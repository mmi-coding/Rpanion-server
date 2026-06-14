// @vitest-environment happy-dom
import React, { act } from 'react'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'

import { renderPage, mockFetch } from '../test/ui.jsx'
import WireguardHubPage from './wireguardhub.jsx'

vi.mock('socket.io-client', () => import('../test/socketMock.js'))

const SCRIPT = '#!/usr/bin/env bash\nset -euo pipefail\nEndpoint = wg.example.com:51820\n'

function fillRequired (page) {
  page.setValue(page.container.querySelector('input[name="vpsIp"]'), '203.0.113.10')
  page.setValue(page.container.querySelector('input[name="domain"]'), 'wg.example.com')
}

describe('#WireguardHubPage()', function () {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear() })

  test('renders title + self-documenting Help, with Generate disabled until required fields set', async function () {
    const page = renderPage(<WireguardHubPage />)
    await page.flush()
    expect(page.container.textContent).toContain('WireGuard Hub')
    expect(page.container.querySelectorAll('[aria-label="help"]').length).toBeGreaterThan(0)
    expect(page.container.querySelector('a[role="button"][aria-expanded]')).not.toBeNull()
    // both required fields empty → disabled (covers the !vpsIp branch)
    expect(page.container.querySelector('#generatewg').disabled).toBe(true)
    page.unmount()
  })

  test('Generate stays disabled with only the VPS IP set (covers the !domain branch)', async function () {
    const page = renderPage(<WireguardHubPage />)
    await page.flush()
    page.setValue(page.container.querySelector('input[name="vpsIp"]'), '203.0.113.10')
    await page.flush()
    expect(page.container.querySelector('#generatewg').disabled).toBe(true)
    page.unmount()
  })

  test('Generate POSTs the config and shows the script', async function () {
    const fetch = mockFetch({ 'POST /api/wireguardhubscript': { script: SCRIPT } })
    const page = renderPage(<WireguardHubPage />)
    await page.flush()
    fillRequired(page)
    await page.flush()
    const btn = page.container.querySelector('#generatewg')
    expect(btn.disabled).toBe(false)
    act(() => { btn.click() })
    await page.flush()
    const call = fetch.mock.calls.find(c => c[0] === '/api/wireguardhubscript')
    const body = JSON.parse(call[1].body)
    expect(body.vpsIp).toBe('203.0.113.10')
    expect(body.domain).toBe('wg.example.com')
    expect(body.port).toBe('51820')
    expect(body.subnet).toBe('10.13.13.0/24')
    expect(body.sshPort).toBe('22')
    expect(page.container.querySelector('#scriptout').value).toContain('#!/usr/bin/env bash')
    page.unmount()
  })

  test('Copy writes the script to the clipboard', async function () {
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    mockFetch({ 'POST /api/wireguardhubscript': { script: SCRIPT } })
    const page = renderPage(<WireguardHubPage />)
    await page.flush()
    fillRequired(page)
    await page.flush()
    act(() => { page.container.querySelector('#generatewg').click() })
    await page.flush()
    act(() => { page.container.querySelector('#copywg').click() })
    await page.flush()
    expect(writeText).toHaveBeenCalledWith(SCRIPT)
    expect(document.body.textContent).toContain('copied to clipboard')
    page.unmount()
  })

  test('Download builds a blob and clicks an anchor', async function () {
    const createObjectURL = vi.fn(() => 'blob:fake')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    mockFetch({ 'POST /api/wireguardhubscript': { script: SCRIPT } })
    const page = renderPage(<WireguardHubPage />)
    await page.flush()
    fillRequired(page)
    await page.flush()
    act(() => { page.container.querySelector('#generatewg').click() })
    await page.flush()
    act(() => { page.container.querySelector('#downloadwg').click() })
    await page.flush()
    expect(createObjectURL).toHaveBeenCalled()
    expect(clickSpy).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake')
    page.unmount()
  })

  test('Generate catch path surfaces an error', async function () {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('boom'))))
    const page = renderPage(<WireguardHubPage />)
    await page.flush()
    fillRequired(page)
    await page.flush()
    act(() => { page.container.querySelector('#generatewg').click() })
    await page.flush()
    expect(document.body.textContent).toContain('Error generating script')
    page.unmount()
  })
})
