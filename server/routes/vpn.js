// VPN routes (ZeroTier, WireGuard, Tailscale). Extracted from index.js.
const { Router } = require('express')
const { check, validationResult } = require('express-validator')

module.exports = function vpnRoutes ({ authenticateToken, VPNManager }) {
  const router = Router()

  // Serve the vpn zerotier info
  router.get('/api/vpnzerotier', authenticateToken, (req, res) => {
    VPNManager.getVPNStatusZerotier(null, (stderr, statusJSON) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ error: stderr, statusZerotier: statusJSON }))
    })
  })

  // Add zerotier network
  router.post('/api/vpnzerotieradd', authenticateToken, [check('network').isAlphanumeric()], (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/vpnzerotieradd', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }
    VPNManager.addZerotier(req.body.network, (stderr, statusJSON) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ error: stderr, statusZerotier: statusJSON }))
    })
  })

  // Remove zerotier network
  router.post('/api/vpnzerotierdel', authenticateToken, [check('network').isAlphanumeric()], (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/vpnzerotierdel', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }
    VPNManager.removeZerotier(req.body.network, (stderr, statusJSON) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ error: stderr, statusZerotier: statusJSON }))
    })
  })

  // Serve the vpn wireguard info
  router.get('/api/vpnwireguard', authenticateToken, (req, res) => {
    VPNManager.getVPNStatusWireguard(null, (stderr, statusJSON) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ error: stderr, statusWireguard: statusJSON }))
    })
  })

  // Add new wireguard network
  router.post('/api/vpnwireguardprofileadd', authenticateToken, (req, res) => {
    if (!req.files || Object.keys(req.files).length === 0 || req.files.wgprofile.truncated) {
      console.log("Couldn't upload")
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ error: 'Bad wireguard profile' }))
    }

    VPNManager.addWireguardProfile(req.files.wgprofile.name, req.files.wgprofile.tempFilePath, (err) => {
      if (err) {
        console.log('Error in /api/vpnwireguardprofileadd', { message: err })
        res.setHeader('Content-Type', 'application/json')
        res.send(JSON.stringify({ error: err }))
      } else {
        // get refreshed status
        VPNManager.getVPNStatusWireguard(null, (stderr, statusJSON) => {
          res.setHeader('Content-Type', 'application/json')
          res.send(JSON.stringify({ error: stderr, statusWireguard: statusJSON }))
        })
      }
    })
  })

  // Activate wireguard network
  router.post('/api/vpnwireguardactivate', authenticateToken, [check('network').not().isEmpty().not().contains(';').not().contains('\'').not().contains('"').trim()], (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/vpnwireguardactivate', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }

    VPNManager.activateWireguardProfile(req.body.network, (stderr, statusJSON) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ error: stderr, statusWireguard: statusJSON }))
    })
  })

  // Deactivate wireguard network
  router.post('/api/vpnwireguarddeactivate', authenticateToken, [check('network').not().isEmpty().not().contains(';').not().contains('\'').not().contains('"').trim()], (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/vpnwireguarddeactivate', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }

    VPNManager.deactivateWireguardProfile(req.body.network, (stderr, statusJSON) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ error: stderr, statusWireguard: statusJSON }))
    })
  })

  // Delete wireguard network
  router.post('/api/vpnwireguardelete', authenticateToken, [check('network').not().isEmpty().not().contains(';').not().contains('\'').not().contains('"').trim()], (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/vpnwireguardelete', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }

    VPNManager.deleteWireguardProfile(req.body.network, (stderr, statusJSON) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ error: stderr, statusWireguard: statusJSON }))
    })
  })

  // Serve the tailscale info
  router.get('/api/vpntailscale', authenticateToken, (req, res) => {
    VPNManager.getVPNStatusTailscale(null, (stderr, statusJSON) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ error: stderr, statusTailscale: statusJSON }))
    })
  })

  // Connect tailscale with an auth key
  router.post('/api/vpntailscaleconnect', authenticateToken, [check('authkey').not().isEmpty().not().contains(';').not().contains('\'').not().contains('"').trim()], (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/vpntailscaleconnect', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }

    VPNManager.connectTailscale(req.body.authkey, (stderr, statusJSON) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ error: stderr, statusTailscale: statusJSON }))
    })
  })

  // Disconnect tailscale
  router.post('/api/vpntailscaledisconnect', authenticateToken, (req, res) => {
    VPNManager.disconnectTailscale((stderr, statusJSON) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ error: stderr, statusTailscale: statusJSON }))
    })
  })

  return router
}
