import React from 'react'
import basePage from './basePage.jsx'
import { Card, Row, Col, Badge } from 'react-bootstrap'

class Home extends basePage {
  constructor (props) {
    super(props, true) // Enable Socket.IO
    this.state = {
      ...this.state,
      FCStatus: {
        conStatus: 'Not connected',
        numpackets: 0,
        byteRate: 0,
        vehType: '',
        FW: '',
        fcVersion: ''
      },
      NTRIPStatus: 'Not connected',
      PPPStatus: 'Not connected',
      LogConversionStatus: 'N/A',
      VideoStreamStatus: 'Not streaming',
      systemStatus: null
    }

    // Socket.io listeners for status updates
    this.socket.on('FCStatus', (msg) => {
      this.setState({ FCStatus: msg })
    })

    this.socket.on('NTRIPStatus', (msg) => {
      this.setState({ NTRIPStatus: msg })
    })

    this.socket.on('PPPStatus', (msg) => {
      this.setState({ PPPStatus: msg })
    })

    this.socket.on('LogConversionStatus', (msg) => {
      this.setState({ LogConversionStatus: msg })
    })

    this.socket.on('VideoStreamStatus', (msg) => {
      this.setState({ VideoStreamStatus: msg })
    })

    this.socket.on('reconnect', () => {
      // refresh state on reconnection
      this.componentDidMount()
    })

    // Poll live system stats (CPU / temp / RAM / disk / uptime) for the dashboard (#31)
    this.loadSystemStatus()
    this.sysTimer = setInterval(this.loadSystemStatus.bind(this), 3000)
  }

  componentDidMount () {
    this.loadDone()
  }

  componentWillUnmount () {
    clearInterval(this.sysTimer)
    super.componentWillUnmount()
  }

  loadSystemStatus () {
    fetch('/api/systemstatus', { headers: { Authorization: `Bearer ${this.state.token}` } })
      .then(response => response.json())
      .then(data => { this.setState({ systemStatus: data }) })
      .catch(() => { /* keep the previous sample */ })
  }

  // Helper method to determine status variant (color)
  // Only genuinely active/connected states are green. Negative states are matched
  // first because 'inactive' contains 'active' and 'disconnected'/'not connected'
  // contain 'connected' — checking success first would turn those green.
  getStatusVariant (status) {
    if (typeof status === 'string') {
      const s = status.toLowerCase()
      if (s.includes('error') || s.includes('failed')) {
        return 'danger'
      } else if (s.includes('inactive') || s.includes('disconnect') || s.includes('not') || s.includes('no')) {
        return 'secondary'
      } else if (s.includes('active') || s.includes('connected')) {
        return 'success'
      }
    }
    return 'warning'
  }

  renderTitle () {
    return 'System Status Overview'
  }

