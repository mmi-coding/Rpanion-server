// Flight controller (MAVLink telemetry) routes. Extracted from index.js.
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
    fcManager.getDeviceSettings((err: any, devices: any, bauds: any, seldevice: any, selbaud: any, mavers: any, selmav: any,
      active: any, enableHeartbeat: any, enableTCP: any, enableUDPB: any, UDPBPort: any, enableDSRequest: any, doLogging: any,
      udpInputPort: any, selInputType: any, inputTypes: any) => {
      // hacky way to pass through the
      if (!err) {
        console.log('Sending')
        console.log(devices)
        res.send(JSON.stringify({
          telemetryStatus: active,
          serialPorts: devices,
          baudRates: bauds,
          serialPortSelected: seldevice,
          mavVersions: mavers,
          mavVersionSelected: selmav,
          baudRateSelected: selbaud,
          enableHeartbeat,
          enableTCP,
          enableUDPB,
          UDPBPort,
          enableDSRequest,
          doLogging,
          udpInputPort,
          selInputType,
          inputTypes
        }))
      } else {
        console.log(devices)
        res.send(JSON.stringify({
          error: err.toString(),
          telemetryStatus: active,
          serialPorts: devices,
          baudRates: bauds,
          serialPortSelected: seldevice,
          mavVersions: mavers,
          mavVersionSelected: selmav,
          baudRateSelected: selbaud,
          enableHeartbeat,
          enableTCP,
          enableUDPB,
          UDPBPort,
          enableDSRequest,
          doLogging,
          udpInputPort,
          selInputType,
          inputTypes
        }))
        console.log('Error in /api/FCDetails ', { message: err })
      }
    })
  })

  router.post('/api/FCModify', authenticateToken, [check('device'), check('baud').isInt(), check('mavversion').isInt(), check('enableHeartbeat').isBoolean(), check('enableTCP').isBoolean(), check('enableUDPB').isBoolean(), check('UDPBPort').isPort(), check('enableDSRequest').isBoolean(), check('doLogging').isBoolean()], function (req: Request, res: Response) {
    // User wants to start/stop FC telemetry
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/FCModify', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }

    fcManager.startStopTelemetry(req.body.device, req.body.baud, req.body.mavversion, req.body.enableHeartbeat,
                                 req.body.enableTCP, req.body.enableUDPB, req.body.UDPBPort, req.body.enableDSRequest,
                                 req.body.doLogging, req.body.inputType, req.body.udpInputPort, (err: any, isSuccess: any) => {
      if (!err) {
        res.setHeader('Content-Type', 'application/json')
        // console.log(isSuccess);
        res.send(JSON.stringify({ telemetryStatus: isSuccess, error: null }))
      } else {
        res.setHeader('Content-Type', 'application/json')
        res.send(JSON.stringify({ telemetryStatus: false, error: err }))
        console.log('Error in /api/FCModify ', { message: err })
      }
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
