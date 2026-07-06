import type { Request, Response, NextFunction } from 'express'
const express = require('express')
const fileUpload = require('express-fileupload')
const compression = require('compression')
const pinoHttp = require('pino-http')
const process = require('process')

// S8: a JWT may ride in a ?token= query param (auth.ts accepts it so <img>/
// <a download>/EventSource can authenticate). pino-http logs req.url verbatim,
// so without this the token lands in the systemd journal (readable by anything
// in the `adm` group). Redact the token value from any URL before it is logged.
const redactToken = (url: string): string =>
  url.replace(/([?&]token=)[^&#]*/gi, '$1[REDACTED]')

// pino-http request serialiser: standard fields, but with the token stripped
// from the logged URL. Exposed via testHooks for a deterministic unit test.
function reqSerializer (req: any) {
  const serialised = pinoHttp.stdSerializers.req(req)
  serialised.url = redactToken(serialised.url)
  return serialised
}
const pino = pinoHttp({ serializers: { req: reqSerializer } })
const { common } = require('node-mavlink')

const networkManager = require('./networkManager')
const aboutPage = require('./aboutInfo')
const videoStream = require('./videostream')
const fcManagerClass = require('./flightController')
const flightLogger = require('./flightLogger')
const networkClients = require('./networkClients')
const ntrip = require('./ntrip')
const Adhoc = require('./adhocManager')
const cloudManager = require('./cloudUpload')
const VPNManager = require('./vpn')
const wireguardHub = require('./wireguardHub')
const logConversionManager = require('./logConverter')
const userLogin = require('./userLogin')
const logpaths = require('./paths')
const CameraSwitcher = require('./cameraSwitcher')
const CustomPipelines = require('./customPipelines')
const LTEModem = require('./ltemodem')
const HudFonts = require('./hudFonts')
const CellularTuning = require('./cellularTuning')
const DynamicDns = require('./dynamicDns')
const NetworkPriority = require('./networkPriority')
const TelemetryInjector = require('./telemetryInjector')
const MavTelemetry = require('./mavTelemetry')
const FCParams = require('./fcParams')
const DroneCANMonitor = require('./droneCan')
const hudOverlay = require('./hudOverlay')

const settings = require('settings-store')

const app = express()
const http = require('http').Server(app)
const path = require('path')

// MEDIA_ROOT is the default storage area used by the Python helpers.
// For security, user-provided paths are required to live within it.
const MEDIA_ROOT = logpaths.mediaDir; // absolute path to rpanion-server/media


const io = require('socket.io')(http, { cookie: false })

// Coerce a request-body field to boolean, accepting JSON true or the string 'true'
const toBool = (v: unknown) => v === true || v === 'true'

// set up rate limiter: maximum of fifty requests per minute
const RateLimit = require('express-rate-limit')
const pppConnection = require('./pppConnection')
// Skip rate-limiting in development so the full test suite (~150+ requests
// from 127.0.0.1) never hits the ceiling.  Production behaviour is unchanged.
// Set ENABLE_RATE_LIMIT=1 to force the limiters on even in development (e.g. to
// test the 429 path).  Shared by both the global and the per-login limiter.
const skipRateLimit = (req: Request) => process.env.NODE_ENV === 'development' && !process.env.ENABLE_RATE_LIMIT
const limiter = RateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 50,
  skip: skipRateLimit
})

// S11: a much stricter limiter for the login endpoint specifically, to blunt
// credential brute-force.  ~5 attempts/minute/IP — well above a human typo
// rate, far below what a brute-forcer needs.  Applied to /api/login *in
// addition to* the global limiter (see app.use below, before authRouter).
const loginLimiter = RateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 5,
  skip: skipRateLimit
})


// apply rate limiter to all requests
app.use(limiter)

// file uploader for WireGuard profiles + HUD fonts (6 MB ceiling covers a .ttf/
// .otf; configs are far smaller; every upload route is authenticated + validated)
app.use(fileUpload({ limits: { fileSize: 6 * 1024 * 1024 }, abortOnLimit: true, useTempFiles: true, tempFileDir: '/tmp/', safeFileNames: true, preserveExtension: 4 }))

