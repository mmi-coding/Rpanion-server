// DroneCAN (UAVCAN v0) node enumeration over MAVLink CAN forwarding.
//
// ArduPilot does not stream UAVCAN_NODE_STATUS over MAVLink, so the FC
// Configuration page cannot list DroneCAN nodes from passive telemetry. Instead
// we do what a ground station's DroneCAN screen does: ask the FC to tunnel a CAN
// bus to us (MAV_CMD_CAN_FORWARD → CAN_FRAME), then speak DroneCAN over it —
// decode periodic NodeStatus broadcasts for liveness, and send a GetNodeInfo
// service request to each discovered node to learn its name + versions.
//
// Decoding is lenient (no transfer-CRC validation) — correct for a read-only
// monitor and avoids needing per-message DSDL signatures.
const { common } = require('node-mavlink')

const CAN_FRAME_MSGID: number = common.CanFrame.MSG_ID // 386
const NODESTATUS_DTID = 341 // uavcan.protocol.NodeStatus (message)
const GETNODEINFO_DTID = 1 // uavcan.protocol.GetNodeInfo (service)
const OUR_NODE_ID = 127 // this monitor's DroneCAN node id (GCS convention)
const PRIORITY = 30 // low priority for our service requests
const CAN_EFF_FLAG = 0x80000000 // extended-frame flag in the MAVLink CAN_FRAME id
const RE_FORWARD_MS = 1000 // forwarding lapses 5 s on the FC → re-request (also paces GetNodeInfo retries)
const SCAN_MS = 10000 // default scan window
const MAX_INFO_TRIES = 8 // GetNodeInfo retries per node (multi-frame responses can be lossy over CAN forwarding)

const HEALTH: { [k: number]: string } = { 0: 'OK', 1: 'Warning', 2: 'Error', 3: 'Critical' }
const MODE: { [k: number]: string } = { 0: 'Operational', 1: 'Initialization', 2: 'Maintenance', 3: 'Software update', 7: 'Offline' }

// ---- pure decoders (unit-tested with synthetic frames) ----

// split the 29-bit DroneCAN CAN id (the MAVLink extended-frame flag is masked off)
function parseCanId (id: number): any {
  const e = (id & 0x1fffffff) >>> 0
  const source = e & 0x7f
  const priority = (e >>> 24) & 0x1f
  if (((e >>> 7) & 1) === 1) {
    return { service: true, priority, serviceTypeId: (e >>> 16) & 0xff, requestNotResponse: (e >>> 15) & 1, dest: (e >>> 8) & 0x7f, source }
  }
  return { service: false, priority, messageTypeId: (e >>> 8) & 0xffff, source }
}

// the last byte of every DroneCAN CAN frame
function parseTail (b: number): any {
  return { sot: (b & 0x80) !== 0, eot: (b & 0x40) !== 0, toggle: (b & 0x20) !== 0, transferId: b & 0x1f }
}

