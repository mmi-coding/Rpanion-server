// Flight-controller parameter cache + full-download orchestration, feeding the
// read-only "FC Configuration" page. The webUI has no parameter editor; this
// module downloads the FC's whole parameter set once (PARAM_REQUEST_LIST),
// caches it, and decodes the config-relevant groups (serial peripherals, servo
// assignments, CAN/DroneCAN, Ethernet/NET) into a structured overview. Sensors,
// live servo PWM and DroneCAN node status come from the telemetry stream
// (server/mavTelemetry.ts), which this module reads at overview time.
//
// Download robustness mirrors a ground station: each PARAM_VALUE carries the
// total count + its own index, so we know when the set is complete and can
// re-request any indices that were dropped in transit (sendParamRead).
const { common } = require('node-mavlink')

const PARAM_VALUE_MSGID: number = common.ParamValue.MSG_ID // 22

// download watchdog tunables
const TICK_MS = 500 // watchdog cadence
const STALL_MS = 800 // no new param for this long → re-request missing indices
const NO_RESPONSE_MS = 4000 // no PARAM_VALUE at all → give up (FC not answering)
const BATCH = 30 // max indices re-requested per stall
const MAX_RETRIES = 8 // re-request rounds before settling for a partial set

type NumMap = { [k: number]: string }

// ArduPilot SERIALx_PROTOCOL / NET_Px_PROTOCOL enum (common values; numeric fallback)
const SERIAL_PROTOCOL: NumMap = {
  [-1]: 'None', 0: 'None', 1: 'MAVLink1', 2: 'MAVLink2', 3: 'Frsky D', 4: 'Frsky SPort',
  5: 'GPS', 7: 'Alexmos Gimbal', 8: 'Gimbal', 9: 'Rangefinder', 10: 'FrSky SPort Passthrough',
  11: 'Lidar360', 13: 'Beacon', 14: 'Volz Servo', 15: 'SBus Servo', 16: 'ESC Telemetry',
  17: 'Devo Telem', 18: 'OpticalFlow', 19: 'RobotisServo', 20: 'NMEA Output', 21: 'WindVane',
  22: 'SLCAN', 23: 'RCIN', 24: 'EFI', 25: 'LTM', 26: 'RunCam', 27: 'HottTelem', 28: 'Scripting',
  29: 'Crossfire VTX', 30: 'Generator', 31: 'Winch', 32: 'MSP', 33: 'DJI FPV', 34: 'AirSpeed',
  35: 'ADSB', 36: 'AHRS', 37: 'SmartAudio', 38: 'FETtecOneWire', 39: 'Torqeedo', 40: 'AIS',
  41: 'CoDevESC', 42: 'DisplayPort', 43: 'MAVLink HighLatency', 44: 'IRC Tramp', 45: 'DDS XRCE',
  46: 'IMUDATA'
}

// ArduPilot SERVOx_FUNCTION enum (common values; numeric fallback)
const SERVO_FUNCTION: NumMap = {
  0: 'Disabled', 1: 'RCPassThru', 2: 'Flap', 3: 'Flap Auto', 4: 'Aileron', 6: 'Mount Pan',
  7: 'Mount Tilt', 8: 'Mount Roll', 9: 'Mount Open', 19: 'Elevator', 21: 'Rudder',
  24: 'Flaperon Left', 25: 'Flaperon Right', 26: 'Ground Steering', 27: 'Parachute',
  33: 'Motor1', 34: 'Motor2', 35: 'Motor3', 36: 'Motor4', 37: 'Motor5', 38: 'Motor6',
  39: 'Motor7', 40: 'Motor8', 51: 'RCIN1', 52: 'RCIN2', 53: 'RCIN3', 54: 'RCIN4',
  70: 'Throttle', 73: 'Throttle Left', 74: 'Throttle Right', 75: 'Tiltmotor Left',
  76: 'Tiltmotor Right', 88: 'Winch', 94: 'Script1'
}

// NET_Px_TYPE enum
const NET_TYPE: NumMap = { 0: 'None', 1: 'UDP Client', 2: 'UDP Server', 3: 'TCP Client', 4: 'TCP Server' }

// CAN_Dx_PROTOCOL enum (common values; numeric fallback)
const CAN_PROTOCOL: NumMap = {
  0: 'Disabled', 1: 'DroneCAN', 4: 'PiccoloCAN', 6: 'EFI_NWPMU', 7: 'USD1', 8: 'KDECAN',
  9: 'MPPT', 10: 'Scripting', 11: 'Benewake', 12: 'Scripting2', 13: 'TOFSenseP', 14: 'NanoRadar'
}

// SERIALx_BAUD code → actual baud (code is roughly baud/1000; numeric fallback)
const BAUD_MAP: NumMap = {
  1: '1200', 2: '2400', 4: '4800', 9: '9600', 19: '19200', 38: '38400', 57: '57600',
  111: '111100', 115: '115200', 230: '230400', 256: '256000', 460: '460800', 500: '500000',
  921: '921600', 1500: '1500000', 2000: '2000000'
}

