// @vitest-environment happy-dom
import React from 'react'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'
import { act } from 'react'

import { renderPage, mockFetch } from '../test/ui.jsx'
import LoginPageComponent from './login.jsx'

// The upstream export name `loginPage` starts lowercase, which React would
// treat as an HTML element. Alias to a PascalCase name for JSX use.
const LoginPage = LoginPageComponent

describe('#loginPage()', function () {
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

  test('renders username and password fields', async function () {
    const page = renderPage(<LoginPage />)
    expect(page.container.textContent).toContain('Please Log In')
    expect(page.container.querySelector('input[name="username"]')).not.toBeNull()
    expect(page.container.querySelector('input[name="password"]')).not.toBeNull()
    page.unmount()
  })

  test('renders submit button', async function () {
    const page = renderPage(<LoginPage />)
    const btn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Submit')
    expect(btn).not.toBeNull()
    page.unmount()
  })

  // -----------------------------------------------------------------------
  // Input typing updates state (onChange handlers)
  // -----------------------------------------------------------------------

  test('typing in username field updates state', async function () {
    const page = renderPage(<LoginPage />)
    const usernameInput = page.container.querySelector('input[name="username"]')
    page.setValue(usernameInput, 'admin')
    expect(usernameInput.value).toBe('admin')
    page.unmount()
  })

  test('typing in password field updates state', async function () {
    const page = renderPage(<LoginPage />)
    const passwordInput = page.container.querySelector('input[name="password"]')
    page.setValue(passwordInput, 'secret')
    expect(passwordInput.value).toBe('secret')
    page.unmount()
  })

  // -----------------------------------------------------------------------
  // handleSubmit — success path
  // -----------------------------------------------------------------------

  test('successful login saves token to localStorage and calls reload', async function () {
    const tokenData = { token: 'tok123', username: 'admin' }
    mockFetch({
      'POST /api/login': tokenData
    })
    const page = renderPage(<LoginPage />)
    const usernameInput = page.container.querySelector('input[name="username"]')
    const passwordInput = page.container.querySelector('input[name="password"]')
    page.setValue(usernameInput, 'admin')
    page.setValue(passwordInput, 'pass')
    const form = page.container.querySelector('form')
    page.submit(form)
    await page.flush()
    expect(localStorage.getItem('token')).toBe(JSON.stringify(tokenData))
    expect(window.location.reload).toHaveBeenCalledTimes(1)
    page.unmount()
  })

  // -----------------------------------------------------------------------
  // handleSubmit — !ok path (server returns error)
  // -----------------------------------------------------------------------

  test('failed login sets errorMessage from data.error', async function () {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Invalid credentials' })
    })))
    const page = renderPage(<LoginPage />)
    const form = page.container.querySelector('form')
    page.submit(form)
    await page.flush()
    // Error modal portal into document.body
    expect(document.body.textContent).toContain('Invalid credentials')
    page.unmount()
  })

  // -----------------------------------------------------------------------
  // handleSubmit — catch path (fetch throws)
  // -----------------------------------------------------------------------

  test('fetch error sets errorMessage from error.message', async function () {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Network down'))))
    const page = renderPage(<LoginPage />)
    const form = page.container.querySelector('form')
    page.submit(form)
    await page.flush()
    expect(document.body.textContent).toContain('Network down')
    page.unmount()
  })

  // -----------------------------------------------------------------------
  // handleSubmit — preventDefault is called
  // -----------------------------------------------------------------------

  test('form submit calls preventDefault', async function () {
    mockFetch({ 'POST /api/login': { token: 'x' } })
    const page = renderPage(<LoginPage />)
    const form = page.container.querySelector('form')
    let defaultPrevented = false
    act(() => {
      const event = new Event('submit', { bubbles: true, cancelable: true })
      event.preventDefault = () => { defaultPrevented = true }
      form.dispatchEvent(event)
    })
    await page.flush()
    expect(defaultPrevented).toBe(true)
    page.unmount()
  })

  // -----------------------------------------------------------------------
  // Error modal — close clears error
  // -----------------------------------------------------------------------

  test('closing error modal clears errorMessage', async function () {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Bad credentials' })
    })))
    const page = renderPage(<LoginPage />)
    const form = page.container.querySelector('form')
    page.submit(form)
    await page.flush()
    // Modal is shown — close it
    const okBtn = [...document.body.querySelectorAll('button')].find(b => b.textContent === 'OK')
    act(() => { okBtn.click() })
    expect(document.body.textContent).not.toContain('Bad credentials')
    page.unmount()
  })
})
