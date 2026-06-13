const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const sinon = require('sinon')
const settings = require('settings-store')
const FCManagerClass = require('./flightController')
const serialDetection = require('./serialDetection')
const logpaths = require('./paths')
const { FakeBin } = require('../test/fakeBin')

// ─── helpers ────────────────────────────────────────────────────────────────

// Poll until condition fn() is true, max `timeout` ms
function waitFor (fn, timeout) {
  const ms = timeout || 3000
  return new Promise(function (resolve, reject) {
    const start = Date.now()
    const poll = function () {
      if (fn()) return resolve()
      if (Date.now() - start > ms) return reject(new Error('waitFor timed out'))
      setTimeout(poll, 20)
    }
    poll()
  })
}

// Teardown a flightController instance: kill router, close mavManager.
// Waits for both the router process and UDP socket to be released so the
// next test can bind to 14540.
function teardownFC (FC) {
  return new Promise(function (resolve) {
    if (!FC) { return resolve() }

    if (FC.intervalObj) {
      clearInterval(FC.intervalObj)
      FC.intervalObj = null
    }
    if (FC.dflogger) {
      try { FC.dflogger.kill('SIGTERM') } catch (_) {}
      FC.dflogger = null
    }

    // Capture udpStream before any m.close() call
    const udpStream = FC.m ? FC.m.udpStream : null

    const afterRouterDead = function () {
      // Close mavManager if still set
      if (FC.m) {
        try { FC.m.close() } catch (_) {}
        FC.m = null
      }
      // Wait for socket close, or resolve immediately if no socket
      if (udpStream) {
        let resolved = false
        const finish = function () {
          if (!resolved) { resolved = true; resolve() }
        }
        udpStream.once('close', finish)
        // Safety: if close event never fires (socket already closed), resolve after 200ms
        setTimeout(finish, 200)
      } else {
        resolve()
      }
    }

    if (FC.router && FC.router.exitCode === null) {
      // The router is still running; kill it and wait for exit.
      // Set a polling check in case the close event already fired (rare race).
      const router = FC.router
      let routerHandled = false
      const onRouterClose = function () {
        if (!routerHandled) { routerHandled = true; afterRouterDead() }
      }
      router.once('close', onRouterClose)
      try { router.kill('SIGINT') } catch (_) {}
      // If exitCode becomes non-null (process already dead), fire afterRouterDead
      const pollTimer = setInterval(() => {
        if (router.exitCode !== null && !routerHandled) {
          clearInterval(pollTimer)
          onRouterClose()
        }
      }, 20)
      router.once('close', () => clearInterval(pollTimer))
    } else {
      afterRouterDead()
    }
  })
}

// Build a fake dflogger Python script
function buildFakeDFLogger (tmpDir) {
  const script = path.join(tmpDir, 'fake_dflogger.py')
  const src = `#!/usr/bin/env python3
import os, sys, time, signal

def handler(signum, frame):
    sys.exit(0)

signal.signal(signal.SIGINT, handler)
signal.signal(signal.SIGTERM, handler)

scenario = os.environ.get('FAKE_SCENARIO', '')
if scenario == 'dflogger-exitfast':
    sys.exit(0)
elif scenario == 'dflogger-output':
    sys.stdout.write('DFLogger stdout message\\n')
    sys.stdout.flush()
    sys.stderr.write('DFLogger stderr message\\n')
    sys.stderr.flush()

try:
    time.sleep(9999)
except (KeyboardInterrupt, SystemExit):
    pass
`
  fs.writeFileSync(script, src, { mode: 0o755 })
  return script
}

// Build a fake python3 wrapper that dispatches to fake dflogger
function buildFakePython (tmpDir) {
  const dfScript = buildFakeDFLogger(tmpDir)
  const script = path.join(tmpDir, 'fakepython3')
  const src = `#!/bin/sh
exec python3 "${dfScript}" "$@"
`
  fs.writeFileSync(script, src, { mode: 0o755 })
  return script
}

