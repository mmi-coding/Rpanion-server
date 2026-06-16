import Button from 'react-bootstrap/Button'
import Form from 'react-bootstrap/Form'
import React from 'react'
import basePage from './basePage.jsx'
import { HelpTip, HelpSection } from './components/Help.jsx'

// Generates a turnkey VPS setup script for a self-hosted WireGuard "hub" — the
// public rendezvous server the drone (behind CGNAT) and the ground station both
// dial out to. The page produces only the script; keys are generated on the VPS.
class WireguardHubPage extends basePage {
  constructor (props) {
    super(props)
    this.state = {
      ...this.state,
      vpsIp: '',
      domain: '',
      port: '51820',
      subnet: '10.13.13.0/24',
      sshPort: '22',
      script: ''
    }
  }

  componentDidMount () {
    // No data to load — this page is a pure generator.
    this.loadDone()
  }

  handleChange = (event) => {
    this.setState({ [event.target.name]: event.target.value })
  }

  generateScript = () => {
    fetch('/api/wireguardhubscript', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${this.state.token}` },
      body: JSON.stringify({
        vpsIp: this.state.vpsIp,
        domain: this.state.domain,
        port: this.state.port,
        subnet: this.state.subnet,
        sshPort: this.state.sshPort
      })
    })
      .then(response => response.json())
      .then(state => { this.setState(state) })
      .catch(error => { this.setState({ error: 'Error generating script: ' + error }) })
  }

  copyScript = () => {
    navigator.clipboard.writeText(this.state.script)
    this.setState({ infoMessage: 'Script copied to clipboard.' })
  }

  downloadScript = () => {
    const blob = new Blob([this.state.script], { type: 'text/x-shellscript' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'setup-wireguard-hub.sh'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // The exact commands to copy the downloaded script onto the VPS and run it,
  // with the entered IP/SSH port baked in (the Pi can't push it — the user does).
  deployCommands () {
    const ip = this.state.vpsIp
    const p = this.state.sshPort
    return [
      "# Run on your LAPTOP. Replace 'root' with your VPS login if root SSH is",
      "# disabled (e.g. 'ubuntu'). Download the script first (button above).",
      `scp -P ${p} setup-wireguard-hub.sh root@${ip}:`,
      `ssh -p ${p} root@${ip} 'sudo bash setup-wireguard-hub.sh'`,
      '',
      '# ...or run it in one line without saving it on the VPS:',
      `ssh -p ${p} root@${ip} 'sudo bash -s' < setup-wireguard-hub.sh`
    ].join('\n')
  }

  copyDeploy = () => {
    navigator.clipboard.writeText(this.deployCommands())
    this.setState({ infoMessage: 'Deploy commands copied to clipboard.' })
  }

  renderTitle () {
    return 'WireGuard Hub'
  }

  renderContent () {
    return (
      <div style={{ width: 800 }}>
        <p><i>Generate a one-shot script that stands up a WireGuard server on a fresh VPS, so your laptop can reach the drone through CGNAT.</i></p>
        <HelpSection title="How this works">
          <p>Plain WireGuard cannot reach the drone directly: on the LTE link the drone sits behind carrier-grade NAT (no public inbound IP), so nothing can connect <i>to</i> it. The fix is a small public <b>hub</b> server (any cheap VPS) that both the drone and your laptop dial <i>out</i> to; the hub relays between them.</p>
          <p>Fill in your VPS&#39;s public IP and a domain/subdomain you control, then click <b>Generate</b>. Copy or download the script and run it once on the VPS (<code>sudo bash setup-wireguard-hub.sh</code>). It installs WireGuard, opens only your SSH port and the WireGuard UDP port, generates all keys on the VPS, and prints two ready configs:</p>
          <ul>
            <li><b>pi.conf</b> — upload it on the VPN page and Activate it.</li>
            <li><b>laptop.conf</b> — import it into your laptop&#39;s WireGuard client.</li>
          </ul>
          <p>First create a DNS <b>A record</b> pointing your domain at the VPS IP (the configs use the domain as the Endpoint, so a VPS IP change just needs a DNS update — not new configs).</p>
        </HelpSection>

        <h2>VPS configuration</h2>
        <div className="form-group row">
          <label className="col-sm-3 col-form-label">VPS public IP<HelpTip text="The public IPv4 address of your fresh VPS. Point your domain's A record at this address. Used for NAT setup and shown in the final reminder." /></label>
          <div className="col-sm-6">
            <Form.Control type="text" name="vpsIp" value={this.state.vpsIp} onChange={this.handleChange} placeholder="203.0.113.10" />
          </div>
        </div>
        <div className="form-group row">
          <label className="col-sm-3 col-form-label">Domain / subdomain<HelpTip text="A hostname you control (e.g. wg.example.com) with an A record pointing at the VPS IP. Used as the Endpoint in the Pi/laptop configs so the tunnel survives a VPS IP change." /></label>
          <div className="col-sm-6">
            <Form.Control type="text" name="domain" value={this.state.domain} onChange={this.handleChange} placeholder="wg.example.com" />
          </div>
        </div>
        <div className="form-group row">
          <label className="col-sm-3 col-form-label">WireGuard UDP port<HelpTip text="The UDP port the hub listens on (default 51820). Your VPS firewall/security group must allow inbound traffic on this port." /></label>
          <div className="col-sm-6">
            <Form.Control type="number" name="port" value={this.state.port} onChange={this.handleChange} />
          </div>
        </div>
        <div className="form-group row">
          <label className="col-sm-3 col-form-label">VPN subnet<HelpTip text="The private subnet for the tunnel (default 10.13.13.0/24). The hub gets .1, the drone .2, the laptop .3. Use a range that doesn't clash with your home/field LAN." /></label>
          <div className="col-sm-6">
            <Form.Control type="text" name="subnet" value={this.state.subnet} onChange={this.handleChange} />
          </div>
        </div>
        <div className="form-group row">
          <label className="col-sm-3 col-form-label">SSH port<HelpTip text="The port you SSH into the VPS on (default 22). The script's firewall keeps this open so enabling the firewall can't lock you out." /></label>
          <div className="col-sm-6">
            <Form.Control type="number" name="sshPort" value={this.state.sshPort} onChange={this.handleChange} />
          </div>
        </div>

        <p>
          <Button id="generatewg" disabled={!this.state.vpsIp || !this.state.domain} onClick={this.generateScript}>Generate</Button>
          <HelpTip text="Builds the VPS setup script from the values above. Requires the VPS IP and domain." />
        </p>

        {this.state.script && (
          <div>
            <h2>Setup script</h2>
            <p><i>Run this once on your fresh VPS as root.</i></p>
            <Form.Control as="textarea" id="scriptout" readOnly rows={14} value={this.state.script} style={{ fontFamily: 'monospace', fontSize: '0.8em' }} />
            <p style={{ marginTop: '6px' }}>
              <Button id="copywg" variant="secondary" onClick={this.copyScript}>Copy</Button>
              <HelpTip text="Copies the script to your clipboard so you can paste it into the VPS terminal." />
              {' '}
              <Button id="downloadwg" variant="secondary" onClick={this.downloadScript}>Download .sh</Button>
              <HelpTip text="Downloads the script as setup-wireguard-hub.sh to scp to the VPS." />
            </p>

            <h2>Deploy to your VPS</h2>
            <p><i>The Pi can&#39;t send the script to the VPS — you carry it across. Download it (above), then run these on your laptop.</i></p>
            <Form.Control as="textarea" id="deployout" readOnly rows={6} value={this.deployCommands()} style={{ fontFamily: 'monospace', fontSize: '0.8em' }} />
            <p style={{ marginTop: '6px' }}>
              <Button id="copydeploy" variant="secondary" onClick={this.copyDeploy}>Copy commands</Button>
              <HelpTip text="Copies the scp/ssh commands (with your VPS IP and SSH port filled in) to run on your laptop. Replace 'root' with your VPS login if needed." />
            </p>
          </div>
        )}
      </div>
    )
  }
}

export default WireguardHubPage
