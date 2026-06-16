// @vitest-environment happy-dom
import React, { act } from 'react'
import { describe, test, expect, afterEach, beforeEach, vi } from 'vitest'

import { renderPage } from '../test/ui.jsx'
import { lastSocket } from '../test/socketMock.js'
import MavInspectorPage from './mavinspector.jsx'

vi.mock('socket.io-client', () => import('../test/socketMock.js'))

// a representative full snapshot (armed, fresh + one stale message)
const snapshot = [
  { name: 'ATTITUDE', msgid: 30, rate: 10, count: 100, stale: false, fields: { roll: 0.5, pitch: -0.2, yaw: 1.0 } },
  { name: 'VFR_HUD', msgid: 74, rate: 4, count: 40, stale: false, fields: { airspeed: 12.5, groundspeed: 11.0, alt: 100.2, climb: 0.5, throttle: 55, heading: 90 } },
  { name: 'GPS_RAW_INT', msgid: 24, rate: 5, count: 50, stale: false, fields: { fixType: 3, satellitesVisible: 12 } },
  { name: 'GLOBAL_POSITION_INT', msgid: 33, rate: 5, count: 50, stale: false, fields: { lat: 495520282, lon: -16987526, relativeAlt: -200 } },
  { name: 'SYS_STATUS', msgid: 1, rate: 1, count: 10, stale: false, fields: { voltageBattery: 12300, currentBattery: 250, batteryRemaining: 88 } },
  { name: 'HEARTBEAT', msgid: 0, rate: 1, count: 10, stale: true, fields: { baseMode: 128, customMode: 5 } },
  { name: 'RC_CHANNELS', msgid: 65, rate: 2, count: 20, stale: false, fields: { rssi: 200 } }
]

function render () {
  let ref = null
  const page = renderPage(<MavInspectorPage ref={(r) => { ref = r }} />)
  return { page, getRef: () => ref }
}

describe('#MavInspectorPage()', function () {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

  test('renders title and the waiting state with empty (—) summary', function () {
    const { page } = render()
    expect(page.container.textContent).toContain('MAVLink Inspector')
    expect(page.container.textContent).toContain('Waiting for telemetry')
    expect(page.container.textContent).toContain('—') // null helpers → em dash
    page.unmount()
  })

  test('shows the summary + inspector from a snapshot', function () {
    const { page } = render()
    act(() => { lastSocket().fire('MAVTelemetry', snapshot) })
    const txt = page.container.textContent
    expect(txt).toContain('28.6°')   // roll 0.5 rad → deg
    expect(txt).toContain('12.5 m/s') // airspeed
    expect(txt).toContain('49.5520282') // lat scaled
    expect(txt).toContain('12.30 V')  // battery voltage scaled
    expect(txt).toContain('ARMED')    // baseMode 128
    expect(txt).toContain('ATTITUDE') // inspector row
    expect(txt).toContain('stale')    // HEARTBEAT stale badge
    page.unmount()
  })

  test('expands and collapses a message row to reveal raw fields', function () {
    const { page } = render()
    act(() => { lastSocket().fire('MAVTelemetry', snapshot) })
    const findAtt = () => [...page.container.querySelectorAll('tr')].find(r => r.textContent.includes('ATTITUDE'))
    expect(findAtt().textContent).toContain('▸') // collapsed
    page.click(findAtt())
    expect(findAtt().textContent).toContain('▾') // expanded
    expect(page.container.textContent).toContain('-0.2') // raw pitch field value, only shown when expanded
    page.click(findAtt())
    expect(findAtt().textContent).toContain('▸') // collapsed again
    page.unmount()
  })

  test('filters the message list by name (via the input onChange)', function () {
    const { page } = render()
    act(() => { lastSocket().fire('MAVTelemetry', snapshot) })
    const input = page.container.querySelector('input[type="text"]')
    page.setValue(input, 'gps')
    const rows = [...page.container.querySelectorAll('tbody tr')].map(r => r.textContent)
    expect(rows.some(t => t.includes('GPS_RAW_INT'))).toBe(true)
    expect(rows.some(t => t.includes('ATTITUDE'))).toBe(false)
    page.unmount()
  })

  test('handles disarmed state, a null field and a string field', function () {
    const { page } = render()
    act(() => {
      lastSocket().fire('MAVTelemetry', [
        { name: 'ATTITUDE', msgid: 30, rate: 1, count: 1, stale: false, fields: { roll: 0 } }, // pitch/yaw absent
        { name: 'VFR_HUD', msgid: 74, rate: 1, count: 1, stale: false, fields: { heading: '90' } }, // string value
        { name: 'SYS_STATUS', msgid: 1, rate: 1, count: 1, stale: false, fields: { voltageBattery: null } }, // null value
        { name: 'HEARTBEAT', msgid: 0, rate: 1, count: 1, stale: false, fields: { baseMode: 0 } } // disarmed
      ])
    })
    const txt = page.container.textContent
    expect(txt).toContain('DISARMED')
    expect(txt).toContain('90°') // string field formatted
    page.unmount()
  })

  test('reconnect handler re-runs componentDidMount without crashing', function () {
    const { page } = render()
    act(() => { lastSocket().fire('reconnect') })
    expect(page.container.textContent).toContain('MAVLink Inspector')
    page.unmount()
  })
})
