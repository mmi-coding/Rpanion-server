/*
 * ltemodem.js
 * AT-command driven management of a SimCom SIM7600-series LTE modem.
 *
 * The modem's data path is USB RNDIS (usb0) - this module only talks to the
 * modem's AT command port (typically /dev/ttyUSB2) for status (signal,
 * registration, operator) and for (re)starting the RNDIS data call.
 * ModemManager is intentionally NOT used and must not be installed, as it
 * grabs the AT ports.
 */
const fs = require('fs')
const path = require('path')
const { SerialPort, ReadlineParser } = require('serialport')
const { detectSerialDevices } = require('./serialDetection.js')

// SIM7600 +CREG / +CGREG registration states
const REG_STATES = {
  0: 'Not registered',
  1: 'Registered (home)',
  2: 'Searching',
  3: 'Registration denied',
  4: 'Unknown',
  5: 'Registered (roaming)'
}

// +COPS <AcT> values
const ACT_NAMES = {
  0: 'GSM',
  1: 'GSM Compact',
  2: 'UMTS',
  3: 'GSM/EDGE',
  4: 'HSDPA',
  5: 'HSUPA',
  6: 'HSPA',
  7: 'LTE',
  9: 'LTE'
}

class LTEModem {
  constructor (settings) {
    this.settings = settings
    this.options = {
      enabled: this.settings.value('ltemodem.enabled', false),
      atPort: this.settings.value('ltemodem.atPort', '/dev/ttyUSB2'),
      baud: this.settings.value('ltemodem.baud', 115200),
      apn: this.settings.value('ltemodem.apn', ''),
      netInterface: this.settings.value('ltemodem.netInterface', 'usb0'),
      autoReconnect: this.settings.value('ltemodem.autoReconnect', false),
      pollInterval: this.settings.value('ltemodem.pollInterval', 5)
    }

    // persistent data usage counters (bytes, over the RNDIS interface)
    this.usage = {
      totalRx: this.settings.value('ltemodem.usageTotalRx', 0),
      totalTx: this.settings.value('ltemodem.usageTotalTx', 0),
      sessionRx: 0,
      sessionTx: 0
    }
    this.lastRawStats = null

    // live status, emitted over socket.io at 1Hz
    this.status = {
      enabled: this.options.enabled,
      available: false, // AT port open and modem responding
      error: '',
      signal: { raw: 99, dbm: null, percent: 0 },
      registration: 'Unknown',
      registered: false,
      operator: '',
      rat: '',
      band: '',
      ip: '',
      usage: this.usage,
      lastReconnect: null,
      reconnectCount: 0,
      lastUpdate: null
    }

    this.port = null
    this.parser = null
    this.portOpen = false
    this.atQueue = Promise.resolve()
    this.pending = null
    this.pollTimer = null
    this.polling = false
    this.lastReconnectAttempt = 0
    // overridable for tests
    this.netStatsBase = '/sys/class/net'

    if (this.options.enabled) {
      this.startMonitor()
    }
  }

  saveSettings () {
    this.settings.setValue('ltemodem.enabled', this.options.enabled)
    this.settings.setValue('ltemodem.atPort', this.options.atPort)
    this.settings.setValue('ltemodem.baud', this.options.baud)
    this.settings.setValue('ltemodem.apn', this.options.apn)
    this.settings.setValue('ltemodem.netInterface', this.options.netInterface)
    this.settings.setValue('ltemodem.autoReconnect', this.options.autoReconnect)
    this.settings.setValue('ltemodem.pollInterval', this.options.pollInterval)
  }

  // --- AT response parsers (pure, static for unit testing) ---

  // +CSQ: 18,99 -> rssi dBm = -113 + 2*raw, raw 0..31 (99 = unknown)
  static parseCSQ (lines) {
    for (const line of lines) {
      const m = line.match(/\+CSQ:\s*(\d+),\s*(\d+)/)
      if (m) {
        const raw = parseInt(m[1], 10)
        if (raw >= 0 && raw <= 31) {
          return { raw, dbm: -113 + 2 * raw, percent: Math.round((raw / 31) * 100) }
        }
        return { raw: 99, dbm: null, percent: 0 }
      }
    }
    return null
  }

