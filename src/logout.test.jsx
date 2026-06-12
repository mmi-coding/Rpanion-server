// @vitest-environment happy-dom
import React from 'react'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'

import { renderPage, mockFetch } from '../test/ui.jsx'
import LogoutPageClass from './logout.jsx'

vi.mock('socket.io-client', () => import('../test/socketMock.js'))

// The upstream export name `logoutPage` starts lowercase — alias to PascalCase
// so React treats it as a component, not an HTML element.
const LogoutPage = LogoutPageClass

describe('#logoutPage()', function () {
  beforeEach(() => {
    localStorage.clear()
    // happy-dom doesn't implement window.location.reload — stub it
    vi.stubGlobal('location', { ...window.location, reload: vi.fn() })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  // -----------------------------------------------------------------------
  // Basic render
  // -----------------------------------------------------------------------

  test('renders "Confirm Logout" title and Logout button', async function () {
    mockFetch({})
    const page = renderPage(<LogoutPage />)
    await page.flush()
    expect(page.container.textContent).toContain('Confirm Logout')
    const logoutBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Logout')
    expect(logoutBtn).not.toBeNull()
    page.unmount()
  })

  // -----------------------------------------------------------------------
  // handleSubmit — success path
  // -----------------------------------------------------------------------

  test('successful logout removes token from localStorage and calls reload', async function () {
    localStorage.setItem('token', JSON.stringify({ token: 'mytoken' }))
    mockFetch({
      'POST /api/auth': {},
      'POST /api/logout': { message: 'logged out' }
    })
    const page = renderPage(<LogoutPage />)
    await page.flush()

    const form = page.container.querySelector('form')
    page.submit(form)
    await page.flush()

    expect(localStorage.getItem('token')).toBeNull()
    expect(window.location.reload).toHaveBeenCalledTimes(1)
    page.unmount()
  })

  // -----------------------------------------------------------------------
  // handleSubmit — !ok path (response not ok — throws an error, caught silently)
  // -----------------------------------------------------------------------

  test('failed logout (response not ok) reads error JSON and throws (caught silently)', async function () {
    localStorage.setItem('token', JSON.stringify({ token: 'mytoken' }))
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (method === 'GET' || url === '/api/auth') {
        return { ok: true, status: 200, json: async () => ({}) }
      }
      // POST /api/logout — not ok
      return {
        ok: false,
        status: 500,
        json: async () => ({ message: 'Logout failed on server' })
      }
    }))
    const page = renderPage(<LogoutPage />)
    await page.flush()

    const form = page.container.querySelector('form')
    page.submit(form)
    await page.flush()

    // The catch swallows the error silently — page still renders normally
    expect(page.container.textContent).toContain('Confirm Logout')
    // Reload should NOT have been called since error was thrown
    expect(window.location.reload).not.toHaveBeenCalled()
    page.unmount()
  })

  // -----------------------------------------------------------------------
  // handleSubmit — !ok path with no errorData.message (covers || fallback)
  // -----------------------------------------------------------------------

  test('failed logout with no errorData.message uses fallback message (caught silently)', async function () {
    localStorage.setItem('token', JSON.stringify({ token: 'mytoken' }))
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (method !== 'POST') {
        return { ok: true, status: 200, json: async () => ({}) }
      }
      // POST /api/logout — not ok, no message field
      return {
        ok: false,
        status: 500,
        json: async () => ({}) // no .message → fallback 'Failed to logout'
      }
    }))
    const page = renderPage(<LogoutPage />)
    await page.flush()

    const form = page.container.querySelector('form')
    page.submit(form)
    await page.flush()

    // The catch swallows the error silently
    expect(page.container.textContent).toContain('Confirm Logout')
    expect(window.location.reload).not.toHaveBeenCalled()
    page.unmount()
  })

  // -----------------------------------------------------------------------
  // handleSubmit — catch path (fetch throws — caught silently)
  // -----------------------------------------------------------------------

  test('logout fetch throws (caught silently)', async function () {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (method !== 'POST') {
        return { ok: true, status: 200, json: async () => ({}) }
      }
      throw new Error('Network error')
    }))
    const page = renderPage(<LogoutPage />)
    await page.flush()

    const form = page.container.querySelector('form')
    page.submit(form)
    await page.flush()

    // catch block is silent — no error shown, page intact
    expect(page.container.textContent).toContain('Confirm Logout')
    expect(window.location.reload).not.toHaveBeenCalled()
    page.unmount()
  })

  // -----------------------------------------------------------------------
  // preventDefault is called on form submit
  // -----------------------------------------------------------------------

  test('form submit calls preventDefault', async function () {
    mockFetch({
      'POST /api/logout': { message: 'ok' }
    })
    const page = renderPage(<LogoutPage />)
    await page.flush()

    const form = page.container.querySelector('form')
    let defaultPrevented = false
    const { act } = await import('react')
    act(() => {
      const event = new Event('submit', { bubbles: true, cancelable: true })
      event.preventDefault = () => { defaultPrevented = true }
      form.dispatchEvent(event)
    })
    await page.flush()
    expect(defaultPrevented).toBe(true)
    page.unmount()
  })
})
