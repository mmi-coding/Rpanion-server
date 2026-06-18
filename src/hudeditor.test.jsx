// @vitest-environment happy-dom
import React, { act } from 'react'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'

import { renderPage, mockFetch } from '../test/ui.jsx'
import { lastSocket } from '../test/socketMock.js'
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
const fontList = {
  generics: ['monospace', 'sans-serif', 'serif'],
  fonts: [
    { family: 'Oxanium', label: 'Oxanium — DJI / FPV OSD style', file: 'Oxanium-Medium.ttf', kind: 'curated' },
    { family: 'IBM Plex Mono', label: 'IBM Plex Mono', file: 'IBMPlexMono-Regular.ttf', kind: 'curated' },
    { family: 'My Upload', label: 'My Upload', file: 'My_Upload.ttf', kind: 'imported', id: 'My_Upload.ttf' }
  ]
}

const videoDevices = {
  devices: [
    { value: '/base/soc/i2c0mux/imx708@1a', label: 'IMX708 (CSI)', caps: [{ value: '1280x720xx-raw', width: 1280, height: 720, format: 'video/x-raw' }] },
    { value: '/dev/video2', caps: [{ width: 1920, height: 1080, format: 'video/x-h264' }, { width: 640, height: 480, format: 'image/jpeg' }] } // no label → shows its value
  ]
}

