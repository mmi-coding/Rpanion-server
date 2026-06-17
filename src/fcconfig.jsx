import Card from 'react-bootstrap/Card';
import Table from 'react-bootstrap/Table';
import Button from 'react-bootstrap/Button';
import Badge from 'react-bootstrap/Badge';
import ProgressBar from 'react-bootstrap/ProgressBar';

import React from 'react'

import basePage from './basePage.jsx';
import { HelpTip, HelpSection } from './components/Help.jsx'
import { fmt, stateVariant } from './fcConfigShared'

import './css/styles.css';

// Read-only overview of how the connected flight controller is configured:
// available sensors, serial peripherals, servo output assignments and
// CAN/DroneCAN. The webUI has no parameter editor — the backend (fcParams.ts)
// downloads the FC's whole parameter set once and decodes the config-relevant
// groups; sensors and live servo PWM come from the telemetry stream.
class FCConfigPage extends basePage {
  constructor(props, useSocketIO = true) {
    super(props, useSocketIO);
    this.state = {
      ...this.state,
      overview: null,
      progress: { state: 'idle', received: 0, total: 0 },
      dcNodes: [],
      dcScanning: false,
      dcStats: null,
      dcParamNode: null, // node id whose parameters are expanded (null = none)
      dcParams: null     // { nodeId, bus, scanning, done, error, params } for that node
    }

    // live download progress, pushed once a second by the backend
    this.socket.on('FCParamStatus', function (msg) {
      const prevState = this.state.progress.state;
      this.setState({ progress: msg });
      // when a download settles, pull the freshly-decoded overview
      if ((msg.state === 'complete' || msg.state === 'partial') && prevState !== msg.state) {
        this.fetchOverview();
      }
    }.bind(this));
    // live DroneCAN node list, pushed once a second while a scan is active
    this.socket.on('DroneCANNodes', function (msg) {
      this.setState({ dcNodes: msg.nodes, dcScanning: msg.scanning, dcStats: msg.stats });
    }.bind(this));
    // live parameter-enumeration state for the expanded node (pushed once a second)
    this.socket.on('DroneCANNodeParams', function (msg) {
      // ignore pushes for a node other than the one currently expanded (stale/late)
      if (this.state.dcParamNode !== null && msg.active && msg.nodeId === this.state.dcParamNode) {
        this.setState({ dcParams: msg });
      }
    }.bind(this));
    this.socket.on('reconnect', function () {
      this.componentDidMount();
    }.bind(this));
  }

  componentDidMount() {
    this.fetchOverview();
    this.loadDone();
  }

  renderTitle() {
    return "FC Configuration";
  }

  fetchOverview = () => {
    fetch('/api/FCConfigOverview', { headers: { Authorization: `Bearer ${this.state.token}` } })
      .then(response => response.json())
      .then(data => this.setState({ overview: data, progress: { state: data.state, received: data.received, total: data.total } }))
      .catch(error => this.setState({ error: error.message }));
  }

  handleRefresh = () => {
    fetch('/api/FCParamRefresh', { method: 'POST', headers: { Authorization: `Bearer ${this.state.token}` } })
      .then(response => response.json())
      .then(data => this.setState({ progress: { state: data.state, received: data.received, total: data.total } }))
      .catch(error => this.setState({ error: error.message }));
  }

  handleScanDroneCAN = () => {
    this.setState({ dcScanning: true });
    fetch('/api/FCDroneCANScan', { method: 'POST', headers: { Authorization: `Bearer ${this.state.token}` } })
      .then(response => response.json())
      .catch(error => this.setState({ error: error.message }));
  }

