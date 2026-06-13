const express = require('express')
const fileUpload = require('express-fileupload')
const compression = require('compression')
const pino = require('pino-http')()
const process = require('process')
const jwt = require('jsonwebtoken');
const { common } = require('node-mavlink')

const networkManager = require('./networkManager')
const aboutPage = require('./aboutInfo')
const videoStream = require('./videostream')
const fcManagerClass = require('./flightController')
const flightLogger = require('./flightLogger.js')
const networkClients = require('./networkClients.js')
const ntrip = require('./ntrip.js')
const Adhoc = require('./adhocManager.js')
const cloudManager = require('./cloudUpload.js')
const VPNManager = require('./vpn')
const logConversionManager = require('./logConverter.js')
const userLogin = require('./userLogin.js')
const logpaths = require('./paths.js')
const CameraSwitcher = require('./cameraSwitcher.js')
const CustomPipelines = require('./customPipelines.js')
const LTEModem = require('./ltemodem.js')
const CellularTuning = require('./cellularTuning.js')
const DynamicDns = require('./dynamicDns.js')
const NetworkPriority = require('./networkPriority.js')
const TelemetryInjector = require('./telemetryInjector.js')

const settings = require('settings-store')

const app = express()
const http = require('http').Server(app)
const path = require('path')

// MEDIA_ROOT is the default storage area used by the Python helpers.
// For security, user-provided paths are required to live within it.
const MEDIA_ROOT = logpaths.mediaDir; // absolute path to rpanion-server/media


const io = require('socket.io')(http, { cookie: false })
const { check, validationResult } = require('express-validator')
const crypto = require('crypto');

// Coerce a request-body field to boolean, accepting JSON true or the string 'true'
const toBool = (v) => v === true || v === 'true'

// set up rate limiter: maximum of fifty requests per minute
const RateLimit = require('express-rate-limit')
const pppConnection = require('./pppConnection.js')
const limiter = RateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 50,
  // Skip rate-limiting in development so the full test suite (~150+ requests
  // from 127.0.0.1) never hits the 50-req/min ceiling.  Production behaviour
  // is unchanged.  Set ENABLE_RATE_LIMIT=1 to force the limiter on even in
  // development (e.g. to test the 429 path).
  skip: (req) => process.env.NODE_ENV === 'development' && !process.env.ENABLE_RATE_LIMIT
})

// Generate a new key if not provided
function generateSecretKey() {
  return crypto.randomBytes(64).toString('hex');
}
const RPANION_SECRET_KEY = process.env.RPANION_SECRET_KEY || generateSecretKey();
const tokenBlacklist = new Set();

// RBAC: read-only users may not perform mutating (POST) requests. These POST
// endpoints are exempt because they are not configuration mutations.
const WRITE_ALLOWLIST = new Set(['/api/auth', '/api/logout']);

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
// cellular video tuning: ties the LTE modem's signal quality to the video
// stream's encoder bitrate
const cellularTuning = new CellularTuning(settings, {
  getSignal: () => {
    const ltestatus = lteModem.getStatus()
    return ltestatus.available ? ltestatus.signal : null
  },
  isStreaming: () => vManager.active && vManager.cameraMode === 'streaming' && vManager.deviceStream !== null,
  getConfiguredBitrate: () => (vManager.videoSettings && vManager.videoSettings.bitrate) || null,
  setBitrate: (kbps) => vManager.setBitrate(kbps),
  getAckBitrate: () => vManager.currentBitrate
})

const ddns = new DynamicDns(settings)

const networkPriority = new NetworkPriority()

const telemetryInjector = new TelemetryInjector(settings)

// Graceful shutdown implementation
let isShuttingDown = false
const SHUTDOWN_TIMEOUT = 10000 // 10 seconds

