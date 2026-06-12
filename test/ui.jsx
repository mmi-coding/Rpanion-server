import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { vi } from 'vitest'

/*
 * Frontend test helpers — see docs/TESTING.md.
 *
 * The upstream "renders without crashing" tests never flush React's
 * concurrent rendering, so they execute almost none of the page code. These
 * helpers render for real (act()), mock fetch per-route, and pair with
 * test/socketMock.js for pages that use socket.io.
 */

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Render an element into a fresh container attached to the document.
// Returns helpers; always call .unmount() at the end of the test.
export function renderPage (element) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(element) })
  return {
    container,
    // settle pending promises (fetch responses) and re-render
    flush: async () => { await act(async () => {}) },
    // click a node with React event handling flushed
    click: (el) => { act(() => { el.click() }) },
    // set a controlled input's value and fire React's onChange
    setValue: (input, value) => {
      act(() => {
        const proto = Object.getPrototypeOf(input)
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
        setter.call(input, String(value))
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    },
    // submit a <form> element through React's onSubmit
    submit: (form) => {
      act(() => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      })
    },
    unmount: () => {
      act(() => { root.unmount() })
      container.remove()
    }
  }
}

// Stub global fetch. `routes` maps "METHOD /api/path" (or just "/api/path"
// for GET) to a response body, or to a function (url, opts) => body.
// Unhandled requests throw, so tests fail loudly on unexpected calls.
// Returns the stub for call assertions; vitest restores it via
// vi.unstubAllGlobals() in afterEach.
export function mockFetch (routes) {
  const stub = vi.fn(async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase()
    const handler = routes[`${method} ${url}`] !== undefined ? routes[`${method} ${url}`] : routes[url]
    if (handler === undefined) {
      throw new Error(`mockFetch: unhandled request ${method} ${url}`)
    }
    const body = typeof handler === 'function' ? await handler(url, opts) : handler
    return {
      ok: true,
      status: 200,
      json: async () => body
    }
  })
  vi.stubGlobal('fetch', stub)
  return stub
}
