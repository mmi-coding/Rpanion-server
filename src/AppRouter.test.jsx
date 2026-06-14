// @vitest-environment happy-dom
import React, { act } from 'react'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { renderPage, mockFetch } from '../test/ui.jsx'
import AppRouter from './AppRouter.jsx'

vi.mock('socket.io-client', () => import('../test/socketMock.js'))

// AppRouter uses useLocation internally so it must be wrapped in a Router.
// index.jsx wraps it in <BrowserRouter>; tests use <MemoryRouter>.
function renderRouter (initialEntries = ['/'], fetchRoutes = {}) {
  return renderPage(
    <MemoryRouter initialEntries={initialEntries}>
      <AppRouter />
    </MemoryRouter>
  )
}

// Minimal fetch routes for pages that render on landing. The Home page
// has no GET fetches (only loadDone()), so '/' is cheapest to land on.
// We need POST /api/auth for every render.
const authOk = { 'POST /api/auth': { authEnabled: true } }
const authOkNoAuth = { 'POST /api/auth': { authEnabled: false } }
const authFail = {}  // will use stubGlobal

// AppRouter reads window.matchMedia for the responsive sidebar default; stub it
// so `(min-width: 768px)` is deterministic (true = desktop, false = phone).
function stubViewport (isDesktop) {
  vi.stubGlobal('matchMedia', (query) => ({
    matches: isDesktop,
    media: query,
    onchange: null,
    addEventListener () {},
    removeEventListener () {},
    addListener () {},
    removeListener () {},
    dispatchEvent () { return false }
  }))
}

