const { exec, execSync, spawn } = require('child_process')
const path = require('path')
const si = require('systeminformation')
const events = require('events')
const { minimal, common } = require('node-mavlink')
const logpaths = require('./paths')
const fs = require('fs')
const vsHelpers = require('./videostreamHelpers')

class videoStream {
  videoSettings: any
  stillDevices: any
  lastSavedFile: any
  ifaces: any
  useCameraHeartbeat: any
  currentBitrate: any
  customPipelineFallback: any
  lastPipeline: any
  stillSettings: any
  devices: any
  eventEmitter: any
  intervalObj: any
  photoSeq: any
  cameraMode: any
  deviceAddresses: any
  deviceStream: any
  active: any
  settings: any
  constructor (settings: any) {
    this.settings = settings

    // Properties used in all modes
    this.active = false
    this.deviceStream = null
    this.deviceAddresses = []
    this.cameraMode = null; // 'streaming', 'photo', or 'video'
    this.photoSeq = 0;

    // Interval to send camera heartbeat events
    this.intervalObj = null;
    this.eventEmitter = new events.EventEmitter()

    // Mode-specific hardware lists/settings
    this.devices = null;      // Video devices
    this.stillDevices = null; // Still devices
    this.videoSettings = null;
    this.stillSettings = null;

    // The pipeline string used by the last/current stream, and the reason
    // a custom pipeline was rejected (if any). For the pipeline editor UI
    this.lastPipeline = '';
    this.customPipelineFallback = '';

    // last runtime bitrate (kbps) acknowledged by the video server, or
    // null if the stream is running at its configured bitrate
    this.currentBitrate = null;

    // Load saved settings from the 'camera' namespace
    this.active = this.settings.value('camera.active', false);
    this.cameraMode = this.settings.value('camera.mode', 'streaming');
    this.useCameraHeartbeat = this.settings.value('camera.useHeartbeat', false);

    // Load specific settings based on mode
    this.videoSettings = this.settings.value('camera.videoSettings', null);
    this.stillSettings = this.settings.value('camera.stillSettings', null);

    // if it's an active device, stop then start it up
    // need to scan for video devices first though
    if (this.active) {
      this.active = false
      this.initialize()
    }
  }

  // Convert destination to relative path form for storage and UI display.
  // Any absolute path or empty value is converted to a relative path under mediaDir.
  //
  // e.g., 'subdir' stays as 'subdir'
  // and '/abs/path' is stored as a relative path under mediaDir
  toRelativePath(dest: string) {
    return vsHelpers.toRelativePath(dest);
  }

  // Convert relative path to absolute before it is passed to Python.
  // Returns the media root directory if no destination is provided.
  toAbsolutePath(dest: string) {
    dest = this.toRelativePath(dest);
    return dest ? path.join(logpaths.mediaDir, dest) : logpaths.mediaDir;
  }

  async initialize() {
    try {
      // Discover Video Hardware and wait for data
      await new Promise((resolve, reject) => {
        this.getVideoDevices((err: any, data: any) => {  // Get the data
          if (err) {
            reject(err);
          } else {
            // this.devices is now populated inside getVideoDevices callback
            resolve(undefined);
          }
        });
      });

      // 2. Discover Still Photo Hardware (We will add this function in Step 2)
      // For now, we wrap it in a try/catch so it doesn't crash if the helper isn't there yet
      try {
        await new Promise((resolve, reject) => {
          this.getStillDevices((err: any) => err ? reject(err) : resolve(undefined));
        });
      } catch (e) {
        console.log("Still hardware discovery skipped or failed.");
      }

      // 3. Start the camera in the last saved mode
      this.startCamera((err: any) => {
        if (err) {
          console.error('Camera start error during init:', err);
          this.resetCamera();
        } else {
          this.active = true;
        }
      });
    } catch (error) {
      console.log('Resetting camera - initialization failed:', error);
      this.resetCamera();
    }
  }

  getVideoDevicesPromise() {
    // Promise wrapper for getVideoDevices
    return new Promise((resolve, reject) => {
      this.getVideoDevices((error: any) => {
        if (error) {
          reject(error)
        } else {
          resolve(undefined)
        }
      })
    })
  }

  startCameraPromise() {
    return new Promise((resolve, reject) => {
      this.startCamera((err: any, result: any) => {
        if (err) {
          reject(err)
        } else {
          resolve(result)
        }
      })
    })
  }


