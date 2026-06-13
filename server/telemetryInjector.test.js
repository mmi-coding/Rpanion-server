const assert = require('assert')
const dgram = require('dgram')
const sinon = require('sinon')
const { PassThrough } = require('stream')
const settings = require('settings-store')
const { startSilentPty } = require('../test/fakeModemPty')
const TelemetryInjector = require('./telemetryInjector')

describe('Telemetry Injector', function () {
  afterEach(function () {
    sinon.restore()
  })

  function make (over = {}) {
    settings.clear()
    for (const [k, v] of Object.entries(over)) {
      settings.setValue('telemetryInjector.' + k, v)
    }
    return new TelemetryInjector(settings)
  }

  it('constructs disabled by default', function () {
    const t = make()
    assert.equal(t.getStatus().enabled, false)
    assert.equal(t.getSettings().sysid, 1)
    assert.equal(t.udpListener, null)
    t.quitting() // sendSock null branch
  })

  it('auto-starts when enabled with no sources', function () {
    const t = make({ enabled: true })
    assert.equal(t.getStatus().enabled, true)
    assert.equal(t.udpListener, null)
    assert.equal(t.serial, null)
    t.quitting()
  })

  it('skips serial start when the port is empty', function () {
    const t = make({ enabled: true, serialEnabled: true, serialPort: '' })
    assert.equal(t.serial, null)
    t.quitting()
  })

  it('encodes NAMED_VALUE_FLOAT (truncating long names)', function () {
    const t = make()
    const buf = t.encodeFloat('verylongsensorname', 12.5)
    assert.ok(Buffer.isBuffer(buf) && buf.length > 0)
  })

  it('encodes STATUSTEXT with default and explicit severity', function () {
    const t = make()
    assert.ok(Buffer.isBuffer(t.encodeText('hello')))
    assert.ok(Buffer.isBuffer(t.encodeText('warn', 4)))
  })

  it('ingest routes float / text / bad reading', function () {
    const t = make()
    const send = sinon.stub(t, '_send')
    assert.equal(t.ingest({ name: 'co2', value: 412 }), null)
    assert.equal(t.ingest({ text: 'pump on' }), null)
    assert.ok(t.ingest({ bad: 1 }) instanceof Error)
    assert.equal(t.stats.sentFloat, 1)
    assert.equal(t.stats.sentText, 1)
    assert.equal(t.stats.errors, 1)
    assert.equal(send.callCount, 2)
  })

  it('_ingestLine handles empty, bad JSON and good lines', function () {
    const t = make()
    sinon.stub(t, '_send')
    t._ingestLine('   ')
    t._ingestLine('not json')
    t._ingestLine('{"name":"x","value":1}')
    assert.equal(t.stats.sentFloat, 1)
    assert.equal(t.stats.errors, 1)
  })

  it('_send creates then reuses a udp socket (and fires the send callback)', function (done) {
    const t = make()
    t.ingest({ name: 'a', value: 1 }) // creates sendSock
    t.ingest({ name: 'b', value: 2 }) // reuses sendSock
    assert.notEqual(t.sendSock, null)
    // let the real dgram send callback run before we tear the socket down
    setTimeout(() => {
      t.quitting() // sendSock present branch
      assert.equal(t.sendSock, null)
      done()
    }, 40)
  })

  it('start() launches the serial listener when configured', function () {
    const t = make()
    const fake = new PassThrough()
    fake.close = (cb) => { if (cb) cb() }
    sinon.stub(t, '_makeSerial').returns(fake)
    t.options.serialEnabled = true
    t.options.serialPort = '/dev/fake'
    t.start() // exercises the serialEnabled branch of start()
    assert.notEqual(t.serial, null)
    t.quitting()
  })

  it('_startUdp receives NDJSON datagrams and handles errors', function (done) {
    const t = make({ enabled: true, udpEnabled: true, udpPort: 0 })
    sinon.stub(t, '_send')
    t.udpListener.on('listening', () => {
      const port = t.udpListener.address().port
      t.udpListener.emit('error', new Error('boom')) // covers the error handler
      const tx = dgram.createSocket('udp4')
      tx.send('{"name":"u","value":7}\nbadline\n', port, '127.0.0.1', () => {
        setTimeout(() => {
          assert.equal(t.stats.sentFloat, 1)
          assert.ok(t.stats.errors >= 2) // bad line + emitted socket error
          tx.close()
          t.quitting() // udpListener present branch
          done()
        }, 60)
      })
    })
  })

  it('_startSerial ingests lines and counts serial errors (fake port)', function (done) {
    const t = make()
    sinon.stub(t, '_send')
    const fake = new PassThrough()
    fake.close = (cb) => { if (cb) cb() }
    sinon.stub(t, '_makeSerial').returns(fake)
    t.options.serialEnabled = true
    t.options.serialPort = '/dev/fake'
    t._startSerial()
    fake.emit('error', new Error('serr'))
    fake.write('{"name":"s","value":3}\n')
    setImmediate(() => {
      assert.equal(t.stats.sentFloat, 1)
      assert.ok(t.stats.errors >= 1)
      t.quitting() // serial present branch
      done()
    })
  })

  it('_startSerial handles a port-open failure', function () {
    const t = make()
    sinon.stub(t, '_makeSerial').throws(new Error('cannot open'))
    t.options.serialEnabled = true
    t.options.serialPort = '/dev/bad'
    t._startSerial()
    assert.equal(t.serial, null)
    assert.equal(t.stats.errors, 1)
  })

  it('_makeSerial opens a real serial port (pty)', async function () {
    const pty = await startSilentPty()
    const t = make()
    t.options.serialEnabled = true
    t.options.serialPort = pty.path
    t.options.serialBaud = 115200
    t._startSerial()
    assert.notEqual(t.serial, null)
    t.quitting()
    pty.stop()
  })

  it('canInjectHttp reflects the master + http switches', function () {
    assert.equal(make().canInjectHttp(), false)
    assert.equal(make({ enabled: true, httpEnabled: false }).canInjectHttp(), false)
    assert.equal(make({ enabled: false, httpEnabled: true }).canInjectHttp(), false)
    assert.equal(make({ enabled: true, httpEnabled: true }).canInjectHttp(), true)
  })

  it('setSettings applies, persists and restarts', function (done) {
    const t = make()
    const start = sinon.stub(t, 'start')
    t.setSettings({ enabled: true, httpEnabled: true, udpEnabled: false, udpPort: 14601, serialEnabled: false, serialPort: '/dev/ttyUSB5', serialBaud: 115200, sysid: 2, compid: 159 }, (err) => {
      assert.equal(err, null)
      assert.equal(t.options.udpPort, 14601)
      assert.equal(settings.value('telemetryInjector.sysid'), 2)
      assert.ok(start.called)
      done()
    })
  })

  it('setSettings disable stops the listeners', function (done) {
    const t = make({ enabled: true })
    const stop = sinon.stub(t, 'stop')
    t.setSettings({ enabled: false }, (err) => {
      assert.equal(err, null)
      assert.ok(stop.called)
      done()
    })
  })

  it('setSettings rejects invalid fields', function (done) {
    const t = make()
    t.setSettings({ udpPort: 0, serialPort: 'bad port!', serialBaud: 1234, sysid: 0, compid: 999 }, (err) => {
      assert.ok(err)
      assert.ok(err.message.includes('Invalid UDP port'))
      assert.ok(err.message.includes('Invalid serial port'))
      assert.ok(err.message.includes('Invalid serial baud'))
      assert.ok(err.message.includes('sysid'))
      assert.ok(err.message.includes('compid'))
      done()
    })
  })
})
