import React from 'react'
import Modal from 'react-bootstrap/Modal';
import Button from 'react-bootstrap/Button';

import basePage from './basePage.jsx'
import { HelpTip, HelpSection } from './components/Help.jsx'

class AboutPage extends basePage {
  constructor (props, useSocketIO = true) {
    super(props, useSocketIO)
    this.state = {
      ...this.state,
      OSVersion: '',
      Nodejsversion: '',
      rpanionversion: '',
      CPUName: '',
      RAMName: '',
      SYSName: '',
      HATName: {},
      diskSpaceStatus: '',
      showModal: false,
      showModalResult: "",
      showResetModal: false,
      resetMessage: "",
      restoreMessage: ""
    }

  }

  componentDidMount () {
    fetch('/api/softwareinfo', {headers: {Authorization: `Bearer ${this.state.token}`}}).then(response => response.json()).then(state => this.setState(state))
    fetch('/api/diskinfo', {headers: {Authorization: `Bearer ${this.state.token}`}}).then(response => response.json()).then(state => this.setState(state))
    fetch('/api/hardwareinfo', {headers: {Authorization: `Bearer ${this.state.token}`}}).then(response => response.json()).then(state => { this.setState(state); this.loadDone() })
  }

  confirmShutdown = () => {
    //user clicked the shutdown button
    // modal events take it from here
    this.setState({ showModal: true });
  }

  handleCloseModal = () => {
    // user does not want to shutdown
    this.setState({ showModal: false});
  }

