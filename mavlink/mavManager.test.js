const assert = require('assert')
const sinon = require('sinon')
const mavManager = require('./mavManager')
const udp = require('dgram')
const { MavLinkPacketSplitter, MavLinkPacketParser, common, minimal } = require('node-mavlink')
const { PassThrough } = require('stream')

// ---------------------------------------------------------------------------
// Raw packet helpers
// ---------------------------------------------------------------------------

// Normal unarmed HB: sysid=42, compid=150, type=5, baseMode=0x2d (bit7 clear)
const HB_NORMAL = Buffer.from([0xfd, 0x09, 0x00, 0x00, 0x07, 0x2a, 0x96, 0x00, 0x00, 0x00, 0x44, 0x00, 0x00, 0x00, 0x05, 0x03, 0x2d, 0x0d, 0x02, 0x7e, 0xfd])

// Armed HB: sysid=42, compid=150, baseMode=0x8d (bit7 set)
const HB_ARMED = Buffer.from([0xfd, 0x09, 0x00, 0x01, 0x07, 0x2a, 0x96, 0x00, 0x00, 0x00, 0x44, 0x00, 0x00, 0x00, 0x05, 0x03, 0x8d, 0x0d, 0x02, 0x4c, 0x4f])

// Disarmed HB: sysid=42, compid=150, seq=10, baseMode=0x2d (bit7 clear; armed=1 -> fires disarmed)
const HB_DISARMED = Buffer.from([253, 9, 0, 0, 10, 42, 150, 0, 0, 0, 68, 0, 0, 0, 5, 3, 45, 13, 2, 200, 11])

// HB type=6 (GCS) - must NOT lock targetSystem
const HB_GCS_TYPE6 = Buffer.from([253, 9, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 6, 3, 0, 0, 3, 135, 164])

// HB type=18 - must NOT lock targetSystem
const HB_TYPE18 = Buffer.from([253, 9, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 18, 3, 0, 0, 3, 139, 120])

// HB type=27 - must NOT lock targetSystem
const HB_TYPE27 = Buffer.from([253, 9, 0, 0, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 27, 3, 0, 0, 3, 217, 199])

// HB from different sysid=99, compid=50 (filters out after targetSystem locked)
const HB_OTHER_SYS = Buffer.from([253, 9, 0, 0, 10, 99, 50, 0, 0, 0, 0, 0, 0, 0, 2, 3, 0, 0, 3, 183, 70])

// StatusText from sysid=42, compid=150, text='TestMsg'
const STATUSTEXT_PKT = Buffer.from([253, 8, 0, 0, 5, 42, 150, 253, 0, 0, 6, 84, 101, 115, 116, 77, 115, 103, 219, 162])

// CommandLong to ONBOARD_COMPUTER (191) from sysid=42: targetSystem=42, targetComponent=191
const CMDLONG_ONBOARD = Buffer.from([253, 32, 0, 0, 8, 42, 150, 76, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 144, 1, 42, 191, 78, 15])

// CommandLong to CAMERA (100) from sysid=42: targetSystem=42, targetComponent=100
const CMDLONG_CAMERA = Buffer.from([253, 32, 0, 0, 9, 42, 150, 76, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 144, 1, 42, 100, 51, 254])

// Valid V2 packet with msgid=148 (not in node-mavlink REGISTRY -> !clazz branch)
// Built with correct CRC using magic=178 for msgid=148
const PKT_MSGID148 = Buffer.from([253, 0, 0, 0, 0, 42, 150, 148, 0, 0, 222, 63])

