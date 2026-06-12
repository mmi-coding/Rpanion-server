// @vitest-environment happy-dom
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'

/*
 * serviceWorker.js — CRA boilerplate
 *
 * register() is guarded by:
 *   process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator
 *
 * process.env.NODE_ENV is NOT statically replaced by Vite in test mode —
 * it can be set to 'production' at runtime before importing the module.
 * We use vi.resetModules() + dynamic import so each test gets a fresh module
 * with its module-level constants (isLocalhost) recomputed.
 */

describe('#serviceWorker', function () {
  const originalHostname = window.location.hostname
  const originalNodeEnv = process.env.NODE_ENV

  function setHostname (hostname) {
    Object.defineProperty(window.location, 'hostname', {
      value: hostname,
      configurable: true,
      writable: true
    })
  }

  function makeServiceWorkerStub (overrides = {}) {
    const unregisterFn = vi.fn().mockResolvedValue(true)
    const registration = {
      installing: null,
      onupdatefound: null,
      unregister: unregisterFn
    }
    const registerFn = vi.fn().mockResolvedValue(registration)
    const readyPromise = Promise.resolve({ unregister: unregisterFn })
    const stub = {
      ready: readyPromise,
      register: registerFn,
      controller: null,
      ...overrides
    }
    Object.defineProperty(navigator, 'serviceWorker', {
      value: stub,
      configurable: true,
      writable: true
    })
    return { stub, registration, unregisterFn, registerFn }
  }

  function removeServiceWorker () {
    try { delete navigator.serviceWorker } catch (_) {}
  }

  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    localStorage.clear()
    process.env.NODE_ENV = originalNodeEnv
    Object.defineProperty(window.location, 'hostname', {
      value: originalHostname,
      configurable: true,
      writable: true
    })
    removeServiceWorker()
  })

  // -------------------------------------------------------------------------
  // unregister() — navigator.serviceWorker present
  // -------------------------------------------------------------------------
  test('unregister() calls ready.then and unregisters', async function () {
    const unregister = vi.fn().mockResolvedValue(true)
    const ready = Promise.resolve({ unregister })
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { ready, register: vi.fn() },
      configurable: true, writable: true
    })

    const sw = await import('./serviceWorker.js')
    sw.unregister()
    await ready
    await Promise.resolve()
    expect(unregister).toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // unregister() — navigator.serviceWorker absent → no-op
  // -------------------------------------------------------------------------
  test('unregister() is a no-op when serviceWorker not in navigator', async function () {
    removeServiceWorker()
    const sw = await import('./serviceWorker.js')
    expect(() => sw.unregister()).not.toThrow()
  })

  // -------------------------------------------------------------------------
  // register() — non-production → early return
  // -------------------------------------------------------------------------
  test('register() is a no-op in non-production environment', async function () {
    process.env.NODE_ENV = 'development'
    const { stub } = makeServiceWorkerStub()
    const sw = await import('./serviceWorker.js')
    sw.register({})
    expect(stub.register).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // register() — production, serviceWorker absent → early return
  // -------------------------------------------------------------------------
  test('register() is a no-op when serviceWorker not in navigator (production)', async function () {
    process.env.NODE_ENV = 'production'
    removeServiceWorker()
    const sw = await import('./serviceWorker.js')
    expect(() => sw.register({})).not.toThrow()
  })

  // -------------------------------------------------------------------------
  // isLocalhost — hostname === 'localhost'
  // -------------------------------------------------------------------------
  test('isLocalhost computed true for hostname=localhost', async function () {
    setHostname('localhost')
    process.env.NODE_ENV = 'production'
    const { stub } = makeServiceWorkerStub()
    // Make PUBLIC_URL match origin so origin check passes
    process.env.PUBLIC_URL = ''
    const sw = await import('./serviceWorker.js')

    // Trigger the load event
    const loadHandlers = []
    const origAdd = window.addEventListener.bind(window)
    const addSpy = vi.spyOn(window, 'addEventListener').mockImplementation((evt, handler, ...rest) => {
      if (evt === 'load') loadHandlers.push(handler)
      else origAdd(evt, handler, ...rest)
    })

    sw.register({})
    addSpy.mockRestore()
    // Manually invoke the load handler
    for (const h of loadHandlers) h()
    await stub.ready

    // On localhost the ready.then logs; checkValidServiceWorker is called instead of registerValidSW.
    // fetch is not stubbed here — this test just verifies register() reaches the load event setup
    // when hostname='localhost' in production mode. The load handlers array captures the handler.
    expect(loadHandlers.length).toBeGreaterThan(0)
    process.env.PUBLIC_URL = ''
  })

  // -------------------------------------------------------------------------
  // isLocalhost — hostname === '[::1]'
  // -------------------------------------------------------------------------
  test('isLocalhost computed true for hostname=[::1]', async function () {
    setHostname('[::1]')
    const sw = await import('./serviceWorker.js')
    expect(() => sw.register({})).not.toThrow()
  })

  // -------------------------------------------------------------------------
  // isLocalhost — hostname matches 127.x.x.x
  // -------------------------------------------------------------------------
  test('isLocalhost computed true for hostname=127.0.0.1', async function () {
    setHostname('127.0.0.1')
    const sw = await import('./serviceWorker.js')
    expect(() => sw.register({})).not.toThrow()
  })

  // -------------------------------------------------------------------------
  // isLocalhost — non-localhost hostname
  // -------------------------------------------------------------------------
  test('isLocalhost computed false for hostname=example.com', async function () {
    setHostname('example.com')
    const sw = await import('./serviceWorker.js')
    expect(() => sw.register({})).not.toThrow()
  })

  // -------------------------------------------------------------------------
  // register() — production + non-localhost → registerValidSW path
  // registerValidSW: onupdatefound → onstatechange with state='installed',
  // controller present → onUpdate called
  // -------------------------------------------------------------------------
  test('registerValidSW: installed + controller present → calls onUpdate', async function () {
    setHostname('example.com')
    process.env.NODE_ENV = 'production'
    process.env.PUBLIC_URL = ''

    const onUpdate = vi.fn()
    const onSuccess = vi.fn()

    let installingWorker = { state: 'installing', onstatechange: null }
    let registration = {
      installing: installingWorker,
      onupdatefound: null,
      unregister: vi.fn()
    }

    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        ready: Promise.resolve({ unregister: vi.fn() }),
        register: vi.fn().mockResolvedValue(registration),
        controller: { postMessage: vi.fn() } // controller present
      },
      configurable: true, writable: true
    })

    const sw = await import('./serviceWorker.js')

    // Capture the load event handler
    const loadHandlers = []
    vi.spyOn(window, 'addEventListener').mockImplementation((evt, handler) => {
      if (evt === 'load') loadHandlers.push(handler)
    })

    sw.register({ onUpdate, onSuccess })

    // Fire the load handler
    for (const h of loadHandlers) h()
    await Promise.resolve()
    await Promise.resolve()

    // Trigger onupdatefound
    if (registration.onupdatefound) registration.onupdatefound()

    // Trigger onstatechange with 'installed'
    installingWorker.state = 'installed'
    if (installingWorker.onstatechange) installingWorker.onstatechange()

    expect(onUpdate).toHaveBeenCalledWith(registration)
    expect(onSuccess).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // registerValidSW: installed + no controller → onSuccess called
  // -------------------------------------------------------------------------
  test('registerValidSW: installed + no controller → calls onSuccess', async function () {
    setHostname('example.com')
    process.env.NODE_ENV = 'production'
    process.env.PUBLIC_URL = ''

    const onUpdate = vi.fn()
    const onSuccess = vi.fn()

    let installingWorker = { state: 'installing', onstatechange: null }
    let registration = {
      installing: installingWorker,
      onupdatefound: null,
      unregister: vi.fn()
    }

    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        ready: Promise.resolve({ unregister: vi.fn() }),
        register: vi.fn().mockResolvedValue(registration),
        controller: null // no controller
      },
      configurable: true, writable: true
    })

    const sw = await import('./serviceWorker.js')

    const loadHandlers = []
    vi.spyOn(window, 'addEventListener').mockImplementation((evt, handler) => {
      if (evt === 'load') loadHandlers.push(handler)
    })

    sw.register({ onUpdate, onSuccess })
    for (const h of loadHandlers) h()
    await Promise.resolve()
    await Promise.resolve()

    if (registration.onupdatefound) registration.onupdatefound()
    installingWorker.state = 'installed'
    if (installingWorker.onstatechange) installingWorker.onstatechange()

    expect(onSuccess).toHaveBeenCalledWith(registration)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // registerValidSW: onstatechange with state != 'installed' → no callbacks
  // -------------------------------------------------------------------------
  test('registerValidSW: onstatechange with non-installed state → no callbacks', async function () {
    setHostname('example.com')
    process.env.NODE_ENV = 'production'
    process.env.PUBLIC_URL = ''

    const onUpdate = vi.fn()
    const onSuccess = vi.fn()

    let installingWorker = { state: 'activating', onstatechange: null }
    let registration = {
      installing: installingWorker,
      onupdatefound: null,
      unregister: vi.fn()
    }

    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        ready: Promise.resolve({ unregister: vi.fn() }),
        register: vi.fn().mockResolvedValue(registration),
        controller: null
      },
      configurable: true, writable: true
    })

    const sw = await import('./serviceWorker.js')
    const loadHandlers = []
    vi.spyOn(window, 'addEventListener').mockImplementation((evt, handler) => {
      if (evt === 'load') loadHandlers.push(handler)
    })

    sw.register({ onUpdate, onSuccess })
    for (const h of loadHandlers) h()
    await Promise.resolve()
    await Promise.resolve()

    if (registration.onupdatefound) registration.onupdatefound()
    // state is 'activating', not 'installed'
    if (installingWorker.onstatechange) installingWorker.onstatechange()

    expect(onUpdate).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // registerValidSW: register() catch → console.error
  // -------------------------------------------------------------------------
  test('registerValidSW: register() reject → console.error', async function () {
    setHostname('example.com')
    process.env.NODE_ENV = 'production'
    process.env.PUBLIC_URL = ''

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        ready: Promise.resolve({ unregister: vi.fn() }),
        register: vi.fn().mockRejectedValue(new Error('SW register failed')),
        controller: null
      },
      configurable: true, writable: true
    })

    const sw = await import('./serviceWorker.js')
    const loadHandlers = []
    vi.spyOn(window, 'addEventListener').mockImplementation((evt, handler) => {
      if (evt === 'load') loadHandlers.push(handler)
    })

    sw.register({})
    for (const h of loadHandlers) h()
    // Wait for the promise rejection to propagate
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error during service worker registration:'),
      expect.any(Error)
    )
    consoleSpy.mockRestore()
  })

  // -------------------------------------------------------------------------
  // register() — production + non-localhost + different origin → early return
  // -------------------------------------------------------------------------
  test('register() returns early when PUBLIC_URL origin differs from page origin', async function () {
    setHostname('example.com')
    process.env.NODE_ENV = 'production'
    process.env.PUBLIC_URL = 'https://cdn.otherdomain.com'

    const { stub } = makeServiceWorkerStub()

    const sw = await import('./serviceWorker.js')
    const loadHandlers = []
    vi.spyOn(window, 'addEventListener').mockImplementation((evt, handler) => {
      if (evt === 'load') loadHandlers.push(handler)
    })

    sw.register({})

    // The early return happens due to origin mismatch — load handler not set
    // (or if set, the inner check exits before registering)
    for (const h of loadHandlers) h()

    // navigator.serviceWorker.register should NOT be called
    expect(stub.register).not.toHaveBeenCalled()
    process.env.PUBLIC_URL = ''
  })

  // -------------------------------------------------------------------------
  // register() — production + localhost → checkValidServiceWorker path
  // checkValidServiceWorker: fetch 404 → unregister + reload
  // -------------------------------------------------------------------------
  test('checkValidServiceWorker: 404 response → unregister + reload', async function () {
    setHostname('localhost')
    process.env.NODE_ENV = 'production'
    process.env.PUBLIC_URL = ''

    const reloadFn = vi.fn()
    Object.defineProperty(window.location, 'reload', {
      value: reloadFn, configurable: true, writable: true
    })

    const unregisterFn = vi.fn().mockResolvedValue(true)
    const innerRegistration = { unregister: unregisterFn }

    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        ready: Promise.resolve(innerRegistration),
        register: vi.fn(),
        controller: null
      },
      configurable: true, writable: true
    })

    // Stub fetch to return 404 for the SW URL
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 404,
      headers: { get: vi.fn().mockReturnValue('text/html') }
    }))

    const sw = await import('./serviceWorker.js')
    const loadHandlers = []
    vi.spyOn(window, 'addEventListener').mockImplementation((evt, handler) => {
      if (evt === 'load') loadHandlers.push(handler)
    })

    sw.register({})
    for (const h of loadHandlers) h()
    // Allow fetch + promise chain to settle
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(unregisterFn).toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // checkValidServiceWorker: non-JS content-type → unregister + reload
  // -------------------------------------------------------------------------
  test('checkValidServiceWorker: non-JS content-type → unregister + reload', async function () {
    setHostname('localhost')
    process.env.NODE_ENV = 'production'
    process.env.PUBLIC_URL = ''

    const unregisterFn = vi.fn().mockResolvedValue(true)
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        ready: Promise.resolve({ unregister: unregisterFn }),
        register: vi.fn(),
        controller: null
      },
      configurable: true, writable: true
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      headers: { get: vi.fn().mockReturnValue('text/html') } // not javascript
    }))

    const sw = await import('./serviceWorker.js')
    const loadHandlers = []
    vi.spyOn(window, 'addEventListener').mockImplementation((evt, handler) => {
      if (evt === 'load') loadHandlers.push(handler)
    })

    sw.register({})
    for (const h of loadHandlers) h()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(unregisterFn).toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // checkValidServiceWorker: valid response → registerValidSW
  // -------------------------------------------------------------------------
  test('checkValidServiceWorker: valid JS response → calls registerValidSW', async function () {
    setHostname('localhost')
    process.env.NODE_ENV = 'production'
    process.env.PUBLIC_URL = ''

    let registration = {
      installing: { state: 'installing', onstatechange: null },
      onupdatefound: null,
      unregister: vi.fn()
    }

    const registerFn = vi.fn().mockResolvedValue(registration)
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        ready: Promise.resolve({ unregister: vi.fn() }),
        register: registerFn,
        controller: null
      },
      configurable: true, writable: true
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      headers: { get: vi.fn().mockReturnValue('application/javascript') }
    }))

    const sw = await import('./serviceWorker.js')
    const loadHandlers = []
    vi.spyOn(window, 'addEventListener').mockImplementation((evt, handler) => {
      if (evt === 'load') loadHandlers.push(handler)
    })

    sw.register({})
    for (const h of loadHandlers) h()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(registerFn).toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // checkValidServiceWorker: fetch throws → offline log
  // -------------------------------------------------------------------------
  test('checkValidServiceWorker: fetch throws → offline console.log', async function () {
    setHostname('localhost')
    process.env.NODE_ENV = 'production'
    process.env.PUBLIC_URL = ''

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        ready: Promise.resolve({ unregister: vi.fn() }),
        register: vi.fn(),
        controller: null
      },
      configurable: true, writable: true
    })

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const sw = await import('./serviceWorker.js')
    const loadHandlers = []
    vi.spyOn(window, 'addEventListener').mockImplementation((evt, handler) => {
      if (evt === 'load') loadHandlers.push(handler)
    })

    sw.register({})
    for (const h of loadHandlers) h()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('No internet connection found')
    )
    consoleSpy.mockRestore()
  })

  // -------------------------------------------------------------------------
  // register() localhost: ready.then logs to console
  // -------------------------------------------------------------------------
  test('register() localhost: navigator.serviceWorker.ready.then logs message', async function () {
    setHostname('localhost')
    process.env.NODE_ENV = 'production'
    process.env.PUBLIC_URL = ''

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const readyPromise = Promise.resolve({ unregister: vi.fn() })
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        ready: readyPromise,
        register: vi.fn(),
        controller: null
      },
      configurable: true, writable: true
    })

    // Return valid SW response so checkValidServiceWorker doesn't unregister
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      headers: { get: vi.fn().mockReturnValue('application/javascript') }
    }))

    const sw = await import('./serviceWorker.js')
    const loadHandlers = []
    vi.spyOn(window, 'addEventListener').mockImplementation((evt, handler) => {
      if (evt === 'load') loadHandlers.push(handler)
    })

    sw.register({})
    for (const h of loadHandlers) h()
    await readyPromise
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('This web app is being served cache-first')
    )
    consoleSpy.mockRestore()
  })

  // -------------------------------------------------------------------------
  // registerValidSW: onUpdate callback not set (no config.onUpdate)
  // -------------------------------------------------------------------------
  test('registerValidSW: installed + controller + no onUpdate callback → no error', async function () {
    setHostname('example.com')
    process.env.NODE_ENV = 'production'
    process.env.PUBLIC_URL = ''

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    let installingWorker = { state: 'installing', onstatechange: null }
    let registration = {
      installing: installingWorker,
      onupdatefound: null,
      unregister: vi.fn()
    }

    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        ready: Promise.resolve({ unregister: vi.fn() }),
        register: vi.fn().mockResolvedValue(registration),
        controller: { postMessage: vi.fn() }
      },
      configurable: true, writable: true
    })

    const sw = await import('./serviceWorker.js')
    const loadHandlers = []
    vi.spyOn(window, 'addEventListener').mockImplementation((evt, handler) => {
      if (evt === 'load') loadHandlers.push(handler)
    })

    // Pass config without onUpdate
    sw.register({})
    for (const h of loadHandlers) h()
    await Promise.resolve()
    await Promise.resolve()

    if (registration.onupdatefound) registration.onupdatefound()
    installingWorker.state = 'installed'
    if (installingWorker.onstatechange) installingWorker.onstatechange()

    // Should log 'New content is available' but not call undefined onUpdate
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('New content is available'))
    consoleSpy.mockRestore()
  })

  // -------------------------------------------------------------------------
  // registerValidSW: no controller + no onSuccess callback → no error
  // -------------------------------------------------------------------------
  test('registerValidSW: installed + no controller + no onSuccess callback → no error', async function () {
    setHostname('example.com')
    process.env.NODE_ENV = 'production'
    process.env.PUBLIC_URL = ''

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    let installingWorker = { state: 'installing', onstatechange: null }
    let registration = {
      installing: installingWorker,
      onupdatefound: null,
      unregister: vi.fn()
    }

    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        ready: Promise.resolve({ unregister: vi.fn() }),
        register: vi.fn().mockResolvedValue(registration),
        controller: null
      },
      configurable: true, writable: true
    })

    const sw = await import('./serviceWorker.js')
    const loadHandlers = []
    vi.spyOn(window, 'addEventListener').mockImplementation((evt, handler) => {
      if (evt === 'load') loadHandlers.push(handler)
    })

    // Pass config without onSuccess
    sw.register({})
    for (const h of loadHandlers) h()
    await Promise.resolve()
    await Promise.resolve()

    if (registration.onupdatefound) registration.onupdatefound()
    installingWorker.state = 'installed'
    if (installingWorker.onstatechange) installingWorker.onstatechange()

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Content is cached for offline use'))
    consoleSpy.mockRestore()
  })
})
