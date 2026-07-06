// Mavlink Manager
const events = require('events')
const udp = require('dgram')
const { MavLinkPacketSplitter, MavLinkPacketParser, MavLinkProtocolV2, minimal, common, ardupilotmega, MavLinkProtocolV1 } = require('node-mavlink')
const { PassThrough } = require('stream')

// create a registry of mappings between a message id and a data class
const REGISTRY = {
  ...minimal.REGISTRY,
  ...common.REGISTRY,
  ...ardupilotmega.REGISTRY
}

// Cap the STATUSTEXT accumulator so a long flight can't grow it without bound
// (it is also re-broadcast at 1 Hz over the scarce LTE uplink). Keep only the
// most-recent lines; each MAVLink STATUSTEXT is <=50 chars so this stays well
// under ~4 KB.
const MAX_STATUSTEXT_LINES = 50

class mavManager {
  enableDSRequest: any
  inStream: any
  RinudpIP: any
  RinudpPort: any
  inudpIP: any
  inudpPort: any
  udpStream: any
  targetComponent: any
  targetSystem: any
  seq: any
  statusArmed: any
  statusText: any
  timeofLastPacket: any
  fcVersion: any
  statusVehType: any
  statusFWName: any
  statusBytesPerSec: any
  statusNumRxPackets: any
  isRebooting: any
  eventEmitter: any
  version: any
  mavmsg: any
  mav: any
  constructor (version: number, inudpIP: string, inudpPort: number, enableDSRequest: boolean) {
    this.mav = null
    this.mavmsg = null
    this.version = version

    this.eventEmitter = new events.EventEmitter()

    // are we in a system reboot?
    this.isRebooting = false

    // System status
    this.statusNumRxPackets = 0
    this.statusBytesPerSec = { avgBytesSec: 0, bytes: 0, lastTime: Date.now().valueOf() }
    this.statusFWName = ''
    this.statusVehType = ''
    this.fcVersion = ''
    this.timeofLastPacket = 0
    this.statusText = ''
    this.statusArmed = 0
    this.seq = 0

    // the vehicle
    this.targetSystem = null
    this.targetComponent = null

    this.enableDSRequest = enableDSRequest

    // udp input
    this.udpStream = udp.createSocket('udp4')
    this.inudpPort = inudpPort
    this.inudpIP = inudpIP
    this.RinudpPort = null
    this.RinudpIP = null
    this.inStream = new PassThrough()

    this.udpStream.on('message', (msg: Buffer, rinfo: { port: number, address: string }) => {
      // calculate bytes/sec rate (once per 2 sec) and do DS requests
      if ((this.statusBytesPerSec.lastTime + 2000) < Date.now().valueOf()) {
        this.statusBytesPerSec.avgBytesSec = Math.round(1000 * this.statusBytesPerSec.bytes / (Date.now().valueOf() - this.statusBytesPerSec.lastTime))
        this.statusBytesPerSec.bytes = 0
        this.statusBytesPerSec.lastTime = Date.now().valueOf()

        if (this.enableDSRequest && this.targetSystem != null && this.targetComponent != null) {
          this.sendDSRequest()
        }
      } else {
        this.statusBytesPerSec.bytes += msg.length
      }

      // lock onto server port
      if (this.RinudpPort === null || this.RinudpIP === null) {
        this.RinudpPort = rinfo.port
        this.RinudpIP = rinfo.address
        console.log(this.RinudpPort)
        this.eventEmitter.emit('linkready', true)
      }

      this.inStream.write(msg)
    })

    this.udpStream.bind(inudpPort, inudpIP)

    this.mav = this.inStream.pipe(new MavLinkPacketSplitter()).pipe(new MavLinkPacketParser())

    // A malformed/truncated frame (RF/EMI on a noisy airframe, or a crafted frame
    // on the open TCP link) can make the splitter/parser emit an 'error' event.
    // Without a listener Node re-throws it out of the event loop and the global
    // handler exits the process -> ~10 s loss of all links. Log and keep running.
    this.mav.on('error', (err: any) => {
      console.log('MAVLink parser error: ', err)
    })

    // what to do when we get a message
    this.mav.on('data', (packet: any) => {
      try {
        const clazz = REGISTRY[packet.header.msgid]
        if (!clazz) {
          // bad message - can't process here any further
          // console.log("Generic: ", packet)
          this.eventEmitter.emit('gotMessage', packet, null)
          return
        }
        const data = packet.protocol.data(packet.payload, clazz)
        // console.log(packet)

        // set the target system/comp ID if needed
        // ensure it's NOT a GCS, as mavlink-router will sometimes route
        // messages from connected GCS's
        if (this.targetSystem === null && packet.header.msgid === minimal.Heartbeat.MSG_ID && data.type !== 6
          && data.type !== 18 && data.type !== 27) {
          console.log('Vehicle is S/C: ' + packet.header.sysid + '/' + packet.header.compid)
          this.targetSystem = packet.header.sysid
          this.targetComponent = packet.header.compid

          // send off initial messages
          this.sendVersionRequest()

          // Respond to MavLink commands that are targeted to the companion computer
        } else if (data.targetSystem === this.targetSystem &&
          data.targetComponent === minimal.MavComponent.ONBOARD_COMPUTER &&
          packet.header.msgid === common.CommandLong.MSG_ID) {
          console.log('Received CommandLong addressed to onboard computer')

        // Or the attached camera
        } else if (data.targetSystem === this.targetSystem &&
          data.targetComponent === minimal.MavComponent.CAMERA &&
          packet.header.msgid === common.CommandLong.MSG_ID) {
          console.log('Received CommandLong addressed to attached camera')

        } else if (this.targetSystem !== packet.header.sysid || this.targetComponent !== packet.header.compid) {
          // don't use packets from other systems or components in Rpanion-server
          return
        }

        // raise event for external objects
        this.eventEmitter.emit('gotMessage', packet, data)

        this.statusNumRxPackets += 1
        this.timeofLastPacket = (Date.now().valueOf())
        if (packet.header.msgid === minimal.Heartbeat.MSG_ID) {
          // System status
          this.statusFWName = data.autopilot
          this.statusVehType = data.type

          // arming status
          if ((data.baseMode & 128) !== 0 && this.statusArmed === 0) {
            console.log('Vehicle ARMED')
            this.statusArmed = 1
            this.eventEmitter.emit('armed')
          } else if ((data.baseMode & 128) === 0 && this.statusArmed === 1) {
            console.log('Vehicle DISARMED')
            this.statusArmed = 0
            this.eventEmitter.emit('disarmed')
          }
        } else if (packet.header.msgid === common.StatusText.MSG_ID) {
          // Remove whitespace
          this.statusText += data.text.trim().replace(/[^ -~]+/g, '') + '\n'
          // Bound the accumulator to the most-recent lines (see MAX_STATUSTEXT_LINES).
          // statusText always ends in '\n', so split() yields a trailing '' element;
          // keep the last MAX_STATUSTEXT_LINES entries plus that terminator.
          const stLines = this.statusText.split('\n')
          if (stLines.length > MAX_STATUSTEXT_LINES + 1) {
            this.statusText = stLines.slice(stLines.length - (MAX_STATUSTEXT_LINES + 1)).join('\n')
          }
        } else /* istanbul ignore next - msgid 148 (AUTOPILOT_VERSION) absent from node-mavlink REGISTRY; splitter skips unknown-registry packets before reaching here */ if (packet.header.msgid === 148) {
          // decode Ardupilot version (AUTOPILOT_VERSION message)
          this.fcVersion = this.decodeFlightSwVersion(data.flightSwVersion)
          console.log(this.fcVersion)
        }
      } catch (err) {
        // A malformed/truncated frame can make packet.protocol.data() throw a
        // RangeError, or a null STATUSTEXT make data.text.trim() throw a
        // TypeError. Drop the frame and keep the process alive rather than
        // letting the throw escape the callback and crash the companion.
        console.log('Error processing MAVLink packet: ', err)
      }
    })
  }

