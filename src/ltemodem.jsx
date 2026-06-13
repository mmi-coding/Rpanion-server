import React from 'react';
import { Form, Button, Table, Alert, Badge } from 'react-bootstrap';
import basePage from './basePage.jsx';
import { HelpTip, HelpSection } from './components/Help.jsx';

import './css/styles.css';

// Baud rates offered for the AT and PPP serial-port selectors
const MODEM_BAUDS = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 3000000];

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    if (!bytes) return '-';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

function stepBadge(pass) {
    if (pass === true) return <Badge bg="success">Pass</Badge>;
    if (pass === false) return <Badge bg="danger">Fail</Badge>;
    return <Badge bg="secondary">Skipped</Badge>;
}

function signalLabel(dbm) {
    if (dbm === null || dbm === undefined) return { text: 'Unknown', variant: 'secondary' };
    if (dbm >= -73) return { text: 'Excellent', variant: 'success' };
    if (dbm >= -85) return { text: 'Good', variant: 'success' };
    if (dbm >= -97) return { text: 'Fair', variant: 'warning' };
    return { text: 'Poor', variant: 'danger' };
}

class LTEModemPage extends basePage {
    constructor(props, useSocketIO = true) {
        super(props, useSocketIO);
        this.state = {
            ...this.state,
            status: {
                enabled: false,
                available: false,
                error: '',
                signal: { raw: 99, dbm: null, percent: 0 },
                registration: 'Unknown',
                registered: false,
                operator: '',
                rat: '',
                band: '',
                ip: '',
                usage: { totalRx: 0, totalTx: 0, sessionRx: 0, sessionTx: 0 },
                lastReconnect: null,
                reconnectCount: 0,
                lastUpdate: null
            },
            config: {
                enabled: false,
                atPort: '/dev/ttyUSB2',
                baud: 115200,
                apn: '',
                netInterface: 'usb0',
                autoReconnect: false,
                pollInterval: 5,
                dataPathMode: 'rndis',
                qmiDevice: '/dev/cdc-wdm0',
                pppPort: '',
                pppBaud: 115200
            },
            serialPorts: [],
            // modem discovery
            scanning: false,
            scanDone: false,
            scanPorts: [],
            scanInterfaces: [],
            // connection test
            testing: false,
            testSteps: [],
            pingHost: '8.8.8.8',
            // AT console
            atCommand: '',
            atLog: [],
            // USB composition switch
            usbMode: 'qmi'
        };

        // Socket.io client for reading in update values
        this.socket.on('LTEStatus', function (msg) {
            this.setState({ status: msg });
        }.bind(this));

        this.socket.on('reconnect', function () {
            // refresh state
            this.componentDidMount();
        }.bind(this));
    }

    componentDidMount() {
        this.fetchConfig();
    }

    fetchConfig = async () => {
        try {
            const response = await fetch('/api/ltemodem', { headers: { Authorization: `Bearer ${this.state.token}` } });
            if (!response.ok) throw new Error('Network response was not ok');
            const data = await response.json();
            this.setState({ config: { ...this.state.config, ...data.settings }, status: data.status, serialPorts: data.serialPorts });
            this.loadDone();
        } catch (error) {
            this.setState({ error: 'Failed to fetch LTE modem config', isLoading: false });
        }
    };

