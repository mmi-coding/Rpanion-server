const assert = require('assert');
const sinon = require('sinon');
const { describe, it, before, after, beforeEach, afterEach } = require('mocha');
const { FakeBin } = require('../test/fakeBin');
const serialDetection = require('./serialDetection.js');
const PPPConnection = require('./pppConnection');

// Fake serial device used across all tests
const FAKE_DEVICE = { value: 'usb-FTDI_FT232-if00', label: 'FTDI (usb-FTDI)', path: '/dev/ttyUSB0' };
const FAKE_DEVICES = [FAKE_DEVICE];

// Helper: poll until condition is true (max timeout ms)
function waitFor (fn, timeout) {
  const ms = timeout || 3000;
  return new Promise(function (resolve, reject) {
    const start = Date.now();
    const poll = function () {
      if (fn()) return resolve();
      if (Date.now() - start > ms) return reject(new Error('waitFor timed out'));
      setTimeout(poll, 10);
    };
    poll();
  });
}

describe('PPPConnection', function () {
  let fake;

  // ── Suite-level FakeBin — installed once, active for all tests ──────────────
  before(function () {
    fake = new FakeBin();

    // Standard sudo fake: dispatches on $1 and $FAKE_SCENARIO
    fake.install('sudo', [
      'case "$FAKE_SCENARIO" in',
      '  pkill-err) case "$1" in pkill) echo "pkill error" >&2; exit 1 ;; esac ;;',
      'esac',
      'case "$1" in',
      '  -v) exit 0 ;;',
      '  pppd)',
      '    case "$FAKE_SCENARIO" in',
      '      bad-baud)',
      '        echo "speed 12500000 not supported"',
      '        sleep 30 & wait $!',
      '        exit 0 ;;',
      '      pppd-exit-signal) exit 5 ;;',
      '      pppd-exit-code2) exit 2 ;;',
      '      pppd-normal-exit) exit 0 ;;',
      '      pppd-crash) exit 99 ;;',
      '      pppd-stderr)',
      '        echo "pppd stderr line" >&2',
      '        sleep 30 & wait $!',
      '        exit 0 ;;',
      '      *)',
      '        echo "PPP started on stdout"',
      '        sleep 30 & wait $!',
      '        exit 0 ;;',
      '    esac ;;',
      '  pkill) exit 0 ;;',
      '  *) exit 0 ;;',
      'esac',
    ].join('\n'));

    // ifconfig fake: returns RX/TX lines matching getPPPDataRate regex
    fake.install('ifconfig', [
      'case "$FAKE_SCENARIO" in',
      '  ifconfig-empty) exit 0 ;;',
      '  ifconfig-malformed) echo "GARBAGE OUTPUT NO MATCH" ;;',
      '  ifconfig-bytes1)',
      '    echo "  RX packets 100  bytes 10000 (10.0 KB)"',
      '    echo "  TX packets 50  bytes 5000 (5.0 KB)" ;;',
      '  ifconfig-bytes2)',
      '    echo "  RX packets 200  bytes 20000 (20.0 KB)"',
      '    echo "  TX packets 100  bytes 10000 (10.0 KB)" ;;',
      '  ifconfig-throw) echo "no such device" >&2; exit 1 ;;',
      '  *)',
      '    echo "  RX packets 0  bytes 0 (0.0 B)"',
      '    echo "  TX packets 0  bytes 0 (0.0 B)" ;;',
      'esac',
    ].join('\n'));

    fake.activate();
  });

  after(function () {
    fake.cleanup();
  });

  // ── Per-test stubs and settings mock ────────────────────────────────────────

  let mockSettings;
  let detectStub;

  beforeEach(function () {
    mockSettings = {
      value: sinon.stub(),
      setValue: sinon.stub(),
    };
    mockSettings.value.withArgs('ppp.enabled', false).returns(false);
    mockSettings.value.withArgs('ppp.uart', null).returns(FAKE_DEVICE.value);
    mockSettings.value.withArgs('ppp.baud', sinon.match.any).returns(921600);
    mockSettings.value.withArgs('ppp.localIP', '192.168.144.14').returns('192.168.144.14');
    mockSettings.value.withArgs('ppp.remoteIP', '192.168.144.15').returns('192.168.144.15');

    // Stub detectSerialDevices so no real hardware scan happens
    detectStub = sinon.stub(serialDetection, 'detectSerialDevices').resolves(FAKE_DEVICES);
    // Stub getSerialPathFromValue to use our fake device list
    sinon.stub(serialDetection, 'getSerialPathFromValue').callsFake(function (value, devices) {
      const list = (devices && devices.length > 0) ? devices : FAKE_DEVICES;
      const d = list.find(function (x) { return x.value === value; });
      return d ? d.path : null;
    });
  });

  afterEach(function () {
    sinon.restore();
    delete process.env.FAKE_SCENARIO;
    process.env.NODE_ENV = 'development';
    fake.reset();
  });

  // ── constructor ─────────────────────────────────────────────────────────────

  describe('constructor', function () {
    it('initializes with default values when ppp.enabled=false', function () {
      const ppp = new PPPConnection(mockSettings);
      assert.strictEqual(ppp.isConnected, false);
      assert.strictEqual(ppp.device, FAKE_DEVICE.value);
      assert.strictEqual(ppp.baudRate, 921600);
      assert.strictEqual(ppp.localIP, '192.168.144.14');
      assert.strictEqual(ppp.remoteIP, '192.168.144.15');
      assert.strictEqual(ppp.pppProcess, null);
      assert.strictEqual(ppp.isQuitting, false);
      assert.strictEqual(ppp.isManualStop, false);
      assert.strictEqual(ppp.badbaudRate, false);
    });

    // When ppp.enabled=true, the constructor calls getDevices then startPPP.
    // startPPP sees isConnected=true and returns "already connected" error.
    // The error handler resets isConnected=false and schedules a 1s retry.
    // On retry, startPPP succeeds and spawns pppd.
    it('auto-starts PPP when ppp.enabled=true — retries past "already connected"', function (done) {
      this.timeout(6000);
      mockSettings.value.withArgs('ppp.enabled', false).returns(true);

      const clock = sinon.useFakeTimers({
        toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
      });

      const ppp = new PPPConnection(mockSettings);

      // getDevices is async — let it settle first, then advance the clock
      setImmediate(function () {
        // After getDevices resolves, startPPP is called with isConnected=true
        // → "already connected" → setTimeout(attemptPPPStart, 1000)
        // Advance clock so the retry fires
        clock.tickAsync(1001).then(function () {
          try {
            // After retry, isConnected should be true (startPPP succeeded)
            // and pppProcess should be set (pppd spawned and blocking)
            assert.strictEqual(ppp.isConnected, true, 'isConnected should be true after retry');
            assert.ok(ppp.pppProcess !== null, 'pppProcess should be set after retry');
            // Clean up the spawned pppd
            ppp.pppProcess.removeAllListeners();
            ppp.pppProcess.kill();
            ppp.pppProcess = null;
            ppp.isConnected = false;
            clock.restore();
            done();
          } catch (e) {
            clock.restore();
            done(e);
          }
        }).catch(function (e) {
          clock.restore();
          done(e);
        });
      });
    });

    it('handles non-"already-connected" error in autostart (device not found)', function (done) {
      this.timeout(3000);
      mockSettings.value.withArgs('ppp.enabled', false).returns(true);
      mockSettings.value.withArgs('ppp.uart', null).returns(null); // null → "Device is required"

      const errSpy = sinon.spy(console, 'error');
      const ppp = new PPPConnection(mockSettings);

      // Wait for the error path to run (isConnected=false after error)
      waitFor(function () { return errSpy.called; })
        .then(function () {
          assert.strictEqual(ppp.isConnected, false);
          done();
        })
        .catch(done);
    });
  });

  // ── setSettings ─────────────────────────────────────────────────────────────

  describe('setSettings', function () {
    it('persists all fields to settings store', function () {
      const ppp = new PPPConnection(mockSettings);
      ppp.device = '/dev/ttyS1';
      ppp.baudRate = 115200;
      ppp.localIP = '10.0.0.1';
      ppp.remoteIP = '10.0.0.2';
      ppp.isConnected = true;
      ppp.setSettings();
      assert.ok(mockSettings.setValue.calledWith('ppp.uart', '/dev/ttyS1'));
      assert.ok(mockSettings.setValue.calledWith('ppp.baud', 115200));
      assert.ok(mockSettings.setValue.calledWith('ppp.localIP', '10.0.0.1'));
      assert.ok(mockSettings.setValue.calledWith('ppp.remoteIP', '10.0.0.2'));
      assert.ok(mockSettings.setValue.calledWith('ppp.enabled', true));
    });
  });

  // ── quitting ────────────────────────────────────────────────────────────────

  describe('quitting', function () {
    // quitting() shells out via execSync; spawning the fake sudo can exceed
    // mocha's 2s default when the box is under load (flaked ~1 in 3 runs)
    this.timeout(10000);

    it('sets isQuitting=true and is a no-op when pppProcess is null', function () {
      const ppp = new PPPConnection(mockSettings);
      ppp.pppProcess = null;
      ppp.quitting();
      assert.strictEqual(ppp.isQuitting, true);
      assert.strictEqual(ppp.pppProcess, null);
    });

    it('kills a live pppProcess and runs pkill via execSync', function () {
      const ppp = new PPPConnection(mockSettings);
      const killSpy = sinon.spy();
      const removeListenersSpy = sinon.spy();
      ppp.pppProcess = {
        kill: killSpy,
        pid: 12345,
        removeAllListeners: removeListenersSpy,
      };
      fake.reset(); // clear previous sudo call log
      ppp.quitting();
      assert.strictEqual(ppp.isQuitting, true);
      assert.ok(removeListenersSpy.calledOnce, 'removeAllListeners should be called');
      assert.ok(killSpy.calledOnce, 'kill should be called');
      assert.strictEqual(ppp.pppProcess, null);
      const sudoCalls = fake.calls('sudo');
      assert.ok(sudoCalls.some(function (c) { return c.includes('pkill'); }),
        'sudo pkill should have been invoked via execSync');
    });

    it('catches error thrown by pkill execSync', function () {
      process.env.FAKE_SCENARIO = 'pkill-err';
      const ppp = new PPPConnection(mockSettings);
      const errSpy = sinon.spy(console, 'error');
      ppp.pppProcess = {
        kill: function () {},
        pid: 999,
        removeAllListeners: function () {},
      };
      assert.doesNotThrow(function () { ppp.quitting(); });
      assert.strictEqual(ppp.pppProcess, null);
    });
  });

  // ── getDevices ──────────────────────────────────────────────────────────────

  describe('getDevices', function () {
    it('returns serial devices via callback on success', function (done) {
      const ppp = new PPPConnection(mockSettings);
      ppp.getDevices(function (err, devices) {
        try {
          assert.strictEqual(err, null);
          assert.deepStrictEqual(devices, FAKE_DEVICES);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    it('calls back with error when detectSerialDevices rejects', function (done) {
      const boom = new Error('serial scan failed');
      detectStub.rejects(boom);
      const ppp = new PPPConnection(mockSettings);
      ppp.getDevices(function (err, devices) {
        try {
          assert.ok(err instanceof Error);
          assert.deepStrictEqual(devices, []);
          done();
        } catch (e) {
          done(e);
        }
      });
    });
  });

  // ── startPPP ────────────────────────────────────────────────────────────────

  describe('startPPP', function () {
    it('returns error when PPP is already connected', function (done) {
      const ppp = new PPPConnection(mockSettings);
      ppp.isConnected = true;
      ppp.startPPP(FAKE_DEVICE.value, 921600, '192.168.1.1', '192.168.1.2', function (err, result) {
        try {
          assert.ok(err instanceof Error);
          assert.match(err.message, /already connected/);
          assert.ok(result.baudRates);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    it('returns error when device is not provided (null)', function (done) {
      const ppp = new PPPConnection(mockSettings);
      ppp.startPPP(null, 921600, '192.168.1.1', '192.168.1.2', function (err) {
        try {
          assert.ok(err instanceof Error);
          assert.match(err.message, /Device is required/);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    it('returns error when pppProcess is still running', function (done) {
      const ppp = new PPPConnection(mockSettings);
      ppp.pppProcess = { pid: 5555, kill: function () {}, removeAllListeners: function () {} };
      ppp.startPPP(FAKE_DEVICE.value, 921600, '192.168.1.1', '192.168.1.2', function (err) {
        try {
          assert.ok(err instanceof Error);
          assert.match(err.message, /PPP still running/);
          ppp.pppProcess = null;
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    it('returns error when device is not in serialDevices list (Invalid device)', function (done) {
      const ppp = new PPPConnection(mockSettings);
      // Override stub to return null for this device
      serialDetection.getSerialPathFromValue.restore();
      sinon.stub(serialDetection, 'getSerialPathFromValue').returns(null);
      ppp.serialDevices = FAKE_DEVICES;
      ppp.startPPP('unknown-device', 921600, '192.168.1.1', '192.168.1.2', function (err) {
        try {
          assert.ok(err instanceof Error);
          assert.match(err.message, /Invalid device selected/);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    it('spawns pppd in development mode (executes sudo -v precheck)', function (done) {
      this.timeout(5000);
      process.env.NODE_ENV = 'development';
      const ppp = new PPPConnection(mockSettings);
      ppp.serialDevices = FAKE_DEVICES;

      ppp.startPPP(FAKE_DEVICE.value, 921600, '192.168.1.1', '192.168.1.2', function (err, result) {
        try {
          assert.strictEqual(err, null);
          assert.strictEqual(result.enabled, true);
          assert.ok(ppp.pppProcess !== null);
          assert.strictEqual(ppp.isConnected, true);
          ppp.pppProcess.removeAllListeners();
          ppp.pppProcess.kill();
          ppp.pppProcess = null;
          ppp.isConnected = false;
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    it('spawns pppd in production mode (skips sudo -v)', function (done) {
      this.timeout(5000);
      process.env.NODE_ENV = 'production';
      const ppp = new PPPConnection(mockSettings);
      ppp.serialDevices = FAKE_DEVICES;

      ppp.startPPP(FAKE_DEVICE.value, 921600, '192.168.1.1', '192.168.1.2', function (err, result) {
        try {
          process.env.NODE_ENV = 'development';
          assert.strictEqual(err, null);
          assert.strictEqual(result.enabled, true);
          if (ppp.pppProcess) {
            ppp.pppProcess.removeAllListeners();
            ppp.pppProcess.kill();
            ppp.pppProcess = null;
          }
          ppp.isConnected = false;
          done();
        } catch (e) {
          process.env.NODE_ENV = 'development';
          done(e);
        }
      });
    });

    it('stdout handler kills process and sets badbaudRate on "speed not supported"', function (done) {
      this.timeout(5000);
      process.env.FAKE_SCENARIO = 'bad-baud';
      const ppp = new PPPConnection(mockSettings);
      ppp.serialDevices = FAKE_DEVICES;

      ppp.startPPP(FAKE_DEVICE.value, 12500000, '192.168.1.1', '192.168.1.2', function (err) {
        try {
          assert.strictEqual(err, null);
          waitFor(function () { return ppp.badbaudRate === true; })
            .then(function () {
              assert.strictEqual(ppp.badbaudRate, true);
              assert.strictEqual(ppp.isConnected, false);
              assert.strictEqual(ppp.pppProcess, null);
              done();
            })
            .catch(done);
        } catch (e) {
          done(e);
        }
      });
    });

    it('stderr handler fires on pppd stderr output', function (done) {
      this.timeout(5000);
      process.env.FAKE_SCENARIO = 'pppd-stderr';
      const logSpy = sinon.spy(console, 'log');
      const ppp = new PPPConnection(mockSettings);
      ppp.serialDevices = FAKE_DEVICES;

      ppp.startPPP(FAKE_DEVICE.value, 921600, '192.168.1.1', '192.168.1.2', function (err) {
        try {
          assert.strictEqual(err, null);
          waitFor(function () {
            return logSpy.args.some(function (a) { return String(a).includes('PPP Error'); });
          }, 3000)
            .then(function () {
              if (ppp.pppProcess) {
                ppp.pppProcess.removeAllListeners();
                ppp.pppProcess.kill();
                ppp.pppProcess = null;
              }
              ppp.isConnected = false;
              done();
            })
            .catch(function (e) {
              if (ppp.pppProcess) {
                ppp.pppProcess.removeAllListeners();
                ppp.pppProcess.kill();
                ppp.pppProcess = null;
              }
              ppp.isConnected = false;
              done(e);
            });
        } catch (e) {
          done(e);
        }
      });
    });

    it('close handler: isQuitting=true — preserves isConnected, resets pppProcess', function (done) {
      this.timeout(5000);
      process.env.FAKE_SCENARIO = 'pppd-normal-exit';
      const ppp = new PPPConnection(mockSettings);
      ppp.serialDevices = FAKE_DEVICES;
      ppp.isQuitting = true;

      ppp.startPPP(FAKE_DEVICE.value, 921600, '192.168.1.1', '192.168.1.2', function (err) {
        try {
          assert.strictEqual(err, null);
          waitFor(function () { return ppp.pppProcess === null; })
            .then(function () {
              // isQuitting=true → skip isConnected update → stays true
              assert.strictEqual(ppp.isConnected, true);
              ppp.isConnected = false;
              done();
            })
            .catch(done);
        } catch (e) {
          done(e);
        }
      });
    });

    it('close handler: isManualStop=true — preserves isConnected, resets isManualStop', function (done) {
      this.timeout(5000);
      process.env.FAKE_SCENARIO = 'pppd-normal-exit';
      const ppp = new PPPConnection(mockSettings);
      ppp.serialDevices = FAKE_DEVICES;
      ppp.isManualStop = true;

      ppp.startPPP(FAKE_DEVICE.value, 921600, '192.168.1.1', '192.168.1.2', function (err) {
        try {
          assert.strictEqual(err, null);
          waitFor(function () { return ppp.pppProcess === null; })
            .then(function () {
              assert.strictEqual(ppp.isConnected, true);
              assert.strictEqual(ppp.isManualStop, false);
              ppp.isConnected = false;
              done();
            })
            .catch(done);
        } catch (e) {
          done(e);
        }
      });
    });

    it('close handler: exit code 5 (isSignalTermination) — preserves isConnected', function (done) {
      this.timeout(5000);
      process.env.FAKE_SCENARIO = 'pppd-exit-signal';
      const ppp = new PPPConnection(mockSettings);
      ppp.serialDevices = FAKE_DEVICES;

      ppp.startPPP(FAKE_DEVICE.value, 921600, '192.168.1.1', '192.168.1.2', function (err) {
        try {
          assert.strictEqual(err, null);
          waitFor(function () { return ppp.pppProcess === null; })
            .then(function () {
              // code=5 → isSignalTermination=true → preserves isConnected=true
              assert.strictEqual(ppp.isConnected, true);
              ppp.isConnected = false;
              done();
            })
            .catch(done);
        } catch (e) {
          done(e);
        }
      });
    });

    it('close handler: exit code 2 (isSignalTermination) — preserves isConnected', function (done) {
      this.timeout(5000);
      process.env.FAKE_SCENARIO = 'pppd-exit-code2';
      const ppp = new PPPConnection(mockSettings);
      ppp.serialDevices = FAKE_DEVICES;

      ppp.startPPP(FAKE_DEVICE.value, 921600, '192.168.1.1', '192.168.1.2', function (err) {
        try {
          assert.strictEqual(err, null);
          waitFor(function () { return ppp.pppProcess === null; })
            .then(function () {
              assert.strictEqual(ppp.isConnected, true);
              ppp.isConnected = false;
              done();
            })
            .catch(done);
        } catch (e) {
          done(e);
        }
      });
    });

    it('close handler: crash (code 99, no signal, not quitting) — sets isConnected=false', function (done) {
      this.timeout(5000);
      process.env.FAKE_SCENARIO = 'pppd-crash';
      const ppp = new PPPConnection(mockSettings);
      ppp.serialDevices = FAKE_DEVICES;
      ppp.isQuitting = false;
      ppp.isManualStop = false;

      ppp.startPPP(FAKE_DEVICE.value, 921600, '192.168.1.1', '192.168.1.2', function (err) {
        try {
          assert.strictEqual(err, null);
          assert.strictEqual(ppp.isConnected, true);
          waitFor(function () { return ppp.pppProcess === null; })
            .then(function () {
              // code=99, signal=null → not signal termination → isConnected set false
              assert.strictEqual(ppp.isConnected, false);
              done();
            })
            .catch(done);
        } catch (e) {
          done(e);
        }
      });
    });
  });

  // ── stopPPP ─────────────────────────────────────────────────────────────────

  describe('stopPPP', function () {
    it('returns error when PPP is not connected', function (done) {
      const ppp = new PPPConnection(mockSettings);
      ppp.isConnected = false;
      ppp.stopPPP(function (err) {
        try {
          assert.ok(err instanceof Error);
          assert.match(err.message, /PPP is not connected/);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    it('succeeds when connected but pppProcess is null (returns current state)', function (done) {
      const ppp = new PPPConnection(mockSettings);
      ppp.isConnected = true;
      ppp.pppProcess = null;

      ppp.stopPPP(function (err, result) {
        try {
          // pppProcess was null so the kill block is skipped;
          // isConnected was NOT set to false (it's inside the if block)
          assert.strictEqual(err, null);
          // result.enabled reflects isConnected at callback time — still true
          assert.strictEqual(result.enabled, true);
          ppp.isConnected = false;
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    it('kills pppProcess and calls pkill when connected with live process', function (done) {
      this.timeout(3000);
      const killSpy = sinon.spy();
      const ppp = new PPPConnection(mockSettings);
      ppp.isConnected = true;
      ppp.pppProcess = {
        kill: killSpy,
        pid: 7777,
        removeAllListeners: function () {},
      };

      fake.reset();
      ppp.stopPPP(function (err, result) {
        try {
          assert.strictEqual(err, null);
          assert.strictEqual(result.enabled, false);
          assert.ok(killSpy.calledOnce, 'kill should be called');
          assert.strictEqual(ppp.isManualStop, true);
          assert.strictEqual(ppp.isConnected, false);
          const sudoCalls = fake.calls('sudo');
          assert.ok(sudoCalls.some(function (c) { return c.includes('pkill'); }),
            'sudo pkill should be called');
          ppp.pppProcess = null;
          done();
        } catch (e) {
          done(e);
        }
      });
    });
  });

  // ── getPPPSettings ──────────────────────────────────────────────────────────

  describe('getPPPSettings', function () {
    it('auto-assigns device from first in list when device is null', function (done) {
      const ppp = new PPPConnection(mockSettings);
      ppp.device = null;

      ppp.getPPPSettings(function (err, result) {
        try {
          assert.strictEqual(err, null);
          // device auto-assigned to first device in list
          assert.strictEqual(result.selDevice, FAKE_DEVICE.value);
          assert.deepStrictEqual(result.serialDevices, FAKE_DEVICES);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    it('reassigns device to first in list when current device is not in list', function (done) {
      const ppp = new PPPConnection(mockSettings);
      ppp.device = 'nonexistent-device-value';

      ppp.getPPPSettings(function (err, result) {
        try {
          assert.strictEqual(err, null);
          assert.strictEqual(result.selDevice, FAKE_DEVICE.value);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    it('keeps existing device when it is in the list', function (done) {
      const ppp = new PPPConnection(mockSettings);
      ppp.device = FAKE_DEVICE.value;

      ppp.getPPPSettings(function (err, result) {
        try {
          assert.strictEqual(err, null);
          assert.strictEqual(result.selDevice, FAKE_DEVICE.value);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    it('does not throw when a stale device is set but no ports are detected', function (done) {
      detectStub.resolves([]);
      const ppp = new PPPConnection(mockSettings);
      ppp.device = 'stale-device-value';

      ppp.getPPPSettings(function (err, result) {
        try {
          assert.strictEqual(err, null);
          // stale device is kept (cannot index into an empty list)
          assert.strictEqual(result.selDevice, 'stale-device-value');
          assert.deepStrictEqual(result.serialDevices, []);
          done();
        } catch (e) {
          done(e);
        }
      });
    });

    it('calls back with error when detectSerialDevices rejects', function (done) {
      const boom = new Error('scan bombed');
      detectStub.rejects(boom);
      const ppp = new PPPConnection(mockSettings);

      ppp.getPPPSettings(function (err, result) {
        try {
          assert.ok(err instanceof Error);
          assert.strictEqual(result.selDevice, null);
          assert.deepStrictEqual(result.serialDevices, []);
          done();
        } catch (e) {
          done(e);
        }
      });
    });
  });

  // ── getPPPDataRate ──────────────────────────────────────────────────────────

  describe('getPPPDataRate', function () {
    it('returns {rxRate:0, txRate:0} when not connected (no extra fields)', function () {
      const ppp = new PPPConnection(mockSettings);
      ppp.isConnected = false;
      const r = ppp.getPPPDataRate();
      assert.deepStrictEqual(r, { rxRate: 0, txRate: 0 });
    });

    it('returns zeros with all four fields on first call (sets prevdata)', function () {
      process.env.FAKE_SCENARIO = 'ifconfig-bytes1';
      const ppp = new PPPConnection(mockSettings);
      ppp.isConnected = true;
      ppp.prevdata = null;
      const r = ppp.getPPPDataRate();
      assert.deepStrictEqual(r, { rxRate: 0, txRate: 0, percentusedRx: 0, percentusedTx: 0 });
      assert.ok(ppp.prevdata !== null, 'prevdata should be set after first call');
    });

    it('returns non-zero rate on second call when bytes changed', function () {
      process.env.FAKE_SCENARIO = 'ifconfig-bytes1';
      const ppp = new PPPConnection(mockSettings);
      ppp.isConnected = true;
      ppp.prevdata = null;
      // First call: populate prevdata
      ppp.getPPPDataRate();

      // Simulate time passing + more bytes
      ppp.prevdata.timestamp -= 1000;
      ppp.prevdata.rxBytes -= 5000;
      ppp.prevdata.txBytes -= 2000;

      process.env.FAKE_SCENARIO = 'ifconfig-bytes2';
      const r = ppp.getPPPDataRate();
      assert.ok(typeof r.rxRate === 'number');
      assert.ok(typeof r.txRate === 'number');
      assert.ok(r.rxRate > 0 || r.txRate > 0, 'should have non-zero rate');
    });

    it('returns all-zero object when ifconfig returns empty stdout', function () {
      process.env.FAKE_SCENARIO = 'ifconfig-empty';
      const ppp = new PPPConnection(mockSettings);
      ppp.isConnected = true;
      ppp.prevdata = null;
      const r = ppp.getPPPDataRate();
      assert.deepStrictEqual(r, { rxRate: 0, txRate: 0, percentusedRx: 0, percentusedTx: 0 });
    });

    it('returns all-zero object when ifconfig output does not match regex (malformed)', function () {
      process.env.FAKE_SCENARIO = 'ifconfig-malformed';
      const ppp = new PPPConnection(mockSettings);
      ppp.isConnected = true;
      ppp.prevdata = null;
      const r = ppp.getPPPDataRate();
      assert.deepStrictEqual(r, { rxRate: 0, txRate: 0, percentusedRx: 0, percentusedTx: 0 });
    });

    it('catches execSync error from ifconfig and returns all-zero object', function () {
      process.env.FAKE_SCENARIO = 'ifconfig-throw';
      const ppp = new PPPConnection(mockSettings);
      ppp.isConnected = true;
      ppp.prevdata = null;
      const r = ppp.getPPPDataRate();
      assert.deepStrictEqual(r, { rxRate: 0, txRate: 0, percentusedRx: 0, percentusedTx: 0 });
    });
  });

  // ── conStatusStr ────────────────────────────────────────────────────────────

  describe('conStatusStr', function () {
    it('returns "Disconnected (Baud rate not supported)" when badbaudRate=true', function () {
      const ppp = new PPPConnection(mockSettings);
      ppp.badbaudRate = true;
      assert.strictEqual(ppp.conStatusStr(), 'Disconnected (Baud rate not supported)');
    });

    it('returns "Disconnected" when not connected and badbaudRate=false', function () {
      const ppp = new PPPConnection(mockSettings);
      ppp.isConnected = false;
      ppp.badbaudRate = false;
      assert.strictEqual(ppp.conStatusStr(), 'Disconnected');
    });

    it('returns "Disconnected" when isConnected=true but pppProcess is null', function () {
      const ppp = new PPPConnection(mockSettings);
      ppp.isConnected = true;
      ppp.badbaudRate = false;
      ppp.pppProcess = null;
      assert.strictEqual(ppp.conStatusStr(), 'Disconnected');
    });

    it('returns "Disconnected" when pppProcess has falsy pid', function () {
      const ppp = new PPPConnection(mockSettings);
      ppp.isConnected = true;
      ppp.badbaudRate = false;
      ppp.pppProcess = { pid: 0 };
      assert.strictEqual(ppp.conStatusStr(), 'Disconnected');
    });

    it('returns Connected with PID and "No data transfer" on first call (no prevdata)', function () {
      process.env.FAKE_SCENARIO = 'ifconfig-bytes1';
      const ppp = new PPPConnection(mockSettings);
      ppp.isConnected = true;
      ppp.badbaudRate = false;
      ppp.pppProcess = { pid: 12345 };
      ppp.prevdata = null;
      const status = ppp.conStatusStr();
      assert.ok(status.includes('Connected'), 'should include Connected');
      assert.ok(status.includes('PID: 12345'), 'should include PID');
      assert.ok(status.includes('No data transfer'), 'first call should say No data transfer');
    });

    it('returns Connected with RX/TX rate when data has transferred', function () {
      process.env.FAKE_SCENARIO = 'ifconfig-bytes1';
      const ppp = new PPPConnection(mockSettings);
      ppp.isConnected = true;
      ppp.badbaudRate = false;
      ppp.pppProcess = { pid: 99999 };
      ppp.prevdata = null;

      // First call populates prevdata
      ppp.conStatusStr();
      // Backdate and inflate delta to get non-zero rates
      ppp.prevdata.timestamp -= 1000;
      ppp.prevdata.rxBytes -= 5000;
      ppp.prevdata.txBytes -= 2000;

      process.env.FAKE_SCENARIO = 'ifconfig-bytes2';
      const status = ppp.conStatusStr();
      assert.ok(status.includes('Connected'), 'should include Connected');
      assert.ok(status.includes('RX:'), 'should include RX rate');
      assert.ok(status.includes('TX:'), 'should include TX rate');
    });
  });

  // ── baudRates list ──────────────────────────────────────────────────────────

  describe('baudRates', function () {
    it('contains expected baud rate entries with value and label', function () {
      const ppp = new PPPConnection(mockSettings);
      assert.ok(Array.isArray(ppp.baudRates));
      assert.ok(ppp.baudRates.length > 0);
      const values = ppp.baudRates.map(function (r) { return r.value; });
      assert.ok(values.includes(921600));
      assert.ok(values.includes(12500000));
      assert.ok(ppp.baudRates[0].hasOwnProperty('value'));
      assert.ok(ppp.baudRates[0].hasOwnProperty('label'));
    });
  });
});