async function gracefulShutdown(signal, exitCode = 0) {
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
        http.close((err) => {
          if (err) {
            console.error('Error closing HTTP server:', err)
            reject(err)
          } else {
            resolve()
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
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err)
  gracefulShutdown('uncaughtException', 1)
})

// Handle unhandled promise rejections
/* istanbul ignore next -- global handler: triggering unhandledRejection would terminate mocha; covered path is gracefulShutdown itself */
process.on('unhandledRejection', (reason, promise) => {
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
ntripClient.eventEmitter.on('rtcmpacket', (msg, seq) => {
  // logManager.writetlog(msg.buf);
  try {
    if (fcManager.m) {
      fcManager.m.sendRTCMMessage(msg, seq)
    }
  } catch (err) {
    console.log(err)
  }
})


// This function responds to a MAVLink command to capture a photo.
vManager.eventEmitter.on('digicamcontrol', (senderSysId, senderCompId, targetComponent) => {
  try {
    if (fcManager.m) {
      // Acknowledge the MAV_CMD_DO_DIGICAM_CONTROL command
      fcManager.m.sendCommandAck(203, 0, senderSysId, senderCompId, targetComponent)
    }
  } catch (err) {
    console.log('Error acknowledging DoDigicamControl:', err);
  }
})

// Got a camera heartbeat event, send to flight controller
vManager.eventEmitter.on('cameraheartbeat', (mavType, autopilot, component) => {
  try {
    if (fcManager.m) {
      fcManager.m.sendHeartbeat(mavType, autopilot, component)
    }
  } catch (err) {
    console.log('Error sending camera heartbeat:', err);
  }
})

// Got a CAMERA_INFORMATION event, send to flight controller
vManager.eventEmitter.on('camerainfo', (msg, senderSysId, senderCompId, targetComponent) => {
  try {
    if (fcManager.m) {
      // Acknowledge the CAMERA_INFORMATION request
      fcManager.m.sendCommandAck(common.CameraInformation.MSG_ID, 0, senderSysId, senderCompId, targetComponent)
      fcManager.m.sendData(msg, senderCompId)
    }
  } catch (err) {
    console.log('Error sending CameraInformation:', err);
  }
})

// Got a VIDEO_STREAM_INFORMATION event, send to flight controller
vManager.eventEmitter.on('videostreaminfo', (msg, senderSysId, senderCompId, targetComponent) => {
  try {
    if (fcManager.m) {
      // Acknowledge the VIDEO_STREAM_INFORMATION request
      fcManager.m.sendCommandAck(common.VideoStreamInformation.MSG_ID, 0, senderSysId, senderCompId, targetComponent)
      fcManager.m.sendData(msg, senderCompId)
    }
  } catch (err) {
    console.log('Error sending VideoStreamInformation:', err);
  }
})

// Got a CAMERA_SETTINGS event, send to flight controller
vManager.eventEmitter.on('camerasettings', (msg, senderSysId, senderCompId, targetComponent) => {
  try {
    if (fcManager.m) {
      // Acknowledge the CAMERA_SETTINGS request
      fcManager.m.sendCommandAck(common.CameraSettings.MSG_ID, 0, senderSysId, senderCompId, targetComponent)
      fcManager.m.sendData(msg, senderCompId)
    }
  } catch (err) {
    console.log('Error sending CameraSettings:', err);
    // console.log(err)
  }
})

// Got a CAMERA_TRIGGER event, send to flight controller
vManager.eventEmitter.on('cameratrigger', (msg, senderCompId) => {
  try {
    if (fcManager.m) {
      // Send the CAMERA_TRIGGER message to the flight controller
      fcManager.m.sendData(msg, senderCompId)
    }
  } catch (err) {
    console.log('Error sending CameraTrigger:', err);
  }
})

vManager.eventEmitter.on('filesaved', (filepath) => {
  try {
    io.sockets.emit('camera:filesaved', { filename: filepath });
    console.log('Pushed filesaved to clients:', filepath);
  } catch (e) {
    console.error('Failed to emit filesaved:', e);
  }
});

// Connecting the flight controller datastream to the logger
// and ntrip and video
fcManager.eventEmitter.on('gotMessage', (packet, data) => {
  try {
    ntripClient.onMavPacket(packet, data)
    vManager.onMavPacket(packet, data)
    camSwitcher.onMavPacket(packet, data)
    // ask the FC to stream RC_CHANNELS (2 Hz), once per link, if the
    // camera switcher needs it
    if (camSwitcher.getSettings().enabled && !camSwitcher.streamRequested &&
        fcManager.m && fcManager.m.targetSystem !== null) {
      camSwitcher.streamRequested = true
      fcManager.m.sendSetMessageInterval(common.RcChannels.MSG_ID, 500000)
    }
  } catch (err) {
    console.log('Error processing MAVLink message in listener:', err);
  }
})

// Camera switcher decided to switch - flip the video pipeline source.
// In 'command' mode the switch command has already been run by the switcher
camSwitcher.eventEmitter.on('switch', (source, switchMode) => {
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

let FCStatusLoop = null

app.use(express.urlencoded({ extended: true }))
app.use(pino)

// Simply pass `compression` as an Express middleware!
app.use(compression())
app.use(express.json())

// Serve the static files from the React app
app.use(express.static(path.join(__dirname, '..', '/build')))

// User login
app.post('/api/login', [check('username').escape().isLength({ min: 2, max:20 }), check('password').escape().isLength({ min: 2, max:20 })], async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    console.log('Bad POST vars in /api/login', { message: JSON.stringify(errors.array()) })
    return res.status(422).json({ error: JSON.stringify(errors.array()) })
  }
  // Capture the input fields
  let username = req.body.username
  let password = req.body.password

  userMgmt.checkLoginDetails(username, password).then(async (match) => {
    if (match) {
      // Generate a token with user information, including the RBAC role
      const role = await userMgmt.getUserRole(username)
      const token = jwt.sign({ username: username, role: role }, RPANION_SECRET_KEY, {
        expiresIn: '1h', // Token expires in 1 hour
      })
      res.send({
        token: token
      })
    } else {
      res.status(401).send(JSON.stringify({error: 'Invalid username or password'}))
    }
  })
})

// List all users
app.get('/api/users', authenticateToken, (req, res) => {
  userMgmt.getAllUsers().then((users) => {
    res.send(JSON.stringify({users: users}))
  })
})

// Update existing user password
app.post('/api/updateUserPassword', authenticateToken, [check('username').escape().isLength({ min: 2, max:20 }), check('password').escape().isLength({ min: 2, max:20 })], async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    console.log('Bad POST vars in /api/updateUserPassword', { message: JSON.stringify(errors.array()) })
    return res.status(422).json({ error: JSON.stringify(errors.array()) })
  }
  const { username, password } = req.body;

  /* istanbul ignore next -- unreachable: express-validator min:2 on both fields already rejects missing/empty values before this guard */
  if (!username || !password) {
    //return res.status(400).send({
    //  error: 'Username and password are required'
    //})
    res.status(400).send(JSON.stringify({error: 'Username and password are required'}))
  }

  userMgmt.changePassword(username, password).then((success) => {
    if (success) {
      res.send(JSON.stringify({infoMessage: 'User password updated successfully'}))
    } else {
      res.status(500).send(JSON.stringify({error: 'Error updating user password'}))
    }
  })
})

// Create new user
app.post('/api/createUser', authenticateToken, [check('username').escape().isLength({ min: 2, max:20 }), check('password').escape().isLength({ min: 2, max:20 }), check('role').optional().isIn(['admin', 'readonly'])], async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    console.log('Bad POST vars in /api/createUser', { message: JSON.stringify(errors.array()) })
    return res.status(422).json({ error: JSON.stringify(errors.array()) })
  }
  const { username, password, role } = req.body

  /* istanbul ignore next -- unreachable: express-validator min:2 on both fields already rejects missing/empty values before this guard */
  if (!username || !password) {
    return res.status(400).send(JSON.stringify({error: 'Username and password are required'}))
  }

  userMgmt.addUser(username, password, role).then((success) => {
    if (success) {
      res.send(JSON.stringify({infoMessage: 'User created successfully'}))
    } else {
      res.status(500).send(JSON.stringify({error: 'Error creating user'}))
    }
  })
})

