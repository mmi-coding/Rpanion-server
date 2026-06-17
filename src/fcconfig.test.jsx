// @vitest-environment happy-dom
import React, { act } from 'react'
import { describe, test, expect, afterEach, beforeEach, vi } from 'vitest'

import { renderPage, mockFetch } from '../test/ui.jsx'
import { lastSocket } from '../test/socketMock.js'
import FCConfigPage from './fcconfig.jsx'

vi.mock('socket.io-client', () => import('../test/socketMock.js'))

const emptyOverview = { state: 'idle', received: 0, total: 0, sensors: [], serial: [], servos: [], can: { ports: [], drivers: [], nodes: [] }, net: { present: false } }

const fullOverview = {
  state: 'complete', received: 5, total: 5,
  sensors: [
    { key: 'gyro', label: 'Gyro', enabled: true, healthy: true },
    { key: 'baro', label: 'Barometer', enabled: false, healthy: false },
    { key: 'gps', label: 'GPS', enabled: true, healthy: false }
  ],
  serial: [{ port: 1, protocol: 2, protocolName: 'MAVLink2', baud: '115200' }],
  servos: [
    { ch: 1, func: 33, funcName: 'Motor1', min: 1000, max: 2000, trim: 1500, reversed: true, pwm: 1500 },
    { ch: 5, func: 4, funcName: 'Aileron', min: 1100, max: 1900, trim: 1500, reversed: false, pwm: null }
  ],
  can: {
    ports: [{ n: 1, driver: 1, bitrate: 1000000 }],
    drivers: [{ n: 1, protocol: 1, protocolName: 'DroneCAN' }]
  },
  net: { present: false }
}

const emptySections = { state: 'partial', received: 3, total: 5, sensors: [], serial: [], servos: [], can: { ports: [], drivers: [] }, net: { present: false } }

