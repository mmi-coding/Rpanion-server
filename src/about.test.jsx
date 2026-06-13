// @vitest-environment happy-dom
import React, { act } from 'react'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'

import { renderPage, mockFetch } from '../test/ui.jsx'
import AboutPage from './about.jsx'

vi.mock('socket.io-client', () => import('../test/socketMock.js'))

const defaultFetch = {
  '/api/softwareinfo': { OSVersion: '11', Nodejsversion: 'v18', rpanionversion: '1.0', hostname: 'rpanion' },
  '/api/diskinfo': { diskSpaceStatus: '10 GB free' },
  '/api/hardwareinfo': { CPUName: 'ARM', RAMName: '4', SYSName: 'Pi4', HATName: { product: '', vendor: '', version: '' } }
}

describe('#AboutPage()', function () {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  // -------------------------------------------------------------------------
  // Basic render
  // -------------------------------------------------------------------------
  test('renders title "About"', async function () {
    mockFetch(defaultFetch)
    const page = renderPage(<AboutPage />)
    await page.flush()
    expect(page.container.textContent).toContain('About')
    page.unmount()
  })

  test('renders hardware info from fetches', async function () {
    mockFetch(defaultFetch)
    const page = renderPage(<AboutPage />)
    await page.flush()
    expect(page.container.textContent).toContain('ARM')
    expect(page.container.textContent).toContain('4')
    expect(page.container.textContent).toContain('Pi4')
    expect(page.container.textContent).toContain('10 GB free')
    page.unmount()
  })

  test('renders software info from fetches', async function () {
    mockFetch(defaultFetch)
    const page = renderPage(<AboutPage />)
    await page.flush()
    expect(page.container.textContent).toContain('11')
    expect(page.container.textContent).toContain('v18')
    expect(page.container.textContent).toContain('1.0')
    expect(page.container.textContent).toContain('rpanion')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // HATInfo branch: empty product (falsy) → empty <p>
  // -------------------------------------------------------------------------
  test('HATInfo: empty product string renders empty paragraph', async function () {
    mockFetch({
      ...defaultFetch,
      '/api/hardwareinfo': { CPUName: 'ARM', RAMName: '4', SYSName: 'Pi4', HATName: { product: '', vendor: '', version: '' } }
    })
    const page = renderPage(<AboutPage />)
    await page.flush()
    expect(page.container.textContent).not.toContain('Attached HAT:')
    page.unmount()
  })

  test('HATInfo: truthy product renders HAT details', async function () {
    mockFetch({
      ...defaultFetch,
      '/api/hardwareinfo': { CPUName: 'ARM', RAMName: '4', SYSName: 'Pi4', HATName: { product: 'SenseHAT', vendor: 'RPi', version: '1.0' } }
    })
    const page = renderPage(<AboutPage />)
    await page.flush()
    expect(page.container.textContent).toContain('Attached HAT: SenseHAT')
    expect(page.container.textContent).toContain('RPi')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Shutdown modal
  // -------------------------------------------------------------------------
  test('clicking Shutdown button shows confirm modal', async function () {
    mockFetch(defaultFetch)
    const page = renderPage(<AboutPage />)
    await page.flush()
    const shutdownBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent.includes('Shutdown'))
    page.click(shutdownBtn)
    expect(document.body.textContent).toContain('Confirm Shutdown')
    expect(document.body.textContent).toContain('Are you sure you want to shutdown')
    page.unmount()
  })

  test('modal No button closes shutdown modal', async function () {
    mockFetch(defaultFetch)
    const page = renderPage(<AboutPage />)
    await page.flush()
    const shutdownBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent.includes('Shutdown'))
    page.click(shutdownBtn)
    // Click "No" button in portal
    const noBtn = [...document.body.querySelectorAll('button')].find(b => b.textContent === 'No')
    act(() => { noBtn.click() })
    await page.flush()
    expect(document.body.textContent).not.toContain('Are you sure you want to shutdown')
    page.unmount()
  })

  test('modal Yes button fires shutdown POST and closes modal', async function () {
    const fetch = mockFetch({
      ...defaultFetch,
      'POST /api/shutdowncc': {}
    })
    const page = renderPage(<AboutPage />)
    await page.flush()
    const shutdownBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent.includes('Shutdown'))
    page.click(shutdownBtn)
    const yesBtn = [...document.body.querySelectorAll('button')].find(b => b.textContent === 'Yes')
    act(() => { yesBtn.click() })
    await page.flush()
    expect(fetch).toHaveBeenCalledWith('/api/shutdowncc', expect.objectContaining({ method: 'POST' }))
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Reset settings modal
  // -------------------------------------------------------------------------
  test('clicking Reset All Settings button shows reset modal', async function () {
    mockFetch(defaultFetch)
    const page = renderPage(<AboutPage />)
    await page.flush()
    const resetBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent.includes('Reset All Settings'))
    page.click(resetBtn)
    expect(document.body.textContent).toContain('Confirm Reset Settings')
    page.unmount()
  })

  test('reset modal Cancel button closes modal', async function () {
    mockFetch(defaultFetch)
    const page = renderPage(<AboutPage />)
    await page.flush()
    const resetBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent.includes('Reset All Settings'))
    page.click(resetBtn)
    const cancelBtn = [...document.body.querySelectorAll('button')].find(b => b.textContent === 'Cancel')
    act(() => { cancelBtn.click() })
    await page.flush()
    expect(document.body.textContent).not.toContain('Confirm Reset Settings')
    page.unmount()
  })

  test('handleResetSettings: success branch shows success message and clears after 5s', async function () {
    const fetch = mockFetch({
      ...defaultFetch,
      'POST /api/resetsettings': { success: true, message: 'Settings reset successfully' }
    })
    const page = renderPage(<AboutPage />)
    await page.flush()
    const resetBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent.includes('Reset All Settings'))
    page.click(resetBtn)
    const yesBtn = [...document.body.querySelectorAll('button')].find(b => b.textContent.includes('Yes, Reset'))
    // Install fake timers scoped to setTimeout only to avoid starving promise resolution
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    act(() => { yesBtn.click() })
    await page.flush()
    expect(fetch).toHaveBeenCalledWith('/api/resetsettings', expect.objectContaining({ method: 'POST' }))
    expect(page.container.textContent).toContain('Settings reset successfully')
    // Advance 5 seconds: message should clear
    act(() => { vi.advanceTimersByTime(5000) })
    expect(page.container.textContent).not.toContain('Settings reset successfully')
    vi.useRealTimers()
    page.unmount()
  })

  test('handleResetSettings: success=false branch shows error from data.error', async function () {
    mockFetch({
      ...defaultFetch,
      'POST /api/resetsettings': { success: false, error: 'Could not reset' }
    })
    const page = renderPage(<AboutPage />)
    await page.flush()
    const resetBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent.includes('Reset All Settings'))
    page.click(resetBtn)
    const yesBtn = [...document.body.querySelectorAll('button')].find(b => b.textContent.includes('Yes, Reset'))
    act(() => { yesBtn.click() })
    await page.flush()
    expect(page.container.textContent).toContain('Could not reset')
    page.unmount()
  })

  test('handleResetSettings: success=false with no error field shows fallback message', async function () {
    mockFetch({
      ...defaultFetch,
      'POST /api/resetsettings': { success: false }
    })
    const page = renderPage(<AboutPage />)
    await page.flush()
    const resetBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent.includes('Reset All Settings'))
    page.click(resetBtn)
    const yesBtn = [...document.body.querySelectorAll('button')].find(b => b.textContent.includes('Yes, Reset'))
    act(() => { yesBtn.click() })
    await page.flush()
    expect(page.container.textContent).toContain('Failed to reset settings')
    page.unmount()
  })

  test('handleResetSettings: fetch throws shows catch message', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (method === 'POST' && url === '/api/resetsettings') {
        throw new Error('network failure')
      }
      // serve initial GET fetches with plain json responses
      if (url === '/api/softwareinfo') return { ok: true, status: 200, json: async () => ({ OSVersion: '', Nodejsversion: '', rpanionversion: '', hostname: '' }) }
      if (url === '/api/diskinfo') return { ok: true, status: 200, json: async () => ({ diskSpaceStatus: '' }) }
      if (url === '/api/hardwareinfo') return { ok: true, status: 200, json: async () => ({ CPUName: '', RAMName: '', SYSName: '', HATName: { product: '', vendor: '', version: '' } }) }
      throw new Error(`mockFetch: unhandled request ${method} ${url}`)
    }))
    const page = renderPage(<AboutPage />)
    await page.flush()
    const resetBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent.includes('Reset All Settings'))
    page.click(resetBtn)
    const yesBtn = [...document.body.querySelectorAll('button')].find(b => b.textContent.includes('Yes, Reset'))
    act(() => { yesBtn.click() })
    await page.flush()
    expect(page.container.textContent).toContain('Error resetting settings: network failure')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Download logs (getlogs)
  // -------------------------------------------------------------------------
  test('Download Logs button triggers blob fetch and creates download link', async function () {
    // Stub only the URL methods, not URL itself (happy-dom needs URL as constructor)
    const origCreate = window.URL.createObjectURL
    const origRevoke = window.URL.revokeObjectURL
    const createObjectURL = vi.fn(() => 'blob:fake')
    const revokeObjectURL = vi.fn()
    window.URL.createObjectURL = createObjectURL
    window.URL.revokeObjectURL = revokeObjectURL

    // Override fetch to return a blob-capable response for /api/logfile
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/logfile') {
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          blob: async () => new Blob(['log data'], { type: 'text/plain' })
        }
      }
      if (url === '/api/softwareinfo') return { ok: true, status: 200, json: async () => ({ OSVersion: '', Nodejsversion: '', rpanionversion: '', hostname: '' }) }
      if (url === '/api/diskinfo') return { ok: true, status: 200, json: async () => ({ diskSpaceStatus: '' }) }
      if (url === '/api/hardwareinfo') return { ok: true, status: 200, json: async () => ({ CPUName: '', RAMName: '', SYSName: '', HATName: { product: '', vendor: '', version: '' } }) }
      throw new Error(`unhandled: ${method} ${url}`)
    }))

    const page = renderPage(<AboutPage />)
    await page.flush()
    const downloadBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent.includes('Download Logs'))
    act(() => { downloadBtn.click() })
    await page.flush()
    expect(createObjectURL).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake')
    // Restore URL methods
    window.URL.createObjectURL = origCreate
    window.URL.revokeObjectURL = origRevoke
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Settings backup / restore
  // -------------------------------------------------------------------------
  test('Backup Settings button triggers blob fetch and creates download link', async function () {
    const origCreate = window.URL.createObjectURL
    const origRevoke = window.URL.revokeObjectURL
    const createObjectURL = vi.fn(() => 'blob:fake')
    const revokeObjectURL = vi.fn()
    window.URL.createObjectURL = createObjectURL
    window.URL.revokeObjectURL = revokeObjectURL

    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/settingsbackup') {
        return { ok: true, status: 200, json: async () => ({}), blob: async () => new Blob(['{"a":1}'], { type: 'application/json' }) }
      }
      if (url === '/api/softwareinfo') return { ok: true, status: 200, json: async () => ({ OSVersion: '', Nodejsversion: '', rpanionversion: '', hostname: '' }) }
      if (url === '/api/diskinfo') return { ok: true, status: 200, json: async () => ({ diskSpaceStatus: '' }) }
      if (url === '/api/hardwareinfo') return { ok: true, status: 200, json: async () => ({ CPUName: '', RAMName: '', SYSName: '', HATName: { product: '', vendor: '', version: '' } }) }
      throw new Error(`unhandled: ${method} ${url}`)
    }))

    const page = renderPage(<AboutPage />)
    await page.flush()
    const backupBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent.includes('Backup Settings'))
    act(() => { backupBtn.click() })
    await page.flush()
    expect(createObjectURL).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake')
    window.URL.createObjectURL = origCreate
    window.URL.revokeObjectURL = origRevoke
    page.unmount()
  })

  test('Restore: no file selected does nothing', async function () {
    const fetch = mockFetch(defaultFetch)
    const page = renderPage(<AboutPage />)
    await page.flush()
    const input = page.container.querySelector('input[type="file"]')
    Object.defineProperty(input, 'files', { value: [], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    await page.flush()
    const restoreCalls = fetch.mock.calls.filter(c => c[0] === '/api/settingsrestore')
    expect(restoreCalls.length).toBe(0)
    page.unmount()
  })

  test('Restore: a valid file POSTs and shows a message that clears', async function () {
    const fetch = mockFetch({ ...defaultFetch, 'POST /api/settingsrestore': { success: true, message: 'Settings restored OK' } })
    const page = renderPage(<AboutPage />)
    await page.flush()
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const input = page.container.querySelector('input[type="file"]')
    const file = new File([JSON.stringify({ a: 1 })], 'settings.json', { type: 'application/json' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    await page.flush()
    await page.flush()
    expect(fetch).toHaveBeenCalledWith('/api/settingsrestore', expect.objectContaining({ method: 'POST' }))
    expect(page.container.textContent).toContain('Settings restored OK')
    act(() => { vi.advanceTimersByTime(5000) })
    expect(page.container.textContent).not.toContain('Settings restored OK')
    vi.useRealTimers()
    page.unmount()
  })

  test('Restore: server reports failure shows the error', async function () {
    mockFetch({ ...defaultFetch, 'POST /api/settingsrestore': { success: false, error: 'Bad settings' } })
    const page = renderPage(<AboutPage />)
    await page.flush()
    const input = page.container.querySelector('input[type="file"]')
    const file = new File([JSON.stringify({ a: 1 })], 'settings.json', { type: 'application/json' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    await page.flush()
    await page.flush()
    expect(page.container.textContent).toContain('Bad settings')
    page.unmount()
  })

  test('Restore: failure without an error message shows the fallback', async function () {
    mockFetch({ ...defaultFetch, 'POST /api/settingsrestore': { success: false } })
    const page = renderPage(<AboutPage />)
    await page.flush()
    const input = page.container.querySelector('input[type="file"]')
    const file = new File([JSON.stringify({ a: 1 })], 'settings.json', { type: 'application/json' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    await page.flush()
    await page.flush()
    expect(page.container.textContent).toContain('Failed to restore settings')
    page.unmount()
  })

  test('Restore: an invalid JSON file is caught and reported', async function () {
    mockFetch(defaultFetch)
    const page = renderPage(<AboutPage />)
    await page.flush()
    const input = page.container.querySelector('input[type="file"]')
    const file = new File(['this is not json'], 'settings.json', { type: 'application/json' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    await page.flush()
    await page.flush()
    expect(page.container.textContent).toContain('Error restoring settings:')
    page.unmount()
  })
})
