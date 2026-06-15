// One MAVLink telemetry input link (#311 multi-link support). Encapsulates a
// single source's full lifecycle: its own mavlink-routerd process, its own
// mavManager monitor (on a per-link loopback port), auto-reconnect, optional
// DataFlash logger and per-link status. FCDetails orchestrates an array of these.
//
// The single-vehicle mavManager is reused unchanged — one instance per link.
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { common } = require('node-mavlink')
const mavManager = require('../mavlink/mavManager')
const logpaths = require('./paths')
const serialDetection = require('./serialDetection')

class FCLink {
  id: number
  device: any
  parent: any
  monitorPort: number
  loggerPort: number
  ownsShared: boolean
  router: any
  m: any
  intervalObj: any
  dflogger: any
  binlog: any
  active: boolean
  previousConnection: boolean
  vehiclePosition: any

  // id: the link's slot (0..N-1). Derives the per-link loopback ports and which
  //   link owns the bind-once outputs (slot 0 = primary → UDP broadcast + TCP).
  // device: { inputType, serial, baud, mavversion, udpInputPort }
  // parent: the FCDetails orchestrator (shared output config + router path + emitter)
  constructor (id: number, device: any, parent: any) {
    this.id = id
    this.device = device
    this.parent = parent
    this.monitorPort = 14540 + id * 2
    this.loggerPort = 14541 + id * 2
    this.ownsShared = (id === 0)
    this.router = null
    this.m = null
    this.intervalObj = null
    this.dflogger = null
    this.binlog = null
    this.active = false
    this.previousConnection = false
    this.vehiclePosition = { lat: 0, lon: 0, alt: 0, relAlt: 0, hdg: 0 }
  }

  deviceLabel () {
    if (this.device.inputType === 'UDP') {
      return 'UDP :' + this.device.udpInputPort
    }
    return this.device.serial + ' @ ' + this.device.baud
  }

  buildRouterCmd () {
    // monitor (this link's mavManager) + DataFlash logger endpoints are per-link
    const cmd = ['-e', '127.0.0.1:' + this.monitorPort, '-e', '127.0.0.1:' + this.loggerPort, '--tcp-port']
    // only the primary link binds the TCP server port
    if (this.ownsShared && this.parent.enableTCP === true) {
      cmd.push('5760')
    } else {
      cmd.push('0')
    }
    // shared GCS UDP outputs go to every link, so all vehicles reach all endpoints
    for (let i = 0, len = this.parent.UDPoutputs.length; i < len; i++) {
      cmd.push('-e')
      cmd.push(this.parent.UDPoutputs[i].IP + ':' + this.parent.UDPoutputs[i].port)
    }
    // only the primary link binds the UDP broadcast port
    if (this.ownsShared && this.parent.enableUDPB === true) {
      cmd.push('0.0.0.0:' + this.parent.UDPBPort)
    }
    // the input itself
    if (this.device.inputType === 'UART') {
      const serialPath = serialDetection.getSerialPathFromValue(this.device.serial, this.parent.serialDevices)
      cmd.push(serialPath + ':' + this.device.baud)
    } else if (this.device.inputType === 'UDP') {
      cmd.push('0.0.0.0:' + this.device.udpInputPort)
    }
    return cmd
  }

  startLink (callback: (err: string | null, success: boolean) => void) {
    if (this.device.inputType === 'UDP') {
      console.log('Link ' + this.id + ': Opening UDP Link 0.0.0.0:' + this.device.udpInputPort + ', MAV v' + this.device.mavversion)
    } else {
      console.log('Link ' + this.id + ': Opening UART Link ' + this.device.serial + ' @ ' + this.device.baud + ', MAV v' + this.device.mavversion)
    }

    const cmd = this.buildRouterCmd()
    console.log(cmd)

    // check mavlink-router exists (parent caches the resolved path)
    if (!this.parent.validMavlinkRouter()) {
      console.log('Could not find mavlink-routerd')
      this.active = false
      return callback('Could not find mavlink-routerd', false)
    }

    this.router = spawn(this.parent.mavlinkRouterPath, cmd)
    this.router.stdout.on('data', (data: Buffer) => {
      console.log(`stdout: ${data}`)
    })

    this.router.stderr.on('data', (data: Buffer) => {
      console.error(`stderr: ${data}`)
      if (data.toString().includes('Logging target') && data.toString().includes('.bin')) {
        // remove old log, if it exists and is <60kB (a stub from a failed start)
        try {
          if (this.binlog !== null) {
            const fileStat = fs.lstatSync(this.binlog)
            if (Math.round(fileStat.size / 1024) < 60) {
              fs.unlinkSync(this.binlog)
            }
          }
        } catch (err) {
          console.log(err)
        }
        const res = data.toString().split(' ')
        const curLog = (res[res.length - 1]).trim()
        this.binlog = path.join(logpaths.flightsLogsDir, curLog)
        console.log('Current log is: ' + this.binlog)
      }
    })

    this.router.on('close', (code: number | null) => {
      console.log(`Link ${this.id}: child process exited with code ${code}`)
      console.log('Closed Router')
      this.parent.eventEmitter.emit('stopLink', this.id)
    })

    console.log('Opened Router')

    // only build the mavlink processor on a fresh link, not a reconnect
    // (reconnect reuses this.m so listeners aren't stacked on every retry)
    if (this.m === null) {
      this.m = new mavManager(this.device.mavversion, '127.0.0.1', this.monitorPort, this.parent.enableDSRequest)
      this.m.eventEmitter.on('gotMessage', (packet: any, data: any) => {
        this.previousConnection = true
        if (packet.header.msgid === common.GlobalPositionInt.MSG_ID) {
          // MAVLink sends lat/lon as int * 1E7, alt as mm, heading as cdeg
          this.vehiclePosition.lat = data.lat / 10000000
          this.vehiclePosition.lon = data.lon / 10000000
          this.vehiclePosition.alt = data.alt / 1000
          this.vehiclePosition.relAlt = data.relativeAlt / 1000
          this.vehiclePosition.hdg = data.hdg / 100
        }
        this.parent.eventEmitter.emit('gotMessage', packet, data, this)
      })
      this.m.eventEmitter.on('armed', () => {
        this.parent.eventEmitter.emit('armed', this.id)
      })
      this.m.eventEmitter.on('disarmed', () => {
        this.parent.eventEmitter.emit('disarmed', this.id)
      })
    }

    this.parent.eventEmitter.emit('newLink', this.id)

    // the primary link runs the DataFlash logger (one logger avoids file collisions)
    if (this.ownsShared && this.parent.doLogging === true) {
      this.startDFLogger()
    }

    this.active = true
    return callback(null, true)
  }

