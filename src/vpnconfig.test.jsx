// @vitest-environment happy-dom
import React, { act } from 'react'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'

import { renderPage, mockFetch } from '../test/ui.jsx'
import VPNPage from './vpnconfig.jsx'

vi.mock('socket.io-client', () => import('../test/socketMock.js'))

// Default API responses
const defaultZerotier = {
  statusZerotier: { installed: true, status: true, text: [] },
  selVPNInstalled: true,
  selVPNActive: true
}

const defaultWireguard = {
  statusWireguard: { installed: false, status: false, text: [] }
}

const defaultFetch = {
  '/api/vpnzerotier': defaultZerotier,
  '/api/vpnwireguard': defaultWireguard
}

// Helper to change a <select> value and fire React's onChange
function selectValue (select, value) {
  act(() => {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype, 'value'
    ).set
    nativeSetter.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('#VPNPage()', function () {
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
  test('renders title "VPN"', async function () {
    mockFetch(defaultFetch)
    const page = renderPage(<VPNPage />)
    await page.flush()
    expect(page.container.textContent).toContain('VPN')
    page.unmount()
  })

  test('renders Zerotier/Wireguard options in select', async function () {
    mockFetch(defaultFetch)
    const page = renderPage(<VPNPage />)
    await page.flush()
    expect(page.container.textContent).toContain('Zerotier')
    expect(page.container.textContent).toContain('Wireguard')
    page.unmount()
  })

  test('shows Installed Yes when zerotier installed=true', async function () {
    mockFetch(defaultFetch)
    const page = renderPage(<VPNPage />)
    await page.flush()
    expect(page.container.textContent).toContain('Installed: Yes')
    page.unmount()
  })

  test('shows Active Yes when zerotier status=true', async function () {
    mockFetch(defaultFetch)
    const page = renderPage(<VPNPage />)
    await page.flush()
    expect(page.container.textContent).toContain('Active: Yes')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // vpnOptions null branch — renders empty <option>
  // -------------------------------------------------------------------------
  test('vpnOptions null renders empty option fallback', async function () {
    mockFetch(defaultFetch)
    let ref = null
    const Wrapper = () => <VPNPage ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()

    // Set vpnOptions to null so the ternary false branch is exercised
    act(() => { ref.setState({ vpnOptions: null }) })
    await page.flush()

    const select = page.container.querySelector('select')
    // Should render an empty <option> (no children with value)
    const options = [...select.querySelectorAll('option')]
    expect(options.length).toBe(1)
    expect(options[0].value).toBe('')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleVPNChange — 'zerotier' branch
  // -------------------------------------------------------------------------
  test('handleVPNChange zerotier branch updates selVPNInstalled/Active from statusZerotier', async function () {
    mockFetch(defaultFetch)
    let ref = null
    const Wrapper = () => <VPNPage ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()

    // Switch to wireguard first, then back to zerotier
    const select = page.container.querySelector('select')
    selectValue(select, 'wireguard')
    await page.flush()
    selectValue(select, 'zerotier')
    await page.flush()

    expect(ref.state.selectedVPN).toBe('zerotier')
    expect(ref.state.selVPNInstalled).toBe(ref.state.statusZerotier.installed)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleVPNChange — 'wireguard' branch
  // -------------------------------------------------------------------------
  test('handleVPNChange wireguard branch updates selVPNInstalled/Active from statusWireguard', async function () {
    mockFetch({
      '/api/vpnzerotier': defaultZerotier,
      '/api/vpnwireguard': { statusWireguard: { installed: true, status: true, text: [] } }
    })
    let ref = null
    const Wrapper = () => <VPNPage ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()

    const select = page.container.querySelector('select')
    selectValue(select, 'wireguard')
    await page.flush()

    expect(ref.state.selectedVPN).toBe('wireguard')
    expect(ref.state.selVPNInstalled).toBe(true)
    expect(ref.state.selVPNActive).toBe(true)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleVPNChange — unknown branch (else)
  // -------------------------------------------------------------------------
  test('handleVPNChange unknown value sets selVPNInstalled false', async function () {
    mockFetch(defaultFetch)
    let ref = null
    const Wrapper = () => <VPNPage ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()

    // Inject unknown value directly via ref
    act(() => {
      ref.handleVPNChange({ target: { value: 'unknown-vpn' } })
    })
    await page.flush()

    expect(ref.state.selectedVPN).toBe('unknown-vpn')
    expect(ref.state.selVPNInstalled).toBe(false)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Zerotier network table — add/delete buttons
  // -------------------------------------------------------------------------
  test('zerotier table renders networks from statusZerotier.text', async function () {
    mockFetch({
      '/api/vpnzerotier': {
        statusZerotier: {
          installed: true,
          status: true,
          text: [{ nwid: 'abc123', name: 'MyNet', assignedAddresses: '10.0.0.1', status: 'OK', type: 'PUBLIC' }]
        },
        selVPNInstalled: true,
        selVPNActive: true
      },
      '/api/vpnwireguard': defaultWireguard
    })
    const page = renderPage(<VPNPage />)
    await page.flush()
    expect(page.container.textContent).toContain('abc123')
    expect(page.container.textContent).toContain('MyNet')
    page.unmount()
  })

  test('removeZerotierNetwork POSTs to /api/vpnzerotierdel', async function () {
    const fetch = mockFetch({
      '/api/vpnzerotier': {
        statusZerotier: {
          installed: true, status: true,
          text: [{ nwid: 'net001', name: 'TestNet', assignedAddresses: '', status: 'OK', type: 'PUBLIC' }]
        },
        selVPNInstalled: true,
        selVPNActive: true
      },
      '/api/vpnwireguard': defaultWireguard,
      'POST /api/vpnzerotierdel': { statusZerotier: { installed: true, status: true, text: [] } }
    })
    const page = renderPage(<VPNPage />)
    await page.flush()

    const deleteBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Delete')
    expect(deleteBtn).toBeDefined()
    act(() => { deleteBtn.click() })
    await page.flush()

    expect(fetch).toHaveBeenCalledWith('/api/vpnzerotierdel', expect.objectContaining({ method: 'POST' }))
    page.unmount()
  })

  test('removeZerotierNetwork catch sets error state', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/vpnzerotier') return { ok: true, status: 200, json: async () => ({
        statusZerotier: { installed: true, status: true,
          text: [{ nwid: 'net001', name: 'TestNet', assignedAddresses: '', status: 'OK', type: 'PUBLIC' }]
        },
        selVPNInstalled: true, selVPNActive: true
      }) }
      if (url === '/api/vpnwireguard') return { ok: true, status: 200, json: async () => defaultWireguard }
      if (method === 'POST' && url === '/api/vpnzerotierdel') throw new Error('delete failed')
      throw new Error(`unhandled: ${method} ${url}`)
    }))

    let ref = null
    const Wrapper = () => <VPNPage ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()

    const deleteBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Delete')
    act(() => { deleteBtn.click() })
    await page.flush()

    expect(ref.state.error).toContain('Error removing network')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Add Zerotier network
  // -------------------------------------------------------------------------
  test('Add button disabled when newZerotierKey is empty', async function () {
    mockFetch(defaultFetch)
    const page = renderPage(<VPNPage />)
    await page.flush()

    const addBtn = page.container.querySelector('#addzt')
    expect(addBtn.disabled).toBe(true)
    page.unmount()
  })

  test('Add button disabled when VPN inactive', async function () {
    mockFetch({
      '/api/vpnzerotier': { statusZerotier: { installed: true, status: false, text: [] }, selVPNInstalled: true, selVPNActive: false },
      '/api/vpnwireguard': defaultWireguard
    })
    const page = renderPage(<VPNPage />)
    await page.flush()

    const keyInput = page.container.querySelector('input[name="ipaddress"]')
    page.setValue(keyInput, 'abc123')
    await page.flush()

    const addBtn = page.container.querySelector('#addzt')
    expect(addBtn.disabled).toBe(true)
    page.unmount()
  })

  test('handlenewZerotierKey updates state', async function () {
    mockFetch(defaultFetch)
    let ref = null
    const Wrapper = () => <VPNPage ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()

    const keyInput = page.container.querySelector('input[name="ipaddress"]')
    page.setValue(keyInput, 'mykey123')
    await page.flush()

    expect(ref.state.newZerotierKey).toBe('mykey123')
    page.unmount()
  })

  test('Add button enabled and POSTs to /api/vpnzerotieradd when key non-empty + active', async function () {
    const fetch = mockFetch({
      ...defaultFetch,
      'POST /api/vpnzerotieradd': { statusZerotier: { installed: true, status: true, text: [] } }
    })
    const page = renderPage(<VPNPage />)
    await page.flush()

    const keyInput = page.container.querySelector('input[name="ipaddress"]')
    page.setValue(keyInput, 'validkey')
    await page.flush()

    const addBtn = page.container.querySelector('#addzt')
    expect(addBtn.disabled).toBe(false)
    act(() => { addBtn.click() })
    await page.flush()

    expect(fetch).toHaveBeenCalledWith('/api/vpnzerotieradd', expect.objectContaining({ method: 'POST' }))
    page.unmount()
  })

  test('addZerotierNetwork catch sets error state', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/vpnzerotier') return { ok: true, status: 200, json: async () => defaultZerotier }
      if (url === '/api/vpnwireguard') return { ok: true, status: 200, json: async () => defaultWireguard }
      if (method === 'POST' && url === '/api/vpnzerotieradd') throw new Error('add failed')
      throw new Error(`unhandled: ${method} ${url}`)
    }))

    let ref = null
    const Wrapper = () => <VPNPage ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()

    const keyInput = page.container.querySelector('input[name="ipaddress"]')
    page.setValue(keyInput, 'validkey')
    await page.flush()

    const addBtn = page.container.querySelector('#addzt')
    act(() => { addBtn.click() })
    await page.flush()

    expect(ref.state.error).toContain('Error removing network')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Wireguard section
  // -------------------------------------------------------------------------
  test('wireguard section renders when selectedVPN=wireguard', async function () {
    mockFetch({
      '/api/vpnzerotier': defaultZerotier,
      '/api/vpnwireguard': {
        statusWireguard: {
          installed: true, status: true,
          text: [{ profile: 'wg0', peer: '10.0.0.2', server: '1.2.3.4', status: 'active', file: 'wg0.conf' }]
        }
      }
    })
    let ref = null
    const Wrapper = () => <VPNPage ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()

    const select = page.container.querySelector('select')
    selectValue(select, 'wireguard')
    await page.flush()

    expect(page.container.textContent).toContain('wg0')
    expect(page.container.textContent).toContain('1.2.3.4')
    page.unmount()
  })

  test('wireguard table: disabled item shows Activate button', async function () {
    mockFetch({
      '/api/vpnzerotier': defaultZerotier,
      '/api/vpnwireguard': {
        statusWireguard: {
          installed: true, status: true,
          text: [{ profile: 'wg0', peer: '10.0.0.2', server: '1.2.3.4', status: 'disabled', file: 'wg0.conf' }]
        }
      }
    })
    const page = renderPage(<VPNPage />)
    await page.flush()

    const select = page.container.querySelector('select')
    selectValue(select, 'wireguard')
    await page.flush()

    const activateBtns = [...page.container.querySelectorAll('button')].filter(b => b.textContent === 'Activate')
    expect(activateBtns.length).toBeGreaterThan(0)
    page.unmount()
  })

  test('wireguard table: active item shows Deactivate button', async function () {
    mockFetch({
      '/api/vpnzerotier': defaultZerotier,
      '/api/vpnwireguard': {
        statusWireguard: {
          installed: true, status: true,
          text: [{ profile: 'wg0', peer: '10.0.0.2', server: '1.2.3.4', status: 'active', file: 'wg0.conf' }]
        }
      }
    })
    const page = renderPage(<VPNPage />)
    await page.flush()

    const select = page.container.querySelector('select')
    selectValue(select, 'wireguard')
    await page.flush()

    const deactivateBtns = [...page.container.querySelectorAll('button')].filter(b => b.textContent === 'Deactivate')
    expect(deactivateBtns.length).toBeGreaterThan(0)
    page.unmount()
  })

  test('wireguard table: delete button disabled when status !== disabled', async function () {
    mockFetch({
      '/api/vpnzerotier': defaultZerotier,
      '/api/vpnwireguard': {
        statusWireguard: {
          installed: true, status: true,
          text: [{ profile: 'wg0', peer: '10.0.0.2', server: '1.2.3.4', status: 'active', file: 'wg0.conf' }]
        }
      }
    })
    const page = renderPage(<VPNPage />)
    await page.flush()

    const select = page.container.querySelector('select')
    selectValue(select, 'wireguard')
    await page.flush()

    const deleteBtns = [...page.container.querySelectorAll('button')].filter(b => b.textContent === 'Delete')
    // The delete button for non-disabled status should be disabled
    const disabledDelete = deleteBtns.find(b => b.disabled)
    expect(disabledDelete).toBeDefined()
    page.unmount()
  })

  test('activateWireguardNetwork POSTs to /api/vpnwireguardactivate', async function () {
    const fetch = mockFetch({
      '/api/vpnzerotier': defaultZerotier,
      '/api/vpnwireguard': {
        statusWireguard: {
          installed: true, status: true,
          text: [{ profile: 'wg0', peer: '10.0.0.2', server: '1.2.3.4', status: 'disabled', file: 'wg0.conf' }]
        }
      },
      'POST /api/vpnwireguardactivate': { statusWireguard: { installed: true, status: true, text: [] } }
    })
    const page = renderPage(<VPNPage />)
    await page.flush()

    const select = page.container.querySelector('select')
    selectValue(select, 'wireguard')
    await page.flush()

    const activateBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Activate')
    act(() => { activateBtn.click() })
    await page.flush()

    expect(fetch).toHaveBeenCalledWith('/api/vpnwireguardactivate', expect.objectContaining({ method: 'POST' }))
    page.unmount()
  })

  test('activateWireguardNetwork catch sets error state', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/vpnzerotier') return { ok: true, status: 200, json: async () => defaultZerotier }
      if (url === '/api/vpnwireguard') return { ok: true, status: 200, json: async () => ({
        statusWireguard: { installed: true, status: true,
          text: [{ profile: 'wg0', peer: '', server: '', status: 'disabled', file: 'wg0.conf' }]
        }
      }) }
      if (method === 'POST' && url === '/api/vpnwireguardactivate') throw new Error('activate failed')
      throw new Error(`unhandled: ${method} ${url}`)
    }))

    let ref = null
    const Wrapper = () => <VPNPage ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()

    const select = page.container.querySelector('select')
    selectValue(select, 'wireguard')
    await page.flush()

    const activateBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Activate')
    act(() => { activateBtn.click() })
    await page.flush()

    expect(ref.state.error).toContain('Error activating network')
    page.unmount()
  })

  test('deactivateWireguardNetwork POSTs to /api/vpnwireguarddeactivate', async function () {
    const fetch = mockFetch({
      '/api/vpnzerotier': defaultZerotier,
      '/api/vpnwireguard': {
        statusWireguard: {
          installed: true, status: true,
          text: [{ profile: 'wg0', peer: '10.0.0.2', server: '1.2.3.4', status: 'active', file: 'wg0.conf' }]
        }
      },
      'POST /api/vpnwireguarddeactivate': { statusWireguard: { installed: true, status: true, text: [] } }
    })
    const page = renderPage(<VPNPage />)
    await page.flush()

    const select = page.container.querySelector('select')
    selectValue(select, 'wireguard')
    await page.flush()

    const deactivateBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Deactivate')
    act(() => { deactivateBtn.click() })
    await page.flush()

    expect(fetch).toHaveBeenCalledWith('/api/vpnwireguarddeactivate', expect.objectContaining({ method: 'POST' }))
    page.unmount()
  })

  test('deactivateWireguardNetwork catch sets error state', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/vpnzerotier') return { ok: true, status: 200, json: async () => defaultZerotier }
      if (url === '/api/vpnwireguard') return { ok: true, status: 200, json: async () => ({
        statusWireguard: { installed: true, status: true,
          text: [{ profile: 'wg0', peer: '', server: '', status: 'active', file: 'wg0.conf' }]
        }
      }) }
      if (method === 'POST' && url === '/api/vpnwireguarddeactivate') throw new Error('deactivate failed')
      throw new Error(`unhandled: ${method} ${url}`)
    }))

    let ref = null
    const Wrapper = () => <VPNPage ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()

    const select = page.container.querySelector('select')
    selectValue(select, 'wireguard')
    await page.flush()

    const deactivateBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Deactivate')
    act(() => { deactivateBtn.click() })
    await page.flush()

    expect(ref.state.error).toContain('Error deactivating network')
    page.unmount()
  })

  test('deleteWireguardNetwork POSTs to /api/vpnwireguardelete', async function () {
    const fetch = mockFetch({
      '/api/vpnzerotier': defaultZerotier,
      '/api/vpnwireguard': {
        statusWireguard: {
          installed: true, status: true,
          text: [{ profile: 'wg0', peer: '10.0.0.2', server: '1.2.3.4', status: 'disabled', file: 'wg0.conf' }]
        }
      },
      'POST /api/vpnwireguardelete': { statusWireguard: { installed: true, status: true, text: [] } }
    })
    const page = renderPage(<VPNPage />)
    await page.flush()

    const select = page.container.querySelector('select')
    selectValue(select, 'wireguard')
    await page.flush()

    const deleteBtns = [...page.container.querySelectorAll('button')].filter(b => b.textContent === 'Delete')
    // Delete button enabled when status === 'disabled'
    const deleteBtn = deleteBtns.find(b => !b.disabled)
    expect(deleteBtn).toBeDefined()
    act(() => { deleteBtn.click() })
    await page.flush()

    expect(fetch).toHaveBeenCalledWith('/api/vpnwireguardelete', expect.objectContaining({ method: 'POST' }))
    page.unmount()
  })

  test('deleteWireguardNetwork catch sets error state', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/vpnzerotier') return { ok: true, status: 200, json: async () => defaultZerotier }
      if (url === '/api/vpnwireguard') return { ok: true, status: 200, json: async () => ({
        statusWireguard: { installed: true, status: true,
          text: [{ profile: 'wg0', peer: '', server: '', status: 'disabled', file: 'wg0.conf' }]
        }
      }) }
      if (method === 'POST' && url === '/api/vpnwireguardelete') throw new Error('delete failed')
      throw new Error(`unhandled: ${method} ${url}`)
    }))

    let ref = null
    const Wrapper = () => <VPNPage ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()

    const select = page.container.querySelector('select')
    selectValue(select, 'wireguard')
    await page.flush()

    const deleteBtns = [...page.container.querySelectorAll('button')].filter(b => b.textContent === 'Delete')
    const deleteBtn = deleteBtns.find(b => !b.disabled)
    act(() => { deleteBtn.click() })
    await page.flush()

    expect(ref.state.error).toContain('Error deleting network')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Wireguard file upload
  // -------------------------------------------------------------------------
  test('Upload button disabled when no file selected', async function () {
    mockFetch({
      '/api/vpnzerotier': defaultZerotier,
      '/api/vpnwireguard': { statusWireguard: { installed: true, status: true, text: [] } }
    })
    const page = renderPage(<VPNPage />)
    await page.flush()

    const select = page.container.querySelector('select')
    selectValue(select, 'wireguard')
    await page.flush()

    const uploadBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Upload')
    expect(uploadBtn).toBeDefined()
    expect(uploadBtn.disabled).toBe(true)
    page.unmount()
  })

  test('fileChangeHandler stores file in state', async function () {
    mockFetch({
      '/api/vpnzerotier': defaultZerotier,
      '/api/vpnwireguard': { statusWireguard: { installed: true, status: true, text: [] } }
    })
    let ref = null
    const Wrapper = () => <VPNPage ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()

    const select = page.container.querySelector('select')
    selectValue(select, 'wireguard')
    await page.flush()

    // Activate wireguard so file input is enabled
    act(() => { ref.setState({ selVPNActive: true }) })
    await page.flush()

    const fileInput = page.container.querySelector('input[type="file"]')
    const fakeFile = new File(['wg content'], 'wg0.conf', { type: 'text/plain' })
    Object.defineProperty(fileInput, 'files', { value: [fakeFile], configurable: true })
    act(() => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await page.flush()

    expect(ref.state.selectedWGFile).toBe(fakeFile)
    page.unmount()
  })

  test('handleSubmit uploads FormData to /api/vpnwireguardprofileadd', async function () {
    const fetch = mockFetch({
      '/api/vpnzerotier': defaultZerotier,
      '/api/vpnwireguard': { statusWireguard: { installed: true, status: true, text: [] } },
      'POST /api/vpnwireguardprofileadd': { statusWireguard: { installed: true, status: true, text: [] } }
    })

    let ref = null
    const Wrapper = () => <VPNPage ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()

    const select = page.container.querySelector('select')
    selectValue(select, 'wireguard')
    await page.flush()

    // Set a fake file via ref state and enable upload
    const fakeFile = new File(['wg content'], 'wg0.conf', { type: 'text/plain' })
    act(() => { ref.setState({ selectedWGFile: fakeFile, selVPNActive: true }) })
    await page.flush()

    const form = page.container.querySelector('form#uploadForm')
    page.submit(form)
    await page.flush()

    expect(fetch).toHaveBeenCalledWith('/api/vpnwireguardprofileadd', expect.objectContaining({
      method: 'POST',
      body: expect.any(FormData)
    }))
    page.unmount()
  })

  test('handleSubmit catch sets error state', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/vpnzerotier') return { ok: true, status: 200, json: async () => defaultZerotier }
      if (url === '/api/vpnwireguard') return { ok: true, status: 200, json: async () => ({ statusWireguard: { installed: true, status: true, text: [] } }) }
      if (method === 'POST' && url === '/api/vpnwireguardprofileadd') throw new Error('upload failed')
      throw new Error(`unhandled: ${method} ${url}`)
    }))

    let ref = null
    const Wrapper = () => <VPNPage ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()

    const fakeFile = new File(['wg content'], 'wg0.conf', { type: 'text/plain' })
    act(() => { ref.setState({ selectedVPN: 'wireguard', selectedWGFile: fakeFile, selVPNActive: true }) })
    await page.flush()

    const form = page.container.querySelector('form#uploadForm')
    page.submit(form)
    await page.flush()

    expect(ref.state.error).toContain('Error uploading profile')
    page.unmount()
  })
})