// R9: boot-time subsystem init guard.  A single bad subsystem — a corrupt
// settings.json, or cloudUpload's `execSync ssh-keygen` failing on an empty
// ~/.ssh — must not throw at module load and abort the whole boot, which would
// leave systemd in an unrecoverable 10 s crash-loop with no companion for the
// entire flight.  Runs `fn`; on throw it logs and returns null so the remaining
// subsystems still initialise (degraded), rather than taking down the process.
// Exposed via testHooks so both branches are exercised deterministically.
function safeInit (label: string, fn: () => any): any {
  try {
    return fn()
  } catch (err) {
    console.error(`Subsystem '${label}' failed to initialise; continuing degraded.`, err)
    return null
  }
}

// Init settings before running the other classes
safeInit('settings.init', () => settings.init({
  appName: 'Rpanion-server', // required,
  reverseDNS: 'com.server.rpanion', // required for macOS
  filename: logpaths.settingsFile
}))

const vManager = new videoStream(settings)
const secondaryStreams = new (require('./secondaryStreams'))(settings, vManager)
// let the camera protocol (VIDEO_STREAM_INFORMATION) advertise the secondaries too
vManager.secondaryStreams = secondaryStreams
const fcManager = new fcManagerClass(settings)
// live store of every MAVLink message from the FC, for the webUI inspector
const mavTelemetry = new MavTelemetry()
// FC parameter cache + full-download orchestration, for the FC Configuration page
const fcParams = new FCParams(fcManager, mavTelemetry)
// DroneCAN node enumeration via CAN forwarding, for the FC Configuration page
const droneCan = new DroneCANMonitor(fcManager)
const logManager = new flightLogger()
const ntripClient = new ntrip(settings)
// R9: cloudUpload's constructor runs `execSync ssh-keygen` when ~/.ssh is empty
// — the highest-risk boot-time initializer.  Guard it so a keygen failure
// degrades cloud upload rather than aborting boot (its routes are lazy and the
// status broadcast is try/catch-wrapped, so a null `cloud` cannot crash boot).
const cloud = safeInit('cloudUpload', () => new cloudManager(settings))
const logConversion = new logConversionManager(settings)
const adhocManager = new Adhoc(settings)
const userMgmt = new userLogin()
const pppConnectionManager = new pppConnection(settings)
const camSwitcher = new CameraSwitcher(settings)
const customPipelines = new CustomPipelines(settings)
const lteModem = new LTEModem(settings)
// let the graphic HUD overlay the modem's GNSS fix (#173 modem-GPS follow-up)
vManager.lteModem = lteModem
// custom OSD fonts (#173): install curated fonts + expose the manager to the
// video manager (which spawns video-server.py with XDG_DATA_HOME so librsvg
// resolves them) and the HUD routes
const hudFonts = new HudFonts(settings)
hudFonts.install()
vManager.hudFonts = hudFonts
// cellular video tuning: ties the LTE modem's signal quality to the video
// stream's encoder bitrate
const cellularTuning = new CellularTuning(settings, {
  getSignal: () => {
    const ltestatus = lteModem.getStatus()
    return ltestatus.available ? ltestatus.signal : null
  },
  isStreaming: () => vManager.active && vManager.cameraMode === 'streaming' && vManager.deviceStream !== null,
  getConfiguredBitrate: () => (vManager.videoSettings && vManager.videoSettings.bitrate) || null,
  setBitrate: (kbps: number) => vManager.setBitrate(kbps),
  getAckBitrate: () => vManager.currentBitrate
})

const ddns = new DynamicDns(settings)

const networkPriority = new NetworkPriority()

const telemetryInjector = new TelemetryInjector(settings)

// Authentication: the authenticateToken middleware (injected into every route
// module) + the auth/user routes (mounted after the body parser, below).
const { authenticateToken, requireAdmin, router: authRouter } = require('./auth')({ userMgmt })

