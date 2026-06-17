const fs = require('fs')
const events = require('events')
const path = require('path')
const { spawnSync } = require('child_process')

const FCLink = require('./fcLink')
const logpaths = require('./paths')
const serialDetection = require('./serialDetection')

// Max simultaneous telemetry input links (#311). Bounds the per-link loopback
// port range (monitor 14540+2i, DataFlash logger 14541+2i).
const MAX_LINKS = 4

class FCDetails {
  UDPoutputs: any
  settings: any
  mavlinkRouterPath: any
  enableDSRequest: any
  UDPBPort: any
  enableUDPB: any
  enableTCP: any
  enableHeartbeat: any
  doLogging: any
  eventEmitter: any
  links: any[]
  inputTypes: any
  mavlinkVersions: any
  baudRates: any
  serialDevices: any
  constructor (settings: any) {
    // all detected serial ports and baud rates
    this.serialDevices = []
    this.baudRates = [{ value: 9600, label: '9600' },
      { value: 19200, label: '19200' },
      { value: 38400, label: '38400' },
      { value: 57600, label: '57600' },
      { value: 111100, label: '111100' },
      { value: 115200, label: '115200' },
      { value: 230400, label: '230400' },
      { value: 256000, label: '256000' },
      { value: 460800, label: '460800' },
      { value: 500000, label: '500000' },
      { value: 921600, label: '921600' },
      { value: 1500000, label: '1500000' }]
    this.mavlinkVersions = [{ value: 1, label: '1.0' },
      { value: 2, label: '2.0' }]
    this.inputTypes = [{ value: 'UART', label: 'UART' },
      { value: 'UDP', label: 'UDP Server' }]

    // active telemetry input links (FCLink instances)
    this.links = []

    // For sending events outside of object
    this.eventEmitter = new events.EventEmitter()

    // UDP Outputs (shared across all links)
    this.UDPoutputs = []

    // Global output / behaviour options (apply to every link)
    this.enableHeartbeat = false
    this.enableTCP = false
    this.enableUDPB = true
    this.UDPBPort = 14550
    this.enableDSRequest = false
    this.doLogging = false

    // mavlink-routerd path (resolved lazily)
    this.mavlinkRouterPath = null

    // load settings
    this.settings = settings
    this.UDPoutputs = this.settings.value('flightcontroller.outputs', [])
    this.enableHeartbeat = this.settings.value('flightcontroller.enableHeartbeat', false)
    this.enableTCP = this.settings.value('flightcontroller.enableTCP', false)
    this.enableUDPB = this.settings.value('flightcontroller.enableUDPB', true)
    this.UDPBPort = this.settings.value('flightcontroller.UDPBPort', 14550)
    this.enableDSRequest = this.settings.value('flightcontroller.enableDSRequest', false)
    this.doLogging = this.settings.value('flightcontroller.doLogging', false)

    // restore previously-active links (migrating the old single-device config)
    const savedLinks = this.loadSavedLinks()
    if (savedLinks.length > 0) {
      this.restoreLinks(savedLinks)
    }
  }

  loadSavedLinks () {
    // new multi-link config, or migrate the legacy single-device one
    let savedLinks = this.settings.value('flightcontroller.links', null)
    if (savedLinks === null) {
      const oldDevice = this.settings.value('flightcontroller.activeDevice', null)
      const wasActive = this.settings.value('flightcontroller.active', false)
      savedLinks = (wasActive && oldDevice) ? [oldDevice] : []
    }
    return savedLinks
  }

  restoreLinks (savedLinks: any[]) {
    // re-open each saved link. UART links only start if the serial port is present.
    this.getDeviceSettings((err: Error | null, data: any) => {
      const present = data.serialPorts.map((d: any) => d.value)
      for (let i = 0; i < savedLinks.length && this.links.length < MAX_LINKS; i++) {
        const device = savedLinks[i]
        if (device.inputType === 'UART' && present.indexOf(device.serial) === -1) {
          console.log("Can't open saved FC " + device.serial + ', skipping')
          continue
        }
        const link = new FCLink(this.nextSlot(), device, this)
        link.startLink((startErr: string | null) => {
          if (startErr) {
            console.log("Can't open saved link: " + startErr)
          } else {
            this.links.push(link)
            link.startInterval()
          }
        })
      }
      this.saveSerialSettings()
    })
  }

