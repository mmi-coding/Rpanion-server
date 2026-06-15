import Button from 'react-bootstrap/Button';
import Table from 'react-bootstrap/Table';
import Card from 'react-bootstrap/Card';
import Accordion from 'react-bootstrap/Accordion';
import Form from 'react-bootstrap/Form';

import React from 'react'

import basePage from './basePage.jsx';
import { HelpTip, HelpSection } from './components/Help.jsx'

import './css/styles.css';

class FCPage extends basePage {
  constructor(props, useSocketIO = true) {
    super(props, useSocketIO);
    this.state = {
      ...this.state,
      // available choices
      inputTypes: [],
      serialPorts: [],
      baudRates: [],
      mavVersions: [],
      // configured input links
      links: [],
      linkError: null,
      // the "add link" form
      addInputType: 'UART',
      addSerial: null,
      addBaud: 57600,
      addMavVersion: 2,
      addUdpPort: 14551,
      // live per-link status (object with a .links array, primary spread at top level)
      FCStatus: {},
      // shared outputs + options (apply to every link)
      UDPoutputs: [],
      addrow: "",
      enableHeartbeat: false,
      enableTCP: false,
      enableUDPB: false,
      UDPBPort: 14550,
      enableDSRequest: false,
      doLogging: false
    }

    this.socket.on('FCStatus', function (msg) {
      this.setState({ FCStatus: msg });
    }.bind(this));
    this.socket.on('reconnect', function () {
      this.componentDidMount();
    }.bind(this));
  }

  componentDidMount() {
    fetch(`/api/FCDetails`, {headers: {Authorization: `Bearer ${this.state.token}`}}).then(response => response.json()).then(state => {
      this.setState(state, () => {
        // seed the add-form's serial default once the ports are known
        if (this.state.addSerial === null && this.state.serialPorts.length > 0) {
          this.setState({ addSerial: this.state.serialPorts[0].value });
        }
      });
    });
    fetch(`/api/FCOutputs`, {headers: {Authorization: `Bearer ${this.state.token}`}}).then(response => response.json()).then(state => { this.setState(state); this.loadDone() });
  }

  // ---- add-link form handlers ----
  handleAddInputType = (e) => this.setState({ addInputType: e.target.value })
  handleAddSerial = (e) => this.setState({ addSerial: e.target.value })
  handleAddBaud = (e) => this.setState({ addBaud: parseInt(e.target.value) })
  handleAddMavVersion = (e) => this.setState({ addMavVersion: parseInt(e.target.value) })
  handleAddUdpPort = (e) => this.setState({ addUdpPort: parseInt(e.target.value) })

