// Secondary video streams (#398/#289/#9). The primary stream (videostream.ts)
// keeps the full feature set (switcher / HUD / custom pipeline / recording /
// MAVLink camera protocol). This manages a small number of additional, basic
// streams — each a *different* camera on its own video-server.py process and its
// own RTSP/RTP endpoint, so one bad camera can't take the others down.
const events = require('events')
const { spawn } = require('child_process')
const logpaths = require('./paths')

// bound the count (and the per-stream RTSP port range: 8555 + id)
const MAX_SECONDARY = 3
const RTSP_BASE_PORT = 8555

class SecondaryStreams {
  settings: any
  vManager: any
  streams: any[]
  eventEmitter: any

  // vManager is the primary videoStream, used to know which camera it's holding
  // so a secondary can't grab the same device.
  constructor (settings: any, vManager: any) {
    this.settings = settings
    this.vManager = vManager
    this.streams = []
    this.eventEmitter = new events.EventEmitter()

    const saved = this.settings.value('camera.secondaryStreams', [])
    for (let i = 0; i < saved.length && this.streams.length < MAX_SECONDARY; i++) {
      const stream = { id: this.nextSlot(), config: saved[i], process: null }
      this.streams.push(stream)
      this.startStream(stream)
    }
  }

  nextSlot () {
    const used = this.streams.map((s) => s.id)
    for (let s = 0; s < MAX_SECONDARY; s++) {
      if (used.indexOf(s) === -1) {
        return s
      }
    }
    /* istanbul ignore next -- callers check MAX_SECONDARY before allocating */
    return -1
  }

  // devices already in use: the primary's active camera + every secondary's
  primaryDevice () {
    if (this.vManager && this.vManager.active && this.vManager.cameraMode === 'streaming' && this.vManager.videoSettings) {
      return this.vManager.videoSettings.device
    }
    return null
  }

  inUseDevices () {
    const used: string[] = []
    const prim = this.primaryDevice()
    if (prim !== null) {
      used.push(prim)
    }
    for (let i = 0; i < this.streams.length; i++) {
      used.push(this.streams[i].config.device)
    }
    return used
  }

  mountName (device: string) {
    return device.replace(/[^a-zA-Z0-9]/g, '')
  }

  streamAddress (stream: any) {
    if (stream.config.transport === 'RTP') {
      return 'RTP → udp://' + stream.config.udpIP + ':' + stream.config.udpPort
    }
    return 'rtsp://<this-device-ip>:' + (RTSP_BASE_PORT + stream.id) + '/' + this.mountName(stream.config.device)
  }

  buildArgs (stream: any) {
    const c = stream.config
    const args = [
      '-u',
      './python/video-server.py',
      '--video=' + c.device,
      '--height=' + c.height,
      '--width=' + c.width,
      '--format=' + c.format,
      '--bitrate=' + c.bitrate,
      '--rotation=' + c.rotation,
      '--fps=' + c.fps,
      '--compression=' + c.compression
    ]
    if (c.transport === 'RTP') {
      args.push('--transport=RTP', '--udp=' + c.udpIP + ':' + c.udpPort)
    } else {
      args.push('--transport=RTSP', '--rtsp-port=' + (RTSP_BASE_PORT + stream.id))
    }
    return args
  }

  startStream (stream: any) {
    const args = this.buildArgs(stream)
    console.log('Starting secondary stream ' + stream.id + ': ' + args.join(' '))
    stream.process = spawn(logpaths.getPythonPath(), args)
    stream.process.stdout.on('data', (data: Buffer) => {
      console.log(`secondary ${stream.id} stdout: ${data}`)
    })
    stream.process.stderr.on('data', (data: Buffer) => {
      console.error(`secondary ${stream.id} stderr: ${data}`)
    })
    stream.process.on('close', (code: number | null) => {
      console.log(`secondary stream ${stream.id} exited with code ${code}`)
      this.eventEmitter.emit('stopped', stream.id)
    })
  }

  isRunning (stream: any) {
    return !!(stream.process && stream.process.exitCode === null)
  }

  // { device, format, width, height, fps, bitrate, rotation, compression, transport, udpIP, udpPort }
  validateConfig (config: any) {
    if (!config || typeof config.device !== 'string' || config.device === '') {
      return 'A camera must be selected'
    }
    if (this.inUseDevices().indexOf(config.device) !== -1) {
      return 'That camera is already in use by another stream'
    }
    if (config.transport === 'RTP' && (!config.udpIP || !config.udpPort)) {
      return 'RTP needs a destination IP and port'
    }
    return null
  }

  addStream (config: any, callback: (err: string | null, streams: any[]) => void) {
    if (this.streams.length >= MAX_SECONDARY) {
      return callback('Maximum of ' + MAX_SECONDARY + ' secondary streams reached', this.getStatus())
    }
    const err = this.validateConfig(config)
    if (err) {
      return callback(err, this.getStatus())
    }
    const stream = { id: this.nextSlot(), config, process: null }
    this.startStream(stream)
    this.streams.push(stream)
    this.saveSettings()
    return callback(null, this.getStatus())
  }

  removeStream (id: number, callback: (err: string | null, streams: any[]) => void) {
    const idx = this.streams.findIndex((s) => s.id === id)
    if (idx === -1) {
      return callback('No such stream', this.getStatus())
    }
    const stream = this.streams[idx]
    if (this.isRunning(stream)) {
      try {
        stream.process.kill('SIGINT')
      } catch (e) { /* istanbul ignore next -- kill only throws if the process is already gone */
        console.log(e)
      }
    }
    this.streams.splice(idx, 1)
    this.saveSettings()
    return callback(null, this.getStatus())
  }

  getStatus () {
    return this.streams.map((s) => ({
      id: s.id,
      config: s.config,
      running: this.isRunning(s),
      address: this.streamAddress(s)
    }))
  }

  saveSettings () {
    try {
      this.settings.setValue('camera.secondaryStreams', this.streams.map((s) => s.config))
    } catch (e) {
      console.log(e)
    }
  }
}

export = SecondaryStreams
