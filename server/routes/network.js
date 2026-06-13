// NetworkManager (wired/WiFi connection) routes. Extracted from index.js.
const { Router } = require('express')
const { check, validationResult } = require('express-validator')

module.exports = function networkRoutes ({ authenticateToken, networkManager }) {
  const router = Router()

  router.get('/api/networkadapters', authenticateToken, (req, res) => {
    networkManager.getAdapters((err, netDeviceList) => {
      if (!err) {
        res.setHeader('Content-Type', 'application/json')
        const ret = { netDevice: netDeviceList }
        res.send(JSON.stringify(ret))
      } else {
        res.setHeader('Content-Type', 'application/json')
        const ret = { netDevice: [] }
        res.send(JSON.stringify(ret))
        console.log('Error in /api/networkadapters ', { message: err })
      }
    })
  })

  router.get('/api/wifiscan', authenticateToken, (req, res) => {
    networkManager.getWifiScan((err, wifiList) => {
      if (!err) {
        res.setHeader('Content-Type', 'application/json')
        const ret = { detWifi: wifiList }
        res.send(JSON.stringify(ret))
      } else {
        res.setHeader('Content-Type', 'application/json')
        const ret = { detWifi: [] }
        res.send(JSON.stringify(ret))
        console.log('Error in /api/wifiscan ', { message: err })
      }
    })
  })

  router.get('/api/wirelessstatus', authenticateToken, (req, res) => {
    networkManager.getWirelessStatus((err, status) => {
      if (!err) {
        res.setHeader('Content-Type', 'application/json')
        const ret = { wirelessEnabled: status }
        res.send(JSON.stringify(ret))
      } else {
        res.setHeader('Content-Type', 'application/json')
        const ret = { wirelessEnabled: true }
        res.send(JSON.stringify(ret))
        console.log('Error in /api/wirelessstatus ', { message: err })
      }
    })
  })

  router.post('/api/setwirelessstatus', authenticateToken, [check('status').isBoolean()], (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/setwirelessstatus ', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }
    // user wants to toggle wifi enabled/disabled
    networkManager.setWirelessStatus(req.body.status, (err, status) => {
      if (!err) {
        res.setHeader('Content-Type', 'application/json')
        const ret = { wirelessEnabled: status }
        res.send(JSON.stringify(ret))
      } else {
        res.setHeader('Content-Type', 'application/json')
        const ret = { wirelessEnabled: status }
        res.send(JSON.stringify(ret))
        console.log('Error in /api/setwirelessstatus ', { message: err })
      }
    })
  })

  router.get('/api/networkconnections', authenticateToken, (req, res) => {
    networkManager.getConnections((err, netConnectionList) => {
      if (!err) {
        res.setHeader('Content-Type', 'application/json')
        const ret = { netConnection: netConnectionList }
        res.send(JSON.stringify(ret))
      } else {
        res.setHeader('Content-Type', 'application/json')
        const ret = { netConnection: [] }
        res.send(JSON.stringify(ret))
        console.log('Error in /api/networkconnections ', { message: err })
      }
    })
  })

  // Get details of a network connection by connection ID
  router.post('/api/networkIP', authenticateToken, [check('conName').isUUID()], (req, res) => {
    // Finds the validation errors in this request and wraps them in an object with handy functions
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/networkIP ', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }
    networkManager.getConnectionDetails(req.body.conName, (err, conDetails) => {
      if (!err) {
        res.setHeader('Content-Type', 'application/json')
        const ret = { netConnectionDetails: conDetails }
        res.send(JSON.stringify(ret))
      } else {
        res.setHeader('Content-Type', 'application/json')
        const ret = { netConnectionDetails: {} }
        res.send(JSON.stringify(ret))
        console.log('Error in /api/networkIP ', { message: err })
      }
    })
  })

  // user wants to activate network
  router.post('/api/networkactivate', authenticateToken, [check('conName').isUUID()], (req, res) => {
    // Finds the validation errors in this request and wraps them in an object with handy functions
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      res.setHeader('Content-Type', 'application/json')
      const ret = { error: 'Bad input - ' + errors.array()[0].param }
      res.send(JSON.stringify(ret))
      console.log('Bad POST vars in /api/networkactivate ', { message: errors.array() })
    } else {
      console.log('Activating network ' + req.body.conName)
      networkManager.activateConnection(req.body.conName, (err) => {
        if (err) {
          res.setHeader('Content-Type', 'application/json')
          const ret = { error: err }
          res.send(JSON.stringify(ret))
          console.log('Error in /api/networkactivate ', { message: err })
        } else {
          res.setHeader('Content-Type', 'application/json')
          const ret = { error: null, action: 'NetworkActivateOK' }
          res.send(JSON.stringify(ret))
        }
      })
    }
  })

  // user wants to deactivate network
  router.post('/api/networkdeactivate', authenticateToken, [check('conName').isUUID()], (req, res) => {
    // Finds the validation errors in this request and wraps them in an object with handy functions
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      res.setHeader('Content-Type', 'application/json')
      const ret = { error: 'Bad input - ' + errors.array()[0].param }
      res.send(JSON.stringify(ret))
      console.log('Bad POST vars in /api/networkdeactivate ', { message: errors.array() })
    } else {
      console.log('Dectivating network ' + req.body.conName)
      networkManager.deactivateConnection(req.body.conName, (err) => {
        if (err) {
          res.setHeader('Content-Type', 'application/json')
          const ret = { error: err }
          res.send(JSON.stringify(ret))
          console.log('Error in /api/networkdeactivate ', { message: err })
        } else {
          res.setHeader('Content-Type', 'application/json')
          const ret = { error: null, action: 'NetworkDectivateOK' }
          res.send(JSON.stringify(ret))
        }
      })
    }
  })

  // user wants to delete network
  router.post('/api/networkdelete', authenticateToken, [check('conName').isUUID()], (req, res) => {
    // Finds the validation errors in this request and wraps them in an object with handy functions
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      res.setHeader('Content-Type', 'application/json')
      const ret = { error: 'Bad input - ' + errors.array()[0].param }
      res.send(JSON.stringify(ret))
      console.log('Bad POST vars in /api/networkdelete ', { message: errors.array() })
    } else {
      console.log('Deleting network ' + req.body.conName)
      networkManager.deleteConnection(req.body.conName, (err) => {
        if (err) {
          res.setHeader('Content-Type', 'application/json')
          const ret = { error: err }
          res.send(JSON.stringify(ret))
          console.log('Error in /api/networkdelete ', { message: err })
        } else {
          res.setHeader('Content-Type', 'application/json')
          const ret = { error: null, action: 'NetworkDeleteOK' }
          res.send(JSON.stringify(ret))
        }
      })
    }
  })

  // user wants to edit network
  router.post('/api/networkedit', authenticateToken, [check('conName').isUUID(),
    check('conSettings.ipaddresstype').isIn(['auto', 'manual', 'shared']),
    check('conSettings.ipaddress').optional().isIP(),
    check('conSettings.subnet').optional().isIP(),
    check('conSettings.wpaType').optional().isIn(['none', 'wpa-psk']),
    check('conSettings.password').optional().escape(),
    check('conSettings.ssid').optional().escape(),
    check('conSettings.attachedIface').optional().escape(),
    check('conSettings.band').optional().isIn(['a', 'bg']),
    check('conSettings.channel').optional().isInt(),
    check('conSettings.mode').optional().isIn(['infrastructure', 'ap'])
  ],
  (req, res) => {
    // Finds the validation errors in this request and wraps them in an object with handy functions
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      res.setHeader('Content-Type', 'application/json')
      const ret = { error: 'Bad input - ' + errors.array()[0].param }
      res.send(JSON.stringify(ret))
      console.log('Bad POST vars in /api/networkedit ', { message: errors.array() })
    } else {
      console.log('Editing network ' + req.body.conName)
      networkManager.editConnection(req.body.conName, req.body.conSettings, (err) => {
        if (err) {
          res.setHeader('Content-Type', 'application/json')
          const ret = { error: err }
          res.send(JSON.stringify(ret))
          console.log('Error in /api/networkedit ', { message: err })
        } else {
          res.setHeader('Content-Type', 'application/json')
          const ret = { error: null, action: 'NetworkEditOK' }
          res.send(JSON.stringify(ret))
        }
      })
    }
  })

  // User wants to add network
  router.post('/api/networkadd', authenticateToken, [check('conSettings.ipaddresstype').isIn(['auto', 'manual', 'shared']),
    check('conSettings.ipaddress').optional().isIP(),
    check('conSettings.subnet').optional().isIP(),
    check('conSettings.wpaType').optional().isIn(['none', 'wpa-psk']),
    check('conSettings.password').optional().escape(),
    check('conSettings.ssid').optional().escape(),
    check('conSettings.band').optional().isIn(['a', 'bg']),
    check('conSettings.channel').optional().isInt(),
    check('conSettings.attachedIface').optional().escape(),
    check('conSettings.mode').optional().isIn(['infrastructure', 'ap']),
    check('conName').escape(),
    check('conType').escape(),
    check('conAdapter').escape()
  ],
  (req, res) => {
    // Finds the validation errors in this request and wraps them in an object with handy functions
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      res.setHeader('Content-Type', 'application/json')
      const ret = { error: 'Bad input - ' + errors.array()[0].param }
      res.send(JSON.stringify(ret))
      console.log('Bad POST vars in /api/networkadd ', { message: errors.array() })
    } else {
      console.log('Adding network ' + req.body)
      networkManager.addConnection(req.body.conName, req.body.conType, req.body.conAdapter, req.body.conSettings, (err) => {
        if (err) {
          res.setHeader('Content-Type', 'application/json')
          const ret = { error: err }
          res.send(JSON.stringify(ret))
          console.log('Error in /api/networkadd ', { message: err })
        } else {
          res.setHeader('Content-Type', 'application/json')
          const ret = { error: null, action: 'NetworkAddOK' }
          res.send(JSON.stringify(ret))
        }
      })
    }
    console.log(req.body)
  })

  return router
}
