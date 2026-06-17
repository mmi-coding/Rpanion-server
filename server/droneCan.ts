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
const GETSET_DTID = 11 // uavcan.protocol.param.GetSet (service)
// uavcan.protocol.GetNodeInfo data-type signature 0xee468a8121c46a9e, little-endian
// (libcanard UAVCAN_PROTOCOL_GETNODEINFO_SIGNATURE) — seeds the transfer CRC below
const GETNODEINFO_SIG = [0x9e, 0x6a, 0xc4, 0x21, 0x81, 0x8a, 0x46, 0xee]
// uavcan.protocol.param.GetSet data-type signature 0xa7b622f939d1a4d5, little-endian
const GETSET_SIG = [0xd5, 0xa4, 0xd1, 0x39, 0xf9, 0x22, 0xb6, 0xa7]
const OUR_NODE_ID = 127 // this monitor's DroneCAN node id (GCS convention)
const PRIORITY = 30 // low priority for our service requests
const CAN_EFF_FLAG = 0x80000000 // extended-frame flag in the MAVLink CAN_FRAME id
const RE_FORWARD_MS = 1000 // re-arm the active bus every second — forwarding lapses ~5 s on the FC; matches the DroneCAN GUI tool's 1 Hz CAN_FORWARD keepalive
const PER_BUS_MS = 5000 // dwell per bus before rotating: the FC forwards only ONE bus at a time, so we sweep the requested buses in turn
const MAX_INFO_TRIES = 8 // GetNodeInfo retries per node (multi-frame responses can be lossy over CAN forwarding)
const MAX_PARAM_TRIES = 10 // unanswered-GetSet retries (per index) before a stalled param scan gives up
const MAX_PARAM_INDEX = 2000 // safety bound on the index sweep (a node that never returns an empty name)

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

// A multi-frame transfer is prefixed with a 2-byte transfer CRC = CRC-16 over the
// data-type signature (LE) then the message bytes. Validating it rejects transfers
// corrupted by a dropped forwarded frame (which would otherwise yield garbled
// fields) so the result is discarded and retried rather than trusted.
function transferCrcOk (transfer: number[], sig: number[]): boolean {
  if (transfer.length < 3) {
    return false
  }
  const expected = (transfer[0] | (transfer[1] << 8)) >>> 0
  return crc16(transfer.slice(2), crc16(sig)) === expected
}

// GetNodeInfo responses are multi-frame → carry a transfer CRC (truncated/garbled
// name otherwise sticks).
function getNodeInfoCrcOk (transfer: number[]): boolean {
  return transferCrcOk(transfer, GETNODEINFO_SIG)
}

// GetSet responses are multi-frame (except the 4-byte end-of-list sentinel) → carry
// a transfer CRC; a dropped frame would otherwise mis-decode a parameter's value.
function getSetCrcOk (transfer: number[]): boolean {
  return transferCrcOk(transfer, GETSET_SIG)
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

// ---- uavcan.protocol.param.GetSet codec (read-only) ----
//
// GetSet enumerates a node's parameters by index. Its request/response use bit-level
// DSDL packing, but the .Response is deliberately byte-aligned: each Value/NumericValue
// union is prefixed with void padding (void5 / void6) so that (padding + tag) fills a
// whole byte and every payload that follows is byte-aligned. That lets us decode it with
// plain byte reads — no general bit-stream reader needed. Tag values: Value {0 empty,
// 1 int64, 2 float32, 3 bool(uint8), 4 string(uint8[<=128])}; NumericValue {0 empty,
// 1 int64, 2 float32}. The trailing name is tail-array-optimised (no length prefix — it
// runs to the end of the transfer); an empty name marks "no such parameter" (end of list).

// signed int64, little-endian → a JS number when it fits exactly, else a decimal string
function readI64LE (b: number[], o: number): number | string {
  let v = 0n
  for (let i = 7; i >= 0; i--) {
    v = (v << 8n) | BigInt(b[o + i] & 0xff)
  }
  if (v >= (1n << 63n)) {
    v -= (1n << 64n) // two's complement
  }
  return (v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER)) ? Number(v) : v.toString()
}

// float32, little-endian → double, trimmed to float32's ~7 significant digits so display
// values come out clean (1.5, 0.1) rather than 0.10000000149…
function readF32LE (b: number[], o: number): number {
  const x = Buffer.from([b[o], b[o + 1], b[o + 2], b[o + 3]]).readFloatLE(0)
  return Number.isFinite(x) ? Number(x.toPrecision(7)) : x
}

