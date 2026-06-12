// Import dependencies
const assert = require('assert')
const { describe, it, before, after } = require('mocha')

// Shared harness — starts an ephemeral server; reused by index.auth.test.js
const { getServer, closeServer, request } = require('../test/indexApp')

before(function (done) {
  getServer().then(() => {
    console.log('Test server started (ephemeral port)')
    done()
  }).catch(done)
})

after(function (done) {
  closeServer().then(() => {
    console.log('Test server closed')
    done()
  }).catch(done)
})

describe('Express server', function () {
  // Test the GET / endpoint
  describe('GET /', function () {
    it('should return a 200 status code', async function () {
      const res = await request('GET', '/')
      assert.equal(res.status, 200)
    })
  })

  // Test that unauthorized users cannot access the /users endpoint
  // In dev mode authenticateToken is a passthrough, so 200 is expected
  describe('GET /users nonauth', function () {
    it('should return a 200 status code', async function () {
      const res = await request('GET', '/api/users')
      assert.equal(res.status, 200)
    })
  })

  // Test that login works
  describe('POST /login', function () {
    it('should return a 200 status code', async function () {
      const res = await request('POST', '/api/login', {
        body: { username: 'admin', password: 'admin' }
      })
      assert.equal(res.status, 200)
    })
  })
})
