import React from 'react';
import { Form, Button, Table, Alert } from 'react-bootstrap';
import basePage from './basePage.jsx';
import { HelpTip, HelpSection } from './components/Help.jsx';

import './css/styles.css';

class PipelineEditorPage extends basePage {
    constructor(props) {
        super(props, false);
        this.state = {
            ...this.state,
            pipelines: {},
            lastPipeline: '',
            customPipelineFallback: '',
            // editor state
            device: '',
            pipeline: '',
            enabled: false,
            validateResult: null
        };
    }

    componentDidMount() {
        this.fetchPipelines();
    }

    fetchPipelines = async () => {
        try {
            const response = await fetch('/api/custompipelines', { headers: { Authorization: `Bearer ${this.state.token}` } });
            if (!response.ok) throw new Error('Network response was not ok');
            const data = await response.json();
            this.setState({
                pipelines: data.pipelines,
                lastPipeline: data.lastPipeline,
                customPipelineFallback: data.customPipelineFallback
            });
            this.loadDone();
        } catch (error) {
            this.setState({ error: 'Failed to fetch custom pipelines', isLoading: false });
        }
    };

    handleChange = (event) => {
        const name = event.target.name;
        const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
        this.setState({ [name]: value, validateResult: null });
    };

    handleEdit = (device) => {
        const entry = this.state.pipelines[device];
        this.setState({
            device,
            // Edit button only exists for devices in pipelines, so entry is always truthy
            /* v8 ignore next -- Edit button only exists for devices in pipelines; entry always truthy */
            pipeline: entry ? entry.pipeline : '',
            /* v8 ignore next -- Edit button only exists for devices in pipelines; entry always truthy */
            enabled: entry ? entry.enabled : false,
            validateResult: null
        });
    };

    handleDelete = async (device) => {
        await this.savePipeline(device, false, '');
    };

