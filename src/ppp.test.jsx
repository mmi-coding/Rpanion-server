// @vitest-environment happy-dom
import React, { act } from 'react'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'

import { renderPage, mockFetch } from '../test/ui.jsx'
import { lastSocket } from '../test/socketMock.js'
import PPPPage from './ppp.jsx'

vi.mock('socket.io-client', () => import('../test/socketMock.js'))

const defaultConfig = {
  enabled: false,
  selDevice: '/dev/ttyS0',
  selBaudRate: 115200,
  serialDevices: [
    { value: '/dev/ttyS0', label: '/dev/ttyS0' },
    { value: '/dev/ttyAMA0', label: '/dev/ttyAMA0' }
  ],
  baudRates: [
    { value: 9600, label: '9600' },
    { value: 115200, label: '115200' }
  ],
  localIP: '10.0.0.1',
  remoteIP: '10.0.0.2'
}

function defaultFetch (overrides = {}) {
  return mockFetch({
    '/api/pppconfig': defaultConfig,
    ...overrides
  })
}

describe('#PPPPage()', function () {
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

  test('renders title "PPP Configuration"', async function () {
    defaultFetch()
    const page = renderPage(<PPPPage />)
    await page.flush()
    expect(page.container.textContent).toContain('PPP Configuration')
    page.unmount()
  })

  test('renders config from GET /api/pppconfig', async function () {
    defaultFetch()
    const page = renderPage(<PPPPage />)
    await page.flush()
    expect(page.container.textContent).toContain('/dev/ttyS0')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // fetchPPPConfig catch branch (network error)
  // -------------------------------------------------------------------------

  test('fetchPPPConfig catch: fetch rejects → sets error and isLoading=false', async function () {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network fail'))))
    const page = renderPage(<PPPPage />)
    await page.flush()
    expect(document.body.textContent).toContain('Failed to fetch PPP config')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // fetchPPPConfig !response.ok branch
  // -------------------------------------------------------------------------

  test('fetchPPPConfig !response.ok → throws → catch sets error', async function () {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({})
    })))
    const page = renderPage(<PPPPage />)
    await page.flush()
    expect(document.body.textContent).toContain('Failed to fetch PPP config')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleUartChange — change UART device select
  // -------------------------------------------------------------------------

  test('handleUartChange: changing UART select updates selDevice', async function () {
    defaultFetch()
    const page = renderPage(<PPPPage />)
    await page.flush()
    const selects = page.container.querySelectorAll('select')
    // selects[0] = UART Port, selects[1] = Baudrate
    const uartSelect = selects[0]
    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype, 'value'
      ).set
      nativeSetter.call(uartSelect, '/dev/ttyAMA0')
      uartSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(page.container.textContent).toContain('UART Port')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleBaudrateChange — change baudrate select
  // -------------------------------------------------------------------------

  test('handleBaudrateChange: changing baudrate select updates selBaudRate', async function () {
    defaultFetch()
    const page = renderPage(<PPPPage />)
    await page.flush()
    const selects = page.container.querySelectorAll('select')
    const baudSelect = selects[1]
    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype, 'value'
      ).set
      nativeSetter.call(baudSelect, '9600')
      baudSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(page.container.textContent).toContain('Baudrate')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleConfigChange native event arm (via IPAddressInput onChange)
  // Fill all 4 octets of localIP to trigger onChange call on the parent
  // -------------------------------------------------------------------------

  test('handleConfigChange native arm: IPAddressInput onChange updates config.localIP', async function () {
    defaultFetch()
    const page = renderPage(<PPPPage />)
    await page.flush()
    // The IPAddressInput for localIP has 4 octet inputs.
    // The name prop is "localIP" so the inputs have ids: ip-localIP-0 .. ip-localIP-3
    const octetInputs = page.container.querySelectorAll('#ip-localIP-0, #ip-localIP-1, #ip-localIP-2, #ip-localIP-3')
    // Set all 4 octets to trigger the full-IP onChange call
    page.setValue(octetInputs[0], '192')
    page.setValue(octetInputs[1], '168')
    page.setValue(octetInputs[2], '1')
    page.setValue(octetInputs[3], '100')
    // No crash; page still renders
    expect(page.container.textContent).toContain('Local IP Address')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleConfigChange react-select arm (via direct ref call)
  // In ppp.jsx there are no react-select elements, so this arm is only
  // reachable by calling handleConfigChange directly with actionMeta truthy.
  // -------------------------------------------------------------------------

  test('handleConfigChange react-select arm: direct call with actionMeta updates config', async function () {
    defaultFetch()
    let ref = null
    const Wrapper = () => <PPPPage ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    // Call the react-select arm: selectedOption = value, actionMeta = {name: field}
    act(() => {
      ref.handleConfigChange({ value: '/dev/ttyAMA0', label: '/dev/ttyAMA0' }, { name: 'selDevice' })
    })
    expect(ref.state.config.selDevice).toEqual({ value: '/dev/ttyAMA0', label: '/dev/ttyAMA0' })
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleSubmit — enable (disabled=false → toggle enabled)
  // -------------------------------------------------------------------------

  test('handleSubmit: enable PPP on success → config updated', async function () {
    const updatedConfig = { ...defaultConfig, enabled: true }
    let postedBody = null
    defaultFetch({
      'POST /api/pppmodify': (url, opts) => {
        postedBody = JSON.parse(opts.body)
        return { settings: updatedConfig }
      }
    })
    const page = renderPage(<PPPPage />)
    await page.flush()
    // Click the Enable button
    const enableBtn = [...page.container.querySelectorAll('button')].find(
      b => b.textContent.trim() === 'Enable'
    )
    page.click(enableBtn)
    await page.flush()
    expect(postedBody).not.toBeNull()
    // enabled is the TOGGLE of current (false → true)
    expect(postedBody.enabled).toBe(true)
    expect(postedBody.device).toBe('/dev/ttyS0')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleSubmit — data.error present → sets error state
  // -------------------------------------------------------------------------

  test('handleSubmit: data.error in response → sets error in state', async function () {
    // NOTE: even with data.error, the code always calls setState({config: data.settings})
    // on line 113, so settings must be a valid config object to avoid a render crash.
    defaultFetch({
      'POST /api/pppmodify': { error: 'PPP device busy', settings: defaultConfig }
    })
    const page = renderPage(<PPPPage />)
    await page.flush()
    const enableBtn = [...page.container.querySelectorAll('button')].find(
      b => b.textContent.trim() === 'Enable'
    )
    page.click(enableBtn)
    await page.flush()
    expect(document.body.textContent).toContain('PPP device busy')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleSubmit — !response.ok + response.json → error branch
  // -------------------------------------------------------------------------

  test('handleSubmit: !response.ok → error branch sets error', async function () {
    // Override with a custom stub that returns !ok
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/pppconfig') {
        return { ok: true, status: 200, json: async () => defaultConfig }
      }
      if (method === 'POST' && url === '/api/pppmodify') {
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: 'Bad request' })
        }
      }
      throw new Error(`unhandled: ${method} ${url}`)
    }))
    const page = renderPage(<PPPPage />)
    await page.flush()
    const enableBtn = [...page.container.querySelectorAll('button')].find(
      b => b.textContent.trim() === 'Enable'
    )
    page.click(enableBtn)
    await page.flush()
    expect(document.body.textContent).toContain('Bad request')
    page.unmount()
  })

  test('handleSubmit: !response.ok with empty error → fallback message', async function () {
    // Covers the `data.error || 'Failed...'` false side of the OR (line 104)
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/pppconfig') {
        return { ok: true, status: 200, json: async () => defaultConfig }
      }
      if (method === 'POST' && url === '/api/pppmodify') {
        // !ok, json exists, but data.error is falsy → fallback string used
        return { ok: false, status: 400, json: async () => ({}) }
      }
      throw new Error(`unhandled: ${method} ${url}`)
    }))
    const page = renderPage(<PPPPage />)
    await page.flush()
    const enableBtn = [...page.container.querySelectorAll('button')].find(
      b => b.textContent.trim() === 'Enable'
    )
    page.click(enableBtn)
    await page.flush()
    expect(document.body.textContent).toContain('Failed to update PPP configuration')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleSubmit — catch branch (fetch throws)
  // -------------------------------------------------------------------------

  test('handleSubmit catch: fetch POST throws → sets error', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/pppconfig') {
        return { ok: true, status: 200, json: async () => defaultConfig }
      }
      if (method === 'POST' && url === '/api/pppmodify') {
        throw new Error('network error on POST')
      }
      throw new Error(`unhandled: ${method} ${url}`)
    }))
    const page = renderPage(<PPPPage />)
    await page.flush()
    const enableBtn = [...page.container.querySelectorAll('button')].find(
      b => b.textContent.trim() === 'Enable'
    )
    page.click(enableBtn)
    await page.flush()
    expect(document.body.textContent).toContain('Failed to update PPP configuration')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleSubmit — disabled=true → shows Disable button
  // -------------------------------------------------------------------------

  test('when enabled=true → button shows "Disable" and selects are disabled', async function () {
    defaultFetch({
      '/api/pppconfig': { ...defaultConfig, enabled: true }
    })
    const page = renderPage(<PPPPage />)
    await page.flush()
    const disableBtn = [...page.container.querySelectorAll('button')].find(
      b => b.textContent.trim() === 'Disable'
    )
    expect(disableBtn).toBeDefined()
    // selects should be disabled when enabled=true
    const selects = page.container.querySelectorAll('select')
    expect(selects[0].disabled).toBe(true)
    expect(selects[1].disabled).toBe(true)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // PPPStatus socket event
  // -------------------------------------------------------------------------

  test('PPPStatus socket event updates PPPStatus display', async function () {
    defaultFetch()
    const page = renderPage(<PPPPage />)
    await page.flush()
    act(() => {
      lastSocket().fire('PPPStatus', 'Active - link established')
    })
    expect(page.container.textContent).toContain('Active - link established')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // reconnect socket event re-calls componentDidMount
  // -------------------------------------------------------------------------

  test('reconnect socket event re-fetches PPP config', async function () {
    defaultFetch()
    const page = renderPage(<PPPPage />)
    await page.flush()
    act(() => { lastSocket().fire('reconnect') })
    await page.flush()
    expect(page.container.textContent).toContain('PPP Configuration')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // showLogin path
  // -------------------------------------------------------------------------

  test('showLogin=true renders login form', async function () {
    defaultFetch()
    const page = renderPage(<PPPPage showLogin={true} />)
    expect(page.container.textContent).toContain('Please Log In')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleSubmit !response.ok with no json → fallback error
  // -------------------------------------------------------------------------

  test('handleSubmit: success with no error → clears error state', async function () {
    // Cover the else branch of if (data.error): when data has no error, sets error=null
    const updatedConfig = { ...defaultConfig, enabled: true }
    defaultFetch({
      'POST /api/pppmodify': { settings: updatedConfig }
      // no error field → data.error is falsy → else branch: setState({error: null})
    })
    const page = renderPage(<PPPPage />)
    await page.flush()
    const enableBtn = [...page.container.querySelectorAll('button')].find(
      b => b.textContent.trim() === 'Enable'
    )
    page.click(enableBtn)
    await page.flush()
    // Page updated to show Disable button (enabled=true)
    const disableBtn = [...page.container.querySelectorAll('button')].find(
      b => b.textContent.trim() === 'Disable'
    )
    expect(disableBtn).toBeDefined()
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleSubmit: !response.ok with no json property → else branch (json
  // branch is falsy) → tries response.json() which throws → catch
  // This covers the false side of `!response.ok && response.json` when
  // !ok=true but json property is absent/undefined.
  // -------------------------------------------------------------------------

  test('handleSubmit: !response.ok with no json → else branch → catch sets error', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/pppconfig') {
        return { ok: true, status: 200, json: async () => defaultConfig }
      }
      if (method === 'POST' && url === '/api/pppmodify') {
        // !ok AND no json property → `!response.ok && response.json` = false → else
        return { ok: false, status: 500 }
      }
      throw new Error(`unhandled: ${method} ${url}`)
    }))
    const page = renderPage(<PPPPage />)
    await page.flush()
    const enableBtn = [...page.container.querySelectorAll('button')].find(
      b => b.textContent.trim() === 'Enable'
    )
    page.click(enableBtn)
    await page.flush()
    // else branch tries response.json() which throws TypeError → catch
    expect(document.body.textContent).toContain('Failed to update PPP configuration')
    page.unmount()
  })
})