describe('#AppRouter()', function () {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-bs-theme')
    stubViewport(true) // default to desktop
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
    document.documentElement.removeAttribute('data-bs-theme')
  })

  // -------------------------------------------------------------------------
  // isAuthenticated === null → renders nothing while checking
  // -------------------------------------------------------------------------
  test('renders nothing while authentication check is pending (isAuthenticated=null)', function () {
    // Don't settle the fetch promise → stays in null state
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))) // never resolves
    const page = renderPage(
      <MemoryRouter initialEntries={['/']}>
        <AppRouter />
      </MemoryRouter>
    )
    // No sidebar, no content — null render
    expect(page.container.querySelector('#wrapper')).toBeNull()
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // isAuthenticated=true, authEnabled=true → sidebar + Logout link
  // -------------------------------------------------------------------------
  test('authenticated + authEnabled=true renders sidebar with Logout link', async function () {
    mockFetch(authOk)
    const page = renderPage(
      <MemoryRouter initialEntries={['/']}>
        <AppRouter />
      </MemoryRouter>
    )
    await page.flush()
    expect(page.container.textContent).toContain('Rpanion Web UI')
    // Logout link should be present when authEnabled
    const links = page.container.querySelectorAll('a')
    const logoutLink = [...links].find(a => a.textContent === 'Logout')
    expect(logoutLink).toBeDefined()
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // isAuthenticated=true, authEnabled=false → sidebar WITHOUT Logout link
  // -------------------------------------------------------------------------
  test('authenticated + authEnabled=false hides Logout link', async function () {
    mockFetch(authOkNoAuth)
    const page = renderPage(
      <MemoryRouter initialEntries={['/']}>
        <AppRouter />
      </MemoryRouter>
    )
    await page.flush()
    expect(page.container.textContent).toContain('Rpanion Web UI')
    const links = page.container.querySelectorAll('a')
    const logoutLink = [...links].find(a => a.textContent === 'Logout')
    expect(logoutLink).toBeUndefined()
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // RBAC: read-only role shows a badge in the sidebar heading
  // -------------------------------------------------------------------------
  test('shows a read-only badge when the auth role is readonly', async function () {
    mockFetch({ 'POST /api/auth': { authEnabled: true, role: 'readonly' } })
    const page = renderPage(
      <MemoryRouter initialEntries={['/']}>
        <AppRouter />
      </MemoryRouter>
    )
    await page.flush()
    const badge = page.container.querySelector('#readonly-badge')
    expect(badge).not.toBeNull()
    expect(badge.textContent).toContain('read-only')
    page.unmount()
  })

  test('shows no read-only badge for an admin role', async function () {
    mockFetch({ 'POST /api/auth': { authEnabled: true, role: 'admin' } })
    const page = renderPage(
      <MemoryRouter initialEntries={['/']}>
        <AppRouter />
      </MemoryRouter>
    )
    await page.flush()
    expect(page.container.querySelector('#readonly-badge')).toBeNull()
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // sidebar collapse toggle flips the gs-collapsed class + aria-expanded
  // -------------------------------------------------------------------------
  test('sidebar toggle collapses and re-expands the rail', async function () {
    mockFetch(authOk)
    const page = renderPage(
      <MemoryRouter initialEntries={['/']}>
        <AppRouter />
      </MemoryRouter>
    )
    await page.flush()
    const wrapper = page.container.querySelector('#wrapper')
    const toggle = page.container.querySelector('#sidebar-toggle')
    expect(toggle).not.toBeNull()
    // starts expanded
    expect(wrapper.className).not.toContain('gs-collapsed')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    // collapse
    page.click(toggle)
    expect(wrapper.className).toContain('gs-collapsed')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    // expand again
    page.click(toggle)
    expect(wrapper.className).not.toContain('gs-collapsed')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // nav category headers collapse and expand their items
  // -------------------------------------------------------------------------
  test('nav category headers collapse and expand', async function () {
    mockFetch(authOk)
    const page = renderPage(
      <MemoryRouter initialEntries={['/']}>
        <AppRouter />
      </MemoryRouter>
    )
    await page.flush()
    const header = page.container.querySelector('.gs-navgroup-header')
    expect(header).not.toBeNull()
    const group = header.closest('.gs-navgroup')
    // expanded by default
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(group.className).not.toContain('gs-navgroup--closed')
    // collapse
    page.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(group.className).toContain('gs-navgroup--closed')
    // expand again
    page.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(group.className).not.toContain('gs-navgroup--closed')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // light/dark theme toggle flips data-bs-theme + persists to localStorage
  // -------------------------------------------------------------------------
  test('theme toggle flips data-bs-theme and persists the choice', async function () {
    document.documentElement.setAttribute('data-bs-theme', 'light') // preset → inits to light
    mockFetch(authOk)
    const page = renderPage(
      <MemoryRouter initialEntries={['/']}>
        <AppRouter />
      </MemoryRouter>
    )
    await page.flush()
    const toggle = page.container.querySelector('#gs-themetoggle')
    expect(toggle).not.toBeNull()
    // initialised from the existing attribute
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('light')
    expect(localStorage.getItem('gs-theme')).toBe('light')
    expect(toggle.textContent).toContain('Dark mode') // offers the opposite
    // → dark
    page.click(toggle)
    await page.flush()
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark')
    expect(localStorage.getItem('gs-theme')).toBe('dark')
    expect(toggle.textContent).toContain('Light mode')
    // → back to light
    page.click(toggle)
    await page.flush()
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('light')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // mobile: starts as a closed drawer; menu button opens it, backdrop closes it
  // -------------------------------------------------------------------------
  test('mobile drawer: menu button opens, backdrop closes', async function () {
    stubViewport(false) // phone → starts collapsed (drawer closed)
    mockFetch(authOk)
    const page = renderPage(
      <MemoryRouter initialEntries={['/']}>
        <AppRouter />
      </MemoryRouter>
    )
    await page.flush()
    const wrapper = page.container.querySelector('#wrapper')
    expect(wrapper.className).toContain('gs-collapsed') // closed on load
    page.click(page.container.querySelector('#gs-menubtn'))
    expect(wrapper.className).not.toContain('gs-collapsed') // opened
    page.click(page.container.querySelector('#gs-backdrop'))
    expect(wrapper.className).toContain('gs-collapsed') // closed again
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // tapping a nav link closes the drawer on mobile, leaves it open on desktop
  // -------------------------------------------------------------------------
  test('nav tap closes the drawer on mobile only', async function () {
    stubViewport(false) // phone
    mockFetch(authOk)
    const page = renderPage(
      <MemoryRouter initialEntries={['/']}>
        <AppRouter />
      </MemoryRouter>
    )
    await page.flush()
    const wrapper = page.container.querySelector('#wrapper')
    page.click(page.container.querySelector('#gs-menubtn')) // open the drawer
    expect(wrapper.className).not.toContain('gs-collapsed')
    const homeLink = [...page.container.querySelectorAll('a')].find(a => a.textContent === 'Home')
    page.click(homeLink)
    await page.flush()
    expect(page.container.querySelector('#wrapper').className).toContain('gs-collapsed') // closed
    page.unmount()

    // desktop: tapping a link must NOT collapse the rail
    stubViewport(true)
    const page2 = renderPage(
      <MemoryRouter initialEntries={['/']}>
        <AppRouter />
      </MemoryRouter>
    )
    await page2.flush()
    const homeLink2 = [...page2.container.querySelectorAll('a')].find(a => a.textContent === 'Home')
    page2.click(homeLink2)
    await page2.flush()
    expect(page2.container.querySelector('#wrapper').className).not.toContain('gs-collapsed')
    page2.unmount()
  })

  // -------------------------------------------------------------------------
  // isAuthenticated=false at '/' → shows home (Login form via showLogin)
  // -------------------------------------------------------------------------
  test('unauthenticated at / renders Home with login form', async function () {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })))
    const page = renderPage(
      <MemoryRouter initialEntries={['/']}>
        <AppRouter />
      </MemoryRouter>
    )
    await page.flush()
    // Home renders with showLogin=true (response.ok false → setIsAuthenticated(false))
    expect(page.container.textContent).toContain('Please Log In')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // isAuthenticated=false at non-root path → Navigate to '/'
  // -------------------------------------------------------------------------
  test('unauthenticated at /about redirects to /', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      // First call from /about path auth check → fail
      return { ok: false, status: 401, json: async () => ({}) }
    }))
    const page = renderPage(
      <MemoryRouter initialEntries={['/about']}>
        <AppRouter />
      </MemoryRouter>
    )
    await page.flush()
    // Should have navigated to / showing the login form (Home showLogin=true)
    expect(page.container.textContent).toContain('Please Log In')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // fetch catch → setIsAuthenticated(false)
  // -------------------------------------------------------------------------
  test('fetch error in auth check sets isAuthenticated=false', async function () {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network error'))))
    const page = renderPage(
      <MemoryRouter initialEntries={['/']}>
        <AppRouter />
      </MemoryRouter>
    )
    await page.flush()
    // isAuthenticated=false at '/' → renders Home showLogin=true
    expect(page.container.textContent).toContain('Please Log In')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // NoMatch route → 404 for unknown path
  // -------------------------------------------------------------------------
  test('unknown path renders 404 NoMatch component', async function () {
    mockFetch(authOk)
    const page = renderPage(
      <MemoryRouter initialEntries={['/nonexistent-path-xyz']}>
        <AppRouter />
      </MemoryRouter>
    )
    await page.flush()
    expect(page.container.textContent).toContain('404')
    expect(page.container.textContent).toContain('/nonexistent-path-xyz')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // authEnabled=true → /logoutconfirm route renders Logout page
  // -------------------------------------------------------------------------
  test('authenticated + authEnabled=true: /logoutconfirm route renders Logout page', async function () {
    mockFetch({
      'POST /api/auth': { authEnabled: true }
    })
    const page = renderPage(
      <MemoryRouter initialEntries={['/logoutconfirm']}>
        <AppRouter />
      </MemoryRouter>
    )
    await page.flush()
    // Logout page renders a logout button
    expect(page.container.textContent).toContain('Confirm Logout')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // authEnabled=false → /logoutconfirm not present → NoMatch 404
  // -------------------------------------------------------------------------
  test('authEnabled=false: /logoutconfirm falls through to NoMatch', async function () {
    mockFetch(authOkNoAuth)
    const page = renderPage(
      <MemoryRouter initialEntries={['/logoutconfirm']}>
        <AppRouter />
      </MemoryRouter>
    )
    await page.flush()
    // Route not rendered because isAuthEnabled=false → NoMatch shows 404
    expect(page.container.textContent).toContain('404')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // token in localStorage is sent with auth request
  // -------------------------------------------------------------------------
  test('sends token from localStorage in auth POST', async function () {
    localStorage.setItem('token', JSON.stringify({ token: 'mytoken123' }))
    let capturedOpts = null
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      capturedOpts = opts
      return { ok: true, status: 200, json: async () => ({ authEnabled: true }) }
    }))
    const page = renderPage(
      <MemoryRouter initialEntries={['/']}>
        <AppRouter />
      </MemoryRouter>
    )
    await page.flush()
    expect(capturedOpts.headers).toMatchObject({ Authorization: 'Bearer mytoken123' })
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // no token → empty headers object sent
  // -------------------------------------------------------------------------
  test('sends empty headers when no token in localStorage', async function () {
    let capturedOpts = null
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      capturedOpts = opts
      return { ok: true, status: 200, json: async () => ({ authEnabled: true }) }
    }))
    const page = renderPage(
      <MemoryRouter initialEntries={['/']}>
        <AppRouter />
      </MemoryRouter>
    )
    await page.flush()
    expect(capturedOpts.headers).toEqual({})
    page.unmount()
  })
})
