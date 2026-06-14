// Log conversion (tlog -> kmz) routes. Extracted from index.js.
import type { Request, Response } from 'express'
const { Router } = require('express')
const { check, validationResult } = require('express-validator')

export = function logConversionRoutes ({ authenticateToken, logConversion }: { authenticateToken: any; logConversion: any }) {
  const router = Router()

  // Serve the logconversion info
  router.get('/api/logconversioninfo', authenticateToken, (req: Request, res: Response) => {
    logConversion.getSettings((doLogConversion: any) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ doLogConversion }))
    })
  })

  // activate or deactivate logconversion
  router.post('/api/logconversion', authenticateToken, [check('doLogConversion').isBoolean()
  ], function (req: Request, res: Response) {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log(req.body)
      console.log('Bad POST vars in /api/logconversion', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    } else {
      logConversion.setSettingsLog(req.body.doLogConversion)
      // send back refreshed settings
      logConversion.getSettings((doLogConversion: any) => {
        res.setHeader('Content-Type', 'application/json')
        res.send(JSON.stringify({ doLogConversion }))
      })
    }
  })

  return router
}
