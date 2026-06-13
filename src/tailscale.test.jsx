// @vitest-environment happy-dom
import React, { act } from 'react'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'

import { renderPage, mockFetch } from '../test/ui.jsx'
import TailscalePage from './tailscale.jsx'

vi.mock('socket.io-client', () => import('../test/socketMock.js'))

const connected = {
  statusTailscale: {
    installed: true,
    status: true,
    text: [
      { host: 'pi', ip: '100.64.0.1', online: true, self: true },
      { host: 'laptop', ip: '', online: false, self: false }
    ]
  }
}

const notInstalled = {
  statusTailscale: { installed: false, status: false, text: [] }
}

describe('#TailscalePage()', function () {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

  test('renders title "Tailscale VPN"', async function () {
    mockFetch({ '/api/vpntailscale': connected })
    const page = renderPage(<TailscalePage />)
    await page.flush()
    expect(page.container.textContent).toContain('Tailscale VPN')
    page.unmount()
  })

  test('renders connected status with self + peer rows', async function () {
    mockFetch({ '/api/vpntailscale': connected })
    const page = renderPage(<TailscalePage />)
    await page.flush()
    expect(page.container.textContent).toContain('Connected: Yes')
    expect(page.container.textContent).toContain('100.64.0.1')
    expect(page.container.textContent).toContain('laptop')
    // disconnect enabled when connected, connect disabled until a key is typed
    const disconnectBtn = page.container.querySelector('#disconnectts')
    const connectBtn = page.container.querySelector('#connectts')
    expect(disconnectBtn.disabled).toBe(false)
    expect(connectBtn.disabled).toBe(true)
    page.unmount()
  })

  test('renders the not-installed / disconnected state', async function () {
    mockFetch({ '/api/vpntailscale': notInstalled })
    const page = renderPage(<TailscalePage />)
    await page.flush()
    expect(page.container.textContent).toContain('Installed: No')
    expect(page.container.textContent).toContain('Connected: No')
    expect(page.container.querySelector('#disconnectts').disabled).toBe(true)
    page.unmount()
  })

  test('exposes HelpTips and a HelpSection (self-documenting)', async function () {
    mockFetch({ '/api/vpntailscale': connected })
    const page = renderPage(<TailscalePage />)
    await page.flush()
    expect(page.container.querySelectorAll('[aria-label="help"]').length).toBeGreaterThan(0)
    const toggle = page.container.querySelector('a[role="button"][aria-expanded]')
    expect(toggle).not.toBeNull()
    page.unmount()
  })

  test('Connect POSTs the auth key', async function () {
    const fetch = mockFetch({
      '/api/vpntailscale': notInstalled,
      'POST /api/vpntailscaleconnect': connected
    })
    const page = renderPage(<TailscalePage />)
    await page.flush()
    page.setValue(page.container.querySelector('input[name="authkey"]'), 'tskey-auth-abc')
    await page.flush()
    const connectBtn = page.container.querySelector('#connectts')
    expect(connectBtn.disabled).toBe(false)
    act(() => { connectBtn.click() })
    await page.flush()
    const call = fetch.mock.calls.find(c => c[0] === '/api/vpntailscaleconnect')
    expect(JSON.parse(call[1].body).authkey).toBe('tskey-auth-abc')
    expect(page.container.textContent).toContain('Connected: Yes')
    page.unmount()
  })

  test('Disconnect POSTs to /api/vpntailscaledisconnect', async function () {
    const fetch = mockFetch({
      '/api/vpntailscale': connected,
      'POST /api/vpntailscaledisconnect': notInstalled
    })
    const page = renderPage(<TailscalePage />)
    await page.flush()
    act(() => { page.container.querySelector('#disconnectts').click() })
    await page.flush()
    expect(fetch).toHaveBeenCalledWith('/api/vpntailscaledisconnect', expect.objectContaining({ method: 'POST' }))
    page.unmount()
  })

  test('componentDidMount catch path sets an error', async function () {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('net error'))))
    const page = renderPage(<TailscalePage />)
    await page.flush()
    // error modal text from basePage
    expect(document.body.textContent).toContain('Error fetching Tailscale status')
    page.unmount()
  })

  test('Connect catch path sets an error', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/vpntailscale') return { ok: true, status: 200, json: async () => notInstalled }
      if (method === 'POST' && url === '/api/vpntailscaleconnect') throw new Error('connect boom')
      throw new Error(`unhandled: ${method} ${url}`)
    }))
    const page = renderPage(<TailscalePage />)
    await page.flush()
    page.setValue(page.container.querySelector('input[name="authkey"]'), 'tskey-auth-abc')
    await page.flush()
    act(() => { page.container.querySelector('#connectts').click() })
    await page.flush()
    expect(document.body.textContent).toContain('Error connecting Tailscale')
    page.unmount()
  })

  test('Disconnect catch path sets an error', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/vpntailscale') return { ok: true, status: 200, json: async () => connected }
      if (method === 'POST' && url === '/api/vpntailscaledisconnect') throw new Error('down boom')
      throw new Error(`unhandled: ${method} ${url}`)
    }))
    const page = renderPage(<TailscalePage />)
    await page.flush()
    act(() => { page.container.querySelector('#disconnectts').click() })
    await page.flush()
    expect(document.body.textContent).toContain('Error disconnecting Tailscale')
    page.unmount()
  })
})
