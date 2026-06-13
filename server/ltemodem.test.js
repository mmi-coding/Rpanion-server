const assert = require('assert')
const fs = require('fs')
const path = require('path')
const os = require('os')
const sinon = require('sinon')
const settings = require('settings-store')
const LTEModem = require('./ltemodem')
const serialDetection = require('./serialDetection.js')
const { FakeBin } = require('../test/fakeBin')
const { startFakeModem, startSilentPty } = require('../test/fakeModemPty')

describe('LTE Modem Functions', function () {
  it('#ltemodeminit()', function () {
    settings.clear()
    const modem = new LTEModem(settings)

    assert.equal(modem.options.enabled, false)
    assert.equal(modem.options.atPort, '/dev/ttyUSB2')
    assert.equal(modem.options.netInterface, 'usb0')
    const status = modem.getStatus()
    assert.equal(status.available, false)
    assert.equal(status.enabled, false)
    assert.equal(status.usage.totalRx, 0)
  })

  it('#parseCSQ()', function () {
    assert.deepEqual(LTEModem.parseCSQ(['+CSQ: 18,99', 'OK']),
      { raw: 18, dbm: -77, percent: 58 })
    assert.deepEqual(LTEModem.parseCSQ(['+CSQ: 31,0', 'OK']),
      { raw: 31, dbm: -51, percent: 100 })
    // 99 = unknown
    assert.deepEqual(LTEModem.parseCSQ(['+CSQ: 99,99', 'OK']),
      { raw: 99, dbm: null, percent: 0 })
    // no CSQ line at all
    assert.equal(LTEModem.parseCSQ(['ERROR']), null)
  })

  it('#parseCREG()', function () {
    let reg = LTEModem.parseCREG(['+CREG: 0,1', 'OK'])
    assert.equal(reg.registered, true)
    assert.equal(reg.roaming, false)
    assert.equal(reg.text, 'Registered (home)')

    reg = LTEModem.parseCREG(['+CREG: 0,5', 'OK'])
    assert.equal(reg.registered, true)
    assert.equal(reg.roaming, true)

    reg = LTEModem.parseCREG(['+CREG: 0,3', 'OK'])
    assert.equal(reg.registered, false)
    assert.equal(reg.text, 'Registration denied')

    // CGREG/CEREG variants parse too
    reg = LTEModem.parseCREG(['+CEREG: 0,1', 'OK'])
    assert.equal(reg.registered, true)

    // out-of-table states fall back to Unknown
    reg = LTEModem.parseCREG(['+CREG: 0,7', 'OK'])
    assert.equal(reg.text, 'Unknown')
    assert.equal(reg.registered, false)

    assert.equal(LTEModem.parseCREG(['OK']), null)
  })

  it('#parseCOPS()', function () {
    let cops = LTEModem.parseCOPS(['+COPS: 0,0,"Vodafone",7', 'OK'])
    assert.equal(cops.operator, 'Vodafone')
    assert.equal(cops.act, 'LTE')

    // no network: +COPS: 0 only
    cops = LTEModem.parseCOPS(['+COPS: 0', 'OK'])
    assert.equal(cops.operator, '')
    assert.equal(cops.act, '')

    // an AcT value outside the table maps to an empty string
    cops = LTEModem.parseCOPS(['+COPS: 0,0,"TestTel",8', 'OK'])
    assert.equal(cops.operator, 'TestTel')
    assert.equal(cops.act, '')

    assert.equal(LTEModem.parseCOPS(['ERROR']), null)
  })

  it('#parseCPSI()', function () {
    const cpsi = LTEModem.parseCPSI(
      ['+CPSI: LTE,Online,505-01,0x5A1E,187214780,257,EUTRAN-BAND3,1850,5,5,-94,-850,-545,15', 'OK'])
    assert.equal(cpsi.rat, 'LTE')
    assert.equal(cpsi.online, true)
    assert.equal(cpsi.mccmnc, '505-01')
    assert.equal(cpsi.band, 'EUTRAN-BAND3')
    assert.equal(cpsi.rsrp, -85)
    assert.equal(cpsi.sinr, 15)

    const noService = LTEModem.parseCPSI(['+CPSI: NO SERVICE,Online', 'OK'])
    assert.equal(noService.online, false)
    assert.equal(noService.rat, 'NO SERVICE')

    // whitespace-only payload -> empty system mode
    const blank = LTEModem.parseCPSI(['+CPSI:  ', 'OK'])
    assert.equal(blank.rat, '')
    assert.equal(blank.online, false)

    // short LTE line: no MCC-MNC, band or signal fields
    const short = LTEModem.parseCPSI(['+CPSI: LTE,Online', 'OK'])
    assert.equal(short.online, true)
    assert.equal(short.mccmnc, '')
    assert.equal(short.band, '')
    assert.equal(short.rsrp, undefined)

    assert.equal(LTEModem.parseCPSI(['OK']), null)
  })

  it('#parseCGPADDR()', function () {
    assert.equal(LTEModem.parseCGPADDR(['+CGPADDR: 1,10.123.45.67', 'OK']), '10.123.45.67')
    assert.equal(LTEModem.parseCGPADDR(['+CGPADDR: 1,"10.123.45.67"', 'OK']), '10.123.45.67')
    // no address assigned
    assert.equal(LTEModem.parseCGPADDR(['+CGPADDR: 1,0.0.0.0', 'OK']), null)
    assert.equal(LTEModem.parseCGPADDR(['OK']), null)
  })

  it('#parsePIN()', function () {
    assert.deepEqual(LTEModem.parsePIN(['+CPIN: READY', 'OK']),
      { ready: true, text: 'READY' })
    assert.deepEqual(LTEModem.parsePIN(['+CPIN: SIM PIN', 'OK']),
      { ready: false, text: 'SIM PIN' })
    assert.deepEqual(LTEModem.parsePIN(['+CME ERROR: SIM not inserted']),
      { ready: false, text: 'SIM not inserted' })
    assert.equal(LTEModem.parsePIN(['OK']), null)
  })

  it('#parseIdentLine()', function () {
    assert.equal(LTEModem.parseIdentLine(['SIMCOM_SIM7600G-H', 'OK']), 'SIMCOM_SIM7600G-H')
    // echo or URC lines are skipped
    assert.equal(LTEModem.parseIdentLine(['AT+CGMM', 'SIMCOM_SIM7600G-H', 'OK']), 'SIMCOM_SIM7600G-H')
    assert.equal(LTEModem.parseIdentLine(['+SOMEURC: 1', 'OK']), '')
    assert.equal(LTEModem.parseIdentLine(['OK']), '')
    assert.equal(LTEModem.parseIdentLine(null), '')
  })

  it('#isModemNetDriver()', function () {
    assert.equal(LTEModem.isModemNetDriver('rndis_host'), true)
    assert.equal(LTEModem.isModemNetDriver('cdc_ether'), true)
    assert.equal(LTEModem.isModemNetDriver('qmi_wwan'), true)
    assert.equal(LTEModem.isModemNetDriver('hv_netvsc'), false)
    assert.equal(LTEModem.isModemNetDriver(''), false)
  })

  it('#buildProbeCandidates()', function () {
    const detected = [
      { path: '/dev/ttyUSB0' },
      { path: '/dev/ttyUSB2' },
      { path: '/dev/ttyACM0' },
      { path: '/dev/serial0' },
      { path: '/dev/ttyUSB2' } // duplicate
    ]
    const candidates = LTEModem.buildProbeCandidates(detected, '/dev/ttyUSB2', ['/dev/ttyACM0'])

    // deduplicated, configured port already covered
    assert.equal(candidates.length, 4)

    // USB CDC ports get a single baud attempt, real UARTs the full list
    const usb = candidates.find(c => c.path === '/dev/ttyUSB0')
    assert.deepEqual(usb.bauds, [115200])
    const uart = candidates.find(c => c.path === '/dev/serial0')
    assert.ok(uart.bauds.length > 1)
    assert.ok(uart.bauds.includes(115200))

    // the FC's port is listed but skipped, never probed
    const fc = candidates.find(c => c.path === '/dev/ttyACM0')
    assert.equal(fc.skipped, true)
    assert.equal(fc.bauds, undefined)

    // the configured port is appended when detection misses it (e.g. a pty)
    const extra = LTEModem.buildProbeCandidates([], '/dev/pts/9', [])
    assert.equal(extra.length, 1)
    assert.equal(extra[0].path, '/dev/pts/9')
  })

  it('#testConnectionAllPass()', async function () {
    settings.clear()
    const modem = new LTEModem(settings)
    modem.options.netInterface = 'usb0'

    // stub the seams: AT session, interface listing, ping
    modem.portOpen = true
    const fixtures = {
      AT: ['OK'],
      'AT+CGMM': ['SIMCOM_SIM7600G-H', 'OK'],
      'AT+CPIN?': ['+CPIN: READY', 'OK'],
      'AT+CSQ': ['+CSQ: 20,99', 'OK'],
      'AT+CREG?': ['+CREG: 0,1', 'OK'],
      'AT+COPS?': ['+COPS: 0,0,"TestTel",7', 'OK'],
      'AT+CGPADDR=1': ['+CGPADDR: 1,10.0.0.5', 'OK']
    }
    modem.sendAT = async (cmd) => fixtures[cmd] || ['OK']
    modem.listNetInterfaces = () => [
      { name: 'usb0', driver: 'rndis_host', modemLike: true, operstate: 'up', ipv4: '192.168.225.30' }
    ]
    modem._ping = async () => ({ ok: true, detail: 'rtt 45.2/50.1/55.0 ms' })

    const steps = await modem.testConnection()
    assert.equal(steps.length, 8)
    for (const step of steps) {
      assert.equal(step.pass, true, step.name + ': ' + step.detail)
    }
    assert.ok(steps.find(s => s.name === 'Modem model').detail.includes('SIM7600'))
    assert.ok(steps.find(s => s.name === 'Network registration').detail.includes('TestTel'))
    assert.ok(steps.find(s => s.name === 'Network interface').detail.includes('192.168.225.30'))
  })

  it('#testConnectionFailures()', async function () {
    settings.clear()
    const modem = new LTEModem(settings)
    modem.options.netInterface = 'usb0'

    // SIM missing, not registered, no PDP address, no RNDIS interface
    modem.portOpen = true
    const fixtures = {
      AT: ['OK'],
      'AT+CGMM': ['SIMCOM_SIM7600G-H', 'OK'],
      'AT+CPIN?': ['+CME ERROR: SIM not inserted'],
      'AT+CSQ': ['+CSQ: 99,99', 'OK'],
      'AT+CREG?': ['+CREG: 0,0', 'OK'],
      'AT+COPS?': ['+COPS: 0', 'OK'],
      'AT+CGPADDR=1': ['+CGPADDR: 1,0.0.0.0', 'OK']
    }
    modem.sendAT = async (cmd) => fixtures[cmd] || ['OK']
    modem.listNetInterfaces = () => []
    modem._ping = async () => { throw new Error('must not ping without an interface') }

    const steps = await modem.testConnection()
    const byName = {}
    for (const step of steps) {
      byName[step.name] = step
    }
    assert.equal(byName['AT port'].pass, true)
    assert.equal(byName['SIM card'].pass, false)
    assert.equal(byName['SIM card'].detail, 'SIM not inserted')
    assert.equal(byName.Signal.pass, false)
    assert.equal(byName['Network registration'].pass, false)
    assert.equal(byName['Data call (PDP address)'].pass, false)
    assert.equal(byName['Network interface'].pass, false)
    // the hint mentions both failure modes (USB mode / UART-only)
    assert.ok(byName['Network interface'].detail.includes('CUSBPIDSWITCH'))
    assert.ok(byName['Network interface'].detail.includes('UART'))
    // ping is skipped, not failed
    assert.equal(byName['Internet (ping 8.8.8.8)'].pass, null)
  })

  it('#testConnectionPortUnavailable()', async function () {
    settings.clear()
    const modem = new LTEModem(settings)
    modem.options.atPort = '/dev/ttyNONEXISTENT99'
    modem.listNetInterfaces = () => []

    const steps = await modem.testConnection()
    assert.equal(steps[0].name, 'AT port')
    assert.equal(steps[0].pass, false)
    // the AT-dependent steps are skipped, not failed
    const sim = steps.find(s => s.name === 'SIM card')
    assert.equal(sim.pass, null)
    // port not left half-open
    assert.equal(modem.portOpen, false)
  })

  it('#sendATResolvesOnOK()', function (done) {
    settings.clear()
    const modem = new LTEModem(settings)

    // mock serial port: echo canned responses on write
    modem.portOpen = true
    modem.port = {
      write: () => {
        setImmediate(() => {
          modem._onLine('')
          modem._onLine('+CSQ: 20,99')
          modem._onLine('OK')
        })
      }
    }

    modem.sendAT('AT+CSQ').then((lines) => {
      assert.deepEqual(lines, ['+CSQ: 20,99', 'OK'])
      done()
    }).catch(done)
  })

  it('#sendATResolvesOnERROR()', function (done) {
    settings.clear()
    const modem = new LTEModem(settings)

    modem.portOpen = true
    modem.port = {
      write: () => {
        setImmediate(() => modem._onLine('+CME ERROR: SIM not inserted'))
      }
    }

    modem.sendAT('AT+CPIN?').then((lines) => {
      assert.equal(lines.length, 1)
      assert.ok(lines[0].includes('CME ERROR'))
      done()
    }).catch(done)
  })

  it('#sendATTimeout()', function (done) {
    settings.clear()
    const modem = new LTEModem(settings)

    modem.portOpen = true
    modem.port = { write: () => {} } // never responds

    modem.sendAT('AT', 100).then(() => {
      done(new Error('should have timed out'))
    }).catch((err) => {
      assert.ok(err.message.includes('AT timeout'))
      done()
    })
  })

  it('#sendATQueued()', function (done) {
    settings.clear()
    const modem = new LTEModem(settings)

    // each write responds to the matching command - out-of-order
    // responses would break the collector if commands weren't queued
    let writes = 0
    modem.portOpen = true
    modem.port = {
      write: (data) => {
        writes += 1
        const n = writes
        setImmediate(() => {
          modem._onLine('RESPONSE' + n)
          modem._onLine('OK')
        })
      }
    }

    const results = []
    modem.sendAT('AT+FIRST').then((lines) => results.push(lines[0]))
    modem.sendAT('AT+SECOND').then((lines) => {
      results.push(lines[0])
      assert.deepEqual(results, ['RESPONSE1', 'RESPONSE2'])
      done()
    }).catch(done)
  })

  it('#usageAccumulation()', function () {
    settings.clear()
    const modem = new LTEModem(settings)

    // fake /sys/class/net tree
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'ltemodem-test-'))
    const statsDir = path.join(tmpBase, 'usb0', 'statistics')
    fs.mkdirSync(statsDir, { recursive: true })
    const setStats = (rx, tx) => {
      fs.writeFileSync(path.join(statsDir, 'rx_bytes'), rx.toString())
      fs.writeFileSync(path.join(statsDir, 'tx_bytes'), tx.toString())
    }
    modem.netStatsBase = tmpBase

    // first read just sets the baseline
    setStats(1000, 500)
    modem.updateUsage()
    assert.equal(modem.usage.totalRx, 0)

    setStats(3000, 1500)
    modem.updateUsage()
    assert.equal(modem.usage.totalRx, 2000)
    assert.equal(modem.usage.totalTx, 1000)
    assert.equal(modem.usage.sessionRx, 2000)

    // counter reset (reboot/replug): count from zero, don't go negative
    setStats(400, 200)
    modem.updateUsage()
    assert.equal(modem.usage.totalRx, 2400)
    assert.equal(modem.usage.totalTx, 1200)

    // totals persist across a reload, session resets
    const modem2 = new LTEModem(settings)
    assert.equal(modem2.usage.totalRx, 2400)
    assert.equal(modem2.usage.sessionRx, 0)

    // reset clears both
    modem.resetUsage()
    assert.equal(modem.usage.totalRx, 0)
    assert.equal(settings.value('ltemodem.usageTotalRx', -1), 0)

    fs.rmSync(tmpBase, { recursive: true, force: true })
  })

  it('#usageMissingInterface()', function () {
    settings.clear()
    const modem = new LTEModem(settings)
    modem.netStatsBase = '/nonexistent'

    // must not throw or change counters
    modem.updateUsage()
    assert.equal(modem.usage.totalRx, 0)
  })

  it('#setSettingsValidation()', function (done) {
    settings.clear()
    const modem = new LTEModem(settings)

    modem.setSettings({ baud: 1234 }, (err) => {
      assert.notEqual(err, null)
      assert.ok(err.message.includes('baud'))

      modem.setSettings({ pollInterval: 1 }, (err2) => {
        assert.notEqual(err2, null)

        modem.setSettings({ netInterface: 'bad/iface' }, (err3) => {
          assert.notEqual(err3, null)

          modem.setSettings({ apn: 'bad apn with spaces;' }, (err4) => {
            assert.notEqual(err4, null)

            // valid settings save and persist
            modem.setSettings({ apn: 'telstra.internet', pollInterval: 10, autoReconnect: true }, (err5) => {
              assert.equal(err5, null)
              assert.equal(modem.options.apn, 'telstra.internet')
              assert.equal(settings.value('ltemodem.pollInterval', 0), 10)
              assert.equal(settings.value('ltemodem.autoReconnect', false), true)
              // not enabled - no monitor started
              assert.equal(modem.pollTimer, null)
              done()
            })
          })
        })
      })
    })
  })

  it('#sendUserCommandGuards()', function (done) {
    settings.clear()
    const modem = new LTEModem(settings)

    // non-AT commands are rejected
    modem.sendUserCommand('rm -rf /', (err) => {
      assert.notEqual(err, null)

      // AT command with the port closed is rejected
      modem.sendUserCommand('AT+CSQ', (err2) => {
        assert.notEqual(err2, null)
        assert.ok(err2.message.includes('not open'))
        done()
      })
    })
  })

  it('#enableWithMissingPort()', function (done) {
    settings.clear()
    const modem = new LTEModem(settings)

    // enabling with a port that doesn't exist must not crash -
    // status reports the error and the monitor keeps retrying
    modem.setSettings({ enabled: true, atPort: '/dev/ttyNONEXISTENT99' }, (err) => {
      assert.equal(err, null)
      setTimeout(() => {
        const status = modem.getStatus()
        assert.equal(status.available, false)
        assert.ok(status.error.length > 0)
        modem.setSettings({ enabled: false }, () => {
          assert.equal(modem.pollTimer, null)
          done()
        })
      }, 300)
    })
  }).timeout(5000)

  it('#monitorTimerRefires()', function () {
    settings.clear()
    const modem = new LTEModem(settings)
    const clock = sinon.useFakeTimers()
    try {
      let polls = 0
      modem.doPoll = () => { polls += 1 }
      modem.options.pollInterval = 2
      modem.startMonitor()
      assert.equal(polls, 1) // immediate first poll
      clock.tick(2000)
      assert.equal(polls, 2) // interval fired
      modem.stopMonitor()
      clock.tick(5000)
      assert.equal(polls, 2) // timer really stopped
    } finally {
      clock.restore()
    }
  })

  it('#doPollRichStatus()', async function () {
    settings.clear()
    const modem = new LTEModem(settings)
    modem.netStatsBase = '/nonexistent'
    modem.portOpen = true
    modem.port = {}
    const fixtures = {
      'AT+CSQ': ['+CSQ: 20,99', 'OK'],
      'AT+CREG?': ['+CREG: 0,5', 'OK'],
      'AT+COPS?': ['+COPS: 0,0,"TestTel",7', 'OK'],
      'AT+CPSI?': ['+CPSI: LTE,Online,505-01,0x5A1E,187214780,257,EUTRAN-BAND3,1850,5,5,-94,-850,-545,15', 'OK'],
      'AT+CGPADDR=1': ['+CGPADDR: 1,10.0.0.7', 'OK']
    }
    modem.sendAT = async (cmd) => fixtures[cmd] || ['OK']

    await modem.doPoll()
    assert.equal(modem.status.available, true)
    assert.equal(modem.status.error, '')
    assert.equal(modem.status.signal.dbm, -73)
    assert.equal(modem.status.signal.rsrp, -85)
    assert.equal(modem.status.registration, 'Registered (roaming)')
    assert.equal(modem.status.operator, 'TestTel')
    assert.equal(modem.status.rat, 'LTE')
    assert.equal(modem.status.band, 'EUTRAN-BAND3')
    assert.equal(modem.status.ip, '10.0.0.7')
    assert.notEqual(modem.status.lastUpdate, null)
  })

  it('#doPollSparseResponses()', async function () {
    // every parser comes back empty - existing status must not be clobbered
    settings.clear()
    const modem = new LTEModem(settings)
    modem.netStatsBase = '/nonexistent'
    modem.portOpen = true
    modem.port = {}
    modem.status.rat = 'LTE' // CPSI with an empty system mode keeps the old one
    const fixtures = {
      'AT+CSQ': ['ERROR'],
      'AT+CREG?': ['ERROR'],
      'AT+COPS?': ['ERROR'],
      'AT+CPSI?': ['+CPSI: ,Online,505-01', 'OK'],
      'AT+CGPADDR=1': ['OK']
    }
    modem.sendAT = async (cmd) => fixtures[cmd] || ['OK']

    await modem.doPoll()
    assert.equal(modem.status.available, true)
    assert.equal(modem.status.rat, 'LTE')
    assert.equal(modem.status.ip, '')
    assert.equal(modem.status.signal.raw, 99) // untouched default
  })

  it('#doPollAutoReconnect()', async function () {
    settings.clear()
    const modem = new LTEModem(settings)
    modem.netStatsBase = '/nonexistent'
    modem.portOpen = true
    modem.port = {}
    modem.options.autoReconnect = true
    modem.options.apn = 'drone.apn'
    const sent = []
    const fixtures = {
      'AT+CSQ': ['+CSQ: 15,99', 'OK'],
      'AT+CREG?': ['+CREG: 0,1', 'OK'],
      'AT+COPS?': ['+COPS: 0', 'OK'], // operator known but unnamed - act stays
      'AT+CPSI?': ['ERROR'],
      'AT+CGPADDR=1': ['+CGPADDR: 1,0.0.0.0', 'OK'], // no data address
      'AT$QCRMCALL=1,1': ['$QCRMCALL: 1,V4', 'OK']
    }
    modem.sendAT = async (cmd) => {
      sent.push(cmd)
      return fixtures[cmd] || ['OK']
    }

    // registered + no IP + no recent attempt -> reconnects with the APN
    await modem.doPoll()
    assert.ok(sent.includes('AT+CGDCONT=1,"IP","drone.apn"'))
    assert.ok(sent.includes('AT$QCRMCALL=1,1'))
    assert.equal(modem.status.reconnectCount, 1)
    assert.notEqual(modem.status.lastReconnect, null)

    // 30s holdoff - no second attempt
    await modem.doPoll()
    assert.equal(modem.status.reconnectCount, 1)

    // not registered -> no attempt even after the holdoff
    fixtures['AT+CREG?'] = ['+CREG: 0,0', 'OK']
    modem.lastReconnectAttempt = 0
    await modem.doPoll()
    assert.equal(modem.status.reconnectCount, 1)

    // registered with a data address -> nothing to fix
    fixtures['AT+CREG?'] = ['+CREG: 0,1', 'OK']
    fixtures['AT+CGPADDR=1'] = ['+CGPADDR: 1,10.0.0.9', 'OK']
    modem.lastReconnectAttempt = 0
    await modem.doPoll()
    assert.equal(modem.status.reconnectCount, 1)
  })

  it('#reconnectWithoutAPN()', async function () {
    settings.clear()
    const modem = new LTEModem(settings)
    modem.portOpen = true
    const sent = []
    modem.sendAT = async (cmd) => {
      sent.push(cmd)
      return ['OK']
    }

    await modem.reconnect()
    // no APN configured - the CGDCONT step is skipped
    assert.deepEqual(sent, ['AT$QCRMCALL=1,1'])
    assert.equal(modem.status.reconnectCount, 1)
  })

  it('#doPollATTimeoutReopensPort()', async function () {
    settings.clear()
    const modem = new LTEModem(settings)
    modem.netStatsBase = '/nonexistent'
    let closed = false
    modem.portOpen = true
    modem.port = { close: () => { closed = true } }
    modem.sendAT = async () => { throw new Error('AT timeout: AT+CSQ') }

    await modem.doPoll()
    assert.equal(modem.status.available, false)
    assert.ok(modem.status.error.includes('AT timeout'))
    // a dead port is force-closed so the next poll reopens it
    assert.equal(closed, true)
    assert.equal(modem.portOpen, false)
  })

  it('#doPollOtherErrorKeepsPort()', async function () {
    settings.clear()
    const modem = new LTEModem(settings)
    modem.netStatsBase = '/nonexistent'
    modem.portOpen = true
    modem.port = { close: () => { throw new Error('must not close') } }
    modem.sendAT = async () => { throw new Error('modem rebooted') }

    await modem.doPoll()
    assert.equal(modem.status.available, false)
    assert.equal(modem.status.error, 'modem rebooted')
    assert.equal(modem.portOpen, true)
  })

  it('#doPollSkippedWhileBusy()', async function () {
    settings.clear()
    const modem = new LTEModem(settings)
    modem.netStatsBase = '/nonexistent'
    let calls = 0
    modem.portOpen = true
    modem.sendAT = async () => {
      calls += 1
      return ['OK']
    }

    modem.polling = true
    await modem.doPoll()
    modem.polling = false
    modem.scanning = true
    await modem.doPoll()
    assert.equal(calls, 0)
  })

  it('#closePortSwallowsCloseErrors()', function () {
    settings.clear()
    const modem = new LTEModem(settings)
    modem.portOpen = true
    modem.port = { close: () => { throw new Error('EBADF') } }

    modem.closePort() // must not throw
    assert.equal(modem.portOpen, false)
    assert.equal(modem.port, null)
    modem.closePort() // idempotent with the port already gone
  })

  it('#sendATPortClosed()', async function () {
    settings.clear()
    const modem = new LTEModem(settings)
    await assert.rejects(modem.sendAT('AT'), /AT port not open/)
  })

  it('#sendATTerminators()', async function () {
    settings.clear()
    const modem = new LTEModem(settings)
    modem.portOpen = true
    let reply = []
    modem.port = {
      write: () => {
        setImmediate(() => {
          for (const l of reply) {
            modem._onLine(l)
          }
        })
      }
    }

    reply = ['ERROR']
    assert.deepEqual(await modem.sendAT('AT+BAD'), ['ERROR'])
    reply = ['+CMS ERROR: memory full']
    assert.deepEqual(await modem.sendAT('AT+CMGS'), ['+CMS ERROR: memory full'])
  })

  it('#readNetStatsGarbage()', function () {
    settings.clear()
    const modem = new LTEModem(settings)
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'ltemodem-garbage-'))
    const statsDir = path.join(tmpBase, 'usb0', 'statistics')
    fs.mkdirSync(statsDir, { recursive: true })
    const setStats = (rx, tx) => {
      fs.writeFileSync(path.join(statsDir, 'rx_bytes'), rx.toString())
      fs.writeFileSync(path.join(statsDir, 'tx_bytes'), tx.toString())
    }
    modem.netStatsBase = tmpBase

    // unparseable counters are treated as missing
    setStats('garbage', 123)
    assert.equal(modem.readNetStats(), null)
    setStats(123, 'garbage')
    assert.equal(modem.readNetStats(), null)

    // a reset on only one direction still counts from zero
    setStats(1000, 500)
    modem.updateUsage() // baseline
    setStats(2000, 200) // tx went backwards
    modem.updateUsage()
    assert.equal(modem.usage.totalRx, 2000)
    assert.equal(modem.usage.totalTx, 200)

    fs.rmSync(tmpBase, { recursive: true, force: true })
  })

  it('#listNetInterfacesReal()', function () {
    settings.clear()
    const modem = new LTEModem(settings)

    // fake /sys/class/net: lo (skipped), a modem-like usb0, a bare veth0
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'ltemodem-net-'))
    fs.mkdirSync(path.join(tmpBase, 'lo'))
    fs.mkdirSync(path.join(tmpBase, 'usb0', 'device'), { recursive: true })
    fs.symlinkSync('/sys/bus/usb/drivers/rndis_host', path.join(tmpBase, 'usb0', 'device', 'driver'))
    fs.writeFileSync(path.join(tmpBase, 'usb0', 'operstate'), 'up\n')
    fs.mkdirSync(path.join(tmpBase, 'veth0')) // no driver link, no operstate
    fs.mkdirSync(path.join(tmpBase, 'dummy0')) // no addresses at all
    modem.netStatsBase = tmpBase
    modem._netIfaces = () => ({
      usb0: [{ family: 'IPv6', address: 'fe80::1' }, { family: 'IPv4', address: '192.168.225.30' }],
      veth0: [{ family: 4, address: '10.0.0.2' }] // older node reports numeric families
    })

    const out = modem.listNetInterfaces()
    assert.equal(out.find(i => i.name === 'lo'), undefined)
    assert.deepEqual(out.find(i => i.name === 'usb0'),
      { name: 'usb0', driver: 'rndis_host', modemLike: true, operstate: 'up', ipv4: '192.168.225.30' })
    assert.deepEqual(out.find(i => i.name === 'veth0'),
      { name: 'veth0', driver: '', modemLike: false, operstate: '', ipv4: '10.0.0.2' })
    assert.equal(out.find(i => i.name === 'dummy0').ipv4, '')

    // unreadable base -> empty list
    modem.netStatsBase = '/nonexistent'
    assert.deepEqual(modem.listNetInterfaces(), [])

    fs.rmSync(tmpBase, { recursive: true, force: true })
  })

  it('#netIfacesReal()', function () {
    settings.clear()
    const modem = new LTEModem(settings)
    assert.equal(typeof modem._netIfaces(), 'object')
  })

  it('#getSerialPortsSeam()', async function () {
    settings.clear()
    const modem = new LTEModem(settings)
    const stub = sinon.stub(serialDetection, 'detectSerialDevices')
    try {
      stub.resolves([{ path: '/dev/ttyTEST0', value: 'x', label: 'x' }])
      let ports = await modem.getSerialPorts()
      assert.equal(ports.length, 1)
      // detection failures degrade to an empty list, never throw
      stub.rejects(new Error('udev exploded'))
      ports = await modem.getSerialPorts()
      assert.deepEqual(ports, [])
    } finally {
      stub.restore()
    }
  })

  it('#getSettingsCopies()', function () {
    settings.clear()
    const modem = new LTEModem(settings)
    const opts = modem.getSettings()
    assert.equal(opts.atPort, modem.options.atPort)
    opts.atPort = 'mutated'
    assert.notEqual(modem.options.atPort, 'mutated')
  })

  it('#setSettingsMoreValidation()', function (done) {
    settings.clear()
    const modem = new LTEModem(settings)

    modem.setSettings({ atPort: 'bad port !!' }, (err) => {
      assert.notEqual(err, null)
      assert.ok(err.message.includes('AT port'))

      modem.setSettings({ enabled: true, atPort: '' }, (err2) => {
        assert.notEqual(err2, null)
        assert.ok(err2.message.includes('required'))

        modem.setSettings({ baud: 57600, netInterface: 'wwan0', pollInterval: 'abc' }, (err3) => {
          assert.notEqual(err3, null)
          assert.ok(err3.message.includes('Poll interval'))

          modem.setSettings({ baud: 57600, netInterface: 'wwan0' }, (err4) => {
            assert.equal(err4, null)
            assert.equal(modem.options.baud, 57600)
            assert.equal(modem.options.netInterface, 'wwan0')
            done()
          })
        })
      })
    })
  })

  it('#sendUserCommandPaths()', function (done) {
    settings.clear()
    const modem = new LTEModem(settings)

    // non-string and over-length commands are rejected up front
    modem.sendUserCommand(null, (err) => {
      assert.notEqual(err, null)

      modem.sendUserCommand('AT+' + 'X'.repeat(130), (err2) => {
        assert.notEqual(err2, null)

        modem.portOpen = true
        modem.sendAT = async () => ['+CSQ: 20,99', 'OK']
        modem.sendUserCommand('at+csq', (err3, lines) => {
          assert.equal(err3, null)
          assert.equal(lines[1], 'OK')

          modem.sendAT = async () => { throw new Error('AT timeout: AT+BAD') }
          modem.sendUserCommand('AT+BAD', (err4, lines4) => {
            assert.notEqual(err4, null)
            assert.equal(lines4, null)
            done()
          })
        })
      })
    })
  })

  it('#testConnectionModemAnswersError()', async function () {
    settings.clear()
    const modem = new LTEModem(settings)
    modem.portOpen = true
    modem.sendAT = async () => ['ERROR']
    modem.listNetInterfaces = () => []

    const steps = await modem.testConnection()
    const at = steps.find(s => s.name === 'AT port')
    assert.equal(at.pass, false)
    assert.ok(at.detail.includes('modem answered ERROR'))
    assert.equal(steps.find(s => s.name === 'SIM card').pass, null)
  })

  it('#testConnectionHandshakeThrows()', async function () {
    settings.clear()
    const modem = new LTEModem(settings)
    modem.portOpen = true
    modem.sendAT = async () => { throw new Error('AT timeout: AT') }
    modem.listNetInterfaces = () => []

    const steps = await modem.testConnection()
    const at = steps.find(s => s.name === 'AT port')
    assert.equal(at.pass, false)
    assert.ok(at.detail.includes('AT timeout'))
    assert.equal(steps.find(s => s.name === 'SIM card').pass, null)
  })

  it('#testConnectionStepErrors()', async function () {
    // handshake fine, every later AT query dies
    settings.clear()
    const modem = new LTEModem(settings)
    modem.portOpen = true
    modem.sendAT = async (cmd) => {
      if (cmd === 'AT') {
        return ['OK']
      }
      throw new Error('AT timeout: ' + cmd)
    }
    modem.listNetInterfaces = () => []

    const steps = await modem.testConnection()
    const byName = {}
    steps.forEach(s => { byName[s.name] = s })
    assert.equal(byName['AT port'].pass, true)
    for (const name of ['Modem model', 'SIM card', 'Signal', 'Network registration', 'Data call (PDP address)']) {
      assert.equal(byName[name].pass, false)
      assert.ok(byName[name].detail.includes('AT timeout'))
    }
  })

  it('#testConnectionUnparseableReplies()', async function () {
    // modem says OK to everything - every parser returns null
    settings.clear()
    const modem = new LTEModem(settings)
    modem.portOpen = true
    modem.options.netInterface = 'usb0'
    modem.sendAT = async (cmd) => (cmd === 'AT+CSQ' ? ['ERROR'] : ['OK'])
    modem.listNetInterfaces = () => [
      { name: 'usb0', driver: 'rndis_host', modemLike: true, operstate: 'up', ipv4: '10.1.1.2' }
    ]
    modem._ping = async () => ({ ok: false, detail: 'unreachable (no output)' })

    const steps = await modem.testConnection()
    const byName = {}
    steps.forEach(s => { byName[s.name] = s })
    assert.equal(byName['Modem model'].pass, false)
    assert.equal(byName['Modem model'].detail, 'no model string')
    assert.equal(byName['SIM card'].pass, false)
    assert.equal(byName['SIM card'].detail, 'no response')
    assert.equal(byName.Signal.pass, false)
    assert.ok(byName['Network registration'].detail.includes('unknown'))
    assert.equal(byName['Data call (PDP address)'].pass, false)
    assert.ok(byName['Data call (PDP address)'].detail.includes('APN'))
    assert.equal(byName['Internet (ping 8.8.8.8)'].pass, false)
  })

  it('#testConnectionIfaceWithoutAddress()', async function () {
    settings.clear()
    const modem = new LTEModem(settings)
    modem.portOpen = true
    modem.options.netInterface = 'usb0'
    const fixtures = {
      AT: ['OK'],
      'AT+CGMM': ['SIMCOM_SIM7600G-H', 'OK'],
      'AT+CPIN?': ['+CPIN: READY', 'OK'],
      'AT+CSQ': ['+CSQ: 20,99', 'OK'],
      'AT+CREG?': ['+CREG: 0,1', 'OK'],
      'AT+COPS?': ['+COPS: 0,0,"TestTel",7', 'OK'],
      'AT+CGPADDR=1': ['+CGPADDR: 1,10.0.0.5', 'OK']
    }
    modem.sendAT = async (cmd) => fixtures[cmd] || ['OK']
    modem._ping = async () => { throw new Error('must not ping a dead interface') }

    // interface exists but never got an address (driver unknown)
    modem.listNetInterfaces = () => [
      { name: 'usb0', driver: '', modemLike: true, operstate: 'down', ipv4: '' }
    ]
    let steps = await modem.testConnection()
    let iface = steps.find(s => s.name === 'Network interface')
    assert.equal(iface.pass, false)
    assert.ok(iface.detail.includes('no IPv4'))
    assert.ok(iface.detail.includes('unknown driver'))
    assert.equal(steps.find(s => s.name.startsWith('Internet')).pass, null)

    // same failure with a known driver
    modem.listNetInterfaces = () => [
      { name: 'usb0', driver: 'rndis_host', modemLike: true, operstate: 'down', ipv4: '' }
    ]
    steps = await modem.testConnection()
    iface = steps.find(s => s.name === 'Network interface')
    assert.equal(iface.pass, false)
    assert.ok(iface.detail.includes('rndis_host'))
  })

  describe('modem discovery orchestration', function () {
    it('#detectModemScanGuard()', async function () {
      settings.clear()
      const modem = new LTEModem(settings)
      modem.scanning = true
      await assert.rejects(modem.detectModem(), /already running/)
    })

    it('#detectModemRecommends()', async function () {
      settings.clear()
      const modem = new LTEModem(settings)
      modem.options.atPort = '/dev/ttyUSB1'

      // run 1: FC port excluded, SIMCOM hit preferred over another modem
      settings.setValue('flightcontroller.activeDevice', { serial: 'usb-FC_Pixhawk-if00' })
      modem.getSerialPorts = async () => [
        { path: '/dev/ttyUSB0', value: 'usb-Quectel-if00' },
        { path: '/dev/ttyUSB1', value: 'usb-SimTech-if02' },
        { path: '/dev/ttyACM0', value: 'usb-FC_Pixhawk-if00' }
      ]
      const probeResults = {
        '/dev/ttyUSB0': { path: '/dev/ttyUSB0', baud: 115200, ok: true, model: 'EC25', manufacturer: 'Quectel' },
        '/dev/ttyUSB1': { path: '/dev/ttyUSB1', baud: 115200, ok: true, model: 'SIMCOM_SIM7600G-H', manufacturer: 'SIMCOM' }
      }
      modem.probePort = async (c) => probeResults[c.path]
      modem.listNetInterfaces = () => [
        { name: 'eth0', driver: 'r8169', modemLike: false },
        { name: 'usb0', driver: 'rndis_host', modemLike: true }
      ]
      let res = await modem.detectModem()
      assert.equal(res.ports.length, 3)
      const fc = res.ports.find(p => p.path === '/dev/ttyACM0')
      assert.equal(fc.skipped, true)
      assert.ok(fc.reason.includes('flight controller'))
      assert.equal(res.ports.find(p => p.path === '/dev/ttyUSB1').recommended, true)
      assert.equal(res.ports.find(p => p.path === '/dev/ttyUSB0').recommended, undefined)
      assert.equal(res.interfaces.find(i => i.name === 'usb0').recommended, true)
      assert.equal(res.interfaces.find(i => i.name === 'eth0').recommended, undefined)
      assert.equal(modem.scanning, false)

      // run 2: no FC configured, anonymous hits still get a recommendation
      settings.clear()
      modem.getSerialPorts = async () => [{ path: '/dev/ttyUSB0', value: 'x' }]
      modem.probePort = async (c) => ({ path: c.path, ok: true })
      modem.listNetInterfaces = () => []
      res = await modem.detectModem()
      assert.equal(res.ports.find(p => p.path === '/dev/ttyUSB0').recommended, true)
      assert.equal(res.interfaces.length, 0)

      // run 3: FC serial that maps to no detected path, and no hits at all
      settings.setValue('flightcontroller.activeDevice', { serial: 'usb-Gone-if00' })
      modem.probePort = async (c) => ({ path: c.path, ok: false })
      res = await modem.detectModem()
      assert.equal(res.ports.filter(p => p.ok).length, 0)
      assert.equal(res.ports.find(p => p.recommended), undefined)

      // run 4: an active FC device without a serial field is ignored
      settings.setValue('flightcontroller.activeDevice', { something: 1 })
      res = await modem.detectModem()
      assert.equal(res.ports.find(p => p.skipped), undefined)
    })
  })

  describe('interface ping (fake ping binary)', function () {
    let fake

    before(function () {
      fake = new FakeBin()
      fake.install('ping', `
case "$FAKE_SCENARIO" in
  rtt) echo "rtt min/avg/max/mdev = 45.1/50.0/55.2/3.1 ms" ;;
  plain) ;;
  loss) echo "2 packets transmitted, 0 received, 100% packet loss" >&2; exit 1 ;;
  silent) exit 1 ;;
esac`)
      fake.activate()
    })

    after(function () {
      delete process.env.FAKE_SCENARIO
      fake.cleanup()
    })

    it('#pingVariants()', async function () {
      settings.clear()
      const modem = new LTEModem(settings)

      process.env.FAKE_SCENARIO = 'rtt'
      let r = await modem._ping('usb0', '8.8.8.8')
      assert.deepEqual(r, { ok: true, detail: 'rtt 45.1/50.0/55.2/3.1 ms' })
      // the route-pinning arguments reached ping
      assert.ok(fake.calls('ping')[0].includes('-I usb0'))

      process.env.FAKE_SCENARIO = 'plain'
      r = await modem._ping('usb0', '8.8.8.8')
      assert.deepEqual(r, { ok: true, detail: 'reachable' })

      process.env.FAKE_SCENARIO = 'loss'
      r = await modem._ping('usb0', '8.8.8.8')
      assert.equal(r.ok, false)
      assert.ok(r.detail.includes('packet loss'))

      process.env.FAKE_SCENARIO = 'silent'
      r = await modem._ping('usb0', '8.8.8.8')
      assert.deepEqual(r, { ok: false, detail: 'unreachable (no output)' })
    })

    it('#pingSpawnFailure()', async function () {
      settings.clear()
      const modem = new LTEModem(settings)
      const oldPath = process.env.PATH
      try {
        process.env.PATH = '/nonexistent-bin'
        const r = await modem._ping('usb0', '8.8.8.8')
        assert.equal(r.ok, false)
        assert.ok(r.detail.includes('ENOENT'))
      } finally {
        process.env.PATH = oldPath
      }
    })
  })

  describe('data path modes (RNDIS / QMI / PPP)', function () {
    let fake

    before(function () {
      fake = new FakeBin()
      fake.install('qmicli', `
case "$FAKE_SCENARIO" in
qmi-fail) echo "qmicli error" >&2; exit 1 ;;
qmi-nohandle) echo "Network started" ;;
*) printf "Network started\\n\\tPacket data handle: '12345'\\n\\tCID: '7'\\n" ;;
esac
exit 0`)
      fake.install('udhcpc', 'exit 0')
      fake.install('ip', 'exit 0')
      fake.install('pppd', `
case "$FAKE_SCENARIO" in
ppp-fail) echo "pppd error" >&2; exit 1 ;;
esac
exit 0`)
      fake.install('poff', 'exit 0')
      // QMI/PPP commands run via sudo; the fake just passes through to the
      // faked underlying binary (qmicli/udhcpc/ip/pppd/poff) on PATH.
      fake.install('sudo', 'exec "$@"')
      fake.activate()
    })

    after(function () {
      delete process.env.FAKE_SCENARIO
      fake.cleanup()
    })

    afterEach(function () {
      delete process.env.FAKE_SCENARIO
      fake.reset()
      sinon.restore()
    })

    it('#_exec() resolves output and rejects with stderr', async function () {
      settings.clear()
      const modem = new LTEModem(settings)
      const out = await modem._exec('qmicli', ['-d', '/dev/cdc-wdm0'])
      assert.ok(out.includes('Network started'))
      process.env.FAKE_SCENARIO = 'qmi-fail'
      await assert.rejects(() => modem._exec('qmicli', []), /qmicli error/)
    })

    it('#_exec() rejects with the error message on spawn failure', async function () {
      settings.clear()
      const modem = new LTEModem(settings)
      const oldPath = process.env.PATH
      try {
        process.env.PATH = '/nonexistent-bin'
        await assert.rejects(() => modem._exec('qmicli', []), /ENOENT/)
      } finally {
        process.env.PATH = oldPath
      }
    })

    it('#connectData() dispatches by mode', async function () {
      settings.clear()
      const modem = new LTEModem(settings)
      const qmi = sinon.stub(modem, '_qmiConnect').resolves(['qmi'])
      const ppp = sinon.stub(modem, '_pppConnect').resolves(['ppp'])
      const rnd = sinon.stub(modem, 'reconnect').resolves(['rndis'])
      modem.options.dataPathMode = 'qmi'
      await modem.connectData()
      assert.ok(qmi.calledOnce)
      modem.options.dataPathMode = 'ppp'
      await modem.connectData()
      assert.ok(ppp.calledOnce)
      modem.options.dataPathMode = 'rndis'
      await modem.connectData()
      assert.ok(rnd.calledOnce)
    })

    it('#disconnectData() dispatches by mode', async function () {
      settings.clear()
      const modem = new LTEModem(settings)
      const qmi = sinon.stub(modem, '_qmiStop').resolves(['qmi'])
      const ppp = sinon.stub(modem, '_pppStop').resolves(['ppp'])
      const at = sinon.stub(modem, 'sendAT').resolves(['OK'])
      modem.options.dataPathMode = 'qmi'
      await modem.disconnectData()
      assert.ok(qmi.calledOnce)
      modem.options.dataPathMode = 'ppp'
      await modem.disconnectData()
      assert.ok(ppp.calledOnce)
      modem.options.dataPathMode = 'rndis'
      await modem.disconnectData()
      assert.ok(at.calledWith('AT$QCRMCALL=0,1', 15000))
    })

    it('#_qmiConnect() parses the handle and CID and runs DHCP', async function () {
      settings.clear()
      const modem = new LTEModem(settings)
      const r = await modem._qmiConnect()
      assert.deepEqual(r, ['QMI network started'])
      assert.equal(modem.qmiHandle, '12345')
      assert.equal(modem.qmiCid, '7')
      assert.ok(fake.calls('qmicli')[0].includes('--wds-start-network'))
      assert.ok(fake.calls('udhcpc').length >= 1)
    })

    it('#_qmiConnect() tolerates output without a handle/CID', async function () {
      settings.clear()
      const modem = new LTEModem(settings)
      process.env.FAKE_SCENARIO = 'qmi-nohandle'
      await modem._qmiConnect()
      assert.equal(modem.qmiHandle, null)
      assert.equal(modem.qmiCid, null)
    })

    it('#_qmiStop() stops the tracked network', async function () {
      settings.clear()
      const modem = new LTEModem(settings)
      modem.qmiHandle = '12345'
      modem.qmiCid = '7'
      await modem._qmiStop()
      assert.ok(fake.calls('qmicli')[0].includes('--wds-stop-network=12345'))
      assert.equal(modem.qmiHandle, null)
    })

    it('#_qmiStop() without a handle takes the interface down', async function () {
      settings.clear()
      const modem = new LTEModem(settings)
      await modem._qmiStop()
      assert.ok(fake.calls('ip')[0].includes('link'))
    })

    it('#_pppConnect() dials pppd on the modem port', async function () {
      settings.clear()
      const modem = new LTEModem(settings)
      modem.options.pppPort = '/dev/ttyUSB3'
      const r = await modem._pppConnect()
      assert.deepEqual(r, ['PPP started'])
      assert.ok(fake.calls('pppd')[0].includes('/dev/ttyUSB3'))
    })

    it('#_pppConnect() refuses to dial the flight controller port', async function () {
      settings.clear()
      settings.setValue('flightcontroller.activeDevice', { serial: '/dev/ttyUSB3' })
      const modem = new LTEModem(settings)
      modem.options.pppPort = '/dev/ttyUSB3'
      await assert.rejects(() => modem._pppConnect(), /flight controller/)
    })

    it('#_pppConnect() falls back to the AT port and allows a non-FC port', async function () {
      settings.clear()
      settings.setValue('flightcontroller.activeDevice', { serial: '/dev/ttyACM0' })
      const modem = new LTEModem(settings)
      // pppPort left empty → falls back to the AT port (/dev/ttyUSB2 default)
      const r = await modem._pppConnect()
      assert.deepEqual(r, ['PPP started'])
      assert.ok(fake.calls('pppd')[0].includes('/dev/ttyUSB2'))
    })

    it('#_pppStop() runs poff via sudo', async function () {
      settings.clear()
      const modem = new LTEModem(settings)
      await modem._pppStop()
      // poff takes no args (nothing logged to poff.calls), so assert via sudo
      assert.ok(fake.calls('sudo').some(c => c === 'poff'))
    })

    it('#setUsbMode() sends AT+CUSBPIDSWITCH', async function () {
      settings.clear()
      const modem = new LTEModem(settings)
      const at = sinon.stub(modem, 'sendAT').resolves(['OK'])
      await modem.setUsbMode('9011')
      assert.ok(at.calledWith('AT+CUSBPIDSWITCH=9011,1,1', 15000))
    })

    it('#setSettings() accepts the new data-path fields and persists them', function (done) {
      settings.clear()
      const modem = new LTEModem(settings)
      modem.setSettings({ enabled: false, dataPathMode: 'qmi', qmiDevice: '/dev/cdc-wdm0', pppPort: '/dev/ttyUSB3', pppBaud: 115200 }, (err) => {
        assert.equal(err, null)
        assert.equal(modem.options.dataPathMode, 'qmi')
        assert.equal(settings.value('ltemodem.qmiDevice'), '/dev/cdc-wdm0')
        assert.equal(settings.value('ltemodem.pppPort'), '/dev/ttyUSB3')
        done()
      })
    })

    it('#setSettings() rejects invalid data-path fields', function (done) {
      settings.clear()
      const modem = new LTEModem(settings)
      modem.setSettings({ dataPathMode: 'bogus', qmiDevice: 'bad dev!', pppPort: 'bad port!', pppBaud: 1234 }, (err) => {
        assert.ok(err)
        assert.ok(err.message.includes('Invalid data path mode'))
        assert.ok(err.message.includes('Invalid QMI device'))
        assert.ok(err.message.includes('Invalid PPP port'))
        assert.ok(err.message.includes('Invalid PPP baud'))
        done()
      })
    })
  })

  describe('live modem on a pty (fake-sim7600.py)', function () {
    let pty

    before(async function () {
      pty = await startFakeModem()
    })

    after(function () {
      pty.stop()
    })

    it('#monitorAutostartPolls()', async function () {
      settings.clear()
      settings.setValue('ltemodem.enabled', true)
      settings.setValue('ltemodem.atPort', pty.path)
      const modem = new LTEModem(settings) // enabled -> constructor starts the monitor

      try {
        await new Promise(resolve => setTimeout(resolve, 800))
        const st = modem.getStatus()
        assert.equal(st.available, true, 'status error: ' + st.error)
        assert.equal(st.signal.raw, 21)
        assert.equal(st.signal.rsrp, -85)
        assert.equal(st.registered, true)
        assert.equal(st.operator, 'TestTel')
        assert.equal(st.rat, 'LTE')
        assert.equal(st.band, 'EUTRAN-BAND3')
        assert.equal(st.ip, '10.64.12.34')
      } finally {
        modem.quitting()
      }
      assert.equal(modem.pollTimer, null)
      assert.equal(modem.portOpen, false)
    }).timeout(10000)

    it('#openPortLifecycle()', async function () {
      settings.clear()
      const modem = new LTEModem(settings)
      modem.options.atPort = pty.path

      const err = await new Promise(resolve => modem.openPort(resolve))
      assert.equal(err, null)
      assert.equal(modem.portOpen, true)

      // opening an already-open port is a no-op success
      const err2 = await new Promise(resolve => modem.openPort(resolve))
      assert.equal(err2, null)

      // a real AT round trip through SerialPort + ReadlineParser
      const lines = await modem.sendAT('AT+CGMM', 3000)
      assert.ok(lines.includes('SIMCOM_SIM7600G-H'))
      assert.ok(lines.includes('OK'))

      // port-level errors land in status.error
      modem.port.emit('error', new Error('fake glitch'))
      assert.ok(modem.status.error.includes('fake glitch'))

      modem.closePort()
      assert.equal(modem.portOpen, false)
      await new Promise(resolve => setTimeout(resolve, 100)) // let 'close' fire
    }).timeout(10000)

    it('#openPortInvalidOptions()', function (done) {
      settings.clear()
      const modem = new LTEModem(settings)
      modem.options.atPort = pty.path
      modem.options.baud = 'not-a-number' // SerialPort constructor throws
      modem.openPort((err) => {
        assert.notEqual(err, null)
        assert.equal(modem.portOpen, false)
        done()
      })
    })

    it('#probeIdentifiesModem()', async function () {
      settings.clear()
      const modem = new LTEModem(settings)

      const r = await modem.probeAttempt(pty.path, 115200)
      assert.equal(r.ok, true)
      assert.equal(r.model, 'SIMCOM_SIM7600G-H')
      assert.equal(r.manufacturer, 'SIMCOM INCORPORATED')

      // probePort reports the answering baud
      const viaPort = await modem.probePort({ path: pty.path, bauds: [115200] })
      assert.equal(viaPort.ok, true)
      assert.equal(viaPort.baud, 115200)

      // open failures and constructor failures resolve, never throw
      const bad = await modem.probeAttempt('/dev/ttyNONEXISTENT99', 115200)
      assert.equal(bad.ok, false)
      const badCtor = await modem.probeAttempt(pty.path, 'not-a-number')
      assert.equal(badCtor.ok, false)
      const badPort = await modem.probePort({ path: '/dev/ttyNONEXISTENT99', bauds: [115200, 9600] })
      assert.deepEqual(badPort, { path: '/dev/ttyNONEXISTENT99', ok: false })
    }).timeout(10000)

    it('#probeModemAnswersError()', async function () {
      // a device that answers ERROR to the handshake is not a usable modem
      settings.clear()
      const errModem = await startFakeModem({ FAKE_SIM7600_ERROR: '1' })
      try {
        const modem = new LTEModem(settings)
        const r = await modem.probeAttempt(errModem.path, 115200)
        assert.deepEqual(r, { ok: false, error: 'no response to AT' })
      } finally {
        errModem.stop()
      }
    }).timeout(10000)

    it('#testConnectionLivePort()', async function () {
      settings.clear()
      const modem = new LTEModem(settings)
      modem.options.atPort = pty.path
      modem.options.netInterface = 'usb0'
      modem.listNetInterfaces = () => [
        { name: 'usb0', driver: 'rndis_host', modemLike: true, operstate: 'up', ipv4: '192.168.225.30' }
      ]
      modem._ping = async () => ({ ok: true, detail: 'rtt 40.1 ms' })

      // monitor off: the port is opened for the test and closed afterwards
      const steps = await modem.testConnection()
      assert.equal(steps.length, 8)
      for (const step of steps) {
        assert.equal(step.pass, true, step.name + ': ' + step.detail)
      }
      assert.equal(modem.portOpen, false)

      // monitor on: the port opened here stays open for the poll loop
      modem.options.enabled = true
      modem.listNetInterfaces = () => [
        { name: 'usb0', driver: '', modemLike: true, operstate: 'up', ipv4: '192.168.225.30' }
      ]
      const steps2 = await modem.testConnection()
      assert.equal(steps2.filter(s => s.pass === true).length, 8)
      assert.ok(steps2.find(s => s.name === 'Network interface').detail.includes('unknown driver'))
      assert.equal(modem.portOpen, true)
      modem.closePort()
    }).timeout(15000)
  })

  describe('unresponsive serial devices (silent pty)', function () {
    it('#probeAndOpenTimeouts()', async function () {
      settings.clear()
      // serialport locks the device, so the concurrent probe and openPort
      // each get their own silent pty
      const [silentA, silentB] = await Promise.all([startSilentPty(), startSilentPty()])
      try {
        const modem = new LTEModem(settings)
        modem.options.atPort = silentB.path

        // run the probe (ATE0 + AT timeouts) and the monitor's openPort
        // (whose fire-and-forget ATE0 also times out) concurrently
        const opened = new Promise(resolve => modem.openPort(resolve))
        const probe = await modem.probeAttempt(silentA.path, 115200)
        assert.equal(probe.ok, false)
        assert.equal(probe.error, 'no response to AT')
        assert.equal(await opened, null) // the open itself succeeds
        await new Promise(resolve => setTimeout(resolve, 500)) // ATE0 catch fires
        modem.closePort()
      } finally {
        silentA.stop()
        silentB.stop()
      }
    }).timeout(15000)

    it('#probePortDropsMidProbe()', async function () {
      settings.clear()
      const silent = await startSilentPty()
      const modem = new LTEModem(settings)
      const probing = modem.probeAttempt(silent.path, 115200)
      setTimeout(() => silent.stop(), 250) // yank the device mid-probe
      const r = await probing
      assert.equal(r.ok, false)
    }).timeout(15000)
  })
})
