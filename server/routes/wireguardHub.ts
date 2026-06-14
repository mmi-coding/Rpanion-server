// WireGuard Hub route — generates a VPS setup script from user config.
import type { Request, Response } from 'express'
const { Router } = require('express')
const { check, validationResult } = require('express-validator')

export = function wireguardHubRoutes ({ authenticateToken, wireguardHub }: { authenticateToken: any; wireguardHub: any }) {
  const router = Router()

  // Generate the VPS setup script. Inputs are interpolated into a bash script,
  // so they are strictly validated (IP / FQDN / port / CIDR) — anything that
  // fails is rejected with 422 before reaching the generator.
  router.post('/api/wireguardhubscript', authenticateToken, [
    check('vpsIp').isIP(),
    check('domain').isFQDN(),
    check('port').isInt({ min: 1, max: 65535 }),
    check('subnet').matches(/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/),
    check('sshPort').isInt({ min: 1, max: 65535 })
  ], (req: Request, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/wireguardhubscript', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }

    const script = wireguardHub.generateScript({
      vpsIp: req.body.vpsIp,
      domain: req.body.domain,
      port: parseInt(req.body.port, 10),
      subnet: req.body.subnet,
      sshPort: parseInt(req.body.sshPort, 10)
    })
    res.setHeader('Content-Type', 'application/json')
    res.send(JSON.stringify({ script }))
  })

  return router
}