  closeLink (callback: (err: null) => void) {
    this.active = false
    if (this.dflogger !== null) {
      this.stopDFLogger()
    }
    if (this.router && this.router.exitCode === null) {
      this.router.kill('SIGINT')
      console.log('Trying to close router')
      return callback(null)
    } else {
      console.log('Already Closed Router')
      this.parent.eventEmitter.emit('stopLink', this.id)
      return callback(null)
    }
  }

  startInterval () {
    // 1-sec loop: heartbeats (if enabled) + reconnect on link timeout
    this.intervalObj = setInterval(() => {
      if (this.parent.enableHeartbeat) {
        this.m.sendHeartbeat()
      }
      if (this.m && this.m.conStatusInt() === -1) {
        console.log('Link ' + this.id + ': Trying to reconnect FC...')
        this.closeLink(() => {
          this.startLink((err: string | null) => {
            if (err) {
              console.log(err)
            } else {
              this.m.restart()
            }
          })
        })
      }
    }, 1000)
  }

  stopInterval () {
    if (this.intervalObj) {
      clearInterval(this.intervalObj)
      this.intervalObj = null
    }
  }

  startDFLogger () {
    if (this.dflogger !== null) {
      console.log('DFLogger already running')
      return
    }
    console.log('Starting DataFlash logger')
    const pythonPath = logpaths.getPythonPath()
    const dfloggerPath = path.join(__dirname, '..', 'python', 'dflogger.py')
    this.dflogger = spawn(pythonPath, [
      dfloggerPath,
      '--connection', 'udp:127.0.0.1:' + this.loggerPort,
      '--logdir', logpaths.flightsLogsDir,
      '--rotate-on-disarm'
    ])
    this.dflogger.stdout.on('data', (data: Buffer) => {
      console.log(`DFLogger: ${data}`)
    })
    this.dflogger.stderr.on('data', (data: Buffer) => {
      console.error(`DFLogger stderr: ${data}`)
    })
    this.dflogger.on('close', (code: number | null) => {
      console.log(`DFLogger exited with code ${code}`)
      this.dflogger = null
    })
  }

  stopDFLogger () {
    if (this.dflogger === null) {
      console.log('DFLogger not running')
      return
    }
    console.log('Stopping DataFlash logger')
    this.dflogger.kill('SIGTERM')
    this.dflogger = null
  }

  destroy (callback: () => void) {
    // fully tear down this link: stop the reconnect loop, close the router and
    // release the mavManager's UDP monitor socket
    this.stopInterval()
    this.previousConnection = false
    this.closeLink(() => {
      if (this.m !== null) {
        this.m.close()
        this.m = null
      }
      return callback()
    })
  }

  getStatus () {
    // per-link status card
    const base = {
      id: this.id,
      device: this.deviceLabel(),
      inputType: this.device.inputType,
      active: this.active
    }
    if (this.m !== null) {
      return {
        ...base,
        numpackets: this.m.statusNumRxPackets,
        FW: this.m.autopilotFromID(),
        vehType: this.m.vehicleFromID(),
        conStatus: this.m.conStatusStr(),
        statusText: this.m.statusText,
        byteRate: this.m.statusBytesPerSec.avgBytesSec,
        fcVersion: this.m.fcVersion,
        vehiclePosition: this.vehiclePosition
      }
    }
    return {
      ...base,
      numpackets: 0,
      FW: '',
      vehType: '',
      conStatus: 'Not connected',
      statusText: '',
      byteRate: 0,
      fcVersion: '',
      vehiclePosition: { lat: 0, lon: 0, alt: 0, relAlt: 0, hdg: 0 }
    }
  }
}

export = FCLink
