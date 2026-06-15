import React from 'react'
import Button from 'react-bootstrap/Button';
import Card from 'react-bootstrap/Card';
import Form from 'react-bootstrap/Form';
import Badge from 'react-bootstrap/Badge';

import basePage from './basePage.jsx';
import { HelpTip, HelpSection } from './components/Help.jsx'

import './css/styles.css';

// Additional, basic video streams (#398). The primary stream (Photo & Video page)
// keeps the full feature set; each secondary is a different camera on its own
// RTSP/RTP endpoint.
class SecondaryStreamsPage extends basePage {
  constructor(props) {
    super(props, false); // no socket — status comes from the REST fetch
    this.state = {
      ...this.state,
      devices: [],
      streams: [],
      inUse: [],
      // add-form
      addDevice: '',
      addCaps: [],
      addCapSelected: '',
      addWidth: 0,
      addHeight: 0,
      addFormat: '',
      addFps: 30,
      addBitrate: 2000,
      addRotation: 0,
      addCompression: 'H264',
      addTransport: 'RTSP',
      addUdpIP: '127.0.0.1',
      addUdpPort: 5602,
      error: null
    }
  }

  componentDidMount() {
    fetch('/api/videodevices', {headers: {Authorization: `Bearer ${this.state.token}`}}).then(r => r.json()).then(data => {
      this.setState({ devices: data.devices || [] }, () => this.seedDevice());
    });
    fetch('/api/secondarystreams', {headers: {Authorization: `Bearer ${this.state.token}`}}).then(r => r.json()).then(data => {
      this.setState({ streams: data.streams || [], inUse: data.inUse || [] }, () => { this.seedDevice(); this.loadDone(); });
    });
  }

  availableDevices() {
    return this.state.devices.filter(d => this.state.inUse.indexOf(d.value) === -1);
  }

  // pick a first not-in-use device + its default cap, once both fetches are in
  seedDevice() {
    if (this.state.addDevice !== '') {
      return;
    }
    const avail = this.availableDevices();
    if (avail.length > 0) {
      this.selectDevice(avail[0]);
    }
  }

  selectDevice(device) {
    const caps = device.caps || [];
    const cap = caps.length > 0 ? caps[0] : null;
    this.setState({
      addDevice: device.value,
      addCaps: caps,
      addCapSelected: cap ? cap.value : '',
      addWidth: cap ? cap.width : 0,
      addHeight: cap ? cap.height : 0,
      addFormat: cap ? cap.format : '',
      addCompression: (cap && cap.format === 'video/x-h264') ? 'H264' : this.state.addCompression
    });
  }

  handleDeviceChange = (e) => {
    const device = this.state.devices.find(d => d.value === e.target.value);
    if (device) { this.selectDevice(device); }
  }

  handleCapChange = (e) => {
    const cap = this.state.addCaps.find(c => c.value === e.target.value);
    if (cap) {
      this.setState({ addCapSelected: cap.value, addWidth: cap.width, addHeight: cap.height, addFormat: cap.format });
    }
  }

  handleField = (field, isInt) => (e) => {
    this.setState({ [field]: isInt ? parseInt(e.target.value) : e.target.value });
  }

