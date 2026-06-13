'use strict'

/*
 * Package B route tests for server/index.js
 *
 * Coverage target: all "simple delegate" HTTP routes — about/info, logfile,
 * PPP, VPN (zerotier + wireguard, NOT the multipart profile-add which is
 * Package C), NTRIP, Cloud, LogConversion, Adhoc, NetworkClients,
 * FlightLogger, CameraSwitcher, CustomPipelines, CellularTuning,
 * NetworkManager (×11), and the /api/shutdowncc + /api/resetsettings special
 * cases.
 *
 * Package A (auth routes) is already done — we never duplicate those routes.
 * Package C (FC/video/LTE/socket.io/multipart) comes after us.
 *
 * Harness: test/indexApp.js (shared server, ephemeral port).
 * Sinon stubs are restored in afterEach(); assertions inside callbacks are
 * wrapped in try/catch + done(err) to avoid silent mocha crashes.
 */

const assert = require('assert')
const sinon = require('sinon')
const { describe, it, before, after, afterEach } = require('mocha')

// Manager modules whose function exports we stub directly
const aboutPage = require('./aboutInfo')
const networkManager = require('./networkManager')
const networkClients = require('./networkClients')
const vpn = require('./vpn')

// Class modules whose prototype methods we stub
const PPPConnection = require('./pppConnection')
const ntrip = require('./ntrip')
const cloudUpload = require('./cloudUpload')
const logConverter = require('./logConverter')
const Adhoc = require('./adhocManager')
const flightLogger = require('./flightLogger')
const CameraSwitcher = require('./cameraSwitcher')
const CustomPipelines = require('./customPipelines')
const CellularTuning = require('./cellularTuning')
const LTEModem = require('./ltemodem')

// Shared harness
const { getServer, closeServer, request } = require('../test/indexApp')

// ---------------------------------------------------------------------------
// Start the shared server once — Package A and the existing index.test.js
// also call getServer(); the harness is idempotent.
// ---------------------------------------------------------------------------
before(function (done) {
  getServer().then(() => done()).catch(done)
})

after(function (done) {
  closeServer().then(() => done()).catch(done)
})

// ---------------------------------------------------------------------------

