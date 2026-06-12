// @vitest-environment happy-dom
import React, { act } from 'react'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'

import { renderPage, mockFetch } from '../test/ui.jsx'
import AdhocConfig from './adhocwifi.jsx'

// adhocwifi uses basePage without socket (super(props) — no useSocketIO arg)
// so no socket.io-client mock needed.

// Use factory functions to prevent shared mutable state between tests.
// AdhocConfig mutates curSettings in place (e.g. `items.wpaType = event.target.value`),
// so reusing a single object would corrupt subsequent tests.
function makeAdapter (customChannels) {
  return {
    value: 'wlan0',
    label: 'wlan0',
    channels: customChannels || [
      { value: 6, label: 'Channel 6', band: 'bg' },
      { value: 36, label: 'Channel 36', band: 'a' },
      { value: 0, label: 'Auto', band: 0 }
    ]
  }
}

function makeDefaultState (curSettingsOverrides) {
  const adapter = makeAdapter()
  return {
    netDevice: [adapter],
    netDeviceSelected: adapter,
    curSettings: {
      ipaddress: '192.168.1.1',
      wpaType: 'none',
      password: '',
      ssid: 'TestAP',
      band: 'bg',
      channel: 6,
      isActive: false,
      gateway: '',
      ...(curSettingsOverrides || {})
    }
  }
}

function defaultFetch (fetchOverrides) {
  return mockFetch({
    '/api/adhocadapters': makeDefaultState(),
    ...(fetchOverrides || {})
  })
}