    handleSubmit = async (event) => {
        event.preventDefault();
        try {
            const response = await fetch('/api/ltemodemmodify', {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.state.token}`
                },
                body: JSON.stringify(this.state.config)
            });
            const data = await response.json();
            if (data.error) {
                this.setState({ error: data.error });
            } else {
                this.setState({ error: null, config: { ...this.state.config, ...data.settings } });
            }
        } catch (error) {
            this.setState({ error: 'Failed to save LTE modem settings' });
        }
    };

    // Shared POST for the three modem control buttons (reconnect/connect/disconnect)
    handleModemAction = async (endpoint, label, failMsg) => {
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${this.state.token}` }
            });
            const data = await response.json();
            if (data.error) {
                this.setState({ error: data.error });
            } else {
                this.setState({ error: null, infoMessage: label + ': ' + (data.response || []).join(' ') });
            }
        } catch (error) {
            this.setState({ error: failMsg });
        }
    };

    handleReconnect = () => this.handleModemAction('/api/ltemodemreconnect', 'Reconnect command sent', 'Failed to send reconnect command');

    handleConnect = () => this.handleModemAction('/api/ltemodemconnect', 'Connect command sent', 'Failed to send connect command');

    handleDisconnect = () => this.handleModemAction('/api/ltemodemdisconnect', 'Disconnect command sent', 'Failed to send disconnect command');

    handleUsbMode = async () => {
        try {
            const response = await fetch('/api/ltemodemusbmode', {
                method: 'POST',
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.state.token}` },
                body: JSON.stringify({ mode: this.state.usbMode })
            });
            const data = await response.json();
            if (data.error) {
                this.setState({ error: data.error });
            } else {
                this.setState({ error: null, infoMessage: 'USB mode switch sent. The modem will reboot and re-enumerate in ~30s — then re-scan and reconnect.' });
            }
        } catch (error) {
            this.setState({ error: 'Failed to switch USB mode' });
        }
    };

    handleResetUsage = async () => {
        try {
            const response = await fetch('/api/ltemodemresetusage', {
                method: 'POST',
                headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${this.state.token}` }
            });
            const data = await response.json();
            if (data.status) {
                this.setState({ status: data.status });
            }
        } catch (error) {
            this.setState({ error: 'Failed to reset usage counters' });
        }
    };

    handleDetect = async () => {
        this.setState({ scanning: true, scanDone: false, scanPorts: [], scanInterfaces: [] });
        try {
            const response = await fetch('/api/ltemodemdetect', {
                method: 'POST',
                headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${this.state.token}` }
            });
            const data = await response.json();
            if (data.error) {
                this.setState({ error: data.error, scanning: false });
            } else {
                this.setState({ error: null, scanning: false, scanDone: true, scanPorts: data.ports, scanInterfaces: data.interfaces });
            }
        } catch (error) {
            this.setState({ error: 'Modem scan failed', scanning: false });
        }
    };

    applyPort = (port) => {
        this.setState(prevState => ({
            config: { ...prevState.config, atPort: port.path, baud: port.baud }
        }));
    };

    applyInterface = (name) => {
        this.setState(prevState => ({
            config: { ...prevState.config, netInterface: name }
        }));
    };

    handleConnectionTest = async () => {
        this.setState({ testing: true, testSteps: [] });
        try {
            const response = await fetch('/api/ltemodemtest', {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.state.token}`
                },
                body: JSON.stringify({ pingHost: this.state.pingHost })
            });
            const data = await response.json();
            if (data.error) {
                this.setState({ error: data.error, testing: false });
            } else {
                this.setState({ error: null, testing: false, testSteps: data.steps });
            }
        } catch (error) {
            this.setState({ error: 'Connection test failed to run', testing: false });
        }
    };

    handlePingHostChange = (event) => {
        this.setState({ pingHost: event.target.value });
    };

    handleAtCommandChange = (event) => {
        this.setState({ atCommand: event.target.value });
    };

    handleAtSend = async (event) => {
        event.preventDefault();
        const cmd = this.state.atCommand.trim();
        if (cmd === '') return;
        try {
            const response = await fetch('/api/ltemodemcommand', {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.state.token}`
                },
                body: JSON.stringify({ command: cmd })
            });
            const data = await response.json();
            const lines = data.error ? ['ERROR: ' + data.error] : data.response;
            this.setState(prevState => ({
                atCommand: '',
                atLog: [...prevState.atLog, '> ' + cmd, ...lines].slice(-100)
            }));
        } catch (error) {
            this.setState({ error: 'Failed to send AT command' });
        }
    };

    renderTitle() {
        return "LTE Modem";
    }

    renderContent() {
        const { status, config } = this.state;
        const sig = signalLabel(status.signal ? status.signal.dbm : null);
        return (
            <div>
                <p><i>Status and management of a SimCom SIM7600-series LTE modem.</i></p>
                <HelpSection title="How the modem link works">
                    <p>This page talks to the modem over its <b>AT command port</b> (a serial port) for status,
                        configuration and reconnects. The data connection itself does <b>not</b> go through that
                        port - it runs over the modem&apos;s <b>USB RNDIS network interface</b> (usually <code>usb0</code>),
                        which appears to Linux as an ordinary network device.</p>
                    <ul>
                        <li><b>Do not install ModemManager</b> - it grabs the AT ports and fights this page for them.</li>
                        <li>A SIM7600 on USB exposes several serial ports; the AT port is usually <code>/dev/ttyUSB2</code>.
                            Use <i>Modem discovery</i> below to find it automatically.</li>
                        <li>The modem can also be wired to the Pi&apos;s UART header for AT control, but the data path
                            still needs the USB cable - the UART is far too slow for video.</li>
                    </ul>
                </HelpSection>
                <h2>Status</h2>
                {status.enabled === false &&
                    <Alert variant="secondary">Modem monitoring is disabled. Enable it below.</Alert>
                }
                {status.enabled && status.available === false &&
                    <Alert variant="danger">Modem not responding{status.error !== '' ? ': ' + status.error : ''}</Alert>
                }
                <Table bordered size="sm" style={{ maxWidth: '700px' }}>
                    <tbody>
                        <tr><td>Modem</td><td>{status.available ? <Badge bg="success">Responding</Badge> : <Badge bg="secondary">Not detected</Badge>}</td></tr>
                        <tr><td>Registration</td><td>{status.registration}{status.operator !== '' ? ' - ' + status.operator : ''}</td></tr>
                        <tr><td>Network</td><td>{status.rat}{status.band !== '' ? ' (' + status.band + ')' : ''}</td></tr>
                        <tr><td>Signal</td><td>
                            {status.signal && status.signal.dbm !== null ?
                                <span><Badge bg={sig.variant}>{sig.text}</Badge> {status.signal.dbm} dBm ({status.signal.percent}%)
                                    {status.signal.rsrp !== undefined ? `, RSRP ${status.signal.rsrp} dBm, SINR ${status.signal.sinr} dB` : ''}</span>
                                : 'Unknown'}
                        </td></tr>
                        <tr><td>WAN IP</td><td>{status.ip !== '' ? status.ip : <span>No data connection</span>}</td></tr>
                        <tr><td>Data usage (session)</td><td>RX {formatBytes(status.usage.sessionRx)} / TX {formatBytes(status.usage.sessionTx)}</td></tr>
                        <tr><td>Data usage (total)</td><td>RX {formatBytes(status.usage.totalRx)} / TX {formatBytes(status.usage.totalTx)}{' '}
                            <Button size="sm" variant="outline-secondary" onClick={this.handleResetUsage}>Reset</Button></td></tr>
                        <tr><td>Reconnects</td><td>{status.reconnectCount}{status.lastReconnect ? ' (last: ' + status.lastReconnect + ')' : ''}</td></tr>
                    </tbody>
                </Table>
                <Button onClick={this.handleReconnect} disabled={!status.available} className="btn btn-primary">Reconnect data call</Button>{' '}
                <Button onClick={this.handleConnect} className="btn btn-success">Connect ({config.dataPathMode.toUpperCase()})<HelpTip text="Bring the data call up using the configured data-path mode (RNDIS dials AT$QCRMCALL; QMI runs qmicli; PPP dials pppd)." /></Button>{' '}
                <Button onClick={this.handleDisconnect} variant="secondary" className="btn">Disconnect<HelpTip text="Bring the current data call down (RNDIS AT$QCRMCALL=0; QMI stop-network; PPP poff)." /></Button>

                <h2 style={{ marginTop: '20px' }}>Modem discovery</h2>
                <p><i>Find the connected modem automatically - serial ports and data network interface.</i></p>
                <HelpSection title="What the scan does">
                    <ul>
                        <li>Probes every candidate serial port with an AT handshake: detected USB serial devices,
                            the board&apos;s UART header (<code>/dev/serial0</code>, <code>/dev/ttyAMA*</code>) and the
                            currently configured port. USB ports are tried at one baud (it is ignored there); real
                            UARTs are tried at the common modem bauds.</li>
                        <li>Responders are identified by model/manufacturer; the SIMCOM-identified, lowest-numbered
                            port is <b>recommended</b> (a SIM7600 answers AT on two of its USB ports - either works).</li>
                        <li>The flight controller&apos;s serial link is <b>never probed</b> (shown as <i>Skipped</i>) -
                            AT chatter must not land in the MAVLink stream.</li>
                        <li>Network interfaces are listed with their kernel driver; RNDIS/CDC ones (the modem&apos;s
                            data path) are flagged and recommended.</li>
                        <li>Modem monitoring is paused during the scan and resumes by itself afterwards.
                            <b>Use</b> fills the settings form below - press Save to apply.</li>
                    </ul>
                </HelpSection>
                <Button onClick={this.handleDetect} disabled={this.state.scanning} className="btn btn-primary">
                    {this.state.scanning ? 'Scanning (can take ~20 s)...' : 'Scan for modem'}
                </Button>
                {this.state.scanDone && this.state.scanPorts.filter(p => p.ok).length === 0 &&
                    <Alert variant="warning" style={{ marginTop: '10px' }}>No modem found on any serial port. Check the
                        cabling (USB) or wiring/baud (UART), and that nothing else holds the port (ModemManager must not be installed).</Alert>
                }
                {this.state.scanDone && this.state.scanPorts.length > 0 &&
                    <Table bordered size="sm" style={{ maxWidth: '700px', marginTop: '10px' }}>
                        <thead><tr><th>Port</th><th>Baud</th><th>Modem</th><th>Result</th><th></th></tr></thead>
                        <tbody>
                            {this.state.scanPorts.map((port, idx) => (
                                <tr key={idx}>
                                    <td>{port.path}</td>
                                    <td>{port.ok ? port.baud : '-'}</td>
                                    <td>{port.ok ? ((port.manufacturer || '') + ' ' + (port.model || '')).trim() || 'unidentified' : '-'}</td>
                                    <td>{port.ok ?
                                        <span><Badge bg="success">AT OK</Badge>{port.recommended ? <span> <Badge bg="primary">Recommended</Badge></span> : ''}</span> :
                                        (port.skipped ? <span><Badge bg="secondary">Skipped</Badge> {port.reason}</span> : <Badge bg="secondary">No response</Badge>)}
                                    </td>
                                    <td>{port.ok &&
                                        <Button size="sm" variant="outline-primary" onClick={() => this.applyPort(port)}>Use</Button>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                }
                {this.state.scanDone && this.state.scanInterfaces.length > 0 &&
                    <Table bordered size="sm" style={{ maxWidth: '700px' }}>
                        <thead><tr><th>Network interface</th><th>Driver</th><th>State</th><th>IPv4</th><th></th></tr></thead>
                        <tbody>
                            {this.state.scanInterfaces.map((ifc, idx) => (
                                <tr key={idx}>
                                    <td>{ifc.name}</td>
                                    <td>{ifc.driver || '-'}{ifc.modemLike ? <span> <Badge bg="success">Modem</Badge></span> : ''}
                                        {ifc.recommended ? <span> <Badge bg="primary">Recommended</Badge></span> : ''}</td>
                                    <td>{ifc.operstate || '-'}</td>
                                    <td>{ifc.ipv4 || '-'}</td>
                                    <td><Button size="sm" variant="outline-primary" onClick={() => this.applyInterface(ifc.name)}>Use</Button></td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                }
                {this.state.scanDone &&
                    <p><small className="form-text text-muted">No modem-driver network interface
                        usually means the modem is not in RNDIS mode (<code>AT+CUSBPIDSWITCH=9011,1,1</code>) or is connected by UART only
                        (the UART carries AT control; data needs the USB cable).</small></p>
                }

                <h2 style={{ marginTop: '20px' }}>Settings</h2>
                <Form onSubmit={this.handleSubmit}>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <label className="col-sm-3 col-form-label">Enable modem monitoring<HelpTip text="Poll the modem over its AT port for signal, registration and data-call status. The discovery scan and connection test work even with this off" /></label>
                        <div className="col-sm-8">
                            <input type="checkbox" name="enabled" checked={config.enabled} onChange={this.handleConfigChange} style={{ marginTop: '12px' }} />
                        </div>
                    </div>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <label className="col-sm-3 col-form-label">Data path mode<HelpTip text="How the modem carries IP data. RNDIS: the modem's built-in USB network device (usb0), no extra packages. QMI: libqmi (qmicli) drives a wwan0 interface - never ModemManager. PPP: pppd dials *99# over the serial port (slowest, last resort). Takes effect on the next Connect." /></label>
                        <div className="col-sm-8">
                            <Form.Select name="dataPathMode" value={config.dataPathMode} onChange={this.handleConfigChange}>
                                <option value="rndis">RNDIS (usb0)</option>
                                <option value="qmi">QMI (wwan0)</option>
                                <option value="ppp">PPP (ppp0)</option>
                            </Form.Select>
                        </div>
                    </div>
                    {config.dataPathMode === 'qmi' && (
                        <div className="form-group row" style={{ marginBottom: '5px' }}>
                            <label className="col-sm-3 col-form-label">QMI control device<HelpTip text="The libqmi control device, usually /dev/cdc-wdm0. Set the data network interface to wwan0 for QMI." /></label>
                            <div className="col-sm-8">
                                <Form.Control type="text" name="qmiDevice" value={config.qmiDevice} onChange={this.handleConfigChange} />
                            </div>
                        </div>
                    )}
                    {config.dataPathMode === 'ppp' && (
                        <div>
                            <div className="form-group row" style={{ marginBottom: '5px' }}>
                                <label className="col-sm-3 col-form-label">PPP port<HelpTip text="Serial port pppd dials on. Leave blank to use the AT port. Must NOT be the flight-controller UART - the server refuses to dial it. Set the data network interface to ppp0 for PPP." /></label>
                                <div className="col-sm-8">
                                    <Form.Control type="text" name="pppPort" value={config.pppPort} onChange={this.handleConfigChange} placeholder="defaults to the AT port" />
                                </div>
                            </div>
                            <div className="form-group row" style={{ marginBottom: '5px' }}>
                                <label className="col-sm-3 col-form-label">PPP baud<HelpTip text="Serial speed for the pppd dial. SIM7600 default 115200." /></label>
                                <div className="col-sm-8">
                                    <Form.Select name="pppBaud" value={config.pppBaud} onChange={this.handleConfigChange}>
                                        {MODEM_BAUDS.map((b) => (
                                            <option key={b} value={b}>{b}</option>
                                        ))}
                                    </Form.Select>
                                </div>
                            </div>
                        </div>
                    )}
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <label className="col-sm-3 col-form-label">AT command port<HelpTip text="Serial port carrying AT commands - usually /dev/ttyUSB2 on a SIM7600 over USB, or the UART device if wired to the GPIO header. Must not be held by anything else (ModemManager, mavlink-router). The discovery scan finds it for you" /></label>
                        <div className="col-sm-8">
                            <Form.Control type="text" name="atPort" value={config.atPort} onChange={this.handleConfigChange} list="serialports" />
                            <datalist id="serialports">
                                {this.state.serialPorts.map((port, idx) => (
                                    <option key={idx} value={port.path}>{port.label}</option>
                                ))}
                            </datalist>
                        </div>
                    </div>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <label className="col-sm-3 col-form-label">Baud rate<HelpTip text="Serial speed of the AT port. Ignored on USB ports; for a UART it must match the modem's setting (SIM7600 default 115200)" /></label>
                        <div className="col-sm-8">
                            <Form.Select name="baud" value={config.baud} onChange={this.handleConfigChange}>
                                {MODEM_BAUDS.map((b) => (
                                    <option key={b} value={b}>{b}</option>
                                ))}
                            </Form.Select>
                        </div>
                    </div>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <label className="col-sm-3 col-form-label">APN<HelpTip text="Your carrier's access point name. Applied before a reconnect (AT+CGDCONT); leave empty to keep the modem's stored APN" /></label>
                        <div className="col-sm-8">
                            <Form.Control type="text" name="apn" value={config.apn} onChange={this.handleConfigChange} placeholder="carrier APN (optional)" />
                        </div>
                    </div>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <label className="col-sm-3 col-form-label">Data network interface<HelpTip text="The modem's RNDIS network device, usually usb0. Used for data usage accounting and the connection test. The discovery scan lists candidates" /></label>
                        <div className="col-sm-8">
                            <Form.Control type="text" name="netInterface" value={config.netInterface} onChange={this.handleConfigChange} />
                        </div>
                    </div>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <label className="col-sm-3 col-form-label">Auto-reconnect<HelpTip text="Restart the data call automatically when the modem is registered to the network but has no IP address (dropped session)" /></label>
                        <div className="col-sm-8">
                            <input type="checkbox" name="autoReconnect" checked={config.autoReconnect} onChange={this.handleConfigChange} style={{ marginTop: '12px' }} />
                        </div>
                    </div>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <label className="col-sm-3 col-form-label">Poll interval (s)<HelpTip text="How often the modem is polled for status. 5 s is a good default; longer intervals reduce AT-port traffic" /></label>
                        <div className="col-sm-8">
                            <Form.Control type="number" name="pollInterval" value={config.pollInterval} onChange={this.handleConfigChange} min={2} max={120} />
                        </div>
                    </div>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <div className="col-sm-11">
                            <Button type="submit" className="btn btn-primary">Save</Button>
                        </div>
                    </div>
                </Form>

                <h2 style={{ marginTop: '20px' }}>USB composition<HelpTip text="Switch the modem's USB mode and REBOOT it (~30s; ports re-enumerate). QMI (cdc-wdm0/wwan0) is recommended; RNDIS exposes usb0. After switching, change the Data path mode to match, re-scan and reconnect." /></h2>
                <div className="form-group row" style={{ marginBottom: '5px' }}>
                    <div className="col-sm-4">
                        <Form.Select name="usbMode" value={this.state.usbMode} onChange={(e) => this.setState({ usbMode: e.target.value })}>
                            <option value="qmi">QMI (cdc-wdm0 / wwan0)</option>
                            <option value="rndis">RNDIS (usb0)</option>
                        </Form.Select>
                    </div>
                    <div className="col-sm-6">
                        <Button variant="warning" onClick={this.handleUsbMode}>Switch USB mode &amp; reboot modem</Button>
                    </div>
                </div>

                <h2>Connection test</h2>
                <p><i>Check the whole modem chain end-to-end, with a per-step diagnosis.</i></p>
                <HelpSection title="What gets tested">
                    <p>Eight steps, in dependency order: AT port opens → modem identifies → SIM present →
                        signal level → network registration + operator → data call has a PDP address →
                        network interface up with an IPv4 address → <b>ping through the modem&apos;s
                        interface</b> (not the default route - with a VPN up, a plain ping would test the
                        tunnel instead of the modem).</p>
                    <ul>
                        <li><i>Skipped</i> means a prerequisite failed, not that the step is broken -
                            fix the first red step and re-run.</li>
                        <li>Failure details include the usual fixes (RNDIS mode switch, APN, UART-vs-USB wiring).</li>
                        <li>Works with monitoring disabled - the test opens and releases the AT port itself.</li>
                        <li>The ping target is configurable; the default 8.8.8.8 only needs internet reachability.</li>
                    </ul>
                </HelpSection>
                <Form onSubmit={(e) => { e.preventDefault(); this.handleConnectionTest(); }}>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <div className="col-sm-3">
                            <Button onClick={this.handleConnectionTest} disabled={this.state.testing} className="btn btn-primary">
                                {this.state.testing ? 'Testing...' : 'Run connection test'}
                            </Button>
                        </div>
                        <label className="col-sm-2 col-form-label" style={{ textAlign: 'right' }}>Ping target</label>
                        <div className="col-sm-3">
                            <Form.Control type="text" value={this.state.pingHost} onChange={this.handlePingHostChange} />
                        </div>
                    </div>
                </Form>
                {this.state.testSteps.length > 0 &&
                    <Table bordered size="sm" style={{ maxWidth: '700px', marginTop: '10px' }}>
                        <thead><tr><th>Step</th><th>Result</th><th>Detail</th></tr></thead>
                        <tbody>
                            {this.state.testSteps.map((step, idx) => (
                                <tr key={idx}>
                                    <td>{step.name}</td>
                                    <td>{stepBadge(step.pass)}</td>
                                    <td>{step.detail}</td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                }

                <h2>AT console</h2>
                <p><i>Send raw AT commands to the modem (e.g. <code>AT+CPIN?</code>, <code>AT+CPSI?</code>). Only available while monitoring is enabled.</i></p>
                {this.state.atLog.length > 0 &&
                    <pre style={{ maxHeight: '200px', overflowY: 'auto', backgroundColor: '#f8f9fa', padding: '8px', fontSize: '0.85em' }}>
                        {this.state.atLog.join('\n')}
                    </pre>
                }
                <Form onSubmit={this.handleAtSend}>
                    <div className="form-group row">
                        <div className="col-sm-6">
                            <Form.Control type="text" style={{ fontFamily: 'monospace' }} value={this.state.atCommand}
                                onChange={this.handleAtCommandChange} placeholder="AT" disabled={!status.available} />
                        </div>
                        <div className="col-sm-2">
                            <Button type="submit" className="btn btn-secondary" disabled={!status.available}>Send</Button>
                        </div>
                    </div>
                </Form>
            </div>
        );
    }
}

export default LTEModemPage;
