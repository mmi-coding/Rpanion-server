const assert = require('assert')
const fs = require('fs')
const sinon = require('sinon')
const settings = require('settings-store')
const FCManagerClass = require('./flightController')
const FCLink = require('./fcLink')
const serialDetection = require('./serialDetection')
const { FakeBin } = require('../test/fakeBin')

// Poll until fn() is true, max `timeout` ms
function waitFor (fn, timeout) {
  const ms = timeout || 2000
  return new Promise(function (resolve, reject) {
    const start = Date.now()
    const poll = function () {
      if (fn()) return resolve()
      if (Date.now() - start > ms) return reject(new Error('waitFor timed out'))
      setTimeout(poll, 10)
    }
    poll()
  })
}

// a fake mavManager the stubbed FCLink.startLink attaches, so orchestration
// (status / fan-out / reboot / options) can be exercised without real processes
function fakeM () {
  return {
    enableDSRequest: false,
    statusNumRxPackets: 5,
    autopilotFromID: () => 'ArduCopter',
    vehicleFromID: () => 'Quadrotor',
    conStatusStr: () => 'Connected',
    statusText: 'ok',
    statusBytesPerSec: { avgBytesSec: 100 },
    fcVersion: '4.5.0',
    sendReboot: sinon.spy(),
    sendParamRequestList: sinon.spy(),
    sendParamRead: sinon.spy(),
    sendBinStreamRequest: sinon.spy(),
    sendBinStreamRequestStop: sinon.spy(),
    sendRTCMMessage: sinon.spy(),
    sendCommandAck: sinon.spy(),
    sendHeartbeat: sinon.spy(),
    sendData: sinon.spy(),
    close: sinon.spy()
  }
}