function fetchWith (extra = {}) {
  return mockFetch({
    '/api/hudlayout': { layout: { global, elements }, elements: catalog, horizon: { styles: ['ladder', 'line', 'ticks'], markers: ['wings', 'crosshair', 'dot', 'caret', 'drone'] } },
    '/api/hudfonts': fontList,
    '/api/videodevices': videoDevices,
    ...extra
  })
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
    // numeric chips show the mock value (WYSIWYG); alt/modemFix have icon:true → a
    // real glyph SVG drawn next to the value (ported from video-server.py)
    expect(page.container.textContent).toContain('ALT 124m')
    expect(page.container.querySelector('[data-eltype="alt"] svg.hud-icon')).toBeTruthy()
    expect(page.container.textContent).toContain('mGPS OK') // modem GPS chip
    expect(page.container.querySelector('[data-eltype="modemFix"] svg.hud-icon')).toBeTruthy()
    // an enabled element with icon:false draws no glyph
    expect(page.container.querySelector('[data-eltype="extrael"] svg.hud-icon')).toBeFalsy()
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

  test('renderIcon ports every video-server.py glyph group (plus a default)', async function () {
    const { page, getRef } = renderEd(() => fetchWith())
    await page.flush()
    // one representative type per _hud_icon() branch + an unknown type (default dot)
    const reps = ['batV', 'alt', 'climb', 'spd', 'rcRssi', 'windSpeed', 'homeDist', 'hdg', 'mode', 'gps', 'armed', 'somethingElse']
    for (const t of reps) {
      const svg = getRef().renderIcon(t)
      expect(svg).toBeTruthy()
      expect(svg.props.className).toBe('hud-icon') // a wrapped <svg> glyph
    }
    page.unmount()
  })

  test('icon colour + size are editable per element and drive the chip glyph', async function () {
    const { page, getRef } = renderEd(() => fetchWith())
    await page.flush()
    // alt has icon:true → the per-element panel exposes icon size + colour controls
    act(() => { getRef().setState({ selectedType: 'alt' }) })
    const scale = page.container.querySelector('[data-testid="el-iconscale"]')
    expect(scale).toBeTruthy()
    page.setValue(scale, '2')
    expect(getRef().getEl('alt').iconScale).toBe(2)
    // icon colour starts at the default (cyan, no override) → tick to override, then pick
    expect(getRef().getEl('alt').iconColor).toBeUndefined()
    act(() => { page.container.querySelector('[data-testid="el-iconcolor-on"]').click() })
    expect(getRef().getEl('alt').iconColor).toBe('#7fe9c8')
    page.setValue(page.container.querySelector('[data-testid="el-iconcolor"]'), '#ff8800')
    expect(getRef().getEl('alt').iconColor).toBe('#ff8800')
    // the chip's glyph reflects the chosen colour + 2× size (1.05 × 2 = 2.1em)
    const svg = page.container.querySelector('[data-eltype="alt"] svg.hud-icon')
    expect(svg.style.height).toBe('2.1em')
    expect(svg.querySelector('path').getAttribute('fill')).toBe('#ff8800')
    // unticking removes the override → back to the default cyan
    act(() => { page.container.querySelector('[data-testid="el-iconcolor-on"]').click() })
    expect('iconColor' in getRef().getEl('alt')).toBe(false)
    // setElIconScale clamps out-of-range and NaN
    act(() => { getRef().setElIconScale('alt', 9) }); expect(getRef().getEl('alt').iconScale).toBe(3)
    act(() => { getRef().setElIconScale('alt', 0.1) }); expect(getRef().getEl('alt').iconScale).toBe(0.5)
    act(() => { getRef().setElIconScale('alt', NaN) }); expect(getRef().getEl('alt').iconScale).toBe(1)
    // a text field with icon:false shows no icon controls
    act(() => { getRef().setState({ selectedType: 'extrael' }) })
    expect(page.container.querySelector('[data-testid="el-iconscale"]')).toBeFalsy()
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
    // a graphic element shows a size (scale) control, not text style
    act(() => { getRef().setState({ selectedType: 'horizon' }) })
    expect(page.container.textContent).toContain('graphic element')
    expect(page.container.querySelector('[data-testid="el-scale"]')).toBeTruthy()
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

  test('graphic elements have a size (scale) control that resizes the preview', async function () {
    const { page, getRef } = renderEd(() => fetchWith())
    await page.flush()
    act(() => { getRef().setState({ selectedType: 'horizon' }) })
    const range = page.container.querySelector('[data-testid="el-scale"]')
    expect(range).toBeTruthy()
    page.setValue(range, '3')
    expect(getRef().getEl('horizon').scale).toBe(3)
    // the horizon chip SVG grew with the scale (width = 90 × scale)
    expect(Number(page.container.querySelector('[data-eltype="horizon"] svg').getAttribute('width'))).toBeCloseTo(270)
    // setElScale clamps out-of-range and NaN
    act(() => { getRef().setElScale('horizon', 99) }); expect(getRef().getEl('horizon').scale).toBe(5)
    act(() => { getRef().setElScale('horizon', 0.1) }); expect(getRef().getEl('horizon').scale).toBe(0.5)
    act(() => { getRef().setElScale('horizon', NaN) }); expect(getRef().getEl('horizon').scale).toBe(1)
    // a graphic with no layout entry → the scale panel still renders (defaults)
    act(() => { getRef().setState({ selectedType: 'compass', elements: getRef().state.elements.filter(e => e.type !== 'compass') }) })
    expect(page.container.querySelector('[data-testid="el-scale"]')).toBeTruthy()
    page.unmount()
  })

  test('horizon: AHI style, aircraft marker and both colours are editable', async function () {
    const { page, getRef } = renderEd(() => fetchWith())
    await page.flush()
    act(() => { getRef().setState({ selectedType: 'horizon' }) })
    selectValue(page.container.querySelector('[data-testid="el-hstyle"]'), 'line')
    expect(getRef().getEl('horizon').style).toBe('line')
    selectValue(page.container.querySelector('[data-testid="el-marker"]'), 'drone')
    expect(getRef().getEl('horizon').marker).toBe('drone')
    page.setValue(page.container.querySelector('[data-testid="el-gcolor"]'), '#112233')
    expect(getRef().getEl('horizon').color).toBe('#112233')
    page.setValue(page.container.querySelector('[data-testid="el-mcolor"]'), '#445566')
    expect(getRef().getEl('horizon').markerColor).toBe('#445566')
    // the chip reflects the drone marker (rotor circles)
    expect(page.container.querySelector('[data-eltype="horizon"] svg').querySelectorAll('circle').length).toBeGreaterThan(0)
    page.unmount()
  })

  test('renderGraphic reflects every marker + style variant and the compass/home colour', async function () {
    const { page, getRef } = renderEd(() => fetchWith())
    await page.flush()
    for (const marker of ['wings', 'crosshair', 'dot', 'caret', 'drone']) {
      act(() => { getRef().updateEl('horizon', { marker }) })
      expect(page.container.querySelector('[data-eltype="horizon"] svg')).toBeTruthy()
    }
    act(() => { getRef().updateEl('horizon', { style: 'ticks' }) })
    act(() => { getRef().updateEl('horizon', { style: 'line' }) })
    // non-horizon graphics take a colour too
    act(() => { getRef().updateEl('compass', { color: '#abcdef' }) })
    act(() => { getRef().updateEl('homeDir', { color: '#fedcba' }) })
    expect(page.container.querySelector('[data-eltype="homeDir"] svg path[fill="#fedcba"]')).toBeTruthy()
    // a non-horizon graphic's panel has Size + Colour but no style/marker controls
    act(() => { getRef().setState({ selectedType: 'compass' }) })
    expect(page.container.querySelector('[data-testid="el-gcolor"]')).toBeTruthy()
    expect(page.container.querySelector('[data-testid="el-hstyle"]')).toBeFalsy()
    // the home arrow's panel renders too (covers the homeDir default-colour branch)
    act(() => { getRef().setState({ selectedType: 'homeDir' }) })
    expect(page.container.querySelector('[data-testid="el-gcolor"]')).toBeTruthy()
    page.unmount()
  })

  test('a malformed horizon-options response falls back to the built-in lists', async function () {
    const { page, getRef } = renderEd(() => fetchWith({ '/api/hudlayout': { layout: { global, elements }, elements: catalog, horizon: {} } }))
    await page.flush()
    expect(getRef().state.horizonOpts.styles).toContain('ladder') // kept the default
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

  test('tolerates a layout/fonts response missing keys', async function () {
    let ref = null
    mockFetch({ '/api/hudlayout': {}, '/api/hudfonts': {} })
    const page = renderPage(<HudEditorPage ref={(r) => { ref = r }} />)
    await page.flush()
    expect(ref.state.elements).toEqual([])
    expect(ref.state.catalog).toEqual([])
    // falls back to the built-in generic fonts + default global style
    expect(ref.state.fontList.generics).toContain('monospace')
    expect(ref.state.fontList.fonts).toEqual([])
    expect(ref.state.global.font).toBe('monospace')
    page.unmount()
  })

  test('font helpers tolerate a fontList missing its arrays', async function () {
    const { page, getRef } = renderEd(() => fetchWith())
    await page.flush()
    act(() => { getRef().setState({ fontList: {} }) })
    expect(getRef().fontOptions()).toEqual([])
    expect(getRef().fontFaceCss()).toBe('')
    page.unmount()
  })

  test('font dropdowns list generics + curated + imported, and @font-face is injected', async function () {
    const { page } = renderEd(() => fetchWith())
    await page.flush()
    const opts = [...page.container.querySelector('[data-testid="global-font"]').options].map(o => o.value)
    expect(opts).toContain('monospace')
    expect(opts).toContain('Oxanium') // curated DJI-style font
    expect(opts).toContain('My Upload') // imported
    // the DJI-style label is shown
    expect(page.container.textContent).toContain('Oxanium — DJI / FPV OSD style')
    // @font-face rules reference the served files so the preview matches the device
    const styleCss = [...page.container.querySelectorAll('style')].map(s => s.innerHTML).join('')
    expect(styleCss).toContain("@font-face")
    expect(styleCss).toContain('/api/hudfonts/file/Oxanium-Medium.ttf')
    page.unmount()
  })

  test('importing a font posts it and refreshes the list', async function () {
    const updated = { generics: fontList.generics, fonts: [...fontList.fonts, { family: 'New Font', label: 'New Font', file: 'New_Font.ttf', kind: 'imported', id: 'New_Font.ttf' }] }
    const fetch = fetchWith({ 'POST /api/hudfonts': { font: { family: 'New Font', file: 'New_Font.ttf', id: 'New_Font.ttf' }, fonts: updated, error: null } })
    let ref = null
    const page = renderPage(<HudEditorPage ref={(r) => { ref = r }} />)
    await page.flush()
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const input = page.container.querySelector('[data-testid="font-import"]')
    const file = new File([new Uint8Array([0, 1, 0, 0])], 'New Font.ttf', { type: 'font/ttf' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(fetch).toHaveBeenCalledWith('/api/hudfonts', expect.objectContaining({ method: 'POST' }))
    expect(ref.state.fontList.fonts.find(f => f.family === 'New Font')).toBeTruthy()
    expect(page.container.textContent).toContain('Imported font: New Font')
    act(() => { vi.advanceTimersByTime(4000) })
    vi.useRealTimers()
    page.unmount()
  })

  test('import surfaces a server error and a no-file change is a no-op', async function () {
    const { page, getRef } = renderEd(() => fetchWith({ 'POST /api/hudfonts': { error: 'Not a TrueType/OpenType font' } }))
    await page.flush()
    // selecting no file does nothing
    act(() => { getRef().importFont({ target: { files: [], value: '' } }) })
    expect(getRef().state.importing).toBe(false)
    // a rejected import shows the server error
    const input = page.container.querySelector('[data-testid="font-import"]')
    const file = new File([new Uint8Array([1, 2])], 'bad.ttf')
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(page.container.textContent).toContain('Not a TrueType/OpenType font')
    page.unmount()
  })

  test('import network failure is caught', async function () {
    const { page, getRef } = renderEd(() => fetchWith({ 'POST /api/hudfonts': () => { throw new Error('net') } }))
    await page.flush()
    await act(async () => { getRef().importFont({ target: { files: [new File([new Uint8Array([0, 1, 0, 0])], 'x.ttf')], value: '' } }) })
    expect(page.container.textContent).toContain('Could not import font')
    page.unmount()
  })

  test('removing an imported font calls DELETE and refreshes', async function () {
    const without = { generics: fontList.generics, fonts: fontList.fonts.filter(f => f.kind !== 'imported') }
    const { page, getRef } = renderEd(() => fetchWith({ 'DELETE /api/hudfonts/My_Upload.ttf': { fonts: without, error: null } }))
    await page.flush()
    const btn = page.container.querySelector('[data-testid="font-remove-My_Upload.ttf"]')
    expect(btn).toBeTruthy()
    await act(async () => { btn.click() })
    expect(getRef().state.fontList.fonts.find(f => f.kind === 'imported')).toBeFalsy()
    page.unmount()
  })

  test('remove tolerates a response without fonts, and a failure is caught', async function () {
    const { page, getRef } = renderEd(() => fetchWith({ 'DELETE /api/hudfonts/My_Upload.ttf': {} }))
    await page.flush()
    const n = getRef().state.fontList.fonts.length
    await act(async () => { getRef().removeFont('My_Upload.ttf') })
    expect(getRef().state.fontList.fonts.length).toBe(n) // unchanged (no fonts in response)
    // network failure path
    mockFetch({ 'DELETE /api/hudfonts/My_Upload.ttf': () => { throw new Error('net') } })
    await act(async () => { getRef().removeFont('My_Upload.ttf') })
    expect(getRef().state.error).toContain('Could not remove font')
    page.unmount()
  })

  test('the element palette is split into two columns', async function () {
    const { page } = renderEd(() => fetchWith())
    await page.flush()
    expect(page.container.querySelectorAll('.row .col-md-6 table').length).toBe(2)
    page.unmount()
  })

  test('loads cameras and defaults the selection to the first', async function () {
    const { page, getRef } = renderEd(() => fetchWith())
    await page.flush()
    expect(getRef().state.cameras.length).toBe(2)
    expect(getRef().state.selectedCamera).toBe('/base/soc/i2c0mux/imx708@1a')
    page.unmount()
  })

  test('toggling the camera feed shows a tokened MJPEG backdrop; img error is handled', async function () {
    const { page, getRef } = renderEd(() => fetchWith())
    await page.flush()
    expect(page.container.querySelector('[data-testid="camera-feed"]')).toBeFalsy() // off by default
    act(() => { page.container.querySelector('[data-testid="show-camera"]').click() })
    const img = page.container.querySelector('[data-testid="camera-feed"]')
    expect(img).toBeTruthy()
    const src = img.getAttribute('src')
    expect(src).toContain('/api/camera/preview?')
    expect(src).toContain('device=')
    expect(src).toContain('token=')
    expect(src).toContain('format=video') // CSI cap is video/x-raw
    // a failed load is surfaced
    act(() => { img.dispatchEvent(new Event('error')) })
    expect(getRef().state.cameraError).toBe(true)
    page.unmount()
  })

  test('selecting a different camera picks a non-compressed cap for the preview', async function () {
    const { page, getRef } = renderEd(() => fetchWith())
    await page.flush()
    act(() => { page.container.querySelector('[data-testid="show-camera"]').click() })
    const sel = page.container.querySelector('[data-testid="camera-select"]')
    act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(sel, '/dev/video2')
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(getRef().state.selectedCamera).toBe('/dev/video2')
    // the USB cam's first cap is H264 (not previewable) → previewSrc skips to its jpeg cap
    expect(page.container.querySelector('[data-testid="camera-feed"]').getAttribute('src')).toContain('format=image%2Fjpeg')
    page.unmount()
  })

  test('previewSrc falls back gracefully for an unknown/capless camera', async function () {
    const { page, getRef } = renderEd(() => fetchWith())
    await page.flush()
    act(() => { getRef().setState({ selectedCamera: 'does-not-exist' }) })
    expect(getRef().previewSrc()).toBe('') // no matching device
    act(() => { getRef().setState({ cameras: [{ value: 'x', label: 'X', caps: [] }], selectedCamera: 'x' }) })
    expect(getRef().previewSrc()).toContain('width=1280') // default resolution when capless
    // a camera with no caps property at all → defaults
    act(() => { getRef().setState({ cameras: [{ value: 'nc' }], selectedCamera: 'nc' }) })
    expect(getRef().previewSrc()).toContain('width=1280')
    // a camera whose only cap is compressed (H265) → falls back to that cap (caps[0])
    act(() => { getRef().setState({ cameras: [{ value: 'h', caps: [{ width: 800, height: 600, format: 'video/x-h265' }] }], selectedCamera: 'h' }) })
    expect(getRef().previewSrc()).toContain('width=800')
    page.unmount()
  })

  test('with no cameras the toggle is disabled and the select says so', async function () {
    const { page } = renderEd(() => fetchWith({ '/api/videodevices': {} }))
    await page.flush()
    expect(page.container.textContent).toContain('No cameras found')
    expect(page.container.querySelector('[data-testid="show-camera"]').disabled).toBe(true)
    page.unmount()
  })

  test('tolerates a videodevices fetch failure', async function () {
    const { page, getRef } = renderEd(() => fetchWith({ '/api/videodevices': () => { throw new Error('net') } }))
    await page.flush()
    expect(getRef().state.cameras).toEqual([])
    page.unmount()
  })

  test('"Show live values" swaps mock chips for real FC telemetry and shows a status line', async function () {
    const { page, getRef } = renderEd(() => fetchWith())
    await page.flush()
    // off by default → chips show the mock sample, no status line
    expect(page.container.querySelector('[data-eltype="alt"]').textContent).toContain('ALT 124m')
    expect(page.container.querySelector('[data-testid="live-status"]')).toBeFalsy()
    // turn it on; before any packet arrives the chip keeps the mock sample and the
    // status warns there's no telemetry yet (live.connected is false)
    act(() => { page.container.querySelector('[data-testid="show-live"]').click() })
    expect(getRef().state.liveValues).toBe(true)
    expect(page.container.querySelector('[data-testid="live-status"]').textContent).toContain('Waiting for telemetry')
    expect(page.container.querySelector('[data-eltype="alt"]').textContent).toContain('ALT 124m')
    // a live packet arrives (FC connected) → the alt chip shows the real reading,
    // while modemFix (absent from the values map) falls back to its mock sample
    act(() => { lastSocket().fire('HUDLive', { connected: true, values: { alt: 'ALT 250m' } }) })
    expect(page.container.querySelector('[data-eltype="alt"]').textContent).toContain('ALT 250m')
    expect(page.container.querySelector('[data-eltype="alt"]').textContent).not.toContain('ALT 124m')
    expect(page.container.querySelector('[data-eltype="modemFix"]').textContent).toContain('mGPS OK')
    expect(page.container.querySelector('[data-testid="live-status"]').textContent).toContain('Live')
    // toggling back off restores every mock sample
    act(() => { page.container.querySelector('[data-testid="show-live"]').click() })
    expect(page.container.querySelector('[data-eltype="alt"]').textContent).toContain('ALT 124m')
    expect(page.container.querySelector('[data-testid="live-status"]')).toBeFalsy()
    page.unmount()
  })

  test('a socket reconnect re-fetches the layout', async function () {
    const fetch = fetchWith()
    const page = renderPage(<HudEditorPage />)
    await page.flush()
    const before = fetch.mock.calls.filter(c => c[0] === '/api/hudlayout').length
    act(() => { lastSocket().fire('reconnect') })
    await page.flush()
    expect(fetch.mock.calls.filter(c => c[0] === '/api/hudlayout').length).toBeGreaterThan(before)
    page.unmount()
  })
})
