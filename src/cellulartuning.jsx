import React from 'react';
import { Form, Button, Table, Alert, Badge } from 'react-bootstrap';
import basePage from './basePage.jsx';
import { HelpTip, HelpSection } from './components/Help.jsx';

import './css/styles.css';

function tierBadge(tier) {
    if (tier === 'good') return <Badge bg="success">Good</Badge>;
    if (tier === 'fair') return <Badge bg="warning">Fair</Badge>;
    if (tier === 'poor') return <Badge bg="danger">Poor</Badge>;
    return <Badge bg="secondary">Unknown</Badge>;
}

class CellularTuningPage extends basePage {
    constructor(props, useSocketIO = true) {
        super(props, useSocketIO);
        this.state = {
            ...this.state,
            status: {
                lowLatency: false,
                adaptiveBitrate: false,
                minBitrate: 250,
                streaming: false,
                tier: null,
                pendingTier: null,
                configuredBitrate: null,
                targetBitrate: null,
                ackBitrate: null,
                signal: null,
                lastChange: null
            },
            config: {
                lowLatency: false,
                adaptiveBitrate: false,
                minBitrate: 250
            }
        };

        // Socket.io client for reading in update values
        this.socket.on('CellularTuningStatus', function (msg) {
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
            const response = await fetch('/api/cellulartuning', { headers: { Authorization: `Bearer ${this.state.token}` } });
            if (!response.ok) throw new Error('Network response was not ok');
            const data = await response.json();
            this.setState({ config: data.settings, status: data.status });
            this.loadDone();
        } catch (error) {
            this.setState({ error: 'Failed to fetch cellular tuning config', isLoading: false });
        }
    };

    handleSubmit = async (event) => {
        event.preventDefault();
        try {
            const response = await fetch('/api/cellulartuningmodify', {
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
            this.setState({ error: 'Failed to save cellular tuning settings' });
        }
    };

    renderTitle() {
        return "Cellular Video Tuning";
    }

    renderContent() {
        const { status, config } = this.state;
        const signal = status.signal;
        return (
            <div>
                <p><i>Video stream tuning for constrained 4G/LTE links - degrade gracefully instead of stalling.</i></p>
                <HelpSection title="How adaptive bitrate works">
                    <p>Signal data comes from the LTE Modem page&apos;s monitor (RSRP when available - the better
                        LTE metric - otherwise RSSI). The signal is mapped to a tier, and the encoder bitrate is
                        scaled live, without restarting the stream:</p>
                    <Table bordered size="sm" style={{ maxWidth: '450px' }}>
                        <thead><tr><th>Tier</th><th>RSRP</th><th>Bitrate</th></tr></thead>
                        <tbody>
                            <tr><td>Good</td><td>≥ -95 dBm</td><td>100% of configured</td></tr>
                            <tr><td>Fair</td><td>≥ -105 dBm</td><td>60%</td></tr>
                            <tr><td>Poor</td><td>&lt; -105 dBm</td><td>35%</td></tr>
                        </tbody>
                    </Table>
                    <p>A tier change is applied only after the signal stays in the new tier for a few polls
                        (hysteresis), so a flickering signal does not cause bitrate thrash. The configured
                        bitrate is restored when the signal recovers. With adaptive bitrate on but no signal
                        data, the current bitrate is held.</p>
                </HelpSection>
                <h2>Status</h2>
                {status.adaptiveBitrate && !status.streaming &&
                    <Alert variant="secondary">Adaptive bitrate is enabled, but no video stream is running.</Alert>
                }
                {status.adaptiveBitrate && status.streaming && signal === null &&
                    <Alert variant="warning">No LTE signal information - enable modem monitoring on the LTE Modem page. Holding the current bitrate.</Alert>
                }
                <Table bordered size="sm" style={{ maxWidth: '700px' }}>
                    <tbody>
                        <tr><td>Video stream</td><td>{status.streaming ? <Badge bg="success">Streaming</Badge> : <Badge bg="secondary">Not streaming</Badge>}</td></tr>
                        <tr><td>Signal tier</td><td>
                            {tierBadge(status.tier)}
                            {signal && signal.rsrp !== undefined ? ` RSRP ${signal.rsrp} dBm` : (signal && signal.dbm !== null ? ` RSSI ${signal.dbm} dBm` : '')}
                        </td></tr>
                        <tr><td>Configured bitrate</td><td>{status.configuredBitrate !== null ? status.configuredBitrate + ' kbps' : '-'}</td></tr>
                        <tr><td>Adapted bitrate</td><td>{status.targetBitrate !== null ? status.targetBitrate + ' kbps' : 'Not adapted'}
                            {status.ackBitrate !== null ? ' (applied: ' + status.ackBitrate + ' kbps)' : ''}</td></tr>
                        <tr><td>Last change</td><td>{status.lastChange || '-'}</td></tr>
                    </tbody>
                </Table>

                <h2 style={{ marginTop: '20px' }}>Settings</h2>
                <Form onSubmit={this.handleSubmit}>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <label className="col-sm-3 col-form-label">Low-latency preset<HelpTip text="Tune the video pipeline for cellular links: ~1 s keyframe interval, constant-bitrate-style rate control, frame dropping instead of buffering. Takes effect when the stream is next started. For custom pipelines, name your encoder enc0 to allow runtime bitrate changes" /></label>
                        <div className="col-sm-8">
                            <input type="checkbox" name="lowLatency" checked={config.lowLatency} onChange={this.handleConfigChange} style={{ marginTop: '12px' }} />
                        </div>
                    </div>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <label className="col-sm-3 col-form-label">Adaptive bitrate<HelpTip text="Scale the encoder bitrate with the LTE signal quality (good 100% / fair 60% / poor 35% - see the table above). Requires modem monitoring on the LTE Modem page" /></label>
                        <div className="col-sm-8">
                            <input type="checkbox" name="adaptiveBitrate" checked={config.adaptiveBitrate} onChange={this.handleConfigChange} style={{ marginTop: '12px' }} />
                        </div>
                    </div>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <label className="col-sm-3 col-form-label">Minimum bitrate (kbps)<HelpTip text="Adaptive bitrate never goes below this floor, however poor the signal" /></label>
                        <div className="col-sm-8">
                            <Form.Control type="number" name="minBitrate" value={config.minBitrate} onChange={this.handleConfigChange} min={50} max={10000} style={{ maxWidth: '200px' }} />
                        </div>
                    </div>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <div className="col-sm-11">
                            <Button type="submit" className="btn btn-primary">Save</Button>
                        </div>
                    </div>
                </Form>
            </div>
        );
    }
}

export default CellularTuningPage;
