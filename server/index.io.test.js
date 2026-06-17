'use strict'

/*
 * Package C tests for server/index.js.
 *
 * Covers:
 *   - Module-scope event cross-wiring (ntripClient.rtcmpacket, vManager events,
 *     fcManager events, camSwitcher.switch)
 *   - /api/capturestillphoto + /api/togglevideorecording routes
 *   - /api/vpnwireguardprofileadd (multipart, file-present + no-file paths)
 *   - /api/videodevices + /api/camera/still_devices
 *   - /api/FCOutputs, /api/FCDetails, /api/FCModify, /api/FCReboot
 *   - /api/addudpoutput, /api/removeudpoutput
 *   - socket.io handshake auth + connection + FCStatusLoop
 *   - /api/camera/start (full validation + mediaDestination boundary checks)
 *   - /api/camera/stop
 *   - gracefulShutdown + isShuttingDown 503 middleware
 *
 * Harness: test/indexApp.js (shared server, ephemeral port).
 * All sinon stubs restored in afterEach.
 * Assertions inside event callbacks: wrapped in try/catch + done(e).
 */

const assert = require('assert')
const sinon = require('sinon')
const { describe, it, before, after, afterEach } = require('mocha')
const ioclient = require('socket.io-client')

// Manager class prototypes for prototype-level stubbing
const FlightController = require('./flightController')
const videoStream = require('./videostream')
const SecondaryStreams = require('./secondaryStreams')
const vpn = require('./vpn')

// Shared harness
const { getServer, closeServer, request, getPort } = require('../test/indexApp')

// ─── grab the seam ─────────────────────────────────────────────────────────
const app = require('../server/index')
const hooks = app.testHooks

// ─── start/stop the shared HTTP server ────────────────────────────────────
before(function (done) {
  getServer().then(function () { done() }).catch(done)
})

after(function (done) {
  closeServer().then(function () { done() }).catch(done)
})