    handleValidate = async () => {
        try {
            const response = await fetch('/api/custompipelinevalidate', {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.state.token}`
                },
                body: JSON.stringify({ pipeline: this.state.pipeline })
            });
            const data = await response.json();
            this.setState({ validateResult: data });
        } catch (error) {
            this.setState({ error: 'Failed to validate pipeline' });
        }
    };

    handleSave = async () => {
        await this.savePipeline(this.state.device, this.state.enabled, this.state.pipeline);
    };

    savePipeline = async (device, enabled, pipeline) => {
        try {
            const response = await fetch('/api/custompipelinemodify', {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.state.token}`
                },
                body: JSON.stringify({ device, enabled, pipeline })
            });
            const data = await response.json();
            this.setState({ error: data.error || null, ...(data.pipelines ? { pipelines: data.pipelines } : {}) });
        } catch (error) {
            console.error('Error saving custom pipeline:', error);
            this.setState({ error: 'Failed to save custom pipeline' });
        }
    };

    handleCopyLast = () => {
        // the last-used pipeline may have a udpsink appended (RTP mode);
        // strip it, since the transport sink is re-added automatically
        const stripped = this.state.lastPipeline.replace(/\s*!\s*udpsink[^!]*$/, '');
        this.setState({ pipeline: stripped, validateResult: null });
    };

    renderTitle() {
        return "Video Pipeline Editor";
    }

    renderContent() {
        return (
            <div>
                <p><i>Override the auto-generated GStreamer pipeline with your own, per camera device.</i></p>
                <HelpSection title="Pipeline rules and behaviour">
                    <ul>
                        <li>Write a full <code>gst-launch</code>-style pipeline <b>without</b> the network sink,
                            ending in an RTP payloader named <code>pay0</code>
                            (e.g. <code>... ! rtph264pay config-interval=1 name=pay0 pt=96</code>).</li>
                        <li>In RTP/UDP mode the <code>udpsink</code> for the configured destination is appended
                            automatically - never add your own. In RTSP mode the server consumes <code>pay0</code> directly.</li>
                        <li>Name your encoder <code>enc0</code> (e.g. <code>x264enc name=enc0 ...</code>) to allow
                            runtime bitrate changes from the Cellular Video Tuning page.</li>
                        <li>Pipelines are validated with a GStreamer dry run before they can be enabled. If an
                            enabled pipeline still fails at stream start, the stream falls back to the
                            auto-generated pipeline (a warning appears here) - a custom pipeline can never brick the video.</li>
                        <li>Changes apply when the stream is next started. The &quot;Last used pipeline&quot; at the
                            bottom is the best starting point for edits.</li>
                    </ul>
                </HelpSection>
                {this.state.customPipelineFallback !== '' &&
                    <Alert variant="warning">The last stream rejected its custom pipeline and used the generated one instead: {this.state.customPipelineFallback}</Alert>
                }
                <h2>Editor</h2>
                <Form>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <label className="col-sm-3 col-form-label">Camera device<HelpTip text="The camera this pipeline overrides - must exactly match the device name shown on the Photo and Video page (e.g. /dev/video0 or the libcamera path)" /></label>
                        <div className="col-sm-8">
                            <Form.Control type="text" name="device" placeholder="/dev/video0 or /base/soc/i2c0mux/i2c@1/imx708@1a" value={this.state.device} onChange={this.handleChange} />
                        </div>
                    </div>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <label className="col-sm-3 col-form-label">Pipeline<HelpTip text="gst-launch syntax, without the network sink, ending in a payloader named pay0. See the rules above" /></label>
                        <div className="col-sm-8">
                            <Form.Control as="textarea" rows={5} name="pipeline" style={{ fontFamily: 'monospace' }} value={this.state.pipeline} onChange={this.handleChange} />
                        </div>
                    </div>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <label className="col-sm-3 col-form-label">Enabled<HelpTip text="Only an enabled pipeline replaces the auto-generated one - and only if it passes validation. Disabled pipelines are kept but ignored" /></label>
                        <div className="col-sm-8">
                            <input type="checkbox" name="enabled" checked={this.state.enabled} onChange={this.handleChange} style={{ marginTop: '12px' }} />
                        </div>
                    </div>
                    <div className="form-group row" style={{ marginBottom: '5px' }}>
                        <div className="col-sm-11">
                            <Button onClick={this.handleValidate} className="btn btn-secondary" style={{ marginRight: '10px' }}>Validate</Button>
                            <Button onClick={this.handleSave} className="btn btn-primary">Save</Button>
                        </div>
                    </div>
                </Form>
                {this.state.validateResult !== null &&
                    <Alert variant={this.state.validateResult.valid === true ? 'success' : (this.state.validateResult.valid === false ? 'danger' : 'warning')}>
                        {this.state.validateResult.valid === true ? 'Pipeline is valid' :
                            (this.state.validateResult.valid === false ? 'Invalid: ' : 'Could not validate: ') + this.state.validateResult.reason}
                    </Alert>
                }
                <h2>Saved pipelines</h2>
                <Table striped bordered size="sm">
                    <thead>
                        <tr><th>Device</th><th>Enabled</th><th>Pipeline</th><th></th></tr>
                    </thead>
                    <tbody>
                        {Object.keys(this.state.pipelines).map((device) => (
                            <tr key={device}>
                                <td>{device}</td>
                                <td>{this.state.pipelines[device].enabled ? 'yes' : 'no'}</td>
                                <td style={{ fontFamily: 'monospace', fontSize: '0.8em', maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{this.state.pipelines[device].pipeline}</td>
                                <td>
                                    <Button size="sm" onClick={() => this.handleEdit(device)} style={{ marginRight: '5px' }}>Edit</Button>
                                    <Button size="sm" variant="danger" onClick={() => this.handleDelete(device)}>Delete</Button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
                <h2>Last used pipeline</h2>
                <p><i>The pipeline used by the last video stream - a good starting point for edits.</i></p>
                {this.state.lastPipeline !== '' ?
                    <div>
                        <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.8em' }}>{this.state.lastPipeline}</pre>
                        <Button onClick={this.handleCopyLast} className="btn btn-secondary">Copy into editor</Button>
                    </div>
                    : <p>No stream started yet.</p>
                }
            </div>
        );
    }
}

export default PipelineEditorPage;
