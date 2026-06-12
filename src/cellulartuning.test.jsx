// @vitest-environment happy-dom
import React, { act } from 'react'
import { describe, test, expect, vi, afterEach } from 'vitest'

import { renderPage, mockFetch } from '../test/ui.jsx'
import { lastSocket } from '../test/socketMock.js'
import CellularTuningPage from './cellulartuning.jsx'

vi.mock('socket.io-client', () => import('../test/socketMock.js'))

// Real rendering tests (act + mocked fetch/socket.io) - the pattern for
// page coverage, see docs/TESTING.md. The smoke tests in App.test.jsx
// only check that construction doesn't throw.
describe('#cellulartuningpage()', function () {
  const settings = { lowLatency: true, adaptiveBitrate: true, minBitrate: 300 }
  const status = {
    lowLatency: true,
    adaptiveBitrate: true,
    minBitrate: 300,
    streaming: true,
    tier: 'good',
    pendingTier: null,
    configuredBitrate: 2000,
    targetBitrate: 2000,
    ackBitrate: 2000,
    signal: { dbm: -63, rsrp: -90 },
    lastChange: null
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('renders status from the config fetch', async function () {
    mockFetch({ '/api/cellulartuning': { settings, status } })
    const page = renderPage(<CellularTuningPage />)
    await page.flush()
    expect(page.container.textContent).toContain('Streaming')
    expect(page.container.textContent).toContain('RSRP -90 dBm')
    expect(page.container.textContent).toContain('2000 kbps')
    // help affordances present (self-documenting UI rule)
    expect(page.container.querySelectorAll('[aria-label="help"]').length).toBe(3)
    page.unmount()
  })

  test('socket push updates the status table', async function () {
    mockFetch({ '/api/cellulartuning': { settings, status } })
    const page = renderPage(<CellularTuningPage />)
    await page.flush()
    act(() => {
      lastSocket().fire('CellularTuningStatus', { ...status, tier: 'poor', targetBitrate: 700 })
    })
    expect(page.container.textContent).toContain('Poor')
    expect(page.container.textContent).toContain('700 kbps')
    page.unmount()
  })

  test('saving posts the modified config', async function () {
    let posted = null
    mockFetch({
      '/api/cellulartuning': { settings, status },
      'POST /api/cellulartuningmodify': (url, opts) => {
        posted = JSON.parse(opts.body)
        return { settings: posted }
      }
    })
    const page = renderPage(<CellularTuningPage />)
    await page.flush()
    // toggle adaptive bitrate off, then save
    page.click(page.container.querySelector('input[name="adaptiveBitrate"]'))
    page.submit(page.container.querySelector('form'))
    await page.flush()
    expect(posted).not.toBeNull()
    expect(posted.adaptiveBitrate).toBe(false)
    expect(posted.lowLatency).toBe(true)
    page.unmount()
  })

  test('reconnect socket event re-fetches config (line 47)', async function () {
    // The GET mock must remain active when reconnect fires because
    // componentDidMount → fetchConfig is called again.
    mockFetch({ '/api/cellulartuning': { settings, status } })
    const page = renderPage(<CellularTuningPage />)
    await page.flush()
    // Fire the reconnect event — componentDidMount is called a second time
    act(() => { lastSocket().fire('reconnect') })
    await page.flush()
    // Page should still show the fetched data (no error)
    expect(page.container.textContent).toContain('Streaming')
    page.unmount()
  })

  test('fetchConfig catch branch sets error state when fetch rejects (line 63)', async function () {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('net'))))
    const page = renderPage(<CellularTuningPage />)
    await page.flush()
    // basePage renders errors in a Modal portal into document.body (not the container)
    expect(document.body.textContent).toContain('Failed to fetch cellular tuning config')
    page.unmount()
  })

  test('handleSubmit sets error state when API returns data.error (line 92)', async function () {
    mockFetch({
      '/api/cellulartuning': { settings, status },
      'POST /api/cellulartuningmodify': { error: 'boom' }
    })
    const page = renderPage(<CellularTuningPage />)
    await page.flush()
    page.submit(page.container.querySelector('form'))
    await page.flush()
    // basePage renders errors in a Modal portal into document.body (not the container)
    expect(document.body.textContent).toContain('boom')
    page.unmount()
  })

  test('handleSubmit updates config from data.settings on success (line 97)', async function () {
    const updatedSettings = { lowLatency: false, adaptiveBitrate: false, minBitrate: 500 }
    mockFetch({
      '/api/cellulartuning': { settings, status },
      'POST /api/cellulartuningmodify': { settings: updatedSettings }
    })
    const page = renderPage(<CellularTuningPage />)
    await page.flush()
    page.submit(page.container.querySelector('form'))
    await page.flush()
    // minBitrate should now show the updated value from data.settings
    const minBitrateInput = page.container.querySelector('input[name="minBitrate"]')
    expect(minBitrateInput.value).toBe('500')
    page.unmount()
  })

  test('tierBadge renders Fair badge for fair tier (branch 1 line 10)', async function () {
    const fairStatus = { ...status, tier: 'fair' }
    mockFetch({ '/api/cellulartuning': { settings, status: fairStatus } })
    const page = renderPage(<CellularTuningPage />)
    await page.flush()
    expect(page.container.textContent).toContain('Fair')
    page.unmount()
  })

  test('fetchConfig !response.ok throws and catches (branch 4 line 58)', async function () {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 500, json: async () => ({}) })))
    const page = renderPage(<CellularTuningPage />)
    await page.flush()
    // The !ok branch throws, which is caught → error state shown in Modal portal
    expect(document.body.textContent).toContain('Failed to fetch cellular tuning config')
    page.unmount()
  })

  test('handleConfigChange with text input covers non-checkbox branch (branch 5 line 69)', async function () {
    mockFetch({
      '/api/cellulartuning': { settings, status },
      'POST /api/cellulartuningmodify': (url, opts) => ({ settings: JSON.parse(opts.body) })
    })
    const page = renderPage(<CellularTuningPage />)
    await page.flush()
    // The minBitrate input is type="number" (not checkbox) — triggers the else branch of
    // target.type === 'checkbox' ? checked : value
    const minBitrateInput = page.container.querySelector('input[name="minBitrate"]')
    page.setValue(minBitrateInput, '400')
    page.submit(page.container.querySelector('form'))
    await page.flush()
    expect(minBitrateInput.value).toBe('400')
    page.unmount()
  })

  test('adaptiveBitrate=true but not streaming shows alert (branch 7 line 129)', async function () {
    const noStreamStatus = { ...status, adaptiveBitrate: true, streaming: false }
    mockFetch({ '/api/cellulartuning': { settings, status: noStreamStatus } })
    const page = renderPage(<CellularTuningPage />)
    await page.flush()
    expect(page.container.textContent).toContain('Adaptive bitrate is enabled, but no video stream is running.')
    page.unmount()
  })

  test('adaptiveBitrate=true, streaming, signal=null shows warning alert (branch 8 line 132)', async function () {
    const nullSignalStatus = { ...status, adaptiveBitrate: true, streaming: true, signal: null }
    mockFetch({ '/api/cellulartuning': { settings, status: nullSignalStatus } })
    const page = renderPage(<CellularTuningPage />)
    await page.flush()
    expect(page.container.textContent).toContain('No LTE signal information')
    page.unmount()
  })

  test('signal with dbm but no rsrp shows RSSI (branch 12 line 140)', async function () {
    // signal.rsrp is undefined → falls to RSSI branch
    const rssiStatus = { ...status, signal: { dbm: -75 } }
    mockFetch({ '/api/cellulartuning': { settings, status: rssiStatus } })
    const page = renderPage(<CellularTuningPage />)
    await page.flush()
    expect(page.container.textContent).toContain('RSSI -75 dBm')
    page.unmount()
  })

  test('signal with dbm=null shows empty string (branch 13 line 140)', async function () {
    // signal exists but dbm is null → empty string branch (no signal value suffix rendered)
    const nullDbmStatus = { ...status, signal: { dbm: null } }
    mockFetch({ '/api/cellulartuning': { settings, status: nullDbmStatus } })
    const page = renderPage(<CellularTuningPage />)
    await page.flush()
    // The tier badge should appear, but no "RSRP -NNN" or "RSSI -NNN" value suffix
    expect(page.container.textContent).toContain('Good')
    // ' RSRP -' appears only when rsrp is defined and a number; ' RSSI -' when dbm is a number
    expect(page.container.textContent).not.toContain(' RSRP -')
    expect(page.container.textContent).not.toContain(' RSSI -')
    page.unmount()
  })

  test('handleSubmit catch covers fetch throw path (line 97)', async function () {
    // First fetch (GET) succeeds so the page loads; second fetch (POST) throws.
    let fetchCount = 0
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ settings, status }) }
      }
      // POST throws — exercises the catch block at line 97
      throw new Error('network failure')
    }))
    const page = renderPage(<CellularTuningPage />)
    await page.flush()
    page.submit(page.container.querySelector('form'))
    await page.flush()
    expect(document.body.textContent).toContain('Failed to save cellular tuning settings')
    page.unmount()
  })
})
