// FC Configuration page routes. Read-only: trigger a full parameter download
// from the flight controller and return the decoded configuration overview
// (sensors, serial peripherals, servos, CAN/DroneCAN, Ethernet/NET).
const { Router } = require('express')
import type { Request, Response } from 'express'

export = function fcConfigRoutes ({ authenticateToken, fcParams, droneCan }: { authenticateToken: any; fcParams: any; droneCan: any }) {
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

  // start a DroneCAN scan (CAN forwarding) on the given buses (default 0 + 1).
  // The webUI Scan button POSTs with no body, so express.json() leaves req.body
  // undefined — optional-chain it (reading req.body.buses outright 500s, #feature-37).
  router.post('/api/FCDroneCANScan', authenticateToken, (req: Request, res: Response) => {
    const buses = Array.isArray(req.body?.buses) ? req.body.buses.map((b: any) => parseInt(b)).filter((b: number) => b >= 0 && b <= 7) : [0, 1]
    droneCan.scan(buses)
    res.setHeader('Content-Type', 'application/json')
    res.send(JSON.stringify({ scanning: true, buses }))
  })

  // current DroneCAN node list (also pushed live on the DroneCANNodes socket event)
  router.get('/api/FCDroneCANNodes', authenticateToken, (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json')
    res.send(JSON.stringify({ scanning: droneCan.scanning, nodes: droneCan.getNodes(), stats: droneCan.getStats() }))
  })

  return router
}
