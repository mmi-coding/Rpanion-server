/*
 * telemetryInjector.js
 * Accept external sensor data over HTTP, UDP or serial and inject it into the
 * MAVLink stream as NAMED_VALUE_FLOAT (numeric) or STATUSTEXT (text). Encoded
 * v2 frames are sent to the local mavlink-router endpoint (127.0.0.1:14540),
 * which rebroadcasts to the flight controller link and every GCS output.
 *
 * Input is newline-delimited JSON, one reading per line:
 *   {"name":"co2","value":412}        -> NAMED_VALUE_FLOAT
 *   {"text":"pump on","severity":6}   -> STATUSTEXT (severity defaults to INFO)
 */
const dgram = require('dgram')
const { SerialPort, ReadlineParser } = require('serialport')
const { common, MavLinkProtocolV2 } = require('node-mavlink')

const ROUTER_HOST = '127.0.0.1'
const ROUTER_PORT = 14540 // mavlink-router endpoint; rebroadcasts to FC + GCS
const BAUDS = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600]

class TelemetryInjector {
  constructor (settings) {
    this.settings = settings
    this.options = {
      enabled: this.settings.value('telemetryInjector.enabled', false),
      httpEnabled: this.settings.value('telemetryInjector.httpEnabled', true),
      udpEnabled: this.settings.value('telemetryInjector.udpEnabled', false),
      udpPort: this.settings.value('telemetryInjector.udpPort', 14600),
      serialEnabled: this.settings.value('telemetryInjector.serialEnabled', false),
      serialPort: this.settings.value('telemetryInjector.serialPort', ''),
      serialBaud: this.settings.value('telemetryInjector.serialBaud', 57600),
      sysid: this.settings.value('telemetryInjector.sysid', 1),
      compid: this.settings.value('telemetryInjector.compid', 158)
    }
    this.seq = 0
    this.stats = { sentFloat: 0, sentText: 0, errors: 0, lastName: null, lastValue: null, lastText: null }
    this.sendSock = null
    this.udpListener = null
    this.serial = null
    if (this.options.enabled) {
      this.start()
    }
  }

  saveSettings () {
    for (const k of ['enabled', 'httpEnabled', 'udpEnabled', 'udpPort', 'serialEnabled', 'serialPort', 'serialBaud', 'sysid', 'compid']) {
      this.settings.setValue('telemetryInjector.' + k, this.options[k])
    }
  }

  // --- MAVLink encoding ---
  encodeFloat (name, value) {
    const m = new common.NamedValueFloat()
    m.timeBootMs = Math.round(process.uptime() * 1000) & 0xffffffff
    m.name = String(name).slice(0, 10)
    m.value = Number(value)
    this.seq = (this.seq + 1) & 0xff
    return new MavLinkProtocolV2(this.options.sysid, this.options.compid).serialize(m, this.seq)
  }

  encodeText (text, severity) {
    const m = new common.StatusText()
    m.severity = (typeof severity === 'number') ? severity : common.MavSeverity.INFO
    m.text = String(text).slice(0, 50)
    this.seq = (this.seq + 1) & 0xff
    return new MavLinkProtocolV2(this.options.sysid, this.options.compid).serialize(m, this.seq)
  }

  // funnel for every source; returns null on success or an Error for a bad reading
  ingest (obj) {
    if (obj && typeof obj.name === 'string' && typeof obj.value === 'number') {
      this._send(this.encodeFloat(obj.name, obj.value))
      this.stats.sentFloat++
      this.stats.lastName = obj.name
      this.stats.lastValue = obj.value
      return null
    }
    if (obj && typeof obj.text === 'string') {
      this._send(this.encodeText(obj.text, obj.severity))
      this.stats.sentText++
      this.stats.lastText = obj.text
      return null
    }
    this.stats.errors++
    return new Error('reading must be {name, value} or {text}')
  }

  // parse one NDJSON line and ingest it (UDP + serial sources)
  _ingestLine (line) {
    const s = line.toString().trim()
    if (s === '') {
      return
    }
    let obj
    try {
      obj = JSON.parse(s)
    } catch (e) {
      this.stats.errors++
      return
    }
    this.ingest(obj)
  }

  // --- seams (stubbed in tests) ---
  _send (buf) {
    if (!this.sendSock) {
      this.sendSock = dgram.createSocket('udp4')
    }
    this.sendSock.send(buf, ROUTER_PORT, ROUTER_HOST, () => {})
  }