describe('FCDetails (multi-link orchestrator #311)', function () {
  let fake

  before(function () {
    // fake `which` so validMavlinkRouter() is deterministic (real spawnSync is
    // destructured at import, so it can't be stubbed)
    fake = new FakeBin()
    fake.install('which', [
      'case "$FAKE_SCENARIO" in',
      '  which-empty) exit 1 ;;',
      `  *) echo "${fake.dir}/mavlink-routerd"; exit 0 ;;`,
      'esac'
    ].join('\n'))
    fake.activate()
  })

  after(function () {
    fake.cleanup()
  })

  beforeEach(function () {
    // stub the link lifecycle so no real mavlink-routerd / mavManager spawns
    sinon.stub(FCLink.prototype, 'startLink').callsFake(function (cb) {
      this.active = true
      // mirror the real link: only build a mavManager on a fresh link, reuse on restart
      if (this.m === null) { this.m = fakeM() }
      cb(null, true)
    })
    sinon.stub(FCLink.prototype, 'startInterval')
    sinon.stub(FCLink.prototype, 'closeLink').callsFake(function (cb) { this.active = false; cb(null) })
    sinon.stub(FCLink.prototype, 'destroy').callsFake(function (cb) { this.m = null; cb() })
  })

  afterEach(function () {
    sinon.restore()
    delete process.env.FAKE_SCENARIO
  })

  // helper: add a link synchronously (startLink stub calls back immediately)
  function addUART (FC, serial, baud) {
    FC.serialDevices.push({ value: serial, label: serial, path: serial, pnpId: '1' })
    let result
    FC.addLink('UART', serial, baud || 115200, 2, 9000, (err, links) => { result = { err, links } })
    return result
  }

  it('#fcinit() - empty by default', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    assert.equal(FC.links.length, 0)
    assert.equal(FC.getSystemStatus().conStatus, 'Not connected')
    assert.deepEqual(FC.getAllStatus().links, [])
    assert.equal(FC.binlog, null)
  })

  it('#nextSlot() - returns the lowest free slot', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    assert.equal(FC.nextSlot(), 0)
    addUART(FC, '/dev/ttyS0')
    assert.equal(FC.links.length, 1)
    assert.equal(FC.nextSlot(), 1)
  })

  it('#addLink() - UART success then duplicate is rejected', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    const r = addUART(FC, '/dev/ttyS0')
    assert.equal(r.err, null)
    assert.equal(FC.links.length, 1)
    assert.equal(FC.links[0].device.serial, '/dev/ttyS0')
    // duplicate
    let dup
    FC.addLink('UART', '/dev/ttyS0', 115200, 2, 9000, (err) => { dup = err })
    assert.ok(dup)
    assert.equal(FC.links.length, 1)
  })

  it('#addLink() - UDP success', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    let res
    FC.addLink('UDP', null, 0, 2, 9000, (err, links) => { res = { err, links } })
    assert.equal(res.err, null)
    assert.equal(FC.links.length, 1)
    assert.equal(FC.links[0].device.inputType, 'UDP')
    // duplicate UDP port rejected
    let dup
    FC.addLink('UDP', null, 0, 2, 9000, (err) => { dup = err })
    assert.ok(dup)
  })

  it('#addLink() - bad serial/baud returns error', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    let res
    FC.addLink('UART', '/dev/nope', 115200, 2, 9000, (err) => { res = err })
    assert.ok(res)
    assert.equal(FC.links.length, 0)
  })

  it('#addLink() - unknown input type returns error', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    let res
    FC.addLink('SPI', null, 0, 2, 9000, (err) => { res = err })
    assert.ok(res)
  })

  it('#addLink() - rejects beyond MAX_LINKS', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    addUART(FC, '/dev/ttyS0')
    addUART(FC, '/dev/ttyS1')
    addUART(FC, '/dev/ttyS2')
    addUART(FC, '/dev/ttyS3')
    assert.equal(FC.links.length, 4)
    let res
    FC.serialDevices.push({ value: '/dev/ttyS4', label: '/dev/ttyS4' })
    FC.addLink('UART', '/dev/ttyS4', 115200, 2, 9000, (err) => { res = err })
    assert.ok(res)
    assert.equal(FC.links.length, 4)
  })

  it('#addLink() - startLink failure is surfaced and the link not kept', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    FCLink.prototype.startLink.restore()
    sinon.stub(FCLink.prototype, 'startLink').callsFake(function (cb) { cb('boom', false) })
    let res
    FC.addLink('UDP', null, 0, 2, 9000, (err) => { res = err })
    assert.equal(res, 'boom')
    assert.equal(FC.links.length, 0)
  })

  it('#removeLink() - removes by id, and errors on unknown id', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    addUART(FC, '/dev/ttyS0')
    const id = FC.links[0].id
    let res
    FC.removeLink(id, (err, links) => { res = { err, links } })
    assert.equal(res.err, null)
    assert.equal(FC.links.length, 0)
    let missing
    FC.removeLink(99, (err) => { missing = err })
    assert.ok(missing)
  })

  it('#validateDevice() - all branches', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    FC.serialDevices.push({ value: '/dev/ttyS0', label: '/dev/ttyS0' })
    assert.ok(FC.validateDevice('UART', '/dev/ttyS0', 115200, 2, 9000).device)
    assert.ok(FC.validateDevice('UART', '/dev/bad', 115200, 2, 9000).error)
    assert.ok(FC.validateDevice('UART', '/dev/ttyS0', 999, 2, 9000).error)
    assert.ok(FC.validateDevice('UART', '/dev/ttyS0', 115200, null, 9000).error)
    assert.ok(FC.validateDevice('UDP', null, 0, 2, 9000).device)
    assert.ok(FC.validateDevice('SPI', null, 0, 2, 9000).error)
  })

  it('#isDuplicate() - UART, UDP and non-duplicate', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    addUART(FC, '/dev/ttyS0')
    assert.equal(FC.isDuplicate({ inputType: 'UART', serial: '/dev/ttyS0' }), true)
    assert.equal(FC.isDuplicate({ inputType: 'UART', serial: '/dev/ttyS1' }), false)
    FC.addLink('UDP', null, 0, 2, 9000, () => {})
    assert.equal(FC.isDuplicate({ inputType: 'UDP', udpInputPort: 9000 }), true)
    assert.equal(FC.isDuplicate({ inputType: 'UDP', udpInputPort: 9001 }), false)
  })

  it('#getUDPOutputs / add / remove', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    assert.equal(FC.getUDPOutputs().length, 0)
    FC.addUDPOutput('127.0.0.1', 15000)
    assert.equal(FC.getUDPOutputs().length, 1)
    FC.addUDPOutput('127.0.0.1', 15000) // dup
    assert.equal(FC.getUDPOutputs().length, 1)
    FC.addUDPOutput('127.0.0.1', 14540) // internal blocked
    assert.equal(FC.getUDPOutputs().length, 1)
    FC.addUDPOutput('127.0.0.1', 15001)
    assert.equal(FC.getUDPOutputs().length, 2)
    FC.removeUDPOutput('127.0.0.1', 14540) // internal blocked
    assert.equal(FC.getUDPOutputs().length, 2)
    FC.removeUDPOutput('127.0.0.1', 15001)
    assert.equal(FC.getUDPOutputs().length, 1)
    FC.removeUDPOutput('127.0.0.1', 19999) // not present
    assert.equal(FC.getUDPOutputs().length, 1)
  })

  it('#addUDPOutput / removeUDPOutput - restart running links', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    addUART(FC, '/dev/ttyS0')
    // restartAllLinks bounces each link's router (close then start)
    FC.addUDPOutput('10.0.0.1', 15600)
    assert.ok(FCLink.prototype.closeLink.called)
    FC.removeUDPOutput('10.0.0.1', 15600)
  })

  it('#restartAllLinks() - logs a restart failure', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    addUART(FC, '/dev/ttyS0')
    // make the restart's startLink fail → the error-log branch runs (no throw)
    FCLink.prototype.startLink.restore()
    sinon.stub(FCLink.prototype, 'startLink').callsFake(function (cb) { cb('restart fail', false) })
    assert.doesNotThrow(() => FC.restartAllLinks())
  })

  it('#saveSerialSettings() - logs when the settings store throws', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    sinon.stub(settings, 'setValue').throws(new Error('disk full'))
    assert.doesNotThrow(() => FC.saveSerialSettings())
  })

  it('#getAllStatus() / #getSystemStatus() - primary at top level + per-link array', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    addUART(FC, '/dev/ttyS0')
    const all = FC.getAllStatus()
    assert.equal(all.conStatus, 'Connected') // primary spread at top level
    assert.equal(all.links.length, 1)
    assert.equal(all.links[0].FW, 'ArduCopter')
    assert.equal(FC.getSystemStatus().conStatus, 'Connected')
    // binlog getter with a link present (primary link's binlog, here null)
    assert.equal(FC.binlog, null)
  })

  it('#rebootFC() - reboots every connected vehicle', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    addUART(FC, '/dev/ttyS0')
    FC.rebootFC()
    assert.ok(FC.links[0].m.sendReboot.calledOnce)
  })

  it('#startBinLogging / #stopBinLogging - primary link', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    // no links → no throw
    FC.startBinLogging()
    FC.stopBinLogging()
    addUART(FC, '/dev/ttyS0')
    FC.startBinLogging()
    FC.stopBinLogging()
    assert.ok(FC.links[0].m.sendBinStreamRequest.calledOnce)
    assert.ok(FC.links[0].m.sendBinStreamRequestStop.calledOnce)
  })

  it('#requestParams / #requestParam - primary link only', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    // no links → false / safe no-op
    assert.equal(FC.requestParams(), false)
    FC.requestParam(3)
    addUART(FC, '/dev/ttyS0')
    assert.equal(FC.requestParams(), true)
    FC.requestParam(5)
    assert.ok(FC.links[0].m.sendParamRequestList.calledOnce)
    assert.ok(FC.links[0].m.sendParamRead.calledWith(5))
    // link present but mavManager not yet up → false / safe no-op
    FC.links[0].m = null
    assert.equal(FC.requestParams(), false)
    FC.requestParam(9)
  })

  it('MAVLink fan-out - RTCM / commandAck / heartbeat / data reach every link', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    // no links → safe no-ops
    FC.sendRTCMMessage({}, 0)
    FC.sendCommandAck(203, 0, 1, 1, 1)
    FC.sendHeartbeat(1, 1, 1)
    FC.sendData({}, 1)
    addUART(FC, '/dev/ttyS0')
    addUART(FC, '/dev/ttyS1')
    FC.sendRTCMMessage({ buf: 1 }, 3)
    FC.sendCommandAck(203, 0, 1, 1, 1)
    FC.sendHeartbeat(1, 1, 1)
    FC.sendData({ x: 1 }, 1)
    for (const link of FC.links) {
      assert.ok(link.m.sendRTCMMessage.calledOnce)
      assert.ok(link.m.sendCommandAck.calledOnce)
      assert.ok(link.m.sendHeartbeat.calledOnce)
      assert.ok(link.m.sendData.calledOnce)
    }
  })

  it('#setGlobalOptions() - updates options, links and restarts', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    addUART(FC, '/dev/ttyS0')
    let done = false
    FC.setGlobalOptions(true, true, false, 14551, true, false, () => { done = true })
    assert.equal(done, true)
    assert.equal(FC.enableHeartbeat, true)
    assert.equal(FC.enableTCP, true)
    assert.equal(FC.UDPBPort, 14551)
    assert.equal(FC.links[0].m.enableDSRequest, true)
    assert.ok(FCLink.prototype.closeLink.called) // restartAllLinks
  })

  it('#validMavlinkRouter() - which empty, parentDir fallback found', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    process.env.FAKE_SCENARIO = 'which-empty'
    sinon.stub(fs, 'existsSync').returns(true)
    assert.equal(FC.validMavlinkRouter(), true)
    assert.ok(FC.mavlinkRouterPath.includes('mavlink-routerd'))
  })

  it('#validMavlinkRouter() - which empty, parentDir not found', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    process.env.FAKE_SCENARIO = 'which-empty'
    sinon.stub(fs, 'existsSync').returns(false)
    assert.equal(FC.validMavlinkRouter(), false)
    assert.equal(FC.mavlinkRouterPath, null)
  })

  it('#validMavlinkRouter() - which finds it on PATH', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    assert.equal(FC.validMavlinkRouter(), true)
    assert.ok(FC.mavlinkRouterPath.includes('mavlink-routerd'))
  })

  it('#checkSerialPortIssues() - ModemManager installed', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    sinon.stub(serialDetection, 'isModemManagerInstalled').returns(true)
    assert.ok(FC.checkSerialPortIssues().message.includes('ModemManager'))
  })

  it('#checkSerialPortIssues() - Pi with serial console', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    sinon.stub(serialDetection, 'isModemManagerInstalled').returns(false)
    sinon.stub(serialDetection, 'isPi').returns(true)
    sinon.stub(fs, 'existsSync').returns(true)
    sinon.stub(fs, 'readFileSync').returns('console=serial0,115200 root=/dev/mmcblk0p2')
    assert.ok(FC.checkSerialPortIssues().message.includes('Serial console'))
  })

  it('#checkSerialPortIssues() - Pi without serial console', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    sinon.stub(serialDetection, 'isModemManagerInstalled').returns(false)
    sinon.stub(serialDetection, 'isPi').returns(true)
    sinon.stub(fs, 'existsSync').returns(true)
    sinon.stub(fs, 'readFileSync').returns('root=/dev/mmcblk0p2')
    assert.equal(FC.checkSerialPortIssues(), null)
  })

  it('#checkSerialPortIssues() - not a Pi', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    sinon.stub(serialDetection, 'isModemManagerInstalled').returns(false)
    sinon.stub(serialDetection, 'isPi').returns(false)
    assert.equal(FC.checkSerialPortIssues(), null)
  })

  it('#getDeviceSettings() - returns ports, options and the links list', function (done) {
    settings.clear()
    const FC = new FCManagerClass(settings)
    sinon.stub(serialDetection, 'detectSerialDevices').resolves([{ value: '/dev/ttyS0', label: '/dev/ttyS0' }])
    sinon.stub(serialDetection, 'isModemManagerInstalled').returns(false)
    addUART(FC, '/dev/ttyS0')
    FC.getDeviceSettings((err, data) => {
      try {
        assert.equal(err, null)
        assert.equal(data.serialPorts.length, 1)
        assert.equal(data.baudRates.length, 12)
        assert.equal(data.mavVersions.length, 2)
        assert.equal(data.inputTypes.length, 2)
        assert.equal(data.links.length, 1)
        assert.equal(data.links[0].inputType, 'UART')
        assert.equal(data.enableUDPB, true)
        done()
      } catch (e) { done(e) }
    })
  })

  it('constructor - migrates a legacy single active device into one link', function (done) {
    settings.clear()
    settings.setValue('flightcontroller.activeDevice', { inputType: 'UART', serial: '/dev/ttyS0', baud: 115200, mavversion: 2, udpInputPort: 9000 })
    settings.setValue('flightcontroller.active', true)
    sinon.stub(serialDetection, 'detectSerialDevices').resolves([{ value: '/dev/ttyS0', label: '/dev/ttyS0' }])
    sinon.stub(serialDetection, 'isModemManagerInstalled').returns(false)
    const FC = new FCManagerClass(settings)
    waitFor(() => FC.links.length === 1).then(() => {
      try {
        assert.equal(FC.links[0].device.serial, '/dev/ttyS0')
        done()
      } catch (e) { done(e) }
    }).catch(done)
  })

  it('constructor - restores saved links, skipping an absent UART port', function (done) {
    settings.clear()
    settings.setValue('flightcontroller.links', [
      { inputType: 'UART', serial: '/dev/present', baud: 115200, mavversion: 2, udpInputPort: 9000 },
      { inputType: 'UART', serial: '/dev/absent', baud: 115200, mavversion: 2, udpInputPort: 9000 },
      { inputType: 'UDP', serial: null, baud: null, mavversion: 2, udpInputPort: 9001 }
    ])
    sinon.stub(serialDetection, 'detectSerialDevices').resolves([{ value: '/dev/present', label: '/dev/present' }])
    sinon.stub(serialDetection, 'isModemManagerInstalled').returns(false)
    const FC = new FCManagerClass(settings)
    waitFor(() => FC.links.length === 2).then(() => {
      try {
        // the absent UART is skipped; present UART + UDP remain
        const labels = FC.links.map((l) => l.device.serial)
        assert.ok(labels.indexOf('/dev/present') !== -1)
        assert.ok(labels.indexOf('/dev/absent') === -1)
        done()
      } catch (e) { done(e) }
    }).catch(done)
  })

  it('constructor - restore start failure is logged, link not kept', function (done) {
    settings.clear()
    settings.setValue('flightcontroller.links', [{ inputType: 'UDP', serial: null, baud: null, mavversion: 2, udpInputPort: 9000 }])
    sinon.stub(serialDetection, 'detectSerialDevices').resolves([])
    sinon.stub(serialDetection, 'isModemManagerInstalled').returns(false)
    FCLink.prototype.startLink.restore()
    sinon.stub(FCLink.prototype, 'startLink').callsFake(function (cb) { cb('nope', false) })
    const FC = new FCManagerClass(settings)
    // give the async restore a tick, then assert nothing was kept
    setTimeout(() => {
      try { assert.equal(FC.links.length, 0); done() } catch (e) { done(e) }
    }, 100)
  })
})
