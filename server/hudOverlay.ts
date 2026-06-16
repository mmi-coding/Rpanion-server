// Telemetry HUD overlay (#173): turn live MAVLink telemetry into the compact
// text readout that video-server.py burns onto the stream via a `textoverlay`
// element. Pure functions only (no I/O), so they unit-test to 100%.

// ArduPilot encodes the flight mode in HEARTBEAT.custom_mode; its meaning
// depends on the vehicle family (copter / plane / rover), which we derive from
// HEARTBEAT.type. Maps below cover the common ArduPilot modes; anything not
// listed falls back to a numeric "MODE <n>".
const COPTER_MODES: { [k: number]: string } = {
  0: 'STAB', 1: 'ACRO', 2: 'ALTHLD', 3: 'AUTO', 4: 'GUIDED', 5: 'LOITER',
  6: 'RTL', 7: 'CIRCLE', 9: 'LAND', 11: 'DRIFT', 13: 'SPORT', 14: 'FLIP',
  15: 'ATUNE', 16: 'POSHLD', 17: 'BRAKE', 18: 'THROW', 19: 'ADSB',
  20: 'GUIDNOGPS', 21: 'SMRTRTL', 22: 'FLOWHLD', 23: 'FOLLOW', 24: 'ZIGZAG',
  25: 'SYSID', 26: 'AROTATE', 27: 'AUTORTL'
}
const PLANE_MODES: { [k: number]: string } = {
  0: 'MANUAL', 1: 'CIRCLE', 2: 'STABLZ', 3: 'TRAIN', 4: 'ACRO', 5: 'FBWA',
  6: 'FBWB', 7: 'CRUISE', 8: 'ATUNE', 10: 'AUTO', 11: 'RTL', 12: 'LOITER',
  13: 'TKOFF', 14: 'ADSB', 15: 'GUIDED', 17: 'QSTAB', 18: 'QHOVER',
  19: 'QLOITER', 20: 'QLAND', 21: 'QRTL', 22: 'QATUNE', 23: 'QACRO',
  24: 'THERMAL', 25: 'LOITQLAND'
}
const ROVER_MODES: { [k: number]: string } = {
  0: 'MANUAL', 1: 'ACRO', 3: 'STEER', 4: 'HOLD', 5: 'LOITER', 6: 'FOLLOW',
  7: 'SIMPLE', 10: 'AUTO', 11: 'RTL', 12: 'SMRTRTL', 15: 'GUIDED', 16: 'INIT'
}

// MavType values (minimal dialect) grouped into ArduPilot vehicle families.
const COPTER_TYPES = new Set([2, 3, 4, 13, 14, 15, 29]) // quad/coax/heli/hexa/octo/tri/dodeca
const PLANE_TYPES = new Set([1, 16, 17, 19, 20, 21, 22, 23, 24, 25, 28]) // fixed-wing + VTOLs
const ROVER_TYPES = new Set([10, 11]) // ground rover + surface boat

function mavlinkModeName (vehicleType: number, customMode: number): string {
  let map: { [k: number]: string } | null = null
  if (COPTER_TYPES.has(vehicleType)) {
    map = COPTER_MODES
  } else if (PLANE_TYPES.has(vehicleType)) {
    map = PLANE_MODES
  } else if (ROVER_TYPES.has(vehicleType)) {
    map = ROVER_MODES
  }
  if (map !== null && customMode in map) {
    return map[customMode]
  }
  return 'MODE ' + customMode
}

// GPS_RAW_INT.fix_type → short label.
const GPS_FIX_NAMES: { [k: number]: string } = {
  0: 'NO', 1: 'NO', 2: '2D', 3: '3D', 4: 'DGPS', 5: 'RTKf', 6: 'RTKx', 7: 'STAT', 8: 'PPP'
}

function gpsFixName (fixType: number): string {
  return fixType in GPS_FIX_NAMES ? GPS_FIX_NAMES[fixType] : '?'
}

// every numeric/string telemetry value the OSD can show. `roll`/`pitch` feed the
// artificial horizon; `hdg` feeds the compass; the rest are direct readouts.
interface HudData {
  [k: string]: number | string | boolean | null
}

