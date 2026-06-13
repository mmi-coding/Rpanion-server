import { Route, Routes, Link, useLocation, Navigate } from 'react-router-dom'
import React, { useState, useEffect } from 'react'

import About from './about.jsx'
import Home from './home.jsx'
import NetworkConfig from './networkconfig.jsx'
import VideoPage from './video.jsx'
import FCConfig from './flightcontroller.jsx'
import LogBrowser from './logBrowser.jsx'
import NetworkClients from './networkClients.jsx'
import NTRIPPage from './ntripcontroller.jsx'
import AdhocConfig from './adhocwifi.jsx'
import CloudConfig from './cloud.jsx'
import VPN from './vpnconfig.jsx'
import TailscalePage from './tailscale.jsx'
import DDNSPage from './ddns.jsx'
import NetworkPriorityPage from './networkpriority.jsx'
import Logout from './logout.jsx'
import UserManagement from './userManagement.jsx'
import PPPPage from './ppp.jsx'
import CameraSwitcherPage from './cameraswitcher.jsx'
import PipelineEditorPage from './pipelineeditor.jsx'
import LTEModemPage from './ltemodem.jsx'
import CellularTuningPage from './cellulartuning.jsx'

function AppRouter () {
  const [isAuthenticated, setIsAuthenticated] = useState(null)
  const [isAuthEnabled, setIsAuthEnabled] = useState(true)
  const [role, setRole] = useState(null)
  const location = useLocation()

  useEffect(() => {
    // Check authentication on mount and when location changes
    const tokenString = localStorage.getItem('token')
    const userToken = JSON.parse(tokenString)
    const token = userToken?.token

    fetch('/api/auth', {
      method: 'POST',
      headers: token
        ? { Authorization: `Bearer ${token}` }
        : {}, // always try the /api/auth endpoint, even with no token: maybe DISABLE_AUTH is set
    })
    .then(async (response) => {      
      if (!response.ok) {
        setIsAuthenticated(false)
      } else {
        setIsAuthenticated(true)

        const data = await response.json()
        if (data?.authEnabled === false) {
          setIsAuthEnabled(false)
        }
        setRole(data?.role ?? null)
      }
    })
    .catch(() => {
      setIsAuthenticated(false)
    })
  }, [location.pathname])

  // Show nothing while checking authentication
  if (isAuthenticated === null) {
    return null
  }

  // If not authenticated and not on home page, redirect to home
  if (!isAuthenticated && location.pathname !== '/') {
    return <Navigate to="/" replace />
  }

  return (
    <div id="wrapper" className="d-flex">
      <div id="sidebar-wrapper" className="bg-light border-right">
        <div id="sidebarheading" className="sidebar-heading">Rpanion Web UI{role === 'readonly' && <span id="readonly-badge" className="badge bg-secondary" style={{ marginLeft: '6px', fontSize: '0.6em', verticalAlign: 'middle' }}>read-only</span>}</div>
        <div id="sidebar-items" className="list-group list-group-flush">
          <Link className='list-group-item list-group-item-action bg-light' to="/">Home</Link>
          <Link className='list-group-item list-group-item-action bg-light' to="/flightlogs">Flight Logs and Media</Link>
          <Link className='list-group-item list-group-item-action bg-light' to="/controller">Flight Controller</Link>
          <Link className='list-group-item list-group-item-action bg-light' to="/ppp">PPP Config</Link>
          <Link className='list-group-item list-group-item-action bg-light' to="/ntrip">NTRIP Config</Link>
          <Link className='list-group-item list-group-item-action bg-light' to="/network">Network Config</Link>
          <Link className='list-group-item list-group-item-action bg-light' to="/adhoc">Adhoc Wifi Config</Link>
          <Link className='list-group-item list-group-item-action bg-light' to="/apclients">Access Point Clients</Link>
          <Link className='list-group-item list-group-item-action bg-light' to="/video">Photo and Video</Link>
          <Link className='list-group-item list-group-item-action bg-light' to="/cameraswitcher">Camera Switcher</Link>
          <Link className='list-group-item list-group-item-action bg-light' to="/pipelineeditor">Video Pipeline Editor</Link>
          <Link className='list-group-item list-group-item-action bg-light' to="/ltemodem">LTE Modem</Link>
          <Link className='list-group-item list-group-item-action bg-light' to="/cellulartuning">Cellular Video Tuning</Link>
          <Link className='list-group-item list-group-item-action bg-light' to="/cloud">Cloud Upload</Link>
          <Link className='list-group-item list-group-item-action bg-light' to="/vpn">VPN Config</Link>
          <Link className='list-group-item list-group-item-action bg-light' to="/tailscale">Tailscale VPN</Link>
          <Link className='list-group-item list-group-item-action bg-light' to="/ddns">Dynamic DNS</Link>
          <Link className='list-group-item list-group-item-action bg-light' to="/networkpriority">Network Priority</Link>
          <Link className='list-group-item list-group-item-action bg-light' to="/about">About</Link>
          <Link className='list-group-item list-group-item-action bg-light' to="/users">User Management</Link>
          {isAuthEnabled && (
            <Link className='list-group-item list-group-item-action bg-light' to="/logoutconfirm">Logout</Link>
          )}
        </div>
      </div>

      <div className="page-content-wrapper" style={{ width: '100%' }}>
        <div className="container-fluid">
          <Routes>
            <Route exact path="/" element={<Home showLogin={!isAuthenticated} />} />
            <Route exact path="/controller" element={<FCConfig />} />
            <Route exact path="/ppp" element={<PPPPage />} />
            <Route exact path="/network" element={<NetworkConfig />} />
            <Route exact path="/about" element={<About />} />
            <Route exact path="/video" element={<VideoPage />} />
            <Route exact path="/cameraswitcher" element={<CameraSwitcherPage />} />
            <Route exact path="/pipelineeditor" element={<PipelineEditorPage />} />
            <Route exact path="/ltemodem" element={<LTEModemPage />} />
            <Route exact path="/cellulartuning" element={<CellularTuningPage />} />
            <Route exact path="/flightlogs" element={<LogBrowser />} />
            <Route exact path="/apclients" element={<NetworkClients />} />
            <Route exact path="/ntrip" element={<NTRIPPage />} />
            <Route exact path="/adhoc" element={<AdhocConfig />} />
            <Route exact path="/cloud" element={<CloudConfig />} />
            <Route exact path="/vpn" element={<VPN/>} />
            <Route exact path="/tailscale" element={<TailscalePage/>} />
            <Route exact path="/ddns" element={<DDNSPage/>} />
            <Route exact path="/networkpriority" element={<NetworkPriorityPage/>} />
            {isAuthEnabled && (
              <Route path="/logoutconfirm" element={<Logout />} />
            )}
            <Route exact path="/users" element={<UserManagement/>} />
            <Route path="*" element={<NoMatch />} />
          </Routes>
        </div>
      </div>
    </div>
  )
}

function NoMatch () {
  const location = useLocation();
  return (
    <div>
    <h1>404 - Page Not Found</h1>
    <p>The URL <code>{location.pathname}</code> does not exist.</p>
  </div>
  )
}

export default AppRouter
