const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const sinon = require('sinon')
const settings = require('settings-store')
const logpaths = require('./paths.js')
const LogConverter = require('./logConverter')

describe('Log Converter Functions', function () {
  let tmpDir
  let fakePython

  before(function () {
    // a fake "python" that ignores its script args and produces output on
    // both streams, so the spawn handlers in the conversion interval run
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-converter-'))
    fakePython = path.join(tmpDir, 'fake-python')
    fs.writeFileSync(fakePython, '#!/bin/sh\necho converted\necho warning >&2\nexit 0\n', { mode: 0o755 })
  })

  after(function () {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  afterEach(function () {
    sinon.restore()
  })

  it('#logconverterinit()', function () {
    settings.clear()
    const clock = sinon.useFakeTimers()
    let lc
    try {
      lc = new LogConverter(settings)
      assert.equal(lc.options.doLogConversion, false)
      assert.equal(lc.converterPid, null)

      // the interval fires but conversion is disabled: no spawn
      clock.tick(20000)
      assert.equal(lc.converterPid, null)

      // quitting with no converter running
      lc.quitting()
      assert.equal(lc.converterPid, null)
    } finally {
      clock.restore()
    }
  })

  it('#intervalRunsConverter()', async function () {
    settings.clear()
    settings.setValue('logConverter.doLogConversion', true)
    sinon.stub(logpaths, 'getPythonPath').returns(fakePython)

    const clock = sinon.useFakeTimers()
    let lc
    try {
      lc = new LogConverter(settings)
      clock.tick(20000)
      assert.notEqual(lc.converterPid, null)
    } finally {
      clock.restore()
    }

    // let the fake converter run to completion (stdout, stderr, close)
    await new Promise((resolve) => lc.converterPid.on('close', resolve))
    // quitting with a (finished) converter present
    lc.quitting()
  })

  it('#intervalSpawnFailure()', function () {
    settings.clear()
    settings.setValue('logConverter.doLogConversion', true)
    // an empty interpreter path makes spawn throw synchronously
    sinon.stub(logpaths, 'getPythonPath').returns('')
    const logSpy = sinon.spy(console, 'log')

    const clock = sinon.useFakeTimers()
    let lc
    try {
      lc = new LogConverter(settings)
      clock.tick(20000)
      // the error was swallowed and logged; no converter handle
      assert.equal(lc.converterPid, null)
      assert.ok(logSpy.getCalls().some((c) => c.args[0] instanceof Error))
      lc.quitting()
    } finally {
      clock.restore()
    }
  })

  it('#getAndSetSettings()', function (done) {
    settings.clear()
    const clock = sinon.useFakeTimers()
    const lc = new LogConverter(settings)
    clock.restore()

    lc.getSettings((doLogConversion) => {
      assert.equal(doLogConversion, false)

      lc.setSettingsLog(true)
      assert.equal(settings.value('logConverter.doLogConversion', false), true)

      lc.getSettings((updated) => {
        assert.equal(updated, true)
        lc.quitting()
        done()
      })
    })
  })

  it('#setSettingsSaveFailure()', function () {
    settings.clear()
    const clock = sinon.useFakeTimers()
    const lc = new LogConverter(settings)
    clock.restore()

    // a broken settings store is logged, the in-memory option still updates
    lc.settings = { setValue: () => { throw new Error('disk full') } }
    const logSpy = sinon.spy(console, 'log')
    lc.setSettingsLog(true)
    assert.equal(lc.options.doLogConversion, true)
    assert.ok(logSpy.getCalls().some((c) => c.args[0] instanceof Error))
    lc.quitting()
  })

  it('#conStatusLogStr()', function () {
    settings.clear()
    const clock = sinon.useFakeTimers()
    const lc = new LogConverter(settings)
    clock.restore()

    // disabled
    assert.equal(lc.conStatusLogStr(), 'Disabled')

    // enabled but never run
    lc.options.doLogConversion = true
    assert.equal(lc.conStatusLogStr(), 'Waiting for run')

    // converter process states
    lc.converterPid = { connected: false, exitCode: null, kill: () => {} }
    assert.equal(lc.conStatusLogStr(), 'Waiting for run')
    lc.converterPid = { connected: true, exitCode: null, kill: () => {} }
    assert.equal(lc.conStatusLogStr(), 'Running')
    lc.converterPid = { connected: true, exitCode: 0, kill: () => {} }
    assert.equal(lc.conStatusLogStr(), 'Success')
    lc.converterPid = { connected: true, exitCode: 1, kill: () => {} }
    assert.equal(lc.conStatusLogStr(), 'Error running kml converter')

    lc.quitting()
  })
})
