import { Component} from 'react';
import { getAppSocket } from './appSocket.js';
import SocketIOFooter from './footerSocketIO';
import Modal from 'react-bootstrap/Modal';
import Button from 'react-bootstrap/Button';
import Spinner from 'react-bootstrap/Spinner';
import React from 'react'
import Login from './login.jsx'
import PropTypes from 'prop-types';

class basePage extends Component {
  constructor(props, useSocketIO = false) {
    super(props);
    this.state = {
      loading: true,
      waiting: false,
      socketioStatus: false,
      usedSocketIO: useSocketIO,
      token: null,
      error: null,
      infoMessage: null,
    }

    // read the stored auth token. AppRouter already verifies it against
    // /api/auth on every navigation — re-verifying here doubled the auth
    // round-trips per page change; an invalid token just 401s the page's own
    // fetches and AppRouter redirects to the login screen.
    const tokenString = localStorage.getItem('token')
    const userToken = JSON.parse(tokenString)
    this.state.token = userToken?.token

    if (this.state.usedSocketIO) {
      // shared app-level connection (see appSocket.js) — pages register their
      // listeners on it and remove them on unmount, no reconnect per page
      this.socket = getAppSocket(this.state.token)
      // an already-open shared socket fires no new 'connect' event
      this.state.socketioStatus = this.socket.connected === true

      // Socket.io client
      this.socket.on('disconnect', function () {
        console.log('Disconnected');
        this.setState({ socketioStatus: false });
      }.bind(this));
      this.socket.on('connect', function () {
        console.log('Connected');
        this.setState({ socketioStatus: true });
      }.bind(this));
    }
  }

  loadDone() {
    this.setState({ loading: false });
  }

  componentWillUnmount() {
    if (this.state.usedSocketIO) {
      // The socket is shared: remove every listener this page registered
      // (its own .on(...) handlers plus basePage's connect/disconnect) but
      // keep the connection open for the next page. Only one page is mounted
      // at a time, so a blanket removeAllListeners cannot clobber anyone.
      this.socket.removeAllListeners();
    }
  }


  handleCloseError = () => {
    // user has closed the error window
    this.setState({ error: null });
  }

  handleCloseInformation = () => {
    // user has closed the information window
    this.setState({ infoMessage: null });
  }

  // Generic controlled-form handler for pages that keep editable form values in
  // a `config` state object (checkbox → checked, everything else → value).
  handleConfigChange = (event) => {
    const name = event.target.name;
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    this.setState(prevState => ({
      config: {
        ...prevState.config,
        [name]: value
      }
    }));
  }

  render() {
    if(this.props.showLogin) {
      return (
        <div>
          <title>{this.renderTitle()}</title>
          <h1>{this.renderTitle()}</h1>
          <div className='pagedetails' style={{ display: (this.state.loading) ? "none" : "block" }}>
            <Login />
          </div>
        </div>
      )
    } else {
      return (
        <div>
          <title>{this.renderTitle()}</title>
          <h1>{this.renderTitle()}</h1>
          <div style={{ display: (this.state.loading) ? "block" : "none" }}>
            <Spinner animation="border" role="status" >
            </Spinner>
            <p><span className="sr-only" size={35}>Loading...</span></p>
          </div>

          <div className='sweet-waiting' style={{ display: (this.state.waiting) ? "block" : "none", "textAlign": "center", "position": "fixed", "width": "100%", "height": "100%", "top": "0", "left": "0", "right": "0", "bottom": "0", "zIndex": "9", "backgroundColor": "rgba(65,117,5,0.5)" }}>
            <Spinner style={{ "position": "absolute", "top": "45%", "left": "50%" }} animation="border" role="status">
            </Spinner>
            <h2 style={{ "position": "absolute", "top": "65%", "left": "40%", "msTransform": "translateY(-50%)", "transform": "translateY(-50%)" }}>Submitting Changes</h2>
          </div>

          <div className='pagedetails' style={{ display: (this.state.loading) ? "none" : "block" }}>
            {this.renderContent()}
          </div>
          <Modal show={this.state.error !== null} onHide={this.handleCloseError}>
            <Modal.Header closeButton>
              <Modal.Title>Error</Modal.Title>
            </Modal.Header>

            <Modal.Body>
              <p>{this.state.error}</p>
            </Modal.Body>

            <Modal.Footer>
              <Button variant="primary" onClick={this.handleCloseError}>OK</Button>
            </Modal.Footer>
          </Modal>

          <Modal show={this.state.infoMessage !== null} onHide={this.handleCloseInformation}>
            <Modal.Header closeButton>
              <Modal.Title>Information</Modal.Title>
            </Modal.Header>

            <Modal.Body>
              <p>{this.state.infoMessage}</p>
            </Modal.Body>

            <Modal.Footer>
              <Button variant="primary" onClick={this.handleCloseInformation}>OK</Button>
            </Modal.Footer>
          </Modal>
          <div>
            {this.state.usedSocketIO ? (
              <SocketIOFooter socketioStatus={this.state.socketioStatus} />
            ) : (<p></p>
            )}
          </div>
        </div>
      );
    }
  }

}

// PropTypes validation
basePage.propTypes = {
  showLogin: PropTypes.bool,
}

export default basePage;

