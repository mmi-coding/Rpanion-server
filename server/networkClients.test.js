const assert = require('assert')
const networkClients = require('./networkClients')
const { FakeBin } = require('../test/fakeBin')

describe('Network Client Functions', function () {
  it('#networkclientgetClients()', function (done) {
    // Getting a list of clients
    networkClients.getClients((err) => {
      assert.equal(err, null)
      done()
    })
  })

  describe('AP leases (fake nmcli)', function () {
    // Drives every branch of getClients() with fake nmcli/sudo binaries on
    // PATH (see test/fakeBin.js) - no NetworkManager AP needed, no source
    // seams. The fakes key off FAKE_SCENARIO, inherited from this process.
    let fake

    before(function () {
      fake = new FakeBin()
      fake.install('nmcli', `
case "$*" in
  "-t -f NAME,UUID,TYPE,DEVICE connection show")
    case "$FAKE_SCENARIO" in
      stderr) echo "nmcli not running" >&2 ;;
      noap) printf 'eth:uuid0:802-3-ethernet:eth0\\nwifi:uuid1:802-11-wireless:--\\nwifi2:uuid2:802-11-wireless:\\n' ;;
      *) printf 'wifi:uuid1:802-11-wireless:wlan0\\n' ;;
    esac ;;
  "-s -t -f 802-11-wireless.mode connection show uuid1")
    case "$FAKE_SCENARIO" in
      notap) echo "802-11-wireless.mode:infrastructure" ;;
      modefail) echo "unknown connection" >&2; exit 10 ;;
      *) echo "802-11-wireless.mode:ap" ;;
    esac ;;
  "-s -t -f 802-11-wireless.ssid connection show uuid1")
    echo "802-11-wireless.ssid:TestNet" ;;
esac`)
      fake.install('sudo', `
case "$*" in
  "cat /var/lib/NetworkManager/dnsmasq-wlan0.leases")
    case "$FAKE_SCENARIO" in
      badlease) echo "1606808691 34:7d:f6:65:b1:1b 10.0.2.117" ;;
      *) printf '1606808691 34:7d:f6:65:b1:1b 10.0.2.117 phone 01:34:7d:f6:65:b1:1b\\n1606808692 11:22:33:44:55:66 10.0.2.118 laptop 01:11:22:33:44:55:66\\n' ;;
    esac ;;
  *) exec "$@" ;;
esac`)
      fake.activate()
    })

    after(function () {
      delete process.env.FAKE_SCENARIO
      fake.cleanup()
    })

    it('#getClientsAP()', function (done) {
      process.env.FAKE_SCENARIO = 'ap'
      networkClients.getClients((err, ssid, clients) => {
        assert.strictEqual(err, null)
        assert.strictEqual(ssid, 'TestNet')
        assert.strictEqual(clients.length, 2)
        assert.deepStrictEqual(clients[0], { ip: '10.0.2.117', mac: '34:7d:f6:65:b1:1b', hostname: 'phone' })
        assert.deepStrictEqual(clients[1], { ip: '10.0.2.118', mac: '11:22:33:44:55:66', hostname: 'laptop' })
        // the AP path read the lease file via sudo
        assert.strictEqual(fake.calls('sudo').length, 1)
        done()
      })
    })

    it('#getClientsNoAP()', function (done) {
      // wireless connections without an active device are skipped
      process.env.FAKE_SCENARIO = 'noap'
      networkClients.getClients((err, ssid, clients) => {
        assert.strictEqual(err, null)
        assert.strictEqual(ssid, '')
        assert.strictEqual(clients, null)
        done()
      })
    })

    it('#getClientsNotAPMode()', function (done) {
      // active wifi connection, but in infrastructure (client) mode
      process.env.FAKE_SCENARIO = 'notap'
      networkClients.getClients((err, ssid, clients) => {
        assert.strictEqual(err, null)
        assert.strictEqual(ssid, '')
        assert.strictEqual(clients, null)
        done()
      })
    })

    it('#getClientsBadLease()', function (done) {
      process.env.FAKE_SCENARIO = 'badlease'
      networkClients.getClients((err, ssid, clients) => {
        assert.strictEqual(err, 'Bad lease')
        assert.notStrictEqual(ssid, null)
        assert.deepStrictEqual(clients, [])
        done()
      })
    })

    it('#getClientsStderr()', function (done) {
      process.env.FAKE_SCENARIO = 'stderr'
      networkClients.getClients((err, ssid, clients) => {
        assert.ok(err.includes('nmcli not running'))
        assert.strictEqual(ssid, null)
        assert.strictEqual(clients, null)
        done()
      })
    })

    it('#getClientsExecFailure()', function (done) {
      // mode query exits non-zero -> execSync throws -> error path
      process.env.FAKE_SCENARIO = 'modefail'
      networkClients.getClients((err, ssid, clients) => {
        assert.ok(err.toString().includes('Error'))
        assert.strictEqual(ssid, null)
        assert.strictEqual(clients, null)
        done()
      })
    })
  })
})