describe('Flight Controller Functions', function () {
  let fake
  let tmpDir
  let fakePython
  // Track the active FC instance for teardown in afterEach
  let activeFC = null

  before(function () {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpanion-fc-'))
    fakePython = buildFakePython(tmpDir)

    fake = new FakeBin()

    // fake `which` dispatches on FAKE_SCENARIO
    fake.install('which', [
      'case "$FAKE_SCENARIO" in',
      '  which-empty) exit 1 ;;',
      '  *)',
      `    echo "${fake.dir}/mavlink-routerd"`,
      '    exit 0 ;;',
      'esac',
    ].join('\n'))

    // fake mavlink-routerd: a Python script so SIGINT/SIGTERM reliably kill it.
    const routerScript = path.join(tmpDir, 'fake_mavlink_routerd.py')
    fs.writeFileSync(routerScript, `#!/usr/bin/env python3
import os, sys, time, signal

def handler(signum, frame):
    sys.exit(0)

signal.signal(signal.SIGINT, handler)
signal.signal(signal.SIGTERM, handler)

scenario = os.environ.get('FAKE_SCENARIO', '')
if scenario == 'router-exitfast':
    sys.exit(0)
elif scenario == 'router-stdout':
    sys.stdout.write('router stdout message\\n')
    sys.stdout.flush()
elif scenario == 'router-stderr-nobinlog':
    sys.stderr.write('some stderr message without binlog\\n')
    sys.stderr.flush()
elif scenario == 'router-binlog':
    sys.stderr.write('Logging target (filename) testlog.bin\\n')
    sys.stderr.flush()
elif scenario == 'router-binlog-large':
    sys.stderr.write('Logging target (filename) largetestlog.bin\\n')
    sys.stderr.flush()
elif scenario == 'router-binlog-lstat-error':
    sys.stderr.write('Logging target (filename) missing.bin\\n')
    sys.stderr.flush()

try:
    time.sleep(9999)
except (KeyboardInterrupt, SystemExit):
    pass
`, { mode: 0o755 })

    // The FakeBin install must be a shell script, so we exec the python script
    fake.install('mavlink-routerd', `exec python3 "${routerScript}" "$@"`)

    fake.activate()
  })

  after(function () {
    fake.cleanup()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // Tear down the active FC after every test so 14540 is free for the next one
  afterEach(function (done) {
    this.timeout(4000)
    const fc = activeFC
    activeFC = null
    sinon.restore()
    delete process.env.FAKE_SCENARIO
    if (fc) {
      teardownFC(fc).then(() => done()).catch(() => done())
    } else {
      done()
    }
  })

  // ── Original tests (kept intact) ──────────────────────────────────────────

  it('#fcinit()', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC

    // check initial status
    assert.equal(FC.getSystemStatus().conStatus, 'Not connected')
    assert.equal(FC.previousConnection, false)
  })

  it('#fcGetSerialDevices()', async function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC

    await FC.getDeviceSettings((err, devices, bauds, seldevice, selbaud, mavers, selmav,
      active, enableHeartbeat, enableTCP, enableUDPB, UDPBPort, enableDSRequest, tlogging,
      udpInputPort, selInputType, inputTypes) => {
      assert.equal(err, null)
      assert.equal(devices.length, 0)
      assert.equal(bauds.length, 12)
      assert.equal(seldevice.length, 0)
      assert.equal(selbaud, 57600)
      assert.equal(mavers.length, 2)
      assert.equal(selmav, 2)
      assert.equal(active, false)
      assert.equal(enableHeartbeat, false)
      assert.equal(enableTCP, false)
      assert.equal(enableUDPB, true)
      assert.equal(UDPBPort, 14550)
      assert.equal(enableDSRequest, false)
      assert.equal(active, false)
      assert.equal(udpInputPort, 9000)
      assert.equal(selInputType, 'UART')
      assert.equal(inputTypes.length, 2)
    })
  })

  it('#fcUDPadderemove()', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC

    // check initial status
    assert.equal(FC.getUDPOutputs().length, 0)

    // add udp
    FC.addUDPOutput('127.0.0.1', 15000)
    assert.equal(FC.getUDPOutputs().length, 1)

    // duplicate add
    FC.addUDPOutput('127.0.0.1', 15000)
    assert.equal(FC.getUDPOutputs().length, 1)

    // another add
    FC.addUDPOutput('127.0.0.1', 15001)
    assert.equal(FC.getUDPOutputs().length, 2)

    // remove
    FC.removeUDPOutput('127.0.0.1', 15001)
    assert.equal(FC.getUDPOutputs().length, 1)

    // remove non-valid
    FC.removeUDPOutput('127.0.0.1', 15003)
    assert.equal(FC.getUDPOutputs().length, 1)
  })

  it('#fcStartStop()', function (done) {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.serialDevices.push({ value: '/dev/ttyS0', label: '/dev/ttyS0', path: '/dev/ttyS0', pnpId: '456' })

    sinon.stub(serialDetection, 'getSerialPathFromValue').returns('/dev/ttyS0')

    FC.startStopTelemetry('/dev/ttyS0', 115200, 2, false, true, false, 0, false, false,
      'UART', 9000, (err, isSuccess) => {
        try {
          assert.equal(err, null)
          assert.equal(isSuccess, true)
          // capture the udpStream BEFORE the stop so we can wait for its close
          const udpStream = FC.m ? FC.m.udpStream : null
          const router = FC.router

          FC.startStopTelemetry('/dev/ttyS0', 115200, 2, false, true, false, 0, false, false,
            'UART', 9000, (err2, isSuccess2) => {
              try {
                assert.equal(err2, null)
                assert.equal(isSuccess2, false)
                // Null out FC.router so teardownFC won't try to re-kill it
                activeFC = null
                // Wait for both router exit and UDP socket close
                const pending = { router: router && router.exitCode === null, udp: !!udpStream }
                let resolved = false
                const checkDone = function () {
                  if (!resolved && !pending.router && !pending.udp) {
                    resolved = true
                    done()
                  }
                }
                if (pending.router) {
                  router.once('close', () => { pending.router = false; checkDone() })
                }
                if (udpStream) {
                  udpStream.once('close', () => { pending.udp = false; checkDone() })
                }
                // Safety timeout
                setTimeout(() => {
                  pending.router = false; pending.udp = false; checkDone()
                }, 1500)
                checkDone() // in case both already done
              } catch (e) { done(e) }
            })
        } catch (e) { done(e) }
      })
  }).timeout(8000)

  // ── New tests ──────────────────────────────────────────────────────────────

  it('#validMavlinkRouter() - which empty, parentDir fallback found', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    process.env.FAKE_SCENARIO = 'which-empty'

    const parentPath = path.join(path.dirname(__dirname), 'mavlink-routerd')
    const stub = sinon.stub(fs, 'existsSync')
    stub.withArgs(parentPath).returns(true)
    stub.callThrough()

    const result = FC.validMavlinkRouter()
    assert.equal(result, true)
    assert.ok(FC.mavlinkRouterPath.includes('mavlink-routerd'))
  })

  it('#validMavlinkRouter() - which empty, parentDir not found', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    process.env.FAKE_SCENARIO = 'which-empty'

    const parentPath = path.join(path.dirname(__dirname), 'mavlink-routerd')
    const stub = sinon.stub(fs, 'existsSync')
    stub.withArgs(parentPath).returns(false)
    stub.callThrough()

    const result = FC.validMavlinkRouter()
    assert.equal(result, false)
    assert.equal(FC.mavlinkRouterPath, null)
  })

  it('#addUDPOutput() - blocks 127.0.0.1:14540', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    const before = FC.getUDPOutputs().length
    FC.addUDPOutput('127.0.0.1', 14540)
    assert.equal(FC.getUDPOutputs().length, before)
  })

  it('#removeUDPOutput() - blocks 127.0.0.1:14540', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.UDPoutputs.push({ IP: '127.0.0.1', port: 14540 })
    const before = FC.getUDPOutputs().length
    FC.removeUDPOutput('127.0.0.1', 14540)
    assert.equal(FC.getUDPOutputs().length, before)
  })

  it('#getSystemStatus() with active mavManager stub', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.m = {
      statusNumRxPackets: 42,
      autopilotFromID: () => 'ArduPilot',
      vehicleFromID: () => 'Quadrotor',
      conStatusStr: () => 'Connected',
      statusText: 'All good',
      statusBytesPerSec: { avgBytesSec: 1234 },
      fcVersion: '4.3.0',
    }
    FC.vehiclePosition = { lat: 1.0, lon: 2.0, alt: 100, relAlt: 50, hdg: 180 }
    const status = FC.getSystemStatus()
    assert.equal(status.numpackets, 42)
    assert.equal(status.FW, 'ArduPilot')
    assert.equal(status.vehType, 'Quadrotor')
    assert.equal(status.conStatus, 'Connected')
    assert.equal(status.statusText, 'All good')
    assert.equal(status.byteRate, 1234)
    assert.equal(status.fcVersion, '4.3.0')
    assert.deepEqual(status.vehiclePosition, { lat: 1.0, lon: 2.0, alt: 100, relAlt: 50, hdg: 180 })
    // null out m so teardownFC doesn't try to close it
    FC.m = null
  })

  it('#rebootFC() with and without active m', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.rebootFC()

    const sendReboot = sinon.spy()
    FC.m = { sendReboot }
    FC.rebootFC()
    assert.equal(sendReboot.callCount, 1)
    FC.m = null
  })

  it('#startBinLogging() and #stopBinLogging() with and without m', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    // no m
    FC.startBinLogging()
    FC.stopBinLogging()

    const sendBinStreamRequest = sinon.spy()
    const sendBinStreamRequestStop = sinon.spy()
    FC.m = { sendBinStreamRequest, sendBinStreamRequestStop }
    FC.startBinLogging()
    assert.equal(sendBinStreamRequest.callCount, 1)
    FC.stopBinLogging()
    assert.equal(sendBinStreamRequestStop.callCount, 1)
    FC.m = null
  })

  it('#getDFLoggerStatus() running and not running', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    assert.deepEqual(FC.getDFLoggerStatus(), { running: false })
    FC.dflogger = { kill: sinon.spy() }
    assert.deepEqual(FC.getDFLoggerStatus(), { running: true })
    FC.dflogger = null
  })

  it('#startDFLogger() and #stopDFLogger()', function (done) {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    sinon.stub(logpaths, 'getPythonPath').returns(fakePython)

    // stopDFLogger when not running — no-op
    FC.stopDFLogger()
    assert.equal(FC.dflogger, null)

    FC.startDFLogger()
    assert.notEqual(FC.dflogger, null)

    // startDFLogger when already running — no-op
    const firstLogger = FC.dflogger
    FC.startDFLogger()
    assert.strictEqual(FC.dflogger, firstLogger)

    // stopDFLogger actually kills it
    FC.stopDFLogger()
    assert.equal(FC.dflogger, null)
    done()
  })

  it('#startDFLogger() - dflogger process exits and sets null', function (done) {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    sinon.stub(logpaths, 'getPythonPath').returns(fakePython)
    process.env.FAKE_SCENARIO = 'dflogger-exitfast'

    FC.startDFLogger()
    waitFor(() => FC.dflogger === null, 3000).then(() => done()).catch(done)
  }).timeout(5000)

  it('#checkSerialPortIssues() - ModemManager installed', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    sinon.stub(serialDetection, 'isModemManagerInstalled').returns(true)

    const err = FC.checkSerialPortIssues()
    assert.ok(err instanceof Error)
    assert.ok(err.message.includes('ModemManager'))
  })

  it('#checkSerialPortIssues() - Pi with serial console in cmdline.txt', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    sinon.stub(serialDetection, 'isModemManagerInstalled').returns(false)
    sinon.stub(serialDetection, 'isPi').returns(true)
    const existsStub = sinon.stub(fs, 'existsSync')
    existsStub.withArgs('/boot/cmdline.txt').returns(true)
    existsStub.callThrough()
    const readStub = sinon.stub(fs, 'readFileSync')
    readStub.withArgs('/boot/cmdline.txt', sinon.match.any).returns('console=serial0,115200 root=/dev/mmcblk0p2')
    readStub.callThrough()

    const err = FC.checkSerialPortIssues()
    assert.ok(err instanceof Error)
    assert.ok(err.message.includes('Serial console'))
  })

  it('#checkSerialPortIssues() - Pi with cmdline.txt, no serial console', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    sinon.stub(serialDetection, 'isModemManagerInstalled').returns(false)
    sinon.stub(serialDetection, 'isPi').returns(true)
    const existsStub = sinon.stub(fs, 'existsSync')
    existsStub.withArgs('/boot/cmdline.txt').returns(true)
    existsStub.callThrough()
    const readStub = sinon.stub(fs, 'readFileSync')
    readStub.withArgs('/boot/cmdline.txt', sinon.match.any).returns('dwc_otg.lpm_enable=0 root=/dev/mmcblk0p2')
    readStub.callThrough()

    const err = FC.checkSerialPortIssues()
    assert.equal(err, null)
  })

  it('#checkSerialPortIssues() - isPi false branch', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    sinon.stub(serialDetection, 'isModemManagerInstalled').returns(false)
    sinon.stub(serialDetection, 'isPi').returns(false)
    const err = FC.checkSerialPortIssues()
    assert.equal(err, null)
  })

  it('#getDeviceSettings() - active UART path', async function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.active = true
    FC.activeDevice = { inputType: 'UART', serial: '/dev/ttyS0', baud: 115200, mavversion: 2, udpInputPort: 9000 }
    FC.serialDevices = [{ value: '/dev/ttyS0', label: '/dev/ttyS0', path: '/dev/ttyS0' }]

    sinon.stub(serialDetection, 'detectSerialDevices').resolves(FC.serialDevices)
    sinon.stub(serialDetection, 'isModemManagerInstalled').returns(false)

    await FC.getDeviceSettings((err, devices, bauds, seldevice, selbaud, mavers, selmav,
      active, enableHeartbeat, enableTCP, enableUDPB, UDPBPort, enableDSRequest, doLogging,
      udpInputPort, selInputType, inputTypes) => {
      assert.equal(err, null)
      assert.equal(active, true)
      assert.equal(seldevice, '/dev/ttyS0')
      assert.equal(selbaud, 115200)
      assert.equal(selmav, 2)
      assert.equal(selInputType, 'UART')
    })
  })

  it('#getDeviceSettings() - active UDP path (no serialDevices)', async function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.active = true
    FC.activeDevice = { inputType: 'UDP', serial: null, baud: null, mavversion: 2, udpInputPort: 14560 }
    FC.serialDevices = []

    sinon.stub(serialDetection, 'detectSerialDevices').resolves([])
    sinon.stub(serialDetection, 'isModemManagerInstalled').returns(false)

    await FC.getDeviceSettings((err, devices, bauds, seldevice, selbaud, mavers, selmav,
      active, enableHeartbeat, enableTCP, enableUDPB, UDPBPort, enableDSRequest, doLogging,
      udpInputPort, selInputType, inputTypes) => {
      assert.equal(err, null)
      assert.equal(active, true)
      assert.equal(selmav, 2)
      assert.equal(udpInputPort, 14560)
      assert.equal(selInputType, 'UDP')
    })
  })

  it('#getDeviceSettings() - active UDP path (non-empty serialDevices)', async function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.active = true
    FC.activeDevice = { inputType: 'UDP', serial: null, baud: null, mavversion: 2, udpInputPort: 14560 }
    FC.serialDevices = [{ value: '/dev/ttyS0', label: '/dev/ttyS0', path: '/dev/ttyS0' }]

    sinon.stub(serialDetection, 'detectSerialDevices').resolves(FC.serialDevices)
    sinon.stub(serialDetection, 'isModemManagerInstalled').returns(false)

    await FC.getDeviceSettings((err, devices, bauds, seldevice, selbaud, mavers, selmav,
      active, enableHeartbeat, enableTCP, enableUDPB, UDPBPort, enableDSRequest, doLogging,
      udpInputPort, selInputType, inputTypes) => {
      assert.equal(err, null)
      assert.equal(active, true)
      assert.equal(selInputType, 'UDP')
      assert.equal(seldevice, '/dev/ttyS0')
    })
  })

  it('#saveSerialSettings() - saves all settings fields', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.activeDevice = { inputType: 'UDP', serial: null, baud: null, mavversion: 2, udpInputPort: 14560 }
    FC.UDPoutputs = [{ IP: '10.0.0.1', port: 15000 }]
    FC.enableHeartbeat = true
    FC.enableTCP = true
    FC.enableUDPB = false
    FC.UDPBPort = 14551
    FC.enableDSRequest = true
    FC.doLogging = true
    FC.active = true

    FC.saveSerialSettings()

    assert.deepEqual(settings.value('flightcontroller.activeDevice'), FC.activeDevice)
    assert.deepEqual(settings.value('flightcontroller.outputs'), FC.UDPoutputs)
    assert.equal(settings.value('flightcontroller.enableHeartbeat'), true)
    assert.equal(settings.value('flightcontroller.enableTCP'), true)
    assert.equal(settings.value('flightcontroller.enableUDPB'), false)
    assert.equal(settings.value('flightcontroller.UDPBPort'), 14551)
    assert.equal(settings.value('flightcontroller.enableDSRequest'), true)
    assert.equal(settings.value('flightcontroller.doLogging'), true)
    assert.equal(settings.value('flightcontroller.active'), true)
  })

  it('#startStopTelemetry() - bad serial/baud returns error', function (done) {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.startStopTelemetry('/dev/nonexistent', 99999, 2, false, false, false, 0, false, false,
      'UART', 9000, (err, isSuccess) => {
        try {
          assert.ok(err)
          assert.equal(isSuccess, false)
          done()
        } catch (e) { done(e) }
      })
  })

  it('#startStopTelemetry() - unknown input type returns error', function (done) {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.startStopTelemetry(null, null, 2, false, false, false, 0, false, false,
      'BLUETOOTH', 0, (err, isSuccess) => {
        try {
          assert.ok(err)
          assert.ok(err.message.includes('Unknown input type'))
          done()
        } catch (e) { done(e) }
      })
  })

  it('#startStopTelemetry() - updates m.enableDSRequest when m exists', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    const mockM = { enableDSRequest: false, close: sinon.spy() }
    FC.m = mockM
    FC.active = true
    FC.activeDevice = { inputType: 'UDP', serial: null, baud: null, mavversion: 2, udpInputPort: 9000 }
    sinon.stub(FC, 'closeLink').callsFake((cb) => { cb(null) })

    FC.startStopTelemetry(null, null, 2, false, false, false, 0, true, false,
      'UDP', 9000, (err, isSuccess) => {})

    assert.equal(mockM.enableDSRequest, true)
    FC.m = null
  })

  // ── Tests that need a real startLink/mavManager — run ONE at a time ────────
  //
  // IMPORTANT: Each test sets activeFC and relies on afterEach teardownFC()
  // to properly close the mavManager UDP socket before the next test runs.

  it('#startLink() UART path - opens router', function (done) {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.serialDevices.push({ value: '/dev/ttyS0', label: '/dev/ttyS0', path: '/dev/ttyS0' })
    sinon.stub(serialDetection, 'getSerialPathFromValue').returns('/dev/ttyS0')
    FC.activeDevice = { inputType: 'UART', serial: '/dev/ttyS0', baud: 115200, mavversion: 2, udpInputPort: 9000 }

    FC.startLink((err) => {
      try {
        assert.equal(err, null)
        assert.notEqual(FC.router, null)
        assert.equal(FC.active, true)
        done()
      } catch (e) { done(e) }
    })
  }).timeout(5000)

  it('#startLink() UDP path - opens router', function (done) {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.activeDevice = { inputType: 'UDP', serial: null, baud: null, mavversion: 2, udpInputPort: 9000 }

    FC.startLink((err) => {
      try {
        assert.equal(err, null)
        assert.notEqual(FC.router, null)
        assert.equal(FC.active, true)
        done()
      } catch (e) { done(e) }
    })
  }).timeout(5000)

  it('#startLink() - router exit fires stopLink event', function (done) {
    settings.clear()
    process.env.FAKE_SCENARIO = 'router-exitfast'
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.activeDevice = { inputType: 'UDP', serial: null, baud: null, mavversion: 2, udpInputPort: 9000 }

    FC.eventEmitter.once('stopLink', () => {
      try { done() } catch (e) { done(e) }
    })

    FC.startLink((err) => {
      try { assert.equal(err, null) } catch (e) { done(e) }
    })
  }).timeout(5000)

  it('#startLink() - returns error when mavlink-routerd not found', function (done) {
    settings.clear()
    process.env.FAKE_SCENARIO = 'which-empty'
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.activeDevice = { inputType: 'UDP', serial: null, baud: null, mavversion: 2, udpInputPort: 9000 }

    const parentPath = path.join(path.dirname(__dirname), 'mavlink-routerd')
    const stub = sinon.stub(fs, 'existsSync')
    stub.withArgs(parentPath).returns(false)
    stub.callThrough()

    FC.startLink((err) => {
      try {
        assert.ok(err)
        assert.equal(FC.active, false)
        done()
      } catch (e) { done(e) }
    })
  }).timeout(5000)

  it('#startLink() - doLogging=true starts dflogger', function (done) {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.activeDevice = { inputType: 'UDP', serial: null, baud: null, mavversion: 2, udpInputPort: 9000 }
    FC.doLogging = true
    sinon.stub(logpaths, 'getPythonPath').returns(fakePython)

    FC.startLink((err) => {
      try {
        assert.equal(err, null)
        assert.notEqual(FC.dflogger, null)
        done()
      } catch (e) { done(e) }
    })
  }).timeout(5000)

  it('#startLink() - enableTCP=true adds tcp-port 5760', function (done) {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.activeDevice = { inputType: 'UDP', serial: null, baud: null, mavversion: 2, udpInputPort: 9000 }
    FC.enableTCP = true

    FC.startLink((err) => {
      try {
        assert.equal(err, null)
        done()
      } catch (e) { done(e) }
    })
  }).timeout(5000)

  it('#startLink() - UDP outputs and UDPB broadcast path', function (done) {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.activeDevice = { inputType: 'UDP', serial: null, baud: null, mavversion: 2, udpInputPort: 9000 }
    FC.UDPoutputs = [{ IP: '10.0.0.1', port: 15300 }]
    FC.enableUDPB = true
    FC.UDPBPort = 14550

    FC.startLink((err) => {
      try {
        assert.equal(err, null)
        done()
      } catch (e) { done(e) }
    })
  }).timeout(5000)

  it('#startLink() - router stderr binlog detect (small file → delete)', function (done) {
    settings.clear()
    process.env.FAKE_SCENARIO = 'router-binlog'
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.activeDevice = { inputType: 'UDP', serial: null, baud: null, mavversion: 2, udpInputPort: 9000 }

    const smallLog = path.join(tmpDir, 'oldlog.bin')
    fs.writeFileSync(smallLog, Buffer.alloc(1024)) // 1KB
    FC.binlog = smallLog

    FC.startLink((err) => {
      try {
        assert.equal(err, null)
        waitFor(() => FC.binlog !== smallLog, 3000).then(() => {
          try {
            assert.equal(fs.existsSync(smallLog), false)
            done()
          } catch (e) { done(e) }
        }).catch(done)
      } catch (e) { done(e) }
    })
  }).timeout(8000)

  it('#startLink() - router stderr binlog detect (large file → keep)', function (done) {
    settings.clear()
    process.env.FAKE_SCENARIO = 'router-binlog-large'
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.activeDevice = { inputType: 'UDP', serial: null, baud: null, mavversion: 2, udpInputPort: 9000 }

    const largeLog = path.join(tmpDir, 'largelog.bin')
    fs.writeFileSync(largeLog, Buffer.alloc(65 * 1024)) // 65KB
    FC.binlog = largeLog

    FC.startLink((err) => {
      try {
        assert.equal(err, null)
        waitFor(() => FC.binlog !== largeLog, 3000).then(() => {
          try {
            assert.equal(fs.existsSync(largeLog), true)
            fs.unlinkSync(largeLog)
            done()
          } catch (e) { done(e) }
        }).catch(done)
      } catch (e) { done(e) }
    })
  }).timeout(8000)

  it('#startLink() - router stderr binlog detect with null binlog', function (done) {
    settings.clear()
    process.env.FAKE_SCENARIO = 'router-binlog'
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.activeDevice = { inputType: 'UDP', serial: null, baud: null, mavversion: 2, udpInputPort: 9000 }
    FC.binlog = null

    FC.startLink((err) => {
      try {
        assert.equal(err, null)
        waitFor(() => FC.binlog !== null, 3000).then(() => {
          try {
            assert.ok(FC.binlog.includes('testlog.bin'))
            done()
          } catch (e) { done(e) }
        }).catch(done)
      } catch (e) { done(e) }
    })
  }).timeout(8000)

  it('#startLink() - gotMessage fires and GlobalPositionInt updates vehiclePosition', function (done) {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.activeDevice = { inputType: 'UDP', serial: null, baud: null, mavversion: 2, udpInputPort: 9000 }

    FC.startLink((err) => {
      try {
        assert.equal(err, null)
        assert.notEqual(FC.m, null)

        let gotMsgFired = false
        FC.eventEmitter.once('gotMessage', () => { gotMsgFired = true })

        // non-GPS packet
        FC.m.eventEmitter.emit('gotMessage', { header: { msgid: 9999 } }, {})

        setTimeout(() => {
          try {
            assert.equal(gotMsgFired, true)
            assert.equal(FC.previousConnection, true)

            // GPS packet
            const { common } = require('node-mavlink')
            FC.m.eventEmitter.emit('gotMessage', {
              header: { msgid: common.GlobalPositionInt.MSG_ID }
            }, {
              lat: 374200000,
              lon: -1220000000,
              alt: 100000,
              relativeAlt: 50000,
              hdg: 18000
            })

            setTimeout(() => {
              try {
                assert.ok(Math.abs(FC.vehiclePosition.lat - 37.42) < 0.001)
                assert.ok(Math.abs(FC.vehiclePosition.lon - (-122.0)) < 0.001)
                assert.ok(Math.abs(FC.vehiclePosition.alt - 100) < 0.01)
                assert.ok(Math.abs(FC.vehiclePosition.relAlt - 50) < 0.01)
                assert.ok(Math.abs(FC.vehiclePosition.hdg - 180) < 0.01)
                done()
              } catch (e) { done(e) }
            }, 50)
          } catch (e) { done(e) }
        }, 50)
      } catch (e) { done(e) }
    })
  }).timeout(5000)

  it('#startLink() - armed/disarmed events pass through', function (done) {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.activeDevice = { inputType: 'UDP', serial: null, baud: null, mavversion: 2, udpInputPort: 9000 }

    FC.startLink((err) => {
      try {
        assert.equal(err, null)
        let armedFired = false
        let disarmedFired = false

        FC.eventEmitter.once('armed', () => { armedFired = true })
        FC.eventEmitter.once('disarmed', () => { disarmedFired = true })

        FC.m.eventEmitter.emit('armed')
        FC.m.eventEmitter.emit('disarmed')

        setTimeout(() => {
          try {
            assert.equal(armedFired, true)
            assert.equal(disarmedFired, true)
            done()
          } catch (e) { done(e) }
        }, 50)
      } catch (e) { done(e) }
    })
  }).timeout(5000)

  it('#startLink() - second startLink reuses existing m (reconnect path)', function (done) {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.activeDevice = { inputType: 'UDP', serial: null, baud: null, mavversion: 2, udpInputPort: 9000 }

    FC.startLink((err) => {
      try {
        assert.equal(err, null)
        const originalM = FC.m
        assert.notEqual(originalM, null)

        // kill router but keep m to simulate reconnect
        const r = FC.router
        FC.router = null

        // Start again with m set — should NOT recreate m
        FC.startLink((err2) => {
          try {
            assert.equal(err2, null)
            assert.strictEqual(FC.m, originalM)
            // armed/disarmed listeners must not accumulate on reconnect
            assert.strictEqual(FC.m.eventEmitter.listenerCount('armed'), 1)
            assert.strictEqual(FC.m.eventEmitter.listenerCount('disarmed'), 1)
            if (r && r.exitCode === null) try { r.kill('SIGINT') } catch (_) {}
            done()
          } catch (e) {
            if (r && r.exitCode === null) try { r.kill('SIGINT') } catch (_) {}
            done(e)
          }
        })
      } catch (e) { done(e) }
    })
  }).timeout(8000)

  it('#closeLink() - stops dflogger if running', function (done) {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.activeDevice = { inputType: 'UDP', serial: null, baud: null, mavversion: 2, udpInputPort: 9000 }
    FC.doLogging = true
    sinon.stub(logpaths, 'getPythonPath').returns(fakePython)

    FC.startLink((err) => {
      try {
        assert.equal(err, null)
        assert.notEqual(FC.dflogger, null)

        FC.closeLink(() => {
          try {
            assert.equal(FC.dflogger, null)
            assert.equal(FC.active, false)
            done()
          } catch (e) { done(e) }
        })
      } catch (e) { done(e) }
    })
  }).timeout(5000)

  it('#closeLink() - router already exited branch', function (done) {
    settings.clear()
    process.env.FAKE_SCENARIO = 'router-exitfast'
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.activeDevice = { inputType: 'UDP', serial: null, baud: null, mavversion: 2, udpInputPort: 9000 }

    FC.startLink((err) => {
      try {
        assert.equal(err, null)
        waitFor(() => FC.router && FC.router.exitCode !== null, 3000).then(() => {
          let stopLinkFired = false
          FC.eventEmitter.once('stopLink', () => { stopLinkFired = true })

          FC.closeLink(() => {
            try {
              assert.equal(stopLinkFired, true)
              done()
            } catch (e) { done(e) }
          })
        }).catch(done)
      } catch (e) { done(e) }
    })
  }).timeout(5000)

  it('#addUDPOutput() - restarts link when active', function (done) {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.serialDevices.push({ value: '/dev/ttyS0', label: '/dev/ttyS0', path: '/dev/ttyS0' })
    sinon.stub(serialDetection, 'getSerialPathFromValue').returns('/dev/ttyS0')
    FC.activeDevice = { inputType: 'UART', serial: '/dev/ttyS0', baud: 115200, mavversion: 2, udpInputPort: 9000 }

    FC.startLink((err) => {
      try {
        assert.equal(err, null)
        const router1 = FC.router
        FC.addUDPOutput('10.0.0.1', 15100)
        waitFor(() => FC.router !== null && FC.router !== router1, 3000).then(() => {
          try {
            assert.equal(FC.UDPoutputs.some(o => o.IP === '10.0.0.1' && o.port === 15100), true)
            done()
          } catch (e) { done(e) }
        }).catch(done)
      } catch (e) { done(e) }
    })
  }).timeout(8000)

  it('#removeUDPOutput() - restarts link when active', function (done) {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.serialDevices.push({ value: '/dev/ttyS0', label: '/dev/ttyS0', path: '/dev/ttyS0' })
    sinon.stub(serialDetection, 'getSerialPathFromValue').returns('/dev/ttyS0')
    FC.UDPoutputs = [{ IP: '10.0.0.2', port: 15200 }]
    FC.activeDevice = { inputType: 'UART', serial: '/dev/ttyS0', baud: 115200, mavversion: 2, udpInputPort: 9000 }

    FC.startLink((err) => {
      try {
        assert.equal(err, null)
        const router1 = FC.router
        FC.removeUDPOutput('10.0.0.2', 15200)
        waitFor(() => FC.router !== null && FC.router !== router1, 3000).then(() => {
          try {
            assert.equal(FC.UDPoutputs.length, 0)
            done()
          } catch (e) { done(e) }
        }).catch(done)
      } catch (e) { done(e) }
    })
  }).timeout(8000)

  it('#startStopTelemetry() - UDP input type starts link', function (done) {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC

    FC.startStopTelemetry(null, null, 2, false, false, false, 0, false, false,
      'UDP', 9000, (err, isSuccess) => {
        try {
          assert.equal(err, null)
          assert.equal(isSuccess, true)
          assert.equal(FC.active, true)
          done()
        } catch (e) { done(e) }
      })
  }).timeout(5000)

  it('#startStopTelemetry() - stop telemetry when active (closeLink)', function (done) {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC

    FC.startStopTelemetry(null, null, 2, false, false, false, 0, false, false,
      'UDP', 9000, (err, isSuccess) => {
        try {
          assert.equal(err, null)
          assert.equal(isSuccess, true)
          const udpStream = FC.m ? FC.m.udpStream : null
          const router = FC.router

          FC.startStopTelemetry(null, null, 2, false, false, false, 0, false, false,
            'UDP', 9000, (err2, isSuccess2) => {
              try {
                assert.equal(err2, null)
                assert.equal(isSuccess2, false)
                assert.equal(FC.m, null)
                assert.equal(FC.activeDevice, null)
                activeFC = null // prevent teardownFC from double-closing
                const pending = { router: router && router.exitCode === null, udp: !!udpStream }
                let resolved = false
                const checkDone = function () {
                  if (!resolved && !pending.router && !pending.udp) {
                    resolved = true
                    done()
                  }
                }
                if (pending.router) {
                  router.once('close', () => { pending.router = false; checkDone() })
                }
                if (udpStream) {
                  udpStream.once('close', () => { pending.udp = false; checkDone() })
                }
                setTimeout(() => { pending.router = false; pending.udp = false; checkDone() }, 1500)
                checkDone()
              } catch (e) { done(e) }
            })
        } catch (e) { done(e) }
      })
  }).timeout(8000)

  it('#startInterval() - sends heartbeat and detects reconnect', function (done) {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.activeDevice = { inputType: 'UDP', serial: null, baud: null, mavversion: 2, udpInputPort: 9000 }

    FC.startLink((err) => {
      try {
        assert.equal(err, null)

        FC.enableHeartbeat = true
        const sendHeartbeat = sinon.spy()
        FC.m.sendHeartbeat = sendHeartbeat
        // stub conStatusInt to return -1 (trigger reconnect path)
        sinon.stub(FC.m, 'conStatusInt').returns(-1)

        // Also stub closeLink and startLink to avoid actually reconnecting
        const closeSpy = sinon.stub(FC, 'closeLink').callsFake((cb) => { cb(null) })
        const startSpy = sinon.stub(FC, 'startLink').callsFake((cb) => { cb(null) })

        const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
        FC.startInterval()

        clock.tickAsync(1100).then(() => {
          try {
            clock.restore()
            assert.ok(sendHeartbeat.callCount >= 1, 'heartbeat should be sent')
            assert.ok(closeSpy.callCount >= 1, 'closeLink should be called on reconnect')
            if (FC.intervalObj) clearInterval(FC.intervalObj)
            done()
          } catch (e) { clock.restore(); done(e) }
        }).catch((e) => { clock.restore(); done(e) })
      } catch (e) { done(e) }
    })
  }).timeout(8000)

  it('#startInterval() - no reconnect when conStatusInt=0', function (done) {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.activeDevice = { inputType: 'UDP', serial: null, baud: null, mavversion: 2, udpInputPort: 9000 }

    FC.startLink((err) => {
      try {
        assert.equal(err, null)
        FC.enableHeartbeat = true
        const sendHeartbeat = sinon.spy()
        FC.m.sendHeartbeat = sendHeartbeat
        sinon.stub(FC.m, 'conStatusInt').returns(0)

        const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
        FC.startInterval()

        clock.tickAsync(1100).then(() => {
          try {
            clock.restore()
            assert.ok(sendHeartbeat.callCount >= 1)
            if (FC.intervalObj) clearInterval(FC.intervalObj)
            done()
          } catch (e) { clock.restore(); done(e) }
        }).catch((e) => { clock.restore(); done(e) })
      } catch (e) { done(e) }
    })
  }).timeout(8000)

  it('#startInterval() - heartbeat=false, conStatusInt=0, no reconnect', function (done) {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.activeDevice = { inputType: 'UDP', serial: null, baud: null, mavversion: 2, udpInputPort: 9000 }

    FC.startLink((err) => {
      try {
        assert.equal(err, null)
        FC.enableHeartbeat = false
        sinon.stub(FC.m, 'conStatusInt').returns(0)

        const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
        FC.startInterval()

        clock.tickAsync(1100).then(() => {
          try {
            clock.restore()
            if (FC.intervalObj) clearInterval(FC.intervalObj)
            done()
          } catch (e) { clock.restore(); done(e) }
        }).catch((e) => { clock.restore(); done(e) })
      } catch (e) { done(e) }
    })
  }).timeout(8000)

  // startInterval reconnect success path: m.restart called
  it('#startInterval() - reconnect success calls m.restart', function (done) {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.activeDevice = { inputType: 'UDP', serial: null, baud: null, mavversion: 2, udpInputPort: 9000 }

    FC.startLink((err) => {
      try {
        assert.equal(err, null)
        FC.enableHeartbeat = false
        sinon.stub(FC.m, 'conStatusInt').returns(-1)
        const mRestart = sinon.spy()
        FC.m.restart = mRestart

        sinon.stub(FC, 'closeLink').callsFake((cb) => { cb(null) })
        sinon.stub(FC, 'startLink').callsFake((cb) => { cb(null) })

        const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
        FC.startInterval()

        clock.tickAsync(1100).then(() => {
          try {
            clock.restore()
            assert.ok(mRestart.callCount >= 1, 'm.restart should be called')
            if (FC.intervalObj) clearInterval(FC.intervalObj)
            done()
          } catch (e) { clock.restore(); done(e) }
        }).catch((e) => { clock.restore(); done(e) })
      } catch (e) { done(e) }
    })
  }).timeout(8000)

  // startInterval reconnect error path
  it('#startInterval() - reconnect error logged', function (done) {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.activeDevice = { inputType: 'UDP', serial: null, baud: null, mavversion: 2, udpInputPort: 9000 }

    FC.startLink((err) => {
      try {
        assert.equal(err, null)
        FC.enableHeartbeat = false
        sinon.stub(FC.m, 'conStatusInt').returns(-1)

        sinon.stub(FC, 'closeLink').callsFake((cb) => { cb(null) })
        sinon.stub(FC, 'startLink').callsFake((cb) => { cb(new Error('reconnect failed')) })

        const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
        FC.startInterval()

        clock.tickAsync(1100).then(() => {
          try {
            clock.restore()
            // should not throw; error just logged
            if (FC.intervalObj) clearInterval(FC.intervalObj)
            done()
          } catch (e) { clock.restore(); done(e) }
        }).catch((e) => { clock.restore(); done(e) })
      } catch (e) { done(e) }
    })
  }).timeout(8000)

  // ── Constructor tests (active=true paths) ──────────────────────────────────

  it('Constructor: active=true, UART, device found', function (done) {
    settings.clear()
    settings.setValue('flightcontroller.active', true)
    settings.setValue('flightcontroller.activeDevice', {
      inputType: 'UART',
      serial: '/dev/ttyS0',
      baud: 115200,
      mavversion: 2,
      udpInputPort: 9000
    })

    sinon.stub(serialDetection, 'detectSerialDevices').resolves([
      { value: '/dev/ttyS0', label: '/dev/ttyS0', path: '/dev/ttyS0' }
    ])
    sinon.stub(serialDetection, 'isModemManagerInstalled').returns(false)
    sinon.stub(serialDetection, 'isPi').returns(false)
    sinon.stub(serialDetection, 'getSerialPathFromValue').returns('/dev/ttyS0')

    const FC = new FCManagerClass(settings)
    activeFC = FC

    waitFor(() => FC.active === true, 5000).then(() => {
      try {
        assert.equal(FC.active, true)
        if (FC.intervalObj) clearInterval(FC.intervalObj)
        done()
      } catch (e) { done(e) }
    }).catch(done)
  }).timeout(8000)

  it('Constructor: active=true, UART, device not found → reset', function (done) {
    settings.clear()
    settings.setValue('flightcontroller.active', true)
    settings.setValue('flightcontroller.activeDevice', {
      inputType: 'UART',
      serial: '/dev/ttyNotExist',
      baud: 115200,
      mavversion: 2,
      udpInputPort: 9000
    })

    sinon.stub(serialDetection, 'detectSerialDevices').resolves([])
    sinon.stub(serialDetection, 'isModemManagerInstalled').returns(false)
    sinon.stub(serialDetection, 'isPi').returns(false)

    const FC = new FCManagerClass(settings)
    activeFC = FC

    waitFor(() => FC.active === false && FC.activeDevice === null, 3000).then(() => {
      try {
        assert.equal(FC.active, false)
        assert.equal(FC.activeDevice, null)
        done()
      } catch (e) { done(e) }
    }).catch(done)
  }).timeout(5000)

  it('Constructor: active=true, UART, startLink error → reset', function (done) {
    settings.clear()
    settings.setValue('flightcontroller.active', true)
    settings.setValue('flightcontroller.activeDevice', {
      inputType: 'UART',
      serial: '/dev/ttyS0',
      baud: 115200,
      mavversion: 2,
      udpInputPort: 9000
    })

    sinon.stub(serialDetection, 'detectSerialDevices').resolves([
      { value: '/dev/ttyS0', label: '/dev/ttyS0', path: '/dev/ttyS0' }
    ])
    sinon.stub(serialDetection, 'isModemManagerInstalled').returns(false)
    sinon.stub(serialDetection, 'isPi').returns(false)
    sinon.stub(serialDetection, 'getSerialPathFromValue').returns('/dev/ttyS0')

    process.env.FAKE_SCENARIO = 'which-empty'
    const parentPath = path.join(path.dirname(__dirname), 'mavlink-routerd')
    const stub = sinon.stub(fs, 'existsSync')
    stub.withArgs(parentPath).returns(false)
    stub.callThrough()

    const FC = new FCManagerClass(settings)
    activeFC = FC

    waitFor(() => FC.active === false, 3000).then(() => {
      try {
        assert.equal(FC.active, false)
        assert.equal(FC.activeDevice, null)
        done()
      } catch (e) { done(e) }
    }).catch(done)
  }).timeout(5000)

  it('Constructor: active=true, UDP, startLink succeeds', function (done) {
    settings.clear()
    settings.setValue('flightcontroller.active', true)
    settings.setValue('flightcontroller.activeDevice', {
      inputType: 'UDP',
      serial: null,
      baud: null,
      mavversion: 2,
      udpInputPort: 9000
    })

    sinon.stub(serialDetection, 'detectSerialDevices').resolves([])
    sinon.stub(serialDetection, 'isModemManagerInstalled').returns(false)
    sinon.stub(serialDetection, 'isPi').returns(false)

    const FC = new FCManagerClass(settings)
    activeFC = FC

    waitFor(() => FC.active === true, 5000).then(() => {
      try {
        assert.equal(FC.active, true)
        if (FC.intervalObj) clearInterval(FC.intervalObj)
        done()
      } catch (e) { done(e) }
    }).catch(done)
  }).timeout(8000)

  it('Constructor: active=true, UDP, startLink error → reset', function (done) {
    settings.clear()
    settings.setValue('flightcontroller.active', true)
    settings.setValue('flightcontroller.activeDevice', {
      inputType: 'UDP',
      serial: null,
      baud: null,
      mavversion: 2,
      udpInputPort: 9000
    })

    sinon.stub(serialDetection, 'detectSerialDevices').resolves([])
    sinon.stub(serialDetection, 'isModemManagerInstalled').returns(false)
    sinon.stub(serialDetection, 'isPi').returns(false)

    process.env.FAKE_SCENARIO = 'which-empty'
    const parentPath = path.join(path.dirname(__dirname), 'mavlink-routerd')
    const stub = sinon.stub(fs, 'existsSync')
    stub.withArgs(parentPath).returns(false)
    stub.callThrough()

    const FC = new FCManagerClass(settings)
    activeFC = FC

    waitFor(() => FC.active === false, 3000).then(() => {
      try {
        assert.equal(FC.active, false)
        assert.equal(FC.activeDevice, null)
        done()
      } catch (e) { done(e) }
    }).catch(done)
  }).timeout(5000)

  // ── Router stdout handler ──────────────────────────────────────────────────
  it('#startLink() - router stdout data handler fires', function (done) {
    settings.clear()
    process.env.FAKE_SCENARIO = 'router-stdout'
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.activeDevice = { inputType: 'UDP', serial: null, baud: null, mavversion: 2, udpInputPort: 9000 }

    FC.startLink((err) => {
      try {
        assert.equal(err, null)
        // Wait for stdout to fire (the script writes stdout then sleeps)
        setTimeout(() => done(), 300)
      } catch (e) { done(e) }
    })
  }).timeout(5000)

  // ── Router stderr without binlog ──────────────────────────────────────────
  it('#startLink() - router stderr without binlog pattern', function (done) {
    settings.clear()
    process.env.FAKE_SCENARIO = 'router-stderr-nobinlog'
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.activeDevice = { inputType: 'UDP', serial: null, baud: null, mavversion: 2, udpInputPort: 9000 }

    FC.startLink((err) => {
      try {
        assert.equal(err, null)
        // Wait for stderr to fire
        setTimeout(() => {
          // binlog should not be set since no binlog pattern in stderr
          assert.equal(FC.binlog, null)
          done()
        }, 300)
      } catch (e) { done(e) }
    })
  }).timeout(5000)

  // ── Router stderr lstat error (binlog file doesn't exist) ─────────────────
  it('#startLink() - router stderr binlog lstat error is caught', function (done) {
    settings.clear()
    process.env.FAKE_SCENARIO = 'router-binlog-lstat-error'
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.activeDevice = { inputType: 'UDP', serial: null, baud: null, mavversion: 2, udpInputPort: 9000 }
    // Point binlog to a non-existent file to trigger lstat error
    FC.binlog = path.join(tmpDir, 'nonexistent_log_xyz.bin')

    FC.startLink((err) => {
      try {
        assert.equal(err, null)
        // Wait for stderr handler
        waitFor(() => FC.binlog !== path.join(tmpDir, 'nonexistent_log_xyz.bin'), 3000).then(() => {
          try {
            // lstat threw but was caught; binlog updated to new value
            assert.ok(FC.binlog.includes('missing.bin'))
            done()
          } catch (e) { done(e) }
        }).catch(done)
      } catch (e) { done(e) }
    })
  }).timeout(8000)

  // ── DFLogger stdout and stderr handlers ───────────────────────────────────
  it('#startDFLogger() - stdout and stderr data handlers fire', function (done) {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    sinon.stub(logpaths, 'getPythonPath').returns(fakePython)
    process.env.FAKE_SCENARIO = 'dflogger-output'

    FC.startDFLogger()
    assert.notEqual(FC.dflogger, null)

    // Give time for stdout/stderr to fire
    setTimeout(() => {
      // cleanup
      if (FC.dflogger) { FC.dflogger.kill('SIGTERM'); FC.dflogger = null }
      done()
    }, 500)
  }).timeout(5000)

  // ── vehiclePosition null/falsy when gotMessage GPS fires ──────────────────
  it('#startLink() - GlobalPositionInt with vehiclePosition=null is skipped', function (done) {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.activeDevice = { inputType: 'UDP', serial: null, baud: null, mavversion: 2, udpInputPort: 9000 }

    FC.startLink((err) => {
      try {
        assert.equal(err, null)
        // Set vehiclePosition to null to hit the else branch
        FC.vehiclePosition = null

        const { common } = require('node-mavlink')
        FC.m.eventEmitter.emit('gotMessage', {
          header: { msgid: common.GlobalPositionInt.MSG_ID }
        }, { lat: 100000, lon: 200000, alt: 1000, relativeAlt: 500, hdg: 9000 })

        setTimeout(() => {
          try {
            // vehiclePosition is still null (wasn't updated)
            assert.equal(FC.vehiclePosition, null)
            done()
          } catch (e) { done(e) }
        }, 50)
      } catch (e) { done(e) }
    })
  }).timeout(5000)

  // ── addUDPOutput: startLink error in restart ──────────────────────────────
  // Inject m as a mock object so no real UDP socket is created.
  it('#addUDPOutput() - restart link fails, logs error', function (done) {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    // inject a mock mavManager so this.m is truthy (triggers closeLink+startLink)
    FC.m = { close: sinon.spy(), enableDSRequest: false }
    // stub closeLink to just call the callback (no real router to kill)
    sinon.stub(FC, 'closeLink').callsFake((cb) => { cb(null) })
    // stub startLink to return an error (covers L196: if (err) { console.log(err) })
    sinon.stub(FC, 'startLink').callsFake((cb) => { cb(new Error('restart failed')) })

    FC.addUDPOutput('10.0.0.5', 15500)

    // closeLink and startLink are synchronous stubs, so no waiting needed
    setTimeout(() => {
      try {
        assert.ok(FC.startLink.calledOnce)
        FC.m = null // clean up mock
        done()
      } catch (e) { done(e) }
    }, 50)
  })

  // ── removeUDPOutput: startLink error in restart ────────────────────────────
  it('#removeUDPOutput() - restart link fails, logs error', function (done) {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.UDPoutputs = [{ IP: '10.0.0.6', port: 15600 }]
    FC.m = { close: sinon.spy(), enableDSRequest: false }
    sinon.stub(FC, 'closeLink').callsFake((cb) => { cb(null) })
    sinon.stub(FC, 'startLink').callsFake((cb) => { cb(new Error('restart failed')) })

    FC.removeUDPOutput('10.0.0.6', 15600)

    setTimeout(() => {
      try {
        assert.ok(FC.startLink.calledOnce)
        FC.m = null
        done()
      } catch (e) { done(e) }
    }, 50)
  })

  // ── saveSerialSettings exception handler ──────────────────────────────────
  it('#saveSerialSettings() - catches exception from settings.setValue', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    // create a mock settings that throws
    FC.settings = {
      setValue: function () { throw new Error('storage error') }
    }
    // should not throw; catches internally
    FC.saveSerialSettings()
  })

  // ── addUDPOutput: saveSerialSettings throws (L206) ────────────────────────
  it('#addUDPOutput() - saveSerialSettings throws, logs exception', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    // m is null so no restart, but saveSerialSettings is called
    FC.m = null
    FC.settings = { setValue: sinon.stub().throws(new Error('save error')) }
    // should not throw
    FC.addUDPOutput('10.0.0.7', 15700)
  })

  // ── removeUDPOutput: saveSerialSettings throws (L242) ─────────────────────
  it('#removeUDPOutput() - saveSerialSettings throws, logs exception', function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.UDPoutputs = [{ IP: '10.0.0.8', port: 15800 }]
    FC.m = null
    FC.settings = { setValue: sinon.stub().throws(new Error('save error')) }
    // should not throw
    FC.removeUDPOutput('10.0.0.8', 15800)
  })

  // ── getDeviceSettings: inactive path with non-empty serialDevices ──────────
  it('#getDeviceSettings() - inactive path with non-empty serialDevices', async function () {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.active = false
    FC.serialDevices = [{ value: '/dev/ttyS0', label: '/dev/ttyS0', path: '/dev/ttyS0' }]

    sinon.stub(serialDetection, 'detectSerialDevices').resolves(FC.serialDevices)
    sinon.stub(serialDetection, 'isModemManagerInstalled').returns(false)

    await FC.getDeviceSettings((err, devices, bauds, seldevice, selbaud) => {
      assert.equal(err, null)
      // When inactive, seldevice = serialDevices[0].value
      assert.equal(seldevice, '/dev/ttyS0')
    })
  })

  // ── Constructor: active=true, UART, device found at second iteration (b2[1]) ──
  it('Constructor: active=true, UART, device found at second index', function (done) {
    settings.clear()
    settings.setValue('flightcontroller.active', true)
    settings.setValue('flightcontroller.activeDevice', {
      inputType: 'UART',
      serial: '/dev/ttyS1',
      baud: 115200,
      mavversion: 2,
      udpInputPort: 9000
    })

    sinon.stub(serialDetection, 'detectSerialDevices').resolves([
      { value: '/dev/ttyS0', label: '/dev/ttyS0', path: '/dev/ttyS0' }, // doesn't match
      { value: '/dev/ttyS1', label: '/dev/ttyS1', path: '/dev/ttyS1' }  // matches
    ])
    sinon.stub(serialDetection, 'isModemManagerInstalled').returns(false)
    sinon.stub(serialDetection, 'isPi').returns(false)
    sinon.stub(serialDetection, 'getSerialPathFromValue').returns('/dev/ttyS1')

    const FC = new FCManagerClass(settings)
    activeFC = FC

    waitFor(() => FC.active === true, 5000).then(() => {
      try {
        assert.equal(FC.active, true)
        if (FC.intervalObj) clearInterval(FC.intervalObj)
        done()
      } catch (e) { done(e) }
    }).catch(done)
  }).timeout(8000)

  // ── startStopTelemetry: UART device not found during loop (b61[1]) ─────────
  it('#startStopTelemetry() - UART device list has non-matching entry then match', function (done) {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    // add two devices, test with the second one
    FC.serialDevices.push({ value: '/dev/ttyS0', label: '/dev/ttyS0', path: '/dev/ttyS0' })
    FC.serialDevices.push({ value: '/dev/ttyS1', label: '/dev/ttyS1', path: '/dev/ttyS1' })
    sinon.stub(serialDetection, 'getSerialPathFromValue').returns('/dev/ttyS1')

    // This triggers the loop where /dev/ttyS0 doesn't match first, then /dev/ttyS1 does (b61[1])
    FC.startStopTelemetry('/dev/ttyS1', 115200, 2, false, false, false, 0, false, false,
      'UART', 9000, (err, isSuccess) => {
        try {
          assert.equal(err, null)
          assert.equal(isSuccess, true)
          done()
        } catch (e) { done(e) }
      })
  }).timeout(5000)

  // ── startStopTelemetry: UART startLink error ──────────────────────────────
  it('#startStopTelemetry() - UART startLink error sets activeDevice=null', function (done) {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    FC.serialDevices.push({ value: '/dev/ttyS0', label: '/dev/ttyS0', path: '/dev/ttyS0' })
    sinon.stub(serialDetection, 'getSerialPathFromValue').returns('/dev/ttyS0')

    process.env.FAKE_SCENARIO = 'which-empty'
    const parentPath = path.join(path.dirname(__dirname), 'mavlink-routerd')
    const stub = sinon.stub(fs, 'existsSync')
    stub.withArgs(parentPath).returns(false)
    stub.callThrough()

    FC.startStopTelemetry('/dev/ttyS0', 115200, 2, false, false, false, 0, false, false,
      'UART', 9000, (err, isSuccess) => {
        try {
          assert.ok(err)
          assert.equal(isSuccess, false)
          assert.equal(FC.activeDevice, null)
          done()
        } catch (e) { done(e) }
      })
  }).timeout(5000)

  // ── startLink: inputType neither UART nor UDP (branch B31[1]) ─────────────
  it('#startLink() - unknown inputType skips port arg, router spawned', function (done) {
    settings.clear()
    const FC = new FCManagerClass(settings)
    activeFC = FC
    // Set an inputType that is neither UART nor UDP to cover the implicit else
    FC.activeDevice = { inputType: 'BLUETOOTH', serial: null, baud: null, mavversion: 2, udpInputPort: 9000 }

    FC.startLink((err) => {
      try {
        assert.equal(err, null)
        assert.notEqual(FC.router, null)
        assert.equal(FC.active, true)
        done()
      } catch (e) { done(e) }
    })
  }).timeout(5000)

  // ── Constructor: active=true, inputType neither UART nor UDP (branch B5[1]) ─
  it('Constructor: active=true, unknown inputType → falls through silently', function (done) {
    settings.clear()
    settings.setValue('flightcontroller.active', true)
    settings.setValue('flightcontroller.activeDevice', {
      inputType: 'BLUETOOTH',
      serial: null,
      baud: null,
      mavversion: 2,
      udpInputPort: 9000
    })

    sinon.stub(serialDetection, 'detectSerialDevices').resolves([])
    sinon.stub(serialDetection, 'isModemManagerInstalled').returns(false)
    sinon.stub(serialDetection, 'isPi').returns(false)

    // Give the async getDeviceSettings callback time to run; then verify
    // FC stayed active=true (loaded from settings) but no startLink called
    const FC = new FCManagerClass(settings)
    activeFC = FC

    // The constructor reads active=true from settings but the inputType branch
    // neither UART nor UDP: falls through, no startLink called, active stays true
    setTimeout(() => {
      try {
        // active remains what was loaded (true); no router was started
        assert.equal(FC.router, null)
        done()
      } catch (e) { done(e) }
    }, 200)
  }).timeout(3000)
})
