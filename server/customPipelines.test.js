const assert = require('assert')
const settings = require('settings-store')
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
})
