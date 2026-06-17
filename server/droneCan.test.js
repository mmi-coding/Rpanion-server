const assert = require('assert')
const sinon = require('sinon')
const DroneCANMonitor = require('./droneCan')
const { parseCanId, parseTail, decodeNodeStatus, decodeNodeInfo, Reassembler, crc16, getNodeInfoCrcOk } = DroneCANMonitor
const { decodeGetSetResponse, encodeGetSetRequestByIndex, getSetCrcOk } = DroneCANMonitor

// prefix a GetNodeInfo body with its valid 2-byte transfer CRC (LE), as the FC does
function withCrc (body) {
  const c = crc16(body, crc16(DroneCANMonitor.GETNODEINFO_SIG))
  return [c & 0xff, (c >> 8) & 0xff, ...body]
}

const CAN_FRAME = 386 // common.CanFrame.MSG_ID
const PKT = { header: { msgid: CAN_FRAME } }

// ---- synthetic-frame helpers ----
function pad8 (a) { const b = a.slice(); while (b.length < 8) { b.push(0) } return b }
function frame (id, bus, dataArr) { return { id, bus, len: dataArr.length, data: pad8(dataArr) } }
// message-frame 29-bit id with the extended-frame flag (as the FC forwards it)
function msgId (source, dtid) { return (0x80000000 | (30 << 24) | ((dtid & 0xffff) << 8) | (source & 0x7f)) >>> 0 }
// service-response 29-bit id (req/resp bit = 0)
function svcRespId (source, dest, stid) { return (0x80000000 | (30 << 24) | ((stid & 0xff) << 16) | ((dest & 0x7f) << 8) | (1 << 7) | (source & 0x7f)) >>> 0 }
function nodeStatusBody (health, mode, sub, uptime, vendor) {
  const b4 = ((health & 3) << 6) | ((mode & 7) << 3) | (sub & 7)
  return [uptime & 0xff, (uptime >> 8) & 0xff, (uptime >> 16) & 0xff, (uptime >>> 24) & 0xff, b4, vendor & 0xff, (vendor >> 8) & 0xff]
}
function nodeInfoPayload (name, coa = []) {
  const ns = nodeStatusBody(0, 0, 0, 100, 0)
  const sw = [1, 2, 0, 0xEF, 0xBE, 0xAD, 0xDE, 0, 0, 0, 0, 0, 0, 0, 0] // 1.2, vcs 0xDEADBEEF
  const hw = [3, 4]
  for (let i = 0; i < 16; i++) { hw.push(i) }
  const nm = [...name].map((c) => c.charCodeAt(0))
  return [...ns, ...sw, ...hw, coa.length, ...coa, ...nm]
}
// chunk a full transfer payload (incl. 2-byte CRC) into multi-frame CAN frames
function chunkToFrames (id, payloadWithCrc, tid) {
  const frames = []
  let i = 0
  let idx = 0
  while (i < payloadWithCrc.length) {
    const chunk = payloadWithCrc.slice(i, i + 7)
    i += 7
    let t = tid & 0x1f
    if (idx === 0) { t |= 0x80 } // SOT
    if (i >= payloadWithCrc.length) { t |= 0x40 } // EOT
    if (idx % 2 === 1) { t |= 0x20 } // toggle
    frames.push(frame(id, 0, [...chunk, t]))
    idx++
  }
  return frames
}

// ---- GetSet (parameter) helpers ----
const GETSET = 11 // uavcan.protocol.param.GetSet service type id
// little-endian int64 bytes for a (possibly BigInt) value
function i64 (v) { const a = []; let x = BigInt(v); for (let k = 0; k < 8; k++) { a.push(Number(x & 0xffn)); x >>= 8n } return a }
// a decodable int-parameter GetSet.Response payload: int value, int default 0, empty max/min, name
function intParamPayload (name, val) {
  return [0x01, ...i64(val), 0x01, ...i64(0), 0x00, 0x00, ...[...name].map((c) => c.charCodeAt(0))]
}
// prefix a multi-frame GetSet transfer with its valid 2-byte transfer CRC (LE)
function withCrcGetSet (body) {
  const c = crc16(body, crc16(DroneCANMonitor.GETSET_SIG))
  return [c & 0xff, (c >> 8) & 0xff, ...body]
}
// CAN frames for a GetSet response transfer with transfer-id tid (responses echo the
// request's tid). ≤7-byte payloads are single-frame (no transfer CRC); larger ones
// are multi-frame and carry the CRC, exactly as a node would send them.
function gsFrames (source, payload, tid) {
  const id = svcRespId(source, 127, GETSET)
  return payload.length <= 7 ? chunkToFrames(id, payload, tid) : chunkToFrames(id, withCrcGetSet(payload), tid)
}

