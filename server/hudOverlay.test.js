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

    it('#validateHudLayout() keeps valid per-icon colour + size overrides (clamped)', function () {
      const out = hud.validateHudLayout({ elements: [
        { type: 'alt', enabled: true, x: 0.8, y: 0.1, icon: true, iconColor: '#0af', iconScale: 2 },
        { type: 'spd', enabled: true, x: 0.1, y: 0.1, icon: true, iconColor: 'red', iconScale: 99 }, // bad colour, over-range scale
        { type: 'batV', enabled: true, x: 0.7, y: 0.9, icon: true, iconScale: 'big' } // NaN scale → dropped
      ] })
      const alt = out.elements.find(e => e.type === 'alt')
      assert.deepEqual({ iconColor: alt.iconColor, iconScale: alt.iconScale }, { iconColor: '#0af', iconScale: 2 })
      const spd = out.elements.find(e => e.type === 'spd')
      assert.ok(!('iconColor' in spd)) // invalid colour dropped
      assert.equal(spd.iconScale, 3) // clamped to the 3x max
      const batV = out.elements.find(e => e.type === 'batV')
      assert.ok(!('iconScale' in batV)) // non-numeric scale dropped (no override)
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

  // ── live "show real values" preview (HUD editor) ──────────────────────────
  describe('#formatHudElement()', function () {
    it('renders every text element from a full field dict (parity with video-server.py)', function () {
      const fullHud = {
        alt: 124.4, altRel: 38.2, spd: 14.23, airspeed: 15.12, climb: 0.53, throttle: 45.6, rangefinder: 2.44,
        hdg: 271.4, turnRate: 5.2, gload: 1.23,
        gpsFix: 3, gpsSats: 11, lat: 37.422001, lon: -122.084001, hdop: 0.84, gpsCourse: 270.4,
        homeDist: 420.6, wpDist: 120.6, wpNum: 3, xtrack: 1.23, altError: 0.53,
        batV: 15.84, batPct: 62, current: 8.44, mah: 1240.6, battTemp: 32.4, battTimeRemaining: 750, cpuLoad: 38.2, dropRate: 0.4,
        rcRssi: 95.4, radioRssi: 180.4, radioRemRssi: 175.4, radioNoise: 40.4,
        windSpeed: 4.23, windDir: 210.4, baroTemp: 24.4, pressure: 1013.4,
        mode: 'AUTO', armed: true, timer: 222, clock: '14:05:32',
        vibe: 12.4, vibeClip: 0,
        modemFix: 'OK', modemLat: 37.422, modemLon: -122.084, modemAlt: 42.4
      }
      const expected = {
        alt: 'ALT 124m', altRel: 'AGL 38m', spd: 'SPD 14.2', airspeed: 'AIR 15.1', climb: 'VS 0.5',
        throttle: 'THR 46%', rangefinder: 'RNG 2.4m', hdg: 'HDG 271', turnRate: 'TRN 5°/s', gload: '1.2G',
        gps: 'GPS 3D/11', lat: 'LAT 37.42200', lon: 'LON -122.08400', hdop: 'HDOP 0.8', gpsCourse: 'CRS 270°',
        homeDist: 'HOME 421m', wpDist: 'WP 121m', wpNum: 'WP#3', xtrack: 'XTK 1.2m', altError: 'AERR 0.5m',
        batV: 'BAT 15.8V', batPct: '62%', current: '8.4A', mah: '1241mAh', battTemp: 'BT 32°C',
        battTimeRemaining: 'BTL 12:30', cpuLoad: 'CPU 38%', dropRate: 'DROP 0%',
        rcRssi: 'RC 95%', radioRssi: 'RSSI 180', radioRemRssi: 'RRSSI 175', radioNoise: 'NOISE 40',
        windSpeed: 'WND 4.2m/s', windDir: 'WDIR 210°', baroTemp: 'TMP 24°C', pressure: 'PRS 1013hPa',
        mode: 'AUTO', armed: 'ARMED', timer: '3:42', clock: '14:05:32', vibe: 'VIB 12', vibeClip: 'CLIP 0',
        modemFix: 'mGPS OK', modemLat: 'mLAT 37.42200', modemLon: 'mLON -122.08400', modemAlt: 'mALT 42m'
      }
      for (const type of Object.keys(expected)) {
        assert.equal(hud.formatHudElement(type, fullHud), expected[type], 'mismatch for ' + type)
      }
    })

    it('renders "--" placeholders for every null field (FC connected but quiet / disconnected)', function () {
      const e = hud.emptyHudData()
      const expected = {
        alt: 'ALT --', spd: 'SPD --', throttle: 'THR --', hdg: 'HDG --', turnRate: 'TRN --', gload: '--',
        gps: 'GPS --/--', wpNum: 'WP#--', batV: 'BAT --', batPct: '--%', current: '--', mah: '--',
        battTimeRemaining: 'BTL --:--', mode: 'MODE --', armed: 'DISARM', timer: '--:--', clock: '--:--:--',
        modemFix: 'mGPS --', modemAlt: 'mALT --'
      }
      for (const type of Object.keys(expected)) {
        assert.equal(hud.formatHudElement(type, e), expected[type], 'mismatch for ' + type)
      }
    })

    it('returns "" for graphic elements and unknown types', function () {
      assert.equal(hud.formatHudElement('horizon', {}), '')
      assert.equal(hud.formatHudElement('compass', {}), '')
      assert.equal(hud.formatHudElement('homeDir', {}), '')
      assert.equal(hud.formatHudElement('nonsense', {}), '')
    })
  })

  describe('#hudDataFromSnapshot()', function () {
    const fullSnap = [
      { name: 'VFR_HUD', stale: false, fields: { alt: 124, groundspeed: 14.2, airspeed: 15.1, heading: 271, climb: 0.5, throttle: 45 } },
      { name: 'GLOBAL_POSITION_INT', stale: false, fields: { relativeAlt: 38000, lat: 374220000, lon: -1220840000 } },
      { name: 'HOME_POSITION', stale: false, fields: { latitude: 374200000, longitude: -1220800000 } },
      { name: 'SYS_STATUS', stale: false, fields: { voltageBattery: 15800, batteryRemaining: 62, currentBattery: 840, load: 380, dropRateComm: 0 } },
      { name: 'BATTERY_STATUS', stale: false, fields: { currentConsumed: 1240, temperature: 3200, timeRemaining: 750 } },
      { name: 'GPS_RAW_INT', stale: false, fields: { fixType: 3, satellitesVisible: 11, eph: 80, cog: 27000 } },
      { name: 'NAV_CONTROLLER_OUTPUT', stale: false, fields: { wpDist: 120, xtrackError: 1.2, altError: 0.5 } },
      { name: 'MISSION_CURRENT', stale: false, fields: { seq: 3 } },
      { name: 'RC_CHANNELS', stale: false, fields: { rssi: 242 } },
      { name: 'RADIO_STATUS', stale: false, fields: { rssi: 180, remrssi: 175, noise: 40 } },
      { name: 'WIND', stale: false, fields: { speed: 4.2, direction: 210 } },
      { name: 'SCALED_PRESSURE', stale: false, fields: { temperature: 2400, pressAbs: 1013 } },
      { name: 'RANGEFINDER', stale: false, fields: { distance: 2.4 } },
      { name: 'VIBRATION', stale: false, fields: { vibrationX: 10, vibrationY: 12, vibrationZ: 8, clipping0: 0 } },
      { name: 'SCALED_IMU', stale: false, fields: { xacc: 0, yacc: 0, zacc: 1000 } },
      { name: 'HEARTBEAT', stale: false, fields: { type: 2, customMode: 3, baseMode: 128 } },
      { name: 'ATTITUDE', stale: false, fields: { roll: 0, pitch: 0, yawspeed: 0.1 } }
    ]

    it('applies the same unit conversions as updateHudFromPacket()', function () {
      const h = hud.hudDataFromSnapshot(fullSnap)
      assert.equal(h.alt, 124)
      assert.equal(h.spd, 14.2)
      assert.equal(h.hdg, 271)
      assert.equal(h.altRel, 38) // mm → m
      assert.ok(Math.abs(h.lat - 37.422) < 1e-6)
      assert.ok(Math.abs(h.lon + 122.084) < 1e-6)
      assert.equal(h.batV, 15.8) // mV → V
      assert.equal(h.batPct, 62)
      assert.equal(h.current, 8.4) // cA → A
      assert.equal(h.cpuLoad, 38) // 0.1% → %
      assert.equal(h.mah, 1240)
      assert.equal(h.battTemp, 32) // cdegC → °C
      assert.equal(h.battTimeRemaining, 750)
      assert.equal(h.gpsFix, 3)
      assert.equal(h.gpsSats, 11)
      assert.equal(h.hdop, 0.8) // eph/100
      assert.equal(h.gpsCourse, 270) // cdeg → deg
      assert.equal(h.wpDist, 120)
      assert.equal(h.wpNum, 3)
      assert.equal(h.rcRssi, 95) // 242/254*100, rounded
      assert.equal(h.radioRssi, 180)
      assert.equal(h.windSpeed, 4.2)
      assert.equal(h.baroTemp, 24)
      assert.equal(h.rangefinder, 2.4)
      assert.equal(h.vibe, 12) // max(x,y,z)
      assert.equal(h.gload, 1) // 1 g straight down
      assert.equal(h.mode, 'AUTO')
      assert.equal(h.armed, true)
      assert.equal(h.roll, 0)
      assert.ok(Math.abs(h.turnRate - 5.7296) < 1e-3) // 0.1 rad/s → deg/s
      assert.ok(h.homeDist > 0) // GLOBAL_POSITION_INT + HOME_POSITION → distance computed
      assert.ok(h.homeDir >= 0 && h.homeDir <= 360)
    })

    it('maps sentinel "unknown" values to null, and skips home distance without HOME_POSITION', function () {
      const snap = [
        { name: 'GLOBAL_POSITION_INT', stale: false, fields: { relativeAlt: 0, lat: 0, lon: 0 } }, // no HOME_POSITION
        { name: 'SYS_STATUS', stale: false, fields: { voltageBattery: 65535, batteryRemaining: -1, currentBattery: -1, load: 0, dropRateComm: 0 } },
        { name: 'BATTERY_STATUS', stale: false, fields: { currentConsumed: -1, temperature: 32767, timeRemaining: 0 } },
        { name: 'GPS_RAW_INT', stale: false, fields: { fixType: 0, satellitesVisible: 0, eph: 65535, cog: 65535 } },
        { name: 'RC_CHANNELS', stale: false, fields: { rssi: 255 } }
      ]
      const h = hud.hudDataFromSnapshot(snap)
      assert.equal(h.batV, null)
      assert.equal(h.batPct, null)
      assert.equal(h.current, null)
      assert.equal(h.mah, null)
      assert.equal(h.battTemp, null)
      assert.equal(h.battTimeRemaining, null)
      assert.equal(h.hdop, null)
      assert.equal(h.gpsCourse, null)
      assert.equal(h.rcRssi, null)
      assert.equal(h.homeDist, null) // position present but no home → not computed
    })

    it('ignores stale and malformed snapshot entries, and tolerates a non-array', function () {
      const h = hud.hudDataFromSnapshot([
        null,
        { name: 5, fields: {} },
        { name: 'SYSTEM_TIME', stale: false }, // valid + fresh but no fields → defaults to {}
        { name: 'VFR_HUD', stale: true, fields: { alt: 999 } } // stale → ignored
      ])
      assert.equal(h.alt, null)
      assert.deepEqual(hud.hudDataFromSnapshot(null), hud.emptyHudData())
    })
  })

  describe('#liveHudValues()', function () {
    it('reports connected + per-text-element values when an FC is transmitting', function () {
      const snap = [{ name: 'VFR_HUD', stale: false, fields: { alt: 124, groundspeed: 14.2, heading: 271 } }]
      const out = hud.liveHudValues(snap, '09:08:07')
      assert.equal(out.connected, true)
      assert.equal(out.values.alt, 'ALT 124m')
      assert.equal(out.values.hdg, 'HDG 271')
      assert.equal(out.values.clock, '09:08:07') // caller-supplied wall clock
      assert.strictEqual(out.values.horizon, undefined) // graphic elements have no text value
    })

    it('reports disconnected with "--" placeholders for an empty / all-stale / non-array snapshot', function () {
      const empty = hud.liveHudValues([])
      assert.equal(empty.connected, false)
      assert.equal(empty.values.alt, 'ALT --')
      assert.equal(empty.values.clock, '--:--:--') // no clock supplied
      assert.equal(hud.liveHudValues([{ name: 'VFR_HUD', stale: true, fields: {} }]).connected, false)
      assert.equal(hud.liveHudValues(null).connected, false)
    })
  })
})
