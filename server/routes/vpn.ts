// VPN routes (ZeroTier, WireGuard, Tailscale). Extracted from index.js.
const { Router } = require('express')
const { check, validationResult } = require('express-validator')

import type { Request, Response } from 'express'

export = function vpnRoutes ({ authenticateToken, VPNManager }: { authenticateToken: any; VPNManager: any }) {
  const router = Router()

  // Serve the vpn zerotier info
  router.get('/api/vpnzerotier', authenticateToken, (req: Request, res: Response) => {
    VPNManager.getVPNStatusZerotier(null, (stderr: any, statusJSON: any) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ error: stderr, statusZerotier: statusJSON }))
    })
  })

  // Add zerotier network
  router.post('/api/vpnzerotieradd', authenticateToken, [check('network').isAlphanumeric()], (req: Request, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/vpnzerotieradd', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }
    VPNManager.addZerotier(req.body.network, (stderr: any, statusJSON: any) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ error: stderr, statusZerotier: statusJSON }))
    })
  })

  // Remove zerotier network
  router.post('/api/vpnzerotierdel', authenticateToken, [check('network').isAlphanumeric()], (req: Request, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/vpnzerotierdel', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }
    VPNManager.removeZerotier(req.body.network, (stderr: any, statusJSON: any) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ error: stderr, statusZerotier: statusJSON }))
    })
  })

  // Serve the vpn wireguard info
  router.get('/api/vpnwireguard', authenticateToken, (req: Request, res: Response) => {
    VPNManager.getVPNStatusWireguard(null, (stderr: any, statusJSON: any) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ error: stderr, statusWireguard: statusJSON }))
    })
  })

  // Add new wireguard network
  router.post('/api/vpnwireguardprofileadd', authenticateToken, (req: Request, res: Response) => {
    const reqFiles = (req as any).files
    if (!reqFiles || Object.keys(reqFiles).length === 0 || reqFiles.wgprofile.truncated) {
      console.log("Couldn't upload")
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ error: 'Bad wireguard profile' }))
    }

    VPNManager.addWireguardProfile(reqFiles.wgprofile.name, reqFiles.wgprofile.tempFilePath, (err: any) => {
      if (err) {
        console.log('Error in /api/vpnwireguardprofileadd', { message: err })
        res.setHeader('Content-Type', 'application/json')
        res.send(JSON.stringify({ error: err }))
      } else {
        // get refreshed status
        VPNManager.getVPNStatusWireguard(null, (stderr: any, statusJSON: any) => {
          res.setHeader('Content-Type', 'application/json')
          res.send(JSON.stringify({ error: stderr, statusWireguard: statusJSON }))
        })
      }
    })
  })

  // Activate wireguard network
  router.post('/api/vpnwireguardactivate', authenticateToken, [check('network').not().isEmpty().not().contains(';').not().contains('\'').not().contains('"').trim()], (req: Request, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/vpnwireguardactivate', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }

    VPNManager.activateWireguardProfile(req.body.network, (stderr: any, statusJSON: any) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ error: stderr, statusWireguard: statusJSON }))
    })
  })

  // Deactivate wireguard network
  router.post('/api/vpnwireguarddeactivate', authenticateToken, [check('network').not().isEmpty().not().contains(';').not().contains('\'').not().contains('"').trim()], (req: Request, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/vpnwireguarddeactivate', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }

    VPNManager.deactivateWireguardProfile(req.body.network, (stderr: any, statusJSON: any) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ error: stderr, statusWireguard: statusJSON }))
    })
  })

  // Delete wireguard network
  router.post('/api/vpnwireguardelete', authenticateToken, [check('network').not().isEmpty().not().contains(';').not().contains('\'').not().contains('"').trim()], (req: Request, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/vpnwireguardelete', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }

    VPNManager.deleteWireguardProfile(req.body.network, (stderr: any, statusJSON: any) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ error: stderr, statusWireguard: statusJSON }))
    })
  })

  // Serve the tailscale info
  router.get('/api/vpntailscale', authenticateToken, (req: Request, res: Response) => {
    VPNManager.getVPNStatusTailscale(null, (stderr: any, statusJSON: any) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ error: stderr, statusTailscale: statusJSON }))
    })
  })

  // Connect tailscale with an auth key
  router.post('/api/vpntailscaleconnect', authenticateToken, [check('authkey').not().isEmpty().not().contains(';').not().contains('\'').not().contains('"').trim()], (req: Request, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/vpntailscaleconnect', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }

    VPNManager.connectTailscale(req.body.authkey, (stderr: any, statusJSON: any) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ error: stderr, statusTailscale: statusJSON }))
    })
  })

  // Disconnect tailscale
  router.post('/api/vpntailscaledisconnect', authenticateToken, (req: Request, res: Response) => {
    VPNManager.disconnectTailscale((stderr: any, statusJSON: any) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ error: stderr, statusTailscale: statusJSON }))
    })
  })

  return router
}
