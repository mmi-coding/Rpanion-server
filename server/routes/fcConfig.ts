// FC Configuration page routes. Read-only: trigger a full parameter download
// from the flight controller and return the decoded configuration overview
// (sensors, serial peripherals, servos, CAN/DroneCAN, Ethernet/NET).
const { Router } = require('express')
import type { Request, Response } from 'express'

export = function fcConfigRoutes ({ authenticateToken, fcParams }: { authenticateToken: any; fcParams: any }) {
  const router = Router()

  // start a fresh full parameter download; returns whether a FC was available
  router.post('/api/FCParamRefresh', authenticateToken, (req: Request, res: Response) => {
    const started = fcParams.requestAll()
    res.setHeader('Content-Type', 'application/json')
    res.send(JSON.stringify({ started, ...fcParams.getProgress() }))
  })

  // decoded, read-only configuration overview built from the param cache + telemetry
  router.get('/api/FCConfigOverview', authenticateToken, (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json')
    res.send(JSON.stringify(fcParams.getOverview()))
  })

  return router
}
