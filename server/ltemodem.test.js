const assert = require('assert')
const fs = require('fs')
const path = require('path')
const os = require('os')
const settings = require('settings-store')
const LTEModem = require('./ltemodem')

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

    assert.equal(LTEModem.parseCPSI(['OK']), null)
  })

  it('#parseCGPADDR()', function () {
    assert.equal(LTEModem.parseCGPADDR(['+CGPADDR: 1,10.123.45.67', 'OK']), '10.123.45.67')
    assert.equal(LTEModem.parseCGPADDR(['+CGPADDR: 1,"10.123.45.67"', 'OK']), '10.123.45.67')
    // no address assigned
    assert.equal(LTEModem.parseCGPADDR(['+CGPADDR: 1,0.0.0.0', 'OK']), null)
    assert.equal(LTEModem.parseCGPADDR(['OK']), null)
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
})
