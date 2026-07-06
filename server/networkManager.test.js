const assert = require('assert')
const fs = require('fs')
const path = require('path')
const sinon = require('sinon')
const { FakeBin } = require('../test/fakeBin')
const networkManager = require('./networkManager')

// Helper: build the full sudo fake body string (used in before() and reinstalled
// after the multi-BSS test that swaps the sudo body)
function buildSudoBody (scanOutput) {
  const scanLines = scanOutput || [
    '    printf "BSS 00:11:22:33:44:55\\n"',
    '    printf "\\tSSID: HomeNet\\n"',
    '    printf "\\tsignal: -45.00 dBm\\n"',
    '    printf "\\t* RSN:\\n"',
    '    printf "BSS aa:bb:cc:dd:ee:ff\\n"',
    '    printf "\\tSSID: GuestNet\\n"',
    '    printf "\\tsignal: -60.00 dBm\\n"',
    '    printf "\\t* WPA:\\n"',
    "    printf 'BSS 11:22:33:44:55:66\\n'",
    "    printf '\\tSSID: Caf\\303\\251Net\\n'",
    "    printf '\\tsignal: -70.00 dBm\\n'",
    "    printf '\\t* WEP:\\n'",
    '    printf "BSS 22:33:44:55:66:77\\n"',
    '    printf "\\tSSID: \\n"',
    '    printf "\\tsignal: -80.00 dBm\\n"'
  ]

  return [
    'case "$FAKE_SCENARIO" in',
    // ---- getAdapters ----
    '  nm-err)',
    '    if echo "$*" | grep -q "nmcli -t -f device,type,state dev"; then',
    '      echo "nmcli error" >&2; exit 1',
    '    fi ;;',
    // ---- getWirelessStatus ----
    '  radio-err)',
    '    if echo "$*" | grep -q "nmcli -t radio wifi"; then',
    '      echo "radio error" >&2; exit 1',
    '    fi ;;',
    '  wifi-off)',
    '    if echo "$*" | grep -q "nmcli -t radio wifi"; then',
    '      echo "disabled"; exit 0',
    '    fi ;;',
    // ---- setWirelessStatus ----
    '  set-stderr)',
    '    echo "set error" >&2; exit 0 ;;',
    // ---- activateConnection / deactivateConnection autoconnect ----
    '  auto-fail)',
    '    if echo "$*" | grep -q "connection.autoconnect"; then',
    '      echo "auto error" >&2; exit 1',
    '    fi ;;',
    '  auto-stderr)',
    '    if echo "$*" | grep -q "connection.autoconnect yes"; then',
    '      echo "auto stderr" >&2; exit 0',
    '    fi ;;',
    // ---- connection up/down ----
    '  updown-fail)',
    '    if echo "$*" | grep -qE "connection (up|down)"; then',
    '      echo "updown error" >&2; exit 1',
    '    fi ;;',
    // ---- iw scan ----
    '  scan-fail)',
    '    if echo "$*" | grep -q "scan ap-force"; then',
    '      exit 1',
    '    fi ;;',
    '  scan-stderr)',
    '    if echo "$*" | grep -q "scan ap-force"; then',
    '      echo "scan error" >&2; exit 0',
    '    fi ;;',
    // ---- nmcli connection add ----
    '  add-fail)',
    '    if echo "$*" | grep -q "connection add"; then',
    '      exit 1',
    '    fi ;;',
    '  add-stderr)',
    '    if echo "$*" | grep -q "connection add"; then',
    '      echo "add stderr" >&2; exit 0',
    '    fi ;;',
    // ---- nmcli uuid lookup — exit 0 + stderr to cover binary-expr RHS ----
    '  uuid-stderr)',
    '    if echo "$*" | grep -q "connection.uuid"; then',
    '      echo "uuid stderr" >&2; exit 0',
    '    fi ;;',
    // ---- nmcli uuid lookup — exit 1 to cover LHS ----
    '  uuid-fail)',
    '    if echo "$*" | grep -q "connection.uuid"; then',
    '      echo "uuid error" >&2; exit 1',
    '    fi ;;',
    // ---- attach interface ----
    '  attach-fail)',
    '    if echo "$*" | grep -q "connection.interface-name"; then',
    '      echo "attach error" >&2; exit 1',
    '    fi ;;',
    // ---- ip address edits ----
    '  ip-fail)',
    '    if echo "$*" | grep -q "ipv4.method"; then',
    '      echo "ip error" >&2; exit 1',
    '    fi ;;',
    // ---- psk edits ----
    '  psk-fail)',
    '    if echo "$*" | grep -q "key-mgmt"; then',
    '      echo "psk error" >&2; exit 1',
    '    fi ;;',
    '  psk2-fail)',
    '    if echo "$*" | echo "$*" | grep -q "wireless-security.psk "; then',
    '      echo "psk2 error" >&2; exit 1',
    '    fi ;;',
    '  pskrm-fail)',
    '    if echo "$*" | grep -q "remove 802-11-wireless-security"; then',
    '      echo "pskrm error" >&2; exit 1',
    '    fi ;;',
    // ---- AP ssid/band edit ----
    '  ap-fail)',
    '    if echo "$*" | grep -q "802-11-wireless.band"; then',
    '      echo "ap error" >&2; exit 1',
    '    fi ;;',
    // ---- client ssid edit ----
    '  client-fail)',
    '    if echo "$*" | grep -q "802-11-wireless.ssid" && ! echo "$*" | grep -q "802-11-wireless.band"; then',
    '      echo "client error" >&2; exit 1',
    '    fi ;;',
    // ---- delete connection ----
    '  del-fail)',
    '    if echo "$*" | grep -q "connection delete"; then',
    '      echo "del error" >&2; exit 1',
    '    fi ;;',
    // ---- conshow-fail: execSync nmcli connection show ----
    '  conshow-fail)',
    '    if echo "$*" | grep -q "NAME,UUID,TYPE,DEVICE"; then',
    '      echo "conshow error" >&2; exit 1',
    '    fi ;;',
    // ---- details-err ----
    '  details-err)',
    '    if echo "$*" | grep -q "ipv4.addresses"; then',
    '      echo "details error" >&2; exit 1',
    '    fi ;;',
    // ---- details-a: band "a" variant with empty/bare IP4.ADDRESS lines ----
    '  details-a)',
    '    if echo "$*" | grep -q "ipv4.addresses"; then',
    "      printf 'ipv4.addresses:\\n'",
    "      printf '802-11-wireless.band:a\\n'",
    "      printf 'ipv4.method:auto\\n'",
    "      printf 'IP4.ADDRESS[1]:\\n'",
    "      printf 'IP4.ADDRESS[1]\\n'",
    "      printf '802-11-wireless.ssid:TestNet\\n'",
    "      printf '802-11-wireless.mode:infrastructure\\n'",
    "      printf '802-11-wireless-security.key-mgmt:wpa-psk\\n'",
    "      printf '802-11-wireless-security.psk:secret\\n'",
    "      printf 'connection.interface-name:eth0\\n'",
    "      printf '802-11-wireless.channel:6\\n'",
    "      printf 'junkline\\n'",
    '      exit 0',
    '    fi ;;',
    // ---- scan-empty: empty scan stdout → covers line 184 false branch (current=null at end) ----
    '  scan-empty)',
    '    if echo "$*" | grep -q "scan ap-force"; then',
    '      printf ""; exit 0',
    '    fi ;;',
    'esac',
    '',
    '# Default behaviour by command',
    'case "$*" in',
    // getAdapters
    '  "nmcli -t -f device,type,state dev")',
    '    printf "lo:loopback:unmanaged\\n"',
    '    printf "br0:bridge:connected\\n"',
    '    printf "p2p0:wifi-p2p:disconnected\\n"',
    '    printf "c0:can0:connected\\n"',
    '    printf "c1:can1:connected\\n"',
    '    printf "eth0:ethernet:connected\\n"',
    '    printf "eth1:ethernet:unavailable\\n"',
    '    printf "wlan0:wifi:connected\\n"',
    '    printf "wlan1:wifi:unavailable\\n"',
    '    printf "bad\\n"',
    '    ;;',
    // getWirelessStatus / setWirelessStatus (second half)
    '  "nmcli -t radio wifi")',
    '    echo "enabled" ;;',
    // iw dev scan output (via "sudo iw dev wlan0 scan ap-force")
    // starts with a non-BSS line to cover line 161 true branch (!current return)
    '  *"scan ap-force"*)',
    '    printf "iw scan output:\\n"',
    '    printf "BSS 00:11:22:33:44:55\\n"',
    '    printf "\\tSSID: HomeNet\\n"',
    '    printf "\\tsignal: -45.00 dBm\\n"',
    '    printf "\\t* RSN:\\n"',
    '    printf "BSS aa:bb:cc:dd:ee:ff\\n"',
    '    printf "\\tSSID: GuestNet\\n"',
    '    printf "\\tsignal: -60.00 dBm\\n"',
    '    printf "\\t* WPA:\\n"',
    "    printf 'BSS 11:22:33:44:55:66\\n'",
    "    printf '\\tSSID: Caf\\303\\251Net\\n'",
    "    printf '\\tsignal: -70.00 dBm\\n'",
    "    printf '\\t* WEP:\\n'",
    '    printf "BSS 22:33:44:55:66:77\\n"',
    '    printf "\\tSSID: \\n"',
    '    printf "\\tsignal: -80.00 dBm\\n"',
    '    ;;',
    // getConnections (execSync)
    '  "nmcli -t -f NAME,UUID,TYPE,DEVICE connection show")',
    '    printf "Wired connection 1:UUID-1:802-3-ethernet:eth0\\n"',
    '    printf "unused:UUID-2:wifi:\\n"',
    '    printf "inactive:UUID-4:802-3-ethernet:--\\n"',
    '    printf "three:UUID-3:wifi\\n"',
    '    ;;',
    // connection.interface-name sub-query: UUID-2 always errors (inner catch coverage)
    '  "nmcli -s -t -f connection.interface-name connection show UUID-2")',
    '    echo "iface error" >&2; exit 1 ;;',
    '  nmcli\\ -s\\ -t\\ -f\\ connection.interface-name\\ connection\\ show\\ *)',
    '    echo "connection.interface-name:eth0" ;;',
    // getConnectionDetails default output
    '  nmcli\\ -s\\ -t\\ -f\\ ipv4.addresses*)',
    "    printf 'ipv4.addresses:192.168.7.2/24\\n'",
    "    printf '802-11-wireless.band:\\n'",
    "    printf 'ipv4.method:manual\\n'",
    "    printf 'IP4.ADDRESS[1]:10.0.0.5/16\\n'",
    "    printf '802-11-wireless.ssid:HomeNet\\n'",
    "    printf '802-11-wireless.mode:ap\\n'",
    "    printf '802-11-wireless-security.key-mgmt:wpa-psk\\n'",
    "    printf '802-11-wireless-security.psk:password123\\n'",
    "    printf 'connection.interface-name:wlan0\\n'",
    "    printf '802-11-wireless.channel:11\\n'",
    "    printf 'junkline\\n'",
    "    printf 'IP4.ADDRESS[1]:\\n'",
    '    ;;',
    // wired addConnection: add + uuid in one exec shell string
    '  nmcli\\ connection\\ add\\ type\\ ethernet*)',
    '    printf "connection 1 added\\nUUID-ADD\\n" ;;',
    // wifi addConnection: execFile sudo with args
    '  nmcli\\ connection\\ add\\ type\\ wifi*)',
    '    printf "connection wifi added\\n" ;;',
    // uuid lookup after add (execFile)
    '  "nmcli -g connection.uuid con show"*)',
    '    printf "UUID-9\\n\\n" ;;',
    // all mod commands succeed by default
    '  "nmcli connection mod"*)',
    '    exit 0 ;;',
    '  "nmcli -s connection mod"*)',
    '    exit 0 ;;',
    // connection up/down
    '  "nmcli connection up"*)',
    '    exit 0 ;;',
    '  "nmcli connection down"*)',
    '    exit 0 ;;',
    // connection delete
    '  "nmcli connection delete"*)',
    '    exit 0 ;;',
    '  *)',
    '    exit 0 ;;',
    'esac'
  ].join('\n')
}