  decodeFlightSwVersion (flightSwVersion: number) {
    // decode 32 bit flight_sw_version mavlink parameter - corresponds to encoding in ardupilot GCS_MAVLINK::send_autopilot_version
    const fwTypeId = (flightSwVersion >> 0) % 256
    const patch = (flightSwVersion >> 8) % 256
    const minor = (flightSwVersion >> 16) % 256
    const major = (flightSwVersion >> 24) % 256
    let fwStr = ''

    switch (fwTypeId) {
      case 0:
        fwStr = 'dev'
        break
      case 64:
        fwStr = 'alpha'
        break
      case 128:
        fwStr = 'beta'
        break
      case 192:
        fwStr = 'rc'
        break
      case 255:
        fwStr = 'official'
        break
      default:
        fwStr = 'Unknown'
        break
    }
    return `${major}.${minor}.${patch}-${fwStr}`
  }

  close () {
    // close cleanly
    if (this.udpStream) {
      this.udpStream.close()
    }
  }

  restart () {
    // reset remote UDP stream
    this.close()
    this.RinudpPort = null
    this.RinudpIP = null
    this.targetSystem = null
    this.targetComponent = null

    this.udpStream = udp.createSocket('udp4')
    this.statusBytesPerSec = { avgBytesSec: 0, bytes: 0, lastTime: Date.now().valueOf() }
    // clear the STATUSTEXT accumulator so it doesn't survive (and keep growing)
    // across reconnects
    this.statusText = ''

    this.udpStream.on('message', (msg: Buffer, rinfo: { port: number, address: string }) => {
      // lock onto server port
      if (this.RinudpPort === null || this.RinudpIP === null) {
        this.RinudpPort = rinfo.port
        this.RinudpIP = rinfo.address
      } else {
        // calculate bytes/sec rate (once per 2 sec) and do DS requests
        if ((this.statusBytesPerSec.lastTime + 2000) < Date.now().valueOf()) {
          this.statusBytesPerSec.avgBytesSec = Math.round(1000 * this.statusBytesPerSec.bytes / (Date.now().valueOf() - this.statusBytesPerSec.lastTime))
          this.statusBytesPerSec.bytes = 0
          this.statusBytesPerSec.lastTime = Date.now().valueOf()

          if (this.enableDSRequest && this.targetSystem != null && this.targetComponent != null) {
            this.sendDSRequest()
          }
        } else {
          this.statusBytesPerSec.bytes += msg.length
        }
        this.inStream.write(msg)
      }
    })

    this.udpStream.bind(this.inudpPort, this.inudpIP)
  }

