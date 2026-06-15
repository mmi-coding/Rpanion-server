// Camera control routes (still capture, recording, device lists, start/stop).
// Extracted from index.js.
const { Router } = require('express')
const { check, validationResult } = require('express-validator')
const path = require('path')

import type { Request, Response } from 'express'

export = function cameraRoutes ({ authenticateToken, toBool, vManager, fcManager, camSwitcher, MEDIA_ROOT }: { authenticateToken: any; toBool: any; vManager: any; fcManager: any; camSwitcher: any; MEDIA_ROOT: string }) {
  const router = Router()

  // Capture a single still photo when in photo mode
  // This code responds to the button on the web interface
  router.post('/api/capturestillphoto', authenticateToken, function (req: Request, res: Response) {
    if (vManager.active && vManager.cameraMode === 'photo') {
      console.log("[API /api/capturestillphoto] Conditions met. Calling vManager.captureStillPhoto()");
      const currentPosition = fcManager.getSystemStatus().vehiclePosition;

      // Call without MAVLink sender/target info as it's a UI trigger
      vManager.captureStillPhoto(null, null, null, currentPosition);
      res.status(200).send({ message: 'Capture signal sent.' });
    } else {
      console.log("[API /api/capturestillphoto] Conditions NOT met. Sending 400.");
      res.status(400).send({ error: 'Camera not active or not in photo mode.' });
    }
  })

  // Toggle local video recording on/off
  // This code responds to the button on the web interface
  router.post('/api/togglevideorecording', authenticateToken, function (req: Request, res: Response) {
    console.log(`[API /togglevideorecording] Received request. Server state: vManager.active=${vManager.active}, vManager.cameraMode=${vManager.cameraMode}`);

    // Check if active and in the correct mode
    if (vManager.active && vManager.cameraMode === 'video') {
      try {
        vManager.toggleVideoRecording(); // Use the new method name
        console.log('Toggled video recording via API.');
        res.status(200).send({ success: true, message: 'Toggle signal sent.' });
      } catch (err) {
        console.log('Error toggling video recording:', err);
        res.status(500).send({ error: 'Failed to send toggle signal.' });
      }
    } else {
      console.log(`[API /togglevideorecording] Condition NOT met (active=${vManager.active}, mode=${vManager.cameraMode}). Sending 400.`);
      res.status(400).send({ error: 'Camera is not active in video recording mode.' });
    }
  })

  router.get('/api/videodevices', authenticateToken, (req: Request, res: Response) => {

    vManager.getVideoDevices((err: any, responseData: any) => {
      res.setHeader('Content-Type', 'application/json');
      if (err) {
        console.error('Error getting video devices /api/videodevices:', err);
        // Determine appropriate status code and send minimal fallback data
        const status = (err === 'No video devices found') ? 404 : 500;
        return res.status(status).json({
          error: `Failed to get video devices: ${err}`,
          active: vManager.active,
          cameraMode: vManager.cameraMode,
          networkInterfaces: vManager.scanInterfaces()
        });
      }
      // Send the whole responseData object directly
      res.send(JSON.stringify(responseData));
    });
  });

  // GET Still Camera Device information
  router.get('/api/camera/still_devices', authenticateToken, (req: Request, res: Response) => {
    vManager.getStillDevices((err: any, stillData: any) => {
      res.setHeader('Content-Type', 'application/json');
      if (err) {
        console.error('Error getting still devices:', err);
        return res.status(500).json({
          error: `Failed to get still camera devices: ${err}`,
          devices: []
        });
      }

      // stillData contains { devices, selectedDevice, selectedCap }
      res.send(JSON.stringify({
        ...stillData,
        error: null
      }));
    });
  });

  // POST to START a specific camera mode (streaming, photo, video)
  router.post('/api/camera/start', authenticateToken, [
    check('cameraMode').isIn(['streaming', 'photo', 'video']),
    check('useCameraHeartbeat').isBoolean(),
    // Validation for modes that use a video pipeline ('streaming' or 'video')
    check('videoDevice').if(check('cameraMode').isIn(['streaming', 'video'])).isString().notEmpty(),
    check('height').if(check('cameraMode').isIn(['streaming', 'video'])).isInt({ min: 1 }),
    check('width').if(check('cameraMode').isIn(['streaming', 'video'])).isInt({ min: 1 }),
    check('bitrate').if(check('cameraMode').isIn(['streaming', 'video'])).isInt({ min: 50, max: 50000 }),
    check('fps').if(check('cameraMode').isIn(['streaming', 'video'])).isInt({ min: 0, max: 120 }),
    check('rotation').if(check('cameraMode').isIn(['streaming', 'video'])).isInt().isIn([0, 90, 180, 270]),
    // Validation ONLY for 'photo' mode
    check('stillDevice').if(check('cameraMode').equals('photo')).isString().notEmpty(),
    check('stillWidth').if(check('cameraMode').equals('photo')).isInt({ min: 1 }),
    check('stillHeight').if(check('cameraMode').equals('photo')).isInt({ min: 1 }),
    // Media destination for photo and video modes (optional, but validate if provided)
    check('mediaDestination')
      .if(check('cameraMode').isIn(['photo', 'video']))
      .optional({ checkFalsy: true }) // Allow blank inputs (to save to MEDIA_ROOT without a subdir)
      .isString()
      .trim()
      .customSanitizer((dest: string) => {
        // For ease of use:
        // If the user pasted the full absolute media path, strip it down to just the folder name
        if (dest.startsWith(MEDIA_ROOT)) {
          dest = dest.slice(MEDIA_ROOT.length);
        }
        // Also for ease of use:
        // Strip leading slashes so that if an absolute path is entered
        // by mistake, it's converted to a relative path instead of being rejected
        return dest.replace(/^[\/\\]+/, '');
      })
        // Check for path traversal attemptsa and null characters
      .custom((dest: string) => {
        if (dest.includes('\0')) {
          throw new Error('Media Destination contains invalid characters');
        }
        if (dest.includes('..')) {
          throw new Error('Directory traversal is not allowed');
        }
        // Final check that an absolute path didn't make it through the sanitizer
        /* istanbul ignore next -- unreachable on Linux: sanitizer strips all leading slashes so no absolute path can survive to this check */
        if (path.isAbsolute(dest)) {
          throw new Error('Media Destination must be a relativefolder name, not an absolute path');
        }
        return true;
      })
  ], (req: Request, res: Response) => {
    console.log("--- Received /api/camera/start request ---");
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
   console.error('Validation failed for /api/camera/start:', errors.array());
      return res.status(422).json({ error: 'Invalid media destination', details: errors.array() });
    }

    const mode = req.body.cameraMode;
    vManager.cameraMode = mode;
    vManager.useCameraHeartbeat = req.body.useCameraHeartbeat;

  // Sanitize the user-provided media destination
    let safeMediaDestination = null;
      if (req.body.mediaDestination) {

        // Force the input into a string format
        const userInput = String(req.body.mediaDestination);

        // Explicitly check for traversal strings inline
        if (userInput.includes('..') || userInput.includes('\0')) {
          return res.status(403).json({ error: 'Path traversal characters detected' });
        }

        const targetPath = path.join(MEDIA_ROOT, userInput);

        const relative = path.relative(MEDIA_ROOT, targetPath);
        // Double-check strict path boundaries to prevent any evasion
        /* istanbul ignore next -- defence-in-depth: the inline ".." and null-byte checks above already block any traversal; path.relative() of a non-traversing join cannot start with ".." */
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          return res.status(403).json({ error: 'Invalid media destination path boundaries' });
        }

        // Store only the path relative to the media directory
        /* istanbul ignore next -- path.relative() on Linux returns '' (not '.') for equal paths; the '.' branch is unreachable on POSIX */
        safeMediaDestination = relative === '.' ? '' : relative;

      }

    // Map incoming request to the internal settings objects used by videostream.js
    if (mode === 'streaming' || mode === 'video') {
      vManager.videoSettings = {
        device: req.body.videoDevice,
        isRecording: req.body.isRecording === false || req.body.isRecording === 'false',
        height: parseInt(req.body.height, 10),
        width: parseInt(req.body.width, 10),
        format: req.body.format,
        bitrate: parseInt(req.body.bitrate, 10),
        fps: parseInt(req.body.fps, 10),
        rotation: parseInt(req.body.rotation, 10),
        useUDP: toBool(req.body.useUDP),
        useUDPIP: req.body.useUDPIP,
        useUDPPort: parseInt(req.body.useUDPPort, 10),
        useTimestamp: toBool(req.body.useTimestamp),
        useHud: toBool(req.body.useHud),
        hudStyle: req.body.hudStyle === 'graphic' ? 'graphic' : 'text',
        mavStreamSelected: req.body.mavStreamSelected,
        compression: req.body.compression,
        mediaDestination: safeMediaDestination
      };
    }
    /* istanbul ignore else */ else /* istanbul ignore next -- express-validator isIn(['streaming','photo','video']) ensures mode is always one of these three; the condition-false arm is unreachable */ if (mode === 'photo') {
      vManager.stillSettings = {
        device: req.body.stillDevice,
        width: parseInt(req.body.stillWidth, 10),
        height: parseInt(req.body.stillHeight, 10),
        format: req.body.stillFormat,
        mediaDestination: safeMediaDestination
      };
    }

    // Persist the selected media destination and mode settings immediately.
    vManager.saveSettings();

    // The dual-source video pipeline always starts on source A - keep the
    // switcher state in sync. The RC logic will re-switch if needed
    if (mode === 'streaming' && camSwitcher.getSettings().switchMode === 'gstreamer') {
      camSwitcher.activeSource = 'A'
    }

    vManager.startCamera((err: any, result: any) => {
      res.setHeader('Content-Type', 'application/json');
      if (err) {
        // Use %s for the mode variable so it is treated as data, not a format string
        console.error(`Error starting camera in %s mode:`, mode, err);
        return res.status(500).json({ error: err.message || err });
      }
      res.send(JSON.stringify({ ...result, error: null }));
    });
  });

  // POST to STOP the currently active camera mode
  router.post('/api/camera/stop', authenticateToken, (req: Request, res: Response) => {
    vManager.stopCamera((err: any, active: any) => {
      res.setHeader('Content-Type', 'application/json');
      if (err) {
        console.error('Error stopping camera:', err);
        return res.status(500).json({ error: 'Failed to stop camera cleanly' });
      }
      res.send(JSON.stringify({ active: active, error: null }));
    });
  });

  return router
}
