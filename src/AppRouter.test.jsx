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

describe('#AppRouter()', function () {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
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
