// @vitest-environment happy-dom
import React, { act } from 'react'
import { describe, test, expect, vi, afterEach } from 'vitest'

import { renderPage, mockFetch } from '../test/ui.jsx'
import { lastSocket } from '../test/socketMock.js'
import CameraSwitcherPage from './cameraswitcher.jsx'

vi.mock('socket.io-client', () => import('../test/socketMock.js'))

describe('#cameraswitcherpage()', function () {
    const defaultConfig = {
        enabled: false,
        rcChannel: 7,
        threshold: 1500,
        hysteresis: 50,
        minHoldMs: 250,
        switchMode: 'gstreamer',
        secDevice: '',
        secFormat: 'video/x-raw',
        secWidth: 0,
        secHeight: 0,
        secFps: -1,
        commandA: '',
        commandB: ''
    }

    const defaultStatus = {
        enabled: false,
        activeSource: 'A',
        lastRcValue: null,
        rcLive: false,
        lastSwitchTime: 0
    }

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    // ------------------------------------------------------------------
    // Basic rendering
    // ------------------------------------------------------------------

    test('renders page title and status section', async function () {
        mockFetch({ '/api/cameraswitcher': { settings: defaultConfig, status: defaultStatus } })
        const page = renderPage(<CameraSwitcherPage />)
        await page.flush()
        expect(page.container.textContent).toContain('Camera Switcher')
        expect(page.container.textContent).toContain('Active source:')
        expect(page.container.textContent).toContain('A')
        page.unmount()
    })

    test('shows "no RC data" when rcLive is false', async function () {
        mockFetch({ '/api/cameraswitcher': { settings: defaultConfig, status: defaultStatus } })
        const page = renderPage(<CameraSwitcherPage />)
        await page.flush()
        expect(page.container.textContent).toContain('no RC data')
        page.unmount()
    })

    test('shows RC value in µs when rcLive is true', async function () {
        const liveStatus = { ...defaultStatus, rcLive: true, lastRcValue: 1750 }
        mockFetch({ '/api/cameraswitcher': { settings: defaultConfig, status: liveStatus } })
        const page = renderPage(<CameraSwitcherPage />)
        await page.flush()
        expect(page.container.textContent).toContain('1750 µs')
        page.unmount()
    })

    // ------------------------------------------------------------------
    // switchMode rendering branches
    // ------------------------------------------------------------------

    test('gstreamer switchMode shows secondary camera fields', async function () {
        const gstConfig = { ...defaultConfig, switchMode: 'gstreamer' }
        mockFetch({ '/api/cameraswitcher': { settings: gstConfig, status: defaultStatus } })
        const page = renderPage(<CameraSwitcherPage />)
        await page.flush()
        expect(page.container.textContent).toContain('Secondary device')
        expect(page.container.textContent).toContain('Secondary format')
        expect(page.container.textContent).toContain('Secondary framerate')
        expect(page.container.textContent).not.toContain('Command for source A')
        page.unmount()
    })

    test('command switchMode shows commandA/commandB fields', async function () {
        const cmdConfig = { ...defaultConfig, switchMode: 'command' }
        mockFetch({ '/api/cameraswitcher': { settings: cmdConfig, status: defaultStatus } })
        const page = renderPage(<CameraSwitcherPage />)
        await page.flush()
        expect(page.container.textContent).toContain('Command for source A')
        expect(page.container.textContent).toContain('Command for source B')
        expect(page.container.textContent).not.toContain('Secondary device')
        page.unmount()
    })

    // ------------------------------------------------------------------
    // handleConfigChange — checkbox and non-checkbox branches
    // ------------------------------------------------------------------

    test('handleConfigChange updates checkbox (checkbox branch)', async function () {
        mockFetch({ '/api/cameraswitcher': { settings: defaultConfig, status: defaultStatus } })
        const page = renderPage(<CameraSwitcherPage />)
        await page.flush()
        const enabledBox = page.container.querySelector('input[name="enabled"]')
        expect(enabledBox.checked).toBe(false)
        page.click(enabledBox)
        expect(enabledBox.checked).toBe(true)
        page.unmount()
    })

    test('handleConfigChange updates number input (non-checkbox branch)', async function () {
        mockFetch({ '/api/cameraswitcher': { settings: defaultConfig, status: defaultStatus } })
        const page = renderPage(<CameraSwitcherPage />)
        await page.flush()
        const rcChannelInput = page.container.querySelector('input[name="rcChannel"]')
        page.setValue(rcChannelInput, '5')
        expect(rcChannelInput.value).toBe('5')
        page.unmount()
    })

    test('handleConfigChange updates switchMode select (non-checkbox branch)', async function () {
        mockFetch({ '/api/cameraswitcher': { settings: defaultConfig, status: defaultStatus } })
        const page = renderPage(<CameraSwitcherPage />)
        await page.flush()
        const switchModeSelect = page.container.querySelector('select[name="switchMode"]')
        // For <select> elements React listens for 'change', not 'input'
        act(() => {
            const proto = Object.getPrototypeOf(switchModeSelect)
            const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
            setter.call(switchModeSelect, 'command')
            switchModeSelect.dispatchEvent(new Event('change', { bubbles: true }))
        })
        // After change, the command fields should appear
        expect(page.container.textContent).toContain('Command for source A')
        page.unmount()
    })

    // ------------------------------------------------------------------
    // handleSubmit — success, error, catch branches
    // ------------------------------------------------------------------

    test('handleSubmit posts config and updates settings on success', async function () {
        let posted = null
        const updatedConfig = { ...defaultConfig, rcChannel: 3 }
        mockFetch({
            '/api/cameraswitcher': { settings: defaultConfig, status: defaultStatus },
            'POST /api/cameraswitchermodify': (url, opts) => {
                posted = JSON.parse(opts.body)
                return { settings: updatedConfig }
            }
        })
        const page = renderPage(<CameraSwitcherPage />)
        await page.flush()
        const saveBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Save')
        page.click(saveBtn)
        await page.flush()
        expect(posted).not.toBeNull()
        const rcChannelInput = page.container.querySelector('input[name="rcChannel"]')
        expect(rcChannelInput.value).toBe('3')
        page.unmount()
    })

    test('handleSubmit sets error state when API returns data.error', async function () {
        mockFetch({
            '/api/cameraswitcher': { settings: defaultConfig, status: defaultStatus },
            'POST /api/cameraswitchermodify': { error: 'invalid config' }
        })
        const page = renderPage(<CameraSwitcherPage />)
        await page.flush()
        const saveBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Save')
        page.click(saveBtn)
        await page.flush()
        expect(document.body.textContent).toContain('invalid config')
        page.unmount()
    })

    test('handleSubmit catch branch sets error when fetch throws', async function () {
        vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
            const method = (opts.method || 'GET').toUpperCase()
            if (method === 'GET') {
                return { ok: true, status: 200, json: async () => ({ settings: defaultConfig, status: defaultStatus }) }
            }
            throw new Error('network failure')
        }))
        const page = renderPage(<CameraSwitcherPage />)
        await page.flush()
        const saveBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Save')
        page.click(saveBtn)
        await page.flush()
        expect(document.body.textContent).toContain('Failed to update camera switcher configuration')
        page.unmount()
    })

    // ------------------------------------------------------------------
    // handleManualSwitch — success, error, catch branches; button disabled state
    // ------------------------------------------------------------------

    test('Switch to B is enabled and Switch to A is disabled when activeSource is A', async function () {
        mockFetch({ '/api/cameraswitcher': { settings: defaultConfig, status: defaultStatus } })
        const page = renderPage(<CameraSwitcherPage />)
        await page.flush()
        const switchABtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Switch to A')
        const switchBBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Switch to B')
        expect(switchABtn.disabled).toBe(true)
        expect(switchBBtn.disabled).toBe(false)
        page.unmount()
    })

    test('Switch to A is enabled and Switch to B is disabled when activeSource is B', async function () {
        const statusB = { ...defaultStatus, activeSource: 'B' }
        mockFetch({ '/api/cameraswitcher': { settings: defaultConfig, status: statusB } })
        const page = renderPage(<CameraSwitcherPage />)
        await page.flush()
        const switchABtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Switch to A')
        const switchBBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Switch to B')
        expect(switchABtn.disabled).toBe(false)
        expect(switchBBtn.disabled).toBe(true)
        page.unmount()
    })

    test('handleManualSwitch success updates status and clears error (switch to B)', async function () {
        const newStatus = { ...defaultStatus, activeSource: 'B' }
        mockFetch({
            '/api/cameraswitcher': { settings: defaultConfig, status: defaultStatus },
            'POST /api/cameraswitcherswitch': { status: newStatus }
        })
        const page = renderPage(<CameraSwitcherPage />)
        await page.flush()
        const switchBBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Switch to B')
        page.click(switchBBtn)
        await page.flush()
        expect(page.container.textContent).toContain('B')
        // Switch to B should now be disabled (activeSource = 'B')
        expect(switchBBtn.disabled).toBe(true)
        page.unmount()
    })

    test('handleManualSwitch success updates status (switch to A from B)', async function () {
        const statusB = { ...defaultStatus, activeSource: 'B' }
        const newStatusA = { ...defaultStatus, activeSource: 'A' }
        mockFetch({
            '/api/cameraswitcher': { settings: defaultConfig, status: statusB },
            'POST /api/cameraswitcherswitch': { status: newStatusA }
        })
        const page = renderPage(<CameraSwitcherPage />)
        await page.flush()
        const switchABtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Switch to A')
        // activeSource is B, so Switch to A is enabled
        expect(switchABtn.disabled).toBe(false)
        page.click(switchABtn)
        await page.flush()
        expect(switchABtn.disabled).toBe(true)
        page.unmount()
    })

    test('handleManualSwitch sets error state when API returns data.error', async function () {
        mockFetch({
            '/api/cameraswitcher': { settings: defaultConfig, status: defaultStatus },
            'POST /api/cameraswitcherswitch': { error: 'switch failed' }
        })
        const page = renderPage(<CameraSwitcherPage />)
        await page.flush()
        const switchBBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Switch to B')
        page.click(switchBBtn)
        await page.flush()
        expect(document.body.textContent).toContain('switch failed')
        page.unmount()
    })

    test('handleManualSwitch catch branch sets error when fetch throws', async function () {
        let callCount = 0
        vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
            const method = (opts.method || 'GET').toUpperCase()
            if (method === 'GET') {
                return { ok: true, status: 200, json: async () => ({ settings: defaultConfig, status: defaultStatus }) }
            }
            throw new Error('switch network failure')
        }))
        const page = renderPage(<CameraSwitcherPage />)
        await page.flush()
        const switchBBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Switch to B')
        page.click(switchBBtn)
        await page.flush()
        expect(document.body.textContent).toContain('Failed to switch camera source')
        page.unmount()
    })

    // ------------------------------------------------------------------
    // Socket.io events
    // ------------------------------------------------------------------

    test('CameraSwitcherStatus socket event updates status', async function () {
        mockFetch({ '/api/cameraswitcher': { settings: defaultConfig, status: defaultStatus } })
        const page = renderPage(<CameraSwitcherPage />)
        await page.flush()
        act(() => {
            lastSocket().fire('CameraSwitcherStatus', {
                ...defaultStatus,
                activeSource: 'B',
                rcLive: true,
                lastRcValue: 1850
            })
        })
        expect(page.container.textContent).toContain('1850 µs')
        expect(page.container.textContent).toContain('B')
        page.unmount()
    })

    test('reconnect socket event re-fetches config', async function () {
        mockFetch({ '/api/cameraswitcher': { settings: defaultConfig, status: defaultStatus } })
        const page = renderPage(<CameraSwitcherPage />)
        await page.flush()
        act(() => { lastSocket().fire('reconnect') })
        await page.flush()
        expect(page.container.textContent).toContain('Camera Switcher')
        page.unmount()
    })

    // ------------------------------------------------------------------
    // fetchConfig catch branches
    // ------------------------------------------------------------------

    test('fetchConfig catch branch sets error when fetch rejects', async function () {
        vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('net'))))
        const page = renderPage(<CameraSwitcherPage />)
        await page.flush()
        expect(document.body.textContent).toContain('Failed to fetch camera switcher config')
        page.unmount()
    })

    test('fetchConfig catch branch on !response.ok', async function () {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 500, json: async () => ({}) })))
        const page = renderPage(<CameraSwitcherPage />)
        await page.flush()
        expect(document.body.textContent).toContain('Failed to fetch camera switcher config')
        page.unmount()
    })

    // ------------------------------------------------------------------
    // HelpTips present (self-documenting UI rule)
    // ------------------------------------------------------------------

    test('help tips are present on form labels', async function () {
        mockFetch({ '/api/cameraswitcher': { settings: defaultConfig, status: defaultStatus } })
        const page = renderPage(<CameraSwitcherPage />)
        await page.flush()
        const tips = page.container.querySelectorAll('[aria-label="help"]')
        expect(tips.length).toBeGreaterThan(0)
        page.unmount()
    })
})
