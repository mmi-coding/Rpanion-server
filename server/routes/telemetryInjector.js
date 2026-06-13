// Telemetry injector routes. Extracted from index.js.
const { Router } = require('express')
const { check, validationResult } = require('express-validator')

module.exports = function telemetryInjectorRoutes ({ authenticateToken, toBool, telemetryInjector }) {
  const router = Router()

  // telemetry injector settings + status
  router.get('/api/telemetryinjector', authenticateToken, (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.send(JSON.stringify({ settings: telemetryInjector.getSettings(), status: telemetryInjector.getStatus() }))
  })

  // change telemetry injector settings
  router.post('/api/telemetryinjectormodify', authenticateToken, [
    check('enabled').isBoolean(),
    check('httpEnabled').isBoolean(),
    check('udpEnabled').isBoolean(),
    check('udpPort').isInt({ min: 1, max: 65535 }),
    check('serialEnabled').isBoolean(),
    check('serialPort').optional({ checkFalsy: true }).isString().isLength({ max: 128 }),
    check('serialBaud').isInt(),
    check('sysid').isInt({ min: 1, max: 255 }),
    check('compid').isInt({ min: 1, max: 255 })
  ], function (req, res) {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/telemetryinjectormodify', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }
    telemetryInjector.setSettings({
      enabled: toBool(req.body.enabled),
      httpEnabled: toBool(req.body.httpEnabled),
      udpEnabled: toBool(req.body.udpEnabled),
      udpPort: parseInt(req.body.udpPort, 10),
      serialEnabled: toBool(req.body.serialEnabled),
      serialPort: req.body.serialPort || '',
      serialBaud: parseInt(req.body.serialBaud, 10),
      sysid: parseInt(req.body.sysid, 10),
      compid: parseInt(req.body.compid, 10)
    }, (err) => {
      res.setHeader('Content-Type', 'application/json')
      if (err) {
        res.status(422).send(JSON.stringify({ error: err.message, settings: telemetryInjector.getSettings() }))
      } else {
        res.send(JSON.stringify({ error: null, settings: telemetryInjector.getSettings() }))
      }
    })
  })

  // HTTP ingest source: external posters push one reading here
  router.post('/api/telemetryinject', authenticateToken, [
    check('name').optional().isString().isLength({ max: 10 }),
    check('value').optional().isFloat(),
    check('text').optional().isString().isLength({ max: 50 }),
    check('severity').optional().isInt({ min: 0, max: 7 })
  ], function (req, res) {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }
    res.setHeader('Content-Type', 'application/json')
    if (!telemetryInjector.canInjectHttp()) {
      return res.status(409).send(JSON.stringify({ error: 'HTTP telemetry injection is disabled' }))
    }
    const err = telemetryInjector.ingest(req.body)
    if (err) {
      return res.status(422).send(JSON.stringify({ error: err.message }))
    }
    res.send(JSON.stringify({ ok: true }))
  })

  return router
}