  nextSlot () {
    // lowest free slot id in 0..MAX_LINKS-1
    const used = this.links.map((l) => l.id)
    for (let s = 0; s < MAX_LINKS; s++) {
      if (used.indexOf(s) === -1) {
        return s
      }
    }
    /* istanbul ignore next -- callers check MAX_LINKS before allocating, so a slot is always free */
    return -1
  }

  validMavlinkRouter () {
    // check mavlink-router is installed
    const ls = spawnSync('which', ['mavlink-routerd'])
    console.log(ls.stdout.toString())
    if (ls.stdout.toString().trim() == '') {
      // also check the parent directory
      const parentDir = path.dirname(__dirname)
      const mavlinkRouterPath = path.join(parentDir, 'mavlink-routerd')
      if (fs.existsSync(mavlinkRouterPath)) {
        console.log('Found mavlink-routerd in ' + parentDir)
        this.mavlinkRouterPath = parentDir + '/mavlink-routerd'
        return true
      }
      this.mavlinkRouterPath = null
      return false
    } else {
      console.log('Found mavlink-routerd in ' + ls.stdout.toString().trim())
      this.mavlinkRouterPath = ls.stdout.toString().trim()
      return true
    }
  }

  getUDPOutputs () {
    // get list of current UDP outputs
    const ret: any[] = []
    for (let i = 0, len = this.UDPoutputs.length; i < len; i++) {
      ret.push({ IPPort: this.UDPoutputs[i].IP + ':' + this.UDPoutputs[i].port })
    }
    return ret
  }

  addUDPOutput (newIP: string, newPort: number) {
    // add a new udp output, if not already in
    for (let i = 0, len = this.UDPoutputs.length; i < len; i++) {
      if (this.UDPoutputs[i].IP === newIP && this.UDPoutputs[i].port === newPort) {
        return this.getUDPOutputs()
      }
    }
    // not the internal monitor endpoint
    if (newIP === '127.0.0.1' && newPort === 14540) {
      return this.getUDPOutputs()
    }
    this.UDPoutputs.push({ IP: newIP, port: newPort })
    console.log('Added UDP Output ' + newIP + ':' + newPort)
    this.restartAllLinks()
    try {
      this.saveSerialSettings()
    } catch (e) { /* istanbul ignore next -- saveSerialSettings has its own try/catch and never throws */
      console.log(e)
    }
    return this.getUDPOutputs()
  }

  removeUDPOutput (remIP: string, remPort: number) {
    // not the internal monitor endpoint
    if (remIP === '127.0.0.1' && remPort === 14540) {
      return this.getUDPOutputs()
    }
    for (let i = 0, len = this.UDPoutputs.length; i < len; i++) {
      if (this.UDPoutputs[i].IP === remIP && this.UDPoutputs[i].port === remPort) {
        this.UDPoutputs.splice(i, 1)
        console.log('Removed UDP Output ' + remIP + ':' + remPort)
        this.restartAllLinks()
        try {
          this.saveSerialSettings()
        } catch (e) { /* istanbul ignore next -- saveSerialSettings has its own try/catch and never throws */
          console.log(e)
        }
        return this.getUDPOutputs()
      }
    }
    return this.getUDPOutputs()
  }

  restartAllLinks () {
    // bounce every link's router so output/option changes take effect
    for (let i = 0; i < this.links.length; i++) {
      const link = this.links[i]
      link.closeLink(() => {
        link.startLink((err: string | null) => {
          if (err) {
            console.log(err)
          }
        })
      })
    }
  }

  // primary link's binlog, for log management (logging is primary-only)
  get binlog () {
    return this.links.length > 0 ? this.links[0].binlog : null
  }

  getSystemStatus () {
    // primary (first) link's status — used for photo geotagging
    if (this.links.length > 0) {
      return this.links[0].getStatus()
    }
    return {
      numpackets: 0, FW: '', vehType: '', conStatus: 'Not connected',
      statusText: '', byteRate: 0, fcVersion: '',
      vehiclePosition: { lat: 0, lon: 0, alt: 0, relAlt: 0, hdg: 0 }
    }
  }

  getAllStatus () {
    // primary status at the top level (back-compat for the dashboard) plus the
    // full per-link array for the Flight Controller page's status cards
    const links = this.links.map((l) => l.getStatus())
    const primary = this.getSystemStatus()
    return { ...primary, links }
  }

