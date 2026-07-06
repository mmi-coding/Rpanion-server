/*
    * PPPConnection.js
    * This module manages a PPP connection using pppd.
    * It allows setting device, baud rate, local and remote IPs,
    * starting and stopping the PPP connection, and retrieving data transfer stats.
    * Used for the PPP feature in ArduPilot
*/
const { spawn, execSync, execFileSync } = require('child_process');
const serialDetection = require('./serialDetection')

// Escape a device path so it can be embedded literally in a pkill -f (ERE) pattern.
const escapeRegexForPkill = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

class PPPConnection {
  isQuitting: any
  devices: any
  isManualStop: any
  prevdata: any
  badbaudRate: any
  serialDevices: any
  baudRates: any
  remoteIP: any
  localIP: any
  baudRate: any
  device: any
  pppProcess: any
  isConnected: any
  settings: any
  pppDevicePath: any
  reconnectTimer: any
  reconnectAttempts: any
  reconnectBaseMs: any
  reconnectMaxMs: any
  reconnectDelayMs: any
    constructor(settings: any) {
        this.settings = settings
        this.isConnected = this.settings.value('ppp.enabled', false);
        this.pppProcess = null;
        this.device = this.settings.value('ppp.uart', null);
        this.baudRate = this.settings.value('ppp.baud', 921600)
        this.localIP = this.settings.value('ppp.localIP', '192.168.144.14');  // default local IP
        this.remoteIP = this.settings.value('ppp.remoteIP', '192.168.144.15'); // default remote IP
        this.baudRates = [
            { value: 115200, label: '115200' },
            { value: 230400, label: '230400' },
            { value: 460800, label: '460800' },
            { value: 921600, label: '921600' },
            { value: 1500000, label: '1.5 MBaud' },
            { value: 2000000, label: '2 MBaud' },
            { value: 12500000, label: '12.5 MBaud' }];
        this.serialDevices = [];
        this.badbaudRate = false; // flag to indicate if the baud rate is not supported
        this.prevdata = null; // previous data for comparison
        this.isQuitting  = false;
        this.isManualStop = false; // flag to distinguish manual stop from process crash
        // Reconnect-on-unexpected-exit state. pppDevicePath is the resolved serial
        // path of the pppd *this* module spawned, so we can SIGTERM only our own
        // pppd and never the LTE modem's own pppd (R13). The backoff timer restarts
        // the link if pppd dies unexpectedly (R13).
        this.pppDevicePath = null;
        this.reconnectTimer = null;
        this.reconnectAttempts = 0;
        this.reconnectBaseMs = 1000;   // first reconnect delay
        this.reconnectMaxMs = 30000;   // backoff ceiling (matches the modem reconnect window)
        this.reconnectDelayMs = 0;     // last computed delay (exposed for status/tests)

        if (this.isConnected) {
            // populate serial devices list and start PPP connection
            this.getDevices((err: Error | null, devices: any[]) => {
                this.devices = devices;
                const attemptPPPStart = () => {
                    this.startPPP(this.device, this.baudRate, this.localIP, this.remoteIP, (err: Error | null, result: any) => {
                        if (err) {
                            if (err.message.includes('already connected')) {
                                console.log('PPP connection is already established. Retrying in 1 second...');
                                this.isConnected = false;
                                this.setSettings();
                                setTimeout(attemptPPPStart, 1000); // Retry after 1 second
                            } else {
                                console.error('Error starting PPP connection:', err);
                                this.isConnected = false;
                                this.setSettings();
                            }
                        } else {
                            console.log('PPP connection started successfully');
                        }
                    });
                };

                attemptPPPStart();
            });
        }
    }

    setSettings() {
        this.settings.setValue('ppp.uart', this.device);
        this.settings.setValue('ppp.baud', this.baudRate);
        this.settings.setValue('ppp.localIP', this.localIP);
        this.settings.setValue('ppp.remoteIP', this.remoteIP);
        this.settings.setValue('ppp.enabled', this.isConnected);
    }