  // Format and store all the possible rtsp addresses
  populateAddresses (factory: string) {
    // set up the avail addresses
    this.ifaces = this.scanInterfaces()
    this.deviceAddresses = []

    for (let j = 0; j < this.ifaces.length; j++) {
      if (factory.includes('rtsp://')) {
        // remove any rtsp username or passwords, format rtsp://admin:admin@192.168.1.217:554/11
        let rtspfactory = factory
        rtspfactory = factory.replace('rtsp://', '')
        if (rtspfactory.includes('@')) {
          rtspfactory = rtspfactory.split('@')[1]
        }
        this.deviceAddresses.push('rtsp://' + this.ifaces[j] + ':8554/' + rtspfactory.replace(/\W/g, ''))
      } else {
        // note that video device URL's are the alphanumeric characters only. So /dev/video0 -> devvideo0
        this.deviceAddresses.push('rtsp://' + this.ifaces[j] + ':8554/' + factory.replace(/\W/g, ''))
      }
    }
  }

  getCompressionSelect(val: string) {
    return vsHelpers.getCompressionSelect(val);
  }

  getTransportSelect(val: string) {
    return vsHelpers.getTransportSelect(val);
  }

  getTransportOptions(){
    return vsHelpers.getTransportOptions();
  }

  // video streaming
  getVideoDevices (callback: any) {
    // get all video device details
    //dont update if streaming is running, as some camera won't be detected if in use
    const networkInterfaces = this.scanInterfaces();

    // Don't re-scan hardware if a stream is already running
    if (this.deviceStream !== null) {
      console.log("Camera active; returning cached hardware details.");

      const responseData: any = {
        devices: this.devices || [],
        networkInterfaces: networkInterfaces,
        active: this.active,
        cameraMode: this.cameraMode,
        streamAddresses: this.deviceAddresses,
        selectedDevice: null,
        selectedCap: null,
        resolutionCaps: [],
        fpsOptions: [],
        fpsMax: 0
      };

      // 1. Find the device and capability currently being used
      if (this.videoSettings && this.devices) {
        responseData.selectedDevice = this.devices.find((d: any) => d.value === this.videoSettings.device);
        if (responseData.selectedDevice) {
          // Safeguard the format string against missing slashes for V4L2 raw modes
          const formatStr = this.videoSettings.format || "";
          const formatShort = formatStr.includes('/') ? formatStr.split('/')[1] : formatStr;
          const capVal = `${this.videoSettings.width}x${this.videoSettings.height}x${formatShort}`;

          responseData.selectedCap = responseData.selectedDevice.caps.find((cap: any) => cap.value === capVal);
          responseData.resolutionCaps = responseData.selectedDevice.caps;
          responseData.fpsMax = responseData.selectedCap?.fpsmax || 0;
          responseData.fpsOptions = responseData.selectedCap?.fps || [];
        }

        // 2. Map raw numbers back to the UI's Object format
        responseData.selectedRotation = {
          label: (this.videoSettings.rotation || 0) + '°',
          value: (this.videoSettings.rotation || 0)
        };
        responseData.selectedMavStreamURI = {
          label: this.videoSettings.mavStreamSelected?.toString() || '127.0.0.1',
          value: this.videoSettings.mavStreamSelected || '127.0.0.1'
        };

        // 3. Map simple values
        responseData.selectedisRecording = this.videoSettings.isRecording || false;
        responseData.selectedBitrate = this.videoSettings.bitrate || 1100;
        responseData.selectedFps = this.videoSettings.fps || 30;
        responseData.selectedUseUDP = this.videoSettings.useUDP || false;
        responseData.selectedUseUDPIP = this.videoSettings.useUDPIP || '127.0.0.1';
        responseData.selectedUseUDPPort = this.videoSettings.useUDPPort || 5600;
        responseData.selectedUseTimestamp = this.videoSettings.useTimestamp || false;
        responseData.selectedUseCameraHeartbeat = this.useCameraHeartbeat || false;

        // Return an empty string if no media destination is given.
        responseData.videoMediaDestination = this.toRelativePath(this.videoSettings?.mediaDestination || '');
      }

      return callback(null, responseData);
    }

    // If not streaming, proceed with hardware discovery
    const pythonPath = logpaths.getPythonPath();
    exec(`${pythonPath} ./python/gstcaps.py`, (error: Error | null, stdout: string, stderr: string) => {
      const responseData = {
        devices: [],
        networkInterfaces: networkInterfaces,
        active: false,
        cameraMode: this.cameraMode,
        streamAddresses: [],
        selectedDevice: null,
        selectedCap: null,
        selectedRotation: { label: '0°', value: 0 },
        selectedBitrate: 1100,
        selectedFps: null,
        selectedUseUDP: false,
        selectedUseUDPIP: '127.0.0.1',
        selectedUseUDPPort: 5400,
        selectedIsRecording: false,
        selectedUseTimestamp: false,
        fpsOptions: [] as any[],
        fpsMax: 0,
        resolutionCaps: [],
        selectedUseCameraHeartbeat: this.useCameraHeartbeat,
        selectedMavStreamURI: { label: '127.0.0.1', value: '127.0.0.1' },
        videoMediaDestination: this.toRelativePath(this.videoSettings?.mediaDestination || '')
      };

      const warnstrings = ['DeprecationWarning', 'gst_element_message_full_with_details', 'camera_manager.cpp', 'Unsupported V4L2 pixel format'];
      if (stderr && !warnstrings.some(wrn => stderr.includes(wrn))) {
        return callback(stderr, responseData);
      }

      try {
        const devices = JSON.parse(stdout);
        // Add RTSP mocks
        devices.push({ label: 'RTSP Source (H.264)', value: 'rtspsourceh264', caps: [{ label: 'Custom RTSP Source', value: '1x1xx-h264', width: 1, height: 1, format: 'video/x-h264', fps: [{ label: 'N/A', value: 1 }], fpsmax: 0 }] });
        devices.push({ label: 'RTSP Source (H.265)', value: 'rtspsourceh265', caps: [{ label: 'Custom RTSP Source', value: '1x1xx-h265', width: 1, height: 1, format: 'video/x-h265', fps: [{ label: 'N/A', value: 1 }], fpsmax: 0 }] });

        this.devices = devices;
        responseData.devices = devices;

        // Populate defaults or saved settings as before...
        const selectedDevice = devices[0];
        const selectedCap = selectedDevice?.caps[0];

        responseData.selectedDevice = selectedDevice;
        responseData.selectedCap = selectedCap;
        responseData.resolutionCaps = /* istanbul ignore next -- RTSP mocks always provide caps */ selectedDevice?.caps || [];
        responseData.fpsOptions = selectedCap?.fps || [];
        responseData.fpsMax = selectedCap?.fpsmax || 0;
        responseData.selectedFps = responseData.fpsMax > 0 ? responseData.fpsMax : (responseData.fpsOptions[0]?.value ?? 30);

        return callback(null, responseData);
      } catch (e) {
        return callback('Failed to process video devices', responseData);
      }
    });
  }

