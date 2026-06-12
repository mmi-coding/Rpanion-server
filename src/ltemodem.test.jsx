// @vitest-environment happy-dom
import React, { act } from 'react'
import { describe, test, expect, vi, afterEach } from 'vitest'

import { renderPage, mockFetch } from '../test/ui.jsx'
import { lastSocket } from '../test/socketMock.js'
import LTEModemPage from './ltemodem.jsx'

vi.mock('socket.io-client', () => import('../test/socketMock.js'))

describe('#ltemodemp age()', function () {
    // Default fixtures
    const defaultConfig = {
        enabled: false,
        atPort: '/dev/ttyUSB2',
        baud: 115200,
        apn: '',
        netInterface: 'usb0',
        autoReconnect: false,
        pollInterval: 5
    }

    const defaultStatus = {
        enabled: false,
        available: false,
        error: '',
        signal: { raw: 99, dbm: null, percent: 0 },
        registration: 'Unknown',
        registered: false,
        operator: '',
        rat: '',
        band: '',
        ip: '',
        usage: { totalRx: 0, totalTx: 0, sessionRx: 0, sessionTx: 0 },
        lastReconnect: null,
        reconnectCount: 0,
        lastUpdate: null
    }

    const defaultFetch = {
        '/api/ltemodem': { settings: defaultConfig, status: defaultStatus, serialPorts: [] }
    }

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    // ------------------------------------------------------------------
    // Basic render
    // ------------------------------------------------------------------

    test('renders page title and status section', async function () {
        mockFetch(defaultFetch)
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        expect(page.container.textContent).toContain('LTE Modem')
        expect(page.container.textContent).toContain('Status')
        page.unmount()
    })

    test('shows help tips on form labels', async function () {
        mockFetch(defaultFetch)
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const tips = page.container.querySelectorAll('[aria-label="help"]')
        expect(tips.length).toBeGreaterThan(0)
        page.unmount()
    })

    // ------------------------------------------------------------------
    // fetchConfig branches
    // ------------------------------------------------------------------

    test('fetchConfig catch branch: fetch rejects', async function () {
        vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('net'))))
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        expect(document.body.textContent).toContain('Failed to fetch LTE modem config')
        page.unmount()
    })

    test('fetchConfig catch branch: !response.ok', async function () {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 500, json: async () => ({}) })))
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        expect(document.body.textContent).toContain('Failed to fetch LTE modem config')
        page.unmount()
    })

    test('fetchConfig populates serialPorts datalist', async function () {
        mockFetch({
            '/api/ltemodem': {
                settings: defaultConfig,
                status: defaultStatus,
                serialPorts: [{ path: '/dev/ttyUSB0', label: 'USB Serial 0' }]
            }
        })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const options = page.container.querySelectorAll('datalist option')
        expect(options.length).toBe(1)
        expect(options[0].value).toBe('/dev/ttyUSB0')
        page.unmount()
    })

    // ------------------------------------------------------------------
    // Status alert init states
    // ------------------------------------------------------------------

    test('shows disabled alert when status.enabled === false', async function () {
        mockFetch(defaultFetch)
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        expect(page.container.textContent).toContain('Modem monitoring is disabled')
        page.unmount()
    })

    test('shows danger alert when enabled but not available (no error message)', async function () {
        const status = { ...defaultStatus, enabled: true, available: false, error: '' }
        mockFetch({ '/api/ltemodem': { settings: defaultConfig, status, serialPorts: [] } })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        expect(page.container.textContent).toContain('Modem not responding')
        page.unmount()
    })

    test('shows danger alert with error text when enabled but not available (with error)', async function () {
        const status = { ...defaultStatus, enabled: true, available: false, error: 'port busy' }
        mockFetch({ '/api/ltemodem': { settings: defaultConfig, status, serialPorts: [] } })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        expect(page.container.textContent).toContain('Modem not responding: port busy')
        page.unmount()
    })

    test('no alerts shown when enabled and available', async function () {
        const status = { ...defaultStatus, enabled: true, available: true }
        mockFetch({ '/api/ltemodem': { settings: defaultConfig, status, serialPorts: [] } })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        expect(page.container.textContent).not.toContain('Modem monitoring is disabled')
        expect(page.container.textContent).not.toContain('Modem not responding')
        page.unmount()
    })

    // ------------------------------------------------------------------
    // formatBytes — all branches
    // ------------------------------------------------------------------

    test('formatBytes: bytes===0 shows "0 B"', async function () {
        const status = {
            ...defaultStatus,
            usage: { totalRx: 0, totalTx: 0, sessionRx: 0, sessionTx: 0 }
        }
        mockFetch({ '/api/ltemodem': { settings: defaultConfig, status, serialPorts: [] } })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        expect(page.container.textContent).toContain('0 B')
        page.unmount()
    })

    test('formatBytes: null bytes shows "-"', async function () {
        const status = {
            ...defaultStatus,
            usage: { totalRx: null, totalTx: null, sessionRx: null, sessionTx: null }
        }
        mockFetch({ '/api/ltemodem': { settings: defaultConfig, status, serialPorts: [] } })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        expect(page.container.textContent).toContain('-')
        page.unmount()
    })

    test('formatBytes: KB magnitude', async function () {
        const status = {
            ...defaultStatus,
            usage: { totalRx: 2048, totalTx: 1024, sessionRx: 512, sessionTx: 768 }
        }
        mockFetch({ '/api/ltemodem': { settings: defaultConfig, status, serialPorts: [] } })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        expect(page.container.textContent).toContain('KB')
        page.unmount()
    })

    test('formatBytes: MB magnitude', async function () {
        const status = {
            ...defaultStatus,
            usage: { totalRx: 5 * 1024 * 1024, totalTx: 3 * 1024 * 1024, sessionRx: 2 * 1024 * 1024, sessionTx: 1 * 1024 * 1024 }
        }
        mockFetch({ '/api/ltemodem': { settings: defaultConfig, status, serialPorts: [] } })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        expect(page.container.textContent).toContain('MB')
        page.unmount()
    })

    test('formatBytes: GB magnitude', async function () {
        const status = {
            ...defaultStatus,
            usage: { totalRx: 2 * 1024 * 1024 * 1024, totalTx: 1 * 1024 * 1024 * 1024, sessionRx: 0, sessionTx: 0 }
        }
        mockFetch({ '/api/ltemodem': { settings: defaultConfig, status, serialPorts: [] } })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        expect(page.container.textContent).toContain('GB')
        page.unmount()
    })

    // ------------------------------------------------------------------
    // signalLabel — all branches
    // ------------------------------------------------------------------

    test('signalLabel: dbm null shows Unknown in table', async function () {
        const status = {
            ...defaultStatus,
            signal: { raw: 99, dbm: null, percent: 0 }
        }
        mockFetch({ '/api/ltemodem': { settings: defaultConfig, status, serialPorts: [] } })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        expect(page.container.textContent).toContain('Unknown')
        page.unmount()
    })

    test('signalLabel: dbm undefined shows Unknown in table', async function () {
        const status = {
            ...defaultStatus,
            signal: { raw: 99, dbm: undefined, percent: 0 }
        }
        mockFetch({ '/api/ltemodem': { settings: defaultConfig, status, serialPorts: [] } })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        expect(page.container.textContent).toContain('Unknown')
        page.unmount()
    })

    test('signalLabel: dbm >= -73 shows Excellent', async function () {
        const status = {
            ...defaultStatus,
            signal: { raw: 20, dbm: -65, percent: 90 }
        }
        mockFetch({ '/api/ltemodem': { settings: defaultConfig, status, serialPorts: [] } })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        expect(page.container.textContent).toContain('Excellent')
        page.unmount()
    })

    test('signalLabel: dbm >= -85 shows Good', async function () {
        const status = {
            ...defaultStatus,
            signal: { raw: 15, dbm: -80, percent: 60 }
        }
        mockFetch({ '/api/ltemodem': { settings: defaultConfig, status, serialPorts: [] } })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        expect(page.container.textContent).toContain('Good')
        page.unmount()
    })

    test('signalLabel: dbm >= -97 shows Fair', async function () {
        const status = {
            ...defaultStatus,
            signal: { raw: 8, dbm: -90, percent: 40 }
        }
        mockFetch({ '/api/ltemodem': { settings: defaultConfig, status, serialPorts: [] } })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        expect(page.container.textContent).toContain('Fair')
        page.unmount()
    })

    test('signalLabel: dbm below -97 shows Poor', async function () {
        const status = {
            ...defaultStatus,
            signal: { raw: 2, dbm: -105, percent: 10 }
        }
        mockFetch({ '/api/ltemodem': { settings: defaultConfig, status, serialPorts: [] } })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        expect(page.container.textContent).toContain('Poor')
        page.unmount()
    })

    test('signal with rsrp defined shows extended RSRP/SINR row', async function () {
        const status = {
            ...defaultStatus,
            signal: { raw: 15, dbm: -80, percent: 60, rsrp: -90, sinr: 15 }
        }
        mockFetch({ '/api/ltemodem': { settings: defaultConfig, status, serialPorts: [] } })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        expect(page.container.textContent).toContain('RSRP -90 dBm')
        expect(page.container.textContent).toContain('SINR 15 dB')
        page.unmount()
    })

    test('signal without rsrp does not show RSRP/SINR row', async function () {
        const status = {
            ...defaultStatus,
            signal: { raw: 15, dbm: -80, percent: 60 }
        }
        mockFetch({ '/api/ltemodem': { settings: defaultConfig, status, serialPorts: [] } })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        expect(page.container.textContent).not.toContain('RSRP')
        page.unmount()
    })

    test('signal null reference is handled gracefully', async function () {
        const status = {
            ...defaultStatus,
            signal: null
        }
        mockFetch({ '/api/ltemodem': { settings: defaultConfig, status, serialPorts: [] } })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        expect(page.container.textContent).toContain('Unknown')
        page.unmount()
    })

    // ------------------------------------------------------------------
    // Status table detail rows
    // ------------------------------------------------------------------

    test('WAN IP row shows IP when status.ip is non-empty', async function () {
        const status = { ...defaultStatus, ip: '10.20.30.40' }
        mockFetch({ '/api/ltemodem': { settings: defaultConfig, status, serialPorts: [] } })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        expect(page.container.textContent).toContain('10.20.30.40')
        page.unmount()
    })

    test('WAN IP row shows "No data connection" when status.ip is empty', async function () {
        mockFetch(defaultFetch)
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        expect(page.container.textContent).toContain('No data connection')
        page.unmount()
    })

    test('registration row shows operator when operator is non-empty', async function () {
        const status = { ...defaultStatus, registration: 'Registered', operator: 'Telco' }
        mockFetch({ '/api/ltemodem': { settings: defaultConfig, status, serialPorts: [] } })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        expect(page.container.textContent).toContain('Registered - Telco')
        page.unmount()
    })

    test('network row shows band in parens when band is non-empty', async function () {
        const status = { ...defaultStatus, rat: 'LTE', band: 'B3' }
        mockFetch({ '/api/ltemodem': { settings: defaultConfig, status, serialPorts: [] } })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        expect(page.container.textContent).toContain('LTE (B3)')
        page.unmount()
    })

    test('reconnects row shows lastReconnect when it is set', async function () {
        const status = { ...defaultStatus, reconnectCount: 2, lastReconnect: '2024-01-01T12:00:00Z' }
        mockFetch({ '/api/ltemodem': { settings: defaultConfig, status, serialPorts: [] } })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        expect(page.container.textContent).toContain('(last: 2024-01-01T12:00:00Z)')
        page.unmount()
    })

    test('modem available badge shows "Responding"', async function () {
        const status = { ...defaultStatus, available: true }
        mockFetch({ '/api/ltemodem': { settings: defaultConfig, status, serialPorts: [] } })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        expect(page.container.textContent).toContain('Responding')
        page.unmount()
    })

    test('modem not available badge shows "Not detected"', async function () {
        mockFetch(defaultFetch)
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        expect(page.container.textContent).toContain('Not detected')
        page.unmount()
    })

    // ------------------------------------------------------------------
    // handleConfigChange — checkbox and text input
    // ------------------------------------------------------------------

    test('handleConfigChange updates checkbox (enabled)', async function () {
        mockFetch(defaultFetch)
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const enabledBox = page.container.querySelector('input[name="enabled"]')
        expect(enabledBox.checked).toBe(false)
        page.click(enabledBox)
        expect(enabledBox.checked).toBe(true)
        page.unmount()
    })

    test('handleConfigChange updates text input (atPort)', async function () {
        mockFetch(defaultFetch)
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const atPortInput = page.container.querySelector('input[name="atPort"]')
        page.setValue(atPortInput, '/dev/ttyUSB3')
        expect(atPortInput.value).toBe('/dev/ttyUSB3')
        page.unmount()
    })

    test('handleConfigChange updates select (baud) via change event', async function () {
        mockFetch(defaultFetch)
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const baudSelect = page.container.querySelector('select[name="baud"]')
        act(() => {
            const proto = Object.getPrototypeOf(baudSelect)
            const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
            setter.call(baudSelect, '9600')
            baudSelect.dispatchEvent(new Event('change', { bubbles: true }))
        })
        expect(baudSelect.value).toBe('9600')
        page.unmount()
    })

    test('handleConfigChange updates autoReconnect checkbox', async function () {
        mockFetch(defaultFetch)
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const arBox = page.container.querySelector('input[name="autoReconnect"]')
        expect(arBox.checked).toBe(false)
        page.click(arBox)
        expect(arBox.checked).toBe(true)
        page.unmount()
    })

    test('handleConfigChange updates pollInterval number input', async function () {
        mockFetch(defaultFetch)
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const pollInput = page.container.querySelector('input[name="pollInterval"]')
        page.setValue(pollInput, '10')
        expect(pollInput.value).toBe('10')
        page.unmount()
    })

    // ------------------------------------------------------------------
    // handleSubmit — success, error, catch
    // ------------------------------------------------------------------

    test('handleSubmit posts config and updates settings on success', async function () {
        let posted = null
        const updatedConfig = { ...defaultConfig, apn: 'internet' }
        mockFetch({
            '/api/ltemodem': { settings: defaultConfig, status: defaultStatus, serialPorts: [] },
            'POST /api/ltemodemmodify': (url, opts) => {
                posted = JSON.parse(opts.body)
                return { settings: updatedConfig }
            }
        })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const saveBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Save')
        page.click(saveBtn)
        await page.flush()
        expect(posted).not.toBeNull()
        const apnInput = page.container.querySelector('input[name="apn"]')
        expect(apnInput.value).toBe('internet')
        page.unmount()
    })

    test('handleSubmit sets error when API returns data.error', async function () {
        mockFetch({
            '/api/ltemodem': { settings: defaultConfig, status: defaultStatus, serialPorts: [] },
            'POST /api/ltemodemmodify': { error: 'invalid port' }
        })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const saveBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Save')
        page.click(saveBtn)
        await page.flush()
        expect(document.body.textContent).toContain('invalid port')
        page.unmount()
    })

    test('handleSubmit catch branch sets error when fetch throws', async function () {
        vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
            const method = (opts.method || 'GET').toUpperCase()
            if (method === 'GET') {
                return { ok: true, status: 200, json: async () => ({ settings: defaultConfig, status: defaultStatus, serialPorts: [] }) }
            }
            throw new Error('network failure')
        }))
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const saveBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Save')
        page.click(saveBtn)
        await page.flush()
        expect(document.body.textContent).toContain('Failed to save LTE modem settings')
        page.unmount()
    })

    // ------------------------------------------------------------------
    // handleReconnect — success, error, catch
    // ------------------------------------------------------------------

    test('handleReconnect success sets infoMessage with response joined', async function () {
        const status = { ...defaultStatus, available: true }
        mockFetch({
            '/api/ltemodem': { settings: defaultConfig, status, serialPorts: [] },
            'POST /api/ltemodemreconnect': { response: ['OK', 'CONNECT'] }
        })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const reconnectBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Reconnect data call')
        page.click(reconnectBtn)
        await page.flush()
        expect(document.body.textContent).toContain('Reconnect command sent: OK CONNECT')
        page.unmount()
    })

    test('handleReconnect success with empty response array', async function () {
        const status = { ...defaultStatus, available: true }
        mockFetch({
            '/api/ltemodem': { settings: defaultConfig, status, serialPorts: [] },
            'POST /api/ltemodemreconnect': { response: [] }
        })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const reconnectBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Reconnect data call')
        page.click(reconnectBtn)
        await page.flush()
        expect(document.body.textContent).toContain('Reconnect command sent:')
        page.unmount()
    })

    test('handleReconnect success with undefined response field (covers || [] fallback)', async function () {
        const status = { ...defaultStatus, available: true }
        mockFetch({
            '/api/ltemodem': { settings: defaultConfig, status, serialPorts: [] },
            'POST /api/ltemodemreconnect': {}
        })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const reconnectBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Reconnect data call')
        page.click(reconnectBtn)
        await page.flush()
        expect(document.body.textContent).toContain('Reconnect command sent:')
        page.unmount()
    })

    test('handleReconnect sets error when API returns data.error', async function () {
        const status = { ...defaultStatus, available: true }
        mockFetch({
            '/api/ltemodem': { settings: defaultConfig, status, serialPorts: [] },
            'POST /api/ltemodemreconnect': { error: 'modem not responding' }
        })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const reconnectBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Reconnect data call')
        page.click(reconnectBtn)
        await page.flush()
        expect(document.body.textContent).toContain('modem not responding')
        page.unmount()
    })

    test('handleReconnect catch branch sets error when fetch throws', async function () {
        const status = { ...defaultStatus, available: true }
        vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
            const method = (opts.method || 'GET').toUpperCase()
            if (method === 'GET') {
                return { ok: true, status: 200, json: async () => ({ settings: defaultConfig, status, serialPorts: [] }) }
            }
            throw new Error('network failure')
        }))
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const reconnectBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Reconnect data call')
        page.click(reconnectBtn)
        await page.flush()
        expect(document.body.textContent).toContain('Failed to send reconnect command')
        page.unmount()
    })

    test('Reconnect button is disabled when modem not available', async function () {
        mockFetch(defaultFetch)
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const reconnectBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Reconnect data call')
        expect(reconnectBtn.disabled).toBe(true)
        page.unmount()
    })

    // ------------------------------------------------------------------
    // handleResetUsage — success (status path), catch
    // ------------------------------------------------------------------

    test('handleResetUsage updates status when data.status is returned', async function () {
        const newStatus = { ...defaultStatus, usage: { totalRx: 0, totalTx: 0, sessionRx: 0, sessionTx: 0 } }
        mockFetch({
            '/api/ltemodem': { settings: defaultConfig, status: defaultStatus, serialPorts: [] },
            'POST /api/ltemodemresetusage': { status: newStatus }
        })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const resetBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Reset')
        page.click(resetBtn)
        await page.flush()
        // No error — status updated silently
        expect(document.body.textContent).not.toContain('Failed to reset usage counters')
        page.unmount()
    })

    test('handleResetUsage no-op when data.status is falsy', async function () {
        mockFetch({
            '/api/ltemodem': { settings: defaultConfig, status: defaultStatus, serialPorts: [] },
            'POST /api/ltemodemresetusage': {}
        })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const resetBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Reset')
        page.click(resetBtn)
        await page.flush()
        expect(document.body.textContent).not.toContain('Failed to reset usage counters')
        page.unmount()
    })

    test('handleResetUsage catch branch sets error when fetch throws', async function () {
        vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
            const method = (opts.method || 'GET').toUpperCase()
            if (method === 'GET') {
                return { ok: true, status: 200, json: async () => ({ settings: defaultConfig, status: defaultStatus, serialPorts: [] }) }
            }
            throw new Error('network failure')
        }))
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const resetBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Reset')
        page.click(resetBtn)
        await page.flush()
        expect(document.body.textContent).toContain('Failed to reset usage counters')
        page.unmount()
    })

    // ------------------------------------------------------------------
    // handleDetect — scanning state, scanDone variants, applyPort/applyInterface
    // ------------------------------------------------------------------

    test('handleDetect shows scanning state while in progress', async function () {
        let resolve
        const detectPromise = new Promise(r => { resolve = r })
        mockFetch({
            '/api/ltemodem': { settings: defaultConfig, status: defaultStatus, serialPorts: [] },
            'POST /api/ltemodemdetect': () => detectPromise
        })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const scanBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Scan for modem')
        page.click(scanBtn)
        // While scanning, button text changes
        expect(page.container.textContent).toContain('Scanning (can take ~20 s)...')
        // Resolve to clean up
        act(() => { resolve({ ports: [], interfaces: [] }) })
        await page.flush()
        page.unmount()
    })

    test('handleDetect: scan error path', async function () {
        mockFetch({
            '/api/ltemodem': { settings: defaultConfig, status: defaultStatus, serialPorts: [] },
            'POST /api/ltemodemdetect': { error: 'scan failed' }
        })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const scanBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Scan for modem')
        page.click(scanBtn)
        await page.flush()
        expect(document.body.textContent).toContain('scan failed')
        page.unmount()
    })

    test('handleDetect catch branch sets error when fetch throws', async function () {
        vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
            const method = (opts.method || 'GET').toUpperCase()
            if (method === 'GET') {
                return { ok: true, status: 200, json: async () => ({ settings: defaultConfig, status: defaultStatus, serialPorts: [] }) }
            }
            throw new Error('scan failure')
        }))
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const scanBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Scan for modem')
        page.click(scanBtn)
        await page.flush()
        expect(document.body.textContent).toContain('Modem scan failed')
        page.unmount()
    })

    test('handleDetect: scanDone with zero ok ports shows "No modem found" alert', async function () {
        mockFetch({
            '/api/ltemodem': { settings: defaultConfig, status: defaultStatus, serialPorts: [] },
            'POST /api/ltemodemdetect': {
                ports: [
                    { path: '/dev/ttyUSB0', ok: false, skipped: false }
                ],
                interfaces: []
            }
        })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const scanBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Scan for modem')
        page.click(scanBtn)
        await page.flush()
        expect(page.container.textContent).toContain('No modem found on any serial port')
        page.unmount()
    })

    test('handleDetect: port ok with recommended badge shown', async function () {
        mockFetch({
            '/api/ltemodem': { settings: defaultConfig, status: defaultStatus, serialPorts: [] },
            'POST /api/ltemodemdetect': {
                ports: [
                    { path: '/dev/ttyUSB2', ok: true, baud: 115200, manufacturer: 'SIMCOM', model: 'SIM7600', recommended: true }
                ],
                interfaces: []
            }
        })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const scanBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Scan for modem')
        page.click(scanBtn)
        await page.flush()
        expect(page.container.textContent).toContain('Recommended')
        expect(page.container.textContent).toContain('SIMCOM SIM7600')
        page.unmount()
    })

    test('handleDetect: port ok without recommended badge', async function () {
        mockFetch({
            '/api/ltemodem': { settings: defaultConfig, status: defaultStatus, serialPorts: [] },
            'POST /api/ltemodemdetect': {
                ports: [
                    { path: '/dev/ttyUSB3', ok: true, baud: 115200, manufacturer: '', model: '', recommended: false }
                ],
                interfaces: []
            }
        })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const scanBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Scan for modem')
        page.click(scanBtn)
        await page.flush()
        expect(page.container.textContent).toContain('unidentified')
        page.unmount()
    })

    test('handleDetect: port not ok and skipped shows Skipped badge with reason', async function () {
        mockFetch({
            '/api/ltemodem': { settings: defaultConfig, status: defaultStatus, serialPorts: [] },
            'POST /api/ltemodemdetect': {
                ports: [
                    { path: '/dev/ttyAMA0', ok: false, skipped: true, reason: 'FC UART' }
                ],
                interfaces: []
            }
        })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const scanBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Scan for modem')
        page.click(scanBtn)
        await page.flush()
        expect(page.container.textContent).toContain('Skipped')
        expect(page.container.textContent).toContain('FC UART')
        page.unmount()
    })

    test('handleDetect: port not ok and not skipped shows "No response" badge', async function () {
        mockFetch({
            '/api/ltemodem': { settings: defaultConfig, status: defaultStatus, serialPorts: [] },
            'POST /api/ltemodemdetect': {
                ports: [
                    { path: '/dev/ttyUSB1', ok: false, skipped: false }
                ],
                interfaces: []
            }
        })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const scanBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Scan for modem')
        page.click(scanBtn)
        await page.flush()
        expect(page.container.textContent).toContain('No response')
        page.unmount()
    })

    test('handleDetect: interface with modemLike and recommended badges', async function () {
        mockFetch({
            '/api/ltemodem': { settings: defaultConfig, status: defaultStatus, serialPorts: [] },
            'POST /api/ltemodemdetect': {
                ports: [],
                interfaces: [
                    { name: 'usb0', driver: 'rndis_host', modemLike: true, recommended: true, operstate: 'up', ipv4: '192.168.0.100' }
                ]
            }
        })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const scanBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Scan for modem')
        page.click(scanBtn)
        await page.flush()
        expect(page.container.textContent).toContain('Modem')
        expect(page.container.textContent).toContain('rndis_host')
        expect(page.container.textContent).toContain('192.168.0.100')
        page.unmount()
    })

    test('handleDetect: interface without modemLike or recommended', async function () {
        mockFetch({
            '/api/ltemodem': { settings: defaultConfig, status: defaultStatus, serialPorts: [] },
            'POST /api/ltemodemdetect': {
                ports: [],
                interfaces: [
                    { name: 'eth0', driver: 'smsc95xx', modemLike: false, recommended: false, operstate: 'down', ipv4: null }
                ]
            }
        })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const scanBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Scan for modem')
        page.click(scanBtn)
        await page.flush()
        expect(page.container.textContent).toContain('eth0')
        expect(page.container.textContent).toContain('smsc95xx')
        page.unmount()
    })

    test('handleDetect: interface with null driver and null operstate shows "-" fallback', async function () {
        mockFetch({
            '/api/ltemodem': { settings: defaultConfig, status: defaultStatus, serialPorts: [] },
            'POST /api/ltemodemdetect': {
                ports: [],
                interfaces: [
                    { name: 'wlan0', driver: null, modemLike: false, recommended: false, operstate: null, ipv4: '192.168.1.5' }
                ]
            }
        })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const scanBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Scan for modem')
        page.click(scanBtn)
        await page.flush()
        expect(page.container.textContent).toContain('wlan0')
        // Both driver and operstate are null → '-' shown in respective cells
        const cells = [...page.container.querySelectorAll('td')]
        const dashCells = cells.filter(td => td.textContent === '-')
        expect(dashCells.length).toBeGreaterThanOrEqual(2)
        page.unmount()
    })

    test('applyPort "Use" button updates atPort and baud in config', async function () {
        mockFetch({
            '/api/ltemodem': { settings: defaultConfig, status: defaultStatus, serialPorts: [] },
            'POST /api/ltemodemdetect': {
                ports: [
                    { path: '/dev/ttyUSB2', ok: true, baud: 9600, manufacturer: 'SIMCOM', model: 'SIM7600', recommended: true }
                ],
                interfaces: []
            }
        })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const scanBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Scan for modem')
        page.click(scanBtn)
        await page.flush()
        const useBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Use')
        page.click(useBtn)
        const atPortInput = page.container.querySelector('input[name="atPort"]')
        expect(atPortInput.value).toBe('/dev/ttyUSB2')
        page.unmount()
    })

    test('applyInterface "Use" button updates netInterface in config', async function () {
        mockFetch({
            '/api/ltemodem': { settings: defaultConfig, status: defaultStatus, serialPorts: [] },
            'POST /api/ltemodemdetect': {
                ports: [],
                interfaces: [
                    { name: 'usb1', driver: 'rndis_host', modemLike: true, recommended: true, operstate: 'up', ipv4: '10.0.0.1' }
                ]
            }
        })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const scanBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Scan for modem')
        page.click(scanBtn)
        await page.flush()
        const useBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Use')
        page.click(useBtn)
        const netInterfaceInput = page.container.querySelector('input[name="netInterface"]')
        expect(netInterfaceInput.value).toBe('usb1')
        page.unmount()
    })

    // ------------------------------------------------------------------
    // handleConnectionTest — testing state, steps rendered, error, catch
    // ------------------------------------------------------------------

    test('handleConnectionTest shows testing state while in progress', async function () {
        let resolve
        const testPromise = new Promise(r => { resolve = r })
        mockFetch({
            '/api/ltemodem': { settings: defaultConfig, status: defaultStatus, serialPorts: [] },
            'POST /api/ltemodemtest': () => testPromise
        })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const testBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Run connection test')
        page.click(testBtn)
        expect(page.container.textContent).toContain('Testing...')
        act(() => { resolve({ steps: [] }) })
        await page.flush()
        page.unmount()
    })

    test('handleConnectionTest renders steps with all badge types', async function () {
        const steps = [
            { name: 'AT port opens', pass: true, detail: 'opened' },
            { name: 'Modem identifies', pass: false, detail: 'no response' },
            { name: 'SIM present', pass: undefined, detail: 'skipped' }
        ]
        mockFetch({
            '/api/ltemodem': { settings: defaultConfig, status: defaultStatus, serialPorts: [] },
            'POST /api/ltemodemtest': { steps }
        })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const testBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Run connection test')
        page.click(testBtn)
        await page.flush()
        expect(page.container.textContent).toContain('AT port opens')
        expect(page.container.textContent).toContain('Pass')
        expect(page.container.textContent).toContain('Fail')
        expect(page.container.textContent).toContain('Skipped')
        page.unmount()
    })

    test('handleConnectionTest sets error when API returns data.error', async function () {
        mockFetch({
            '/api/ltemodem': { settings: defaultConfig, status: defaultStatus, serialPorts: [] },
            'POST /api/ltemodemtest': { error: 'test error' }
        })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const testBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Run connection test')
        page.click(testBtn)
        await page.flush()
        expect(document.body.textContent).toContain('test error')
        page.unmount()
    })

    test('handleConnectionTest catch branch sets error when fetch throws', async function () {
        vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
            const method = (opts.method || 'GET').toUpperCase()
            if (method === 'GET') {
                return { ok: true, status: 200, json: async () => ({ settings: defaultConfig, status: defaultStatus, serialPorts: [] }) }
            }
            throw new Error('test failure')
        }))
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const testBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Run connection test')
        page.click(testBtn)
        await page.flush()
        expect(document.body.textContent).toContain('Connection test failed to run')
        page.unmount()
    })

    test('handlePingHostChange updates pingHost value', async function () {
        mockFetch(defaultFetch)
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const pingInput = page.container.querySelector('input[type="text"][value="8.8.8.8"]') ||
            [...page.container.querySelectorAll('input[type="text"]')].find(i => i.value === '8.8.8.8')
        page.setValue(pingInput, '1.1.1.1')
        expect(pingInput.value).toBe('1.1.1.1')
        page.unmount()
    })

    test('connection test form onSubmit calls handleConnectionTest', async function () {
        mockFetch({
            '/api/ltemodem': { settings: defaultConfig, status: defaultStatus, serialPorts: [] },
            'POST /api/ltemodemtest': { steps: [{ name: 'AT port opens', pass: true, detail: 'ok' }] }
        })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        // Find connection test form (second form) and submit it
        const forms = page.container.querySelectorAll('form')
        page.submit(forms[1]) // second form is the connection test form
        await page.flush()
        expect(page.container.textContent).toContain('AT port opens')
        page.unmount()
    })

    // ------------------------------------------------------------------
    // AT console — empty command, success, error path, catch, atLog cap, disabled state
    // ------------------------------------------------------------------

    test('AT console input is disabled when modem not available', async function () {
        mockFetch(defaultFetch)
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const atInput = page.container.querySelector('input[placeholder="AT"]')
        expect(atInput.disabled).toBe(true)
        const sendBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Send')
        expect(sendBtn.disabled).toBe(true)
        page.unmount()
    })

    test('AT console input is enabled when modem is available', async function () {
        const status = { ...defaultStatus, available: true }
        mockFetch({ '/api/ltemodem': { settings: defaultConfig, status, serialPorts: [] } })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const atInput = page.container.querySelector('input[placeholder="AT"]')
        expect(atInput.disabled).toBe(false)
        page.unmount()
    })

    test('AT handleAtSend: empty command returns early without fetching', async function () {
        const fetchMock = mockFetch(defaultFetch)
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const atForm = page.container.querySelectorAll('form')[2] // AT form is the third form
        // Submit with empty command
        page.submit(atForm)
        await page.flush()
        // Only the initial GET should have been called, no POST
        const postCalls = fetchMock.mock.calls.filter(c => c[1] && c[1].method === 'POST')
        expect(postCalls.length).toBe(0)
        page.unmount()
    })

    test('AT handleAtSend: success appends to atLog', async function () {
        const status = { ...defaultStatus, available: true }
        mockFetch({
            '/api/ltemodem': { settings: defaultConfig, status, serialPorts: [] },
            'POST /api/ltemodemcommand': { response: ['OK'] }
        })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const atInput = page.container.querySelector('input[placeholder="AT"]')
        page.setValue(atInput, 'AT+CPIN?')
        const atForm = page.container.querySelectorAll('form')[2]
        page.submit(atForm)
        await page.flush()
        const pre = page.container.querySelector('pre')
        expect(pre).not.toBeNull()
        expect(pre.textContent).toContain('> AT+CPIN?')
        expect(pre.textContent).toContain('OK')
        page.unmount()
    })

    test('AT handleAtSend: data.error path prepends ERROR: prefix', async function () {
        const status = { ...defaultStatus, available: true }
        mockFetch({
            '/api/ltemodem': { settings: defaultConfig, status, serialPorts: [] },
            'POST /api/ltemodemcommand': { error: 'port unavailable' }
        })
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const atInput = page.container.querySelector('input[placeholder="AT"]')
        page.setValue(atInput, 'AT+CPSI?')
        const atForm = page.container.querySelectorAll('form')[2]
        page.submit(atForm)
        await page.flush()
        const pre = page.container.querySelector('pre')
        expect(pre).not.toBeNull()
        expect(pre.textContent).toContain('ERROR: port unavailable')
        page.unmount()
    })

    test('AT handleAtSend: catch branch sets error when fetch throws', async function () {
        const status = { ...defaultStatus, available: true }
        vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
            const method = (opts.method || 'GET').toUpperCase()
            if (method === 'GET') {
                return { ok: true, status: 200, json: async () => ({ settings: defaultConfig, status, serialPorts: [] }) }
            }
            throw new Error('at failure')
        }))
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        const atInput = page.container.querySelector('input[placeholder="AT"]')
        page.setValue(atInput, 'AT+CPIN?')
        const atForm = page.container.querySelectorAll('form')[2]
        page.submit(atForm)
        await page.flush()
        expect(document.body.textContent).toContain('Failed to send AT command')
        page.unmount()
    })

    test('AT atLog slice: log is capped at 100 entries', async function () {
        const status = { ...defaultStatus, available: true }
        // We need to send enough commands to push the log over 100 entries.
        // Each send adds 2 entries ("> cmd" + "OK"), so 51 sends = 102 before slice → 100 after.
        let callNum = 0
        vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
            const method = (opts.method || 'GET').toUpperCase()
            if (method === 'GET') {
                return { ok: true, status: 200, json: async () => ({ settings: defaultConfig, status, serialPorts: [] }) }
            }
            callNum++
            return { ok: true, status: 200, json: async () => ({ response: ['OK'] }) }
        }))
        const page = renderPage(<LTEModemPage />)
        await page.flush()

        // Send 51 commands — each adds 2 log entries = 102 total before slice to 100
        for (let i = 0; i < 51; i++) {
            const atInput = page.container.querySelector('input[placeholder="AT"]')
            page.setValue(atInput, `AT+CMD${i}`)
            const atForm = page.container.querySelectorAll('form')[2]
            page.submit(atForm)
            await page.flush()
        }

        const pre = page.container.querySelector('pre')
        expect(pre).not.toBeNull()
        // The log content should show log entries (capped)
        const lines = pre.textContent.split('\n').filter(l => l.trim() !== '')
        expect(lines.length).toBeLessThanOrEqual(100)
        page.unmount()
    })

    // ------------------------------------------------------------------
    // Socket events
    // ------------------------------------------------------------------

    test('LTEStatus socket event updates status', async function () {
        mockFetch(defaultFetch)
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        act(() => {
            lastSocket().fire('LTEStatus', {
                ...defaultStatus,
                available: true,
                signal: { raw: 15, dbm: -80, percent: 60 },
                ip: '10.0.0.2'
            })
        })
        expect(page.container.textContent).toContain('Responding')
        expect(page.container.textContent).toContain('10.0.0.2')
        page.unmount()
    })

    test('reconnect socket event re-fetches config', async function () {
        mockFetch(defaultFetch)
        const page = renderPage(<LTEModemPage />)
        await page.flush()
        act(() => { lastSocket().fire('reconnect') })
        await page.flush()
        expect(page.container.textContent).toContain('LTE Modem')
        page.unmount()
    })
})