  renderContent () {
    
    // Get the exact state of the camrea
    const videoStatus = (this.state.VideoStreamStatus || '').toString();
    let cameraBadgeLabel = 'Inactive';
    if (videoStatus.toLowerCase().includes('inactive') || videoStatus.toLowerCase().includes('not')) {
      cameraBadgeLabel = 'Inactive';
    } else if (videoStatus.toLowerCase().includes('streaming')) {
      cameraBadgeLabel = 'Active (Streaming)';
    } else if (videoStatus.toLowerCase().includes('photo')) {
      cameraBadgeLabel = 'Active (Photo)';
    } else if (videoStatus.toLowerCase().includes('recording')) {
      cameraBadgeLabel = 'Recording';
    } else if (videoStatus.toLowerCase().includes('video')) {
      cameraBadgeLabel = 'Active (Video)';
    }
    const cameraBadgeVariant = this.getStatusVariant(videoStatus);

    return (
      <div style={{ maxWidth: 650 }}>
        <div className="mb-4">
          <h2>Quick Links</h2>
          <p>Use the navigation menu to configure system components:</p>
          <ul>
            <li><a href='https://github.com/stephendade/Rpanion-server'>Rpanion-server website</a></li>
            <li><a href='https://www.docs.rpanion.com/software/rpanion-server'>Rpanion-server documentation</a></li>
          </ul>
        </div>

        <p>Welcome to the Rpanion-server home page. Real-time system status is updated every second.</p>
        
        <Row className="mb-4">
          <Col md={6}>
            <Card className="mb-3">
              <Card.Header>
                <h5 className="mb-0">
                  MAVLink Connection
                  <Badge bg={this.getStatusVariant(this.state.FCStatus.conStatus)} className="ms-2">
                    {this.state.FCStatus.conStatus}
                  </Badge>
                </h5>
              </Card.Header>
              <Card.Body>
                <p><strong>Packets:</strong> {this.state.FCStatus.numpackets}</p>
                <p><strong>Data Rate:</strong> {this.state.FCStatus.byteRate} bytes/sec</p>
                <p><strong>Vehicle:</strong> {this.state.FCStatus.vehType}</p>
                <p><strong>Firmware:</strong> {this.state.FCStatus.FW} {this.state.FCStatus.fcVersion}</p>
              </Card.Body>
            </Card>

            <Card className="mb-3">
              <Card.Header>
                <h5 className="mb-0">
                  PPP Connection
                  <Badge bg={this.getStatusVariant(this.state.PPPStatus)} className="ms-2">
                    {this.state.PPPStatus.includes('Active') ? 'Active' : 'Inactive'}
                  </Badge>
                </h5>
              </Card.Header>
              <Card.Body>
                <p>{this.state.PPPStatus}</p>
              </Card.Body>
            </Card>

            <Card className="mb-3">
              <Card.Header>
                <h5 className="mb-0">
                  NTRIP Connection
                  <Badge bg={this.getStatusVariant(this.state.NTRIPStatus)} className="ms-2">
                    {this.state.NTRIPStatus.includes('Active') ? 'Active' : 'Inactive'}
                  </Badge>
                </h5>
              </Card.Header>
              <Card.Body>
                <p>{this.state.NTRIPStatus}</p>
              </Card.Body>
            </Card>
          </Col>

          <Col md={6}>
            <Card className="mb-3">
              <Card.Header>
                <h5 className="mb-0">System</h5>
              </Card.Header>
              <Card.Body>
                {this.state.systemStatus ? (
                  <>
                    <p><strong>CPU:</strong> {this.state.systemStatus.cpuLoad}% · {this.state.systemStatus.cpuTempC !== null ? this.state.systemStatus.cpuTempC + ' °C' : 'N/A'}</p>
                    <p><strong>Memory:</strong> {this.state.systemStatus.memUsedMB} / {this.state.systemStatus.memTotalMB} MB</p>
                    <p><strong>Disk:</strong> {this.state.systemStatus.diskUsedGB} / {this.state.systemStatus.diskTotalGB} GB</p>
                    <p><strong>Uptime:</strong> {Math.floor(this.state.systemStatus.uptimeSec / 3600)}h {Math.floor((this.state.systemStatus.uptimeSec % 3600) / 60)}m</p>
                  </>
                ) : <p>—</p>}
              </Card.Body>
            </Card>

            <Card className="mb-3">
              <Card.Header>
                <h5 className="mb-0">
                  Camera
                  <Badge bg={cameraBadgeVariant} className="ms-2">
                    {cameraBadgeLabel}
                  </Badge>
                </h5>
              </Card.Header>
              <Card.Body>
                <p>{videoStatus}</p>
              </Card.Body>
            </Card>

            <Card className="mb-3">
              <Card.Header>
                <h5 className="mb-0">
                  Log Conversion
                  <Badge bg={this.getStatusVariant(this.state.LogConversionStatus)} className="ms-2">
                    {this.state.LogConversionStatus === 'N/A' ? 'N/A' : (this.state.LogConversionStatus.includes('Active') ? 'Active' : 'Inactive')}
                  </Badge>
                </h5>
              </Card.Header>
              <Card.Body>
                <p>{this.state.LogConversionStatus}</p>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </div>
    )
  }
}

export default Home
