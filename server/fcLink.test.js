const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const events = require('events')
const sinon = require('sinon')
const { common } = require('node-mavlink')
const FCLink = require('./fcLink')
const serialDetection = require('./serialDetection')
const logpaths = require('./paths')
const { FakeBin } = require('../test/fakeBin')

// Poll until fn() is true, max `timeout` ms
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

// Tear down a link: kill router, close mavManager UDP socket, clear interval
function teardownLink (link) {
  return new Promise(function (resolve) {
    if (!link) { return resolve() }
    if (link.intervalObj) { clearInterval(link.intervalObj); link.intervalObj = null }
    if (link.dflogger) { try { link.dflogger.kill('SIGTERM') } catch (_) {} link.dflogger = null }
    if (link.router && link.router.exitCode === null) { try { link.router.kill('SIGINT') } catch (_) {} }
    const udpStream = link.m ? link.m.udpStream : null
    if (link.m) { try { link.m.close() } catch (_) {} link.m = null }
    if (udpStream) {
      let resolved = false
      const fin = () => { if (!resolved) { resolved = true; resolve() } }
      udpStream.once('close', fin)
      setTimeout(fin, 400)
    } else {
      setTimeout(resolve, 100)
    }
  })
}

function buildFakeDFLogger (tmpDir) {
  const script = path.join(tmpDir, 'fake_dflogger.py')
  fs.writeFileSync(script, `#!/usr/bin/env python3
import os, sys, time, signal
def handler(signum, frame):
    sys.exit(0)
signal.signal(signal.SIGINT, handler)
signal.signal(signal.SIGTERM, handler)
scenario = os.environ.get('FAKE_SCENARIO', '')
if scenario == 'dflogger-exitfast':
    sys.exit(0)
elif scenario == 'dflogger-output':
    sys.stdout.write('DFLogger stdout message\\n'); sys.stdout.flush()
    sys.stderr.write('DFLogger stderr message\\n'); sys.stderr.flush()
try:
    time.sleep(9999)
except (KeyboardInterrupt, SystemExit):
    pass
`, { mode: 0o755 })
  return script
}

function buildFakePython (tmpDir) {
  const dfScript = buildFakeDFLogger(tmpDir)
  const script = path.join(tmpDir, 'fakepython3')
  fs.writeFileSync(script, `#!/bin/sh\nexec python3 "${dfScript}" "$@"\n`, { mode: 0o755 })
  return script
}