// a uavcan.protocol.param.Value union at byte offset o (the void5+tag byte, then payload)
function readValueUnion (b: number[], o: number): { kind: string, value: any, next: number } | null {
  if (o >= b.length) {
    return null
  }
  const tag = b[o] & 0x07
  o += 1
  if (tag === 0) { return { kind: 'empty', value: null, next: o } }
  if (tag === 1) { return (o + 8 > b.length) ? null : { kind: 'int', value: readI64LE(b, o), next: o + 8 } }
  if (tag === 2) { return (o + 4 > b.length) ? null : { kind: 'real', value: readF32LE(b, o), next: o + 4 } }
  if (tag === 3) { return (o + 1 > b.length) ? null : { kind: 'bool', value: b[o] !== 0, next: o + 1 } }
  if (tag === 4) { // uint8[<=128] string: one-byte length prefix (not the last field → prefixed)
    if (o >= b.length) { return null }
    const len = b[o]
    o += 1
    if (o + len > b.length) { return null }
    return { kind: 'string', value: b.slice(o, o + len).map((c) => String.fromCharCode(c)).join(''), next: o + len }
  }
  return null // tags 5..7 are undefined for Value
}

// a uavcan.protocol.param.NumericValue union at byte offset o (void6+tag byte, then payload)
function readNumericUnion (b: number[], o: number): { value: any, next: number } | null {
  if (o >= b.length) {
    return null
  }
  const tag = b[o] & 0x03
  o += 1
  if (tag === 0) { return { value: null, next: o } }
  if (tag === 1) { return (o + 8 > b.length) ? null : { value: readI64LE(b, o), next: o + 8 } }
  if (tag === 2) { return (o + 4 > b.length) ? null : { value: readF32LE(b, o), next: o + 4 } }
  return null // tag 3 is undefined for NumericValue
}

// uavcan.protocol.param.GetSet.Response (transfer CRC already stripped):
// value, default_value, max_value, min_value, name. Returns the decoded parameter, or
// null if any union is truncated. An empty name (value tag empty) signals end-of-list.
function decodeGetSetResponse (payload: number[]): any {
  const value = readValueUnion(payload, 0)
  if (value === null) { return null }
  const def = readValueUnion(payload, value.next)
  if (def === null) { return null }
  const max = readNumericUnion(payload, def.next)
  if (max === null) { return null }
  const min = readNumericUnion(payload, max.next)
  if (min === null) { return null }
  const name = payload.slice(min.next).map((c) => String.fromCharCode(c)).join('')
  return { name, type: value.kind, value: value.value, defaultValue: def.value, min: min.value, max: max.value }
}

