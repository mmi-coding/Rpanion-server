/*
 * Custom Video Pipelines
 * Manages user-editable GStreamer pipeline strings, stored per camera device.
 * When enabled for the active device, the custom pipeline replaces the
 * auto-generated one in python/video-server.py.
 *
 * Contract: a custom pipeline is a full gst-launch description ending in an
 * RTP payloader named pay0. In RTP/UDP mode the udpsink is appended
 * automatically; in RTSP mode the pay0 element feeds the RTSP server.
 *
 * Validation is done by python/validate-pipeline.py (gst_parse_launch
 * dry-run + pay0 check). video-server.py re-validates at stream start and
 * falls back to the auto-generated pipeline if the custom one is bad, so a
 * stale custom pipeline can never brick the video stream.
 */
const { execFile } = require('child_process')
const logpaths = require('./paths.js')

class customPipelines {
  constructor (settings) {
    this.settings = settings

    // map of device name -> { enabled: bool, pipeline: string }
    this.pipelines = this.settings.value('customPipelines.map', {})
  }

  saveSettings () {
    try {
      this.settings.setValue('customPipelines.map', this.pipelines)
    } catch (e) {
      console.error('Error saving customPipelines settings:', e)
    }
  }

  getAllPipelines () {
    return { ...this.pipelines }
  }

  // The pipeline entry for one device: { enabled, pipeline } or null
  getPipeline (device) {
    if (Object.prototype.hasOwnProperty.call(this.pipelines, device)) {
      return { ...this.pipelines[device] }
    }
    return null
  }

  // The pipeline string to use for a device, or null if none enabled
  getActivePipeline (device) {
    const entry = this.getPipeline(device)
    if (entry && entry.enabled && entry.pipeline !== '') {
      return entry.pipeline
    }
    return null
  }

  setPipeline (device, enabled, pipeline, callback) {
    if (typeof device !== 'string' || device === '') {
      return callback(new Error('A device name is required'))
    }
    if (typeof pipeline !== 'string') {
      return callback(new Error('Pipeline must be a string'))
    }
    if (enabled && pipeline.trim() === '') {
      return callback(new Error('Cannot enable an empty pipeline'))
    }

    if (pipeline.trim() === '') {
      // empty disabled pipeline = remove the entry
      delete this.pipelines[device]
      this.saveSettings()
      return callback(null)
    }

    if (!enabled) {
      this.pipelines[device] = { enabled: false, pipeline }
      this.saveSettings()
      return callback(null)
    }

    // validate before enabling. valid=null (no validator available, e.g.
    // dev box without gst python bindings) is allowed through - the video
    // server still falls back at runtime if the pipeline is bad
    this.validatePipeline(pipeline, (err, valid, reason) => {
      if (err) {
        return callback(err)
      }
      if (valid === false) {
        return callback(new Error('Invalid pipeline: ' + reason))
      }
      if (valid === null) {
        console.log('Custom pipeline saved without validation: ' + reason)
      }
      this.pipelines[device] = { enabled: true, pipeline }
      this.saveSettings()
      return callback(null)
    })
  }

  // Dry-run validation via python/validate-pipeline.py.
  // callback(err, valid, reason) - valid is true/false/null (= can't validate)
  validatePipeline (pipeline, callback) {
    if (typeof pipeline !== 'string' || pipeline.trim() === '') {
      return callback(null, false, 'No pipeline supplied')
    }

    // execFile (no shell) - the pipeline string is passed as a single argv
    execFile(logpaths.getPythonPath(), ['./python/validate-pipeline.py', pipeline],
      { timeout: 20000 }, (error, stdout, stderr) => {
        if (error && stdout === '') {
          console.error('Pipeline validator failed:', stderr || error)
          return callback(null, null, 'Validator unavailable: ' + (stderr || error.message))
        }
        try {
          const res = JSON.parse(stdout)
          return callback(null, res.valid, res.reason)
        } catch (e) {
          console.error('Bad validator output:', stdout, stderr)
          return callback(null, null, 'Validator returned unexpected output')
        }
      })
  }
}

module.exports = customPipelines
