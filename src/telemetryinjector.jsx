import React from 'react';
import { Form, Button, Table, Badge } from 'react-bootstrap';
import basePage from './basePage.jsx';
import { HelpTip, HelpSection } from './components/Help.jsx';

import './css/styles.css';

const BAUDS = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

class TelemetryInjectorPage extends basePage {
    constructor(props, useSocketIO = true) {
        super(props, useSocketIO);
        this.state = {
            ...this.state,
            status: {
                enabled: false,
                httpEnabled: true,
                udpEnabled: false,
                udpPort: 14600,
                serialEnabled: false,
                serialPort: '',
                udpListening: false,
                serialOpen: false,
                sentFloat: 0,
                sentText: 0,
                errors: 0,
                lastName: null,
                lastValue: null,
                lastText: null
            },
            config: {
                enabled: false,
                httpEnabled: true,
                udpEnabled: false,
                udpPort: 14600,
                serialEnabled: false,
                serialPort: '',
                serialBaud: 57600,
                sysid: 1,
                compid: 158
            }
        };

        // Socket.io client for live status updates
        this.socket.on('TelemetryInjectorStatus', function (msg) {
            this.setState({ status: msg });
        }.bind(this));

        this.socket.on('reconnect', function () {
            this.componentDidMount();
        }.bind(this));
    }

    componentDidMount() {
        this.fetchConfig();
    }

    fetchConfig = async () => {
        try {
            const response = await fetch('/api/telemetryinjector', { headers: { Authorization: `Bearer ${this.state.token}` } });
            if (!response.ok) throw new Error('Network response was not ok');
            const data = await response.json();
            this.setState({ config: data.settings, status: data.status });
            this.loadDone();
        } catch (error) {
            this.setState({ error: 'Failed to fetch telemetry injector config', isLoading: false });
        }
    };