  getStillDevices(callback: any) {
    const defaultResponse = {
      devices: [],
      capabilities: { cv2: false, picamera2: false },
      selectedDevice: undefined,
      selectedCap: undefined,
      stillMediaDestination: ''
    };

    const pythonPath = logpaths.getPythonPath();
    exec(`${pythonPath} ./python/get_camera_caps.py`, (error: Error | null, stdout: string, stderr: string) => {
      if (error) return callback(stderr || error.message, defaultResponse);

      try {
        const output = JSON.parse(stdout);
        const cameraDevices = output.devices || [];
        const capabilities = output.capabilities || { cv2: false, picamera2: false };
        
        this.stillDevices = cameraDevices;

        const defaultDevice = cameraDevices.find((dev: any) => dev.caps && dev.caps.length > 0);
        const defaultCap = defaultDevice?.caps[0];
        const stillMediaDestination = this.toRelativePath(this.stillSettings?.mediaDestination || '');

        return callback(null, {
          devices: cameraDevices,
          capabilities: capabilities,
          selectedDevice: defaultDevice,
          selectedCap: defaultCap,
          stillMediaDestination
        });
      } catch (e) {
        return callback('Invalid JSON from get_camera_caps.py', defaultResponse);
      }
    });
  }


  saveSettings() {
    try {
      this.settings.setValue('camera.active', this.active);
      this.settings.setValue('camera.mode', this.cameraMode);
      this.settings.setValue('camera.useHeartbeat', this.useCameraHeartbeat);
      this.settings.setValue('camera.videoSettings', this.videoSettings);
      this.settings.setValue('camera.stillSettings', this.stillSettings);
    } catch (e) {
      console.error('Error saving camera settings:', e);
    }
  }

  resetCamera() {
    this.active = false;
    this.videoSettings = null;
    this.stillSettings = null;
    try {
      this.settings.setValue('camera.active', false);
      this.settings.setValue('camera.mode', 'streaming');
      this.settings.setValue('camera.videoSettings', null);
      this.settings.setValue('camera.stillSettings', null);
      this.settings.setValue('camera.useHeartbeat', false);
    } catch (e) {
      console.log('Error saving reset settings:', e);
    }
    console.log('Camera System Reset');
  }

  scanInterfaces() {
    return vsHelpers.scanInterfaces()
  }

  startCamera(callback: any) {
    console.log(`Attempting to start camera in mode: ${this.cameraMode}`);
    try {
      if (this.cameraMode === 'streaming') {
        // startVideoStreaming is async, so we must catch rejections
        this.startVideoStreaming(callback).catch((err: any) => {
          console.error("Async Start Error:", err);
          callback(err);
        });
      } else if (this.cameraMode === 'photo') {
        this.startPhotoMode(callback);
      } else if (this.cameraMode === 'video') {
        this.startVideoMode(callback);
      } else {
        callback(new Error(`Unsupported camera mode: ${this.cameraMode}`));
      }
    } catch (syncErr) {
      console.error("Sync Start Error:", syncErr);
      callback(syncErr);
    }
  }

