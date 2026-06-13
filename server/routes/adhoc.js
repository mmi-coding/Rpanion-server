// Adhoc WiFi routes. Extracted from index.js.
const { Router } = require('express')
const { check, validationResult } = require('express-validator')

module.exports = function adhocRoutes ({ authenticateToken, adhocManager }) {
  const router = Router()

  // Serve the adhocwifi info
  router.get('/api/adhocadapters', authenticateToken, (req, res) => {
    adhocManager.getAdapters((err, netDeviceList, netDeviceSelected, settings) => {
      if (!err) {
        res.setHeader('Content-Type', 'application/json')
        const ret = { netDevice: netDeviceList, netDeviceSelected, curSettings: settings }
        res.send(JSON.stringify(ret))
      } else {
        res.setHeader('Content-Type', 'application/json')
        const ret = { netDevice: [], netDeviceSelected: [], cursettings: [], error: err }
        res.send(JSON.stringify(ret))
        console.log('Error in /api/adhocadapters ', { message: err })
      }
    })
  })

  // activate or deactivate adhoc wifi
  router.post('/api/adhocadaptermodify', authenticateToken, [check('settings.isActive').isBoolean(),
    check('toState').isBoolean(),
    check('netDeviceSelected').isAlphanumeric(),
    check('settings.ipaddress').if(check('toState').isIn([true])).isIP(),
    check('settings.wpaType').isIn(['none', 'wep']),
    check('settings.password').if(check('settings.wpaType').isIn(['wep'])).isAlphanumeric(),
    check('settings.ssid').if(check('toState').isIn([true])).isAlphanumeric(),
    check('settings.band').isIn(['a', 'bg']),
    check('settings.channel').if(check('toState').isIn([true])).isInt(),
    check('settings.gateway').optional({ checkFalsy: true }).if(check('toState').isIn([true])).isIP()], function (req, res) {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log(req.body)
      console.log('Bad POST vars in /api/adhocadaptermodify', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    } else {
      adhocManager.setAdapter(req.body.toState, req.body.netDeviceSelected, req.body.settings, (err, netDeviceList, netDeviceSelected, settings) => {
        if (!err) {
          res.setHeader('Content-Type', 'application/json')
          const ret = { netDevice: netDeviceList, netDeviceSelected, curSettings: settings }
          res.send(JSON.stringify(ret))
        } else {
          res.setHeader('Content-Type', 'application/json')
          const ret = { netDevice: netDeviceList, netDeviceSelected, curSettings: settings, error: err }
          res.send(JSON.stringify(ret))
          console.log('Error in /api/adhocadapters ', { message: err })
        }
      })
    }
  })

  return router
}