  // +CREG: 0,1 (also +CGREG/+CEREG) -> registration state
  static parseCREG (lines) {
    for (const line of lines) {
      const m = line.match(/\+C(?:G|E)?REG:\s*\d+,\s*(\d+)/)
      if (m) {
        const stat = parseInt(m[1], 10)
        return {
          stat,
          text: REG_STATES[stat] || 'Unknown',
          registered: stat === 1 || stat === 5,
          roaming: stat === 5
        }
      }
    }
    return null
  }

  // +COPS: 0,0,"Vodafone",7 -> operator name + access technology
  static parseCOPS (lines) {
    for (const line of lines) {
      const m = line.match(/\+COPS:\s*\d+(?:,\s*\d+,\s*"([^"]*)"(?:,\s*(\d+))?)?/)
      if (m) {
        return {
          operator: m[1] || '',
          act: m[2] !== undefined ? (ACT_NAMES[parseInt(m[2], 10)] || '') : ''
        }
      }
    }
    return null
  }

  // +CPSI: LTE,Online,505-01,0x5A1E,187214780,257,EUTRAN-BAND3,1850,5,5,-94,-850,-545,15
  // -> system mode, operator MCC-MNC, band (LTE: RSRP/SINR too)
  static parseCPSI (lines) {
    for (const line of lines) {
      const m = line.match(/\+CPSI:\s*(.+)/)
      if (m) {
        const fields = m[1].split(',').map(f => f.trim())
        if (fields.length < 2 || fields[0] === 'NO SERVICE') {
          return { rat: fields[0] || '', online: false, mccmnc: '', band: '' }
        }
        const out = {
          rat: fields[0],
          online: fields[1].toLowerCase() === 'online',
          mccmnc: fields[2] || '',
          band: fields[6] || ''
        }
        if (fields[0] === 'LTE' && fields.length >= 14) {
          out.rsrp = parseInt(fields[11], 10) / 10 // dBm
          out.sinr = parseInt(fields[13], 10) // dB
        }
        return out
      }
    }
    return null
  }

  // +CGPADDR: 1,10.123.45.67 (sometimes quoted)
  static parseCGPADDR (lines) {
    for (const line of lines) {
      const m = line.match(/\+CGPADDR:\s*\d+,\s*"?([0-9.]+)"?/)
      if (m && m[1] !== '0.0.0.0') {
        return m[1]
      }
    }
    return null
  }

  // --- serial port handling ---

  openPort (callback) {
    if (this.portOpen) {
      return callback(null)
    }
    try {
      this.port = new SerialPort({ path: this.options.atPort, baudRate: this.options.baud, autoOpen: false })
    } catch (err) {
      return callback(err)
    }
    this.port.open((err) => {
      if (err) {
        this.port = null
        return callback(err)
      }
      this.portOpen = true
      this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\r\n' }))
      this.parser.on('data', (line) => this._onLine(line))
      this.port.on('close', () => {
        this.portOpen = false
        this.parser = null
      })
      this.port.on('error', (portErr) => {
        console.log('LTE modem port error: ' + portErr.toString())
        this.status.error = portErr.toString()
      })
      // disable command echo for clean parsing
      this.sendAT('ATE0', 2000).catch(() => {})
      return callback(null)
    })
  }

  closePort () {
    if (this.port && this.portOpen) {
      try {
        this.port.close()
      } catch (err) {
        console.log('LTE modem port close error: ' + err.toString())
      }
    }
    this.port = null
    this.parser = null
    this.portOpen = false
    this.pending = null
  }

  _onLine (line) {
    if (this.pending) {
      this.pending(line)
    }
    // anything else is an unsolicited result code - ignored
  }

  // send one AT command, resolve with all response lines (up to OK/ERROR).
  // Commands are queued - the modem handles one at a time
  sendAT (cmd, timeout = 3000) {
    const run = () => this._sendATNow(cmd, timeout)
    this.atQueue = this.atQueue.then(run, run)
    return this.atQueue
  }