  // Build the extra video-server.py arguments for a dual-source (switchable)
  // pipeline, based on the camera switcher settings. Returns [] when the
  // switcher is disabled or not in gstreamer mode.
  // Custom (user-editable) pipeline for the active device, if enabled.
  // Takes precedence over the camera switcher's dual-source mode
  getCustomPipelineArgs() {
    const map = this.settings.value('customPipelines.map', {})
    const device = this.videoSettings ? this.videoSettings.device : null
    if (device && Object.prototype.hasOwnProperty.call(map, device) &&
        map[device].enabled && map[device].pipeline !== '') {
      return ['--custom-pipeline=' + map[device].pipeline]
    }
    return []
  }

  getSecondarySourceArgs() {
    const swEnabled = this.settings.value('cameraSwitcher.enabled', false)
    const swMode = this.settings.value('cameraSwitcher.switchMode', 'gstreamer')
    const secDevice = this.settings.value('cameraSwitcher.secDevice', '')

    if (!swEnabled || swMode !== 'gstreamer' || secDevice === '') {
      return []
    }

    // RTSP sources can't be a switchable secondary (would need a full
    // depay/decode branch); ignore if misconfigured
    if (secDevice.startsWith('rtsp')) {
      console.log('Camera switcher: RTSP secondary sources are not supported')
      return []
    }

    // capture size defaults to the primary stream size (0 = use primary)
    const secWidth = this.settings.value('cameraSwitcher.secWidth', 0) || this.videoSettings.width
    const secHeight = this.settings.value('cameraSwitcher.secHeight', 0) || this.videoSettings.height

    return [
      '--secondary=' + secDevice,
      '--secondary-format=' + this.settings.value('cameraSwitcher.secFormat', 'video/x-raw'),
      '--secondary-width=' + secWidth,
      '--secondary-height=' + secHeight,
      '--secondary-fps=' + this.settings.value('cameraSwitcher.secFps', -1)
    ]
  }

  // Build the transport args for the video server. The UI's RTP/RTSP
  // transport selection arrives as videoSettings.useUDP - without an
  // explicit --transport the video server defaults to RTSP and silently
  // ignores the --udp destination
  getTransportArgs() {
    if (this.videoSettings && this.videoSettings.useUDP) {
      return [
        '--transport=RTP',
        '--udp=' + `${this.videoSettings.useUDPIP}:${this.videoSettings.useUDPPort}`
      ]
    }
    return ['--transport=RTSP', '--udp=0']
  }

  // Cellular low-latency preset: pass --lowlatency to the video server so
  // the generated pipeline is tuned for constrained 4G links (1s GOP,
  // CBR-ish rate control, leaky queues, non-blocking udpsink)
  getCellularTuningArgs() {
    if (this.settings.value('cellularTuning.lowLatency', false)) {
      return ['--lowlatency']
    }
    return []
  }

  // Retune the encoder bitrate (kbps) on a running stream via the video
  // server's stdin control channel. Returns true if the command was sent;
  // the BITRATE: ack from the video server updates this.currentBitrate
  // Send one JSON control line to the running video server over stdin.
  // Returns true only if the stream is live and stdin accepted the write.
  _sendStdinCommand(payload: { cmd: string; [k: string]: any }) {
    if (this.deviceStream === null || this.cameraMode !== 'streaming') {
      return false
    }
    if (this.deviceStream.stdin && this.deviceStream.stdin.writable) {
      this.deviceStream.stdin.write(JSON.stringify(payload) + '\n')
      return true
    }
    return false
  }

  setBitrate(kbps: number) {
    if (!Number.isInteger(kbps) || kbps < 50 || kbps > 100000) {
      return false
    }
    return this._sendStdinCommand({ cmd: 'bitrate', kbps })
  }

  // Flip the active source on a running dual-source stream.
  // Returns true if the switch command was sent to the video server.
  switchSource(source: string) {
    if (source !== 'A' && source !== 'B') {
      return false
    }
    return this._sendStdinCommand({ cmd: 'switch', source })
  }

