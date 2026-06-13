// Cloud upload routes. Extracted from index.js.
const { Router } = require('express')
const { check, validationResult } = require('express-validator')

module.exports = function cloudRoutes ({ authenticateToken, cloud }) {
  const router = Router()

  // Serve the cloud info
  router.get('/api/cloudinfo', authenticateToken, (req, res) => {
    cloud.getSettings((doBinUpload, binUploadLink, syncDeletions, pubkey) => {
      res.setHeader('Content-Type', 'application/json')
      res.send(JSON.stringify({ doBinUpload, binUploadLink, syncDeletions, pubkey }))
    })
  })

  // activate or deactivate bin log upload
  router.post('/api/binlogupload', authenticateToken, [check('doBinUpload').isBoolean(),
    check('binUploadLink').not().isEmpty().not().contains(';').not().contains('\'').not().contains('"').trim(),
    check('syncDeletions').isBoolean()], function (req, res) {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log(req.body)
      console.log('Bad POST vars in /api/binlogupload', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    } else {
      cloud.setSettingsBin(req.body.doBinUpload, req.body.binUploadLink, req.body.syncDeletions)
      // send back refreshed settings
      cloud.getSettings((doBinUpload, binUploadLink, syncDeletions) => {
        res.setHeader('Content-Type', 'application/json')
        res.send(JSON.stringify({ doBinUpload, binUploadLink, syncDeletions }))
      })
    }
  })

  return router
}
