/*
 * Camera Switcher
 * Switches the active video source at runtime, driven by a MAVLink RC channel
 * (RC_CHANNELS message) or manually from the web UI.
 *
 * Two switch modes are supported:
 *  - 'gstreamer': the video pipeline runs two sources into an input-selector
 *    (see python/video-server.py). Switching flips the selector pad without
 *    restarting the stream. Suitable for CSI + USB camera pairs.
 *  - 'command': a user-defined shell command is run for each source. Suitable
 *    for CSI multiplexer boards (e.g. Arducam) where the source is selected
 *    via an i2c/GPIO command and the pipeline keeps using the same device.
 */
const { exec } = require('child_process')
const events = require('events')

const RC_CHANNELS_MSG_ID = 65

class cameraSwitcher {
  activeSource: any
  lastSwitchTime: any
  lastRcValue: any
  streamRequested: any
  pendingSince: any
  pendingSource: any
  lastRcTime: any
  options: any
  eventEmitter: any
  settings: any
  constructor (settings: any) {
    this.settings = settings
    this.eventEmitter = new events.EventEmitter()

    // config
    this.options = {
      enabled: this.settings.value('cameraSwitcher.enabled', false),
      // RC channel number, 1-18
      rcChannel: this.settings.value('cameraSwitcher.rcChannel', 7),
      // PWM threshold: above threshold+hysteresis -> source B,
      // below threshold-hysteresis -> source A
      threshold: this.settings.value('cameraSwitcher.threshold', 1500),
      hysteresis: this.settings.value('cameraSwitcher.hysteresis', 50),
      // RC value must be stable for this long before switching (debounce)
      minHoldMs: this.settings.value('cameraSwitcher.minHoldMs', 250),
      // 'gstreamer' or 'command'
      switchMode: this.settings.value('cameraSwitcher.switchMode', 'gstreamer'),
      // secondary video source ('gstreamer' mode)
      secDevice: this.settings.value('cameraSwitcher.secDevice', ''),
      secFormat: this.settings.value('cameraSwitcher.secFormat', 'video/x-raw'),
      secWidth: this.settings.value('cameraSwitcher.secWidth', 0),
      secHeight: this.settings.value('cameraSwitcher.secHeight', 0),
      secFps: this.settings.value('cameraSwitcher.secFps', -1),
      // commands for 'command' mode (CSI multiplexer boards)
      commandA: this.settings.value('cameraSwitcher.commandA', ''),
      commandB: this.settings.value('cameraSwitcher.commandB', '')
    }

    // runtime state
    this.activeSource = 'A'
    this.lastRcValue = null
    this.lastRcTime = 0
    this.lastSwitchTime = 0
    // debounce state: candidate source and when it was first seen
    this.pendingSource = null
    this.pendingSince = 0
    // whether we've asked the FC to stream RC_CHANNELS on this link
    this.streamRequested = false
  }

  saveSettings () {
    try {
      this.settings.setValue('cameraSwitcher.enabled', this.options.enabled)
      this.settings.setValue('cameraSwitcher.rcChannel', this.options.rcChannel)
      this.settings.setValue('cameraSwitcher.threshold', this.options.threshold)
      this.settings.setValue('cameraSwitcher.hysteresis', this.options.hysteresis)
      this.settings.setValue('cameraSwitcher.minHoldMs', this.options.minHoldMs)
      this.settings.setValue('cameraSwitcher.switchMode', this.options.switchMode)
      this.settings.setValue('cameraSwitcher.secDevice', this.options.secDevice)
      this.settings.setValue('cameraSwitcher.secFormat', this.options.secFormat)
      this.settings.setValue('cameraSwitcher.secWidth', this.options.secWidth)
      this.settings.setValue('cameraSwitcher.secHeight', this.options.secHeight)
      this.settings.setValue('cameraSwitcher.secFps', this.options.secFps)
      this.settings.setValue('cameraSwitcher.commandA', this.options.commandA)
      this.settings.setValue('cameraSwitcher.commandB', this.options.commandB)
    } catch (e) {
      console.error('Error saving cameraSwitcher settings:', e)
    }
  }

  getSettings () {
    return { ...this.options }
  }