describe('FCLink (one telemetry input link)', function () {
  let fake
  let tmpDir
  let fakePython
  let activeLink = null

  before(function () {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpanion-fclink-'))
    fakePython = buildFakePython(tmpDir)
    fake = new FakeBin()
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
    sys.stdout.write('router stdout message\\n'); sys.stdout.flush()
elif scenario == 'router-stderr-nobinlog':
    sys.stderr.write('some stderr message without binlog\\n'); sys.stderr.flush()
elif scenario == 'router-binlog':
    sys.stderr.write('Logging target (filename) testlog.bin\\n'); sys.stderr.flush()
try:
    time.sleep(9999)
except (KeyboardInterrupt, SystemExit):
    pass
`, { mode: 0o755 })
    fake.install('mavlink-routerd', `exec python3 "${routerScript}" "$@"`)
    fake.activate()
  })

  after(function () {
    fake.cleanup()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  afterEach(function (done) {
    this.timeout(4000)
    const link = activeLink
    activeLink = null
    sinon.restore()
    delete process.env.FAKE_SCENARIO
    if (link) { teardownLink(link).then(() => done()).catch(() => done()) } else { done() }
  })

  // a fake FCDetails parent providing shared config + the router path
  function fakeParent (overrides) {
    return Object.assign({
      eventEmitter: new events.EventEmitter(),
      UDPoutputs: [],
      enableTCP: false,
      enableUDPB: false,
      UDPBPort: 14550,
      enableHeartbeat: false,
      enableDSRequest: false,
      doLogging: false,
      serialDevices: [],
      mavlinkRouterPath: path.join(fake.dir, 'mavlink-routerd'),
      validMavlinkRouter: function () { return true }
    }, overrides || {})
  }

  const udpDevice = { inputType: 'UDP', serial: null, baud: null, mavversion: 2, udpInputPort: 9000 }

  it('derives ports + shared ownership from the slot id', function () {
    const a = new FCLink(0, udpDevice, fakeParent())
    assert.equal(a.monitorPort, 14540)
    assert.equal(a.loggerPort, 14541)
    assert.equal(a.ownsShared, true)
    const b = new FCLink(1, udpDevice, fakeParent())
    assert.equal(b.monitorPort, 14542)
    assert.equal(b.loggerPort, 14543)
    assert.equal(b.ownsShared, false)
  })

  it('#deviceLabel() for UART and UDP', function () {
    const uart = new FCLink(0, { inputType: 'UART', serial: '/dev/ttyS0', baud: 115200 }, fakeParent())
    assert.equal(uart.deviceLabel(), '/dev/ttyS0 @ 115200')
    const udp = new FCLink(0, udpDevice, fakeParent())
    assert.equal(udp.deviceLabel(), 'UDP :9000')
  })

  it('#buildRouterCmd() - primary link includes TCP, broadcast and outputs', function () {
    sinon.stub(serialDetection, 'getSerialPathFromValue').returns('/dev/ttyS0')
    const parent = fakeParent({ enableTCP: true, enableUDPB: true, UDPBPort: 14550, UDPoutputs: [{ IP: '10.0.0.1', port: 15300 }] })
    const link = new FCLink(0, { inputType: 'UART', serial: '/dev/ttyS0', baud: 115200, mavversion: 2 }, parent)
    const cmd = link.buildRouterCmd()
    assert.ok(cmd.includes('5760'))
    assert.ok(cmd.includes('0.0.0.0:14550'))
    assert.ok(cmd.includes('10.0.0.1:15300'))
    assert.ok(cmd.includes('/dev/ttyS0:115200'))
    assert.ok(cmd.includes('127.0.0.1:14540'))
  })

  it('#buildRouterCmd() - secondary link omits TCP + broadcast', function () {
    const parent = fakeParent({ enableTCP: true, enableUDPB: true })
    const link = new FCLink(1, udpDevice, parent)
    const cmd = link.buildRouterCmd()
    // tcp-port follows --tcp-port; secondary passes '0'
    assert.ok(cmd.includes('0'))
    assert.ok(!cmd.includes('5760'))
    assert.ok(!cmd.includes('0.0.0.0:14550'))
    assert.ok(cmd.includes('0.0.0.0:9000')) // its UDP input
    assert.ok(cmd.includes('127.0.0.1:14542'))
  })

  it('#startLink() - opens a UDP link and builds a mavManager', function (done) {
    const link = new FCLink(0, udpDevice, fakeParent())
    activeLink = link
    link.startLink((err) => {
      try {
        assert.equal(err, null)
        assert.equal(link.active, true)
        assert.notEqual(link.m, null)
        done()
      } catch (e) { done(e) }
    })
  }).timeout(5000)

  it('#startLink() - returns error when mavlink-routerd is missing', function (done) {
    const link = new FCLink(0, udpDevice, fakeParent({ validMavlinkRouter: () => false }))
    activeLink = link
    link.startLink((err, ok) => {
      try {
        assert.ok(err)
        assert.equal(ok, false)
        assert.equal(link.active, false)
        done()
      } catch (e) { done(e) }
    })
  }).timeout(5000)

  it('#startLink() - router stdout branch', function (done) {
    process.env.FAKE_SCENARIO = 'router-stdout'
    const link = new FCLink(0, udpDevice, fakeParent())
    activeLink = link
    link.startLink((err) => {
      try { assert.equal(err, null) } catch (e) { return done(e) }
      // let the router's stdout 'data' event fire (covers the stdout handler)
      setTimeout(done, 250)
    })
  }).timeout(5000)

  it('#startLink() - opens a UART link', function (done) {
    sinon.stub(serialDetection, 'getSerialPathFromValue').returns('/dev/ttyS0')
    const link = new FCLink(0, { inputType: 'UART', serial: '/dev/ttyS0', baud: 115200, mavversion: 2 }, fakeParent())
    activeLink = link
    link.startLink((err) => {
      try { assert.equal(err, null); assert.equal(link.active, true); done() } catch (e) { done(e) }
    })
  }).timeout(5000)

  it('#startLink() - router stderr without binlog', function (done) {
    process.env.FAKE_SCENARIO = 'router-stderr-nobinlog'
    const link = new FCLink(0, udpDevice, fakeParent())
    activeLink = link
    link.startLink((err) => { try { assert.equal(err, null); done() } catch (e) { done(e) } })
  }).timeout(5000)

  it('#startLink() - binlog detect deletes a small stale log', function (done) {
    process.env.FAKE_SCENARIO = 'router-binlog'
    const link = new FCLink(0, udpDevice, fakeParent())
    activeLink = link
    const smallLog = path.join(tmpDir, 'oldlog.bin')
    fs.writeFileSync(smallLog, Buffer.alloc(1024))
    link.binlog = smallLog
    link.startLink((err) => {
      try {
        assert.equal(err, null)
        waitFor(() => link.binlog !== smallLog, 3000).then(() => {
          try { assert.equal(fs.existsSync(smallLog), false); done() } catch (e) { done(e) }
        }).catch(done)
      } catch (e) { done(e) }
    })
  }).timeout(8000)

  it('#startLink() - binlog detect keeps a large stale log', function (done) {
    process.env.FAKE_SCENARIO = 'router-binlog'
    const link = new FCLink(0, udpDevice, fakeParent())
    activeLink = link
    const largeLog = path.join(tmpDir, 'largelog.bin')
    fs.writeFileSync(largeLog, Buffer.alloc(65 * 1024))
    link.binlog = largeLog
    link.startLink((err) => {
      try {
        assert.equal(err, null)
        waitFor(() => link.binlog !== largeLog, 3000).then(() => {
          try { assert.equal(fs.existsSync(largeLog), true); fs.unlinkSync(largeLog); done() } catch (e) { done(e) }
        }).catch(done)
      } catch (e) { done(e) }
    })
  }).timeout(8000)

  it('#startLink() - binlog detect with a missing stale file (lstat throws, caught)', function (done) {
    process.env.FAKE_SCENARIO = 'router-binlog'
    const link = new FCLink(0, udpDevice, fakeParent())
    activeLink = link
    link.binlog = path.join(tmpDir, 'does-not-exist.bin')
    link.startLink((err) => {
      try {
        assert.equal(err, null)
        waitFor(() => link.binlog.includes('testlog.bin'), 3000).then(() => done()).catch(done)
      } catch (e) { done(e) }
    })
  }).timeout(8000)

  it('#startLink() - gotMessage forwards packets and GlobalPositionInt updates position', function (done) {
    const parent = fakeParent()
    const link = new FCLink(0, udpDevice, parent)
    activeLink = link
    link.startLink((err) => {
      try {
        assert.equal(err, null)
        let fired = null
        parent.eventEmitter.once('gotMessage', (p, d, l) => { fired = l })
        link.m.eventEmitter.emit('gotMessage', { header: { msgid: 9999 } }, {})
        setTimeout(() => {
          try {
            assert.strictEqual(fired, link)
            assert.equal(link.previousConnection, true)
            link.m.eventEmitter.emit('gotMessage', { header: { msgid: common.GlobalPositionInt.MSG_ID } },
              { lat: 374200000, lon: -1220000000, alt: 100000, relativeAlt: 50000, hdg: 18000 })
            setTimeout(() => {
              try {
                assert.ok(Math.abs(link.vehiclePosition.lat - 37.42) < 0.001)
                assert.ok(Math.abs(link.vehiclePosition.hdg - 180) < 0.01)
                done()
              } catch (e) { done(e) }
            }, 40)
          } catch (e) { done(e) }
        }, 40)
      } catch (e) { done(e) }
    })
  }).timeout(5000)

  it('#startLink() - armed/disarmed pass through with the link id', function (done) {
    const parent = fakeParent()
    const link = new FCLink(0, udpDevice, parent)
    activeLink = link
    link.startLink((err) => {
      try {
        assert.equal(err, null)
        let armedId = null
        let disarmedId = null
        parent.eventEmitter.once('armed', (id) => { armedId = id })
        parent.eventEmitter.once('disarmed', (id) => { disarmedId = id })
        link.m.eventEmitter.emit('armed')
        link.m.eventEmitter.emit('disarmed')
        setTimeout(() => {
          try { assert.equal(armedId, 0); assert.equal(disarmedId, 0); done() } catch (e) { done(e) }
        }, 40)
      } catch (e) { done(e) }
    })
  }).timeout(5000)

  it('#startLink() - a second start reuses the existing mavManager (no stacked listeners)', function (done) {
    const link = new FCLink(0, udpDevice, fakeParent())
    activeLink = link
    link.startLink((err) => {
      try {
        assert.equal(err, null)
        const originalM = link.m
        const r = link.router
        link.router = null
        link.startLink((err2) => {
          try {
            assert.equal(err2, null)
            assert.strictEqual(link.m, originalM)
            assert.strictEqual(link.m.eventEmitter.listenerCount('armed'), 1)
            if (r && r.exitCode === null) try { r.kill('SIGINT') } catch (_) {}
            done()
          } catch (e) { if (r) try { r.kill('SIGINT') } catch (_) {} done(e) }
        })
      } catch (e) { done(e) }
    })
  }).timeout(8000)

  it('#startLink() - primary link with doLogging starts the DataFlash logger', function (done) {
    sinon.stub(logpaths, 'getPythonPath').returns(fakePython)
    const link = new FCLink(0, udpDevice, fakeParent({ doLogging: true }))
    activeLink = link
    link.startLink((err) => {
      try { assert.equal(err, null); assert.notEqual(link.dflogger, null); done() } catch (e) { done(e) }
    })
  }).timeout(5000)

  it('#startLink() - close event emits stopLink (router-exitfast)', function (done) {
    process.env.FAKE_SCENARIO = 'router-exitfast'
    const parent = fakeParent()
    const link = new FCLink(0, udpDevice, parent)
    activeLink = link
    parent.eventEmitter.once('stopLink', (id) => { try { assert.equal(id, 0); done() } catch (e) { done(e) } })
    link.startLink(() => {})
  }).timeout(5000)

  it('#startLink() - router process error event is handled (no crash, drives stopLink)', function (done) {
    // R3: an unhandled child 'error' (EACCES/EAGAIN/ENOMEM/ENOENT) would be
    // thrown by Node and crash the process. The listener must log + tear down.
    const parent = fakeParent()
    const link = new FCLink(0, udpDevice, parent)
    activeLink = link
    link.startLink((err) => {
      try {
        assert.equal(err, null)
        let stopId = null
        parent.eventEmitter.once('stopLink', (id) => { stopId = id })
        // simulate a spawn/runtime error on the router child
        link.router.emit('error', new Error('spawn EACCES'))
        setTimeout(() => {
          try {
            assert.equal(stopId, 0)
            assert.equal(link.active, false)
            done()
          } catch (e) { done(e) }
        }, 40)
      } catch (e) { done(e) }
    })
  }).timeout(5000)

  it('#closeLink() - stops the dflogger and clears active', function (done) {
    sinon.stub(logpaths, 'getPythonPath').returns(fakePython)
    const link = new FCLink(0, udpDevice, fakeParent({ doLogging: true }))
    activeLink = link
    link.startLink((err) => {
      try {
        assert.equal(err, null)
        assert.notEqual(link.dflogger, null)
        link.closeLink(() => {
          try { assert.equal(link.dflogger, null); assert.equal(link.active, false); done() } catch (e) { done(e) }
        })
      } catch (e) { done(e) }
    })
  }).timeout(5000)

  it('#closeLink() - already-exited router branch emits stopLink', function (done) {
    const parent = fakeParent()
    const link = new FCLink(0, udpDevice, parent)
    activeLink = link
    // no router started
    parent.eventEmitter.once('stopLink', (id) => { try { assert.equal(id, 0); done() } catch (e) { done(e) } })
    link.closeLink(() => {})
  })

  it('#startInterval() - sends heartbeat and reconnects on a dead link', function (done) {
    const link = new FCLink(0, udpDevice, fakeParent({ enableHeartbeat: true }))
    activeLink = link
    link.startLink((err) => {
      try {
        assert.equal(err, null)
        let beats = 0
        link.m.sendHeartbeat = () => { beats++ }
        sinon.stub(link.m, 'conStatusInt').returns(-1)
        const closeSpy = sinon.stub(link, 'closeLink').callsFake((cb) => cb(null))
        const startSpy = sinon.stub(link, 'startLink').callsFake((cb) => cb(null))
        link.m.restart = () => {}
        const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
        link.startInterval()
        clock.tickAsync(1100).then(() => {
          try {
            clock.restore()
            assert.ok(beats >= 1)
            assert.ok(closeSpy.callCount >= 1)
            assert.ok(startSpy.callCount >= 1)
            if (link.intervalObj) clearInterval(link.intervalObj)
            done()
          } catch (e) { clock.restore(); done(e) }
        }).catch((e) => { clock.restore(); done(e) })
      } catch (e) { done(e) }
    })
  }).timeout(8000)

  it('#startInterval() - reconnect start failure is logged', function (done) {
    const link = new FCLink(0, udpDevice, fakeParent())
    activeLink = link
    link.startLink((err) => {
      try {
        assert.equal(err, null)
        sinon.stub(link.m, 'conStatusInt').returns(-1)
        sinon.stub(link, 'closeLink').callsFake((cb) => cb(null))
        // inner reconnect startLink fails → the error-log branch runs
        sinon.stub(link, 'startLink').callsFake((cb) => cb('reconnect failed'))
        const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
        link.startInterval()
        clock.tickAsync(1100).then(() => {
          try { clock.restore(); if (link.intervalObj) clearInterval(link.intervalObj); done() } catch (e) { clock.restore(); done(e) }
        }).catch((e) => { clock.restore(); done(e) })
      } catch (e) { done(e) }
    })
  }).timeout(8000)

  it('#startInterval() - no reconnect when the link is healthy', function (done) {
    const link = new FCLink(0, udpDevice, fakeParent())
    activeLink = link
    link.startLink((err) => {
      try {
        assert.equal(err, null)
        sinon.stub(link.m, 'conStatusInt').returns(0)
        const closeSpy = sinon.stub(link, 'closeLink')
        const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
        link.startInterval()
        clock.tickAsync(1100).then(() => {
          try {
            clock.restore()
            assert.equal(closeSpy.callCount, 0)
            if (link.intervalObj) clearInterval(link.intervalObj)
            done()
          } catch (e) { clock.restore(); done(e) }
        }).catch((e) => { clock.restore(); done(e) })
      } catch (e) { done(e) }
    })
  }).timeout(8000)

  it('#startInterval() - skips reconnect when the serial device is gone (R14 null-device guard)', function (done) {
    // UART whose value is absent from serialDevices → getSerialPathFromValue → null.
    // Reconnect must be skipped rather than spawning a router dialling 'null:baud'.
    const parent = fakeParent({ serialDevices: [] })
    const link = new FCLink(0, { inputType: 'UART', serial: '/dev/ttyGONE', baud: 115200, mavversion: 2 }, parent)
    activeLink = link
    link.m = { conStatusInt: () => -1, sendHeartbeat: () => {}, restart: () => {} }
    const closeSpy = sinon.stub(link, 'closeLink')
    const startSpy = sinon.stub(link, 'startLink')
    const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    link.startInterval()
    clock.tickAsync(1100).then(() => {
      try {
        clock.restore()
        assert.equal(closeSpy.callCount, 0)
        assert.equal(startSpy.callCount, 0)
        if (link.intervalObj) clearInterval(link.intervalObj)
        done()
      } catch (e) { clock.restore(); done(e) }
    }).catch((e) => { clock.restore(); done(e) })
  }).timeout(8000)

  it('#startInterval() - reconnects when the serial device is present (R14 guard allows)', function (done) {
    const parent = fakeParent({ serialDevices: [{ value: '/dev/ttyHERE', path: '/dev/ttyHERE', label: 'x' }] })
    const link = new FCLink(0, { inputType: 'UART', serial: '/dev/ttyHERE', baud: 115200, mavversion: 2 }, parent)
    activeLink = link
    link.m = { conStatusInt: () => -1, sendHeartbeat: () => {}, restart: () => {} }
    const closeSpy = sinon.stub(link, 'closeLink').callsFake((cb) => cb(null))
    const startSpy = sinon.stub(link, 'startLink').callsFake((cb) => cb(null))
    const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    link.startInterval()
    clock.tickAsync(1100).then(() => {
      try {
        clock.restore()
        assert.ok(closeSpy.callCount >= 1)
        assert.ok(startSpy.callCount >= 1)
        if (link.intervalObj) clearInterval(link.intervalObj)
        done()
      } catch (e) { clock.restore(); done(e) }
    }).catch((e) => { clock.restore(); done(e) })
  }).timeout(8000)

  it('#startDFLogger() - already-running and process-exit branches; #stopDFLogger() not-running', function (done) {
    sinon.stub(logpaths, 'getPythonPath').returns(fakePython)
    const link = new FCLink(0, udpDevice, fakeParent())
    activeLink = link
    // not running → no-op
    link.stopDFLogger()
    link.startDFLogger()
    assert.notEqual(link.dflogger, null)
    const first = link.dflogger
    // already running → no replacement
    link.startDFLogger()
    assert.strictEqual(link.dflogger, first)
    done()
  }).timeout(5000)

  it('#startDFLogger() - process exit sets dflogger null', function (done) {
    process.env.FAKE_SCENARIO = 'dflogger-exitfast'
    sinon.stub(logpaths, 'getPythonPath').returns(fakePython)
    const link = new FCLink(0, udpDevice, fakeParent())
    activeLink = link
    link.startDFLogger()
    waitFor(() => link.dflogger === null, 3000).then(() => done()).catch(done)
  }).timeout(5000)

  it('#startDFLogger() - stdout/stderr output branches', function (done) {
    process.env.FAKE_SCENARIO = 'dflogger-output'
    sinon.stub(logpaths, 'getPythonPath').returns(fakePython)
    const link = new FCLink(0, udpDevice, fakeParent())
    activeLink = link
    link.startDFLogger()
    setTimeout(() => done(), 300)
  }).timeout(5000)

  it('#startDFLogger() - process error event is handled and identity-nulls (R3)', function (done) {
    sinon.stub(logpaths, 'getPythonPath').returns(fakePython)
    const link = new FCLink(0, udpDevice, fakeParent())
    activeLink = link
    link.startDFLogger()
    const proc = link.dflogger
    assert.notEqual(proc, null)
    // simulate a child 'error' (spawn EACCES/EAGAIN) — must not crash, must null
    proc.emit('error', new Error('spawn EAGAIN'))
    setTimeout(() => {
      try { assert.equal(link.dflogger, null) } catch (e) { try { proc.kill('SIGTERM') } catch (_) {} return done(e) }
      // the fake process is still alive (manual emit didn't kill it) — reap it
      try { proc.kill('SIGTERM') } catch (_) {}
      done()
    }, 40)
  }).timeout(5000)

  it('#startDFLogger() - a late OLD close does not null a NEW logger (R6 identity check)', function (done) {
    sinon.stub(logpaths, 'getPythonPath').returns(fakePython)
    const link = new FCLink(0, udpDevice, fakeParent())
    activeLink = link
    link.startDFLogger()
    const oldProc = link.dflogger
    assert.notEqual(oldProc, null)
    // kill-before-respawn: a NEW logger is now the live reference
    const newProc = { newLogger: true }
    link.dflogger = newProc
    // the OLD process exits late and fires its (stale) close handler
    oldProc.emit('close', 0)
    setTimeout(() => {
      try {
        assert.strictEqual(link.dflogger, newProc) // NOT nulled by the stale close
        link.dflogger = oldProc // restore so teardown reaps the real fake process
        done()
      } catch (e) { try { oldProc.kill('SIGTERM') } catch (_) {} done(e) }
    }, 40)
  }).timeout(5000)

  it('#startDFLogger() - a late OLD error does not null a NEW logger (error-path identity check)', function (done) {
    sinon.stub(logpaths, 'getPythonPath').returns(fakePython)
    const link = new FCLink(0, udpDevice, fakeParent())
    activeLink = link
    link.startDFLogger()
    const oldProc = link.dflogger
    assert.notEqual(oldProc, null)
    const newProc = { newLogger: true }
    link.dflogger = newProc
    // the OLD process errors late — its handler must not clear the NEW ref
    oldProc.emit('error', new Error('spawn EACCES'))
    setTimeout(() => {
      try {
        assert.strictEqual(link.dflogger, newProc)
        link.dflogger = oldProc // restore so teardown reaps the real fake process
        done()
      } catch (e) { try { oldProc.kill('SIGTERM') } catch (_) {} done(e) }
    }, 40)
  }).timeout(5000)

  it('#getStatus() - with and without a mavManager', function () {
    const link = new FCLink(0, udpDevice, fakeParent())
    const cold = link.getStatus()
    assert.equal(cold.id, 0)
    assert.equal(cold.conStatus, 'Not connected')
    assert.equal(cold.numpackets, 0)
    // fake an m
    link.m = {
      statusNumRxPackets: 7,
      autopilotFromID: () => 'ArduCopter',
      vehicleFromID: () => 'Quadrotor',
      conStatusStr: () => 'Connected',
      statusText: 'hi',
      statusBytesPerSec: { avgBytesSec: 42 },
      fcVersion: '4.5.0'
    }
    const hot = link.getStatus()
    assert.equal(hot.numpackets, 7)
    assert.equal(hot.FW, 'ArduCopter')
    assert.equal(hot.conStatus, 'Connected')
    assert.equal(hot.byteRate, 42)
    link.m = null
  })

  it('#destroy() - tears down interval, router and mavManager', function (done) {
    const link = new FCLink(0, udpDevice, fakeParent())
    activeLink = link
    link.startLink((err) => {
      try {
        assert.equal(err, null)
        link.startInterval()
        link.destroy(() => {
          try {
            assert.equal(link.m, null)
            assert.equal(link.intervalObj, null)
            activeLink = null
            done()
          } catch (e) { done(e) }
        })
      } catch (e) { done(e) }
    })
  }).timeout(5000)
})
