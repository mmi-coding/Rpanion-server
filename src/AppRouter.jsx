import { Route, Routes, NavLink, useLocation, Navigate } from 'react-router-dom'
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
import WireguardHubPage from './wireguardhub.jsx'
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
import TelemetryInjectorPage from './telemetryinjector.jsx'

// Sidebar navigation. `code` is the short "waypoint" tag shown when the rail is
// collapsed (via CSS data-code); `end` marks an exact-match route (Home only).
const NAV = [
  { to: '/', code: 'HOM', label: 'Home', end: true },
  { to: '/flightlogs', code: 'LOG', label: 'Flight Logs and Media' },
  { to: '/controller', code: 'FC', label: 'Flight Controller' },
  { to: '/ppp', code: 'PPP', label: 'PPP Config' },
  { to: '/ntrip', code: 'NTR', label: 'NTRIP Config' },
  { to: '/network', code: 'NET', label: 'Network Config' },
  { to: '/adhoc', code: 'ADH', label: 'Adhoc Wifi Config' },
  { to: '/apclients', code: 'AP', label: 'Access Point Clients' },
  { to: '/video', code: 'VID', label: 'Photo and Video' },
  { to: '/cameraswitcher', code: 'CAM', label: 'Camera Switcher' },
  { to: '/pipelineeditor', code: 'PIP', label: 'Video Pipeline Editor' },
  { to: '/ltemodem', code: 'LTE', label: 'LTE Modem' },
  { to: '/cellulartuning', code: 'CVT', label: 'Cellular Video Tuning' },
  { to: '/telemetryinjector', code: 'TEL', label: 'Telemetry Injector' },
  { to: '/cloud', code: 'CLD', label: 'Cloud Upload' },
  { to: '/vpn', code: 'VPN', label: 'VPN Config' },
  { to: '/wireguardhub', code: 'WG', label: 'WireGuard Hub' },
  { to: '/tailscale', code: 'TS', label: 'Tailscale VPN' },
  { to: '/ddns', code: 'DNS', label: 'Dynamic DNS' },
  { to: '/networkpriority', code: 'NPR', label: 'Network Priority' },
  { to: '/about', code: 'ABT', label: 'About' },
  { to: '/users', code: 'USR', label: 'User Management' },
]

function AppRouter () {
  const [isAuthenticated, setIsAuthenticated] = useState(null)
  const [isAuthEnabled, setIsAuthEnabled] = useState(true)
  const [role, setRole] = useState(null)
  const [navOpen, setNavOpen] = useState(true)
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
    <div id="wrapper" className={`d-flex${navOpen ? '' : ' gs-collapsed'}`}>
      <div id="sidebar-wrapper" className="bg-light border-right">
        <div id="sidebarheading" className="sidebar-heading">
          <span className="gs-pip" aria-hidden="true"></span>
          <span className="gs-brand">
            <span className="gs-brand-name">Rpanion Web UI{role === 'readonly' && <span id="readonly-badge" className="badge bg-secondary" style={{ marginLeft: '6px', fontSize: '0.6em', verticalAlign: 'middle' }}>read-only</span>}</span>
            <span className="gs-brand-sub" aria-hidden="true">COMPANION · LTE · GCS</span>
          </span>
          <button
            id="sidebar-toggle"
            type="button"
            aria-label="Toggle navigation"
            aria-expanded={navOpen}
            onClick={() => setNavOpen(open => !open)}
          >☰</button>
        </div>
        <div id="sidebar-items" className="list-group list-group-flush">
          {NAV.map(item => (
            <NavLink
              key={item.to}
              end={item.end}
              to={item.to}
              data-code={item.code}
              title={item.label}
              className='list-group-item list-group-item-action bg-light'
            >{item.label}</NavLink>
          ))}
          {isAuthEnabled && (
            <NavLink data-code="OUT" title="Logout" className='list-group-item list-group-item-action bg-light' to="/logoutconfirm">Logout</NavLink>
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
            <Route exact path="/telemetryinjector" element={<TelemetryInjectorPage />} />
            <Route exact path="/flightlogs" element={<LogBrowser />} />
            <Route exact path="/apclients" element={<NetworkClients />} />
            <Route exact path="/ntrip" element={<NTRIPPage />} />
            <Route exact path="/adhoc" element={<AdhocConfig />} />
            <Route exact path="/cloud" element={<CloudConfig />} />
            <Route exact path="/vpn" element={<VPN/>} />
            <Route exact path="/wireguardhub" element={<WireguardHubPage/>} />
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