function emptyHudData (): HudData {
  const keys = [
    // attitude
    'roll', 'pitch', 'turnRate', 'gload',
    // altitude & speed
    'alt', 'altRel', 'spd', 'airspeed', 'climb', 'throttle', 'rangefinder',
    // position & gps
    'gpsFix', 'gpsSats', 'lat', 'lon', 'hdop', 'gpsCourse', 'hdg',
    // navigation
    'homeDist', 'homeDir', 'wpDist', 'wpNum', 'xtrack', 'altError',
    // battery & power
    'batV', 'batPct', 'current', 'mah', 'battTemp', 'battTimeRemaining', 'cpuLoad',
    // link
    'rcRssi', 'radioRssi', 'radioRemRssi', 'radioNoise', 'dropRate',
    // environment
    'windSpeed', 'windDir', 'baroTemp', 'pressure',
    // status
    'mode', 'armed', 'timer',
    // health
    'vibe', 'vibeClip',
    // modem GPS (SIM7600)
    'modemLat', 'modemLon', 'modemAlt', 'modemFix'
  ]
  const o: HudData = {}
  for (const k of keys) {
    o[k] = null
  }
  return o
}

// The catalog of customizable OSD elements (#173 "professional HUD"), grouped into
// sections. The editor (frontend) reads this list (section + label + a sample
// value, for the draggable chips + grouped palette); video-server.py has a
// matching renderer (value formatter + icon glyph) keyed on `type`. Each entry
// also carries its default placement { enabled, x, y, icon } (x/y are 0..1 frame
// fractions). Most are off by default to keep a clean default HUD.
const HUD_ELEMENTS = [
  // ── Attitude ──
  { type: 'horizon', section: 'Attitude', label: 'Artificial Horizon', sample: '', enabled: true, x: 0.5, y: 0.5, icon: false },
  { type: 'compass', section: 'Attitude', label: 'Compass Tape', sample: '', enabled: false, x: 0.5, y: 0.12, icon: false },
  { type: 'hdg', section: 'Attitude', label: 'Heading', sample: '271°', enabled: true, x: 0.46, y: 0.06, icon: false },
  { type: 'turnRate', section: 'Attitude', label: 'Turn Rate', sample: '5°/s', enabled: false, x: 0.04, y: 0.40, icon: true },
  { type: 'gload', section: 'Attitude', label: 'G-Load', sample: '1.0G', enabled: false, x: 0.04, y: 0.46, icon: true },
  // ── Altitude & Speed ──
  { type: 'alt', section: 'Altitude & Speed', label: 'Altitude (MSL)', sample: '124m', enabled: true, x: 0.86, y: 0.06, icon: true },
  { type: 'altRel', section: 'Altitude & Speed', label: 'Altitude (AGL)', sample: '38m', enabled: false, x: 0.86, y: 0.12, icon: true },
  { type: 'spd', section: 'Altitude & Speed', label: 'Ground Speed', sample: '14.2m/s', enabled: true, x: 0.04, y: 0.06, icon: true },
  { type: 'airspeed', section: 'Altitude & Speed', label: 'Airspeed', sample: '15.1m/s', enabled: false, x: 0.04, y: 0.12, icon: true },
  { type: 'climb', section: 'Altitude & Speed', label: 'Climb Rate', sample: '0.5m/s', enabled: false, x: 0.04, y: 0.18, icon: true },
  { type: 'throttle', section: 'Altitude & Speed', label: 'Throttle', sample: '45%', enabled: false, x: 0.04, y: 0.24, icon: true },
  { type: 'rangefinder', section: 'Altitude & Speed', label: 'Rangefinder', sample: '2.4m', enabled: false, x: 0.86, y: 0.18, icon: true },
  // ── Position & GPS ──
  { type: 'gps', section: 'Position & GPS', label: 'GPS Fix/Sats', sample: '3D/11', enabled: true, x: 0.46, y: 0.92, icon: true },
  { type: 'lat', section: 'Position & GPS', label: 'Latitude', sample: '37.4220', enabled: false, x: 0.04, y: 0.52, icon: false },
  { type: 'lon', section: 'Position & GPS', label: 'Longitude', sample: '-122.084', enabled: false, x: 0.04, y: 0.58, icon: false },
  { type: 'hdop', section: 'Position & GPS', label: 'GPS HDOP', sample: '0.8', enabled: false, x: 0.04, y: 0.64, icon: true },
  { type: 'gpsCourse', section: 'Position & GPS', label: 'GPS Course', sample: '270°', enabled: false, x: 0.04, y: 0.70, icon: true },
  // ── Navigation ──
  { type: 'homeDist', section: 'Navigation', label: 'Distance to Home', sample: '420m', enabled: false, x: 0.40, y: 0.86, icon: true },
  { type: 'homeDir', section: 'Navigation', label: 'Direction to Home', sample: '', enabled: false, x: 0.55, y: 0.86, icon: false },
  { type: 'wpDist', section: 'Navigation', label: 'Distance to WP', sample: '120m', enabled: false, x: 0.40, y: 0.80, icon: true },
  { type: 'wpNum', section: 'Navigation', label: 'Current Waypoint', sample: 'WP 3', enabled: false, x: 0.40, y: 0.74, icon: false },
  { type: 'xtrack', section: 'Navigation', label: 'Crosstrack Error', sample: '1.2m', enabled: false, x: 0.40, y: 0.68, icon: false },
  { type: 'altError', section: 'Navigation', label: 'Altitude Error', sample: '0.5m', enabled: false, x: 0.40, y: 0.62, icon: false },
  // ── Battery & Power ──
  { type: 'batV', section: 'Battery & Power', label: 'Battery Voltage', sample: '15.8V', enabled: true, x: 0.78, y: 0.92, icon: true },
  { type: 'batPct', section: 'Battery & Power', label: 'Battery Remaining', sample: '62%', enabled: false, x: 0.78, y: 0.86, icon: true },
  { type: 'current', section: 'Battery & Power', label: 'Current', sample: '8.4A', enabled: false, x: 0.78, y: 0.80, icon: true },
  { type: 'mah', section: 'Battery & Power', label: 'mAh Consumed', sample: '1240mAh', enabled: false, x: 0.78, y: 0.74, icon: true },
  { type: 'battTemp', section: 'Battery & Power', label: 'Battery Temp', sample: '32°C', enabled: false, x: 0.78, y: 0.68, icon: true },
  { type: 'battTimeRemaining', section: 'Battery & Power', label: 'Battery Time Left', sample: '12:30', enabled: false, x: 0.78, y: 0.62, icon: true },
  { type: 'cpuLoad', section: 'Battery & Power', label: 'Autopilot Load', sample: '38%', enabled: false, x: 0.78, y: 0.56, icon: true },
  // ── Link ──
  { type: 'rcRssi', section: 'Link', label: 'RC RSSI', sample: '95%', enabled: false, x: 0.86, y: 0.30, icon: true },
  { type: 'radioRssi', section: 'Link', label: 'Radio RSSI', sample: '180', enabled: false, x: 0.86, y: 0.36, icon: true },
  { type: 'radioRemRssi', section: 'Link', label: 'Radio Remote RSSI', sample: '175', enabled: false, x: 0.86, y: 0.42, icon: true },
  { type: 'radioNoise', section: 'Link', label: 'Radio Noise', sample: '40', enabled: false, x: 0.86, y: 0.48, icon: true },
  { type: 'dropRate', section: 'Link', label: 'Comm Drop Rate', sample: '0%', enabled: false, x: 0.86, y: 0.54, icon: true },
  // ── Environment ──
  { type: 'windSpeed', section: 'Environment', label: 'Wind Speed', sample: '4.2m/s', enabled: false, x: 0.86, y: 0.60, icon: true },
  { type: 'windDir', section: 'Environment', label: 'Wind Direction', sample: '210°', enabled: false, x: 0.86, y: 0.66, icon: true },
  { type: 'baroTemp', section: 'Environment', label: 'Baro Temperature', sample: '24°C', enabled: false, x: 0.86, y: 0.72, icon: true },
  { type: 'pressure', section: 'Environment', label: 'Baro Pressure', sample: '1013hPa', enabled: false, x: 0.86, y: 0.78, icon: true },
  // ── Status ──
  { type: 'mode', section: 'Status', label: 'Flight Mode', sample: 'AUTO', enabled: true, x: 0.04, y: 0.92, icon: false },
  { type: 'armed', section: 'Status', label: 'Arm State', sample: 'ARMED', enabled: false, x: 0.04, y: 0.86, icon: true },
  { type: 'timer', section: 'Status', label: 'Flight Timer', sample: '3:42', enabled: false, x: 0.04, y: 0.80, icon: true },
  { type: 'clock', section: 'Status', label: 'Clock', sample: '14:05:32', enabled: false, x: 0.04, y: 0.74, icon: true },
  // ── Health ──
  { type: 'vibe', section: 'Health', label: 'Vibration', sample: '12', enabled: false, x: 0.46, y: 0.18, icon: true },
  { type: 'vibeClip', section: 'Health', label: 'Vibration Clipping', sample: '0', enabled: false, x: 0.46, y: 0.24, icon: true },
  // ── Modem GPS (SIM7600, when present) ──
  { type: 'modemFix', section: 'Modem GPS', label: 'Modem GPS Fix', sample: 'OK', enabled: false, x: 0.46, y: 0.30, icon: true },
  { type: 'modemLat', section: 'Modem GPS', label: 'Modem Latitude', sample: '37.42200', enabled: false, x: 0.46, y: 0.36, icon: false },
  { type: 'modemLon', section: 'Modem GPS', label: 'Modem Longitude', sample: '-122.08400', enabled: false, x: 0.46, y: 0.42, icon: false },
  { type: 'modemAlt', section: 'Modem GPS', label: 'Modem Altitude', sample: '42m', enabled: false, x: 0.46, y: 0.48, icon: true }
]

