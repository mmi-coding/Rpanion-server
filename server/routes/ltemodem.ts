// LTE modem routes (SimCom SIM7600). Extracted from index.js; mounted with a
// context object so the handlers keep their original behaviour.
import type { Request, Response } from 'express'
const { Router } = require('express')
const { check, validationResult } = require('express-validator')

export = function lteModemRoutes ({ authenticateToken, toBool, lteModem }: { authenticateToken: any; toBool: any; lteModem: any }) {
  const router = Router()

  // Serve the LTE modem settings, status and detected serial ports
  router.get('/api/ltemodem', authenticateToken, (req: Request, res: Response) => {
    lteModem.getSerialPorts().then((ports: any) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ settings: lteModem.getSettings(), status: lteModem.getStatus(), serialPorts: ports }))
    })
  })

  // change LTE modem settings
  router.post('/api/ltemodemmodify', authenticateToken, [
    check('enabled').isBoolean(),
    check('atPort').isString().isLength({ max: 128 }),
    check('baud').isInt(),
    check('apn').optional({ checkFalsy: true }).isString().isLength({ max: 64 }),
    check('netInterface').isString().isLength({ min: 1, max: 15 }),
    check('autoReconnect').isBoolean(),
    check('pollInterval').isInt({ min: 2, max: 120 }),
    check('dataPathMode').optional({ checkFalsy: true }).isIn(['rndis', 'qmi', 'ppp']),
    check('qmiDevice').optional({ checkFalsy: true }).isString().isLength({ max: 128 }),
    check('pppPort').optional({ checkFalsy: true }).isString().isLength({ max: 128 }),
    check('pppBaud').optional({ checkFalsy: true }).isInt()
  ], function (req: Request, res: Response) {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/ltemodemmodify', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }

    lteModem.setSettings({
      enabled: toBool(req.body.enabled),
      atPort: req.body.atPort,
      baud: parseInt(req.body.baud, 10),
      apn: req.body.apn || '',
      netInterface: req.body.netInterface,
      autoReconnect: toBool(req.body.autoReconnect),
      pollInterval: parseInt(req.body.pollInterval, 10),
      dataPathMode: req.body.dataPathMode || 'rndis',
      qmiDevice: req.body.qmiDevice || '/dev/cdc-wdm0',
      pppPort: req.body.pppPort || '',
      pppBaud: parseInt(req.body.pppBaud, 10) || 115200
    }, (err: Error | null) => {
      res.setHeader('Content-Type', 'application/json')
      if (err) {
        res.status(422).send(JSON.stringify({ error: err.message, settings: lteModem.getSettings() }))
      } else {
        res.send(JSON.stringify({ error: null, settings: lteModem.getSettings() }))
      }
    })
  })

  // manually (re)start the modem's RNDIS data call
  router.post('/api/ltemodemreconnect', authenticateToken, function (req: Request, res: Response) {
    res.setHeader('Content-Type', 'application/json')
    lteModem.reconnect().then((lines: any) => {
      res.send(JSON.stringify({ error: null, response: lines }))
    }).catch((err: any) => {
      res.status(422).send(JSON.stringify({ error: err.message, response: [] }))
    })
  })

  // bring the data call up using the configured data-path mode (RNDIS/QMI/PPP)
  router.post('/api/ltemodemconnect', authenticateToken, function (req: Request, res: Response) {
    res.setHeader('Content-Type', 'application/json')
    lteModem.connectData().then((lines: any) => {
      res.send(JSON.stringify({ error: null, response: lines }))
    }).catch((err: any) => {
      res.status(422).send(JSON.stringify({ error: err.message, response: [] }))
    })
  })

  // bring the data call down using the configured data-path mode
  router.post('/api/ltemodemdisconnect', authenticateToken, function (req: Request, res: Response) {
    res.setHeader('Content-Type', 'application/json')
    lteModem.disconnectData().then((lines: any) => {
      res.send(JSON.stringify({ error: null, response: lines }))
    }).catch((err: any) => {
      res.status(422).send(JSON.stringify({ error: err.message, response: [] }))
    })
  })

  // switch the modem's USB composition (QMI <-> RNDIS). Reboots the modem.
  router.post('/api/ltemodemusbmode', authenticateToken, [check('mode').isIn(['qmi', 'rndis'])], function (req: Request, res: Response) {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/ltemodemusbmode', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }
    const usbPidMap: { [k: string]: string } = { qmi: '9001', rndis: '9011' }
    const pid = usbPidMap[req.body.mode]
    res.setHeader('Content-Type', 'application/json')
    lteModem.setUsbMode(pid).then((lines: any) => {
      res.send(JSON.stringify({ error: null, response: lines }))
    }).catch((err: any) => {
      res.status(422).send(JSON.stringify({ error: err.message, response: [] }))
    })
  })

  // reset the data usage counters
  router.post('/api/ltemodemresetusage', authenticateToken, function (req: Request, res: Response) {
    lteModem.resetUsage()
    res.setHeader('Content-Type', 'application/json')
    res.send(JSON.stringify({ error: null, status: lteModem.getStatus() }))
  })

  // scan serial ports (USB + UART) for an AT-responding modem and list
  // candidate data network interfaces. Long-running (up to ~20s)
  router.post('/api/ltemodemdetect', authenticateToken, function (req: Request, res: Response) {
    res.setHeader('Content-Type', 'application/json')
    lteModem.detectModem().then((result: any) => {
      res.send(JSON.stringify({ error: null, ports: result.ports, interfaces: result.interfaces }))
    }).catch((err: any) => {
      res.status(422).send(JSON.stringify({ error: err.message, ports: [], interfaces: [] }))
    })
  })

  // staged end-to-end connection test (AT -> SIM -> registration -> data
  // call -> interface -> ping)
  router.post('/api/ltemodemtest', authenticateToken, [
    check('pingHost').optional({ checkFalsy: true }).matches(/^[a-zA-Z0-9.:-]{1,253}$/)
  ], function (req: Request, res: Response) {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/ltemodemtest', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }

    res.setHeader('Content-Type', 'application/json')
    lteModem.testConnection(req.body.pingHost || undefined).then((steps: any) => {
      res.send(JSON.stringify({ error: null, steps }))
    }).catch((err: any) => {
      res.status(422).send(JSON.stringify({ error: err.message, steps: [] }))
    })
  })

  // raw AT command console
  router.post('/api/ltemodemcommand', authenticateToken, [
    check('command').isString().isLength({ min: 2, max: 128 })
  ], function (req: Request, res: Response) {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/ltemodemcommand', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }

    lteModem.sendUserCommand(req.body.command, (err: Error | null, lines: any) => {
      res.setHeader('Content-Type', 'application/json')
      if (err) {
        res.status(422).send(JSON.stringify({ error: err.message, response: [] }))
      } else {
        res.send(JSON.stringify({ error: null, response: lines }))
      }
    })
  })

  return router
}