  sendData (msg: any, component?: any) {
    // Set the default target component if it wasn't specified
    if (component === null || component === undefined) {
      component = minimal.MavComponent.ONBOARD_COMPUTER
    }

    // msgbuf outgoing data
    if (this.RinudpPort === null || this.RinudpIP === null) {
      return
    }

    let protocol: any = null
    if (this.version === 2) {
      protocol = new MavLinkProtocolV2(this.targetSystem, component)
    } else {
      protocol = new MavLinkProtocolV1(this.targetSystem, component)
    }

    const buffer = protocol.serialize(msg, this.seq++)
    this.seq &= 255

    this.udpStream.send(buffer, this.RinudpPort, this.RinudpIP, (error: Error | null) => {
      if (error) {
        // A transient UDP send error (ECONNREFUSED from an ICMP port-unreachable,
        // EMSGSIZE, etc.) must NOT tear down the socket — closing it here would
        // drop the whole FC link. Log and keep the stream so the next send works.
        console.log(error)
      }
    })
  }

  sendHeartbeat (mavType: number, autopilot: number, component: number) {

    // Set defaults if parameters are not provided
    if (mavType === null || mavType === undefined) {
      mavType = minimal.MavType.ONBOARD_CONTROLLER
    }

    if (autopilot === null || autopilot === undefined) {
      autopilot = minimal.MavAutopilot.INVALID
    }

    if (component === null || component === undefined) {
      component = minimal.MavComponent.ONBOARD_COMPUTER
    }

      // create a heartbeat packet
    const heartbeatMessage = new minimal.Heartbeat()

    heartbeatMessage.type = mavType
    heartbeatMessage.autopilot = autopilot
    heartbeatMessage.mavlinkVersion = this.version
    // Set these to zero since we aren't currently using them
    heartbeatMessage.baseMode = 0
    heartbeatMessage.customMode = 0
    heartbeatMessage.systemStatus = 0

    this.sendData(heartbeatMessage, component)
  }