// Graceful shutdown implementation
let isShuttingDown = false
const SHUTDOWN_TIMEOUT = 10000 // 10 seconds

async function gracefulShutdown(signal: string, exitCode = 0) {
  if (isShuttingDown) {
    return
  }
  
  isShuttingDown = true
  console.log(`Received ${signal}. Shutting down gracefully...`)
  
  // Set a timeout to force shutdown if graceful shutdown takes too long
  /* istanbul ignore next -- force-shutdown callback: only fires after 10s timeout; not exercised in tests to avoid long delays */
  const forceShutdownTimer = setTimeout(() => {
    console.error('Graceful shutdown timeout exceeded. Forcing shutdown...')
    process.exit(1)
  }, SHUTDOWN_TIMEOUT)
  
  try {
    // Stop accepting new connections
    if (http && http.listening) {
      console.log('Closing HTTP server...')
      console.log(`Waiting for ${activeConnections.size} active connections to finish...`)
      
      await new Promise((resolve, reject) => {
        http.close((err: Error | undefined) => {
          if (err) {
            console.error('Error closing HTTP server:', err)
            reject(err)
          } else {
            resolve(undefined)
          }
        })
      })
    }
    
    // Stop Socket.IO connections
    /* istanbul ignore else -- io is always initialised at module scope; falsy branch is unreachable */
    if (io) {
      console.log('Closing Socket.IO connections...')
      io.close()
      console.log('Socket.IO closed')
    }
    
    // Clear intervals
    if (FCStatusLoop) {
      clearInterval(FCStatusLoop)
      FCStatusLoop = null
      console.log('Status loop cleared')
    }
    
    // Stop all managed services
    console.log('Stopping managed services...')

    // Stop camera processes cleanly
    /* istanbul ignore else -- vManager is always initialised at module scope; falsy branch is unreachable */
    if (vManager) {
      vManager.stopCamera();
      console.log('Camera processes stopped');
    }

    pppConnectionManager.quitting()
    cloud.quitting()
    logConversion.quitting()
    lteModem.quitting()
    cellularTuning.quitting()
    ddns.quitting()
    telemetryInjector.quitting()
    console.log('All services stopped')
    
    clearTimeout(forceShutdownTimer)
    console.log('---Shutdown Rpanion Complete---')
    process.exit(exitCode)
  } catch (err) {
    console.error('Error during graceful shutdown:', err)
    clearTimeout(forceShutdownTimer)
    process.exit(1)
  }
}

// Handle SIGINT (Ctrl+C)
/* istanbul ignore next -- signal handler: triggering SIGINT in tests would kill the mocha process */
process.on('SIGINT', () => {
  gracefulShutdown('SIGINT', 0)
})

// Handle SIGTERM (systemd stop)
/* istanbul ignore next -- signal handler: triggering SIGTERM in tests would kill the mocha process */
process.on('SIGTERM', () => {
  gracefulShutdown('SIGTERM', 0)
})

// Handle uncaught exceptions
/* istanbul ignore next -- global handler: triggering uncaughtException would terminate mocha; covered path is gracefulShutdown itself */
process.on('uncaughtException', (err: Error) => {
  console.error('Uncaught exception:', err)
  gracefulShutdown('uncaughtException', 1)
})

// Handle unhandled promise rejections
/* istanbul ignore next -- global handler: triggering unhandledRejection would terminate mocha; covered path is gracefulShutdown itself */
process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason)
  gracefulShutdown('unhandledRejection', 1)
})

// Handle nodemon restarts (SIGUSR2)
/* istanbul ignore next -- signal handler: triggering SIGUSR2/nodemon restart in tests would kill the mocha process */
process.once('SIGUSR2', () => {
  console.log('Received SIGUSR2. Shutting down gracefully...')
  gracefulShutdown('SIGUSR2', 0).then(() => {
    process.kill(process.pid, 'SIGUSR2')
  })
})

