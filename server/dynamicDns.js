/*
 * dynamicDns.js
 * Keeps a Dynamic DNS hostname pointed at this device's current public IP.
 *
 * Supports DuckDNS and No-IP. The HTTP client (fetchFn) is injectable so the
 * provider calls and public-IP detection are fully unit-testable without
 * touching the network. Settings persist via the injected settings-store.
 */

const DEFAULT_INTERVAL_MIN = 5
const VALID_PROVIDERS = ['duckdns', 'noip']

class DynamicDns {
  constructor (settings, deps = {}) {
    this.settings = settings
    this.fetchFn = deps.fetchFn || ((...args) => fetch(...args))

    this.options = {
      enabled: this.settings.value('ddns.enabled', false),
      provider: this.settings.value('ddns.provider', 'duckdns'),
      hostname: this.settings.value('ddns.hostname', ''),
      token: this.settings.value('ddns.token', ''),
      username: this.settings.value('ddns.username', ''),
      password: this.settings.value('ddns.password', ''),
      intervalMin: this.settings.value('ddns.intervalMin', DEFAULT_INTERVAL_MIN)
    }

    this.lastStatus = 'Disabled'
    this.lastIp = null
    this.lastUpdate = null
    this.timer = null

    if (this.options.enabled) {
      this.startLoop()
    }
  }

  getStatus () {
    return { status: this.lastStatus, lastIp: this.lastIp, lastUpdate: this.lastUpdate }
  }

  getSettings () {
    // Never expose the stored password; report only whether one is set.
    return {
      enabled: this.options.enabled,
      provider: this.options.provider,
      hostname: this.options.hostname,
      token: this.options.token,
      username: this.options.username,
      hasPassword: this.options.password !== '',
      intervalMin: this.options.intervalMin
    }
  }

  setSettings (cfg, callback) {
    this.options.enabled = cfg.enabled
    this.options.provider = cfg.provider
    this.options.hostname = cfg.hostname
    this.options.token = cfg.token
    this.options.username = cfg.username
    // Empty password means "keep the existing one"
    if (cfg.password !== undefined && cfg.password !== '') {
      this.options.password = cfg.password
    }
    this.options.intervalMin = cfg.intervalMin

    try {
      this.settings.setValue('ddns.enabled', this.options.enabled)
      this.settings.setValue('ddns.provider', this.options.provider)
      this.settings.setValue('ddns.hostname', this.options.hostname)
      this.settings.setValue('ddns.token', this.options.token)
      this.settings.setValue('ddns.username', this.options.username)
      this.settings.setValue('ddns.password', this.options.password)
      this.settings.setValue('ddns.intervalMin', this.options.intervalMin)
    } catch (e) {
      console.log(e)
    }

    if (this.options.enabled) {
      this.startLoop()
    } else {
      this.stopLoop()
      this.lastStatus = 'Disabled'
    }
    return callback(null)
  }

  async detectPublicIp () {
    const res = await this.fetchFn('https://api.ipify.org?format=json')
    const data = await res.json()
    return data.ip
  }

  buildRequest (ip) {
    const o = this.options
    if (o.provider === 'noip') {
      return {
        url: `https://dynupdate.no-ip.com/nic/update?hostname=${encodeURIComponent(o.hostname)}&myip=${encodeURIComponent(ip)}`,
        init: { method: 'GET', headers: { Authorization: 'Basic ' + Buffer.from(`${o.username}:${o.password}`).toString('base64') } },
        ok: (txt) => txt.startsWith('good') || txt.startsWith('nochg')
      }
    }
    // duckdns
    return {
      url: `https://www.duckdns.org/update?domains=${encodeURIComponent(o.hostname)}&token=${encodeURIComponent(o.token)}&ip=${encodeURIComponent(ip)}`,
      init: { method: 'GET' },
      ok: (txt) => txt.trim() === 'OK'
    }
  }

  async performUpdate () {
    if (!this.options.enabled) {
      this.lastStatus = 'Disabled'
      return this.getStatus()
    }
    let ip
    try {
      ip = await this.detectPublicIp()
    } catch (e) {
      this.lastStatus = 'Error: cannot detect public IP'
      return this.getStatus()
    }
    const req = this.buildRequest(ip)
    try {
      const res = await this.fetchFn(req.url, req.init)
      const txt = await res.text()
      if (res.ok && req.ok(txt)) {
        this.lastStatus = 'Success'
        this.lastIp = ip
        this.lastUpdate = new Date().toISOString()
      } else {
        this.lastStatus = `Error: provider rejected (HTTP ${res.status})`
      }
    } catch (e) {
      this.lastStatus = 'Error: ' + e.message
    }
    return this.getStatus()
  }

  updateNow () {
    return this.performUpdate()
  }

  startLoop () {
    this.stopLoop()
    this.performUpdate()
    this.timer = setInterval(() => this.performUpdate(), this.options.intervalMin * 60000)
  }

  stopLoop () {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  quitting () {
    this.stopLoop()
  }
}

module.exports = DynamicDns
module.exports.VALID_PROVIDERS = VALID_PROVIDERS
