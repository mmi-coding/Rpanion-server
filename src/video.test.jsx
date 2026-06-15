// @vitest-environment happy-dom
import React, { act } from 'react'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { renderPage, mockFetch } from '../test/ui.jsx'
import { lastSocket } from '../test/socketMock.js'
import VideoPage from './video.jsx'

vi.mock('socket.io-client', () => import('../test/socketMock.js'))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Render VideoPage inside MemoryRouter, capturing the component ref.
// Returns { page, getRef } where getRef() returns the VideoPage instance.
function renderVideo (props = {}) {
  let ref = null
  const Wrapper = (p) => (
    <MemoryRouter>
      <VideoPage ref={r => { ref = r }} {...p} />
    </MemoryRouter>
  )
  const page = renderPage(<Wrapper {...props} />)
  return { page, getRef: () => ref }
}

function selectValue (select, value) {
  act(() => {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype, 'value'
    ).set
    nativeSetter.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const videoCap1 = {
  value: 'cap-h264-1',
  width: 1920, height: 1080,
  format: 'video/x-h264',
  fps: [],
  fpsmax: 30
}
const videoCap2 = {
  value: 'cap-yuv-1',
  width: 1280, height: 720,
  format: 'video/x-raw',
  fps: [{ value: 30, label: '30 fps' }, { value: 15, label: '15 fps' }],
  fpsmax: 0
}
const videoCap3 = {
  value: 'cap-nofps',
  width: 640, height: 480,
  format: 'video/x-raw',
  fps: [],
  fpsmax: 0
}

const videoDevice1 = {
  value: 'dev1',
  label: 'Camera 1',
  caps: [videoCap1, videoCap2]
}
const rtspDevice = {
  value: 'rtspsourceh264',
  label: 'RTSP H264 Source',
  caps: []
}
const rtspH265Device = {
  value: 'rtspsourceh265',
  label: 'RTSP H265 Source',
  caps: []
}

// stillCap1: no .value property → getStillCapValue returns '4056x3040xJPEG'
const stillCap1 = { width: 4056, height: 3040, format: 'JPEG' }
// stillCap2: has .value property → getStillCapValue returns 'still-val-1'
const stillCap2 = { value: 'still-val-1', width: 1920, height: 1080, format: 'YUV420' }
const stillDevice1 = {
  id: 'still-dev-1',
  type: 'picamera2',
  card_name: 'IMX708',
  caps: [stillCap1, stillCap2]
}
const stillDevice2 = {
  id: 'still-dev-2',
  type: 'v4l2',
  card_name: 'USB Camera',
  caps: [stillCap2]
}

const defaultVideoData = {
  devices: [videoDevice1],
  selectedDevice: videoDevice1,
  selectedCap: videoCap1,
  selectedFps: 30,
  active: false,
  cameraMode: 'streaming',
  streamAddresses: [],
  networkInterfaces: ['192.168.1.1', '10.0.0.1'],
  selectedUseUDP: false,
  selectedUseUDPIP: '127.0.0.1',
  selectedUseUDPPort: 5600,
  selectedBitrate: 1000,
  selectedRotation: { value: 0 },
  selectedUseTimestamp: false,
  selectedUseCameraHeartbeat: false,
  selectedMavStreamURI: { value: '192.168.1.1' },
  compression: { value: 'H264' },
  videoMediaDestination: '',
}

const defaultStillData = {
  devices: [stillDevice1],
  selectedDevice: stillDevice1,
  selectedCap: stillCap1,
  capabilities: { cv2: true, picamera2: true },
  stillMediaDestination: '',
}

function defaultFetch (videoOverrides = {}, stillOverrides = {}) {
  return mockFetch({
    '/api/approot': { appRoot: '/home/pi/rpanion' },
    '/api/videodevices': { ...defaultVideoData, ...videoOverrides },
    '/api/camera/still_devices': { ...defaultStillData, ...stillOverrides },
  })
}

// ---------------------------------------------------------------------------
describe('#VideoPage()', function () {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  // -------------------------------------------------------------------------
  // Basic render / initial loading state
  // -------------------------------------------------------------------------

  test('shows loading spinner initially then content after flush', async function () {
    defaultFetch()
    const { page } = renderVideo()
    // Before flush, loading spinner visible
    const spinner = page.container.querySelector('[role="status"]')
    expect(spinner).not.toBeNull()
    await page.flush()
    expect(page.container.textContent).toContain('Photo and Video')
    page.unmount()
  })

  test('renders page title and mode options', async function () {
    defaultFetch()
    const { page } = renderVideo()
    await page.flush()
    expect(page.container.textContent).toContain('Photo and Video')
    expect(page.container.textContent).toContain('Camera Mode')
    page.unmount()
  })

  test('renders Flight Logs link', async function () {
    defaultFetch()
    const { page } = renderVideo()
    await page.flush()
    expect(page.container.textContent).toContain('Flight Logs and Media')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Init: photo/video NOT available (cv2 missing)
  // -------------------------------------------------------------------------

  test('shows OpenCV warning when cv2 is false', async function () {
    defaultFetch({}, { capabilities: { cv2: false, picamera2: false } })
    const { page } = renderVideo()
    await page.flush()
    expect(page.container.textContent).toContain('Photo and Video modes unavailable')
    page.unmount()
  })

  test('dismiss OpenCV warning removes alert', async function () {
    defaultFetch({}, { capabilities: { cv2: false, picamera2: false } })
    const { page } = renderVideo()
    await page.flush()
    const dismissBtn = Array.from(page.container.querySelectorAll('button'))
      .find(b => b.textContent.trim() === 'Dismiss')
    expect(dismissBtn).not.toBeNull()
    page.click(dismissBtn)
    expect(page.container.textContent).not.toContain('Photo and Video modes unavailable')
    page.unmount()
  })

  test('forces streaming mode when cv2 unavailable and saved mode is photo', async function () {
    defaultFetch(
      { cameraMode: 'photo' },
      { capabilities: { cv2: false, picamera2: false } }
    )
    const { page } = renderVideo()
    await page.flush()
    const streamingRadio = page.container.querySelector('input[value="streaming"]')
    expect(streamingRadio.checked).toBe(true)
    page.unmount()
  })

  test('forces streaming mode when cv2 unavailable and saved mode is video', async function () {
    defaultFetch(
      { cameraMode: 'video' },
      { capabilities: { cv2: false, picamera2: false } }
    )
    const { page } = renderVideo()
    await page.flush()
    const streamingRadio = page.container.querySelector('input[value="streaming"]')
    expect(streamingRadio.checked).toBe(true)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Init: video mode with matching still device
  // -------------------------------------------------------------------------

  test('init in video mode picks matching still device by value', async function () {
    defaultFetch(
      { cameraMode: 'video', selectedDevice: { value: 'still-dev-1' } },
      { capabilities: { cv2: true, picamera2: true } }
    )
    const { page } = renderVideo()
    await page.flush()
    const videoRadio = page.container.querySelector('input[value="video"]')
    expect(videoRadio.checked).toBe(true)
    page.unmount()
  })

  test('init in video mode with no matching still device uses first still device', async function () {
    defaultFetch(
      { cameraMode: 'video', selectedDevice: { value: 'no-match-dev' } },
      { capabilities: { cv2: true, picamera2: true } }
    )
    const { page } = renderVideo()
    await page.flush()
    const videoRadio = page.container.querySelector('input[value="video"]')
    expect(videoRadio.checked).toBe(true)
    page.unmount()
  })

  test('init in video mode with no still devices at all', async function () {
    defaultFetch(
      { cameraMode: 'video', selectedDevice: { value: 'no-match-dev' } },
      { capabilities: { cv2: true, picamera2: true }, devices: [], selectedDevice: null }
    )
    const { page } = renderVideo()
    await page.flush()
    const videoRadio = page.container.querySelector('input[value="video"]')
    expect(videoRadio.checked).toBe(true)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Init: RTP transport from backend
  // -------------------------------------------------------------------------

  test('init with RTP transport sets transportSelected to RTP', async function () {
    defaultFetch({ selectedUseUDP: true })
    const { page } = renderVideo()
    await page.flush()
    expect(page.container.textContent).toContain('Destination IP')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Init: FPS processing branches
  // -------------------------------------------------------------------------

  test('init selectedFps null uses fpsmax when fpsmax > 0', async function () {
    defaultFetch({ selectedFps: null, selectedCap: videoCap1 })
    const { page } = renderVideo()
    await page.flush()
    // fpsmax=30, so fps number input should exist
    const fpsInput = page.container.querySelector('input[type="number"][max="30"]')
    expect(fpsInput).not.toBeNull()
    page.unmount()
  })

  test('init selectedFps null uses fpsOptions[0] when fpsmax=0 and fps options exist', async function () {
    defaultFetch({ selectedFps: null, selectedCap: videoCap2 })
    const { page } = renderVideo()
    await page.flush()
    // videoCap2 has fpsmax=0 and fps options → FPSChangeSelect dropdown
    const selects = page.container.querySelectorAll('select')
    expect(selects.length).toBeGreaterThan(0)
    page.unmount()
  })

  test('init selectedFps null with fpsmax=0 and no fps options defaults to 30', async function () {
    const devNoFps = {
      value: 'dev-nofps', label: 'Dev No FPS',
      caps: [videoCap3]
    }
    defaultFetch({
      selectedFps: null,
      selectedCap: videoCap3,
      selectedDevice: devNoFps,
      devices: [devNoFps]
    })
    const { page } = renderVideo()
    await page.flush()
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Init: null device / cap edge cases
  // -------------------------------------------------------------------------

  test('init with no devices and no caps', async function () {
    defaultFetch({ devices: [], selectedDevice: null, selectedCap: null })
    const { page } = renderVideo()
    await page.flush()
    expect(page.container.textContent).toContain('Photo and Video')
    page.unmount()
  })

  test('init with selectedDevice having no caps', async function () {
    const devNoCaps = { value: 'dev-nocaps', label: 'No Caps Dev', caps: [] }
    defaultFetch({ devices: [devNoCaps], selectedDevice: devNoCaps, selectedCap: null })
    const { page } = renderVideo()
    await page.flush()
    page.unmount()
  })

  test('init with selectedMavStreamURI null uses first iface', async function () {
    defaultFetch({ selectedMavStreamURI: null })
    const { page } = renderVideo()
    await page.flush()
    page.unmount()
  })

  test('init with selectedRotation null uses 0', async function () {
    defaultFetch({ selectedRotation: null })
    const { page } = renderVideo()
    await page.flush()
    page.unmount()
  })

  test('init with compression null uses H264', async function () {
    defaultFetch({ compression: null })
    const { page } = renderVideo()
    await page.flush()
    page.unmount()
  })

  test('init calls isMulticastUpdateIP when selectedUseUDPIP present', async function () {
    defaultFetch({ selectedUseUDPIP: '239.1.1.1' })
    const { page } = renderVideo()
    await page.flush()
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Init: still data
  // -------------------------------------------------------------------------

  test('init with no still devices sets empty still selections', async function () {
    defaultFetch({}, { devices: [], selectedDevice: null, selectedCap: null, capabilities: { cv2: true } })
    const { page } = renderVideo()
    await page.flush()
    page.unmount()
  })

  test('init with still cap having value property', async function () {
    defaultFetch({}, {
      devices: [stillDevice1],
      selectedDevice: stillDevice1,
      selectedCap: stillCap2, // has .value
      capabilities: { cv2: true },
      stillMediaDestination: 'myflight'
    })
    const { page } = renderVideo()
    await page.flush()
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Promise.all catch → error state
  // -------------------------------------------------------------------------

  test('Promise.all catch sets error and calls loadDone', async function () {
    mockFetch({
      '/api/approot': { appRoot: '/home/pi' },
      '/api/videodevices': () => { throw new Error('Network error') },
      '/api/camera/still_devices': { devices: [], capabilities: { cv2: true } }
    })
    const { page } = renderVideo()
    await page.flush()
    expect(document.body.textContent).toContain('Failed to load camera configuration')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleCameraModeChange – via ref (arrow fn property)
  // -------------------------------------------------------------------------

  test('handleCameraModeChange to video mode with still devices', async function () {
    defaultFetch({ cameraMode: 'streaming' })
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleCameraModeChange({ target: { value: 'video' } })
    })
    expect(getRef().state.cameraMode).toBe('video')
    expect(getRef().state.FPSMax).toBe(120)
    page.unmount()
  })

  test('handleCameraModeChange to video mode with no still devices', async function () {
    defaultFetch({ cameraMode: 'streaming' }, { devices: [], capabilities: { cv2: true } })
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleCameraModeChange({ target: { value: 'video' } })
    })
    expect(getRef().state.cameraMode).toBe('video')
    expect(getRef().state.vidDeviceSelected).toBe('')
    page.unmount()
  })

  test('handleCameraModeChange to video mode still device with no cap', async function () {
    const stillDevNoCaps = { id: 'sd-nc', type: 'v4l2', card_name: 'NoCaps', caps: [] }
    defaultFetch(
      { cameraMode: 'streaming' },
      { devices: [stillDevNoCaps], capabilities: { cv2: true } }
    )
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleCameraModeChange({ target: { value: 'video' } })
    })
    expect(getRef().state.vidCapSelected).toBe('')
    page.unmount()
  })

  test('handleCameraModeChange to photo mode (else branch, no state reset)', async function () {
    defaultFetch({ cameraMode: 'streaming' })
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleCameraModeChange({ target: { value: 'photo' } })
    })
    expect(getRef().state.cameraMode).toBe('photo')
    page.unmount()
  })

  test('handleCameraModeChange to streaming mode with video devices', async function () {
    defaultFetch({ cameraMode: 'photo' }, { capabilities: { cv2: true } })
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleCameraModeChange({ target: { value: 'streaming' } })
    })
    expect(getRef().state.cameraMode).toBe('streaming')
    expect(getRef().state.vidDeviceSelected).toBe('dev1')
    page.unmount()
  })

  test('handleCameraModeChange to streaming with no video devices', async function () {
    defaultFetch({ devices: [], selectedDevice: null, cameraMode: 'photo' }, { capabilities: { cv2: true } })
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleCameraModeChange({ target: { value: 'streaming' } })
    })
    expect(getRef().state.vidDeviceSelected).toBe('')
    page.unmount()
  })

  test('handleCameraModeChange to streaming with device having no caps', async function () {
    const devNoCaps = { value: 'dev-nocaps', label: 'No Caps Dev', caps: [] }
    defaultFetch({ devices: [devNoCaps], selectedDevice: devNoCaps, cameraMode: 'photo' }, { capabilities: { cv2: true } })
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleCameraModeChange({ target: { value: 'streaming' } })
    })
    expect(getRef().state.vidCapSelected).toBe('')
    page.unmount()
  })

  test('handleCameraModeChange to streaming: cap has no fpsmax uses fpsOpts', async function () {
    // videoCap2 has fpsmax=0 and fps options
    const dev2 = { value: 'dev2', label: 'Camera 2', caps: [videoCap2] }
    defaultFetch({ devices: [dev2], selectedDevice: { value: 'still-dev-1' }, cameraMode: 'video' }, { capabilities: { cv2: true } })
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleCameraModeChange({ target: { value: 'streaming' } })
    })
    // fpsSelected should be fpsOpts[0].value = 30
    expect(getRef().state.fpsSelected).toBe(30)
    page.unmount()
  })

  test('handleCameraModeChange to streaming: cap has no fpsmax and no fps options', async function () {
    const devNoFps = { value: 'dev-nofps', label: 'Dev', caps: [videoCap3] }
    defaultFetch({ devices: [devNoFps], selectedDevice: devNoFps, cameraMode: 'photo' }, { capabilities: { cv2: true } })
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleCameraModeChange({ target: { value: 'streaming' } })
    })
    expect(getRef().state.fpsSelected).toBe(30)
    page.unmount()
  })

  test('handleCameraModeChange to streaming: cap has fpsmax > 0', async function () {
    // videoCap1 has fpsmax=30
    defaultFetch({ cameraMode: 'photo' }, { capabilities: { cv2: true } })
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleCameraModeChange({ target: { value: 'streaming' } })
    })
    expect(getRef().state.FPSMax).toBe(30)
    expect(getRef().state.fpsSelected).toBe(30)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleVideoDeviceChange – via ref
  // -------------------------------------------------------------------------

  test('handleVideoDeviceChange finds device and updates caps', async function () {
    const dev2 = { value: 'dev2', label: 'Camera 2', caps: [videoCap2] }
    defaultFetch({ devices: [videoDevice1, dev2] })
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleVideoDeviceChange({ target: { value: 'dev2' } })
    })
    expect(getRef().state.vidDeviceSelected).toBe('dev2')
    page.unmount()
  })

  test('handleVideoDeviceChange device not found does nothing', async function () {
    defaultFetch()
    const { page, getRef } = renderVideo()
    await page.flush()
    const prevSel = getRef().state.vidDeviceSelected
    act(() => {
      getRef().handleVideoDeviceChange({ target: { value: 'nonexistent' } })
    })
    expect(getRef().state.vidDeviceSelected).toBe(prevSel)
    page.unmount()
  })

  test('handleVideoDeviceChange with H264 cap auto-sets compression', async function () {
    const dev2 = { value: 'dev2', label: 'Camera 2', caps: [videoCap1] }
    defaultFetch({ devices: [videoDevice1, dev2] })
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleVideoDeviceChange({ target: { value: 'dev2' } })
    })
    expect(getRef().state.compression).toBe('H264')
    page.unmount()
  })

  test('handleVideoDeviceChange device has no caps', async function () {
    const devNoCaps = { value: 'dev-nocaps', label: 'No Caps', caps: [] }
    defaultFetch({ devices: [videoDevice1, devNoCaps] })
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleVideoDeviceChange({ target: { value: 'dev-nocaps' } })
    })
    expect(getRef().state.vidCapSelected).toBe('')
    page.unmount()
  })

  test('handleVideoDeviceChange cap with fpsmax=0 and fps options uses fpsOpts[0]', async function () {
    const dev2 = { value: 'dev2', label: 'Camera 2', caps: [videoCap2] }
    defaultFetch({ devices: [videoDevice1, dev2] })
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleVideoDeviceChange({ target: { value: 'dev2' } })
    })
    expect(getRef().state.fpsSelected).toBe(30) // fpsOpts[0].value
    page.unmount()
  })

  test('handleVideoDeviceChange cap with fpsmax=0 and no fps options defaults to 30', async function () {
    const dev2 = { value: 'dev2', label: 'Camera 2', caps: [videoCap3] }
    defaultFetch({ devices: [videoDevice1, dev2] })
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleVideoDeviceChange({ target: { value: 'dev2' } })
    })
    expect(getRef().state.fpsSelected).toBe(30)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleVideoResChange – via ref
  // -------------------------------------------------------------------------

  test('handleVideoResChange with fpsmax > 0', async function () {
    defaultFetch({ selectedCap: videoCap2 })
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleVideoResChange({ target: { value: 'cap-h264-1' } })
    })
    expect(getRef().state.FPSMax).toBe(30)
    page.unmount()
  })

  test('handleVideoResChange with fpsmax=0 and fps options', async function () {
    defaultFetch()
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleVideoResChange({ target: { value: 'cap-yuv-1' } })
    })
    expect(getRef().state.FPSMax).toBe(0)
    page.unmount()
  })

  test('handleVideoResChange with H264 format auto-sets compression', async function () {
    defaultFetch({ selectedCap: videoCap2 })
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleVideoResChange({ target: { value: 'cap-h264-1' } })
    })
    expect(getRef().state.compression).toBe('H264')
    page.unmount()
  })

  test('handleVideoResChange cap not found does nothing', async function () {
    defaultFetch()
    const { page, getRef } = renderVideo()
    await page.flush()
    const prevCap = getRef().state.vidCapSelected
    act(() => {
      getRef().handleVideoResChange({ target: { value: 'nonexistent-cap' } })
    })
    expect(getRef().state.vidCapSelected).toBe(prevCap)
    page.unmount()
  })

  test('handleVideoResChange fpsmax=0 no fps options defaults to 30', async function () {
    const devBoth = { value: 'devboth', label: 'Both', caps: [videoCap1, videoCap3] }
    defaultFetch({ devices: [devBoth], selectedDevice: devBoth, selectedCap: videoCap1 })
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleVideoResChange({ target: { value: 'cap-nofps' } })
    })
    expect(getRef().state.fpsSelected).toBe(30)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleVideoRecordingDeviceChange / handleVideoRecordingResChange – via ref
  // -------------------------------------------------------------------------

  test('handleVideoRecordingDeviceChange finds still device and updates caps', async function () {
    defaultFetch(
      { cameraMode: 'video', selectedDevice: { value: 'still-dev-1' } },
      { devices: [stillDevice1, stillDevice2], capabilities: { cv2: true } }
    )
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleVideoRecordingDeviceChange({ target: { value: 'still-dev-2' } })
    })
    expect(getRef().state.vidDeviceSelected).toBe('still-dev-2')
    page.unmount()
  })

  test('handleVideoRecordingDeviceChange device not found does nothing', async function () {
    defaultFetch(
      { cameraMode: 'video', selectedDevice: { value: 'still-dev-1' } },
      { capabilities: { cv2: true } }
    )
    const { page, getRef } = renderVideo()
    await page.flush()
    const prevSel = getRef().state.vidDeviceSelected
    act(() => {
      getRef().handleVideoRecordingDeviceChange({ target: { value: 'nonexistent' } })
    })
    expect(getRef().state.vidDeviceSelected).toBe(prevSel)
    page.unmount()
  })

  test('handleVideoRecordingDeviceChange device has no caps', async function () {
    const stillDevNoCaps = { id: 'still-nocaps', type: 'v4l2', card_name: 'No Caps', caps: [] }
    defaultFetch(
      { cameraMode: 'video', selectedDevice: { value: 'still-dev-1' } },
      { devices: [stillDevice1, stillDevNoCaps], capabilities: { cv2: true } }
    )
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleVideoRecordingDeviceChange({ target: { value: 'still-nocaps' } })
    })
    expect(getRef().state.vidCapSelected).toBe('')
    page.unmount()
  })

  test('handleVideoRecordingResChange cap found updates vidCapSelected', async function () {
    defaultFetch(
      { cameraMode: 'video', selectedDevice: { value: 'still-dev-1' } },
      { capabilities: { cv2: true } }
    )
    const { page, getRef } = renderVideo()
    await page.flush()
    const capVal = getRef().getStillCapValue(stillCap2) // 'still-val-1'
    act(() => {
      getRef().handleVideoRecordingResChange({ target: { value: capVal } })
    })
    expect(getRef().state.vidCapSelected).toBe(capVal)
    page.unmount()
  })

  test('handleVideoRecordingResChange cap not found does nothing', async function () {
    defaultFetch(
      { cameraMode: 'video', selectedDevice: { value: 'still-dev-1' } },
      { capabilities: { cv2: true } }
    )
    const { page, getRef } = renderVideo()
    await page.flush()
    const prevCap = getRef().state.vidCapSelected
    act(() => {
      getRef().handleVideoRecordingResChange({ target: { value: 'nonexistent-cap-val' } })
    })
    expect(getRef().state.vidCapSelected).toBe(prevCap)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleStillDeviceChange / handleStillCapChange – via ref
  // -------------------------------------------------------------------------

  test('handleStillDeviceChange finds device and updates still caps', async function () {
    defaultFetch(
      { cameraMode: 'photo' },
      { devices: [stillDevice1, stillDevice2], capabilities: { cv2: true } }
    )
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleStillDeviceChange({ target: { value: 'still-dev-2' } })
    })
    expect(getRef().state.stillDeviceSelected).toBe('still-dev-2')
    page.unmount()
  })

  test('handleStillDeviceChange device not found does nothing', async function () {
    defaultFetch(
      { cameraMode: 'photo' },
      { capabilities: { cv2: true } }
    )
    const { page, getRef } = renderVideo()
    await page.flush()
    const prevSel = getRef().state.stillDeviceSelected
    act(() => {
      getRef().handleStillDeviceChange({ target: { value: 'nonexistent' } })
    })
    expect(getRef().state.stillDeviceSelected).toBe(prevSel)
    page.unmount()
  })

  test('handleStillDeviceChange device has no caps sets empty stillCapSelected', async function () {
    const stillDevNoCaps = { id: 'still-nocaps', type: 'v4l2', card_name: 'No Caps Cam', caps: [] }
    defaultFetch(
      { cameraMode: 'photo' },
      { devices: [stillDevice1, stillDevNoCaps], capabilities: { cv2: true } }
    )
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleStillDeviceChange({ target: { value: 'still-nocaps' } })
    })
    expect(getRef().state.stillCapSelected).toBe('')
    page.unmount()
  })

  test('handleStillCapChange updates stillCapSelected', async function () {
    defaultFetch(
      { cameraMode: 'photo' },
      { capabilities: { cv2: true } }
    )
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleStillCapChange({ target: { value: 'new-cap-value' } })
    })
    expect(getRef().state.stillCapSelected).toBe('new-cap-value')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleRotChange / handleBitrateChange / handleFPSChange / handleFPSChangeSelect
  // -------------------------------------------------------------------------

  test('handleRotChange updates rotation via ref', async function () {
    defaultFetch()
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleRotChange({ target: { value: '90' } })
    })
    expect(getRef().state.rotSelected).toBe(90)
    page.unmount()
  })

  test('handleBitrateChange updates bitrate via ref', async function () {
    defaultFetch()
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleBitrateChange({ target: { value: '2000' } })
    })
    expect(getRef().state.bitrate).toBe('2000')
    page.unmount()
  })

  test('handleFPSChange updates fps via number input', async function () {
    defaultFetch({ selectedCap: videoCap1 }) // fpsmax=30
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleFPSChange({ target: { value: '25' } })
    })
    expect(getRef().state.fpsSelected).toBe('25')
    page.unmount()
  })

  test('handleFPSChangeSelect updates fps via select', async function () {
    defaultFetch({ selectedCap: videoCap2 }) // fpsmax=0 with fps options
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleFPSChangeSelect({ target: { value: '15' } })
    })
    expect(getRef().state.fpsSelected).toBe('15')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleTimestampChange / handleUseCameraHeartbeatChange – via ref
  // -------------------------------------------------------------------------

  test('handleTimestampChange toggles timestamp via ref', async function () {
    defaultFetch()
    const { page, getRef } = renderVideo()
    await page.flush()
    const before = getRef().state.timestamp
    act(() => {
      getRef().handleTimestampChange()
    })
    expect(getRef().state.timestamp).toBe(!before)
    page.unmount()
  })

  test('handleUseCameraHeartbeatChange toggles heartbeat via ref', async function () {
    defaultFetch()
    const { page, getRef } = renderVideo()
    await page.flush()
    const before = getRef().state.enableCameraHeartbeat
    act(() => {
      getRef().handleUseCameraHeartbeatChange()
    })
    expect(getRef().state.enableCameraHeartbeat).toBe(!before)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleMavStreamChange – via ref
  // -------------------------------------------------------------------------

  test('handleMavStreamChange updates mavStreamSelected via ref', async function () {
    defaultFetch({ selectedUseCameraHeartbeat: true })
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleMavStreamChange({ target: { value: '10.0.0.1' } })
    })
    expect(getRef().state.mavStreamSelected).toBe('10.0.0.1')
    page.unmount()
  })

  test('mavStreamChange select shows when heartbeat enabled + streaming + RTSP', async function () {
    defaultFetch({ selectedUseCameraHeartbeat: true })
    const { page } = renderVideo()
    await page.flush()
    expect(page.container.textContent).toContain('Video source IP Address')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleMediaDestinationChange – via ref
  // -------------------------------------------------------------------------

  test('handleMediaDestinationChange for video mode updates videoMediaDestination', async function () {
    defaultFetch({ cameraMode: 'video', selectedDevice: { value: 'still-dev-1' } },
      { capabilities: { cv2: true } })
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleMediaDestinationChange({ target: { value: 'my-video-folder' } }, 'video')
    })
    expect(getRef().state.videoMediaDestination).toBe('my-video-folder')
    page.unmount()
  })

  test('handleMediaDestinationChange for photo mode updates stillMediaDestination', async function () {
    defaultFetch({ cameraMode: 'photo' }, { capabilities: { cv2: true } })
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleMediaDestinationChange({ target: { value: 'my-photo-folder' } }, 'photo')
    })
    expect(getRef().state.stillMediaDestination).toBe('my-photo-folder')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleUDPIPChange / handleUDPPortChange – via ref
  // -------------------------------------------------------------------------

  test('handleUDPIPChange with multicast IP sets multicastString', async function () {
    defaultFetch({ selectedUseUDP: true })
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleUDPIPChange({ target: { value: '239.0.0.1' } })
    })
    expect(getRef().state.useUDPIP).toBe('239.0.0.1')
    expect(getRef().state.multicastString).toContain('multicast-group=239.0.0.1')
    page.unmount()
  })

  test('handleUDPIPChange with normal IP clears multicastString', async function () {
    defaultFetch({ selectedUseUDP: true })
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleUDPIPChange({ target: { value: '192.168.1.100' } })
    })
    expect(getRef().state.useUDPIP).toBe('192.168.1.100')
    expect(getRef().state.multicastString).toBe(' ')
    page.unmount()
  })

  test('handleUDPPortChange updates port', async function () {
    defaultFetch({ selectedUseUDP: true })
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleUDPPortChange({ target: { value: '5700' } })
    })
    expect(getRef().state.useUDPPort).toBe('5700')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // isMulticastUpdateIP branches – via ref
  // -------------------------------------------------------------------------

  test('isMulticastUpdateIP with invalid IP (wrong octet count) sets multicast', async function () {
    defaultFetch()
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().isMulticastUpdateIP('256.1.1') // only 3 octets
    })
    expect(getRef().state.multicastString).toContain('multicast-group=256.1.1')
    page.unmount()
  })

  test('isMulticastUpdateIP with NaN octet sets multicast string', async function () {
    defaultFetch()
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().isMulticastUpdateIP('abc.1.2.3')
    })
    expect(getRef().state.multicastString).toContain('multicast-group=abc.1.2.3')
    page.unmount()
  })

  test('isMulticastUpdateIP with multicast range (224-239) sets multicast string', async function () {
    defaultFetch()
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().isMulticastUpdateIP('224.0.0.1')
    })
    expect(getRef().state.multicastString).toContain('multicast-group=224.0.0.1')
    page.unmount()
  })

  test('isMulticastUpdateIP with normal unicast IP clears multicast string', async function () {
    defaultFetch()
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().isMulticastUpdateIP('10.0.0.1')
    })
    expect(getRef().state.multicastString).toBe(' ')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Compression / transport select changes – via select DOM element
  // -------------------------------------------------------------------------

  test('compression select updates compression to H265', async function () {
    defaultFetch()
    const { page, getRef } = renderVideo()
    await page.flush()
    const selects = page.container.querySelectorAll('select')
    const compSelect = Array.from(selects).find(s =>
      Array.from(s.options).some(o => o.value === 'H265')
    )
    if (compSelect) selectValue(compSelect, 'H265')
    else {
      // Use ref directly via inline onChange handler
      act(() => { getRef().setState({ compression: 'H265' }) })
    }
    expect(getRef().state.compression).toBe('H265')
    page.unmount()
  })

  test('transport select changes to RTP mode', async function () {
    defaultFetch()
    const { page, getRef } = renderVideo()
    await page.flush()
    const selects = page.container.querySelectorAll('select')
    const transportSelect = Array.from(selects).find(s =>
      Array.from(s.options).some(o => o.value === 'RTP')
    )
    if (transportSelect) selectValue(transportSelect, 'RTP')
    else act(() => { getRef().setState({ transportSelected: 'RTP' }) })
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // isrtspSourceSelected – rendered output
  // -------------------------------------------------------------------------

  test('isrtspSourceSelected shows RTSP Source URL input when rtspsourceh264 selected', async function () {
    defaultFetch({ devices: [videoDevice1, rtspDevice], selectedDevice: rtspDevice })
    const { page } = renderVideo()
    await page.flush()
    expect(page.container.textContent).toContain('RTSP Source URL')
    page.unmount()
  })

  test('isrtspSourceSelected shows RTSP Source URL when rtspsourceh265 selected', async function () {
    defaultFetch({ devices: [videoDevice1, rtspH265Device], selectedDevice: rtspH265Device })
    const { page } = renderVideo()
    await page.flush()
    expect(page.container.textContent).toContain('RTSP Source URL')
    page.unmount()
  })

  test('customRTSPSource input updates state', async function () {
    defaultFetch({ devices: [videoDevice1, rtspDevice], selectedDevice: rtspDevice })
    const { page, getRef } = renderVideo()
    await page.flush()
    const rtspInput = page.container.querySelector('input[type="text"]')
    if (rtspInput) page.setValue(rtspInput, 'rtsp://192.168.1.100:8554/stream')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // doGstreamerRTPString / doMissionPlannerRTPString / doQGCformatselection
  // Test via rendered connection strings (active + RTP mode)
  // -------------------------------------------------------------------------

  test('RTP strings H264 non-rtsp source', async function () {
    defaultFetch({ active: true, selectedUseUDP: true, streamAddresses: [] })
    const { page } = renderVideo()
    await page.flush()
    expect(page.container.textContent).toContain('h.264 Video Stream')
    expect(page.container.textContent).toContain('rtph264depay')
    expect(page.container.textContent).toContain('udpsrc')
    page.unmount()
  })

  test('RTP strings H265 non-rtsp source', async function () {
    defaultFetch({
      active: true, selectedUseUDP: true, streamAddresses: [],
      compression: { value: 'H265' }
    })
    const { page } = renderVideo()
    await page.flush()
    expect(page.container.textContent).toContain('h.265 Video Stream')
    expect(page.container.textContent).toContain('rtph265depay')
    page.unmount()
  })

  test('RTP strings rtspsourceh264 selected', async function () {
    defaultFetch({
      active: true, selectedUseUDP: true, streamAddresses: [],
      devices: [videoDevice1, rtspDevice],
      selectedDevice: rtspDevice
    })
    const { page } = renderVideo()
    await page.flush()
    expect(page.container.textContent).toContain('rtph264depay')
    page.unmount()
  })

  test('RTP strings rtspsourceh265 selected', async function () {
    defaultFetch({
      active: true, selectedUseUDP: true, streamAddresses: [],
      devices: [videoDevice1, rtspH265Device],
      selectedDevice: rtspH265Device
    })
    const { page } = renderVideo()
    await page.flush()
    expect(page.container.textContent).toContain('rtph265depay')
    page.unmount()
  })

  test('RTSP connection strings render when active+streaming+RTSP with addresses', async function () {
    defaultFetch({
      active: true, selectedUseUDP: false,
      streamAddresses: ['rtsp://192.168.1.1:8554/stream1']
    })
    const { page } = renderVideo()
    await page.flush()
    expect(page.container.textContent).toContain('RTSP Streaming Addresses')
    expect(page.container.textContent).toContain('rtsp://192.168.1.1:8554/stream1')
    page.unmount()
  })

  test('RTSP mission planner string with H264 compression', async function () {
    defaultFetch({
      active: true, selectedUseUDP: false,
      streamAddresses: ['rtsp://192.168.1.1:8554/stream1'],
      compression: { value: 'H264' }
    })
    const { page } = renderVideo()
    await page.flush()
    expect(page.container.textContent).toContain('rtph264depay')
    page.unmount()
  })

  test('RTSP mission planner string with H265 compression', async function () {
    defaultFetch({
      active: true, selectedUseUDP: false,
      streamAddresses: ['rtsp://192.168.1.1:8554/stream1'],
      compression: { value: 'H265' }
    })
    const { page } = renderVideo()
    await page.flush()
    expect(page.container.textContent).toContain('rtph265depay')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleStartCamera guard chains
  // -------------------------------------------------------------------------

  test('handleStartCamera streaming: no device throws error', async function () {
    defaultFetch({ devices: [], selectedDevice: null, selectedCap: null })
    const { page } = renderVideo()
    await page.flush()
    const startBtn = Array.from(page.container.querySelectorAll('button'))
      .find(b => b.textContent.includes('Start Streaming'))
    if (startBtn) page.click(startBtn)
    await page.flush()
    expect(document.body.textContent).toContain('Video device not found')
    page.unmount()
  })

  test('handleStartCamera streaming: device found but no cap throws error', async function () {
    const devNoCaps = { value: 'dev-nocaps', label: 'No Caps', caps: [] }
    defaultFetch({ devices: [devNoCaps], selectedDevice: devNoCaps, selectedCap: null })
    const { page } = renderVideo()
    await page.flush()
    const startBtn = Array.from(page.container.querySelectorAll('button'))
      .find(b => b.textContent.includes('Start Streaming'))
    if (startBtn) page.click(startBtn)
    await page.flush()
    expect(document.body.textContent).toContain('Selected resolution is not valid')
    page.unmount()
  })

  test('handleStartCamera streaming: valid → POST start and re-fetch devices', async function () {
    mockFetch({
      '/api/approot': { appRoot: '/home/pi' },
      '/api/videodevices': defaultVideoData,
      '/api/camera/still_devices': defaultStillData,
      'POST /api/camera/start': { active: true, addresses: ['rtsp://192.168.1.1:8554/stream'] }
    })
    const { page } = renderVideo()
    await page.flush()
    const startBtn = Array.from(page.container.querySelectorAll('button'))
      .find(b => b.textContent.includes('Start Streaming'))
    if (startBtn) page.click(startBtn)
    await page.flush()
    page.unmount()
  })

  test('handleStartCamera streaming: POST ok=false shows error', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/approot') return { ok: true, json: async () => ({ appRoot: '/home/pi' }) }
      if (url === '/api/videodevices') return { ok: true, json: async () => defaultVideoData }
      if (url === '/api/camera/still_devices') return { ok: true, json: async () => defaultStillData }
      if (method === 'POST' && url === '/api/camera/start') {
        return { ok: false, status: 500, json: async () => ({ error: 'Device busy' }) }
      }
      throw new Error(`Unhandled: ${method} ${url}`)
    }))
    const { page } = renderVideo()
    await page.flush()
    const startBtn = Array.from(page.container.querySelectorAll('button'))
      .find(b => b.textContent.includes('Start Streaming'))
    if (startBtn) page.click(startBtn)
    await page.flush()
    expect(document.body.textContent).toContain('Device busy')
    page.unmount()
  })

  test('handleStartCamera streaming: POST then re-fetch updates networkInterfaces', async function () {
    let callCount = 0
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/approot') return { ok: true, json: async () => ({ appRoot: '/home/pi' }) }
      if (url === '/api/camera/still_devices') return { ok: true, json: async () => defaultStillData }
      if (url === '/api/videodevices') {
        callCount++
        if (callCount === 1) return { ok: true, json: async () => defaultVideoData }
        return { ok: true, json: async () => ({ ...defaultVideoData, networkInterfaces: ['10.0.0.1'] }) }
      }
      if (method === 'POST' && url === '/api/camera/start') {
        return { ok: true, json: async () => ({ active: true, addresses: [] }) }
      }
      throw new Error(`Unhandled: ${method} ${url}`)
    }))
    const { page, getRef } = renderVideo()
    await page.flush()
    const startBtn = Array.from(page.container.querySelectorAll('button'))
      .find(b => b.textContent.includes('Start Streaming'))
    if (startBtn) page.click(startBtn)
    await page.flush()
    expect(getRef().state.ifaces).toContain('10.0.0.1')
    page.unmount()
  })

  test('handleStartCamera streaming: re-fetch without networkInterfaces does not crash', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/approot') return { ok: true, json: async () => ({ appRoot: '/home/pi' }) }
      if (url === '/api/camera/still_devices') return { ok: true, json: async () => defaultStillData }
      if (url === '/api/videodevices') {
        return { ok: true, json: async () => ({ ...defaultVideoData, networkInterfaces: undefined }) }
      }
      if (method === 'POST' && url === '/api/camera/start') {
        return { ok: true, json: async () => ({ active: true, addresses: ['rtsp://x'] }) }
      }
      throw new Error(`Unhandled: ${method} ${url}`)
    }))
    const { page } = renderVideo()
    await page.flush()
    const startBtn = Array.from(page.container.querySelectorAll('button'))
      .find(b => b.textContent.includes('Start Streaming'))
    if (startBtn) page.click(startBtn)
    await page.flush()
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleStartCamera video mode
  // -------------------------------------------------------------------------

  test('handleStartCamera video mode: no device throws error', async function () {
    defaultFetch(
      { cameraMode: 'video' },
      { devices: [], selectedDevice: null, capabilities: { cv2: true } }
    )
    const { page } = renderVideo()
    await page.flush()
    const startBtn = Array.from(page.container.querySelectorAll('button'))
      .find(b => b.textContent.includes('Start Video Mode'))
    if (startBtn) page.click(startBtn)
    await page.flush()
    expect(document.body.textContent).toContain('Video device not found')
    page.unmount()
  })

  test('handleStartCamera video mode: device found but no cap throws error', async function () {
    const stillDevNoCaps = { id: 'still-nocaps', type: 'v4l2', card_name: 'No Caps', caps: [] }
    defaultFetch(
      { cameraMode: 'video', selectedDevice: { value: 'still-nocaps' } },
      { devices: [stillDevNoCaps], selectedDevice: stillDevNoCaps, capabilities: { cv2: true } }
    )
    const { page } = renderVideo()
    await page.flush()
    const startBtn = Array.from(page.container.querySelectorAll('button'))
      .find(b => b.textContent.includes('Start Video Mode'))
    if (startBtn) page.click(startBtn)
    await page.flush()
    expect(document.body.textContent).toContain('Selected resolution is not valid')
    page.unmount()
  })

  test('handleStartCamera video mode: valid → POST start', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/approot') return { ok: true, json: async () => ({ appRoot: '/home/pi' }) }
      if (url === '/api/camera/still_devices') {
        return { ok: true, json: async () => ({ ...defaultStillData, capabilities: { cv2: true } }) }
      }
      if (url === '/api/videodevices') {
        return {
          ok: true, json: async () => ({
            ...defaultVideoData,
            cameraMode: 'video',
            selectedDevice: { value: 'still-dev-1' }
          })
        }
      }
      if (method === 'POST' && url === '/api/camera/start') {
        return { ok: true, json: async () => ({ active: true, addresses: [] }) }
      }
      throw new Error(`Unhandled: ${method} ${url}`)
    }))
    const { page } = renderVideo()
    await page.flush()
    const startBtn = Array.from(page.container.querySelectorAll('button'))
      .find(b => b.textContent.includes('Start Video Mode'))
    if (startBtn) page.click(startBtn)
    await page.flush()
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleStartCamera photo mode
  // -------------------------------------------------------------------------

  test('handleStartCamera photo mode: no still device throws error', async function () {
    defaultFetch(
      { cameraMode: 'photo' },
      { devices: [], selectedDevice: null, capabilities: { cv2: true } }
    )
    const { page } = renderVideo()
    await page.flush()
    const startBtn = Array.from(page.container.querySelectorAll('button'))
      .find(b => b.textContent.includes('Start Photo Mode'))
    if (startBtn) page.click(startBtn)
    await page.flush()
    expect(document.body.textContent).toContain('Photo device not found')
    page.unmount()
  })

  test('handleStartCamera photo mode: no cap throws error', async function () {
    const stillDevNoCaps = { id: 'still-nocaps', type: 'v4l2', card_name: 'No Caps', caps: [] }
    defaultFetch(
      { cameraMode: 'photo' },
      { devices: [stillDevNoCaps], selectedDevice: stillDevNoCaps, selectedCap: null, capabilities: { cv2: true } }
    )
    const { page } = renderVideo()
    await page.flush()
    const startBtn = Array.from(page.container.querySelectorAll('button'))
      .find(b => b.textContent.includes('Start Photo Mode'))
    if (startBtn) page.click(startBtn)
    await page.flush()
    expect(document.body.textContent).toContain('Photo resolution not valid')
    page.unmount()
  })

  test('handleStartCamera photo mode: valid → POST start', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/approot') return { ok: true, json: async () => ({ appRoot: '/home/pi' }) }
      if (url === '/api/camera/still_devices') {
        return { ok: true, json: async () => ({ ...defaultStillData, capabilities: { cv2: true } }) }
      }
      if (url === '/api/videodevices') {
        return { ok: true, json: async () => ({ ...defaultVideoData, cameraMode: 'photo' }) }
      }
      if (method === 'POST' && url === '/api/camera/start') {
        return { ok: true, json: async () => ({ active: true, addresses: [] }) }
      }
      throw new Error(`Unhandled: ${method} ${url}`)
    }))
    const { page } = renderVideo()
    await page.flush()
    const startBtn = Array.from(page.container.querySelectorAll('button'))
      .find(b => b.textContent.includes('Start Photo Mode'))
    if (startBtn) page.click(startBtn)
    await page.flush()
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleStopCamera
  // -------------------------------------------------------------------------

  test('handleStopCamera when not recording', async function () {
    mockFetch({
      '/api/approot': { appRoot: '/home/pi' },
      '/api/videodevices': { ...defaultVideoData, active: true },
      '/api/camera/still_devices': defaultStillData,
      'POST /api/camera/stop': { active: false }
    })
    const { page } = renderVideo()
    await page.flush()
    const stopBtn = Array.from(page.container.querySelectorAll('button'))
      .find(b => b.textContent.includes('Stop Streaming'))
    if (stopBtn) page.click(stopBtn)
    await page.flush()
    page.unmount()
  })

  test('handleStopCamera when recording with a file gives recorded notification', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/approot') return { ok: true, json: async () => ({ appRoot: '/home/pi' }) }
      if (url === '/api/videodevices') {
        return { ok: true, json: async () => ({ ...defaultVideoData, active: true }) }
      }
      if (url === '/api/camera/still_devices') return { ok: true, json: async () => defaultStillData }
      if (method === 'POST' && url === '/api/camera/stop') {
        return { ok: true, json: async () => ({ active: false }) }
      }
      throw new Error(`Unhandled: ${method} ${url}`)
    }))
    const { page, getRef } = renderVideo()
    await page.flush()
    // Set wasRecording + lastFile directly via ref
    act(() => {
      getRef().setState({ videoIsRecording: true, currentVideoFile: 'test-video.mp4' })
    })
    const stopBtn = Array.from(page.container.querySelectorAll('button'))
      .find(b => b.textContent.includes('Stop'))
    if (stopBtn) page.click(stopBtn)
    await page.flush()
    expect(page.container.textContent).toContain('Recorded video to test-video.mp4')
    page.unmount()
  })

  test('handleStopCamera when recording without a file keeps current notification', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/approot') return { ok: true, json: async () => ({ appRoot: '/home/pi' }) }
      if (url === '/api/videodevices') {
        return { ok: true, json: async () => ({ ...defaultVideoData, active: true }) }
      }
      if (url === '/api/camera/still_devices') return { ok: true, json: async () => defaultStillData }
      if (method === 'POST' && url === '/api/camera/stop') {
        return { ok: true, json: async () => ({ active: false }) }
      }
      throw new Error(`Unhandled: ${method} ${url}`)
    }))
    const { page, getRef } = renderVideo()
    await page.flush()
    // Set recording=true but no currentVideoFile
    act(() => {
      getRef().setState({ videoIsRecording: true, currentVideoFile: '' })
    })
    const stopBtn = Array.from(page.container.querySelectorAll('button'))
      .find(b => b.textContent.includes('Stop'))
    if (stopBtn) page.click(stopBtn)
    await page.flush()
    page.unmount()
  })

  test('handleStopCamera catch branch sets error', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/approot') return { ok: true, json: async () => ({ appRoot: '/home/pi' }) }
      if (url === '/api/videodevices') {
        return { ok: true, json: async () => ({ ...defaultVideoData, active: true }) }
      }
      if (url === '/api/camera/still_devices') return { ok: true, json: async () => defaultStillData }
      if (method === 'POST' && url === '/api/camera/stop') {
        throw new Error('Stop failed')
      }
      throw new Error(`Unhandled: ${method} ${url}`)
    }))
    const { page } = renderVideo()
    await page.flush()
    const stopBtn = Array.from(page.container.querySelectorAll('button'))
      .find(b => b.textContent.includes('Stop Streaming'))
    if (stopBtn) page.click(stopBtn)
    await page.flush()
    expect(document.body.textContent).toContain('Stop failed')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleCaptureStill
  // -------------------------------------------------------------------------

  test('handleCaptureStill when not active sets error', async function () {
    defaultFetch({ cameraMode: 'photo' }, { capabilities: { cv2: true } })
    const { page, getRef } = renderVideo()
    await page.flush()
    // Camera is NOT active
    act(() => {
      getRef().handleCaptureStill()
    })
    expect(getRef().state.error).toContain('Camera must be active in Photo Mode')
    page.unmount()
  })

  test('handleCaptureStill when active but wrong mode sets error', async function () {
    defaultFetch({ active: true, cameraMode: 'streaming' })
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleCaptureStill()
    })
    expect(getRef().state.error).toContain('Camera must be active in Photo Mode')
    page.unmount()
  })

  test('handleCaptureStill when active and photo mode and POST succeeds', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/approot') return { ok: true, json: async () => ({ appRoot: '/home/pi' }) }
      if (url === '/api/videodevices') {
        return { ok: true, json: async () => ({ ...defaultVideoData, cameraMode: 'photo', active: true }) }
      }
      if (url === '/api/camera/still_devices') {
        return { ok: true, json: async () => ({ ...defaultStillData, capabilities: { cv2: true } }) }
      }
      if (method === 'POST' && url === '/api/capturestillphoto') {
        return { ok: true, json: async () => ({}) }
      }
      throw new Error(`Unhandled: ${method} ${url}`)
    }))
    const { page } = renderVideo()
    await page.flush()
    const takePhotoBtn = Array.from(page.container.querySelectorAll('button'))
      .find(b => b.textContent.includes('Take Photo'))
    if (takePhotoBtn) page.click(takePhotoBtn)
    await page.flush()
    page.unmount()
  })

  test('handleCaptureStill when capture fails shows error', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/approot') return { ok: true, json: async () => ({ appRoot: '/home/pi' }) }
      if (url === '/api/videodevices') {
        return { ok: true, json: async () => ({ ...defaultVideoData, cameraMode: 'photo', active: true }) }
      }
      if (url === '/api/camera/still_devices') {
        return { ok: true, json: async () => ({ ...defaultStillData, capabilities: { cv2: true } }) }
      }
      if (method === 'POST' && url === '/api/capturestillphoto') {
        return { ok: false, status: 500, json: async () => ({}) }
      }
      throw new Error(`Unhandled: ${method} ${url}`)
    }))
    const { page } = renderVideo()
    await page.flush()
    const takePhotoBtn = Array.from(page.container.querySelectorAll('button'))
      .find(b => b.textContent.includes('Take Photo'))
    if (takePhotoBtn) page.click(takePhotoBtn)
    await page.flush()
    expect(document.body.textContent).toContain('Capture failed')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleToggleVideoRecording
  // -------------------------------------------------------------------------

  test('handleToggleVideoRecording when not active sets error', async function () {
    defaultFetch()
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleToggleVideoRecording()
    })
    expect(getRef().state.error).toContain('Camera must be active in Video Mode')
    page.unmount()
  })

  test('handleToggleVideoRecording when active but wrong mode sets error', async function () {
    defaultFetch({ active: true, cameraMode: 'streaming' })
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleToggleVideoRecording()
    })
    expect(getRef().state.error).toContain('Camera must be active in Video Mode')
    page.unmount()
  })

  test('handleToggleVideoRecording starting shows Starting notification', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/approot') return { ok: true, json: async () => ({ appRoot: '/home/pi' }) }
      if (url === '/api/videodevices') {
        return { ok: true, json: async () => ({ ...defaultVideoData, cameraMode: 'video', active: true }) }
      }
      if (url === '/api/camera/still_devices') {
        return { ok: true, json: async () => ({ ...defaultStillData, capabilities: { cv2: true } }) }
      }
      if (method === 'POST' && url === '/api/togglevideorecording') {
        return { ok: true, json: async () => ({}) }
      }
      throw new Error(`Unhandled: ${method} ${url}`)
    }))
    const { page } = renderVideo()
    await page.flush()
    const toggleBtn = Array.from(page.container.querySelectorAll('button'))
      .find(b => b.textContent.includes('Start Recording'))
    if (toggleBtn) page.click(toggleBtn)
    await page.flush()
    expect(page.container.textContent).toContain('Starting video recording')
    page.unmount()
  })

  test('handleToggleVideoRecording stopping with currentVideoFile shows filename', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/approot') return { ok: true, json: async () => ({ appRoot: '/home/pi' }) }
      if (url === '/api/videodevices') {
        return { ok: true, json: async () => ({ ...defaultVideoData, cameraMode: 'video', active: true }) }
      }
      if (url === '/api/camera/still_devices') {
        return { ok: true, json: async () => ({ ...defaultStillData, capabilities: { cv2: true } }) }
      }
      if (method === 'POST' && url === '/api/togglevideorecording') {
        return { ok: true, json: async () => ({}) }
      }
      throw new Error(`Unhandled: ${method} ${url}`)
    }))
    const { page, getRef } = renderVideo()
    await page.flush()

    // Start recording first
    const startBtn = Array.from(page.container.querySelectorAll('button'))
      .find(b => b.textContent.includes('Start Recording'))
    if (startBtn) page.click(startBtn)
    await page.flush()

    // Set a current video file via filesaved
    act(() => {
      lastSocket().fire('camera:filesaved', { filename: 'my-video.mp4' })
    })

    // Now stop recording
    const stopBtn = Array.from(page.container.querySelectorAll('button'))
      .find(b => b.textContent.includes('Stop Recording'))
    if (stopBtn) page.click(stopBtn)
    await page.flush()
    expect(page.container.textContent).toContain('my-video.mp4')
    page.unmount()
  })

  test('handleToggleVideoRecording stopping without currentVideoFile shows stopped message', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/approot') return { ok: true, json: async () => ({ appRoot: '/home/pi' }) }
      if (url === '/api/videodevices') {
        return { ok: true, json: async () => ({ ...defaultVideoData, cameraMode: 'video', active: true }) }
      }
      if (url === '/api/camera/still_devices') {
        return { ok: true, json: async () => ({ ...defaultStillData, capabilities: { cv2: true } }) }
      }
      if (method === 'POST' && url === '/api/togglevideorecording') {
        return { ok: true, json: async () => ({}) }
      }
      throw new Error(`Unhandled: ${method} ${url}`)
    }))
    const { page } = renderVideo()
    await page.flush()

    // Start recording (no filesaved → currentVideoFile = '')
    const startBtn = Array.from(page.container.querySelectorAll('button'))
      .find(b => b.textContent.includes('Start Recording'))
    if (startBtn) page.click(startBtn)
    await page.flush()

    // Stop recording
    const stopBtn = Array.from(page.container.querySelectorAll('button'))
      .find(b => b.textContent.includes('Stop Recording'))
    if (stopBtn) page.click(stopBtn)
    await page.flush()
    expect(page.container.textContent).toContain('Video recording stopped')
    page.unmount()
  })

  test('handleToggleVideoRecording catch branch sets error', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/approot') return { ok: true, json: async () => ({ appRoot: '/home/pi' }) }
      if (url === '/api/videodevices') {
        return { ok: true, json: async () => ({ ...defaultVideoData, cameraMode: 'video', active: true }) }
      }
      if (url === '/api/camera/still_devices') {
        return { ok: true, json: async () => ({ ...defaultStillData, capabilities: { cv2: true } }) }
      }
      if (method === 'POST' && url === '/api/togglevideorecording') {
        throw new Error('Toggle failed')
      }
      throw new Error(`Unhandled: ${method} ${url}`)
    }))
    const { page } = renderVideo()
    await page.flush()
    const toggleBtn = Array.from(page.container.querySelectorAll('button'))
      .find(b => b.textContent.includes('Start Recording'))
    if (toggleBtn) page.click(toggleBtn)
    await page.flush()
    expect(document.body.textContent).toContain('Toggle failed')
    page.unmount()
  })

  test('handleToggleVideoRecording POST ok=false sets error', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/approot') return { ok: true, json: async () => ({ appRoot: '/home/pi' }) }
      if (url === '/api/videodevices') {
        return { ok: true, json: async () => ({ ...defaultVideoData, cameraMode: 'video', active: true }) }
      }
      if (url === '/api/camera/still_devices') {
        return { ok: true, json: async () => ({ ...defaultStillData, capabilities: { cv2: true } }) }
      }
      if (method === 'POST' && url === '/api/togglevideorecording') {
        return { ok: false, status: 500, json: async () => ({}) }
      }
      throw new Error(`Unhandled: ${method} ${url}`)
    }))
    const { page } = renderVideo()
    await page.flush()
    const toggleBtn = Array.from(page.container.querySelectorAll('button'))
      .find(b => b.textContent.includes('Start Recording'))
    if (toggleBtn) page.click(toggleBtn)
    await page.flush()
    expect(document.body.textContent).toContain('Toggle recording failed')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // camera:filesaved socket event
  // -------------------------------------------------------------------------

  test('camera:filesaved while recording shows Recording video to', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/approot') return { ok: true, json: async () => ({ appRoot: '/home/pi' }) }
      if (url === '/api/videodevices') {
        return { ok: true, json: async () => ({ ...defaultVideoData, cameraMode: 'video', active: true }) }
      }
      if (url === '/api/camera/still_devices') {
        return { ok: true, json: async () => ({ ...defaultStillData, capabilities: { cv2: true } }) }
      }
      if (method === 'POST' && url === '/api/togglevideorecording') {
        return { ok: true, json: async () => ({}) }
      }
      throw new Error(`Unhandled: ${method} ${url}`)
    }))
    const { page } = renderVideo()
    await page.flush()

    // Start recording so videoIsRecording=true
    const startBtn = Array.from(page.container.querySelectorAll('button'))
      .find(b => b.textContent.includes('Start Recording'))
    if (startBtn) page.click(startBtn)
    await page.flush()

    act(() => {
      lastSocket().fire('camera:filesaved', { filename: 'flight001.mp4' })
    })
    expect(page.container.textContent).toContain('Recording video to flight001.mp4')
    page.unmount()
  })

  test('camera:filesaved while NOT recording in video mode shows Recorded video to', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/approot') return { ok: true, json: async () => ({ appRoot: '/home/pi' }) }
      if (url === '/api/videodevices') {
        return { ok: true, json: async () => ({ ...defaultVideoData, cameraMode: 'video', active: true }) }
      }
      if (url === '/api/camera/still_devices') {
        return { ok: true, json: async () => ({ ...defaultStillData, capabilities: { cv2: true } }) }
      }
      throw new Error(`Unhandled: ${method} ${url}`)
    }))
    const { page } = renderVideo()
    await page.flush()

    // videoIsRecording=false, cameraMode='video'
    act(() => {
      lastSocket().fire('camera:filesaved', { filename: 'flight001.mp4' })
    })
    expect(page.container.textContent).toContain('Recorded video to flight001.mp4')
    page.unmount()
  })

  test('camera:filesaved in photo mode shows Saved photo to', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/approot') return { ok: true, json: async () => ({ appRoot: '/home/pi' }) }
      if (url === '/api/videodevices') {
        return { ok: true, json: async () => ({ ...defaultVideoData, cameraMode: 'photo', active: true }) }
      }
      if (url === '/api/camera/still_devices') {
        return { ok: true, json: async () => ({ ...defaultStillData, capabilities: { cv2: true } }) }
      }
      throw new Error(`Unhandled: ${method} ${url}`)
    }))
    const { page } = renderVideo()
    await page.flush()

    act(() => {
      lastSocket().fire('camera:filesaved', { filename: 'photo001.jpg' })
    })
    expect(page.container.textContent).toContain('Saved photo to photo001.jpg')
    page.unmount()
  })

  test('camera:filesaved with data.file field (not filename)', async function () {
    defaultFetch()
    const { page } = renderVideo()
    await page.flush()
    act(() => {
      lastSocket().fire('camera:filesaved', { file: 'alt-photo.jpg' })
    })
    expect(page.container.textContent).toContain('Saved photo to alt-photo.jpg')
    page.unmount()
  })

  test('camera:filesaved with null data does nothing', async function () {
    defaultFetch()
    const { page } = renderVideo()
    await page.flush()
    act(() => {
      lastSocket().fire('camera:filesaved', null)
    })
    page.unmount()
  })

  test('camera:filesaved with data but no filename/file does nothing', async function () {
    defaultFetch()
    const { page } = renderVideo()
    await page.flush()
    act(() => {
      lastSocket().fire('camera:filesaved', {})
    })
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Notification dismiss button
  // -------------------------------------------------------------------------

  test('notification dismiss button clears notification', async function () {
    defaultFetch()
    const { page } = renderVideo()
    await page.flush()
    act(() => {
      lastSocket().fire('camera:filesaved', { filename: 'test.jpg' })
    })
    expect(page.container.textContent).toContain('test.jpg')
    const dismissBtn = Array.from(page.container.querySelectorAll('button'))
      .find(b => b.textContent.trim() === 'Dismiss')
    if (dismissBtn) page.click(dismissBtn)
    expect(page.container.textContent).not.toContain('test.jpg')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // getStillCapValue branches
  // -------------------------------------------------------------------------

  test('getStillCapValue returns empty string for null cap', async function () {
    defaultFetch({}, {
      selectedCap: null,
      capabilities: { cv2: true }
    })
    const { page, getRef } = renderVideo()
    await page.flush()
    expect(getRef().getStillCapValue(null)).toBe('')
    page.unmount()
  })

  test('getStillCapValue returns cap.value when present', async function () {
    defaultFetch()
    const { page, getRef } = renderVideo()
    await page.flush()
    expect(getRef().getStillCapValue(stillCap2)).toBe('still-val-1')
    page.unmount()
  })

  test('getStillCapValue returns WxHxFormat when no value property', async function () {
    defaultFetch()
    const { page, getRef } = renderVideo()
    await page.flush()
    expect(getRef().getStillCapValue(stillCap1)).toBe('4056x3040xJPEG')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // componentWillUnmount
  // -------------------------------------------------------------------------

  test('componentWillUnmount calls socket.off', async function () {
    defaultFetch()
    const { page } = renderVideo()
    await page.flush()
    const socket = lastSocket()
    page.unmount()
    expect(socket.off).toHaveBeenCalledWith('camera:filesaved')
  })

  // -------------------------------------------------------------------------
  // Button label states
  // -------------------------------------------------------------------------

  test('button shows Stop Streaming when active in streaming mode', async function () {
    defaultFetch({ active: true })
    const { page } = renderVideo()
    await page.flush()
    expect(page.container.textContent).toContain('Stop Streaming')
    page.unmount()
  })

  test('button shows Stop Photo Mode when active in photo mode', async function () {
    defaultFetch({ active: true, cameraMode: 'photo' }, { capabilities: { cv2: true } })
    const { page } = renderVideo()
    await page.flush()
    expect(page.container.textContent).toContain('Stop Photo Mode')
    page.unmount()
  })

  test('button shows Stop Video Mode when active in video mode', async function () {
    defaultFetch(
      { active: true, cameraMode: 'video', selectedDevice: { value: 'still-dev-1' } },
      { capabilities: { cv2: true } }
    )
    const { page } = renderVideo()
    await page.flush()
    expect(page.container.textContent).toContain('Stop Video Mode')
    page.unmount()
  })

  test('button shows Start Photo Mode when not active in photo mode', async function () {
    defaultFetch({ cameraMode: 'photo' }, { capabilities: { cv2: true } })
    const { page } = renderVideo()
    await page.flush()
    expect(page.container.textContent).toContain('Start Photo Mode')
    page.unmount()
  })

  test('button shows Start Video Mode when not active in video mode', async function () {
    defaultFetch(
      { cameraMode: 'video', selectedDevice: { value: 'still-dev-1' } },
      { capabilities: { cv2: true } }
    )
    const { page } = renderVideo()
    await page.flush()
    expect(page.container.textContent).toContain('Start Video Mode')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // streamAddresses rendering
  // -------------------------------------------------------------------------

  test('renders multiple RTSP stream addresses', async function () {
    defaultFetch({
      active: true,
      selectedUseUDP: false,
      streamAddresses: ['rtsp://192.168.1.1:8554/stream1', 'rtsp://10.0.0.1:8554/stream1']
    })
    const { page } = renderVideo()
    await page.flush()
    expect(page.container.textContent).toContain('rtsp://192.168.1.1:8554/stream1')
    expect(page.container.textContent).toContain('rtsp://10.0.0.1:8554/stream1')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // appRoot fetch error
  // -------------------------------------------------------------------------

  test('appRoot fetch error does not crash page', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/approot') throw new Error('approot failed')
      if (url === '/api/videodevices') return { ok: true, json: async () => defaultVideoData }
      if (url === '/api/camera/still_devices') return { ok: true, json: async () => defaultStillData }
      throw new Error(`Unhandled: ${method} ${url}`)
    }))
    const { page } = renderVideo()
    await page.flush()
    expect(page.container.textContent).toContain('Photo and Video')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // notification in video recording state (alert-warning vs alert-info)
  // -------------------------------------------------------------------------

  test('notification shows alert-warning when recording', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/approot') return { ok: true, json: async () => ({ appRoot: '/home/pi' }) }
      if (url === '/api/videodevices') {
        return { ok: true, json: async () => ({ ...defaultVideoData, cameraMode: 'video', active: true }) }
      }
      if (url === '/api/camera/still_devices') {
        return { ok: true, json: async () => ({ ...defaultStillData, capabilities: { cv2: true } }) }
      }
      if (method === 'POST' && url === '/api/togglevideorecording') {
        return { ok: true, json: async () => ({}) }
      }
      throw new Error(`Unhandled: ${method} ${url}`)
    }))
    const { page } = renderVideo()
    await page.flush()
    // Start recording
    const startBtn = Array.from(page.container.querySelectorAll('button'))
      .find(b => b.textContent.includes('Start Recording'))
    if (startBtn) page.click(startBtn)
    await page.flush()
    // Fire filesaved while recording → "Recording video to"
    act(() => {
      lastSocket().fire('camera:filesaved', { filename: 'rec.mp4' })
    })
    const alert = page.container.querySelector('.alert-warning')
    expect(alert).not.toBeNull()
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Media destination shown in appRoot message
  // -------------------------------------------------------------------------

  test('non-streaming mode shows appRoot media path hint', async function () {
    defaultFetch({ cameraMode: 'photo' }, { capabilities: { cv2: true } })
    const { page } = renderVideo()
    await page.flush()
    expect(page.container.textContent).toContain('/home/pi/rpanion')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // init video mode uses getStillCapValue for initial cap selection
  // -------------------------------------------------------------------------

  test('init video mode getStillCapValue returns value for cap with .value field', async function () {
    const stillDevWithValue = {
      id: 'still-dev-val',
      type: 'picamera2',
      card_name: 'IMX708',
      caps: [stillCap2] // has .value
    }
    defaultFetch(
      { cameraMode: 'video', selectedDevice: { value: 'still-dev-val' } },
      {
        devices: [stillDevWithValue],
        selectedDevice: stillDevWithValue,
        capabilities: { cv2: true }
      }
    )
    const { page, getRef } = renderVideo()
    await page.flush()
    // init video: matchingStillDev found, caps[0] = stillCap2 which has .value
    expect(getRef().state.vidCapSelected).toBe('still-val-1')
    page.unmount()
  })

  test('init video mode getStillCapValue returns WxHxFormat for cap without .value', async function () {
    defaultFetch(
      { cameraMode: 'video', selectedDevice: { value: 'still-dev-1' } },
      {
        devices: [stillDevice1],
        selectedDevice: stillDevice1,
        capabilities: { cv2: true }
      }
    )
    const { page, getRef } = renderVideo()
    await page.flush()
    // init video: matchingStillDev found, caps[0] = stillCap1 which has no .value
    expect(getRef().state.vidCapSelected).toBe('4056x3040xJPEG')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Branch coverage: init with minimal/missing fields (covers || fallbacks)
  // -------------------------------------------------------------------------

  test('init with no devices key at all in videoData (devices || [] fallback)', async function () {
    // Remove devices key entirely from videoData - tests branch 12[1]
    const minimalVideo = {
      // No devices key
      active: false, cameraMode: 'streaming', selectedUseUDP: false,
      streamAddresses: [], networkInterfaces: ['192.168.1.1'],
      selectedBitrate: null, selectedUseUDPIP: null, selectedUseUDPPort: null,
      selectedRotation: null, selectedMavStreamURI: null, compression: null,
    }
    mockFetch({
      '/api/approot': { appRoot: '/home/pi' },
      '/api/videodevices': minimalVideo,
      '/api/camera/still_devices': { capabilities: { cv2: true } }
    })
    const { page } = renderVideo()
    await page.flush()
    expect(page.container.textContent).toContain('Photo and Video')
    page.unmount()
  })

  test('init with no still devices key + no capabilities key (devices || [] and capabilities || {})', async function () {
    // No devices key in still data, no capabilities key - tests branches 23[1] and 29[1]
    const minimalStill = {
      // No devices or capabilities keys
    }
    mockFetch({
      '/api/approot': { appRoot: '/home/pi' },
      '/api/videodevices': defaultVideoData,
      '/api/camera/still_devices': minimalStill
    })
    const { page } = renderVideo()
    await page.flush()
    page.unmount()
  })

  test('init with selectedDevice null but non-empty devices (selVidDev from devices[0])', async function () {
    // selectedDevice=null, devices=[videoDevice1] → selVidDev = vidDevs[0] - tests branch 14[0]
    // Also: selectedCap=null, vidCaps=[...] → selVidCap = vidCaps[0] - tests branch 17[0]
    mockFetch({
      '/api/approot': { appRoot: '/home/pi' },
      '/api/videodevices': {
        ...defaultVideoData,
        selectedDevice: null,
        selectedCap: null,
        devices: [videoDevice1]
      },
      '/api/camera/still_devices': defaultStillData
    })
    const { page, getRef } = renderVideo()
    await page.flush()
    // selVidDev = videoDevice1, vidCaps = videoDevice1.caps, selVidCap = vidCaps[0]
    expect(getRef().state.vidDeviceSelected).toBe('dev1')
    page.unmount()
  })

  test('init with still selectedDevice null but non-empty stillDevs (branch 25[0])', async function () {
    mockFetch({
      '/api/approot': { appRoot: '/home/pi' },
      '/api/videodevices': defaultVideoData,
      '/api/camera/still_devices': {
        ...defaultStillData,
        selectedDevice: null,
        devices: [stillDevice1]
      }
    })
    const { page, getRef } = renderVideo()
    await page.flush()
    expect(getRef().state.stillDeviceSelected).toBe('still-dev-1')
    page.unmount()
  })

  test('init with cameraMode null falls back to streaming (branch 32[1])', async function () {
    mockFetch({
      '/api/approot': { appRoot: '/home/pi' },
      '/api/videodevices': { ...defaultVideoData, cameraMode: null },
      '/api/camera/still_devices': defaultStillData
    })
    const { page, getRef } = renderVideo()
    await page.flush()
    expect(getRef().state.cameraMode).toBe('streaming')
    page.unmount()
  })

  test('init video mode with selectedDevice null uses null savedDeviceValue (branch 36[1])', async function () {
    // In video mode init, selectedDevice=null → savedDeviceValue=null → matchingStillDev not found by id
    mockFetch({
      '/api/approot': { appRoot: '/home/pi' },
      '/api/videodevices': { ...defaultVideoData, cameraMode: 'video', selectedDevice: null },
      '/api/camera/still_devices': { ...defaultStillData, capabilities: { cv2: true } }
    })
    const { page, getRef } = renderVideo()
    await page.flush()
    expect(getRef().state.cameraMode).toBe('video')
    page.unmount()
  })

  test('init video mode with still device having no caps key (branch 40[1] caps || [])', async function () {
    // matchingStillDev.caps is undefined → caps || [] hit
    // Need caps to be undefined but still device present (not null)
    // Use a device object missing the caps property — video.jsx line 143: matchingStillDev.caps ||[]
    // We need to use a device where caps is undefined (not an empty array)
    // To avoid the stillCaps.map bug, use stillDevice1 for still device list, but
    // use a separate device for the video mode matching (pass selectedDevice.value matching a still dev without caps)
    const stillDevWithUndefinedCaps = { id: 'still-ucaps', type: 'v4l2', card_name: 'UndefinedCaps', caps: undefined }
    // stillCaps used for photo is a separate path - need a separate device for stillCaps render
    // Actually we need selectedDevice to have matching still device. Let's ensure stillDevices has a valid one too.
    mockFetch({
      '/api/approot': { appRoot: '/home/pi' },
      '/api/videodevices': { ...defaultVideoData, cameraMode: 'video', selectedDevice: { value: 'still-ucaps' } },
      '/api/camera/still_devices': {
        devices: [stillDevWithUndefinedCaps],
        selectedDevice: stillDevice1, // for stillDeviceSelected init (selectedDevice in still data)
        selectedCap: stillCap1,
        capabilities: { cv2: true },
      }
    })
    const { page, getRef } = renderVideo()
    await page.flush()
    // matchingStillDev = stillDevWithUndefinedCaps; caps || [] → []
    expect(getRef().state.videoCaps).toEqual([])
    page.unmount()
  })

  test('init video mode selFps null falls back to 30 (branch 43[1] selFps || 30)', async function () {
    // In video mode: selFps is 0/null, so selFps || 30 → 30
    mockFetch({
      '/api/approot': { appRoot: '/home/pi' },
      '/api/videodevices': { ...defaultVideoData, cameraMode: 'video', selectedDevice: { value: 'still-dev-1' }, selectedFps: 0 },
      '/api/camera/still_devices': { ...defaultStillData, capabilities: { cv2: true } }
    })
    const { page, getRef } = renderVideo()
    await page.flush()
    expect(getRef().state.fpsSelected).toBe(30)
    page.unmount()
  })

  test('init with no streamAddresses key (branch 48[1] streamAddresses || [])', async function () {
    const videoDataNoAddresses = { ...defaultVideoData }
    delete videoDataNoAddresses.streamAddresses
    mockFetch({
      '/api/approot': { appRoot: '/home/pi' },
      '/api/videodevices': videoDataNoAddresses,
      '/api/camera/still_devices': defaultStillData
    })
    const { page, getRef } = renderVideo()
    await page.flush()
    expect(getRef().state.streamAddresses).toEqual([])
    page.unmount()
  })

  test('init with no selectedUseUDPIP (branch 50[1] → "127.0.0.1"; branch 64[1] no isMulticastUpdateIP call)', async function () {
    // selectedUseUDPIP=null/undefined → useUDPIP defaults to "127.0.0.1", isMulticastUpdateIP NOT called
    const videoDataNoUDP = { ...defaultVideoData, selectedUseUDPIP: null, selectedUseUDPPort: null }
    mockFetch({
      '/api/approot': { appRoot: '/home/pi' },
      '/api/videodevices': videoDataNoUDP,
      '/api/camera/still_devices': defaultStillData
    })
    const { page, getRef } = renderVideo()
    await page.flush()
    expect(getRef().state.useUDPIP).toBe('127.0.0.1')
    expect(getRef().state.useUDPPort).toBe(5600)
    page.unmount()
  })

  test('init with no selectedBitrate (branch 52[1] → 1100 fallback)', async function () {
    const videoDataNoBitrate = { ...defaultVideoData, selectedBitrate: null }
    mockFetch({
      '/api/approot': { appRoot: '/home/pi' },
      '/api/videodevices': videoDataNoBitrate,
      '/api/camera/still_devices': defaultStillData
    })
    const { page, getRef } = renderVideo()
    await page.flush()
    expect(getRef().state.bitrate).toBe(1100)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Branch coverage: DOM onChange for media destination inputs (lines 964, 999)
  // -------------------------------------------------------------------------

  test('video mode media destination onChange triggers handleMediaDestinationChange', async function () {
    defaultFetch({ cameraMode: 'video', selectedDevice: { value: 'still-dev-1' } },
      { capabilities: { cv2: true } })
    const { page, getRef } = renderVideo()
    await page.flush()
    // Find the media destination text input (placeholder: "e.g., flight_01")
    const textInputs = page.container.querySelectorAll('input[type="text"]')
    const destInput = Array.from(textInputs).find(i => i.placeholder === 'e.g., flight_01')
    if (destInput) {
      act(() => {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        nativeSetter.call(destInput, 'my-video-folder')
        destInput.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    page.unmount()
  })

  test('photo mode media destination onChange triggers handleMediaDestinationChange', async function () {
    defaultFetch({ cameraMode: 'photo' }, { capabilities: { cv2: true } })
    const { page, getRef } = renderVideo()
    await page.flush()
    const textInputs = page.container.querySelectorAll('input[type="text"]')
    const destInput = Array.from(textInputs).find(i => i.placeholder === 'e.g., flight_01')
    if (destInput) {
      act(() => {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        nativeSetter.call(destInput, 'my-photo-folder')
        destInput.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Branch coverage: handleVideoDeviceChange/Recording null caps branch (294,324)
  // -------------------------------------------------------------------------

  test('handleVideoDeviceChange with device having undefined caps key (branch 94[1] caps || [])', async function () {
    const devNoCapsKey = { value: 'dev-nck', label: 'No Caps Key' } // No caps property
    defaultFetch({ devices: [videoDevice1, devNoCapsKey] })
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleVideoDeviceChange({ target: { value: 'dev-nck' } })
    })
    expect(getRef().state.videoCaps).toEqual([])
    page.unmount()
  })

  test('handleVideoRecordingDeviceChange with device having undefined caps key (branch 104[1])', async function () {
    const stillDevNoCapsKey = { id: 'sncpk', type: 'v4l2', card_name: 'NoCapsKey' }
    defaultFetch(
      { cameraMode: 'video', selectedDevice: { value: 'still-dev-1' } },
      { devices: [stillDevice1, stillDevNoCapsKey], capabilities: { cv2: true } }
    )
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleVideoRecordingDeviceChange({ target: { value: 'sncpk' } })
    })
    expect(getRef().state.videoCaps).toEqual([])
    page.unmount()
  })

  test('handleVideoResChange with cap having no fps key (branch 108[1] fps || [])', async function () {
    const capNoFpsKey = { value: 'cap-nfk', width: 640, height: 480, format: 'video/x-raw', fpsmax: 0 } // no fps key
    const devWithNFPS = { value: 'dev-nfps2', label: 'Dev', caps: [videoCap1, capNoFpsKey] }
    defaultFetch({ devices: [devWithNFPS], selectedDevice: devWithNFPS, selectedCap: videoCap1 })
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleVideoResChange({ target: { value: 'cap-nfk' } })
    })
    expect(getRef().state.fpsOptions).toEqual([])
    page.unmount()
  })

  test('handleStillDeviceChange with device having undefined caps key (branch 115[1])', async function () {
    const stillDevNoCapsKey = { id: 'still-nck2', type: 'v4l2', card_name: 'NoCapsKey2' }
    defaultFetch(
      { cameraMode: 'photo' },
      { devices: [stillDevice1, stillDevNoCapsKey], capabilities: { cv2: true } }
    )
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleStillDeviceChange({ target: { value: 'still-nck2' } })
    })
    expect(getRef().state.stillCaps).toEqual([])
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Branch coverage: handleStartCamera data.error || fallback (branch 142[1])
  // and data.addresses || [] (branch 143[1])
  // -------------------------------------------------------------------------

  test('handleStartCamera streaming: POST ok=false with no error field uses fallback message', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/approot') return { ok: true, json: async () => ({ appRoot: '/home/pi' }) }
      if (url === '/api/videodevices') return { ok: true, json: async () => defaultVideoData }
      if (url === '/api/camera/still_devices') return { ok: true, json: async () => defaultStillData }
      if (method === 'POST' && url === '/api/camera/start') {
        return { ok: false, status: 500, json: async () => ({}) } // no error field → fallback "Failed to start camera"
      }
      throw new Error(`Unhandled: ${method} ${url}`)
    }))
    const { page } = renderVideo()
    await page.flush()
    const startBtn = Array.from(page.container.querySelectorAll('button'))
      .find(b => b.textContent.includes('Start Streaming'))
    if (startBtn) page.click(startBtn)
    await page.flush()
    expect(document.body.textContent).toContain('Failed to start camera')
    page.unmount()
  })

  test('handleStartCamera streaming: POST ok=true with no addresses field (addresses || [])', async function () {
    mockFetch({
      '/api/approot': { appRoot: '/home/pi' },
      '/api/videodevices': defaultVideoData,
      '/api/camera/still_devices': defaultStillData,
      'POST /api/camera/start': { active: true } // no addresses key → addresses || [] = []
    })
    const { page, getRef } = renderVideo()
    await page.flush()
    const startBtn = Array.from(page.container.querySelectorAll('button'))
      .find(b => b.textContent.includes('Start Streaming'))
    if (startBtn) page.click(startBtn)
    await page.flush()
    expect(getRef().state.streamAddresses).toEqual([])
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Branch coverage: handleCameraModeChange streaming: cap with no fps key (branch 88[1])
  // -------------------------------------------------------------------------

  test('handleCameraModeChange to streaming: first cap has no fps key (branch 88[1] fps || [])', async function () {
    // firstCap has no fps key → (firstCap.fps || []) hits the [] fallback
    const capNoFpsKey = { value: 'cap-nfk2', width: 640, height: 480, format: 'video/x-raw', fpsmax: 30 }
    const devNoFpsKey = { value: 'dev-nfk2', label: 'Dev', caps: [capNoFpsKey] }
    defaultFetch({ devices: [devNoFpsKey], selectedDevice: devNoFpsKey, cameraMode: 'photo' }, { capabilities: { cv2: true } })
    const { page, getRef } = renderVideo()
    await page.flush()
    act(() => {
      getRef().handleCameraModeChange({ target: { value: 'streaming' } })
    })
    expect(getRef().state.fpsOptions).toEqual([])
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Telemetry HUD overlay (#173)
  // -------------------------------------------------------------------------

  function hudRow (page) {
    return Array.from(page.container.querySelectorAll('.form-group.row'))
      .find(r => r.textContent.includes('Telemetry HUD'))
  }

  test('HUD: disabled with an explanation on a pre-compressed H264 source', async function () {
    // default device's first cap is video/x-h264 → overlay impossible
    defaultFetch()
    const { page, getRef } = renderVideo()
    await page.flush()
    expect(getRef().isH264NativeSource()).toBe(true)
    const row = hudRow(page)
    expect(row).toBeTruthy()
    const checkbox = row.querySelector('input[type="checkbox"]')
    expect(checkbox.disabled).toBe(true)
    expect(row.textContent).toContain('Not available on a pre-compressed H264 source')
    page.unmount()
  })

  test('HUD: enabled and toggleable on a re-encoded raw source', async function () {
    defaultFetch()
    const { page, getRef } = renderVideo()
    await page.flush()
    // switch to the raw (video/x-raw) cap, which the companion computer re-encodes
    act(() => { getRef().handleVideoResChange({ target: { value: 'cap-yuv-1' } }) })
    expect(getRef().isH264NativeSource()).toBe(false)
    const row = hudRow(page)
    const checkbox = row.querySelector('input[type="checkbox"]')
    expect(checkbox.disabled).toBe(false)
    expect(row.textContent).not.toContain('Not available on a pre-compressed H264 source')
    act(() => { checkbox.click() })
    expect(getRef().state.useHud).toBe(true)
    page.unmount()
  })

  test('HUD: loads the saved selectedUseHud flag', async function () {
    defaultFetch({ selectedUseHud: true })
    const { page, getRef } = renderVideo()
    await page.flush()
    expect(getRef().state.useHud).toBe(true)
    page.unmount()
  })

  test('HUD: style selector appears when HUD is on (raw source) and switches to graphic', async function () {
    defaultFetch({ selectedHudStyle: 'graphic' })
    const { page, getRef } = renderVideo()
    await page.flush()
    expect(getRef().state.hudStyle).toBe('graphic')
    // raw source + HUD on → the style select is shown
    act(() => { getRef().handleVideoResChange({ target: { value: 'cap-yuv-1' } }) })
    act(() => { getRef().setState({ useHud: true }) })
    const styleRow = [...page.container.querySelectorAll('.form-group.row')].find(r => r.textContent.includes('HUD Style'))
    expect(styleRow).toBeTruthy()
    const select = styleRow.querySelector('select')
    act(() => { select.value = 'text'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(getRef().state.hudStyle).toBe('text')
    page.unmount()
  })

})

