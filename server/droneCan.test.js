const assert = require('assert')
const sinon = require('sinon')
const DroneCANMonitor = require('./droneCan')
const { parseCanId, parseTail, decodeNodeStatus, decodeNodeInfo, Reassembler } = DroneCANMonitor

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

  it('Reassembler handles single + multi frame and drops bad frames', function () {
    const r = new Reassembler()
    assert.deepEqual(r.accept('k', [1, 2, 3], parseTail(0xC0)), [1, 2, 3]) // single-frame
    // multi-frame: SOT(crc,crc,a) → cont(b) → EOT(c)
    assert.equal(r.accept('m', [0xAA, 0xBB, 1], parseTail(0x80 | 0)), null) // SOT, toggle0
    assert.equal(r.accept('m', [2], parseTail(0x20 | 0)), null) // cont, toggle1
    assert.deepEqual(r.accept('m', [3], parseTail(0x40 | 0)), [1, 2, 3]) // EOT, toggle0 → CRC stripped
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
    const payload = [0xAA, 0xBB, ...nodeInfoPayload('org.ardupilot.gps')] // 2-byte CRC + body
    for (const f of chunkToFrames(svcRespId(25, 127, 1), payload, 3)) {
      m.onCanFrame(PKT, f)
    }
    const n = m.getNodes()[0]
    assert.equal(n.name, 'org.ardupilot.gps')
    assert.equal(n.swVersion, '1.2')
    assert.equal(n.hwVersion, '3.4')
    assert.equal(n.uniqueId.length, 32)
  })

  it('maps an unknown NodeStatus mode to a numeric fallback', function () {
    const m = new DroneCANMonitor(fc)
    m.onCanFrame(PKT, frame(msgId(7, 341), 0, [...nodeStatusBody(0, 5, 0, 1, 0), 0xC0])) // mode 5 (unmapped)
    assert.equal(m.getNodes()[0].mode, 'Mode 5')
  })

  it('a GetNodeInfo response with no prior NodeStatus still creates the node', function () {
    const m = new DroneCANMonitor(fc)
    const payload = [0xAA, 0xBB, ...nodeInfoPayload('org.lone.node')]
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
})