describe('DroneCAN', function () {
  let clock
  let fc

  beforeEach(function () {
    clock = sinon.useFakeTimers(1000000)
    fc = { canForward: sinon.spy(), canFilter: sinon.spy(), sendCanFrame: sinon.spy() }
  })

  afterEach(function () { clock.restore(); sinon.restore() })

  it('parseCanId decodes message vs service frames', function () {
    const m = parseCanId(msgId(11, 341))
    assert.equal(m.service, false)
    assert.equal(m.messageTypeId, 341)
    assert.equal(m.source, 11)
    const s = parseCanId(svcRespId(11, 127, 1))
    assert.equal(s.service, true)
    assert.equal(s.serviceTypeId, 1)
    assert.equal(s.requestNotResponse, 0)
    assert.equal(s.dest, 127)
    assert.equal(s.source, 11)
  })

  it('parseTail decodes the tail byte', function () {
    const t = parseTail(0xC5) // SOT|EOT, transferId 5
    assert.deepEqual({ sot: t.sot, eot: t.eot, toggle: t.toggle, transferId: t.transferId }, { sot: true, eot: true, toggle: false, transferId: 5 })
    assert.equal(parseTail(0x20).toggle, true)
  })

  it('decodeNodeStatus reads fields (and rejects a short payload)', function () {
    const st = decodeNodeStatus(nodeStatusBody(2, 3, 1, 1234, 7))
    assert.deepEqual({ h: st.health, m: st.mode, s: st.subMode, u: st.uptimeSec, v: st.vendorCode }, { h: 2, m: 3, s: 1, u: 1234, v: 7 })
    assert.equal(decodeNodeStatus([0, 0, 0]), null)
  })

  it('decodeNodeInfo reads name/versions (with and without COA; rejects short)', function () {
    const a = decodeNodeInfo(nodeInfoPayload('org.test.gps'))
    assert.equal(a.name, 'org.test.gps')
    assert.equal(a.swVersion, '1.2')
    assert.equal(a.hwVersion, '3.4')
    assert.equal(a.vcsCommit, 'deadbeef')
    assert.equal(a.uniqueId.length, 32)
    const b = decodeNodeInfo(nodeInfoPayload('x', [0xAA, 0xBB])) // non-empty COA shifts the name
    assert.equal(b.name, 'x')
    assert.equal(decodeNodeInfo([1, 2, 3]), null)
  })

  it('crc16 is CRC-16-CCITT (check value 0x29b1 for "123456789")', function () {
    assert.equal(crc16([...'123456789'].map((c) => c.charCodeAt(0))), 0x29b1)
  })

  it('getNodeInfoCrcOk validates the transfer CRC (and rejects short/corrupt transfers)', function () {
    const transfer = withCrc(nodeInfoPayload('org.test'))
    assert.equal(getNodeInfoCrcOk(transfer), true)
    const corrupt = transfer.slice()
    corrupt[corrupt.length - 1] ^= 0xff // flip a payload byte → CRC no longer matches
    assert.equal(getNodeInfoCrcOk(corrupt), false)
    assert.equal(getNodeInfoCrcOk([0x00, 0x01]), false) // too short to hold CRC + body
  })

  it('Reassembler handles single + multi frame and drops bad frames', function () {
    const r = new Reassembler()
    assert.deepEqual(r.accept('k', [1, 2, 3], parseTail(0xC0)), { bytes: [1, 2, 3], multiframe: false }) // single-frame
    // multi-frame: SOT(crc,crc,a) → cont(b) → EOT(c); CRC kept for the caller to verify
    assert.equal(r.accept('m', [0xAA, 0xBB, 1], parseTail(0x80 | 0)), null) // SOT, toggle0
    assert.equal(r.accept('m', [2], parseTail(0x20 | 0)), null) // cont, toggle1
    assert.deepEqual(r.accept('m', [3], parseTail(0x40 | 0)), { bytes: [0xAA, 0xBB, 1, 2, 3], multiframe: true }) // EOT, toggle0
    // continuation with no start → null
    assert.equal(r.accept('z', [9], parseTail(0x00)), null)
    // transfer-id mismatch drops the in-progress transfer
    assert.equal(r.accept('q', [0, 0, 1], parseTail(0x80 | 5)), null)
    assert.equal(r.accept('q', [2], parseTail(0x20 | 6)), null) // different transferId → drop
    // duplicate toggle drops
    assert.equal(r.accept('d', [0, 0, 1], parseTail(0x80 | 0)), null)
    assert.equal(r.accept('d', [2], parseTail(0x80 | 0)), null) // same toggle (0) → drop
  })

  it('scan() sweeps one bus at a time (the FC forwards a single bus), re-arms it, rotates, and auto-stops', function () {
    const m = new DroneCANMonitor(fc)
    m.scan([0, 1])
    assert.equal(fc.canForward.callCount, 1) // ONE bus forwarded at a time, not both
    assert.ok(fc.canForward.calledWith(0)) // starts on the first bus
    assert.equal(m.scanning, true)
    clock.tick(1000)
    assert.equal(fc.canForward.callCount, 2) // re-armed, still dwelling on bus 0
    assert.equal(fc.canForward.lastCall.args[0], 0)
    clock.tick(5000) // past the 5 s dwell → rotate to bus 1
    assert.ok(fc.canForward.calledWith(1))
    clock.tick(10000) // past the scan window (buses.length * PER_BUS_MS)
    assert.equal(m.scanning, false)
    assert.equal(m.forwardTimer, null)
  })

  it('scan() defaults an empty bus list to bus 0', function () {
    const m = new DroneCANMonitor(fc)
    m.scan([])
    assert.deepEqual(m.buses, [0])
    assert.ok(fc.canForward.calledWith(0))
    m.stop()
  })

  it('stop() is idempotent / safe with no timers', function () {
    const m = new DroneCANMonitor(fc)
    m.stop()
    assert.equal(m.scanning, false)
  })

  it('onCanFrame ignores junk frames', function () {
    const m = new DroneCANMonitor(fc)
    m.onCanFrame(null, {})
    m.onCanFrame(undefined, {})
    m.onCanFrame({}, {}) // no header
    m.onCanFrame({ header: { msgid: 30 } }, {}) // not CAN_FRAME
    m.onCanFrame(PKT, null) // null data
    m.onCanFrame(PKT, { len: 0, data: [], id: 0 }) // empty frame
    m.onCanFrame(PKT, frame(svcRespId(11, 127, 99), 0, [1, 0xC0])) // wrong service type
    m.onCanFrame(PKT, frame((0x80000000 | (30 << 24) | (1 << 16) | (1 << 15) | (127 << 8) | (1 << 7) | 11) >>> 0, 0, [1, 0xC0])) // a request (reqNotResp=1), not a response
    m.onCanFrame(PKT, frame(msgId(11, 999), 0, [...nodeStatusBody(0, 0, 0, 1, 0), 0xC0])) // wrong message type
    assert.deepEqual(m.getNodes(), [])
  })

  it('NodeStatus registers a node with decoded fields', function () {
    const m = new DroneCANMonitor(fc)
    m.onCanFrame(PKT, frame(msgId(25, 341), 1, [...nodeStatusBody(1, 0, 0, 42, 0), 0xC0]))
    const n = m.getNodes()
    assert.equal(n.length, 1)
    assert.equal(n[0].id, 25)
    assert.equal(n[0].bus, 1)
    assert.equal(n[0].health, 'Warning')
    assert.equal(n[0].mode, 'Operational')
    assert.equal(n[0].uptimeSec, 42)
  })

  it('_forward requests GetNodeInfo for nameless nodes, retrying, and skips named/busless/exhausted', function () {
    const m = new DroneCANMonitor(fc)
    m.buses = [0]
    m.nodes[5] = { id: 5, bus: 0, infoTries: 0 } // nameless + bus → requested
    m._forward()
    assert.equal(fc.canForward.callCount, 1) // forwarded bus 0 (no CAN_FILTER_MODIFY — all frames forwarded)
    assert.equal(fc.sendCanFrame.callCount, 1) // GetNodeInfo requested
    assert.equal(fc.sendCanFrame.args[0][0], 0) // on the node's bus
    assert.equal(fc.sendCanFrame.args[0][2].length, 1) // empty request: just a tail byte
    assert.equal(m.nodes[5].infoTries, 1)
    fc.sendCanFrame.resetHistory()
    m.nodes[5].name = 'org.x' // now named → skipped
    m.nodes[6] = { id: 6, infoTries: 0 } // no bus → skipped
    m.nodes[7] = { id: 7, bus: 0, infoTries: 8 } // retries exhausted (MAX_INFO_TRIES) → skipped
    m._forward()
    assert.equal(fc.sendCanFrame.callCount, 0)
  })

  it('GetNodeInfo response fills the node name + versions', function () {
    const m = new DroneCANMonitor(fc)
    m.onCanFrame(PKT, frame(msgId(25, 341), 0, [...nodeStatusBody(0, 0, 0, 1, 0), 0xC0]))
    const payload = withCrc(nodeInfoPayload('org.ardupilot.gps')) // valid 2-byte transfer CRC + body
    for (const f of chunkToFrames(svcRespId(25, 127, 1), payload, 3)) {
      m.onCanFrame(PKT, f)
    }
    const n = m.getNodes()[0]
    assert.equal(n.name, 'org.ardupilot.gps')
    assert.equal(n.swVersion, '1.2')
    assert.equal(n.hwVersion, '3.4')
    assert.equal(n.uniqueId.length, 32)
  })

  it('a corrupt multi-frame GetNodeInfo (bad transfer CRC) is rejected so the name is not set', function () {
    const m = new DroneCANMonitor(fc)
    m.onCanFrame(PKT, frame(msgId(25, 341), 1, [...nodeStatusBody(0, 0, 0, 1, 0), 0xC0])) // node seen on bus 1
    const payload = withCrc(nodeInfoPayload('org.ardupilot.gps'))
    payload[payload.length - 2] ^= 0xff // drop/garble a payload byte → CRC mismatch
    for (const f of chunkToFrames(svcRespId(25, 127, 1), payload, 3)) {
      m.onCanFrame(PKT, f)
    }
    assert.equal(m.getNodes()[0].name, undefined) // reassembled but CRC-rejected → still nameless
    // …and the node is still eligible for a GetNodeInfo retry on its bus
    m.buses = [1]
    m._forward()
    assert.ok(fc.sendCanFrame.called)
  })

  it('maps an unknown NodeStatus mode to a numeric fallback', function () {
    const m = new DroneCANMonitor(fc)
    m.onCanFrame(PKT, frame(msgId(7, 341), 0, [...nodeStatusBody(0, 5, 0, 1, 0), 0xC0])) // mode 5 (unmapped)
    assert.equal(m.getNodes()[0].mode, 'Mode 5')
  })

  it('a GetNodeInfo response with no prior NodeStatus still creates the node', function () {
    const m = new DroneCANMonitor(fc)
    const payload = withCrc(nodeInfoPayload('org.lone.node'))
    for (const f of chunkToFrames(svcRespId(60, 127, 1), payload, 0)) {
      m.onCanFrame(PKT, f)
    }
    const n = m.getNodes()
    assert.equal(n.length, 1)
    assert.equal(n[0].id, 60)
    assert.equal(n[0].name, 'org.lone.node')
  })

  it('ignores GetNodeInfo responses addressed to another node (autopilot polling)', function () {
    const m = new DroneCANMonitor(fc)
    const payload = [0xAA, 0xBB, ...nodeInfoPayload('org.someone.else')]
    for (const f of chunkToFrames(svcRespId(60, 5, 1), payload, 0)) { // dest 5, not us (127)
      m.onCanFrame(PKT, f)
    }
    assert.deepEqual(m.getNodes(), []) // not reassembled → no node
  })

  it('tracks scan stats and resets them on a new scan', function () {
    const m = new DroneCANMonitor(fc)
    m.onCanFrame(PKT, frame(msgId(11, 341), 0, [...nodeStatusBody(0, 0, 0, 1, 0), 0xC0])) // NodeStatus
    m.onCanFrame(PKT, frame(svcRespId(11, 127, 99), 0, [1, 0xC0])) // service, wrong type
    m.onCanFrame(PKT, frame(svcRespId(11, 127, 1), 0, [1, 0xC0])) // GetNodeInfo response (won't decode)
    m._requestNodeInfo(0, 11)
    let s = m.getStats()
    assert.deepEqual({ f: s.frames, ns: s.nodeStatus, sv: s.service, ni: s.nodeInfo, rq: s.requests }, { f: 3, ns: 1, sv: 2, ni: 1, rq: 1 })
    m.scan([0])
    s = m.getStats()
    assert.equal(s.frames, 0)
    m.stop()
  })

  it('getNodes sorts by node id', function () {
    const m = new DroneCANMonitor(fc)
    m.onCanFrame(PKT, frame(msgId(50, 341), 0, [...nodeStatusBody(0, 0, 0, 1, 0), 0xC0]))
    m.onCanFrame(PKT, frame(msgId(11, 341), 0, [...nodeStatusBody(0, 0, 0, 1, 0), 0xC0]))
    assert.deepEqual(m.getNodes().map((n) => n.id), [11, 50])
  })

  // ---- uavcan.protocol.param.GetSet codec (vectors verified against pydronecan) ----

  it('encodeGetSetRequestByIndex packs uint13 index + empty value (pydronecan vectors)', function () {
    assert.deepEqual(encodeGetSetRequestByIndex(0), [0x00, 0x00])
    assert.deepEqual(encodeGetSetRequestByIndex(1), [0x01, 0x00])
    assert.deepEqual(encodeGetSetRequestByIndex(37), [0x25, 0x00])
    assert.deepEqual(encodeGetSetRequestByIndex(255), [0xff, 0x00])
    assert.deepEqual(encodeGetSetRequestByIndex(8191), [0xff, 0xf8]) // all 13 index bits set
  })

  it('decodeGetSetResponse decodes int/real/bool/string/end-of-list (pydronecan vectors)', function () {
    const h = (s) => s.trim().split(/\s+/).map((x) => parseInt(x, 16))
    assert.deepEqual(decodeGetSetResponse(h('01 05 00 00 00 00 00 00 00 01 01 00 00 00 00 00 00 00 01 16 00 00 00 00 00 00 00 01 00 00 00 00 00 00 00 00 47 50 53 5f 54 59 50 45')),
      { name: 'GPS_TYPE', type: 'int', value: 5, defaultValue: 1, min: 0, max: 22 })
    assert.deepEqual(decodeGetSetResponse(h('02 00 00 c0 3f 02 00 00 80 3f 02 00 00 20 41 02 00 00 00 00 47 50 53 5f 52 41 54 45')),
      { name: 'GPS_RATE', type: 'real', value: 1.5, defaultValue: 1, min: 0, max: 10 })
    assert.deepEqual(decodeGetSetResponse(h('03 01 03 00 00 00 47 50 53 5f 41 55 54 4f')),
      { name: 'GPS_AUTO', type: 'bool', value: true, defaultValue: false, min: null, max: null })
    assert.deepEqual(decodeGetSetResponse(h('04 05 68 65 6c 6c 6f 04 00 00 00 4e 4f 54 45')),
      { name: 'NOTE', type: 'string', value: 'hello', defaultValue: '', min: null, max: null })
    assert.equal(decodeGetSetResponse(h('00 00 00 00')).name, '') // empty name = end of list
  })

  it('decodeGetSetResponse keeps out-of-safe-range int64 as a string, signed negatives, and float ±inf', function () {
    const big = decodeGetSetResponse([0x01, ...i64(9223372036854775807n), 0x00, 0x00, 0x00, ...[...'BIG'].map((c) => c.charCodeAt(0))])
    assert.equal(big.value, '9223372036854775807') // beyond Number.MAX_SAFE_INTEGER → string
    const neg = decodeGetSetResponse([0x01, ...i64(-5), 0x00, 0x00, 0x00, ...[...'NEG'].map((c) => c.charCodeAt(0))])
    assert.equal(neg.value, -5) // two's-complement, in safe range → number
    const inf = decodeGetSetResponse([0x02, 0x00, 0x00, 0x80, 0x7f, 0x00, 0x00, 0x00, ...[...'INF'].map((c) => c.charCodeAt(0))])
    assert.equal(inf.value, Infinity) // non-finite float32 passes through unrounded
  })

  it('decodeGetSetResponse returns null on any truncated/invalid union', function () {
    const nulls = [
      [], // value union: empty buffer
      [0x01, 1], // value int64 truncated
      [0x02, 0], // value float32 truncated
      [0x03], // value bool truncated
      [0x04], // value string: missing length byte
      [0x04, 0x05, 1], // value string: length runs past the buffer
      [0x05], // value: undefined union tag
      [0x00, 0x01, 1], // default value int64 truncated
      [0x00, 0x00], // max numeric: missing byte
      [0x00, 0x00, 0x01, 1], // max numeric int64 truncated
      [0x00, 0x00, 0x02, 1], // max numeric float32 truncated
      [0x00, 0x00, 0x03], // max numeric: undefined union tag
      [0x00, 0x00, 0x00], // min numeric: missing byte
      [0x00, 0x00, 0x00, 0x01, 1] // min numeric int64 truncated
    ]
    nulls.forEach((p, i) => assert.equal(decodeGetSetResponse(p), null, 'null case ' + i))
  })

  it('getSetCrcOk validates the GetSet transfer CRC (and rejects short/corrupt)', function () {
    const t = withCrcGetSet(intParamPayload('A', 1))
    assert.equal(getSetCrcOk(t), true)
    const bad = t.slice(); bad[bad.length - 1] ^= 0xff
    assert.equal(getSetCrcOk(bad), false)
    assert.equal(getSetCrcOk([0x00]), false) // too short
  })

  // ---- parameter enumeration over CAN forwarding ----

  it('scanParams forwards the node bus, reads index 0, stores the param and auto-requests the next', function () {
    const m = new DroneCANMonitor(fc)
    m.scanParams(125, 0)
    assert.equal(m.paramScan.scanning, true)
    assert.ok(fc.canForward.calledWith(0))
    assert.equal(fc.sendCanFrame.callCount, 1)
    assert.deepEqual(fc.sendCanFrame.getCall(0).args[2], [0x00, 0x00, 0xc0]) // read index 0 + SOT|EOT|tid0
    for (const f of gsFrames(125, intParamPayload('GPS_TYPE', 5), 0)) { m.onCanFrame(PKT, f) }
    const ps = m.getParamScan()
    assert.equal(ps.active, true)
    assert.equal(ps.nodeId, 125)
    assert.equal(ps.bus, 0)
    assert.equal(ps.params.length, 1)
    assert.deepEqual({ n: ps.params[0].name, v: ps.params[0].value, d: ps.params[0].defaultValue, i: ps.params[0].index }, { n: 'GPS_TYPE', v: 5, d: 0, i: 0 })
    assert.equal(fc.sendCanFrame.callCount, 2) // next index auto-requested
    assert.deepEqual(fc.sendCanFrame.getCall(1).args[2], [0x01, 0x00, 0xc1]) // read index 1 + tid1
    m.stopParams()
  })

  it('an empty-name response ends the enumeration', function () {
    const m = new DroneCANMonitor(fc)
    m.scanParams(125, 0)
    for (const f of gsFrames(125, [0, 0, 0, 0], 0)) { m.onCanFrame(PKT, f) } // end-of-list, tid0
    const ps = m.getParamScan()
    assert.equal(ps.scanning, false)
    assert.equal(ps.done, true)
    assert.equal(ps.error, null)
    assert.equal(m.paramForwardTimer, null)
  })

  it('a superseded (wrong transfer-id) response is ignored', function () {
    const m = new DroneCANMonitor(fc)
    m.scanParams(125, 0) // outstanding request tid0
    for (const f of gsFrames(125, intParamPayload('A', 1), 0)) { m.onCanFrame(PKT, f) } // answers index0 → now awaiting tid1
    assert.equal(m.getParamScan().params.length, 1)
    for (const f of gsFrames(125, intParamPayload('A', 1), 0)) { m.onCanFrame(PKT, f) } // late duplicate (tid0) → ignored
    assert.equal(m.getParamScan().params.length, 1)
    m.stopParams()
  })

  it('a corrupt multi-frame response (bad transfer CRC) is ignored and the scan keeps going', function () {
    const m = new DroneCANMonitor(fc)
    m.scanParams(125, 0)
    const payload = withCrcGetSet(intParamPayload('A', 1))
    payload[payload.length - 1] ^= 0xff // garble the name → CRC mismatch
    for (const f of chunkToFrames(svcRespId(125, 127, GETSET), payload, 0)) { m.onCanFrame(PKT, f) }
    assert.equal(m.getParamScan().params.length, 0)
    assert.equal(m.getParamScan().scanning, true)
    m.stopParams()
  })

  it('a CRC-valid but undecodable response is ignored', function () {
    const m = new DroneCANMonitor(fc)
    m.scanParams(125, 0)
    for (const f of gsFrames(125, [0x01, 0, 0, 0, 0, 0, 0, 0], 0)) { m.onCanFrame(PKT, f) } // int64 value, 1 byte short
    assert.equal(m.getParamScan().params.length, 0)
    m.stopParams()
  })

  it('an incomplete (still-in-progress) transfer is held, not decoded', function () {
    const m = new DroneCANMonitor(fc)
    m.scanParams(125, 0)
    m.onCanFrame(PKT, gsFrames(125, intParamPayload('A', 1), 0)[0]) // only the first (SOT) frame
    assert.equal(m.getParamScan().params.length, 0)
    m.stopParams()
  })

  it('_paramTick re-arms forwarding and retries; a stalled node gives up after MAX_PARAM_TRIES', function () {
    const m = new DroneCANMonitor(fc)
    m.scanParams(125, 0)
    fc.canForward.resetHistory(); fc.sendCanFrame.resetHistory()
    clock.tick(1000) // one tick: re-arm + re-request the current index
    assert.ok(fc.canForward.calledWith(0))
    assert.ok(fc.sendCanFrame.called)
    clock.tick(20000) // exceed the retry budget with no response
    const ps = m.getParamScan()
    assert.equal(ps.scanning, false)
    assert.equal(ps.done, true)
    assert.equal(ps.error, 'timeout')
    assert.equal(m.paramForwardTimer, null)
  })

  it('the index sweep is bounded at MAX_PARAM_INDEX', function () {
    const m = new DroneCANMonitor(fc)
    m.scanParams(125, 0)
    m.paramScan.index = 2000 // MAX_PARAM_INDEX
    m.paramScan.expectTid = 0
    fc.sendCanFrame.resetHistory()
    for (const f of gsFrames(125, intParamPayload('LAST', 1), 0)) { m.onCanFrame(PKT, f) }
    const ps = m.getParamScan()
    assert.equal(ps.done, true)
    assert.equal(ps.scanning, false)
    assert.equal(fc.sendCanFrame.callCount, 0) // did not request past the cap
  })

  it('starting a param scan stops a running node scan (single forwarded bus)', function () {
    const m = new DroneCANMonitor(fc)
    m.scan([0, 1])
    assert.equal(m.scanning, true)
    m.scanParams(125, 0)
    assert.equal(m.scanning, false)
    assert.equal(m.forwardTimer, null)
    assert.equal(m.paramScan.nodeId, 125)
    m.scanParams(123, 1) // a second param scan supersedes the first
    assert.equal(m.paramScan.nodeId, 123)
    m.stopParams()
  })

  it('starting a node scan stops an in-progress param scan', function () {
    const m = new DroneCANMonitor(fc)
    m.scanParams(125, 0)
    assert.notEqual(m.paramForwardTimer, null)
    m.scan([0])
    assert.equal(m.paramForwardTimer, null)
    m.stop()
  })

  it('getParamScan reports an inactive state before any scan', function () {
    const m = new DroneCANMonitor(fc)
    assert.deepEqual(m.getParamScan(), { active: false, nodeId: null, bus: null, scanning: false, done: false, error: null, params: [] })
  })

  it('GetSet responses are ignored with no active scan or for a different node', function () {
    const m = new DroneCANMonitor(fc)
    for (const f of gsFrames(125, intParamPayload('A', 1), 0)) { m.onCanFrame(PKT, f) } // no scan → ignored
    assert.equal(m.getParamScan().active, false)
    m.scanParams(125, 0)
    for (const f of gsFrames(99, intParamPayload('A', 1), 0)) { m.onCanFrame(PKT, f) } // wrong source → ignored
    assert.equal(m.getParamScan().params.length, 0)
    m.stopParams()
  })
})