  rebootFC () {
    // command every connected flight controller to reboot
    for (let i = 0; i < this.links.length; i++) {
      if (this.links[i].m !== null) {
        console.log('Rebooting FC on link ' + this.links[i].id)
        this.links[i].m.sendReboot()
      }
    }
  }

  startBinLogging () {
    // primary link only
    if (this.links.length > 0 && this.links[0].m !== null) {
      console.log('Bin log start request')
      this.links[0].m.sendBinStreamRequest()
    }
  }

  stopBinLogging () {
    if (this.links.length > 0 && this.links[0].m !== null) {
      console.log('Bin log stop request')
      this.links[0].m.sendBinStreamRequestStop()
    }
  }

  // ---- Parameter download (FC Configuration page) — primary link only, since
  //      parameters come from a single vehicle (not the multi-link fan-out) ----
  requestParams () {
    if (this.links.length > 0 && this.links[0].m !== null) {
      this.links[0].m.sendParamRequestList()
      return true
    }
    return false
  }

  requestParam (paramIndex: number) {
    if (this.links.length > 0 && this.links[0].m !== null) {
      this.links[0].m.sendParamRead(paramIndex)
    }
  }

  // ---- MAVLink fan-out (index.ts wires camera / RTCM / heartbeat through here) ----
  sendRTCMMessage (msg: any, seq: any) {
    for (let i = 0; i < this.links.length; i++) {
      if (this.links[i].m !== null) {
        this.links[i].m.sendRTCMMessage(msg, seq)
      }
    }
  }

  sendCommandAck (cmd: any, result: any, senderSysId: any, senderCompId: any, targetComponent: any) {
    for (let i = 0; i < this.links.length; i++) {
      if (this.links[i].m !== null) {
        this.links[i].m.sendCommandAck(cmd, result, senderSysId, senderCompId, targetComponent)
      }
    }
  }

  sendHeartbeat (mavType: any, autopilot: any, component: any) {
    for (let i = 0; i < this.links.length; i++) {
      if (this.links[i].m !== null) {
        this.links[i].m.sendHeartbeat(mavType, autopilot, component)
      }
    }
  }

  sendData (msg: any, senderCompId: any) {
    for (let i = 0; i < this.links.length; i++) {
      if (this.links[i].m !== null) {
        this.links[i].m.sendData(msg, senderCompId)
      }
    }
  }

  checkSerialPortIssues () {
    // Check if ModemManager is installed
    if (serialDetection.isModemManagerInstalled()) {
      return new Error('The ModemManager package is installed. This must be uninstalled (via sudo apt remove modemmanager), due to conflicts with serial ports')
    }
    // Check if serial console is active on Raspberry Pi
    if (fs.existsSync('/boot/cmdline.txt') && serialDetection.isPi()) {
      const data = fs.readFileSync('/boot/cmdline.txt', { encoding: 'utf8', flag: 'r' })
      if (data.includes('console=serial0')) {
        return new Error('Serial console is active on /dev/serial0. Use raspi-config to deactivate it')
      }
    }
    return null
  }

  async getDeviceSettings (callback: (...args: any[]) => void) {
    // detect serial ports + return current links and global options
    this.serialDevices = await serialDetection.detectSerialDevices()
    const retError = this.checkSerialPortIssues()
    return callback(retError, {
      serialPorts: this.serialDevices,
      baudRates: this.baudRates,
      mavVersions: this.mavlinkVersions,
      inputTypes: this.inputTypes,
      links: this.links.map((l: any) => ({
        id: l.id,
        inputType: l.device.inputType,
        serial: l.device.serial,
        baud: l.device.baud,
        mavversion: l.device.mavversion,
        udpInputPort: l.device.udpInputPort,
        label: l.deviceLabel()
      })),
      enableHeartbeat: this.enableHeartbeat,
      enableTCP: this.enableTCP,
      enableUDPB: this.enableUDPB,
      UDPBPort: this.UDPBPort,
      enableDSRequest: this.enableDSRequest,
      doLogging: this.doLogging
    })
  }

