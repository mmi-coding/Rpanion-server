// Camera switcher routes. Extracted from index.js.
const { Router } = require('express')
const { check, validationResult } = require('express-validator')

export = function cameraSwitcherRoutes ({ authenticateToken, toBool, camSwitcher }) {
  const router = Router()

  // Serve the camera switcher config and status
  router.get('/api/cameraswitcher', authenticateToken, (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.send(JSON.stringify({ settings: camSwitcher.getSettings(), status: camSwitcher.getStatus() }))
  })

  // change camera switcher settings
  router.post('/api/cameraswitchermodify', authenticateToken, [
    check('enabled').isBoolean(),
    check('rcChannel').isInt({ min: 1, max: 18 }),
    check('threshold').isInt({ min: 800, max: 2200 }),
    check('hysteresis').isInt({ min: 0, max: 500 }),
    check('minHoldMs').isInt({ min: 0, max: 5000 }),
    check('switchMode').isIn(['gstreamer', 'command']),
    check('secDevice').optional({ checkFalsy: true }).isString().not().contains(';').not().contains('\'').not().contains('"').trim(),
    check('secFormat').optional({ checkFalsy: true }).isIn(['video/x-raw', 'image/jpeg']),
    check('secWidth').optional().isInt({ min: 0, max: 4096 }),
    check('secHeight').optional().isInt({ min: 0, max: 4096 }),
    check('secFps').optional().isInt({ min: -1, max: 120 }),
    check('commandA').optional({ checkFalsy: true }).isString(),
    check('commandB').optional({ checkFalsy: true }).isString()
  ], function (req, res) {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/cameraswitchermodify', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }

    camSwitcher.setSettings({
      enabled: toBool(req.body.enabled),
      rcChannel: parseInt(req.body.rcChannel, 10),
      threshold: parseInt(req.body.threshold, 10),
      hysteresis: parseInt(req.body.hysteresis, 10),
      minHoldMs: parseInt(req.body.minHoldMs, 10),
      switchMode: req.body.switchMode,
      secDevice: req.body.secDevice || '',
      secFormat: req.body.secFormat || 'video/x-raw',
      secWidth: parseInt(req.body.secWidth, 10) || 0,
      secHeight: parseInt(req.body.secHeight, 10) || 0,
      secFps: parseInt(req.body.secFps, 10) || -1,
      commandA: req.body.commandA || '',
      commandB: req.body.commandB || ''
    }, (err) => {
      res.setHeader('Content-Type', 'application/json')
      if (err) {
        res.status(422).send(JSON.stringify({ error: err.message, settings: camSwitcher.getSettings() }))
      } else {
        res.send(JSON.stringify({ error: null, settings: camSwitcher.getSettings() }))
      }
    })
  })

  // manually switch the active camera source
  router.post('/api/cameraswitcherswitch', authenticateToken, [check('source').isIn(['A', 'B'])], function (req, res) {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/cameraswitcherswitch', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }

    camSwitcher.doSwitch(req.body.source)
    res.setHeader('Content-Type', 'application/json')
    res.send(JSON.stringify({ error: null, status: camSwitcher.getStatus() }))
  })

  return router
}
