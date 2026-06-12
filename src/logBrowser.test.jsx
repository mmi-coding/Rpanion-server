// @vitest-environment happy-dom
import React, { act } from 'react'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'

import { renderPage, mockFetch } from '../test/ui.jsx'
import { lastSocket } from '../test/socketMock.js'
import LoggerPage from './logBrowser.jsx'

vi.mock('socket.io-client', () => import('../test/socketMock.js'))

const tlogFiles = [
  { key: 'flight1.tlog', name: 'flight1.tlog', size: 100, modified: '2024-01-01' }
]
const binlogFiles = [
  { key: 'flight1.bin', name: 'flight1.bin', size: 200, modified: '2024-01-02' }
]
const kmzFiles = [
  { key: 'flight1.kmz', name: 'flight1.kmz', size: 50, modified: '2024-01-03' }
]
const mediaFiles = [
  { key: 'photo1.jpg', name: 'photo1.jpg', size: 300, modified: '2024-01-05' },
  { key: 'photo2.jpg', name: 'photo2.jpg', size: 150, modified: '2024-01-10' }
]

const defaultFetch = {
  '/api/logfiles': { TlogFiles: tlogFiles, BinlogFiles: binlogFiles, KMZlogFiles: kmzFiles, MediaFiles: mediaFiles },
  '/api/diskinfo': { diskSpaceStatus: '20 GB free' },
  '/api/logconversioninfo': { doLogConversion: true, conversionLogStatus: 'N/A' }
}

