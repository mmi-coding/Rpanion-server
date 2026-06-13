// Network priority / bandwidth routes. Extracted from index.js.
const { Router } = require('express')
const { check, validationResult } = require('express-validator')

module.exports = function networkPriorityRoutes ({ authenticateToken, networkPriority }) {
  const router = Router()

  // List NetworkManager connections for priority configuration
  router.get('/api/networkpriority', authenticateToken, (req, res) => {
    networkPriority.listConnections((err, connections) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ error: err, connections }))
    })
  })

  // Per-interface bandwidth (totals + rate since the last sample)
  router.get('/api/networkbandwidth', authenticateToken, (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.send(JSON.stringify({ interfaces: networkPriority.getBandwidth() }))
  })

  // Set a connection's autoconnect priority + route metric (WiFi/cellular failover)
  router.post('/api/networksetpriority', authenticateToken, [
    check('conName').isUUID(),
    check('priority').isInt({ min: -999, max: 999 }),
    check('metric').isInt({ min: 0, max: 9999 })
  ], (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/networksetpriority', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }
    networkPriority.setPriority(req.body.conName, parseInt(req.body.priority, 10), parseInt(req.body.metric, 10), (err) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ error: err }))
    })
  })

  return router
}
