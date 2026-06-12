import React from 'react';
import { Form, Button } from 'react-bootstrap';
import basePage from './basePage.jsx';

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
                <p><i>Switch the active video source at runtime, driven by an RC channel on the flight controller or manually from this page.</i></p>
                <p><i>GStreamer mode runs a second camera into the video stream and switches without restarting it (applies on next stream start). Command mode runs a user command per source, for CSI multiplexer boards.</i></p>
                <h2>Configuration</h2>
                <Form style={{ width: 600 }}>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <label className="col-sm-4 col-form-label">Enable RC switching</label>
                        <div className="col-sm-7">
                            <input type="checkbox" name="enabled" checked={this.state.config.enabled} onChange={this.handleConfigChange} style={{ marginTop: '12px' }} />
                        </div>
                    </div>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <label className="col-sm-4 col-form-label">RC Channel</label>
                        <div className="col-sm-3">
                            <Form.Control type="number" name="rcChannel" min={1} max={18} value={this.state.config.rcChannel} onChange={this.handleConfigChange} />
                        </div>
                    </div>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <label className="col-sm-4 col-form-label">Threshold (&micro;s)</label>
                        <div className="col-sm-3">
                            <Form.Control type="number" name="threshold" min={800} max={2200} value={this.state.config.threshold} onChange={this.handleConfigChange} />
                        </div>
                    </div>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <label className="col-sm-4 col-form-label">Hysteresis (&micro;s)</label>
                        <div className="col-sm-3">
                            <Form.Control type="number" name="hysteresis" min={0} max={500} value={this.state.config.hysteresis} onChange={this.handleConfigChange} />
                        </div>
                    </div>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <label className="col-sm-4 col-form-label">Min hold time (ms)</label>
                        <div className="col-sm-3">
                            <Form.Control type="number" name="minHoldMs" min={0} max={5000} value={this.state.config.minHoldMs} onChange={this.handleConfigChange} />
                        </div>
                    </div>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <label className="col-sm-4 col-form-label">Switch mode</label>
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
                                <label className="col-sm-4 col-form-label">Secondary device</label>
                                <div className="col-sm-7">
                                    <Form.Control type="text" name="secDevice" placeholder="/dev/video1" value={this.state.config.secDevice} onChange={this.handleConfigChange} />
                                </div>
                            </div>
                            <div className="form-group row" style={{ marginBottom: '5px' }}>
                                <label className="col-sm-4 col-form-label">Secondary format</label>
                                <div className="col-sm-7">
                                    <Form.Select name="secFormat" value={this.state.config.secFormat} onChange={this.handleConfigChange}>
                                        <option value="video/x-raw">Raw (video/x-raw)</option>
                                        <option value="image/jpeg">MJPEG (image/jpeg)</option>
                                    </Form.Select>
                                </div>
                            </div>
                            <div className="form-group row" style={{ marginBottom: '5px' }}>
                                <label className="col-sm-4 col-form-label">Secondary capture (WxH, 0 = same as primary)</label>
                                <div className="col-sm-3">
                                    <Form.Control type="number" name="secWidth" min={0} max={4096} value={this.state.config.secWidth} onChange={this.handleConfigChange} />
                                </div>
                                <div className="col-sm-3">
                                    <Form.Control type="number" name="secHeight" min={0} max={4096} value={this.state.config.secHeight} onChange={this.handleConfigChange} />
                                </div>
                            </div>
                            <div className="form-group row" style={{ marginBottom: '5px' }}>
                                <label className="col-sm-4 col-form-label">Secondary framerate (-1 = auto)</label>
                                <div className="col-sm-3">
                                    <Form.Control type="number" name="secFps" min={-1} max={120} value={this.state.config.secFps} onChange={this.handleConfigChange} />
                                </div>
                            </div>
                        </div>
                    }
                    {this.state.config.switchMode === 'command' &&
                        <div>
                            <div className="form-group row" style={{ marginBottom: '5px' }}>
                                <label className="col-sm-4 col-form-label">Command for source A</label>
                                <div className="col-sm-7">
                                    <Form.Control type="text" name="commandA" placeholder="i2cset -y 1 0x70 0x00 0x01" value={this.state.config.commandA} onChange={this.handleConfigChange} />
                                </div>
                            </div>
                            <div className="form-group row" style={{ marginBottom: '5px' }}>
                                <label className="col-sm-4 col-form-label">Command for source B</label>
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