// type → the full rendered value the burned-in HUD shows, so the editor canvas is
// WYSIWYG (mirrors python video-server.py's hudElementText). Graphic elements
// (horizon/compass/homeDir) render as shapes, not text.
const HUD_MOCK: { [k: string]: string } = {
  hdg: 'HDG 271', turnRate: 'TRN 5°/s', gload: '1.2G',
  alt: 'ALT 124m', altRel: 'AGL 38m', spd: 'SPD 14.2', airspeed: 'AIR 15.1',
  climb: 'VS 0.5', throttle: 'THR 45%', rangefinder: 'RNG 2.4m',
  gps: 'GPS 3D/11', lat: 'LAT 37.42200', lon: 'LON -122.08400', hdop: 'HDOP 0.8', gpsCourse: 'CRS 270°',
  homeDist: 'HOME 420m', wpDist: 'WP 120m', wpNum: 'WP#3', xtrack: 'XTK 1.2m', altError: 'AERR 0.5m',
  batV: 'BAT 15.8V', batPct: '62%', current: '8.4A', mah: '1240mAh', battTemp: 'BT 32°C',
  battTimeRemaining: 'BTL 12:30', cpuLoad: 'CPU 38%',
  rcRssi: 'RC 95%', radioRssi: 'RSSI 180', radioRemRssi: 'RRSSI 175', radioNoise: 'NOISE 40', dropRate: 'DROP 0%',
  windSpeed: 'WND 4.2m/s', windDir: 'WDIR 210°', baroTemp: 'TMP 24°C', pressure: 'PRS 1013hPa',
  mode: 'AUTO', armed: 'ARMED', timer: '3:42', clock: '14:05:32', vibe: 'VIB 12', vibeClip: 'CLIP 0',
  modemFix: 'mGPS OK', modemLat: 'mLAT 37.42200', modemLon: 'mLON -122.08400', modemAlt: 'mALT 42m'
}

