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
const os = require('os')
const { spawn, execFile } = require('child_process')
const { SerialPort, ReadlineParser } = require('serialport')
// required as an object (not destructured) so tests can stub the detection seam
const serialDetection = require('./serialDetection')

// Baud rates accepted on the modem's AT / PPP serial ports
const VALID_BAUDS = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 3000000]

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

// baud rates tried when probing a real UART (GPIO header). The SIM7600
// default is 115200 (or autobaud, which syncs on the "AT" prefix). USB CDC
// ports ignore the baud setting entirely, so they get a single attempt
const UART_PROBE_BAUDS = [115200, 921600, 460800, 9600]

// kernel drivers behind a cellular modem's network interface
const MODEM_NET_DRIVERS = ['rndis_host', 'cdc_ether', 'cdc_ncm', 'cdc_mbim', 'qmi_wwan']

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
      pollInterval: this.settings.value('ltemodem.pollInterval', 5),
      // Data path: 'rndis' (USB net device, default), 'qmi' (libqmi/qmicli) or
      // 'ppp' (pppd dial). ModemManager is never used in any mode.
      dataPathMode: this.settings.value('ltemodem.dataPathMode', 'rndis'),
      qmiDevice: this.settings.value('ltemodem.qmiDevice', '/dev/cdc-wdm0'),
      pppPort: this.settings.value('ltemodem.pppPort', ''),
      pppBaud: this.settings.value('ltemodem.pppBaud', 115200)
    }
    // QMI packet-data handle/CID captured at connect, used for a clean stop
    this.qmiHandle = null
    this.qmiCid = null

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
    this.scanning = false
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
    this.settings.setValue('ltemodem.dataPathMode', this.options.dataPathMode)
    this.settings.setValue('ltemodem.qmiDevice', this.options.qmiDevice)
    this.settings.setValue('ltemodem.pppPort', this.options.pppPort)
    this.settings.setValue('ltemodem.pppBaud', this.options.pppBaud)
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

  // +CPIN: READY (or SIM PIN / SIM PUK), +CME ERROR: SIM not inserted
  static parsePIN (lines) {
    for (const line of lines) {
      const m = line.match(/\+CPIN:\s*(.+)/)
      if (m) {
        return { ready: m[1].trim() === 'READY', text: m[1].trim() }
      }
      const e = line.match(/\+CME ERROR:\s*(.+)/)
      if (e) {
        return { ready: false, text: e[1].trim() }
      }
    }
    return null
  }

  // AT+CGMM / AT+CGMI answer with a bare text line before OK
  static parseIdentLine (lines) {
    if (!lines) {
      return ''
    }
    for (const line of lines) {
      if (line === 'OK' || line === 'ERROR' || line.startsWith('+') || /^AT/i.test(line)) {
        continue
      }
      return line
    }
    return ''
  }

  static isModemNetDriver (driver) {
    return MODEM_NET_DRIVERS.includes(driver)
  }

  // Build the list of serial paths worth probing for a modem: every
  // detected port (USB serial and board UARTs) plus the currently
  // configured AT port, minus the flight controller's link - AT chatter
  // must never land in the MAVLink stream
  static buildProbeCandidates (detected, currentAtPort, excludePaths) {
    const seen = new Set()
    const candidates = []
    const add = (p) => {
      if (!p || p === '' || seen.has(p)) {
        return
      }
      seen.add(p)
      if (excludePaths.includes(p)) {
        candidates.push({ path: p, skipped: true, reason: 'in use by the flight controller link' })
        return
      }
      const usb = /ttyUSB|ttyACM/.test(p)
      candidates.push({ path: p, bauds: usb ? [115200] : UART_PROBE_BAUDS })
    }
    for (const d of detected) {
      add(d.path)
    }
    add(currentAtPort)
    return candidates
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
    if (this.polling || this.scanning) {
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
        await this.connectData()
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
    this._markReconnect()
    if (this.options.apn !== '') {
      await this.sendAT(`AT+CGDCONT=1,"IP","${this.options.apn}"`, 5000)
    }
    // SIM7600 RNDIS dial. $QCRMCALL=1,1 starts the v4 data call on the
    // RNDIS interface; harmless if already up
    const resp = await this.sendAT('AT$QCRMCALL=1,1', 15000)
    return resp
  }

  // --- multi-mode data path (RNDIS / QMI / PPP) ---
  // Promise-wrapping execFile seam (single stub point for tests; never runs
  // ModemManager). Rejects with the command's stderr (or error message).
  _exec (cmd, args) {
    return new Promise((resolve, reject) => {
      execFile(cmd, args, (error, stdout, stderr) => {
        if (error) {
          const msg = (stderr && stderr.toString().trim()) ? stderr.toString().trim() : error.message
          return reject(new Error(msg))
        }
        return resolve(stdout.toString())
      })
    })
  }

  // bookkeeping shared by every connect path
  _markReconnect () {
    this.lastReconnectAttempt = Date.now()
    this.status.lastReconnect = new Date().toISOString()
    this.status.reconnectCount += 1
  }

  // bring the data call up, dispatching on the configured mode
  async connectData () {
    if (this.options.dataPathMode === 'qmi') {
      return this._qmiConnect()
    }
    if (this.options.dataPathMode === 'ppp') {
      return this._pppConnect()
    }
    return this.reconnect()
  }

  // bring the data call down, dispatching on the configured mode
  async disconnectData () {
    if (this.options.dataPathMode === 'qmi') {
      return this._qmiStop()
    }
    if (this.options.dataPathMode === 'ppp') {
      return this._pppStop()
    }
    // RNDIS: stop the QCRMCALL data call
    return this.sendAT('AT$QCRMCALL=0,1', 15000)
  }

  // QMI via libqmi (no ModemManager). Starts the WDS network and captures the
  // packet-data handle/CID for a clean stop, then leases an address via DHCP.
  async _qmiConnect () {
    this._markReconnect()
    // Raw-IP framing is set automatically by the shipped udev rule
    // (77-rpanion-qmi-rawip.rules) when the qmi_wwan interface appears; just
    // ensure it's up before starting the bearer + leasing an address.
    await this._exec('sudo', ['ip', 'link', 'set', this.options.netInterface, 'up'])
    const out = await this._exec('sudo', ['qmicli', '-d', this.options.qmiDevice, `--wds-start-network=apn='${this.options.apn}',ip-type=4`, '--client-no-release-cid'])
    const hMatch = out.match(/handle:\s*'?(\d+)'?/i)
    const cMatch = out.match(/CID:\s*'?(\d+)'?/i)
    this.qmiHandle = hMatch ? hMatch[1] : null
    this.qmiCid = cMatch ? cMatch[1] : null
    await this._exec('sudo', ['udhcpc', '-q', '-i', this.options.netInterface])
    return ['QMI network started']
  }

  async _qmiStop () {
    if (this.qmiHandle) {
      await this._exec('sudo', ['qmicli', '-d', this.options.qmiDevice, `--wds-stop-network=${this.qmiHandle}`, `--client-cid=${this.qmiCid}`])
      this.qmiHandle = null
      this.qmiCid = null
    } else {
      // no tracked session - just take the interface down
      await this._exec('sudo', ['ip', 'link', 'set', this.options.netInterface, 'down'])
    }
    return ['QMI network stopped']
  }

  // PPP via pppd dialling *99# on the modem's serial port. Never dials the
  // flight-controller UART.
  async _pppConnect () {
    this._markReconnect()
    const port = this.options.pppPort || this.options.atPort
    const fcDevice = this.settings.value('flightcontroller.activeDevice', null)
    const fcSerial = fcDevice && fcDevice.serial
    if (fcSerial && fcSerial === port) {
      throw new Error('Refusing to dial PPP on the flight controller port')
    }
    const chat = "chat -v '' AT OK ATD*99# CONNECT ''"
    await this._exec('sudo', ['pppd', port, String(this.options.pppBaud), 'noauth', 'defaultroute', 'usepeerdns', 'connect', chat])
    return ['PPP started']
  }

  async _pppStop () {
    await this._exec('sudo', ['poff'])
    return ['PPP stopped']
  }

  // Switch the modem's USB composition by PID (e.g. 9001=QMI, 9011=RNDIS) via
  // AT+CUSBPIDSWITCH. This REBOOTS the modem and re-enumerates its USB
  // interfaces, so the AT port drops out for ~30s afterwards.
  async setUsbMode (pid) {
    return this.sendAT(`AT+CUSBPIDSWITCH=${pid},1,1`, 15000)
  }

  // --- modem discovery ---

  // Probe one serial path at one baud rate: open it, expect OK to AT,
  // then identify the modem. Self-contained session - does not touch the
  // monitor's port object
  probeAttempt (devPath, baud) {
    return new Promise((resolve) => {
      let port
      try {
        port = new SerialPort({ path: devPath, baudRate: baud, autoOpen: false })
      } catch (err) {
        return resolve({ ok: false, error: err.message })
      }
      port.open((err) => {
        if (err) {
          return resolve({ ok: false, error: err.message })
        }
        const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }))
        let pending = null
        parser.on('data', (line) => {
          if (pending) {
            pending(line.toString().trim())
          }
        })
        port.on('error', () => {})
        const sendCmd = (cmd, timeout) => new Promise((res) => {
          const lines = []
          const timer = setTimeout(() => {
            pending = null
            res(null)
          }, timeout)
          pending = (l) => {
            if (l === '') {
              return
            }
            lines.push(l)
            if (l === 'OK' || l === 'ERROR' || l.startsWith('+CME ERROR')) {
              clearTimeout(timer)
              pending = null
              res(lines)
            }
          }
          port.write(cmd + '\r')
        })
        const done = (result) => {
          try {
            port.close()
          } catch (closeErr) { /* already closed */ }
          resolve(result)
        }
        // echo off first (also syncs an autobauding UART), then the handshake.
        // A GPS/NMEA port streams sentences but never answers OK - it times out
        sendCmd('ATE0', 800)
          .then(() => sendCmd('AT', 1200))
          .then(async (resp) => {
            if (resp === null || !resp.includes('OK')) {
              return done({ ok: false, error: 'no response to AT' })
            }
            const model = LTEModem.parseIdentLine(await sendCmd('AT+CGMM', 1000))
            const manufacturer = LTEModem.parseIdentLine(await sendCmd('AT+CGMI', 1000))
            done({ ok: true, model, manufacturer })
          })
      })
    })
  }

  // try a candidate at each of its baud rates until one answers
  async probePort (candidate) {
    for (const baud of candidate.bauds) {
      const r = await this.probeAttempt(candidate.path, baud)
      if (r.ok) {
        return { path: candidate.path, baud, ok: true, model: r.model, manufacturer: r.manufacturer }
      }
    }
    return { path: candidate.path, ok: false }
  }

  // Scan all candidate serial ports (USB and UART) for an AT-responding
  // modem and list candidate data network interfaces. Recommends the best
  // match of each
  async detectModem () {
    if (this.scanning) {
      throw new Error('A modem scan is already running')
    }
    this.scanning = true
    try {
      const detected = await this.getSerialPorts()
      const exclude = []
      const fcDevice = this.settings.value('flightcontroller.activeDevice', null)
      if (fcDevice !== null && fcDevice.serial !== undefined) {
        exclude.push(fcDevice.serial)
        const fcPath = serialDetection.getSerialPathFromValue(fcDevice.serial, detected)
        if (fcPath !== null) {
          exclude.push(fcPath)
        }
      }
      const candidates = LTEModem.buildProbeCandidates(detected, this.options.atPort, exclude)

      // release the monitor's port so the scan can open it - the poll
      // loop reopens it lazily once the scan is over
      this.closePort()

      const results = []
      for (const c of candidates) {
        if (c.skipped) {
          results.push({ path: c.path, ok: false, skipped: true, reason: c.reason })
          continue
        }
        results.push(await this.probePort(c))
      }

      // recommend: SIMCOM-identified ports first, then lowest path - a
      // SIM7600 answers AT on two USB ports (ttyUSB2 and ttyUSB3)
      const hits = results.filter(r => r.ok)
      const simcom = hits.filter(r => /SIM\d{4}|SIMCOM/i.test((r.model || '') + ' ' + (r.manufacturer || '')))
      const pool = simcom.length > 0 ? simcom : hits
      if (pool.length > 0) {
        pool.sort((a, b) => a.path.localeCompare(b.path))[0].recommended = true
      }

      const interfaces = this.listNetInterfaces()
      const modemIfaces = interfaces.filter(i => i.modemLike)
      if (modemIfaces.length > 0) {
        modemIfaces[0].recommended = true
      }
      return { ports: results, interfaces }
    } finally {
      this.scanning = false
    }
  }

  // list network interfaces with their kernel driver - the modem's RNDIS
  // device shows up as rndis_host/cdc_ether
  listNetInterfaces () {
    const out = []
    let names = []
    try {
      names = fs.readdirSync(this.netStatsBase)
    } catch (err) {
      return out
    }
    const addrs = this._netIfaces()
    for (const name of names) {
      if (name === 'lo') {
        continue
      }
      let driver = ''
      try {
        driver = path.basename(fs.readlinkSync(path.join(this.netStatsBase, name, 'device', 'driver')))
      } catch (err) { /* virtual interface - no driver link */ }
      let operstate = ''
      try {
        operstate = fs.readFileSync(path.join(this.netStatsBase, name, 'operstate'), 'utf8').trim()
      } catch (err) { /* ignore */ }
      const v4 = (addrs[name] || []).find(a => a.family === 'IPv4' || a.family === 4)
      out.push({
        name,
        driver,
        modemLike: LTEModem.isModemNetDriver(driver),
        operstate,
        ipv4: v4 ? v4.address : ''
      })
    }
    return out
  }

  // overridable for tests
  _netIfaces () {
    return os.networkInterfaces()
  }

  // ping through a specific interface - proves the route over the modem,
  // not whatever the default route happens to be. Overridable for tests
  _ping (iface, host) {
    return new Promise((resolve) => {
      const p = spawn('ping', ['-I', iface, '-c', '2', '-W', '3', host])
      let out = ''
      p.stdout.on('data', (d) => { out += d.toString() })
      p.stderr.on('data', (d) => { out += d.toString() })
      p.on('error', (err) => resolve({ ok: false, detail: err.message }))
      p.on('close', (code) => {
        const m = out.match(/rtt [^=]*= ([\d./]+)/)
        resolve({
          ok: code === 0,
          detail: code === 0
            ? (m ? 'rtt ' + m[1] + ' ms' : 'reachable')
            : 'unreachable (' + (out.trim().split('\n').pop() || 'no output') + ')'
        })
      })
    })
  }

  // --- staged connection test ---

  // Run the whole chain: AT port -> modem -> SIM -> signal -> registration
  // -> PDP address -> network interface -> internet. Returns one
  // {name, pass, detail} per step; pass is null for skipped steps
  async testConnection (pingHost = '8.8.8.8') {
    const steps = []
    const add = (name, pass, detail) => steps.push({ name, pass, detail })

    // 1. AT port + modem responding
    let openedHere = false
    if (!this.portOpen) {
      const err = await new Promise((resolve) => this.openPort(resolve))
      if (err) {
        add('AT port', false, this.options.atPort + ': ' + err.message)
      } else {
        openedHere = true
      }
    }
    let atOk = this.portOpen
    if (atOk) {
      try {
        const resp = await this.sendAT('AT', 3000)
        atOk = resp.includes('OK')
        add('AT port', atOk, this.options.atPort + ' @ ' + this.options.baud +
          (atOk ? '' : ': modem answered ' + resp.join(' ')))
      } catch (err) {
        atOk = false
        add('AT port', false, this.options.atPort + ': ' + err.message)
      }
    }

    if (atOk) {
      // 2. identify
      try {
        const model = LTEModem.parseIdentLine(await this.sendAT('AT+CGMM', 3000))
        add('Modem model', model !== '', model !== '' ? model : 'no model string')
      } catch (err) {
        add('Modem model', false, err.message)
      }
      // 3. SIM
      try {
        const pin = LTEModem.parsePIN(await this.sendAT('AT+CPIN?', 5000))
        add('SIM card', pin !== null && pin.ready, pin === null ? 'no response' : pin.text)
      } catch (err) {
        add('SIM card', false, err.message)
      }
      // 4. signal
      try {
        const csq = LTEModem.parseCSQ(await this.sendAT('AT+CSQ'))
        add('Signal', csq !== null && csq.dbm !== null,
          csq !== null && csq.dbm !== null ? csq.dbm + ' dBm (' + csq.percent + '%)' : 'no signal reading - check the antenna')
      } catch (err) {
        add('Signal', false, err.message)
      }
      // 5. registration
      try {
        const creg = LTEModem.parseCREG(await this.sendAT('AT+CREG?'))
        const cops = LTEModem.parseCOPS(await this.sendAT('AT+COPS?'))
        add('Network registration', creg !== null && creg.registered,
          (creg !== null ? creg.text : 'unknown') +
          (cops !== null && cops.operator !== '' ? ' - ' + cops.operator : ''))
      } catch (err) {
        add('Network registration', false, err.message)
      }
      // 6. data call
      try {
        const ip = LTEModem.parseCGPADDR(await this.sendAT('AT+CGPADDR=1'))
        add('Data call (PDP address)', ip !== null,
          ip !== null ? ip : 'no IP from the network - try "Reconnect data call" and check the APN')
      } catch (err) {
        add('Data call (PDP address)', false, err.message)
      }
    } else {
      for (const name of ['Modem model', 'SIM card', 'Signal', 'Network registration', 'Data call (PDP address)']) {
        add(name, null, 'skipped - AT port not available')
      }
    }

    // 7. data network interface - independent of the AT link
    const iface = this.listNetInterfaces().find(i => i.name === this.options.netInterface)
    let ifaceOk = false
    if (iface === undefined) {
      add('Network interface', false, this.options.netInterface +
        ' not found. If the modem is on USB, switch it to RNDIS mode (AT+CUSBPIDSWITCH=9011,1,1). ' +
        'If it is connected by UART only, the UART carries AT control - the data path needs the USB cable')
    } else if (iface.ipv4 === '') {
      add('Network interface', false, this.options.netInterface + ' (' +
        (iface.driver !== '' ? iface.driver : 'unknown driver') + ', ' + iface.operstate +
        ') has no IPv4 address - check the data call and DHCP on the interface')
    } else {
      ifaceOk = true
      add('Network interface', true, this.options.netInterface + ' (' +
        (iface.driver !== '' ? iface.driver : 'unknown driver') + ') ' + iface.ipv4)
    }

    // 8. reachability through that interface
    if (ifaceOk) {
      const ping = await this._ping(this.options.netInterface, pingHost)
      add('Internet (ping ' + pingHost + ')', ping.ok, ping.detail)
    } else {
      add('Internet (ping ' + pingHost + ')', null, 'skipped - no usable interface')
    }

    // leave the port the way we found it when the monitor is off
    if (openedHere && !this.options.enabled) {
      this.closePort()
    }
    return steps
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
      return await serialDetection.detectSerialDevices()
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
      if (!VALID_BAUDS.includes(baud)) {
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
    if (newSettings.dataPathMode !== undefined) {
      if (!['rndis', 'qmi', 'ppp'].includes(newSettings.dataPathMode)) {
        errors.push('Invalid data path mode')
      } else {
        next.dataPathMode = newSettings.dataPathMode
      }
    }
    if (newSettings.qmiDevice !== undefined) {
      if (typeof newSettings.qmiDevice !== 'string' || !/^[\w/.:-]{0,128}$/.test(newSettings.qmiDevice)) {
        errors.push('Invalid QMI device')
      } else {
        next.qmiDevice = newSettings.qmiDevice
      }
    }
    if (newSettings.pppPort !== undefined) {
      if (typeof newSettings.pppPort !== 'string' || !/^[\w/.:-]{0,128}$/.test(newSettings.pppPort)) {
        errors.push('Invalid PPP port')
      } else {
        next.pppPort = newSettings.pppPort
      }
    }
    if (newSettings.pppBaud !== undefined) {
      const pppBaud = parseInt(newSettings.pppBaud, 10)
      if (!VALID_BAUDS.includes(pppBaud)) {
        errors.push('Invalid PPP baud rate')
      } else {
        next.pppBaud = pppBaud
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
