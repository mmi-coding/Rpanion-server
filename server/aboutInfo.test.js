const assert = require('assert')
const sinon = require('sinon')
const si = require('systeminformation')
const { FakeBin } = require('../test/fakeBin')
const aboutPage = require('./aboutInfo')

describe('About Functions', function () {
  afterEach(function () {
    sinon.restore()
    delete process.env.FAKE_SCENARIO
  })

  describe('#getSoftwareInfo()', function () {
    it('should get software info', function (done) {
      aboutPage.getSoftwareInfo(function (OSV, NodeV, RpanionV, hostname, err) {
        assert.notEqual(OSV, '')
        assert.notEqual(NodeV, '')
        assert.notEqual(RpanionV, '')
        assert.notEqual(hostname, '')
        assert.equal(err, null)
        done()
      })
    })
  })

  describe('#getDiskInfo()', function () {
    it('should get disk info', function (done) {
      aboutPage.getDiskInfo(function (total, used, percent, err) {
        assert.notEqual(total, 0)
        assert.notEqual(used, 0)
        assert.notEqual(percent, 0)
        assert.equal(err, null)
        done()
      })
    })
  })

  describe('#getHardwareInfo()', function () {
    it('should get hardware info', function (done) {
      aboutPage.getHardwareInfo(function (RAM, CPU, HAT, sysData, err) {
        assert.notEqual(RAM, '')
        assert.notEqual(CPU, '')
        assert.notEqual(sysData, '')
        assert.equal(HAT.product, '')
        assert.equal(HAT.vendor, '')
        assert.equal(HAT.version, '')
        assert.equal(err, null)
        done()
      })
    })

    it('should read the Pi model and HAT data', function (done) {
      // empty model/manufacturer (as on a RasPi) triggers the /proc/cpuinfo
      // fallback; a fake `cat` provides the device-tree HAT files
      sinon.stub(si, 'get').resolves({
        cpu: { manufacturer: 'ARM', brand: 'Cortex-A72', speed: 1.5, cores: 4 },
        system: { model: '', manufacturer: '' },
        mem: { total: 4 * 1024 * 1024 * 1024 }
      })
      const fake = new FakeBin()
      fake.install('cat', 'case "$1" in\n' +
        '/proc/device-tree/hat/product) printf %s FakeHAT;;\n' +
        '/proc/device-tree/hat/vendor) printf %s FakeVendor;;\n' +
        '/proc/device-tree/hat/product_ver) printf %s 1.0;;\n' +
        '*) exec /bin/cat "$@";;\n' +
        'esac')
      fake.activate()

      aboutPage.getHardwareInfo(function (RAM, CPU, HAT, sysData, err) {
        try {
          assert.equal(RAM, '4.00')
          assert.equal(CPU, 'ARM Cortex-A72 (1.5GHz x 4)')
          assert.equal(HAT.product, 'FakeHAT')
          assert.equal(HAT.vendor, 'FakeVendor')
          assert.equal(HAT.version, '1.0')
          assert.equal(err, null)
          done()
        } catch (e) {
          done(e)
        } finally {
          fake.cleanup()
        }
      })
    })
  })

  describe('#getLiveStats()', function () {
    it('returns CPU/temp/mem/disk/uptime stats', function (done) {
      sinon.stub(si, 'get').resolves({
        currentLoad: { currentLoad: 42.6 },
        cpuTemperature: { main: 55.3 },
        mem: { total: 4 * 1024 * 1024 * 1024, available: 1 * 1024 * 1024 * 1024 },
        fsSize: [{ mount: '/boot', size: 1e9, used: 1e8 }, { mount: '/', size: 32 * 1024 * 1024 * 1024, used: 8 * 1024 * 1024 * 1024 }],
        time: { uptime: 3661 }
      })
      aboutPage.getLiveStats(function (stats, err) {
        try {
          assert.equal(err, null)
          assert.equal(stats.cpuLoad, 43)
          assert.equal(stats.cpuTempC, 55)
          assert.equal(stats.memUsedMB, 3072)
          assert.equal(stats.memTotalMB, 4096)
          assert.equal(stats.diskUsedGB, 8)
          assert.equal(stats.diskTotalGB, 32)
          assert.equal(stats.uptimeSec, 3661)
          done()
        } catch (e) { done(e) }
      })
    })

    it('handles a missing root mount and unavailable temperature', function (done) {
      sinon.stub(si, 'get').resolves({
        currentLoad: { currentLoad: 5 },
        cpuTemperature: { main: -1 }, // unavailable (e.g. VM/WSL)
        mem: { total: 2 * 1024 * 1024 * 1024, available: 1 * 1024 * 1024 * 1024 },
        fsSize: [{ mount: '/boot', size: 1e9, used: 1e8 }], // no '/'
        time: { uptime: 100 }
      })
      aboutPage.getLiveStats(function (stats, err) {
        try {
          assert.equal(err, null)
          assert.equal(stats.cpuTempC, null)
          assert.equal(stats.diskUsedGB, 0)
          assert.equal(stats.diskTotalGB, 0)
          done()
        } catch (e) { done(e) }
      })
    })

    it('returns an error when sampling fails', function (done) {
      sinon.stub(si, 'get').rejects(new Error('si fail'))
      const logSpy = sinon.spy(console, 'log')
      aboutPage.getLiveStats(function (stats, err) {
        try {
          assert.equal(stats, null)
          assert.ok(err)
          assert.ok(logSpy.calledWithMatch('Error getting live stats:'))
          done()
        } catch (e) { done(e) }
      })
    })
  })

  describe('#getSoftwareInfo() production', function () {
    it('should read the package version from dpkg', function (done) {
      // outside development the version comes from the installed package
      const fake = new FakeBin()
      fake.install('dpkg', 'echo "ii  rpanion-server  1.2.3  arm64  companion computer web ui"')
      fake.activate()
      process.env.NODE_ENV = 'production'

      aboutPage.getSoftwareInfo(function (OSV, NodeV, RpanionV, hostname, err) {
        process.env.NODE_ENV = 'development'
        try {
          assert.equal(RpanionV, '1.2.3')
          assert.equal(err, null)
          done()
        } catch (e) {
          done(e)
        } finally {
          fake.cleanup()
        }
      })
    })

    it('should survive a dpkg query failure', function (done) {
      // a failing awk makes the whole pipeline fail, execSync throws
      const fake = new FakeBin()
      fake.install('awk', 'exit 1')
      fake.activate()
      const logSpy = sinon.spy(console, 'log')
      process.env.NODE_ENV = 'production'

      aboutPage.getSoftwareInfo(function (OSV, NodeV, RpanionV, hostname, err) {
        process.env.NODE_ENV = 'development'
        try {
          assert.equal(err, null)
          assert.ok(logSpy.calledWithMatch('Error getting rpanion-server version:'))
          done()
        } catch (e) {
          done(e)
        } finally {
          fake.cleanup()
        }
      })
    })
  })

  describe('#shutdownCC()', function () {
    it('should run shutdown via sudo and log a failure', function (done) {
      this.timeout(5000)
      const fake = new FakeBin()
      fake.install('sudo', 'if [ "$FAKE_SCENARIO" = "fail" ]; then exit 1; fi\necho down')
      fake.activate()
      const logSpy = sinon.spy(console, 'log')

      delete process.env.FAKE_SCENARIO
      aboutPage.shutdownCC() // success path
      process.env.FAKE_SCENARIO = 'fail'
      aboutPage.shutdownCC() // error path

      const deadline = Date.now() + 3000
      const check = () => {
        const sawError = logSpy.getCalls().some((c) => c.args[0] instanceof Error)
        if (fake.calls('sudo').length === 2 && sawError) {
          fake.cleanup()
          return done()
        }
        if (Date.now() > deadline) {
          fake.cleanup()
          return done(new Error('shutdown calls not observed'))
        }
        setTimeout(check, 25)
      }
      check()
    })
  })

  describe('#getsystemctllog()', function () {
    it('should fetch the log and redact bearer tokens', function (done) {
      const fake = new FakeBin()
      fake.install('journalctl', 'case "$FAKE_SCENARIO" in\n' +
        'fail) exit 1;;\n' +
        'warn) echo "a warning" >&2;;\n' +
        '*) printf "log line Bearer abc.DEF-123\\nanother line\\n";;\n' +
        'esac')
      fake.activate()

      aboutPage.getsystemctllog(function (log) {
        try {
          assert.ok(log.includes('Bearer <token>'))
          assert.ok(!log.includes('abc.DEF-123'))
          assert.ok(log.includes('another line'))
        } catch (e) {
          fake.cleanup()
          return done(e)
        }

        // exec failure: the error string is returned
        process.env.FAKE_SCENARIO = 'fail'
        aboutPage.getsystemctllog(function (log2) {
          try {
            assert.ok(log2.includes('Command failed'))
          } catch (e) {
            fake.cleanup()
            return done(e)
          }

          // stderr output (exit 0): the stderr text is returned
          process.env.FAKE_SCENARIO = 'warn'
          aboutPage.getsystemctllog(function (log3) {
            try {
              assert.ok(log3.includes('a warning'))
              done()
            } catch (e) {
              done(e)
            } finally {
              fake.cleanup()
            }
          })
        })
      })
    })
  })
})
