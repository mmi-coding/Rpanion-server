import { Route, Routes, NavLink, useLocation, Navigate } from 'react-router-dom'
import React, { useState, useEffect, Suspense, lazy } from 'react'
import Spinner from 'react-bootstrap/Spinner'

// Home stays eager: it is the landing page, so lazy-loading it would only add
// a round-trip to first paint. Every other page is code-split (React.lazy →
// its own Vite chunk) so the initial download over a slow LTE link carries
// just the shell + Home instead of all ~30 pages.
import Home from './home.jsx'

// Exported for tests: resolving every importer proves each route's dynamic
// import path is valid (a typo here would otherwise only fail at runtime,
// when the operator first navigates to the broken page).
export const pageImporters = {
  about: () => import('./about.jsx'),
  networkconfig: () => import('./networkconfig.jsx'),
  video: () => import('./video.jsx'),
  flightcontroller: () => import('./flightcontroller.jsx'),
  logBrowser: () => import('./logBrowser.jsx'),
  networkClients: () => import('./networkClients.jsx'),
  ntripcontroller: () => import('./ntripcontroller.jsx'),
  adhocwifi: () => import('./adhocwifi.jsx'),
  cloud: () => import('./cloud.jsx'),
  vpnconfig: () => import('./vpnconfig.jsx'),
  wireguardhub: () => import('./wireguardhub.jsx'),
  tailscale: () => import('./tailscale.jsx'),
  ddns: () => import('./ddns.jsx'),
  networkpriority: () => import('./networkpriority.jsx'),
  logout: () => import('./logout.jsx'),
  userManagement: () => import('./userManagement.jsx'),
  ppp: () => import('./ppp.jsx'),
  cameraswitcher: () => import('./cameraswitcher.jsx'),
  secondarystreams: () => import('./secondarystreams.jsx'),
  hudeditor: () => import('./hudeditor.jsx'),
  pipelineeditor: () => import('./pipelineeditor.jsx'),
  ltemodem: () => import('./ltemodem.jsx'),
  cellulartuning: () => import('./cellulartuning.jsx'),
  telemetryinjector: () => import('./telemetryinjector.jsx'),
  mavinspector: () => import('./mavinspector.jsx'),
  fcconfig: () => import('./fcconfig.jsx')
}

const About = lazy(pageImporters.about)
const NetworkConfig = lazy(pageImporters.networkconfig)
const VideoPage = lazy(pageImporters.video)
const FCConfig = lazy(pageImporters.flightcontroller)
const LogBrowser = lazy(pageImporters.logBrowser)
const NetworkClients = lazy(pageImporters.networkClients)
const NTRIPPage = lazy(pageImporters.ntripcontroller)
const AdhocConfig = lazy(pageImporters.adhocwifi)
const CloudConfig = lazy(pageImporters.cloud)
const VPN = lazy(pageImporters.vpnconfig)
const WireguardHubPage = lazy(pageImporters.wireguardhub)
const TailscalePage = lazy(pageImporters.tailscale)
const DDNSPage = lazy(pageImporters.ddns)
const NetworkPriorityPage = lazy(pageImporters.networkpriority)
const Logout = lazy(pageImporters.logout)
const UserManagement = lazy(pageImporters.userManagement)
const PPPPage = lazy(pageImporters.ppp)
const CameraSwitcherPage = lazy(pageImporters.cameraswitcher)
const SecondaryStreamsPage = lazy(pageImporters.secondarystreams)
const HudEditorPage = lazy(pageImporters.hudeditor)
const PipelineEditorPage = lazy(pageImporters.pipelineeditor)
const LTEModemPage = lazy(pageImporters.ltemodem)
const CellularTuningPage = lazy(pageImporters.cellulartuning)
const TelemetryInjectorPage = lazy(pageImporters.telemetryinjector)
const MavInspectorPage = lazy(pageImporters.mavinspector)
const FCConfigPage = lazy(pageImporters.fcconfig)