function readU32LE (b: number[], o: number): number {
  return ((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0)
}

// uavcan.protocol.NodeStatus payload (7 bytes); bit fields are MSB-first per UAVCAN v0
function decodeNodeStatus (body: number[]): any {
  if (body.length < 7) {
    return null
  }
  const b4 = body[4]
  return {
    uptimeSec: readU32LE(body, 0),
    health: (b4 >>> 6) & 0x03,
    mode: (b4 >>> 3) & 0x07,
    subMode: b4 & 0x07,
    vendorCode: body[5] | (body[6] << 8)
  }
}

function hexId (bytes: number[]): string {
  return bytes.map((x) => x.toString(16).padStart(2, '0')).join('')
}

// uavcan.protocol.GetNodeInfo.Response payload (transfer CRC already stripped).
// Byte-aligned in v0: NodeStatus(7) + SoftwareVersion(15) + HardwareVersion
// (major,minor,unique_id[16]) + certificate_of_authenticity(len-prefixed) + name.
function decodeNodeInfo (payload: number[]): any {
  if (payload.length < 41) {
    return null
  }
  const coaLen = payload[40]
  const nameStart = 41 + coaLen
  const name = payload.slice(nameStart).map((c) => String.fromCharCode(c)).join('')
  return {
    name,
    swVersion: payload[7] + '.' + payload[8],
    vcsCommit: readU32LE(payload, 10).toString(16),
    hwVersion: payload[22] + '.' + payload[23],
    uniqueId: hexId(payload.slice(24, 40))
  }
}

// Reassembles DroneCAN transfers (single- and multi-frame). Returns the
// completed payload (with the 2-byte transfer CRC stripped on multi-frame), or
// null while a transfer is still in progress / on a dropped frame.
class Reassembler {
  transfers: { [k: string]: { chunks: number[][], toggle: boolean, transferId: number } }

  constructor () {
    this.transfers = {}
  }

  accept (key: string, body: number[], tail: any): number[] | null {
    if (tail.sot && tail.eot) {
      return body // single-frame transfer, no CRC prefix
    }
    if (tail.sot) {
      this.transfers[key] = { chunks: [body], toggle: tail.toggle, transferId: tail.transferId }
      return null
    }
    const t = this.transfers[key]
    if (t === undefined) {
      return null // continuation with no start → drop
    }
    if (t.transferId !== tail.transferId || tail.toggle === t.toggle) {
      delete this.transfers[key] // wrong transfer / duplicate toggle → drop
      return null
    }
    t.toggle = tail.toggle
    t.chunks.push(body)
    if (!tail.eot) {
      return null
    }
    delete this.transfers[key]
    const all = ([] as number[]).concat(...t.chunks)
    return all.slice(2) // strip the 2-byte transfer CRC
  }
}

class DroneCANMonitor {
  fcManager: any
  nodes: { [id: number]: any }
  reasm: Reassembler
  scanning: boolean
  buses: number[]
  forwardTimer: any
  stopTimer: any
  transferId: number
  stats: any

  constructor (fcManager: any) {
    this.fcManager = fcManager
    this.nodes = {}
    this.reasm = new Reassembler()
    this.scanning = false
    this.buses = []
    this.forwardTimer = null
    this.stopTimer = null
    this.transferId = 0
    this.stats = { frames: 0, nodeStatus: 0, service: 0, nodeInfo: 0, requests: 0 }
  }

  // start a scan: enable forwarding on each bus (re-requested every second) and
  // collect nodes for the scan window
  scan (buses: number[], durationMs: number = SCAN_MS): void {
    this.stop()
    this.nodes = {}
    this.reasm = new Reassembler()
    this.stats = { frames: 0, nodeStatus: 0, service: 0, nodeInfo: 0, requests: 0 }
    this.buses = buses
    this.scanning = true
    this._forward()
    this.forwardTimer = setInterval(() => this._forward(), RE_FORWARD_MS)
    this.stopTimer = setTimeout(() => this.stop(), durationMs)
  }

  _forward (): void {
    for (const b of this.buses) {
      this.fcManager.canForward(b)
      // forward only NodeStatus (msg type 341) + GetNodeInfo (svc type 1) so the
      // FC's small forward buffer isn't saturated by other bus traffic, which
      // would truncate multi-frame GetNodeInfo responses (ids must be sorted)
      this.fcManager.canFilter(b, [GETNODEINFO_DTID, NODESTATUS_DTID])
    }
    // retry GetNodeInfo for nodes we've seen but don't yet have a name for
    // (the first request can be lost right after forwarding arms)
    for (const k of Object.keys(this.nodes)) {
      const n = this.nodes[parseInt(k)]
      if (n.name === undefined && n.bus !== undefined && (n.infoTries || 0) < MAX_INFO_TRIES) {
        n.infoTries = (n.infoTries || 0) + 1
        this._requestNodeInfo(n.bus, n.id)
      }
    }
  }

  stop (): void {
    this.scanning = false
    if (this.forwardTimer !== null) {
      clearInterval(this.forwardTimer)
      this.forwardTimer = null
    }
    if (this.stopTimer !== null) {
      clearTimeout(this.stopTimer)
      this.stopTimer = null
    }
  }

  // feed one decoded MAVLink CAN_FRAME (from the fcManager gotMessage stream)
  onCanFrame (packet: any, data: any): void {
    if (packet === null || packet === undefined || packet.header === undefined) {
      return
    }
    if (packet.header.msgid !== CAN_FRAME_MSGID || data === null || data === undefined) {
      return
    }
    const len = data.len
    if (len < 1) {
      return
    }
    this.stats.frames++
    const bytes = data.data.slice(0, len)
    const tail = parseTail(bytes[len - 1])
    const body = bytes.slice(0, len - 1)
    const cid = parseCanId(data.id)
    if (cid.service) {
      this.stats.service++
      // only GetNodeInfo responses addressed to *us* — the autopilot also polls
      // GetNodeInfo, and its responses (same source node, different dest) would
      // otherwise interleave under one reassembly key and corrupt every transfer
      if (cid.serviceTypeId !== GETNODEINFO_DTID || cid.requestNotResponse !== 0 || cid.dest !== OUR_NODE_ID) {
        return
      }
      this.stats.nodeInfo++
      const payload = this.reasm.accept('s:' + cid.source, body, tail)
      if (payload !== null) {
        const info = decodeNodeInfo(payload)
        if (info !== null) {
          this._mergeInfo(cid.source, info)
        }
      }
    } else {
      if (cid.messageTypeId !== NODESTATUS_DTID) {
        return // only NodeStatus broadcasts
      }
      this.stats.nodeStatus++
      const payload = this.reasm.accept('m:' + cid.source, body, tail)
      if (payload !== null) {
        const st = decodeNodeStatus(payload)
        if (st !== null) {
          this._mergeStatus(cid.source, data.bus, st)
        }
      }
    }
  }

  _mergeStatus (id: number, bus: number, st: any): void {
    const n = this.nodes[id] || { id, infoTries: 0 }
    n.bus = bus
    n.health = HEALTH[st.health] // st.health is a 2-bit field (0..3) — always mapped
    n.mode = MODE[st.mode] || ('Mode ' + st.mode)
    n.uptimeSec = st.uptimeSec
    n.vendorCode = st.vendorCode
    n.lastMs = Date.now()
    this.nodes[id] = n
    // GetNodeInfo is requested (and retried) from _forward, so a single dropped
    // request doesn't permanently leave the node nameless
  }

  _mergeInfo (id: number, info: any): void {
    const n = this.nodes[id] || { id, infoTries: 0 }
    n.name = info.name
    n.swVersion = info.swVersion
    n.hwVersion = info.hwVersion
    n.uniqueId = info.uniqueId
    this.nodes[id] = n
  }

  _requestNodeInfo (bus: number, dest: number): void {
    this.stats.requests++
    const tid = this.transferId & 0x1f
    this.transferId = (this.transferId + 1) & 0x1f
    const core = ((PRIORITY << 24) | (GETNODEINFO_DTID << 16) | (1 << 15) | (dest << 8) | (1 << 7) | OUR_NODE_ID) >>> 0
    const id = (CAN_EFF_FLAG | core) >>> 0
    this.fcManager.sendCanFrame(bus, id, [0xc0 | tid]) // empty request: SOT|EOT|toggle0|tid
  }

  getNodes (): any[] {
    return Object.keys(this.nodes).map((k) => this.nodes[parseInt(k)]).sort((a, b) => a.id - b.id)
  }

  // scan health counters (frames forwarded back, NodeStatus/service/GetNodeInfo
  // seen, requests sent) — surfaced so the bus's liveness is visible even when no
  // node fully decodes
  getStats (): any {
    return this.stats
  }
}

// expose the pure decoders as statics for direct unit testing
;(DroneCANMonitor as any).parseCanId = parseCanId
;(DroneCANMonitor as any).parseTail = parseTail
;(DroneCANMonitor as any).decodeNodeStatus = decodeNodeStatus
;(DroneCANMonitor as any).decodeNodeInfo = decodeNodeInfo
;(DroneCANMonitor as any).Reassembler = Reassembler

export = DroneCANMonitor
