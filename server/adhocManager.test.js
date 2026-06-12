const assert = require('assert')
const sinon = require('sinon')
const settings = require('settings-store')
const { FakeBin } = require('../test/fakeBin')
const AdhocManager = require('./adhocManager')

describe('Adhoc Manager Functions', function () {
  // nmcli/iwlist/iwconfig/ip/route/sleep are all faked; FAKE_SCENARIO picks
  // the adapter state. grep/awk in the gateway pipeline stay real.
  let fake

  before(function () {
    fake = new FakeBin()
    fake.install('nmcli', 'if [ "$1" = "-t" ]; then\n' +
      '  case "$FAKE_SCENARIO" in\n' +
      '  nm-err|refresh-err) echo "nmcli boom" >&2; exit 1 ;;\n' +
      '  nm-nodev) printf "eth0:ethernet:connected\\nwlan1:wifi:unavailable\\n" ;;\n' +
      '  *) printf "eth0:ethernet:connected\\nwlan0:wifi:connected\\n" ;;\n' +
      '  esac\n' +
      'fi\n' +
      'if [ "$1" = "dev" ] && [ "$2" = "set" ] && [ "$FAKE_SCENARIO" = "set-fail" ]; then echo "set boom" >&2; exit 1; fi\n' +
      'exit 0')
    fake.install('iwlist', 'case "$2" in\n' +
      'channel)\n' +
      '  echo "wlan0     32 channels in total; available frequencies :"\n' +
      '  echo "          Channel 01 : 2.412 GHz"\n' +
      '  echo "          Channel 02 : 2.417 GHz"\n' +
      '  echo "          Channel 36 : 5.18 GHz"\n' +
      '  echo "          Current Frequency:2.412 GHz (Channel 1)"\n' +
      '  ;;\n' +
      'key)\n' +
      '  echo "wlan0     2 key sizes : 40, 104bits"\n' +
      '  echo "4 keys available :"\n' +
      '  if [ "$FAKE_SCENARIO" = "adhoc-wep" ]; then echo "[1]: 4865-6C6C-6F"; else echo "[1]: off"; fi\n' +
      '  ;;\n' +
      'esac')
    fake.install('iwconfig', 'if [ -z "$2" ]; then\n' +
      '  case "$FAKE_SCENARIO" in\n' +
      '  adhoc-active|adhoc-wep)\n' +
      '    echo "wlan0     IEEE 802.11  ESSID:\\"dronenet\\""\n' +
      '    echo "          Mode:Ad-Hoc  Frequency:2.412 Cell: 02:11:22:33:44:55"\n' +
      '    ;;\n' +
      '  adhoc-5g)\n' +
      '    echo "wlan0     IEEE 802.11  ESSID:\\"dronenet\\""\n' +
      '    echo "          Mode:Ad-Hoc  Frequency:5.18 Cell: 02:11:22:33:44:55"\n' +
      '    ;;\n' +
      '  *)\n' +
      '    echo "wlan0     IEEE 802.11  ESSID:off/any"\n' +
      '    echo "          Mode:Managed  Access Point: Not-Associated"\n' +
      '    ;;\n' +
      '  esac\n' +
      'fi')
    fake.install('ip', 'if [ "$1" = "link" ] && [ "$FAKE_SCENARIO" = "link-fail" ]; then echo "link boom" >&2; exit 1; fi\n' +
      'case "$1" in\n' +
      '-4) printf \'[{"ifname":"eth0","addr_info":[{"local":"10.0.0.1"}]},{"ifname":"wlan0","addr_info":[{"local":"192.168.1.10"}]}]\\n\' ;;\n' +
      'route) printf "default via 192.168.1.1 dev wlan0\\n10.0.0.0/8 dev eth0\\n" ;;\n' +
      'esac')
    fake.install('route', '')
    fake.install('sleep', '')
    fake.activate()
  })

  after(function () {
    fake.cleanup()
  })

  afterEach(function () {
    sinon.restore()
    delete process.env.FAKE_SCENARIO
    settings.clear()
  })

  describe('#getAdapters()', function () {
    it('should list a managed wifi adapter with its channels', function (done) {
      settings.clear()
      const adhoc = new AdhocManager(settings)
      adhoc.getAdapters((err, netDeviceList, netDeviceSelected, curSettings) => {
        assert.equal(err, null)
        // eth0 is filtered out, wlan0 keeps its 2.4GHz channels only
        assert.equal(netDeviceList.length, 1)
        assert.equal(netDeviceList[0].value, 'wlan0')
        assert.deepEqual(netDeviceList[0].channels.map((c) => c.value), [1, 2])
        assert.equal(netDeviceSelected.value, 'wlan0')
        assert.equal(curSettings.isActive, false)
        done()
      })
    })

    it('should report no adapters when wifi is unavailable', function (done) {
      process.env.FAKE_SCENARIO = 'nm-nodev'
      const adhoc = new AdhocManager(settings)
      adhoc.getAdapters((err, netDeviceList, netDeviceSelected, curSettings) => {
        assert.equal(err, null)
        assert.equal(netDeviceList.length, 0)
        assert.equal(netDeviceSelected, null)
        assert.equal(curSettings.isActive, false)
        done()
      })
    })

    it('should pass through an nmcli failure', function (done) {
      process.env.FAKE_SCENARIO = 'nm-err'
      const adhoc = new AdhocManager(settings)
      adhoc.getAdapters((err) => {
        assert.ok(err.includes('nmcli boom'))
        done()
      })
    })

    it('should read back an active open adhoc adapter', function (done) {
      process.env.FAKE_SCENARIO = 'adhoc-active'
      const adhoc = new AdhocManager(settings)
      adhoc.getAdapters((err, netDeviceList, netDeviceSelected, curSettings) => {
        assert.equal(err, null)
        assert.equal(curSettings.isActive, true)
        assert.equal(curSettings.ssid, 'dronenet')
        assert.equal(curSettings.band, 'bg')
        assert.equal(curSettings.channel, 1)
        assert.equal(curSettings.ipaddress, '192.168.1.10')
        assert.equal(curSettings.wpaType, 'none')
        assert.equal(curSettings.password, '')
        assert.ok(curSettings.gateway.includes('192.168.1.1'))
        done()
      })
    })

    it('should decode a WEP key on an active adhoc adapter', function (done) {
      process.env.FAKE_SCENARIO = 'adhoc-wep'
      const adhoc = new AdhocManager(settings)
      adhoc.getAdapters((err, netDeviceList, netDeviceSelected, curSettings) => {
        assert.equal(err, null)
        assert.equal(curSettings.wpaType, 'wep')
        assert.equal(curSettings.password, 'Hello')
        done()
      })
    })

    it('should fail on a 5GHz adhoc frequency', function (done) {
      // 5GHz channels are filtered from the channel list, so the lookup
      // throws; the error lands in the callback (which then fires a second
      // time from the tail of getAdapters - ignore that one)
      process.env.FAKE_SCENARIO = 'adhoc-5g'
      const adhoc = new AdhocManager(settings)
      let finished = false
      adhoc.getAdapters((err) => {
        if (finished) {
          return
        }
        finished = true
        assert.ok(err instanceof TypeError)
        done()
      })
    })
  })

  describe('#setAdapter()', function () {
    it('should activate an adhoc network with key and gateway', function (done) {
      settings.clear()
      const adhoc = new AdhocManager(settings)
      adhoc.setAdapter(true, 'wlan0', {
        ipaddress: '192.168.1.10', wpaType: 'wep', password: 'Hello', ssid: 'dronenet', band: 'bg', channel: 1, gateway: '192.168.1.1'
      }, (err, netStatusList) => {
        assert.equal(err, null)
        assert.equal(netStatusList.length, 1)
        assert.equal(settings.value('adhoc.device', null), 'wlan0')
        done()
      })
    })

    it('should activate an open adhoc network without a gateway', function (done) {
      settings.clear()
      const adhoc = new AdhocManager(settings)
      adhoc.setAdapter(true, 'wlan0', {
        ipaddress: '192.168.1.10', wpaType: 'none', password: '', ssid: 'dronenet', band: 'bg', channel: 1, gateway: ''
      }, (err) => {
        assert.equal(err, null)
        done()
      })
    })

    it('should pass through an activation failure', function (done) {
      process.env.FAKE_SCENARIO = 'set-fail'
      const adhoc = new AdhocManager(settings)
      adhoc.setAdapter(true, 'wlan0', {
        ipaddress: '192.168.1.10', wpaType: 'none', password: '', ssid: 'dronenet', band: 'bg', channel: 1, gateway: ''
      }, (err) => {
        assert.ok(err.includes('set boom'))
        done()
      })
    })

    it('should reset the adapter when the refresh after activation fails', function (done) {
      // activation chain succeeds, but the nmcli device list then errors
      process.env.FAKE_SCENARIO = 'refresh-err'
      const adhoc = new AdhocManager(settings)
      adhoc.setAdapter(true, 'wlan0', {
        ipaddress: '192.168.1.10', wpaType: 'none', password: '', ssid: 'dronenet', band: 'bg', channel: 1, gateway: ''
      }, (err) => {
        assert.ok(err.includes('nmcli boom'))
        done()
      })
    })

    it('should deactivate an adhoc network', function (done) {
      settings.clear()
      const adhoc = new AdhocManager(settings)
      adhoc.setAdapter(false, 'wlan0', { }, (err) => {
        assert.equal(err, null)
        assert.equal(settings.value('adhoc.device', 'unset'), null)
        done()
      })
    })

    it('should pass through a deactivation failure', function (done) {
      process.env.FAKE_SCENARIO = 'link-fail'
      const adhoc = new AdhocManager(settings)
      adhoc.setAdapter(false, 'wlan0', { }, (err) => {
        assert.ok(err.includes('link boom'))
        done()
      })
    })

    it('should pass through a failed refresh after deactivation', function (done) {
      process.env.FAKE_SCENARIO = 'refresh-err'
      const adhoc = new AdhocManager(settings)
      adhoc.setAdapter(false, 'wlan0', { }, (err) => {
        assert.ok(err.includes('nmcli boom'))
        done()
      })
    })
  })

  describe('#constructor()', function () {
    it('should re-activate a saved adhoc device on startup', function (done) {
      this.timeout(5000)
      settings.clear()
      settings.setValue('adhoc.device', 'wlan0')
      settings.setValue('adhoc.devicesettings', {
        ipaddress: '192.168.1.10', wpaType: 'none', password: '', ssid: 'dronenet', band: 'bg', channel: 1, gateway: ''
      })
      const logSpy = sinon.spy(console, 'log')
      const adhoc = new AdhocManager(settings)
      assert.notEqual(adhoc, null)

      const deadline = Date.now() + 3000
      const check = () => {
        if (logSpy.getCalls().some((c) => String(c.args[0]).includes('Adhoc Init wlan0'))) {
          return done()
        }
        if (Date.now() > deadline) {
          return done(new Error('adhoc init was not logged'))
        }
        setTimeout(check, 25)
      }
      check()
    })

    it('should log a failed re-activation on startup', function (done) {
      this.timeout(5000)
      settings.clear()
      settings.setValue('adhoc.device', 'wlan0')
      settings.setValue('adhoc.devicesettings', {
        ipaddress: '192.168.1.10', wpaType: 'none', password: '', ssid: 'dronenet', band: 'bg', channel: 1, gateway: ''
      })
      process.env.FAKE_SCENARIO = 'set-fail'
      const logSpy = sinon.spy(console, 'log')
      const adhoc = new AdhocManager(settings)
      assert.notEqual(adhoc, null)

      const deadline = Date.now() + 3000
      const check = () => {
        if (logSpy.getCalls().some((c) => String(c.args[0]).includes('Error in adhoc init'))) {
          return done()
        }
        if (Date.now() > deadline) {
          return done(new Error('adhoc init failure was not logged'))
        }
        setTimeout(check, 25)
      }
      check()
    })
  })
})
