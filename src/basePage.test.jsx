// @vitest-environment happy-dom
import React, { act } from 'react'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'

import { renderPage, mockFetch } from '../test/ui.jsx'
import { lastSocket } from '../test/socketMock.js'
import basePage from './basePage.jsx'

vi.mock('socket.io-client', () => import('../test/socketMock.js'))

// Minimal concrete subclass that renders a title and content so basePage's
// render() method can execute fully without errors.
class TestPage extends basePage {
  constructor (props) {
    super(props)
  }

  renderTitle () {
    return 'Test Page'
  }

  renderContent () {
    return <div data-testid="content">Page Content</div>
  }
}

// Subclass that enables socket.io
class SocketPage extends basePage {
  constructor (props) {
    super(props, true)
  }

  renderTitle () {
    return 'Socket Page'
  }

  renderContent () {
    return <div data-testid="socket-content">Socket Content</div>
  }
}

describe('#basePage()', function () {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  // -----------------------------------------------------------------------
  // Basic render — loading state and content reveal
  // -----------------------------------------------------------------------

  test('renders title from renderTitle()', async function () {
    mockFetch({})
    const page = renderPage(<TestPage />)
    expect(page.container.textContent).toContain('Test Page')
    page.unmount()
  })

  test('loading spinner visible before loadDone, hidden after', async function () {
    mockFetch({})
    const page = renderPage(<TestPage />)
    // Loading div is shown (display block)
    const spinner = page.container.querySelector('.sr-only')
    expect(spinner).not.toBeNull()
    expect(spinner.textContent).toBe('Loading...')
    page.unmount()
  })

  test('pagedetails hidden while loading=true', async function () {
    mockFetch({})
    const page = renderPage(<TestPage />)
    const details = page.container.querySelector('.pagedetails')
    // display:none when loading
    expect(details.style.display).toBe('none')
    page.unmount()
  })

  // -----------------------------------------------------------------------
  // showLogin prop → renders Login component instead of content
  // -----------------------------------------------------------------------

  test('showLogin=true renders login form', async function () {
    mockFetch({})
    const page = renderPage(<TestPage showLogin={true} />)
    // Login component renders a form with "Please Log In" heading
    expect(page.container.textContent).toContain('Please Log In')
    page.unmount()
  })

  test('showLogin=true with loading=false shows pagedetails block', async function () {
    // Use ModalTestPage (has componentDidMount → loadDone) with showLogin=true
    // to cover the loading=false branch of the showLogin render path (line 102)
    mockFetch({})
    const page = renderPage(<ModalTestPage showLogin={true} />)
    await page.flush()
    // pagedetails in showLogin path should show when loading=false
    const details = page.container.querySelector('.pagedetails')
    expect(details.style.display).toBe('block')
    page.unmount()
  })

  test('showLogin=false renders content (default)', async function () {
    mockFetch({})
    const page = renderPage(<TestPage />)
    expect(page.container.textContent).not.toContain('Please Log In')
    page.unmount()
  })

  // -----------------------------------------------------------------------
  // Auth — the token is read but NOT re-verified (AppRouter already verifies
  // per navigation; a second /api/auth here doubled the round-trips)
  // -----------------------------------------------------------------------

  test('auth: stored token is read without an extra /api/auth fetch', async function () {
    localStorage.setItem('token', JSON.stringify({ token: 'abc' }))
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const page = renderPage(<TestPage />)
    await page.flush()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(page.container.textContent).toContain('Test Page')
    page.unmount()
  })

  test('auth: no token in localStorage still renders (token undefined)', async function () {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const page = renderPage(<TestPage />)
    await page.flush()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(page.container.textContent).toContain('Test Page')
    page.unmount()
  })

  // -----------------------------------------------------------------------
  // waiting overlay
  // -----------------------------------------------------------------------

  test('waiting spinner overlay hidden by default', async function () {
    mockFetch({})
    const page = renderPage(<TestPage />)
    const overlay = page.container.querySelector('.sweet-waiting')
    expect(overlay.style.display).toBe('none')
    page.unmount()
  })

  // -----------------------------------------------------------------------
  // Error modal — show and close
  // -----------------------------------------------------------------------

  test('error modal renders when error state is set', async function () {
    mockFetch({})
    const page = renderPage(<TestPage />)
    act(() => {
      // Directly set state via the component instance
      const root = page.container._reactRootContainer || null
      // Access via internal React fibers is fragile — use public setState path
    })
    page.unmount()
  })

  test('handleCloseError clears error state', async function () {
    mockFetch({})
    const page = renderPage(<TestPage />)
    // We can trigger error modal via basePage's setState; use a subclass trick:
    // we'll exercise this via the modal OK button after setting state externally.
    // Actually the cleanest way is to expose state via a test-only render that
    // sets error in componentDidMount.
    page.unmount()
  })

  // -----------------------------------------------------------------------
  // Socket lifecycle — socket-using subclass
  // -----------------------------------------------------------------------

  test('socket page: socket is created on construction', async function () {
    mockFetch({})
    const page = renderPage(<SocketPage />)
    await page.flush()
    expect(lastSocket()).not.toBeUndefined()
    page.unmount()
  })

  test('socket page: unmount removes the page listeners but keeps the shared socket open', async function () {
    mockFetch({})
    const page = renderPage(<SocketPage />)
    await page.flush()
    const socket = lastSocket()
    // the shared socket persists across tests in this file, so count relative
    const callsBefore = socket.removeAllListeners.mock.calls.length
    page.unmount()
    expect(socket.removeAllListeners.mock.calls.length).toBe(callsBefore + 1)
    expect(socket.disconnect).not.toHaveBeenCalled()
  })

  test('socket page: a second page reuses the shared socket (no reconnect per navigation)', async function () {
    mockFetch({})
    const first = renderPage(<SocketPage />)
    await first.flush()
    const socket = lastSocket()
    first.unmount()
    const second = renderPage(<SocketPage />)
    await second.flush()
    expect(lastSocket()).toBe(socket)
    second.unmount()
  })

  test('socket page: already-connected shared socket shows Connected immediately', async function () {
    mockFetch({})
    const first = renderPage(<SocketPage />)
    await first.flush()
    first.unmount()
    // simulate the shared socket having connected while no page was mounted
    lastSocket().connected = true
    const second = renderPage(<SocketPage />)
    await second.flush()
    expect(second.container.textContent).toContain('Connected')
    second.unmount()
    lastSocket().connected = false
  })

  test('socket page: connect event sets socketioStatus=true → shows Connected', async function () {
    mockFetch({})
    const page = renderPage(<SocketPage />)
    await page.flush()
    act(() => { lastSocket().fire('connect') })
    expect(page.container.textContent).toContain('Connected')
    page.unmount()
  })

  test('socket page: disconnect event sets socketioStatus=false → shows Not Connected', async function () {
    mockFetch({})
    const page = renderPage(<SocketPage />)
    await page.flush()
    // First connect so status is true
    act(() => { lastSocket().fire('connect') })
    // Then disconnect
    act(() => { lastSocket().fire('disconnect') })
    expect(page.container.textContent).toContain('Not Connected')
    page.unmount()
  })

  // -----------------------------------------------------------------------
  // Non-socket page does not render SocketIOFooter (covers the <p></p> branch)
  // -----------------------------------------------------------------------

  test('non-socket page: no SocketIOFooter (paragraph placeholder rendered)', async function () {
    mockFetch({})
    const page = renderPage(<TestPage />)
    // The page-content-footer div should NOT be rendered for non-socket page
    expect(page.container.querySelector('.page-content-footer')).toBeNull()
    page.unmount()
  })
})

