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
        alt: null, altRel: null, spd: null, airspeed: null, hdg: null, climb: null,
        throttle: null, batV: null, batPct: null, current: null, mode: null, armed: null,
        gpsFix: null, gpsSats: null, roll: null, pitch: null
      })
    })
  })

  describe('OSD layout (#173 editor)', function () {
    it('#hudElements() lists the catalog with labels + samples', function () {
      const els = hud.hudElements()
      assert.ok(Array.isArray(els) && els.length > 10)
      const alt = els.find(e => e.type === 'alt')
      assert.equal(alt.label, 'Altitude (MSL)')
      assert.ok(els.find(e => e.type === 'horizon'))
    })

    it('#defaultHudLayout() has one entry per catalog element', function () {
      const layout = hud.defaultHudLayout()
      assert.equal(layout.elements.length, hud.hudElements().length)
      const horizon = layout.elements.find(e => e.type === 'horizon')
      assert.equal(horizon.enabled, true)
      assert.ok(layout.elements.every(e => e.x >= 0 && e.x <= 1 && e.y >= 0 && e.y <= 1))
    })

    it('#validateHudLayout(null) returns the default layout', function () {
      assert.deepEqual(hud.validateHudLayout(null), hud.defaultHudLayout())
      assert.deepEqual(hud.validateHudLayout({}), hud.defaultHudLayout())
    })

    it('#validateHudLayout() coerces flags, clamps positions, drops unknown types and fills missing ones', function () {
      const out = hud.validateHudLayout({ elements: [
        { type: 'alt', enabled: 1, icon: 0, x: 1.7, y: -0.3 },   // clamp x→1, y→0; coerce flags
        { type: 'bogus', enabled: true, x: 0.5, y: 0.5 },         // unknown → dropped
        { type: 'spd', enabled: false, icon: true, x: 'nope', y: 0.4 } // non-finite x → 0
      ] })
      assert.equal(out.elements.length, hud.hudElements().length) // full set
      const alt = out.elements.find(e => e.type === 'alt')
      assert.equal(alt.enabled, true)
      assert.equal(alt.icon, false)
      assert.equal(alt.x, 1)
      assert.equal(alt.y, 0)
      const spd = out.elements.find(e => e.type === 'spd')
      assert.equal(spd.x, 0) // 'nope' → 0
      assert.ok(!out.elements.find(e => e.type === 'bogus'))
      // a not-supplied element falls back to its default
      const gps = out.elements.find(e => e.type === 'gps')
      assert.equal(gps.enabled, true)
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
