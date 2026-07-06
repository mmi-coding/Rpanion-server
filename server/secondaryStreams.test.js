const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const sinon = require('sinon')
const settings = require('settings-store')
const SecondaryStreams = require('./secondaryStreams')
const logpaths = require('./paths')

function waitFor (fn, timeout) {
  const ms = timeout || 2000
  return new Promise(function (resolve, reject) {
    const start = Date.now()
    const poll = function () {
      if (fn()) return resolve()
      if (Date.now() - start > ms) return reject(new Error('waitFor timed out'))
      setTimeout(poll, 15)
    }
    poll()
  })
}

function teardown (mgr) {
  if (!mgr) return
  for (const s of mgr.streams) {
    if (s.process && s.process.exitCode === null) {
      try { s.process.kill('SIGKILL') } catch (_) {}
    }
  }
}

// a fake "python" that just stays alive (or exits / emits output per scenario)
function buildFakePython (tmpDir) {
  const script = path.join(tmpDir, 'fakepython.sh')
  fs.writeFileSync(script, `#!/bin/sh
case "$FAKE_SCENARIO" in
  exitfast) exit 0 ;;
  output) echo out; echo err >&2; exec sleep 9999 ;;
  *) exec sleep 9999 ;;
esac
`, { mode: 0o755 })
  return script
}

const cfgRTSP = { device: '/dev/video2', format: 'image/jpeg', width: 1280, height: 720, fps: 30, bitrate: 2000, rotation: 0, compression: 'H264', transport: 'RTSP' }
const cfgRTP = { device: '/dev/video4', format: 'video/x-raw', width: 640, height: 480, fps: 15, bitrate: 1000, rotation: 90, compression: 'H264', transport: 'RTP', udpIP: '10.0.0.2', udpPort: 5602 }

