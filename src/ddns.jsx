import Button from 'react-bootstrap/Button'
import Form from 'react-bootstrap/Form'
import React from 'react'
import basePage from './basePage.jsx'
import { HelpTip, HelpSection } from './components/Help.jsx'

class DDNSPage extends basePage {
  constructor (props) {
    super(props)
    this.state = {
      ...this.state,
      enabled: false,
      provider: 'duckdns',
      hostname: '',
      token: '',
      username: '',
      password: '',
      hasPassword: false,
      intervalMin: 5,
      ddnsStatus: { status: 'Disabled', lastIp: null, lastUpdate: null }
    }
  }

  componentDidMount () {
    fetch('/api/ddns', { headers: { Authorization: `Bearer ${this.state.token}` } })
      .then(response => response.json())
      .then(data => { this.setState({ ...data.settings, ddnsStatus: data.status, password: '' }); this.loadDone() })
      .catch(error => { this.setState({ error: 'Error fetching DDNS settings: ' + error }); this.loadDone() })
  }

  handleChange = (event) => {
    const { name, value, type, checked } = event.target
    this.setState({ [name]: type === 'checkbox' ? checked : value })
  }

  handleSave = () => {
    fetch('/api/ddnsmodify', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${this.state.token}` },
      body: JSON.stringify({
        enabled: this.state.enabled,
        provider: this.state.provider,
        hostname: this.state.hostname,
        token: this.state.token,
        username: this.state.username,
        password: this.state.password,
        intervalMin: parseInt(this.state.intervalMin, 10)
      })
    })
      .then(response => response.json())
      .then(data => { this.setState({ ...data.settings, ddnsStatus: data.status, password: '' }) })
      .catch(error => { this.setState({ error: 'Error saving DDNS settings: ' + error }) })
  }

  handleUpdateNow = () => {
    fetch('/api/ddnsupdate', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${this.state.token}` },
      body: JSON.stringify({})
    })
      .then(response => response.json())
      .then(data => { this.setState({ ddnsStatus: data.status }) })
      .catch(error => { this.setState({ error: 'Error updating DDNS: ' + error }) })
  }

  renderTitle () {
    return 'Dynamic DNS'
  }

  renderContent () {
    return (
      <div style={{ width: 800 }}>
        <p><i>Keep a hostname pointed at this device as its public IP changes, so you can always reach it by name.</i></p>
        <HelpSection title="How dynamic DNS works">
          <p>A Dynamic DNS provider gives you a stable hostname (e.g. <code>mydrone.duckdns.org</code>) that this device keeps updated with its current public IP on a timer.</p>
          <p>On a mobile/4G link the public IP is usually a carrier-NAT address, so DDNS is most useful alongside a VPN; it still helps you find the device when it has a routable IP.</p>
        </HelpSection>

        <Form.Check type="checkbox" name="enabled" id="ddns-enabled" label="Enable dynamic DNS updates" checked={this.state.enabled} onChange={this.handleChange} />

        <div className="form-group row" style={{ marginTop: '8px', marginBottom: '5px' }}>
          <label className="col-sm-3 col-form-label">Provider<HelpTip text="Which Dynamic DNS service to update. DuckDNS uses a token; No-IP uses a username and password." /></label>
          <div className="col-sm-5">
            <Form.Select name="provider" value={this.state.provider} onChange={this.handleChange}>
              <option value="duckdns">DuckDNS</option>
              <option value="noip">No-IP</option>
            </Form.Select>
          </div>
        </div>

        <div className="form-group row" style={{ marginBottom: '5px' }}>
          <label className="col-sm-3 col-form-label">Hostname<HelpTip text="The DDNS hostname/subdomain to update (e.g. 'mydrone' for mydrone.duckdns.org, or the full No-IP host)." /></label>
          <div className="col-sm-5"><Form.Control type="text" name="hostname" value={this.state.hostname} onChange={this.handleChange} /></div>
        </div>

        {this.state.provider === 'noip' ? (
          <div>
            <div className="form-group row" style={{ marginBottom: '5px' }}>
              <label className="col-sm-3 col-form-label">Username<HelpTip text="Your No-IP account username (or DDNS key username)." /></label>
              <div className="col-sm-5"><Form.Control type="text" name="username" value={this.state.username} onChange={this.handleChange} /></div>
            </div>
            <div className="form-group row" style={{ marginBottom: '5px' }}>
              <label className="col-sm-3 col-form-label">Password<HelpTip text="Your No-IP password (or DDNS key). Leave blank to keep the saved one." /></label>
              <div className="col-sm-5"><Form.Control type="password" name="password" value={this.state.password} placeholder={this.state.hasPassword ? '(unchanged)' : ''} onChange={this.handleChange} /></div>
            </div>
          </div>
        ) : (
          <div className="form-group row" style={{ marginBottom: '5px' }}>
            <label className="col-sm-3 col-form-label">Token<HelpTip text="Your DuckDNS account token (from the DuckDNS website)." /></label>
            <div className="col-sm-5"><Form.Control type="text" name="token" value={this.state.token} onChange={this.handleChange} /></div>
          </div>
        )}

        <div className="form-group row" style={{ marginBottom: '5px' }}>
          <label className="col-sm-3 col-form-label">Update interval (min)<HelpTip text="How often to push the current IP to the provider. 1–1440 minutes." /></label>
          <div className="col-sm-3"><Form.Control type="number" name="intervalMin" value={this.state.intervalMin} onChange={this.handleChange} /></div>
        </div>

        <p>
          <Button onClick={this.handleSave}>Save</Button>{' '}
          <Button variant="secondary" onClick={this.handleUpdateNow}>Update now</Button>
          <HelpTip text="Save stores the settings and (re)starts the update timer. Update now pushes the IP immediately." />
        </p>

        <h2>Status</h2>
        <p>Last result: {this.state.ddnsStatus.status}</p>
        <p>Last IP: {this.state.ddnsStatus.lastIp || '—'}</p>
        <p>Last update: {this.state.ddnsStatus.lastUpdate || '—'}</p>
      </div>
    )
  }
}

export default DDNSPage
