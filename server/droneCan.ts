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
// uavcan.protocol.GetNodeInfo data-type signature 0xee468a8121c46a9e, little-endian
// (libcanard UAVCAN_PROTOCOL_GETNODEINFO_SIGNATURE) — seeds the transfer CRC below
const GETNODEINFO_SIG = [0x9e, 0x6a, 0xc4, 0x21, 0x81, 0x8a, 0x46, 0xee]
const OUR_NODE_ID = 127 // this monitor's DroneCAN node id (GCS convention)
const PRIORITY = 30 // low priority for our service requests
const CAN_EFF_FLAG = 0x80000000 // extended-frame flag in the MAVLink CAN_FRAME id
const RE_FORWARD_MS = 1000 // re-arm the active bus every second — forwarding lapses ~5 s on the FC; matches the DroneCAN GUI tool's 1 Hz CAN_FORWARD keepalive
const PER_BUS_MS = 5000 // dwell per bus before rotating: the FC forwards only ONE bus at a time, so we sweep the requested buses in turn
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

// CRC-16-CCITT (poly 0x1021, init 0xffff, no reflection) — the DroneCAN/UAVCAN v0
// transfer CRC. Check value 0x29b1 for "123456789".
function crc16 (bytes: number[], crc: number = 0xffff): number {
  for (const b of bytes) {
    crc = (crc ^ (b << 8)) & 0xffff
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x8000) ? (((crc << 1) ^ 0x1021) & 0xffff) : ((crc << 1) & 0xffff)
    }
  }
  return crc
}

// A multi-frame GetNodeInfo response is prefixed with a 2-byte transfer CRC =
// CRC-16 over the data-type signature (LE) then the message bytes. Validating it
// rejects transfers corrupted by a dropped forwarded frame (which yields a
// truncated/garbled name) so the node stays nameless and is retried.
function getNodeInfoCrcOk (transfer: number[]): boolean {
  if (transfer.length < 3) {
    return false
  }
  const expected = (transfer[0] | (transfer[1] << 8)) >>> 0
  return crc16(transfer.slice(2), crc16(GETNODEINFO_SIG)) === expected
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

  accept (key: string, body: number[], tail: any): { bytes: number[], multiframe: boolean } | null {
    if (tail.sot && tail.eot) {
      return { bytes: body, multiframe: false } // single-frame transfer, no transfer CRC
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
    // multi-frame: the leading 2 bytes are the transfer CRC (caller validates + strips)
    return { bytes: ([] as number[]).concat(...t.chunks), multiframe: true }
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
  tick: number
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
    this.tick = 0
    this.stats = { frames: 0, nodeStatus: 0, service: 0, nodeInfo: 0, requests: 0 }
  }

  // start a scan. The FC forwards only one CAN bus at a time, so — like the
  // DroneCAN GUI tool, which connects per-bus — we dwell on each requested bus
  // in turn (re-arming it every second), sweeping them all within one scan.
  scan (buses: number[]): void {
    this.stop()
    this.nodes = {}
    this.reasm = new Reassembler()
    this.stats = { frames: 0, nodeStatus: 0, service: 0, nodeInfo: 0, requests: 0 }
    this.buses = buses.length > 0 ? buses : [0]
    this.scanning = true
    this.tick = 0
    this._forward()
    this.forwardTimer = setInterval(() => this._forward(), RE_FORWARD_MS)
    // run long enough for every requested bus to get one full dwell
    this.stopTimer = setTimeout(() => this.stop(), this.buses.length * PER_BUS_MS)
  }

  _forward (): void {
    // ArduPilot forwards exactly one bus per MAVLink channel — a new
    // MAV_CMD_CAN_FORWARD unregisters the previous bus — so forward a single bus,
    // rotating to the next once its dwell elapses, re-arming it on every tick.
    // No CAN_FILTER_MODIFY: like the GUI tool we forward all frames (a filter is
    // available but defaults off), so multi-frame GetNodeInfo isn't starved.
    const dwellTicks = Math.max(1, Math.round(PER_BUS_MS / RE_FORWARD_MS))
    const bus = this.buses[Math.floor(this.tick / dwellTicks) % this.buses.length]
    this.tick++
    this.fcManager.canForward(bus)
    // retry GetNodeInfo for nameless nodes seen on the bus we're forwarding now
    // (a request on a non-forwarded bus goes nowhere; the first one can also be
    // lost right after forwarding arms)
    for (const k of Object.keys(this.nodes)) {
      const n = this.nodes[parseInt(k)]
      if (n.bus === bus && n.name === undefined && (n.infoTries || 0) < MAX_INFO_TRIES) {
        n.infoTries = (n.infoTries || 0) + 1
        this._requestNodeInfo(bus, n.id)
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
      const res = this.reasm.accept('s:' + cid.source, body, tail)
      if (res !== null) {
        // GetNodeInfo responses are multi-frame and carry a transfer CRC; verify it
        // so a dropped frame (→ partial/garbled name) is rejected, leaving the node
        // nameless to be retried, instead of a wrong name sticking
        const payload = res.multiframe ? (getNodeInfoCrcOk(res.bytes) ? res.bytes.slice(2) : null) : res.bytes
        if (payload !== null) {
          const info = decodeNodeInfo(payload)
          if (info !== null) {
            this._mergeInfo(cid.source, info)
          }
        }
      }
    } else {
      if (cid.messageTypeId !== NODESTATUS_DTID) {
        return // only NodeStatus broadcasts
      }
      this.stats.nodeStatus++
      const res = this.reasm.accept('m:' + cid.source, body, tail)
      if (res !== null) {
        const st = decodeNodeStatus(res.bytes) // NodeStatus is single-frame (no CRC)
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
;(DroneCANMonitor as any).crc16 = crc16
;(DroneCANMonitor as any).getNodeInfoCrcOk = getNodeInfoCrcOk
;(DroneCANMonitor as any).GETNODEINFO_SIG = GETNODEINFO_SIG

export = DroneCANMonitor