// Shown while a code-split page chunk downloads (matches basePage's spinner).
function PageLoading () {
  return (
    <div className="text-center mt-4">
      <Spinner animation="border" role="status" />
      <p><span className="sr-only">Loading...</span></p>
    </div>
  )
}

// Sidebar navigation. Home is a standalone top item; the rest are grouped into
// collapsible categories. `code` is the short "waypoint" tag shown when the rail
// is collapsed (via CSS data-code); `end` marks an exact-match route (Home only).
const NAV_HOME = { to: '/', code: 'HOM', label: 'Home', end: true }
const NAV_GROUPS = [
  { id: 'flight', label: 'Flight', items: [
    { to: '/controller', code: 'FC', label: 'Flight Controller' },
    { to: '/fcconfig', code: 'CFG', label: 'FC Configuration' },
    { to: '/mavinspector', code: 'MAV', label: 'MAVLink Inspector' },
    { to: '/ntrip', code: 'NTR', label: 'NTRIP Config' },
    { to: '/telemetryinjector', code: 'TEL', label: 'Telemetry Injector' },
  ] },
  { id: 'logs', label: 'Logs & Media', items: [
    { to: '/flightlogs', code: 'LOG', label: 'Flight Logs and Media' },
    { to: '/cloud', code: 'CLD', label: 'Cloud Upload' },
  ] },
  { id: 'camera', label: 'Camera & Video', items: [
    { to: '/video', code: 'VID', label: 'Photo and Video' },
    { to: '/secondarystreams', code: 'SEC', label: 'Secondary Streams' },
    { to: '/hudeditor', code: 'HUD', label: 'HUD Editor' },
    { to: '/cameraswitcher', code: 'CAM', label: 'Camera Switcher' },
    { to: '/pipelineeditor', code: 'PIP', label: 'Video Pipeline Editor' },
    { to: '/cellulartuning', code: 'CVT', label: 'Cellular Video Tuning' },
  ] },
  { id: 'network', label: 'Network', items: [
    { to: '/network', code: 'NET', label: 'Network Config' },
    { to: '/networkpriority', code: 'NPR', label: 'Network Priority' },
    { to: '/adhoc', code: 'ADH', label: 'Adhoc Wifi Config' },
    { to: '/apclients', code: 'AP', label: 'Access Point Clients' },
    { to: '/ltemodem', code: 'LTE', label: 'LTE Modem' },
    { to: '/ppp', code: 'PPP', label: 'PPP Config' },
  ] },
  { id: 'vpn', label: 'VPN & DDNS', items: [
    { to: '/vpn', code: 'VPN', label: 'VPN Config' },
    { to: '/wireguardhub', code: 'WG', label: 'WireGuard Hub' },
    { to: '/tailscale', code: 'TS', label: 'Tailscale VPN' },
    { to: '/ddns', code: 'DNS', label: 'Dynamic DNS' },
  ] },
  { id: 'system', label: 'System', items: [
    { to: '/about', code: 'ABT', label: 'About' },
    { to: '/users', code: 'USR', label: 'User Management' },
  ] },
]

