// System / about / logs / settings routes. Extracted from index.js.
import type { Request, Response } from 'express'
const { Router } = require('express')
const { check, validationResult } = require('express-validator')
const fs = require('fs')
const appRoot = require('app-root-path')
const logpaths = require('../paths')

export = function systemRoutes ({ authenticateToken, aboutPage, networkClients, logManager, fcManager }: { authenticateToken: any; aboutPage: any; networkClients: any; logManager: any; fcManager: any }) {
  const router = Router()

  // Serve the logfile
  router.get('/api/logfile', authenticateToken, (req: Request, res: Response) => {
    aboutPage.getsystemctllog((logStr: any) => {
      console.log(logStr)
      res.setHeader('Content-Disposition', 'attachment; filename="rpanion.log"')
      res.setHeader('Content-Type', 'text/plain')
      res.send(logStr)
    })
  })

  // Serve the AP clients info
  router.get('/api/networkclients', authenticateToken, (req: Request, res: Response) => {
    networkClients.getClients((err: any, apnamev: any, apclientsv: any) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ error: err, apname: apnamev, apclients: apclientsv }))
    })
  })

  router.get('/api/logfiles', authenticateToken, (req: Request, res: Response) => {
    logManager.getLogs((err: any, tlogs: any, binlogs: any, kmzlogs: any, media: any) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ TlogFiles: tlogs, BinlogFiles: binlogs, KMZlogFiles: kmzlogs, MediaFiles: media, url: req.protocol + '://' + req.headers.host }))
    })
  })

  router.post('/api/deletelogfiles', authenticateToken, [check('logtype').isIn(['tlog', 'binlog', 'kmzlog', 'media'])], (req: Request, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/deletelogfiles', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }

    logManager.clearlogs(req.body.logtype, fcManager.binlog)
    res.setHeader('Content-Type', 'application/json')
    res.send(JSON.stringify({}))
  })

  router.get('/api/approot', authenticateToken, (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json')
    res.send(JSON.stringify({ appRoot: appRoot.toString() }))
  })

  router.get('/api/softwareinfo', authenticateToken, (req: Request, res: Response) => {
    aboutPage.getSoftwareInfo((OSV: any, NodeV: any, RpanionV: any, hostname: any, err: any) => {
      if (!err) {
        res.setHeader('Content-Type', 'application/json')
        res.send(JSON.stringify({ OSVersion: OSV, Nodejsversion: NodeV, rpanionversion: RpanionV, hostname }))
        console.log('/api/softwareinfo OS:' + OSV + ' Node:' + NodeV + ' Rpanion:' + RpanionV + ' Hostname: ' + hostname)
      } else {
        res.setHeader('Content-Type', 'application/json')
        res.send(JSON.stringify({ OSVersion: err, Nodejsversion: err, rpanionversion: err, hostname: err }))
        console.log('Error in /api/softwareinfo ', { message: err })
      }
    })
  })

  router.get('/api/hardwareinfo', authenticateToken, (req: Request, res: Response) => {
    aboutPage.getHardwareInfo((RAM: any, CPU: any, hatData: any, sysData: any, err: any) => {
      if (!err) {
        res.setHeader('Content-Type', 'application/json')
        res.send(JSON.stringify({ CPUName: CPU, RAMName: RAM, HATName: hatData, SYSName: sysData }))
      } else {
        res.setHeader('Content-Type', 'application/json')
        res.send(JSON.stringify({ CPUName: err, RAMName: err, HATName: err, SYSName: err }))
        console.log('Error in /api/hardwareinfo ', { message: err })
      }
    })
  })

  router.get('/api/diskinfo', authenticateToken, (req: Request, res: Response) => {
    aboutPage.getDiskInfo((total: any, used: any, percent: any, err: any) => {
      if (!err) {
        res.setHeader('Content-Type', 'application/json')
        res.send(JSON.stringify({ diskSpaceStatus: 'Used ' + used + '/' + total + ' Gb (' + percent + '%)' }))
      } else {
        res.setHeader('Content-Type', 'application/json')
        res.send(JSON.stringify({ diskSpaceStatus: err }))
        console.log('Error in /api/diskinfo ', { message: err })
      }
    })
  })

  router.post('/api/shutdowncc', authenticateToken, function () {
    // User wants to shutdown the computer
    aboutPage.shutdownCC()
  })

  router.post('/api/resetsettings', authenticateToken, function (req: Request, res: Response) {
    // User wants to reset all settings to defaults
    try {
      const settingsPath = logpaths.settingsFile

      // Delete the settings file
      if (fs.existsSync(settingsPath)) {
        fs.unlinkSync(settingsPath)
        console.log('Settings file deleted:', settingsPath)
      }

      // Create empty settings object
      fs.writeFileSync(settingsPath, '{}')
      console.log('Settings reset to defaults')

      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ success: true, message: 'Settings have been reset. Please restart the application for changes to take effect.' }))
    } catch (error) {
      console.error('Error resetting settings:', error)
      res.status(500).send(JSON.stringify({ error: 'Failed to reset settings: ' + error.message }))
    }
  })

  router.get('/api/settingsbackup', authenticateToken, function (req: Request, res: Response) {
    // User wants to download the current settings as a JSON file
    try {
      const settingsPath = logpaths.settingsFile
      const contents = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, 'utf8') : '{}'
      res.setHeader('Content-Disposition', 'attachment; filename="rpanion-settings.json"')
      res.setHeader('Content-Type', 'application/json')
      res.send(contents)
    } catch (error) {
      console.error('Error backing up settings:', error)
      res.status(500).send(JSON.stringify({ error: 'Failed to backup settings: ' + error.message }))
    }
  })

  router.post('/api/settingsrestore', authenticateToken, function (req: Request, res: Response) {
    // User wants to restore settings from an uploaded settings object
    try {
      const settings = req.body
      // Must be a non-null, non-array plain object
      if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
        return res.status(400).send(JSON.stringify({ success: false, error: 'Invalid settings: expected a JSON object' }))
      }
      fs.writeFileSync(logpaths.settingsFile, JSON.stringify(settings))
      console.log('Settings restored')
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ success: true, message: 'Settings restored. Please restart the application for changes to take effect.' }))
    } catch (error) {
      console.error('Error restoring settings:', error)
      res.status(500).send(JSON.stringify({ error: 'Failed to restore settings: ' + error.message }))
    }
  })

  return router
}