    quitting() {
        // stop the PPP connection if rpanion is quitting
        this.isQuitting = true;
        this._cancelReconnect();
        if (this.pppProcess) {
            console.log('Stopping PPP connection on quit...');
            // Remove all event listeners to prevent close handler from firing
            this.pppProcess.removeAllListeners();
            this.pppProcess.kill();
            this.pppProcess = null;
            try {
                // Kill ONLY the pppd we started (scoped by its device path), never the
                // LTE modem's own pppd; then give it a moment to release the port.
                this._killScopedPppd();
                execSync('sleep 1');
            } catch (error) {
                console.error('Error stopping PPP connection on shutdown:', error);
            }
        }
    }

    // SIGTERM only the pppd this module spawned, matched by its device path, so a
    // system-wide `pkill pppd` can never take down the LTE modem's own pppd (R13).
    // No-op (never a system-wide kill) if we never recorded a device path.
    _killScopedPppd() {
        if (!this.pppDevicePath) {
            return;
        }
        const pattern = 'pppd ' + escapeRegexForPkill(this.pppDevicePath);
        // argv form (no shell) — the device path can never be interpreted as a command.
        execFileSync('sudo', ['pkill', '-SIGTERM', '-f', pattern]);
    }

    // Schedule a reconnect attempt with exponential backoff (capped). Guarded so it
    // never fires during shutdown or after an operator-initiated stop, and never
    // stacks more than one pending timer (R13).
    _scheduleReconnect() {
        if (this.isQuitting || this.isManualStop) {
            return;
        }
        if (this.reconnectTimer) {
            return;
        }
        const delay = Math.min(this.reconnectBaseMs * Math.pow(2, this.reconnectAttempts), this.reconnectMaxMs);
        this.reconnectDelayMs = delay;
        this.reconnectAttempts += 1;
        console.log(`PPP: scheduling reconnect attempt ${this.reconnectAttempts} in ${delay} ms`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.startPPP(this.device, this.baudRate, this.localIP, this.remoteIP, (err: Error | null) => {
                if (err) {
                    console.error('PPP reconnect attempt failed:', err.message);
                    this._scheduleReconnect();
                } else {
                    console.log('PPP reconnect: link re-established');
                }
            });
        }, delay);
    }

    // Cancel any pending reconnect timer (operator stop / shutdown / fresh start).
    _cancelReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    // Common child-exit path for both the 'close' and 'error' events. On an
    // unexpected death (not a shutdown, operator stop, or signal termination) mark
    // the link down and start the backoff reconnect (R13).
    _handleChildExit(isSignalTermination: boolean) {
        const expected = this.isQuitting || this.isManualStop || isSignalTermination;
        this.pppProcess = null;
        this.isManualStop = false;
        if (!expected) {
            this.isConnected = false;
            this.setSettings();
            this._scheduleReconnect();
        }
    }

    async getDevices (callback: (err: Error | null, devices: any[]) => void) {
        // get all serial devices using hardwareDetection module
        try {
            this.serialDevices = await serialDetection.detectSerialDevices()
            return callback(null, this.serialDevices);
        } catch (error) {
            console.error('Error detecting serial devices:', error)
            return callback(error, []);
        }
    }

    // The settings/status object returned to the UI by every PPP entry point.
    // Pass overrides for the error case (e.g. { selDevice: null, serialDevices: [] }).
    _stateSnapshot(overrides = {}) {
        return {
            selDevice: this.device,
            selBaudRate: this.baudRate,
            localIP: this.localIP,
            remoteIP: this.remoteIP,
            enabled: this.isConnected,
            baudRates: this.baudRates,
            serialDevices: this.serialDevices,
            ...overrides,
        };
    }

    startPPP(device: string, baudRate: number, localIP: string, remoteIP: string, callback: (err: Error | null, result: any) => void) {
        this.badbaudRate = false;
        if (this.isConnected) {
            return callback(new Error('PPP is already connected'), this._stateSnapshot());
        }
        if (!device) {
            return callback(new Error('Device is required'), this._stateSnapshot());
        }
        if (this.pppProcess) {
            return callback(new Error('PPP still running. Please wait for it to finish.'), this._stateSnapshot());
        }

        //ensure device string is valid in the serialdevices list
        const devicePath = serialDetection.getSerialPathFromValue(device, this.serialDevices);
        if (!devicePath) {
            return callback(new Error('Invalid device selected'), this._stateSnapshot());
        }

        this.device = device;
        this.baudRate = baudRate;
        this.localIP = localIP;
        this.remoteIP = remoteIP;
        this.pppDevicePath = devicePath; // remember which pppd is ours (scoped kill)
        // A fresh start supersedes any pending reconnect timer.
        this._cancelReconnect();

        const args = [
            "pppd",
            devicePath,
            this.baudRate, // baud rate
            //'persist',          // enables faster termination
            //'holdoff', '1',     // minimum delay of 1 second between connection attempts
            this.localIP + ':' + this.remoteIP, // local and remote IPs
            'local',
            'noauth',
            //'debug',
            'crtscts',
            'nodetach',
            'ktune'
        ];
        // if running in dev env, need to preload sudo login
        if (process.env.NODE_ENV === 'development') {
            execSync('sudo -v');
        }
        console.log(`Starting PPP with args: ${args.join(' ')}`);
        this.pppProcess = spawn('sudo', args, {
        //detached: true,
        stdio: ['ignore', 'pipe', 'pipe'] // or 'ignore' for all three to fully detach
        });
        // Without this listener, a spawn failure (ENOENT / EACCES / fork failure
        // under memory pressure on a Pi Zero 2 W) emits an 'error' event with no
        // handler, which Node re-throws as an uncaught exception → whole-process
        // crash → link blackout (R3). Route it through the shared exit handler so a
        // failed spawn triggers the same backoff reconnect as an unexpected death.
        this.pppProcess.on('error', (err: Error) => {
            console.error('PPP process error (failed to start or crashed):', err);
            this._handleChildExit(false);
        });
        this.pppProcess.stdout.on('data', (data: Buffer) => {
            console.log("PPP Output: ", data.toString().trim());
            // Check for non support baud rates "speed <baud> not supported"
            if (data.toString().includes('speed') && data.toString().includes('not supported')) {
                this.pppProcess.kill();
                this.pppProcess = null; // reset the process reference
                this.isConnected = false;
                this.badbaudRate = true;
            }
        });
        this.pppProcess.stderr.on('data', (data: Buffer) => {
            console.log("PPP Error: ", data.toString().trim());
        });
        this.pppProcess.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
            console.log(`PPP process exited with code: ${code}, signal: ${signal} (isQuitting: ${this.isQuitting}, isManualStop: ${this.isManualStop})`);
            // Don't treat signal-based terminations as unexpected (code 5 is typical for SIGTERM/SIGINT)
            // These usually happen during application shutdown when Ctrl+C is pressed
            const isSignalTermination = signal !== null || code === 5 || code === 2;
            this._handleChildExit(isSignalTermination);
        });
        this.isConnected = true;
        this.setSettings();
        return callback(null, this._stateSnapshot());
    }

    stopPPP(callback: (err: Error | null, result: any) => void) {
        // An operator stop always cancels any in-flight reconnect and resets backoff,
        // even mid-reconnect (when isConnected is briefly false), so the loop can be
        // halted from the UI.
        this._cancelReconnect();
        this.reconnectAttempts = 0;
        if (!this.isConnected) {
            return callback(new Error('PPP is not connected'), this._stateSnapshot());
        }
        if (this.pppProcess) {
            // Gracefully kill the PPP process
            console.log('Stopping PPP connection...');
            // Set flag to prevent the close event handler from updating state
            this.isManualStop = true;
            this.pppProcess.kill();
            try {
                // Kill only our pppd (scoped by device path), never the modem's own pppd.
                this._killScopedPppd();
            } catch (error: any) {
                console.error('Error stopping PPP connection:', error);
            }
            this.isConnected = false;
            this.setSettings();
        }
        return callback(null, this._stateSnapshot());
    }

    getPPPSettings(callback: (err: Error | null, result: any) => void) {
        this.getDevices((err: Error | null, devices: any[]) => {
            if (err) {
                console.error('Error fetching serial devices:', err);
                return callback(err, this._stateSnapshot({ selDevice: null, serialDevices: [] }));
            }
            
            this.serialDevices = devices;
            
            // Set default device if not already set
            if (!this.device && this.serialDevices.length > 0) {
                this.device = this.serialDevices[0].value;
            }
            
            // if this.device is not in the list, set it to first available device
            // (guard the empty-list case: a stale device with no ports detected
            //  must not index into serialDevices[0])
            if (this.device && this.serialDevices.length > 0 && !this.serialDevices.some((d: any) => d.value === this.device)) {
                this.device = this.serialDevices[0].value;
            }
            
            // Always return callback
            return callback(null, this._stateSnapshot());
        });
    }

    // uses ifconfig to get the PPP connection datarate
    getPPPDataRate() {
        if (!this.isConnected) {
            return { rxRate: 0, txRate: 0, percentusedRx: 0, percentusedTx: 0 };
        }
        // get current data transfer stats for connected PPP session
        try {
            const stdout = execSync('ifconfig ppp0 | grep packets', { encoding: 'utf8' }).toString().trim();
            /* istanbul ignore next - grep exits 1 (throws) when no lines match; stdout is never empty here */
            if (!stdout) {
                return { rxRate: 0, txRate: 0, percentusedRx: 0, percentusedTx: 0 };
            }
            // match format :
            //        RX packets 0  bytes 0 (0.0 B)
            //        TX packets 118  bytes 12232 (12.2 KB)
            const [ , matchRX, matchTX ] = stdout.match(/RX\s+packets\s+\d+\s+bytes\s+(\d+).*TX\s+packets\s+\d+\s+bytes\s+(\d+)/s);
            /* istanbul ignore else - regex destructuring throws TypeError on null match before reaching else; unreachable */
            if (matchRX && matchTX) {
                const rxBytes = parseInt(matchRX);
                const txBytes = parseInt(matchTX);
                // calculate the data rate in bytes per second
                if (this.prevdata) {
                    const elapsed = Date.now() - this.prevdata.timestamp; // in milliseconds
                    const rxRate = (rxBytes - this.prevdata.rxBytes) / (elapsed / 1000); // bytes per second
                    const txRate = (txBytes - this.prevdata.txBytes) / (elapsed / 1000); // bytes per second
                    const percentusedRx = rxRate / (this.baudRate / 8); // percent of baud rate used
                    const percentusedTx = txRate / (this.baudRate / 8); // percent of baud rate used
                    this.prevdata = { rxBytes, txBytes, timestamp: Date.now() };
                    return { rxRate, txRate, percentusedRx, percentusedTx };
                }
                this.prevdata = { rxBytes, txBytes, timestamp: Date.now() };
                return { rxRate: 0, txRate: 0, percentusedRx: 0, percentusedTx: 0 };
            } else {
                return { rxRate: 0, txRate: 0, percentusedRx: 0, percentusedTx: 0};
            }
        } catch (error) {
            console.error('Error getting PPP data rate:', error.message);
            return { rxRate: 0, txRate: 0, percentusedRx: 0, percentusedTx: 0 };
        }
    }

    // Returns a string representation of the PPP connection status for use by socket.io
    conStatusStr () {
        //format the connection status string
        if (this.badbaudRate) {
            return 'Disconnected (Baud rate not supported)';
        }
        if (!this.isConnected) {
            return 'Disconnected';
        }
        if (this.pppProcess && this.pppProcess.pid) {
            //get datarate
            const { rxRate, txRate, percentusedRx, percentusedTx } = this.getPPPDataRate();
            // outer guard already requires a truthy pid
            let status = `Connected (PID: ${this.pppProcess.pid})`;
            if (rxRate > 0 || txRate > 0) {
                status += `, RX: ${rxRate.toFixed(2)} B/s (${(percentusedRx * 100).toFixed(2)}%), TX: ${txRate.toFixed(2)} B/s (${(percentusedTx * 100).toFixed(2)}%)`;
            } else {
                status += ', No data transfer';
            }
            return status;
        }
        else {
            return 'Disconnected';
        }
    }
}


export = PPPConnection;