// Update an existing user's role (admin only, enforced by authenticateToken)
app.post('/api/updateUserRole', authenticateToken, [check('username').escape().isLength({ min: 2, max:20 }), check('role').isIn(['admin', 'readonly'])], (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    console.log('Bad POST vars in /api/updateUserRole', { message: JSON.stringify(errors.array()) })
    return res.status(422).json({ error: JSON.stringify(errors.array()) })
  }
  const { username, role } = req.body

  userMgmt.updateRole(username, role).then((success) => {
    if (success) {
      res.send(JSON.stringify({infoMessage: 'User role updated successfully'}))
    } else {
      res.status(500).send(JSON.stringify({error: 'Error updating user role'}))
    }
  })
})

// Delete a user
app.post('/api/deleteUser', authenticateToken, [check('username').escape().isLength({ min: 2, max:20 })], (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    console.log('Bad POST vars in /api/deleteUser', { message: JSON.stringify(errors.array()) })
    return res.status(422).json({ error: JSON.stringify(errors.array()) })
  }
  const { username } = req.body

  /* istanbul ignore next -- unreachable: express-validator min:2 on username already rejects missing/empty value before this guard */
  if (!username) {
    return res.status(400).send(JSON.stringify({error: 'Username is required'}))
  }

  userMgmt.deleteUser(username).then((success) => {
    if (success) {
      res.send(JSON.stringify({infoMessage: 'User deleted successfully'}))
    } else {
      res.status(500).send(JSON.stringify({error: 'Error deleting user'}))
    }
  })
})

