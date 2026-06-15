// Flight controller (MAVLink telemetry) routes. Multi-link (#311): the page
// manages a list of input links + shared output options.
const { Router } = require('express')
const { check, validationResult } = require('express-validator')
import type { Request, Response } from 'express'

export = function flightControllerRoutes ({ authenticateToken, fcManager }: { authenticateToken: any; fcManager: any }) {
  const router = Router()

  router.get('/api/FCOutputs', authenticateToken, (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json')
    res.send(JSON.stringify({ UDPoutputs: fcManager.getUDPOutputs() }))
  })

  router.get('/api/FCDetails', authenticateToken, (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json')
    fcManager.getDeviceSettings((err: any, data: any) => {
      res.send(JSON.stringify({
        error: err ? err.toString() : null,
        serialPorts: data.serialPorts,
        baudRates: data.baudRates,
        mavVersions: data.mavVersions,
        inputTypes: data.inputTypes,
        links: data.links,
        enableHeartbeat: data.enableHeartbeat,
        enableTCP: data.enableTCP,
        enableUDPB: data.enableUDPB,
        UDPBPort: data.UDPBPort,
        enableDSRequest: data.enableDSRequest,
        doLogging: data.doLogging
      }))
      if (err) {
        console.log('Error in /api/FCDetails ', { message: err })
      }
    })
  })

  router.post('/api/FCAddLink', authenticateToken, [check('inputType').isIn(['UART', 'UDP']), check('baud').isInt(), check('mavversion').isInt(), check('udpInputPort').isInt({ min: 1, max: 65535 })], function (req: Request, res: Response) {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/FCAddLink', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }
    fcManager.addLink(req.body.inputType, req.body.device, req.body.baud, req.body.mavversion, req.body.udpInputPort, (err: any, links: any) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ links, error: err ? err.toString() : null }))
      if (err) {
        console.log('Error in /api/FCAddLink ', { message: err })
      }
    })
  })

  router.post('/api/FCRemoveLink', authenticateToken, [check('id').isInt({ min: 0 })], function (req: Request, res: Response) {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/FCRemoveLink', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }
    fcManager.removeLink(parseInt(req.body.id), (err: any, links: any) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ links, error: err ? err.toString() : null }))
      if (err) {
        console.log('Error in /api/FCRemoveLink ', { message: err })
      }
    })
  })

  router.post('/api/FCOptions', authenticateToken, [check('enableHeartbeat').isBoolean(), check('enableTCP').isBoolean(), check('enableUDPB').isBoolean(), check('UDPBPort').isPort(), check('enableDSRequest').isBoolean(), check('doLogging').isBoolean()], function (req: Request, res: Response) {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/FCOptions', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }
    fcManager.setGlobalOptions(req.body.enableHeartbeat, req.body.enableTCP, req.body.enableUDPB, req.body.UDPBPort, req.body.enableDSRequest, req.body.doLogging, () => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ error: null }))
    })
  })

  router.post('/api/FCReboot', authenticateToken, function () {
    fcManager.rebootFC()
  })

  router.post('/api/addudpoutput', authenticateToken, [check('newoutputIP').isIP(), check('newoutputPort').isInt({ min: 1 })], function (req: Request, res: Response) {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/addudpoutput ', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }
    const newOutput = fcManager.addUDPOutput(req.body.newoutputIP, parseInt(req.body.newoutputPort))
    res.setHeader('Content-Type', 'application/json')
    res.send(JSON.stringify({ UDPoutputs: newOutput }))
  })

  router.post('/api/removeudpoutput', authenticateToken, [check('removeoutputIP').isIP(), check('removeoutputPort').isInt({ min: 1 })], function (req: Request, res: Response) {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/removeudpoutput ', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }
    const newOutput = fcManager.removeUDPOutput(req.body.removeoutputIP, parseInt(req.body.removeoutputPort))
    res.setHeader('Content-Type', 'application/json')
    res.send(JSON.stringify({ UDPoutputs: newOutput }))
  })

  return router
}
