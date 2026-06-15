import type { Request, Response, NextFunction } from 'express'
const express = require('express')
const fileUpload = require('express-fileupload')
const compression = require('compression')
const pino = require('pino-http')()
const process = require('process')
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
const CellularTuning = require('./cellularTuning')
const DynamicDns = require('./dynamicDns')
const NetworkPriority = require('./networkPriority')
const TelemetryInjector = require('./telemetryInjector')

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
const limiter = RateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 50,
  // Skip rate-limiting in development so the full test suite (~150+ requests
  // from 127.0.0.1) never hits the 50-req/min ceiling.  Production behaviour
  // is unchanged.  Set ENABLE_RATE_LIMIT=1 to force the limiter on even in
  // development (e.g. to test the 429 path).
  skip: (req: Request) => process.env.NODE_ENV === 'development' && !process.env.ENABLE_RATE_LIMIT
})


// apply rate limiter to all requests
app.use(limiter)

// use file uploader for Wireguard profiles
app.use(fileUpload({ limits: { fileSize: 1000 }, abortOnLimit: true, useTempFiles: true, tempFileDir: '/tmp/', safeFileNames: true, preserveExtension: 4 }))

// Init settings before running the other classes
settings.init({
  appName: 'Rpanion-server', // required,
  reverseDNS: 'com.server.rpanion', // required for macOS
  filename: logpaths.settingsFile
})

const vManager = new videoStream(settings)
const secondaryStreams = new (require('./secondaryStreams'))(settings, vManager)
// let the camera protocol (VIDEO_STREAM_INFORMATION) advertise the secondaries too
vManager.secondaryStreams = secondaryStreams
const fcManager = new fcManagerClass(settings)
const logManager = new flightLogger()
const ntripClient = new ntrip(settings)
const cloud = new cloudManager(settings)
const logConversion = new logConversionManager(settings)
const adhocManager = new Adhoc(settings)
const userMgmt = new userLogin()
const pppConnectionManager = new pppConnection(settings)
const camSwitcher = new CameraSwitcher(settings)
const customPipelines = new CustomPipelines(settings)
const lteModem = new LTEModem(settings)
// let the graphic HUD overlay the modem's GNSS fix (#173 modem-GPS follow-up)
vManager.lteModem = lteModem
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
const { authenticateToken, router: authRouter } = require('./auth')({ userMgmt })

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

app.use(express.urlencoded({ extended: true }))
app.use(pino)

// Simply pass `compression` as an Express middleware!
app.use(compression())
app.use(express.json())

// Serve the static files from the React app
app.use(express.static(path.join(__dirname, '..', '/build')))

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
app.use(require('./routes/hud')({ authenticateToken, vManager }))

// Camera switcher routes (extracted to ./routes/cameraSwitcher.js)
app.use(require('./routes/cameraSwitcher')({ authenticateToken, toBool, camSwitcher }))

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

// Serve the logfiles
app.use('/logdownload', express.static(logpaths.flightsLogsDir))
// Serve the media files
app.use('/media', express.static(MEDIA_ROOT))

// Flight controller routes (extracted to ./routes/flightController.js)
app.use(require('./routes/flightController')({ authenticateToken, fcManager }))

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
  FCStatusLoop = setInterval(function () {
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
  }, 1000)
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

// Test-only seam: exposes module-level singletons so test/index.io.test.js
// can emit events, trigger shutdown, and connect via the real socket.io server.
// Attached to `app` (which is the module export) so require('./index').testHooks
// works. Pure addition — zero production behaviour change.
;(app as any).testHooks = {
  fcManager,
  vManager,
  secondaryStreams,
  ntripClient,
  camSwitcher,
  logManager,
  cloud,
  logConversion,
  pppConnectionManager,
  lteModem,
  cellularTuning,
  httpServer: http,
  io,
  gracefulShutdown,
  getIsShuttingDown: () => isShuttingDown,
  setIsShuttingDown: (v: boolean) => { isShuttingDown = v }
};

// Only start the server if this file is being run directly (not imported)
/* istanbul ignore next -- direct-run guard: file is always required (not run directly) in the test harness */
if (require.main === module) {
  const port = process.env.PORT || 3001;
  /* istanbul ignore next -- http.listen callback: only executed when running standalone */
  http.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'production'}`);
    console.log('Press Ctrl+C to stop');
  });
}

export = app;