  sendCommandAck (commandReceived: number, commandResult: number, senderSysId: number, senderCompId: number, targetComponent: number) {
    // Set defaults if parameters are not provided
    if (commandResult === null || commandResult === undefined) {
      commandResult = 0
    }

    if (senderSysId === null || senderSysId === undefined) {
      senderSysId = 255
    }

    if (senderCompId === null || senderCompId === undefined) {
      senderCompId = minimal.MavComponent.MISSION_PLANNER
    }

    // create a CommandAck packet
    const commandAck = new common.CommandAck()
    commandAck.command = commandReceived
    // result = 0 for "accepted and executed"
    commandAck.result = commandResult
    // resultParam2 is for optional additional result information. Not currently used by rpanion.
    commandAck.resultParam2 = 0
    commandAck.targetSystem = senderSysId
    commandAck.targetComponent = targetComponent

    this.sendData(commandAck, senderCompId)
  }

  sendReboot () {
    // create a reboot packet
    const command = new common.PreflightRebootShutdownCommand(this.targetSystem, this.targetComponent)
    command.confirmation = 1
    command.autopilot = 1
    this.isRebooting = true
    this.sendData(command)
  }

  sendDSRequest () {
    // send datastream request
    const msg = new common.RequestDataStream()
    msg.targetSystem = this.targetSystem
    msg.targetComponent = this.targetComponent
    msg.reqStreamId = common.MavDataStream.ALL
    msg.reqMessageRate = 4
    msg.startStop = 1
    this.sendData(msg)
  }

  sendVersionRequest () {
    // request ArduPilot version
    const command = new common.RequestMessageCommand(this.targetSystem, this.targetComponent)
    command.messageId = 148 // AUTOPILOT_VERSION message ID
    command.confirmation = 1
    this.sendData(command)
  }

  sendParamRequestList () {
    // ask the flight controller to stream its entire parameter set
    // (PARAM_REQUEST_LIST). Each PARAM_VALUE carries the total count + its index,
    // so the caller can detect a complete download and re-request any gaps.
    const msg = new common.ParamRequestList()
    msg.targetSystem = this.targetSystem
    msg.targetComponent = this.targetComponent
    this.sendData(msg)
  }

  sendParamRead (paramIndex: number) {
    // re-request a single parameter by its index (PARAM_REQUEST_READ) — used to
    // fill gaps when PARAM_VALUE messages are dropped during a full download.
    const msg = new common.ParamRequestRead()
    msg.targetSystem = this.targetSystem
    msg.targetComponent = this.targetComponent
    msg.paramId = ''
    msg.paramIndex = paramIndex
    this.sendData(msg)
  }

  sendCanForward (bus: number) {
    // ask the FC to tunnel a CAN bus's frames to us over MAVLink (CAN_FRAME).
    // Forwarding lapses after ~5 s on the FC, so the caller re-sends this while
    // a DroneCAN scan is active (#feature-37). NOTE: MAV_CMD_CAN_FORWARD param1 is
    // 1-based on ArduPilot (bus = param1 - 1; param1 0 disables), so add 1.
    const cmd = new common.CanForwardCommand()
    cmd.targetSystem = this.targetSystem
    cmd.targetComponent = this.targetComponent
    cmd.bus = bus + 1
    cmd.confirmation = 0
    this.sendData(cmd)
  }

  sendCanFilter (bus: number, ids: number[]) {
    // restrict which CAN frames the FC forwards (CAN_FILTER_MODIFY) so its small
    // (~20-frame) forward buffer isn't saturated by bus traffic — multi-frame
    // DroneCAN responses (e.g. GetNodeInfo) are otherwise truncated. ArduPilot
    // bus is 1-based here too, and the ids list must be sorted (binary search).
    const msg = new common.CanFilterModify()
    msg.targetSystem = this.targetSystem
    msg.targetComponent = this.targetComponent
    msg.bus = bus + 1
    msg.operation = common.CanFilterOp.REPLACE
    const sorted = ids.slice().sort((a, b) => a - b).slice(0, 16)
    msg.numIds = sorted.length
    const padded = new Array(16).fill(0)
    sorted.forEach((v, i) => { padded[i] = v })
    msg.ids = padded
    this.sendData(msg)
  }