// MAV_SYS_STATUS_SENSOR bits we surface as "available sensors"
const SENSORS: Array<{ key: string, label: string, bit: number }> = [
  { key: 'gyro', label: 'Gyro', bit: 1 },
  { key: 'accel', label: 'Accelerometer', bit: 2 },
  { key: 'mag', label: 'Compass', bit: 4 },
  { key: 'baro', label: 'Barometer', bit: 8 },
  { key: 'airspeed', label: 'Airspeed', bit: 16 },
  { key: 'gps', label: 'GPS', bit: 32 },
  { key: 'opticalflow', label: 'Optical Flow', bit: 64 },
  { key: 'gyro2', label: 'Gyro 2', bit: 131072 },
  { key: 'accel2', label: 'Accelerometer 2', bit: 262144 },
  { key: 'mag2', label: 'Compass 2', bit: 524288 },
  { key: 'rcreceiver', label: 'RC Receiver', bit: 65536 },
  { key: 'battery', label: 'Battery', bit: 33554432 },
  { key: 'proximity', label: 'Proximity', bit: 67108864 },
  { key: 'ahrs', label: 'AHRS / EKF', bit: 2097152 },
  { key: 'logging', label: 'Logging', bit: 16777216 },
  { key: 'prearm', label: 'Pre-arm Check', bit: 268435456 }
]

type Getter = (name: string) => number | undefined

// bit test that is safe for bits ≥ 2^31 (JS bitwise '&' is 32-bit signed)
function hasBit (value: number, bit: number): boolean {
  return Math.floor(value / bit) % 2 === 1
}

function mapEnum (map: NumMap, val: number | undefined, fallback: string): string | null {
  if (val === undefined) {
    return null
  }
  return (map[val] !== undefined) ? map[val] : (fallback + ' ' + val)
}

// combine NAME0..NAME3 octet params into a dotted-quad string (null if incomplete)
function ipQuad (get: Getter, prefix: string): string | null {
  const o = [get(prefix + '0'), get(prefix + '1'), get(prefix + '2'), get(prefix + '3')]
  if (o.some((v) => v === undefined)) {
    return null
  }
  return o.map((v) => (v as number) & 0xff).join('.')
}

function decodeBaud (code: number | undefined): string | number | null {
  if (code === undefined) {
    return null
  }
  return (BAUD_MAP[code] !== undefined) ? BAUD_MAP[code] : code
}

function decodeSensors (fields: any): any[] {
  if (fields === undefined) {
    return []
  }
  const present = Number(fields.onboardControlSensorsPresent) || 0
  const enabled = Number(fields.onboardControlSensorsEnabled) || 0
  const health = Number(fields.onboardControlSensorsHealth) || 0
  return SENSORS.filter((s) => hasBit(present, s.bit)).map((s) => ({
    key: s.key,
    label: s.label,
    enabled: hasBit(enabled, s.bit),
    healthy: hasBit(health, s.bit)
  }))
}

function decodeSerial (get: Getter): any[] {
  const out = []
  for (let i = 0; i <= 9; i++) {
    const proto = get('SERIAL' + i + '_PROTOCOL')
    if (proto === undefined) {
      continue
    }
    out.push({
      port: i,
      protocol: proto,
      protocolName: mapEnum(SERIAL_PROTOCOL, proto, 'Protocol'),
      baud: decodeBaud(get('SERIAL' + i + '_BAUD'))
    })
  }
  return out
}

function servoPwm (servoRaw: any, ch: number): number | null {
  if (servoRaw === undefined || ch > 16) {
    return null
  }
  const v = servoRaw['servo' + ch + 'Raw']
  return (v === undefined || v === null) ? null : Number(v)
}

function decodeServos (get: Getter, servoRaw: any): any[] {
  const out = []
  for (let ch = 1; ch <= 32; ch++) {
    const func = get('SERVO' + ch + '_FUNCTION')
    if (func === undefined || func === 0) {
      continue // unconfigured / disabled output — skip to keep the summary tight
    }
    out.push({
      ch,
      func,
      funcName: mapEnum(SERVO_FUNCTION, func, 'Function'),
      min: get('SERVO' + ch + '_MIN') ?? null,
      max: get('SERVO' + ch + '_MAX') ?? null,
      trim: get('SERVO' + ch + '_TRIM') ?? null,
      reversed: get('SERVO' + ch + '_REVERSED') === 1,
      pwm: servoPwm(servoRaw, ch)
    })
  }
  return out
}

// CAN bus configuration from parameters. The live DroneCAN *node* list comes from
// server/droneCan.ts (CAN forwarding) — params only describe the buses/drivers.
function decodeCan (get: Getter): any {
  const ports = []
  for (let n = 1; n <= 3; n++) {
    const driver = get('CAN_P' + n + '_DRIVER')
    if (driver === undefined) {
      continue
    }
    ports.push({ n, driver, bitrate: get('CAN_P' + n + '_BITRATE') ?? null })
  }
  const drivers = []
  for (let d = 1; d <= 3; d++) {
    const proto = get('CAN_D' + d + '_PROTOCOL')
    if (proto === undefined) {
      continue
    }
    drivers.push({ n: d, protocol: proto, protocolName: mapEnum(CAN_PROTOCOL, proto, 'Protocol') })
  }
  return { ports, drivers }
}

