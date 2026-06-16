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
    it('returns an all-null shape covering every captured field', function () {
      const d = hud.emptyHudData()
      assert.ok(Object.values(d).every(v => v === null))
      for (const k of ['alt', 'altRel', 'spd', 'airspeed', 'climb', 'throttle', 'rangefinder',
        'lat', 'lon', 'hdop', 'gpsCourse', 'homeDist', 'homeDir', 'wpDist', 'wpNum', 'xtrack',
        'altError', 'mah', 'battTemp', 'battTimeRemaining', 'cpuLoad', 'rcRssi', 'radioRssi',
        'radioRemRssi', 'radioNoise', 'dropRate', 'windSpeed', 'windDir', 'baroTemp', 'pressure',
        'turnRate', 'gload', 'timer', 'vibe', 'vibeClip', 'roll', 'pitch', 'hdg', 'mode', 'armed']) {
        assert.ok(k in d, 'missing field ' + k)
      }
    })
  })

  describe('#emptyHudData() modem GPS', function () {
    it('includes the SIM7600 GNSS fields', function () {
      const d = hud.emptyHudData()
      for (const k of ['modemLat', 'modemLon', 'modemAlt', 'modemFix']) {
        assert.ok(k in d, 'missing modem field ' + k)
      }
    })
  })

  describe('OSD layout (#173 editor)', function () {
    it('#hudElements() lists the catalog with sections, labels + samples', function () {
      const els = hud.hudElements()
      assert.ok(Array.isArray(els) && els.length > 40)
      const alt = els.find(e => e.type === 'alt')
      assert.equal(alt.label, 'Altitude (MSL)')
      assert.equal(alt.section, 'Altitude & Speed')
      assert.equal(els.find(e => e.type === 'horizon').section, 'Attitude')
      // sections present
      const sections = new Set(els.map(e => e.section))
      assert.ok(sections.has('Navigation') && sections.has('Link') && sections.has('Environment'))
    })

    it('#hudElements() carries mock values + the graphic flag + a Modem GPS section', function () {
      const els = hud.hudElements()
      // a numeric element shows its formatted mock value; a graphic one is flagged
      assert.equal(els.find(e => e.type === 'alt').mock, 'ALT 124m')
      assert.equal(els.find(e => e.type === 'alt').graphic, false)
      const horizon = els.find(e => e.type === 'horizon')
      assert.equal(horizon.graphic, true)
      assert.equal(horizon.mock, '') // no text for a shape
      assert.equal(els.find(e => e.type === 'homeDir').graphic, true)
      // modem GPS catalog
      const modemFix = els.find(e => e.type === 'modemFix')
      assert.equal(modemFix.section, 'Modem GPS')
      assert.equal(modemFix.mock, 'mGPS OK')
      assert.ok(els.find(e => e.type === 'modemLat').mock.startsWith('mLAT '))
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

    it('#defaultHudLayout() carries the default global text style', function () {
      const g = hud.defaultHudLayout().global
      assert.deepEqual(g, { font: 'monospace', size: 34, color: '#ffffff' })
    })

    it('graphic elements carry a default scale; text elements do not', function () {
      const els = hud.defaultHudLayout().elements
      assert.equal(els.find(e => e.type === 'horizon').scale, 1.8)
      assert.equal(els.find(e => e.type === 'compass').scale, 1.4)
      assert.equal(els.find(e => e.type === 'homeDir').scale, 1.4)
      assert.ok(!('scale' in els.find(e => e.type === 'alt')))
    })

    it('#validateHudLayout() validates + clamps the graphic scale', function () {
      const out = hud.validateHudLayout({ elements: [
        { type: 'horizon', enabled: true, x: 0.5, y: 0.5, scale: 3.25 },
        { type: 'compass', enabled: true, x: 0.5, y: 0.1, scale: 99 },  // clamp → 5
        { type: 'homeDir', enabled: true, x: 0.5, y: 0.9, scale: 0.1 }, // clamp → 0.5
        { type: 'alt', enabled: true, x: 0.8, y: 0.1, scale: 2 }        // text: scale ignored
      ] })
      assert.equal(out.elements.find(e => e.type === 'horizon').scale, 3.25)
      assert.equal(out.elements.find(e => e.type === 'compass').scale, 5)
      assert.equal(out.elements.find(e => e.type === 'homeDir').scale, 0.5)
      assert.ok(!('scale' in out.elements.find(e => e.type === 'alt')))
      // a non-numeric scale falls back to the per-element default
      assert.equal(hud.validateHudLayout({ elements: [{ type: 'horizon', enabled: true, x: 0.5, y: 0.5, scale: 'big' }] }).elements.find(e => e.type === 'horizon').scale, 1.8)
    })

    it('#horizonOptions() lists the AHI styles + aircraft markers', function () {
      const o = hud.horizonOptions()
      assert.deepEqual(o.styles, ['ladder', 'line', 'ticks'])
      assert.ok(o.markers.includes('wings') && o.markers.includes('crosshair') && o.markers.includes('drone'))
    })

    it('#validateHudLayout() validates the horizon style / marker / colours + graphic colour', function () {
      // defaults: ladder + wings
      const def = hud.defaultHudLayout().elements.find(e => e.type === 'horizon')
      assert.equal(def.style, 'ladder')
      assert.equal(def.marker, 'wings')
      // valid choices pass through
      const ok = hud.validateHudLayout({ elements: [{ type: 'horizon', enabled: true, x: 0.5, y: 0.5, style: 'line', marker: 'drone', color: '#0af', markerColor: '#f50' }] }).elements.find(e => e.type === 'horizon')
      assert.deepEqual({ style: ok.style, marker: ok.marker, color: ok.color, markerColor: ok.markerColor }, { style: 'line', marker: 'drone', color: '#0af', markerColor: '#f50' })
      // invalid style/marker → defaults; invalid colours dropped
      const bad = hud.validateHudLayout({ elements: [{ type: 'horizon', enabled: true, x: 0.5, y: 0.5, style: 'spaceship', marker: 'ufo', color: 'red', markerColor: 'green' }] }).elements.find(e => e.type === 'horizon')
      assert.equal(bad.style, 'ladder')
      assert.equal(bad.marker, 'wings')
      assert.ok(!('color' in bad) && !('markerColor' in bad))
      // a colour validates on the compass too (no style/marker for non-horizon graphics)
      const comp = hud.validateHudLayout({ elements: [{ type: 'compass', enabled: true, x: 0.5, y: 0.1, color: '#abc' }] }).elements.find(e => e.type === 'compass')
      assert.equal(comp.color, '#abc')
      assert.ok(!('style' in comp) && !('marker' in comp))
    })

    it('#validateHudLayout() normalises the global text style', function () {
      // valid values pass through
      const ok = hud.validateHudLayout({ global: { font: 'serif', size: 50, color: '#0af' }, elements: [] })
      assert.deepEqual(ok.global, { font: 'serif', size: 50, color: '#0af' })
      // a custom font name (curated/imported) is accepted as-is
      assert.equal(hud.validateHudLayout({ global: { font: 'Chakra Petch' } }).global.font, 'Chakra Petch')
      // unsafe font name + invalid colour fall back to defaults; size is clamped & rounded
      const bad = hud.validateHudLayout({ global: { font: 'Bad/Font!', size: 999, color: 'red' }, elements: [] })
      assert.equal(bad.global.font, 'monospace')
      assert.equal(bad.global.size, 120) // clamped to the 10..120 max
      assert.equal(bad.global.color, '#ffffff')
      // too-small + non-numeric size
      assert.equal(hud.validateHudLayout({ global: { size: 2 } }).global.size, 10) // min
      assert.equal(hud.validateHudLayout({ global: { size: 'big' } }).global.size, 34) // NaN → default
    })

    it('#validateHudLayout() keeps only valid per-element style overrides', function () {
      const out = hud.validateHudLayout({ elements: [
        { type: 'alt', enabled: true, x: 0.8, y: 0.1, icon: true, font: 'sans-serif', size: 44, color: '#ff0000' },
        { type: 'spd', enabled: true, x: 0.1, y: 0.1, icon: false, font: 'Bad/Font!', size: null, color: 'bad' },
        { type: 'hdg', enabled: true, x: 0.4, y: 0.1, icon: false, size: '300' } // string number, clamped
      ] })
      const alt = out.elements.find(e => e.type === 'alt')
      assert.deepEqual({ font: alt.font, size: alt.size, color: alt.color }, { font: 'sans-serif', size: 44, color: '#ff0000' })
      // spd's overrides are all invalid → none stored (inherits global)
      const spd = out.elements.find(e => e.type === 'spd')
      assert.ok(!('font' in spd) && !('size' in spd) && !('color' in spd))
      // hdg's string size is clamped to the max and no other override is added
      const hdg = out.elements.find(e => e.type === 'hdg')
      assert.equal(hdg.size, 120)
      assert.ok(!('font' in hdg) && !('color' in hdg))
    })

    it('#homeDistance() / #homeBearing() compute distance + bearing to home', function () {
      // ~1.11 km north of home (0.01° latitude)
      assert.ok(Math.abs(hud.homeDistance(37.0, -122.0, 37.01, -122.0) - 1112) < 5)
      // home is due north → bearing ~0
      assert.equal(hud.homeBearing(37.0, -122.0, 37.01, -122.0), 0)
      // home due east → bearing ~90
      assert.ok(Math.abs(hud.homeBearing(37.0, -122.0, 37.0, -121.99) - 90) <= 1)
      // same point → distance 0
      assert.equal(hud.homeDistance(37.0, -122.0, 37.0, -122.0), 0)
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
