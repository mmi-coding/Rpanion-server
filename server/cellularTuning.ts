/*
 * cellularTuning.js
 * Cellular link tuning for the video stream:
 *  - low-latency preset: passes --lowlatency to the video server, which
 *    generates a pipeline tuned for constrained 4G links (1s GOP, CBR-ish
 *    rate control, leaky single-buffer queues, non-blocking udpsink)
 *  - adaptive bitrate: scales the encoder bitrate to the LTE signal
 *    quality at runtime, so the stream degrades gracefully instead of
 *    stalling and buffering when the link gets worse
 *
 * Dependencies (the LTE modem signal and the video manager hooks) are
 * injected, keeping this module independently testable.
 */

// bitrate scale factor per signal tier
const TIER_FACTORS = { good: 1.0, fair: 0.6, poor: 0.35 }
// consecutive evaluations in the same tier before a change is applied
const HYSTERESIS_POLLS = 2
// evaluation period (ms)
const POLL_MS = 5000

class CellularTuning {
  pendingTier: any
  targetBitrate: any
  lastChange: any
  pollTimer: any
  appliedTier: any
  pendingCount: any
  options: any
  deps: any
  settings: any
  constructor (settings, deps) {
    this.settings = settings
    // injected: getSignal(), isStreaming(), getConfiguredBitrate(),
    // setBitrate(kbps), getAckBitrate()
    this.deps = deps

    this.options = {
      lowLatency: this.settings.value('cellularTuning.lowLatency', false),
      adaptiveBitrate: this.settings.value('cellularTuning.adaptiveBitrate', false),
      minBitrate: this.settings.value('cellularTuning.minBitrate', 250)
    }

    // adaptation state
    this.pendingTier = null
    this.pendingCount = 0
    this.appliedTier = null
    this.targetBitrate = null
    this.lastChange = null
    this.pollTimer = null

    if (this.options.adaptiveBitrate) {
      this.startLoop()
    }
  }

  saveSettings () {
    this.settings.setValue('cellularTuning.lowLatency', this.options.lowLatency)
    this.settings.setValue('cellularTuning.adaptiveBitrate', this.options.adaptiveBitrate)
    this.settings.setValue('cellularTuning.minBitrate', this.options.minBitrate)
  }

  // Map LTE signal quality onto a tier. Prefers RSRP (the LTE reference
  // signal power measure, available via AT+CPSI?); falls back to RSSI.
  // Unknown/missing signal -> null (hold the current bitrate)
  static tierForSignal (signal) {
    if (!signal) {
      return null
    }
    if (typeof signal.rsrp === 'number' && !isNaN(signal.rsrp)) {
      if (signal.rsrp >= -95) return 'good'
      if (signal.rsrp >= -105) return 'fair'
      return 'poor'
    }
    if (typeof signal.dbm === 'number' && !isNaN(signal.dbm)) {
      if (signal.dbm >= -85) return 'good'
      if (signal.dbm >= -97) return 'fair'
      return 'poor'
    }
    return null
  }

  // one adaptation step - factored out of the timer for testability
  evaluate () {
    if (!this.deps.isStreaming()) {
      // stream stopped (or restarting) - it comes back at the configured
      // bitrate, so the adaptation starts from scratch
      this.resetState()
      return
    }
    const tier = CellularTuning.tierForSignal(this.deps.getSignal())
    if (tier === null) {
      // no signal information (modem disabled or unavailable) - hold
      return
    }
    if (tier === this.pendingTier) {
      this.pendingCount += 1
    } else {
      this.pendingTier = tier
      this.pendingCount = 1
    }
    // hysteresis: only act on consecutive evaluations in the same tier
    if (this.pendingCount < HYSTERESIS_POLLS || tier === this.appliedTier) {
      return
    }
    const configured = this.deps.getConfiguredBitrate()
    if (!configured) {
      return
    }
    const target = Math.min(configured,
      Math.max(this.options.minBitrate, Math.round(configured * TIER_FACTORS[tier])))
    if (this.deps.setBitrate(target)) {
      this.appliedTier = tier
      this.targetBitrate = target
      this.lastChange = new Date().toISOString()
      console.log(`Cellular tuning: signal ${tier} - video bitrate -> ${target} kbps`)
    }
  }

  resetState () {
    this.pendingTier = null
    this.pendingCount = 0
    this.appliedTier = null
    this.targetBitrate = null
  }

  startLoop () {
    this.stopLoop()
    this.pollTimer = setInterval(() => this.evaluate(), POLL_MS)
  }

  stopLoop () {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    this.resetState()
  }

  getSettings () {
    return { ...this.options }
  }

  getStatus () {
    return {
      lowLatency: this.options.lowLatency,
      adaptiveBitrate: this.options.adaptiveBitrate,
      minBitrate: this.options.minBitrate,
      streaming: this.deps.isStreaming(),
      tier: this.appliedTier,
      pendingTier: this.pendingTier,
      configuredBitrate: this.deps.getConfiguredBitrate(),
      targetBitrate: this.targetBitrate,
      ackBitrate: this.deps.getAckBitrate(),
      signal: this.deps.getSignal(),
      lastChange: this.lastChange
    }
  }

  setSettings (newSettings, callback) {
    const errors = []
    const next = { ...this.options }

    if (typeof newSettings.lowLatency === 'boolean') {
      next.lowLatency = newSettings.lowLatency
    }
    if (typeof newSettings.adaptiveBitrate === 'boolean') {
      next.adaptiveBitrate = newSettings.adaptiveBitrate
    }
    if (newSettings.minBitrate !== undefined) {
      const minBitrate = parseInt(newSettings.minBitrate, 10)
      if (isNaN(minBitrate) || minBitrate < 50 || minBitrate > 10000) {
        errors.push('Minimum bitrate must be 50-10000 kbps')
      } else {
        next.minBitrate = minBitrate
      }
    }
    if (errors.length > 0) {
      return callback(new Error(errors.join('; ')))
    }

    const wasAdaptive = this.options.adaptiveBitrate
    this.options = next
    this.saveSettings()

    if (next.adaptiveBitrate && !wasAdaptive) {
      this.startLoop()
    } else if (!next.adaptiveBitrate && wasAdaptive) {
      // restore the configured bitrate if adaptation had lowered it
      const configured = this.deps.getConfiguredBitrate()
      if (this.appliedTier !== null && this.appliedTier !== 'good' &&
          configured && this.deps.isStreaming()) {
        this.deps.setBitrate(configured)
      }
      this.stopLoop()
    }
    return callback(null)
  }

  quitting () {
    this.stopLoop()
  }
}

export = CellularTuning