describe('#FCConfigPage()', function () {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

  test('shows the waiting prompt when no params are downloaded', async function () {
    mockFetch({ '/api/FCConfigOverview': emptyOverview })
    const page = renderPage(<FCConfigPage />)
    await page.flush()
    expect(page.container.textContent).toContain('FC Configuration')
    expect(page.container.textContent).toContain('No parameters downloaded yet')
    page.unmount()
  })

  test('renders every section from a complete overview', async function () {
    mockFetch({ '/api/FCConfigOverview': fullOverview })
    const page = renderPage(<FCConfigPage />)
    await page.flush()
    const txt = page.container.textContent
    expect(txt).toContain('Gyro: OK')
    expect(txt).toContain('Barometer: disabled')
    expect(txt).toContain('GPS: unhealthy')
    expect(txt).toContain('MAVLink2')
    expect(txt).toContain('Motor1')
    expect(txt).toContain('Aileron')
    expect(txt).toContain('DroneCAN') // CAN driver protocol (bus config)
    expect(txt).toContain('Scan DroneCAN bus') // node scan control
    page.unmount()
  })

  test('Scan DroneCAN bus button POSTs a scan and reflects scanning state', async function () {
    const stub = mockFetch({ '/api/FCConfigOverview': fullOverview, 'POST /api/FCDroneCANScan': { scanning: true, buses: [0, 1] } })
    const page = renderPage(<FCConfigPage />)
    await page.flush()
    const btn = [...page.container.querySelectorAll('button')].find(b => b.textContent.includes('Scan DroneCAN bus'))
    page.click(btn)
    await page.flush()
    expect(stub.mock.calls.some(c => c[0] === '/api/FCDroneCANScan' && c[1]?.method === 'POST')).toBe(true)
    expect(page.container.textContent).toContain('Scanning the bus') // scanning placeholder (button also shows 'Scanning…')
    page.unmount()
  })

  test('DroneCAN scan error surfaces in the error modal', async function () {
    mockFetch({ '/api/FCConfigOverview': fullOverview, 'POST /api/FCDroneCANScan': () => { throw new Error('scan boom') } })
    const page = renderPage(<FCConfigPage />)
    await page.flush()
    const btn = [...page.container.querySelectorAll('button')].find(b => b.textContent.includes('Scan DroneCAN bus'))
    page.click(btn)
    await page.flush()
    expect(document.body.textContent).toContain('scan boom')
    page.unmount()
  })

  test('DroneCANNodes socket event populates the live node table + bus-traffic stats', async function () {
    mockFetch({ '/api/FCConfigOverview': fullOverview })
    const page = renderPage(<FCConfigPage />)
    await page.flush()
    expect(page.container.textContent).toContain('No DroneCAN nodes found yet') // dcStats null → no stats line
    // stats present but no frames yet → still no bus-traffic line
    act(() => { lastSocket().fire('DroneCANNodes', { scanning: true, nodes: [], stats: { frames: 0, nodeStatus: 0, nodeInfo: 0 } }) })
    expect(page.container.textContent).not.toContain('bus traffic')
    // frames flowing + nodes present
    act(() => {
      lastSocket().fire('DroneCANNodes', { scanning: true, stats: { frames: 142, nodeStatus: 7, nodeInfo: 1 }, nodes: [
        { id: 11, bus: 0, name: 'org.ardupilot.gps', health: 'OK', mode: 'Operational', uptimeSec: 42, swVersion: '1.2', hwVersion: '3.4' },
        { id: 50, name: '' } // no bus / health / mode / uptime / versions → all em-dash fallbacks
      ] })
    })
    const txt = page.container.textContent
    expect(txt).toContain('bus traffic: 142 frames')
    expect(txt).toContain('org.ardupilot.gps')
    expect(txt).toContain('CAN1') // bus 0 → CAN1
    expect(txt).toContain('1.2 / 3.4') // sw/hw versions
    page.unmount()
  })

  // helper: render with a node already discovered, ready to click
  async function pageWithNode(extraFetch = {}) {
    const stub = mockFetch({ '/api/FCConfigOverview': fullOverview, 'POST /api/FCDroneCANNodeParams': { scanning: true, node: 125, bus: 0 }, ...extraFetch })
    const page = renderPage(<FCConfigPage />)
    await page.flush()
    act(() => {
      lastSocket().fire('DroneCANNodes', { scanning: false, stats: { frames: 5 }, nodes: [
        { id: 125, bus: 0, name: 'com.vimdrones.gps', health: 'OK', mode: 'Operational', uptimeSec: 5, swVersion: '1.0', hwVersion: '2.0' }
      ] })
    })
    return { stub, page }
  }
  const nodeRow = (page) => [...page.container.querySelectorAll('tr')].find(r => r.textContent.includes('com.vimdrones.gps'))

  test('clicking a node row POSTs a param read and shows the requesting state', async function () {
    const { stub, page } = await pageWithNode()
    page.click(nodeRow(page))
    await page.flush()
    expect(stub.mock.calls.some(c => c[0] === '/api/FCDroneCANNodeParams' && c[1]?.method === 'POST')).toBe(true)
    expect(page.container.textContent).toContain('Requesting parameters…') // dcParams still null until the push
    page.unmount()
  })

  test('a DroneCANNodeParams push renders the parameter table (values, defaults, bounds, bool/null formatting)', async function () {
    const { page } = await pageWithNode()
    page.click(nodeRow(page))
    await page.flush()
    act(() => {
      lastSocket().fire('DroneCANNodeParams', { active: true, nodeId: 125, bus: 0, scanning: false, done: true, error: null, params: [
        { index: 0, name: 'GPS_TYPE', type: 'int', value: 5, defaultValue: 1, min: 0, max: 22 },
        { index: 1, name: 'GPS_AUTO', type: 'bool', value: true, defaultValue: false, min: null, max: null }
      ] })
    })
    const txt = page.container.textContent
    expect(txt).toContain('2 parameters · complete')
    expect(txt).toContain('GPS_TYPE')
    expect(txt).toContain('GPS_AUTO')
    expect(txt).toContain('true') // boolean value formatted
    // a push for a different node is ignored (stale), leaving the table intact
    act(() => { lastSocket().fire('DroneCANNodeParams', { active: true, nodeId: 999, scanning: false, done: true, error: null, params: [{ index: 0, name: 'OTHER', type: 'int', value: 1, defaultValue: 0, min: 0, max: 1 }] }) })
    expect(page.container.textContent).not.toContain('OTHER')
    expect(page.container.textContent).toContain('GPS_TYPE')
    page.unmount()
  })

  test('param table shows reading / empty / stopped states', async function () {
    const { page } = await pageWithNode()
    page.click(nodeRow(page))
    await page.flush()
    // scanning, no params yet
    act(() => { lastSocket().fire('DroneCANNodeParams', { active: true, nodeId: 125, scanning: true, done: false, error: null, params: [] }) })
    expect(page.container.textContent).toContain('Waiting for the node to respond…')
    // finished with no params
    act(() => { lastSocket().fire('DroneCANNodeParams', { active: true, nodeId: 125, scanning: false, done: true, error: null, params: [] }) })
    expect(page.container.textContent).toContain('This node reported no parameters')
    // stopped with an error (node didn't answer) → header + clear "no response" guidance
    act(() => { lastSocket().fire('DroneCANNodeParams', { active: true, nodeId: 125, scanning: false, done: true, error: 'timeout', params: [] }) })
    expect(page.container.textContent).toContain('stopped (timeout)')
    expect(page.container.textContent).toContain('No response')
    expect(page.container.textContent).toContain('param.GetSet')
    page.unmount()
  })

  test('clicking an expanded node row again collapses it', async function () {
    const { page } = await pageWithNode()
    page.click(nodeRow(page))
    await page.flush()
    act(() => { lastSocket().fire('DroneCANNodeParams', { active: true, nodeId: 125, scanning: false, done: true, error: null, params: [{ index: 0, name: 'GPS_TYPE', type: 'int', value: 5, defaultValue: 1, min: 0, max: 22 }] }) })
    expect(page.container.textContent).toContain('GPS_TYPE')
    page.click(nodeRow(page)) // collapse
    await page.flush()
    expect(page.container.textContent).not.toContain('GPS_TYPE')
    page.unmount()
  })

  test('DroneCANNodeParams pushes are ignored when no node is expanded or the push is inactive', async function () {
    const { page } = await pageWithNode()
    // nothing expanded → ignored (no crash, no table)
    act(() => { lastSocket().fire('DroneCANNodeParams', { active: true, nodeId: 125, scanning: false, done: true, error: null, params: [{ index: 0, name: 'GPS_TYPE', type: 'int', value: 5, defaultValue: 1, min: 0, max: 22 }] }) })
    expect(page.container.textContent).not.toContain('GPS_TYPE')
    // expand, then an inactive push (the idle once-a-second emit) is ignored
    page.click(nodeRow(page))
    await page.flush()
    act(() => { lastSocket().fire('DroneCANNodeParams', { active: false, nodeId: null, scanning: false, done: false, error: null, params: [] }) })
    expect(page.container.textContent).toContain('Requesting parameters…') // unchanged
    page.unmount()
  })

  test('node param read error surfaces in the error modal', async function () {
    const { page } = await pageWithNode({ 'POST /api/FCDroneCANNodeParams': () => { throw new Error('param boom') } })
    page.click(nodeRow(page))
    await page.flush()
    expect(document.body.textContent).toContain('param boom')
    page.unmount()
  })

  test('shows per-section placeholders when params exist but groups are empty', async function () {
    mockFetch({ '/api/FCConfigOverview': emptySections })
    const page = renderPage(<FCConfigPage />)
    await page.flush()
    const txt = page.container.textContent
    expect(txt).toContain('No SYS_STATUS telemetry yet')
    expect(txt).toContain('No serial port parameters found')
    expect(txt).toContain('No assigned servo outputs')
    expect(txt).toContain('No CAN parameters found')
    expect(txt).toContain('No DroneCAN nodes found yet')
    page.unmount()
  })

  test('Refresh parameters button POSTs a refresh', async function () {
    const stub = mockFetch({ '/api/FCConfigOverview': emptyOverview, 'POST /api/FCParamRefresh': { started: true, state: 'downloading', received: 0, total: 0 } })
    const page = renderPage(<FCConfigPage />)
    await page.flush()
    const btn = [...page.container.querySelectorAll('button')].find(b => b.textContent.includes('Refresh parameters'))
    page.click(btn)
    await page.flush()
    expect(stub.mock.calls.some(c => c[0] === '/api/FCParamRefresh' && c[1]?.method === 'POST')).toBe(true)
    page.unmount()
  })

  test('shows a progress bar while downloading and refetches on completion', async function () {
    let n = 0
    const seq = [emptyOverview, fullOverview]
    mockFetch({
      '/api/FCConfigOverview': () => seq[Math.min(n++, seq.length - 1)],
      'POST /api/FCParamRefresh': { started: true, state: 'downloading', received: 0, total: 0 }
    })
    const page = renderPage(<FCConfigPage />)
    await page.flush()
    expect(page.container.textContent).toContain('No parameters downloaded yet')
    act(() => { lastSocket().fire('FCParamStatus', { state: 'downloading', received: 50, total: 100 }) })
    expect(page.container.textContent).toContain('50%') // progress bar label
    act(() => { lastSocket().fire('FCParamStatus', { state: 'complete', received: 100, total: 100 }) })
    await page.flush()
    expect(page.container.textContent).toContain('Motor1') // refetched sections
    page.unmount()
  })

  test('shows the failed alert when no FC responds', async function () {
    mockFetch({ '/api/FCConfigOverview': emptyOverview })
    const page = renderPage(<FCConfigPage />)
    await page.flush()
    act(() => { lastSocket().fire('FCParamStatus', { state: 'failed', received: 0, total: 0 }) })
    expect(page.container.textContent).toContain('No flight controller responded')
    page.unmount()
  })

  test('overview fetch error surfaces in the error modal', async function () {
    mockFetch({ '/api/FCConfigOverview': () => { throw new Error('boom') } })
    const page = renderPage(<FCConfigPage />)
    await page.flush()
    expect(document.body.textContent).toContain('boom')
    page.unmount()
  })

  test('refresh error surfaces in the error modal', async function () {
    mockFetch({ '/api/FCConfigOverview': emptyOverview, 'POST /api/FCParamRefresh': () => { throw new Error('refresh fail') } })
    const page = renderPage(<FCConfigPage />)
    await page.flush()
    const btn = [...page.container.querySelectorAll('button')].find(b => b.textContent.includes('Refresh parameters'))
    page.click(btn)
    await page.flush()
    expect(document.body.textContent).toContain('refresh fail')
    page.unmount()
  })

  test('reconnect re-runs componentDidMount without crashing', async function () {
    mockFetch({ '/api/FCConfigOverview': emptyOverview })
    const page = renderPage(<FCConfigPage />)
    await page.flush()
    act(() => { lastSocket().fire('reconnect') })
    await page.flush()
    expect(page.container.textContent).toContain('FC Configuration')
    page.unmount()
  })
})