  validateDevice (inputType: string, device: string, baud: number, mavversion: number, udpInputPort: number) {
    // build + validate a link's device config. Returns { device } or { error }.
    if (inputType === 'UART') {
      let serial = null
      for (let i = 0, len = this.serialDevices.length; i < len; i++) {
        if (this.serialDevices[i].value === device) {
          serial = this.serialDevices[i].value
          break
        }
      }
      let validBaud = null
      for (let i = 0, len = this.baudRates.length; i < len; i++) {
        if (this.baudRates[i].value === baud) {
          validBaud = this.baudRates[i].value
          break
        }
      }
      if (serial === null || validBaud === null || mavversion === null) {
        return { error: 'Bad serial device or baud' }
      }
      return { device: { inputType: 'UART', serial, baud: validBaud, mavversion, udpInputPort: 9000 } }
    } else if (inputType === 'UDP') {
      return { device: { inputType: 'UDP', serial: null, baud: null, mavversion, udpInputPort } }
    }
    return { error: 'Unknown input type' }
  }

  isDuplicate (device: any) {
    // already have a link on this serial port / UDP input port?
    for (let i = 0; i < this.links.length; i++) {
      const d = this.links[i].device
      if (device.inputType === 'UART' && d.inputType === 'UART' && d.serial === device.serial) {
        return true
      }
      if (device.inputType === 'UDP' && d.inputType === 'UDP' && d.udpInputPort === device.udpInputPort) {
        return true
      }
    }
    return false
  }

  addLink (inputType: string, device: string, baud: number, mavversion: number, udpInputPort: number, callback: (err: Error | string | null, links: any[]) => void) {
    // add + start a new telemetry input link
    if (this.links.length >= MAX_LINKS) {
      return callback(new Error('Maximum of ' + MAX_LINKS + ' links reached'), this.linkList())
    }
    const result = this.validateDevice(inputType, device, baud, mavversion, udpInputPort)
    if (result.error) {
      return callback(new Error(result.error), this.linkList())
    }
    if (this.isDuplicate(result.device)) {
      return callback(new Error('A link on that input already exists'), this.linkList())
    }
    const link = new FCLink(this.nextSlot(), result.device, this)
    link.startLink((err: string | null) => {
      if (err) {
        console.log(err)
        return callback(err, this.linkList())
      }
      this.links.push(link)
      link.startInterval()
      this.saveSerialSettings()
      return callback(null, this.linkList())
    })
  }

  removeLink (id: number, callback: (err: Error | null, links: any[]) => void) {
    // stop + remove a link by id
    const idx = this.links.findIndex((l) => l.id === id)
    if (idx === -1) {
      return callback(new Error('No such link'), this.linkList())
    }
    const link = this.links[idx]
    link.destroy(() => {
      this.links.splice(idx, 1)
      this.saveSerialSettings()
      return callback(null, this.linkList())
    })
  }

  linkList () {
    return this.links.map((l: any) => ({ id: l.id, inputType: l.device.inputType, label: l.deviceLabel() }))
  }

  setGlobalOptions (enableHeartbeat: boolean, enableTCP: boolean, enableUDPB: boolean, UDPBPort: number, enableDSRequest: boolean, doLogging: boolean, callback: (err: null) => void) {
    // update shared options + apply to every running link
    this.enableHeartbeat = enableHeartbeat
    this.enableTCP = enableTCP
    this.enableUDPB = enableUDPB
    this.UDPBPort = UDPBPort
    this.enableDSRequest = enableDSRequest
    this.doLogging = doLogging
    for (let i = 0; i < this.links.length; i++) {
      this.links[i].m.enableDSRequest = enableDSRequest
    }
    this.restartAllLinks()
    this.saveSerialSettings()
    return callback(null)
  }

  saveSerialSettings () {
    try {
      this.settings.setValue('flightcontroller.links', this.links.map((l: any) => l.device))
      this.settings.setValue('flightcontroller.outputs', this.UDPoutputs)
      this.settings.setValue('flightcontroller.enableHeartbeat', this.enableHeartbeat)
      this.settings.setValue('flightcontroller.enableTCP', this.enableTCP)
      this.settings.setValue('flightcontroller.enableUDPB', this.enableUDPB)
      this.settings.setValue('flightcontroller.UDPBPort', this.UDPBPort)
      this.settings.setValue('flightcontroller.enableDSRequest', this.enableDSRequest)
      this.settings.setValue('flightcontroller.doLogging', this.doLogging)
      console.log('Saved FC settings')
    } catch (e) {
      console.log(e)
    }
  }
}

export = FCDetails