// default global text style. A font family is any safe name (generics, or a
// curated/imported family from the HudFonts manager) — letters/digits/space/
// hyphen only, so it is safe to interpolate into the SVG/CSS.
const DEFAULT_GLOBAL_STYLE = { font: 'monospace', size: 34, color: '#ffffff' }

function validFont (v: any): boolean {
  return typeof v === 'string' && /^[A-Za-z0-9 \-]{1,64}$/.test(v)
}

// element type → default { enabled, x, y, icon }, derived from the catalog above.
const DEFAULT_PLACEMENT: { [k: string]: { enabled: boolean; x: number; y: number; icon: boolean } } = {}
for (const e of HUD_ELEMENTS) {
  DEFAULT_PLACEMENT[e.type] = { enabled: e.enabled, x: e.x, y: e.y, icon: e.icon }
}

// graphic elements draw shapes (no value text / icon / style) — they carry a
// `scale` multiplier instead of a text size. Defaults are >1 so they're prominent
// out of the box (the horizon especially); the editor lets the user dial 0.5–5.
const GRAPHIC_TYPES = new Set(['horizon', 'compass', 'homeDir'])
const GRAPHIC_DEFAULT_SCALE: { [k: string]: number } = { horizon: 1.8, compass: 1.4, homeDir: 1.4 }