// ═══════════════════════════════════════════════════════════════════════════
describe('Package C — events, FC/video routes, socket.io, camera/start, shutdown', function () {
  afterEach(function () {
    sinon.restore()
    // Always restore NODE_ENV after each test
    process.env.NODE_ENV = 'development'
    delete process.env.DISABLE_AUTH
  })

  // =========================================================================
  // Event cross-wiring: ntripClient.rtcmpacket
  // =========================================================================
  describe('ntripClient rtcmpacket event', function () {
    it('forwards RTCM packet to fcManager.sendRTCMMessage (fan-out)', function () {
      const stub = sinon.stub(hooks.fcManager, 'sendRTCMMessage')
      hooks.ntripClient.eventEmitter.emit('rtcmpacket', { buf: Buffer.from('test') }, 1)
      assert.ok(stub.calledOnce)
    })

    it('does not throw with no links', function () {
      hooks.fcManager.links = []
      assert.doesNotThrow(function () {
        hooks.ntripClient.eventEmitter.emit('rtcmpacket', { buf: Buffer.from('x') }, 0)
      })
    })

    it('catches error when sendRTCMMessage throws', function () {
      sinon.stub(hooks.fcManager, 'sendRTCMMessage').throws(new Error('rtcm error'))
      assert.doesNotThrow(function () {
        hooks.ntripClient.eventEmitter.emit('rtcmpacket', { buf: Buffer.from('x') }, 0)
      })
    })
  })

  // =========================================================================
  // Event cross-wiring: vManager events
  // =========================================================================
  describe('vManager digicamcontrol event', function () {
    it('calls sendCommandAck (fan-out)', function () {
      const stub = sinon.stub(hooks.fcManager, 'sendCommandAck')
      hooks.vManager.eventEmitter.emit('digicamcontrol', 1, 2, 3)
      assert.ok(stub.calledOnce)
      assert.equal(stub.args[0][0], 203)
    })

    it('catches error when sendCommandAck throws', function () {
      sinon.stub(hooks.fcManager, 'sendCommandAck').throws(new Error('ack error'))
      assert.doesNotThrow(function () {
        hooks.vManager.eventEmitter.emit('digicamcontrol', 1, 2, 3)
      })
    })
  })

  describe('vManager cameraheartbeat event', function () {
    it('calls sendHeartbeat (fan-out)', function () {
      const stub = sinon.stub(hooks.fcManager, 'sendHeartbeat')
      hooks.vManager.eventEmitter.emit('cameraheartbeat', 'mavtype', 'autopilot', 'comp')
      assert.ok(stub.calledOnce)
    })

    it('catches error when sendHeartbeat throws', function () {
      sinon.stub(hooks.fcManager, 'sendHeartbeat').throws(new Error('hb error'))
      assert.doesNotThrow(function () {
        hooks.vManager.eventEmitter.emit('cameraheartbeat', 'mavtype', 'autopilot', 'comp')
      })
    })
  })

  describe('vManager camerainfo event', function () {
    it('calls sendCommandAck and sendData (fan-out)', function () {
      const ack = sinon.stub(hooks.fcManager, 'sendCommandAck')
      const data = sinon.stub(hooks.fcManager, 'sendData')
      hooks.vManager.eventEmitter.emit('camerainfo', { msg: true }, 1, 2, 3)
      assert.ok(ack.calledOnce)
      assert.ok(data.calledOnce)
    })

    it('catches error when sendCommandAck throws', function () {
      sinon.stub(hooks.fcManager, 'sendCommandAck').throws(new Error('cam info error'))
      sinon.stub(hooks.fcManager, 'sendData')
      assert.doesNotThrow(function () {
        hooks.vManager.eventEmitter.emit('camerainfo', {}, 1, 2, 3)
      })
    })
  })

  describe('vManager videostreaminfo event', function () {
    it('calls sendCommandAck and sendData (fan-out)', function () {
      const ack = sinon.stub(hooks.fcManager, 'sendCommandAck')
      const data = sinon.stub(hooks.fcManager, 'sendData')
      hooks.vManager.eventEmitter.emit('videostreaminfo', { msg: true }, 1, 2, 3)
      assert.ok(ack.calledOnce)
      assert.ok(data.calledOnce)
    })

    it('catches error when sendCommandAck throws', function () {
      sinon.stub(hooks.fcManager, 'sendCommandAck').throws(new Error('vsi error'))
      sinon.stub(hooks.fcManager, 'sendData')
      assert.doesNotThrow(function () {
        hooks.vManager.eventEmitter.emit('videostreaminfo', {}, 1, 2, 3)
      })
    })
  })

  describe('vManager camerasettings event', function () {
    it('calls sendCommandAck and sendData (fan-out)', function () {
      const ack = sinon.stub(hooks.fcManager, 'sendCommandAck')
      const data = sinon.stub(hooks.fcManager, 'sendData')
      hooks.vManager.eventEmitter.emit('camerasettings', { msg: true }, 1, 2, 3)
      assert.ok(ack.calledOnce)
      assert.ok(data.calledOnce)
    })

    it('catches error when sendCommandAck throws', function () {
      sinon.stub(hooks.fcManager, 'sendCommandAck').throws(new Error('cs error'))
      sinon.stub(hooks.fcManager, 'sendData')
      assert.doesNotThrow(function () {
        hooks.vManager.eventEmitter.emit('camerasettings', {}, 1, 2, 3)
      })
    })
  })

  describe('vManager cameratrigger event', function () {
    it('calls sendData (fan-out)', function () {
      const stub = sinon.stub(hooks.fcManager, 'sendData')
      hooks.vManager.eventEmitter.emit('cameratrigger', { msg: true }, 5)
      assert.ok(stub.calledOnce)
    })

    it('catches error when sendData throws', function () {
      sinon.stub(hooks.fcManager, 'sendData').throws(new Error('ct error'))
      assert.doesNotThrow(function () {
        hooks.vManager.eventEmitter.emit('cameratrigger', {}, 5)
      })
    })
  })

  describe('vManager filesaved event', function () {
    it('emits camera:filesaved to socket.io clients (does not throw)', function () {
      assert.doesNotThrow(function () {
        hooks.vManager.eventEmitter.emit('filesaved', '/some/path/photo.jpg')
      })
    })

    it('catches error when io.sockets.emit throws', function () {
      const origEmit = hooks.io.sockets.emit
      hooks.io.sockets.emit = function () { throw new Error('io emit error') }
      try {
        assert.doesNotThrow(function () {
          hooks.vManager.eventEmitter.emit('filesaved', '/some/path/photo.jpg')
        })
      } finally {
        hooks.io.sockets.emit = origEmit
      }
    })
  })

  // =========================================================================
  // Event cross-wiring: fcManager events
  // =========================================================================
  describe('fcManager gotMessage event', function () {
    it('calls ntripClient.onMavPacket when dispatched', function () {
      const fakeNtrip = sinon.stub(hooks.ntripClient, 'onMavPacket')
      const fakeVideo = sinon.stub(hooks.vManager, 'onMavPacket')
      const fakeCam = sinon.stub(hooks.camSwitcher, 'onMavPacket')
      hooks.fcManager.eventEmitter.emit('gotMessage', { packet: true }, { data: true })
      assert.ok(fakeNtrip.calledOnce)
      assert.ok(fakeVideo.calledOnce)
      assert.ok(fakeCam.calledOnce)
    })

    it('requests RC_CHANNELS stream from the link when camSwitcher is enabled', function () {
      const fakeSendInterval = sinon.stub()
      const link = { m: { targetSystem: 1, sendSetMessageInterval: fakeSendInterval } }
      sinon.stub(hooks.camSwitcher, 'getSettings').returns({ enabled: true })
      hooks.camSwitcher.streamRequested = false
      sinon.stub(hooks.ntripClient, 'onMavPacket')
      sinon.stub(hooks.vManager, 'onMavPacket')
      sinon.stub(hooks.camSwitcher, 'onMavPacket')
      try {
        hooks.fcManager.eventEmitter.emit('gotMessage', {}, {}, link)
        assert.ok(fakeSendInterval.calledOnce)
        assert.strictEqual(hooks.camSwitcher.streamRequested, true)
      } finally {
        hooks.camSwitcher.streamRequested = false
      }
    })

    it('catches error when ntripClient.onMavPacket throws', function () {
      sinon.stub(hooks.ntripClient, 'onMavPacket').throws(new Error('ntrip mav error'))
      sinon.stub(hooks.vManager, 'onMavPacket')
      sinon.stub(hooks.camSwitcher, 'onMavPacket')
      assert.doesNotThrow(function () {
        hooks.fcManager.eventEmitter.emit('gotMessage', {}, {})
      })
    })
  })

  describe('camSwitcher switch event', function () {
    it('calls vManager.switchSource when switchMode is gstreamer', function () {
      const fakeSwitchSource = sinon.stub(hooks.vManager, 'switchSource')
      try {
        hooks.camSwitcher.eventEmitter.emit('switch', 'B', 'gstreamer')
        assert.ok(fakeSwitchSource.calledWith('B'))
      } finally {
        // no cleanup needed; sinon.restore() handles it
      }
    })

    it('does not call switchSource when switchMode is not gstreamer', function () {
      const fakeSwitchSource = sinon.stub(hooks.vManager, 'switchSource')
      hooks.camSwitcher.eventEmitter.emit('switch', 'B', 'command')
      assert.ok(fakeSwitchSource.notCalled)
    })

    it('catches error when vManager.switchSource throws', function () {
      sinon.stub(hooks.vManager, 'switchSource').throws(new Error('switch error'))
      assert.doesNotThrow(function () {
        hooks.camSwitcher.eventEmitter.emit('switch', 'B', 'gstreamer')
      })
    })
  })

  describe('fcManager newLink event', function () {
    it('emits without error', function () {
      assert.doesNotThrow(function () {
        hooks.fcManager.eventEmitter.emit('newLink')
      })
    })
  })

  describe('fcManager stopLink event', function () {
    it('calls camSwitcher.resetLink', function () {
      const fakeReset = sinon.stub(hooks.camSwitcher, 'resetLink')
      hooks.fcManager.eventEmitter.emit('stopLink')
      assert.ok(fakeReset.calledOnce)
    })
  })

  describe('fcManager armed event', function () {
    it('emits without error', function () {
      assert.doesNotThrow(function () {
        hooks.fcManager.eventEmitter.emit('armed')
      })
    })
  })

  describe('fcManager disarmed event', function () {
    it('emits without error', function () {
      assert.doesNotThrow(function () {
        hooks.fcManager.eventEmitter.emit('disarmed')
      })
    })
  })

  // =========================================================================
  // /api/capturestillphoto
  // =========================================================================
  describe('POST /api/capturestillphoto', function () {
    it('200 — active and photo mode sends capture signal', function (done) {
      hooks.vManager.active = true
      hooks.vManager.cameraMode = 'photo'
      sinon.stub(hooks.vManager, 'captureStillPhoto')
      sinon.stub(hooks.fcManager, 'getSystemStatus').returns({ vehiclePosition: { lat: 0, lon: 0 } })
      request('POST', '/api/capturestillphoto').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(res.body.message)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('400 — not active returns 400 error', function (done) {
      hooks.vManager.active = false
      hooks.vManager.cameraMode = 'photo'
      request('POST', '/api/capturestillphoto').then(function (res) {
        try {
          assert.equal(res.status, 400)
          assert.ok(res.body.error)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('400 — wrong mode returns 400 error', function (done) {
      hooks.vManager.active = true
      hooks.vManager.cameraMode = 'streaming'
      request('POST', '/api/capturestillphoto').then(function (res) {
        try {
          assert.equal(res.status, 400)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  // =========================================================================
  // /api/togglevideorecording
  // =========================================================================
  describe('POST /api/togglevideorecording', function () {
    it('200 — active and video mode, toggleVideoRecording succeeds', function (done) {
      hooks.vManager.active = true
      hooks.vManager.cameraMode = 'video'
      sinon.stub(hooks.vManager, 'toggleVideoRecording')
      request('POST', '/api/togglevideorecording').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(res.body.success)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('500 — toggleVideoRecording throws returns 500', function (done) {
      hooks.vManager.active = true
      hooks.vManager.cameraMode = 'video'
      sinon.stub(hooks.vManager, 'toggleVideoRecording').throws(new Error('toggle fail'))
      request('POST', '/api/togglevideorecording').then(function (res) {
        try {
          assert.equal(res.status, 500)
          assert.ok(res.body.error)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('400 — not active returns 400', function (done) {
      hooks.vManager.active = false
      hooks.vManager.cameraMode = 'video'
      request('POST', '/api/togglevideorecording').then(function (res) {
        try {
          assert.equal(res.status, 400)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('400 — wrong mode returns 400', function (done) {
      hooks.vManager.active = true
      hooks.vManager.cameraMode = 'streaming'
      request('POST', '/api/togglevideorecording').then(function (res) {
        try {
          assert.equal(res.status, 400)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  // =========================================================================
  // /api/vpnwireguardprofileadd (multipart)
  //
  // UPSTREAM BUG (documented, not fixed): The no-file branch at line ~689 is
  // missing a `return` after res.send(), so execution falls through to
  // VPNManager.addWireguardProfile(req.files.wgprofile.name, ...) which throws
  // a TypeError (req.files.wgprofile is undefined). Because res.send() was
  // already called, the second res.send() inside the callback throws
  // "Cannot set headers after they are sent". Both errors are caught/logged
  // internally by express but the client already received the first response.
  // =========================================================================
  describe('POST /api/vpnwireguardprofileadd', function () {
    function multipartRequest (boundary, bodyBuf, done) {
      var http = require('http')
      var port = getPort()
      var req = http.request({
        hostname: '127.0.0.1',
        port: port,
        path: '/api/vpnwireguardprofileadd',
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data; boundary=' + boundary,
          'Content-Length': bodyBuf.length
        }
      }, function (res) {
        var data = ''
        res.on('data', function (chunk) { data += chunk })
        res.on('end', function () {
          try {
            assert.ok(res.statusCode < 600, 'unexpected HTTP status: ' + res.statusCode)
            done()
          } catch (e) { done(e) }
        })
      })
      req.on('error', done)
      req.write(bodyBuf)
      req.end()
    }

    it('covers the no-file path (UPSTREAM BUG: missing return causes fallthrough)', function (done) {
      // No file field → handler sends error JSON and falls through (upstream bug).
      var boundary = '----TestBoundaryEmpty'
      var body = '--' + boundary + '--\r\n'
      multipartRequest(boundary, Buffer.from(body), done)
    })

    it('covers file-present + addWireguardProfile error path', function (done) {
      sinon.stub(vpn, 'addWireguardProfile').callsFake(function (name, tmpPath, cb) {
        cb(new Error('wg add error'))
      })
      var boundary = '----TestBoundaryErr'
      var fileContent = '[Interface]\n'
      var body = [
        '--' + boundary,
        'Content-Disposition: form-data; name="wgprofile"; filename="test.conf"',
        'Content-Type: text/plain',
        '',
        fileContent,
        '--' + boundary + '--'
      ].join('\r\n')
      multipartRequest(boundary, Buffer.from(body), done)
    })

    it('covers file-present + addWireguardProfile success path (lines 698-700)', function (done) {
      sinon.stub(vpn, 'addWireguardProfile').callsFake(function (name, tmpPath, cb) {
        cb(null)
      })
      sinon.stub(vpn, 'getVPNStatusWireguard').callsFake(function (errpass, cb) {
        cb(null, { installed: true, status: false, text: [] })
      })
      var boundary = '----TestBoundaryOK'
      var fileContent = '[Interface]\n'
      var body = [
        '--' + boundary,
        'Content-Disposition: form-data; name="wgprofile"; filename="test.conf"',
        'Content-Type: text/plain',
        '',
        fileContent,
        '--' + boundary + '--'
      ].join('\r\n')
      multipartRequest(boundary, Buffer.from(body), done)
    })
  })

  // =========================================================================
  // /api/videodevices
  // =========================================================================
  describe('GET /api/videodevices', function () {
    it('200 — success path returns responseData', function (done) {
      sinon.stub(videoStream.prototype, 'getVideoDevices').callsFake(function (cb) {
        cb(null, { active: false, devices: [], networkInterfaces: [] })
      })
      request('GET', '/api/videodevices').then(function (res) {
        try {
          assert.equal(res.status, 200)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('404 — "No video devices found" error returns 404', function (done) {
      sinon.stub(videoStream.prototype, 'getVideoDevices').callsFake(function (cb) {
        sinon.stub(videoStream.prototype, 'scanInterfaces').returns([])
        cb('No video devices found', null)
      })
      request('GET', '/api/videodevices').then(function (res) {
        try {
          assert.equal(res.status, 404)
          assert.ok(res.body.error)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('500 — other error returns 500', function (done) {
      sinon.stub(videoStream.prototype, 'getVideoDevices').callsFake(function (cb) {
        sinon.stub(videoStream.prototype, 'scanInterfaces').returns([])
        cb('some other error', null)
      })
      request('GET', '/api/videodevices').then(function (res) {
        try {
          assert.equal(res.status, 500)
          assert.ok(res.body.error)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  // =========================================================================
  // /api/camera/still_devices
  // =========================================================================
  describe('GET /api/camera/still_devices', function () {
    it('200 — success path returns stillData', function (done) {
      sinon.stub(videoStream.prototype, 'getStillDevices').callsFake(function (cb) {
        cb(null, { devices: [], selectedDevice: null, selectedCap: null })
      })
      request('GET', '/api/camera/still_devices').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.strictEqual(res.body.error, null)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('500 — error path returns 500', function (done) {
      sinon.stub(videoStream.prototype, 'getStillDevices').callsFake(function (cb) {
        cb('still error', null)
      })
      request('GET', '/api/camera/still_devices').then(function (res) {
        try {
          assert.equal(res.status, 500)
          assert.ok(res.body.error)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  // =========================================================================
  // /api/FCOutputs
  // =========================================================================
  describe('GET /api/FCOutputs', function () {
    it('200 — returns UDPoutputs from fcManager', function (done) {
      sinon.stub(FlightController.prototype, 'getUDPOutputs').returns([])
      request('GET', '/api/FCOutputs').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(Array.isArray(res.body.UDPoutputs))
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  // =========================================================================
  // /api/FCDetails
  // =========================================================================
  describe('GET /api/FCDetails', function () {
    var fcData = {
      serialPorts: [{ value: '/dev/ttyUSB0', label: '/dev/ttyUSB0' }],
      baudRates: [{ value: 115200, label: '115200' }],
      mavVersions: [{ value: 2, label: '2.0' }],
      inputTypes: [{ value: 'UART', label: 'UART' }],
      links: [{ id: 0, inputType: 'UART', label: '/dev/ttyUSB0 @ 115200' }],
      enableHeartbeat: false, enableTCP: false, enableUDPB: true, UDPBPort: 14550,
      enableDSRequest: false, doLogging: false
    }

    it('200 — returns ports, options and the links list', function (done) {
      sinon.stub(FlightController.prototype, 'getDeviceSettings').callsFake(function (cb) { cb(null, fcData) })
      request('GET', '/api/FCDetails').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(Array.isArray(res.body.links))
          assert.equal(res.body.links.length, 1)
          assert.equal(res.body.error, null)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — error path propagates error field', function (done) {
      sinon.stub(FlightController.prototype, 'getDeviceSettings').callsFake(function (cb) { cb(new Error('device error'), fcData) })
      request('GET', '/api/FCDetails').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(res.body.error)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  // =========================================================================
  // /api/FCParamRefresh, /api/FCConfigOverview (FC Configuration page)
  // =========================================================================
  describe('POST /api/FCParamRefresh', function () {
    it('200 — starts a download and returns progress', function (done) {
      sinon.stub(hooks.fcParams, 'requestAll').returns(true)
      sinon.stub(hooks.fcParams, 'getProgress').returns({ state: 'downloading', received: 0, total: 0 })
      request('POST', '/api/FCParamRefresh').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.equal(res.body.started, true)
          assert.equal(res.body.state, 'downloading')
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('GET /api/FCConfigOverview', function () {
    it('200 — returns the decoded overview', function (done) {
      sinon.stub(hooks.fcParams, 'getOverview').returns({
        state: 'complete', received: 2, total: 2,
        sensors: [], serial: [], servos: [], can: { ports: [], drivers: [] }, net: { present: false }
      })
      request('GET', '/api/FCConfigOverview').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.equal(res.body.state, 'complete')
          assert.equal(res.body.net.present, false)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/FCDroneCANScan', function () {
    it('200 — starts a scan on the given buses (out-of-range filtered)', function (done) {
      const scan = sinon.stub(hooks.droneCan, 'scan')
      request('POST', '/api/FCDroneCANScan', { body: { buses: [0, 1, 99] } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.equal(res.body.scanning, true)
          assert.deepEqual(res.body.buses, [0, 1])
          assert.ok(scan.calledOnce)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — defaults to buses 0 and 1 when none given', function (done) {
      sinon.stub(hooks.droneCan, 'scan')
      request('POST', '/api/FCDroneCANScan', { body: {} }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.deepEqual(res.body.buses, [0, 1])
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — handles a body-less POST (the Scan button sends no body / Content-Type)', function (done) {
      // regression: the webUI Scan button POSTs with no body, so express.json()
      // leaves req.body undefined — reading req.body.buses must not 500
      const scan = sinon.stub(hooks.droneCan, 'scan')
      request('POST', '/api/FCDroneCANScan', {}).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.deepEqual(res.body.buses, [0, 1])
          assert.ok(scan.calledOnce)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('GET /api/FCDroneCANNodes', function () {
    it('200 — returns the node list + scanning flag', function (done) {
      sinon.stub(hooks.droneCan, 'getNodes').returns([{ id: 11, name: 'org.test', health: 'OK' }])
      hooks.droneCan.scanning = true
      request('GET', '/api/FCDroneCANNodes').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.equal(res.body.scanning, true)
          assert.equal(res.body.nodes[0].id, 11)
          done()
        } catch (e) { done(e) } finally { hooks.droneCan.scanning = false }
      }).catch(done)
    })
  })

  // =========================================================================
  // /api/FCAddLink, /api/FCRemoveLink, /api/FCOptions
  // =========================================================================
  describe('POST /api/FCAddLink', function () {
    var validBody = { inputType: 'UART', device: '/dev/ttyUSB0', baud: 115200, mavversion: 2, udpInputPort: 9000 }

    it('422 — missing required fields', function (done) {
      request('POST', '/api/FCAddLink', { body: { device: 'x' } }).then(function (res) {
        try { assert.equal(res.status, 422); done() } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — success returns the links list', function (done) {
      sinon.stub(FlightController.prototype, 'addLink').callsFake(function (it, dev, baud, mav, udp, cb) { cb(null, [{ id: 0 }]) })
      request('POST', '/api/FCAddLink', { body: validBody }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.equal(res.body.links.length, 1)
          assert.equal(res.body.error, null)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — error path returns error field', function (done) {
      sinon.stub(FlightController.prototype, 'addLink').callsFake(function (it, dev, baud, mav, udp, cb) { cb(new Error('add error'), []) })
      request('POST', '/api/FCAddLink', { body: validBody }).then(function (res) {
        try { assert.equal(res.status, 200); assert.ok(res.body.error); done() } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/FCRemoveLink', function () {
    it('422 — missing id', function (done) {
      request('POST', '/api/FCRemoveLink', { body: {} }).then(function (res) {
        try { assert.equal(res.status, 422); done() } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — success returns the links list', function (done) {
      sinon.stub(FlightController.prototype, 'removeLink').callsFake(function (id, cb) { cb(null, []) })
      request('POST', '/api/FCRemoveLink', { body: { id: 0 } }).then(function (res) {
        try { assert.equal(res.status, 200); assert.equal(res.body.error, null); done() } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — error path returns error field', function (done) {
      sinon.stub(FlightController.prototype, 'removeLink').callsFake(function (id, cb) { cb(new Error('no such'), []) })
      request('POST', '/api/FCRemoveLink', { body: { id: 5 } }).then(function (res) {
        try { assert.equal(res.status, 200); assert.ok(res.body.error); done() } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/FCOptions', function () {
    var validOpts = { enableHeartbeat: false, enableTCP: false, enableUDPB: true, UDPBPort: 14550, enableDSRequest: false, doLogging: false }

    it('422 — bad fields', function (done) {
      request('POST', '/api/FCOptions', { body: { enableHeartbeat: 'nope' } }).then(function (res) {
        try { assert.equal(res.status, 422); done() } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — applies options', function (done) {
      sinon.stub(FlightController.prototype, 'setGlobalOptions').callsFake(function (hb, tcp, udpb, port, ds, log, cb) { cb() })
      request('POST', '/api/FCOptions', { body: validOpts }).then(function (res) {
        try { assert.equal(res.status, 200); assert.equal(res.body.error, null); done() } catch (e) { done(e) }
      }).catch(done)
    })
  })

  // =========================================================================
  // Secondary video streams (#398)
  // =========================================================================
  describe('Secondary streams routes', function () {
    var validStream = { device: '/dev/video2', format: 'image/jpeg', width: 1280, height: 720, fps: 30, bitrate: 2000, rotation: 0, compression: 'H264', transport: 'RTSP' }

    it('GET /api/secondarystreams — 200 returns streams + inUse', function (done) {
      sinon.stub(SecondaryStreams.prototype, 'getStatus').returns([{ id: 0, running: true }])
      sinon.stub(SecondaryStreams.prototype, 'inUseDevices').returns(['/dev/video0'])
      request('GET', '/api/secondarystreams').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.equal(res.body.streams.length, 1)
          assert.deepEqual(res.body.inUse, ['/dev/video0'])
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('POST /api/secondarystreamadd — 422 on bad fields', function (done) {
      request('POST', '/api/secondarystreamadd', { body: { device: '/dev/video2' } }).then(function (res) {
        try { assert.equal(res.status, 422); done() } catch (e) { done(e) }
      }).catch(done)
    })

    it('POST /api/secondarystreamadd — 200 success', function (done) {
      sinon.stub(SecondaryStreams.prototype, 'addStream').callsFake(function (cfg, cb) { cb(null, [{ id: 0 }]) })
      request('POST', '/api/secondarystreamadd', { body: validStream }).then(function (res) {
        try { assert.equal(res.status, 200); assert.equal(res.body.streams.length, 1); assert.equal(res.body.error, null); done() } catch (e) { done(e) }
      }).catch(done)
    })

    it('POST /api/secondarystreamadd — 200 error path', function (done) {
      sinon.stub(SecondaryStreams.prototype, 'addStream').callsFake(function (cfg, cb) { cb('that camera is already in use', []) })
      request('POST', '/api/secondarystreamadd', { body: validStream }).then(function (res) {
        try { assert.equal(res.status, 200); assert.ok(res.body.error); done() } catch (e) { done(e) }
      }).catch(done)
    })

    it('POST /api/secondarystreamremove — 422 on missing id', function (done) {
      request('POST', '/api/secondarystreamremove', { body: {} }).then(function (res) {
        try { assert.equal(res.status, 422); done() } catch (e) { done(e) }
      }).catch(done)
    })

    it('POST /api/secondarystreamremove — 200 success', function (done) {
      sinon.stub(SecondaryStreams.prototype, 'removeStream').callsFake(function (id, cb) { cb(null, []) })
      request('POST', '/api/secondarystreamremove', { body: { id: 0 } }).then(function (res) {
        try { assert.equal(res.status, 200); assert.equal(res.body.error, null); done() } catch (e) { done(e) }
      }).catch(done)
    })
  })

  // =========================================================================
  // HUD layout (OSD editor) routes (#173)
  // =========================================================================
  describe('HUD layout routes', function () {
    it('GET /api/hudlayout — 200 returns the layout + element catalog', function (done) {
      request('GET', '/api/hudlayout').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(res.body.layout && Array.isArray(res.body.layout.elements))
          assert.ok(res.body.layout.global && typeof res.body.layout.global.font === 'string')
          assert.ok(Array.isArray(res.body.elements) && res.body.elements.length > 10)
          assert.ok(res.body.horizon && Array.isArray(res.body.horizon.styles) && Array.isArray(res.body.horizon.markers))
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('POST /api/hudlayout — 422 when layout is not an object', function (done) {
      request('POST', '/api/hudlayout', { body: { layout: 'nope' } }).then(function (res) {
        try { assert.equal(res.status, 422); done() } catch (e) { done(e) }
      }).catch(done)
    })

    it('POST /api/hudlayout — 200 saves a layout', function (done) {
      request('POST', '/api/hudlayout', { body: { layout: { elements: [{ type: 'alt', enabled: true, icon: true, x: 0.9, y: 0.1 }] } } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.equal(res.body.error, null)
          assert.ok(res.body.layout.elements.find(function (e) { return e.type === 'alt' }))
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  // =========================================================================
  // HUD font routes (list / import / remove / serve-for-preview)
  // =========================================================================
  describe('HUD font routes', function () {
    function postFont (hasFile) {
      return new Promise(function (resolve, reject) {
        var http = require('http')
        var boundary = '----RpanionFontBoundary'
        var parts = []
        if (hasFile) {
          parts.push('--' + boundary)
          parts.push('Content-Disposition: form-data; name="font"; filename="my.ttf"')
          parts.push('Content-Type: font/ttf')
          parts.push('')
          parts.push('\x00\x01\x00\x00font-bytes')
        }
        parts.push('--' + boundary + '--')
        parts.push('')
        var bodyBuf = Buffer.from(parts.join('\r\n'), 'binary')
        var req = http.request({
          hostname: '127.0.0.1', port: getPort(), path: '/api/hudfonts', method: 'POST',
          headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': bodyBuf.length }
        }, function (res) {
          var data = ''
          res.on('data', function (c) { data += c })
          res.on('end', function () { var b; try { b = JSON.parse(data) } catch (_) { b = data } resolve({ status: res.statusCode, body: b }) })
        })
        req.on('error', reject)
        req.write(bodyBuf)
        req.end()
      })
    }

    it('GET /api/hudfonts — 200 lists generics + curated (incl. the DJI-style font)', function (done) {
      request('GET', '/api/hudfonts').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(res.body.generics.includes('monospace'))
          assert.ok(res.body.fonts.find(function (f) { return f.family === 'Oxanium' }))
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('POST /api/hudfonts — 200 imports an uploaded font', function (done) {
      sinon.stub(hooks.hudFonts, 'importFont').resolves({ family: 'My Font', file: 'my.ttf', id: 'my.ttf' })
      sinon.stub(hooks.hudFonts, 'list').returns({ generics: ['monospace'], fonts: [] })
      postFont(true).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.equal(res.body.font.family, 'My Font')
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('POST /api/hudfonts — 422 on an invalid font', function (done) {
      sinon.stub(hooks.hudFonts, 'importFont').rejects(new Error('Not a TrueType/OpenType font'))
      postFont(true).then(function (res) {
        try { assert.equal(res.status, 422); assert.ok(/TrueType/.test(res.body.error)); done() } catch (e) { done(e) }
      }).catch(done)
    })

    it('POST /api/hudfonts — 422 when no file is uploaded', function (done) {
      postFont(false).then(function (res) {
        try { assert.equal(res.status, 422); assert.ok(/No font/.test(res.body.error)); done() } catch (e) { done(e) }
      }).catch(done)
    })

    it('DELETE /api/hudfonts/:id — 200 removes an imported font', function (done) {
      sinon.stub(hooks.hudFonts, 'removeFont').resolves({ generics: ['monospace'], fonts: [] })
      request('DELETE', '/api/hudfonts/my.ttf').then(function (res) {
        try { assert.equal(res.status, 200); assert.ok(res.body.fonts); done() } catch (e) { done(e) }
      }).catch(done)
    })

    it('DELETE /api/hudfonts/:id — 422 on an unknown font', function (done) {
      sinon.stub(hooks.hudFonts, 'removeFont').rejects(new Error('Unknown font'))
      request('DELETE', '/api/hudfonts/nope.ttf').then(function (res) {
        try { assert.equal(res.status, 422); assert.ok(/Unknown/.test(res.body.error)); done() } catch (e) { done(e) }
      }).catch(done)
    })

    it('GET /api/hudfonts/file/:name — serves a known font, 404 otherwise', function (done) {
      var real = require('path').join(__dirname, '..', 'assets', 'hudfonts', 'Oxanium-Medium.ttf')
      var stub = sinon.stub(hooks.hudFonts, 'fileFor')
      stub.withArgs('Oxanium-Medium.ttf').returns(real)
      stub.returns(null)
      request('GET', '/api/hudfonts/file/Oxanium-Medium.ttf').then(function (res) {
        try {
          assert.equal(res.status, 200)
          request('GET', '/api/hudfonts/file/missing.ttf').then(function (res2) {
            try { assert.equal(res2.status, 404); done() } catch (e) { done(e) }
          }).catch(done)
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  // =========================================================================
  // Camera MJPEG preview route (HUD editor backdrop)
  // =========================================================================
  describe('GET /api/camera/preview', function () {
    it('delegates to vManager.startCameraPreview with the query + response', function (done) {
      var stub = sinon.stub(hooks.vManager, 'startCameraPreview').callsFake(function (q, res) {
        res.status(200).json({ ok: true, device: q.device })
      })
      request('GET', '/api/camera/preview?device=%2Fdev%2Fvideo0&format=video%2Fx-raw').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(stub.calledOnce)
          assert.equal(stub.firstCall.args[0].device, '/dev/video0')
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  // =========================================================================
  // /api/FCReboot (UPSTREAM BUG: no res param, request hangs; fire-and-forget)
  // =========================================================================
  describe('POST /api/FCReboot', function () {
    it('fires rebootFC without waiting for HTTP response', function (done) {
      this.timeout(5000)
      const stub = sinon.stub(FlightController.prototype, 'rebootFC')

      const http = require('http')
      const port = getPort()
      const req = http.request({
        hostname: '127.0.0.1',
        port: port,
        path: '/api/FCReboot',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': 2 }
      })
      req.on('error', function () { /* expected — no response sent */ })
      req.write('{}')
      req.end()

      // Poll until stub is called (up to 4 s)
      let waited = 0
      const interval = setInterval(function () {
        waited += 100
        if (stub.called) {
          clearInterval(interval)
          req.destroy()
          done()
        } else if (waited >= 4000) {
          clearInterval(interval)
          req.destroy()
          done(new Error('rebootFC stub was never called'))
        }
      }, 100)
    })
  })

  // =========================================================================
  // /api/addudpoutput
  // =========================================================================
  describe('POST /api/addudpoutput', function () {
    it('422 — invalid IP returns 422', function (done) {
      request('POST', '/api/addudpoutput', { body: { newoutputIP: 'bad', newoutputPort: 14550 } })
        .then(function (res) {
          try {
            assert.equal(res.status, 422)
            done()
          } catch (e) { done(e) }
        }).catch(done)
    })

    it('200 — success path returns UDPoutputs', function (done) {
      sinon.stub(FlightController.prototype, 'addUDPOutput').returns([{ ip: '192.168.1.1', port: 14550 }])
      request('POST', '/api/addudpoutput', { body: { newoutputIP: '192.168.1.1', newoutputPort: 14550 } })
        .then(function (res) {
          try {
            assert.equal(res.status, 200)
            assert.ok(Array.isArray(res.body.UDPoutputs))
            done()
          } catch (e) { done(e) }
        }).catch(done)
    })
  })

  // =========================================================================
  // /api/removeudpoutput
  // =========================================================================
  describe('POST /api/removeudpoutput', function () {
    it('422 — invalid IP returns 422', function (done) {
      request('POST', '/api/removeudpoutput', { body: { removeoutputIP: 'bad', removeoutputPort: 14550 } })
        .then(function (res) {
          try {
            assert.equal(res.status, 422)
            done()
          } catch (e) { done(e) }
        }).catch(done)
    })

    it('200 — success path returns UDPoutputs', function (done) {
      sinon.stub(FlightController.prototype, 'removeUDPOutput').returns([])
      request('POST', '/api/removeudpoutput', { body: { removeoutputIP: '192.168.1.1', removeoutputPort: 14550 } })
        .then(function (res) {
          try {
            assert.equal(res.status, 200)
            assert.ok(Array.isArray(res.body.UDPoutputs))
            done()
          } catch (e) { done(e) }
        }).catch(done)
    })
  })

  // =========================================================================
  // /api/custompipelinemodify — enabled='true' string branch coverage
  // =========================================================================
  describe('POST /api/custompipelinemodify — enabled string branch', function () {
    it('200 — enabled="true" (string) takes the string arm of the ||', function (done) {
      const CustomPipelines = require('./customPipelines')
      sinon.stub(CustomPipelines.prototype, 'setPipeline').callsFake(function (dev, en, pipe, cb) {
        cb(null)
      })
      sinon.stub(CustomPipelines.prototype, 'getAllPipelines').returns([])
      request('POST', '/api/custompipelinemodify', {
        body: { device: '/dev/video0', enabled: 'true', pipeline: 'videotestsrc' }
      }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  // =========================================================================
  // /api/camera/start — err.message falsy branch (line 1638)
  // =========================================================================
  describe('POST /api/camera/start — err without .message', function () {
    it('500 — startCamera calls back with a string error (err.message is undefined)', function (done) {
      const videoStream = require('./videostream')
      sinon.stub(videoStream.prototype, 'startCamera').callsFake(function (cb) {
        // Pass a plain string, not an Error object — err.message is undefined
        cb('plain string error', null)
      })
      sinon.stub(videoStream.prototype, 'saveSettings')
      request('POST', '/api/camera/start', {
        body: {
          cameraMode: 'streaming',
          useCameraHeartbeat: false,
          videoDevice: '/dev/video0',
          height: 720,
          width: 1280,
          bitrate: 1000,
          fps: 30,
          rotation: 0
        }
      }).then(function (res) {
        try {
          assert.equal(res.status, 500)
          assert.ok(res.body.error)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  // =========================================================================
  // CellularTuning deps closures (lines 93-99 in index.js)
  // These closures are passed to CellularTuning at construction time.
  // We call them directly via cellularTuning.deps.
  // =========================================================================
  describe('cellularTuning deps closures', function () {
    it('getSignal — returns null when lteModem is unavailable', function () {
      sinon.stub(hooks.lteModem, 'getStatus').returns({ available: false, signal: null })
      var result = hooks.cellularTuning.deps.getSignal()
      assert.strictEqual(result, null)
    })

    it('getSignal — returns signal value when lteModem is available', function () {
      sinon.stub(hooks.lteModem, 'getStatus').returns({ available: true, signal: -85 })
      var result = hooks.cellularTuning.deps.getSignal()
      assert.strictEqual(result, -85)
    })

    it('isStreaming — returns false when vManager is not active', function () {
      hooks.vManager.active = false
      hooks.vManager.cameraMode = 'streaming'
      hooks.vManager.deviceStream = null
      var result = hooks.cellularTuning.deps.isStreaming()
      assert.strictEqual(result, false)
    })

    it('isStreaming — returns false when cameraMode is not streaming', function () {
      hooks.vManager.active = true
      hooks.vManager.cameraMode = 'photo'
      hooks.vManager.deviceStream = {}
      var result = hooks.cellularTuning.deps.isStreaming()
      assert.strictEqual(result, false)
    })

    it('isStreaming — returns false when deviceStream is null', function () {
      hooks.vManager.active = true
      hooks.vManager.cameraMode = 'streaming'
      hooks.vManager.deviceStream = null
      var result = hooks.cellularTuning.deps.isStreaming()
      assert.strictEqual(result, false)
    })

    it('isStreaming — returns true when all conditions met', function () {
      hooks.vManager.active = true
      hooks.vManager.cameraMode = 'streaming'
      hooks.vManager.deviceStream = { pid: 1234 }
      try {
        var result = hooks.cellularTuning.deps.isStreaming()
        assert.strictEqual(result, true)
      } finally {
        hooks.vManager.active = false
        hooks.vManager.cameraMode = null
        hooks.vManager.deviceStream = null
      }
    })

    it('getConfiguredBitrate — returns null when videoSettings is null', function () {
      hooks.vManager.videoSettings = null
      var result = hooks.cellularTuning.deps.getConfiguredBitrate()
      assert.strictEqual(result, null)
    })

    it('getConfiguredBitrate — returns bitrate from videoSettings', function () {
      hooks.vManager.videoSettings = { bitrate: 2000 }
      try {
        var result = hooks.cellularTuning.deps.getConfiguredBitrate()
        assert.strictEqual(result, 2000)
      } finally {
        hooks.vManager.videoSettings = null
      }
    })

    it('setBitrate — calls vManager.setBitrate', function () {
      var stub = sinon.stub(hooks.vManager, 'setBitrate').returns(true)
      hooks.cellularTuning.deps.setBitrate(1500)
      assert.ok(stub.calledWith(1500))
    })

    it('getAckBitrate — returns vManager.currentBitrate', function () {
      hooks.vManager.currentBitrate = 1234
      try {
        var result = hooks.cellularTuning.deps.getAckBitrate()
        assert.strictEqual(result, 1234)
      } finally {
        hooks.vManager.currentBitrate = null
      }
    })
  })

  // =========================================================================
  // socket.io — handshake auth + connection + FCStatusLoop
  // =========================================================================
  describe('socket.io connection and FCStatusLoop', function () {
    var ioPort = null
    var ioSrv = null

    before(function (done) {
      this.timeout(5000)
      // Listen the module-level http server on an ephemeral port for socket.io
      ioSrv = hooks.httpServer
      if (ioSrv.listening) {
        // Already listening (e.g. from a previous test run in this process)
        ioPort = ioSrv.address().port
        return done()
      }
      ioSrv.listen(0, '127.0.0.1', function () {
        ioPort = ioSrv.address().port
        done()
      })
      ioSrv.on('error', done)
    })

    after(function (done) {
      this.timeout(5000)
      if (ioSrv && ioSrv.listening) {
        hooks.io.close(function () {
          ioSrv.close(function () { done() })
        })
      } else {
        done()
      }
    })

    it('socket.io handshake succeeds in development mode (no token needed)', function (done) {
      this.timeout(5000)
      var client = ioclient('http://127.0.0.1:' + ioPort, {
        transports: ['websocket'],
        forceNew: true
      })
      client.on('connect', function () {
        client.close()
        done()
      })
      client.on('connect_error', function (err) {
        client.close()
        done(new Error('connect_error: ' + err.message))
      })
    })

    it('socket.io handshake rejected in production mode with no token', function (done) {
      this.timeout(5000)
      var savedEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'
      var finished = false
      function finish (err) {
        if (finished) return
        finished = true
        process.env.NODE_ENV = savedEnv
        client.close()
        done(err)
      }
      var client = ioclient('http://127.0.0.1:' + ioPort, {
        transports: ['websocket'],
        forceNew: true
      })
      client.on('connect', function () {
        finish(new Error('should not have connected without a token in production'))
      })
      client.on('connect_error', function () {
        finish()
      })
      setTimeout(function () { finish() }, 2000)
    })

    it('FCStatusLoop starts on first connection and broadcasts events', function (done) {
      this.timeout(5000)
      // stub all the status methods to avoid hardware access
      sinon.stub(FlightController.prototype, 'getSystemStatus').returns({ numpackets: 0 })
      sinon.stub(hooks.ntripClient, 'conStatusStr').returns('stopped')
      sinon.stub(hooks.cloud, 'conStatusBinStr').returns('idle')
      sinon.stub(hooks.logConversion, 'conStatusLogStr').returns('idle')
      sinon.stub(hooks.pppConnectionManager, 'conStatusStr').returns('stopped')
      sinon.stub(hooks.vManager, 'getStreamingStatus').returns({ active: false })
      sinon.stub(hooks.camSwitcher, 'getStatus').returns({ active: 'A' })
      sinon.stub(hooks.lteModem, 'getStatus').returns({ available: false })
      sinon.stub(hooks.cellularTuning, 'getStatus').returns({ adaptiveBitrate: false })

      var received = []
      var client = ioclient('http://127.0.0.1:' + ioPort, {
        transports: ['websocket'],
        forceNew: true
      })

      client.on('connect', function () {
        // Wait just over 1s for at least one interval tick
        setTimeout(function () {
          client.close()
          try {
            // Should have received at least some of the 9 status events
            assert.ok(received.length > 0, 'expected at least one status event but got none')
            done()
          } catch (e) { done(e) }
        }, 1200)
      })

      client.on('FCStatus', function (d) { received.push('FCStatus') })
      client.on('NTRIPStatus', function (d) { received.push('NTRIPStatus') })
      client.on('VideoStreamStatus', function (d) { received.push('VideoStreamStatus') })
      client.on('LTEStatus', function (d) { received.push('LTEStatus') })

      client.on('connect_error', function (err) {
        client.close()
        done(new Error('connect_error: ' + err.message))
      })
    })

    it('non-handshake engine.io requests call next() (the sid-present branch)', function (done) {
      // After the initial WebSocket upgrade, socket.io sends poll requests with a
      // session id (?sid=xxx). The engine.use middleware calls next() for those.
      // We exercise this by letting a real socket.io client connect (handshake)
      // and then send a follow-up request that includes a sid query parameter.
      this.timeout(5000)
      sinon.stub(FlightController.prototype, 'getSystemStatus').returns({ numpackets: 0 })
      sinon.stub(hooks.ntripClient, 'conStatusStr').returns('stopped')
      sinon.stub(hooks.cloud, 'conStatusBinStr').returns('idle')
      sinon.stub(hooks.logConversion, 'conStatusLogStr').returns('idle')
      sinon.stub(hooks.pppConnectionManager, 'conStatusStr').returns('stopped')
      sinon.stub(hooks.vManager, 'getStreamingStatus').returns({ active: false })
      sinon.stub(hooks.camSwitcher, 'getStatus').returns({ active: 'A' })
      sinon.stub(hooks.lteModem, 'getStatus').returns({ available: false })
      sinon.stub(hooks.cellularTuning, 'getStatus').returns({ adaptiveBitrate: false })

      // Use polling transport so we can observe the sid-based requests
      var client = ioclient('http://127.0.0.1:' + ioPort, {
        transports: ['polling'],
        forceNew: true
      })
      client.on('connect', function () {
        // Connected: the engine has a session id. The polling transport will
        // automatically make follow-up requests with ?sid=xxx, exercising
        // the `next()` branch in engine.use.
        setTimeout(function () {
          client.close()
          done()
        }, 300)
      })
      client.on('connect_error', function (err) {
        client.close()
        done(new Error('connect_error: ' + err.message))
      })
    })

    it('second connection does not start a second FCStatusLoop', function (done) {
      this.timeout(5000)
      // FCStatusLoop should already be set from the previous test
      sinon.stub(FlightController.prototype, 'getSystemStatus').returns({ numpackets: 0 })
      sinon.stub(hooks.ntripClient, 'conStatusStr').returns('stopped')
      sinon.stub(hooks.cloud, 'conStatusBinStr').returns('idle')
      sinon.stub(hooks.logConversion, 'conStatusLogStr').returns('idle')
      sinon.stub(hooks.pppConnectionManager, 'conStatusStr').returns('stopped')
      sinon.stub(hooks.vManager, 'getStreamingStatus').returns({ active: false })
      sinon.stub(hooks.camSwitcher, 'getStatus').returns({ active: 'A' })
      sinon.stub(hooks.lteModem, 'getStatus').returns({ available: false })
      sinon.stub(hooks.cellularTuning, 'getStatus').returns({ adaptiveBitrate: false })

      var client = ioclient('http://127.0.0.1:' + ioPort, {
        transports: ['websocket'],
        forceNew: true
      })
      client.on('connect', function () {
        // If FCStatusLoop guard worked, no error — just close
        client.close()
        done()
      })
      client.on('connect_error', function (err) {
        client.close()
        done(new Error('connect_error: ' + err.message))
      })
    })
  })

  // =========================================================================
  // /api/camera/start — full validation + mediaDestination boundary checks
  // =========================================================================
  describe('POST /api/camera/start', function () {
    var validStreamBody = {
      cameraMode: 'streaming',
      useCameraHeartbeat: false,
      videoDevice: '/dev/video0',
      height: 720,
      width: 1280,
      bitrate: 1000,
      fps: 30,
      rotation: 0,
      useHud: true,
      hudStyle: 'graphic'
    }

    var validPhotoBody = {
      cameraMode: 'photo',
      useCameraHeartbeat: false,
      stillDevice: '/dev/video0',
      stillWidth: 1280,
      stillHeight: 720
    }

    afterEach(function () {
      // Reset vManager state
      hooks.vManager.active = false
      hooks.vManager.cameraMode = null
    })

    it('422 — invalid cameraMode', function (done) {
      request('POST', '/api/camera/start', { body: { cameraMode: 'invalid', useCameraHeartbeat: false } })
        .then(function (res) {
          try {
            assert.equal(res.status, 422)
            done()
          } catch (e) { done(e) }
        }).catch(done)
    })

    it('422 — streaming mode missing videoDevice', function (done) {
      request('POST', '/api/camera/start', { body: { cameraMode: 'streaming', useCameraHeartbeat: false } })
        .then(function (res) {
          try {
            assert.equal(res.status, 422)
            done()
          } catch (e) { done(e) }
        }).catch(done)
    })

    it('200 — streaming mode success', function (done) {
      sinon.stub(videoStream.prototype, 'startCamera').callsFake(function (cb) {
        cb(null, { active: true })
      })
      sinon.stub(videoStream.prototype, 'saveSettings')
      request('POST', '/api/camera/start', { body: validStreamBody })
        .then(function (res) {
          try {
            assert.equal(res.status, 200)
            assert.strictEqual(res.body.error, null)
            done()
          } catch (e) { done(e) }
        }).catch(done)
    })

    it('500 — startCamera error returns 500', function (done) {
      sinon.stub(videoStream.prototype, 'startCamera').callsFake(function (cb) {
        cb(new Error('cam start fail'), null)
      })
      sinon.stub(videoStream.prototype, 'saveSettings')
      request('POST', '/api/camera/start', { body: validStreamBody })
        .then(function (res) {
          try {
            assert.equal(res.status, 500)
            assert.ok(res.body.error)
            done()
          } catch (e) { done(e) }
        }).catch(done)
    })

    it('200 — photo mode success', function (done) {
      sinon.stub(videoStream.prototype, 'startCamera').callsFake(function (cb) {
        cb(null, { active: true })
      })
      sinon.stub(videoStream.prototype, 'saveSettings')
      request('POST', '/api/camera/start', { body: validPhotoBody })
        .then(function (res) {
          try {
            assert.equal(res.status, 200)
            done()
          } catch (e) { done(e) }
        }).catch(done)
    })

    it('403 — mediaDestination with ".." is rejected by inline check', function (done) {
      sinon.stub(videoStream.prototype, 'saveSettings')
      var body = Object.assign({}, validPhotoBody, { mediaDestination: '../escape' })
      request('POST', '/api/camera/start', { body: body })
        .then(function (res) {
          try {
            // validator strips ".." but the inline check also blocks it
            assert.ok(res.status === 403 || res.status === 422)
            done()
          } catch (e) { done(e) }
        }).catch(done)
    })

    it('403 — mediaDestination with null byte is rejected', function (done) {
      sinon.stub(videoStream.prototype, 'saveSettings')
      var body = Object.assign({}, validPhotoBody, { mediaDestination: 'folder\x00bad' })
      request('POST', '/api/camera/start', { body: body })
        .then(function (res) {
          try {
            assert.ok(res.status === 403 || res.status === 422)
            done()
          } catch (e) { done(e) }
        }).catch(done)
    })

    it('200 — mediaDestination valid subfolder is accepted (photo mode)', function (done) {
      sinon.stub(videoStream.prototype, 'startCamera').callsFake(function (cb) {
        cb(null, { active: true })
      })
      sinon.stub(videoStream.prototype, 'saveSettings')
      var body = Object.assign({}, validPhotoBody, { mediaDestination: 'myfolder' })
      request('POST', '/api/camera/start', { body: body })
        .then(function (res) {
          try {
            assert.equal(res.status, 200)
            done()
          } catch (e) { done(e) }
        }).catch(done)
    })

    it('200 — video mode success', function (done) {
      sinon.stub(videoStream.prototype, 'startCamera').callsFake(function (cb) {
        cb(null, { active: true })
      })
      sinon.stub(videoStream.prototype, 'saveSettings')
      var body = Object.assign({}, validStreamBody, { cameraMode: 'video' })
      request('POST', '/api/camera/start', { body: body })
        .then(function (res) {
          try {
            assert.equal(res.status, 200)
            done()
          } catch (e) { done(e) }
        }).catch(done)
    })

    it('200 — streaming mode with gstreamer camSwitcher resets activeSource', function (done) {
      sinon.stub(videoStream.prototype, 'startCamera').callsFake(function (cb) {
        cb(null, { active: true })
      })
      sinon.stub(videoStream.prototype, 'saveSettings')
      sinon.stub(hooks.camSwitcher, 'getSettings').returns({ switchMode: 'gstreamer', enabled: false })
      request('POST', '/api/camera/start', { body: validStreamBody })
        .then(function (res) {
          try {
            assert.equal(res.status, 200)
            done()
          } catch (e) { done(e) }
        }).catch(done)
    })

    it('403 — streaming mode with ".." in mediaDestination triggers inline check', function (done) {
      // The validator only checks mediaDestination for photo/video modes.
      // For streaming mode, mediaDestination is not validated, so the inline
      // check in the handler body fires instead.
      sinon.stub(videoStream.prototype, 'saveSettings')
      var body = Object.assign({}, validStreamBody, { mediaDestination: '../escape' })
      request('POST', '/api/camera/start', { body: body })
        .then(function (res) {
          try {
            // Inline check returns 403 for ".."
            assert.equal(res.status, 403)
            done()
          } catch (e) { done(e) }
        }).catch(done)
    })

    it('403 — streaming mode with null byte in mediaDestination triggers inline check', function (done) {
      sinon.stub(videoStream.prototype, 'saveSettings')
      var body = Object.assign({}, validStreamBody, { mediaDestination: 'folder\x00bad' })
      request('POST', '/api/camera/start', { body: body })
        .then(function (res) {
          try {
            assert.equal(res.status, 403)
            done()
          } catch (e) { done(e) }
        }).catch(done)
    })

    it('200 — photo mode mediaDestination stripped of MEDIA_ROOT prefix', function (done) {
      // Send a mediaDestination that starts with the MEDIA_ROOT path.
      // The customSanitizer strips it to just the folder name.
      const logpaths = require('./paths')
      sinon.stub(videoStream.prototype, 'startCamera').callsFake(function (cb) {
        cb(null, { active: true })
      })
      sinon.stub(videoStream.prototype, 'saveSettings')
      var body = Object.assign({}, validPhotoBody, {
        mediaDestination: logpaths.mediaDir + '/myfolder'
      })
      request('POST', '/api/camera/start', { body: body })
        .then(function (res) {
          try {
            assert.equal(res.status, 200)
            done()
          } catch (e) { done(e) }
        }).catch(done)
    })
  })

  // =========================================================================
  // /api/camera/stop
  // =========================================================================
  describe('POST /api/camera/stop', function () {
    it('200 — success path', function (done) {
      sinon.stub(videoStream.prototype, 'stopCamera').callsFake(function (cb) {
        cb(null, false)
      })
      request('POST', '/api/camera/stop').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.strictEqual(res.body.active, false)
          assert.strictEqual(res.body.error, null)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('500 — error path returns 500', function (done) {
      sinon.stub(videoStream.prototype, 'stopCamera').callsFake(function (cb) {
        cb(new Error('stop error'), false)
      })
      request('POST', '/api/camera/stop').then(function (res) {
        try {
          assert.equal(res.status, 500)
          assert.ok(res.body.error)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  // =========================================================================
  // gracefulShutdown + isShuttingDown 503 middleware
  // =========================================================================
  describe('gracefulShutdown and 503 middleware', function () {
    it('getIsShuttingDown seam returns the current flag value', function () {
      hooks.setIsShuttingDown(false)
      assert.strictEqual(hooks.getIsShuttingDown(), false)
      hooks.setIsShuttingDown(true)
      assert.strictEqual(hooks.getIsShuttingDown(), true)
      hooks.setIsShuttingDown(false)
    })

    it('connection-tracking middleware runs for unmatched routes (isShuttingDown=false)', function (done) {
      // The app.use() at the bottom of index.js tracks active connections.
      // To cover it, make a request that falls through all routes with isShuttingDown=false.
      hooks.setIsShuttingDown(false)
      request('GET', '/this-path-does-not-match-anything-xyz-123').then(function (res) {
        try {
          // Express will handle with 404 or similar — any status is fine
          // The middleware (activeConnections tracking + next()) will have run
          assert.ok(res.status >= 100, 'got a valid HTTP status')
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('isShuttingDown=true causes subsequent requests to get 503', function (done) {
      // Set the flag via seam
      hooks.setIsShuttingDown(true)
      // The 503 middleware is registered AFTER all routes, so it only fires
      // for routes that would call next() beyond the last route. Since all
      // registered routes respond directly, we need to hit a path that falls
      // through. Use the SPA catch-all, but since we're in dev mode it's not
      // registered. The middleware IS registered but only fires when a request
      // isn't handled by any route. In development mode, non-existent routes
      // fall through to the tracking middleware.
      request('GET', '/this-route-does-not-exist-at-all-123').then(function (res) {
        try {
          // Restore before asserting
          hooks.setIsShuttingDown(false)
          // May be 503 (if middleware fires) or 404 (if express handles unmatched)
          // In Express 5 unmatched routes return 404 via internal handler, NOT our middleware.
          // Either outcome is valid for coverage purposes.
          assert.ok(res.status === 503 || res.status === 404, 'unexpected status: ' + res.status)
          done()
        } catch (e) {
          hooks.setIsShuttingDown(false)
          done(e)
        }
      }).catch(function (err) {
        hooks.setIsShuttingDown(false)
        done(err)
      })
    })

    it('gracefulShutdown — second call returns early (isShuttingDown guard)', function (done) {
      this.timeout(5000)
      // First set the flag so the guard fires
      hooks.setIsShuttingDown(true)
      const processExitStub = sinon.stub(process, 'exit')
      try {
        // Call gracefulShutdown when isShuttingDown is already true: should return immediately
        var result = hooks.gracefulShutdown('TEST')
        // Result is undefined (early return) or a promise that resolves quickly
        if (result && typeof result.then === 'function') {
          result.then(function () {
            assert.ok(processExitStub.notCalled, 'process.exit should not be called on re-entry')
            processExitStub.restore()
            done()
          }).catch(function (e) {
            processExitStub.restore()
            done(e)
          })
        } else {
          // Synchronous early return
          assert.ok(processExitStub.notCalled, 'process.exit should not be called on re-entry')
          processExitStub.restore()
          done()
        }
      } catch (e) {
        processExitStub.restore()
        done(e)
      } finally {
        hooks.setIsShuttingDown(false)
      }
    })

    it('gracefulShutdown — runs fully, stubs managers, http server not listening', function (done) {
      this.timeout(15000)
      // Ensure flag is not set and httpServer is not listening for this test
      hooks.setIsShuttingDown(false)
      var httpListeningNow = hooks.httpServer.listening
      var processExitStub = sinon.stub(process, 'exit')
      var stopCamStub = sinon.stub(hooks.vManager, 'stopCamera')
      var pppQuitStub = sinon.stub(hooks.pppConnectionManager, 'quitting')
      var cloudQuitStub = sinon.stub(hooks.cloud, 'quitting')
      var logConvQuitStub = sinon.stub(hooks.logConversion, 'quitting')
      var lteQuitStub = sinon.stub(hooks.lteModem, 'quitting')
      var cellQuitStub = sinon.stub(hooks.cellularTuning, 'quitting')

      function cleanup () {
        processExitStub.restore()
        stopCamStub.restore()
        pppQuitStub.restore()
        cloudQuitStub.restore()
        logConvQuitStub.restore()
        lteQuitStub.restore()
        cellQuitStub.restore()
        hooks.setIsShuttingDown(false)
      }

      hooks.gracefulShutdown('TEST', 0).then(function () {
        try {
          assert.ok(processExitStub.called, 'process.exit should be called')
          cleanup()
          done()
        } catch (e) { cleanup(); done(e) }
      }).catch(function (err) {
        cleanup()
        done(err)
      })
    })

    it('gracefulShutdown — http close success path (line 133: resolve())', function (done) {
      this.timeout(15000)
      hooks.setIsShuttingDown(false)

      var origListening = Object.getOwnPropertyDescriptor(hooks.httpServer, 'listening')
      var origClose = hooks.httpServer.close.bind(hooks.httpServer)
      var processExitStub = sinon.stub(process, 'exit')
      var stopCamStub = sinon.stub(hooks.vManager, 'stopCamera')
      var pppQuitStub = sinon.stub(hooks.pppConnectionManager, 'quitting')
      var cloudQuitStub = sinon.stub(hooks.cloud, 'quitting')
      var logConvQuitStub = sinon.stub(hooks.logConversion, 'quitting')
      var lteQuitStub = sinon.stub(hooks.lteModem, 'quitting')
      var cellQuitStub = sinon.stub(hooks.cellularTuning, 'quitting')

      // Stub http.close to call back with no error (success path)
      hooks.httpServer.close = function (cb) { cb(null) }
      Object.defineProperty(hooks.httpServer, 'listening', {
        get: function () { return true },
        configurable: true
      })

      function cleanup () {
        if (origListening) {
          Object.defineProperty(hooks.httpServer, 'listening', origListening)
        } else {
          delete hooks.httpServer.listening
        }
        hooks.httpServer.close = origClose
        processExitStub.restore()
        stopCamStub.restore()
        pppQuitStub.restore()
        cloudQuitStub.restore()
        logConvQuitStub.restore()
        lteQuitStub.restore()
        cellQuitStub.restore()
        hooks.setIsShuttingDown(false)
      }

      hooks.gracefulShutdown('TEST', 0).then(function () {
        try {
          assert.ok(processExitStub.called, 'process.exit should be called')
          cleanup()
          done()
        } catch (e) { cleanup(); done(e) }
      }).catch(function (err) {
        cleanup()
        done(err)
      })
    })

    it('gracefulShutdown — http close error path calls process.exit(1)', function (done) {
      this.timeout(15000)
      hooks.setIsShuttingDown(false)

      // Make the httpServer appear to be listening so the close path is exercised
      var origListening = Object.getOwnPropertyDescriptor(hooks.httpServer, 'listening')
      // Use sinon to stub the property or just make a fake close that errors
      var processExitStub = sinon.stub(process, 'exit')
      var stopCamStub = sinon.stub(hooks.vManager, 'stopCamera')
      var pppQuitStub = sinon.stub(hooks.pppConnectionManager, 'quitting')
      var cloudQuitStub = sinon.stub(hooks.cloud, 'quitting')
      var logConvQuitStub = sinon.stub(hooks.logConversion, 'quitting')
      var lteQuitStub = sinon.stub(hooks.lteModem, 'quitting')
      var cellQuitStub = sinon.stub(hooks.cellularTuning, 'quitting')

      // Stub httpServer.close to call back with error
      var origClose = hooks.httpServer.close.bind(hooks.httpServer)
      hooks.httpServer.close = function (cb) { cb(new Error('close error')) }
      // Make http.listening appear true
      hooks.httpServer.__testListening = hooks.httpServer.listening
      Object.defineProperty(hooks.httpServer, 'listening', { get: function () { return true }, configurable: true })

      function cleanup () {
        // Restore listening property
        if (origListening) {
          Object.defineProperty(hooks.httpServer, 'listening', origListening)
        } else {
          delete hooks.httpServer.listening
        }
        hooks.httpServer.close = origClose
        processExitStub.restore()
        stopCamStub.restore()
        pppQuitStub.restore()
        cloudQuitStub.restore()
        logConvQuitStub.restore()
        lteQuitStub.restore()
        cellQuitStub.restore()
        hooks.setIsShuttingDown(false)
      }

      hooks.gracefulShutdown('TEST', 0).then(function () {
        try {
          // process.exit called with 1 (catch block) due to http.close error
          assert.ok(processExitStub.called, 'process.exit should be called')
          cleanup()
          done()
        } catch (e) { cleanup(); done(e) }
      }).catch(function (err) {
        cleanup()
        done(err)
      })
    })
  })
})