  handleShutdown = () => {
    // user does want to shutdown
    this.setState({ showModal: false});
    fetch('/api/shutdowncc', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.state.token}`
      }
    });
  }

  confirmResetSettings = () => {
    // user clicked the reset settings button
    this.setState({ showResetModal: true });
  }

  handleCloseResetModal = () => {
    // user does not want to reset settings
    this.setState({ showResetModal: false, resetMessage: "" });
  }

  handleResetSettings = () => {
    // user does want to reset settings
    fetch('/api/resetsettings', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.state.token}`
      }
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        this.setState({ 
          resetMessage: data.message,
          showResetModal: false 
        });
        // Show success message for a few seconds
        setTimeout(() => {
          this.setState({ resetMessage: "" });
        }, 5000);
      } else {
        this.setState({ 
          resetMessage: data.error || 'Failed to reset settings',
          showResetModal: false 
        });
      }
    })
    .catch(error => {
      this.setState({ 
        resetMessage: 'Error resetting settings: ' + error.message,
        showResetModal: false 
      });
    });
  }

  getlogs = () => {
    // download the logs
    fetch('/api/logfile', {
      method: 'GET',
      headers: {
      'Authorization': `Bearer ${this.state.token}`
      }
    })
    .then(response => response.blob())
    .then(blob => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = 'rpanion.log';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    });
  }

  getBackup = () => {
    // download the current settings as a JSON file
    fetch('/api/settingsbackup', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.state.token}`
      }
    })
    .then(response => response.blob())
    .then(blob => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = 'rpanion-settings.json';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    });
  }

  handleRestoreFile = (event) => {
    // user selected a settings file to restore
    const file = event.target.files[0]
    if (!file) {
      return
    }
    file.text()
    .then(text => {
      const settings = JSON.parse(text)
      return fetch('/api/settingsrestore', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.state.token}`
        },
        body: JSON.stringify(settings)
      })
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        this.setState({ restoreMessage: data.message })
        setTimeout(() => {
          this.setState({ restoreMessage: "" })
        }, 5000)
      } else {
        this.setState({ restoreMessage: data.error || 'Failed to restore settings' })
      }
    })
    .catch(error => {
      this.setState({ restoreMessage: 'Error restoring settings: ' + error.message })
    })
  }

  renderTitle () {
    return 'About'
  }

  HATInfo() {
      if (this.state.HATName.product !== "") {
        return <p>Attached HAT: {this.state.HATName.product}, Vendor: {this.state.HATName.vendor}, Version: {this.state.HATName.version}</p>;
      }
      return <p></p>;
    }

  renderContent () {
    return (
      <div>
        <h2>About Hardware</h2>
        <p>System: {this.state.SYSName}</p>
        <p>CPU: {this.state.CPUName}</p>
        <p>RAM: {this.state.RAMName} GB</p>
        <p>Disk Space: {this.state.diskSpaceStatus}</p>
        {this.HATInfo()}
        <h2>About Software</h2>
        <p>OS hostname: {this.state.hostname}</p>
        <p>OS version: {this.state.OSVersion}</p>
        <p>Node.js version: {this.state.Nodejsversion}</p>
        <p>Rpanion-server version: {this.state.rpanionversion}</p>
        <h2>Logs</h2>
        <p><Button size="sm" onClick={this.getlogs}>Download Logs</Button></p>
        <h2>Controls</h2>
        <p><Button size="sm" onClick={this.confirmShutdown}>Shutdown Companion Computer</Button></p>
        <p><Button size="sm" variant="warning" onClick={this.confirmResetSettings}>Reset All Settings</Button></p>
        {this.state.resetMessage && (
          <div className="alert alert-info" role="alert">
            {this.state.resetMessage}
          </div>
        )}

        <h2>Backup &amp; Restore <HelpTip text="Save or restore this companion computer's configuration. Handy when re-flashing or cloning a device." /></h2>
        <HelpSection title="How backup & restore works">
          <p>Backup downloads <code>config/settings.json</code> (network, video, modem, NTRIP, cellular, etc.) as a file you can keep or copy to another device.</p>
          <p>Restore overwrites the current configuration from a previously downloaded file. Restart the application afterwards for changes to take effect. User accounts are managed separately and are not included.</p>
        </HelpSection>
        <p>
          <Button size="sm" onClick={this.getBackup}>Backup Settings</Button>
          <HelpTip text="Download the current settings as rpanion-settings.json." />
        </p>
        <p>
          <label className="btn btn-sm btn-primary" style={{ marginBottom: 0 }}>
            Restore Settings
            <input type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={this.handleRestoreFile} />
          </label>
          <HelpTip text="Pick a previously downloaded settings file to overwrite the current configuration. Restart the app afterwards." />
        </p>
        {this.state.restoreMessage && (
          <div className="alert alert-info" role="alert">
            {this.state.restoreMessage}
          </div>
        )}

        <Modal show={this.state.showModal} onHide={this.handleCloseModal}>
          <Modal.Header closeButton>
            <Modal.Title>Confirm Shutdown</Modal.Title>
          </Modal.Header>

          <Modal.Body>
            <p>Are you sure you want to shutdown the Companion Computer?</p>
          </Modal.Body>

          <Modal.Footer>
            <Button variant="secondary" onClick={this.handleShutdown}>Yes</Button>
            <Button variant="primary" onClick={this.handleCloseModal}>No</Button>
          </Modal.Footer>
        </Modal>

        <Modal show={this.state.showResetModal} onHide={this.handleCloseResetModal}>
          <Modal.Header closeButton>
            <Modal.Title>Confirm Reset Settings</Modal.Title>
          </Modal.Header>

          <Modal.Body>
            <p>Are you sure you want to reset all settings to defaults?</p>
            <p className="text-warning">This will clear all configuration including:</p>
            <ul>
              <li>Flight controller settings</li>
              <li>Video stream settings</li>
              <li>PPP settings</li>
              <li>NTRIP settings</li>
            </ul>
            <p className="text-danger"><strong>You will need to restart the application for changes to take effect.</strong></p>
          </Modal.Body>

          <Modal.Footer>
            <Button variant="danger" onClick={this.handleResetSettings}>Yes, Reset All Settings</Button>
            <Button variant="primary" onClick={this.handleCloseResetModal}>Cancel</Button>
          </Modal.Footer>
        </Modal>

      </div>
    )
  }
}

export default AboutPage
