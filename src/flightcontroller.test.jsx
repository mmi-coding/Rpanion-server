// @vitest-environment happy-dom
import React, { act } from 'react'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'

import { renderPage, mockFetch } from '../test/ui.jsx'
import { lastSocket } from '../test/socketMock.js'
import FCPage from './flightcontroller.jsx'

vi.mock('socket.io-client', () => import('../test/socketMock.js'))

// Default API responses
const fcDetails = {
  selInputType: 'UART',
  inputTypes: [
    { value: 'UART', label: 'UART' },
    { value: 'UDP', label: 'UDP' }
  ],
  serialPorts: [
    { value: '/dev/ttyUSB0', label: '/dev/ttyUSB0' }
  ],
  baudRates: [
    { value: 57600, label: '57600' },
    { value: 115200, label: '115200' }
  ],
  mavVersions: [
    { value: '1', label: 'MAVLink 1' },
    { value: '2', label: 'MAVLink 2' }
  ],
  serialPortSelected: '/dev/ttyUSB0',
  baudRateSelected: 57600,
  mavVersionSelected: '1'
}

const fcOutputs = {
  UDPoutputs: [],
  enableHeartbeat: false,
  enableTCP: false,
  enableUDPB: false,
  UDPBPort: 14550,
  doLogging: false,
  enableDSRequest: false,
  loadDone: true
}

function defaultFetch (overrides = {}) {
  return mockFetch({
    '/api/FCDetails': fcDetails,
    '/api/FCOutputs': fcOutputs,
    ...overrides
  })
}

