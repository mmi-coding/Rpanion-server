const assert = require('assert')
const settings = require('settings-store')
const CameraSwitcher = require('./cameraSwitcher')

describe('Camera Switcher Functions', function () {
  it('#switcherinit()', function () {
    settings.clear()
    const sw = new CameraSwitcher(settings)

    assert.equal(sw.options.enabled, false)
    assert.equal(sw.options.rcChannel, 7)
    assert.equal(sw.options.threshold, 1500)
    assert.equal(sw.activeSource, 'A')
    assert.equal(sw.getStatus().rcLive, false)
  })

  it('#desiredSourceForValue()', function () {
    settings.clear()
    const sw = new CameraSwitcher(settings)
    // threshold 1500, hysteresis 50

    assert.equal(sw.desiredSourceForValue(1000), 'A')
    assert.equal(sw.desiredSourceForValue(1450), 'A')
    assert.equal(sw.desiredSourceForValue(1480), null) // dead-band
    assert.equal(sw.desiredSourceForValue(1500), null) // dead-band
    assert.equal(sw.desiredSourceForValue(1520), null) // dead-band
    assert.equal(sw.desiredSourceForValue(1550), 'B')
    assert.equal(sw.desiredSourceForValue(2000), 'B')
    // invalid / channel-not-present values
    assert.equal(sw.desiredSourceForValue(0), null)
    assert.equal(sw.desiredSourceForValue(65535), null)
    assert.equal(sw.desiredSourceForValue(null), null)
  })

  it('#processRcValueDebounce()', function () {
    settings.clear()
    const sw = new CameraSwitcher(settings)
    // minHoldMs default 250

    // single high sample: no switch yet (debounce)
    assert.equal(sw.processRcValue(1900, 1000), null)
    assert.equal(sw.activeSource, 'A')

    // still high but before minHoldMs: no switch
    assert.equal(sw.processRcValue(1900, 1100), null)
    assert.equal(sw.activeSource, 'A')

    // high beyond minHoldMs: switch committed
    assert.equal(sw.processRcValue(1900, 1300), 'B')
    assert.equal(sw.activeSource, 'B')

    // glitch low then back high: no switch back
    assert.equal(sw.processRcValue(1100, 1400), null)
    assert.equal(sw.processRcValue(1900, 1500), null)
    assert.equal(sw.activeSource, 'B')

    // sustained low: switch back to A
    assert.equal(sw.processRcValue(1100, 1600), null)
    assert.equal(sw.processRcValue(1100, 1900), 'A')
    assert.equal(sw.activeSource, 'A')
  })

  it('#processRcValueDeadband()', function () {
    settings.clear()
    const sw = new CameraSwitcher(settings)

    // values in the dead-band never cause a switch
    assert.equal(sw.processRcValue(1500, 1000), null)
    assert.equal(sw.processRcValue(1500, 2000), null)
    assert.equal(sw.activeSource, 'A')

    // a pending switch is cancelled by a dead-band value
    assert.equal(sw.processRcValue(1900, 3000), null)
    assert.equal(sw.processRcValue(1500, 3100), null)
    assert.equal(sw.processRcValue(1900, 3300), null) // debounce restarted
    assert.equal(sw.activeSource, 'A')
  })

  it('#onMavPacket()', function () {
    settings.clear()
    const sw = new CameraSwitcher(settings)
    sw.options.enabled = true
    sw.options.minHoldMs = 0

    const rcPacket = { header: { msgid: 65 } }
    const rcData = { chan7Raw: 1900, chan8Raw: 1100 }

    // disabled switcher ignores packets
    sw.options.enabled = false
    sw.onMavPacket(rcPacket, rcData)
    assert.equal(sw.lastRcValue, null)

    // enabled switcher reads the configured channel
    sw.options.enabled = true
    sw.onMavPacket(rcPacket, rcData)
    assert.equal(sw.lastRcValue, 1900)
    assert.equal(sw.getStatus().rcLive, true)

    // non-RC packets are ignored
    sw.onMavPacket({ header: { msgid: 0 } }, { type: 2 })
    assert.equal(sw.lastRcValue, 1900)

    // channel selection is respected
    sw.options.rcChannel = 8
    sw.onMavPacket(rcPacket, rcData)
    assert.equal(sw.lastRcValue, 1100)
  })

  it('#doSwitchEmitsEvent()', function (done) {
    settings.clear()
    const sw = new CameraSwitcher(settings)

    sw.eventEmitter.on('switch', (source, mode) => {
      assert.equal(source, 'B')
      assert.equal(mode, 'gstreamer')
      assert.equal(sw.activeSource, 'B')
      done()
    })
    assert.equal(sw.doSwitch('B'), true)
  })

  it('#doSwitchRejectsBadSource()', function () {
    settings.clear()
    const sw = new CameraSwitcher(settings)
    assert.equal(sw.doSwitch('C'), false)
    assert.equal(sw.doSwitch(''), false)
    assert.equal(sw.activeSource, 'A')
  })

  it('#setSettingsValidation()', function (done) {
    settings.clear()
    const sw = new CameraSwitcher(settings)

    // bad channel
    sw.setSettings({ rcChannel: 0 }, (err) => {
      assert.notEqual(err, null)

      // bad threshold
      sw.setSettings({ threshold: 100 }, (err) => {
        assert.notEqual(err, null)

        // gstreamer mode without secondary device
        sw.setSettings({ enabled: true, switchMode: 'gstreamer', secDevice: '' }, (err) => {
          assert.notEqual(err, null)

          // command mode without commands
          sw.setSettings({ enabled: true, switchMode: 'command', commandA: '', commandB: 'x' }, (err) => {
            assert.notEqual(err, null)

            // valid config persists
            sw.setSettings({ enabled: true, switchMode: 'gstreamer', secDevice: '/dev/video1', rcChannel: 6 }, (err) => {
              assert.equal(err, null)
              assert.equal(sw.options.rcChannel, 6)
              assert.equal(sw.options.secDevice, '/dev/video1')

              // settings survive a reload
              const sw2 = new CameraSwitcher(settings)
              assert.equal(sw2.options.enabled, true)
              assert.equal(sw2.options.rcChannel, 6)
              assert.equal(sw2.options.secDevice, '/dev/video1')
              done()
            })
          })
        })
      })
    })
  })

  it('#resetLink()', function () {
    settings.clear()
    const sw = new CameraSwitcher(settings)
    sw.streamRequested = true
    sw.resetLink()
    assert.equal(sw.streamRequested, false)
  })
})
