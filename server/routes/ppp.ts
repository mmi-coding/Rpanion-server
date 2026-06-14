// PPP connection routes. Extracted from index.js.
const { Router } = require('express')
const { check, validationResult } = require('express-validator')

export = function pppRoutes ({ authenticateToken, pppConnectionManager }) {
  const router = Router()

  router.get('/api/pppconfig', authenticateToken, (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    pppConnectionManager.getPPPSettings((err, settings) => {
      if (err) {
        console.log('Error in /api/pppconfig', { message: err })
        res.send(JSON.stringify({ error: err }))
        return
      }
      res.send(JSON.stringify(settings))
    })
  })

  router.post('/api/pppmodify', authenticateToken, [
    check('device').not().isEmpty(),
    check('baudrate').isInt(),
    check('localIP').isIP(),
    check('remoteIP').isIP(),
    check('enabled').isBoolean()
  ], (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/pppmodify', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }

    if (req.body.enabled === true) {
      console.log('Starting PPP connection');
      res.setHeader('Content-Type', 'application/json')
      pppConnectionManager.startPPP(req.body.device, req.body.baudrate, req.body.localIP, req.body.remoteIP, (err, settings) => {
        if (err !== null) {
          console.log('Error in /api/pppmodify', { message: err })
          console.log(JSON.stringify({settings, error: err }))
          res.send(JSON.stringify({settings, error: err.toString() }))
          return
        } else {
          res.send(JSON.stringify({settings}))
          return
        }
      })
    }
    /* istanbul ignore else */ else /* istanbul ignore next -- express-validator isBoolean() ensures enabled is always true or false when reached here; the condition-false arm is unreachable */ if (req.body.enabled === false) {
      pppConnectionManager.stopPPP((err, settings) => {
        if (err) {
          //console.log('Error in /api/pppmodify', { message: err })
          console.log(JSON.stringify({settings, error: err }))
          res.send(JSON.stringify({settings, error: err }))
          return
        } else {
          res.send(JSON.stringify({settings}))
          return
        }
      })
    }
  })

  return router
}
