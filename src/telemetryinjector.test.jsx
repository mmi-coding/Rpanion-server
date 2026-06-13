// @vitest-environment happy-dom
import React, { act } from 'react'
import { describe, test, expect, vi, afterEach } from 'vitest'

import { renderPage, mockFetch } from '../test/ui.jsx'
import { lastSocket } from '../test/socketMock.js'
import TelemetryInjectorPage from './telemetryinjector.jsx'

vi.mock('socket.io-client', () => import('../test/socketMock.js'))

// Real rendering tests (act + mocked fetch/socket.io) - see docs/TESTING.md.
describe('#telemetryinjectorpage()', function () {
  const settings = { enabled: true, httpEnabled: true, udpEnabled: true, udpPort: 14600, serialEnabled: true, serialPort: '/dev/ttyUSB0', serialBaud: 115200, sysid: 1, compid: 158 }
  const statusAllOn = {
    enabled: true, httpEnabled: true, udpEnabled: true, udpPort: 14600,
    serialEnabled: true, serialPort: '/dev/ttyUSB0', udpListening: true, serialOpen: true,
    sentFloat: 5, sentText: 2, errors: 3, lastName: 'co2', lastValue: 412, lastText: 'pump on'
  }
  const statusOff = {
    enabled: false, httpEnabled: true, udpEnabled: false, udpPort: 14600,
    serialEnabled: false, serialPort: '', udpListening: false, serialOpen: false,
    sentFloat: 0, sentText: 0, errors: 0, lastName: null, lastValue: null, lastText: null
  }
  const statusNameOnly = { ...statusOff, enabled: true, httpEnabled: false, lastName: 'rpm', lastValue: 1500, lastText: null }
  const statusTextOnly = { ...statusOff, lastName: null, lastValue: null, lastText: 'hello' }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('renders status from the config fetch (all sources on)', async function () {
    mockFetch({ '/api/telemetryinjector': { settings, status: statusAllOn } })
    const page = renderPage(<TelemetryInjectorPage />)
    await page.flush()
    expect(page.container.textContent).toContain('Enabled')
    expect(page.container.textContent).toContain('Accepting')
    expect(page.container.textContent).toContain('Listening on 14600')
    expect(page.container.textContent).toContain('Open (/dev/ttyUSB0)')
    expect(page.container.textContent).toContain('5 float, 2 text')
    expect(page.container.textContent).toContain('co2 = 412')
    expect(page.container.textContent).toContain('pump on')
    // self-documenting UI rule: one HelpTip per control (9 controls) + a HelpSection toggle
    expect(page.container.querySelectorAll('[aria-label="help"]').length).toBe(9)
    expect(page.container.querySelector('a[role="button"][aria-expanded]')).not.toBeNull()
    page.unmount()
  })

  test('renders the disabled / off state with no readings', async function () {
    mockFetch({ '/api/telemetryinjector': { settings, status: statusOff } })
    const page = renderPage(<TelemetryInjectorPage />)
    await page.flush()
    expect(page.container.textContent).toContain('Disabled')
    expect(page.container.textContent).toContain('Off')
    page.unmount()
  })

  test('HTTP shows Off when enabled but the HTTP source is disabled, name-only reading', async function () {
    mockFetch({ '/api/telemetryinjector': { settings, status: statusNameOnly } })
    const page = renderPage(<TelemetryInjectorPage />)
    await page.flush()
    // name-only reading: shows "name = value" with no " / text" separator suffix
    expect(page.container.textContent).toContain('Last readingrpm = 1500')
    expect(page.container.textContent).toContain('HTTP sourceOff')
    page.unmount()
  })

  test('renders a text-only reading (no name)', async function () {
    mockFetch({ '/api/telemetryinjector': { settings, status: statusTextOnly } })
    const page = renderPage(<TelemetryInjectorPage />)
    await page.flush()
    expect(page.container.textContent).toContain('"hello"')
    page.unmount()
  })

  test('socket push updates the status table', async function () {
    mockFetch({ '/api/telemetryinjector': { settings, status: statusOff } })
    const page = renderPage(<TelemetryInjectorPage />)
    await page.flush()
    act(() => {
      lastSocket().fire('TelemetryInjectorStatus', { ...statusAllOn, errors: 0 })
    })
    expect(page.container.textContent).toContain('Listening on 14600')
    expect(page.container.textContent).toContain('co2 = 412')
    page.unmount()
  })

  test('saving posts the modified config (checkbox + parsed ints)', async function () {
    let posted = null
    mockFetch({
      '/api/telemetryinjector': { settings, status: statusAllOn },
      'POST /api/telemetryinjectormodify': (url, opts) => {
        posted = JSON.parse(opts.body)
        return { settings: posted }
      }
    })
    const page = renderPage(<TelemetryInjectorPage />)
    await page.flush()
    // toggle the master switch off, then save
    page.click(page.container.querySelector('input[name="enabled"]'))
    page.submit(page.container.querySelector('form'))
    await page.flush()
    expect(posted).not.toBeNull()
    expect(posted.enabled).toBe(false)
    expect(posted.udpPort).toBe(14600)
    expect(posted.sysid).toBe(1)
    page.unmount()
  })

  test('handleConfigChange with a text/number input covers the non-checkbox branch', async function () {
    mockFetch({
      '/api/telemetryinjector': { settings, status: statusAllOn },
      'POST /api/telemetryinjectormodify': (url, opts) => ({ settings: JSON.parse(opts.body) })
    })
    const page = renderPage(<TelemetryInjectorPage />)
    await page.flush()
    const udpPortInput = page.container.querySelector('input[name="udpPort"]')
    page.setValue(udpPortInput, '15000')
    page.submit(page.container.querySelector('form'))
    await page.flush()
    expect(udpPortInput.value).toBe('15000')
    page.unmount()
  })

  test('reconnect socket event re-fetches config', async function () {
    mockFetch({ '/api/telemetryinjector': { settings, status: statusAllOn } })
    const page = renderPage(<TelemetryInjectorPage />)
    await page.flush()
    act(() => { lastSocket().fire('reconnect') })
    await page.flush()
    expect(page.container.textContent).toContain('Enabled')
    page.unmount()
  })

  test('fetchConfig catch branch sets error state when fetch rejects', async function () {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('net'))))
    const page = renderPage(<TelemetryInjectorPage />)
    await page.flush()
    expect(document.body.textContent).toContain('Failed to fetch telemetry injector config')
    page.unmount()
  })

  test('fetchConfig !response.ok throws and is caught', async function () {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 500, json: async () => ({}) })))
    const page = renderPage(<TelemetryInjectorPage />)
    await page.flush()
    expect(document.body.textContent).toContain('Failed to fetch telemetry injector config')
    page.unmount()
  })

  test('handleSubmit sets error state when API returns data.error', async function () {
    mockFetch({
      '/api/telemetryinjector': { settings, status: statusAllOn },
      'POST /api/telemetryinjectormodify': { error: 'boom' }
    })
    const page = renderPage(<TelemetryInjectorPage />)
    await page.flush()
    page.submit(page.container.querySelector('form'))
    await page.flush()
    expect(document.body.textContent).toContain('boom')
    page.unmount()
  })

  test('handleSubmit updates config from data.settings on success', async function () {
    const updated = { ...settings, udpPort: 16000 }
    mockFetch({
      '/api/telemetryinjector': { settings, status: statusAllOn },
      'POST /api/telemetryinjectormodify': { settings: updated }
    })
    const page = renderPage(<TelemetryInjectorPage />)
    await page.flush()
    page.submit(page.container.querySelector('form'))
    await page.flush()
    expect(page.container.querySelector('input[name="udpPort"]').value).toBe('16000')
    page.unmount()
  })

  test('handleSubmit catch covers the fetch-throw path', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ settings, status: statusAllOn }) }
      }
      throw new Error('network failure')
    }))
    const page = renderPage(<TelemetryInjectorPage />)
    await page.flush()
    page.submit(page.container.querySelector('form'))
    await page.flush()
    expect(document.body.textContent).toContain('Failed to save telemetry injector settings')
    page.unmount()
  })
})
