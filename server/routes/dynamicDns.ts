// Dynamic DNS routes. Extracted from index.js.
const { Router } = require('express')
const { check, validationResult } = require('express-validator')

export = function dynamicDnsRoutes ({ authenticateToken, toBool, ddns }) {
  const router = Router()

  // Serve the dynamic DNS settings + status
  router.get('/api/ddns', authenticateToken, (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.send(JSON.stringify({ settings: ddns.getSettings(), status: ddns.getStatus() }))
  })

  // Change dynamic DNS settings
  router.post('/api/ddnsmodify', authenticateToken, [
    check('enabled').isBoolean(),
    check('provider').isIn(['duckdns', 'noip']),
    check('hostname').isLength({ min: 1 }).not().contains(';').trim(),
    check('intervalMin').isInt({ min: 1, max: 1440 })
  ], (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/ddnsmodify', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }

    ddns.setSettings({
      enabled: toBool(req.body.enabled),
      provider: req.body.provider,
      hostname: req.body.hostname,
      token: req.body.token || '',
      username: req.body.username || '',
      password: req.body.password,
      intervalMin: parseInt(req.body.intervalMin, 10)
    }, (err) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ error: err, settings: ddns.getSettings(), status: ddns.getStatus() }))
    })
  })

  // Trigger an immediate dynamic DNS update
  router.post('/api/ddnsupdate', authenticateToken, (req, res) => {
    ddns.updateNow().then((status) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ status }))
    })
  })

  return router
}
