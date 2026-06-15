// Customizable graphic-HUD (OSD) layout + font routes (#173 editor). The HUD
// Editor page reads the current layout + the element catalog, saves an edited
// layout, and manages the OSD fonts (list / import / remove / serve-for-preview).
const { Router } = require('express')
const { check, validationResult } = require('express-validator')
const fs = require('fs')
const hudOverlay = require('../hudOverlay')
import type { Request, Response } from 'express'

export = function hudRoutes ({ authenticateToken, vManager, hudFonts }: { authenticateToken: any; vManager: any; hudFonts: any }) {
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

  // selectable OSD fonts: generic families + curated + imported (each with the
  // served filename so the editor can @font-face it for an exact preview)
  router.get('/api/hudfonts', authenticateToken, (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json')
    res.send(JSON.stringify(hudFonts.list()))
  })

  // import a .ttf/.otf — installed to the device's HUD fonts dir + registered.
  // The global express-fileupload middleware (index.ts) parses to a temp file.
  router.post('/api/hudfonts', authenticateToken, (req: any, res: Response) => {
    const file = req.files && req.files.font
    if (!file) {
      return res.status(422).json({ error: 'No font file uploaded' })
    }
    hudFonts.importFont(fs.readFileSync(file.tempFilePath), file.name)
      .then((font: any) => res.json({ font, fonts: hudFonts.list(), error: null }))
      .catch((err: Error) => res.status(422).json({ error: err.message }))
  })

  // remove an imported font by id
  router.delete('/api/hudfonts/:id', authenticateToken, (req: Request, res: Response) => {
    hudFonts.removeFont(req.params.id)
      .then((fonts: any) => res.json({ fonts, error: null }))
      .catch((err: Error) => res.status(422).json({ error: err.message }))
  })

  // serve a font file for the editor preview. Unauthenticated: a CSS @font-face
  // url() cannot carry the bearer token, and only known, path-safe font files
  // are served (fonts are not secrets).
  router.get('/api/hudfonts/file/:name', (req: Request, res: Response) => {
    const p = hudFonts.fileFor(req.params.name)
    if (!p) {
      return res.status(404).end()
    }
    res.setHeader('Content-Type', 'font/ttf')
    res.sendFile(p)
  })

  return router
}