// Got an RTCM message, send to flight controller
ntripClient.eventEmitter.on('rtcmpacket', (msg: any, seq: any) => {
  // logManager.writetlog(msg.buf);
  try {
    // inject RTCM to every connected vehicle
    fcManager.sendRTCMMessage(msg, seq)
  } catch (err) {
    console.log(err)
  }
})


// This function responds to a MAVLink command to capture a photo.
vManager.eventEmitter.on('digicamcontrol', (senderSysId: any, senderCompId: any, targetComponent: any) => {
  try {
    // Acknowledge the MAV_CMD_DO_DIGICAM_CONTROL command
    fcManager.sendCommandAck(203, 0, senderSysId, senderCompId, targetComponent)
  } catch (err) {
    console.log('Error acknowledging DoDigicamControl:', err);
  }
})

// Got a camera heartbeat event, send to flight controller
vManager.eventEmitter.on('cameraheartbeat', (mavType: any, autopilot: any, component: any) => {
  try {
    fcManager.sendHeartbeat(mavType, autopilot, component)
  } catch (err) {
    console.log('Error sending camera heartbeat:', err);
  }
})

// Got a CAMERA_INFORMATION event, send to flight controller
vManager.eventEmitter.on('camerainfo', (msg: any, senderSysId: any, senderCompId: any, targetComponent: any) => {
  try {
    // Acknowledge the CAMERA_INFORMATION request
    fcManager.sendCommandAck(common.CameraInformation.MSG_ID, 0, senderSysId, senderCompId, targetComponent)
    fcManager.sendData(msg, senderCompId)
  } catch (err) {
    console.log('Error sending CameraInformation:', err);
  }
})

// Got a VIDEO_STREAM_INFORMATION event, send to flight controller
vManager.eventEmitter.on('videostreaminfo', (msg: any, senderSysId: any, senderCompId: any, targetComponent: any) => {
  try {
    // Acknowledge the VIDEO_STREAM_INFORMATION request
    fcManager.sendCommandAck(common.VideoStreamInformation.MSG_ID, 0, senderSysId, senderCompId, targetComponent)
    fcManager.sendData(msg, senderCompId)
  } catch (err) {
    console.log('Error sending VideoStreamInformation:', err);
  }
})

// Got a CAMERA_SETTINGS event, send to flight controller
vManager.eventEmitter.on('camerasettings', (msg: any, senderSysId: any, senderCompId: any, targetComponent: any) => {
  try {
    // Acknowledge the CAMERA_SETTINGS request
    fcManager.sendCommandAck(common.CameraSettings.MSG_ID, 0, senderSysId, senderCompId, targetComponent)
    fcManager.sendData(msg, senderCompId)
  } catch (err) {
    console.log('Error sending CameraSettings:', err);
    // console.log(err)
  }
})

// Got a CAMERA_TRIGGER event, send to flight controller
vManager.eventEmitter.on('cameratrigger', (msg: any, senderCompId: any) => {
  try {
    // Send the CAMERA_TRIGGER message to the flight controller
    fcManager.sendData(msg, senderCompId)
  } catch (err) {
    console.log('Error sending CameraTrigger:', err);
  }
})

vManager.eventEmitter.on('filesaved', (filepath: string) => {
  try {
    io.sockets.emit('camera:filesaved', { filename: filepath });
    console.log('Pushed filesaved to clients:', filepath);
  } catch (e) {
    console.error('Failed to emit filesaved:', e);
  }
});

// Connecting the flight controller datastream to the logger
// and ntrip and video
fcManager.eventEmitter.on('gotMessage', (packet: any, data: any, link: any) => {
  try {
    ntripClient.onMavPacket(packet, data)
    vManager.onMavPacket(packet, data)
    camSwitcher.onMavPacket(packet, data)
    mavTelemetry.onMessage(packet, data)
    fcParams.onMessage(packet, data)
    droneCan.onCanFrame(packet, data)
    // ask the FC to stream RC_CHANNELS (2 Hz), once, if the camera switcher
    // needs it — requested from the link whose vehicle we first locked onto
    if (camSwitcher.getSettings().enabled && !camSwitcher.streamRequested &&
        link && link.m && link.m.targetSystem !== null) {
      camSwitcher.streamRequested = true
      link.m.sendSetMessageInterval(common.RcChannels.MSG_ID, 500000)
    }
  } catch (err) {
    console.log('Error processing MAVLink message in listener:', err);
  }
})

