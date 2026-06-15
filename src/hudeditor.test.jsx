// @vitest-environment happy-dom
import React, { act } from 'react'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'

import { renderPage, mockFetch } from '../test/ui.jsx'
import HudEditorPage from './hudeditor.jsx'

vi.mock('socket.io-client', () => import('../test/socketMock.js'))

// catalog has 'extracat' with no matching element; elements has 'extrael' not in
// the catalog and a disabled 'gps' — exercises the fallback branches.
const catalog = [
  { type: 'horizon', section: 'Attitude', label: 'Artificial Horizon', sample: '' },
  { type: 'compass', section: 'Attitude', label: 'Compass Tape', sample: '' },
  { type: 'alt', section: 'Altitude & Speed', label: 'Altitude (MSL)', sample: '124m' },
  { type: 'gps', section: 'Position & GPS', label: 'GPS', sample: '3D/11' },
  { type: 'extracat', section: 'Position & GPS', label: 'Extra Cat', sample: '' }
]
const elements = [
  { type: 'horizon', enabled: true, x: 0.5, y: 0.5, icon: false },
  { type: 'compass', enabled: true, x: 0.5, y: 0.1, icon: false },
  { type: 'alt', enabled: true, x: 0.8, y: 0.1, icon: true },
  { type: 'gps', enabled: false, x: 0.1, y: 0.9, icon: true },
  { type: 'extrael', enabled: true, x: 0.2, y: 0.2, icon: false }
]

function fetchWith (extra = {}) {
  return mockFetch({ '/api/hudlayout': { layout: { elements }, elements: catalog }, ...extra })
}

function renderEd (setup) {
  setup()
  let ref = null
  const page = renderPage(<HudEditorPage ref={(r) => { ref = r }} />)
  return { page, getRef: () => ref }
}

function findButton (page, text) {
  return [...page.container.querySelectorAll('button')].find(b => b.textContent.includes(text))
}

