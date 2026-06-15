// Customizable graphic-HUD (OSD) layout routes (#173 editor). The HUD Editor page
// reads the current layout + the element catalog, and saves an edited layout which
// is persisted and applied live to a running graphic stream.
const { Router } = require('express')
const { check, validationResult } = require('express-validator')
const hudOverlay = require('../hudOverlay')
import type { Request, Response } from 'express'

export = function hudRoutes ({ authenticateToken, vManager }: { authenticateToken: any; vManager: any }) {
  const router = Router()

  router.get('/api/hudlayout', authenticateToken, (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json')
    res.send(JSON.stringify({ layout: vManager.getHudLayout(), elements: hudOverlay.hudElements() }))
  })

  router.post('/api/hudlayout', authenticateToken, [check('layout').isObject()], (req: Request, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/hudlayout', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }
    const layout = vManager.setHudLayout(req.body.layout)
    res.setHeader('Content-Type', 'application/json')
    res.send(JSON.stringify({ layout, error: null }))
  })

  return router
}
