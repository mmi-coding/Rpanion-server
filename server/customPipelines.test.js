const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const sinon = require('sinon')
const settings = require('settings-store')
const logpaths = require('./paths')
const CustomPipelines = require('./customPipelines')

const GOOD_PIPELINE = 'videotestsrc is-live=true ! video/x-raw,width=640,height=480 ! videoconvert ! x264enc tune=zerolatency bitrate=1000 ! rtph264pay config-interval=1 name=pay0 pt=96'

describe('Custom Pipeline Functions', function () {
  it('#custompipelinesinit()', function () {
    settings.clear()
    const cp = new CustomPipelines(settings)

    assert.deepEqual(cp.getAllPipelines(), {})
    assert.equal(cp.getPipeline('/dev/video0'), null)
    assert.equal(cp.getActivePipeline('/dev/video0'), null)
  })

  it('#setPipelineDisabled()', function (done) {
    settings.clear()
    const cp = new CustomPipelines(settings)

    // disabled pipelines are stored without validation
    cp.setPipeline('/dev/video0', false, 'anything ! goes ! here', (err) => {
      assert.equal(err, null)
      assert.deepEqual(cp.getPipeline('/dev/video0'), { enabled: false, pipeline: 'anything ! goes ! here' })
      // disabled = not active
      assert.equal(cp.getActivePipeline('/dev/video0'), null)
      done()
    })
  })

  it('#setPipelineRemove()', function (done) {
    settings.clear()
    const cp = new CustomPipelines(settings)

    cp.setPipeline('/dev/video0', false, 'pipelinestr', (err) => {
      assert.equal(err, null)
      // empty disabled pipeline removes the entry
      cp.setPipeline('/dev/video0', false, '', (err2) => {
        assert.equal(err2, null)
        assert.equal(cp.getPipeline('/dev/video0'), null)
        done()
      })
    })
  })

  it('#setPipelineBadArgs()', function (done) {
    settings.clear()
    const cp = new CustomPipelines(settings)

    cp.setPipeline('', false, 'pipelinestr', (err) => {
      assert.notEqual(err, null)
      // can't enable an empty pipeline
      cp.setPipeline('/dev/video0', true, '   ', (err2) => {
        assert.notEqual(err2, null)
        done()
      })
    })
  })

  it('#validateBadPipeline()', function (done) {
    settings.clear()
    const cp = new CustomPipelines(settings)

    cp.validatePipeline('notanelement ! rtph264pay name=pay0', (err, valid, reason) => {
      assert.equal(err, null)
      // false when the gst validator is available, null when it isn't -
      // but never true
      assert.notEqual(valid, true)
      assert.ok(reason.length > 0)
      done()
    })
  }).timeout(20000)

  it('#validateMissingPay0()', function (done) {
    settings.clear()
    const cp = new CustomPipelines(settings)

    cp.validatePipeline('videotestsrc ! fakesink', (err, valid, reason) => {
      assert.equal(err, null)
      assert.notEqual(valid, true)
      done()
    })
  }).timeout(20000)

  it('#setPipelineEnabled()', function (done) {
    settings.clear()
    const cp = new CustomPipelines(settings)

    // a known-good pipeline must save and become active (validator present)
    // or save unvalidated (validator absent) - either way no error
    cp.setPipeline('/dev/video0', true, GOOD_PIPELINE, (err) => {
      assert.equal(err, null)
      assert.equal(cp.getActivePipeline('/dev/video0'), GOOD_PIPELINE)

      // settings persist across a reload
      const cp2 = new CustomPipelines(settings)
      assert.equal(cp2.getActivePipeline('/dev/video0'), GOOD_PIPELINE)
      done()
    })
  }).timeout(20000)

  it('#setPipelineEnabledRejectsInvalid()', function (done) {
    settings.clear()
    const cp = new CustomPipelines(settings)

    // only assert the rejection when a validator is actually available
    cp.validatePipeline(GOOD_PIPELINE, (err, valid) => {
      if (valid === null) {
        // no gst bindings in this environment - runtime fallback still protects
        return done()
      }
      cp.setPipeline('/dev/video1', true, 'notanelement ! rtph264pay name=pay0', (err2) => {
        assert.notEqual(err2, null)
        assert.equal(cp.getPipeline('/dev/video1'), null)
        done()
      })
    })
  }).timeout(30000)

  it('#saveSettingsSwallowsErrors()', function () {
    settings.clear()
    const cp = new CustomPipelines(settings)
    // a broken settings store must not crash the pipeline manager
    cp.settings = { setValue: () => { throw new Error('disk full') } }
    const errSpy = sinon.spy(console, 'error')
    try {
      cp.saveSettings()
      assert.ok(errSpy.calledWithMatch('Error saving customPipelines settings:'))
    } finally {
      errSpy.restore()
    }
  })

  it('#setPipelineNonString()', function (done) {
    settings.clear()
    const cp = new CustomPipelines(settings)

    cp.setPipeline('/dev/video0', false, 12345, (err) => {
      assert.notEqual(err, null)
      assert.ok(err.message.includes('must be a string'))
      done()
    })
  })

  it('#validateNoPipelineSupplied()', function (done) {
    settings.clear()
    const cp = new CustomPipelines(settings)

    // whitespace-only and non-string pipelines never reach the validator
    cp.validatePipeline('   ', (err, valid, reason) => {
      assert.equal(err, null)
      assert.equal(valid, false)
      assert.equal(reason, 'No pipeline supplied')

      cp.validatePipeline(42, (err2, valid2) => {
        assert.equal(err2, null)
        assert.equal(valid2, false)
        done()
      })
    })
  })

  it('#setPipelineValidatorError()', function (done) {
    settings.clear()
    const cp = new CustomPipelines(settings)
    // a validator-level error propagates and nothing is saved
    cp.validatePipeline = (p, cb) => cb(new Error('validator exploded'))

    cp.setPipeline('/dev/video0', true, 'fakesrc ! pay0', (err) => {
      assert.notEqual(err, null)
      assert.equal(err.message, 'validator exploded')
      assert.equal(cp.getPipeline('/dev/video0'), null)
      done()
    })
  })

  describe('validator process paths (fake validator binaries)', function () {
    let tmpDir
    const fakes = {}

    before(function () {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-validator-'))
      const make = (name, body) => {
        const p = path.join(tmpDir, name)
        fs.writeFileSync(p, '#!/bin/sh\n' + body, { mode: 0o755 })
        return p
      }
      // crashes with a message and no verdict on stdout
      fakes.stderrFail = make('stderr-fail', 'echo boom >&2\nexit 1\n')
      // exits cleanly but prints garbage instead of JSON
      fakes.badJson = make('bad-json', 'echo this is not json\n')
      // prints a verdict, then crashes - the verdict still counts
      fakes.jsonWithError = make('json-with-error', 'echo \'{"valid": true, "reason": "ok"}\'\nexit 1\n')
    })

    after(function () {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    afterEach(function () {
      sinon.restore()
    })

    it('#validatorUnavailableStderr()', function (done) {
      settings.clear()
      const cp = new CustomPipelines(settings)
      sinon.stub(logpaths, 'getPythonPath').returns(fakes.stderrFail)
      const errSpy = sinon.spy(console, 'error')

      cp.validatePipeline('fakesrc ! pay0', (err, valid, reason) => {
        assert.equal(err, null)
        assert.equal(valid, null)
        assert.ok(reason.includes('Validator unavailable'))
        assert.ok(reason.includes('boom'))
        assert.ok(errSpy.calledWithMatch('Pipeline validator failed:'))
        done()
      })
    })

    it('#validatorUnavailableSpawnFail()', function (done) {
      settings.clear()
      const cp = new CustomPipelines(settings)
      sinon.stub(logpaths, 'getPythonPath').returns(path.join(tmpDir, 'no-such-binary'))
      const errSpy = sinon.spy(console, 'error')

      cp.validatePipeline('fakesrc ! pay0', (err, valid, reason) => {
        assert.equal(err, null)
        assert.equal(valid, null)
        // no stderr from a failed spawn: the error message is used instead
        assert.ok(reason.includes('Validator unavailable'))
        assert.ok(reason.includes('ENOENT'))
        assert.ok(errSpy.called)
        done()
      })
    })

    it('#validatorBadOutput()', function (done) {
      settings.clear()
      const cp = new CustomPipelines(settings)
      sinon.stub(logpaths, 'getPythonPath').returns(fakes.badJson)
      const errSpy = sinon.spy(console, 'error')

      cp.validatePipeline('fakesrc ! pay0', (err, valid, reason) => {
        assert.equal(err, null)
        assert.equal(valid, null)
        assert.equal(reason, 'Validator returned unexpected output')
        assert.ok(errSpy.calledWithMatch('Bad validator output:'))
        done()
      })
    })

    it('#validatorErrorWithOutput()', function (done) {
      settings.clear()
      const cp = new CustomPipelines(settings)
      sinon.stub(logpaths, 'getPythonPath').returns(fakes.jsonWithError)

      cp.validatePipeline('fakesrc ! pay0', (err, valid, reason) => {
        assert.equal(err, null)
        assert.equal(valid, true)
        assert.equal(reason, 'ok')
        done()
      })
    })

    it('#setPipelineSavesUnvalidated()', function (done) {
      settings.clear()
      const cp = new CustomPipelines(settings)
      sinon.stub(logpaths, 'getPythonPath').returns(path.join(tmpDir, 'no-such-binary'))
      sinon.spy(console, 'error') // silence the expected validator complaint
      const logSpy = sinon.spy(console, 'log')

      // valid=null (no validator) saves with a console note - the video
      // server still falls back at runtime if the pipeline is bad
      cp.setPipeline('/dev/video9', true, 'fakesrc ! pay0', (err) => {
        assert.equal(err, null)
        assert.equal(cp.getActivePipeline('/dev/video9'), 'fakesrc ! pay0')
        assert.ok(logSpy.calledWithMatch('saved without validation'))
        done()
      })
    })
  })
})
