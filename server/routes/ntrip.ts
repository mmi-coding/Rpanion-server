// NTRIP routes. Extracted from index.js.
const { Router } = require('express')
const { check, validationResult } = require('express-validator')

export = function ntripRoutes ({ authenticateToken, ntripClient }) {
  const router = Router()

  // Serve the ntrip info
  router.get('/api/ntripconfig', authenticateToken, (req, res) => {
    ntripClient.getSettings((host, port, mountpoint, username, password, active, useTLS) => {
      res.setHeader('Content-Type', 'application/json')
      res.send({ host, port, mountpoint, username, password, active, useTLS })
    })
  })

  // change ntrip settings
  router.post('/api/ntripmodify', authenticateToken, [check('active').isBoolean(),
    check('host').isLength({ min: 5 }),
    check('port').isPort(),
    check('mountpoint').isLength({ min: 1 }),
    check('username').isLength({ min: 5 }),
    check('password').isLength({ min: 5 }),
    check('useTLS').isBoolean()], function (req, res) {
    // User wants to start/stop NTRIP
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/ntripmodify', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }

    ntripClient.setSettings(JSON.parse(req.body.host), req.body.port, JSON.parse(req.body.mountpoint), JSON.parse(req.body.username),
                            JSON.parse(req.body.password), req.body.active, req.body.useTLS)
    ntripClient.getSettings((host, port, mountpoint, username, password, active, useTLS) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ host, port, mountpoint, username, password, active, useTLS }))
    })
  })

  return router
}
