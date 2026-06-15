// @vitest-environment happy-dom
import React, { act } from 'react'
import { describe, test, expect, afterEach, beforeEach } from 'vitest'

import { renderPage, mockFetch } from '../test/ui.jsx'
import { lastSocket } from '../test/socketMock.js'
import FCPage from './flightcontroller.jsx'
import { vi } from 'vitest'

vi.mock('socket.io-client', () => import('../test/socketMock.js'))

const fcDetails = {
  inputTypes: [{ value: 'UART', label: 'UART' }, { value: 'UDP', label: 'UDP Server' }],
  serialPorts: [{ value: '/dev/ttyUSB0', label: '/dev/ttyUSB0' }],
  baudRates: [{ value: 57600, label: '57600' }, { value: 115200, label: '115200' }],
  mavVersions: [{ value: 1, label: '1.0' }, { value: 2, label: '2.0' }],
  links: [{ id: 0, inputType: 'UART', label: '/dev/ttyUSB0 @ 57600' }],
  enableHeartbeat: false, enableTCP: false, enableUDPB: false, UDPBPort: 14550,
  enableDSRequest: false, doLogging: false
}
const fcOutputs = { UDPoutputs: [] }

function defaultFetch (overrides = {}) {
  return mockFetch({ '/api/FCDetails': fcDetails, '/api/FCOutputs': fcOutputs, ...overrides })
}

function renderFC () {
  let ref = null
  const page = renderPage(<FCPage ref={(r) => { ref = r }} />)
  return { page, getRef: () => ref }
}

function findButton (page, text) {
  return [...page.container.querySelectorAll('button')].find(b => b.textContent.includes(text))
}

