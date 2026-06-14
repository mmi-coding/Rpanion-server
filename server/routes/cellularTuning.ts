// Cellular video tuning routes. Extracted from index.js.
const { Router } = require('express')
const { check, validationResult } = require('express-validator')

export = function cellularTuningRoutes ({ authenticateToken, toBool, cellularTuning }) {
  const router = Router()

  // cellular video tuning settings and status
  router.get('/api/cellulartuning', authenticateToken, (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.send(JSON.stringify({ settings: cellularTuning.getSettings(), status: cellularTuning.getStatus() }))
  })

  // change cellular video tuning settings
  router.post('/api/cellulartuningmodify', authenticateToken, [
    check('lowLatency').isBoolean(),
    check('adaptiveBitrate').isBoolean(),
    check('minBitrate').isInt({ min: 50, max: 10000 })
  ], function (req, res) {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/cellulartuningmodify', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }

    cellularTuning.setSettings({
      lowLatency: toBool(req.body.lowLatency),
      adaptiveBitrate: toBool(req.body.adaptiveBitrate),
      minBitrate: parseInt(req.body.minBitrate, 10)
    }, (err) => {
      res.setHeader('Content-Type', 'application/json')
      if (err) {
        res.status(422).send(JSON.stringify({ error: err.message, settings: cellularTuning.getSettings() }))
      } else {
        res.send(JSON.stringify({ error: null, settings: cellularTuning.getSettings() }))
      }
    })
  })

  return router
}
