const assert = require('assert')
const hud = require('./hudOverlay')

describe('HUD overlay helpers (#173)', function () {
  describe('#mavlinkModeName()', function () {
    it('maps copter modes (quadrotor type)', function () {
      assert.equal(hud.mavlinkModeName(2, 3), 'AUTO')
      assert.equal(hud.mavlinkModeName(4, 6), 'RTL') // helicopter -> copter family
    })

    it('maps plane modes (fixed-wing type)', function () {
      assert.equal(hud.mavlinkModeName(1, 0), 'MANUAL')
      assert.equal(hud.mavlinkModeName(1, 10), 'AUTO')
    })

    it('maps rover modes (ground rover + surface boat)', function () {
      assert.equal(hud.mavlinkModeName(10, 0), 'MANUAL')
      assert.equal(hud.mavlinkModeName(11, 11), 'RTL')
    })

    it('falls back to MODE <n> for an unknown vehicle family', function () {
      assert.equal(hud.mavlinkModeName(99, 0), 'MODE 0')
    })

    it('falls back to MODE <n> for a known family but unknown mode number', function () {
      assert.equal(hud.mavlinkModeName(2, 999), 'MODE 999')
    })
  })

  describe('#gpsFixName()', function () {
    it('names a known fix type', function () {
      assert.equal(hud.gpsFixName(3), '3D')
      assert.equal(hud.gpsFixName(0), 'NO')
    })

    it('returns "?" for an unknown fix type', function () {
      assert.equal(hud.gpsFixName(99), '?')
    })
  })

  describe('#emptyHudData()', function () {
    it('returns an all-null shape', function () {
      assert.deepEqual(hud.emptyHudData(), {
        alt: null, spd: null, hdg: null, batV: null, batPct: null,
        mode: null, gpsFix: null, gpsSats: null, roll: null, pitch: null
      })
    })
  })

  describe('#formatHudText()', function () {
    it('renders placeholders when every field is null', function () {
      const text = hud.formatHudText(hud.emptyHudData())
      assert.equal(text, 'ALT --  SPD --\nHDG --  BAT -- --\nMODE --  GPS --/--')
    })

    it('renders a full readout with rounding and units', function () {
      const text = hud.formatHudText({
        alt: 124.4, spd: 14.23, hdg: 271, batV: 15.84, batPct: 62,
        mode: 'AUTO', gpsFix: 3, gpsSats: 11
      })
      assert.equal(text, 'ALT 124m  SPD 14.2m/s\nHDG 271°  BAT 15.8V 62%\nAUTO  GPS 3D/11')
    })
  })
})