describe('SecondaryStreams (#398)', function () {
  let tmpDir
  let fakePython
  let activeMgr = null

  before(function () {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpanion-sec-'))
    fakePython = buildFakePython(tmpDir)
  })

  after(function () {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  beforeEach(function () {
    sinon.stub(logpaths, 'getPythonPath').returns(fakePython)
  })

  afterEach(function () {
    teardown(activeMgr)
    activeMgr = null
    sinon.restore()
    delete process.env.FAKE_SCENARIO
  })

  function noVManager () { return { active: false } }

  it('starts empty with no saved streams', function () {
    settings.clear()
    const mgr = new SecondaryStreams(settings, noVManager())
    activeMgr = mgr
    assert.equal(mgr.streams.length, 0)
    assert.deepEqual(mgr.getStatus(), [])
  })

  it('#nextSlot() returns the lowest free id', function () {
    settings.clear()
    const mgr = new SecondaryStreams(settings, noVManager())
    activeMgr = mgr
    assert.equal(mgr.nextSlot(), 0)
  })

  it('#primaryDevice() / #inUseDevices() reflect the primary + secondaries', function () {
    settings.clear()
    const vManager = { active: true, cameraMode: 'streaming', videoSettings: { device: '/dev/video0' } }
    const mgr = new SecondaryStreams(settings, vManager)
    activeMgr = mgr
    assert.equal(mgr.primaryDevice(), '/dev/video0')
    mgr.addStream({ ...cfgRTSP }, () => {})
    assert.deepEqual(mgr.inUseDevices().sort(), ['/dev/video0', '/dev/video2'])
    // primary not streaming → not counted
    const mgr2 = new SecondaryStreams(settings, { active: true, cameraMode: 'photo', videoSettings: { device: '/dev/video0' } })
    assert.equal(mgr2.primaryDevice(), null)
  })

  it('#mountName / #streamAddress for RTSP and RTP', function () {
    settings.clear()
    const mgr = new SecondaryStreams(settings, noVManager())
    activeMgr = mgr
    assert.equal(mgr.mountName('/dev/video2'), 'devvideo2')
    assert.ok(mgr.streamAddress({ id: 0, config: cfgRTSP }).includes('rtsp://'))
    assert.ok(mgr.streamAddress({ id: 0, config: cfgRTSP }).includes('8555'))
    assert.ok(mgr.streamAddress({ id: 1, config: cfgRTP }).includes('10.0.0.2:5602'))
  })

  it('#buildArgs() for RTSP includes a distinct rtsp-port; RTP includes the udp dest', function () {
    settings.clear()
    const mgr = new SecondaryStreams(settings, noVManager())
    activeMgr = mgr
    const rtsp = mgr.buildArgs({ id: 0, config: cfgRTSP })
    assert.ok(rtsp.includes('--transport=RTSP'))
    assert.ok(rtsp.includes('--rtsp-port=8555'))
    assert.ok(rtsp.includes('--video=/dev/video2'))
    const rtp = mgr.buildArgs({ id: 1, config: cfgRTP })
    assert.ok(rtp.includes('--transport=RTP'))
    assert.ok(rtp.includes('--udp=10.0.0.2:5602'))
  })

  it('#validateConfig() - all branches', function () {
    settings.clear()
    const vManager = { active: true, cameraMode: 'streaming', videoSettings: { device: '/dev/video0' } }
    const mgr = new SecondaryStreams(settings, vManager)
    activeMgr = mgr
    assert.ok(mgr.validateConfig(null).includes('camera'))
    assert.ok(mgr.validateConfig({ device: '' }).includes('camera'))
    assert.ok(mgr.validateConfig({ device: '/dev/video0' }).includes('in use')) // primary's device
    assert.ok(mgr.validateConfig({ device: '/dev/video9', transport: 'RTP', udpIP: '', udpPort: 0 }).includes('RTP'))
    assert.equal(mgr.validateConfig({ device: '/dev/video9', transport: 'RTSP' }), null)
  })

  it('#addStream() - RTSP success, then duplicate device rejected', function () {
    settings.clear()
    const mgr = new SecondaryStreams(settings, noVManager())
    activeMgr = mgr
    let res
    mgr.addStream({ ...cfgRTSP }, (err, streams) => { res = { err, streams } })
    assert.equal(res.err, null)
    assert.equal(mgr.streams.length, 1)
    assert.equal(res.streams[0].config.device, '/dev/video2')
    let dup
    mgr.addStream({ ...cfgRTSP }, (err) => { dup = err })
    assert.ok(dup.includes('in use'))
    assert.equal(mgr.streams.length, 1)
  })

  it('#addStream() - RTP success and validation error', function () {
    settings.clear()
    const mgr = new SecondaryStreams(settings, noVManager())
    activeMgr = mgr
    mgr.addStream({ ...cfgRTP }, () => {})
    assert.equal(mgr.streams.length, 1)
    let bad
    mgr.addStream({ device: '' }, (err) => { bad = err })
    assert.ok(bad)
  })

  it('#addStream() - rejects beyond the maximum', function () {
    settings.clear()
    const mgr = new SecondaryStreams(settings, noVManager())
    activeMgr = mgr
    mgr.addStream({ ...cfgRTSP, device: '/dev/v0' }, () => {})
    mgr.addStream({ ...cfgRTSP, device: '/dev/v1' }, () => {})
    mgr.addStream({ ...cfgRTSP, device: '/dev/v2' }, () => {})
    assert.equal(mgr.streams.length, 3)
    let over
    mgr.addStream({ ...cfgRTSP, device: '/dev/v3' }, (err) => { over = err })
    assert.ok(over.includes('Maximum'))
    assert.equal(mgr.streams.length, 3)
  })

  it('#removeStream() - kills a running stream; errors on unknown id', function (done) {
    settings.clear()
    const mgr = new SecondaryStreams(settings, noVManager())
    activeMgr = mgr
    mgr.addStream({ ...cfgRTSP }, () => {})
    const id = mgr.streams[0].id
    assert.equal(mgr.isRunning(mgr.streams[0]), true)
    mgr.removeStream(id, (err) => {
      try {
        assert.equal(err, null)
        assert.equal(mgr.streams.length, 0)
        let missing
        mgr.removeStream(99, (e) => { missing = e })
        assert.ok(missing)
        done()
      } catch (e) { done(e) }
    })
  })

  it('#removeStream() - handles an already-exited stream', function (done) {
    settings.clear()
    process.env.FAKE_SCENARIO = 'exitfast'
    const mgr = new SecondaryStreams(settings, noVManager())
    activeMgr = mgr
    mgr.addStream({ ...cfgRTSP }, () => {})
    const id = mgr.streams[0].id
    waitFor(() => !mgr.isRunning(mgr.streams[0])).then(() => {
      mgr.removeStream(id, (err) => {
        try { assert.equal(err, null); assert.equal(mgr.streams.length, 0); done() } catch (e) { done(e) }
      })
    }).catch(done)
  })

  it('#startStream() - stdout/stderr/close handlers fire', function (done) {
    settings.clear()
    process.env.FAKE_SCENARIO = 'output'
    const mgr = new SecondaryStreams(settings, noVManager())
    activeMgr = mgr
    let stopped = false
    mgr.eventEmitter.on('stopped', () => { stopped = true })
    mgr.addStream({ ...cfgRTSP }, () => {})
    // give the output a moment, then kill to trigger close
    setTimeout(() => {
      mgr.streams[0].process.kill('SIGKILL')
      waitFor(() => stopped).then(() => done()).catch(done)
    }, 200)
  }).timeout(4000)

  it('#startStream() - spawn error (stale/invalid venv, ENOENT) is handled, not thrown (R3)', function (done) {
    // R3: without an 'error' listener, the child 'error' event (ENOENT on a
    // stale venv path, or spawn EACCES/ENOMEM on a memory-pressured Pi Zero) is
    // thrown by Node and crashes the whole server. The listener must log + clean
    // up: drop the dead process ref (isRunning → false); 'stopped' still fires.
    settings.clear()
    logpaths.getPythonPath.returns(path.join(tmpDir, 'no-such-python'))
    const mgr = new SecondaryStreams(settings, noVManager())
    activeMgr = mgr
    let stopped = -1
    mgr.eventEmitter.on('stopped', (id) => { stopped = id })
    mgr.addStream({ ...cfgRTSP }, () => {})
    const stream = mgr.streams[0]
    const id = stream.id
    waitFor(() => stream.process === null && stopped === id).then(() => {
      try {
        assert.equal(mgr.isRunning(stream), false)
        done()
      } catch (e) { done(e) }
    }).catch(done)
  }).timeout(4000)

  it('restores saved streams on construction', function () {
    settings.clear()
    settings.setValue('camera.secondaryStreams', [{ ...cfgRTSP }, { ...cfgRTP }])
    const mgr = new SecondaryStreams(settings, noVManager())
    activeMgr = mgr
    assert.equal(mgr.streams.length, 2)
    assert.equal(mgr.getStatus().length, 2)
  })

  it('#saveSettings() - logs when the settings store throws', function () {
    settings.clear()
    const mgr = new SecondaryStreams(settings, noVManager())
    activeMgr = mgr
    sinon.stub(settings, 'setValue').throws(new Error('disk full'))
    assert.doesNotThrow(() => mgr.saveSettings())
  })
})