describe('#HudEditorPage()', function () {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

  test('renders the canvas, chips for enabled elements, and the palette', async function () {
    const { page } = renderEd(() => fetchWith())
    await page.flush()
    expect(page.container.textContent).toContain('HUD Editor')
    // enabled chips: horizon, compass, alt, extrael — gps is disabled so no chip
    expect(page.container.textContent).toContain('⊕ horizon')
    expect(page.container.textContent).toContain('⊕ compass') // graphic element chip
    expect(page.container.textContent).toContain('◈ Altitude (MSL)') // alt has icon → ◈ prefix + catalog label
    expect(page.container.textContent).toContain('extrael') // sampleFor fallback (type, not in catalog)
    // palette grouped into sections, with rows from the catalog
    expect(page.container.textContent).toContain('Attitude')
    expect(page.container.textContent).toContain('Position & GPS')
    expect(page.container.textContent).toContain('Extra Cat')
    expect(page.container.textContent).toContain('Artificial Horizon')
    page.unmount()
  })

  test('toggling Show and Icon via the palette checkboxes updates the element', async function () {
    const { page, getRef } = renderEd(() => fetchWith())
    await page.flush()
    // rows with a checkbox are element rows (section headers have none)
    const rows = [...page.container.querySelectorAll('tbody tr')].filter(r => r.querySelector('input[type="checkbox"]'))
    const gpsRow = rows.find(r => r.textContent.includes('GPS'))
    act(() => { gpsRow.querySelectorAll('input[type="checkbox"]')[0].click() }) // Show
    expect(getRef().getEl('gps').enabled).toBe(true)
    const altRow = rows.find(r => r.textContent.includes('Altitude'))
    act(() => { altRow.querySelectorAll('input[type="checkbox"]')[1].click() }) // Icon
    expect(getRef().getEl('alt').icon).toBe(false)
    page.unmount()
  })

  test('dragging an element updates its fractional position (clamped)', async function () {
    const { page, getRef } = renderEd(() => fetchWith())
    await page.flush()
    getRef().canvasRef.current.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 500 })
    act(() => { getRef().startDrag('alt')({ preventDefault () {} }) })
    expect(getRef().state.dragType).toBe('alt')
    act(() => { getRef().handleMove({ clientX: 500, clientY: 250 }) })
    expect(getRef().getEl('alt').x).toBeCloseTo(0.5)
    expect(getRef().getEl('alt').y).toBeCloseTo(0.5)
    // clamp beyond the edges
    act(() => { getRef().handleMove({ clientX: 5000, clientY: -100 }) })
    expect(getRef().getEl('alt').x).toBe(1)
    expect(getRef().getEl('alt').y).toBe(0)
    act(() => { getRef().endDrag() })
    expect(getRef().state.dragType).toBe(null)
    page.unmount()
  })

  test('move is a no-op when not dragging or with no canvas', async function () {
    const { page, getRef } = renderEd(() => fetchWith())
    await page.flush()
    const before = { ...getRef().getEl('alt') }
    act(() => { getRef().endDrag() }) // endDrag with no active drag is a no-op
    act(() => { getRef().handleMove({ clientX: 100, clientY: 100 }) }) // dragType null
    expect(getRef().getEl('alt')).toEqual(before)
    // dragging but canvas missing
    act(() => { getRef().startDrag('alt')({ preventDefault () {} }) })
    getRef().canvasRef = { current: null }
    act(() => { getRef().handleMove({ clientX: 100, clientY: 100 }) })
    act(() => { getRef().endDrag() })
    expect(getRef().getEl('alt')).toEqual(before)
    page.unmount()
  })

  test('Save posts the layout and shows a message', async function () {
    const fetch = fetchWith({ 'POST /api/hudlayout': { layout: { elements }, error: null } })
    let ref = null
    const page = renderPage(<HudEditorPage ref={(r) => { ref = r }} />)
    await page.flush()
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    act(() => { findButton(page, 'Save Layout').click() })
    await page.flush()
    expect(fetch).toHaveBeenCalledWith('/api/hudlayout', expect.objectContaining({ method: 'POST' }))
    expect(page.container.textContent).toContain('Layout saved')
    act(() => { vi.advanceTimersByTime(4000) })
    expect(page.container.textContent).not.toContain('Layout saved')
    vi.useRealTimers()
    page.unmount()
  })

  test('Save failure is caught', async function () {
    const { page } = renderEd(() => fetchWith({ 'POST /api/hudlayout': () => { throw new Error('net') } }))
    await page.flush()
    act(() => { findButton(page, 'Save Layout').click() })
    await page.flush()
    expect(page.container.textContent).toContain('Could not save layout')
    page.unmount()
  })

  test('Reset to Defaults posts an empty layout and applies the result', async function () {
    const resetElements = [{ type: 'horizon', enabled: true, x: 0.5, y: 0.5, icon: false }]
    const fetch = fetchWith({ 'POST /api/hudlayout': { layout: { elements: resetElements }, error: null } })
    let ref = null
    const page = renderPage(<HudEditorPage ref={(r) => { ref = r }} />)
    await page.flush()
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    act(() => { findButton(page, 'Reset to Defaults').click() })
    await page.flush()
    const call = fetch.mock.calls.find(c => c[0] === '/api/hudlayout' && c[1] && c[1].method === 'POST')
    expect(JSON.parse(call[1].body).layout.elements).toEqual([])
    expect(page.container.textContent).toContain('Reset to defaults')
    expect(ref.state.elements.length).toBe(1)
    act(() => { vi.advanceTimersByTime(4000) })
    expect(page.container.textContent).not.toContain('Reset to defaults')
    vi.useRealTimers()
    page.unmount()
  })

  test('Save and Reset tolerate a response with no layout (elements unchanged)', async function () {
    const { page, getRef } = renderEd(() => fetchWith({ 'POST /api/hudlayout': { error: null } }))
    await page.flush()
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const n = getRef().state.elements.length
    act(() => { findButton(page, 'Save Layout').click() })
    await page.flush()
    expect(getRef().state.elements.length).toBe(n) // kept (no layout in response)
    act(() => { findButton(page, 'Reset to Defaults').click() })
    await page.flush()
    expect(getRef().state.elements.length).toBe(n)
    act(() => { vi.advanceTimersByTime(4000) })
    vi.useRealTimers()
    page.unmount()
  })

  test('Reset failure is caught', async function () {
    const { page } = renderEd(() => fetchWith({ 'POST /api/hudlayout': () => { throw new Error('net') } }))
    await page.flush()
    act(() => { findButton(page, 'Reset to Defaults').click() })
    await page.flush()
    expect(page.container.textContent).toContain('Could not reset layout')
    page.unmount()
  })

  test('tolerates a layout response missing keys', async function () {
    let ref = null
    mockFetch({ '/api/hudlayout': {} })
    const page = renderPage(<HudEditorPage ref={(r) => { ref = r }} />)
    await page.flush()
    expect(ref.state.elements).toEqual([])
    expect(ref.state.catalog).toEqual([])
    page.unmount()
  })
})
