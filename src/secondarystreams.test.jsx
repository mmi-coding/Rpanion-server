// @vitest-environment happy-dom
import React, { act } from 'react'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'

import { renderPage, mockFetch } from '../test/ui.jsx'
import SecondaryStreamsPage from './secondarystreams.jsx'

vi.mock('socket.io-client', () => import('../test/socketMock.js'))

const devices = [
  { value: '/dev/video2', label: 'USB Cam 2', caps: [
    { value: 'c-jpeg', width: 1280, height: 720, format: 'image/jpeg', fps: [], fpsmax: 30 },
    { value: 'c-raw', width: 640, height: 480, format: 'video/x-raw', fps: [], fpsmax: 30 }
  ] },
  { value: '/dev/video4', label: 'USB Cam 4', caps: [
    { value: 'c-h264', width: 1920, height: 1080, format: 'video/x-h264', fps: [], fpsmax: 30 }
  ] },
  { value: '/dev/video0', label: 'CSI', caps: [{ value: 'c0', width: 1920, height: 1080, format: 'video/x-raw', fps: [], fpsmax: 30 }] }
]

function fetchWith (videodev = {}, secondary = {}, extra = {}) {
  return mockFetch({
    '/api/videodevices': { devices, ...videodev },
    '/api/secondarystreams': { streams: [], inUse: ['/dev/video0'], ...secondary },
    ...extra
  })
}

function renderSS (fetchSetup) {
  fetchSetup()
  let ref = null
  const page = renderPage(<SecondaryStreamsPage ref={(r) => { ref = r }} />)
  return { page, getRef: () => ref }
}

function findButton (page, text) {
  return [...page.container.querySelectorAll('button')].find(b => b.textContent.includes(text))
}