describe('Network Manager Functions', function () {
  let fake

  before(function () {
    fake = new FakeBin()
    fake.install('sudo', buildSudoBody())

    // -------------------------------------------------------------------------
    // fake iw (no sudo) — used by getPrimaryWifiDevice pipeline
    // -------------------------------------------------------------------------
    fake.install('iw', [
      'case "$FAKE_SCENARIO" in',
      '  iw-stderr)',
      '    echo "iw error" >&2; exit 0 ;;',
      '  awk-fail)',
      '    printf "phy#0\\n\\tInterface wlan0\\n" ;;',
      'esac',
      'printf "phy#0\\n\\tInterface wlan0\\n"'
    ].join('\n'))

    // -------------------------------------------------------------------------
    // fake awk — pass-through except awk-fail exits 1 to cover the error branch
    // -------------------------------------------------------------------------
    fake.install('awk', [
      'if [ "$FAKE_SCENARIO" = "awk-fail" ]; then exit 1; fi',
      'exec /usr/bin/awk "$@"'
    ].join('\n'))

    // -------------------------------------------------------------------------
    // fake iwlist (no sudo) — used by getAdapters for wifi channel discovery
    // -------------------------------------------------------------------------
    fake.install('iwlist', [
      'case "$FAKE_SCENARIO" in',
      '  iwlist-fail)',
      '    exit 1 ;;',
      'esac',
      '# 2.4GHz channel (band=bg), 5GHz channel (band=a), Current line, short line',
      'echo "          Channel 01 : 2.412 GHz"',
      'echo "          Channel 36 : 5.18 GHz"',
      'echo "          Current Frequency:2.412 GHz (Channel 1)"',
      'echo "          Channel 7"'
    ].join('\n'))

    fake.activate()
  })

  after(function () {
    fake.cleanup()
  })

  afterEach(function () {
    sinon.restore()
    delete process.env.FAKE_SCENARIO
  })

  // ---------------------------------------------------------------------------
  describe('#getAdapters()', function () {
    it('should return filtered adapters with wifi channel list', function (done) {
      networkManager.getAdapters(function (err, list) {
        try {
          assert.equal(err, null)
          const names = list.map(function (d) { return d.value })
          // filtered types: loopback, bridge, wifi-p2p, can0, can1
          assert.ok(!names.includes('lo'), 'lo should be filtered')
          assert.ok(!names.includes('br0'), 'br0 should be filtered')
          assert.ok(!names.includes('p2p0'), 'p2p0 should be filtered')
          // ethernet and wifi remain
          assert.ok(names.includes('eth0'), 'eth0 expected')
          assert.ok(names.includes('wlan0'), 'wlan0 expected')
          assert.ok(names.includes('wlan1'), 'wlan1 expected (isDisabled)')
          // wlan0 has channels: auto + Channel 01 (bg) + Channel 36 (a)
          const wlan0 = list.find(function (d) { return d.value === 'wlan0' })
          assert.ok(wlan0.channels.length >= 3, 'wlan0 should have 3+ channel entries')
          // channel 36 should have band 'a' (5.18 GHz ≥ 3)
          const ch36 = wlan0.channels.find(function (c) { return c.value === 36 })
          assert.equal(ch36.band, 'a')
          // channel 1 should have band 'bg'
          const ch1 = wlan0.channels.find(function (c) { return c.value === 1 })
          assert.equal(ch1.band, 'bg')
          // wlan1 isDisabled=true (wifi + unavailable)
          const wlan1 = list.find(function (d) { return d.value === 'wlan1' })
          assert.equal(wlan1.isDisabled, true)
          // eth0 isDisabled=false (not wifi)
          const eth0 = list.find(function (d) { return d.value === 'eth0' })
          assert.equal(eth0.isDisabled, false)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should error when nmcli fails', function (done) {
      process.env.FAKE_SCENARIO = 'nm-err'
      networkManager.getAdapters(function (err) {
        try {
          assert.ok(err)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should error when iwlist fails for a wifi adapter', function (done) {
      process.env.FAKE_SCENARIO = 'iwlist-fail'
      // guard against double-callback (forEach continues after callback(e) in the catch)
      let finished = false
      networkManager.getAdapters(function (err) {
        if (finished) return
        finished = true
        try {
          assert.ok(err)
          done()
        } catch (e) {
          done(e)
        }
      })
    })
  })

  // ---------------------------------------------------------------------------
  describe('#getWirelessStatus()', function () {
    it('should report wifi enabled', function (done) {
      networkManager.getWirelessStatus(function (err, status) {
        try {
          assert.equal(err, null)
          assert.equal(status, true)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should report wifi disabled', function (done) {
      process.env.FAKE_SCENARIO = 'wifi-off'
      networkManager.getWirelessStatus(function (err, status) {
        try {
          assert.equal(err, null)
          assert.equal(status, false)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should pass through radio error', function (done) {
      process.env.FAKE_SCENARIO = 'radio-err'
      networkManager.getWirelessStatus(function (err) {
        try {
          assert.ok(err)
          done()
        } catch (e) {
          done(e)
        }
      })
    })
  })

  // ---------------------------------------------------------------------------
  describe('#setWirelessStatus()', function () {
    it('should turn wifi on and report enabled', function (done) {
      networkManager.setWirelessStatus(true, function (err, status) {
        try {
          assert.equal(err, null)
          assert.equal(status, true)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should turn wifi off and report disabled', function (done) {
      process.env.FAKE_SCENARIO = 'wifi-off'
      networkManager.setWirelessStatus(false, function (err, status) {
        try {
          assert.equal(err, null)
          assert.equal(status, false)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should pass through stderr on set', function (done) {
      process.env.FAKE_SCENARIO = 'set-stderr'
      networkManager.setWirelessStatus(true, function (err) {
        try {
          assert.ok(err)
          done()
        } catch (e) {
          done(e)
        }
      })
    })
  })

  // ---------------------------------------------------------------------------
  describe('#activateConnection()', function () {
    it('should activate a connection successfully', function (done) {
      networkManager.activateConnection('UUID-TEST', function (err, result) {
        try {
          assert.equal(err, null)
          assert.equal(result, 'OK')
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should fail when autoconnect mod fails', function (done) {
      process.env.FAKE_SCENARIO = 'auto-fail'
      networkManager.activateConnection('UUID-TEST', function (err) {
        try {
          assert.ok(err)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should fail when connection up fails', function (done) {
      process.env.FAKE_SCENARIO = 'updown-fail'
      networkManager.activateConnection('UUID-TEST', function (err) {
        try {
          assert.ok(err)
          done()
        } catch (e) {
          done(e)
        }
      })
    })
  })

  // ---------------------------------------------------------------------------
  describe('#deactivateConnection()', function () {
    it('should deactivate a connection successfully', function (done) {
      networkManager.deactivateConnection('UUID-TEST', function (err, result) {
        try {
          assert.equal(err, null)
          assert.equal(result, 'OK')
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should fail when autoconnect mod fails', function (done) {
      process.env.FAKE_SCENARIO = 'auto-fail'
      networkManager.deactivateConnection('UUID-TEST', function (err) {
        try {
          assert.ok(err)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should fail when connection down fails', function (done) {
      process.env.FAKE_SCENARIO = 'updown-fail'
      networkManager.deactivateConnection('UUID-TEST', function (err) {
        try {
          assert.ok(err)
          done()
        } catch (e) {
          done(e)
        }
      })
    })
  })

  // ---------------------------------------------------------------------------
  describe('#getWifiScan() via getPrimaryWifiDevice()', function () {
    it('should scan and return signal-sorted results with empty SSID filtered', function (done) {
      networkManager.getWifiScan(function (err, networks) {
        try {
          assert.equal(err, null)
          // sorted by signal descending
          for (let i = 1; i < networks.length; i++) {
            assert.ok(networks[i - 1].signal >= networks[i].signal, 'not sorted by signal')
          }
          // all entries have a non-empty ssid (empty SSID BSS filtered out)
          networks.forEach(function (n) { assert.ok(n.ssid, 'ssid must be truthy') })
          // HomeNet (RSN → WPA2) and GuestNet (WPA) present
          const ssids = networks.map(function (n) { return n.ssid })
          assert.ok(ssids.includes('HomeNet'), 'HomeNet missing')
          assert.ok(ssids.includes('GuestNet'), 'GuestNet missing')
          // security
          const home = networks.find(function (n) { return n.ssid === 'HomeNet' })
          assert.equal(home.security, 'WPA2')
          const guest = networks.find(function (n) { return n.ssid === 'GuestNet' })
          assert.equal(guest.security, 'WPA')
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should error when iw reports stderr (new Error(stderr) path)', function (done) {
      process.env.FAKE_SCENARIO = 'iw-stderr'
      networkManager.getWifiScan(function (err) {
        try {
          assert.ok(err instanceof Error)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should error when awk pipeline exits non-zero (error path)', function (done) {
      process.env.FAKE_SCENARIO = 'awk-fail'
      networkManager.getWifiScan(function (err) {
        try {
          assert.ok(err)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should error when iw scan exits non-zero', function (done) {
      process.env.FAKE_SCENARIO = 'scan-fail'
      networkManager.getWifiScan(function (err) {
        try {
          assert.ok(err)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should error when iw scan has stderr output', function (done) {
      process.env.FAKE_SCENARIO = 'scan-stderr'
      networkManager.getWifiScan(function (err) {
        try {
          assert.ok(err instanceof Error)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should return empty array when scan stdout is empty (line 184 false branch)', function (done) {
      process.env.FAKE_SCENARIO = 'scan-empty'
      networkManager.getWifiScan(function (err, networks) {
        try {
          assert.equal(err, null)
          assert.deepEqual(networks, [])
          done()
        } catch (e) {
          done(e)
        }
      })
    })
  })

  // ---------------------------------------------------------------------------
  describe('#getConnections()', function () {
    it('should return list with active, empty-state and -- state entries', function (done) {
      networkManager.getConnections(function (err, list) {
        try {
          assert.equal(err, null)
          assert.ok(Array.isArray(list))
          const uuids = list.map(function (c) { return c.value })
          // UUID-1 active (eth0), UUID-2 empty state, UUID-4 state '--'
          assert.ok(uuids.includes('UUID-1'), 'UUID-1 expected')
          assert.ok(uuids.includes('UUID-2'), 'UUID-2 expected')
          assert.ok(uuids.includes('UUID-4'), 'UUID-4 expected')
          // UUID-1 should have attachedIface from sub-query
          const u1 = list.find(function (c) { return c.value === 'UUID-1' })
          assert.equal(u1.attachedIface, 'eth0')
          // UUID-2 sub-query throws (inner catch) → attachedIface is ''
          const u2 = list.find(function (c) { return c.value === 'UUID-2' })
          assert.equal(u2.attachedIface, '')
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should error when execSync throws', function (done) {
      process.env.FAKE_SCENARIO = 'conshow-fail'
      networkManager.getConnections(function (err) {
        try {
          assert.ok(err)
          done()
        } catch (e) {
          done(e)
        }
      })
    })
  })

  // ---------------------------------------------------------------------------
  describe('#getConnectionDetails()', function () {
    it('should return parsed connection details from default output', function (done) {
      networkManager.getConnectionDetails('UUID-TEST', function (err, ret) {
        try {
          assert.equal(err, null)
          // band empty → 'bg'
          assert.equal(ret.band, 'bg')
          assert.equal(ret.DHCP, 'manual')
          // ipv4.addresses:192.168.7.2/24 is parsed first; then IP4.ADDRESS[1]:10.0.0.5/16
          // overwrites it (it comes later in the else-if chain)
          assert.equal(ret.IP, '10.0.0.5')
          assert.equal(ret.subnet, '255.255.0.0') // CIDR 16
          assert.equal(ret.ssid, 'HomeNet')
          assert.equal(ret.mode, 'ap')
          assert.equal(ret.wpaType, 'wpa-psk')
          assert.equal(ret.password, 'password123')
          assert.equal(ret.attachedIface, 'wlan0')
          assert.equal(ret.channel, '11')
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should return band=a and handle empty/bare IP4.ADDRESS lines (details-a)', function (done) {
      process.env.FAKE_SCENARIO = 'details-a'
      networkManager.getConnectionDetails('UUID-TEST', function (err, ret) {
        try {
          assert.equal(err, null)
          assert.equal(ret.band, 'a')
          // ipv4.addresses empty, IP4.ADDRESS[1] empty and bare → IP stays ''
          assert.equal(ret.IP, '')
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should pass through stderr on details query', function (done) {
      process.env.FAKE_SCENARIO = 'details-err'
      networkManager.getConnectionDetails('UUID-TEST', function (err) {
        try {
          assert.ok(err)
          done()
        } catch (e) {
          done(e)
        }
      })
    })
  })

  // ---------------------------------------------------------------------------
  describe('#deleteConnection()', function () {
    it('should delete a connection successfully', function (done) {
      networkManager.deleteConnection('UUID-TEST', function (err, result) {
        try {
          assert.equal(err, null)
          assert.equal(result, 'OK')
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should fail when delete command fails', function (done) {
      process.env.FAKE_SCENARIO = 'del-fail'
      networkManager.deleteConnection('UUID-TEST', function (err) {
        try {
          assert.ok(err)
          done()
        } catch (e) {
          done(e)
        }
      })
    })
  })

  // ---------------------------------------------------------------------------
  describe('#editConnectionAttached() via editConnection()', function () {
    it('should convert &quot;&quot; attachedIface to ""', function (done) {
      const settings = { attachedIface: '&quot;&quot;', ipaddresstype: 'auto', mode: '' }
      networkManager.editConnection('UUID-A', settings, function (err, result) {
        try {
          assert.equal(err, null)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should convert "undefined" attachedIface to ""', function (done) {
      const settings = { attachedIface: 'undefined', ipaddresstype: 'auto', mode: '' }
      networkManager.editConnection('UUID-A', settings, function (err) {
        try {
          assert.equal(err, null)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should fail when attach command fails', function (done) {
      process.env.FAKE_SCENARIO = 'attach-fail'
      const settings = { attachedIface: 'eth0', ipaddresstype: 'auto', mode: '' }
      networkManager.editConnection('UUID-A', settings, function (err) {
        try {
          assert.ok(err)
          done()
        } catch (e) {
          done(e)
        }
      })
    })
  })

  // ---------------------------------------------------------------------------
  describe('#editConnectionIP() via editConnection()', function () {
    // Use mode='' so editConnectionPSK returns EditNotRequired and APClient too

    it('should edit IP as auto when no ssid and mode empty', function (done) {
      const settings = { attachedIface: 'eth0', ipaddresstype: 'auto', mode: '' }
      networkManager.editConnection('UUID-B', settings, function (err) {
        try {
          assert.equal(err, null)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should edit IP as manual with subnet → netmask2CIDR', function (done) {
      const settings = {
        attachedIface: 'eth0',
        ipaddresstype: 'manual',
        ipaddress: '192.168.1.100',
        subnet: '255.255.255.0',
        mode: ''
      }
      networkManager.editConnection('UUID-B', settings, function (err) {
        try {
          assert.equal(err, null)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should fail on IP auto edit when sudo fails', function (done) {
      process.env.FAKE_SCENARIO = 'ip-fail'
      const settings = { attachedIface: 'eth0', ipaddresstype: 'auto', mode: '' }
      networkManager.editConnection('UUID-B', settings, function (err) {
        try {
          assert.ok(err)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should fail on IP manual edit when sudo fails', function (done) {
      process.env.FAKE_SCENARIO = 'ip-fail'
      const settings = {
        attachedIface: 'eth0',
        ipaddresstype: 'manual',
        ipaddress: '192.168.1.100',
        subnet: '255.255.255.0',
        mode: ''
      }
      networkManager.editConnection('UUID-B', settings, function (err) {
        try {
          assert.ok(err)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should skip IP edit when ssid set and mode is not infrastructure', function (done) {
      // ssid set + mode 'ap' → editConnectionIP returns EditNotRequired
      // PSK: mode='ap', wpaType='none', ssid set → pskrm branch
      // APClient: mode='ap', all fields set → ap edit
      const settings = {
        attachedIface: 'eth0',
        ipaddresstype: 'auto',
        ssid: 'TestNet',
        mode: 'ap',
        band: 'bg',
        channel: '6',
        ipaddress: '192.168.4.1',
        wpaType: 'none'
      }
      networkManager.editConnection('UUID-C', settings, function (err) {
        try {
          assert.equal(err, null)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should silently not callback when manual but no ipaddress', function (done) {
      const settings = {
        attachedIface: 'eth0',
        ipaddresstype: 'manual',
        ipaddress: '',
        subnet: '255.255.255.0',
        mode: ''
      }
      networkManager.editConnection('UUID-B', settings, function () {})
      setTimeout(done, 300)
    })

    it('should silently not callback when manual but no subnet', function (done) {
      const settings = {
        attachedIface: 'eth0',
        ipaddresstype: 'manual',
        ipaddress: '192.168.1.1',
        subnet: '',
        mode: ''
      }
      networkManager.editConnection('UUID-B', settings, function () {})
      setTimeout(done, 300)
    })

    it('should silently not callback when manual with empty object values', function (done) {
      const settings = {
        attachedIface: 'eth0',
        ipaddresstype: 'manual',
        ipaddress: {},
        subnet: {},
        mode: ''
      }
      networkManager.editConnection('UUID-B', settings, function () {})
      setTimeout(done, 300)
    })
  })

  // ---------------------------------------------------------------------------
  describe('#editConnectionPSK() via editConnection()', function () {
    it('should add wpa-psk key for infrastructure network', function (done) {
      const settings = {
        attachedIface: 'eth0',
        ipaddresstype: 'auto',
        ssid: 'TestNet',
        mode: 'infrastructure',
        wpaType: 'wpa-psk',
        password: 'mypassword'
      }
      networkManager.editConnection('UUID-P', settings, function (err) {
        try {
          assert.equal(err, null)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should fail when key-mgmt edit fails', function (done) {
      process.env.FAKE_SCENARIO = 'psk-fail'
      const settings = {
        attachedIface: 'eth0',
        ipaddresstype: 'auto',
        ssid: 'TestNet',
        mode: 'infrastructure',
        wpaType: 'wpa-psk',
        password: 'mypassword'
      }
      networkManager.editConnection('UUID-P', settings, function (err) {
        try {
          assert.ok(err)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should fail when psk value edit fails', function (done) {
      process.env.FAKE_SCENARIO = 'psk2-fail'
      const settings = {
        attachedIface: 'eth0',
        ipaddresstype: 'auto',
        ssid: 'TestNet',
        mode: 'infrastructure',
        wpaType: 'wpa-psk',
        password: 'mypassword'
      }
      networkManager.editConnection('UUID-P', settings, function (err) {
        try {
          assert.ok(err)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should remove wireless security when wpaType is none', function (done) {
      const settings = {
        attachedIface: 'eth0',
        ipaddresstype: 'auto',
        ssid: 'TestNet',
        mode: 'infrastructure',
        wpaType: 'none',
        password: ''
      }
      networkManager.editConnection('UUID-P', settings, function (err) {
        try {
          assert.equal(err, null)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should fail when remove security command fails', function (done) {
      process.env.FAKE_SCENARIO = 'pskrm-fail'
      const settings = {
        attachedIface: 'eth0',
        ipaddresstype: 'auto',
        ssid: 'TestNet',
        mode: 'ap',
        band: 'bg',
        channel: '6',
        ipaddress: '192.168.4.1',
        wpaType: 'none'
      }
      networkManager.editConnection('UUID-P', settings, function (err) {
        try {
          assert.ok(err)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should skip PSK when mode is empty string', function (done) {
      const settings = {
        attachedIface: 'eth0',
        ipaddresstype: 'auto',
        mode: '',
        ssid: 'TestNet',
        wpaType: 'wpa-psk',
        password: 'pass'
      }
      networkManager.editConnection('UUID-P', settings, function (err) {
        try {
          assert.equal(err, null)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should skip PSK when mode is empty object', function (done) {
      const settings = {
        attachedIface: 'eth0',
        ipaddresstype: 'auto',
        mode: {},
        ssid: ''
      }
      networkManager.editConnection('UUID-P', settings, function (err) {
        try {
          assert.equal(err, null)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should silently not callback when infrastructure wpa-psk but no password', function (done) {
      const settings = {
        attachedIface: 'eth0',
        ipaddresstype: 'auto',
        ssid: 'TestNet',
        mode: 'infrastructure',
        wpaType: 'wpa-psk',
        password: ''
      }
      networkManager.editConnection('UUID-P', settings, function () {})
      setTimeout(done, 300)
    })
  })

  // ---------------------------------------------------------------------------
  describe('#editConnectionAPClient() via editConnection()', function () {
    it('should edit AP settings with wpaType none', function (done) {
      const settings = {
        attachedIface: 'eth0',
        ipaddresstype: 'manual',
        ipaddress: '192.168.4.1',
        subnet: '255.255.255.0',
        ssid: 'DroneAP',
        mode: 'ap',
        band: 'bg',
        channel: '6',
        wpaType: 'none'
      }
      networkManager.editConnection('UUID-AP', settings, function (err) {
        try {
          assert.equal(err, null)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should edit AP with wpa-psk and channel 0 (converted to empty)', function (done) {
      const settings = {
        attachedIface: 'eth0',
        ipaddresstype: 'manual',
        ipaddress: '192.168.4.1',
        subnet: '255.255.255.0',
        ssid: 'DroneAP',
        mode: 'ap',
        band: 'bg',
        channel: '0',
        wpaType: 'wpa-psk',
        password: 'appassword'
      }
      networkManager.editConnection('UUID-AP', settings, function (err) {
        try {
          assert.equal(err, null)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should return BADARGS when AP missing band', function (done) {
      const settings = {
        attachedIface: 'eth0',
        ipaddresstype: 'auto',
        ssid: 'DroneAP',
        mode: 'ap',
        band: '',
        channel: '6',
        ipaddress: '192.168.4.1',
        wpaType: 'none'
      }
      networkManager.editConnection('UUID-AP', settings, function (err, result) {
        try {
          assert.equal(err, null)
          assert.equal(result, 'EditOK')
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should fail when AP edit command fails', function (done) {
      process.env.FAKE_SCENARIO = 'ap-fail'
      const settings = {
        attachedIface: 'eth0',
        ipaddresstype: 'manual',
        ipaddress: '192.168.4.1',
        subnet: '255.255.255.0',
        ssid: 'DroneAP',
        mode: 'ap',
        band: 'bg',
        channel: '6',
        wpaType: 'none'
      }
      networkManager.editConnection('UUID-AP', settings, function (err) {
        try {
          assert.ok(err)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should edit client ssid for mesh mode', function (done) {
      const settings = {
        attachedIface: 'eth0',
        ipaddresstype: 'auto',
        ssid: 'MeshNet',
        mode: 'mesh',
        wpaType: 'none'
      }
      networkManager.editConnection('UUID-CLI', settings, function (err) {
        try {
          assert.equal(err, null)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should fail when client ssid edit command fails', function (done) {
      process.env.FAKE_SCENARIO = 'client-fail'
      const settings = {
        attachedIface: 'eth0',
        ipaddresstype: 'auto',
        ssid: 'MeshNet',
        mode: 'mesh',
        wpaType: 'none'
      }
      networkManager.editConnection('UUID-CLI', settings, function (err) {
        try {
          assert.ok(err)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should return BADARGS for client mode with empty ssid', function (done) {
      const settings = {
        attachedIface: 'eth0',
        ipaddresstype: 'auto',
        ssid: '',
        mode: 'mesh',
        wpaType: 'none'
      }
      networkManager.editConnection('UUID-CLI', settings, function (err, result) {
        try {
          assert.equal(err, null)
          assert.equal(result, 'EditOK')
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should skip APClient when mode is empty object', function (done) {
      const settings = {
        attachedIface: 'eth0',
        ipaddresstype: 'auto',
        mode: {},
        ssid: ''
      }
      networkManager.editConnection('UUID-CLI', settings, function (err) {
        try {
          assert.equal(err, null)
          done()
        } catch (e) {
          done(e)
        }
      })
    })
  })

  // ---------------------------------------------------------------------------
  describe('#addConnection() — wifi path', function () {
    it('should add wifi with band and non-zero channel', function (done) {
      this.timeout(10000)
      const settings = {
        ssid: 'TestWifi',
        mode: 'infrastructure',
        band: 'bg',
        channel: '6',
        ipaddresstype: 'auto',
        wpaType: 'wpa-psk',
        password: 'wifipass',
        attachedIface: 'wlan0'
      }
      networkManager.addConnection.call(networkManager, 'TestConn', 'wifi', 'wlan0', settings, function (err, result) {
        try {
          assert.equal(err, null)
          assert.equal(result, 'AddOK')
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should add wifi with channel 0 (converted to empty string)', function (done) {
      this.timeout(10000)
      const settings = {
        ssid: 'TestWifi',
        mode: 'infrastructure',
        band: 'bg',
        channel: '0',
        ipaddresstype: 'auto',
        wpaType: 'wpa-psk',
        password: 'wifipass',
        attachedIface: 'wlan0'
      }
      networkManager.addConnection.call(networkManager, 'TestConn', 'wifi', 'wlan0', settings, function (err, result) {
        try {
          assert.equal(err, null)
          assert.equal(result, 'AddOK')
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should add wifi without band or channel (both undefined)', function (done) {
      this.timeout(10000)
      const settings = {
        ssid: 'TestWifi',
        mode: 'infrastructure',
        ipaddresstype: 'auto',
        wpaType: 'wpa-psk',
        password: 'wifipass',
        attachedIface: 'wlan0'
      }
      networkManager.addConnection.call(networkManager, 'TestConn', 'wifi', 'wlan0', settings, function (err, result) {
        try {
          assert.equal(err, null)
          assert.equal(result, 'AddOK')
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should fail when wifi connection add exits non-zero', function (done) {
      process.env.FAKE_SCENARIO = 'add-fail'
      const settings = {
        ssid: 'TestWifi',
        mode: 'infrastructure',
        band: 'bg',
        channel: '6',
        ipaddresstype: 'auto',
        wpaType: 'wpa-psk',
        password: 'wifipass',
        attachedIface: 'wlan0'
      }
      networkManager.addConnection.call(networkManager, 'TestConn', 'wifi', 'wlan0', settings, function (err) {
        try {
          assert.ok(err)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should fail when wifi connection add has stderr (exit 0)', function (done) {
      process.env.FAKE_SCENARIO = 'add-stderr'
      const settings = {
        ssid: 'TestWifi',
        mode: 'infrastructure',
        band: 'bg',
        channel: '6',
        ipaddresstype: 'auto',
        wpaType: 'wpa-psk',
        password: 'wifipass',
        attachedIface: 'wlan0'
      }
      networkManager.addConnection.call(networkManager, 'TestConn', 'wifi', 'wlan0', settings, function (err) {
        try {
          assert.ok(err)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    // covers lines 223-224 binary-expr LHS (error2 is set, exit 1)
    it('should fail when uuid lookup exits non-zero after wifi add (error2 path)', function (done) {
      process.env.FAKE_SCENARIO = 'uuid-fail'
      const settings = {
        ssid: 'TestWifi',
        mode: 'infrastructure',
        band: 'bg',
        channel: '6',
        ipaddresstype: 'auto',
        wpaType: 'wpa-psk',
        password: 'wifipass',
        attachedIface: 'wlan0'
      }
      networkManager.addConnection.call(networkManager, 'TestConn', 'wifi', 'wlan0', settings, function (err) {
        try {
          assert.ok(err)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    // covers lines 223-224 binary-expr RHS (error2=null, stderr2 is set, exit 0)
    it('should fail when uuid lookup has stderr (exit 0) after wifi add (stderr2 path)', function (done) {
      process.env.FAKE_SCENARIO = 'uuid-stderr'
      const settings = {
        ssid: 'TestWifi',
        mode: 'infrastructure',
        band: 'bg',
        channel: '6',
        ipaddresstype: 'auto',
        wpaType: 'wpa-psk',
        password: 'wifipass',
        attachedIface: 'wlan0'
      }
      networkManager.addConnection.call(networkManager, 'TestConn', 'wifi', 'wlan0', settings, function (err) {
        try {
          assert.ok(err)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    // covers the !err && !error3 && !stderr3 → else branch (auto-stderr makes stderr3 truthy)
    it('should fail when final autoconnect yes has stderr after wifi add', function (done) {
      this.timeout(10000)
      process.env.FAKE_SCENARIO = 'auto-stderr'
      const settings = {
        ssid: 'TestWifi',
        mode: 'infrastructure',
        band: 'bg',
        channel: '6',
        ipaddresstype: 'auto',
        wpaType: 'wpa-psk',
        password: 'wifipass',
        attachedIface: 'wlan0'
      }
      networkManager.addConnection.call(networkManager, 'TestConn', 'wifi', 'wlan0', settings, function (err) {
        try {
          // auto-stderr: execFile exits 0 with stderr, so error3=null, stderr3=set
          // !err=true, !error3=true, !stderr3=false → else branch → callback(err||error3||stderr3)
          assert.ok(err)
          done()
        } catch (e) {
          done(e)
        }
      })
    })
  })

  // ---------------------------------------------------------------------------
  describe('#addConnection() — wired path', function () {
    it('should add a wired connection successfully', function (done) {
      this.timeout(10000)
      const settings = {
        ipaddresstype: 'auto',
        attachedIface: 'eth0'
      }
      networkManager.addConnection.call(networkManager, 'WiredConn', 'ethernet', 'eth0', settings, function (err, result) {
        try {
          assert.equal(err, null)
          assert.equal(result, 'AddOK')
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should fail when wired add has stderr', function (done) {
      process.env.FAKE_SCENARIO = 'add-stderr'
      const settings = {
        ipaddresstype: 'auto',
        attachedIface: 'eth0'
      }
      networkManager.addConnection.call(networkManager, 'WiredConn', 'ethernet', 'eth0', settings, function (err) {
        try {
          assert.ok(err)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should fail (callback err) when editConnection errors during wired add', function (done) {
      this.timeout(10000)
      // attach-fail makes editConnectionAttached fail → editConnection callback(errAttach)
      // addConnection then calls exec autoconnect yes (no scenario → no stderr)
      // !err=false → else → callback(err) where err=errAttach (truthy)
      process.env.FAKE_SCENARIO = 'attach-fail'
      const settings = {
        ipaddresstype: 'auto',
        attachedIface: 'eth0'
      }
      networkManager.addConnection.call(networkManager, 'WiredConn', 'ethernet', 'eth0', settings, function (err) {
        try {
          assert.ok(err)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should fail when wired connection add exits non-zero', function (done) {
      // covers the `error || stderr` LHS on the wired add execFile
      process.env.FAKE_SCENARIO = 'add-fail'
      const settings = { ipaddresstype: 'auto', attachedIface: 'eth0' }
      networkManager.addConnection.call(networkManager, 'WiredConn', 'ethernet', 'eth0', settings, function (err) {
        try {
          assert.ok(err)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should fail when uuid lookup exits non-zero after wired add (error2 path)', function (done) {
      // covers the `error2 || stderr2` LHS on the wired uuid lookup execFile
      process.env.FAKE_SCENARIO = 'uuid-fail'
      const settings = { ipaddresstype: 'auto', attachedIface: 'eth0' }
      networkManager.addConnection.call(networkManager, 'WiredConn', 'ethernet', 'eth0', settings, function (err) {
        try {
          assert.ok(err)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should fail when uuid lookup has stderr (exit 0) after wired add (stderr2 path)', function (done) {
      // covers the `error2 || stderr2` RHS on the wired uuid lookup execFile
      process.env.FAKE_SCENARIO = 'uuid-stderr'
      const settings = { ipaddresstype: 'auto', attachedIface: 'eth0' }
      networkManager.addConnection.call(networkManager, 'WiredConn', 'ethernet', 'eth0', settings, function (err) {
        try {
          assert.ok(err)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    it('should fail when final autoconnect yes has stderr after wired add', function (done) {
      this.timeout(10000)
      // covers the `!err && !error3 && !stderr3` → else branch (stderr3 truthy)
      process.env.FAKE_SCENARIO = 'auto-stderr'
      const settings = { ipaddresstype: 'auto', attachedIface: 'eth0' }
      networkManager.addConnection.call(networkManager, 'WiredConn', 'ethernet', 'eth0', settings, function (err) {
        try {
          assert.ok(err)
          done()
        } catch (e) {
          done(e)
        }
      })
    })

    // S2: prove the wired path shells out via execFile (argv array), not exec()
    // (a shell string). An injection payload in conName/conAdapter must reach the
    // fake `sudo` as a single, verbatim argv element — the shell never tokenises,
    // substitutes ($(...)), or executes it.
    it('passes injection payloads as single argv elements (no shell)', function (done) {
      this.timeout(10000)
      const recorder = new FakeBin()
      const argvLog = path.join(recorder.dir, 'argv.log')
      // Record every positional arg on its own line, then behave like a happy
      // nmcli (return a UUID for the lookup, succeed otherwise).
      recorder.install('sudo', [
        `printf '%s\\n' "$@" >> "${argvLog}"`,
        'case "$*" in',
        '  "nmcli -g connection.uuid con show"*) printf "UUID-INJ\\n" ;;',
        'esac',
        'exit 0'
      ].join('\n'))
      recorder.activate()

      const payloadName = 'evil; touch /tmp/pwned'
      const payloadAdapter = 'eth0 $(id)'
      const settings = { ipaddresstype: 'auto', attachedIface: 'eth0' }
      networkManager.addConnection.call(networkManager, payloadName, 'ethernet', payloadAdapter, settings, function (err, result) {
        try {
          assert.equal(err, null)
          assert.equal(result, 'AddOK')
          const lines = fs.readFileSync(argvLog, 'utf8').split('\n').filter(function (l) { return l !== '' })
          // Each malicious value appears verbatim as exactly one argv element —
          // impossible if it had been concatenated into a shell command line.
          assert.ok(lines.includes(payloadName), 'conName must be one argv element')
          assert.ok(lines.includes(payloadAdapter), 'conAdapter must be one argv element')
          recorder.cleanup()
          done()
        } catch (e) {
          recorder.cleanup()
          done(e)
        }
      })
    })
  })

  // ---------------------------------------------------------------------------
  describe('#netmask2CIDR() throw paths (uncaughtException)', function () {
    it('should throw for invalid netmasks (>255, 0<m<128, discontiguous)', function (done) {
      this.timeout(10000)
      const savedListeners = process.listeners('uncaughtException').slice()
      process.removeAllListeners('uncaughtException')

      let count = 0
      let resolved = false

      function handler (e) {
        if (resolved) return
        count++
        if (count >= 3) {
          resolved = true
          process.removeAllListeners('uncaughtException')
          for (let i = 0; i < savedListeners.length; i++) {
            process.on('uncaughtException', savedListeners[i])
          }
          done()
        }
      }

      process.on('uncaughtException', handler)

      // subnet > 255 → 'ERROR: Invalid Netmask'
      const s1 = { attachedIface: 'eth0', ipaddresstype: 'manual', ipaddress: '192.168.1.1', subnet: '256.0.0.0', mode: '' }
      // 0 < m < 128 → 'ERROR: Invalid Netmask'
      const s2 = { attachedIface: 'eth0', ipaddresstype: 'manual', ipaddress: '192.168.1.1', subnet: '64.0.0.0', mode: '' }
      // discontiguous → logs 'Error in netmask2CIDR()' then throws
      const s3 = { attachedIface: 'eth0', ipaddresstype: 'manual', ipaddress: '192.168.1.1', subnet: '255.0.255.0', mode: '' }

      networkManager.editConnection('UUID-THROW', s1, function () {})
      networkManager.editConnection('UUID-THROW', s2, function () {})
      networkManager.editConnection('UUID-THROW', s3, function () {})
    })
  })

  // ---------------------------------------------------------------------------
  describe('#CIDR2netmask() via getConnectionDetails', function () {
    it('should convert various CIDR values to dotted netmasks', function (done) {
      networkManager.getConnectionDetails('UUID-TEST', function (err, ret) {
        try {
          assert.equal(err, null)
          // IP4.ADDRESS[1]:10.0.0.5/16 → CIDR 16 → 255.255.0.0
          assert.equal(ret.subnet, '255.255.0.0')
          // IP value from IP4.ADDRESS line
          assert.equal(ret.IP, '10.0.0.5')
          done()
        } catch (e) {
          done(e)
        }
      })
    })
  })
})