  async startVideoStreaming(callback: any) {
    if (!this.videoSettings) return callback(new Error('No video settings provided'));

    let device = this.videoSettings.device;
    let format = this.videoSettings.format;

    // Ubuntu RPI camera mapping
    if (await this.isUbuntu() && device === 'rpicam') {
      device = '/dev/video0';
      format = 'video/x-raw';
    }

    this.populateAddresses(this.videoSettings.device);

    const args = [
      '-u', // force the stdout and stderr streams to be unbuffered
      './python/video-server.py',
      '--video=' + device,
      '--height=' + this.videoSettings.height,
      '--width=' + this.videoSettings.width,
      '--format=' + format,
      '--bitrate=' + this.videoSettings.bitrate,
      '--rotation=' + this.videoSettings.rotation,
      '--fps=' + this.videoSettings.fps,
      ...this.getTransportArgs(),
      '--compression=' + this.videoSettings.compression,
      ...this.getCellularTuningArgs()
    ];

    if (this.videoSettings.useTimestamp) args.push('--timestamp');

    // custom (user-editable) pipeline support. Takes precedence over the
    // camera switcher's dual-source mode
    const customArgs = this.getCustomPipelineArgs();
    args.push(...customArgs);

    // dual-source (camera switcher) support
    if (customArgs.length === 0) {
      args.push(...this.getSecondarySourceArgs());
    } else if (this.getSecondarySourceArgs().length > 0) {
      console.log('Custom pipeline enabled for this device - camera switcher dual-source mode is disabled');
    }

    // reset pipeline tracking for this run
    this.lastPipeline = '';
    this.customPipelineFallback = '';
    this.currentBitrate = null;

    const pythonPath = logpaths.getPythonPath()
    this.deviceStream = spawn(pythonPath, args)
    this.setupStreamEvents('Streaming', callback);

    // Start MAVLink heartbeats if enabled
    if (this.useCameraHeartbeat) {
      this.startHeartbeatInterval();
      this.sendVideoStreamInformation(null, minimal.MavComponent.CAMERA, null);
    }
  }

  // Best-effort create the media destination directory and append the
  // --destination arg for photovideo.py.
  _ensureAndPushDest(args: string[], dest: string) {
    /* istanbul ignore else -- toAbsolutePath() always returns a non-empty string */
    if (dest) {
      try {
        fs.mkdirSync(dest, { recursive: true });
        console.log('Ensured media directory exists:', dest);
      } catch (e) {
        console.error('Failed to create media directory:', dest, e);
      }
      args.push('--destination=' + dest);
    }
  }

  startPhotoMode(callback: any) {
    if (!this.stillSettings) return callback(new Error('No still settings provided'));

    const dest = this.toAbsolutePath(this.stillSettings.mediaDestination);

    const args = [
      '-u', // force the stdout and stderr streams to be unbuffered
      './python/photovideo.py',
      '--mode=photo'
    ];
    if (this.stillSettings.device) args.push('--device=' + this.stillSettings.device);
    if (this.stillSettings.width) args.push('--width=' + this.stillSettings.width);
    if (this.stillSettings.height) args.push('--height=' + this.stillSettings.height);
    this._ensureAndPushDest(args, dest);

    const pythonPath = logpaths.getPythonPath()
    this.deviceStream = spawn(pythonPath, args)
    this.setupStreamEvents('Photo Mode', callback);

    // Start MAVLink heartbeats if enabled
    if (this.useCameraHeartbeat) {
      this.startHeartbeatInterval();
      this.sendCameraInformation(null, minimal.MavComponent.CAMERA, null);
    }
  }

  startVideoMode(callback: any) {
    if (!this.videoSettings) return callback(new Error('No video settings provided'));

    const dest = this.toAbsolutePath(this.videoSettings.mediaDestination);

    // Convert bitrate from kbps to bps Picamera2
    const bitrateBps = this.videoSettings.bitrate * 1000;

    const args = [
      '-u', // force the stdout and stderr streams to be unbuffered
      './python/photovideo.py',
      '--mode=video',
      '--device=' + this.videoSettings.device,
      '--width=' + this.videoSettings.width,
      '--height=' + this.videoSettings.height,
      '--fps=' + this.videoSettings.fps,
      '--bitrate=' + bitrateBps,
      '--rotation=' + this.videoSettings.rotation,
      '--format=' + this.videoSettings.format
    ];

    this._ensureAndPushDest(args, dest);

    const pythonPath = logpaths.getPythonPath()
    this.deviceStream = spawn(pythonPath, args)
    this.setupStreamEvents('Video Mode', callback);

    // Start MAVLink heartbeats if enabled
    if (this.useCameraHeartbeat) {
      this.startHeartbeatInterval();
      this.sendCameraInformation(null, minimal.MavComponent.CAMERA, null);
    }
  }

