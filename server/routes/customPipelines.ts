// Custom video pipeline routes. Extracted from index.js.
import type { Request, Response } from 'express'
const { Router } = require('express')
const { check, validationResult } = require('express-validator')

export = function customPipelineRoutes ({ authenticateToken, toBool, customPipelines, vManager }: { authenticateToken: any; toBool: any; customPipelines: any; vManager: any }) {
  const router = Router()

  // Serve the custom video pipelines and the pipeline used by the last stream
  router.get('/api/custompipelines', authenticateToken, (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json')
    res.send(JSON.stringify({
      pipelines: customPipelines.getAllPipelines(),
      lastPipeline: vManager.lastPipeline,
      customPipelineFallback: vManager.customPipelineFallback
    }))
  })

  // add/update/remove a custom pipeline for a device
  router.post('/api/custompipelinemodify', authenticateToken, [
    check('device').isLength({ min: 1, max: 256 }),
    check('enabled').isBoolean(),
    check('pipeline').isString().isLength({ max: 8192 })
  ], function (req: Request, res: Response) {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/custompipelinemodify', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }

    const enabled = toBool(req.body.enabled)
    customPipelines.setPipeline(req.body.device, enabled, req.body.pipeline, (err: any) => {
      res.setHeader('Content-Type', 'application/json')
      if (err) {
        res.status(422).send(JSON.stringify({ error: err.message, pipelines: customPipelines.getAllPipelines() }))
      } else {
        res.send(JSON.stringify({ error: null, pipelines: customPipelines.getAllPipelines() }))
      }
    })
  })

  // dry-run validate a pipeline string without saving it
  router.post('/api/custompipelinevalidate', authenticateToken, [
    check('pipeline').isString().isLength({ min: 1, max: 8192 })
  ], function (req: Request, res: Response) {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/custompipelinevalidate', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }

    customPipelines.validatePipeline(req.body.pipeline, (err: any, valid: any, reason: any) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ error: err ? err.message : null, valid, reason }))
    })
  })

  return router
}