function validScale (v: any, def: number): number {
  const n = Number(v)
  return isFinite(n) ? +Math.min(5, Math.max(0.5, n)).toFixed(2) : def
}

// Artificial-horizon options, inspired by INAV's osd_ahi_style + osd_crosshairs_style
// (https://github.com/iNavFlight/inav). `style` = the AHI (ladder / line / ticks);
// `marker` = the centre "aircraft" symbol (the classic wings, a crosshair, etc.).
const HORIZON_STYLES = ['ladder', 'line', 'ticks']
const HORIZON_MARKERS = ['wings', 'crosshair', 'dot', 'caret', 'drone']

function horizonOptions () {
  return { styles: HORIZON_STYLES.slice(), markers: HORIZON_MARKERS.slice() }
}

// validate a graphic element's extra fields: a scale (all graphics), an optional
// colour, and — for the horizon — its AHI style + aircraft marker + marker colour.
function validateGraphic (type: string, e: any, d: any) {
  const out: any = e
    ? { type, enabled: !!e.enabled, icon: !!e.icon, x: clamp01(e.x), y: clamp01(e.y) }
    : { type, enabled: d.enabled, x: d.x, y: d.y, icon: d.icon }
  out.scale = validScale(e ? e.scale : undefined, GRAPHIC_DEFAULT_SCALE[type])
  const color = validColor(e && e.color)
  if (color) {
    out.color = color
  }
  if (type === 'horizon') {
    out.style = (e && HORIZON_STYLES.indexOf(e.style) !== -1) ? e.style : 'ladder'
    out.marker = (e && HORIZON_MARKERS.indexOf(e.marker) !== -1) ? e.marker : 'wings'
    const mc = validColor(e && e.markerColor)
    if (mc) {
      out.markerColor = mc
    }
  }
  return out
}

function hudElements () {
  // catalog metadata the editor needs (placement comes from the saved layout).
  // `mock` is the value as it appears on the stream (WYSIWYG); `graphic` marks
  // the shape-only elements.
  return HUD_ELEMENTS.map((e) => ({
    type: e.type, section: e.section, label: e.label,
    mock: HUD_MOCK[e.type] || '', graphic: GRAPHIC_TYPES.has(e.type)
  }))
}

// great-circle distance (m) between two lat/lon points (degrees)
function homeDistance (lat: number, lon: number, homeLat: number, homeLon: number): number {
  const R = 6371000
  const dLat = (homeLat - lat) * Math.PI / 180
  const dLon = (homeLon - lon) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat * Math.PI / 180) * Math.cos(homeLat * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
}

// initial bearing (deg, 0..360) from the current point to home
function homeBearing (lat: number, lon: number, homeLat: number, homeLon: number): number {
  const φ1 = lat * Math.PI / 180
  const φ2 = homeLat * Math.PI / 180
  const dλ = (homeLon - lon) * Math.PI / 180
  const y = Math.sin(dλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ)
  return Math.round((Math.atan2(y, x) * 180 / Math.PI + 360) % 360)
}

function clampSize (v: any, def: number): number {
  const n = Math.round(Number(v))
  return isFinite(n) ? Math.min(120, Math.max(10, n)) : def
}

function validColor (v: any): string | null {
  return (typeof v === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) ? v : null
}

