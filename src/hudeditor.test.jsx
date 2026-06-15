// @vitest-environment happy-dom
import React, { act } from 'react'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'

import { renderPage, mockFetch } from '../test/ui.jsx'
import HudEditorPage from './hudeditor.jsx'

vi.mock('socket.io-client', () => import('../test/socketMock.js'))

// catalog has 'extracat' with no matching element; elements has 'extrael' not in
// the catalog and a disabled 'gps' — exercises the fallback branches. Graphic
// elements (horizon/compass/homeDir) carry graphic:true; numeric ones carry a
// `mock` string shown on the chip.
const catalog = [
  { type: 'horizon', section: 'Attitude', label: 'Artificial Horizon', mock: '', graphic: true },
  { type: 'compass', section: 'Attitude', label: 'Compass Tape', mock: '', graphic: true },
  { type: 'alt', section: 'Altitude & Speed', label: 'Altitude (MSL)', mock: 'ALT 124m', graphic: false },
  { type: 'gps', section: 'Position & GPS', label: 'GPS', mock: 'GPS 3D/11', graphic: false },
  { type: 'homeDir', section: 'Navigation', label: 'Direction to Home', mock: '', graphic: true },
  { type: 'modemFix', section: 'Modem GPS', label: 'Modem GPS Fix', mock: 'mGPS OK', graphic: false },
  { type: 'extracat', section: 'Modem GPS', label: 'Extra Cat', mock: '', graphic: false }
]
const elements = [
  { type: 'horizon', enabled: true, x: 0.5, y: 0.5, icon: false },
  { type: 'compass', enabled: true, x: 0.5, y: 0.1, icon: false },
  { type: 'alt', enabled: true, x: 0.8, y: 0.1, icon: true, color: '#ff0000' },
  { type: 'gps', enabled: false, x: 0.1, y: 0.9, icon: true },
  { type: 'homeDir', enabled: true, x: 0.6, y: 0.8, icon: false },
  { type: 'modemFix', enabled: true, x: 0.4, y: 0.3, icon: true },
  { type: 'extrael', enabled: true, x: 0.2, y: 0.2, icon: false }
]
const global = { font: 'monospace', size: 34, color: '#ffffff' }
const fonts = ['monospace', 'sans-serif', 'serif']