// User logout
app.post('/api/logout', authenticateToken, async (req, res) => {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]

  // Add token to the blacklist
  tokenBlacklist.add(token)

  res.send({
    token: token
  })
})

// Simple token authentication call
app.post('/api/auth', authenticateToken, async (req, res) => {
  const authEnabled = !(process.env.NODE_ENV === 'development' || process.env.DISABLE_AUTH === '1')

  res.setHeader('Content-Type', 'application/json')
  res.send(JSON.stringify({
    authEnabled,
    role: req.user?.role
  }))
})

// Middleware to check if the request has a valid token
function authenticateToken(req, res, next) {
  // Skip authentication in development mode
  if (process.env.NODE_ENV === 'development' || process.env.DISABLE_AUTH === '1') {
    return next();
  }

  // Determine if this is a Socket.IO request
  const isSocketIO = typeof res.status !== 'function'

  // Helper function to send error responses
  const sendError = (statusCode, message) => {
    if (isSocketIO) {
      return next(new Error(message))
    }
    return res.status(statusCode).json({ message })
  }

  // Extract token
  let token;
  try {
    const authHeader = req.headers['authorization']
    token = authHeader && authHeader.split(' ')[1]
  } catch (err) /* istanbul ignore next -- header property access cannot throw in express */ {
    return sendError(401, 'Access denied. No token provided.')
  }

  if (!token) {
    return sendError(401, 'Access denied. No token provided.')
  }

  // Check if the token is blacklisted
  if (tokenBlacklist.has(token)) {
    return sendError(401, 'Invalid token')
  }

  // Verify token
  jwt.verify(token, RPANION_SECRET_KEY, (err, user) => {
    if (err) {
      return sendError(403, 'Invalid token')
    }
    req.user = user
    // RBAC: read-only users may only read. Block mutating (POST) requests
    // except the auth/logout housekeeping endpoints.
    if (req.method === 'POST' && user.role === 'readonly' && !WRITE_ALLOWLIST.has(req.path)) {
      return sendError(403, 'Read-only user: write access denied')
    }
    next()
  })
}

// PPP connection routes (extracted to ./routes/ppp.js)
app.use(require('./routes/ppp.js')({ authenticateToken, pppConnectionManager }))

// System / about / logs / settings routes (extracted to ./routes/system.js)
app.use(require('./routes/system.js')({ authenticateToken, aboutPage, networkClients, logManager, fcManager }))