  addLink = () => {
    fetch('/api/FCAddLink', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.state.token}` },
      body: JSON.stringify({
        inputType: this.state.addInputType,
        device: this.state.addSerial,
        baud: this.state.addBaud,
        mavversion: this.state.addMavVersion,
        udpInputPort: this.state.addUdpPort
      })
    }).then(response => response.json()).then(data => {
      this.setState({ links: data.links, linkError: data.error });
    }).catch(() => this.setState({ linkError: 'Could not add link' }))
  }

  removeLink = (id) => {
    fetch('/api/FCRemoveLink', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.state.token}` },
      body: JSON.stringify({ id })
    }).then(response => response.json()).then(data => {
      this.setState({ links: data.links, linkError: data.error });
    }).catch(() => this.setState({ linkError: 'Could not remove link' }))
  }

  // ---- shared options handlers ----
  handleUseHeartbeatChange = (e) => this.setState({ enableHeartbeat: e.target.checked })
  handleUseTCPChange = (e) => this.setState({ enableTCP: e.target.checked })
  handleLoggingChange = (e) => this.setState({ doLogging: e.target.checked })
  handleDSRequest = (e) => this.setState({ enableDSRequest: e.target.checked })
  handleUseUDPBChange = (e) => this.setState({ enableUDPB: e.target.checked })
  changeUDPBPort = (e) => this.setState({ UDPBPort: parseInt(e.target.value) })

  applyOptions = () => {
    fetch('/api/FCOptions', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.state.token}` },
      body: JSON.stringify({
        enableHeartbeat: this.state.enableHeartbeat,
        enableTCP: this.state.enableTCP,
        enableUDPB: this.state.enableUDPB,
        UDPBPort: this.state.UDPBPort,
        enableDSRequest: this.state.enableDSRequest,
        doLogging: this.state.doLogging
      })
    }).then(response => response.json()).then(state => { this.setState(state) })
  }

  handleFCReboot = () => {
    fetch('/api/FCReboot', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.state.token}` }
    });
  }

  addUdpOutput = () => {
    fetch('/api/addudpoutput', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.state.token}` },
      body: JSON.stringify({ newoutputIP: this.state.addrow.split(":")[0], newoutputPort: this.state.addrow.split(":")[1] })
    }).then(response => response.json()).then(state => { this.setState(state) })
  }

  removeUdpOutput = (val) => {
    fetch('/api/removeudpoutput', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.state.token}` },
      body: JSON.stringify({ removeoutputIP: val.IPPort.split(":")[0], removeoutputPort: val.IPPort.split(":")[1] })
    }).then(response => response.json()).then(state => { this.setState(state) })
  }

  changeaddrow = (e) => this.setState({ addrow: e.target.value })

  renderTitle() {
    return "Flight Controller";
  }

  renderUDPTableData(udplist) {
    return udplist.map((output, index) => (
      <tr key={index}>
        <td>{output.IPPort}</td>
        <td><Button size="sm" id={index} onClick={() => this.removeUdpOutput(output)}>Delete</Button></td>
      </tr>
    ));
  }

  // a status card for one configured link, merging in the live FCStatus
  renderLinkCard(link) {
    const live = (this.state.FCStatus.links || []).find(s => s.id === link.id) || {};
    const pos = live.vehiclePosition;
    return (
      <Card key={link.id} style={{ marginBottom: '8px' }}>
        <Card.Body>
          <Card.Title>
            {link.label}
            <Button size="sm" variant="danger" style={{ float: 'right' }} onClick={() => this.removeLink(link.id)}>Remove</Button>
          </Card.Title>
          <p style={{ marginBottom: '2px' }}>Status: {live.conStatus || 'Not connected'} — {live.numpackets || 0} packets ({live.byteRate || 0} bytes/sec)</p>
          <p style={{ marginBottom: '2px' }}>Vehicle: {live.vehType || '—'} {live.FW || ''}{live.fcVersion ? (', ' + live.fcVersion) : ''}</p>
          {pos && (pos.lat !== 0 || pos.lon !== 0) &&
            <p style={{ marginBottom: '2px' }}>Position: {pos.lat.toFixed(7)}, {pos.lon.toFixed(7)} — {pos.relAlt.toFixed(1)}m rel / {pos.alt.toFixed(1)}m MSL, hdg {pos.hdg.toFixed(0)}°</p>
          }
        </Card.Body>
      </Card>
    );
  }

  renderContent() {
    const isUART = this.state.addInputType === 'UART';
    const atMax = this.state.links.length >= 4;
    return (
      <div style={{ width: 650 }}>
        <p><i>Connect one or more MAVLink telemetry sources and route them all to your ground station.</i></p>
        <HelpSection title="How multiple telemetry links work">
          <p>Each input link (a serial UART or a UDP server) is independent: it gets its own router and connection monitor, so one link dropping out does not affect the others. Every link is routed to the shared telemetry destinations below — your ground station tells the vehicles apart by their MAVLink system ID.</p>
          <p>The <b>UDP Server</b> (broadcast) and <b>TCP Server</b> bind a fixed port, so they carry the <b>first</b> link only. For multiple vehicles over a cellular/VPN link, add an explicit <b>UDP Client</b> destination — that carries every vehicle. DataFlash logging captures the first link.</p>
        </HelpSection>

        <h2>Telemetry Links</h2>
        {this.state.links.length === 0 && <p><i>No links yet — add one below.</i></p>}
        {this.state.links.map(link => this.renderLinkCard(link))}
        {this.state.linkError && <div className="alert alert-warning" role="alert">{this.state.linkError}</div>}

        <Accordion defaultActiveKey="0">
          <Accordion.Item eventKey="0">
            <Accordion.Header>Add a Link</Accordion.Header>
            <Accordion.Body>
              <div className="form-group row" style={{ marginBottom: '5px' }}>
                <label className="col-sm-4 col-form-label">Input Type<HelpTip text="UART for a serial-attached flight controller / radio; UDP Server to receive a MAVLink stream the vehicle sends to this device's IP:port." /></label>
                <div className="col-sm-8">
                  <Form.Select value={this.state.addInputType} onChange={this.handleAddInputType}>
                    {this.state.inputTypes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Form.Select>
                </div>
              </div>
              {isUART ? (
                <>
                  <div className="form-group row" style={{ marginBottom: '5px' }}>
                    <label className="col-sm-4 col-form-label">Serial Device<HelpTip text="The serial port the flight controller / telemetry radio is on. Never select the modem's own serial port." /></label>
                    <div className="col-sm-8">
                      <Form.Select onChange={this.handleAddSerial} value={this.state.addSerial || ''}>
                        {this.state.serialPorts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </Form.Select>
                    </div>
                  </div>
                  <div className="form-group row" style={{ marginBottom: '5px' }}>
                    <label className="col-sm-4 col-form-label">Baud Rate<HelpTip text="Must match the flight controller's SERIALn_BAUD for this port (commonly 57600 or 115200)." /></label>
                    <div className="col-sm-8">
                      <Form.Select onChange={this.handleAddBaud} value={this.state.addBaud}>
                        {this.state.baudRates.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </Form.Select>
                    </div>
                  </div>
                </>
              ) : (
                <div className="form-group row" style={{ marginBottom: '5px' }}>
                  <label className="col-sm-5 col-form-label">UDP Input Port<HelpTip text="The port this device listens on for the vehicle's MAVLink stream. Set the FC's NET_Pn_TYPE=1 and NET_Pn_IP* to this device's IP." /></label>
                  <div className="col-sm-7">
                    <input type="number" min="1000" max="65535" value={this.state.addUdpPort} onChange={this.handleAddUdpPort} />
                  </div>
                </div>
              )}
              <div className="form-group row" style={{ marginBottom: '5px' }}>
                <label className="col-sm-4 col-form-label">MAVLink Version<HelpTip text="MAVLink protocol version for this link. Modern ArduPilot uses 2.0." /></label>
                <div className="col-sm-8">
                  <Form.Select onChange={this.handleAddMavVersion} value={this.state.addMavVersion}>
                    {this.state.mavVersions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Form.Select>
                </div>
              </div>
              <Button onClick={this.addLink} disabled={atMax || (isUART && this.state.serialPorts.length === 0)}>Add Link</Button>
              {atMax && <span> <i>Maximum of 4 links reached.</i></span>}
            </Accordion.Body>
          </Accordion.Item>

          <Accordion.Item eventKey="1">
            <Accordion.Header>Telemetry Destinations (shared)</Accordion.Header>
            <Accordion.Body>
              <h3>UDP Client</h3>
              <p><i>Send telemetry to a specific IP:port (carries every link). Use the &quot;UDP&quot; option in Mission Planner.</i></p>
              <Table id='UDPOut' striped bordered hover size="sm">
                <thead><tr><th>Destination IP:Port</th><th>Action</th></tr></thead>
                <tbody>
                  <tr key={this.state.UDPoutputs.length}><td>127.0.0.1:14540</td><td><i>Required for Rpanion-server</i></td></tr>
                  {this.renderUDPTableData(this.state.UDPoutputs)}
                </tbody>
              </Table>
              <div className="form-group row" style={{ marginBottom: '5px' }}>
                <label className="col-sm-4 col-form-label">Add new destination</label>
                <div className="col-sm-8">
                  <input type="text" onChange={this.changeaddrow} value={this.state.addrow} /><Button size="sm" onClick={this.addUdpOutput}>Add</Button>
                </div>
              </div>
              <br />
              <h3>UDP Server <HelpTip text="Lets one GCS connect to this device's IP:port (broadcast). Binds a fixed port, so it carries the first link only." /></h3>
              <div className="form-group row" style={{ marginBottom: '5px' }}>
                <label className="col-sm-4 col-form-label">Enable UDP Server</label>
                <div className="col-sm-8">
                  <input type="checkbox" checked={this.state.enableUDPB} onChange={this.handleUseUDPBChange} />
                </div>
              </div>
              <div className="form-group row" style={{ marginBottom: '5px' }}>
                <label className="col-sm-4 col-form-label">UDP Server Port</label>
                <div className="col-sm-8">
                  <input type="number" min="1000" max="20000" step="1" onChange={this.changeUDPBPort} value={this.state.UDPBPort} disabled={!this.state.enableUDPB} />
                </div>
              </div>
              <br />
              <h3>TCP Server <HelpTip text="Lets multiple GCSs connect to this device's IP:5760. Binds a fixed port, so it carries the first link only." /></h3>
              <div className="form-group row" style={{ marginBottom: '5px' }}>
                <label className="col-sm-5 col-form-label">Enable TCP Server at port 5760</label>
                <div className="col-sm-7">
                  <input type="checkbox" checked={this.state.enableTCP} onChange={this.handleUseTCPChange} />
                </div>
              </div>
            </Accordion.Body>
          </Accordion.Item>

          <Accordion.Item eventKey="2">
            <Accordion.Header>Other Options (shared)</Accordion.Header>
            <Accordion.Body>
              <div className="form-group row" style={{ marginBottom: '5px' }}>
                <label className="col-sm-5 col-form-label">Enable datastream requests<HelpTip text="Have this device request the telemetry datastreams from each vehicle. Needed when no GCS is connected to ask for them." /></label>
                <div className="col-sm-7">
                  <input type="checkbox" checked={this.state.enableDSRequest} onChange={this.handleDSRequest} />
                </div>
              </div>
              <div className="form-group row" style={{ marginBottom: '5px' }}>
                <label className="col-sm-5 col-form-label">Enable MAVLink heartbeats<HelpTip text="Advertise this device as an onboard companion computer on the MAVLink network." /></label>
                <div className="col-sm-7">
                  <input type="checkbox" checked={this.state.enableHeartbeat} onChange={this.handleUseHeartbeatChange} />
                </div>
              </div>
              <div className="form-group row" style={{ marginBottom: '5px' }}>
                <label className="col-sm-5 col-form-label">Enable flight controller logging<HelpTip text="Record a DataFlash log of the first link's vehicle." /></label>
                <div className="col-sm-7">
                  <input type="checkbox" checked={this.state.doLogging} onChange={this.handleLoggingChange} />
                </div>
              </div>
            </Accordion.Body>
          </Accordion.Item>
        </Accordion>

        <div className="form-group row" style={{ marginBottom: '5px', marginTop: '8px' }}>
          <div className="col-sm-8">
            <Button onClick={this.applyOptions}>Apply Shared Options</Button>
            <HelpTip text="Apply the destination + option changes above. Running links are briefly restarted to pick them up." />
          </div>
        </div>

        <br />
        <Button size="sm" disabled={this.state.links.length === 0} onClick={this.handleFCReboot}>Reboot Flight Controller(s)</Button>
      </div>
    );
  }
}

export default FCPage;
