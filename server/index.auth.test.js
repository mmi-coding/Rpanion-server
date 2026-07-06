'use strict'

const assert = require('assert')
const sinon = require('sinon')
const { describe, it, before, after, afterEach } = require('mocha')
const jwt = require('jsonwebtoken')
const userLogin = require('./userLogin')
const CameraSwitcher = require('./cameraSwitcher')

// Shared harness — server started once by index.test.js before() via getServer()
const { getServer, request } = require('../test/indexApp')

// ---------------------------------------------------------------------------
// Ensure the shared server is running before any auth tests run
// ---------------------------------------------------------------------------
before(function (done) {
  getServer().then(() => done()).catch(done)
})

// Helper: obtain a fresh JWT token from the server
async function getToken () {
  const res = await request('POST', '/api/login', {
    body: { username: 'admin', password: 'admin' }
  })
  if (res.status !== 200) throw new Error('getToken: login failed, status ' + res.status)
  return res.body.token
}

describe('Auth and user routes', function () {
  // Restore any sinon stubs after each test
  afterEach(function () {
    sinon.restore()
  })

  // -------------------------------------------------------------------------
  // POST /api/login
  // -------------------------------------------------------------------------
  describe('POST /api/login', function () {
    it('200 — valid admin credentials return a JWT token', async function () {
      const res = await request('POST', '/api/login', {
        body: { username: 'admin', password: 'admin' }
      })
      assert.equal(res.status, 200)
      assert.ok(res.body.token, 'expected token in response')
    })

    it('401 — wrong password returns Unauthorized', async function () {
      const res = await request('POST', '/api/login', {
        body: { username: 'admin', password: 'wrongpassword' }
      })
      assert.equal(res.status, 401)
    })

    it('401 — stub checkLoginDetails returning false', async function () {
      sinon.stub(userLogin.prototype, 'checkLoginDetails').resolves(false)
      const res = await request('POST', '/api/login', {
        body: { username: 'admin', password: 'admin' }
      })
      assert.equal(res.status, 401)
    })

    it('422 — username too short fails validation', async function () {
      const res = await request('POST', '/api/login', {
        body: { username: 'a', password: 'admin' }
      })
      assert.equal(res.status, 422)
    })

    it('422 — missing password fails validation', async function () {
      const res = await request('POST', '/api/login', {
        body: { username: 'admin' }
      })
      assert.equal(res.status, 422)
    })

    it('200 — the JWT embeds the user role', async function () {
      const res = await request('POST', '/api/login', {
        body: { username: 'admin', password: 'admin' }
      })
      assert.equal(res.status, 200)
      const decoded = jwt.decode(res.body.token)
      assert.equal(decoded.role, 'admin')
    })
  })

  // -------------------------------------------------------------------------
  // GET /api/users  (authenticateToken is a passthrough in dev mode)
  // -------------------------------------------------------------------------
  describe('GET /api/users', function () {
    it('200 — returns users list in dev mode (no token needed)', async function () {
      const res = await request('GET', '/api/users')
      assert.equal(res.status, 200)
      assert.ok(Array.isArray(res.body.users), 'expected users array')
    })
  })

  // -------------------------------------------------------------------------
  // POST /api/auth
  // -------------------------------------------------------------------------
  describe('POST /api/auth', function () {
    it('200 — returns authEnabled:false in dev mode', async function () {
      const res = await request('POST', '/api/auth', { body: {} })
      assert.equal(res.status, 200)
      assert.strictEqual(res.body.authEnabled, false)
    })

    it('200 — returns authEnabled:true in production mode (with valid token)', async function () {
      // Get a token while still in dev mode so login succeeds without auth
      const token = await getToken()
      const savedEnv = process.env.NODE_ENV
      try {
        process.env.NODE_ENV = 'production'
        const res = await request('POST', '/api/auth', { body: {}, token })
        assert.equal(res.status, 200)
        assert.strictEqual(res.body.authEnabled, true)
      } finally {
        process.env.NODE_ENV = savedEnv
      }
    })

    it('200 — flags mustChangePassword when the default admin password is in use (S1)', async function () {
      // The test fixture (config/user.json) ships admin:admin, so the
      // default-credentials flag must be set for the UI banner.
      const token = await getToken()
      const savedEnv = process.env.NODE_ENV
      try {
        process.env.NODE_ENV = 'production'
        const res = await request('POST', '/api/auth', { body: {}, token })
        assert.equal(res.status, 200)
        assert.strictEqual(res.body.mustChangePassword, true)
      } finally {
        process.env.NODE_ENV = savedEnv
      }
    })

    it('200 — DISABLE_AUTH=1 makes authEnabled false even in production mode', async function () {
      const savedEnv = process.env.NODE_ENV
      try {
        process.env.NODE_ENV = 'production'
        process.env.DISABLE_AUTH = '1'
        // DISABLE_AUTH bypasses authenticateToken, so no token needed
        const res = await request('POST', '/api/auth', { body: {} })
        assert.equal(res.status, 200)
        assert.strictEqual(res.body.authEnabled, false)
      } finally {
        process.env.NODE_ENV = savedEnv
        delete process.env.DISABLE_AUTH
      }
    })

    it('200 — returns the role from the token in production mode', async function () {
      // Mint a read-only token (login runs in dev mode here)
      sinon.stub(userLogin.prototype, 'getUserRole').resolves('readonly')
      const token = (await request('POST', '/api/login', {
        body: { username: 'admin', password: 'admin' }
      })).body.token
      const savedEnv = process.env.NODE_ENV
      try {
        process.env.NODE_ENV = 'production'
        const res = await request('POST', '/api/auth', { body: {}, token })
        assert.equal(res.status, 200)
        assert.strictEqual(res.body.role, 'readonly')
      } finally {
        process.env.NODE_ENV = savedEnv
      }
    })
  })

  // -------------------------------------------------------------------------
  // POST /api/updateUserPassword
  // -------------------------------------------------------------------------
  describe('POST /api/updateUserPassword', function () {
    it('200 — success path', async function () {
      sinon.stub(userLogin.prototype, 'changePassword').resolves(true)
      const res = await request('POST', '/api/updateUserPassword', {
        body: { username: 'admin', password: 'newpass' }
      })
      assert.equal(res.status, 200)
      assert.ok(res.body.infoMessage)
    })

    it('500 — changePassword returns false', async function () {
      sinon.stub(userLogin.prototype, 'changePassword').resolves(false)
      const res = await request('POST', '/api/updateUserPassword', {
        body: { username: 'admin', password: 'newpass' }
      })
      assert.equal(res.status, 500)
    })

    it('422 — username too short fails validation', async function () {
      const res = await request('POST', '/api/updateUserPassword', {
        body: { username: 'a', password: 'newpass' }
      })
      assert.equal(res.status, 422)
    })

    it('422 — missing password fails validation', async function () {
      const res = await request('POST', '/api/updateUserPassword', {
        body: { username: 'admin' }
      })
      assert.equal(res.status, 422)
    })
  })

  // -------------------------------------------------------------------------
  // POST /api/createUser
  // -------------------------------------------------------------------------
  describe('POST /api/createUser', function () {
    it('200 — success path', async function () {
      sinon.stub(userLogin.prototype, 'addUser').resolves(true)
      const res = await request('POST', '/api/createUser', {
        body: { username: 'newuser', password: 'password' }
      })
      assert.equal(res.status, 200)
      assert.ok(res.body.infoMessage)
    })

    it('500 — addUser returns false', async function () {
      sinon.stub(userLogin.prototype, 'addUser').resolves(false)
      const res = await request('POST', '/api/createUser', {
        body: { username: 'newuser', password: 'password' }
      })
      assert.equal(res.status, 500)
    })

    it('422 — username too short fails validation', async function () {
      const res = await request('POST', '/api/createUser', {
        body: { username: 'a', password: 'password' }
      })
      assert.equal(res.status, 422)
    })

    it('422 — missing password fails validation', async function () {
      const res = await request('POST', '/api/createUser', {
        body: { username: 'newuser' }
      })
      assert.equal(res.status, 422)
    })

    it('422 — invalid role fails validation', async function () {
      const res = await request('POST', '/api/createUser', {
        body: { username: 'newuser', password: 'password', role: 'superuser' }
      })
      assert.equal(res.status, 422)
    })

    it('200 — a valid role is passed through to addUser', async function () {
      const stub = sinon.stub(userLogin.prototype, 'addUser').resolves(true)
      const res = await request('POST', '/api/createUser', {
        body: { username: 'newuser', password: 'password', role: 'admin' }
      })
      assert.equal(res.status, 200)
      assert.ok(stub.calledWith('newuser', 'password', 'admin'))
    })
  })

  // -------------------------------------------------------------------------
  // POST /api/deleteUser
  // -------------------------------------------------------------------------
  describe('POST /api/deleteUser', function () {
    it('200 — success path', async function () {
      sinon.stub(userLogin.prototype, 'deleteUser').resolves(true)
      const res = await request('POST', '/api/deleteUser', {
        body: { username: 'admin' }
      })
      assert.equal(res.status, 200)
      assert.ok(res.body.infoMessage)
    })

    it('500 — deleteUser returns false', async function () {
      sinon.stub(userLogin.prototype, 'deleteUser').resolves(false)
      const res = await request('POST', '/api/deleteUser', {
        body: { username: 'admin' }
      })
      assert.equal(res.status, 500)
    })

    it('422 — username too short fails validation', async function () {
      const res = await request('POST', '/api/deleteUser', {
        body: { username: 'a' }
      })
      assert.equal(res.status, 422)
    })
  })

  // -------------------------------------------------------------------------
  // POST /api/logout  +  blacklist verification
  // -------------------------------------------------------------------------
  describe('POST /api/logout', function () {
    it('200 — logs out and gets the token echoed back', async function () {
      const token = await getToken()

      // Logout with that token (dev mode: no auth needed to reach the handler)
      const logoutRes = await request('POST', '/api/logout', { token })
      assert.equal(logoutRes.status, 200)
      assert.ok(logoutRes.body.token)
    })
  })

  // -------------------------------------------------------------------------
  // authenticateToken middleware — production-mode sub-describe
  //
  // We switch NODE_ENV to 'production' so authenticateToken is no longer a
  // passthrough.  Every test restores it via try/finally; the sub-describe
  // also has an after() belt-and-braces restore.
  //
  // The socket.io path (typeof res.status !== 'function') is NOT exercised
  // here — that requires a socket.io handshake with a production-mode server,
  // which is Package C scope.
  // NOTE for Package C: in production mode with no token a socket.io
  // handshake will call next(new Error('Access denied. No token provided.')).
  // -------------------------------------------------------------------------
  describe('authenticateToken middleware (production mode)', function () {
    let savedNodeEnv
    // Pre-fetched tokens obtained before any blacklisting happens in this
    // sub-describe.  JWT iat is in seconds — consecutive getToken() calls
    // within the same second produce identical tokens.  We advance the fake
    // Date clock by 1 second between fetches so each token is unique.
    let validToken      // used for: "valid token grants access"
    let blacklistToken  // used for: "blacklisted token" test
    let expiredToken    // used for: "jwt.verify error path" test

    before(async function () {
      // 3 × 1100 ms iat-spacing sleeps + 3 bcrypt-backed logins: needs far
      // more than the 3.3 s of sleeps alone when the box is under load
      this.timeout(20000)
      savedNodeEnv = process.env.NODE_ENV
      // Obtain three distinct tokens.  JWT iat has 1-second granularity; tokens
      // with the same payload signed within the same second are identical.
      // We wait 1100 ms between fetches so each token has a unique iat and is
      // distinct from any token blacklisted by earlier tests.
      await new Promise((resolve) => setTimeout(resolve, 1100))
      validToken = await getToken()
      await new Promise((resolve) => setTimeout(resolve, 1100))
      blacklistToken = await getToken()
      await new Promise((resolve) => setTimeout(resolve, 1100))
      expiredToken = await getToken()
    })

    after(function () {
      // Belt-and-braces restore
      process.env.NODE_ENV = savedNodeEnv
      delete process.env.DISABLE_AUTH
    })

    afterEach(function () {
      sinon.restore()
      process.env.NODE_ENV = savedNodeEnv
      delete process.env.DISABLE_AUTH
    })

    it('401 — no token provided returns 401', async function () {
      process.env.NODE_ENV = 'production'
      const res = await request('GET', '/api/users')
      assert.equal(res.status, 401)
    })

    it('401 — Authorization header present but token part missing', async function () {
      process.env.NODE_ENV = 'production'
      // "Bearer " with trailing space but no token — split(' ')[1] is undefined
      const res = await request('GET', '/api/users', {
        headers: { Authorization: 'Bearer ' }
      })
      assert.equal(res.status, 401)
    })

    it('403 — garbage/invalid token string returns 403', async function () {
      process.env.NODE_ENV = 'production'
      const res = await request('GET', '/api/users', {
        token: 'this.is.not.a.valid.jwt'
      })
      assert.equal(res.status, 403)
    })

    it('200 — valid token grants access', async function () {
      process.env.NODE_ENV = 'production'
      const res = await request('GET', '/api/users', { token: validToken })
      assert.equal(res.status, 200)
    })

    it('200 — token in the ?token= query param grants access (for <img>/EventSource)', async function () {
      process.env.NODE_ENV = 'production'
      // no Authorization header — the token rides in the query string
      const res = await request('GET', '/api/users?token=' + encodeURIComponent(validToken))
      assert.equal(res.status, 200)
    })

    it('401 — blacklisted token is rejected', async function () {
      // Blacklist the designated token (in dev mode — no auth needed for logout)
      await request('POST', '/api/logout', { token: blacklistToken })

      // Now in production mode the blacklisted token must be rejected
      process.env.NODE_ENV = 'production'
      const res = await request('GET', '/api/users', { token: blacklistToken })
      assert.equal(res.status, 401)
    })

    it('403 — jwt.verify error path (stub to return TokenExpiredError)', async function () {
      // Stub jwt.verify so it calls back with an expiry error.
      // expiredToken is distinct from any blacklisted token so the blacklist
      // check passes and jwt.verify (stubbed) is reached.
      // jwt.verify is now called with an options object ({ algorithms: ['HS256'] },
      // S15) so the callback is the 4th arg — the fake must accept _opts.
      sinon.stub(jwt, 'verify').callsFake((_tok, _secret, _opts, cb) => {
        const err = new Error('jwt expired')
        err.name = 'TokenExpiredError'
        cb(err, null)
      })

      process.env.NODE_ENV = 'production'
      const res = await request('GET', '/api/users', { token: expiredToken })
      assert.equal(res.status, 403)
    })

    it('passthrough — DISABLE_AUTH=1 bypasses auth even in production mode', async function () {
      process.env.NODE_ENV = 'production'
      process.env.DISABLE_AUTH = '1'
      const res = await request('GET', '/api/users')
      assert.equal(res.status, 200)
    })
  })

  // -------------------------------------------------------------------------
  // POST /api/updateUserRole
  // -------------------------------------------------------------------------
  describe('POST /api/updateUserRole', function () {
    it('200 — success path', async function () {
      sinon.stub(userLogin.prototype, 'updateRole').resolves(true)
      const res = await request('POST', '/api/updateUserRole', {
        body: { username: 'admin', role: 'readonly' }
      })
      assert.equal(res.status, 200)
      assert.ok(res.body.infoMessage)
    })

    it('500 — updateRole returns false', async function () {
      sinon.stub(userLogin.prototype, 'updateRole').resolves(false)
      const res = await request('POST', '/api/updateUserRole', {
        body: { username: 'admin', role: 'readonly' }
      })
      assert.equal(res.status, 500)
    })

    it('422 — invalid role fails validation', async function () {
      const res = await request('POST', '/api/updateUserRole', {
        body: { username: 'admin', role: 'root' }
      })
      assert.equal(res.status, 422)
    })

    it('422 — username too short fails validation', async function () {
      const res = await request('POST', '/api/updateUserRole', {
        body: { username: 'a', role: 'admin' }
      })
      assert.equal(res.status, 422)
    })
  })

  // -------------------------------------------------------------------------
  // RBAC write protection — read-only users may not POST mutating routes.
  // Tokens are minted with distinct usernames (stubbed login) so they never
  // collide with the admin/admin tokens blacklisted elsewhere.
  // -------------------------------------------------------------------------
  describe('RBAC write protection (production mode)', function () {
    let savedNodeEnv
    let readonlyToken
    let adminToken

    before(async function () {
      this.timeout(20000)
      savedNodeEnv = process.env.NODE_ENV
      sinon.stub(userLogin.prototype, 'checkLoginDetails').resolves(true)
      const roleStub = sinon.stub(userLogin.prototype, 'getUserRole')
      roleStub.resolves('readonly')
      readonlyToken = (await request('POST', '/api/login', {
        body: { username: 'rbacviewer', password: 'pw' }
      })).body.token
      roleStub.resolves('admin')
      adminToken = (await request('POST', '/api/login', {
        body: { username: 'rbacadmin', password: 'pw' }
      })).body.token
      sinon.restore()
    })

    afterEach(function () {
      sinon.restore()
      process.env.NODE_ENV = savedNodeEnv
    })

    after(function () {
      process.env.NODE_ENV = savedNodeEnv
    })

    it('403 — read-only user cannot POST a mutating route', async function () {
      process.env.NODE_ENV = 'production'
      const res = await request('POST', '/api/createUser', {
        token: readonlyToken,
        body: { username: 'someone', password: 'password' }
      })
      assert.equal(res.status, 403)
    })

    it('200 — read-only user may still GET', async function () {
      process.env.NODE_ENV = 'production'
      const res = await request('GET', '/api/users', { token: readonlyToken })
      assert.equal(res.status, 200)
    })

    it('403 — read-only user cannot DELETE a mutating route (S6)', async function () {
      // The RBAC gate must fire on every non-idempotent verb, not just POST.
      // DELETE /api/hudfonts/:id is a live example of a non-POST mutation; the
      // gate returns before the route handler runs, so no stubbing is needed.
      process.env.NODE_ENV = 'production'
      const res = await request('DELETE', '/api/hudfonts/anyid', { token: readonlyToken })
      assert.equal(res.status, 403)
    })

    it('200 — read-only user may POST an allowlisted route (/api/auth)', async function () {
      process.env.NODE_ENV = 'production'
      const res = await request('POST', '/api/auth', { token: readonlyToken, body: {} })
      assert.equal(res.status, 200)
    })

    it('200 — admin user is not blocked from a mutating POST', async function () {
      sinon.stub(userLogin.prototype, 'addUser').resolves(true)
      process.env.NODE_ENV = 'production'
      const res = await request('POST', '/api/createUser', {
        token: adminToken,
        body: { username: 'someone', password: 'password' }
      })
      assert.equal(res.status, 200)
    })
  })

  // -------------------------------------------------------------------------
  // S4 — the camera-switcher "command" mode is a root-level command-exec
  // primitive (server/cameraSwitcher.ts runs exec(commandA/B) as root). The
  // requireAdmin gate on /api/cameraswitchermodify (stores the command) and
  // /api/cameraswitcherswitch (fires it) must reject any non-admin, and let an
  // admin through.
  // -------------------------------------------------------------------------
  describe('Camera-switcher command mode is admin-only (S4)', function () {
    const validSwitcherBody = {
      enabled: false,
      rcChannel: 7,
      threshold: 1500,
      hysteresis: 50,
      minHoldMs: 500,
      switchMode: 'gstreamer'
    }
    let savedNodeEnv
    let adminToken
    let nonAdminToken

    before(async function () {
      this.timeout(20000)
      savedNodeEnv = process.env.NODE_ENV
      sinon.stub(userLogin.prototype, 'checkLoginDetails').resolves(true)
      const roleStub = sinon.stub(userLogin.prototype, 'getUserRole')
      roleStub.resolves('admin')
      adminToken = (await request('POST', '/api/login', {
        body: { username: 's4admin', password: 'pw' }
      })).body.token
      // A token whose role is neither 'admin' nor 'readonly': authenticateToken's
      // read-only write-block does NOT catch it, so it reaches requireAdmin — the
      // exact gap the admin gate is defence-in-depth against.
      roleStub.resolves(undefined)
      nonAdminToken = (await request('POST', '/api/login', {
        body: { username: 's4nonadmin', password: 'pw' }
      })).body.token
      sinon.restore()
    })

    afterEach(function () {
      sinon.restore()
      process.env.NODE_ENV = savedNodeEnv
    })

    after(function () {
      process.env.NODE_ENV = savedNodeEnv
    })

    it('403 — non-admin cannot POST /api/cameraswitchermodify', async function () {
      process.env.NODE_ENV = 'production'
      const res = await request('POST', '/api/cameraswitchermodify', {
        token: nonAdminToken,
        body: validSwitcherBody
      })
      assert.equal(res.status, 403)
    })

    it('403 — non-admin cannot POST /api/cameraswitcherswitch', async function () {
      process.env.NODE_ENV = 'production'
      const res = await request('POST', '/api/cameraswitcherswitch', {
        token: nonAdminToken,
        body: { source: 'A' }
      })
      assert.equal(res.status, 403)
    })

    it('200 — admin may POST /api/cameraswitchermodify', async function () {
      sinon.stub(CameraSwitcher.prototype, 'setSettings').callsFake(function (opts, cb) { cb(null) })
      sinon.stub(CameraSwitcher.prototype, 'getSettings').returns({ enabled: false })
      process.env.NODE_ENV = 'production'
      const res = await request('POST', '/api/cameraswitchermodify', {
        token: adminToken,
        body: validSwitcherBody
      })
      assert.equal(res.status, 200)
    })

    it('200 — admin may POST /api/cameraswitcherswitch', async function () {
      sinon.stub(CameraSwitcher.prototype, 'doSwitch').returns(undefined)
      sinon.stub(CameraSwitcher.prototype, 'getStatus').returns({ activeSource: 'A' })
      process.env.NODE_ENV = 'production'
      const res = await request('POST', '/api/cameraswitcherswitch', {
        token: adminToken,
        body: { source: 'A' }
      })
      assert.equal(res.status, 200)
    })
  })

  // -------------------------------------------------------------------------
  // S15 — jwt.verify pins the signing algorithm to HS256. A token whose header
  // advertises a different HMAC algorithm (even one signed with the real secret)
  // must be rejected. Driven against the middleware directly with a known secret
  // so the token can be forged (the running server's secret is random/unknown).
  // -------------------------------------------------------------------------
  describe('JWT algorithm pinning (S15)', function () {
    const authModule = require('./auth')
    const SECRET = 'unit-test-secret-key-for-alg-pinning'
    let authenticateToken
    let savedSecret
    let savedNodeEnv

    // Run the middleware and resolve with the outcome: either 'next' (allowed)
    // or an 'error' response carrying the status code.
    function runAuth (req) {
      return new Promise((resolve) => {
        const res = {
          statusCode: 200,
          status (code) { this.statusCode = code; return this },
          json (obj) { resolve({ outcome: 'error', statusCode: this.statusCode, body: obj }) }
        }
        authenticateToken(req, res, () => resolve({ outcome: 'next', statusCode: 200 }))
      })
    }

    function reqFor (token) {
      return { headers: { authorization: 'Bearer ' + token }, query: {}, method: 'GET', path: '/api/users' }
    }

    before(function () {
      savedSecret = process.env.RPANION_SECRET_KEY
      savedNodeEnv = process.env.NODE_ENV
      process.env.RPANION_SECRET_KEY = SECRET
      // Capture the secret at module-construction time, then enforce auth.
      authenticateToken = authModule({ userMgmt: {} }).authenticateToken
      process.env.NODE_ENV = 'production'
    })

    after(function () {
      if (savedSecret === undefined) delete process.env.RPANION_SECRET_KEY
      else process.env.RPANION_SECRET_KEY = savedSecret
      process.env.NODE_ENV = savedNodeEnv
    })

    it('allows a correctly-signed HS256 token', async function () {
      const token = jwt.sign({ username: 'u', role: 'admin' }, SECRET, { algorithm: 'HS256' })
      const out = await runAuth(reqFor(token))
      assert.equal(out.outcome, 'next')
    })

    it('403 — rejects a token signed with a non-HS256 algorithm (HS512)', async function () {
      // Signed with the *real* secret but under HS512 — accepted without the pin,
      // rejected with { algorithms: ['HS256'] }.
      const token = jwt.sign({ username: 'u', role: 'admin' }, SECRET, { algorithm: 'HS512' })
      const out = await runAuth(reqFor(token))
      assert.equal(out.outcome, 'error')
      assert.equal(out.statusCode, 403)
    })
  })

  // -------------------------------------------------------------------------
  // Rate limiter seam
  // -------------------------------------------------------------------------
  describe('Rate limiter seam', function () {
    it('skips limiter in development mode — no 429 across many requests', async function () {
      const results = []
      for (let i = 0; i < 10; i++) {
        results.push(await request('GET', '/api/users'))
      }
      results.forEach((res, idx) => {
        assert.notEqual(res.status, 429, `request ${idx + 1} was unexpectedly rate-limited`)
      })
    })

    it('ENABLE_RATE_LIMIT=1 re-enables limiter (skip function returns false) — request still succeeds below cap', async function () {
      // We verify the skip path returns false when ENABLE_RATE_LIMIT is set
      // by confirming a single request succeeds (we are well below 50 req/min).
      process.env.ENABLE_RATE_LIMIT = '1'
      try {
        const res = await request('GET', '/api/users')
        // Well below the 50 req/min cap — should still succeed
        assert.notEqual(res.status, 429)
      } finally {
        delete process.env.ENABLE_RATE_LIMIT
      }
    })
  })

  // -------------------------------------------------------------------------
  // S3 — /logdownload and /media are behind authenticateToken. Unauthenticated
  // requests are rejected in production; the JWT may ride in ?token= so
  // <a download> links still work.
  // -------------------------------------------------------------------------
  describe('Static file auth — /logdownload and /media (S3)', function () {
    const fs = require('fs')
    const path = require('path')
    const logpaths = require('./paths')
    let savedNodeEnv
    let token

    before(async function () {
      this.timeout(20000)
      savedNodeEnv = process.env.NODE_ENV
      // mint a real JWT in dev mode (auth skipped) before switching to production
      token = await getToken()
    })

    after(function () {
      process.env.NODE_ENV = savedNodeEnv
    })

    afterEach(function () {
      process.env.NODE_ENV = savedNodeEnv
    })

    it('401 — /logdownload rejected without a token in production', async function () {
      process.env.NODE_ENV = 'production'
      const res = await request('GET', '/logdownload/anything.tlog')
      assert.equal(res.status, 401)
    })

    it('401 — /media rejected without a token in production', async function () {
      process.env.NODE_ENV = 'production'
      const res = await request('GET', '/media/anything.jpg')
      assert.equal(res.status, 401)
    })

    it('200 — /logdownload serves the file when the JWT rides in ?token=', async function () {
      fs.mkdirSync(logpaths.flightsLogsDir, { recursive: true })
      const fname = 's3-logdownload-' + Date.now() + '.tlog'
      const fpath = path.join(logpaths.flightsLogsDir, fname)
      fs.writeFileSync(fpath, 'HELLO_TLOG')
      try {
        process.env.NODE_ENV = 'production'
        const res = await request('GET', '/logdownload/' + fname + '?token=' + encodeURIComponent(token), { raw: true })
        assert.equal(res.statusCode, 200)
        assert.equal(res.body, 'HELLO_TLOG')
      } finally {
        fs.unlinkSync(fpath)
      }
    })

    it('200 — /media serves the file when the JWT rides in ?token=', async function () {
      fs.mkdirSync(logpaths.mediaDir, { recursive: true })
      const fname = 's3-media-' + Date.now() + '.txt'
      const fpath = path.join(logpaths.mediaDir, fname)
      fs.writeFileSync(fpath, 'MEDIA_BYTES')
      try {
        process.env.NODE_ENV = 'production'
        const res = await request('GET', '/media/' + fname + '?token=' + encodeURIComponent(token), { raw: true })
        assert.equal(res.statusCode, 200)
        assert.equal(res.body, 'MEDIA_BYTES')
      } finally {
        fs.unlinkSync(fpath)
      }
    })
  })

  // -------------------------------------------------------------------------
  // S9 — security headers on every response
  // -------------------------------------------------------------------------
  describe('Security headers (S9)', function () {
    it('sets X-Frame-Options, X-Content-Type-Options and a CSP', async function () {
      const res = await request('GET', '/api/users')
      assert.equal(res.headers['x-frame-options'], 'DENY')
      assert.equal(res.headers['x-content-type-options'], 'nosniff')
      assert.ok(res.headers['content-security-policy'], 'expected a CSP header')
      assert.ok(res.headers['content-security-policy'].includes("frame-ancestors 'none'"))
      assert.ok(res.headers['content-security-policy'].includes("default-src 'self'"))
    })
  })

  // -------------------------------------------------------------------------
  // S11 — stricter per-login rate limiter (in addition to the global one)
  // -------------------------------------------------------------------------
  describe('Login rate limiter (S11)', function () {
    it('throttles /api/login after ~5 attempts/min while the global limiter still allows them', async function () {
      this.timeout(10000)
      // Force the limiters on in dev mode; the login limiter (max 5) must trip
      // well before the global limiter (max 50).
      process.env.ENABLE_RATE_LIMIT = '1'
      try {
        const statuses = []
        for (let i = 0; i < 6; i++) {
          const res = await request('POST', '/api/login', {
            body: { username: 'admin', password: 'admin' }
          })
          statuses.push(res.status)
        }
        // The first request is under the cap and succeeds; the 6th is throttled.
        assert.equal(statuses[0], 200, 'first login should succeed under the cap')
        assert.equal(statuses[5], 429, 'the 6th login within a minute should be rate-limited')
      } finally {
        delete process.env.ENABLE_RATE_LIMIT
      }
    })
  })
})
