import React from 'react';
import { Form, Button, Table, Alert, Badge } from 'react-bootstrap';
import basePage from './basePage.jsx';

import './css/styles.css';

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    if (!bytes) return '-';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
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
                pollInterval: 5
            },
            serialPorts: [],
            // AT console
            atCommand: '',
            atLog: []
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
            this.setState({ config: data.settings, status: data.status, serialPorts: data.serialPorts });
            this.loadDone();
        } catch (error) {
            this.setState({ error: 'Failed to fetch LTE modem config', isLoading: false });
        }
    };

    handleConfigChange = (event) => {
        const name = event.target.name;
        const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
        this.setState(prevState => ({
            config: {
                ...prevState.config,
                [name]: value
            }
        }));
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
                this.setState({ error: null, config: data.settings });
            }
        } catch (error) {
            this.setState({ error: 'Failed to save LTE modem settings' });
        }
    };

    handleReconnect = async () => {
        try {
            const response = await fetch('/api/ltemodemreconnect', {
                method: 'POST',
                headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${this.state.token}` }
            });
            const data = await response.json();
            if (data.error) {
                this.setState({ error: data.error });
            } else {
                this.setState({ error: null, infoMessage: 'Reconnect command sent: ' + (data.response || []).join(' ') });
            }
        } catch (error) {
            this.setState({ error: 'Failed to send reconnect command' });
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
                <p><i>Status and management of a SimCom SIM7600-series LTE modem over its AT command port.
                    The data connection itself runs over the modem&apos;s USB RNDIS network interface - do not install ModemManager.</i></p>
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
                <Button onClick={this.handleReconnect} disabled={!status.available} className="btn btn-primary">Reconnect data call</Button>

                <h2 style={{ marginTop: '20px' }}>Settings</h2>
                <Form onSubmit={this.handleSubmit}>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <label className="col-sm-3 col-form-label">Enable modem monitoring</label>
                        <div className="col-sm-8">
                            <input type="checkbox" name="enabled" checked={config.enabled} onChange={this.handleConfigChange} style={{ marginTop: '12px' }} />
                        </div>
                    </div>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <label className="col-sm-3 col-form-label">AT command port</label>
                        <div className="col-sm-8">
                            <Form.Control type="text" name="atPort" value={config.atPort} onChange={this.handleConfigChange} list="serialports" />
                            <datalist id="serialports">
                                {this.state.serialPorts.map((port, idx) => (
                                    <option key={idx} value={port.path}>{port.label}</option>
                                ))}
                            </datalist>
                            <small className="form-text text-muted">SIM7600 USB: usually /dev/ttyUSB2. Must not be in use by ModemManager or mavlink-router</small>
                        </div>
                    </div>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <label className="col-sm-3 col-form-label">Baud rate</label>
                        <div className="col-sm-8">
                            <Form.Select name="baud" value={config.baud} onChange={this.handleConfigChange}>
                                {[9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 3000000].map((b) => (
                                    <option key={b} value={b}>{b}</option>
                                ))}
                            </Form.Select>
                        </div>
                    </div>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <label className="col-sm-3 col-form-label">APN</label>
                        <div className="col-sm-8">
                            <Form.Control type="text" name="apn" value={config.apn} onChange={this.handleConfigChange} placeholder="carrier APN (optional)" />
                            <small className="form-text text-muted">Set before a reconnect via AT+CGDCONT. Leave empty to keep the modem&apos;s stored APN</small>
                        </div>
                    </div>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <label className="col-sm-3 col-form-label">Data network interface</label>
                        <div className="col-sm-8">
                            <Form.Control type="text" name="netInterface" value={config.netInterface} onChange={this.handleConfigChange} />
                            <small className="form-text text-muted">The RNDIS network device, usually usb0. Used for data usage accounting</small>
                        </div>
                    </div>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <label className="col-sm-3 col-form-label">Auto-reconnect</label>
                        <div className="col-sm-8">
                            <input type="checkbox" name="autoReconnect" checked={config.autoReconnect} onChange={this.handleConfigChange} style={{ marginTop: '12px' }} />
                            <small className="form-text text-muted">Restart the data call when registered to the network but no IP address is assigned</small>
                        </div>
                    </div>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <label className="col-sm-3 col-form-label">Poll interval (s)</label>
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
