// @vitest-environment happy-dom
import React, { act } from 'react'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'

/*
 * index.jsx — module-side-effect bootstrap
 *
 * The module does:
 *   1. document.getElementById('root') → createRoot(container).render(...)
 *   2. serviceWorker.unregister()
 *
 * Strategy:
 *   - Insert <div id="root"> into document.body before import
 *   - Stub navigator.serviceWorker so unregister() doesn't throw
 *   - Stub fetch for POST /api/auth (AppRouter fires on mount)
 *   - Dynamic import inside act() — module evaluates once per vi.resetModules()
 */

vi.mock('socket.io-client', () => import('../test/socketMock.js'))

describe('#index.jsx bootstrap', function () {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    localStorage.clear()
    // Clean up the root div if present
    const root = document.getElementById('root')
    if (root) root.remove()
    // Clean up serviceWorker stub
    try { delete navigator.serviceWorker } catch (_) {}
  })

  test('index.jsx mounts AppRouter into #root and calls serviceWorker.unregister()', async function () {
    // 1. Provide the mount point
    const rootDiv = document.createElement('div')
    rootDiv.id = 'root'
    document.body.appendChild(rootDiv)

    // 2. Stub navigator.serviceWorker so unregister() works
    const unregister = vi.fn().mockResolvedValue(true)
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        ready: Promise.resolve({ unregister }),
        register: vi.fn()
      },
      configurable: true,
      writable: true
    })

    // 3. Stub fetch: AppRouter fires POST /api/auth on mount
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (method === 'POST' && url === '/api/auth') {
        return { ok: true, status: 200, json: async () => ({ authEnabled: true }) }
      }
      // Return ok for any other fetch (home page, etc.)
      return { ok: true, status: 200, json: async () => ({}) }
    }))

    // 4. Import the module — this triggers the side-effect render
    await act(async () => {
      await import('./index.jsx')
    })

    // 5. Settle React rendering
    await act(async () => {})

    // 6. Verify the app mounted (sidebar is rendered by AppRouter)
    expect(document.body.textContent).toContain('Rpanion Web UI')

    // 7. Verify serviceWorker.unregister was called (via ready.then)
    await navigator.serviceWorker.ready
    await Promise.resolve()
    expect(unregister).toHaveBeenCalled()
  })
})