  // expand a node row and read its parameters (or collapse if already open). The FC
  // forwards one bus at a time, so opening a node takes over from the node scan.
  handleNodeParams = (node) => {
    if (this.state.dcParamNode === node.id) {
      this.setState({ dcParamNode: null, dcParams: null }); // collapse
      return;
    }
    // expand now; the per-second DroneCANNodeParams push fills in the values (clear any
    // previous node's params so they don't flash under the newly expanded row)
    this.setState({ dcParamNode: node.id, dcParams: null });
    fetch('/api/FCDroneCANNodeParams', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.state.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ node: node.id, bus: node.bus })
    })
      .then(response => response.json())
      .catch(error => this.setState({ error: error.message }));
  }

  // a parameter value/bound for display: booleans as true/false, nulls (an empty
  // union, e.g. min/max not applicable to a bool or string) as an em dash
  fmtParam = (v) => {
    if (v === null || v === undefined) { return '—'; }
    if (typeof v === 'boolean') { return v ? 'true' : 'false'; }
    return String(v);
  }

  renderContent() {
    const ov = this.state.overview;
    const p = this.state.progress;
    const variant = stateVariant(p.state);
    const pct = p.total > 0 ? Math.round((p.received / p.total) * 100) : 0;
    const hasParams = ov !== null && p.total > 0;

    return (
      <div style={{ maxWidth: 900 }}>
        <p><i>A read-only snapshot of how the connected flight controller is set up — sensors, serial peripherals, servos and CAN/DroneCAN.</i></p>
        <HelpSection title="How this works">
          <p>The webUI has no parameter editor. This page asks the flight controller for its <b>entire parameter set</b> (the same data Mission Planner&apos;s full parameter list shows) plus its live telemetry, and decodes the configuration-relevant parts so you can see how the FC is wired without a ground station.</p>
          <p>Click <b>Refresh parameters</b> to (re)download — on a fast link (Ethernet/USB) it takes a few seconds; over a constrained telemetry radio it can take longer, and dropped values are automatically re-requested. <b>Sensors</b> and live servo <b>PWM</b> come from the telemetry stream, so an FC link on the <b>Flight Controller</b> page must be connected. DroneCAN node listing is best-effort over MAVLink and may need on-device CAN forwarding.</p>
        </HelpSection>

        <div className="form-group row" style={{ alignItems: 'center', marginBottom: '10px' }}>
          <div className="col-sm-4">
            <Button onClick={this.handleRefresh} disabled={p.state === 'downloading'}>
              Refresh parameters
            </Button>
            <HelpTip text="Download the full parameter set from the flight controller. Re-run after changing FC settings to update this page. Disabled while a download is in progress." />
          </div>
          <div className="col-sm-8">
            <span className="text-muted">Parameters: </span>
            <Badge bg={variant}>{p.state}</Badge>
            {p.total > 0 && <span style={{ marginLeft: '8px', fontVariantNumeric: 'tabular-nums' }}>{p.received} / {p.total}</span>}
            {p.state === 'downloading' && <ProgressBar now={pct} label={`${pct}%`} style={{ marginTop: '6px' }} />}
          </div>
        </div>

        {p.state === 'failed' && <div className="alert alert-warning" role="alert">No flight controller responded. Connect an FC link on the Flight Controller page, then refresh.</div>}

        {!hasParams ? (
          <p><i>No parameters downloaded yet — click <b>Refresh parameters</b> to read the FC configuration.</i></p>
        ) : (
          <>
            {this.renderSensors(ov.sensors)}
            {this.renderSerial(ov.serial)}
            {this.renderServos(ov.servos)}
            {this.renderCan(ov.can)}
          </>
        )}
      </div>
    );
  }

  renderSensors(sensors) {
    return (
      <Card className="mb-3">
        <Card.Header><h5 className="mb-0">Sensors</h5></Card.Header>
        <Card.Body>
          {sensors.length === 0 ? <p className="mb-0"><i>No SYS_STATUS telemetry yet.</i></p> : (
            <div className="d-flex flex-wrap" style={{ gap: '8px' }}>
              {sensors.map(s => {
                const v = !s.enabled ? 'secondary' : (s.healthy ? 'success' : 'danger');
                const label = !s.enabled ? 'disabled' : (s.healthy ? 'OK' : 'unhealthy');
                return <Badge key={s.key} bg={v}>{s.label}: {label}</Badge>;
              })}
            </div>
          )}
        </Card.Body>
      </Card>
    );
  }

  renderSerial(serial) {
    return (
      <Card className="mb-3">
        <Card.Header><h5 className="mb-0">Serial peripherals</h5></Card.Header>
        <Card.Body>
          {serial.length === 0 ? <p className="mb-0"><i>No serial port parameters found.</i></p> : (
            <Table striped bordered hover size="sm" className="mb-0">
              <thead><tr><th>Port</th><th>Protocol</th><th>Baud</th></tr></thead>
              <tbody>
                {serial.map(s => (
                  <tr key={s.port}>
                    <td>SERIAL{s.port}</td>
                    <td>{s.protocolName}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(s.baud)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>
    );
  }

  renderServos(servos) {
    return (
      <Card className="mb-3">
        <Card.Header><h5 className="mb-0">Servo outputs</h5></Card.Header>
        <Card.Body>
          {servos.length === 0 ? <p className="mb-0"><i>No assigned servo outputs.</i></p> : (
            <Table striped bordered hover size="sm" className="mb-0">
              <thead><tr><th>Ch</th><th>Function</th><th>PWM</th><th>Range</th><th>Reversed</th></tr></thead>
              <tbody>
                {servos.map(s => (
                  <tr key={s.ch}>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{s.ch}</td>
                    <td>{s.funcName}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{s.pwm === null ? '—' : s.pwm}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(s.min)}–{fmt(s.max)}</td>
                    <td>{s.reversed ? 'Yes' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>
    );
  }

  renderCan(can) {
    return (
      <Card className="mb-3">
        <Card.Header><h5 className="mb-0">CAN / DroneCAN</h5></Card.Header>
        <Card.Body>
          {can.ports.length === 0 && can.drivers.length === 0 ? <p><i>No CAN parameters found.</i></p> : (
            <Table striped bordered hover size="sm">
              <thead><tr><th>CAN bus</th><th>Driver</th><th>Bitrate</th></tr></thead>
              <tbody>
                {can.ports.map(c => (
                  <tr key={c.n}>
                    <td>CAN{c.n}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{c.driver}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(c.bitrate)}</td>
                  </tr>
                ))}
                {can.drivers.map(d => (
                  <tr key={'d' + d.n}>
                    <td>Driver {d.n}</td>
                    <td colSpan={2}>{d.protocolName}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <h6 className="mt-3">DroneCAN nodes<HelpTip text="Click a node row to read its parameters live from the device (uavcan.protocol.param.GetSet) — name, current value, default, and min/max — the same list a ground station shows when you open a node. Read-only: it only reads, never writes. Because the FC forwards one bus at a time, opening a node pauses the node sweep until enumeration finishes." /></h6>
          <div style={{ marginBottom: '8px' }}>
            <Button size="sm" onClick={this.handleScanDroneCAN} disabled={this.state.dcScanning}>
              {this.state.dcScanning ? 'Scanning…' : 'Scan DroneCAN bus'}
            </Button>
            <HelpTip text="Ask the flight controller to forward its CAN bus over MAVLink and enumerate live DroneCAN nodes (id, name, health, versions) — the same thing a ground station's DroneCAN screen does. The FC can forward only one bus at a time, so this sweeps each CAN bus in turn (~5 s per bus). Safe and read-only (it only sends standard GetNodeInfo requests)." />
            {this.state.dcStats && this.state.dcStats.frames > 0 && (
              <small className="text-muted" style={{ marginLeft: '8px', fontVariantNumeric: 'tabular-nums' }}>
                bus traffic: {this.state.dcStats.frames} frames · {this.state.dcStats.nodeStatus} status · {this.state.dcStats.nodeInfo} info replies
              </small>
            )}
          </div>
          {this.state.dcNodes.length === 0 ? (
            <p className="mb-0"><small className="text-muted">{this.state.dcScanning ? 'Scanning the bus for DroneCAN nodes…' : 'No DroneCAN nodes found yet — click Scan DroneCAN bus. (Nothing will appear if no DroneCAN devices are on the bus.)'}</small></p>
          ) : (
            <Table striped bordered hover size="sm" className="mb-0">
              <thead><tr><th>Node</th><th>Name</th><th>Health</th><th>Mode</th><th>Uptime</th><th>SW/HW</th></tr></thead>
              <tbody>
                {this.state.dcNodes.map(n => {
                  const open = this.state.dcParamNode === n.id;
                  return (
                    <React.Fragment key={n.id}>
                      <tr onClick={() => this.handleNodeParams(n)} style={{ cursor: 'pointer' }} title="Click to read this node's parameters">
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>{open ? '▾ ' : '▸ '}{n.id}{n.bus !== undefined ? ' · CAN' + (n.bus + 1) : ''}</td>
                        <td>{n.name || '—'}</td>
                        <td>{n.health || '—'}</td>
                        <td>{n.mode || '—'}</td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>{n.uptimeSec === undefined ? '—' : n.uptimeSec + ' s'}</td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>{n.swVersion ? n.swVersion : '—'}{n.hwVersion ? ' / ' + n.hwVersion : ''}</td>
                      </tr>
                      {open && <tr><td colSpan={6} style={{ padding: 0 }}>{this.renderNodeParams(n)}</td></tr>}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>
    );
  }

  // the expanded parameter list for one node — values read live over GetSet
  renderNodeParams(node) {
    const ps = this.state.dcParams;
    // no state yet, or state is for a different node → still requesting
    if (ps === null || ps.nodeId !== node.id) {
      return <p className="mb-0 p-2"><small className="text-muted">Requesting parameters…</small></p>;
    }
    const params = ps.params; // always an array (from getParamScan / the socket push)
    return (
      <div className="p-2">
        <div style={{ marginBottom: '6px' }}>
          <small className="text-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {params.length} parameter{params.length === 1 ? '' : 's'}
            {ps.scanning ? ' · reading…' : (ps.error ? ` · stopped (${ps.error})` : ' · complete')}
          </small>
        </div>
        {params.length === 0 ? (
          <p className="mb-0"><small className="text-muted">{ps.scanning ? 'Waiting for the node to respond…' : 'This node reported no parameters.'}</small></p>
        ) : (
          <Table striped bordered hover size="sm" className="mb-0">
            <thead><tr><th>Parameter</th><th>Value</th><th>Default</th><th>Min</th><th>Max</th></tr></thead>
            <tbody>
              {params.map(prm => (
                <tr key={prm.index}>
                  <td>{prm.name}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{this.fmtParam(prm.value)}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{this.fmtParam(prm.defaultValue)}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{this.fmtParam(prm.min)}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{this.fmtParam(prm.max)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    );
  }
}

export default FCConfigPage;