// VPN routes — ZeroTier/WireGuard/Tailscale (extracted to ./routes/vpn.js)
app.use(require('./routes/vpn.js')({ authenticateToken, VPNManager }))

// NTRIP routes (extracted to ./routes/ntrip.js)
app.use(require('./routes/ntrip.js')({ authenticateToken, ntripClient }))

// Cloud upload routes (extracted to ./routes/cloud.js)
app.use(require('./routes/cloud.js')({ authenticateToken, cloud }))

// Log conversion routes (extracted to ./routes/logConversion.js)
app.use(require('./routes/logConversion.js')({ authenticateToken, logConversion }))

// Adhoc WiFi routes (extracted to ./routes/adhoc.js)
app.use(require('./routes/adhoc.js')({ authenticateToken, adhocManager }))

// Camera control routes (extracted to ./routes/camera.js) — must be after the
// body-parser middleware so camera/start sees req.body
app.use(require('./routes/camera.js')({ authenticateToken, toBool, vManager, fcManager, camSwitcher, MEDIA_ROOT }))

// Camera switcher routes (extracted to ./routes/cameraSwitcher.js)
app.use(require('./routes/cameraSwitcher.js')({ authenticateToken, toBool, camSwitcher }))

// Custom video pipeline routes (extracted to ./routes/customPipelines.js)
app.use(require('./routes/customPipelines.js')({ authenticateToken, toBool, customPipelines, vManager }))

// LTE modem routes (extracted to ./routes/ltemodem.js)
app.use(require('./routes/ltemodem.js')({ authenticateToken, toBool, lteModem }))

// Cellular video tuning routes (extracted to ./routes/cellularTuning.js)
app.use(require('./routes/cellularTuning.js')({ authenticateToken, toBool, cellularTuning }))

// Telemetry injector routes (extracted to ./routes/telemetryInjector.js)
app.use(require('./routes/telemetryInjector.js')({ authenticateToken, toBool, telemetryInjector }))

// Network priority / bandwidth routes (extracted to ./routes/networkPriority.js)
app.use(require('./routes/networkPriority.js')({ authenticateToken, networkPriority }))

// Dynamic DNS routes (extracted to ./routes/dynamicDns.js)
app.use(require('./routes/dynamicDns.js')({ authenticateToken, toBool, ddns }))

// Serve the logfiles
app.use('/logdownload', express.static(logpaths.flightsLogsDir))
// Serve the media files
app.use('/media', express.static(MEDIA_ROOT))

// Flight controller routes (extracted to ./routes/flightController.js)
app.use(require('./routes/flightController.js')({ authenticateToken, fcManager }))

io.engine.use((req, res, next) => {
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
    io.sockets.emit('FCStatus', fcManager.getSystemStatus())
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
app.use(require('./routes/network.js')({ authenticateToken, networkManager }))

// Pass GUI requests to the React app only in production mode
/* istanbul ignore next -- guarded by NODE_ENV !== development; never registered in test harness; covered by Package C integration tests */
if (process.env.NODE_ENV !== 'development')
{
  /* istanbul ignore next -- spa-catch-all handler: only active in production mode */
  app.get(['/', '/controller', '/about', '/network',
          '/video', '/vpn', '/ntrip', '/cloud', '/flightlogs',
          '/apclients', '/adhoc', '/logoutconfirm', '/users', '/ppp'], (req, res) => {
    res.sendFile(path.join(__dirname, '..', '/build/index.html'))
  })
}

// Track active connections for graceful shutdown
const activeConnections = new Set()

// Add connection tracking middleware
app.use((req, res, next) => {
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

module.exports = app;

// Test-only seam: exposes module-level singletons so test/index.io.test.js
// can emit events, trigger shutdown, and connect via the real socket.io server.
// Pure addition — zero production behaviour change.
module.exports.testHooks = {
  fcManager,
  vManager,
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
  setIsShuttingDown: (v) => { isShuttingDown = v }
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