// uavcan.protocol.param.GetSet.Request for a read-by-index: uint13 index, empty Value
// (3-bit tag = 0), empty name (TAO). DSDL packs the 13-bit index little-endian by byte
// with MSB-first bits, so byte0 = index[7:0] and byte1 = index[12:8] in its high 5 bits,
// the empty-value tag (0) occupying the low 3. (Verified against pydronecan vectors.)
function encodeGetSetRequestByIndex (index: number): number[] {
  return [index & 0xff, ((index >> 8) & 0x1f) << 3]
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
  paramScan: any
  paramForwardTimer: any

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
    this.paramScan = null // active/last parameter enumeration (see scanParams)
    this.paramForwardTimer = null
  }

  // start a scan. The FC forwards only one CAN bus at a time, so — like the
  // DroneCAN GUI tool, which connects per-bus — we dwell on each requested bus
  // in turn (re-arming it every second), sweeping them all within one scan.
  scan (buses: number[]): void {
    this.stop()
    this.stopParams() // a node scan and a param scan can't share the single forwarded bus
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

  // ---- parameter enumeration (uavcan.protocol.param.GetSet, read-only) ----

  // Enumerate one node's parameters by index. Like a ground station's parameter
  // inspector, we GetSet index 0,1,2,… until the node returns an empty name. The FC
  // forwards a single bus, so this takes over forwarding for the node's bus (stopping
  // any node scan); responses drive the next request, with a 1 Hz retry for dropped
  // ones. Read-only: every request carries an empty value (a pure read, never a set).
  scanParams (nodeId: number, bus: number): void {
    this.stop() // free the single forwarded bus from any node scan
    this.stopParams()
    this.reasm = new Reassembler()
    this.paramScan = { nodeId, bus, index: 0, tries: 0, expectTid: -1, params: [], scanning: true, done: false, error: null }
    this.fcManager.canForward(bus)
    this._requestParam()
    this.paramForwardTimer = setInterval(() => this._paramTick(), RE_FORWARD_MS)
  }

  stopParams (): void {
    if (this.paramForwardTimer !== null) {
      clearInterval(this.paramForwardTimer)
      this.paramForwardTimer = null
    }
  }

  // 1 Hz: re-arm CAN forwarding for the node's bus and re-request the current index
  // (covers a dropped request or response); give up after MAX_PARAM_TRIES stalls.
  _paramTick (): void {
    const ps = this.paramScan
    this.fcManager.canForward(ps.bus)
    ps.tries += 1
    if (ps.tries > MAX_PARAM_TRIES) {
      this._finishParams('timeout')
      return
    }
    this._requestParam()
  }

  _requestParam (): void {
    const ps = this.paramScan
    const tid = this.transferId & 0x1f
    this.transferId = (this.transferId + 1) & 0x1f
    ps.expectTid = tid // service responses echo the request's transfer id — correlate on it
    const core = ((PRIORITY << 24) | (GETSET_DTID << 16) | (1 << 15) | (ps.nodeId << 8) | (1 << 7) | OUR_NODE_ID) >>> 0
    const id = (CAN_EFF_FLAG | core) >>> 0
    this.fcManager.sendCanFrame(ps.bus, id, [...encodeGetSetRequestByIndex(ps.index), 0xc0 | tid]) // SOT|EOT single-frame
  }

  _onParamFrame (body: number[], tail: any, cid: any): void {
    const ps = this.paramScan
    const res = this.reasm.accept('gs:' + cid.source, body, tail)
    if (res === null) {
      return
    }
    if (tail.transferId !== ps.expectTid) {
      return // a response to a superseded (retried) request — ignore, await the current one
    }
    // multi-frame GetSet responses carry a transfer CRC; a dropped frame → reject + retry
    const payload = res.multiframe ? (getSetCrcOk(res.bytes) ? res.bytes.slice(2) : null) : res.bytes
    if (payload === null) {
      return
    }
    const p = decodeGetSetResponse(payload)
    if (p === null) {
      return
    }
    if (p.name === '') {
      this._finishParams(null) // empty name = no such parameter = end of list
      return
    }
    ps.params.push({ index: ps.index, name: p.name, type: p.type, value: p.value, defaultValue: p.defaultValue, min: p.min, max: p.max })
    ps.index += 1
    ps.tries = 0
    if (ps.index > MAX_PARAM_INDEX) {
      this._finishParams(null)
      return
    }
    this._requestParam() // response received → immediately request the next index
  }

  _finishParams (error: string | null): void {
    if (this.paramScan !== null) {
      this.paramScan.scanning = false
      this.paramScan.done = true
      this.paramScan.error = error
    }
    this.stopParams()
  }

  // current/last parameter-enumeration state for the GET endpoint + socket push
  getParamScan (): any {
    const ps = this.paramScan
    if (ps === null) {
      return { active: false, nodeId: null, bus: null, scanning: false, done: false, error: null, params: [] }
    }
    return { active: true, nodeId: ps.nodeId, bus: ps.bus, scanning: ps.scanning, done: ps.done, error: ps.error, params: ps.params }
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
      // only service responses addressed to *us* — the autopilot also polls these
      // services, and its responses (same source node, different dest) would
      // otherwise interleave under one reassembly key and corrupt every transfer
      if (cid.requestNotResponse !== 0 || cid.dest !== OUR_NODE_ID) {
        return
      }
      if (cid.serviceTypeId === GETNODEINFO_DTID) {
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
      } else if (cid.serviceTypeId === GETSET_DTID && this.paramScan !== null && cid.source === this.paramScan.nodeId) {
        this._onParamFrame(body, tail, cid)
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
;(DroneCANMonitor as any).decodeGetSetResponse = decodeGetSetResponse
;(DroneCANMonitor as any).encodeGetSetRequestByIndex = encodeGetSetRequestByIndex
;(DroneCANMonitor as any).getSetCrcOk = getSetCrcOk
;(DroneCANMonitor as any).GETSET_SIG = GETSET_SIG

export = DroneCANMonitor
