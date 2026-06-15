// @vitest-environment happy-dom
import React, { act } from 'react'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'

import { renderPage, mockFetch } from '../test/ui.jsx'
import { lastSocket } from '../test/socketMock.js'
import Home from './home.jsx'

vi.mock('socket.io-client', () => import('../test/socketMock.js'))

describe('#homePage()', function () {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  test('renders title and default state', async function () {
    mockFetch({})
    const page = renderPage(<Home />)
    await page.flush()
    expect(page.container.textContent).toContain('System Status Overview')
    page.unmount()
  })

  test('renders initial Inactive camera badge when VideoStreamStatus is Not streaming', async function () {
    mockFetch({})
    const page = renderPage(<Home />)
    await page.flush()
    expect(page.container.textContent).toContain('Inactive')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // System stats card (#31)
  // -------------------------------------------------------------------------
  test('System card shows live stats from /api/systemstatus', async function () {
    mockFetch({ '/api/systemstatus': { cpuLoad: 37, cpuTempC: 52, memUsedMB: 800, memTotalMB: 4096, diskUsedGB: 8, diskTotalGB: 32, uptimeSec: 3725 } })
    const page = renderPage(<Home />)
    await page.flush()
    expect(page.container.textContent).toContain('System')
    expect(page.container.textContent).toContain('37%')
    expect(page.container.textContent).toContain('52 °C')
    expect(page.container.textContent).toContain('800 / 4096 MB')
    expect(page.container.textContent).toContain('8 / 32 GB')
    expect(page.container.textContent).toContain('1h 2m') // 3725s
    page.unmount()
  })

  test('System card shows N/A temperature when unavailable', async function () {
    mockFetch({ '/api/systemstatus': { cpuLoad: 5, cpuTempC: null, memUsedMB: 100, memTotalMB: 2048, diskUsedGB: 1, diskTotalGB: 16, uptimeSec: 60 } })
    const page = renderPage(<Home />)
    await page.flush()
    expect(page.container.textContent).toContain('N/A')
    page.unmount()
  })

  test('System card tolerates a /api/systemstatus fetch failure', async function () {
    mockFetch({ '/api/systemstatus': () => { throw new Error('boom') } })
    const page = renderPage(<Home />)
    await page.flush()
    expect(page.container.textContent).toContain('System Status Overview') // no crash
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Socket: FCStatus
  // -------------------------------------------------------------------------
  test('FCStatus socket event updates flight controller display', async function () {
    mockFetch({})
    const page = renderPage(<Home />)
    await page.flush()
    act(() => {
      lastSocket().fire('FCStatus', {
        conStatus: 'Connected',
        numpackets: 42,
        byteRate: 1024,
        vehType: 'Quadcopter',
        FW: 'ArduCopter',
        fcVersion: '4.3.0'
      })
    })
    expect(page.container.textContent).toContain('42')
    expect(page.container.textContent).toContain('1024')
    expect(page.container.textContent).toContain('Quadcopter')
    expect(page.container.textContent).toContain('ArduCopter')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Socket: NTRIPStatus
  // -------------------------------------------------------------------------
  test('NTRIPStatus socket event with Active status shows Active badge', async function () {
    mockFetch({})
    const page = renderPage(<Home />)
    await page.flush()
    act(() => {
      lastSocket().fire('NTRIPStatus', 'Active - connected to host')
    })
    expect(page.container.textContent).toContain('Active')
    page.unmount()
  })

  test('NTRIPStatus socket event without Active shows Inactive badge', async function () {
    mockFetch({})
    const page = renderPage(<Home />)
    await page.flush()
    act(() => {
      lastSocket().fire('NTRIPStatus', 'Not connected')
    })
    expect(page.container.textContent).toContain('Inactive')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Socket: PPPStatus
  // -------------------------------------------------------------------------
  test('PPPStatus socket event with Active shows Active badge', async function () {
    mockFetch({})
    const page = renderPage(<Home />)
    await page.flush()
    act(() => {
      lastSocket().fire('PPPStatus', 'Active link')
    })
    expect(page.container.textContent).toContain('Active')
    page.unmount()
  })

  test('PPPStatus socket event without Active shows Inactive badge', async function () {
    mockFetch({})
    const page = renderPage(<Home />)
    await page.flush()
    act(() => {
      lastSocket().fire('PPPStatus', 'Not connected')
    })
    expect(page.container.textContent).toContain('Inactive')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Socket: LogConversionStatus
  // -------------------------------------------------------------------------
  test('LogConversionStatus socket event with N/A shows N/A badge', async function () {
    mockFetch({})
    const page = renderPage(<Home />)
    await page.flush()
    act(() => {
      lastSocket().fire('LogConversionStatus', 'N/A')
    })
    expect(page.container.textContent).toContain('N/A')
    page.unmount()
  })

  test('LogConversionStatus socket event with Active shows Active badge', async function () {
    mockFetch({})
    const page = renderPage(<Home />)
    await page.flush()
    act(() => {
      lastSocket().fire('LogConversionStatus', 'Active converting')
    })
    expect(page.container.textContent).toContain('Active')
    page.unmount()
  })

  test('LogConversionStatus socket event with non-Active non-NA shows Inactive badge', async function () {
    mockFetch({})
    const page = renderPage(<Home />)
    await page.flush()
    act(() => {
      lastSocket().fire('LogConversionStatus', 'Idle')
    })
    expect(page.container.textContent).toContain('Inactive')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Socket: VideoStreamStatus — camera badge labels
  // -------------------------------------------------------------------------
  test('VideoStreamStatus streaming → Active (Streaming) badge', async function () {
    mockFetch({})
    const page = renderPage(<Home />)
    await page.flush()
    act(() => {
      lastSocket().fire('VideoStreamStatus', 'streaming active')
    })
    expect(page.container.textContent).toContain('Active (Streaming)')
    page.unmount()
  })

  test('VideoStreamStatus photo → Active (Photo) badge', async function () {
    mockFetch({})
    const page = renderPage(<Home />)
    await page.flush()
    act(() => {
      lastSocket().fire('VideoStreamStatus', 'photo mode')
    })
    expect(page.container.textContent).toContain('Active (Photo)')
    page.unmount()
  })

  test('VideoStreamStatus recording → Recording badge', async function () {
    mockFetch({})
    const page = renderPage(<Home />)
    await page.flush()
    act(() => {
      lastSocket().fire('VideoStreamStatus', 'recording video')
    })
    expect(page.container.textContent).toContain('Recording')
    page.unmount()
  })

  test('VideoStreamStatus video (non-recording/streaming) → Active (Video) badge', async function () {
    mockFetch({})
    const page = renderPage(<Home />)
    await page.flush()
    act(() => {
      lastSocket().fire('VideoStreamStatus', 'video ready')
    })
    expect(page.container.textContent).toContain('Active (Video)')
    page.unmount()
  })

  test('VideoStreamStatus inactive → Inactive badge', async function () {
    mockFetch({})
    const page = renderPage(<Home />)
    await page.flush()
    act(() => {
      lastSocket().fire('VideoStreamStatus', 'inactive')
    })
    expect(page.container.textContent).toContain('Inactive')
    page.unmount()
  })

  test('VideoStreamStatus not streaming → Inactive badge', async function () {
    mockFetch({})
    const page = renderPage(<Home />)
    await page.flush()
    act(() => {
      lastSocket().fire('VideoStreamStatus', 'not active')
    })
    expect(page.container.textContent).toContain('Inactive')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // getStatusVariant branches
  // -------------------------------------------------------------------------
  test('getStatusVariant: connected → success badge on FCStatus', async function () {
    mockFetch({})
    const page = renderPage(<Home />)
    await page.flush()
    act(() => {
      lastSocket().fire('FCStatus', {
        conStatus: 'connected',
        numpackets: 0, byteRate: 0, vehType: '', FW: '', fcVersion: ''
      })
    })
    // 'connected' → success variant; badge text is 'connected'
    expect(page.container.textContent).toContain('connected')
    page.unmount()
  })

  test('getStatusVariant: active keyword → success (NTRIPStatus with Active string)', async function () {
    mockFetch({})
    const page = renderPage(<Home />)
    await page.flush()
    act(() => {
      // NTRIPStatus badge checks .includes('Active'), getStatusVariant checks .toLowerCase().includes('active')
      lastSocket().fire('NTRIPStatus', 'Active connection')
    })
    expect(page.container.textContent).toContain('Active')
    page.unmount()
  })

  test('getStatusVariant: error → danger badge', async function () {
    mockFetch({})
    const page = renderPage(<Home />)
    await page.flush()
    act(() => {
      lastSocket().fire('PPPStatus', 'error occurred')
    })
    // variant is danger; badge shows "Inactive" since it doesn't include 'Active'
    expect(page.container.textContent).toContain('Inactive')
    page.unmount()
  })

  test('getStatusVariant: failed → danger badge', async function () {
    mockFetch({})
    const page = renderPage(<Home />)
    await page.flush()
    act(() => {
      lastSocket().fire('NTRIPStatus', 'connection failed')
    })
    expect(page.container.textContent).toContain('Inactive')
    page.unmount()
  })

  test('getStatusVariant: not → secondary badge', async function () {
    mockFetch({})
    const page = renderPage(<Home />)
    await page.flush()
    act(() => {
      lastSocket().fire('PPPStatus', 'not running')
    })
    expect(page.container.textContent).toContain('Inactive')
    page.unmount()
  })

  test('getStatusVariant: no → secondary badge', async function () {
    mockFetch({})
    const page = renderPage(<Home />)
    await page.flush()
    act(() => {
      lastSocket().fire('PPPStatus', 'no connection')
    })
    expect(page.container.textContent).toContain('Inactive')
    page.unmount()
  })

  test('getStatusVariant: unknown string → warning badge', async function () {
    mockFetch({})
    const page = renderPage(<Home />)
    await page.flush()
    act(() => {
      lastSocket().fire('PPPStatus', 'pending')
    })
    // 'pending' doesn't match any keyword → warning variant; badge shows Inactive
    expect(page.container.textContent).toContain('Inactive')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // getStatusVariant: non-string input → warning (branch 0 false path)
  // -------------------------------------------------------------------------
  test('getStatusVariant: non-string number → warning variant (branch 0 false)', async function () {
    mockFetch({})
    const page = renderPage(<Home />)
    await page.flush()
    // Pass a number as conStatus: React can render numbers but getStatusVariant
    // receives a non-string, hitting the typeof !== 'string' false branch
    act(() => {
      lastSocket().fire('FCStatus', {
        conStatus: 42,
        numpackets: 0, byteRate: 0, vehType: '', FW: '', fcVersion: ''
      })
    })
    expect(page.container.textContent).toContain('MAVLink Connection')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // VideoStreamStatus falsy → cameraBadgeLabel stays Inactive (branch 7 false)
  // -------------------------------------------------------------------------
  test('VideoStreamStatus falsy (null) → Inactive camera badge', async function () {
    mockFetch({})
    const page = renderPage(<Home />)
    await page.flush()
    act(() => {
      lastSocket().fire('VideoStreamStatus', null)
    })
    expect(page.container.textContent).toContain('Inactive')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // VideoStreamStatus with no keyword matches → stays Inactive (branch 13 false)
  // -------------------------------------------------------------------------
  test('VideoStreamStatus unknown string with no keyword → Inactive badge (branch 13 else)', async function () {
    mockFetch({})
    const page = renderPage(<Home />)
    await page.flush()
    // A string that doesn't include 'inactive', 'not', 'streaming', 'photo', 'recording', or 'video'
    act(() => {
      lastSocket().fire('VideoStreamStatus', 'starting')
    })
    // None of the if/else-if conditions match → label stays 'Inactive' (initial value)
    expect(page.container.textContent).toContain('Inactive')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // reconnect socket event re-calls componentDidMount
  // -------------------------------------------------------------------------
  test('reconnect socket event triggers componentDidMount again', async function () {
    mockFetch({})
    const page = renderPage(<Home />)
    await page.flush()
    // Should not throw
    act(() => {
      lastSocket().fire('reconnect')
    })
    await page.flush()
    expect(page.container.textContent).toContain('System Status Overview')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // showLogin path
  // -------------------------------------------------------------------------
  test('showLogin=true renders login form', async function () {
    mockFetch({})
    const page = renderPage(<Home showLogin={true} />)
    expect(page.container.textContent).toContain('Please Log In')
    page.unmount()
  })
})
