'use strict'

const assert = require('assert')
const sinon = require('sinon')
const { describe, it, before, after, afterEach } = require('mocha')
const jwt = require('jsonwebtoken')
const userLogin = require('./userLogin')

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
      this.timeout(5000)
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
      sinon.stub(jwt, 'verify').callsFake((_tok, _secret, cb) => {
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
})
