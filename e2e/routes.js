// Shared route metadata for the web UI e2e suite.
//
//   path  - URL path
//   nav   - exact sidebar link text (src/AppRouter.jsx)
//   title - page <h1> rendered by basePage.renderTitle (src/basePage.jsx)
//
// Captured by exploring the live dev stack; see specs/webui-e2e-plan.md.
export const ROUTES = [
  { path: '/', nav: 'Home', title: 'System Status Overview' },
  { path: '/flightlogs', nav: 'Flight Logs and Media', title: 'Flight Log and Media Browser' },
  { path: '/controller', nav: 'Flight Controller', title: 'Flight Controller' },
  { path: '/ppp', nav: 'PPP Config', title: 'PPP Configuration' },
  { path: '/ntrip', nav: 'NTRIP Config', title: 'NTRIP Configuration' },
  { path: '/network', nav: 'Network Config', title: 'Network Configuration' },
  { path: '/adhoc', nav: 'Adhoc Wifi Config', title: 'Adhoc Wifi Config' },
  { path: '/apclients', nav: 'Access Point Clients', title: 'Access Point Clients' },
  { path: '/video', nav: 'Photo and Video', title: 'Photo and Video' },
  { path: '/cameraswitcher', nav: 'Camera Switcher', title: 'Camera Switcher' },
  { path: '/pipelineeditor', nav: 'Video Pipeline Editor', title: 'Video Pipeline Editor' },
  { path: '/ltemodem', nav: 'LTE Modem', title: 'LTE Modem' },
  { path: '/cellulartuning', nav: 'Cellular Video Tuning', title: 'Cellular Video Tuning' },
  { path: '/cloud', nav: 'Cloud Upload', title: 'Cloud Upload' },
  { path: '/vpn', nav: 'VPN Config', title: 'VPN' },
  { path: '/tailscale', nav: 'Tailscale VPN', title: 'Tailscale VPN' },
  { path: '/ddns', nav: 'Dynamic DNS', title: 'Dynamic DNS' },
  { path: '/about', nav: 'About', title: 'About' },
  { path: '/users', nav: 'User Management', title: 'User Management' },
]

// Fork-added/-modified pages that must follow the self-documenting UI rule
// (docs/UI-GUIDELINES.md): a collapsed HelpSection plus HelpTips on controls.
export const SELF_DOCUMENTING_PAGES = [
  { path: '/cameraswitcher', title: 'Camera Switcher' },
  { path: '/cellulartuning', title: 'Cellular Video Tuning' },
  { path: '/ltemodem', title: 'LTE Modem' },
  { path: '/pipelineeditor', title: 'Video Pipeline Editor' },
  { path: '/users', title: 'User Management' },
  { path: '/tailscale', title: 'Tailscale VPN' },
  { path: '/ddns', title: 'Dynamic DNS' },
]
