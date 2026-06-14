// @vitest-environment happy-dom
import { createRoot } from 'react-dom/client'
import React, { act } from 'react'
import { describe, test, expect } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import About from './about.jsx'
import Home from './home.jsx'
import NetworkConfig from './networkconfig.jsx'
import Video from './video.jsx'
import FCConfig from './flightcontroller.jsx'
import LogBrowser from './logBrowser.jsx'
import NTRIPPage from './ntripcontroller.jsx'
import AdhocConfig from './adhocwifi.jsx'
import CloudConfig from './cloud.jsx'
import UserManagement from './userManagement.jsx'
import PPPPage from './ppp.jsx'
import CameraSwitcherPage from './cameraswitcher.jsx'
import PipelineEditorPage from './pipelineeditor.jsx'
import LTEModemPage from './ltemodem.jsx'
import CellularTuningPage from './cellulartuning.jsx'
import { HelpTip, HelpSection } from './components/Help.jsx'

describe('#apptest()', function () {
  test('homepage renders without crashing', function () {
    const div = document.createElement('div')
    const root = createRoot(div)
    root.render(<Home />)
    root.unmount()
  })

  test('about page renders without crashing', function () {
    const div = document.createElement('div')
    const root = createRoot(div)
    root.render(<About />)
    root.unmount()
  })

  test('networkconfig page renders without crashing', function () {
    const div = document.createElement('div')
    const root = createRoot(div)
    root.render(<NetworkConfig />)
    root.unmount()
  })

  test('video page renders without crashing', function () {
    const div = document.createElement('div')
    const root = createRoot(div)
    root.render(<Video />)
    root.unmount()
  })

  test('flightcontroller page renders without crashing', function () {
    const div = document.createElement('div')
    const root = createRoot(div)
    root.render(<FCConfig />)
    root.unmount()
  })

  test('logging page renders without crashing', function () {
    const div = document.createElement('div')
    const root = createRoot(div)
    root.render(<LogBrowser />)
    root.unmount()
  })

  test('ntrip page renders without crashing', function () {
    const div = document.createElement('div')
    const root = createRoot(div)
    root.render(<NTRIPPage />)
    root.unmount()
  })

  test('adhoc page renders without crashing', function () {
    const div = document.createElement('div')
    const root = createRoot(div)
    root.render(<AdhocConfig />)
    root.unmount()
  })

  test('cloud page renders without crashing', function () {
    const div = document.createElement('div')
    const root = createRoot(div)
    root.render(<CloudConfig />)
    root.unmount()
  })

  test('user page renders without crashing', function () {
    const div = document.createElement('div')
    const root = createRoot(div)
    root.render(<UserManagement />)
    root.unmount()
  })

  test('PPP page renders without crashing', function () {
    const div = document.createElement('div')
    const root = createRoot(div)
    root.render(<PPPPage />)
    root.unmount()
  })

  test('camera switcher page renders without crashing', function () {
    const div = document.createElement('div')
    const root = createRoot(div)
    root.render(<CameraSwitcherPage />)
    root.unmount()
  })

  test('pipeline editor page renders without crashing', function () {
    const div = document.createElement('div')
    const root = createRoot(div)
    root.render(<PipelineEditorPage />)
    root.unmount()
  })

  test('lte modem page renders without crashing', function () {
    const div = document.createElement('div')
    const root = createRoot(div)
    root.render(<LTEModemPage />)
    root.unmount()
  })

  test('cellular tuning page renders without crashing', function () {
    const div = document.createElement('div')
    const root = createRoot(div)
    root.render(<CellularTuningPage />)
    root.unmount()
  })

  test('help components render marker, collapsed section and toggle', function () {
    const div = document.createElement('div')
    const root = createRoot(div)
    act(() => {
      root.render(
        <div>
          <HelpTip text='what this field does' />
          <HelpSection title='How this works'><p>the long explanation</p></HelpSection>
        </div>
      )
    })
    // HelpTip: a focusable "?" marker
    const marker = div.querySelector('[aria-label="help"]')
    expect(marker).not.toBeNull()
    expect(marker.textContent).toBe('?')
    // HelpSection: collapsed by default, but content present in the DOM
    const toggle = div.querySelector('[aria-expanded]')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(div.textContent).toContain('How this works')
    expect(div.textContent).toContain('the long explanation')
    // clicking the title expands it
    act(() => { toggle.click() })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    root.unmount()
  })
})