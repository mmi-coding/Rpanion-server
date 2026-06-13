// @vitest-environment happy-dom
import React, { act } from 'react'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'

import { renderPage, mockFetch } from '../test/ui.jsx'
import NetworkPriorityPage from './networkpriority.jsx'

vi.mock('socket.io-client', () => import('../test/socketMock.js'))

const conns = { error: null, connections: [{ name: 'WiFi', uuid: 'u1', type: '802-11-wireless' }] }
// one row exercises all three formatBytes branches (MB / kB / B)
const bw = { interfaces: [{ name: 'eth0', rxBytes: 5000000, txBytes: 2000, rxRate: 1500000, txRate: 500 }] }

const defaultFetch = { '/api/networkpriority': conns, '/api/networkbandwidth': bw }

describe('#NetworkPriorityPage()', function () {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

  test('renders title', async function () {
    mockFetch(defaultFetch)
    const page = renderPage(<NetworkPriorityPage />)
    await page.flush()
    expect(page.container.textContent).toContain('Network Priority & Bandwidth')
    page.unmount()
  })

  test('renders bandwidth (formatted) and connections', async function () {
    mockFetch(defaultFetch)
    const page = renderPage(<NetworkPriorityPage />)
    await page.flush()
    expect(page.container.textContent).toContain('eth0')
    expect(page.container.textContent).toContain('5.00 MB')   // MB branch
    expect(page.container.textContent).toContain('2.0 kB')    // kB branch
    expect(page.container.textContent).toContain('500 B/s')   // B branch (rate)
    expect(page.container.textContent).toContain('WiFi')
    page.unmount()
  })

  test('exposes HelpTips and a HelpSection', async function () {
    mockFetch(defaultFetch)
    const page = renderPage(<NetworkPriorityPage />)
    await page.flush()
    expect(page.container.querySelectorAll('[aria-label="help"]').length).toBeGreaterThan(0)
    expect(page.container.querySelector('a[role="button"][aria-expanded]')).not.toBeNull()
    page.unmount()
  })

  test('editing priority and clicking Set POSTs the values', async function () {
    const fetch = mockFetch({ ...defaultFetch, 'POST /api/networksetpriority': { error: null } })
    const page = renderPage(<NetworkPriorityPage />)
    await page.flush()
    const inputs = page.container.querySelectorAll('input[type="number"]')
    page.setValue(inputs[0], '10') // priority
    page.setValue(inputs[1], '50') // metric
    await page.flush()
    const setBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Set')
    act(() => { setBtn.click() })
    await page.flush()
    const call = fetch.mock.calls.find(c => c[0] === '/api/networksetpriority')
    const body = JSON.parse(call[1].body)
    expect(body).toMatchObject({ conName: 'u1', priority: 10, metric: 50 })
    expect(document.body.textContent).toContain('Priority updated')
    page.unmount()
  })

  test('Set shows an error when the backend reports one', async function () {
    mockFetch({ ...defaultFetch, 'POST /api/networksetpriority': { error: 'nmcli boom' } })
    const page = renderPage(<NetworkPriorityPage />)
    await page.flush()
    const setBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Set')
    act(() => { setBtn.click() })
    await page.flush()
    expect(document.body.textContent).toContain('Error setting priority: nmcli boom')
    page.unmount()
  })

  test('Set catch path sets an error', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/networkpriority') return { ok: true, status: 200, json: async () => conns }
      if (url === '/api/networkbandwidth') return { ok: true, status: 200, json: async () => bw }
      if (method === 'POST' && url === '/api/networksetpriority') throw new Error('set boom')
      throw new Error(`unhandled: ${method} ${url}`)
    }))
    const page = renderPage(<NetworkPriorityPage />)
    await page.flush()
    const setBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Set')
    act(() => { setBtn.click() })
    await page.flush()
    expect(document.body.textContent).toContain('Error setting priority')
    page.unmount()
  })

  test('handles a connections response with no connections', async function () {
    // also returns no interfaces → exercises the `data.interfaces || []` fallback
    mockFetch({ '/api/networkpriority': { error: null }, '/api/networkbandwidth': {} })
    const page = renderPage(<NetworkPriorityPage />)
    await page.flush()
    // no connection rows, but the page renders
    expect([...page.container.querySelectorAll('button')].find(b => b.textContent === 'Set')).toBeUndefined()
    page.unmount()
  })

  test('fetchConnections catch path sets an error', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url === '/api/networkbandwidth') return { ok: true, status: 200, json: async () => bw }
      if (url === '/api/networkpriority') throw new Error('conn boom')
      throw new Error(`unhandled: ${url}`)
    }))
    const page = renderPage(<NetworkPriorityPage />)
    await page.flush()
    expect(document.body.textContent).toContain('Error fetching connections')
    page.unmount()
  })

  test('fetchBandwidth catch path leaves bandwidth empty', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url === '/api/networkpriority') return { ok: true, status: 200, json: async () => conns }
      if (url === '/api/networkbandwidth') throw new Error('bw boom')
      throw new Error(`unhandled: ${url}`)
    }))
    const page = renderPage(<NetworkPriorityPage />)
    await page.flush()
    // connections still render; bandwidth table has no data rows
    expect(page.container.textContent).toContain('WiFi')
    page.unmount()
  })
})