describe('#SecondaryStreamsPage()', function () {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

  test('renders title and seeds the first available (not in-use) camera', async function () {
    const { page, getRef } = renderSS(() => fetchWith())
    await page.flush()
    expect(page.container.textContent).toContain('Secondary Streams')
    // /dev/video0 is in use → first available is /dev/video2
    expect(getRef().state.addDevice).toBe('/dev/video2')
    expect(getRef().state.addFormat).toBe('image/jpeg')
    page.unmount()
  })

  test('selecting an H264-native camera defaults compression to H264', async function () {
    const { page, getRef } = renderSS(() => fetchWith())
    await page.flush()
    act(() => { getRef().handleDeviceChange({ target: { value: '/dev/video4' } }) })
    expect(getRef().state.addDevice).toBe('/dev/video4')
    expect(getRef().state.addFormat).toBe('video/x-h264')
    expect(getRef().state.addCompression).toBe('H264')
    page.unmount()
  })

  test('changing resolution updates width/height/format', async function () {
    const { page, getRef } = renderSS(() => fetchWith())
    await page.flush()
    act(() => { getRef().handleCapChange({ target: { value: 'c-raw' } }) })
    expect(getRef().state.addWidth).toBe(640)
    expect(getRef().state.addFormat).toBe('video/x-raw')
    page.unmount()
  })

  test('RTP transport reveals destination IP/port fields and field handlers work', async function () {
    const { page, getRef } = renderSS(() => fetchWith())
    await page.flush()
    act(() => { getRef().handleField('addTransport', false)({ target: { value: 'RTP' } }) })
    expect(page.container.textContent).toContain('Destination IP')
    act(() => {
      getRef().handleField('addFps', true)({ target: { value: '24' } })
      getRef().handleField('addBitrate', true)({ target: { value: '3000' } })
      getRef().handleField('addRotation', true)({ target: { value: '90' } })
      getRef().handleField('addCompression', false)({ target: { value: 'H265' } })
      getRef().handleField('addUdpIP', false)({ target: { value: '10.0.0.9' } })
      getRef().handleField('addUdpPort', true)({ target: { value: '5610' } })
    })
    expect(getRef().state.addFps).toBe(24)
    expect(getRef().state.addBitrate).toBe(3000)
    expect(getRef().state.addRotation).toBe(90)
    expect(getRef().state.addCompression).toBe('H265')
    expect(getRef().state.addUdpPort).toBe(5610)
    page.unmount()
  })

  test('addStream success updates the list (and refreshes)', async function () {
    const fetch = mockFetch({
      '/api/videodevices': { devices },
      '/api/secondarystreams': { streams: [], inUse: ['/dev/video0'] },
      'POST /api/secondarystreamadd': { streams: [{ id: 0, config: { device: '/dev/video2', width: 1280, height: 720, compression: 'H264', fps: 30, bitrate: 2000 }, running: true, address: 'rtsp://x:8555/devvideo2' }], error: null }
    })
    const { page } = (function () {
      let ref = null
      const p = renderPage(<SecondaryStreamsPage ref={(r) => { ref = r }} />)
      return { page: p, getRef: () => ref }
    })()
    await page.flush()
    act(() => { findButton(page, 'Add Stream').click() })
    await page.flush()
    expect(fetch).toHaveBeenCalledWith('/api/secondarystreamadd', expect.objectContaining({ method: 'POST' }))
    expect(page.container.textContent).toContain('rtsp://x:8555/devvideo2')
    page.unmount()
  })

  test('addStream error shows the warning', async function () {
    const { page } = renderSS(() => fetchWith({}, {}, { 'POST /api/secondarystreamadd': { streams: [], error: 'That camera is already in use by another stream' } }))
    await page.flush()
    act(() => { findButton(page, 'Add Stream').click() })
    await page.flush()
    expect(page.container.textContent).toContain('already in use')
    page.unmount()
  })

  test('addStream fetch failure is caught', async function () {
    const { page } = renderSS(() => fetchWith({}, {}, { 'POST /api/secondarystreamadd': () => { throw new Error('net') } }))
    await page.flush()
    act(() => { findButton(page, 'Add Stream').click() })
    await page.flush()
    expect(page.container.textContent).toContain('Could not add stream')
    page.unmount()
  })

  test('renders stream cards (running + stopped) and removes one', async function () {
    const fetch = mockFetch({
      '/api/videodevices': { devices },
      '/api/secondarystreams': { streams: [
        { id: 0, config: { device: '/dev/video2', width: 1280, height: 720, compression: 'H264', fps: 30, bitrate: 2000 }, running: true, address: 'rtsp://x:8555/devvideo2' },
        { id: 1, config: { device: '/dev/video4', width: 640, height: 480, compression: 'H264', fps: 15, bitrate: 1000 }, running: false, address: 'RTP → udp://10.0.0.2:5602' }
      ], inUse: ['/dev/video0', '/dev/video2', '/dev/video4'] },
      'POST /api/secondarystreamremove': { streams: [], error: null }
    })
    let ref = null
    const page = renderPage(<SecondaryStreamsPage ref={(r) => { ref = r }} />)
    await page.flush()
    expect(page.container.textContent).toContain('running')
    expect(page.container.textContent).toContain('stopped')
    // every camera in use → the add form shows the no-spare note
    expect(page.container.textContent).toContain('No spare cameras')
    act(() => { findButton(page, 'Remove').click() })
    await page.flush()
    expect(fetch).toHaveBeenCalledWith('/api/secondarystreamremove', expect.objectContaining({ method: 'POST' }))
    expect(ref.state.streams.length).toBe(0)
    page.unmount()
  })

  test('remove response carrying inUse but no streams updates inUse and clears the list', async function () {
    let ref = null
    mockFetch({
      '/api/videodevices': { devices },
      '/api/secondarystreams': { streams: [{ id: 0, config: { device: '/dev/video2', width: 1280, height: 720, compression: 'H264', fps: 30, bitrate: 2000 }, running: true, address: 'rtsp://x' }], inUse: ['/dev/video2'] },
      'POST /api/secondarystreamremove': { inUse: ['/dev/video9'], error: null }
    })
    const page = renderPage(<SecondaryStreamsPage ref={(r) => { ref = r }} />)
    await page.flush()
    act(() => { findButton(page, 'Remove').click() })
    await page.flush()
    expect(ref.state.streams).toEqual([])
    expect(ref.state.inUse).toEqual(['/dev/video9'])
    page.unmount()
  })

  test('removeStream fetch failure is caught', async function () {
    let ref = null
    mockFetch({
      '/api/videodevices': { devices },
      '/api/secondarystreams': { streams: [{ id: 0, config: { device: '/dev/video2', width: 1280, height: 720, compression: 'H264', fps: 30, bitrate: 2000 }, running: true, address: 'rtsp://x' }], inUse: ['/dev/video2'] },
      'POST /api/secondarystreamremove': () => { throw new Error('net') }
    })
    const page = renderPage(<SecondaryStreamsPage ref={(r) => { ref = r }} />)
    await page.flush()
    act(() => { findButton(page, 'Remove').click() })
    await page.flush()
    expect(page.container.textContent).toContain('Could not remove stream')
    page.unmount()
  })

  test('with no spare cameras, no add form is shown', async function () {
    const { page } = renderSS(() => fetchWith({}, { inUse: ['/dev/video0', '/dev/video2', '/dev/video4'] }))
    await page.flush()
    expect(page.container.textContent).toContain('No spare cameras')
    expect(page.container.textContent).toContain('None yet')
    page.unmount()
  })

  test('tolerates API responses missing devices / streams / inUse keys', async function () {
    let ref = null
    mockFetch({ '/api/videodevices': {}, '/api/secondarystreams': {} })
    const page = renderPage(<SecondaryStreamsPage ref={(r) => { ref = r }} />)
    await page.flush()
    expect(ref.state.devices).toEqual([])
    expect(ref.state.streams).toEqual([])
    expect(ref.state.inUse).toEqual([])
    page.unmount()
  })

  test('selecting a camera with no capabilities clears the cap fields', async function () {
    const noCaps = [{ value: '/dev/video5', label: 'NoCaps' }, ...devices]
    const { page, getRef } = renderSS(() => fetchWith({ devices: noCaps }))
    await page.flush()
    act(() => { getRef().handleDeviceChange({ target: { value: '/dev/video5' } }) })
    expect(getRef().state.addDevice).toBe('/dev/video5')
    expect(getRef().state.addCapSelected).toBe('')
    expect(getRef().state.addWidth).toBe(0)
    expect(getRef().state.addFormat).toBe('')
    page.unmount()
  })

  test('seedDevice is a no-op once a device is already chosen', async function () {
    const { page, getRef } = renderSS(() => fetchWith())
    await page.flush()
    const before = getRef().state.addDevice
    act(() => { getRef().seedDevice() })
    expect(getRef().state.addDevice).toBe(before)
    page.unmount()
  })

  test('add response carrying inUse but no streams updates inUse and clears the list', async function () {
    const { page, getRef } = renderSS(() => fetchWith({}, {}, { 'POST /api/secondarystreamadd': { inUse: ['/dev/video0', '/dev/video2'], error: null } }))
    await page.flush()
    act(() => { findButton(page, 'Add Stream').click() })
    await page.flush()
    expect(getRef().state.streams).toEqual([])
    expect(getRef().state.inUse).toEqual(['/dev/video0', '/dev/video2'])
    page.unmount()
  })

  test('handleDeviceChange ignores an unknown device value', async function () {
    const { page, getRef } = renderSS(() => fetchWith())
    await page.flush()
    const before = getRef().state.addDevice
    act(() => { getRef().handleDeviceChange({ target: { value: '/dev/nope' } }) })
    expect(getRef().state.addDevice).toBe(before)
    page.unmount()
  })

  test('handleCapChange ignores an unknown cap value', async function () {
    const { page, getRef } = renderSS(() => fetchWith())
    await page.flush()
    const before = getRef().state.addCapSelected
    act(() => { getRef().handleCapChange({ target: { value: 'nope' } }) })
    expect(getRef().state.addCapSelected).toBe(before)
    page.unmount()
  })
})
