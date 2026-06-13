import React from 'react';
import { Form, Button } from 'react-bootstrap';
import basePage from './basePage.jsx';
import { HelpTip, HelpSection } from './components/Help.jsx';

import './css/styles.css';

class CameraSwitcherPage extends basePage {
    constructor(props, useSocketIO = true) {
        super(props, useSocketIO);
        this.state = {
            ...this.state,
            status: {
                enabled: false,
                activeSource: 'A',
                lastRcValue: null,
                rcLive: false,
                lastSwitchTime: 0
            },
            config: {
                enabled: false,
                rcChannel: 7,
                threshold: 1500,
                hysteresis: 50,
                minHoldMs: 250,
                switchMode: 'gstreamer',
                secDevice: '',
                secFormat: 'video/x-raw',
                secWidth: 0,
                secHeight: 0,
                secFps: -1,
                commandA: '',
                commandB: ''
            },
        };

        // Socket.io client for reading in update values
        this.socket.on('CameraSwitcherStatus', function (msg) {
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
            const response = await fetch('/api/cameraswitcher', { headers: { Authorization: `Bearer ${this.state.token}` } });
            if (!response.ok) throw new Error('Network response was not ok');
            const data = await response.json();
            this.setState({ config: data.settings, status: data.status });
            this.loadDone();
        } catch (error) {
            this.setState({ error: 'Failed to fetch camera switcher config', isLoading: false });
        }
    };

    handleSubmit = async (event) => {
        event.preventDefault();
        try {
            const response = await fetch('/api/cameraswitchermodify', {
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
                this.setState({ error: null });
            }
            if (data.settings) {
                this.setState({ config: data.settings });
            }
        } catch (error) {
            console.error('Error updating camera switcher configuration:', error);
            this.setState({ error: 'Failed to update camera switcher configuration' });
        }
    };

    handleManualSwitch = async (source) => {
        try {
            const response = await fetch('/api/cameraswitcherswitch', {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.state.token}`
                },
                body: JSON.stringify({ source })
            });
            const data = await response.json();
            if (data.error) {
                this.setState({ error: data.error });
            } else {
                this.setState({ error: null, status: data.status });
            }
        } catch (error) {
            console.error('Error switching camera source:', error);
            this.setState({ error: 'Failed to switch camera source' });
        }
    };

    renderTitle() {
        return "Camera Switcher";
    }

    renderContent() {
        return (
            <div>
                <p><i>Switch the active video source at runtime - from an RC switch on your transmitter, or manually from this page.</i></p>
                <HelpSection title="How camera switching works">
                    <p>Two switch modes:</p>
                    <ul>
                        <li><b>GStreamer (dual source)</b> - both cameras feed the running video stream and
                            switching is instant, with no stream restart and no client reconnect. The secondary
                            camera is configured below; the primary is whatever the Photo and Video page streams.
                            Applies when the stream is next started.</li>
                        <li><b>Command (CSI multiplexer)</b> - runs a user-defined shell command per source, for
                            multiplexer boards that share one CSI port between cameras (typically
                            <code> i2cset</code> commands from the board vendor).</li>
                    </ul>
                    <p>RC switching reads the configured channel from the flight controller (the RC_CHANNELS
                        stream is requested automatically when enabled). Channel value above the threshold selects
                        source B, below selects A. Hysteresis and the minimum hold time stop a noisy channel from
                        flapping between sources. The manual buttons at the bottom work whether or not RC
                        switching is enabled.</p>
                </HelpSection>
                <h2>Configuration</h2>
                <Form style={{ width: 600 }}>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <label className="col-sm-4 col-form-label">Enable RC switching<HelpTip text="Listen to the flight controller's RC channel and switch sources automatically. Manual switching below works either way" /></label>
                        <div className="col-sm-7">
                            <input type="checkbox" name="enabled" checked={this.state.config.enabled} onChange={this.handleConfigChange} style={{ marginTop: '12px' }} />
                        </div>
                    </div>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <label className="col-sm-4 col-form-label">RC Channel<HelpTip text="Transmitter channel that drives the switch (1-18). Assign a 2-position switch to it on your radio" /></label>
                        <div className="col-sm-3">
                            <Form.Control type="number" name="rcChannel" min={1} max={18} value={this.state.config.rcChannel} onChange={this.handleConfigChange} />
                        </div>
                    </div>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <label className="col-sm-4 col-form-label">Threshold (&micro;s)<HelpTip text="Channel value separating the sources: below selects A, above selects B. A 2-position switch outputs roughly 1000/2000 µs, so 1500 fits most radios" /></label>
                        <div className="col-sm-3">
                            <Form.Control type="number" name="threshold" min={800} max={2200} value={this.state.config.threshold} onChange={this.handleConfigChange} />
                        </div>
                    </div>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <label className="col-sm-4 col-form-label">Hysteresis (&micro;s)<HelpTip text="Dead band around the threshold: the channel must cross threshold ± hysteresis before a switch happens. Stops flapping from a noisy channel" /></label>
                        <div className="col-sm-3">
                            <Form.Control type="number" name="hysteresis" min={0} max={500} value={this.state.config.hysteresis} onChange={this.handleConfigChange} />
                        </div>
                    </div>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <label className="col-sm-4 col-form-label">Min hold time (ms)<HelpTip text="Ignore further RC switches for this long after one happens (debounce)" /></label>
                        <div className="col-sm-3">
                            <Form.Control type="number" name="minHoldMs" min={0} max={5000} value={this.state.config.minHoldMs} onChange={this.handleConfigChange} />
                        </div>
                    </div>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <label className="col-sm-4 col-form-label">Switch mode<HelpTip text="GStreamer: dual-camera pipeline, instant in-stream switching. Command: run a shell command per source, for CSI multiplexer boards" /></label>
                        <div className="col-sm-7">
                            <Form.Select name="switchMode" value={this.state.config.switchMode} onChange={this.handleConfigChange}>
                                <option value="gstreamer">GStreamer (dual source)</option>
                                <option value="command">Command (CSI multiplexer)</option>
                            </Form.Select>
                        </div>
                    </div>
                    {this.state.config.switchMode === 'gstreamer' &&
                        <div>
                            <div className="form-group row" style={{ marginBottom: '5px' }}>
                                <label className="col-sm-4 col-form-label">Secondary device<HelpTip text="The second camera, named exactly as on the Photo and Video page (e.g. /dev/video1)" /></label>
                                <div className="col-sm-7">
                                    <Form.Control type="text" name="secDevice" placeholder="/dev/video1" value={this.state.config.secDevice} onChange={this.handleConfigChange} />
                                </div>
                            </div>
                            <div className="form-group row" style={{ marginBottom: '5px' }}>
                                <label className="col-sm-4 col-form-label">Secondary format<HelpTip text="Capture format of the secondary camera. USB webcams usually need MJPEG for higher resolutions" /></label>
                                <div className="col-sm-7">
                                    <Form.Select name="secFormat" value={this.state.config.secFormat} onChange={this.handleConfigChange}>
                                        <option value="video/x-raw">Raw (video/x-raw)</option>
                                        <option value="image/jpeg">MJPEG (image/jpeg)</option>
                                    </Form.Select>
                                </div>
                            </div>
                            <div className="form-group row" style={{ marginBottom: '5px' }}>
                                <label className="col-sm-4 col-form-label">Secondary capture (WxH, 0 = same as primary)<HelpTip text="Capture resolution of the secondary camera. It is scaled to match the primary before encoding, so a lower capture size saves CPU" /></label>
                                <div className="col-sm-3">
                                    <Form.Control type="number" name="secWidth" min={0} max={4096} value={this.state.config.secWidth} onChange={this.handleConfigChange} />
                                </div>
                                <div className="col-sm-3">
                                    <Form.Control type="number" name="secHeight" min={0} max={4096} value={this.state.config.secHeight} onChange={this.handleConfigChange} />
                                </div>
                            </div>
                            <div className="form-group row" style={{ marginBottom: '5px' }}>
                                <label className="col-sm-4 col-form-label">Secondary framerate (-1 = auto)<HelpTip text="Capture framerate of the secondary camera. -1 lets the camera choose" /></label>
                                <div className="col-sm-3">
                                    <Form.Control type="number" name="secFps" min={-1} max={120} value={this.state.config.secFps} onChange={this.handleConfigChange} />
                                </div>
                            </div>
                        </div>
                    }
                    {this.state.config.switchMode === 'command' &&
                        <div>
                            <div className="form-group row" style={{ marginBottom: '5px' }}>
                                <label className="col-sm-4 col-form-label">Command for source A<HelpTip text="Shell command run when this source is selected, e.g. the i2cset line from your multiplexer board's documentation" /></label>
                                <div className="col-sm-7">
                                    <Form.Control type="text" name="commandA" placeholder="i2cset -y 1 0x70 0x00 0x01" value={this.state.config.commandA} onChange={this.handleConfigChange} />
                                </div>
                            </div>
                            <div className="form-group row" style={{ marginBottom: '5px' }}>
                                <label className="col-sm-4 col-form-label">Command for source B<HelpTip text="Shell command run when this source is selected, e.g. the i2cset line from your multiplexer board's documentation" /></label>
                                <div className="col-sm-7">
                                    <Form.Control type="text" name="commandB" placeholder="i2cset -y 1 0x70 0x00 0x02" value={this.state.config.commandB} onChange={this.handleConfigChange} />
                                </div>
                            </div>
                        </div>
                    }
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <div className="col-sm-10">
                            <Button onClick={this.handleSubmit} className="btn btn-primary">Save</Button>
                        </div>
                    </div>
                </Form>
                <h2>Status</h2>
                <p>Active source: <strong>{this.state.status.activeSource}</strong></p>
                <p>RC input: {this.state.status.rcLive ? (this.state.status.lastRcValue + ' µs') : 'no RC data'}</p>
                <Button onClick={() => this.handleManualSwitch('A')} disabled={this.state.status.activeSource === 'A'} className="btn btn-secondary" style={{ marginRight: '10px' }}>Switch to A</Button>
                <Button onClick={() => this.handleManualSwitch('B')} disabled={this.state.status.activeSource === 'B'} className="btn btn-secondary">Switch to B</Button>
            </div>
        );
    }
}

export default CameraSwitcherPage;