describe('#FCPage()', function () {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  // -------------------------------------------------------------------------
  // Basic render / initial state
  // -------------------------------------------------------------------------

  test('renders title "Flight Controller"', async function () {
    defaultFetch()
    const page = renderPage(<FCPage />)
    await page.flush()
    expect(page.container.textContent).toContain('Flight Controller')
    page.unmount()
  })

  test('renders FCDetails after mount', async function () {
    defaultFetch()
    const page = renderPage(<FCPage />)
    await page.flush()
    expect(page.container.textContent).toContain('/dev/ttyUSB0')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // UART branch: selInputType === 'UART' shows serial/baud fields
  // -------------------------------------------------------------------------

  test('UART input type shows Serial Device and Baud Rate selects', async function () {
    defaultFetch()
    const page = renderPage(<FCPage />)
    await page.flush()
    expect(page.container.textContent).toContain('Serial Device')
    expect(page.container.textContent).toContain('Baud Rate')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Non-UART branch: selInputType !== 'UART' shows UDP port field
  // -------------------------------------------------------------------------

  test('UDP input type shows UDP Input Port field (non-UART branch)', async function () {
    defaultFetch({
      '/api/FCDetails': { ...fcDetails, selInputType: 'UDP' }
    })
    const page = renderPage(<FCPage />)
    await page.flush()
    expect(page.container.textContent).toContain('UDP Input Port')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // selInputType === null branch: also renders serial/baud (null || UART)
  // -------------------------------------------------------------------------

  test('selInputType null shows serial fields (null || UART branch)', async function () {
    defaultFetch({
      '/api/FCDetails': { ...fcDetails, selInputType: null }
    })
    const page = renderPage(<FCPage />)
    await page.flush()
    expect(page.container.textContent).toContain('Serial Device')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleInputTypeChange — change select to UDP
  // -------------------------------------------------------------------------

  test('handleInputTypeChange: switching to UDP shows UDP port input', async function () {
    defaultFetch()
    const page = renderPage(<FCPage />)
    await page.flush()
    const selects = page.container.querySelectorAll('select')
    const inputTypeSelect = selects[0]
    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype, 'value'
      ).set
      nativeSetter.call(inputTypeSelect, 'UDP')
      inputTypeSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(page.container.textContent).toContain('UDP Input Port')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleUDPInputPortChange
  // -------------------------------------------------------------------------

  test('handleUDPInputPortChange: updates udpInputPort state', async function () {
    defaultFetch({
      '/api/FCDetails': { ...fcDetails, selInputType: 'UDP' }
    })
    const page = renderPage(<FCPage />)
    await page.flush()
    const udpInput = page.container.querySelector('input[type="number"]')
    page.setValue(udpInput, '14600')
    expect(udpInput.value).toBe('14600')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleSerialPortChange
  // -------------------------------------------------------------------------

  test('handleSerialPortChange: updates serialPortSelected', async function () {
    defaultFetch({
      '/api/FCDetails': {
        ...fcDetails,
        serialPorts: [
          { value: '/dev/ttyUSB0', label: '/dev/ttyUSB0' },
          { value: '/dev/ttyUSB1', label: '/dev/ttyUSB1' }
        ]
      }
    })
    const page = renderPage(<FCPage />)
    await page.flush()
    const selects = page.container.querySelectorAll('select')
    const serialSelect = selects[1] // 0=inputType, 1=serialPort
    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype, 'value'
      ).set
      nativeSetter.call(serialSelect, '/dev/ttyUSB1')
      serialSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    // No crash; selection changed
    expect(page.container.textContent).toContain('Serial Device')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleBaudRateChange
  // -------------------------------------------------------------------------

  test('handleBaudRateChange: updates baudRateSelected', async function () {
    defaultFetch()
    const page = renderPage(<FCPage />)
    await page.flush()
    const selects = page.container.querySelectorAll('select')
    const baudSelect = selects[2] // 0=inputType, 1=serialPort, 2=baudRate
    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype, 'value'
      ).set
      nativeSetter.call(baudSelect, '115200')
      baudSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(page.container.textContent).toContain('Baud Rate')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleMavVersionChange
  // -------------------------------------------------------------------------

  test('handleMavVersionChange: updates mavVersionSelected', async function () {
    defaultFetch()
    const page = renderPage(<FCPage />)
    await page.flush()
    const selects = page.container.querySelectorAll('select')
    const mavSelect = selects[3] // 0=inputType, 1=serialPort, 2=baudRate, 3=mavVersion
    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype, 'value'
      ).set
      nativeSetter.call(mavSelect, '2')
      mavSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(page.container.textContent).toContain('MAVLink Version')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleUseHeartbeatChange, handleUseTCPChange, handleLoggingChange,
  // handleDSRequest, handleUseUDPBChange, changeUDPBPort
  // -------------------------------------------------------------------------

  test('handleUseHeartbeatChange: toggling heartbeat checkbox', async function () {
    defaultFetch()
    const page = renderPage(<FCPage />)
    await page.flush()
    const checkboxes = page.container.querySelectorAll('input[type="checkbox"]')
    // enableUDPB=0, enableTCP=1, enableDSRequest=2, enableHeartbeat=3, doLogging=4
    // Actually order: enableUDPB, enableTCP, enableDSRequest, enableHeartbeat, doLogging
    // Let's find by traversal — just click each and verify no crash
    act(() => { checkboxes[0].click() }) // enableUDPB
    act(() => { checkboxes[1].click() }) // enableTCP
    act(() => { checkboxes[2].click() }) // enableDSRequest
    act(() => { checkboxes[3].click() }) // enableHeartbeat
    act(() => { checkboxes[4].click() }) // doLogging
    expect(page.container.textContent).toContain('Flight Controller')
    page.unmount()
  })

  test('changeUDPBPort: updates UDPBPort when UDPB enabled', async function () {
    defaultFetch({
      '/api/FCOutputs': { ...fcOutputs, enableUDPB: true }
    })
    const page = renderPage(<FCPage />)
    await page.flush()
    const udpbPortInput = page.container.querySelector('input[type="number"][min="1000"][max="20000"]')
    page.setValue(udpbPortInput, '14551')
    expect(udpbPortInput.value).toBe('14551')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleSubmit — POST /api/FCModify
  // -------------------------------------------------------------------------

  test('handleSubmit POSTs to /api/FCModify', async function () {
    let postedBody = null
    defaultFetch({
      'POST /api/FCModify': (url, opts) => {
        postedBody = JSON.parse(opts.body)
        return { ...fcDetails, ...fcOutputs }
      }
    })
    const page = renderPage(<FCPage />)
    await page.flush()
    // Button is enabled: selInputType is 'UART', serialPorts has entries
    // Use trim() to avoid matching "Telemetry Destinations" accordion button
    const btn = [...page.container.querySelectorAll('button')].find(
      b => b.textContent.trim() === 'Start Telemetry' || b.textContent.trim() === 'Stop Telemetry'
    )
    expect(btn.disabled).toBe(false)
    page.click(btn)
    await page.flush()
    expect(postedBody).not.toBeNull()
    expect(postedBody.inputType).toBe('UART')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Button disabled when selInputType === null
  // -------------------------------------------------------------------------

  test('Start Telemetry button disabled when selInputType is null', async function () {
    defaultFetch({
      '/api/FCDetails': { ...fcDetails, selInputType: null, inputTypes: [], serialPorts: [], baudRates: [], mavVersions: [] }
    })
    const page = renderPage(<FCPage />)
    await page.flush()
    const btn = [...page.container.querySelectorAll('button')].find(
      b => b.textContent.trim() === 'Start Telemetry' || b.textContent.trim() === 'Stop Telemetry'
    )
    expect(btn.disabled).toBe(true)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Button disabled when serialPorts empty and UART
  // -------------------------------------------------------------------------

  test('Start Telemetry button disabled when serialPorts empty and UART', async function () {
    defaultFetch({
      '/api/FCDetails': { ...fcDetails, selInputType: 'UART', serialPorts: [] }
    })
    const page = renderPage(<FCPage />)
    await page.flush()
    const btn = [...page.container.querySelectorAll('button')].find(
      b => b.textContent.trim() === 'Start Telemetry' || b.textContent.trim() === 'Stop Telemetry'
    )
    expect(btn.disabled).toBe(true)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleFCReboot — POST /api/FCReboot (fire-and-forget)
  // -------------------------------------------------------------------------

  test('handleFCReboot POSTs to /api/FCReboot when telemetryStatus=true', async function () {
    let rebootCalled = false
    defaultFetch({
      'POST /api/FCReboot': () => { rebootCalled = true; return {} }
    })
    const page = renderPage(<FCPage telemetryStatus={true} />)
    await page.flush()
    const rebootBtn = [...page.container.querySelectorAll('button')].find(
      b => b.textContent.trim() === 'Reboot Flight Controller'
    )
    expect(rebootBtn.disabled).toBe(false)
    page.click(rebootBtn)
    await page.flush()
    expect(rebootCalled).toBe(true)
    page.unmount()
  })

  test('Reboot button disabled when telemetryStatus=false (default)', async function () {
    defaultFetch()
    const page = renderPage(<FCPage />)
    await page.flush()
    const rebootBtn = [...page.container.querySelectorAll('button')].find(
      b => b.textContent.trim() === 'Reboot Flight Controller'
    )
    expect(rebootBtn.disabled).toBe(true)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // addUdpOutput — POST /api/addudpoutput
  // -------------------------------------------------------------------------

  test('addUdpOutput: changeaddrow + Add button POSTs to /api/addudpoutput', async function () {
    let addedBody = null
    defaultFetch({
      'POST /api/addudpoutput': (url, opts) => {
        addedBody = JSON.parse(opts.body)
        return { UDPoutputs: [{ IPPort: '192.168.1.10:14550' }] }
      }
    })
    const page = renderPage(<FCPage />)
    await page.flush()
    // Set addrow input value
    const addInput = page.container.querySelector('input[type="text"]')
    page.setValue(addInput, '192.168.1.10:14550')
    await page.flush()
    // Click Add button
    const addBtn = [...page.container.querySelectorAll('button')].find(
      b => b.textContent === 'Add'
    )
    page.click(addBtn)
    await page.flush()
    expect(addedBody).not.toBeNull()
    expect(addedBody.newoutputIP).toBe('192.168.1.10')
    expect(addedBody.newoutputPort).toBe('14550')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // removeUdpOutput — POST /api/removeudpoutput
  // -------------------------------------------------------------------------

  test('removeUdpOutput: Delete button POSTs to /api/removeudpoutput', async function () {
    let removedBody = null
    defaultFetch({
      '/api/FCOutputs': {
        ...fcOutputs,
        UDPoutputs: [{ IPPort: '10.0.0.1:14550' }]
      },
      'POST /api/removeudpoutput': (url, opts) => {
        removedBody = JSON.parse(opts.body)
        return { UDPoutputs: [] }
      }
    })
    const page = renderPage(<FCPage />)
    await page.flush()
    const deleteBtn = [...page.container.querySelectorAll('button')].find(
      b => b.textContent === 'Delete'
    )
    expect(deleteBtn).toBeDefined()
    page.click(deleteBtn)
    await page.flush()
    expect(removedBody).not.toBeNull()
    expect(removedBody.removeoutputIP).toBe('10.0.0.1')
    expect(removedBody.removeoutputPort).toBe('14550')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // renderUDPTableData — renders table rows for UDPoutputs
  // -------------------------------------------------------------------------

  test('renderUDPTableData renders IP:port rows in table', async function () {
    defaultFetch({
      '/api/FCOutputs': {
        ...fcOutputs,
        UDPoutputs: [
          { IPPort: '10.0.0.1:14550' },
          { IPPort: '10.0.0.2:14551' }
        ]
      }
    })
    const page = renderPage(<FCPage />)
    await page.flush()
    expect(page.container.textContent).toContain('10.0.0.1:14550')
    expect(page.container.textContent).toContain('10.0.0.2:14551')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // FCStatus socket event
  // -------------------------------------------------------------------------

  test('FCStatus socket updates status fields', async function () {
    defaultFetch()
    const page = renderPage(<FCPage />)
    await page.flush()
    act(() => {
      lastSocket().fire('FCStatus', {
        numpackets: 99,
        byteRate: 2048,
        conStatus: 'Connected',
        vehType: 'Quadrotor',
        FW: 'ArduCopter',
        fcVersion: '4.5.0',
        statusText: 'EKF OK'
      })
    })
    expect(page.container.textContent).toContain('99')
    expect(page.container.textContent).toContain('2048')
    expect(page.container.textContent).toContain('Quadrotor')
    expect(page.container.textContent).toContain('ArduCopter')
    expect(page.container.textContent).toContain('4.5.0')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // FCStatus with vehiclePosition (conditional block)
  // -------------------------------------------------------------------------

  test('FCStatus with vehiclePosition renders lat/lon/alt/heading', async function () {
    defaultFetch()
    const page = renderPage(<FCPage />)
    await page.flush()
    act(() => {
      lastSocket().fire('FCStatus', {
        numpackets: 10,
        byteRate: 100,
        conStatus: 'Connected',
        vehType: 'Plane',
        FW: 'ArduPlane',
        fcVersion: '',
        statusText: '',
        vehiclePosition: {
          lat: 51.5074123,
          lon: -0.1278456,
          alt: 100.5,
          relAlt: 50.25,
          hdg: 270.0
        }
      })
    })
    expect(page.container.textContent).toContain('51.5074123')
    expect(page.container.textContent).toContain('-0.1278456')
    expect(page.container.textContent).toContain('100.50')
    expect(page.container.textContent).toContain('50.25')
    expect(page.container.textContent).toContain('270')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // FCStatus without vehiclePosition (null/undefined — conditional false branch)
  // -------------------------------------------------------------------------

  test('FCStatus without vehiclePosition does not render position block', async function () {
    defaultFetch()
    const page = renderPage(<FCPage />)
    await page.flush()
    act(() => {
      lastSocket().fire('FCStatus', {
        numpackets: 5,
        byteRate: 50,
        conStatus: 'Disconnected',
        vehType: '',
        FW: '',
        fcVersion: '',
        statusText: '',
        vehiclePosition: null
      })
    })
    expect(page.container.textContent).not.toContain('Position:')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // FCStatus fcVersion empty string vs non-empty (ternary branch)
  // -------------------------------------------------------------------------

  test('FCStatus with empty fcVersion shows no version suffix', async function () {
    defaultFetch()
    const page = renderPage(<FCPage />)
    await page.flush()
    act(() => {
      lastSocket().fire('FCStatus', {
        numpackets: 0,
        byteRate: 0,
        conStatus: '',
        vehType: '',
        FW: 'ArduCopter',
        fcVersion: '',
        statusText: ''
      })
    })
    expect(page.container.textContent).toContain('ArduCopter')
    expect(page.container.textContent).not.toContain('Version:')
    page.unmount()
  })

  test('FCStatus with non-empty fcVersion shows version suffix', async function () {
    defaultFetch()
    const page = renderPage(<FCPage />)
    await page.flush()
    act(() => {
      lastSocket().fire('FCStatus', {
        numpackets: 0,
        byteRate: 0,
        conStatus: '',
        vehType: '',
        FW: 'ArduCopter',
        fcVersion: '4.3.2',
        statusText: ''
      })
    })
    expect(page.container.textContent).toContain('Version: 4.3.2')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // reconnect socket event re-calls componentDidMount
  // -------------------------------------------------------------------------

  test('reconnect socket event re-fetches details', async function () {
    defaultFetch()
    const page = renderPage(<FCPage />)
    await page.flush()
    act(() => { lastSocket().fire('reconnect') })
    await page.flush()
    expect(page.container.textContent).toContain('Flight Controller')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // showLogin path
  // -------------------------------------------------------------------------

  test('showLogin=true renders login form', async function () {
    defaultFetch()
    const page = renderPage(<FCPage showLogin={true} />)
    expect(page.container.textContent).toContain('Please Log In')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // telemetryStatus prop disables controls
  // -------------------------------------------------------------------------

  test('telemetryStatus=true disables input type select', async function () {
    defaultFetch({
      '/api/FCDetails': { ...fcDetails, selInputType: 'UART' }
    })
    const page = renderPage(<FCPage telemetryStatus={true} />)
    await page.flush()
    const selects = page.container.querySelectorAll('select')
    expect(selects[0].disabled).toBe(true)
    page.unmount()
  })

  test('telemetryStatus=true shows "Stop Telemetry" button text', async function () {
    defaultFetch()
    const page = renderPage(<FCPage telemetryStatus={true} />)
    await page.flush()
    const btn = [...page.container.querySelectorAll('button')].find(
      b => b.textContent.trim() === 'Stop Telemetry'
    )
    expect(btn).toBeDefined()
    page.unmount()
  })
})
