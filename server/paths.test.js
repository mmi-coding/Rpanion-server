const assert = require('assert')
const path = require('path')
const fs = require('fs')
const sinon = require('sinon')
const logpaths = require('./paths.js')

describe('Paths Functions', function () {
  afterEach(function () {
    sinon.restore()
  })

  it('#pathsDevBaseDir()', function () {
    // mocha runs with NODE_ENV=development: paths live under the repo root
    assert.ok(logpaths.settingsFile.endsWith(path.join('config', 'settings.json')))
    assert.ok(!logpaths.settingsFile.startsWith('/etc/rpanion-server'))
  })

  it('#pathsProdBaseDir()', function () {
    // re-require with NODE_ENV unset to get the installed-system base dir
    const prevEnv = process.env.NODE_ENV
    delete require.cache[require.resolve('./paths.js')]
    process.env.NODE_ENV = 'production'
    try {
      const prodPaths = require('./paths.js')
      assert.ok(prodPaths.settingsFile.startsWith('/etc/rpanion-server'))
      assert.ok(prodPaths.flightsLogsDir.startsWith('/etc/rpanion-server'))
    } finally {
      process.env.NODE_ENV = prevEnv
      // re-prime the cache with the development paths for later requires
      delete require.cache[require.resolve('./paths.js')]
      require('./paths.js')
    }
  })

  it('#getPythonPathSystemVenv()', function () {
    // installed-system venv wins when present
    const sysVenv = path.join('/usr/share/rpanion-server/app', 'python', '.venv', 'bin', 'python3')
    sinon.stub(fs, 'existsSync').callsFake((p) => p === sysVenv)
    assert.equal(logpaths.getPythonPath(), sysVenv)
  })

  it('#getPythonPathLocalVenv()', function () {
    // local (development) venv is the second choice
    const sysVenv = path.join('/usr/share/rpanion-server/app', 'python', '.venv', 'bin', 'python3')
    sinon.stub(fs, 'existsSync').callsFake((p) => p !== sysVenv)
    const result = logpaths.getPythonPath()
    assert.ok(result.endsWith(path.join('python', '.venv', 'bin', 'python3')))
    assert.notEqual(result, sysVenv)
  })

  it('#getPythonPathSystemFallback()', function () {
    // no venv anywhere: system python3
    sinon.stub(fs, 'existsSync').returns(false)
    assert.equal(logpaths.getPythonPath(), 'python3')
  })
})