// Camera switcher decided to switch - flip the video pipeline source.
// In 'command' mode the switch command has already been run by the switcher
camSwitcher.eventEmitter.on('switch', (source: any, switchMode: string) => {
  try {
    if (switchMode === 'gstreamer') {
      vManager.switchSource(source)
    }
  } catch (err) {
    console.log('Error switching video source:', err);
  }
})

fcManager.eventEmitter.on('newLink', () => {
})

fcManager.eventEmitter.on('stopLink', () => {
  // re-request the RC_CHANNELS stream on the next link
  camSwitcher.resetLink()
})

fcManager.eventEmitter.on('armed', () => {
})

fcManager.eventEmitter.on('disarmed', () => {
})

let FCStatusLoop: NodeJS.Timeout | null = null

// R7: the 1 Hz status broadcast pulls from ~15 subsystems.  A bare setInterval
// body has no error boundary — any one emitter throwing propagates out of the
// timer as an uncaughtException, which the global handler turns into
// process.exit (a ~10 s in-flight blackout, recurring every second).  Wrap the
// whole body so one bad subsystem is logged and the loop continues.
// Exposed via testHooks so the catch path is exercised deterministically.
function broadcastStatus () {
  try {
    io.sockets.emit('FCStatus', fcManager.getAllStatus())
    io.sockets.emit('NTRIPStatus', ntripClient.conStatusStr())
    io.sockets.emit('CloudBinStatus', cloud.conStatusBinStr())
    io.sockets.emit('LogConversionStatus', logConversion.conStatusLogStr())
    io.sockets.emit('PPPStatus', pppConnectionManager.conStatusStr())
    io.sockets.emit('VideoStreamStatus', vManager.getStreamingStatus())
    io.sockets.emit('CameraSwitcherStatus', camSwitcher.getStatus())
    io.sockets.emit('LTEStatus', lteModem.getStatus())
    io.sockets.emit('CellularTuningStatus', cellularTuning.getStatus())
    io.sockets.emit('TelemetryInjectorStatus', telemetryInjector.getStatus())
    io.sockets.emit('MAVTelemetry', mavTelemetry.getSnapshot())
    // live per-element HUD values for the editor's "show live values" preview
    io.sockets.emit('HUDLive', hudOverlay.liveHudValues(mavTelemetry.getSnapshot(), new Date().toTimeString().slice(0, 8)))
    io.sockets.emit('FCParamStatus', fcParams.getProgress())
    io.sockets.emit('DroneCANNodes', { scanning: droneCan.scanning, nodes: droneCan.getNodes(), stats: droneCan.getStats() })
    io.sockets.emit('DroneCANNodeParams', droneCan.getParamScan())
  } catch (err) {
    console.log('Error in FCStatus broadcast loop:', err)
  }
}

app.use(express.urlencoded({ extended: true }))
app.use(pino)

// Simply pass `compression` as an Express middleware!
app.use(compression())
app.use(express.json())

// S9: security headers (helmet is not a dependency, so set them manually).
// X-Frame-Options + frame-ancestors stop the GS UI being framed for a
// clickjacking overlay (e.g. a hidden "Reboot FC"); nosniff blocks MIME
// sniffing; the CSP is deliberately conservative (compatibility-first: inline
// styles/scripts and same-origin bundles + websockets are needed by the built
// React/Bootstrap/socket.io UI) — tightening script-src to a nonce/hash is a
// documented on-device hardening follow-up (ties to S12).
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline'",
    "connect-src 'self' ws: wss:"
  ].join('; '))
  next()
})

// Serve the static files from the React app
app.use(express.static(path.join(__dirname, '..', '/build')))

// S11: throttle login attempts (stricter than the global limiter) before the
// auth router that owns /api/login.
app.use('/api/login', loginLimiter)