  _makeSerial (devPath, baud) {
    return new SerialPort({ path: devPath, baudRate: baud })
  }

  // --- source listeners ---
  start () {
    if (this.options.udpEnabled) {
      this._startUdp()
    }
    if (this.options.serialEnabled && this.options.serialPort !== '') {
      this._startSerial()
    }
  }

  _startUdp () {
    this.udpListener = dgram.createSocket('udp4')
    this.udpListener.on('message', (msg) => {
      for (const line of msg.toString().split('\n')) {
        this._ingestLine(line)
      }
    })
    this.udpListener.on('error', () => { this.stats.errors++ })
    this.udpListener.bind(this.options.udpPort)
  }

  _startSerial () {
    try {
      this.serial = this._makeSerial(this.options.serialPort, this.options.serialBaud)
    } catch (e) {
      this.stats.errors++
      this.serial = null
      return
    }
    const parser = this.serial.pipe(new ReadlineParser({ delimiter: '\n' }))
    parser.on('data', (line) => this._ingestLine(line))
    this.serial.on('error', () => { this.stats.errors++ })
  }

  stop () {
    if (this.udpListener) {
      this.udpListener.close()
      this.udpListener = null
    }
    if (this.serial) {
      this.serial.close(() => {})
      this.serial = null
    }
  }

  // true only when both the master switch and the HTTP source are enabled
  canInjectHttp () {
    return this.options.enabled === true && this.options.httpEnabled === true
  }

  getSettings () {
    return { ...this.options }
  }

  getStatus () {
    return {
      enabled: this.options.enabled,
      httpEnabled: this.options.httpEnabled,
      udpEnabled: this.options.udpEnabled,
      udpPort: this.options.udpPort,
      serialEnabled: this.options.serialEnabled,
      serialPort: this.options.serialPort,
      udpListening: this.udpListener !== null,
      serialOpen: this.serial !== null,
      sentFloat: this.stats.sentFloat,
      sentText: this.stats.sentText,
      errors: this.stats.errors,
      lastName: this.stats.lastName,
      lastValue: this.stats.lastValue,
      lastText: this.stats.lastText
    }
  }

  setSettings (newSettings, callback) {
    const errors = []
    const next = { ...this.options }

    for (const b of ['enabled', 'httpEnabled', 'udpEnabled', 'serialEnabled']) {
      if (typeof newSettings[b] === 'boolean') {
        next[b] = newSettings[b]
      }
    }
    if (newSettings.udpPort !== undefined) {
      const p = parseInt(newSettings.udpPort, 10)
      if (isNaN(p) || p < 1 || p > 65535) {
        errors.push('Invalid UDP port')
      } else {
        next.udpPort = p
      }
    }
    if (newSettings.serialPort !== undefined) {
      if (typeof newSettings.serialPort !== 'string' || !/^[\w/.:-]{0,128}$/.test(newSettings.serialPort)) {
        errors.push('Invalid serial port')
      } else {
        next.serialPort = newSettings.serialPort
      }
    }
    if (newSettings.serialBaud !== undefined) {
      const b = parseInt(newSettings.serialBaud, 10)
      if (!BAUDS.includes(b)) {
        errors.push('Invalid serial baud rate')
      } else {
        next.serialBaud = b
      }
    }
    if (newSettings.sysid !== undefined) {
      const s = parseInt(newSettings.sysid, 10)
      if (isNaN(s) || s < 1 || s > 255) {
        errors.push('sysid must be 1-255')
      } else {
        next.sysid = s
      }
    }
    if (newSettings.compid !== undefined) {
      const c = parseInt(newSettings.compid, 10)
      if (isNaN(c) || c < 1 || c > 255) {
        errors.push('compid must be 1-255')
      } else {
        next.compid = c
      }
    }

    if (errors.length > 0) {
      return callback(new Error(errors.join('; ')))
    }

    this.options = next
    this.saveSettings()
    // restart listeners to apply the new config
    this.stop()
    if (next.enabled) {
      this.start()
    }
    return callback(null)
  }

  quitting () {
    this.stop()
    if (this.sendSock) {
      this.sendSock.close()
      this.sendSock = null
    }
  }
}

module.exports = TelemetryInjector