  setupStreamEvents(modeName: string, callback: any) {
    let callbackCalled = false;
    let stdoutBuffer = ''; // Buffer for accumulating data chunks

    // Importing cv2 and Picamera2 on a Pi can take a minute or more
    // Safety Timeout: If nothing happens in 90 seconds, unblock the UI
    const timeout = setTimeout(() => {
      /* istanbul ignore else -- callbackCalled is always false when timeout fires (clearTimeout prevents double-fire) */
      if (!callbackCalled) {
        callbackCalled = true;
        console.log(`${modeName}: No response from script after 60s, assuming start.`);
        this.active = true;
        this.saveSettings();
        callback(null, { active: true, addresses: this.deviceAddresses });
      }
    }, 90000);

    this.deviceStream.on('error', (err: Error) => {
      clearTimeout(timeout);
      console.error(`Failed to spawn ${modeName}:`, err);
      if (!callbackCalled) {
        callbackCalled = true;
        callback(err);
      }
    });

    // Listen continuously until we hear "Camera is ready"
    // or in streaming mode
    this.deviceStream.stdout.on('data', (data: Buffer) => {

      const chunk = data.toString();
      stdoutBuffer += chunk;

      // Detect the video recording start/stop messages from photovideo.py and update the recording flag
      const lower = chunk.toLowerCase();
      // start patterns printed by photovideo.py:
      // "Picamera2 recording started to <path>"
      // "V4L2 recording started to <path>"
      // also generic "recording started"
      if (lower.includes('recording started')) {
        this.setRecordingFlag(true);
        console.log('Detected recorder START; isRecording=true');
      }
      // stop patterns printed by photovideo.py:
      // "Picamera2 recording stopped."
      // "V4L2 recording stopped."
      // also generic "recording stopped"
      if (lower.includes('recording stopped')) {
        this.setRecordingFlag(false);
        console.log('Detected recorder STOP; isRecording=false');
      }

      // capture the actually-used pipeline and any custom-pipeline fallback
      // markers printed by video-server.py
      const pipelineMatch = chunk.match(/^PIPELINE:(.+)$/m);
      if (pipelineMatch) {
        this.lastPipeline = pipelineMatch[1].trim();
      }
      const fallbackMatch = chunk.match(/^CUSTOM-PIPELINE-FALLBACK:(.+)$/m);
      if (fallbackMatch) {
        this.customPipelineFallback = fallbackMatch[1].trim();
        console.log('Custom pipeline rejected, fell back to generated pipeline: ' + this.customPipelineFallback);
      }

      // runtime bitrate change acknowledgements from video-server.py
      const bitrateMatch = chunk.match(/^BITRATE:(\d+)$/m);
      if (bitrateMatch) {
        this.currentBitrate = parseInt(bitrateMatch[1], 10);
        console.log('Video server acknowledged bitrate change: ' + this.currentBitrate + ' kbps');
      }

      // find file paths printed by photovideo.py
      const re = /to\s+(\S+\.(?:jpg|jpeg|png|h264|mp4|avi))/ig;
      let m;
      while ((m = re.exec(chunk)) !== null) {
        const filepath = m[1];
        this.lastSavedFile = filepath;             // store for API read-after-post fallback
        this.eventEmitter.emit('filesaved', filepath); // internal event
        console.log('Detected saved file:', filepath);
      }

      // Print chunk for debugging immediately
      const chunkTrimmed = chunk.trim();
      if (chunkTrimmed) console.log(`${modeName} chunk: ${chunkTrimmed}`);

      if (!callbackCalled) {
        // For Photo/Video mode (photovideo.py): Wait for "Camera is ready"
        // For Streaming (video-server.py): Wait for any data (assumed ready)

        let isReady = false;

        if (modeName === 'Streaming') {
          isReady = true; // Assuming first output from Gstreamer script means it's running
        } else {
          // photovideo.py prints "Camera is ready in..."
          if (stdoutBuffer.includes("Camera is ready")) {
            isReady = true;
          }
        }

        if (isReady) {
          clearTimeout(timeout);
          console.log(`${modeName} process is fully initialized.`);
          this.active = true;
          this.saveSettings();
          callbackCalled = true;
          callback(null, { active: true, addresses: this.deviceAddresses });
        }
      }
    });

    this.deviceStream.stderr.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.error(`${modeName} error: ${msg}`);
    });

    this.deviceStream.on('close', (code: number | null) => {
      clearTimeout(timeout);
      console.log(`${modeName} exited with code ${code}`);
      this.active = false;
      // Clear the video recording flag (setRecordingFlag persists)
      if (this.videoSettings) {
        this.setRecordingFlag(false);
      }
      if (!callbackCalled) {
        callbackCalled = true;
        callback(new Error(`${modeName} exited immediately (Code: ${code})`));
      }
    });
  }

  stopCamera(callback: any) {
    if (this.intervalObj) {
      clearInterval(this.intervalObj);
      this.intervalObj = null;
    }

    if (this.deviceStream) {
      this.deviceStream.kill('SIGTERM'); // Clean kill
      this.deviceStream = null;
    }

    this.active = false;
    this.settings.setValue('camera.active', false);
    // Clear the video recording flag and persist the current mode's settings.
    if (this.videoSettings) {
      this.setRecordingFlag(false);
    }
    this.saveSettings();

    if (callback) callback(null, false);
  }

  async isUbuntu () {
    // Check if we are running Ubuntu
    let ret
    const data = await si.osInfo()
    if (data.distro.toString().includes('Ubuntu')) {
      console.log('Video Running Ubuntu')
      ret = true
    } else {
      ret = false
    }
    return ret
  }

  getStreamingStatus () {
    // return the current streaming status
    if (this.active) {
      if (this.cameraMode === 'streaming') {
        return 'Camera is streaming video'
      } else if (this.cameraMode === 'photo') {
        return 'Camera is active in photo mode'
      } else if (this.cameraMode === 'video' && this.videoSettings.isRecording) {
        return 'Camera is currently recording a video'
      } else if (this.cameraMode === 'video' && !this.videoSettings.isRecording) {
        return 'Camera is active in video mode'
      }
    } else {
      return 'Camera is inactive'
    }
  }

  startHeartbeatInterval () {
    // start the 1-sec loop to send heartbeat events
    this.intervalObj = setInterval(() => {
      const mavType = minimal.MavType.CAMERA
      const autopilot = minimal.MavAutopilot.INVALID
      const component = minimal.MavComponent.CAMERA

      this.eventEmitter.emit('cameraheartbeat', mavType, autopilot, component)
    }, 1000)
  }

  captureStillPhoto(senderSysId: number, senderCompId: number, targetComponent: number, positionData: any = null) {
    console.log('Capturing still photo. Internal state: active=', this.active, 'mode=', this.cameraMode, 'deviceStream exists=', !!this.deviceStream);

    if (!this.active || !this.deviceStream) {
      console.log('Cannot capture photo: camera not active or no deviceStream')
      return
    }

    // Write GPS data to a temporary file for Python to read
    if (positionData) {
      try {
        const gpsPayload = JSON.stringify(positionData);
        fs.writeFileSync('/tmp/rpanion_gps.json', gpsPayload);
        console.log('Wrote GPS data for geotagging:', gpsPayload);
      } catch (e) {
        console.error('Failed to write GPS temp file:', e);
      }
    } else {
      // Clean up old file to prevent stale tags
      if (fs.existsSync('/tmp/rpanion_gps.json')) {
        fs.unlinkSync('/tmp/rpanion_gps.json');
      }
    }

    // Signal the Python process to capture a photo
    this.deviceStream.kill('SIGUSR1')

    // Build MAVLink CAMERA_TRIGGER packet for geotagging/logging
    const msg = new common.CameraTrigger()
    // Date.now() returns time in milliseconds
    msg.timeUsec = BigInt(Date.now() * 1000)
    // Increment the photo counter
    msg.seq = this.photoSeq++

    this.eventEmitter.emit('digicamcontrol', senderSysId, senderCompId, targetComponent)
    this.eventEmitter.emit('cameratrigger', msg, senderCompId)
  }

  toggleVideoRecording() {
    if (!this.active || !this.deviceStream) {
      console.log('Cannot toggle video - camera not active');
      return;
    }

    console.log('Toggling local video recording via SIGUSR1');
    // Signal the Python process to start or stop the file write
    this.deviceStream.kill('SIGUSR1');
  }

  // Helper to set the isRecording flag by replacing the object
  // instead of mutating the property
  setRecordingFlag(val: boolean) {
    if (this.videoSettings) {
      this.videoSettings = { ...this.videoSettings, isRecording: val };
    }
    // persist unconditionally so callers don't need a redundant saveSettings()
    this.saveSettings();
  }

  // Helper to convert JS strings to the Array<string> format node-mavlink expects for char[]
  toMavChars(str: string, length: number) {
    return vsHelpers.toMavChars(str, length);
  }

  sendCameraInformation(senderSysId: number | null, senderCompId: number, targetComponent: number | null) {
    console.log('Sending MAVLink CameraInformation packet')

    const msg = new common.CameraInformation();

    // Get the camera model name, and handle cases where settings might be null
    let devicePath = "Unknown";
    if (this.cameraMode === 'photo' && this.stillSettings && this.stillSettings.device) {
      devicePath = this.stillSettings.device;
    } else if (this.videoSettings && this.videoSettings.device) {
      devicePath = this.videoSettings.device;
    }

    let extractedModel = "Unknown";
    if (devicePath !== "Unknown") {
      if (devicePath.includes('rtspsource')) {
        extractedModel = "RTSP Source";
      } else if (devicePath.includes('/')) {
        // e.g. /base/soc/i2c0mux/i2c@1/imx219@10 -> imx219
        const parts = devicePath.split('/');
        const leaf = parts[parts.length - 1];
        extractedModel = leaf.split('@')[0];
      } else {
        extractedModel = devicePath;
      }
    }

    msg.vendorName = this.toMavChars("Rpanion", 32);
    msg.modelName = this.toMavChars(extractedModel, 32);
    msg.firmwareVersion = 0;
    msg.focalLength = 0;
    msg.sensorSizeH = 0;
    msg.sensorSizeV = 0;
    msg.lensId = 0;
    msg.camDefinitionVersion = 0;
    msg.camDefinitionUri = ""; // send zero-length string if not known
    msg.gimbalDeviceId = 0;

    // Mode-specific Configuration
    if (this.cameraMode === 'photo') {
      msg.resolutionH = this.stillSettings?.width || 0;
      msg.resolutionV = this.stillSettings?.height || 0;
      msg.flags = 2; // CAMERA_CAP_FLAGS_CAPTURE_IMAGE
    }
    else if (this.cameraMode === 'video') {
      msg.resolutionH = this.videoSettings?.width || 0;
      msg.resolutionV = this.videoSettings?.height || 0;
      msg.flags = 4; // CAMERA_CAP_FLAGS_CAPTURE_VIDEO
    }
    else {
      // Default: streaming
      msg.resolutionH = this.videoSettings?.width || 0;
      msg.resolutionV = this.videoSettings?.height || 0;
      msg.flags = 256; // CAMERA_CAP_FLAGS_HAS_VIDEO_STREAM
    }

    this.eventEmitter.emit('camerainfo', msg, senderSysId, senderCompId, targetComponent);
  }

  sendCameraSettings(senderSysId: number, senderCompId: number, targetComponent: number) {
    console.log('Sending MAVLink CameraSettings packet')

    // build a CAMERA_SETTINGS packet
    const msg = new common.CameraSettings()

    msg.timeBootMs = 0

    // Camera modes: 0 = IMAGE, 1 = VIDEO, 2 = IMAGE_SURVEY
    if (this.cameraMode === 'photo') {
      msg.modeId = 0
    } else {
      msg.modeId = 1
    }

    msg.zoomLevel = null
    msg.focusLevel = null

    this.eventEmitter.emit('camerasettings', msg, senderSysId, senderCompId, targetComponent)
  }

  sendVideoStreamInformation(senderSysId: number | null, senderCompId: number, targetComponent: number | null) {
    console.log('Responding to MAVLink request for VideoStreamInformation')

    // build a VIDEO_STREAM_INFORMATION packet
    const msg = new common.VideoStreamInformation()

    // rpanion only supports a single stream, so streamId and count will always be 1
    msg.streamId = 1
    msg.count = 1

    // msg.type and msg.uri need to be different depending on whether RTP or RTSP is selected
    if (this.videoSettings && this.videoSettings.useUDP) {
      // msg.type = 0 = VIDEO_STREAM_TYPE_RTSP
      // msg.type = 1 = VIDEO_STREAM_TYPE_RTPUDP
      msg.type = 1
      // For RTP, just send the destination UDP port instead of a full URI
      msg.uri = this.videoSettings.useUDPPort.toString();
    } else {
      msg.type = 0
      msg.encoding = this.videoSettings.compression === 'H264' ? 1 : (this.videoSettings.compression === 'H265' ? 2 : 0);

      // Find the address in the list that matches the selected MAVLink interface IP
      // This uses the array populated in populateAddresses() to ensure 1:1 consistency with Web UI
      const matchedAddress = this.deviceAddresses.find((addr: string) =>
        addr.includes(this.videoSettings.mavStreamSelected)
      );

      msg.uri = matchedAddress || "";

    }

    // 1 = VIDEO_STREAM_STATUS_FLAGS_RUNNING
    msg.flags = 1;
    msg.framerate = this.videoSettings.fps;
    msg.resolutionH = this.videoSettings.width;
    msg.resolutionV = this.videoSettings.height;
    msg.bitrate = this.videoSettings.bitrate;
    msg.rotation = this.videoSettings.rotation;
    // Rpanion doesn't collect field of view values, so set to zero
    msg.hfov = 0;
    // Set the stream name (usually the device path)
    msg.name = this.videoSettings.device;

    this.eventEmitter.emit('videostreaminfo', msg, senderSysId, senderCompId, targetComponent)
  }

  onMavPacket(packet: any, data: any) {
    if (packet.header.msgid === common.CommandLong.MSG_ID &&
      data.targetComponent === minimal.MavComponent.CAMERA) {
      if (data._param1 === common.CameraInformation.MSG_ID) {
        console.log('Responding to MAVLink request for CameraInformation')
        this.sendCameraInformation(packet.header.sysid, minimal.MavComponent.CAMERA, packet.header.compid);
      }
      else if (data._param1 === common.VideoStreamInformation.MSG_ID && this.cameraMode === "streaming") {
        console.log('Responding to MAVLink request for VideoStreamInformation')
        this.sendVideoStreamInformation(packet.header.sysid, minimal.MavComponent.CAMERA, packet.header.compid);
      }
      else if (data._param1 === common.CameraSettings.MSG_ID) {
        console.log('Responding to MAVLink request for CameraSettings')
        this.sendCameraSettings(packet.header.sysid, minimal.MavComponent.CAMERA, packet.header.compid)
      }
      // 203 = MAV_CMD_DO_DIGICAM_CONTROL
      else if (data.command === 203) {
        console.log('Received DoDigicamControl command')
        this.captureStillPhoto(packet.header.sysid, minimal.MavComponent.CAMERA, packet.header.compid)
      }
    }
  }
}

export = videoStream