// Auth + user management routes (extracted to ./auth.js)
app.use(authRouter)

// PPP connection routes (extracted to ./routes/ppp.js)
app.use(require('./routes/ppp')({ authenticateToken, pppConnectionManager }))

// System / about / logs / settings routes (extracted to ./routes/system.js)
app.use(require('./routes/system')({ authenticateToken, aboutPage, networkClients, logManager, fcManager }))

// VPN routes — ZeroTier/WireGuard/Tailscale (extracted to ./routes/vpn.js)
app.use(require('./routes/vpn')({ authenticateToken, VPNManager }))

// WireGuard Hub — generates a VPS setup script (extracted to ./routes/wireguardHub.js)
app.use(require('./routes/wireguardHub')({ authenticateToken, wireguardHub }))

// NTRIP routes (extracted to ./routes/ntrip.js)
app.use(require('./routes/ntrip')({ authenticateToken, ntripClient }))

// Cloud upload routes (extracted to ./routes/cloud.js)
app.use(require('./routes/cloud')({ authenticateToken, cloud }))

// Log conversion routes (extracted to ./routes/logConversion.js)
app.use(require('./routes/logConversion')({ authenticateToken, logConversion }))

// Adhoc WiFi routes (extracted to ./routes/adhoc.js)
app.use(require('./routes/adhoc')({ authenticateToken, adhocManager }))

// Camera control routes (extracted to ./routes/camera.js) — must be after the
// body-parser middleware so camera/start sees req.body
app.use(require('./routes/camera')({ authenticateToken, toBool, vManager, fcManager, camSwitcher, MEDIA_ROOT }))
app.use(require('./routes/secondaryStreams')({ authenticateToken, secondaryStreams }))
app.use(require('./routes/hud')({ authenticateToken, vManager, hudFonts }))

// Camera switcher routes (extracted to ./routes/cameraSwitcher.js)
app.use(require('./routes/cameraSwitcher')({ authenticateToken, requireAdmin, toBool, camSwitcher }))

// Custom video pipeline routes (extracted to ./routes/customPipelines.js)
app.use(require('./routes/customPipelines')({ authenticateToken, toBool, customPipelines, vManager }))

// LTE modem routes (extracted to ./routes/ltemodem.js)
app.use(require('./routes/ltemodem')({ authenticateToken, toBool, lteModem }))

// Cellular video tuning routes (extracted to ./routes/cellularTuning.js)
app.use(require('./routes/cellularTuning')({ authenticateToken, toBool, cellularTuning }))

// Telemetry injector routes (extracted to ./routes/telemetryInjector.js)
app.use(require('./routes/telemetryInjector')({ authenticateToken, toBool, telemetryInjector }))

// Network priority / bandwidth routes (extracted to ./routes/networkPriority.js)
app.use(require('./routes/networkPriority')({ authenticateToken, networkPriority }))

// Dynamic DNS routes (extracted to ./routes/dynamicDns.js)
app.use(require('./routes/dynamicDns')({ authenticateToken, toBool, ddns }))

// Serve the logfiles — S3: authenticate first (flight telemetry/imagery must
// not be downloadable unauthenticated).  authenticateToken accepts a ?token=
// query param (auth.ts) so <a download> links can carry the JWT.
app.use('/logdownload', authenticateToken, express.static(logpaths.flightsLogsDir))
// Serve the media files — S3: same auth gate as /logdownload.
app.use('/media', authenticateToken, express.static(MEDIA_ROOT))

// Flight controller routes (extracted to ./routes/flightController.js)
app.use(require('./routes/flightController')({ authenticateToken, fcManager }))

// FC Configuration page routes (parameter download + decoded overview + DroneCAN scan)
app.use(require('./routes/fcConfig')({ authenticateToken, fcParams, droneCan }))

io.engine.use((req: any, res: any, next: any) => {
  const isHandshake = req._query.sid === undefined
  if (isHandshake) {
    authenticateToken(req, res, next)
  } else {
    next()
  }
})