function AppRouter () {
  const [isAuthenticated, setIsAuthenticated] = useState(null)
  const [isAuthEnabled, setIsAuthEnabled] = useState(true)
  const [role, setRole] = useState(null)
  // S1: server reports when the default/auto-generated admin password is still
  // in use so we can nag the operator to change it.
  const [mustChangePassword, setMustChangePassword] = useState(false)
  // Sidebar starts expanded on desktop, collapsed (off-canvas drawer) on phones.
  const [navOpen, setNavOpen] = useState(() => window.matchMedia('(min-width: 768px)').matches)
  // Theme is read from the attribute the index.html bootstrap script already set.
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-bs-theme') || 'dark')
  const location = useLocation()

  // Nav categories are expanded by default; the user can collapse any of them.
  const [openGroups, setOpenGroups] = useState(() => new Set(NAV_GROUPS.map(g => g.id)))

  const toggleNav = () => setNavOpen(open => !open)
  const toggleTheme = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'))
  const toggleGroup = (id) => setOpenGroups(prev => {
    const next = new Set(prev)
    if (next.has(id)) { next.delete(id) } else { next.add(id) }
    return next
  })
  // On phones the sidebar is an off-canvas drawer; tapping a nav link closes it.
  const closeNavOnMobile = () => { if (!window.matchMedia('(min-width: 768px)').matches) setNavOpen(false) }

  // Apply + persist the light/dark choice whenever it changes.
  useEffect(() => {
    document.documentElement.setAttribute('data-bs-theme', theme)
    localStorage.setItem('gs-theme', theme)
  }, [theme])

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
        setMustChangePassword(data?.mustChangePassword === true)
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
    <>
      {isAuthenticated && mustChangePassword && (
        <div id="default-pw-banner" className="alert alert-warning mb-0 rounded-0 text-center" role="alert">
          <strong>Security:</strong> the admin account is still using the default password.{' '}
          <NavLink to="/users">Change it now</NavLink> to secure this aircraft.
        </div>
      )}
      <div id="wrapper" className={`d-flex${navOpen ? '' : ' gs-collapsed'}`}>
      <div id="sidebar-wrapper">
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
            onClick={toggleNav}
          >☰</button>
        </div>
        <div id="sidebar-items" className="list-group list-group-flush">
          <NavLink
            end={NAV_HOME.end}
            to={NAV_HOME.to}
            data-code={NAV_HOME.code}
            title={NAV_HOME.label}
            onClick={closeNavOnMobile}
            className='list-group-item list-group-item-action'
          >{NAV_HOME.label}</NavLink>
          {NAV_GROUPS.map(group => {
            const open = openGroups.has(group.id)
            return (
              <div className={`gs-navgroup${open ? '' : ' gs-navgroup--closed'}`} key={group.id}>
                <button
                  type="button"
                  className="gs-navgroup-header"
                  aria-expanded={open}
                  onClick={() => toggleGroup(group.id)}
                >
                  <span className="gs-navgroup-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
                  <span className="gs-navgroup-label">{group.label}</span>
                </button>
                <div className="gs-navgroup-items">
                  {group.items.map(item => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      data-code={item.code}
                      title={item.label}
                      onClick={closeNavOnMobile}
                      className='list-group-item list-group-item-action'
                    >{item.label}</NavLink>
                  ))}
                </div>
              </div>
            )
          })}
          {isAuthEnabled && (
            <NavLink onClick={closeNavOnMobile} data-code="OUT" title="Logout" className='list-group-item list-group-item-action' to="/logoutconfirm">Logout</NavLink>
          )}
        </div>
        <div id="sidebar-footer">
          <button id="gs-themetoggle" type="button" aria-label="Toggle light/dark theme" onClick={toggleTheme}>
            <span className="gs-themeicon" aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
            <span className="gs-themelabel">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
          </button>
        </div>
      </div>

      <div id="gs-backdrop" aria-hidden="true" onClick={toggleNav}></div>

      <div className="page-content-wrapper" style={{ width: '100%' }}>
        <div id="gs-topbar">
          <button id="gs-menubtn" type="button" aria-label="Open navigation" onClick={toggleNav}>☰</button>
          <span className="gs-topbar-brand">Rpanion · Ground Station</span>
        </div>
        <div className="container-fluid">
          <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route exact path="/" element={<Home showLogin={!isAuthenticated} />} />
            <Route exact path="/controller" element={<FCConfig />} />
            <Route exact path="/fcconfig" element={<FCConfigPage />} />
            <Route exact path="/mavinspector" element={<MavInspectorPage />} />
            <Route exact path="/ppp" element={<PPPPage />} />
            <Route exact path="/network" element={<NetworkConfig />} />
            <Route exact path="/about" element={<About />} />
            <Route exact path="/video" element={<VideoPage />} />
            <Route exact path="/secondarystreams" element={<SecondaryStreamsPage />} />
            <Route exact path="/hudeditor" element={<HudEditorPage />} />
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
          </Suspense>
        </div>
      </div>
      </div>
    </>
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