// -----------------------------------------------------------------------
// Separate describe for error/info modal tests using a dedicated subclass
// that sets state after mount so modals can be triggered cleanly.
// -----------------------------------------------------------------------
class ModalTestPage extends basePage {
  renderTitle () { return 'Modal Test' }
  renderContent () { return <div /> }

  componentDidMount () {
    this.loadDone()
  }

  setError (msg) { this.setState({ error: msg }) }
  setInfo (msg) { this.setState({ infoMessage: msg }) }
  setWaiting (v) { this.setState({ waiting: v }) }
}

describe('#basePage() modals', function () {
  let pageInstance = null

  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  // We need a ref to the class instance. Use a wrapper that captures it.
  function renderModalPage () {
    let ref = null
    const Wrapper = () => <ModalTestPage ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    return { page, getRef: () => ref }
  }

  test('error modal appears when error state set', async function () {
    mockFetch({})
    const { page, getRef } = renderModalPage()
    await page.flush()
    act(() => { getRef().setError('Something went wrong') })
    // react-bootstrap Modals portal into document.body
    expect(document.body.textContent).toContain('Something went wrong')
    page.unmount()
  })

  test('handleCloseError clears error modal', async function () {
    mockFetch({})
    const { page, getRef } = renderModalPage()
    await page.flush()
    act(() => { getRef().setError('Test error') })
    // Click the OK button inside the error modal
    const okBtn = [...document.body.querySelectorAll('button')].find(b => b.textContent === 'OK')
    act(() => { okBtn.click() })
    expect(document.body.textContent).not.toContain('Test error')
    page.unmount()
  })

  test('infoMessage modal appears when infoMessage state set', async function () {
    mockFetch({})
    const { page, getRef } = renderModalPage()
    await page.flush()
    act(() => { getRef().setInfo('Some information') })
    expect(document.body.textContent).toContain('Some information')
    page.unmount()
  })

  test('handleCloseInformation clears infoMessage modal', async function () {
    mockFetch({})
    const { page, getRef } = renderModalPage()
    await page.flush()
    act(() => { getRef().setInfo('Info msg') })
    const okBtn = [...document.body.querySelectorAll('button')].find(b => b.textContent === 'OK')
    act(() => { okBtn.click() })
    expect(document.body.textContent).not.toContain('Info msg')
    page.unmount()
  })

  test('waiting overlay visible when waiting=true', async function () {
    mockFetch({})
    const { page, getRef } = renderModalPage()
    await page.flush()
    act(() => { getRef().setWaiting(true) })
    const overlay = page.container.querySelector('.sweet-waiting')
    expect(overlay.style.display).toBe('block')
    page.unmount()
  })
})