io.on('connection', function () {
  // only set interval if not already set
  if (FCStatusLoop !== null) {
    return
  }
  // send Flight Controller and NTRIP status out 1 per second
  FCStatusLoop = setInterval(broadcastStatus, 1000)
})

// NetworkManager (wired/WiFi) routes (extracted to ./routes/network.js)
app.use(require('./routes/network')({ authenticateToken, networkManager }))

// Pass GUI requests to the React app only in production mode
/* istanbul ignore next -- guarded by NODE_ENV !== development; never registered in test harness; covered by Package C integration tests */
if (process.env.NODE_ENV !== 'development')
{
  /* istanbul ignore next -- spa-catch-all handler: only active in production mode */
  app.get(['/', '/controller', '/about', '/network',
          '/video', '/vpn', '/ntrip', '/cloud', '/flightlogs',
          '/apclients', '/adhoc', '/logoutconfirm', '/users', '/ppp'], (req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, '..', '/build/index.html'))
  })
}

// Track active connections for graceful shutdown
const activeConnections = new Set()

// Add connection tracking middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  // Return 503 if shutting down
  if (isShuttingDown) {
    res.set('Connection', 'close')
    return res.status(503).json({ error: 'Server is shutting down' })
  }

  // Track this connection
  activeConnections.add(res)

  // Remove when done
  res.on('finish', () => {
    activeConnections.delete(res)
  })

  res.on('close', () => {
    activeConnections.delete(res)
  })

  next()
})

// S5: which address the HTTP/socket.io server binds to. Defaults to 0.0.0.0 (all
// interfaces) so the field WiFi-AP and eth0 access paths keep working; operators
// harden by setting RPANION_BIND_ADDRESS (e.g. the wg0 VPN address). If that
// address cannot be bound at startup we fall back to 0.0.0.0 so the web UI is
// never made unreachable (see the listen() error handler in the run block).
function resolveBindAddress (): string {
  return process.env.RPANION_BIND_ADDRESS || '0.0.0.0'
}

// Test-only seam: exposes module-level singletons so test/index.io.test.js
// can emit events, trigger shutdown, and connect via the real socket.io server.
// Attached to `app` (which is the module export) so require('./index').testHooks
// works. Pure addition — zero production behaviour change.
;(app as any).testHooks = {
  fcManager,
  fcParams,
  droneCan,
  vManager,
  secondaryStreams,
  ntripClient,
  camSwitcher,
  logManager,
  cloud,
  logConversion,
  pppConnectionManager,
  lteModem,
  hudFonts,
  cellularTuning,
  httpServer: http,
  io,
  gracefulShutdown,
  // Seams for the S8/R7/R9 unit tests (deterministic branch coverage).
  safeInit,
  redactToken,
  reqSerializer,
  broadcastStatus,
  resolveBindAddress,
  getIsShuttingDown: () => isShuttingDown,
  setIsShuttingDown: (v: boolean) => { isShuttingDown = v }
};

// Only start the server if this file is being run directly (not imported)
/* istanbul ignore next -- direct-run guard: file is always required (not run directly) in the test harness */
if (require.main === module) {
  const port = process.env.PORT || 3001;
  const host = resolveBindAddress();
  // Never lock the operator out: if a misconfigured RPANION_BIND_ADDRESS can't be
  // bound, fall back to all-interfaces so the web UI stays reachable.
  http.on('error', (err: any) => {
    if (host !== '0.0.0.0') {
      console.error(`[rpanion] could not bind to ${host} (${err && err.code}); falling back to 0.0.0.0`);
      http.listen(port, '0.0.0.0');
    } else {
      throw err;
    }
  });
  http.listen(port, host, () => {
    console.log(`Server running on ${host}:${port}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'production'}`);
    console.log('Press Ctrl+C to stop');
  });
  // Never-locked-out invariant: guarantee a usable admin login always exists
  // (self-heals a random-password admin if the users file is missing/adminless).
  userMgmt.ensureInitialAdmin().catch((e: any) => console.error('ensureInitialAdmin:', e));
}

export = app;

