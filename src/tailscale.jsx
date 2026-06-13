import Button from 'react-bootstrap/Button'
import Table from 'react-bootstrap/Table'
import Form from 'react-bootstrap/Form'
import React from 'react'
import basePage from './basePage.jsx'
import { HelpTip, HelpSection } from './components/Help.jsx'

class TailscalePage extends basePage {
  constructor (props) {
    super(props)
    this.state = {
      ...this.state,
      statusTailscale: { installed: false, status: false, text: [] },
      authkey: ''
    }
  }

  componentDidMount () {
    fetch('/api/vpntailscale', { headers: { Authorization: `Bearer ${this.state.token}` } })
      .then(response => response.json())
      // Only adopt the status; a non-fatal status stderr (e.g. tailscale not
      // logged in) must not raise the blocking error modal on every load.
      .then(state => { this.setState({ statusTailscale: state.statusTailscale }); this.loadDone() })
      .catch(error => { this.setState({ error: 'Error fetching Tailscale status: ' + error }); this.loadDone() })
  }

  handleAuthKeyChange = (event) => {
    this.setState({ authkey: event.target.value })
  }

  connectTailscale = () => {
    fetch('/api/vpntailscaleconnect', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${this.state.token}` },
      body: JSON.stringify({ authkey: this.state.authkey })
    })
      .then(response => response.json())
      .then(state => { this.setState(state) })
      .catch(error => { this.setState({ error: 'Error connecting Tailscale: ' + error }) })
  }

  disconnectTailscale = () => {
    fetch('/api/vpntailscaledisconnect', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${this.state.token}` },
      body: JSON.stringify({})
    })
      .then(response => response.json())
      .then(state => { this.setState(state) })
      .catch(error => { this.setState({ error: 'Error disconnecting Tailscale: ' + error }) })
  }

  renderTitle () {
    return 'Tailscale VPN'
  }

  renderContent () {
    const ts = this.state.statusTailscale
    return (
      <div style={{ width: 800 }}>
        <p><i>Connect this companion computer to your Tailscale tailnet, so a ground station can reach it through CGNAT without port-forwarding.</i></p>
        <HelpSection title="How Tailscale works">
          <p>Tailscale builds a private mesh VPN (a &quot;tailnet&quot;) between your devices. Once this companion computer joins, Mission Planner on another tailnet device can reach it directly over the modem link, even behind carrier-grade NAT.</p>
          <p>Enrol the device headlessly with an <b>auth key</b> generated in the Tailscale admin console. Without a key, <code>tailscale up</code> needs an interactive login that must be done on the device itself. Tailscale runs over the existing RNDIS/USB modem data path.</p>
        </HelpSection>
        <h2>Status</h2>
        <p>Installed: {ts.installed ? 'Yes' : 'No'}</p>
        <p>Connected: {ts.status ? 'Yes' : 'No'}</p>
        <Table striped bordered>
          <thead>
            <tr><th>Host</th><th>Tailscale IP</th><th>Online</th><th>This device</th></tr>
          </thead>
          <tbody>
            {ts.text.map((node, idx) => (
              <tr key={idx}><td>{node.host}</td><td>{node.ip}</td><td>{node.online ? 'Yes' : 'No'}</td><td>{node.self ? 'Yes' : ''}</td></tr>
            ))}
          </tbody>
        </Table>
        <h2>Connection</h2>
        <div className="form-group row" style={{ marginBottom: '5px' }}>
          <label className="col-sm-3 col-form-label">Auth key<HelpTip text="Paste a Tailscale auth key (tskey-auth-...) from the admin console to join the tailnet headlessly. Takes effect immediately; reusable/ephemeral keys survive re-flashes." /></label>
          <div className="col-sm-6">
            <Form.Control type="text" name="authkey" value={this.state.authkey} onChange={this.handleAuthKeyChange} />
          </div>
        </div>
        <p>
          <Button id="connectts" disabled={this.state.authkey === ''} onClick={this.connectTailscale}>Connect</Button>
          <HelpTip text="Runs 'tailscale up' with the auth key to join the tailnet." />
          {' '}
          <Button id="disconnectts" variant="secondary" disabled={!ts.status} onClick={this.disconnectTailscale}>Disconnect</Button>
          <HelpTip text="Runs 'tailscale down' — leaves the tailnet but keeps the node authorised; reconnect without a new key." />
        </p>
      </div>
    )
  }
}

export default TailscalePage
