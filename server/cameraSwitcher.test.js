const assert = require('assert')
const sinon = require('sinon')
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

  it('#saveSettingsSwallowsErrors()', function () {
    settings.clear()
    const sw = new CameraSwitcher(settings)
    // a broken settings store must not crash the switcher
    sw.settings = { setValue: () => { throw new Error('disk full') } }
    const errSpy = sinon.spy(console, 'error')
    try {
      sw.saveSettings()
      assert.ok(errSpy.calledWithMatch('Error saving cameraSwitcher settings:'))
    } finally {
      errSpy.restore()
    }
  })

  it('#getSettingsCopies()', function () {
    settings.clear()
    const sw = new CameraSwitcher(settings)
    const opts = sw.getSettings()
    assert.equal(opts.rcChannel, sw.options.rcChannel)
    // mutating the copy must not touch the live options
    opts.rcChannel = 12
    assert.equal(sw.options.rcChannel, 7)
  })

  it('#setSettingsMoreValidation()', function (done) {
    settings.clear()
    const sw = new CameraSwitcher(settings)

    // hysteresis out of range, both directions
    sw.setSettings({ hysteresis: -1 }, (err) => {
      assert.notEqual(err, null)
      assert.ok(err.message.includes('Hysteresis'))

      sw.setSettings({ hysteresis: 501 }, (err2) => {
        assert.notEqual(err2, null)

        // unknown switch mode
        sw.setSettings({ switchMode: 'sorcery' }, (err3) => {
          assert.notEqual(err3, null)
          assert.ok(err3.message.includes('switch mode'))

          // command mode with only commandB missing
          sw.setSettings({ enabled: true, switchMode: 'command', commandA: 'x', commandB: '' }, (err4) => {
            assert.notEqual(err4, null)
            done()
          })
        })
      })
    })
  })

  it('#setSettingsWhileEnabled()', function (done) {
    settings.clear()
    const sw = new CameraSwitcher(settings)

    sw.setSettings({ enabled: true, switchMode: 'gstreamer', secDevice: '/dev/video1' }, (err) => {
      assert.equal(err, null)
      sw.streamRequested = true

      // changing settings while already enabled keeps the RC stream request
      sw.setSettings({ threshold: 1600 }, (err2) => {
        assert.equal(err2, null)
        assert.equal(sw.options.threshold, 1600)
        assert.equal(sw.streamRequested, true)
        done()
      })
    })
  })

  it('#doSwitchCommandMode()', function (done) {
    this.timeout(5000)
    settings.clear()
    const sw = new CameraSwitcher(settings)
    sw.options.switchMode = 'command'
    sw.options.commandA = 'true'
    sw.options.commandB = ''

    // empty command: nothing run, switch still committed
    assert.equal(sw.doSwitch('B'), true)
    assert.equal(sw.activeSource, 'B')

    // command success (also picks the source-A side of the command choice)
    assert.equal(sw.doSwitch('A'), true)

    // command failure: its stderr is logged
    const errSpy = sinon.spy(console, 'error')
    sw.options.commandB = '>&2 echo boom; exit 1'
    assert.equal(sw.doSwitch('B'), true)
    const deadline = Date.now() + 3000
    const check = () => {
      if (errSpy.getCalls().some(c => String(c.args[0]).includes('Camera switch command failed'))) {
        errSpy.restore()
        return done()
      }
      if (Date.now() > deadline) {
        errSpy.restore()
        return done(new Error('command failure was not logged'))
      }
      setTimeout(check, 25)
    }
    check()
  })

  it('#onMavPacketMissingChannel()', function () {
    settings.clear()
    const sw = new CameraSwitcher(settings)
    sw.options.enabled = true

    // null data (decode failure upstream) is ignored
    sw.onMavPacket({ header: { msgid: 65 } }, null)
    assert.equal(sw.lastRcValue, null)

    // RC channel not present in the message: ignored
    sw.options.rcChannel = 16
    sw.onMavPacket({ header: { msgid: 65 } }, { chan7Raw: 1900 })
    assert.equal(sw.lastRcValue, null)
  })
})