describe('#LoggerPage()', function () {
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
  test('renders title', async function () {
    mockFetch(defaultFetch)
    const page = renderPage(<LoggerPage />)
    await page.flush()
    expect(page.container.textContent).toContain('Flight Log and Media Browser')
    page.unmount()
  })

  test('renders disk space status', async function () {
    mockFetch(defaultFetch)
    const page = renderPage(<LoggerPage />)
    await page.flush()
    expect(page.container.textContent).toContain('20 GB free')
    page.unmount()
  })

  test('renders tlog file entries with download links containing logdownload/', async function () {
    mockFetch(defaultFetch)
    const page = renderPage(<LoggerPage />)
    await page.flush()
    const links = page.container.querySelectorAll('a')
    const tlogLink = [...links].find(a => a.href.includes('logdownload/'))
    expect(tlogLink).toBeDefined()
    expect(tlogLink.textContent).toContain('flight1.tlog')
    page.unmount()
  })

  test('renders binlog file entries', async function () {
    mockFetch(defaultFetch)
    const page = renderPage(<LoggerPage />)
    await page.flush()
    expect(page.container.textContent).toContain('flight1.bin')
    page.unmount()
  })

  test('renders kmz file entries', async function () {
    mockFetch(defaultFetch)
    const page = renderPage(<LoggerPage />)
    await page.flush()
    expect(page.container.textContent).toContain('flight1.kmz')
    page.unmount()
  })

  test('renders media files in a table', async function () {
    mockFetch(defaultFetch)
    const page = renderPage(<LoggerPage />)
    await page.flush()
    expect(page.container.textContent).toContain('photo1.jpg')
    expect(page.container.textContent).toContain('photo2.jpg')
    page.unmount()
  })

  test('media files sorted newest-first (photo2 before photo1)', async function () {
    mockFetch(defaultFetch)
    const page = renderPage(<LoggerPage />)
    await page.flush()
    const text = page.container.textContent
    const idx1 = text.indexOf('photo1.jpg')
    const idx2 = text.indexOf('photo2.jpg')
    // photo2 (2024-01-10) newer than photo1 (2024-01-05) → should appear first
    expect(idx2).toBeLessThan(idx1)
    page.unmount()
  })

  test('media file links contain /media/ path', async function () {
    mockFetch(defaultFetch)
    const page = renderPage(<LoggerPage />)
    await page.flush()
    const links = page.container.querySelectorAll('a')
    const mediaLink = [...links].find(a => a.href.includes('/media/'))
    expect(mediaLink).toBeDefined()
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // doLogConversion toggle button
  // -------------------------------------------------------------------------
  test('doLogConversion=true shows Disable button', async function () {
    mockFetch({ ...defaultFetch, '/api/logconversioninfo': { doLogConversion: true } })
    const page = renderPage(<LoggerPage />)
    await page.flush()
    expect(page.container.textContent).toContain('Disable')
    page.unmount()
  })

  test('doLogConversion=false shows Enable button', async function () {
    mockFetch({ ...defaultFetch, '/api/logconversioninfo': { doLogConversion: false } })
    const page = renderPage(<LoggerPage />)
    await page.flush()
    expect(page.container.textContent).toContain('Enable')
    page.unmount()
  })

  test('handleDoLogConversion POSTs and updates state', async function () {
    const fetch = mockFetch({
      ...defaultFetch,
      'POST /api/logconversion': { doLogConversion: false }
    })
    const page = renderPage(<LoggerPage />)
    await page.flush()
    // Find the Disable/Enable toggle button (KMZ section)
    const toggleBtn = [...page.container.querySelectorAll('button')].find(b =>
      b.textContent === 'Disable' || b.textContent === 'Enable'
    )
    page.click(toggleBtn)
    await page.flush()
    expect(fetch).toHaveBeenCalledWith('/api/logconversion', expect.objectContaining({ method: 'POST' }))
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // clearLogs (deletelogfiles)
  // -------------------------------------------------------------------------
  test('clear tlog button POSTs to deletelogfiles with logtype=tlog', async function () {
    const fetch = mockFetch({
      ...defaultFetch,
      'POST /api/deletelogfiles': {}
    })
    const page = renderPage(<LoggerPage />)
    await page.flush()
    const tlogClearBtn = page.container.querySelector('button#tlog')
    expect(tlogClearBtn).not.toBeNull()
    // Use click to trigger clearLogs
    act(() => { tlogClearBtn.click() })
    await page.flush()
    expect(fetch).toHaveBeenCalledWith('/api/deletelogfiles', expect.objectContaining({ method: 'POST' }))
    const body = JSON.parse(fetch.mock.calls.find(c => c[0] === '/api/deletelogfiles')[1].body)
    expect(body.logtype).toBe('tlog')
    page.unmount()
  })

  test('clear binlog button POSTs with logtype=binlog', async function () {
    const fetch = mockFetch({
      ...defaultFetch,
      'POST /api/deletelogfiles': {}
    })
    const page = renderPage(<LoggerPage />)
    await page.flush()
    const binClearBtn = page.container.querySelector('button#binlog')
    act(() => { binClearBtn.click() })
    await page.flush()
    const body = JSON.parse(fetch.mock.calls.find(c => c[0] === '/api/deletelogfiles')[1].body)
    expect(body.logtype).toBe('binlog')
    page.unmount()
  })

  test('clear kmzlog button POSTs with logtype=kmzlog', async function () {
    const fetch = mockFetch({
      ...defaultFetch,
      'POST /api/deletelogfiles': {}
    })
    const page = renderPage(<LoggerPage />)
    await page.flush()
    const kmzClearBtn = page.container.querySelector('button#kmzlog')
    act(() => { kmzClearBtn.click() })
    await page.flush()
    const body = JSON.parse(fetch.mock.calls.find(c => c[0] === '/api/deletelogfiles')[1].body)
    expect(body.logtype).toBe('kmzlog')
    page.unmount()
  })

  test('clear media button POSTs with logtype=media', async function () {
    const fetch = mockFetch({
      ...defaultFetch,
      'POST /api/deletelogfiles': {}
    })
    const page = renderPage(<LoggerPage />)
    await page.flush()
    const mediaClearBtn = page.container.querySelector('button#media')
    act(() => { mediaClearBtn.click() })
    await page.flush()
    const body = JSON.parse(fetch.mock.calls.find(c => c[0] === '/api/deletelogfiles')[1].body)
    expect(body.logtype).toBe('media')
    page.unmount()
  })

  test('clearLogs catch path sets error state', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (method === 'POST' && url === '/api/deletelogfiles') {
        throw new Error('delete failed')
      }
      if (url === '/api/logfiles') return { ok: true, status: 200, json: async () => ({ TlogFiles: [], BinlogFiles: [], KMZlogFiles: [], MediaFiles: [] }) }
      if (url === '/api/diskinfo') return { ok: true, status: 200, json: async () => ({ diskSpaceStatus: '' }) }
      if (url === '/api/logconversioninfo') return { ok: true, status: 200, json: async () => ({ doLogConversion: true }) }
      throw new Error(`unhandled: ${method} ${url}`)
    }))
    const page = renderPage(<LoggerPage />)
    await page.flush()
    const tlogClearBtn = page.container.querySelector('button#tlog')
    act(() => { tlogClearBtn.click() })
    await page.flush()
    // Error modal shows up in document.body portal
    expect(document.body.textContent).toContain('Error deleting logfiles')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Socket events
  // -------------------------------------------------------------------------
  test('LogConversionStatus socket event updates conversionLogStatus', async function () {
    mockFetch(defaultFetch)
    const page = renderPage(<LoggerPage />)
    await page.flush()
    act(() => { lastSocket().fire('LogConversionStatus', 'Converting...') })
    expect(page.container.textContent).toContain('Converting...')
    page.unmount()
  })

  test('VideoStreamStatus socket event updates videoStreamStatus', async function () {
    mockFetch(defaultFetch)
    const page = renderPage(<LoggerPage />)
    await page.flush()
    act(() => { lastSocket().fire('VideoStreamStatus', 'Streaming active') })
    expect(page.container.textContent).toContain('Streaming active')
    page.unmount()
  })

  test('reconnect socket event re-fires componentDidMount', async function () {
    const fetch = mockFetch(defaultFetch)
    const page = renderPage(<LoggerPage />)
    await page.flush()
    const callsBefore = fetch.mock.calls.length
    act(() => { lastSocket().fire('reconnect') })
    await page.flush()
    // Should have made more fetch calls
    expect(fetch.mock.calls.length).toBeGreaterThan(callsBefore)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Empty file lists (renderLogTableData with empty array)
  // -------------------------------------------------------------------------
  test('renders with empty log file lists', async function () {
    mockFetch({
      '/api/logfiles': { TlogFiles: [], BinlogFiles: [], KMZlogFiles: [], MediaFiles: [] },
      '/api/diskinfo': { diskSpaceStatus: '' },
      '/api/logconversioninfo': { doLogConversion: false }
    })
    const page = renderPage(<LoggerPage />)
    await page.flush()
    expect(page.container.textContent).toContain('Flight Log and Media Browser')
    page.unmount()
  })
})