// global text style (font/size/color) applied to every element unless overridden
function validateGlobalStyle (g: any) {
  g = g || {}
  return {
    font: validFont(g.font) ? g.font : DEFAULT_GLOBAL_STYLE.font,
    size: clampSize(g.size, DEFAULT_GLOBAL_STYLE.size),
    color: validColor(g.color) || DEFAULT_GLOBAL_STYLE.color
  }
}

// per-element overrides: keep only the valid, present fields (absent = inherit)
function validateElementStyle (e: any) {
  const s: any = {}
  if (validFont(e.font)) {
    s.font = e.font
  }
  if (e.size !== undefined && e.size !== null && isFinite(Number(e.size))) {
    s.size = clampSize(e.size, DEFAULT_GLOBAL_STYLE.size)
  }
  const c = validColor(e.color)
  if (c) {
    s.color = c
  }
  // icon overrides: an icon colour (default cyan) + a size multiplier (0.5–3×,
  // default 1×). Kept only when present/valid, so an un-customised icon keeps the
  // default look (cyan, text-height) the renderer falls back to.
  const ic = validColor(e.iconColor)
  if (ic) {
    s.iconColor = ic
  }
  if (e.iconScale !== undefined && e.iconScale !== null && isFinite(Number(e.iconScale))) {
    s.iconScale = +Math.min(3, Math.max(0.5, Number(e.iconScale))).toFixed(2)
  }
  return s
}

function defaultHudLayout () {
  return {
    global: { ...DEFAULT_GLOBAL_STYLE },
    elements: HUD_ELEMENTS.map((e) => {
      if (GRAPHIC_TYPES.has(e.type)) {
        return validateGraphic(e.type, null, DEFAULT_PLACEMENT[e.type])
      }
      return { type: e.type, ...DEFAULT_PLACEMENT[e.type] }
    })
  }
}

function clamp01 (v: any): number {
  const n = Number(v)
  if (!isFinite(n)) {
    return 0
  }
  return Math.min(1, Math.max(0, n))
}

// Normalize a layout from the editor / settings: keep only known element types,
// coerce flags to booleans, clamp positions to the frame. Always returns the full
// element set (missing ones filled from the defaults) so the renderer is complete.
function validateHudLayout (layout: any) {
  const known: { [k: string]: any } = {}
  const incoming = (layout && Array.isArray(layout.elements)) ? layout.elements : []
  for (const e of incoming) {
    if (e && typeof e.type === 'string' && DEFAULT_PLACEMENT[e.type]) {
      known[e.type] = e
    }
  }
  const elements = HUD_ELEMENTS.map((cat) => {
    const e = known[cat.type]
    const d = DEFAULT_PLACEMENT[cat.type]
    if (GRAPHIC_TYPES.has(cat.type)) {
      return validateGraphic(cat.type, e, d)
    }
    if (!e) {
      return { type: cat.type, enabled: d.enabled, x: d.x, y: d.y, icon: d.icon }
    }
    return { type: cat.type, enabled: !!e.enabled, icon: !!e.icon, x: clamp01(e.x), y: clamp01(e.y), ...validateElementStyle(e) }
  })
  return { global: validateGlobalStyle(layout && layout.global), elements }
}

function num (v: any, digits: number, suffix: string): string {
  return (v === null || v === undefined) ? '--' : v.toFixed(digits) + suffix
}

function formatHudText (hud: HudData): string {
  const line1 = 'ALT ' + num(hud.alt, 0, 'm') + '  SPD ' + num(hud.spd, 1, 'm/s')
  const line2 = 'HDG ' + (hud.hdg === null ? '--' : Math.round(hud.hdg as number) + '°') +
                '  BAT ' + num(hud.batV, 1, 'V') + ' ' + (hud.batPct === null ? '--' : hud.batPct + '%')
  const gps = (hud.gpsFix === null ? '--' : gpsFixName(hud.gpsFix as number)) + '/' +
              (hud.gpsSats === null ? '--' : hud.gpsSats)
  const line3 = (hud.mode === null ? 'MODE --' : hud.mode) + '  GPS ' + gps
  return line1 + '\n' + line2 + '\n' + line3
}

export = { mavlinkModeName, gpsFixName, formatHudText, emptyHudData, hudElements, horizonOptions, defaultHudLayout, validateHudLayout, homeDistance, homeBearing }