  sendCanFrame (bus: number, id: number, data: number[]) {
    // inject one CAN frame onto a forwarded bus (used to send DroneCAN service
    // requests, e.g. GetNodeInfo). `id` carries the 29-bit DroneCAN ID with the
    // extended-frame flag already set by the caller.
    const frame = new common.CanFrame()
    frame.targetSystem = this.targetSystem
    frame.targetComponent = this.targetComponent
    frame.bus = bus
    frame.id = id
    frame.len = data.length
    const padded = new Array(8).fill(0)
    for (let i = 0; i < data.length && i < 8; i++) {
      padded[i] = data[i]
    }
    frame.data = padded
    this.sendData(frame)
  }

  sendSetMessageInterval (msgId: number, intervalUsec: number) {
    // ask the FC to stream a specific message at a fixed interval
    // (MAV_CMD_SET_MESSAGE_INTERVAL). intervalUsec = -1 disables, 0 = default rate
    const command = new common.SetMessageIntervalCommand(this.targetSystem, this.targetComponent)
    command.messageId = msgId
    command.interval = intervalUsec
    command.confirmation = 1
    this.sendData(command)
  }

  sendRTCMMessage (gpmessage: Buffer, seq: number) {
    // create a rtcm message for the flight controller
    let flags = 0
    if (gpmessage.length > 180) {
      flags = 1
    }
    // add in the sequence number
    flags |= (seq & 0x1F) << 3

    if (gpmessage.length > 4 * 180) {
      // can't send this with GPS_RTCM_DATA
      return
    }
    // send data in 180 byte parts
    let buf = Buffer.from(gpmessage)
    const msgset: any[] = []
    const maxBytes = 180
    while (buf.length > maxBytes) {
      //if (buf.length > maxBytes) {
        // slice
        msgset.push(buf.slice(0, maxBytes))
        buf = buf.slice(maxBytes)
      //} else {
        // need to pad to 180 chars? No, message packing
        // will do this for us
      //  msgset.push(buf)
      //  break
      //}
    }
    msgset.push(buf)

    for (let i = 0, len = msgset.length; i < len; i++) {
      const msg = new common.GpsRtcmData()
      msg.flags = flags | (i << 1)
      msg.len = msgset[i].length
      msg.data = msgset[i]
      this.sendData(msg)
    }
  }

  autopilotFromID () {
    switch (this.statusFWName) {
      case 0:
        return 'Generic'
      case 3:
        return 'APM'
      case 4:
        return 'OpenPilot'
      case 12:
        return 'PX4'
      default:
        return 'Unknown'
    }
  }

  vehicleFromID () {
    switch (this.statusVehType) {
      case 0:
        return 'Generic'
      case 1:
        return 'Fixed Wing'
      case 2:
        return 'Quadcopter'
      case 4:
        return 'Helicopter'
      case 5:
        return 'Antenna Tracker'
      case 6:
        return 'GCS'
      case 10:
        return 'Ground Rover'
      case 11:
        return 'Boat'
      case 12:
        return 'Submarine'
      case 13:
        return 'Hexacopter'
      case 14:
        return 'Octocopter'
      case 15:
        return 'Tricopter'
      default:
        return 'Unknown'
    }
  }

  conStatusStr () {
    // connection status - connected, not connected, no packets for x sec
    if ((Date.now().valueOf()) - this.timeofLastPacket < 5000) {
      return 'Connected'
    } else if (this.timeofLastPacket > 0) {
      return 'Connection lost for ' + (Date.now().valueOf() - this.timeofLastPacket) / 1000 + ' seconds'
    } else {
      return 'Not connected'
    }
  }

  conStatusInt () {
    // connection status - connected (1), not connected (0), no packets for x sec (-1)
    if ((Date.now().valueOf()) - this.timeofLastPacket < 5000) {
      return 1
    } else if (this.timeofLastPacket > 0) {
      return -1
    } else {
      return 0
    }
  }
}

export = mavManager
