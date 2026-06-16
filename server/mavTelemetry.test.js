const assert = require('assert')
const sinon = require('sinon')
const MavTelemetry = require('./mavTelemetry')

describe('MavTelemetry', function () {
  let clock

  beforeEach(function () { clock = sinon.useFakeTimers(1000000) })

  afterEach(function () { clock.restore(); sinon.restore() })

  it('ignores null / undefined / header-less packets', function () {
    const t = new MavTelemetry()
    t.onMessage(null, {})
    t.onMessage(undefined, {})
    t.onMessage({}, {}) // no header
    assert.deepEqual(t.getSnapshot(), [])
  })

  it('records a known message with canonical name + scalar fields', function () {
    const t = new MavTelemetry()
    t.onMessage({ header: { msgid: 30, sysid: 1, compid: 1 } },
      { roll: 0.5, label: 'x', flag: true, none: null, undef: undefined })
    const snap = t.getSnapshot()
    assert.equal(snap.length, 1)
    assert.equal(snap[0].name, 'ATTITUDE')
    assert.equal(snap[0].msgid, 30)
    assert.equal(snap[0].sysid, 1)
    assert.equal(snap[0].compid, 1)
    assert.equal(snap[0].count, 1)
    assert.equal(snap[0].rate, 0) // single packet → no interval yet
    assert.equal(snap[0].stale, false)
    assert.equal(snap[0].fields.roll, 0.5)
    assert.equal(snap[0].fields.label, 'x')
    assert.equal(snap[0].fields.flag, true)
    assert.equal(snap[0].fields.none, null)
    assert.equal(snap[0].fields.undef, null)
  })

  it('stringifies array and object fields', function () {
    const t = new MavTelemetry()
    t.onMessage({ header: { msgid: 65, sysid: 1, compid: 1 } },
      { chans: [1, 2, 3], obj: { a: 1 } })
    const m = t.getSnapshot()[0]
    assert.equal(m.fields.chans, '1, 2, 3')
    assert.equal(m.fields.obj, '[object Object]')
  })

  it('labels unknown message ids and tolerates null data', function () {
    const t = new MavTelemetry()
    t.onMessage({ header: { msgid: 99999, sysid: 1, compid: 1 } }, null)
    const m = t.getSnapshot()[0]
    assert.equal(m.name, 'UNKNOWN_99999')
    assert.deepEqual(m.fields, {})
  })

  it('computes a smoothed rate over repeats and sorts by name', function () {
    const t = new MavTelemetry()
    t.onMessage({ header: { msgid: 30, sysid: 1, compid: 1 } }, { roll: 0 }) // 1st: interval 0
    clock.tick(100)
    t.onMessage({ header: { msgid: 30, sysid: 1, compid: 1 } }, { roll: 0 }) // 2nd: seed delta
    clock.tick(100)
    t.onMessage({ header: { msgid: 30, sysid: 1, compid: 1 } }, { roll: 0 }) // 3rd: smoothing
    t.onMessage({ header: { msgid: 0, sysid: 1, compid: 1 } }, { baseMode: 0 })
    const snap = t.getSnapshot()
    assert.equal(snap[0].name, 'ATTITUDE') // sorted before HEARTBEAT
    assert.equal(snap[1].name, 'HEARTBEAT')
    assert.equal(snap[0].count, 3)
    assert.ok(snap[0].rate > 0) // ~10 Hz
    assert.equal(snap[1].rate, 0) // single HEARTBEAT
  })

  it('flags stale messages and clears', function () {
    const t = new MavTelemetry()
    t.onMessage({ header: { msgid: 30, sysid: 1, compid: 1 } }, { roll: 0 })
    clock.tick(6000)
    assert.equal(t.getSnapshot()[0].stale, true)
    t.clear()
    assert.deepEqual(t.getSnapshot(), [])
  })
})