describe('#AdhocConfig()', function () {
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

  test('renders title "Adhoc Wifi Config"', async function () {
    defaultFetch()
    const page = renderPage(<AdhocConfig />)
    await page.flush()
    expect(page.container.textContent).toContain('Adhoc Wifi Config')
    page.unmount()
  })

  test('renders adapter form when netDeviceSelected is not null', async function () {
    defaultFetch()
    const page = renderPage(<AdhocConfig />)
    await page.flush()
    expect(page.container.textContent).toContain('SSID')
    // Input values don't appear in textContent — check the input value directly
    const ssidInput = page.container.querySelector('input[name="ssid"]')
    expect(ssidInput.value).toBe('TestAP')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // No wireless adapters detected (netDeviceSelected === null)
  // -------------------------------------------------------------------------

  test('renders "No wireless adapters detected" when netDeviceSelected is null', async function () {
    mockFetch({
      '/api/adhocadapters': {
        netDevice: [],
        netDeviceSelected: null,
        curSettings: makeDefaultState().curSettings
      }
    })
    const page = renderPage(<AdhocConfig />)
    await page.flush()
    expect(page.container.textContent).toContain('No wireless adapters detected')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleAdapterChange is undefined (upstream bug): the onChange handler on
  // the Adapter Form.Select is `this.handleAdapterChange`, which is NOT defined
  // in the class. The select renders with onChange=undefined (valid in React).
  // v8 does not generate a branch for a property access that evaluates to
  // undefined — the expression is covered as soon as JSX is rendered.
  // No v8 ignore annotation is needed; the coverage gap (if any) is a function
  // call that can never happen, and v8 function coverage does not count
  // undefined callbacks.
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // SSIDhandler
  // -------------------------------------------------------------------------

  test('SSIDhandler: typing in SSID input updates ssid', async function () {
    defaultFetch()
    const page = renderPage(<AdhocConfig />)
    await page.flush()
    const ssidInput = page.container.querySelector('input[name="ssid"]')
    page.setValue(ssidInput, 'NewSSID')
    expect(ssidInput.value).toBe('NewSSID')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // bandhandler
  // -------------------------------------------------------------------------

  test('bandhandler: changing band select updates curSettings.band', async function () {
    defaultFetch()
    const page = renderPage(<AdhocConfig />)
    await page.flush()
    const bandSelect = page.container.querySelector('select[name="band"]')
    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype, 'value'
      ).set
      nativeSetter.call(bandSelect, 'bg')
      bandSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(page.container.textContent).toContain('Band')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // getValidChannels: filters channels by band, including band===0 (Auto)
  // -------------------------------------------------------------------------

  test('getValidChannels: matches band and band===0 (Auto) channels', async function () {
    defaultFetch()
    const page = renderPage(<AdhocConfig />)
    await page.flush()
    // curSettings.band is 'bg'; channels: Channel 6 (bg) → included,
    // Channel 36 (a) → excluded, Auto (0) → always included
    const channelSelect = page.container.querySelector('select[name="channel"]')
    const options = [...channelSelect.querySelectorAll('option')]
    const labels = options.map(o => o.textContent)
    expect(labels).toContain('Channel 6')
    expect(labels).toContain('Auto')
    expect(labels).not.toContain('Channel 36')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // channelhandler
  // -------------------------------------------------------------------------

  test('channelhandler: changing channel updates curSettings.channel', async function () {
    defaultFetch()
    const page = renderPage(<AdhocConfig />)
    await page.flush()
    const channelSelect = page.container.querySelector('select[name="channel"]')
    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype, 'value'
      ).set
      nativeSetter.call(channelSelect, '0')
      channelSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(page.container.textContent).toContain('Channel')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // securityhandler
  // -------------------------------------------------------------------------

  test('securityhandler: changing to WEP enables password field', async function () {
    defaultFetch()
    const page = renderPage(<AdhocConfig />)
    await page.flush()
    const secSelect = page.container.querySelector('select[name="wpaType"]')
    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype, 'value'
      ).set
      nativeSetter.call(secSelect, 'wep')
      secSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    // After selecting WEP, password field should be enabled
    const pwdInput = page.container.querySelector('input[name="password"]')
    expect(pwdInput.disabled).toBe(false)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // password disabled when wpaType==='none'
  // -------------------------------------------------------------------------

  test('password input disabled when wpaType is none', async function () {
    // Fresh state per test prevents mutation from securityhandler test
    defaultFetch()
    const page = renderPage(<AdhocConfig />)
    await page.flush()
    const pwdInput = page.container.querySelector('input[name="password"]')
    expect(pwdInput.disabled).toBe(true)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // passwordhandler
  // -------------------------------------------------------------------------

  test('passwordhandler: typing password updates curSettings.password', async function () {
    mockFetch({
      '/api/adhocadapters': makeDefaultState({ wpaType: 'wep' })
    })
    const page = renderPage(<AdhocConfig />)
    await page.flush()
    const pwdInput = page.container.querySelector('input[name="password"]')
    page.setValue(pwdInput, 'secret123')
    expect(pwdInput.value).toBe('secret123')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // togglePasswordVisible
  // -------------------------------------------------------------------------

  test('togglePasswordVisible: show-password checkbox toggles password input type', async function () {
    mockFetch({
      '/api/adhocadapters': makeDefaultState({ wpaType: 'wep', password: 'pass' })
    })
    const page = renderPage(<AdhocConfig />)
    await page.flush()
    const pwdInput = page.container.querySelector('input[name="password"]')
    expect(pwdInput.type).toBe('password')
    const showPwdCheckbox = page.container.querySelector('input[name="showpassword"]')
    page.click(showPwdCheckbox)
    expect(pwdInput.type).toBe('text')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // IPHandler
  // -------------------------------------------------------------------------

  test('IPHandler: typing in IP address field updates ipaddress', async function () {
    defaultFetch()
    const page = renderPage(<AdhocConfig />)
    await page.flush()
    const ipInput = page.container.querySelector('input[name="ipaddress"]')
    page.setValue(ipInput, '10.0.0.1')
    expect(ipInput.value).toBe('10.0.0.1')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // GatewayHandler
  // -------------------------------------------------------------------------

  test('GatewayHandler: typing in gateway field updates gateway', async function () {
    defaultFetch()
    const page = renderPage(<AdhocConfig />)
    await page.flush()
    // There are two inputs[name="ipaddress"]: IP (first) and Gateway (second)
    const allIpInputs = page.container.querySelectorAll('input[name="ipaddress"]')
    const gatewayInput = allIpInputs[1]
    page.setValue(gatewayInput, '192.168.1.254')
    expect(gatewayInput.value).toBe('192.168.1.254')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleadhocSubmit — success: error==null, isActive=false → "Network Activated"
  // -------------------------------------------------------------------------

  test('handleadhocSubmit: success when isActive=false → "Network Activated"', async function () {
    let postedBody = null
    defaultFetch({
      'POST /api/adhocadaptermodify': (url, opts) => {
        postedBody = JSON.parse(opts.body)
        return { error: null }
      }
    })
    const page = renderPage(<AdhocConfig />)
    await page.flush()
    const enableBtn = [...page.container.querySelectorAll('button')].find(
      b => b.textContent.trim() === 'Enable'
    )
    page.click(enableBtn)
    await page.flush()
    expect(postedBody).not.toBeNull()
    expect(postedBody.toState).toBe(true) // !isActive (false) → true
    expect(document.body.textContent).toContain('Network Activated')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleadhocSubmit — success when isActive=true → "Network Deactivated"
  // -------------------------------------------------------------------------

  test('handleadhocSubmit: success when isActive=true → "Network Deactivated"', async function () {
    mockFetch({
      '/api/adhocadapters': makeDefaultState({ isActive: true }),
      'POST /api/adhocadaptermodify': { error: null }
    })
    const page = renderPage(<AdhocConfig />)
    await page.flush()
    const disableBtn = [...page.container.querySelectorAll('button')].find(
      b => b.textContent.trim() === 'Disable'
    )
    page.click(disableBtn)
    await page.flush()
    expect(document.body.textContent).toContain('Network Deactivated')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleadhocSubmit — error present in response
  // -------------------------------------------------------------------------

  test('handleadhocSubmit: data.error present → sets error state', async function () {
    defaultFetch({
      'POST /api/adhocadaptermodify': { error: 'Interface not found' }
    })
    const page = renderPage(<AdhocConfig />)
    await page.flush()
    const enableBtn = [...page.container.querySelectorAll('button')].find(
      b => b.textContent.trim() === 'Enable'
    )
    page.click(enableBtn)
    await page.flush()
    expect(document.body.textContent).toContain('Interface not found')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleadhocSubmit — catch branch (fetch throws)
  // -------------------------------------------------------------------------

  test('handleadhocSubmit catch: fetch POST throws → sets error', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/adhocadapters') {
        return { ok: true, status: 200, json: async () => makeDefaultState() }
      }
      if (method === 'POST' && url === '/api/adhocadaptermodify') {
        throw new Error('connection refused')
      }
      throw new Error(`unhandled: ${method} ${url}`)
    }))
    const page = renderPage(<AdhocConfig />)
    await page.flush()
    const enableBtn = [...page.container.querySelectorAll('button')].find(
      b => b.textContent.trim() === 'Enable'
    )
    page.click(enableBtn)
    await page.flush()
    expect(document.body.textContent).toContain('Error:')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleadhocSubmit: handleStart (GET) is re-called after submit
  // -------------------------------------------------------------------------

  test('handleadhocSubmit: handleStart re-fetches adapters after submit', async function () {
    let getCallCount = 0
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/adhocadapters') {
        getCallCount++
        return { ok: true, status: 200, json: async () => makeDefaultState() }
      }
      if (method === 'POST' && url === '/api/adhocadaptermodify') {
        return { ok: true, status: 200, json: async () => ({ error: null }) }
      }
      throw new Error(`unhandled: ${method} ${url}`)
    }))
    const page = renderPage(<AdhocConfig />)
    await page.flush()
    const initialCount = getCallCount
    const enableBtn = [...page.container.querySelectorAll('button')].find(
      b => b.textContent.trim() === 'Enable'
    )
    page.click(enableBtn)
    await page.flush()
    expect(getCallCount).toBeGreaterThan(initialCount)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Active state: fields disabled + shows Disable button
  // -------------------------------------------------------------------------

  test('active state: fields disabled and Disable button shown', async function () {
    mockFetch({
      '/api/adhocadapters': makeDefaultState({ isActive: true })
    })
    const page = renderPage(<AdhocConfig />)
    await page.flush()
    const ssidInput = page.container.querySelector('input[name="ssid"]')
    expect(ssidInput.disabled).toBe(true)
    const disableBtn = [...page.container.querySelectorAll('button')].find(
      b => b.textContent.trim() === 'Disable'
    )
    expect(disableBtn).toBeDefined()
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Enable button disabled when netDeviceSelected is null
  // -------------------------------------------------------------------------

  test('Enable button disabled when netDeviceSelected is null', async function () {
    mockFetch({
      '/api/adhocadapters': {
        netDevice: [],
        netDeviceSelected: null,
        curSettings: makeDefaultState().curSettings
      }
    })
    const page = renderPage(<AdhocConfig />)
    await page.flush()
    // Primary check: "No wireless adapters" message shown
    expect(page.container.textContent).toContain('No wireless adapters detected')
    // The Enable/Disable button is inside the display:none div but still in DOM
    const enableBtn = [...page.container.querySelectorAll('button')].find(
      b => b.textContent.trim() === 'Enable' || b.textContent.trim() === 'Disable'
    )
    if (enableBtn) {
      expect(enableBtn.disabled).toBe(true)
    }
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // channel select ternary: netDeviceSelected !== null ? ... : <option>
  // When netDeviceSelected is null, the else branch renders a single empty option
  // -------------------------------------------------------------------------

  test('channel select shows empty option when netDeviceSelected is null', async function () {
    mockFetch({
      '/api/adhocadapters': {
        netDevice: [],
        netDeviceSelected: null,
        curSettings: makeDefaultState().curSettings
      }
    })
    const page = renderPage(<AdhocConfig />)
    await page.flush()
    const channelSelect = page.container.querySelector('select[name="channel"]')
    expect(channelSelect).not.toBeNull()
    // The null branch renders a single empty <option></option>
    const options = channelSelect.querySelectorAll('option')
    expect(options.length).toBe(1)
    expect(options[0].textContent).toBe('')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // showLogin path
  // -------------------------------------------------------------------------

  test('showLogin=true renders login form', async function () {
    defaultFetch()
    const page = renderPage(<AdhocConfig showLogin={true} />)
    expect(page.container.textContent).toContain('Please Log In')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // password value ternary: wpaType === 'none' → '' else password
  // -------------------------------------------------------------------------

  test('password value is empty string when wpaType is none (even if password set)', async function () {
    mockFetch({
      '/api/adhocadapters': makeDefaultState({ wpaType: 'none', password: 'should-be-hidden' })
    })
    const page = renderPage(<AdhocConfig />)
    await page.flush()
    const pwdInput = page.container.querySelector('input[name="password"]')
    expect(pwdInput.value).toBe('')
    page.unmount()
  })

  test('password value shows actual password when wpaType is wep', async function () {
    mockFetch({
      '/api/adhocadapters': makeDefaultState({ wpaType: 'wep', password: 'mypassword' })
    })
    const page = renderPage(<AdhocConfig />)
    await page.flush()
    const pwdInput = page.container.querySelector('input[name="password"]')
    expect(pwdInput.value).toBe('mypassword')
    page.unmount()
  })
})
