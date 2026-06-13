const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { FakeBin } = require('../test/fakeBin')
const NetworkPriority = require('./networkPriority')

// Build a fake /sys/class/net tree: ifaces = { name: { rx, tx } | 'nostats' | 'garbage' }
function makeNetTree (ifaces) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'netprio-'))
  for (const name of Object.keys(ifaces)) {
    const spec = ifaces[name]
    const ifaceDir = path.join(base, name)
    fs.mkdirSync(ifaceDir)
    if (spec === 'nostats') {
      continue // no statistics dir → readFileSync throws → skipped
    }
    const statsDir = path.join(ifaceDir, 'statistics')
    fs.mkdirSync(statsDir)
    if (spec === 'garbage') {
      fs.writeFileSync(path.join(statsDir, 'rx_bytes'), 'abc')
      fs.writeFileSync(path.join(statsDir, 'tx_bytes'), 'def')
    } else {
      fs.writeFileSync(path.join(statsDir, 'rx_bytes'), String(spec.rx))
      fs.writeFileSync(path.join(statsDir, 'tx_bytes'), String(spec.tx))
    }
  }
  return base
}

function writeBytes (base, iface, rx, tx) {
  fs.writeFileSync(path.join(base, iface, 'statistics', 'rx_bytes'), String(rx))
  fs.writeFileSync(path.join(base, iface, 'statistics', 'tx_bytes'), String(tx))
}

describe('Network Priority & Bandwidth', function () {
  describe('bandwidth sampling', function () {
    const dirs = []

    after(function () {
      dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true }))
    })
    function tree (ifaces) { const d = makeNetTree(ifaces); dirs.push(d); return d }

    it('first sample is a baseline (empty result)', function () {
      const np = new NetworkPriority()
      np.netStatsBase = tree({ eth0: { rx: 1000, tx: 500 }, lo: { rx: 9, tx: 9 } })
      assert.deepEqual(np.getBandwidth(1000), [])
    })

    it('defaults the timestamp to the wall clock when none is given', function () {
      const np = new NetworkPriority()
      np.netStatsBase = tree({ eth0: { rx: 1, tx: 1 } })
      assert.deepEqual(np.getBandwidth(), []) // baseline, exercises the Date.now() default
    })

    it('computes rates between two samples and skips lo', function () {
      const np = new NetworkPriority()
      const base = tree({ eth0: { rx: 1000, tx: 500 }, lo: { rx: 9, tx: 9 } })
      np.netStatsBase = base
      np.sample(1000) // baseline at t=1s
      writeBytes(base, 'eth0', 3000, 1500)
      const out = np.sample(3000) // t=3s → dt=2s
      assert.equal(out.length, 1) // lo skipped
      assert.equal(out[0].name, 'eth0')
      assert.equal(out[0].rxRate, (3000 - 1000) / 2)
      assert.equal(out[0].txRate, (1500 - 500) / 2)
    })

    it('handles a counter reset (lower value than before)', function () {
      const np = new NetworkPriority()
      const base = tree({ eth0: { rx: 5000, tx: 5000 } })
      np.netStatsBase = base
      np.sample(1000)
      writeBytes(base, 'eth0', 200, 100) // reset
      const out = np.sample(2000)
      assert.equal(out[0].rxRate, 200) // dRx = b.rx, over dt=1s
      assert.equal(out[0].txRate, 100)
    })

    it('reports zero rate when no time elapses', function () {
      const np = new NetworkPriority()
      const base = tree({ eth0: { rx: 1000, tx: 1000 } })
      np.netStatsBase = base
      np.sample(5000)
      writeBytes(base, 'eth0', 2000, 2000)
      const out = np.sample(5000) // same timestamp → dt=0
      assert.equal(out[0].rxRate, 0)
      assert.equal(out[0].txRate, 0)
    })

    it('treats a newly-appeared interface as zero delta', function () {
      const np = new NetworkPriority()
      const base = tree({ eth0: { rx: 1000, tx: 1000 } })
      np.netStatsBase = base
      np.sample(1000)
      // add a new interface that was not in the baseline
      fs.mkdirSync(path.join(base, 'usb0', 'statistics'), { recursive: true })
      writeBytes(base, 'usb0', 800, 800)
      const out = np.sample(2000)
      const usb = out.find(i => i.name === 'usb0')
      assert.equal(usb.rxRate, 0) // prev missing → delta 0
    })

    it('returns empty when the base dir does not exist', function () {
      const np = new NetworkPriority()
      np.netStatsBase = '/nonexistent/class/net'
      assert.deepEqual(np.readNetStats(), {})
    })

    it('skips interfaces with garbage or missing counters', function () {
      const np = new NetworkPriority()
      np.netStatsBase = tree({ good: { rx: 10, tx: 20 }, bad: 'garbage', noStats: 'nostats' })
      const stats = np.readNetStats()
      assert.ok(stats.good)
      assert.ok(!stats.bad)
      assert.ok(!stats.noStats)
    })
  })

  describe('nmcli priority/listing', function () {
    let fake

    before(function () {
      fake = new FakeBin()
      fake.install('sudo', `case "$FAKE_SCENARIO" in
np-list-err) if echo "$*" | grep -q "connection show"; then echo "list boom" >&2; exit 1; fi ;;
np-set-err) if echo "$*" | grep -q "connection modify"; then echo "set boom" >&2; exit 1; fi ;;
esac
case "$*" in
*"connection show"*)
  if [ "$FAKE_SCENARIO" = "np-empty" ]; then printf ''; else printf 'Wired:uuid-1:802-3-ethernet\\nWiFi:uuid-2:802-11-wireless\\n'; fi ;;
*"connection modify"*) exit 0 ;;
esac
exit 0`)
      fake.activate()
    })

    after(function () { fake.cleanup() })

    afterEach(function () { delete process.env.FAKE_SCENARIO })

    it('lists connections', function (done) {
      const np = new NetworkPriority()
      np.listConnections((err, list) => {
        assert.equal(err, null)
        assert.equal(list.length, 2)
        assert.equal(list[0].uuid, 'uuid-1')
        assert.equal(list[1].type, '802-11-wireless')
        done()
      })
    })

    it('lists nothing when there are no connections', function (done) {
      process.env.FAKE_SCENARIO = 'np-empty'
      const np = new NetworkPriority()
      np.listConnections((err, list) => {
        assert.equal(err, null)
        assert.deepEqual(list, [])
        done()
      })
    })

    it('passes through a list error on stderr', function (done) {
      process.env.FAKE_SCENARIO = 'np-list-err'
      const np = new NetworkPriority()
      np.listConnections((err, list) => {
        assert.ok(err.includes('list boom'))
        assert.deepEqual(list, [])
        done()
      })
    })

    it('sets a connection priority', function (done) {
      const np = new NetworkPriority()
      np.setPriority('uuid-2', 10, 50, (err) => {
        assert.equal(err, null)
        done()
      })
    })

    it('passes through a set error on stderr', function (done) {
      process.env.FAKE_SCENARIO = 'np-set-err'
      const np = new NetworkPriority()
      np.setPriority('uuid-2', 10, 50, (err) => {
        assert.ok(err.includes('set boom'))
        done()
      })
    })
  })
})
