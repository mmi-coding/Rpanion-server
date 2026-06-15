// Secondary video stream routes (#398). The page lists the extra streams and
// adds/removes them; the camera list itself comes from /api/videodevices.
const { Router } = require('express')
const { check, validationResult } = require('express-validator')
import type { Request, Response } from 'express'

export = function secondaryStreamRoutes ({ authenticateToken, secondaryStreams }: { authenticateToken: any; secondaryStreams: any }) {
  const router = Router()

  router.get('/api/secondarystreams', authenticateToken, (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json')
    res.send(JSON.stringify({ streams: secondaryStreams.getStatus(), inUse: secondaryStreams.inUseDevices() }))
  })

  router.post('/api/secondarystreamadd', authenticateToken, [
    check('device').isString().notEmpty(),
    check('format').isString().notEmpty(),
    check('width').isInt({ min: 1 }),
    check('height').isInt({ min: 1 }),
    check('fps').isInt({ min: 0, max: 120 }),
    check('bitrate').isInt({ min: 50, max: 50000 }),
    check('rotation').isInt().isIn([0, 90, 180, 270]),
    check('compression').isIn(['H264', 'H265']),
    check('transport').isIn(['RTSP', 'RTP'])
  ], (req: Request, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/secondarystreamadd', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }
    const config = {
      device: req.body.device,
      format: req.body.format,
      width: parseInt(req.body.width),
      height: parseInt(req.body.height),
      fps: parseInt(req.body.fps),
      bitrate: parseInt(req.body.bitrate),
      rotation: parseInt(req.body.rotation),
      compression: req.body.compression,
      transport: req.body.transport,
      udpIP: req.body.udpIP,
      udpPort: parseInt(req.body.udpPort)
    }
    secondaryStreams.addStream(config, (err: any, streams: any) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ streams, inUse: secondaryStreams.inUseDevices(), error: err || null }))
    })
  })

  router.post('/api/secondarystreamremove', authenticateToken, [check('id').isInt({ min: 0 })], (req: Request, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/secondarystreamremove', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }
    secondaryStreams.removeStream(parseInt(req.body.id), (err: any, streams: any) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ streams, inUse: secondaryStreams.inUseDevices(), error: err || null }))
    })
  })

  return router
}
