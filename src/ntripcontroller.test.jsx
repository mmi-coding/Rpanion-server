// @vitest-environment happy-dom
import React, { act } from 'react'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'

import { renderPage, mockFetch } from '../test/ui.jsx'
import { lastSocket } from '../test/socketMock.js'
import NTRIPPage from './ntripcontroller.jsx'

vi.mock('socket.io-client', () => import('../test/socketMock.js'))

describe('#ntripControllerPage()', function () {
  const defaultConfig = {
    host: 'rtk.example.com',
    port: 2101,
    mountpoint: 'NEAREST',
    username: 'user1',
    password: 'pass1',
    active: false,
    showPW: false,
    useTLS: false,
    NTRIPStatus: 'Not connected'
  }

  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  test('renders title NTRIP Configuration', async function () {
    mockFetch({ '/api/ntripconfig': defaultConfig })
    const page = renderPage(<NTRIPPage />)
    await page.flush()
    expect(page.container.textContent).toContain('NTRIP Configuration')
    page.unmount()
  })

  test('fetches ntripconfig on mount and populates fields', async function () {
    mockFetch({ '/api/ntripconfig': defaultConfig })
    const page = renderPage(<NTRIPPage />)
    await page.flush()
    const hostInput = page.container.querySelector('input[name="host"]')
    expect(hostInput.value).toBe('rtk.example.com')
    const portInput = page.container.querySelector('input[name="port"]')
    expect(portInput.value).toBe('2101')
    page.unmount()
  })

  test('renders Enable button and enabled fields when active=false', async function () {
    mockFetch({ '/api/ntripconfig': defaultConfig })
    const page = renderPage(<NTRIPPage />)
    await page.flush()
    expect(page.container.textContent).toContain('Enable')
    const hostInput = page.container.querySelector('input[name="host"]')
    expect(hostInput.disabled).toBe(false)
    page.unmount()
  })

  test('renders Disable button and disabled fields when active=true', async function () {
    const activeConfig = { ...defaultConfig, active: true }
    mockFetch({ '/api/ntripconfig': activeConfig })
    const page = renderPage(<NTRIPPage />)
    await page.flush()
    expect(page.container.textContent).toContain('Disable')
    const hostInput = page.container.querySelector('input[name="host"]')
    expect(hostInput.disabled).toBe(true)
    const portInput = page.container.querySelector('input[name="port"]')
    expect(portInput.disabled).toBe(true)
    const mountInput = page.container.querySelector('input[name="mountpoint"]')
    expect(mountInput.disabled).toBe(true)
    const usernameInput = page.container.querySelector('input[name="username"]')
    expect(usernameInput.disabled).toBe(true)
    const passwordInput = page.container.querySelector('input[name="password"]')
    expect(passwordInput.disabled).toBe(true)
    const tlsCheckbox = page.container.querySelector('input[name="useTLS"]')
    expect(tlsCheckbox.disabled).toBe(true)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Password visibility toggle
  // -------------------------------------------------------------------------
  test('password input type is password by default (showPW=false)', async function () {
    mockFetch({ '/api/ntripconfig': defaultConfig })
    const page = renderPage(<NTRIPPage />)
    await page.flush()
    const passwordInput = page.container.querySelector('input[name="password"]')
    expect(passwordInput.type).toBe('password')
    page.unmount()
  })

  test('togglePasswordVisible changes password input to text type', async function () {
    mockFetch({ '/api/ntripconfig': defaultConfig })
    const page = renderPage(<NTRIPPage />)
    await page.flush()
    const showPWCheckbox = page.container.querySelector('input[name="showpassword"]')
    act(() => { showPWCheckbox.click() })
    const passwordInput = page.container.querySelector('input[name="password"]')
    expect(passwordInput.type).toBe('text')
    page.unmount()
  })

  test('togglePasswordVisible with showPW=true in initial state renders text input', async function () {
    const showPWConfig = { ...defaultConfig, showPW: true }
    mockFetch({ '/api/ntripconfig': showPWConfig })
    const page = renderPage(<NTRIPPage />)
    await page.flush()
    const passwordInput = page.container.querySelector('input[name="password"]')
    expect(passwordInput.type).toBe('text')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // toggleuseTLS — toggles the TLS checkbox
  // -------------------------------------------------------------------------
  test('toggleuseTLS toggles useTLS checkbox state', async function () {
    mockFetch({ '/api/ntripconfig': defaultConfig })
    const page = renderPage(<NTRIPPage />)
    await page.flush()
    const tlsCheckbox = page.container.querySelector('input[name="useTLS"]')
    expect(tlsCheckbox.checked).toBe(false)
    act(() => { tlsCheckbox.click() })
    expect(tlsCheckbox.checked).toBe(true)
    page.unmount()
  })

  test('useTLS=true in initial state renders checked TLS checkbox', async function () {
    const tlsConfig = { ...defaultConfig, useTLS: true }
    mockFetch({ '/api/ntripconfig': tlsConfig })
    const page = renderPage(<NTRIPPage />)
    await page.flush()
    const tlsCheckbox = page.container.querySelector('input[name="useTLS"]')
    expect(tlsCheckbox.checked).toBe(true)
    page.unmount()
  })

  // S14: cleartext-credentials warning shown only when TLS is off
  test('shows a cleartext warning when TLS is off', async function () {
    mockFetch({ '/api/ntripconfig': { ...defaultConfig, useTLS: false } })
    const page = renderPage(<NTRIPPage />)
    await page.flush()
    const warn = page.container.querySelector('#tls-cleartext-warning')
    expect(warn).not.toBeNull()
    expect(warn.textContent).toContain('unencrypted')
    page.unmount()
  })

  test('hides the cleartext warning when TLS is on', async function () {
    mockFetch({ '/api/ntripconfig': { ...defaultConfig, useTLS: true } })
    const page = renderPage(<NTRIPPage />)
    await page.flush()
    expect(page.container.querySelector('#tls-cleartext-warning')).toBeNull()
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // changeHandler — updates various fields
  // -------------------------------------------------------------------------
  test('changeHandler updates host field', async function () {
    mockFetch({ '/api/ntripconfig': defaultConfig })
    const page = renderPage(<NTRIPPage />)
    await page.flush()
    const hostInput = page.container.querySelector('input[name="host"]')
    page.setValue(hostInput, 'newhost.example.com')
    expect(hostInput.value).toBe('newhost.example.com')
    page.unmount()
  })

  test('changeHandler updates port field', async function () {
    mockFetch({ '/api/ntripconfig': defaultConfig })
    const page = renderPage(<NTRIPPage />)
    await page.flush()
    const portInput = page.container.querySelector('input[name="port"]')
    page.setValue(portInput, '2102')
    expect(portInput.value).toBe('2102')
    page.unmount()
  })

  test('changeHandler updates mountpoint field', async function () {
    mockFetch({ '/api/ntripconfig': defaultConfig })
    const page = renderPage(<NTRIPPage />)
    await page.flush()
    const mountInput = page.container.querySelector('input[name="mountpoint"]')
    page.setValue(mountInput, 'MOUNT1')
    expect(mountInput.value).toBe('MOUNT1')
    page.unmount()
  })

  test('changeHandler updates username field', async function () {
    mockFetch({ '/api/ntripconfig': defaultConfig })
    const page = renderPage(<NTRIPPage />)
    await page.flush()
    const usernameInput = page.container.querySelector('input[name="username"]')
    page.setValue(usernameInput, 'newuser')
    expect(usernameInput.value).toBe('newuser')
    page.unmount()
  })

  test('changeHandler updates password field', async function () {
    mockFetch({ '/api/ntripconfig': defaultConfig })
    const page = renderPage(<NTRIPPage />)
    await page.flush()
    const passwordInput = page.container.querySelector('input[name="password"]')
    page.setValue(passwordInput, 'newpassword')
    expect(passwordInput.value).toBe('newpassword')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleNTRIPSubmit — POSTs with !active
  // -------------------------------------------------------------------------
  test('submit sends POST with active=!false (Enable case)', async function () {
    let posted = null
    mockFetch({
      '/api/ntripconfig': defaultConfig,
      'POST /api/ntripmodify': (url, opts) => {
        posted = JSON.parse(opts.body)
        return { ...defaultConfig, active: true }
      }
    })
    const page = renderPage(<NTRIPPage />)
    await page.flush()
    const button = page.container.querySelector('button')
    page.click(button)
    await page.flush()
    expect(posted).not.toBeNull()
    // active was false → sends !false = true
    expect(posted.active).toBe(true)
    expect(posted.useTLS).toBe(false)
    page.unmount()
  })

  test('submit sends POST with active=!true (Disable case)', async function () {
    let posted = null
    const activeConfig = { ...defaultConfig, active: true }
    mockFetch({
      '/api/ntripconfig': activeConfig,
      'POST /api/ntripmodify': (url, opts) => {
        posted = JSON.parse(opts.body)
        return { ...defaultConfig, active: false }
      }
    })
    const page = renderPage(<NTRIPPage />)
    await page.flush()
    const button = page.container.querySelector('button')
    page.click(button)
    await page.flush()
    expect(posted).not.toBeNull()
    // active was true → sends !true = false
    expect(posted.active).toBe(false)
    page.unmount()
  })

  test('submit body includes all fields JSON-stringified', async function () {
    let posted = null
    mockFetch({
      '/api/ntripconfig': defaultConfig,
      'POST /api/ntripmodify': (url, opts) => {
        posted = JSON.parse(opts.body)
        return defaultConfig
      }
    })
    const page = renderPage(<NTRIPPage />)
    await page.flush()
    const button = page.container.querySelector('button')
    page.click(button)
    await page.flush()
    // host/port/mountpoint/username/password are JSON.stringify'd
    expect(posted.host).toBe(JSON.stringify(defaultConfig.host))
    expect(posted.mountpoint).toBe(JSON.stringify(defaultConfig.mountpoint))
    expect(posted.username).toBe(JSON.stringify(defaultConfig.username))
    expect(posted.password).toBe(JSON.stringify(defaultConfig.password))
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Socket: NTRIPStatus updates status display
  // -------------------------------------------------------------------------
  test('NTRIPStatus socket event updates status text', async function () {
    mockFetch({ '/api/ntripconfig': defaultConfig })
    const page = renderPage(<NTRIPPage />)
    await page.flush()
    act(() => {
      lastSocket().fire('NTRIPStatus', 'Active - receiving corrections')
    })
    expect(page.container.textContent).toContain('Active - receiving corrections')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Socket: reconnect triggers componentDidMount again
  // -------------------------------------------------------------------------
  test('reconnect socket event re-fetches ntripconfig', async function () {
    mockFetch({ '/api/ntripconfig': defaultConfig })
    const page = renderPage(<NTRIPPage />)
    await page.flush()
    act(() => {
      lastSocket().fire('reconnect')
    })
    await page.flush()
    expect(page.container.textContent).toContain('NTRIP Configuration')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // showLogin path
  // -------------------------------------------------------------------------
  test('showLogin=true renders login form', async function () {
    mockFetch({ '/api/ntripconfig': defaultConfig })
    const page = renderPage(<NTRIPPage showLogin={true} />)
    await page.flush()
    expect(page.container.textContent).toContain('Please Log In')
    page.unmount()
  })
})