  _sendATNow (cmd, timeout) {
    return new Promise((resolve, reject) => {
      if (!this.port || !this.portOpen) {
        return reject(new Error('AT port not open'))
      }
      const lines = []
      const timer = setTimeout(() => {
        this.pending = null
        reject(new Error('AT timeout: ' + cmd))
      }, timeout)
      this.pending = (line) => {
        const l = line.toString().trim()
        if (l === '') {
          return
        }
        lines.push(l)
        if (l === 'OK' || l === 'ERROR' || l.startsWith('+CME ERROR') || l.startsWith('+CMS ERROR')) {
          clearTimeout(timer)
          this.pending = null
          // ERROR responses still resolve - callers inspect the lines
          resolve(lines)
        }
      }
      this.port.write(cmd + '\r')
    })
  }

  // --- data usage over the RNDIS interface ---

  readNetStats () {
    const base = path.join(this.netStatsBase, this.options.netInterface, 'statistics')
    try {
      const rx = parseInt(fs.readFileSync(path.join(base, 'rx_bytes'), 'utf8'), 10)
      const tx = parseInt(fs.readFileSync(path.join(base, 'tx_bytes'), 'utf8'), 10)
      if (isNaN(rx) || isNaN(tx)) {
        return null
      }
      return { rx, tx }
    } catch (err) {
      return null
    }
  }

  updateUsage () {
    const raw = this.readNetStats()
    if (raw === null) {
      return
    }
    if (this.lastRawStats === null) {
      this.lastRawStats = raw
      return
    }
    let dRx = raw.rx - this.lastRawStats.rx
    let dTx = raw.tx - this.lastRawStats.tx
    if (dRx < 0 || dTx < 0) {
      // interface counter reset (reboot / replug) - count from zero
      dRx = raw.rx
      dTx = raw.tx
    }
    this.usage.totalRx += dRx
    this.usage.totalTx += dTx
    this.usage.sessionRx += dRx
    this.usage.sessionTx += dTx
    this.lastRawStats = raw
    this.settings.setValue('ltemodem.usageTotalRx', this.usage.totalRx)
    this.settings.setValue('ltemodem.usageTotalTx', this.usage.totalTx)
  }

  resetUsage () {
    this.usage.totalRx = 0
    this.usage.totalTx = 0
    this.usage.sessionRx = 0
    this.usage.sessionTx = 0
    this.settings.setValue('ltemodem.usageTotalRx', 0)
    this.settings.setValue('ltemodem.usageTotalTx', 0)
  }

  // --- monitoring loop ---

  startMonitor () {
    this.stopMonitor()
    this.pollTimer = setInterval(() => this.doPoll(), this.options.pollInterval * 1000)
    // first poll immediately
    this.doPoll()
  }

  stopMonitor () {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    this.closePort()
    this.status.available = false
  }

  async doPoll () {
    if (this.polling) {
      return
    }
    this.polling = true
    try {
      // usage is independent of the AT port
      this.updateUsage()

      if (!this.portOpen) {
        await new Promise((resolve) => {
          this.openPort((err) => {
            if (err) {
              this.status.available = false
              this.status.error = 'AT port: ' + err.message
            }
            resolve()
          })
        })
        if (!this.portOpen) {
          return
        }
      }

      const csq = LTEModem.parseCSQ(await this.sendAT('AT+CSQ'))
      if (csq) {
        this.status.signal = csq
      }
      const creg = LTEModem.parseCREG(await this.sendAT('AT+CREG?'))
      if (creg) {
        this.status.registration = creg.text
        this.status.registered = creg.registered
      }
      const cops = LTEModem.parseCOPS(await this.sendAT('AT+COPS?'))
      if (cops) {
        this.status.operator = cops.operator
        if (cops.act !== '') {
          this.status.rat = cops.act
        }
      }
      const cpsi = LTEModem.parseCPSI(await this.sendAT('AT+CPSI?'))
      if (cpsi) {
        this.status.rat = cpsi.rat || this.status.rat
        this.status.band = cpsi.band
        if (cpsi.rsrp !== undefined) {
          this.status.signal.rsrp = cpsi.rsrp
          this.status.signal.sinr = cpsi.sinr
        }
      }
      this.status.ip = LTEModem.parseCGPADDR(await this.sendAT('AT+CGPADDR=1')) || ''

      this.status.available = true
      this.status.error = ''
      this.status.lastUpdate = new Date().toISOString()

      // auto-reconnect: registered on the network but no PDP/data address
      if (this.options.autoReconnect && this.status.registered && this.status.ip === '' &&
          Date.now() - this.lastReconnectAttempt > 30000) {
        console.log('LTE modem: registered but no data connection - reconnecting')
        await this.reconnect()
      }
    } catch (err) {
      this.status.available = false
      this.status.error = err.message
      // a dead port (unplugged modem) won't recover - force a reopen next poll
      if (err.message.includes('AT timeout')) {
        this.closePort()
      }
    } finally {
      this.polling = false
    }
  }

