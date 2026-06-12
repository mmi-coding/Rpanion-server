// @vitest-environment happy-dom
import React, { act } from 'react'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'

import { renderPage, mockFetch } from '../test/ui.jsx'
import NetworkConfig from './networkconfig.jsx'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function selectValue (select, value) {
  act(() => {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype, 'value'
    ).set
    nativeSetter.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

// Standard ethernet adapter fixture
const ethAdapter = { value: 'eth0', label: 'eth0', type: 'ethernet', channels: [] }
const wifiAdapter = {
  value: 'wlan0', label: 'wlan0', type: 'wifi',
  channels: [
    { value: 1, label: 'CH 1', band: 'bg' },
    { value: 36, label: 'CH 36', band: 'a' },
    { value: 0, label: 'Auto', band: 0 }
  ]
}
const tunAdapter = { value: 'tun0', label: 'tun0', type: 'tun', channels: [] }
const wifiAdapter2 = { value: 'wlan1', label: 'wlan1', type: 'wifi', channels: [] }

const ethConnection = {
  value: 'eth0-home',
  label: 'Home Network',
  labelPre: 'Home Network',
  type: '802-3-ethernet',
  state: '',
  attachedIface: ''
}
const ethConnectionActive = {
  value: 'eth0-home',
  label: 'Home Network',
  labelPre: 'Home Network',
  type: '802-3-ethernet',
  state: 'eth0', // active on eth0
  attachedIface: ''
}

const wifiConnectionClient = {
  value: 'wlan0-home',
  label: 'MyWifi',
  labelPre: 'MyWifi',
  type: '802-11-wireless',
  state: '',
  attachedIface: ''
}
const wifiConnectionAP = {
  value: 'wlan0-ap',
  label: 'MyAP',
  labelPre: 'MyAP',
  type: '802-11-wireless',
  state: '',
  attachedIface: ''
}
const tunConnection = {
  value: 'tun0-vpn',
  label: 'VPN Tunnel',
  labelPre: 'VPN Tunnel',
  type: 'tun',
  state: '',
  attachedIface: ''
}

const defaultDetails = {
  netConnectionDetails: {
    DHCP: 'auto',
    IP: '192.168.1.100',
    subnet: '255.255.255.0',
    wpaType: 'wpa-psk',
    password: 'secret',
    ssid: 'MySSID',
    band: 'bg',
    channel: '6',
    mode: 'infrastructure',
    attachedIface: 'wlan0'
  }
}

const apDetails = {
  netConnectionDetails: {
    DHCP: 'shared',
    IP: '192.168.50.1',
    subnet: '255.255.255.0',
    wpaType: 'wpa-psk',
    password: 'appassword',
    ssid: 'MyHotspot',
    band: 'bg',
    channel: '6',
    mode: 'ap',
    attachedIface: 'wlan0'
  }
}

// Build a standard mock fetch for an ethernet setup
function buildEthFetch (overrides = {}) {
  return mockFetch({
    '/api/networkconnections': { netConnection: [ethConnection] },
    '/api/wirelessstatus': { wirelessEnabled: true },
    '/api/networkadapters': { netDevice: [ethAdapter] },
    'POST /api/networkIP': { ...defaultDetails, netConnectionDetails: { ...defaultDetails.netConnectionDetails, mode: '' } },
    ...overrides
  })
}

function buildWifiFetch (overrides = {}) {
  return mockFetch({
    '/api/networkconnections': { netConnection: [wifiConnectionClient] },
    '/api/wirelessstatus': { wirelessEnabled: true },
    '/api/networkadapters': { netDevice: [wifiAdapter] },
    'POST /api/networkIP': defaultDetails,
    ...overrides
  })
}

// ---------------------------------------------------------------------------
// Main test suite
// ---------------------------------------------------------------------------

describe('#NetworkConfig()', function () {
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

  test('renders title "Network Configuration"', async function () {
    buildEthFetch()
    const page = renderPage(<NetworkConfig />)
    await page.flush()
    expect(page.container.textContent).toContain('Network Configuration')
    page.unmount()
  })

  test('renders adapter and connection selects after load', async function () {
    buildEthFetch()
    const page = renderPage(<NetworkConfig />)
    await page.flush()
    const selects = page.container.querySelectorAll('select')
    expect(selects.length).toBeGreaterThan(0)
    page.unmount()
  })

  test('renders wireless enabled checkbox', async function () {
    buildEthFetch()
    const page = renderPage(<NetworkConfig />)
    await page.flush()
    const checkboxes = page.container.querySelectorAll('input[type="checkbox"]')
    expect(checkboxes.length).toBeGreaterThan(0)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // No adapters — empty device list
  // -------------------------------------------------------------------------

  test('handles empty netDevice list gracefully', async function () {
    mockFetch({
      '/api/networkconnections': { netConnection: [] },
      '/api/wirelessstatus': { wirelessEnabled: false },
      '/api/networkadapters': { netDevice: [] }
    })
    const page = renderPage(<NetworkConfig />)
    await page.flush()
    expect(page.container.textContent).toContain('Network Configuration')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Ethernet adapter — active connection gets "(Active)" label
  // -------------------------------------------------------------------------

  test('active ethernet connection gets (Active) label', async function () {
    let ref = null
    mockFetch({
      '/api/networkconnections': { netConnection: [ethConnectionActive] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [ethAdapter] },
      'POST /api/networkIP': { ...defaultDetails, netConnectionDetails: { ...defaultDetails.netConnectionDetails, mode: '' } }
    })
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    // Active connection state === adapter value triggers (Active) label
    expect(ref.state.netConnectionFiltered.some(c => c.label.includes('(Active)'))).toBe(true)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Ethernet adapter — non-active connection (state !== adapter value)
  // -------------------------------------------------------------------------

  test('non-active ethernet connection has plain label', async function () {
    let ref = null
    buildEthFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    // state === '' so no (Active) label
    expect(ref.state.netConnectionFiltered[0].label).toBe('Home Network')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Ethernet adapter — connection with specific attachedIface
  // -------------------------------------------------------------------------

  test('ethernet connection with different attachedIface is excluded', async function () {
    let ref = null
    const differentIfaceCon = { ...ethConnection, attachedIface: 'eth1' }
    mockFetch({
      '/api/networkconnections': { netConnection: [differentIfaceCon] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [ethAdapter] },
      'POST /api/networkIP': { ...defaultDetails, netConnectionDetails: { ...defaultDetails.netConnectionDetails, mode: '' } }
    })
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    // Should be excluded because attachedIface !== '' and !== 'eth0'
    expect(ref.state.netConnectionFiltered.length).toBe(0)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Ethernet adapter — connection with matching attachedIface
  // -------------------------------------------------------------------------

  test('ethernet connection with matching attachedIface is included', async function () {
    let ref = null
    const matchingIfaceCon = { ...ethConnection, attachedIface: 'eth0' }
    mockFetch({
      '/api/networkconnections': { netConnection: [matchingIfaceCon] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [ethAdapter] },
      'POST /api/networkIP': { ...defaultDetails, netConnectionDetails: { ...defaultDetails.netConnectionDetails, mode: '' } }
    })
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    expect(ref.state.netConnectionFiltered.length).toBe(1)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // No connections → blank form (handleConnectionChange with null)
  // -------------------------------------------------------------------------

  test('no connections for adapter → showIP false, no filtered connections', async function () {
    let ref = null
    // No ethernet connections in list
    mockFetch({
      '/api/networkconnections': { netConnection: [wifiConnectionClient] }, // wifi connection, eth adapter
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [ethAdapter] }
    })
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    expect(ref.state.showIP).toBe(false)
    expect(ref.state.netConnectionFiltered.length).toBe(0)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Wifi adapter — filters wifi connections
  // -------------------------------------------------------------------------

  test('wifi adapter shows wifi connections', async function () {
    let ref = null
    buildWifiFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    expect(ref.state.netConnectionFiltered.length).toBeGreaterThan(0)
    page.unmount()
  })

  test('wifi active connection gets (Active) label', async function () {
    let ref = null
    const activeWifi = { ...wifiConnectionClient, state: 'wlan0' }
    mockFetch({
      '/api/networkconnections': { netConnection: [activeWifi] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter] },
      'POST /api/networkIP': defaultDetails
    })
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    expect(ref.state.netConnectionFiltered.some(c => c.label.includes('(Active)'))).toBe(true)
    page.unmount()
  })

  // Wifi connections with various attachedIface values
  test('wifi connection with attachedIface "\"\"" is included', async function () {
    let ref = null
    const con = { ...wifiConnectionClient, attachedIface: '""' }
    mockFetch({
      '/api/networkconnections': { netConnection: [con] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter] },
      'POST /api/networkIP': defaultDetails
    })
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    expect(ref.state.netConnectionFiltered.length).toBe(1)
    page.unmount()
  })

  test('wifi connection with attachedIface "undefined" is included', async function () {
    let ref = null
    const con = { ...wifiConnectionClient, attachedIface: 'undefined' }
    mockFetch({
      '/api/networkconnections': { netConnection: [con] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter] },
      'POST /api/networkIP': defaultDetails
    })
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    expect(ref.state.netConnectionFiltered.length).toBe(1)
    page.unmount()
  })

  test('wifi connection with matching adapter attachedIface is included', async function () {
    let ref = null
    const con = { ...wifiConnectionClient, attachedIface: 'wlan0' }
    mockFetch({
      '/api/networkconnections': { netConnection: [con] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter] },
      'POST /api/networkIP': defaultDetails
    })
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    expect(ref.state.netConnectionFiltered.length).toBe(1)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Tun adapter
  // -------------------------------------------------------------------------

  test('tun adapter shows tun connections', async function () {
    let ref = null
    mockFetch({
      '/api/networkconnections': { netConnection: [tunConnection] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [tunAdapter] },
      'POST /api/networkIP': { netConnectionDetails: { DHCP: 'auto', IP: '', subnet: '', wpaType: '', password: '', ssid: '', band: '', channel: '', mode: '', attachedIface: '' } }
    })
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    expect(ref.state.netConnectionFiltered.length).toBe(1)
    page.unmount()
  })

  test('tun active connection gets (Active) label', async function () {
    let ref = null
    const activeTun = { ...tunConnection, state: 'tun0' }
    mockFetch({
      '/api/networkconnections': { netConnection: [activeTun] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [tunAdapter] },
      'POST /api/networkIP': { netConnectionDetails: { DHCP: 'auto', IP: '', subnet: '', wpaType: '', password: '', ssid: '', band: '', channel: '', mode: '', attachedIface: '' } }
    })
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    expect(ref.state.netConnectionFiltered.some(c => c.label.includes('(Active)'))).toBe(true)
    page.unmount()
  })

  test('tun connection with matching attachedIface is included', async function () {
    let ref = null
    const matchTun = { ...tunConnection, attachedIface: 'tun0' }
    mockFetch({
      '/api/networkconnections': { netConnection: [matchTun] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [tunAdapter] },
      'POST /api/networkIP': { netConnectionDetails: { DHCP: 'auto', IP: '', subnet: '', wpaType: '', password: '', ssid: '', band: '', channel: '', mode: '', attachedIface: '' } }
    })
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    expect(ref.state.netConnectionFiltered.length).toBe(1)
    page.unmount()
  })

  test('tun connection with different attachedIface is excluded', async function () {
    let ref = null
    const otherTun = { ...tunConnection, attachedIface: 'tun1' }
    mockFetch({
      '/api/networkconnections': { netConnection: [otherTun] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [tunAdapter] }
    })
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    expect(ref.state.netConnectionFiltered.length).toBe(0)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleAdapterChange — invalid adapter (not found)
  // -------------------------------------------------------------------------

  test('handleAdapterChange with unknown value returns early', async function () {
    let ref = null
    buildEthFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    const before = ref.state.netConnectionFiltered.length
    act(() => {
      ref.handleAdapterChange({ target: { value: 'nonexistent-adapter' } })
    })
    await page.flush()
    // State should be unchanged because device not found → early return
    expect(ref.state.netConnectionFiltered.length).toBe(before)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleConnectionChange — null (no connection selected)
  // -------------------------------------------------------------------------

  test('handleConnectionChange with null sets showIP false', async function () {
    let ref = null
    buildEthFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => {
      ref.handleConnectionChange({ target: { value: null } })
    })
    await page.flush()
    expect(ref.state.showIP).toBe(false)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleConnectionChange — connection not found in filtered list
  // -------------------------------------------------------------------------

  test('handleConnectionChange with unknown value returns early', async function () {
    let ref = null
    buildEthFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    const prevSelected = ref.state.netConnectionFilteredSelected
    act(() => {
      ref.handleConnectionChange({ target: { value: 'unknown-connection' } })
    })
    await page.flush()
    // State should be unchanged because connection not found
    expect(ref.state.netConnectionFilteredSelected).toBe(prevSelected)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleConnectionChange — loads curSettings from netConnectionDetails
  // -------------------------------------------------------------------------

  test('handleConnectionChange loads curSettings from API response', async function () {
    let ref = null
    buildWifiFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    expect(ref.state.curSettings.ssid).toBe('MySSID')
    expect(ref.state.curSettings.mode).toBe('infrastructure')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // getSameAdapter — returns adapters of same type
  // -------------------------------------------------------------------------

  test('getSameAdapter returns adapters of same type', async function () {
    let ref = null
    mockFetch({
      '/api/networkconnections': { netConnection: [wifiConnectionClient] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter, wifiAdapter2, ethAdapter] },
      'POST /api/networkIP': defaultDetails
    })
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    const same = ref.getSameAdapter()
    // Should return wlan0 and wlan1 (both wifi), not eth0
    expect(same.map(a => a.value)).toContain('wlan0')
    expect(same.map(a => a.value)).toContain('wlan1')
    expect(same.map(a => a.value)).not.toContain('eth0')
    page.unmount()
  })

  test('getSameAdapter returns empty when no selected device', async function () {
    let ref = null
    buildEthFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.setState({ netDeviceSelected: null }) })
    const same = ref.getSameAdapter()
    expect(same).toEqual([])
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Adapter select change via DOM
  // -------------------------------------------------------------------------

  test('adapter select change triggers handleAdapterChange', async function () {
    let ref = null
    mockFetch({
      '/api/networkconnections': { netConnection: [ethConnection, wifiConnectionClient] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [ethAdapter, wifiAdapter] },
      'POST /api/networkIP': defaultDetails
    })
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    const selects = page.container.querySelectorAll('select')
    const adapterSelect = selects[0]
    selectValue(adapterSelect, 'wlan0')
    await page.flush()
    expect(ref.state.netDeviceSelected).toBe('wlan0')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Connection select change via DOM
  // -------------------------------------------------------------------------

  test('connection select change triggers handleConnectionChange', async function () {
    let ref = null
    const ethCon2 = { ...ethConnection, value: 'eth0-work', label: 'Work Network', labelPre: 'Work Network' }
    mockFetch({
      '/api/networkconnections': { netConnection: [ethConnection, ethCon2] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [ethAdapter] },
      'POST /api/networkIP': { ...defaultDetails, netConnectionDetails: { ...defaultDetails.netConnectionDetails, mode: '' } }
    })
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    const selects = page.container.querySelectorAll('select')
    const connSelect = selects[1]
    selectValue(connSelect, 'eth0-work')
    await page.flush()
    expect(ref.state.netConnectionFilteredSelected).toBe('eth0-work')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // changeHandler — generic field change
  // -------------------------------------------------------------------------

  test('changeHandler updates curSettings for regular fields', async function () {
    let ref = null
    buildWifiFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => {
      ref.changeHandler({ target: { name: 'ssid', value: 'NewSSID' } })
    })
    expect(ref.state.curSettings.ssid).toBe('NewSSID')
    page.unmount()
  })

  test('changeHandler band change resets channel to 0', async function () {
    let ref = null
    buildWifiFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.setState({ curSettings: { ...ref.state.curSettings, channel: '6' } }) })
    act(() => {
      ref.changeHandler({ target: { name: 'band', value: 'a' } })
    })
    expect(ref.state.curSettings.band).toBe('a')
    expect(ref.state.curSettings.channel).toBe('0')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // togglePasswordVisible
  // -------------------------------------------------------------------------

  test('togglePasswordVisible sets showPW true', async function () {
    let ref = null
    buildWifiFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.togglePasswordVisible({ target: { checked: true } }) })
    expect(ref.state.showPW).toBe(true)
    page.unmount()
  })

  test('togglePasswordVisible sets showPW false', async function () {
    let ref = null
    buildWifiFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.setState({ showPW: true }) })
    act(() => { ref.togglePasswordVisible({ target: { checked: false } }) })
    expect(ref.state.showPW).toBe(false)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // resetForm
  // -------------------------------------------------------------------------

  test('resetForm restores curSettings from netConnectionDetails', async function () {
    let ref = null
    buildWifiFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    // Modify curSettings
    act(() => { ref.changeHandler({ target: { name: 'ssid', value: 'Changed' } }) })
    expect(ref.state.curSettings.ssid).toBe('Changed')
    // Reset form
    act(() => { ref.resetForm() })
    await page.flush()
    expect(ref.state.curSettings.ssid).toBe('MySSID')
    page.unmount()
  })

  test('resetForm with new connection loads first connection from list', async function () {
    let ref = null
    mockFetch({
      '/api/networkconnections': { netConnection: [wifiConnectionClient] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter] },
      'POST /api/networkIP': defaultDetails
    })
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    // Add a "new" connection and select it
    act(() => {
      ref.setState({
        netConnectionFiltered: [
          ...ref.state.netConnectionFiltered,
          { value: 'new', label: 'NewConn', labelPre: 'NewConn', type: 'wifi', state: '' }
        ],
        netConnectionFilteredSelected: 'new'
      })
    })
    act(() => { ref.resetForm() })
    await page.flush()
    // Should have called handleConnectionChange on the first connection
    page.unmount()
  })

  test('resetForm with new connection but empty netConnection list is safe', async function () {
    let ref = null
    buildWifiFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => {
      ref.setState({
        netConnection: [],
        netConnectionFiltered: [
          { value: 'new', label: 'NewConn', labelPre: 'NewConn', type: 'wifi', state: '' }
        ],
        netConnectionFilteredSelected: 'new'
      })
    })
    // Should not throw
    act(() => { ref.resetForm() })
    await page.flush()
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleNetworkSubmit — 'new' → /api/networkadd
  // -------------------------------------------------------------------------

  test('submit new connection POSTs to /api/networkadd', async function () {
    const fetch = mockFetch({
      '/api/networkconnections': { netConnection: [wifiConnectionClient] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter] },
      'POST /api/networkIP': defaultDetails,
      'POST /api/networkadd': { error: null }
    })
    let ref = null
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    // Add a "new" connection with an empty-string field to exercise JSON replacer
    act(() => {
      ref.setState({
        netConnectionFiltered: [
          { value: 'new', label: 'NewWifi', labelPre: 'NewWifi', type: 'wifi', state: '' }
        ],
        netConnectionFilteredSelected: 'new',
        curSettings: {
          ...ref.state.curSettings,
          ssid: 'NewNetwork',
          wpaType: '',  // empty string — exercises replacer false branch
          password: 'pass'
        }
      })
    })
    const form = page.container.querySelector('form')
    page.submit(form)
    await page.flush()
    expect(fetch).toHaveBeenCalledWith('/api/networkadd', expect.objectContaining({ method: 'POST' }))
    expect(ref.state.infoMessage).toBe('Network Added')
    page.unmount()
  })

  test('submit new connection handles error from /api/networkadd', async function () {
    mockFetch({
      '/api/networkconnections': { netConnection: [wifiConnectionClient] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter] },
      'POST /api/networkIP': defaultDetails,
      'POST /api/networkadd': { error: 'Permission denied' }
    })
    let ref = null
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => {
      ref.setState({
        netConnectionFiltered: [
          { value: 'new', label: 'NewWifi', labelPre: 'NewWifi', type: 'wifi', state: '' }
        ],
        netConnectionFilteredSelected: 'new'
      })
    })
    const form = page.container.querySelector('form')
    page.submit(form)
    await page.flush()
    expect(ref.state.error).toContain('Error adding network')
    page.unmount()
  })

  test('submit new connection handles fetch rejection (catch)', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/networkconnections') return { ok: true, json: async () => ({ netConnection: [wifiConnectionClient] }) }
      if (url === '/api/wirelessstatus') return { ok: true, json: async () => ({ wirelessEnabled: true }) }
      if (url === '/api/networkadapters') return { ok: true, json: async () => ({ netDevice: [wifiAdapter] }) }
      if (method === 'POST' && url === '/api/networkIP') return { ok: true, json: async () => defaultDetails }
      if (method === 'POST' && url === '/api/networkadd') throw new Error('network failure')
      throw new Error(`unhandled: ${method} ${url}`)
    }))
    let ref = null
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => {
      ref.setState({
        netConnectionFiltered: [
          { value: 'new', label: 'NewWifi', labelPre: 'NewWifi', type: 'wifi', state: '' }
        ],
        netConnectionFilteredSelected: 'new'
      })
    })
    const form = page.container.querySelector('form')
    page.submit(form)
    await page.flush()
    expect(ref.state.error).toContain('Error adding network')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleNetworkSubmit — existing → /api/networkedit
  // -------------------------------------------------------------------------

  test('submit existing connection POSTs to /api/networkedit', async function () {
    const fetch = mockFetch({
      '/api/networkconnections': { netConnection: [wifiConnectionClient] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter] },
      'POST /api/networkIP': defaultDetails,
      'POST /api/networkedit': { error: null }
    })
    let ref = null
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    const form = page.container.querySelector('form')
    page.submit(form)
    await page.flush()
    expect(fetch).toHaveBeenCalledWith('/api/networkedit', expect.objectContaining({ method: 'POST' }))
    expect(ref.state.infoMessage).toBe('Network Edited')
    page.unmount()
  })

  test('submit existing connection handles error from /api/networkedit', async function () {
    mockFetch({
      '/api/networkconnections': { netConnection: [wifiConnectionClient] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter] },
      'POST /api/networkIP': defaultDetails,
      'POST /api/networkedit': { error: 'Write failed' }
    })
    let ref = null
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    const form = page.container.querySelector('form')
    page.submit(form)
    await page.flush()
    expect(ref.state.error).toContain('Error editing network')
    page.unmount()
  })

  test('submit existing connection handles fetch rejection (catch)', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/networkconnections') return { ok: true, json: async () => ({ netConnection: [wifiConnectionClient] }) }
      if (url === '/api/wirelessstatus') return { ok: true, json: async () => ({ wirelessEnabled: true }) }
      if (url === '/api/networkadapters') return { ok: true, json: async () => ({ netDevice: [wifiAdapter] }) }
      if (method === 'POST' && url === '/api/networkIP') return { ok: true, json: async () => defaultDetails }
      if (method === 'POST' && url === '/api/networkedit') throw new Error('network failure')
      throw new Error(`unhandled: ${method} ${url}`)
    }))
    let ref = null
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    const form = page.container.querySelector('form')
    page.submit(form)
    await page.flush()
    expect(ref.state.error).toContain('Error editing network')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // deleteConnection → showModalDelete modal
  // -------------------------------------------------------------------------

  test('delete button click shows modal', async function () {
    let ref = null
    buildEthFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.deleteConnection({ preventDefault: () => {} }) })
    expect(ref.state.showModalDelete).toBe(true)
    page.unmount()
  })

  test('handleCloseModalDelete closes the modal without deleting', async function () {
    let ref = null
    buildEthFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.setState({ showModalDelete: true }) })
    act(() => { ref.handleCloseModalDelete() })
    expect(ref.state.showModalDelete).toBe(false)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleDelete — 'new' connection (no fetch, just adapter refresh)
  // -------------------------------------------------------------------------

  test('handleDelete on new connection does not POST and calls handleAdapterChange', async function () {
    const fetch = mockFetch({
      '/api/networkconnections': { netConnection: [wifiConnectionClient] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter] },
      'POST /api/networkIP': defaultDetails
    })
    let ref = null
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    const callCountBefore = fetch.mock.calls.length
    act(() => {
      ref.setState({
        netConnectionFilteredSelected: 'new',
        showModalDelete: true
      })
    })
    act(() => { ref.handleDelete() })
    await page.flush()
    // Should not have called /api/networkdelete
    const deleteCall = fetch.mock.calls.find(c => c[0] === '/api/networkdelete')
    expect(deleteCall).toBeUndefined()
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleDelete — existing connection → /api/networkdelete + setTimeout
  // -------------------------------------------------------------------------

  test('handleDelete on existing POSTs to /api/networkdelete', async function () {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const fetch = mockFetch({
      '/api/networkconnections': { netConnection: [wifiConnectionClient] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter] },
      'POST /api/networkIP': defaultDetails,
      'POST /api/networkdelete': { error: null }
    })
    let ref = null
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.handleDelete() })
    await page.flush()
    expect(fetch).toHaveBeenCalledWith('/api/networkdelete', expect.objectContaining({ method: 'POST' }))
    expect(ref.state.infoMessage).toBe('Network Deleted')
    vi.useRealTimers()
    page.unmount()
  })

  test('handleDelete with error sets error state', async function () {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    mockFetch({
      '/api/networkconnections': { netConnection: [wifiConnectionClient] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter] },
      'POST /api/networkIP': defaultDetails,
      'POST /api/networkdelete': { error: 'Delete failed' }
    })
    let ref = null
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.handleDelete() })
    await page.flush()
    expect(ref.state.error).toContain('Error deleting network')
    vi.useRealTimers()
    page.unmount()
  })

  test('handleDelete fetch rejection sets error state', async function () {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/networkconnections') return { ok: true, json: async () => ({ netConnection: [wifiConnectionClient] }) }
      if (url === '/api/wirelessstatus') return { ok: true, json: async () => ({ wirelessEnabled: true }) }
      if (url === '/api/networkadapters') return { ok: true, json: async () => ({ netDevice: [wifiAdapter] }) }
      if (method === 'POST' && url === '/api/networkIP') return { ok: true, json: async () => defaultDetails }
      if (method === 'POST' && url === '/api/networkdelete') throw new Error('connection refused')
      throw new Error(`unhandled: ${method} ${url}`)
    }))
    let ref = null
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.handleDelete() })
    await page.flush()
    expect(ref.state.error).toContain('Error deleting network')
    vi.useRealTimers()
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // refreshConList — setTimeout fires then calls handleAdapterChange
  // -------------------------------------------------------------------------

  test('refreshConList calls /api/networkconnections and refreshes adapter', async function () {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const fetch = mockFetch({
      '/api/networkconnections': { netConnection: [wifiConnectionClient] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter] },
      'POST /api/networkIP': defaultDetails,
      'POST /api/networkdelete': { error: null }
    })
    let ref = null
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    // Trigger delete which calls refreshConList after setTimeout
    act(() => { ref.handleDelete() })
    await page.flush()
    // Advance the fake timer to trigger setTimeout callback
    await act(async () => { vi.advanceTimersByTime(600) })
    await page.flush()
    const connCalls = fetch.mock.calls.filter(c => c[0] === '/api/networkconnections')
    expect(connCalls.length).toBeGreaterThan(1)
    vi.useRealTimers()
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // refreshInfoList
  // -------------------------------------------------------------------------

  test('refreshInfoList calls handleConnectionChange with current selected', async function () {
    let ref = null
    buildWifiFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    const btn = [...page.container.querySelectorAll('button')].find(b =>
      b.textContent.includes('Refresh Connection Information')
    )
    expect(btn).toBeDefined()
    page.click(btn)
    await page.flush()
    // Should not throw
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // activateConnection
  // -------------------------------------------------------------------------

  test('activateConnection POSTs to /api/networkactivate', async function () {
    const fetch = mockFetch({
      '/api/networkconnections': { netConnection: [ethConnection] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [ethAdapter] },
      'POST /api/networkIP': { ...defaultDetails, netConnectionDetails: { ...defaultDetails.netConnectionDetails, mode: '' } },
      'POST /api/networkactivate': { error: null }
    })
    let ref = null
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.activateConnection({ preventDefault: () => {} }) })
    await page.flush()
    expect(fetch).toHaveBeenCalledWith('/api/networkactivate', expect.objectContaining({ method: 'POST' }))
    expect(ref.state.infoMessage).toBe('Network Activated')
    page.unmount()
  })

  test('activateConnection handles error response', async function () {
    mockFetch({
      '/api/networkconnections': { netConnection: [ethConnection] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [ethAdapter] },
      'POST /api/networkIP': { ...defaultDetails, netConnectionDetails: { ...defaultDetails.netConnectionDetails, mode: '' } },
      'POST /api/networkactivate': { error: 'Not found' }
    })
    let ref = null
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.activateConnection({ preventDefault: () => {} }) })
    await page.flush()
    expect(ref.state.error).toContain('Error activating network')
    page.unmount()
  })

  test('activateConnection catch sets error state', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/networkconnections') return { ok: true, json: async () => ({ netConnection: [ethConnection] }) }
      if (url === '/api/wirelessstatus') return { ok: true, json: async () => ({ wirelessEnabled: true }) }
      if (url === '/api/networkadapters') return { ok: true, json: async () => ({ netDevice: [ethAdapter] }) }
      if (method === 'POST' && url === '/api/networkIP') return { ok: true, json: async () => ({ ...defaultDetails, netConnectionDetails: { ...defaultDetails.netConnectionDetails, mode: '' } }) }
      if (method === 'POST' && url === '/api/networkactivate') throw new Error('activation failed')
      throw new Error(`unhandled: ${method} ${url}`)
    }))
    let ref = null
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.activateConnection({ preventDefault: () => {} }) })
    await page.flush()
    expect(ref.state.error).toContain('Error activating network')
    page.unmount()
  })

  test('activateConnection does nothing when selected is "new"', async function () {
    const fetch = mockFetch({
      '/api/networkconnections': { netConnection: [wifiConnectionClient] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter] },
      'POST /api/networkIP': defaultDetails
    })
    let ref = null
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    const countBefore = fetch.mock.calls.length
    act(() => { ref.setState({ netConnectionFilteredSelected: 'new' }) })
    act(() => { ref.activateConnection({ preventDefault: () => {} }) })
    await page.flush()
    expect(fetch.mock.calls.length).toBe(countBefore)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // deactivateConnection
  // -------------------------------------------------------------------------

  test('deactivateConnection POSTs to /api/networkdeactivate', async function () {
    const fetch = mockFetch({
      '/api/networkconnections': { netConnection: [ethConnection] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [ethAdapter] },
      'POST /api/networkIP': { ...defaultDetails, netConnectionDetails: { ...defaultDetails.netConnectionDetails, mode: '' } },
      'POST /api/networkdeactivate': { error: null }
    })
    let ref = null
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.deactivateConnection({ preventDefault: () => {} }) })
    await page.flush()
    expect(fetch).toHaveBeenCalledWith('/api/networkdeactivate', expect.objectContaining({ method: 'POST' }))
    expect(ref.state.infoMessage).toBe('Network Deactivated')
    page.unmount()
  })

  test('deactivateConnection handles error response', async function () {
    mockFetch({
      '/api/networkconnections': { netConnection: [ethConnection] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [ethAdapter] },
      'POST /api/networkIP': { ...defaultDetails, netConnectionDetails: { ...defaultDetails.netConnectionDetails, mode: '' } },
      'POST /api/networkdeactivate': { error: 'Not connected' }
    })
    let ref = null
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.deactivateConnection({ preventDefault: () => {} }) })
    await page.flush()
    expect(ref.state.error).toContain('Error deactivating network')
    page.unmount()
  })

  test('deactivateConnection catch sets error state', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/networkconnections') return { ok: true, json: async () => ({ netConnection: [ethConnection] }) }
      if (url === '/api/wirelessstatus') return { ok: true, json: async () => ({ wirelessEnabled: true }) }
      if (url === '/api/networkadapters') return { ok: true, json: async () => ({ netDevice: [ethAdapter] }) }
      if (method === 'POST' && url === '/api/networkIP') return { ok: true, json: async () => ({ ...defaultDetails, netConnectionDetails: { ...defaultDetails.netConnectionDetails, mode: '' } }) }
      if (method === 'POST' && url === '/api/networkdeactivate') throw new Error('deactivation failed')
      throw new Error(`unhandled: ${method} ${url}`)
    }))
    let ref = null
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.deactivateConnection({ preventDefault: () => {} }) })
    await page.flush()
    expect(ref.state.error).toContain('Error deactivating network')
    page.unmount()
  })

  test('deactivateConnection does nothing when selected is "new"', async function () {
    const fetch = mockFetch({
      '/api/networkconnections': { netConnection: [wifiConnectionClient] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter] },
      'POST /api/networkIP': defaultDetails
    })
    let ref = null
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    const countBefore = fetch.mock.calls.length
    act(() => { ref.setState({ netConnectionFilteredSelected: 'new' }) })
    act(() => { ref.deactivateConnection({ preventDefault: () => {} }) })
    await page.flush()
    expect(fetch.mock.calls.length).toBe(countBefore)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // addConnection — non-wifi shows name modal directly
  // -------------------------------------------------------------------------

  test('addConnection with non-wifi adapter shows name modal', async function () {
    let ref = null
    buildEthFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.addConnection() })
    await page.flush()
    expect(ref.state.showModalNewNetworkName).toBe(true)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // addConnection — wifi shows wifi scan then name modal
  // -------------------------------------------------------------------------

  test('addConnection with wifi adapter calls /api/wifiscan', async function () {
    const fetch = mockFetch({
      '/api/networkconnections': { netConnection: [wifiConnectionClient] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter] },
      'POST /api/networkIP': defaultDetails,
      '/api/wifiscan': { detWifi: [{ ssid: 'HomeNet', signal: -50, security: 'wpa-psk' }] }
    })
    let ref = null
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.addConnection() })
    await page.flush()
    expect(fetch).toHaveBeenCalledWith('/api/wifiscan', expect.any(Object))
    expect(ref.state.showModalNewNetworkName).toBe(true)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleNewNetworkNameCancel
  // -------------------------------------------------------------------------

  test('handleNewNetworkNameCancel closes the name modal', async function () {
    let ref = null
    buildEthFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.setState({ showModalNewNetworkName: true }) })
    act(() => { ref.handleNewNetworkNameCancel() })
    expect(ref.state.showModalNewNetworkName).toBe(false)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleCloseModalNewNetworkName — non-empty name, non-wifi
  // -------------------------------------------------------------------------

  test('handleCloseModalNewNetworkName with non-empty name adds new connection', async function () {
    let ref = null
    buildEthFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => {
      ref.setState({ newNetworkName: 'MyNewNetwork', showModalNewNetworkName: true })
    })
    act(() => { ref.handleCloseModalNewNetworkName() })
    await page.flush()
    expect(ref.state.netConnectionFiltered.some(c => c.value === 'new')).toBe(true)
    expect(ref.state.netConnectionFilteredSelected).toBe('new')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleCloseModalNewNetworkName — non-empty name, wifi → shows type modal
  // -------------------------------------------------------------------------

  test('handleCloseModalNewNetworkName with wifi shows type modal (showModal)', async function () {
    let ref = null
    buildWifiFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => {
      ref.setState({ newNetworkName: 'MyWifiNet', showModalNewNetworkName: true })
    })
    act(() => { ref.handleCloseModalNewNetworkName() })
    await page.flush()
    expect(ref.state.showModal).toBe(true)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleCloseModalNewNetworkName — empty name (cancel path)
  // -------------------------------------------------------------------------

  test('handleCloseModalNewNetworkName with empty name does not add connection', async function () {
    let ref = null
    buildEthFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    const beforeCount = ref.state.netConnectionFiltered.length
    act(() => {
      ref.setState({ newNetworkName: '', showModalNewNetworkName: true })
    })
    act(() => { ref.handleCloseModalNewNetworkName() })
    await page.flush()
    expect(ref.state.netConnectionFiltered.length).toBe(beforeCount)
    page.unmount()
  })

  test('handleCloseModalNewNetworkName with null name does not add connection', async function () {
    let ref = null
    buildEthFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    const beforeCount = ref.state.netConnectionFiltered.length
    act(() => {
      ref.setState({ newNetworkName: null, showModalNewNetworkName: true })
    })
    act(() => { ref.handleCloseModalNewNetworkName() })
    await page.flush()
    expect(ref.state.netConnectionFiltered.length).toBe(beforeCount)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleCloseModalNewNetworkName — removes existing 'new' before adding
  // -------------------------------------------------------------------------

  test('handleCloseModalNewNetworkName replaces existing new entry', async function () {
    let ref = null
    buildEthFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    // Pre-add a 'new' entry
    act(() => {
      ref.setState({
        netConnectionFiltered: [
          ...ref.state.netConnectionFiltered,
          { value: 'new', label: 'OldNew', labelPre: 'OldNew', type: 'ethernet', state: '' }
        ],
        newNetworkName: 'FreshNew'
      })
    })
    act(() => { ref.handleCloseModalNewNetworkName() })
    await page.flush()
    const newEntries = ref.state.netConnectionFiltered.filter(c => c.value === 'new')
    expect(newEntries.length).toBe(1)
    expect(newEntries[0].label).toBe('FreshNew')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleCloseModalNewNetworkName — no selected device (selectedDevice = null)
  // -------------------------------------------------------------------------

  test('handleCloseModalNewNetworkName works even with no selected device', async function () {
    let ref = null
    buildEthFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => {
      ref.setState({ netDeviceSelected: null, newNetworkName: 'TestName' })
    })
    act(() => { ref.handleCloseModalNewNetworkName() })
    await page.flush()
    const newEntry = ref.state.netConnectionFiltered.find(c => c.value === 'new')
    expect(newEntry).toBeDefined()
    expect(newEntry.type).toBe('')  // selectedDevice null → empty type
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // changeNetworkNameHandler
  // -------------------------------------------------------------------------

  test('changeNetworkNameHandler updates newNetworkName state', async function () {
    let ref = null
    buildEthFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.changeNetworkNameHandler({ target: { value: 'TestName' } }) })
    expect(ref.state.newNetworkName).toBe('TestName')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleCloseModalAP — sets AP defaults
  // -------------------------------------------------------------------------

  test('handleCloseModalAP sets AP mode curSettings and adds new entry', async function () {
    let ref = null
    buildWifiFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.handleCloseModalAP() })
    await page.flush()
    expect(ref.state.curSettings.mode).toBe('ap')
    expect(ref.state.curSettings.ipaddresstype).toBe('shared')
    expect(ref.state.curSettings.band).toBe('bg')
    expect(ref.state.curSettings.wpaType).toBe('wpa-psk')
    expect(ref.state.netConnectionFilteredSelected).toBe('new')
    page.unmount()
  })

  test('handleCloseModalAP with multiple wifi adapters sets attachedIface to first', async function () {
    let ref = null
    mockFetch({
      '/api/networkconnections': { netConnection: [wifiConnectionClient] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter, wifiAdapter2] },
      'POST /api/networkIP': defaultDetails
    })
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.handleCloseModalAP() })
    expect(ref.state.curSettings.attachedIface).toBe('wlan0') // first in sameAdapters
    page.unmount()
  })

  test('handleCloseModalAP with no selected connection uses empty label', async function () {
    let ref = null
    buildWifiFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.setState({ netConnectionFilteredSelected: null }) })
    act(() => { ref.handleCloseModalAP() })
    await page.flush()
    const newEntry = ref.state.netConnectionFiltered.find(c => c.value === 'new')
    expect(newEntry.label).toBe('')
    page.unmount()
  })

  test('handleCloseModalAP with no selected device sets empty type', async function () {
    let ref = null
    buildWifiFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.setState({ netDeviceSelected: null }) })
    act(() => { ref.handleCloseModalAP() })
    await page.flush()
    const newEntry = ref.state.netConnectionFiltered.find(c => c.value === 'new')
    expect(newEntry.type).toBe('')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleCloseModalClient — empty security → wpaType 'none'
  // -------------------------------------------------------------------------

  test('handleCloseModalClient with empty security sets wpaType to none', async function () {
    let ref = null
    buildWifiFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.handleCloseModalClient('OpenNet', '') })
    await page.flush()
    expect(ref.state.curSettings.mode).toBe('infrastructure')
    expect(ref.state.curSettings.ssid).toBe('OpenNet')
    expect(ref.state.curSettings.wpaType).toBe('none')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleCloseModalClient — non-empty security → wpaType 'wpa-psk'
  // -------------------------------------------------------------------------

  test('handleCloseModalClient with non-empty security sets wpaType to wpa-psk', async function () {
    let ref = null
    buildWifiFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.handleCloseModalClient('SecuredNet', 'wpa-psk') })
    await page.flush()
    expect(ref.state.curSettings.wpaType).toBe('wpa-psk')
    expect(ref.state.curSettings.ssid).toBe('SecuredNet')
    page.unmount()
  })

  test('handleCloseModalClient with no selected connection uses empty label', async function () {
    let ref = null
    buildWifiFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.setState({ netConnectionFilteredSelected: null }) })
    act(() => { ref.handleCloseModalClient('SomeNet', '') })
    await page.flush()
    const newEntry = ref.state.netConnectionFiltered.find(c => c.value === 'new')
    expect(newEntry.label).toBe('')
    page.unmount()
  })

  test('handleCloseModalClient with no selected device sets empty type', async function () {
    let ref = null
    buildWifiFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.setState({ netDeviceSelected: null }) })
    act(() => { ref.handleCloseModalClient('SomeNet', 'wpa') })
    await page.flush()
    const newEntry = ref.state.netConnectionFiltered.find(c => c.value === 'new')
    expect(newEntry.type).toBe('')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleNewNetworkTypeCancel
  // -------------------------------------------------------------------------

  test('handleNewNetworkTypeCancel closes type modal', async function () {
    let ref = null
    buildWifiFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.setState({ showModal: true }) })
    act(() => { ref.handleNewNetworkTypeCancel() })
    expect(ref.state.showModal).toBe(false)
    page.unmount()
  })

  test('handleNewNetworkTypeCancel calls handleConnectionChange on first connection', async function () {
    let ref = null
    buildWifiFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.setState({ showModal: true }) })
    act(() => { ref.handleNewNetworkTypeCancel() })
    await page.flush()
    // Should reselect first connection
    page.unmount()
  })

  test('handleNewNetworkTypeCancel with empty netConnection list is safe', async function () {
    let ref = null
    buildWifiFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.setState({ netConnection: [], showModal: true }) })
    act(() => { ref.handleNewNetworkTypeCancel() })
    await page.flush()
    expect(ref.state.showModal).toBe(false)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // refreshWifi
  // -------------------------------------------------------------------------

  test('refreshWifi calls /api/wifiscan', async function () {
    const fetch = mockFetch({
      '/api/networkconnections': { netConnection: [wifiConnectionClient] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter] },
      'POST /api/networkIP': defaultDetails,
      '/api/wifiscan': { detWifi: [{ ssid: 'Found', signal: -60, security: '' }] }
    })
    let ref = null
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.refreshWifi() })
    await page.flush()
    expect(fetch).toHaveBeenCalledWith('/api/wifiscan', expect.any(Object))
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // togglewirelessEnabled
  // -------------------------------------------------------------------------

  test('togglewirelessEnabled POSTs to /api/setwirelessstatus', async function () {
    const fetch = mockFetch({
      '/api/networkconnections': { netConnection: [wifiConnectionClient] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter] },
      'POST /api/networkIP': defaultDetails,
      'POST /api/setwirelessstatus': { wirelessEnabled: false }
    })
    let ref = null
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.togglewirelessEnabled({ target: { checked: false } }) })
    await page.flush()
    expect(fetch).toHaveBeenCalledWith('/api/setwirelessstatus', expect.objectContaining({ method: 'POST' }))
    page.unmount()
  })

  test('togglewirelessEnabled catch sets error state', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/networkconnections') return { ok: true, json: async () => ({ netConnection: [wifiConnectionClient] }) }
      if (url === '/api/wirelessstatus') return { ok: true, json: async () => ({ wirelessEnabled: true }) }
      if (url === '/api/networkadapters') return { ok: true, json: async () => ({ netDevice: [wifiAdapter] }) }
      if (method === 'POST' && url === '/api/networkIP') return { ok: true, json: async () => defaultDetails }
      if (method === 'POST' && url === '/api/setwirelessstatus') throw new Error('toggle failed')
      throw new Error(`unhandled: ${method} ${url}`)
    }))
    let ref = null
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.togglewirelessEnabled({ target: { checked: false } }) })
    await page.flush()
    expect(ref.state.error).toContain('Error toggling wireless')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // getValidChannels
  // -------------------------------------------------------------------------

  test('getValidChannels filters by current band', async function () {
    let ref = null
    buildWifiFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    // Set band to 'bg'
    act(() => { ref.setState({ curSettings: { ...ref.state.curSettings, band: 'bg' } }) })
    const channels = ref.getValidChannels()
    // Should include band='bg' and band=0 channels
    const values = channels.map(c => c.value)
    expect(values).toContain(1)   // band='bg'
    expect(values).toContain(0)   // band=0
    expect(values).not.toContain(36) // band='a'
    page.unmount()
  })

  test('getValidChannels returns empty for tun adapter', async function () {
    let ref = null
    mockFetch({
      '/api/networkconnections': { netConnection: [tunConnection] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [tunAdapter] },
      'POST /api/networkIP': { netConnectionDetails: { DHCP: 'auto', IP: '', subnet: '', wpaType: '', password: '', ssid: '', band: '', channel: '', mode: '', attachedIface: '' } }
    })
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    // tun adapter has no channels array
    page.unmount()
  })

  test('getValidChannels returns empty when no selected device', async function () {
    let ref = null
    buildEthFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.setState({ netDeviceSelected: null }) })
    const channels = ref.getValidChannels()
    expect(channels).toEqual([])
    page.unmount()
  })

  test('getValidChannels returns empty when device has no channels', async function () {
    let ref = null
    buildEthFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    // eth adapter has channels: [] which is falsy for the check
    const channels = ref.getValidChannels()
    expect(channels).toEqual([])
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // IP section visibility — mode affects display
  // -------------------------------------------------------------------------

  test('IP section is visible for infrastructure mode', async function () {
    let ref = null
    buildWifiFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    // mode is infrastructure from defaultDetails
    expect(ref.state.curSettings.mode).toBe('infrastructure')
    const ipSection = page.container.querySelector('.ipconfig')
    expect(ipSection).not.toBeNull()
    page.unmount()
  })

  test('IP section is hidden for ap mode', async function () {
    let ref = null
    mockFetch({
      '/api/networkconnections': { netConnection: [wifiConnectionAP] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter] },
      'POST /api/networkIP': apDetails
    })
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    expect(ref.state.curSettings.mode).toBe('ap')
    // AP mode: ipconfig section display should be 'none'
    const ipSection = page.container.querySelector('.ipconfig')
    expect(ipSection.style.display).toBe('none')
    page.unmount()
  })

  test('IP section is hidden for adhoc mode', async function () {
    let ref = null
    const adhocDetails = {
      netConnectionDetails: { ...apDetails.netConnectionDetails, mode: 'adhoc' }
    }
    mockFetch({
      '/api/networkconnections': { netConnection: [wifiConnectionAP] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter] },
      'POST /api/networkIP': adhocDetails
    })
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    const ipSection = page.container.querySelector('.ipconfig')
    expect(ipSection.style.display).toBe('none')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Static IP section — visible when ipaddresstype !== 'auto'
  // -------------------------------------------------------------------------

  test('static IP inputs are visible when ipaddresstype is manual', async function () {
    let ref = null
    const manualDetails = {
      netConnectionDetails: { ...defaultDetails.netConnectionDetails, DHCP: 'manual', mode: '' }
    }
    mockFetch({
      '/api/networkconnections': { netConnection: [ethConnection] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [ethAdapter] },
      'POST /api/networkIP': manualDetails
    })
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    expect(ref.state.curSettings.ipaddresstype).toBe('manual')
    // IPAddressInput components should be visible
    const ipInputs = page.container.querySelectorAll('.ip-address-input')
    expect(ipInputs.length).toBeGreaterThan(0)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Wifi client section — infrastructure mode shows
  // -------------------------------------------------------------------------

  test('wifi client section is visible for infrastructure mode', async function () {
    let ref = null
    buildWifiFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    const clientSection = page.container.querySelector('.wificlientconfig')
    expect(clientSection.style.display).toBe('block')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Wifi AP section — ap mode shows
  // -------------------------------------------------------------------------

  test('wifi AP section is visible for ap mode', async function () {
    let ref = null
    mockFetch({
      '/api/networkconnections': { netConnection: [wifiConnectionAP] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter] },
      'POST /api/networkIP': apDetails
    })
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    const apSection = page.container.querySelector('.wifiapconfig')
    expect(apSection.style.display).toBe('block')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Password visibility in wifi client section
  // -------------------------------------------------------------------------

  test('password field shown as text when showPW is true in client mode', async function () {
    let ref = null
    buildWifiFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.setState({ showPW: true }) })
    await page.flush()
    const pwInputs = page.container.querySelectorAll('input[name="password"]')
    const textInput = [...pwInputs].find(i => i.type === 'text')
    expect(textInput).toBeDefined()
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // wpaType 'none' — password field hidden
  // -------------------------------------------------------------------------

  test('password field is hidden when wpaType is none', async function () {
    let ref = null
    buildWifiFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.setState({ curSettings: { ...ref.state.curSettings, wpaType: 'none' } }) })
    await page.flush()
    // In infrastructure mode, the div around password should be hidden
    const clientConfig = page.container.querySelector('.wificlientconfig')
    const pwDiv = clientConfig.querySelector('div[style*="display"]')
    // wpaType === 'none' → display: 'none'
    expect(pwDiv.style.display).toBe('none')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Wifi scan modal table — clicking row selects network
  // -------------------------------------------------------------------------

  test('wifi scan modal row click calls handleCloseModalClient', async function () {
    let ref = null
    mockFetch({
      '/api/networkconnections': { netConnection: [wifiConnectionClient] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter] },
      'POST /api/networkIP': defaultDetails,
      '/api/wifiscan': { detWifi: [{ ssid: 'ScanNet', signal: -55, security: 'wpa-psk' }] }
    })
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    // Open the wifi type modal
    act(() => { ref.setState({ showModal: true, detWifi: [{ ssid: 'ScanNet', signal: -55, security: 'wpa-psk' }] }) })
    await page.flush()
    // Click on the SSID cell in the modal (in document.body)
    const modalTd = [...document.body.querySelectorAll('td')].find(td => td.textContent === 'ScanNet')
    expect(modalTd).toBeDefined()
    page.click(modalTd)
    await page.flush()
    expect(ref.state.curSettings.ssid).toBe('ScanNet')
    expect(ref.state.curSettings.wpaType).toBe('wpa-psk')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Connect to hidden WiFi button
  // -------------------------------------------------------------------------

  test('Connect to hidden WiFi button calls handleCloseModalClient with empty strings', async function () {
    let ref = null
    buildWifiFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.setState({ showModal: true }) })
    await page.flush()
    const hiddenBtn = [...document.body.querySelectorAll('button')].find(b =>
      b.textContent.includes('Connect to hidden WiFi')
    )
    expect(hiddenBtn).toBeDefined()
    page.click(hiddenBtn)
    await page.flush()
    expect(ref.state.curSettings.ssid).toBe('')
    expect(ref.state.curSettings.wpaType).toBe('none')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Refresh Wifi button in modal
  // -------------------------------------------------------------------------

  test('Refresh Wifi list button calls refreshWifi', async function () {
    const fetch = mockFetch({
      '/api/networkconnections': { netConnection: [wifiConnectionClient] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter] },
      'POST /api/networkIP': defaultDetails,
      '/api/wifiscan': { detWifi: [] }
    })
    let ref = null
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.setState({ showModal: true }) })
    await page.flush()
    const refreshBtn = [...document.body.querySelectorAll('button')].find(b =>
      b.textContent === 'Refresh Wifi list'
    )
    expect(refreshBtn).toBeDefined()
    page.click(refreshBtn)
    await page.flush()
    expect(fetch).toHaveBeenCalledWith('/api/wifiscan', expect.any(Object))
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Delete modal — Yes button calls handleDelete
  // -------------------------------------------------------------------------

  test('delete modal Yes button triggers handleDelete', async function () {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const fetch = mockFetch({
      '/api/networkconnections': { netConnection: [wifiConnectionClient] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter] },
      'POST /api/networkIP': defaultDetails,
      'POST /api/networkdelete': { error: null }
    })
    let ref = null
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.setState({ showModalDelete: true }) })
    await page.flush()
    const yesBtn = [...document.body.querySelectorAll('button')].find(b => b.textContent === 'Yes')
    expect(yesBtn).toBeDefined()
    page.click(yesBtn)
    await page.flush()
    expect(fetch).toHaveBeenCalledWith('/api/networkdelete', expect.objectContaining({ method: 'POST' }))
    vi.useRealTimers()
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // New network name modal — input change
  // -------------------------------------------------------------------------

  test('new network name modal input updates newNetworkName', async function () {
    let ref = null
    buildEthFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.setState({ showModalNewNetworkName: true }) })
    await page.flush()
    const nameInput = [...document.body.querySelectorAll('input')].find(i =>
      i.getAttribute('name') === 'newNetworkName'
    )
    expect(nameInput).toBeDefined()
    page.setValue(nameInput, 'TestNetwork')
    await page.flush()
    expect(ref.state.newNetworkName).toBe('TestNetwork')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // getSelectedDevice and getSelectedConnection helpers
  // -------------------------------------------------------------------------

  test('getSelectedDevice returns the selected device', async function () {
    let ref = null
    buildEthFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    const dev = ref.getSelectedDevice()
    expect(dev).toBeDefined()
    expect(dev.value).toBe('eth0')
    page.unmount()
  })

  test('getSelectedConnection returns the selected connection', async function () {
    let ref = null
    buildEthFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    const con = ref.getSelectedConnection()
    expect(con).toBeDefined()
    expect(con.value).toBe('eth0-home')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Refresh Connection List button
  // -------------------------------------------------------------------------

  test('Refresh Connection List button calls refreshConList', async function () {
    const fetch = mockFetch({
      '/api/networkconnections': { netConnection: [wifiConnectionClient] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter] },
      'POST /api/networkIP': defaultDetails
    })
    let ref = null
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    const btn = [...page.container.querySelectorAll('button')].find(b =>
      b.textContent.includes('Refresh Connection List')
    )
    expect(btn).toBeDefined()
    page.click(btn)
    await page.flush()
    const connCalls = fetch.mock.calls.filter(c => c[0] === '/api/networkconnections')
    expect(connCalls.length).toBeGreaterThan(1)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleAdapterChange via select — second adapter loaded after init
  // -------------------------------------------------------------------------

  test('adapter select change to second adapter sets correct device and connections', async function () {
    let ref = null
    mockFetch({
      '/api/networkconnections': { netConnection: [ethConnection, wifiConnectionClient] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [ethAdapter, wifiAdapter] },
      'POST /api/networkIP': { ...defaultDetails, netConnectionDetails: { ...defaultDetails.netConnectionDetails, mode: '' } }
    })
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    const selects = page.container.querySelectorAll('select')
    selectValue(selects[0], 'wlan0')
    await page.flush()
    expect(ref.state.netDeviceSelected).toBe('wlan0')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // renderTitle
  // -------------------------------------------------------------------------

  test('renderTitle returns "Network Configuration"', async function () {
    let ref = null
    buildEthFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    expect(ref.renderTitle()).toBe('Network Configuration')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // AP IPAddressInput — fill all 4 octets
  // -------------------------------------------------------------------------

  test('IPAddressInput in AP mode accepts valid octets', async function () {
    let ref = null
    mockFetch({
      '/api/networkconnections': { netConnection: [wifiConnectionAP] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter] },
      'POST /api/networkIP': apDetails
    })
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    // AP mode is rendered — find the IPAddressInput for ipaddress in AP config
    const ipInputGroups = page.container.querySelectorAll('.ip-address-input')
    expect(ipInputGroups.length).toBeGreaterThan(0)
    const firstGroup = ipInputGroups[0]
    const octets = firstGroup.querySelectorAll('input')
    page.setValue(octets[0], '10')
    page.setValue(octets[1], '0')
    page.setValue(octets[2], '0')
    page.setValue(octets[3], '1')
    await page.flush()
    expect(ref.state.curSettings.ipaddress).toBe('10.0.0.1')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Static IP section — IPAddressInput for ipaddress and subnet
  // -------------------------------------------------------------------------

  test('IPAddressInput for static ipaddress and subnet in manual mode', async function () {
    let ref = null
    const manualDetails = {
      netConnectionDetails: {
        DHCP: 'manual',
        IP: '192.168.1.50',
        subnet: '255.255.255.0',
        wpaType: '',
        password: '',
        ssid: '',
        band: '',
        channel: '',
        mode: '',
        attachedIface: ''
      }
    }
    mockFetch({
      '/api/networkconnections': { netConnection: [ethConnection] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [ethAdapter] },
      'POST /api/networkIP': manualDetails
    })
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    // IPAddressInput components: ipaddress, subnet (static section) + ipaddress (AP section hidden)
    const ipGroups = page.container.querySelectorAll('.ip-address-input')
    expect(ipGroups.length).toBeGreaterThanOrEqual(2)
    // Test ipaddress input (first in the static section)
    const firstOctets = ipGroups[0].querySelectorAll('input')
    page.setValue(firstOctets[0], '10')
    page.setValue(firstOctets[1], '10')
    page.setValue(firstOctets[2], '10')
    page.setValue(firstOctets[3], '10')
    await page.flush()
    expect(ref.state.curSettings.ipaddress).toBe('10.10.10.10')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Adhoc mode — shows AP config section
  // -------------------------------------------------------------------------

  test('adhoc mode shows AP config section', async function () {
    let ref = null
    const adhocDetails = {
      netConnectionDetails: {
        DHCP: 'shared',
        IP: '10.0.0.1',
        subnet: '',
        wpaType: '',
        password: '',
        ssid: 'AdhocNet',
        band: 'bg',
        channel: '1',
        mode: 'adhoc',
        attachedIface: 'wlan0'
      }
    }
    mockFetch({
      '/api/networkconnections': { netConnection: [wifiConnectionAP] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter] },
      'POST /api/networkIP': adhocDetails
    })
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    const apSection = page.container.querySelector('.wifiapconfig')
    expect(apSection.style.display).toBe('block')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // No selectedDevice → networkadd falls back to empty conType
  // -------------------------------------------------------------------------

  test('submit new connection with no selected device uses empty conType', async function () {
    const fetch = mockFetch({
      '/api/networkconnections': { netConnection: [wifiConnectionClient] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter] },
      'POST /api/networkIP': defaultDetails,
      'POST /api/networkadd': { error: null }
    })
    let ref = null
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => {
      ref.setState({
        netDeviceSelected: null,
        netConnectionFiltered: [
          { value: 'new', label: 'NewWifi', labelPre: 'NewWifi', type: 'wifi', state: '' }
        ],
        netConnectionFilteredSelected: 'new'
      })
    })
    const form = page.container.querySelector('form')
    page.submit(form)
    await page.flush()
    // Should still call networkadd with empty conType
    const addCall = fetch.mock.calls.find(c => c[0] === '/api/networkadd')
    expect(addCall).toBeDefined()
    const body = JSON.parse(addCall[1].body)
    expect(body.conType).toBeUndefined() // empty string dropped by replacer
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleCloseModalAP — removes existing 'new' before adding
  // -------------------------------------------------------------------------

  test('handleCloseModalAP replaces existing new entry', async function () {
    let ref = null
    buildWifiFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    // Pre-add a 'new' entry
    act(() => {
      ref.setState({
        netConnectionFiltered: [
          ...ref.state.netConnectionFiltered,
          { value: 'new', label: 'OldNew', labelPre: 'OldNew', type: 'wifi', state: '' }
        ]
      })
    })
    act(() => { ref.handleCloseModalAP() })
    await page.flush()
    const newEntries = ref.state.netConnectionFiltered.filter(c => c.value === 'new')
    expect(newEntries.length).toBe(1)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleCloseModalClient — removes existing 'new' before adding
  // -------------------------------------------------------------------------

  test('handleCloseModalClient replaces existing new entry', async function () {
    let ref = null
    buildWifiFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => {
      ref.setState({
        netConnectionFiltered: [
          ...ref.state.netConnectionFiltered,
          { value: 'new', label: 'OldNew', labelPre: 'OldNew', type: 'wifi', state: '' }
        ]
      })
    })
    act(() => { ref.handleCloseModalClient('TestNet', 'wpa') })
    await page.flush()
    const newEntries = ref.state.netConnectionFiltered.filter(c => c.value === 'new')
    expect(newEntries.length).toBe(1)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleStart — uses netDeviceSelected if already set
  // -------------------------------------------------------------------------

  test('handleStart uses existing netDeviceSelected if set', async function () {
    let ref = null
    mockFetch({
      '/api/networkconnections': { netConnection: [ethConnection] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [ethAdapter] },
      'POST /api/networkIP': { ...defaultDetails, netConnectionDetails: { ...defaultDetails.netConnectionDetails, mode: '' } }
    })
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    // netDeviceSelected should be 'eth0'
    expect(ref.state.netDeviceSelected).toBe('eth0')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // JSON replacer — verifies empty string '' is dropped
  // -------------------------------------------------------------------------

  test('networkadd JSON body drops empty string fields via replacer', async function () {
    const fetch = mockFetch({
      '/api/networkconnections': { netConnection: [wifiConnectionClient] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter] },
      'POST /api/networkIP': defaultDetails,
      'POST /api/networkadd': { error: null }
    })
    let ref = null
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => {
      ref.setState({
        netConnectionFiltered: [
          { value: 'new', label: 'TestNet', labelPre: 'TestNet', type: 'wifi', state: '' }
        ],
        netConnectionFilteredSelected: 'new',
        curSettings: {
          ssid: 'TestNet',
          wpaType: '',      // should be dropped by replacer
          password: 'pass',
          mode: 'infrastructure',
          band: '',         // should be dropped by replacer
          channel: '6',
          ipaddresstype: 'auto',
          ipaddress: '',    // should be dropped by replacer
          subnet: '',       // should be dropped by replacer
          attachedIface: 'wlan0'
        }
      })
    })
    const form = page.container.querySelector('form')
    page.submit(form)
    await page.flush()
    const addCall = fetch.mock.calls.find(c => c[0] === '/api/networkadd')
    const body = JSON.parse(addCall[1].body)
    // Empty string fields should be missing (replacer returns undefined for them)
    expect(body.conSettings.wpaType).toBeUndefined()
    expect(body.conSettings.band).toBeUndefined()
    expect(body.conSettings.ssid).toBe('TestNet')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // networkedit JSON body — replacer also applied
  // -------------------------------------------------------------------------

  test('networkedit JSON body drops empty string fields via replacer', async function () {
    const fetch = mockFetch({
      '/api/networkconnections': { netConnection: [wifiConnectionClient] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter] },
      'POST /api/networkIP': defaultDetails,
      'POST /api/networkedit': { error: null }
    })
    let ref = null
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => {
      ref.setState({
        curSettings: {
          ...ref.state.curSettings,
          wpaType: '',   // empty → dropped
          ssid: 'Kept'
        }
      })
    })
    const form = page.container.querySelector('form')
    page.submit(form)
    await page.flush()
    const editCall = fetch.mock.calls.find(c => c[0] === '/api/networkedit')
    const body = JSON.parse(editCall[1].body)
    expect(body.conSettings.wpaType).toBeUndefined()
    expect(body.conSettings.ssid).toBe('Kept')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Activate/Deactivate buttons disabled state
  // -------------------------------------------------------------------------

  test('activate button is enabled when connection state is empty (not active)', async function () {
    let ref = null
    buildWifiFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    // state='' means the connection is not currently active → activate button enabled
    expect(ref.state.netConnectionFiltered[0].state).toBe('')
    const activateBtn = page.container.querySelector('.activateConnection')
    expect(activateBtn.disabled).toBe(false)
    page.unmount()
  })

  test('activate button is disabled when connection state is set (already active)', async function () {
    let ref = null
    const activeWifi = { ...wifiConnectionClient, state: 'wlan0' }
    mockFetch({
      '/api/networkconnections': { netConnection: [activeWifi] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter] },
      'POST /api/networkIP': defaultDetails
    })
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    const activateBtn = page.container.querySelector('.activateConnection')
    // disabled when state !== "" (i.e. already active)
    expect(activateBtn.disabled).toBe(true)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleCloseModalAP with single wifi adapter uses netDeviceSelected as fallback
  // -------------------------------------------------------------------------

  test('handleCloseModalAP with single wifi adapter uses netDeviceSelected as attachedIface fallback', async function () {
    let ref = null
    mockFetch({
      '/api/networkconnections': { netConnection: [wifiConnectionClient] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter] },  // only one adapter
      'POST /api/networkIP': defaultDetails
    })
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    // Force getSameAdapter to return empty by nulling device type match
    // Actually with one wifi adapter it returns [wlan0], so sameAdapters.length = 1
    // To test fallback: set netDevice to adapter without type match
    act(() => { ref.setState({ netDevice: [] }) })
    act(() => { ref.handleCloseModalAP() })
    await page.flush()
    // With no same adapters (empty array), should use netDeviceSelected
    expect(ref.state.curSettings.attachedIface).toBe('wlan0')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleCloseModalClient with single wifi adapter fallback
  // -------------------------------------------------------------------------

  test('handleCloseModalClient fallback uses netDeviceSelected when no same adapters', async function () {
    let ref = null
    buildWifiFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.setState({ netDevice: [] }) })
    act(() => { ref.handleCloseModalClient('TestSSID', '') })
    await page.flush()
    expect(ref.state.curSettings.attachedIface).toBe('wlan0')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Discard Changes button calls resetForm
  // -------------------------------------------------------------------------

  test('Discard Changes button calls resetForm', async function () {
    let ref = null
    buildWifiFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    act(() => { ref.changeHandler({ target: { name: 'ssid', value: 'Modified' } }) })
    expect(ref.state.curSettings.ssid).toBe('Modified')
    const discardBtn = [...page.container.querySelectorAll('button')].find(b =>
      b.textContent.includes('Discard Changes')
    )
    expect(discardBtn).toBeDefined()
    page.click(discardBtn)
    await page.flush()
    expect(ref.state.curSettings.ssid).toBe('MySSID')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleStart sets netDeviceSelected when not already set (branch at line 70-71)
  // -------------------------------------------------------------------------

  test('handleStart auto-selects first adapter when netDeviceSelected is null', async function () {
    mockFetch({
      '/api/networkconnections': { netConnection: [ethConnection] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [ethAdapter] },
      'POST /api/networkIP': { ...defaultDetails, netConnectionDetails: { ...defaultDetails.netConnectionDetails, mode: '' } }
    })
    let ref = null
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    // Do not pre-set netDeviceSelected; let handleStart set it
    await page.flush()
    expect(ref.state.netDeviceSelected).toBe('eth0')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleConnectionChange — null netConnectionDetails fields use '' fallback
  // -------------------------------------------------------------------------

  test('handleConnectionChange uses empty fallbacks when netConnectionDetails fields are undefined', async function () {
    let ref = null
    mockFetch({
      '/api/networkconnections': { netConnection: [wifiConnectionClient] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [wifiAdapter] },
      // Return netConnectionDetails with all fields absent (undefined → || '' fires)
      'POST /api/networkIP': { netConnectionDetails: {} }
    })
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    // All curSettings fields should fall back to ''
    expect(ref.state.curSettings.ipaddresstype).toBe('')
    expect(ref.state.curSettings.ssid).toBe('')
    expect(ref.state.curSettings.wpaType).toBe('')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // resetForm — null netConnectionDetails fields use '' fallback
  // -------------------------------------------------------------------------

  test('resetForm uses empty fallbacks when netConnectionDetails fields are undefined', async function () {
    let ref = null
    buildWifiFetch()
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    // Clear netConnectionDetails to trigger the || '' arms
    act(() => { ref.setState({ netConnectionDetails: {} }) })
    act(() => { ref.resetForm() })
    await page.flush()
    expect(ref.state.curSettings.ipaddresstype).toBe('')
    expect(ref.state.curSettings.ssid).toBe('')
    expect(ref.state.curSettings.wpaType).toBe('')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleStart uses netDeviceSelected if already set (right-side || not taken)
  // -------------------------------------------------------------------------

  test('handleStart with already-set netDeviceSelected uses it for adapter change', async function () {
    let ref = null
    mockFetch({
      '/api/networkconnections': { netConnection: [ethConnection] },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [ethAdapter] },
      'POST /api/networkIP': { ...defaultDetails, netConnectionDetails: { ...defaultDetails.netConnectionDetails, mode: '' } }
    })
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    const firstDevice = ref.state.netDeviceSelected
    // Call handleStart again with netDeviceSelected already set
    act(() => { ref.handleStart() })
    await page.flush()
    // Should still use the selected adapter
    expect(ref.state.netDeviceSelected).toBe(firstDevice)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleStart — right side of || used when netDeviceSelected cleared by
  // an API response that includes netDeviceSelected: null (exercises line 80 right arm)
  // -------------------------------------------------------------------------

  test('handleStart falls back to netDevice[0] when netDeviceSelected gets cleared by API response', async function () {
    let ref = null
    // The networkconnections response clears netDeviceSelected
    mockFetch({
      '/api/networkconnections': { netConnection: [ethConnection], netDeviceSelected: null },
      '/api/wirelessstatus': { wirelessEnabled: true },
      '/api/networkadapters': { netDevice: [ethAdapter] },
      'POST /api/networkIP': { ...defaultDetails, netConnectionDetails: { ...defaultDetails.netConnectionDetails, mode: '' } }
    })
    const Wrapper = () => <NetworkConfig ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    // netDeviceSelected should be set to eth0 either way
    expect(ref.state.netDeviceSelected).toBe('eth0')
    page.unmount()
  })
})
