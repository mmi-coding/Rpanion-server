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
})
