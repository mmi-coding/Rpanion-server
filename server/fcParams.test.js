const assert = require('assert')
const sinon = require('sinon')
const FCParams = require('./fcParams')

const PARAM_VALUE = 22 // common.ParamValue.MSG_ID

// build a fake mavTelemetry whose snapshot is the given [{name, fields}] array
function fakeTelem (snapshot) {
  return { getSnapshot: () => snapshot }
}

// set the param cache directly from a {name: value} map
function setParams (fc, obj) {
  fc.params = {}
  let i = 0
  for (const k of Object.keys(obj)) {
    fc.params[k] = { value: obj[k], type: 9, index: i++ }
  }
  fc.total = Object.keys(obj).length
}

function pv (paramId, paramValue, paramCount, paramIndex) {
  return { paramId, paramValue, paramType: 9, paramCount, paramIndex }
}

describe('FCParams', function () {
  let clock

  beforeEach(function () { clock = sinon.useFakeTimers(1000000) })

  afterEach(function () { clock.restore(); sinon.restore() })

  // -------------------------------------------------------------------------
  // onMessage
  // -------------------------------------------------------------------------
  it('ignores null / header-less / non-PARAM_VALUE / null-data / empty-name', function () {
    const fc = new FCParams({}, fakeTelem([]))
    fc.onMessage(null, {})
    fc.onMessage(undefined, {})
    fc.onMessage({}, {}) // no header
    fc.onMessage({ header: { msgid: 30 } }, {}) // not PARAM_VALUE
    fc.onMessage({ header: { msgid: PARAM_VALUE } }, null) // null data
    fc.onMessage({ header: { msgid: PARAM_VALUE } }, pv('', 0, 1, 0)) // empty name
    assert.equal(Object.keys(fc.params).length, 0)
  })

  it('caches a PARAM_VALUE and tracks total + seen index', function () {
    const fc = new FCParams({}, fakeTelem([]))
    fc.onMessage({ header: { msgid: PARAM_VALUE } }, pv('SERIAL1_PROTOCOL', 2, 1100, 42))
    assert.deepEqual(fc.getProgress(), { state: 'idle', received: 1, total: 1100 })
    assert.equal(fc.params.SERIAL1_PROTOCOL.value, 2)
    assert.ok(fc.seen.has(42))
  })

  it('completes the download when every index has been seen', function () {
    const fc = new FCParams({ requestParams: () => true, requestParam: () => {} }, fakeTelem([]))
    fc.requestAll()
    assert.equal(fc.state, 'downloading')
    fc.onMessage({ header: { msgid: PARAM_VALUE } }, pv('A', 1, 2, 0))
    assert.equal(fc.state, 'downloading')
    fc.onMessage({ header: { msgid: PARAM_VALUE } }, pv('B', 2, 2, 1))
    assert.equal(fc.state, 'complete')
    assert.equal(fc.timer, null) // watchdog stopped
  })

  // -------------------------------------------------------------------------
  // requestAll
  // -------------------------------------------------------------------------
  it('requestAll starts a download when a FC is present', function () {
    const requestParams = sinon.stub().returns(true)
    const fc = new FCParams({ requestParams, requestParam: () => {} }, fakeTelem([]))
    assert.equal(fc.requestAll(), true)
    assert.ok(requestParams.calledOnce)
    assert.equal(fc.state, 'downloading')
    assert.notEqual(fc.timer, null)
    clock.tick(500) // fire the watchdog interval once (still within the response window)
    assert.equal(fc.state, 'downloading')
    fc._stop()
  })

  it('requestAll fails when no FC responds to the list request', function () {
    const fc = new FCParams({ requestParams: () => false }, fakeTelem([]))
    assert.equal(fc.requestAll(), false)
    assert.equal(fc.state, 'failed')
  })

  // -------------------------------------------------------------------------
  // _tick watchdog
  // -------------------------------------------------------------------------
  it('_tick stops itself if no longer downloading', function () {
    const fc = new FCParams({}, fakeTelem([]))
    fc.state = 'complete'
    fc.timer = setInterval(() => {}, 100000)
    fc._tick()
    assert.equal(fc.timer, null)
  })

  it('_tick keeps waiting while total is 0 inside the response window', function () {
    const fc = new FCParams({}, fakeTelem([]))
    fc.state = 'downloading'
    fc.total = 0
    fc.startMs = Date.now()
    fc._tick()
    assert.equal(fc.state, 'downloading')
  })

  it('_tick fails when no PARAM_VALUE arrives within the response window', function () {
    const fc = new FCParams({}, fakeTelem([]))
    fc.state = 'downloading'
    fc.total = 0
    fc.startMs = Date.now() - 5000 // past NO_RESPONSE_MS
    fc.timer = setInterval(() => {}, 100000)
    fc._tick()
    assert.equal(fc.state, 'failed')
    assert.equal(fc.timer, null)
  })

  it('_tick completes when all indices are present', function () {
    const fc = new FCParams({}, fakeTelem([]))
    fc.state = 'downloading'
    fc.total = 2
    fc.seen = new Set([0, 1])
    fc.timer = setInterval(() => {}, 100000)
    fc._tick()
    assert.equal(fc.state, 'complete')
    assert.equal(fc.timer, null)
  })

  it('_tick re-requests missing indices when stalled', function () {
    const requestParam = sinon.stub()
    const fc = new FCParams({ requestParam }, fakeTelem([]))
    fc.state = 'downloading'
    fc.total = 3
    fc.seen = new Set([0])
    fc.retries = 0
    fc.lastParamMs = Date.now() - 1000 // past STALL_MS
    fc._tick()
    assert.deepEqual(requestParam.args.map(a => a[0]), [1, 2])
    assert.equal(fc.retries, 1)
  })

  it('_tick caps re-requests to a single batch', function () {
    const requestParam = sinon.stub()
    const fc = new FCParams({ requestParam }, fakeTelem([]))
    fc.state = 'downloading'
    fc.total = 100
    fc.seen = new Set()
    fc.retries = 0
    fc.lastParamMs = Date.now() - 1000
    fc._tick()
    assert.equal(requestParam.callCount, 30) // BATCH
  })

  it('_tick settles for a partial set after exhausting retries', function () {
    const fc = new FCParams({ requestParam: () => {} }, fakeTelem([]))
    fc.state = 'downloading'
    fc.total = 3
    fc.seen = new Set([0])
    fc.retries = 8 // MAX_RETRIES
    fc.lastParamMs = Date.now() - 1000
    fc.timer = setInterval(() => {}, 100000)
    fc._tick()
    assert.equal(fc.state, 'partial')
    assert.equal(fc.timer, null)
  })

  it('_tick does nothing while params are still arriving (not stalled)', function () {
    const requestParam = sinon.stub()
    const fc = new FCParams({ requestParam }, fakeTelem([]))
    fc.state = 'downloading'
    fc.total = 3
    fc.seen = new Set([0])
    fc.lastParamMs = Date.now()
    fc._tick()
    assert.ok(requestParam.notCalled)
    assert.equal(fc.state, 'downloading')
  })

  // -------------------------------------------------------------------------
  // getOverview — decoders
  // -------------------------------------------------------------------------
  it('decodes a rich parameter set + telemetry into the overview', function () {
    const snapshot = [
      { name: 'SYS_STATUS', fields: { onboardControlSensorsPresent: 1 | 2 | 4 | 8 | 32, onboardControlSensorsEnabled: 1 | 2 | 4 | 32, onboardControlSensorsHealth: 1 | 2 | 4 } },
      { name: 'SERVO_OUTPUT_RAW', fields: { servo1Raw: 1500, servo9Raw: 1600 } },
      { name: 'UAVCAN_NODE_STATUS', fields: { health: 0, mode: 0, uptimeSec: 1234 } },
      { name: 'UAVCAN_NODE_INFO', fields: { name: 'ESC 1', swVersionMajor: 1, swVersionMinor: 2 } }
    ]
    const fc = new FCParams({}, fakeTelem(snapshot))
    setParams(fc, {
      SERIAL0_PROTOCOL: 2, SERIAL0_BAUD: 115, // MAVLink2 @ 115200
      SERIAL3_PROTOCOL: 5, SERIAL3_BAUD: 38, // GPS @ 38400
      SERIAL5_PROTOCOL: 999, SERIAL5_BAUD: 7777, // unknown protocol + unknown baud
      SERIAL6_PROTOCOL: 23, // RCIN, no baud → null
      SERVO1_FUNCTION: 33, SERVO1_MIN: 1000, SERVO1_MAX: 2000, SERVO1_TRIM: 1500, SERVO1_REVERSED: 1,
      SERVO2_FUNCTION: 0, // disabled → skipped
      SERVO5_FUNCTION: 4, SERVO5_MIN: 1100, // Aileron, no live pwm
      SERVO9_FUNCTION: 12345, // unknown function fallback, pwm from servo9Raw
      SERVO17_FUNCTION: 70, // ch > 16 → no pwm
      CAN_P1_DRIVER: 1, CAN_P1_BITRATE: 1000000,
      CAN_P2_DRIVER: 0, // present, no bitrate → null
      CAN_D1_PROTOCOL: 1, // DroneCAN
      CAN_D2_PROTOCOL: 555, // unknown fallback
      NET_ENABLE: 1, NET_DHCP: 0,
      NET_IPADDR0: 192, NET_IPADDR1: 168, NET_IPADDR2: 144, NET_IPADDR3: 14,
      NET_NETMASK: 24,
      NET_GWADDR0: 192, NET_GWADDR1: 168, // incomplete → gateway null
      NET_P1_TYPE: 1, NET_P1_PROTOCOL: 2, NET_P1_IP0: 192, NET_P1_IP1: 168, NET_P1_IP2: 144, NET_P1_IP3: 10, NET_P1_PORT: 14550,
      NET_P2_TYPE: 2 // no protocol → protocolName null, ip incomplete → null, port null
    })
    fc.state = 'complete'
    const ov = fc.getOverview()

    // sensors: 5 present; gps enabled-but-unhealthy; baro present-but-disabled
    assert.equal(ov.sensors.length, 5)
    const gps = ov.sensors.find(s => s.key === 'gps')
    assert.deepEqual({ enabled: gps.enabled, healthy: gps.healthy }, { enabled: true, healthy: false })
    const baro = ov.sensors.find(s => s.key === 'baro')
    assert.equal(baro.enabled, false)

    // serial
    assert.deepEqual(ov.serial.map(s => s.port), [0, 3, 5, 6])
    assert.equal(ov.serial[0].protocolName, 'MAVLink2')
    assert.equal(ov.serial[0].baud, '115200')
    assert.equal(ov.serial[2].protocolName, 'Protocol 999') // fallback
    assert.equal(ov.serial[2].baud, 7777) // unknown baud → raw code
    assert.equal(ov.serial[3].baud, null) // no baud param

    // servos
    assert.deepEqual(ov.servos.map(s => s.ch), [1, 5, 9, 17]) // ch2 disabled skipped
    assert.equal(ov.servos[0].funcName, 'Motor1')
    assert.equal(ov.servos[0].pwm, 1500)
    assert.equal(ov.servos[0].reversed, true)
    assert.equal(ov.servos[1].pwm, null) // no servo5Raw
    assert.equal(ov.servos[2].funcName, 'Function 12345') // fallback
    assert.equal(ov.servos[2].pwm, 1600)
    assert.equal(ov.servos[3].pwm, null) // ch > 16

    // CAN
    assert.deepEqual(ov.can.ports.map(p => p.n), [1, 2])
    assert.equal(ov.can.ports[1].bitrate, null)
    assert.equal(ov.can.drivers[0].protocolName, 'DroneCAN')
    assert.equal(ov.can.drivers[1].protocolName, 'Protocol 555')

    // NET
    assert.equal(ov.net.present, true)
    assert.equal(ov.net.ip, '192.168.144.14')
    assert.equal(ov.net.gateway, null) // incomplete quad
    assert.equal(ov.net.ports[0].typeName, 'UDP Client')
    assert.equal(ov.net.ports[0].protocolName, 'MAVLink2')
    assert.equal(ov.net.ports[0].ip, '192.168.144.10')
    assert.equal(ov.net.ports[1].protocolName, null) // no protocol param
    assert.equal(ov.net.ports[1].ip, null)
    assert.equal(ov.net.ports[1].port, null)
  })

  it('overview is empty/safe with no params and no telemetry (servoPwm without SERVO_OUTPUT_RAW)', function () {
    const fc = new FCParams({}, fakeTelem([]))
    setParams(fc, { SERVO1_FUNCTION: 33 })
    const ov = fc.getOverview()
    assert.deepEqual(ov.sensors, [])
    assert.equal(ov.servos[0].pwm, null) // no SERVO_OUTPUT_RAW telemetry
    assert.deepEqual(ov.serial, [])
    assert.deepEqual(ov.can.ports, [])
    assert.deepEqual(ov.can.drivers, [])
    assert.equal(ov.net.present, false)
    assert.equal(ov.net.ip, null)
  })

  it('sensor decode tolerates a SYS_STATUS with missing bitmask fields', function () {
    const fc = new FCParams({}, fakeTelem([{ name: 'SYS_STATUS', fields: {} }]))
    const ov = fc.getOverview()
    assert.deepEqual(ov.sensors, []) // NaN bitmasks → 0 → no sensors present
  })
})
