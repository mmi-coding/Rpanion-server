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

interface HudData {
  alt: number | null
  altRel: number | null
  spd: number | null
  airspeed: number | null
  hdg: number | null
  climb: number | null
  throttle: number | null
  batV: number | null
  batPct: number | null
  current: number | null
  mode: string | null
  armed: boolean | null
  gpsFix: number | null
  gpsSats: number | null
  roll: number | null
  pitch: number | null
}

function emptyHudData (): HudData {
  return {
    alt: null, altRel: null, spd: null, airspeed: null, hdg: null, climb: null,
    throttle: null, batV: null, batPct: null, current: null, mode: null, armed: null,
    gpsFix: null, gpsSats: null, roll: null, pitch: null
  }
}

// The catalog of customizable OSD elements (#173 "professional HUD"). The editor
// (frontend) reads this list (label + a sample value, for the draggable chips);
// video-server.py has a matching renderer (label/unit/icon glyph) keyed on `type`.
const HUD_ELEMENTS = [
  { type: 'horizon', label: 'Artificial Horizon', sample: '' },
  { type: 'alt', label: 'Altitude (MSL)', sample: '124m' },
  { type: 'altRel', label: 'Altitude (AGL)', sample: '38m' },
  { type: 'spd', label: 'Ground Speed', sample: '14.2m/s' },
  { type: 'airspeed', label: 'Airspeed', sample: '15.1m/s' },
  { type: 'hdg', label: 'Heading', sample: '271°' },
  { type: 'climb', label: 'Climb Rate', sample: '0.5m/s' },
  { type: 'throttle', label: 'Throttle', sample: '45%' },
  { type: 'batV', label: 'Battery Voltage', sample: '15.8V' },
  { type: 'batPct', label: 'Battery Remaining', sample: '62%' },
  { type: 'current', label: 'Current', sample: '8.4A' },
  { type: 'mode', label: 'Flight Mode', sample: 'AUTO' },
  { type: 'armed', label: 'Arm State', sample: 'ARMED' },
  { type: 'gps', label: 'GPS', sample: '3D/11' }
]

// element type → default { enabled, x, y, icon }. x/y are 0..1 fractions of the
// frame. Defaults roughly mirror the original fixed graphic HUD.
const DEFAULT_PLACEMENT: { [k: string]: { enabled: boolean; x: number; y: number; icon: boolean } } = {
  horizon: { enabled: true, x: 0.5, y: 0.5, icon: false },
  alt: { enabled: true, x: 0.86, y: 0.06, icon: true },
  altRel: { enabled: false, x: 0.86, y: 0.12, icon: true },
  spd: { enabled: true, x: 0.04, y: 0.06, icon: true },
  airspeed: { enabled: false, x: 0.04, y: 0.12, icon: true },
  hdg: { enabled: true, x: 0.46, y: 0.06, icon: false },
  climb: { enabled: false, x: 0.04, y: 0.18, icon: true },
  throttle: { enabled: false, x: 0.04, y: 0.24, icon: true },
  batV: { enabled: true, x: 0.78, y: 0.92, icon: true },
  batPct: { enabled: false, x: 0.78, y: 0.86, icon: true },
  current: { enabled: false, x: 0.78, y: 0.80, icon: true },
  mode: { enabled: true, x: 0.04, y: 0.92, icon: false },
  armed: { enabled: false, x: 0.04, y: 0.86, icon: true },
  gps: { enabled: true, x: 0.46, y: 0.92, icon: true }
}

function hudElements () {
  return HUD_ELEMENTS
}

function defaultHudLayout () {
  return {
    elements: HUD_ELEMENTS.map((e) => ({ type: e.type, ...DEFAULT_PLACEMENT[e.type] }))
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
    if (!e) {
      return { type: cat.type, enabled: d.enabled, x: d.x, y: d.y, icon: d.icon }
    }
    return {
      type: cat.type,
      enabled: !!e.enabled,
      icon: !!e.icon,
      x: clamp01(e.x),
      y: clamp01(e.y)
    }
  })
  return { elements }
}

function num (v: number | null, digits: number, suffix: string): string {
  return v === null ? '--' : v.toFixed(digits) + suffix
}

function formatHudText (hud: HudData): string {
  const line1 = 'ALT ' + num(hud.alt, 0, 'm') + '  SPD ' + num(hud.spd, 1, 'm/s')
  const line2 = 'HDG ' + (hud.hdg === null ? '--' : Math.round(hud.hdg) + '°') +
                '  BAT ' + num(hud.batV, 1, 'V') + ' ' + (hud.batPct === null ? '--' : hud.batPct + '%')
  const gps = (hud.gpsFix === null ? '--' : gpsFixName(hud.gpsFix)) + '/' +
              (hud.gpsSats === null ? '--' : hud.gpsSats)
  const line3 = (hud.mode === null ? 'MODE --' : hud.mode) + '  GPS ' + gps
  return line1 + '\n' + line2 + '\n' + line3
}

export = { mavlinkModeName, gpsFixName, formatHudText, emptyHudData, hudElements, defaultHudLayout, validateHudLayout }