  setSettings (newOptions: any, callback: (err: Error | null) => void) {
    const opts = { ...this.options, ...newOptions }

    // validation
    if (opts.rcChannel < 1 || opts.rcChannel > 18) {
      return callback(new Error('RC channel must be 1-18'))
    }
    if (opts.threshold < 800 || opts.threshold > 2200) {
      return callback(new Error('Threshold must be 800-2200 us'))
    }
    if (opts.hysteresis < 0 || opts.hysteresis > 500) {
      return callback(new Error('Hysteresis must be 0-500 us'))
    }
    if (!['gstreamer', 'command'].includes(opts.switchMode)) {
      return callback(new Error('Invalid switch mode'))
    }
    if (opts.enabled && opts.switchMode === 'gstreamer' && opts.secDevice === '') {
      return callback(new Error('A secondary video device is required in GStreamer mode'))
    }
    if (opts.enabled && opts.switchMode === 'command' && (opts.commandA === '' || opts.commandB === '')) {
      return callback(new Error('Switch commands for both sources are required in command mode'))
    }

    const wasEnabled = this.options.enabled
    this.options = opts
    this.saveSettings()

    if (this.options.enabled && !wasEnabled) {
      // (re-)request the RC_CHANNELS stream next time we see the FC
      this.streamRequested = false
    }

    return callback(null)
  }

  getStatus () {
    return {
      enabled: this.options.enabled,
      activeSource: this.activeSource,
      lastRcValue: this.lastRcValue,
      // RC data is "live" if seen in the last 3 seconds
      rcLive: (Date.now() - this.lastRcTime) < 3000,
      lastSwitchTime: this.lastSwitchTime
    }
  }

  // called when the FC link is reset, so the RC stream is re-requested
  resetLink () {
    this.streamRequested = false
  }

  // Decide which source should be active for a given RC value.
  // Returns 'A', 'B' or null (= stay in the hysteresis dead-band)
  desiredSourceForValue (value: number | null | undefined) {
    if (value === null || value === undefined || value === 65535 || value === 0) {
      // 0 / UINT16_MAX = channel not available
      return null
    }
    if (value >= this.options.threshold + this.options.hysteresis) {
      return 'B'
    }
    if (value <= this.options.threshold - this.options.hysteresis) {
      return 'A'
    }
    return null
  }

  // Process an RC value with debouncing. 'now' is injectable for tests.
  // Returns the newly committed source ('A'/'B') or null if no switch happened.
  processRcValue (value: number | null | undefined, now = Date.now()) {
    this.lastRcValue = value
    this.lastRcTime = now

    const desired = this.desiredSourceForValue(value)
    if (desired === null || desired === this.activeSource) {
      this.pendingSource = null
      return null
    }

    if (this.pendingSource !== desired) {
      // new candidate - start the debounce clock
      this.pendingSource = desired
      this.pendingSince = now
      return null
    }

    if ((now - this.pendingSince) >= this.options.minHoldMs) {
      this.pendingSource = null
      this.doSwitch(desired, now)
      return desired
    }

    return null
  }

  // Perform the actual switch: emit for the gstreamer path or run the
  // configured command for multiplexer boards
  doSwitch (source: string, now = Date.now()) {
    if (source !== 'A' && source !== 'B') {
      return false
    }
    this.activeSource = source
    this.lastSwitchTime = now
    console.log('Camera switcher: switching to source ' + source)

    if (this.options.switchMode === 'command') {
      const cmd = source === 'A' ? this.options.commandA : this.options.commandB
      if (cmd !== '') {
        exec(cmd, (error: Error | null, stdout: string, stderr: string) => {
          if (error) {
            console.error('Camera switch command failed: ' + stderr)
          }
        })
      }
    }

    // index.js routes this to videostream.switchSource() in gstreamer mode
    this.eventEmitter.emit('switch', source, this.options.switchMode)
    return true
  }

  // MAVLink packet hook - wired to fcManager's gotMessage in index.js
  onMavPacket (packet: any, data: any) {
    if (!this.options.enabled) {
      return
    }
    if (packet.header.msgid !== RC_CHANNELS_MSG_ID || data === null) {
      return
    }
    const value = data['chan' + this.options.rcChannel + 'Raw']
    if (value === undefined) {
      return
    }
    this.processRcValue(value)
  }
}

export = cameraSwitcher
