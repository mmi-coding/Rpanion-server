const assert = require('assert')
const sinon = require('sinon')
const settings = require('settings-store')
const CellularTuning = require('./cellularTuning')

// build a tuner with controllable fake dependencies
function makeTuner (overrides = {}) {
  const state = {
    streaming: true,
    signal: { dbm: -71, rsrp: -85 },
    configuredBitrate: 2000,
    ackBitrate: null,
    setCalls: [],
    setResult: true,
    ...overrides
  }
  const tuner = new CellularTuning(settings, {
    getSignal: () => state.signal,
    isStreaming: () => state.streaming,
    getConfiguredBitrate: () => state.configuredBitrate,
    setBitrate: (kbps) => {
      state.setCalls.push(kbps)
      return state.setResult
    },
    getAckBitrate: () => state.ackBitrate
  })
  return { tuner, state }
}

describe('Cellular Tuning Functions', function () {
  it('#cellulartuninginit()', function () {
    settings.clear()
    const { tuner } = makeTuner()

    assert.equal(tuner.options.lowLatency, false)
    assert.equal(tuner.options.adaptiveBitrate, false)
    assert.equal(tuner.options.minBitrate, 250)
    // adaptive bitrate off: no poll loop
    assert.equal(tuner.pollTimer, null)

    const status = tuner.getStatus()
    assert.equal(status.tier, null)
    assert.equal(status.targetBitrate, null)
    assert.equal(status.configuredBitrate, 2000)
    assert.equal(status.streaming, true)
  })

  it('#tierForSignal()', function () {
    // RSRP is preferred when present
    assert.equal(CellularTuning.tierForSignal({ rsrp: -80, dbm: -110 }), 'good')
    assert.equal(CellularTuning.tierForSignal({ rsrp: -95 }), 'good')
    assert.equal(CellularTuning.tierForSignal({ rsrp: -96 }), 'fair')
    assert.equal(CellularTuning.tierForSignal({ rsrp: -105 }), 'fair')
    assert.equal(CellularTuning.tierForSignal({ rsrp: -106 }), 'poor')

    // RSSI fallback (no RSRP - e.g. non-LTE registration)
    assert.equal(CellularTuning.tierForSignal({ dbm: -85 }), 'good')
    assert.equal(CellularTuning.tierForSignal({ dbm: -86 }), 'fair')
    assert.equal(CellularTuning.tierForSignal({ dbm: -97 }), 'fair')
    assert.equal(CellularTuning.tierForSignal({ dbm: -98 }), 'poor')

    // unknown signal: hold
    assert.equal(CellularTuning.tierForSignal(null), null)
    assert.equal(CellularTuning.tierForSignal({}), null)
    assert.equal(CellularTuning.tierForSignal({ dbm: null }), null)
  })

  it('#evaluateHysteresis()', function () {
    settings.clear()
    settings.setValue('cellularTuning.adaptiveBitrate', true)
    const { tuner, state } = makeTuner()
    tuner.stopLoop() // drive evaluate() manually

    state.signal = { rsrp: -110 } // poor

    // first poor evaluation: no change yet (hysteresis)
    tuner.evaluate()
    assert.equal(state.setCalls.length, 0)

    // second consecutive poor evaluation: bitrate drops to 35%
    tuner.evaluate()
    assert.deepEqual(state.setCalls, [700])
    assert.equal(tuner.appliedTier, 'poor')
    assert.equal(tuner.targetBitrate, 700)

    // staying poor: no repeat commands
    tuner.evaluate()
    tuner.evaluate()
    assert.equal(state.setCalls.length, 1)

    // a single good blip does not restore (hysteresis again)
    state.signal = { rsrp: -80 }
    tuner.evaluate()
    assert.equal(state.setCalls.length, 1)

    // signal flapping resets the consecutive count
    state.signal = { rsrp: -110 }
    tuner.evaluate()
    state.signal = { rsrp: -80 }
    tuner.evaluate()
    assert.equal(state.setCalls.length, 1)

    // two consecutive good evaluations: full bitrate restored
    tuner.evaluate()
    assert.deepEqual(state.setCalls, [700, 2000])
    assert.equal(tuner.appliedTier, 'good')
  })

  it('#evaluateMinBitrateFloor()', function () {
    settings.clear()
    settings.setValue('cellularTuning.adaptiveBitrate', true)
    settings.setValue('cellularTuning.minBitrate', 400)
    const { tuner, state } = makeTuner({ configuredBitrate: 800 })
    tuner.stopLoop()

    // poor tier: 800 * 0.35 = 280, floored to minBitrate 400
    state.signal = { rsrp: -110 }
    tuner.evaluate()
    tuner.evaluate()
    assert.deepEqual(state.setCalls, [400])

    // the floor never raises the bitrate above the configured value
    state.configuredBitrate = 300
    tuner.resetState()
    tuner.evaluate()
    tuner.evaluate()
    assert.deepEqual(state.setCalls, [400, 300])
  })

  it('#evaluateHoldsAndResets()', function () {
    settings.clear()
    settings.setValue('cellularTuning.adaptiveBitrate', true)
    const { tuner, state } = makeTuner()
    tuner.stopLoop()

    // unknown signal (modem off/unavailable): hold, no commands
    state.signal = null
    tuner.evaluate()
    tuner.evaluate()
    assert.equal(state.setCalls.length, 0)

    // degrade on a poor signal
    state.signal = { rsrp: -110 }
    tuner.evaluate()
    tuner.evaluate()
    assert.deepEqual(state.setCalls, [700])

    // stream stops: adaptation state resets (a restarted stream comes
    // back at the configured bitrate)
    state.streaming = false
    tuner.evaluate()
    assert.equal(tuner.appliedTier, null)
    assert.equal(tuner.targetBitrate, null)

    // back to streaming on the same poor signal: needs 2 polls again
    state.streaming = true
    tuner.evaluate()
    assert.equal(state.setCalls.length, 1)
    tuner.evaluate()
    assert.deepEqual(state.setCalls, [700, 700])
  })

  it('#setSettingsValidation()', function (done) {
    settings.clear()
    const { tuner } = makeTuner()

    tuner.setSettings({ minBitrate: 10 }, (err) => {
      assert.notEqual(err, null)
      assert.ok(err.message.includes('bitrate'))

      tuner.setSettings({ minBitrate: 20000 }, (err2) => {
        assert.notEqual(err2, null)

        tuner.setSettings({ lowLatency: true, adaptiveBitrate: true, minBitrate: 300 }, (err3) => {
          assert.equal(err3, null)
          assert.equal(tuner.options.lowLatency, true)
          assert.equal(tuner.options.minBitrate, 300)
          assert.equal(settings.value('cellularTuning.lowLatency', false), true)
          // adaptive bitrate enabled: poll loop running
          assert.notEqual(tuner.pollTimer, null)

          tuner.setSettings({ adaptiveBitrate: false }, (err4) => {
            assert.equal(err4, null)
            assert.equal(tuner.pollTimer, null)
            done()
          })
        })
      })
    })
  })

  it('#disableRestoresBitrate()', function (done) {
    settings.clear()
    settings.setValue('cellularTuning.adaptiveBitrate', true)
    const { tuner, state } = makeTuner()
    tuner.stopLoop()
    tuner.options.adaptiveBitrate = true

    // degrade first
    state.signal = { rsrp: -110 }
    tuner.evaluate()
    tuner.evaluate()
    assert.deepEqual(state.setCalls, [700])

    // turning adaptation off restores the configured bitrate
    tuner.setSettings({ adaptiveBitrate: false }, (err) => {
      assert.equal(err, null)
      assert.deepEqual(state.setCalls, [700, 2000])
      assert.equal(tuner.appliedTier, null)
      done()
    })
  })

  it('#quitting()', function () {
    settings.clear()
    settings.setValue('cellularTuning.adaptiveBitrate', true)
    const { tuner } = makeTuner()
    assert.notEqual(tuner.pollTimer, null)
    tuner.quitting()
    assert.equal(tuner.pollTimer, null)
  })

  it('#evaluateNoConfiguredBitrate()', function () {
    // video server not configured yet - nothing to scale
    settings.clear()
    settings.setValue('cellularTuning.adaptiveBitrate', true)
    const { tuner, state } = makeTuner({ configuredBitrate: 0 })
    tuner.stopLoop()

    state.signal = { rsrp: -110 }
    tuner.evaluate()
    tuner.evaluate()
    assert.equal(state.setCalls.length, 0)
    assert.equal(tuner.appliedTier, null)
  })

  it('#evaluateSetBitrateRejected()', function () {
    // the video manager refusing the change must not mark the tier applied
    settings.clear()
    settings.setValue('cellularTuning.adaptiveBitrate', true)
    const { tuner, state } = makeTuner({ setResult: false })
    tuner.stopLoop()

    state.signal = { rsrp: -110 }
    tuner.evaluate()
    tuner.evaluate()
    assert.deepEqual(state.setCalls, [700])
    assert.equal(tuner.appliedTier, null)
    assert.equal(tuner.targetBitrate, null)
  })

  it('#pollLoopTimerFires()', function () {
    settings.clear()
    const { tuner } = makeTuner()
    const clock = sinon.useFakeTimers()
    try {
      let evaluations = 0
      tuner.evaluate = () => { evaluations += 1 }
      tuner.startLoop()
      clock.tick(5000)
      assert.equal(evaluations, 1)
      clock.tick(5000)
      assert.equal(evaluations, 2)
      tuner.stopLoop()
      clock.tick(10000)
      assert.equal(evaluations, 2)
    } finally {
      clock.restore()
    }
  })

  it('#getSettingsCopies()', function () {
    settings.clear()
    const { tuner } = makeTuner()
    const opts = tuner.getSettings()
    assert.equal(opts.minBitrate, tuner.options.minBitrate)
    opts.minBitrate = 9999
    assert.notEqual(tuner.options.minBitrate, 9999)
  })

  it('#setSettingsNoLoopTransition()', function (done) {
    // changing an unrelated option with adaptation off touches no loop
    settings.clear()
    const { tuner, state } = makeTuner()

    tuner.setSettings({ lowLatency: true }, (err) => {
      assert.equal(err, null)
      assert.equal(tuner.pollTimer, null)
      assert.equal(state.setCalls.length, 0)
      done()
    })
  })
})