function decodeNet (get: Getter): any {
  const ports = []
  for (let n = 1; n <= 4; n++) {
    const type = get('NET_P' + n + '_TYPE')
    if (type === undefined) {
      continue
    }
    ports.push({
      n,
      type,
      typeName: mapEnum(NET_TYPE, type, 'Type'),
      protocol: get('NET_P' + n + '_PROTOCOL') ?? null,
      protocolName: mapEnum(SERIAL_PROTOCOL, get('NET_P' + n + '_PROTOCOL'), 'Protocol'),
      ip: ipQuad(get, 'NET_P' + n + '_IP'),
      port: get('NET_P' + n + '_PORT') ?? null
    })
  }
  const enable = get('NET_ENABLE')
  return {
    present: enable !== undefined || ports.length > 0,
    enable: enable ?? null,
    dhcp: get('NET_DHCP') ?? null,
    ip: ipQuad(get, 'NET_IPADDR'),
    netmask: get('NET_NETMASK') ?? null,
    gateway: ipQuad(get, 'NET_GWADDR'),
    ports
  }
}

class FCParams {
  fcManager: any
  mavTelemetry: any
  params: { [name: string]: { value: number, type: number, index: number } }
  state: string
  total: number
  seen: Set<number>
  startMs: number
  lastParamMs: number
  retries: number
  timer: any

  constructor (fcManager: any, mavTelemetry: any) {
    this.fcManager = fcManager
    this.mavTelemetry = mavTelemetry
    this.params = {}
    this.state = 'idle' // idle | downloading | complete | partial | failed
    this.total = 0
    this.seen = new Set()
    this.startMs = 0
    this.lastParamMs = 0
    this.retries = 0
    this.timer = null
  }

  // record one decoded MAVLink packet; only PARAM_VALUE is of interest here
  onMessage (packet: any, data: any): void {
    if (packet === null || packet === undefined || packet.header === undefined) {
      return
    }
    if (packet.header.msgid !== PARAM_VALUE_MSGID) {
      return
    }
    if (data === null || data === undefined) {
      return
    }
    const name = String(data.paramId).replace(/\0/g, '').trim()
    if (name === '') {
      return
    }
    this.params[name] = { value: data.paramValue, type: data.paramType, index: data.paramIndex }
    this.total = data.paramCount
    this.seen.add(data.paramIndex)
    this.lastParamMs = Date.now()
    if (this.state === 'downloading' && this.total > 0 && this.seen.size >= this.total) {
      this.state = 'complete'
      this._stop()
    }
  }

  // trigger a fresh full parameter download
  requestAll (): boolean {
    this._stop()
    this.params = {}
    this.seen = new Set()
    this.total = 0
    this.retries = 0
    const now = Date.now()
    this.startMs = now
    this.lastParamMs = now
    if (!this.fcManager.requestParams()) {
      this.state = 'failed' // no connected flight controller to ask
      return false
    }
    this.state = 'downloading'
    this.timer = setInterval(() => this._tick(), TICK_MS)
    return true
  }

  _tick (): void {
    if (this.state !== 'downloading') {
      this._stop()
      return
    }
    const now = Date.now()
    if (this.total === 0) {
      // still waiting for the first PARAM_VALUE
      if (now - this.startMs > NO_RESPONSE_MS) {
        this.state = 'failed'
        this._stop()
      }
      return
    }
    if (this.seen.size >= this.total) {
      this.state = 'complete'
      this._stop()
      return
    }
    if (now - this.lastParamMs > STALL_MS) {
      this.retries += 1
      if (this.retries > MAX_RETRIES) {
        this.state = 'partial' // settle for what we have
        this._stop()
        return
      }
      let sent = 0
      for (let i = 0; i < this.total && sent < BATCH; i++) {
        if (!this.seen.has(i)) {
          this.fcManager.requestParam(i)
          sent += 1
        }
      }
      this.lastParamMs = now // give the re-requested params time to arrive
    }
  }

  _stop (): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  getProgress (): any {
    return { state: this.state, received: Object.keys(this.params).length, total: this.total }
  }

  // structured, read-only config overview built from the param cache + telemetry
  getOverview (): any {
    const get: Getter = (name) => {
      const p = this.params[name]
      return (p !== undefined) ? p.value : undefined
    }
    const byName: any = {}
    for (const m of this.mavTelemetry.getSnapshot()) {
      byName[m.name] = m.fields
    }
    return {
      ...this.getProgress(),
      sensors: decodeSensors(byName.SYS_STATUS),
      serial: decodeSerial(get),
      servos: decodeServos(get, byName.SERVO_OUTPUT_RAW),
      can: decodeCan(get),
      net: decodeNet(get)
    }
  }
}

export = FCParams
