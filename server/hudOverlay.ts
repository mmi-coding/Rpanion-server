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
  spd: number | null
  hdg: number | null
  batV: number | null
  batPct: number | null
  mode: string | null
  gpsFix: number | null
  gpsSats: number | null
}

function emptyHudData (): HudData {
  return { alt: null, spd: null, hdg: null, batV: null, batPct: null, mode: null, gpsFix: null, gpsSats: null }
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

export = { mavlinkModeName, gpsFixName, formatHudText, emptyHudData }