describe('MAVLink Functions', function () {
  afterEach(function () {
    sinon.restore()
  })

  it('#startup()', function () {
    const m = new mavManager(1, '127.0.0.1', 15000)

    assert.notEqual(m.mav, null)
    m.close()
  })

  it('#receivepacket()', function (done) {
    const m = new mavManager(2, '127.0.0.1', 15000)
    const packets = []

    m.eventEmitter.on('gotMessage', (packet,) => {
      packets.push(packet.buffer)
    })

    m.eventEmitter.on('armed', () => {
      try {
        assert.equal(m.statusArmed, 1)
        m.close()
        done()
      } catch (e) {
        m.close()
        done(e)
      }
    })

    assert.equal(m.conStatusStr(), 'Not connected')
    assert.equal(m.conStatusInt(), 0)
    assert.equal(m.statusArmed, 0)

    m.inStream.write(HB_NORMAL)

    assert.equal(m.conStatusStr(), 'Connected')
    assert.equal(m.conStatusInt(), 1)
    assert.equal(m.autopilotFromID(), 'APM')
    assert.equal(m.vehicleFromID(), 'Antenna Tracker')
    assert.equal(m.statusArmed, 0)
    assert.equal(packets.length, 1)

    // check arming
    m.inStream.write(HB_ARMED)
  })

  it('#versionSend()', function (done) {
    const m = new mavManager(2, '127.0.0.1', 16000)
    const udpStream = udp.createSocket('udp4')

    assert.equal(m.statusBytesPerSec.avgBytesSec, 0)

    m.eventEmitter.on('linkready', () => {
      m.sendVersionRequest()
    })

    udpStream.on('message', (msg) => {
      try {
        assert.deepStrictEqual(msg, Buffer.from([0xfd, 0x21, 0x00, 0x00, 0x00, 0x00, 0xBF, 0x4c, 0x00, 0x00, 0x00, 0x00, 0x14, 0x43, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02,
          0x00, 0x00, 0x01, 0xbf, 0x5b]))
        assert.equal(m.statusBytesPerSec.bytes, 2)
        m.close()
        udpStream.close()
        done()
      } catch (e) {
        m.close()
        udpStream.close()
        done(e)
      }
    })

    udpStream.send(Buffer.from([0xfd, 0x06]), 16000, '127.0.0.1', (error) => {
      if (error) {
        console.error(error)
      }
    })
  })

  it('#dsSend()', function (done) {
    const m = new mavManager(2, '127.0.0.1', 15000)
    const udpStream = udp.createSocket('udp4')

    m.eventEmitter.on('linkready', () => {
      m.sendDSRequest()
    })

    udpStream.on('message', (msg) => {
      try {
        assert.deepStrictEqual(msg, Buffer.from([253, 6, 0, 0, 0, 0, 191, 66, 0, 0, 4, 0, 0, 0, 0, 1, 171, 220]))
        m.close()
        udpStream.close()
        done()
      } catch (e) {
        m.close()
        udpStream.close()
        done(e)
      }
    })

    udpStream.send(Buffer.from([0xfd, 0x06]), 15000, '127.0.0.1', (error) => {
      if (error) {
        console.error(error)
      }
    })
  })

  it('#rebootSend()', function (done) {
    const m = new mavManager(2, '127.0.0.1', 15000)
    const udpStream = udp.createSocket('udp4')

    m.eventEmitter.on('linkready', () => {
      m.sendReboot()
    })

    udpStream.on('message', (msg) => {
      try {
        assert.deepStrictEqual(msg, Buffer.from([253, 33, 0, 0, 0, 0, 191, 76, 0, 0, 0, 0, 128, 63, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 246, 0, 0, 0, 1, 187, 227]))
        m.close()
        udpStream.close()
        done()
      } catch (e) {
        m.close()
        udpStream.close()
        done(e)
      }
    })

    udpStream.send(Buffer.from([0xfd, 0x06]), 15000, '127.0.0.1', (error) => {
      if (error) {
        console.error(error)
      }
    })
  })

  it('#paramRequestListSend()', function (done) {
    const m = new mavManager(2, '127.0.0.1', 15000)
    const udpStream = udp.createSocket('udp4')

    m.eventEmitter.on('linkready', () => {
      m.sendParamRequestList()
    })

    udpStream.on('message', (msg) => {
      try {
        // MAVLink2 frame: magic 0xFD, msgid little-endian in bytes 7..9
        assert.equal(msg[0], 0xFD)
        assert.equal(msg[7], 21) // PARAM_REQUEST_LIST
        assert.equal(msg[8], 0)
        assert.equal(msg[9], 0)
        m.close()
        udpStream.close()
        done()
      } catch (e) {
        m.close()
        udpStream.close()
        done(e)
      }
    })

    udpStream.send(Buffer.from([0xfd, 0x06]), 15000, '127.0.0.1', (error) => {
      if (error) {
        console.error(error)
      }
    })
  })

  it('#paramReadSend()', function (done) {
    const m = new mavManager(2, '127.0.0.1', 15000)
    const udpStream = udp.createSocket('udp4')

    m.eventEmitter.on('linkready', () => {
      m.sendParamRead(7)
    })

    udpStream.on('message', (msg) => {
      try {
        assert.equal(msg[0], 0xFD)
        assert.equal(msg[7], 20) // PARAM_REQUEST_READ
        assert.equal(msg[8], 0)
        assert.equal(msg[9], 0)
        m.close()
        udpStream.close()
        done()
      } catch (e) {
        m.close()
        udpStream.close()
        done(e)
      }
    })

    udpStream.send(Buffer.from([0xfd, 0x06]), 15000, '127.0.0.1', (error) => {
      if (error) {
        console.error(error)
      }
    })
  })

  it('#canForwardSend()', function (done) {
    const m = new mavManager(2, '127.0.0.1', 15000)
    const udpStream = udp.createSocket('udp4')

    m.eventEmitter.on('linkready', () => {
      m.sendCanForward(1)
    })

    udpStream.on('message', (msg) => {
      try {
        assert.equal(msg[0], 0xFD)
        assert.equal(msg[7], 76) // COMMAND_LONG (MAV_CMD_CAN_FORWARD)
        m.close()
        udpStream.close()
        done()
      } catch (e) {
        m.close()
        udpStream.close()
        done(e)
      }
    })

    udpStream.send(Buffer.from([0xfd, 0x06]), 15000, '127.0.0.1', (error) => {
      if (error) {
        console.error(error)
      }
    })
  })

  it('#canFrameSend()', function (done) {
    const m = new mavManager(2, '127.0.0.1', 15000)
    const udpStream = udp.createSocket('udp4')

    m.eventEmitter.on('linkready', () => {
      m.sendCanFrame(0, 0x80001234, [0xC0])
    })

    udpStream.on('message', (msg) => {
      try {
        assert.equal(msg[0], 0xFD)
        assert.equal(msg[7], 0x82) // CAN_FRAME msgid 386 = 0x182, low byte
        assert.equal(msg[8], 0x01)
        m.close()
        udpStream.close()
        done()
      } catch (e) {
        m.close()
        udpStream.close()
        done(e)
      }
    })

    udpStream.send(Buffer.from([0xfd, 0x06]), 15000, '127.0.0.1', (error) => {
      if (error) {
        console.error(error)
      }
    })
  })

  it('#canFilterSend()', function (done) {
    const m = new mavManager(2, '127.0.0.1', 15000)
    const udpStream = udp.createSocket('udp4')

    m.eventEmitter.on('linkready', () => {
      m.sendCanFilter(0, [341, 1])
    })

    udpStream.on('message', (msg) => {
      try {
        assert.equal(msg[0], 0xFD)
        assert.equal(msg[7], 0x84) // CAN_FILTER_MODIFY msgid 388 = 0x184, low byte
        assert.equal(msg[8], 0x01)
        m.close()
        udpStream.close()
        done()
      } catch (e) {
        m.close()
        udpStream.close()
        done(e)
      }
    })

    udpStream.send(Buffer.from([0xfd, 0x06]), 15000, '127.0.0.1', (error) => {
      if (error) {
        console.error(error)
      }
    })
  })

  it('#heartbeatSend()', function (done) {
    const m = new mavManager(2, '127.0.0.1', 15000)
    const udpStream = udp.createSocket('udp4')

    m.eventEmitter.on('linkready', () => {
      m.sendHeartbeat()
    })

    udpStream.on('message', (msg) => {
      try {
        assert.deepStrictEqual(msg, Buffer.from([253, 9, 0, 0, 0, 0, 191, 0, 0, 0, 0, 0, 0, 0, 18, 8, 0, 0, 2, 61, 244]))
        m.close()
        udpStream.close()
        done()
      } catch (e) {
        m.close()
        udpStream.close()
        done(e)
      }
    })

    udpStream.send(Buffer.from([0xfd, 0x06]), 15000, '127.0.0.1', (error) => {
      if (error) {
        console.error(error)
      }
    })
  })

  it('#commandAckSend()', function (done) {
    const m = new mavManager(2, '127.0.0.1', 15000)
    const udpStream = udp.createSocket('udp4')

    m.eventEmitter.on('linkready', () => {
      m.sendCommandAck()
    })

    udpStream.on('message', (msg) => {
      try {
        assert.deepStrictEqual(msg, Buffer.from([253, 9, 0, 0, 0, 0, 191, 77, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 197, 27]))
        m.close()
        udpStream.close()
        done()
      } catch (e) {
        m.close()
        udpStream.close()
        done(e)
      }
    })

    udpStream.send(Buffer.from([0xfd, 0x06]), 15000, '127.0.0.1', (error) => {
      if (error) {
        console.error(error)
      }
    })
  })

  it('#perfTest()', function () {
    // how fast can we process packets and send out over udp?
    const m = new mavManager(2, '127.0.0.1', 15000)

    // time how long 255 HB packets takes
    const starttime = Date.now().valueOf()
    for (let i = 0; i < 255; i++) {
      const hb = new Buffer.from([0xfd, 0x09, 0x00, 0x00, i, 0x2a, 0x96, 0x00, 0x00, 0x00, 0x44, 0x00, 0x00, 0x00, 0x05, 0x03, 0x2d, 0x0d, 0x02, 0x7e, 0xfd])
      m.inStream.write(hb)
    }
    const delta = Date.now().valueOf() - starttime
    const packetsPerSec = 1000 * (255 / delta)

    console.log('MAVLink performance is ' + parseInt(packetsPerSec) + ' packets/sec')
    m.close()
  })

  it('#decodeFlightSwVersion()', function () {
    const m = new mavManager(2, '127.0.0.1', 17000)

    // Test dev version: 4.5.3-dev (0x04050300)
    assert.equal(m.decodeFlightSwVersion(0x04050300), '4.5.3-dev')

    // Test alpha version: 4.5.3-alpha (0x04050340)
    assert.equal(m.decodeFlightSwVersion(0x04050340), '4.5.3-alpha')

    // Test beta version: 4.5.3-beta (0x04050380)
    assert.equal(m.decodeFlightSwVersion(0x04050380), '4.5.3-beta')

    // Test rc version: 4.5.3-rc (0x040503C0)
    assert.equal(m.decodeFlightSwVersion(0x040503C0), '4.5.3-rc')

    // Test official version: 4.5.3-official (0x040503FF)
    assert.equal(m.decodeFlightSwVersion(0x040503FF), '4.5.3-official')

    // Test unknown version type (0x04050332)
    assert.equal(m.decodeFlightSwVersion(0x04050332), '4.5.3-Unknown')

    m.close()
  })

  it('#autopilotFromID()', function () {
    const m = new mavManager(2, '127.0.0.1', 17100)

    m.statusFWName = 0
    assert.equal(m.autopilotFromID(), 'Generic')

    m.statusFWName = 3
    assert.equal(m.autopilotFromID(), 'APM')

    m.statusFWName = 4
    assert.equal(m.autopilotFromID(), 'OpenPilot')

    m.statusFWName = 12
    assert.equal(m.autopilotFromID(), 'PX4')

    m.statusFWName = 99
    assert.equal(m.autopilotFromID(), 'Unknown')

    m.close()
  })

  it('#vehicleFromID()', function () {
    const m = new mavManager(2, '127.0.0.1', 17200)

    m.statusVehType = 0
    assert.equal(m.vehicleFromID(), 'Generic')

    m.statusVehType = 1
    assert.equal(m.vehicleFromID(), 'Fixed Wing')

    m.statusVehType = 2
    assert.equal(m.vehicleFromID(), 'Quadcopter')

    m.statusVehType = 4
    assert.equal(m.vehicleFromID(), 'Helicopter')

    m.statusVehType = 5
    assert.equal(m.vehicleFromID(), 'Antenna Tracker')

    m.statusVehType = 6
    assert.equal(m.vehicleFromID(), 'GCS')

    m.statusVehType = 10
    assert.equal(m.vehicleFromID(), 'Ground Rover')

    m.statusVehType = 11
    assert.equal(m.vehicleFromID(), 'Boat')

    m.statusVehType = 12
    assert.equal(m.vehicleFromID(), 'Submarine')

    m.statusVehType = 13
    assert.equal(m.vehicleFromID(), 'Hexacopter')

    m.statusVehType = 14
    assert.equal(m.vehicleFromID(), 'Octocopter')

    m.statusVehType = 15
    assert.equal(m.vehicleFromID(), 'Tricopter')

    m.statusVehType = 99
    assert.equal(m.vehicleFromID(), 'Unknown')

    m.close()
  })

  it('#conStatusStr()', function (done) {
    const m = new mavManager(2, '127.0.0.1', 17300)

    // Initially not connected
    assert.equal(m.conStatusStr(), 'Not connected')
    assert.equal(m.conStatusInt(), 0)

    // Simulate receiving a packet
    m.eventEmitter.on('linkready', () => {
      m.inStream.write(HB_NORMAL)

      // Should be connected now
      setTimeout(() => {
        try {
          assert.equal(m.conStatusStr(), 'Connected')
          assert.equal(m.conStatusInt(), 1)

          // Simulate connection loss by setting old timestamp
          m.timeofLastPacket = Date.now().valueOf() - 10000
          assert.ok(m.conStatusStr().includes('Connection lost'))
          assert.equal(m.conStatusInt(), -1)

          m.close()
          done()
        } catch (e) {
          m.close()
          done(e)
        }
      }, 100)
    })

    const udpStream = udp.createSocket('udp4')
    udpStream.send(Buffer.from([0xfd, 0x06]), 17300, '127.0.0.1')
  })

  it('#restart()', function () {
    const m = new mavManager(2, '127.0.0.1', 16500)

    // Set some state
    m.RinudpPort = 12345
    m.RinudpIP = '192.168.1.1'
    m.targetSystem = 1
    m.targetComponent = 1

    // Restart the manager
    m.restart()

    // Target should be reset
    assert.equal(m.targetSystem, null)
    assert.equal(m.targetComponent, null)
    assert.equal(m.RinudpPort, null)
    assert.equal(m.RinudpIP, null)
    assert.equal(m.statusBytesPerSec.avgBytesSec, 0)

    m.close()
  })

  it('#isRebooting()', function () {
    const m = new mavManager(2, '127.0.0.1', 16100)

    assert.equal(m.isRebooting, false)
    m.sendReboot()
    assert.equal(m.isRebooting, true)

    m.close()
  })

  it('#sendHeartbeatWithParams()', function (done) {
    const m = new mavManager(2, '127.0.0.1', 16200)
    const udpStream = udp.createSocket('udp4')

    m.eventEmitter.on('linkready', () => {
      // Send heartbeat with custom parameters
      m.sendHeartbeat(6, 8, 1) // GCS, Invalid, AUTOPILOT
    })

    udpStream.on('message', (msg) => {
      try {
        assert.ok(msg.length > 0)
        m.close()
        udpStream.close()
        done()
      } catch (e) {
        m.close()
        udpStream.close()
        done(e)
      }
    })

    udpStream.send(Buffer.from([0xfd, 0x06]), 16200, '127.0.0.1')
  })

  it('#sendCommandAckWithParams()', function (done) {
    const m = new mavManager(2, '127.0.0.1', 16300)
    const udpStream = udp.createSocket('udp4')

    m.eventEmitter.on('linkready', () => {
      // Send command ack with custom parameters
      m.sendCommandAck(400, 1, 1, 1, 1)
    })

    udpStream.on('message', (msg) => {
      try {
        assert.ok(msg.length > 0)
        m.close()
        udpStream.close()
        done()
      } catch (e) {
        m.close()
        udpStream.close()
        done(e)
      }
    })

    udpStream.send(Buffer.from([0xfd, 0x06]), 16300, '127.0.0.1')
  })

  it('#sendSetMessageInterval()', function (done) {
    const m = new mavManager(2, '127.0.0.1', 16400)
    const udpStream = udp.createSocket('udp4')

    m.eventEmitter.on('linkready', () => {
      // ask for RC_CHANNELS (65) at 2 Hz (500000 us)
      m.sendSetMessageInterval(65, 500000)
    })

    udpStream.on('message', (msg) => {
      // decode the raw packet and check it is a correctly-formed
      // MAV_CMD_SET_MESSAGE_INTERVAL COMMAND_LONG
      const s = new PassThrough()
      const decoder = s.pipe(new MavLinkPacketSplitter()).pipe(new MavLinkPacketParser())
      decoder.on('data', (packet) => {
        try {
          assert.equal(packet.header.msgid, common.CommandLong.MSG_ID)
          const data = packet.protocol.data(packet.payload, common.CommandLong)
          assert.equal(data.command, 511) // MAV_CMD_SET_MESSAGE_INTERVAL
          assert.equal(data._param1, 65) // RC_CHANNELS
          assert.equal(data._param2, 500000) // 2 Hz
          m.close()
          udpStream.close()
          done()
        } catch (e) {
          m.close()
          udpStream.close()
          done(e)
        }
      })
      s.write(msg)
    })

    udpStream.send(Buffer.from([0xfd, 0x06]), 16400, '127.0.0.1')
  })

  // -------------------------------------------------------------------------
  // GCS / type-filter: heartbeats with type 6, 18, 27 must NOT lock targetSystem
  // -------------------------------------------------------------------------
  it('#gcsTypeFilter() type=6,18,27 rejected; other system filtered after lock', function (done) {
    const m = new mavManager(2, '127.0.0.1', 17400)

    // Inject type=6 (GCS), type=18, type=27 - none should lock targetSystem
    m.inStream.write(HB_GCS_TYPE6)
    m.inStream.write(HB_TYPE18)
    m.inStream.write(HB_TYPE27)

    // After a tick, targetSystem must still be null
    setImmediate(() => {
      try {
        assert.equal(m.targetSystem, null, 'GCS-type HBs must not lock targetSystem')

        // Now lock with a legitimate vehicle HB
        m.inStream.write(HB_NORMAL)

        setImmediate(() => {
          try {
            assert.equal(m.targetSystem, 42)

            // Inject HB from different sysid - should be silently discarded
            const msgsBefore = m.statusNumRxPackets
            m.inStream.write(HB_OTHER_SYS)

            setImmediate(() => {
              try {
                // Packet count must not have changed (other-sys packet was returned early)
                assert.equal(m.statusNumRxPackets, msgsBefore)
                m.close()
                done()
              } catch (e) {
                m.close()
                done(e)
              }
            })
          } catch (e) {
            m.close()
            done(e)
          }
        })
      } catch (e) {
        m.close()
        done(e)
      }
    })
  })

  // -------------------------------------------------------------------------
  // disarmed event: arm then disarm
  // -------------------------------------------------------------------------
  it('#disarmedEvent() fires after armed then disarmed HB', function (done) {
    const m = new mavManager(2, '127.0.0.1', 17500)

    // Lock targetSystem with normal HB first
    m.inStream.write(HB_NORMAL)

    m.eventEmitter.on('armed', () => {
      // Now send disarmed HB from same sysid
      m.inStream.write(HB_DISARMED)
    })

    m.eventEmitter.on('disarmed', () => {
      try {
        assert.equal(m.statusArmed, 0)
        m.close()
        done()
      } catch (e) {
        m.close()
        done(e)
      }
    })

    // Trigger armed HB
    m.inStream.write(HB_ARMED)
  })

  // -------------------------------------------------------------------------
  // StatusText handler
  // -------------------------------------------------------------------------
  it('#statusText() set from STATUSTEXT packet', function (done) {
    const m = new mavManager(2, '127.0.0.1', 17600)

    // Lock targetSystem first
    m.inStream.write(HB_NORMAL)

    setImmediate(() => {
      // Inject a STATUSTEXT packet from sysid=42
      m.inStream.write(STATUSTEXT_PKT)

      setImmediate(() => {
        try {
          assert.ok(m.statusText.includes('TestMsg'), 'statusText should include injected text, got: ' + m.statusText)
          m.close()
          done()
        } catch (e) {
          m.close()
          done(e)
        }
      })
    })
  })

  // -------------------------------------------------------------------------
  // CommandLong ONBOARD_COMPUTER and CAMERA branches
  // -------------------------------------------------------------------------
  it('#commandLongDispatch() ONBOARD_COMPUTER and CAMERA branches', function (done) {
    const m = new mavManager(2, '127.0.0.1', 17700)
    let gotMessages = 0

    // Lock targetSystem
    m.inStream.write(HB_NORMAL)

    m.eventEmitter.on('gotMessage', (packet, data) => {
      if (data && packet.header.msgid === common.CommandLong.MSG_ID) {
        gotMessages++
        if (gotMessages === 2) {
          try {
            m.close()
            done()
          } catch (e) {
            m.close()
            done(e)
          }
        }
      }
    })

    setImmediate(() => {
      // CommandLong to ONBOARD_COMPUTER
      m.inStream.write(CMDLONG_ONBOARD)
      // CommandLong to CAMERA
      m.inStream.write(CMDLONG_CAMERA)
    })
  })

  // -------------------------------------------------------------------------
  // Unknown msgid packet: !clazz branch (line 82-87)
  // msgid=148 has a magic number in mavlink-mappings but is NOT in node-mavlink
  // REGISTRY, so the splitter validates it but REGISTRY[148] is undefined
  // -------------------------------------------------------------------------
  it('#unknownMsgidPacket() emits gotMessage with null data', function (done) {
    const m = new mavManager(2, '127.0.0.1', 17800)
    let gotNullData = false

    m.eventEmitter.on('gotMessage', (packet, data) => {
      if (packet.header.msgid === 148 && data === null) {
        gotNullData = true
        try {
          m.close()
          done()
        } catch (e) {
          m.close()
          done(e)
        }
      }
    })

    // PKT_MSGID148 is a valid V2 packet (correct CRC for magic=178) with msgid=148
    // The splitter passes it through; REGISTRY[148] is undefined -> !clazz path
    m.inStream.write(PKT_MSGID148)

    // Timeout safety: in case packet never arrives
    setTimeout(() => {
      if (!gotNullData) {
        m.close()
        done(new Error('gotMessage with null data was never emitted for msgid=148'))
      }
    }, 500)
  })

  // -------------------------------------------------------------------------
  // restart() post-restart message path (f[6], lines 200-219)
  // First UDP message after restart locks RinudpPort (line 202-204)
  // Second UDP message with a fresh lastTime exercises bytes accumulation (lines 215-216)
  // Third message with backdated lastTime exercises rate recalculation (lines 207-214)
  // -------------------------------------------------------------------------
  it('#restartMessagePath() post-restart UDP message handler', function (done) {
    const PORT = 17900
    const m = new mavManager(2, '127.0.0.1', PORT, false)

    m.restart()

    const sender = udp.createSocket('udp4')

    // First message after restart: locks RinudpPort
    sender.send(Buffer.from([0x01, 0x02, 0x03]), PORT, '127.0.0.1', (err) => {
      if (err) {
        sender.close()
        m.close()
        done(err)
        return
      }
      // Give the OS a moment to deliver the datagram
      setImmediate(() => {
        try {
          assert.notEqual(m.RinudpPort, null, 'RinudpPort should be locked after first message')
          assert.equal(m.RinudpIP, '127.0.0.1')

          // Second message: bytes should accumulate (within 2s window)
          sender.send(Buffer.from([0xAA, 0xBB]), PORT, '127.0.0.1', (err2) => {
            if (err2) {
              sender.close()
              m.close()
              done(err2)
              return
            }
            setImmediate(() => {
              try {
                assert.equal(m.statusBytesPerSec.bytes, 2, 'bytes should be 2 after second message')

                // Backdate lastTime so next message triggers rate window recalculation
                m.statusBytesPerSec.lastTime = Date.now() - 3000

                sender.send(Buffer.from([0xCC]), PORT, '127.0.0.1', (err3) => {
                  if (err3) {
                    sender.close()
                    m.close()
                    done(err3)
                    return
                  }
                  setImmediate(() => {
                    try {
                      // Rate calculation executed; bytes reset to 0; avgBytesSec updated
                      assert.equal(m.statusBytesPerSec.bytes, 0)
                      sender.close()
                      m.close()
                      done()
                    } catch (e) {
                      sender.close()
                      m.close()
                      done(e)
                    }
                  })
                })
              } catch (e) {
                sender.close()
                m.close()
                done(e)
              }
            })
          })
        } catch (e) {
          sender.close()
          m.close()
          done(e)
        }
      })
    })
  })

  // -------------------------------------------------------------------------
  // restart() with enableDSRequest + targetSystem locked: sendDSRequest called
  // -------------------------------------------------------------------------
  it('#restartDSRequest() auto-sendDSRequest after rate window via restart handler', function (done) {
    const PORT = 18000
    const m = new mavManager(2, '127.0.0.1', PORT, true)

    m.restart()

    // Pre-set targetSystem/Component so the DS request fires
    m.targetSystem = 42
    m.targetComponent = 150

    const spy = sinon.spy(m, 'sendDSRequest')

    const sender = udp.createSocket('udp4')

    // First message: lock RinudpPort (also needed so sendDSRequest can call sendData)
    sender.send(Buffer.from([0x01]), PORT, '127.0.0.1', (err) => {
      if (err) { sender.close(); m.close(); done(err); return }
      setImmediate(() => {
        try {
          assert.notEqual(m.RinudpPort, null)

          // Backdate lastTime to trigger rate window + DS request on next message
          m.statusBytesPerSec.lastTime = Date.now() - 3000

          sender.send(Buffer.from([0x02]), PORT, '127.0.0.1', (err2) => {
            if (err2) { sender.close(); m.close(); done(err2); return }
            setImmediate(() => {
              try {
                assert.equal(spy.callCount, 1, 'sendDSRequest should have been called once')
                sender.close()
                m.close()
                done()
              } catch (e) {
                sender.close()
                m.close()
                done(e)
              }
            })
          })
        } catch (e) {
          sender.close()
          m.close()
          done(e)
        }
      })
    })
  })

  // -------------------------------------------------------------------------
  // constructor UDP message handler: bytes accounting path (lines 52-62)
  // -------------------------------------------------------------------------
  it('#constructorBytesAccounting() rate window in constructor UDP handler', function (done) {
    const PORT = 18100
    const m = new mavManager(2, '127.0.0.1', PORT, false)

    const sender = udp.createSocket('udp4')

    // First message: locks RinudpPort; bytes accounting runs but window not yet expired
    // Note: the constructor handler checks bytes BEFORE the lock, so first msg bytes counted
    sender.send(Buffer.from([0xAA, 0xBB]), PORT, '127.0.0.1', (err) => {
      if (err) { sender.close(); m.close(); done(err); return }
      setImmediate(() => {
        try {
          assert.notEqual(m.RinudpPort, null)
          // First msg (2 bytes) ran through the bytes-accumulate branch before locking
          assert.equal(m.statusBytesPerSec.bytes, 2)

          // Second message within 2s: bytes accumulates further (b[0][0] false branch)
          sender.send(Buffer.from([0x01, 0x02, 0x03]), PORT, '127.0.0.1', (err2) => {
            if (err2) { sender.close(); m.close(); done(err2); return }
            setImmediate(() => {
              try {
                assert.equal(m.statusBytesPerSec.bytes, 5, 'bytes should be 2+3=5 after two messages')

                // Backdate lastTime and send third message: triggers rate recalculation (b[0][0] true)
                m.statusBytesPerSec.lastTime = Date.now() - 3000
                sender.send(Buffer.from([0xDD]), PORT, '127.0.0.1', (err3) => {
                  if (err3) { sender.close(); m.close(); done(err3); return }
                  setImmediate(() => {
                    try {
                      assert.equal(m.statusBytesPerSec.bytes, 0, 'bytes should reset to 0 after rate window')
                      sender.close()
                      m.close()
                      done()
                    } catch (e) {
                      sender.close()
                      m.close()
                      done(e)
                    }
                  })
                })
              } catch (e) {
                sender.close()
                m.close()
                done(e)
              }
            })
          })
        } catch (e) {
          sender.close()
          m.close()
          done(e)
        }
      })
    })
  })

  // -------------------------------------------------------------------------
  // constructor UDP handler: enableDSRequest fires after rate window
  // -------------------------------------------------------------------------
  it('#constructorDSRequest() enableDSRequest fires in constructor handler after 2s', function (done) {
    const PORT = 18200
    const m = new mavManager(2, '127.0.0.1', PORT, true)

    // Pre-lock targetSystem so DS request fires
    m.targetSystem = 42
    m.targetComponent = 150

    const spy = sinon.spy(m, 'sendDSRequest')

    const sender = udp.createSocket('udp4')

    // First message: lock RinudpPort
    sender.send(Buffer.from([0x01]), PORT, '127.0.0.1', (err) => {
      if (err) { sender.close(); m.close(); done(err); return }
      setImmediate(() => {
        try {
          assert.notEqual(m.RinudpPort, null)
          // Backdate lastTime so next message exceeds the 2s window
          m.statusBytesPerSec.lastTime = Date.now() - 3000
          sender.send(Buffer.from([0x02]), PORT, '127.0.0.1', (err2) => {
            if (err2) { sender.close(); m.close(); done(err2); return }
            setImmediate(() => {
              try {
                assert.equal(spy.callCount, 1, 'sendDSRequest should fire after rate window')
                sender.close()
                m.close()
                done()
              } catch (e) {
                sender.close()
                m.close()
                done(e)
              }
            })
          })
        } catch (e) {
          sender.close()
          m.close()
          done(e)
        }
      })
    })
  })

  // -------------------------------------------------------------------------
  // sendData() with MavLinkProtocolV1 (version=1 branch)
  // -------------------------------------------------------------------------
  it('#sendDataV1() uses MavLinkProtocolV1 when version=1', function (done) {
    const m = new mavManager(1, '127.0.0.1', 18300)
    const udpStream = udp.createSocket('udp4')

    m.eventEmitter.on('linkready', () => {
      m.sendHeartbeat()
    })

    udpStream.on('message', (msg) => {
      try {
        // V1 magic byte is 0xFE
        assert.equal(msg[0], 0xFE)
        m.close()
        udpStream.close()
        done()
      } catch (e) {
        m.close()
        udpStream.close()
        done(e)
      }
    })

    udpStream.send(Buffer.from([0xfd, 0x06]), 18300, '127.0.0.1')
  })

  // -------------------------------------------------------------------------
  // close() when udpStream is already null: defensive guard (b[22][1] false)
  // -------------------------------------------------------------------------
  it('#closeGuard() close() is safe when udpStream is null', function () {
    const m = new mavManager(2, '127.0.0.1', 18400)
    m.close() // normal close
    m.udpStream = null
    // Should not throw
    m.close()
  })

  // -------------------------------------------------------------------------
  // sendRTCMMessage() – comprehensive coverage
  // -------------------------------------------------------------------------
  describe('#sendRTCMMessage()', function () {
    it('empty message (0 bytes)', function (done) {
      const m = new mavManager(2, '127.0.0.1', 18500)
      const udpStream = udp.createSocket('udp4')
      let received = 0

      m.eventEmitter.on('linkready', () => {
        m.sendRTCMMessage(Buffer.alloc(0), 0)
      })

      udpStream.on('message', (msg) => {
        received++
        // Give a tick to collect any additional messages
        setImmediate(() => {
          try {
            assert.equal(received, 1, 'empty message should produce exactly 1 GpsRtcmData packet')
            m.close()
            udpStream.close()
            done()
          } catch (e) {
            m.close()
            udpStream.close()
            done(e)
          }
        })
      })

      udpStream.send(Buffer.from([0xfd, 0x06]), 18500, '127.0.0.1')
    })

    it('message <= 180 bytes (no fragmentation)', function (done) {
      const m = new mavManager(2, '127.0.0.1', 18600)
      const udpStream = udp.createSocket('udp4')
      let received = 0

      m.eventEmitter.on('linkready', () => {
        // 100 bytes - under the 180-byte threshold
        m.sendRTCMMessage(Buffer.alloc(100, 0xAA), 1)
      })

      udpStream.on('message', (msg) => {
        received++
        setImmediate(() => {
          try {
            assert.equal(received, 1, 'short message should produce 1 packet')
            m.close()
            udpStream.close()
            done()
          } catch (e) {
            m.close()
            udpStream.close()
            done(e)
          }
        })
      })

      udpStream.send(Buffer.from([0xfd, 0x06]), 18600, '127.0.0.1')
    })

    it('message 181 bytes (flags=1, 2 fragments)', function (done) {
      const m = new mavManager(2, '127.0.0.1', 18700)
      const udpStream = udp.createSocket('udp4')
      const received = []

      m.eventEmitter.on('linkready', () => {
        // 181 bytes -> flags |= 1, split into [180, 1]
        m.sendRTCMMessage(Buffer.alloc(181, 0xBB), 2)
      })

      udpStream.on('message', (msg) => {
        received.push(msg)
        if (received.length === 2) {
          try {
            // Decode both packets and check flags
            let s = new PassThrough()
            let parsed = []
            const decoder = s.pipe(new MavLinkPacketSplitter()).pipe(new MavLinkPacketParser())
            decoder.on('data', (packet) => {
              const data = packet.protocol.data(packet.payload, common.GpsRtcmData)
              parsed.push(data)
              if (parsed.length === 2) {
                try {
                  // flags & 1 should be set (fragmented)
                  assert.equal(parsed[0].flags & 1, 1)
                  assert.equal(parsed[1].flags & 1, 1)
                  // fragment index: first packet index=0 (bits 1-0 of flags>>1), second=1
                  assert.equal((parsed[0].flags >> 1) & 0x3, 0)
                  assert.equal((parsed[1].flags >> 1) & 0x3, 1)
                  m.close()
                  udpStream.close()
                  done()
                } catch (e) {
                  m.close()
                  udpStream.close()
                  done(e)
                }
              }
            })
            received.forEach(r => s.write(r))
          } catch (e) {
            m.close()
            udpStream.close()
            done(e)
          }
        }
      })

      udpStream.send(Buffer.from([0xfd, 0x06]), 18700, '127.0.0.1')
    })

    it('message 361 bytes (3 fragments)', function (done) {
      const m = new mavManager(2, '127.0.0.1', 18800)
      const udpStream = udp.createSocket('udp4')
      const received = []

      m.eventEmitter.on('linkready', () => {
        m.sendRTCMMessage(Buffer.alloc(361, 0xCC), 3)
      })

      udpStream.on('message', (msg) => {
        received.push(msg)
        if (received.length === 3) {
          try {
            assert.equal(received.length, 3, 'should get 3 fragments for 361-byte message')
            m.close()
            udpStream.close()
            done()
          } catch (e) {
            m.close()
            udpStream.close()
            done(e)
          }
        }
      })

      udpStream.send(Buffer.from([0xfd, 0x06]), 18800, '127.0.0.1')
    })

    it('message > 720 bytes returns early (no send)', function (done) {
      const m = new mavManager(2, '127.0.0.1', 18900)
      const udpStream = udp.createSocket('udp4')
      let received = 0

      m.eventEmitter.on('linkready', () => {
        // 721 bytes = 4*180 + 1 -> exceeds limit, early return
        m.sendRTCMMessage(Buffer.alloc(721, 0xDD), 4)
        // Also send a heartbeat as a sentinel to confirm the UDP socket is working
        m.sendHeartbeat()
      })

      udpStream.on('message', (msg) => {
        received++
        // The heartbeat is the only message that should arrive
        setImmediate(() => {
          try {
            // Only the heartbeat sentinel should be received
            assert.equal(received, 1, 'should only receive the sentinel heartbeat')
            m.close()
            udpStream.close()
            done()
          } catch (e) {
            m.close()
            udpStream.close()
            done(e)
          }
        })
      })

      udpStream.send(Buffer.from([0xfd, 0x06]), 18900, '127.0.0.1')
    })

    it('sequence number encoding in flags', function (done) {
      const m = new mavManager(2, '127.0.0.1', 19000)
      const udpStream = udp.createSocket('udp4')

      m.eventEmitter.on('linkready', () => {
        // seq=5 -> flags |= (5 & 0x1F) << 3 = 0x28
        m.sendRTCMMessage(Buffer.alloc(10, 0xEE), 5)
      })

      udpStream.on('message', (msg) => {
        try {
          const s = new PassThrough()
          const decoder = s.pipe(new MavLinkPacketSplitter()).pipe(new MavLinkPacketParser())
          decoder.on('data', (packet) => {
            try {
              const data = packet.protocol.data(packet.payload, common.GpsRtcmData)
              // seq=5, len<=180 so flags = 0 | (5<<3) = 40
              assert.equal(data.flags, 40)
              m.close()
              udpStream.close()
              done()
            } catch (e) {
              m.close()
              udpStream.close()
              done(e)
            }
          })
          s.write(msg)
        } catch (e) {
          m.close()
          udpStream.close()
          done(e)
        }
      })

      udpStream.send(Buffer.from([0xfd, 0x06]), 19000, '127.0.0.1')
    })
  })
})