  // (re)start the RNDIS data call
  async reconnect () {
    this.lastReconnectAttempt = Date.now()
    this.status.lastReconnect = new Date().toISOString()
    this.status.reconnectCount += 1
    if (this.options.apn !== '') {
      await this.sendAT(`AT+CGDCONT=1,"IP","${this.options.apn}"`, 5000)
    }
    // SIM7600 RNDIS dial. $QCRMCALL=1,1 starts the v4 data call on the
    // RNDIS interface; harmless if already up
    const resp = await this.sendAT('AT$QCRMCALL=1,1', 15000)
    return resp
  }

  // raw AT console for the web UI
  sendUserCommand (cmd, callback) {
    if (typeof cmd !== 'string' || !/^at/i.test(cmd.trim()) || cmd.trim().length > 128) {
      return callback(new Error('Commands must start with AT and be under 128 characters'), null)
    }
    if (!this.portOpen) {
      return callback(new Error('AT port not open - enable the modem monitor first'), null)
    }
    this.sendAT(cmd.trim(), 10000)
      .then((lines) => callback(null, lines))
      .catch((err) => callback(err, null))
  }

  async getSerialPorts () {
    try {
      return await detectSerialDevices()
    } catch (err) {
      console.log('LTE modem: serial detection failed: ' + err.toString())
      return []
    }
  }

  getSettings () {
    return { ...this.options }
  }

  getStatus () {
    return { ...this.status, enabled: this.options.enabled, usage: { ...this.usage } }
  }

  setSettings (newSettings, callback) {
    const errors = []
    const next = { ...this.options }

    if (typeof newSettings.enabled === 'boolean') {
      next.enabled = newSettings.enabled
    }
    if (newSettings.atPort !== undefined) {
      if (typeof newSettings.atPort !== 'string' || !/^[\w/.:-]{0,128}$/.test(newSettings.atPort)) {
        errors.push('Invalid AT port')
      } else {
        next.atPort = newSettings.atPort
      }
    }
    if (newSettings.baud !== undefined) {
      const baud = parseInt(newSettings.baud, 10)
      if (![9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 3000000].includes(baud)) {
        errors.push('Invalid baud rate')
      } else {
        next.baud = baud
      }
    }
    if (newSettings.apn !== undefined) {
      if (typeof newSettings.apn !== 'string' || !/^[\w.-]{0,64}$/.test(newSettings.apn)) {
        errors.push('Invalid APN')
      } else {
        next.apn = newSettings.apn
      }
    }
    if (newSettings.netInterface !== undefined) {
      if (typeof newSettings.netInterface !== 'string' || !/^[a-zA-Z0-9@.-]{1,15}$/.test(newSettings.netInterface)) {
        errors.push('Invalid network interface name')
      } else {
        next.netInterface = newSettings.netInterface
      }
    }
    if (typeof newSettings.autoReconnect === 'boolean') {
      next.autoReconnect = newSettings.autoReconnect
    }
    if (newSettings.pollInterval !== undefined) {
      const pollInterval = parseInt(newSettings.pollInterval, 10)
      if (isNaN(pollInterval) || pollInterval < 2 || pollInterval > 120) {
        errors.push('Poll interval must be 2-120 seconds')
      } else {
        next.pollInterval = pollInterval
      }
    }
    if (next.enabled && next.atPort === '') {
      errors.push('An AT port is required to enable the modem monitor')
    }

    if (errors.length > 0) {
      return callback(new Error(errors.join('; ')))
    }

    const wasEnabled = this.options.enabled
    this.options = next
    this.status.enabled = next.enabled
    this.saveSettings()

    // (re)start or stop the monitor to apply changes
    if (next.enabled) {
      this.startMonitor()
    } else if (wasEnabled) {
      this.stopMonitor()
    }
    return callback(null)
  }

  quitting () {
    this.stopMonitor()
  }
}

module.exports = LTEModem