describe('#FCPage() multi-link', function () {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

  test('renders title and a link card from FCDetails', async function () {
    defaultFetch()
    const { page } = renderFC()
    await page.flush()
    expect(page.container.textContent).toContain('Flight Controller')
    expect(page.container.textContent).toContain('/dev/ttyUSB0 @ 57600')
    page.unmount()
  })

  test('seeds the add-form serial default from the available ports', async function () {
    defaultFetch()
    const { page, getRef } = renderFC()
    await page.flush()
    expect(getRef().state.addSerial).toBe('/dev/ttyUSB0')
    page.unmount()
  })

  test('with no serial ports, Add is disabled and serial stays null', async function () {
    defaultFetch({ '/api/FCDetails': { ...fcDetails, serialPorts: [], links: [] } })
    const { page, getRef } = renderFC()
    await page.flush()
    expect(getRef().state.addSerial).toBe(null)
    expect(findButton(page, 'Add Link').disabled).toBe(true)
    page.unmount()
  })

  test('switching input type to UDP shows the UDP port input', async function () {
    defaultFetch()
    const { page, getRef } = renderFC()
    await page.flush()
    act(() => { getRef().handleAddInputType({ target: { value: 'UDP' } }) })
    expect(page.container.textContent).toContain('UDP Input Port')
    // back to UART
    act(() => { getRef().handleAddInputType({ target: { value: 'UART' } }) })
    expect(page.container.textContent).toContain('Serial Device')
    page.unmount()
  })

  test('addLink success updates the links list', async function () {
    const fetch = defaultFetch({ 'POST /api/FCAddLink': { links: [{ id: 0, inputType: 'UART', label: '/dev/ttyUSB0 @ 57600' }, { id: 1, inputType: 'UDP', label: 'UDP :14551' }], error: null } })
    const { page, getRef } = renderFC()
    await page.flush()
    act(() => { findButton(page, 'Add Link').click() })
    await page.flush()
    expect(fetch).toHaveBeenCalledWith('/api/FCAddLink', expect.objectContaining({ method: 'POST' }))
    expect(getRef().state.links.length).toBe(2)
    page.unmount()
  })

  test('addLink error shows the warning', async function () {
    defaultFetch({ 'POST /api/FCAddLink': { links: [], error: 'A link on that input already exists' } })
    const { page } = renderFC()
    await page.flush()
    act(() => { findButton(page, 'Add Link').click() })
    await page.flush()
    expect(page.container.textContent).toContain('already exists')
    page.unmount()
  })

  test('addLink fetch failure is caught', async function () {
    defaultFetch({ 'POST /api/FCAddLink': () => { throw new Error('net') } })
    const { page } = renderFC()
    await page.flush()
    act(() => { findButton(page, 'Add Link').click() })
    await page.flush()
    expect(page.container.textContent).toContain('Could not add link')
    page.unmount()
  })

  test('removeLink success updates the links list', async function () {
    const fetch = defaultFetch({ 'POST /api/FCRemoveLink': { links: [], error: null } })
    const { page, getRef } = renderFC()
    await page.flush()
    act(() => { findButton(page, 'Remove').click() })
    await page.flush()
    expect(fetch).toHaveBeenCalledWith('/api/FCRemoveLink', expect.objectContaining({ method: 'POST' }))
    expect(getRef().state.links.length).toBe(0)
    page.unmount()
  })

  test('removeLink fetch failure is caught', async function () {
    defaultFetch({ 'POST /api/FCRemoveLink': () => { throw new Error('net') } })
    const { page } = renderFC()
    await page.flush()
    act(() => { findButton(page, 'Remove').click() })
    await page.flush()
    expect(page.container.textContent).toContain('Could not remove link')
    page.unmount()
  })

  test('FCStatus populates the matching link card with live status + position', async function () {
    defaultFetch()
    const { page } = renderFC()
    await page.flush()
    act(() => {
      lastSocket().fire('FCStatus', {
        conStatus: 'Connected', numpackets: 99, byteRate: 2048,
        links: [{ id: 0, conStatus: 'Connected', numpackets: 99, byteRate: 2048, vehType: 'Quadrotor', FW: 'ArduCopter', fcVersion: '4.5.0', vehiclePosition: { lat: 51.5074123, lon: -0.1278456, alt: 100.5, relAlt: 50.25, hdg: 270 } }]
      })
    })
    expect(page.container.textContent).toContain('Connected')
    expect(page.container.textContent).toContain('99 packets')
    expect(page.container.textContent).toContain('ArduCopter')
    expect(page.container.textContent).toContain('4.5.0')
    expect(page.container.textContent).toContain('51.5074123')
    expect(page.container.textContent).toContain('270')
    page.unmount()
  })

  test('FCStatus with a zero position does not render the position line', async function () {
    defaultFetch()
    const { page } = renderFC()
    await page.flush()
    act(() => {
      lastSocket().fire('FCStatus', {
        conStatus: 'Waiting', links: [{ id: 0, conStatus: 'Waiting', numpackets: 0, byteRate: 0, vehType: '', FW: '', fcVersion: '', vehiclePosition: { lat: 0, lon: 0, alt: 0, relAlt: 0, hdg: 0 } }]
      })
    })
    expect(page.container.textContent).not.toContain('Position:')
    page.unmount()
  })

  test('reconnect re-fetches details', async function () {
    defaultFetch()
    const { page, getRef } = renderFC()
    await page.flush()
    const spy = vi.spyOn(getRef(), 'componentDidMount')
    act(() => { lastSocket().fire('reconnect') })
    expect(spy).toHaveBeenCalled()
    page.unmount()
  })

  test('shared option toggles + UDPB port update state', async function () {
    defaultFetch()
    const { page, getRef } = renderFC()
    await page.flush()
    act(() => {
      getRef().handleUseHeartbeatChange({ target: { checked: true } })
      getRef().handleUseTCPChange({ target: { checked: true } })
      getRef().handleUseUDPBChange({ target: { checked: true } })
      getRef().handleDSRequest({ target: { checked: true } })
      getRef().handleLoggingChange({ target: { checked: true } })
      getRef().changeUDPBPort({ target: { value: '14555' } })
      getRef().handleAddBaud({ target: { value: '115200' } })
      getRef().handleAddMavVersion({ target: { value: '1' } })
      getRef().handleAddUdpPort({ target: { value: '14999' } })
      getRef().handleAddSerial({ target: { value: '/dev/ttyUSB0' } })
    })
    expect(getRef().state.enableHeartbeat).toBe(true)
    expect(getRef().state.enableTCP).toBe(true)
    expect(getRef().state.enableUDPB).toBe(true)
    expect(getRef().state.enableDSRequest).toBe(true)
    expect(getRef().state.doLogging).toBe(true)
    expect(getRef().state.UDPBPort).toBe(14555)
    expect(getRef().state.addBaud).toBe(115200)
    expect(getRef().state.addUdpPort).toBe(14999)
    page.unmount()
  })

  test('applyOptions POSTs the shared options', async function () {
    const fetch = defaultFetch({ 'POST /api/FCOptions': { error: null } })
    const { page } = renderFC()
    await page.flush()
    act(() => { findButton(page, 'Apply Shared Options').click() })
    await page.flush()
    expect(fetch).toHaveBeenCalledWith('/api/FCOptions', expect.objectContaining({ method: 'POST' }))
    page.unmount()
  })

  test('add / remove a UDP output destination', async function () {
    const fetch = defaultFetch({
      'POST /api/addudpoutput': { UDPoutputs: [{ IPPort: '10.0.0.2:14550' }] },
      'POST /api/removeudpoutput': { UDPoutputs: [] }
    })
    const { page, getRef } = renderFC()
    await page.flush()
    act(() => { getRef().changeaddrow({ target: { value: '10.0.0.2:14550' } }) })
    const udpAddBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Add')
    act(() => { udpAddBtn.click() })
    await page.flush()
    expect(getRef().state.UDPoutputs.length).toBe(1)
    expect(page.container.textContent).toContain('10.0.0.2:14550')
    act(() => { findButton(page, 'Delete').click() })
    await page.flush()
    expect(getRef().state.UDPoutputs.length).toBe(0)
    expect(fetch).toHaveBeenCalledWith('/api/removeudpoutput', expect.objectContaining({ method: 'POST' }))
    page.unmount()
  })

  test('Reboot button is disabled with no links and POSTs when links exist', async function () {
    const fetch = defaultFetch({ '/api/FCDetails': { ...fcDetails, links: [] }, 'POST /api/FCReboot': {} })
    const { page } = renderFC()
    await page.flush()
    expect(findButton(page, 'Reboot Flight Controller').disabled).toBe(true)
    page.unmount()

    const f2 = defaultFetch({ 'POST /api/FCReboot': {} })
    const { page: p2 } = renderFC()
    await p2.flush()
    const rb = findButton(p2, 'Reboot Flight Controller')
    expect(rb.disabled).toBe(false)
    act(() => { rb.click() })
    await p2.flush()
    expect(f2).toHaveBeenCalledWith('/api/FCReboot', expect.objectContaining({ method: 'POST' }))
    p2.unmount()
  })

  test('at the link maximum, Add Link is disabled with a note', async function () {
    const fourLinks = [0, 1, 2, 3].map(i => ({ id: i, inputType: 'UART', label: '/dev/ttyUSB' + i + ' @ 57600' }))
    defaultFetch({ '/api/FCDetails': { ...fcDetails, links: fourLinks } })
    const { page } = renderFC()
    await page.flush()
    expect(findButton(page, 'Add Link').disabled).toBe(true)
    expect(page.container.textContent).toContain('Maximum of 4 links')
    page.unmount()
  })
})