    handleSubmit = async (event) => {
        event.preventDefault();
        try {
            const response = await fetch('/api/telemetryinjectormodify', {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.state.token}`
                },
                body: JSON.stringify({
                    ...this.state.config,
                    udpPort: parseInt(this.state.config.udpPort, 10),
                    serialBaud: parseInt(this.state.config.serialBaud, 10),
                    sysid: parseInt(this.state.config.sysid, 10),
                    compid: parseInt(this.state.config.compid, 10)
                })
            });
            const data = await response.json();
            if (data.error) {
                this.setState({ error: data.error });
            } else {
                this.setState({ error: null, config: data.settings });
            }
        } catch (error) {
            this.setState({ error: 'Failed to save telemetry injector settings' });
        }
    };

    renderTitle() {
        return "Telemetry Injector";
    }

    renderContent() {
        const { status, config } = this.state;
        return (
            <div>
                <p><i>Push external sensor data into the MAVLink stream so it shows up in your GCS alongside the autopilot telemetry.</i></p>
                <HelpSection title="How telemetry injection works">
                    <p>External processes (a CO&#8322; sensor, a payload controller, a script on the
                        companion computer&hellip;) hand readings to this service, which encodes them as
                        standard MAVLink messages and sends them to the local mavlink-router endpoint
                        (<code>127.0.0.1:14540</code>). The router rebroadcasts to the flight controller
                        link and every connected GCS, so the values appear wherever you already watch
                        telemetry &mdash; no extra link to the GCS required.</p>
                    <p>Two reading shapes are accepted, each one line of JSON:</p>
                    <Table bordered size="sm" style={{ maxWidth: '600px' }}>
                        <thead><tr><th>Reading</th><th>Becomes</th></tr></thead>
                        <tbody>
                            <tr><td><code>{'{"name":"co2","value":412}'}</code></td><td>NAMED_VALUE_FLOAT (name truncated to 10 chars)</td></tr>
                            <tr><td><code>{'{"text":"pump on","severity":6}'}</code></td><td>STATUSTEXT (severity 0-7, defaults to 6/INFO)</td></tr>
                        </tbody>
                    </Table>
                    <p>Three sources can feed readings in, enabled independently:</p>
                    <ul>
                        <li><b>HTTP</b> &mdash; POST one reading as JSON to <code>/api/telemetryinject</code>.</li>
                        <li><b>UDP</b> &mdash; send newline-delimited JSON datagrams to the listen port.</li>
                        <li><b>Serial</b> &mdash; newline-delimited JSON on a serial device (never the flight-controller port).</li>
                    </ul>
                    <p>The MAVLink System / Component ID identify the injected messages; pick a component
                        ID distinct from the autopilot so the readings are clearly attributable.</p>
                </HelpSection>

                <h2>Status</h2>
                <Table bordered size="sm" style={{ maxWidth: '700px' }}>
                    <tbody>
                        <tr><td>Injector</td><td>{status.enabled ? <Badge bg="success">Enabled</Badge> : <Badge bg="secondary">Disabled</Badge>}</td></tr>
                        <tr><td>HTTP source</td><td>{status.enabled && status.httpEnabled ? <Badge bg="success">Accepting</Badge> : <Badge bg="secondary">Off</Badge>}</td></tr>
                        <tr><td>UDP source</td><td>{status.udpListening ? <Badge bg="success">Listening on {status.udpPort}</Badge> : <Badge bg="secondary">Off</Badge>}</td></tr>
                        <tr><td>Serial source</td><td>{status.serialOpen ? <Badge bg="success">Open ({status.serialPort})</Badge> : <Badge bg="secondary">Off</Badge>}</td></tr>
                        <tr><td>Readings sent</td><td>{status.sentFloat} float, {status.sentText} text</td></tr>
                        <tr><td>Errors</td><td>{status.errors > 0 ? <Badge bg="warning">{status.errors}</Badge> : '0'}</td></tr>
                        <tr><td>Last reading</td><td>
                            {status.lastName !== null ? `${status.lastName} = ${status.lastValue}` : ''}
                            {status.lastName !== null && status.lastText !== null ? ' / ' : ''}
                            {status.lastText !== null ? `"${status.lastText}"` : ''}
                            {status.lastName === null && status.lastText === null ? '-' : ''}
                        </td></tr>
                    </tbody>
                </Table>

                <h2>Settings</h2>
                <Form onSubmit={this.handleSubmit}>
                    <div className="form-group row">
                        <label className="col-sm-3 col-form-label">Enable injector<HelpTip text="Master switch. When off, all sources stop and no MAVLink messages are injected. Takes effect on Save" /></label>
                        <div className="col-sm-8">
                            <input type="checkbox" name="enabled" checked={config.enabled} onChange={this.handleConfigChange} style={{ marginTop: '12px' }} />
                        </div>
                    </div>
                    <div className="form-group row">
                        <label className="col-sm-3 col-form-label">HTTP source<HelpTip text="Accept readings POSTed as JSON to /api/telemetryinject. Best for scripts already running on the companion computer. Takes effect on Save" /></label>
                        <div className="col-sm-8">
                            <input type="checkbox" name="httpEnabled" checked={config.httpEnabled} onChange={this.handleConfigChange} style={{ marginTop: '12px' }} />
                        </div>
                    </div>
                    <div className="form-group row">
                        <label className="col-sm-3 col-form-label">UDP source<HelpTip text="Listen for newline-delimited JSON datagrams. Best for a sensor or microcontroller on the local network. Takes effect on Save" /></label>
                        <div className="col-sm-8">
                            <input type="checkbox" name="udpEnabled" checked={config.udpEnabled} onChange={this.handleConfigChange} style={{ marginTop: '12px' }} />
                        </div>
                    </div>
                    <div className="form-group row">
                        <label className="col-sm-3 col-form-label">UDP listen port<HelpTip text="The UDP port this service binds to when the UDP source is enabled (1-65535, default 14600). Point your sensor at this port" /></label>
                        <div className="col-sm-8">
                            <Form.Control type="number" name="udpPort" value={config.udpPort} onChange={this.handleConfigChange} min={1} max={65535} style={{ maxWidth: '200px' }} />
                        </div>
                    </div>
                    <div className="form-group row">
                        <label className="col-sm-3 col-form-label">Serial source<HelpTip text="Read newline-delimited JSON from a serial device. Takes effect on Save. Never select the flight-controller serial port" /></label>
                        <div className="col-sm-8">
                            <input type="checkbox" name="serialEnabled" checked={config.serialEnabled} onChange={this.handleConfigChange} style={{ marginTop: '12px' }} />
                        </div>
                    </div>
                    <div className="form-group row">
                        <label className="col-sm-3 col-form-label">Serial device<HelpTip text="Path to the serial device that emits JSON readings, e.g. /dev/ttyUSB0. Leave blank to disable serial even if the source is ticked" /></label>
                        <div className="col-sm-8">
                            <Form.Control type="text" name="serialPort" value={config.serialPort} onChange={this.handleConfigChange} placeholder="/dev/ttyUSB0" style={{ maxWidth: '300px' }} />
                        </div>
                    </div>
                    <div className="form-group row">
                        <label className="col-sm-3 col-form-label">Serial baud<HelpTip text="Baud rate of the serial device. Must match the device's setting" /></label>
                        <div className="col-sm-8">
                            <Form.Select name="serialBaud" value={config.serialBaud} onChange={this.handleConfigChange} style={{ maxWidth: '200px' }}>
                                {BAUDS.map(b => <option key={b} value={b}>{b}</option>)}
                            </Form.Select>
                        </div>
                    </div>
                    <div className="form-group row">
                        <label className="col-sm-3 col-form-label">MAVLink System ID<HelpTip text="System ID stamped on injected messages (1-255). Usually matches the vehicle so the readings group with it in the GCS" /></label>
                        <div className="col-sm-8">
                            <Form.Control type="number" name="sysid" value={config.sysid} onChange={this.handleConfigChange} min={1} max={255} style={{ maxWidth: '200px' }} />
                        </div>
                    </div>
                    <div className="form-group row">
                        <label className="col-sm-3 col-form-label">MAVLink Component ID<HelpTip text="Component ID stamped on injected messages (1-255). Pick a value distinct from the autopilot (1) so injected readings are clearly attributable, e.g. 158" /></label>
                        <div className="col-sm-8">
                            <Form.Control type="number" name="compid" value={config.compid} onChange={this.handleConfigChange} min={1} max={255} style={{ maxWidth: '200px' }} />
                        </div>
                    </div>
                    <div className="form-group row">
                        <div className="col-sm-11">
                            <Button type="submit" className="btn btn-primary">Save</Button>
                        </div>
                    </div>
                </Form>
            </div>
        );
    }
}

export default TelemetryInjectorPage;
