// @vitest-environment happy-dom
import { describe, test, expect, vi, afterEach } from 'vitest'

import { getAppSocket, closeAppSocket } from './appSocket.js'

vi.mock('socket.io-client', () => import('../test/socketMock.js'))

describe('#appSocket()', function () {
  afterEach(() => {
    closeAppSocket()
  })

  test('repeated calls with the same token return the same socket', function () {
    const a = getAppSocket('tok')
    const b = getAppSocket('tok')
    expect(b).toBe(a)
    expect(a.disconnect).not.toHaveBeenCalled()
  })

  test('a token change (login/logout) reconnects with the new credentials', function () {
    const a = getAppSocket('tok1')
    const b = getAppSocket('tok2')
    expect(b).not.toBe(a)
    expect(a.disconnect).toHaveBeenCalledTimes(1)
  })

  test('closeAppSocket disconnects, is idempotent, and a later call gets a fresh socket', function () {
    const a = getAppSocket('tok')
    closeAppSocket()
    expect(a.disconnect).toHaveBeenCalledTimes(1)
    closeAppSocket() // no socket: must be a no-op
    expect(a.disconnect).toHaveBeenCalledTimes(1)
    const b = getAppSocket('tok')
    expect(b).not.toBe(a)
  })
})
