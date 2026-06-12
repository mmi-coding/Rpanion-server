import { vi } from 'vitest'

/*
 * socket.io-client mock — see docs/TESTING.md.
 *
 * basePage.jsx does `import io from 'socket.io-client'` and calls `io(...)`
 * in its constructor. Mock the module with:
 *
 *   vi.mock('socket.io-client', () => import('../test/socketMock.js'))
 *
 * then drive server-push events from the test:
 *
 *   import { lastSocket } from '../test/socketMock.js'
 *   act(() => { lastSocket().fire('LTEStatus', { ... }) })
 */

const sockets = []

export function lastSocket () {
  return sockets[sockets.length - 1]
}

export function allSockets () {
  return sockets
}

export default function io () {
  const handlers = {}
  const socket = {
    on: vi.fn((event, cb) => {
      if (handlers[event] === undefined) {
        handlers[event] = []
      }
      handlers[event].push(cb)
    }),
    emit: vi.fn(),
    disconnect: vi.fn(),
    // test-side: invoke every handler registered for `event`
    fire: (event, ...args) => {
      for (const cb of handlers[event] || []) {
        cb(...args)
      }
    }
  }
  sockets.push(socket)
  return socket
}