  addStream = () => {
    fetch('/api/secondarystreamadd', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.state.token}` },
      body: JSON.stringify({
        device: this.state.addDevice,
        format: this.state.addFormat,
        width: this.state.addWidth,
        height: this.state.addHeight,
        fps: this.state.addFps,
        bitrate: this.state.addBitrate,
        rotation: this.state.addRotation,
        compression: this.state.addCompression,
        transport: this.state.addTransport,
        udpIP: this.state.addUdpIP,
        udpPort: this.state.addUdpPort
      })
    }).then(r => r.json()).then(data => {
      this.setState({ streams: data.streams || [], inUse: data.inUse || this.state.inUse, error: data.error });
    }).catch(() => this.setState({ error: 'Could not add stream' }));
  }

  removeStream = (id) => {
    fetch('/api/secondarystreamremove', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.state.token}` },
      body: JSON.stringify({ id })
    }).then(r => r.json()).then(data => {
      this.setState({ streams: data.streams || [], inUse: data.inUse || this.state.inUse, error: data.error });
    }).catch(() => this.setState({ error: 'Could not remove stream' }));
  }

  renderTitle() {
    return 'Secondary Streams';
  }

  renderContent() {
    const isRTP = this.state.addTransport === 'RTP';
    const avail = this.availableDevices();
    return (
      <div style={{ width: 650 }}>
        <p><i>Run extra video streams alongside the main camera — each a different camera on its own endpoint.</i></p>
        <HelpSection title="About secondary streams">
          <p>The main stream on the <b>Photo &amp; Video</b> page keeps every feature (camera switcher, telemetry HUD, custom pipelines, recording). Secondary streams here are <b>basic</b> additional feeds — pick a camera, resolution, bitrate and transport, and it streams on its own RTSP/RTP endpoint and its own process.</p>
          <p>Each stream needs a <b>different camera</b> (a camera can only be opened once), and each one costs encoder + CPU time — two 1080p streams can saturate a Pi 4 and will overwhelm a Pi Zero 2 W, so choose modest resolutions for extra streams.</p>
        </HelpSection>

        <h2>Active Secondary Streams</h2>
        {this.state.streams.length === 0 && <p><i>None yet — add one below.</i></p>}
        {this.state.streams.map(s => (
          <Card key={s.id} style={{ marginBottom: '8px' }}>
            <Card.Body>
              <Card.Title>
                {s.config.device} <Badge bg={s.running ? 'success' : 'secondary'}>{s.running ? 'running' : 'stopped'}</Badge>
                <Button size="sm" variant="danger" style={{ float: 'right' }} onClick={() => this.removeStream(s.id)}>Remove</Button>
              </Card.Title>
              <p style={{ marginBottom: '2px' }}>{s.config.width}x{s.config.height} {s.config.compression} @ {s.config.fps}fps, {s.config.bitrate} kbps</p>
              <p style={{ marginBottom: '2px' }}>{s.address}</p>
            </Card.Body>
          </Card>
        ))}
        {this.state.error && <div className="alert alert-warning" role="alert">{this.state.error}</div>}

        <h2>Add a Stream</h2>
        {avail.length === 0 ? (
          <p><i>No spare cameras available — every detected camera is already in use by the main stream or another secondary stream.</i></p>
        ) : (
          <>
            <div className="form-group row" style={{ marginBottom: '5px' }}>
              <label className="col-sm-4 col-form-label">Camera<HelpTip text="A camera not already used by the main stream or another secondary stream." /></label>
              <div className="col-sm-8">
                <Form.Select value={this.state.addDevice} onChange={this.handleDeviceChange}>
                  {avail.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </Form.Select>
              </div>
            </div>
            <div className="form-group row" style={{ marginBottom: '5px' }}>
              <label className="col-sm-4 col-form-label">Resolution<HelpTip text="Capture format and size. Lower resolutions cost less encoder/CPU time on a shared Pi." /></label>
              <div className="col-sm-8">
                <Form.Select value={this.state.addCapSelected} onChange={this.handleCapChange}>
                  {this.state.addCaps.map(c => <option key={c.value} value={c.value}>{c.width}x{c.height} {c.format}</option>)}
                </Form.Select>
              </div>
            </div>
            <div className="form-group row" style={{ marginBottom: '5px' }}>
              <label className="col-sm-4 col-form-label">Framerate</label>
              <div className="col-sm-8"><input type="number" min="1" max="120" value={this.state.addFps} onChange={this.handleField('addFps', true)} /></div>
            </div>
            <div className="form-group row" style={{ marginBottom: '5px' }}>
              <label className="col-sm-4 col-form-label">Max Bitrate</label>
              <div className="col-sm-8"><input type="number" min="50" max="50000" step="100" value={this.state.addBitrate} onChange={this.handleField('addBitrate', true)} /> kbps</div>
            </div>
            <div className="form-group row" style={{ marginBottom: '5px' }}>
              <label className="col-sm-4 col-form-label">Rotation</label>
              <div className="col-sm-8">
                <Form.Select value={this.state.addRotation} onChange={this.handleField('addRotation', true)}>
                  {[0, 90, 180, 270].map(r => <option key={r} value={r}>{r}°</option>)}
                </Form.Select>
              </div>
            </div>
            <div className="form-group row" style={{ marginBottom: '5px' }}>
              <label className="col-sm-4 col-form-label">Compression</label>
              <div className="col-sm-8">
                <Form.Select value={this.state.addCompression} onChange={this.handleField('addCompression', false)}>
                  <option value="H264">H.264</option>
                  <option value="H265">H.265</option>
                </Form.Select>
              </div>
            </div>
            <div className="form-group row" style={{ marginBottom: '5px' }}>
              <label className="col-sm-4 col-form-label">Transport<HelpTip text="RTSP serves the stream on a port for a client to pull; RTP pushes it to a fixed destination (use this over the cellular/VPN link)." /></label>
              <div className="col-sm-8">
                <Form.Select value={this.state.addTransport} onChange={this.handleField('addTransport', false)}>
                  <option value="RTSP">RTSP</option>
                  <option value="RTP">RTP</option>
                </Form.Select>
              </div>
            </div>
            {isRTP && (
              <>
                <div className="form-group row" style={{ marginBottom: '5px' }}>
                  <label className="col-sm-4 col-form-label">Destination IP</label>
                  <div className="col-sm-8"><input type="text" value={this.state.addUdpIP} onChange={this.handleField('addUdpIP', false)} /></div>
                </div>
                <div className="form-group row" style={{ marginBottom: '5px' }}>
                  <label className="col-sm-4 col-form-label">Destination Port</label>
                  <div className="col-sm-8"><input type="number" min="1" max="65535" value={this.state.addUdpPort} onChange={this.handleField('addUdpPort', true)} /></div>
                </div>
              </>
            )}
            <Button onClick={this.addStream}>Add Stream</Button>
          </>
        )}
      </div>
    );
  }
}

export default SecondaryStreamsPage;