describe('Package B — delegate HTTP routes', function () {
  afterEach(function () {
    sinon.restore()
  })

  // =========================================================================
  // About / info routes
  // =========================================================================
  describe('GET /api/softwareinfo', function () {
    it('200 — success path returns software versions', function (done) {
      sinon.stub(aboutPage, 'getSoftwareInfo').callsFake(function (cb) {
        cb('Ubuntu 22.04', 'v18.0.0', '1.2.3', 'myhostname', null)
      })
      request('GET', '/api/softwareinfo').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.equal(res.body.OSVersion, 'Ubuntu 22.04')
          assert.equal(res.body.Nodejsversion, 'v18.0.0')
          assert.equal(res.body.rpanionversion, '1.2.3')
          assert.equal(res.body.hostname, 'myhostname')
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — error path returns err in all fields', function (done) {
      sinon.stub(aboutPage, 'getSoftwareInfo').callsFake(function (cb) {
        cb(null, null, null, null, 'some error')
      })
      request('GET', '/api/softwareinfo').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.equal(res.body.OSVersion, 'some error')
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('GET /api/hardwareinfo', function () {
    it('200 — success path returns hardware info', function (done) {
      sinon.stub(aboutPage, 'getHardwareInfo').callsFake(function (cb) {
        cb('8 GB', 'ARM Cortex-A72', { product: 'Hat', vendor: 'V', version: '1' }, 'Pi 4B', null)
      })
      request('GET', '/api/hardwareinfo').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.equal(res.body.RAMName, '8 GB')
          assert.equal(res.body.CPUName, 'ARM Cortex-A72')
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — error path propagates err string', function (done) {
      sinon.stub(aboutPage, 'getHardwareInfo').callsFake(function (cb) {
        cb(null, null, null, null, 'hw error')
      })
      request('GET', '/api/hardwareinfo').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.equal(res.body.CPUName, 'hw error')
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('GET /api/diskinfo', function () {
    it('200 — success path returns disk status string', function (done) {
      sinon.stub(aboutPage, 'getDiskInfo').callsFake(function (cb) {
        cb('64.00', '10.00', 15.6, null)
      })
      request('GET', '/api/diskinfo').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(res.body.diskSpaceStatus.includes('10.00'))
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — error path returns err as diskSpaceStatus', function (done) {
      sinon.stub(aboutPage, 'getDiskInfo').callsFake(function (cb) {
        cb(null, null, null, 'disk error')
      })
      request('GET', '/api/diskinfo').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.equal(res.body.diskSpaceStatus, 'disk error')
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('GET /api/approot', function () {
    it('200 — returns appRoot string', function (done) {
      request('GET', '/api/approot').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(typeof res.body.appRoot === 'string')
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  // =========================================================================
  // /api/logfile — file download (text/plain attachment)
  // =========================================================================
  describe('GET /api/logfile', function () {
    it('200 — returns log as text/plain attachment', function (done) {
      sinon.stub(aboutPage, 'getsystemctllog').callsFake(function (cb) {
        cb('line1\nline2\n')
      })
      request('GET', '/api/logfile', { raw: true }).then(function (res) {
        try {
          assert.equal(res.statusCode, 200)
          assert.ok(res.headers['content-disposition'].includes('rpanion.log'))
          assert.ok(res.body.includes('line1'))
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  // =========================================================================
  // /api/shutdowncc — upstream bug: handler takes no res param; request hangs.
  // We fire-and-forget, poll until the stub is called, then assert.
  // =========================================================================
  describe('POST /api/shutdowncc', function () {
    it('fires shutdownCC without waiting for HTTP response', function (done) {
      this.timeout(5000)
      const stub = sinon.stub(aboutPage, 'shutdownCC')

      // Fire the request without awaiting a response (it will hang)
      const http = require('http')
      const { getPort } = require('../test/indexApp')
      const port = getPort()
      const req = http.request({
        hostname: '127.0.0.1',
        port: port,
        path: '/api/shutdowncc',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': 2 }
      })
      req.on('error', function () { /* expected — no response */ })
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
          done(new Error('shutdownCC stub was never called'))
        }
      }, 100)
    })
  })

  // =========================================================================
  // /api/resetsettings — stub fs narrowly so no other suite fs use is broken.
  // =========================================================================
  describe('POST /api/resetsettings', function () {
    it('200 — success path deletes and recreates settings file', function (done) {
      const fs = require('fs')
      // Stub only the specific calls the handler makes
      const existsStub = sinon.stub(fs, 'existsSync').returns(true)
      const unlinkStub = sinon.stub(fs, 'unlinkSync')
      const writeStub = sinon.stub(fs, 'writeFileSync')

      request('POST', '/api/resetsettings').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.strictEqual(res.body.success, true)
          assert.ok(unlinkStub.called, 'unlinkSync should be called')
          assert.ok(writeStub.called, 'writeFileSync should be called')
          existsStub.restore()
          unlinkStub.restore()
          writeStub.restore()
          done()
        } catch (e) {
          existsStub.restore()
          unlinkStub.restore()
          writeStub.restore()
          done(e)
        }
      }).catch(function (err) {
        existsStub.restore()
        unlinkStub.restore()
        writeStub.restore()
        done(err)
      })
    })

    it('200 — file does not exist: skips unlink, writes empty settings', function (done) {
      const fs = require('fs')
      const existsStub = sinon.stub(fs, 'existsSync').returns(false)
      const unlinkStub = sinon.stub(fs, 'unlinkSync')
      const writeStub = sinon.stub(fs, 'writeFileSync')

      request('POST', '/api/resetsettings').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.strictEqual(res.body.success, true)
          assert.ok(!unlinkStub.called, 'unlinkSync should NOT be called when file missing')
          assert.ok(writeStub.called, 'writeFileSync should still be called')
          existsStub.restore()
          unlinkStub.restore()
          writeStub.restore()
          done()
        } catch (e) {
          existsStub.restore()
          unlinkStub.restore()
          writeStub.restore()
          done(e)
        }
      }).catch(function (err) {
        existsStub.restore()
        unlinkStub.restore()
        writeStub.restore()
        done(err)
      })
    })

    it('500 — fs error returns 500 JSON', function (done) {
      const fs = require('fs')
      const existsStub = sinon.stub(fs, 'existsSync').throws(new Error('disk full'))

      request('POST', '/api/resetsettings').then(function (res) {
        try {
          assert.equal(res.status, 500)
          assert.ok(res.body.error.includes('disk full'))
          existsStub.restore()
          done()
        } catch (e) {
          existsStub.restore()
          done(e)
        }
      }).catch(function (err) {
        existsStub.restore()
        done(err)
      })
    })
  })

  // =========================================================================
  // /api/settingsbackup + /api/settingsrestore — stub fs narrowly.
  // =========================================================================
  describe('GET /api/settingsbackup', function () {
    it('200 — returns the settings file as a download', function (done) {
      const fs = require('fs')
      sinon.stub(fs, 'existsSync').returns(true)
      sinon.stub(fs, 'readFileSync').returns('{"a":1}')
      request('GET', '/api/settingsbackup', { raw: true }).then(function (res) {
        try {
          assert.equal(res.statusCode, 200)
          assert.ok(res.headers['content-disposition'].includes('rpanion-settings.json'))
          assert.equal(res.body, '{"a":1}')
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — file missing returns empty object', function (done) {
      const fs = require('fs')
      sinon.stub(fs, 'existsSync').returns(false)
      const readStub = sinon.stub(fs, 'readFileSync')
      request('GET', '/api/settingsbackup', { raw: true }).then(function (res) {
        try {
          assert.equal(res.statusCode, 200)
          assert.equal(res.body, '{}')
          assert.ok(!readStub.called, 'readFileSync should not be called when file missing')
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('500 — fs error returns 500 JSON', function (done) {
      const fs = require('fs')
      sinon.stub(fs, 'existsSync').throws(new Error('disk full'))
      request('GET', '/api/settingsbackup').then(function (res) {
        try {
          assert.equal(res.status, 500)
          assert.ok(res.body.error.includes('disk full'))
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/settingsrestore', function () {
    it('200 — writes a valid settings object', function (done) {
      const fs = require('fs')
      const writeStub = sinon.stub(fs, 'writeFileSync')
      request('POST', '/api/settingsrestore', { body: { foo: 'bar' } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.strictEqual(res.body.success, true)
          assert.ok(writeStub.called, 'writeFileSync should be called')
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('400 — rejects a non-object (array) body', function (done) {
      request('POST', '/api/settingsrestore', { body: [1, 2, 3] }).then(function (res) {
        try {
          assert.equal(res.status, 400)
          assert.strictEqual(res.body.success, false)
          assert.ok(res.body.error.includes('Invalid'))
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('500 — fs write error returns 500 JSON', function (done) {
      const fs = require('fs')
      sinon.stub(fs, 'writeFileSync').throws(new Error('disk full'))
      request('POST', '/api/settingsrestore', { body: { foo: 'bar' } }).then(function (res) {
        try {
          assert.equal(res.status, 500)
          assert.ok(res.body.error.includes('disk full'))
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  // =========================================================================
  // PPP routes
  // =========================================================================
  describe('GET /api/pppconfig', function () {
    it('200 — success path returns settings object', function (done) {
      sinon.stub(PPPConnection.prototype, 'getPPPSettings').callsFake(function (cb) {
        cb(null, { selDevice: '/dev/ttyUSB0', enabled: false })
      })
      request('GET', '/api/pppconfig').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.equal(res.body.selDevice, '/dev/ttyUSB0')
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — error path returns error field', function (done) {
      sinon.stub(PPPConnection.prototype, 'getPPPSettings').callsFake(function (cb) {
        cb('some ppp error', null)
      })
      request('GET', '/api/pppconfig').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.equal(res.body.error, 'some ppp error')
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/pppmodify', function () {
    var validBody = {
      device: '/dev/ttyUSB0',
      baudrate: 115200,
      localIP: '192.168.1.1',
      remoteIP: '192.168.1.2',
      enabled: true
    }

    it('422 — missing required fields returns 422', function (done) {
      request('POST', '/api/pppmodify', { body: { device: 'x' } }).then(function (res) {
        try {
          assert.equal(res.status, 422)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — enabled=true, startPPP success', function (done) {
      sinon.stub(PPPConnection.prototype, 'startPPP').callsFake(function (dev, baud, local, remote, cb) {
        cb(null, { selDevice: dev, enabled: true })
      })
      request('POST', '/api/pppmodify', { body: validBody }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(res.body.settings)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — enabled=true, startPPP error', function (done) {
      sinon.stub(PPPConnection.prototype, 'startPPP').callsFake(function (dev, baud, local, remote, cb) {
        cb(new Error('ppp fail'), { enabled: false })
      })
      request('POST', '/api/pppmodify', { body: validBody }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(res.body.error)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — enabled=false, stopPPP success', function (done) {
      sinon.stub(PPPConnection.prototype, 'stopPPP').callsFake(function (cb) {
        cb(null, { enabled: false })
      })
      var body = Object.assign({}, validBody, { enabled: false })
      request('POST', '/api/pppmodify', { body: body }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(res.body.settings)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — enabled=false, stopPPP error', function (done) {
      sinon.stub(PPPConnection.prototype, 'stopPPP').callsFake(function (cb) {
        cb('stop error', { enabled: false })
      })
      var body = Object.assign({}, validBody, { enabled: false })
      request('POST', '/api/pppmodify', { body: body }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(res.body.error)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  // =========================================================================
  // VPN — Zerotier routes
  // =========================================================================
  describe('GET /api/vpnzerotier', function () {
    it('200 — returns zerotier status', function (done) {
      sinon.stub(vpn, 'getVPNStatusZerotier').callsFake(function (errpass, cb) {
        cb(null, { installed: true, status: true, text: [] })
      })
      request('GET', '/api/vpnzerotier').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(res.body.statusZerotier)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/vpnzerotieradd', function () {
    it('422 — non-alphanumeric network', function (done) {
      request('POST', '/api/vpnzerotieradd', { body: { network: 'bad-network!' } }).then(function (res) {
        try {
          assert.equal(res.status, 422)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — success path', function (done) {
      sinon.stub(vpn, 'addZerotier').callsFake(function (net, cb) {
        cb(null, { installed: true, status: true, text: [] })
      })
      request('POST', '/api/vpnzerotieradd', { body: { network: 'abc123def456' } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/vpnzerotierdel', function () {
    it('422 — non-alphanumeric network', function (done) {
      request('POST', '/api/vpnzerotierdel', { body: { network: 'bad!' } }).then(function (res) {
        try {
          assert.equal(res.status, 422)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — success path', function (done) {
      sinon.stub(vpn, 'removeZerotier').callsFake(function (net, cb) {
        cb(null, { installed: true, status: false, text: [] })
      })
      request('POST', '/api/vpnzerotierdel', { body: { network: 'abc123def456' } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  // =========================================================================
  // VPN — Wireguard routes (NOT vpnwireguardprofileadd — Package C)
  // =========================================================================
  describe('GET /api/vpnwireguard', function () {
    it('200 — returns wireguard status', function (done) {
      sinon.stub(vpn, 'getVPNStatusWireguard').callsFake(function (errpass, cb) {
        cb(null, { installed: true, status: false, text: [] })
      })
      request('GET', '/api/vpnwireguard').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(res.body.statusWireguard)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/vpnwireguardactivate', function () {
    it('422 — empty network fails validation', function (done) {
      request('POST', '/api/vpnwireguardactivate', { body: { network: '' } }).then(function (res) {
        try {
          assert.equal(res.status, 422)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — success path', function (done) {
      sinon.stub(vpn, 'activateWireguardProfile').callsFake(function (net, cb) {
        cb(null, { installed: true, status: true, text: [] })
      })
      request('POST', '/api/vpnwireguardactivate', { body: { network: 'mywg0' } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/vpnwireguarddeactivate', function () {
    it('422 — empty network fails validation', function (done) {
      request('POST', '/api/vpnwireguarddeactivate', { body: { network: '' } }).then(function (res) {
        try {
          assert.equal(res.status, 422)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — success path', function (done) {
      sinon.stub(vpn, 'deactivateWireguardProfile').callsFake(function (net, cb) {
        cb(null, { installed: true, status: false, text: [] })
      })
      request('POST', '/api/vpnwireguarddeactivate', { body: { network: 'mywg0' } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/vpnwireguardelete', function () {
    it('422 — empty network fails validation', function (done) {
      request('POST', '/api/vpnwireguardelete', { body: { network: '' } }).then(function (res) {
        try {
          assert.equal(res.status, 422)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — success path', function (done) {
      sinon.stub(vpn, 'deleteWireguardProfile').callsFake(function (net, cb) {
        cb(null, { installed: false, status: false, text: [] })
      })
      request('POST', '/api/vpnwireguardelete', { body: { network: 'mywg0' } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('GET /api/vpntailscale', function () {
    it('200 — returns tailscale status', function (done) {
      sinon.stub(vpn, 'getVPNStatusTailscale').callsFake(function (errpass, cb) {
        cb(null, { installed: true, status: true, text: [] })
      })
      request('GET', '/api/vpntailscale').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(res.body.statusTailscale)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/vpntailscaleconnect', function () {
    it('422 — empty auth key fails validation', function (done) {
      request('POST', '/api/vpntailscaleconnect', { body: { authkey: '' } }).then(function (res) {
        try {
          assert.equal(res.status, 422)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — success path', function (done) {
      sinon.stub(vpn, 'connectTailscale').callsFake(function (key, cb) {
        cb(null, { installed: true, status: true, text: [] })
      })
      request('POST', '/api/vpntailscaleconnect', { body: { authkey: 'tskey-auth-abc123' } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/vpntailscaledisconnect', function () {
    it('200 — success path', function (done) {
      sinon.stub(vpn, 'disconnectTailscale').callsFake(function (cb) {
        cb(null, { installed: true, status: false, text: [] })
      })
      request('POST', '/api/vpntailscaledisconnect').then(function (res) {
        try {
          assert.equal(res.status, 200)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  // =========================================================================
  // NTRIP routes
  // =========================================================================
  describe('GET /api/ntripconfig', function () {
    it('200 — returns NTRIP settings', function (done) {
      sinon.stub(ntrip.prototype, 'getSettings').callsFake(function (cb) {
        cb('ntrip.example.com', 2101, 'MOUNT', 'user', 'pass', false, false)
      })
      request('GET', '/api/ntripconfig').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.equal(res.body.host, 'ntrip.example.com')
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/ntripmodify', function () {
    var validNtripBody = {
      active: false,
      host: JSON.stringify('ntrip.host.com'),
      port: 2101,
      mountpoint: JSON.stringify('MOUNT'),
      username: JSON.stringify('myuser'),
      password: JSON.stringify('mypass'),
      useTLS: false
    }

    it('422 — missing required fields', function (done) {
      request('POST', '/api/ntripmodify', { body: { active: false } }).then(function (res) {
        try {
          assert.equal(res.status, 422)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — success path calls setSettings and returns updated config', function (done) {
      sinon.stub(ntrip.prototype, 'setSettings').returns(undefined)
      sinon.stub(ntrip.prototype, 'getSettings').callsFake(function (cb) {
        cb('ntrip.host.com', 2101, 'MOUNT', 'myuser', 'mypass', false, false)
      })
      request('POST', '/api/ntripmodify', { body: validNtripBody }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.equal(res.body.host, 'ntrip.host.com')
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  // =========================================================================
  // Cloud routes
  // =========================================================================
  describe('GET /api/cloudinfo', function () {
    it('200 — returns cloud settings', function (done) {
      sinon.stub(cloudUpload.prototype, 'getSettings').callsFake(function (cb) {
        cb(false, '', false, [])
      })
      request('GET', '/api/cloudinfo').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.strictEqual(res.body.doBinUpload, false)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/binlogupload', function () {
    it('422 — missing fields', function (done) {
      request('POST', '/api/binlogupload', { body: {} }).then(function (res) {
        try {
          assert.equal(res.status, 422)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — success path', function (done) {
      sinon.stub(cloudUpload.prototype, 'setSettingsBin').returns(undefined)
      sinon.stub(cloudUpload.prototype, 'getSettings').callsFake(function (cb) {
        cb(true, 'user@host:/path', false)
      })
      request('POST', '/api/binlogupload', {
        body: { doBinUpload: true, binUploadLink: 'user@host:/path', syncDeletions: false }
      }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.strictEqual(res.body.doBinUpload, true)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  // =========================================================================
  // LogConversion routes
  // =========================================================================
  describe('GET /api/logconversioninfo', function () {
    it('200 — returns logConversion setting', function (done) {
      sinon.stub(logConverter.prototype, 'getSettings').callsFake(function (cb) {
        cb(false)
      })
      request('GET', '/api/logconversioninfo').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.strictEqual(res.body.doLogConversion, false)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/logconversion', function () {
    it('422 — missing doLogConversion', function (done) {
      request('POST', '/api/logconversion', { body: {} }).then(function (res) {
        try {
          assert.equal(res.status, 422)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — success path', function (done) {
      sinon.stub(logConverter.prototype, 'setSettingsLog').returns(undefined)
      sinon.stub(logConverter.prototype, 'getSettings').callsFake(function (cb) {
        cb(true)
      })
      request('POST', '/api/logconversion', { body: { doLogConversion: true } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.strictEqual(res.body.doLogConversion, true)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  // =========================================================================
  // Adhoc routes
  // =========================================================================
  describe('GET /api/adhocadapters', function () {
    it('200 — success path returns adapters', function (done) {
      sinon.stub(Adhoc.prototype, 'getAdapters').callsFake(function (cb) {
        cb(null, [{ value: 'wlan0', label: 'wlan0 (wifi)' }], 'wlan0', {})
      })
      request('GET', '/api/adhocadapters').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(Array.isArray(res.body.netDevice))
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — error path returns empty list and error', function (done) {
      sinon.stub(Adhoc.prototype, 'getAdapters').callsFake(function (cb) {
        cb('adhoc error', [], [], {})
      })
      request('GET', '/api/adhocadapters').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.equal(res.body.netDevice.length, 0)
          assert.ok(res.body.error)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/adhocadaptermodify', function () {
    var validAdhocBody = {
      settings: {
        isActive: false,
        ipaddress: '10.0.0.1',
        wpaType: 'none',
        password: '',
        ssid: 'testssid',
        band: 'bg',
        channel: 6,
        gateway: ''
      },
      toState: false,
      netDeviceSelected: 'wlan0'
    }

    it('422 — missing fields', function (done) {
      request('POST', '/api/adhocadaptermodify', { body: {} }).then(function (res) {
        try {
          assert.equal(res.status, 422)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — success path', function (done) {
      sinon.stub(Adhoc.prototype, 'setAdapter').callsFake(function (toState, dev, settings, cb) {
        cb(null, [{ value: 'wlan0' }], 'wlan0', settings)
      })
      request('POST', '/api/adhocadaptermodify', { body: validAdhocBody }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(res.body.netDevice)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — error path', function (done) {
      sinon.stub(Adhoc.prototype, 'setAdapter').callsFake(function (toState, dev, settings, cb) {
        cb('adapter error', [], null, {})
      })
      request('POST', '/api/adhocadaptermodify', { body: validAdhocBody }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(res.body.error)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  // =========================================================================
  // NetworkClients routes
  // =========================================================================
  describe('GET /api/networkclients', function () {
    it('200 — returns clients info', function (done) {
      sinon.stub(networkClients, 'getClients').callsFake(function (cb) {
        cb(null, 'wlan0', [{ ip: '10.0.0.2' }])
      })
      request('GET', '/api/networkclients').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(Array.isArray(res.body.apclients))
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  // =========================================================================
  // FlightLogger routes
  // =========================================================================
  describe('GET /api/logfiles', function () {
    it('200 — returns log file lists', function (done) {
      sinon.stub(flightLogger.prototype, 'getLogs').callsFake(function (cb) {
        cb(null, ['tlog1.tlog'], ['flight1.bin'], ['mission.kmz'], ['photo.jpg'])
      })
      request('GET', '/api/logfiles').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(Array.isArray(res.body.TlogFiles))
          assert.ok(Array.isArray(res.body.BinlogFiles))
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/deletelogfiles', function () {
    it('422 — invalid logtype', function (done) {
      request('POST', '/api/deletelogfiles', { body: { logtype: 'invalid' } }).then(function (res) {
        try {
          assert.equal(res.status, 422)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — tlog type clears logs', function (done) {
      sinon.stub(flightLogger.prototype, 'clearlogs').returns(undefined)
      request('POST', '/api/deletelogfiles', { body: { logtype: 'tlog' } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — binlog type accepted', function (done) {
      sinon.stub(flightLogger.prototype, 'clearlogs').returns(undefined)
      request('POST', '/api/deletelogfiles', { body: { logtype: 'binlog' } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — kmzlog type accepted', function (done) {
      sinon.stub(flightLogger.prototype, 'clearlogs').returns(undefined)
      request('POST', '/api/deletelogfiles', { body: { logtype: 'kmzlog' } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — media type accepted', function (done) {
      sinon.stub(flightLogger.prototype, 'clearlogs').returns(undefined)
      request('POST', '/api/deletelogfiles', { body: { logtype: 'media' } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  // =========================================================================
  // CameraSwitcher routes (×3)
  // =========================================================================
  describe('GET /api/cameraswitcher', function () {
    it('200 — returns settings and status', function (done) {
      sinon.stub(CameraSwitcher.prototype, 'getSettings').returns({ enabled: false, rcChannel: 7 })
      sinon.stub(CameraSwitcher.prototype, 'getStatus').returns({ activeSource: 'A' })
      request('GET', '/api/cameraswitcher').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(res.body.settings)
          assert.ok(res.body.status)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/cameraswitchermodify', function () {
    var validSwitcherBody = {
      enabled: false,
      rcChannel: 7,
      threshold: 1500,
      hysteresis: 50,
      minHoldMs: 500,
      switchMode: 'gstreamer'
    }

    it('422 — missing required fields', function (done) {
      request('POST', '/api/cameraswitchermodify', { body: {} }).then(function (res) {
        try {
          assert.equal(res.status, 422)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — success path', function (done) {
      sinon.stub(CameraSwitcher.prototype, 'setSettings').callsFake(function (opts, cb) {
        cb(null)
      })
      sinon.stub(CameraSwitcher.prototype, 'getSettings').returns({ enabled: false })
      request('POST', '/api/cameraswitchermodify', { body: validSwitcherBody }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.strictEqual(res.body.error, null)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('422 — setSettings returns validation error', function (done) {
      sinon.stub(CameraSwitcher.prototype, 'setSettings').callsFake(function (opts, cb) {
        cb(new Error('RC channel must be 1-18'))
      })
      sinon.stub(CameraSwitcher.prototype, 'getSettings').returns({ enabled: false })
      request('POST', '/api/cameraswitchermodify', { body: validSwitcherBody }).then(function (res) {
        try {
          assert.equal(res.status, 422)
          assert.ok(res.body.error)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/cameraswitcherswitch', function () {
    it('422 — invalid source value', function (done) {
      request('POST', '/api/cameraswitcherswitch', { body: { source: 'C' } }).then(function (res) {
        try {
          assert.equal(res.status, 422)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — source=A', function (done) {
      sinon.stub(CameraSwitcher.prototype, 'doSwitch').returns(undefined)
      sinon.stub(CameraSwitcher.prototype, 'getStatus').returns({ activeSource: 'A' })
      request('POST', '/api/cameraswitcherswitch', { body: { source: 'A' } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.strictEqual(res.body.error, null)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — source=B', function (done) {
      sinon.stub(CameraSwitcher.prototype, 'doSwitch').returns(undefined)
      sinon.stub(CameraSwitcher.prototype, 'getStatus').returns({ activeSource: 'B' })
      request('POST', '/api/cameraswitcherswitch', { body: { source: 'B' } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.strictEqual(res.body.error, null)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  // =========================================================================
  // CustomPipelines routes (×3)
  // =========================================================================
  describe('GET /api/custompipelines', function () {
    it('200 — returns pipelines list', function (done) {
      sinon.stub(CustomPipelines.prototype, 'getAllPipelines').returns([])
      request('GET', '/api/custompipelines').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(Array.isArray(res.body.pipelines))
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/custompipelinemodify', function () {
    it('422 — empty device', function (done) {
      request('POST', '/api/custompipelinemodify', { body: { device: '', enabled: true, pipeline: 'gst-launch-1.0 videotestsrc ! autovideosink' } }).then(function (res) {
        try {
          assert.equal(res.status, 422)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — success path', function (done) {
      sinon.stub(CustomPipelines.prototype, 'setPipeline').callsFake(function (dev, enabled, pipeline, cb) {
        cb(null)
      })
      sinon.stub(CustomPipelines.prototype, 'getAllPipelines').returns([])
      request('POST', '/api/custompipelinemodify', { body: { device: '/dev/video0', enabled: true, pipeline: 'videotestsrc ! autovideosink' } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.strictEqual(res.body.error, null)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('422 — setPipeline returns error', function (done) {
      sinon.stub(CustomPipelines.prototype, 'setPipeline').callsFake(function (dev, enabled, pipeline, cb) {
        cb(new Error('invalid pipeline'))
      })
      sinon.stub(CustomPipelines.prototype, 'getAllPipelines').returns([])
      request('POST', '/api/custompipelinemodify', { body: { device: '/dev/video0', enabled: true, pipeline: 'bad' } }).then(function (res) {
        try {
          assert.equal(res.status, 422)
          assert.ok(res.body.error)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/custompipelinevalidate', function () {
    it('422 — empty pipeline string', function (done) {
      request('POST', '/api/custompipelinevalidate', { body: { pipeline: '' } }).then(function (res) {
        try {
          assert.equal(res.status, 422)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — valid pipeline', function (done) {
      sinon.stub(CustomPipelines.prototype, 'validatePipeline').callsFake(function (pipeline, cb) {
        cb(null, true, null)
      })
      request('POST', '/api/custompipelinevalidate', { body: { pipeline: 'videotestsrc ! autovideosink' } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.strictEqual(res.body.valid, true)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — invalid pipeline (error from validator)', function (done) {
      sinon.stub(CustomPipelines.prototype, 'validatePipeline').callsFake(function (pipeline, cb) {
        cb(new Error('parse error'), false, 'bad syntax')
      })
      request('POST', '/api/custompipelinevalidate', { body: { pipeline: 'bad_pipeline_string' } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(res.body.error)
          assert.strictEqual(res.body.valid, false)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  // =========================================================================
  // CellularTuning routes (×2)
  // =========================================================================
  describe('GET /api/cellulartuning', function () {
    it('200 — returns settings and status', function (done) {
      sinon.stub(CellularTuning.prototype, 'getSettings').returns({ lowLatency: false, adaptiveBitrate: false, minBitrate: 250 })
      sinon.stub(CellularTuning.prototype, 'getStatus').returns({ tier: null })
      request('GET', '/api/cellulartuning').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(res.body.settings)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/cellulartuningmodify', function () {
    it('422 — missing fields', function (done) {
      request('POST', '/api/cellulartuningmodify', { body: {} }).then(function (res) {
        try {
          assert.equal(res.status, 422)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — success path', function (done) {
      sinon.stub(CellularTuning.prototype, 'setSettings').callsFake(function (opts, cb) {
        cb(null)
      })
      sinon.stub(CellularTuning.prototype, 'getSettings').returns({ lowLatency: false, adaptiveBitrate: false, minBitrate: 250 })
      request('POST', '/api/cellulartuningmodify', { body: { lowLatency: false, adaptiveBitrate: false, minBitrate: 250 } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.strictEqual(res.body.error, null)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('422 — setSettings returns error', function (done) {
      sinon.stub(CellularTuning.prototype, 'setSettings').callsFake(function (opts, cb) {
        cb(new Error('bad value'))
      })
      sinon.stub(CellularTuning.prototype, 'getSettings').returns({ lowLatency: false, adaptiveBitrate: false, minBitrate: 250 })
      request('POST', '/api/cellulartuningmodify', { body: { lowLatency: false, adaptiveBitrate: false, minBitrate: 250 } }).then(function (res) {
        try {
          assert.equal(res.status, 422)
          assert.ok(res.body.error)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  // =========================================================================
  // NetworkManager routes (×11)
  // =========================================================================
  describe('GET /api/networkadapters', function () {
    it('200 — success path returns device list', function (done) {
      sinon.stub(networkManager, 'getAdapters').callsFake(function (cb) {
        cb(null, [{ value: 'eth0', label: 'eth0 (ethernet)' }])
      })
      request('GET', '/api/networkadapters').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(Array.isArray(res.body.netDevice))
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — error path returns empty list', function (done) {
      sinon.stub(networkManager, 'getAdapters').callsFake(function (cb) {
        cb('nm error')
      })
      request('GET', '/api/networkadapters').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.equal(res.body.netDevice.length, 0)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('GET /api/wifiscan', function () {
    it('200 — success path returns wifi list', function (done) {
      sinon.stub(networkManager, 'getWifiScan').callsFake(function (cb) {
        cb(null, [{ ssid: 'MyWifi' }])
      })
      request('GET', '/api/wifiscan').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(Array.isArray(res.body.detWifi))
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — error path returns empty list', function (done) {
      sinon.stub(networkManager, 'getWifiScan').callsFake(function (cb) {
        cb('wifi scan error')
      })
      request('GET', '/api/wifiscan').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.equal(res.body.detWifi.length, 0)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('GET /api/wirelessstatus', function () {
    it('200 — success path', function (done) {
      sinon.stub(networkManager, 'getWirelessStatus').callsFake(function (cb) {
        cb(null, true)
      })
      request('GET', '/api/wirelessstatus').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.strictEqual(res.body.wirelessEnabled, true)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — error path defaults to true', function (done) {
      sinon.stub(networkManager, 'getWirelessStatus').callsFake(function (cb) {
        cb('wifi error', null)
      })
      request('GET', '/api/wirelessstatus').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.strictEqual(res.body.wirelessEnabled, true)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/setwirelessstatus', function () {
    it('422 — missing status', function (done) {
      request('POST', '/api/setwirelessstatus', { body: {} }).then(function (res) {
        try {
          assert.equal(res.status, 422)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — success path', function (done) {
      sinon.stub(networkManager, 'setWirelessStatus').callsFake(function (status, cb) {
        cb(null, status)
      })
      request('POST', '/api/setwirelessstatus', { body: { status: true } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.strictEqual(res.body.wirelessEnabled, true)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — error path', function (done) {
      sinon.stub(networkManager, 'setWirelessStatus').callsFake(function (status, cb) {
        cb('wifi toggle error', false)
      })
      request('POST', '/api/setwirelessstatus', { body: { status: false } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.strictEqual(res.body.wirelessEnabled, false)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('GET /api/networkconnections', function () {
    it('200 — success path returns connections', function (done) {
      sinon.stub(networkManager, 'getConnections').callsFake(function (cb) {
        cb(null, [{ id: 'conn1' }])
      })
      request('GET', '/api/networkconnections').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(Array.isArray(res.body.netConnection))
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — error path returns empty list', function (done) {
      sinon.stub(networkManager, 'getConnections').callsFake(function (cb) {
        cb('conn error')
      })
      request('GET', '/api/networkconnections').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.equal(res.body.netConnection.length, 0)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/networkIP', function () {
    var validUUID = '123e4567-e89b-12d3-a456-426614174000'

    it('422 — non-UUID conName', function (done) {
      request('POST', '/api/networkIP', { body: { conName: 'not-a-uuid' } }).then(function (res) {
        try {
          assert.equal(res.status, 422)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — success path returns connection details', function (done) {
      sinon.stub(networkManager, 'getConnectionDetails').callsFake(function (name, cb) {
        cb(null, { ip: '192.168.1.5' })
      })
      request('POST', '/api/networkIP', { body: { conName: validUUID } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(res.body.netConnectionDetails)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — error path returns empty details', function (done) {
      sinon.stub(networkManager, 'getConnectionDetails').callsFake(function (name, cb) {
        cb('details error', null)
      })
      request('POST', '/api/networkIP', { body: { conName: validUUID } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.deepStrictEqual(res.body.netConnectionDetails, {})
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/networkactivate', function () {
    var validUUID = '123e4567-e89b-12d3-a456-426614174000'

    it('200 (error field) — non-UUID conName fails validation inline', function (done) {
      request('POST', '/api/networkactivate', { body: { conName: 'not-a-uuid' } }).then(function (res) {
        try {
          // handler sends 200 with error field for validation failures (upstream behavior)
          assert.equal(res.status, 200)
          assert.ok(res.body.error)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — success path', function (done) {
      sinon.stub(networkManager, 'activateConnection').callsFake(function (name, cb) {
        cb(null)
      })
      request('POST', '/api/networkactivate', { body: { conName: validUUID } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.equal(res.body.action, 'NetworkActivateOK')
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — error path returns error field', function (done) {
      sinon.stub(networkManager, 'activateConnection').callsFake(function (name, cb) {
        cb('activate failed')
      })
      request('POST', '/api/networkactivate', { body: { conName: validUUID } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(res.body.error)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/networkdeactivate', function () {
    var validUUID = '123e4567-e89b-12d3-a456-426614174000'

    it('200 (error field) — non-UUID conName fails validation inline', function (done) {
      request('POST', '/api/networkdeactivate', { body: { conName: 'not-a-uuid' } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(res.body.error)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — success path', function (done) {
      sinon.stub(networkManager, 'deactivateConnection').callsFake(function (name, cb) {
        cb(null)
      })
      request('POST', '/api/networkdeactivate', { body: { conName: validUUID } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.equal(res.body.action, 'NetworkDectivateOK')
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — error path', function (done) {
      sinon.stub(networkManager, 'deactivateConnection').callsFake(function (name, cb) {
        cb('deactivate failed')
      })
      request('POST', '/api/networkdeactivate', { body: { conName: validUUID } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(res.body.error)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/networkdelete', function () {
    var validUUID = '123e4567-e89b-12d3-a456-426614174000'

    it('200 (error field) — non-UUID conName fails validation inline', function (done) {
      request('POST', '/api/networkdelete', { body: { conName: 'not-a-uuid' } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(res.body.error)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — success path', function (done) {
      sinon.stub(networkManager, 'deleteConnection').callsFake(function (name, cb) {
        cb(null)
      })
      request('POST', '/api/networkdelete', { body: { conName: validUUID } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.equal(res.body.action, 'NetworkDeleteOK')
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — error path', function (done) {
      sinon.stub(networkManager, 'deleteConnection').callsFake(function (name, cb) {
        cb('delete failed')
      })
      request('POST', '/api/networkdelete', { body: { conName: validUUID } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(res.body.error)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/networkedit', function () {
    var validUUID = '123e4567-e89b-12d3-a456-426614174000'
    var validEditBody = {
      conName: validUUID,
      conSettings: { ipaddresstype: 'auto' }
    }

    it('200 (error field) — invalid conSettings.ipaddresstype', function (done) {
      request('POST', '/api/networkedit', { body: { conName: validUUID, conSettings: { ipaddresstype: 'bad' } } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(res.body.error)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — success path', function (done) {
      sinon.stub(networkManager, 'editConnection').callsFake(function (name, settings, cb) {
        cb(null)
      })
      request('POST', '/api/networkedit', { body: validEditBody }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.equal(res.body.action, 'NetworkEditOK')
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — error path', function (done) {
      sinon.stub(networkManager, 'editConnection').callsFake(function (name, settings, cb) {
        cb('edit failed')
      })
      request('POST', '/api/networkedit', { body: validEditBody }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(res.body.error)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/networkadd', function () {
    var validAddBody = {
      conName: 'myconn',
      conType: 'ethernet',
      conAdapter: 'eth0',
      conSettings: { ipaddresstype: 'auto' }
    }

    it('200 (error field) — invalid ipaddresstype', function (done) {
      request('POST', '/api/networkadd', { body: { conName: 'x', conType: 'wifi', conAdapter: 'wlan0', conSettings: { ipaddresstype: 'bad' } } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(res.body.error)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — success path', function (done) {
      sinon.stub(networkManager, 'addConnection').callsFake(function (name, type, adapter, settings, cb) {
        cb(null)
      })
      request('POST', '/api/networkadd', { body: validAddBody }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.equal(res.body.action, 'NetworkAddOK')
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — error path', function (done) {
      sinon.stub(networkManager, 'addConnection').callsFake(function (name, type, adapter, settings, cb) {
        cb('add failed')
      })
      request('POST', '/api/networkadd', { body: validAddBody }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(res.body.error)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  // =========================================================================
  // LTE modem routes
  // =========================================================================
  describe('GET /api/ltemodem', function () {
    it('200 — returns settings, status and serial ports', function (done) {
      sinon.stub(LTEModem.prototype, 'getSerialPorts').resolves(['/dev/ttyUSB2'])
      sinon.stub(LTEModem.prototype, 'getSettings').returns({ enabled: false, atPort: '/dev/ttyUSB2' })
      sinon.stub(LTEModem.prototype, 'getStatus').returns({ available: false, signal: null })
      request('GET', '/api/ltemodem').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(res.body.settings)
          assert.ok(res.body.status)
          assert.ok(Array.isArray(res.body.serialPorts))
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/ltemodemmodify', function () {
    var validLTEBody = {
      enabled: false,
      atPort: '/dev/ttyUSB2',
      baud: 115200,
      apn: '',
      netInterface: 'usb0',
      autoReconnect: false,
      pollInterval: 5
    }

    it('422 — missing required fields', function (done) {
      request('POST', '/api/ltemodemmodify', { body: { enabled: false } }).then(function (res) {
        try {
          assert.equal(res.status, 422)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — success path', function (done) {
      sinon.stub(LTEModem.prototype, 'setSettings').callsFake(function (opts, cb) {
        cb(null)
      })
      sinon.stub(LTEModem.prototype, 'getSettings').returns({ enabled: false })
      request('POST', '/api/ltemodemmodify', { body: validLTEBody }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.strictEqual(res.body.error, null)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('422 — setSettings returns error', function (done) {
      sinon.stub(LTEModem.prototype, 'setSettings').callsFake(function (opts, cb) {
        cb(new Error('modem busy'))
      })
      sinon.stub(LTEModem.prototype, 'getSettings').returns({ enabled: false })
      request('POST', '/api/ltemodemmodify', { body: validLTEBody }).then(function (res) {
        try {
          assert.equal(res.status, 422)
          assert.ok(res.body.error)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/ltemodemreconnect', function () {
    it('200 — success path', function (done) {
      sinon.stub(LTEModem.prototype, 'reconnect').resolves(['OK'])
      request('POST', '/api/ltemodemreconnect').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.strictEqual(res.body.error, null)
          assert.ok(Array.isArray(res.body.response))
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('422 — reconnect rejects', function (done) {
      sinon.stub(LTEModem.prototype, 'reconnect').rejects(new Error('no modem'))
      request('POST', '/api/ltemodemreconnect').then(function (res) {
        try {
          assert.equal(res.status, 422)
          assert.ok(res.body.error)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/ltemodemresetusage', function () {
    it('200 — resets usage counters', function (done) {
      sinon.stub(LTEModem.prototype, 'resetUsage').returns(undefined)
      sinon.stub(LTEModem.prototype, 'getStatus').returns({ available: false })
      request('POST', '/api/ltemodemresetusage').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.strictEqual(res.body.error, null)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/ltemodemdetect', function () {
    it('200 — success path', function (done) {
      sinon.stub(LTEModem.prototype, 'detectModem').resolves({ ports: ['/dev/ttyUSB2'], interfaces: ['usb0'] })
      request('POST', '/api/ltemodemdetect').then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(Array.isArray(res.body.ports))
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('422 — detectModem rejects', function (done) {
      sinon.stub(LTEModem.prototype, 'detectModem').rejects(new Error('scan failed'))
      request('POST', '/api/ltemodemdetect').then(function (res) {
        try {
          assert.equal(res.status, 422)
          assert.ok(res.body.error)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/ltemodemtest', function () {
    it('422 — invalid pingHost', function (done) {
      request('POST', '/api/ltemodemtest', { body: { pingHost: 'bad host!@#' } }).then(function (res) {
        try {
          assert.equal(res.status, 422)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — success path', function (done) {
      sinon.stub(LTEModem.prototype, 'testConnection').resolves([{ name: 'AT', ok: true }])
      request('POST', '/api/ltemodemtest', { body: {} }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.ok(Array.isArray(res.body.steps))
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — success with pingHost', function (done) {
      sinon.stub(LTEModem.prototype, 'testConnection').resolves([{ name: 'ping', ok: true }])
      request('POST', '/api/ltemodemtest', { body: { pingHost: '8.8.8.8' } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('422 — testConnection rejects', function (done) {
      sinon.stub(LTEModem.prototype, 'testConnection').rejects(new Error('test fail'))
      request('POST', '/api/ltemodemtest', { body: {} }).then(function (res) {
        try {
          assert.equal(res.status, 422)
          assert.ok(res.body.error)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  describe('POST /api/ltemodemcommand', function () {
    it('422 — command too short', function (done) {
      request('POST', '/api/ltemodemcommand', { body: { command: 'A' } }).then(function (res) {
        try {
          assert.equal(res.status, 422)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('200 — success path', function (done) {
      sinon.stub(LTEModem.prototype, 'sendUserCommand').callsFake(function (cmd, cb) {
        cb(null, ['OK'])
      })
      request('POST', '/api/ltemodemcommand', { body: { command: 'AT+CREG?' } }).then(function (res) {
        try {
          assert.equal(res.status, 200)
          assert.strictEqual(res.body.error, null)
          assert.ok(Array.isArray(res.body.response))
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })

    it('422 — sendUserCommand returns error', function (done) {
      sinon.stub(LTEModem.prototype, 'sendUserCommand').callsFake(function (cmd, cb) {
        cb(new Error('AT error'), [])
      })
      request('POST', '/api/ltemodemcommand', { body: { command: 'AT+CREG?' } }).then(function (res) {
        try {
          assert.equal(res.status, 422)
          assert.ok(res.body.error)
          done()
        } catch (e) { done(e) }
      }).catch(done)
    })
  })

  // =========================================================================
  // Production SPA catch-all — unreachable in development (NODE_ENV=development)
  // =========================================================================
  // The `if (process.env.NODE_ENV !== 'development')` guard at line 1827 means
  // the catch-all route block is never registered when tests run.
  // This is genuinely unreachable under the test harness without restarting the
  // process in production mode — which would break the shared singleton.
  /* istanbul ignore next -- spa-catch-all: guarded by NODE_ENV !== development; unreachable in test harness without process restart */

})
