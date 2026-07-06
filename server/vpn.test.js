const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const sinon = require('sinon')
const { FakeBin } = require('../test/fakeBin')
const logpaths = require('./paths')
const VPNManager = require('./vpn')

describe('VPN Functions', function () {
  // all binaries (which/sudo/cp/rm) are faked so the tests never touch a
  // real zerotier/wireguard install; scenarios select the failure modes
  let fake
  let tmpDir
  let fakeWgPy

  before(function () {
    fake = new FakeBin()
    fake.install('which', `case "$FAKE_SCENARIO" in
zt-missing) [ "$1" = "zerotier-cli" ] && exit 1 ;;
zt-empty) [ "$1" = "zerotier-cli" ] && exit 0 ;;
wg-missing) [ "$1" = "wg-quick" ] && exit 1 ;;
wg-empty) [ "$1" = "wg-quick" ] && exit 0 ;;
ts-missing) [ "$1" = "tailscale" ] && exit 1 ;;
ts-empty) [ "$1" = "tailscale" ] && exit 0 ;;
esac
echo "/usr/bin/$1"`)
    fake.install('sudo', `case "$FAKE_SCENARIO" in
zt-err) echo boom >&2; exit 0 ;;
zt-connfail) echo "connection failed"; exit 0 ;;
esac
case "$1 $2" in
"zerotier-cli info")
  case "$FAKE_SCENARIO" in
  zt-offline) echo "200 info abc 1.10.1 OFFLINE" ;;
  zt-tunneled) echo "200 info abc 1.10.1 TUNNELED" ;;
  *) echo "200 info abc 1.10.1 ONLINE" ;;
  esac ;;
"zerotier-cli listnetworks")
  if [ "$FAKE_SCENARIO" = "zt-badjson" ]; then echo "not json"; else echo "[]"; fi ;;
"zerotier-cli join")
  if [ "$FAKE_SCENARIO" = "zt-joinfail" ]; then echo "500 join failed"; else echo "200 join OK"; fi ;;
"zerotier-cli leave")
  if [ "$FAKE_SCENARIO" = "zt-leavefail" ]; then echo "500 leave failed"; else echo "200 leave OK"; fi ;;
"tailscale status")
  case "$FAKE_SCENARIO" in
  ts-err) echo "ts boom" >&2; exit 0 ;;
  ts-badjson) echo "not json" ;;
  ts-stopped) echo '{"BackendState":"Stopped"}' ;;
  *) echo '{"BackendState":"Running","Self":{"HostName":"pi","TailscaleIPs":["100.64.0.1"],"Online":true},"Peer":{"k":{"HostName":"laptop","Online":true}}}' ;;
  esac ;;
"tailscale up")
  if [ "$FAKE_SCENARIO" = "ts-upfail" ]; then echo "ts up boom" >&2; fi ;;
"tailscale down")
  if [ "$FAKE_SCENARIO" = "ts-downfail" ]; then echo "ts down boom" >&2; fi ;;
"wg-quick up"|"wg-quick down")
  if [ "$FAKE_SCENARIO" = "wg-fail" ]; then echo "wg boom" >&2; exit 1; fi ;;
"systemctl enable"|"systemctl disable")
  if [ "$FAKE_SCENARIO" = "sysctl-fail" ]; then exit 1; fi
  if [ "$FAKE_SCENARIO" = "wg-noexist" ]; then echo "wg-quick@xxxxx.service does not exist"; fi ;;
esac
exit 0`)
    fake.install('cp', 'if [ "$FAKE_SCENARIO" = "cp-fail" ]; then echo "cp: cannot create" >&2; exit 1; fi')
    fake.install('rm', 'if [ "$FAKE_SCENARIO" = "rm-stderr" ]; then echo "rm: cannot remove" >&2; fi')
    fake.activate()

    // wireguardconfig.py stand-in, selected by stubbing logpaths.getPythonPath
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-vpn-'))
    fakeWgPy = path.join(tmpDir, 'fake-wgpy')
    fs.writeFileSync(fakeWgPy,
      '#!/bin/sh\nif [ "$FAKE_SCENARIO" = "py-fail" ]; then echo pyboom >&2; exit 1; fi\nif [ "$FAKE_SCENARIO" = "py-badjson" ]; then echo "not json"; exit 0; fi\necho "[]"\n',
      { mode: 0o755 })
  })

  after(function () {
    fake.cleanup()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  beforeEach(function () {
    sinon.stub(logpaths, 'getPythonPath').returns(fakeWgPy)
  })

  afterEach(function () {
    sinon.restore()
    delete process.env.FAKE_SCENARIO
  })

  describe('#getVPNStatusZerotier()', function () {
    it('should report an online zerotier', function (done) {
      VPNManager.getVPNStatusZerotier(null, (stderr, statusJSON) => {
        assert.equal(stderr, null)
        assert.equal(statusJSON.installed, true)
        assert.equal(statusJSON.status, true)
        assert.deepEqual(statusJSON.text, [])
        done()
      })
    })

    it('should report a tunneled zerotier as online', function (done) {
      process.env.FAKE_SCENARIO = 'zt-tunneled'
      VPNManager.getVPNStatusZerotier(null, (stderr, statusJSON) => {
        assert.equal(stderr, null)
        assert.equal(statusJSON.status, true)
        done()
      })
    })

    it('should report an offline zerotier', function (done) {
      process.env.FAKE_SCENARIO = 'zt-offline'
      VPNManager.getVPNStatusZerotier(null, (stderr, statusJSON) => {
        assert.equal(stderr, null)
        assert.equal(statusJSON.installed, true)
        assert.equal(statusJSON.status, false)
        done()
      })
    })

    it('should report zerotier as not installed', function (done) {
      process.env.FAKE_SCENARIO = 'zt-missing'
      VPNManager.getVPNStatusZerotier(null, (stderr, statusJSON) => {
        assert.equal(stderr, null)
        assert.equal(statusJSON.installed, false)
        done()
      })
    })

    it('should treat an empty which result as not installed', function (done) {
      process.env.FAKE_SCENARIO = 'zt-empty'
      VPNManager.getVPNStatusZerotier(null, (stderr, statusJSON) => {
        assert.equal(statusJSON.installed, false)
        done()
      })
    })

    it('should pass through cli errors on stderr', function (done) {
      process.env.FAKE_SCENARIO = 'zt-err'
      VPNManager.getVPNStatusZerotier(null, (stderr, statusJSON) => {
        assert.ok(stderr.includes('boom'))
        assert.equal(statusJSON.installed, false)
        done()
      })
    })

    it('should report a daemon connection failure', function (done) {
      process.env.FAKE_SCENARIO = 'zt-connfail'
      VPNManager.getVPNStatusZerotier(null, (stderr, statusJSON) => {
        assert.equal(statusJSON.installed, true)
        assert.equal(statusJSON.status, false)
        done()
      })
    })

    it('should not crash on malformed network JSON (R4)', function (done) {
      // partial/garbled zerotier-cli output must yield a safe result, not throw
      process.env.FAKE_SCENARIO = 'zt-badjson'
      VPNManager.getVPNStatusZerotier(null, (stderr, statusJSON) => {
        assert.ok(stderr.includes('Unable to parse'))
        assert.equal(statusJSON.installed, true)
        assert.equal(statusJSON.status, false)
        assert.deepEqual(statusJSON.text, [])
        done()
      })
    })
  })

  describe('#addZerotier() and #removeZerotier()', function () {
    it('should join a network', function (done) {
      VPNManager.addZerotier('aaaabbbbcccc0001', (stderr, statusJSON) => {
        assert.equal(stderr, null)
        assert.equal(statusJSON.installed, true)
        done()
      })
    })

    it('should pass through a failed join', function (done) {
      process.env.FAKE_SCENARIO = 'zt-joinfail'
      VPNManager.addZerotier('xxxxx', (stderr, statusJSON) => {
        assert.ok(stderr.includes('500 join failed'))
        assert.equal(statusJSON.installed, true)
        done()
      })
    })

    it('should leave a network', function (done) {
      VPNManager.removeZerotier('aaaabbbbcccc0001', (stderr, statusJSON) => {
        assert.equal(stderr, null)
        assert.equal(statusJSON.installed, true)
        done()
      })
    })

    it('should pass through a failed leave', function (done) {
      process.env.FAKE_SCENARIO = 'zt-leavefail'
      VPNManager.removeZerotier('xxxxx', (stderr, statusJSON) => {
        assert.ok(stderr.includes('500 leave failed'))
        done()
      })
    })

    it('should log stderr from join and leave', function (done) {
      this.timeout(5000)
      // on stderr the callback is never run, only console.error
      process.env.FAKE_SCENARIO = 'zt-err'
      const errSpy = sinon.spy(console, 'error')
      VPNManager.addZerotier('xxxxx', () => done(new Error('callback should not run')))
      VPNManager.removeZerotier('xxxxx', () => done(new Error('callback should not run')))

      const deadline = Date.now() + 3000
      const check = () => {
        if (errSpy.callCount >= 2) {
          return done()
        }
        if (Date.now() > deadline) {
          return done(new Error('stderr was not logged'))
        }
        setTimeout(check, 25)
      }
      check()
    })
  })

  describe('#getVPNStatusTailscale()', function () {
    it('should report a running tailscale with self + peers', function (done) {
      VPNManager.getVPNStatusTailscale(null, (stderr, statusJSON) => {
        assert.equal(stderr, null)
        assert.equal(statusJSON.installed, true)
        assert.equal(statusJSON.status, true)
        assert.equal(statusJSON.text.length, 2)
        const self = statusJSON.text.find(n => n.self)
        assert.equal(self.ip, '100.64.0.1')
        const peer = statusJSON.text.find(n => !n.self)
        assert.equal(peer.ip, '') // peer has no TailscaleIPs → falls back to ''
        done()
      })
    })

    it('should report a stopped tailscale (no self/peers)', function (done) {
      process.env.FAKE_SCENARIO = 'ts-stopped'
      VPNManager.getVPNStatusTailscale(null, (stderr, statusJSON) => {
        assert.equal(statusJSON.installed, true)
        assert.equal(statusJSON.status, false)
        assert.deepEqual(statusJSON.text, [])
        done()
      })
    })

    it('should report tailscale as not installed (which exit 1)', function (done) {
      process.env.FAKE_SCENARIO = 'ts-missing'
      VPNManager.getVPNStatusTailscale(null, (stderr, statusJSON) => {
        assert.equal(stderr, null)
        assert.equal(statusJSON.installed, false)
        done()
      })
    })

    it('should treat an empty which result as not installed', function (done) {
      process.env.FAKE_SCENARIO = 'ts-empty'
      VPNManager.getVPNStatusTailscale(null, (stderr, statusJSON) => {
        assert.equal(statusJSON.installed, false)
        done()
      })
    })

    it('should pass through cli errors on stderr', function (done) {
      process.env.FAKE_SCENARIO = 'ts-err'
      VPNManager.getVPNStatusTailscale(null, (stderr, statusJSON) => {
        assert.ok(stderr.includes('ts boom'))
        assert.equal(statusJSON.installed, false)
        done()
      })
    })

    it('should handle unparseable status output', function (done) {
      process.env.FAKE_SCENARIO = 'ts-badjson'
      VPNManager.getVPNStatusTailscale(null, (stderr, statusJSON) => {
        assert.ok(stderr.includes('Unable to parse'))
        assert.equal(statusJSON.installed, true)
        assert.equal(statusJSON.status, false)
        done()
      })
    })
  })

  describe('#connectTailscale() and #disconnectTailscale()', function () {
    it('should connect with an auth key', function (done) {
      VPNManager.connectTailscale('tskey-auth-abc123', (stderr, statusJSON) => {
        assert.equal(stderr, null)
        assert.equal(statusJSON.installed, true)
        assert.equal(statusJSON.status, true)
        done()
      })
    })

    it('should pass through a connect failure', function (done) {
      process.env.FAKE_SCENARIO = 'ts-upfail'
      VPNManager.connectTailscale('badkey', (stderr, statusJSON) => {
        assert.ok(stderr.includes('ts up boom'))
        done()
      })
    })

    it('should disconnect', function (done) {
      VPNManager.disconnectTailscale((stderr, statusJSON) => {
        assert.equal(stderr, null)
        assert.equal(statusJSON.installed, true)
        done()
      })
    })

    it('should pass through a disconnect failure', function (done) {
      process.env.FAKE_SCENARIO = 'ts-downfail'
      VPNManager.disconnectTailscale((stderr, statusJSON) => {
        assert.ok(stderr.includes('ts down boom'))
        done()
      })
    })
  })

  describe('#getVPNStatusWireguard()', function () {
    it('should report wireguard profiles', function (done) {
      VPNManager.getVPNStatusWireguard(null, (stderr, statusJSON) => {
        assert.equal(stderr, null)
        assert.equal(statusJSON.installed, true)
        assert.equal(statusJSON.status, true)
        assert.deepEqual(statusJSON.text, [])
        done()
      })
    })

    it('should report wireguard as not installed', function (done) {
      process.env.FAKE_SCENARIO = 'wg-missing'
      VPNManager.getVPNStatusWireguard(null, (stderr, statusJSON) => {
        assert.equal(stderr, null)
        assert.equal(statusJSON.installed, false)
        done()
      })
    })

    it('should treat an empty which result as not installed', function (done) {
      process.env.FAKE_SCENARIO = 'wg-empty'
      VPNManager.getVPNStatusWireguard(null, (stderr, statusJSON) => {
        assert.equal(statusJSON.installed, false)
        done()
      })
    })

    it('should pass through a config reader failure', function (done) {
      process.env.FAKE_SCENARIO = 'py-fail'
      VPNManager.getVPNStatusWireguard(null, (stderr, statusJSON) => {
        assert.ok(stderr.includes('pyboom'))
        assert.equal(statusJSON.installed, false)
        done()
      })
    })

    it('should not crash on malformed config JSON (R4)', function (done) {
      // partial/garbled wireguardconfig.py output must yield a safe result
      process.env.FAKE_SCENARIO = 'py-badjson'
      VPNManager.getVPNStatusWireguard(null, (stderr, statusJSON) => {
        assert.ok(stderr.includes('Unable to parse'))
        assert.equal(statusJSON.installed, true)
        assert.equal(statusJSON.status, false)
        assert.deepEqual(statusJSON.text, [])
        done()
      })
    })
  })

  describe('#addWireguardProfile()', function () {
    it('should reject a bad extension', function (done) {
      VPNManager.addWireguardProfile('evil.exe', '/tmp/upload', (err) => {
        assert.equal(err, 'Bad extension')
        done()
      })
    })

    it('should install a profile (temp cleanup tolerates a missing file)', function (done) {
      // tmp file never created → fs.unlink errors, but that must not surface
      const missing = path.join(tmpDir, 'nope-upload')
      VPNManager.addWireguardProfile('drone.conf', missing, (err) => {
        assert.equal(err, null)
        done()
      })
    })

    it('should copy with an argv array + basename and remove the temp file (S10)', function (done) {
      // a path-traversal filename must be collapsed to a basename under
      // /etc/wireguard, and the copy must go through argv (no shell "&& rm")
      const src = path.join(tmpDir, 'wg-upload-src')
      fs.writeFileSync(src, '[Interface]\n')
      VPNManager.addWireguardProfile('../../../etc/pwn.conf', src, (err) => {
        assert.equal(err, null)
        const cpCalls = fake.calls('cp')
        const last = cpCalls[cpCalls.length - 1]
        // argv: "<src> <dest>" — no shell metacharacters, no traversal left
        assert.equal(last, src + ' /etc/wireguard/pwn.conf')
        assert.ok(!last.includes('..'))
        assert.ok(!last.includes('&&'))
        // the temp upload was unlinked after a successful copy
        assert.equal(fs.existsSync(src), false)
        done()
      })
    })

    it('should pass through a copy failure', function (done) {
      process.env.FAKE_SCENARIO = 'cp-fail'
      VPNManager.addWireguardProfile('drone.conf', '/tmp/upload', (err) => {
        assert.ok(err.includes('cannot create'))
        done()
      })
    })
  })

  describe('#activateWireguardProfile()', function () {
    it('should activate a profile', function (done) {
      VPNManager.activateWireguardProfile('drone.conf', (stderr, statusJSON) => {
        assert.equal(stderr, null)
        assert.equal(statusJSON.installed, true)
        done()
      })
    })

    it('should report a wg-quick failure', function (done) {
      process.env.FAKE_SCENARIO = 'wg-fail'
      VPNManager.activateWireguardProfile('drone.conf', (stderr, statusJSON) => {
        assert.ok(stderr.includes('wg boom'))
        assert.equal(statusJSON.installed, true)
        done()
      })
    })

    it('should report a systemctl failure', function (done) {
      process.env.FAKE_SCENARIO = 'sysctl-fail'
      VPNManager.activateWireguardProfile('drone.conf', (stderr, statusJSON) => {
        assert.ok(stderr.includes('Command failed'))
        done()
      })
    })

    it('should report a missing unit', function (done) {
      process.env.FAKE_SCENARIO = 'wg-noexist'
      VPNManager.activateWireguardProfile('xxxxx.conf', (stderr, statusJSON) => {
        assert.ok(stderr.includes('does not exist'))
        done()
      })
    })
  })

  describe('#deactivateWireguardProfile()', function () {
    it('should deactivate a profile', function (done) {
      VPNManager.deactivateWireguardProfile('drone.conf', (stderr, statusJSON) => {
        assert.equal(stderr, null)
        assert.equal(statusJSON.installed, true)
        done()
      })
    })

    it('should report a wg-quick failure', function (done) {
      process.env.FAKE_SCENARIO = 'wg-fail'
      VPNManager.deactivateWireguardProfile('drone.conf', (stderr, statusJSON) => {
        assert.ok(stderr.includes('wg boom'))
        done()
      })
    })

    it('should report a systemctl failure', function (done) {
      process.env.FAKE_SCENARIO = 'sysctl-fail'
      VPNManager.deactivateWireguardProfile('drone.conf', (stderr, statusJSON) => {
        assert.ok(stderr.includes('Command failed'))
        done()
      })
    })

    it('should report a missing unit', function (done) {
      process.env.FAKE_SCENARIO = 'wg-noexist'
      VPNManager.deactivateWireguardProfile('xxxxx.conf', (stderr, statusJSON) => {
        assert.ok(stderr.includes('does not exist'))
        done()
      })
    })
  })

  describe('#deleteWireguardProfile()', function () {
    it('should delete a profile', function (done) {
      VPNManager.deleteWireguardProfile('drone.conf', (err, statusJSON) => {
        assert.equal(err, null)
        assert.equal(statusJSON.installed, true)
        done()
      })
    })

    it('should reject a bad extension (and still try the delete)', function (done) {
      // the bad-extension guard does not return, so the callback runs twice:
      // once with the error, once from the rm that follows anyway
      const results = []
      VPNManager.deleteWireguardProfile('../evil.exe', (err) => {
        results.push(err)
        if (results.length === 2) {
          assert.ok(results.some((e) => e instanceof Error && e.message === 'Bad extension'))
          assert.ok(results.some((e) => e === null))
          done()
        }
      })
    })

    it('should log stderr from rm', function (done) {
      process.env.FAKE_SCENARIO = 'rm-stderr'
      const errSpy = sinon.spy(console, 'error')
      VPNManager.deleteWireguardProfile('drone.conf', (err, statusJSON) => {
        try {
          // the logged message holds the (null) error object, not the stderr text
          assert.equal(err, null)
          assert.ok(errSpy.getCalls().some((c) => String(c.args[0]).includes('exec error')))
          done()
        } catch (e) {
          done(e)
        }
      })
    })
  })
})
