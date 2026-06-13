import Button from 'react-bootstrap/Button'
import Table from 'react-bootstrap/Table'
import Form from 'react-bootstrap/Form'
import React from 'react'
import basePage from './basePage.jsx'
import { HelpTip, HelpSection } from './components/Help.jsx'

class NetworkPriorityPage extends basePage {
  constructor (props) {
    super(props)
    this.state = {
      ...this.state,
      connections: [],
      bandwidth: [],
      inputs: {}
    }
  }

  componentDidMount () {
    this.fetchConnections()
    this.fetchBandwidth()
    this.timer = setInterval(this.fetchBandwidth, 2000)
  }

  componentWillUnmount () {
    clearInterval(this.timer)
    super.componentWillUnmount()
  }

  fetchConnections = () => {
    fetch('/api/networkpriority', { headers: { Authorization: `Bearer ${this.state.token}` } })
      .then(response => response.json())
      .then(data => {
        const connections = data.connections || []
        const inputs = {}
        connections.forEach(c => { inputs[c.uuid] = { priority: 0, metric: 100 } })
        this.setState({ connections, inputs })
        this.loadDone()
      })
      .catch(error => { this.setState({ error: 'Error fetching connections: ' + error }); this.loadDone() })
  }

  fetchBandwidth = () => {
    fetch('/api/networkbandwidth', { headers: { Authorization: `Bearer ${this.state.token}` } })
      .then(response => response.json())
      .then(data => { this.setState({ bandwidth: data.interfaces || [] }) })
      .catch(() => { this.setState({ bandwidth: [] }) })
  }

  handleInput = (uuid, field, value) => {
    this.setState(prev => ({ inputs: { ...prev.inputs, [uuid]: { ...prev.inputs[uuid], [field]: value } } }))
  }

  setPriority = (uuid) => {
    const inp = this.state.inputs[uuid]
    fetch('/api/networksetpriority', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${this.state.token}` },
      body: JSON.stringify({ conName: uuid, priority: parseInt(inp.priority, 10), metric: parseInt(inp.metric, 10) })
    })
      .then(response => response.json())
      .then(data => { this.setState({ infoMessage: data.error ? ('Error setting priority: ' + data.error) : 'Priority updated. It applies on the next reconnect.' }) })
      .catch(error => { this.setState({ error: 'Error setting priority: ' + error }) })
  }

  formatBytes (n) {
    if (n > 1000000) { return (n / 1000000).toFixed(2) + ' MB' }
    if (n > 1000) { return (n / 1000).toFixed(1) + ' kB' }
    return n + ' B'
  }

  renderTitle () {
    return 'Network Priority & Bandwidth'
  }

  renderContent () {
    return (
      <div style={{ width: 800 }}>
        <p><i>See live per-interface throughput and choose which network the device prefers (e.g. WiFi, falling back to cellular).</i></p>
        <HelpSection title="How priority & failover work">
          <p>NetworkManager picks the active link by <b>autoconnect priority</b> (higher wins) and, when several are up, the <b>route metric</b> (lower wins). Give WiFi a higher priority / lower metric than the cellular connection so the device prefers WiFi and falls back to the modem automatically when WiFi drops.</p>
          <p>Changes apply on the next reconnect of that connection. Bandwidth below refreshes every couple of seconds.</p>
        </HelpSection>

        <h2>Bandwidth</h2>
        <Table striped bordered size="sm">
          <thead>
            <tr><th>Interface</th><th>RX total</th><th>TX total</th><th>RX rate</th><th>TX rate</th></tr>
          </thead>
          <tbody>
            {this.state.bandwidth.map((i) => (
              <tr key={i.name}>
                <td>{i.name}</td>
                <td>{this.formatBytes(i.rxBytes)}</td>
                <td>{this.formatBytes(i.txBytes)}</td>
                <td>{this.formatBytes(i.rxRate)}/s</td>
                <td>{this.formatBytes(i.txRate)}/s</td>
              </tr>
            ))}
          </tbody>
        </Table>

        <h2>Connection priority <HelpTip text="Higher priority and lower metric make a connection preferred. Set WiFi above cellular for automatic failover." /></h2>
        <Table striped bordered size="sm">
          <thead>
            <tr><th>Connection</th><th>Type</th><th>Priority</th><th>Metric</th><th>Action</th></tr>
          </thead>
          <tbody>
            {this.state.connections.map((c) => (
              <tr key={c.uuid}>
                <td>{c.name}</td>
                <td>{c.type}</td>
                <td><Form.Control type="number" style={{ width: 90 }} value={this.state.inputs[c.uuid].priority} onChange={(e) => this.handleInput(c.uuid, 'priority', e.target.value)} /></td>
                <td><Form.Control type="number" style={{ width: 90 }} value={this.state.inputs[c.uuid].metric} onChange={(e) => this.handleInput(c.uuid, 'metric', e.target.value)} /></td>
                <td><Button size="sm" onClick={() => this.setPriority(c.uuid)}>Set</Button></td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    )
  }
}

export default NetworkPriorityPage