function fetchWith (extra = {}) {
  return mockFetch({ '/api/hudlayout': { layout: { global, elements }, elements: catalog, fonts }, ...extra })
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

function selectValue (select, value) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
    setter.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('#HudEditorPage()', function () {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

  test('renders the canvas with mock-data chips, graphic previews and the palette', async function () {
    const { page } = renderEd(() => fetchWith())
    await page.flush()
    expect(page.container.textContent).toContain('HUD Editor')
    // numeric chips show the mock value (WYSIWYG); alt has an icon → ◈ prefix
    expect(page.container.textContent).toContain('◈ ALT 124m')
    expect(page.container.textContent).toContain('◈ mGPS OK') // modem GPS chip
    expect(page.container.textContent).toContain('extrael') // catalogFor fallback (type, not in catalog)
    // graphic chips render shapes (no value text); the home arrow has its spin class
    expect(page.container.querySelector('.hud-home-arrow')).toBeTruthy()
    expect(page.container.querySelectorAll('[data-eltype="horizon"] svg').length).toBe(1)
    // global text style controls + palette sections
    expect(page.container.textContent).toContain('Global text style')
    expect(page.container.textContent).toContain('Attitude')
    expect(page.container.textContent).toContain('Modem GPS')
    expect(page.container.textContent).toContain('Artificial Horizon')
    // the palette preview column shows the mock value and a shape marker
    expect(page.container.textContent).toContain('⊕ shape')
    page.unmount()
  })

  test('toggling Show and Icon via the palette checkboxes updates the element', async function () {
    const { page, getRef } = renderEd(() => fetchWith())
    await page.flush()
    const rows = [...page.container.querySelectorAll('tbody tr')].filter(r => r.querySelector('input[type="checkbox"]'))
    const gpsRow = rows.find(r => r.textContent.includes('GPS'))
    act(() => { gpsRow.querySelectorAll('input[type="checkbox"]')[0].click() }) // Show
    expect(getRef().getEl('gps').enabled).toBe(true)
    const altRow = rows.find(r => r.textContent.includes('Altitude'))
    act(() => { altRow.querySelectorAll('input[type="checkbox"]')[1].click() }) // Icon
    expect(getRef().getEl('alt').icon).toBe(false)
    page.unmount()
  })

  test('clicking a palette row selects an element for styling', async function () {
    const { page, getRef } = renderEd(() => fetchWith())
    await page.flush()
    const rows = [...page.container.querySelectorAll('tbody tr')].filter(r => r.querySelector('input[type="checkbox"]'))
    const altRow = rows.find(r => r.textContent.includes('Altitude'))
    act(() => { altRow.click() })
    expect(getRef().state.selectedType).toBe('alt')
    page.unmount()
  })

  test('global text style controls update the global style', async function () {
    const { page, getRef } = renderEd(() => fetchWith())
    await page.flush()
    selectValue(page.container.querySelector('[data-testid="global-font"]'), 'serif')
    expect(getRef().state.global.font).toBe('serif')
    page.setValue(page.container.querySelector('[data-testid="global-size"]'), '40')
    expect(getRef().state.global.size).toBe(40)
    page.setValue(page.container.querySelector('[data-testid="global-size"]'), '')
    expect(getRef().state.global.size).toBe('')
    page.setValue(page.container.querySelector('[data-testid="global-color"]'), '#00ff00')
    expect(getRef().state.global.color).toBe('#00ff00')
    page.unmount()
  })

  test('per-element style overrides: font, size and colour, then "Use global" clears them', async function () {
    const { page, getRef } = renderEd(() => fetchWith())
    await page.flush()
    // no selection → prompt to pick an element
    expect(page.container.textContent).toContain('Click an element')
    // a graphic element has no text style
    act(() => { getRef().setState({ selectedType: 'horizon' }) })
    expect(page.container.textContent).toContain('graphic elements have no text style')
    // select alt (a text element with a colour override from the fixture)
    act(() => { getRef().setState({ selectedType: 'alt' }) })
    selectValue(page.container.querySelector('[data-testid="el-font"]'), 'sans-serif')
    expect(getRef().getEl('alt').font).toBe('sans-serif')
    page.setValue(page.container.querySelector('[data-testid="el-size"]'), '50')
    expect(getRef().getEl('alt').size).toBe(50)
    // clearing the size input removes the override
    page.setValue(page.container.querySelector('[data-testid="el-size"]'), '')
    expect('size' in getRef().getEl('alt')).toBe(false)
    // colour override: the fixture set #ff0000 so the checkbox starts ticked — untick removes it
    const colorOn = page.container.querySelector('[data-testid="el-color-on"]')
    act(() => { colorOn.click() })
    expect('color' in getRef().getEl('alt')).toBe(false)
    // re-tick re-adds it (defaults to the global colour), then change it
    act(() => { page.container.querySelector('[data-testid="el-color-on"]').click() })
    expect(getRef().getEl('alt').color).toBeDefined()
    page.setValue(page.container.querySelector('[data-testid="el-color"]'), '#00ff00')
    expect(getRef().getEl('alt').color).toBe('#00ff00')
    // "Use global" strips every override
    act(() => { findButton(page, 'Use global').click() })
    const alt = getRef().getEl('alt')
    expect('font' in alt || 'size' in alt || 'color' in alt).toBe(false)
    page.unmount()
  })

  test('style panel tolerates a selected catalog element with no layout entry', async function () {
    const { page, getRef } = renderEd(() => fetchWith())
    await page.flush()
    act(() => { getRef().setState({ selectedType: 'extracat' }) }) // in catalog, no element
    expect(getRef().getEl('extracat')).toBeUndefined()
    expect(page.container.querySelector('[data-testid="el-font"]')).toBeTruthy() // renders with el={}
    page.unmount()
  })

  test('setElStyle drops a NaN numeric override', async function () {
    const { page, getRef } = renderEd(() => fetchWith())
    await page.flush()
    act(() => { getRef().setElStyle('alt', 'size', 44) })
    expect(getRef().getEl('alt').size).toBe(44)
    act(() => { getRef().setElStyle('alt', 'size', NaN) })
    expect('size' in getRef().getEl('alt')).toBe(false)
    page.unmount()
  })

  test('dragging an element updates its fractional position (clamped) and selects it', async function () {
    const { page, getRef } = renderEd(() => fetchWith())
    await page.flush()
    getRef().canvasRef.current.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 500 })
    act(() => { getRef().startDrag('alt')({ preventDefault () {} }) })
    expect(getRef().state.dragType).toBe('alt')
    expect(getRef().state.selectedType).toBe('alt')
    act(() => { getRef().handleMove({ clientX: 500, clientY: 250 }) })
    expect(getRef().getEl('alt').x).toBeCloseTo(0.5)
    expect(getRef().getEl('alt').y).toBeCloseTo(0.5)
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
    act(() => { getRef().endDrag() })
    act(() => { getRef().handleMove({ clientX: 100, clientY: 100 }) })
    expect(getRef().getEl('alt')).toEqual(before)
    act(() => { getRef().startDrag('alt')({ preventDefault () {} }) })
    getRef().canvasRef = { current: null }
    act(() => { getRef().handleMove({ clientX: 100, clientY: 100 }) })
    act(() => { getRef().endDrag() })
    expect(getRef().getEl('alt')).toEqual(before)
    page.unmount()
  })

  test('Save posts the layout (with global style) and shows a message', async function () {
    const fetch = fetchWith({ 'POST /api/hudlayout': { layout: { global, elements }, error: null } })
    let ref = null
    const page = renderPage(<HudEditorPage ref={(r) => { ref = r }} />)
    await page.flush()
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    act(() => { findButton(page, 'Save Layout').click() })
    await page.flush()
    expect(fetch).toHaveBeenCalledWith('/api/hudlayout', expect.objectContaining({ method: 'POST' }))
    const call = fetch.mock.calls.find(c => c[0] === '/api/hudlayout' && c[1] && c[1].method === 'POST')
    expect(JSON.parse(call[1].body).layout.global).toBeDefined()
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
    const fetch = fetchWith({ 'POST /api/hudlayout': { layout: { global, elements: resetElements }, error: null } })
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
    expect(getRef().state.elements.length).toBe(n)
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
    // falls back to the built-in fonts + default global style
    expect(ref.state.fonts).toContain('monospace')
    expect(ref.state.global.font).toBe('monospace')
    page.unmount()
  })
})
