const assert = require('assert')
const sinon = require('sinon')
const settings = require('settings-store')
const { common } = require('node-mavlink')
const { UNKOWN_HEADER_ERROR } = require('ntrip-decoder/lib/config')
const Ntrip = require('./ntrip')

describe('NTRIP Functions', function () {
  afterEach(function () {
    sinon.restore()
  })

  it('#ntripinit()', function () {
    settings.clear()
    const ntripClient = new Ntrip(settings)

    // check initial status
    assert.equal(ntripClient.options.active, false)
  })

  it('#ntriptryconnect()', function () {
    // Getting starting client with bad details
    settings.clear()
    const ntripClient = new Ntrip(settings)

    // check initial status
    assert.equal(ntripClient.conStatusStr(), 'Not active | Disabled')

    ntripClient.setSettings('auscors.ga.gov.au', 2101, 'MNT', 'name', 'pwd', false, false)

    assert.equal(ntripClient.conStatusStr(), 'Not active | Disabled')
  })

  it('#getSettings()', function (done) {
    settings.clear()
    const ntripClient = new Ntrip(settings)
    ntripClient.getSettings(function (host, port, mountpoint, username, password, active, useTls) {
      assert.equal(host, '')
      assert.equal(port, 2101)
      assert.equal(mountpoint, '')
      assert.equal(username, '')
      assert.equal(password, '')
      assert.equal(active, false)
      assert.equal(useTls, false)
      done()
    })
  })

  it('#ntripActiveLifecycle()', function () {
    // drive a full status walk: enabled -> FC packets -> GPS lock ->
    // RTCM data -> stale -> error -> disabled. The client never reaches a
    // real caster (port 1 on localhost); its events are emitted directly.
    settings.clear()
    const ntripClient = new Ntrip(settings)
    ntripClient.setSettings('127.0.0.1', 1, 'MNT', 'user', 'pwd', true, false)
    assert.equal(ntripClient.status, 1)
    assert.ok(ntripClient.conStatusStr().startsWith('Waiting for flight controller packets'))

    // any FC packet moves the status to "waiting for GPS lock"
    ntripClient.onMavPacket({ header: { msgid: 0 } }, {})
    assert.equal(ntripClient.status, 2)
    assert.ok(ntripClient.conStatusStr().startsWith('Waiting for GPS lock'))

    // GPS without a fix: keep waiting
    ntripClient.onMavPacket({ header: { msgid: common.GpsRawInt.MSG_ID } },
      { fixType: 1, lat: 0, lon: 0, alt: 0 })
    assert.equal(ntripClient.status, 2)

    // GPS with a 3D fix: position converted to ECEF and handed to the client
    ntripClient.onMavPacket({ header: { msgid: common.GpsRawInt.MSG_ID } },
      { fixType: 3, lat: -354000000, lon: 1490000000, alt: 600000 })
    assert.equal(ntripClient.status, 3)
    assert.notDeepEqual(ntripClient.options.xyz, [0, 0, 0])
    assert.ok(ntripClient.conStatusStr().startsWith('No RTCM server connection'))

    // RTCM data arrives: status 4 and rtcmpacket events with a sequence number
    let seenData = null
    let seenSeq = null
    ntripClient.eventEmitter.on('rtcmpacket', (data, seq) => { seenData = data; seenSeq = seq })
    ntripClient.client.emit('data', Buffer.from([0xd3, 0x00]))
    assert.equal(ntripClient.status, 4)
    assert.equal(seenSeq, 0)
    assert.ok(Buffer.isBuffer(seenData))
    assert.ok(ntripClient.conStatusStr().startsWith('Active - receiving RTCM packets'))

    // no packets for >2s: drop back to "no server connection"
    ntripClient.timeofLastPacket = Date.now() - 5000
    assert.ok(ntripClient.conStatusStr().startsWith('No RTCM server connection'))
    assert.equal(ntripClient.status, 3)

    // a close event is just logged
    ntripClient.client.emit('close')

    // a network error flags the error status
    ntripClient.client.emit('error', new Error('boom'))
    assert.equal(ntripClient.status, -1)
    assert.ok(ntripClient.conStatusStr().startsWith('Error - unable to connect'))
    assert.ok(ntripClient.errorDescription.includes('[Error] boom'))

    // GPS update with no client handle present: position still recorded
    const liveClient = ntripClient.client
    ntripClient.client = null
    ntripClient.onMavPacket({ header: { msgid: common.GpsRawInt.MSG_ID } },
      { fixType: 3, lat: 10000000, lon: 20000000, alt: 30000 })
    ntripClient.client = liveClient

    // data/errors arriving after NTRIP is switched off are ignored
    ntripClient.options.active = false
    ntripClient.client.emit('data', Buffer.from([0xd3]))
    ntripClient.client.emit('error', 'late error')
    ntripClient.onMavPacket({ header: { msgid: 0 } }, {})
    assert.equal(ntripClient.status, -1)
    ntripClient.options.active = true

    // disabling closes and clears the client
    ntripClient.setSettings('127.0.0.1', 1, 'MNT', 'user', 'pwd', false, false)
    assert.equal(ntripClient.status, 0)
    assert.equal(ntripClient.client, null)

    // an unknown status value falls through every clause
    ntripClient.status = -5
    assert.ok(ntripClient.conStatusStr().startsWith(' | '))
    ntripClient.status = 0
  })

  it('#setSettingsSaveFailure()', function () {
    settings.clear()
    const ntripClient = new Ntrip(settings)
    // a broken settings store is logged, the client still restarts
    ntripClient.settings = { setValue: () => { throw new Error('disk full') } }
    const logSpy = sinon.spy(console, 'log')
    ntripClient.setSettings('host', 2101, 'MNT', 'user', 'pwd', false, false)
    assert.ok(logSpy.getCalls().some((c) => c.args[0] instanceof Error))
    assert.equal(ntripClient.options.host, 'host')
  })

  it('#formatError()', function () {
    settings.clear()
    const ntripClient = new Ntrip(settings)

    // Error instances and error-shaped objects
    assert.equal(ntripClient.formatError(new TypeError('bad host')), '[TypeError] bad host')
    assert.equal(ntripClient.formatError({ message: 'plain object' }), '[Error] plain object')

    // anything else is stringified
    assert.equal(ntripClient.formatError('some failure'), 'some failure')
    assert.equal(ntripClient.formatError({ odd: true }), '[object Object]')

    // unexpected HTTP headers are parsed for a hint; every recognised
    // status code ends as the generic message (the switch falls through)
    assert.equal(ntripClient.formatError(UNKOWN_HEADER_ERROR + ' HTTP/1.1 401 Unauthorized'), 'Connection failed')
    assert.equal(ntripClient.formatError(UNKOWN_HEADER_ERROR + ' HTTP/1.1 404 Not Found'), 'Connection failed')
    assert.equal(ntripClient.formatError(UNKOWN_HEADER_ERROR + ' HTTP/1.1 503 Unavailable'), 'Connection failed')

    // a header that is not an HTTP status line is passed through
    const garbled = UNKOWN_HEADER_ERROR + ' ICY 200 OK'
    assert.equal(ntripClient.formatError(garbled), garbled)
  })
})
