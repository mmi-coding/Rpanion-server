// @vitest-environment happy-dom
import React, { act } from 'react'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'

import { renderPage, mockFetch } from '../test/ui.jsx'
import DDNSPage from './ddns.jsx'

vi.mock('socket.io-client', () => import('../test/socketMock.js'))

const duckdns = {
  settings: { enabled: false, provider: 'duckdns', hostname: 'mypi', token: 'tok', username: '', hasPassword: false, intervalMin: 5 },
  status: { status: 'Disabled', lastIp: null, lastUpdate: null }
}
const noip = {
  settings: { enabled: true, provider: 'noip', hostname: 'h', token: '', username: 'u', hasPassword: true, intervalMin: 10 },
  status: { status: 'Success', lastIp: '203.0.113.7', lastUpdate: '2026-06-13T00:00:00Z' }
}

describe('#DDNSPage()', function () {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

  test('renders title "Dynamic DNS"', async function () {
    mockFetch({ '/api/ddns': duckdns })
    const page = renderPage(<DDNSPage />)
    await page.flush()
    expect(page.container.textContent).toContain('Dynamic DNS')
    page.unmount()
  })

  test('renders DuckDNS fields (token) and status', async function () {
    mockFetch({ '/api/ddns': duckdns })
    const page = renderPage(<DDNSPage />)
    await page.flush()
    expect(page.container.querySelector('input[name="ddnsToken"]')).not.toBeNull()
    expect(page.container.querySelector('input[name="username"]')).toBeNull()
    expect(page.container.textContent).toContain('Last result: Disabled')
    page.unmount()
  })

  test('renders No-IP fields (username/password) and success status', async function () {
    mockFetch({ '/api/ddns': noip })
    const page = renderPage(<DDNSPage />)
    await page.flush()
    expect(page.container.querySelector('input[name="username"]')).not.toBeNull()
    expect(page.container.querySelector('input[name="password"]')).not.toBeNull()
    expect(page.container.textContent).toContain('Last result: Success')
    expect(page.container.textContent).toContain('203.0.113.7')
    page.unmount()
  })

  test('exposes HelpTips and a HelpSection', async function () {
    mockFetch({ '/api/ddns': duckdns })
    const page = renderPage(<DDNSPage />)
    await page.flush()
    expect(page.container.querySelectorAll('[aria-label="help"]').length).toBeGreaterThan(0)
    expect(page.container.querySelector('a[role="button"][aria-expanded]')).not.toBeNull()
    page.unmount()
  })

  test('toggling enable and switching provider updates the form', async function () {
    mockFetch({ '/api/ddns': duckdns })
    const page = renderPage(<DDNSPage />)
    await page.flush()
    // toggle the enabled checkbox (covers the checkbox branch of handleChange)
    const enabled = page.container.querySelector('input[name="enabled"]')
    act(() => { enabled.click() })
    await page.flush()
    expect(enabled.checked).toBe(true)
    // switch provider to no-ip → username/password fields appear
    const provider = page.container.querySelector('select[name="provider"]')
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
      setter.call(provider, 'noip')
      provider.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await page.flush()
    expect(page.container.querySelector('input[name="username"]')).not.toBeNull()
    page.unmount()
  })

  test('Save POSTs to /api/ddnsmodify', async function () {
    const fetch = mockFetch({
      '/api/ddns': duckdns,
      'POST /api/ddnsmodify': { error: null, settings: duckdns.settings, status: duckdns.status }
    })
    const page = renderPage(<DDNSPage />)
    await page.flush()
    page.setValue(page.container.querySelector('input[name="hostname"]'), 'newhost')
    await page.flush()
    const saveBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Save')
    act(() => { saveBtn.click() })
    await page.flush()
    const call = fetch.mock.calls.find(c => c[0] === '/api/ddnsmodify')
    expect(JSON.parse(call[1].body).hostname).toBe('newhost')
    page.unmount()
  })

  test('Save sends the JWT (not the saved DuckDNS token) in the Authorization header', async function () {
    // regression: state.token (JWT) must not be shadowed by the DuckDNS API token
    localStorage.setItem('token', JSON.stringify({ token: 'JWT123' }))
    const fetch = mockFetch({
      'POST /api/auth': { authEnabled: true, role: 'admin' },
      '/api/ddns': duckdns, // settings.token = 'tok' (the DuckDNS API token)
      'POST /api/ddnsmodify': { error: null, settings: duckdns.settings, status: duckdns.status }
    })
    const page = renderPage(<DDNSPage />)
    await page.flush()
    const saveBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Save')
    act(() => { saveBtn.click() })
    await page.flush()
    const call = fetch.mock.calls.find(c => c[0] === '/api/ddnsmodify')
    // Authorization carries the JWT, not the saved DuckDNS token
    expect(call[1].headers.Authorization).toBe('Bearer JWT123')
    // the DuckDNS token is still sent in the request body
    expect(JSON.parse(call[1].body).token).toBe('tok')
    page.unmount()
  })

  test('Update now POSTs to /api/ddnsupdate and refreshes status', async function () {
    const fetch = mockFetch({
      '/api/ddns': duckdns,
      'POST /api/ddnsupdate': { status: { status: 'Success', lastIp: '1.2.3.4', lastUpdate: 'now' } }
    })
    const page = renderPage(<DDNSPage />)
    await page.flush()
    const btn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Update now')
    act(() => { btn.click() })
    await page.flush()
    expect(fetch).toHaveBeenCalledWith('/api/ddnsupdate', expect.objectContaining({ method: 'POST' }))
    expect(page.container.textContent).toContain('1.2.3.4')
    page.unmount()
  })

  test('componentDidMount catch path sets an error', async function () {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('net error'))))
    const page = renderPage(<DDNSPage />)
    await page.flush()
    expect(document.body.textContent).toContain('Error fetching DDNS settings')
    page.unmount()
  })

  test('Save catch path sets an error', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/ddns') return { ok: true, status: 200, json: async () => duckdns }
      if (method === 'POST' && url === '/api/ddnsmodify') throw new Error('save boom')
      throw new Error(`unhandled: ${method} ${url}`)
    }))
    const page = renderPage(<DDNSPage />)
    await page.flush()
    const saveBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Save')
    act(() => { saveBtn.click() })
    await page.flush()
    expect(document.body.textContent).toContain('Error saving DDNS settings')
    page.unmount()
  })

  test('Update now catch path sets an error', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/ddns') return { ok: true, status: 200, json: async () => duckdns }
      if (method === 'POST' && url === '/api/ddnsupdate') throw new Error('update boom')
      throw new Error(`unhandled: ${method} ${url}`)
    }))
    const page = renderPage(<DDNSPage />)
    await page.flush()
    const btn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Update now')
    act(() => { btn.click() })
    await page.flush()
    expect(document.body.textContent).toContain('Error updating DDNS')
    page.unmount()
  })
})
