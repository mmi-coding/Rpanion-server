/**
 * Shared test harness for server/index.js.
 *
 * Exports:
 *   app        — the Express app (already required; no port bound)
 *   getServer  — returns a Promise<net.Server> listening on an ephemeral port;
 *                idempotent: the same server is reused across require()s.
 *   getPort    — returns the port the server is listening on (after getServer())
 *   request    — Promise-based HTTP helper (uses Node's built-in http module)
 *   closeServer — close the shared server (call from a suite-level after())
 *
 * request(method, path, { body, headers, token, raw })
 *   method   — 'GET'|'POST'|...
 *   path     — e.g. '/api/login'
 *   body     — JS object; serialised as JSON, Content-Type set automatically
 *   headers  — additional headers object
 *   token    — if set, adds Authorization: Bearer <token>
 *   raw      — if true, returns the raw http.IncomingMessage (plus .body string
 *              and .json parsed value); otherwise returns { status, body, headers }
 *              where body is already JSON-parsed (or the raw string on failure).
 *
 * Packages B and C: call getServer() in their before(), closeServer() in their
 * after().  The module caches a single server instance so parallel describe
 * blocks within one mocha run share it without fighting over a port.
 */

'use strict'

const http = require('http')

// Require the app once — module.exports = app, no port bound
const app = require('../server/index')

let _server = null
let _port = null

/**
 * Start the shared server (or return the already-running one).
 * @returns {Promise<http.Server>}
 */
function getServer () {
  if (_server) return Promise.resolve(_server)
  return new Promise((resolve, reject) => {
    const srv = http.createServer(app)
    srv.listen(0, '127.0.0.1', () => {
      _server = srv
      _port = srv.address().port
      resolve(srv)
    })
    srv.on('error', reject)
  })
}

/**
 * Close the shared server.  Safe to call even if it was never started.
 * @returns {Promise<void>}
 */
function closeServer () {
  if (!_server) return Promise.resolve()
  return new Promise((resolve, reject) => {
    _server.close((err) => {
      _server = null
      _port = null
      if (err) reject(err)
      else resolve()
    })
  })
}

/**
 * Return the port the server is listening on.  Call after getServer().
 * @returns {number}
 */
function getPort () {
  if (!_port) throw new Error('indexApp: server not started yet — call getServer() first')
  return _port
}

/**
 * Make an HTTP request to the shared server.
 *
 * @param {string} method
 * @param {string} path
 * @param {object} [opts]
 * @param {object} [opts.body]       — JSON body
 * @param {object} [opts.headers]    — extra headers
 * @param {string} [opts.token]      — Bearer token
 * @param {boolean} [opts.raw]       — return raw IncomingMessage-like object
 * @returns {Promise<{status:number, body:any, headers:object}>}
 */
function request (method, reqPath, opts) {
  opts = opts || {}
  const port = getPort()

  return new Promise((resolve, reject) => {
    const headers = Object.assign({ Accept: 'application/json' }, opts.headers || {})
    if (opts.token) {
      headers['Authorization'] = 'Bearer ' + opts.token
    }

    let bodyData = null
    if (opts.body !== undefined) {
      bodyData = JSON.stringify(opts.body)
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = Buffer.byteLength(bodyData)
    }

    const options = {
      hostname: '127.0.0.1',
      port: port,
      path: reqPath,
      method: method,
      headers: headers
    }

    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        if (opts.raw) {
          res.body = data
          try { res.json = JSON.parse(data) } catch (_) { res.json = null }
          return resolve(res)
        }
        let parsed
        try { parsed = JSON.parse(data) } catch (_) { parsed = data }
        resolve({
          status: res.statusCode,
          body: parsed,
          headers: res.headers
        })
      })
    })

    req.on('error', reject)
    if (bodyData !== null) req.write(bodyData)
    req.end()
  })
}

module.exports = { app, getServer, closeServer, getPort, request }
