// @vitest-environment happy-dom
import React, { act } from 'react'
import { describe, test, expect, vi, afterEach } from 'vitest'

import { renderPage } from '../../test/ui.jsx'
import IPAddressInput from './IPAddressInput.jsx'

// Helper to render IPAddressInput with defaults
function renderIP (props = {}) {
  const defaults = {
    value: '192.168.1.1',
    onChange: vi.fn(),
    name: 'testip',
    disabled: false,
    isInvalid: false,
    feedback: 'Invalid IP'
  }
  return renderPage(<IPAddressInput {...defaults} {...props} />)
}

describe('#IPAddressInput()', function () {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // -----------------------------------------------------------------------
  // Basic render — parses initial IP into 4 octet inputs
  // -----------------------------------------------------------------------

  test('renders four octet inputs from initial value', async function () {
    const page = renderIP({ value: '10.20.30.40' })
    const inputs = page.container.querySelectorAll('input')
    expect(inputs.length).toBe(4)
    expect(inputs[0].value).toBe('10')
    expect(inputs[1].value).toBe('20')
    expect(inputs[2].value).toBe('30')
    expect(inputs[3].value).toBe('40')
    page.unmount()
  })

  test('renders three dot separators between octets', async function () {
    const page = renderIP()
    const dots = [...page.container.querySelectorAll('.px-1')].filter(el => el.textContent === '.')
    expect(dots.length).toBe(3)
    page.unmount()
  })

  test('renders feedback element', async function () {
    const page = renderIP({ isInvalid: true, feedback: 'Bad IP' })
    expect(page.container.textContent).toContain('Bad IP')
    page.unmount()
  })

  test('inputs are disabled when disabled=true', async function () {
    const page = renderIP({ disabled: true })
    const inputs = page.container.querySelectorAll('input')
    inputs.forEach(input => expect(input.disabled).toBe(true))
    page.unmount()
  })

  // -----------------------------------------------------------------------
  // parseIP — edge cases: empty string, short octets
  // -----------------------------------------------------------------------

  test('empty string value produces 4 empty octet inputs', async function () {
    const page = renderIP({ value: '' })
    const inputs = page.container.querySelectorAll('input')
    expect(inputs.length).toBe(4)
    inputs.forEach(input => expect(input.value).toBe(''))
    page.unmount()
  })

  test('partial IP (fewer than 4 parts) pads with empty strings', async function () {
    const page = renderIP({ value: '192.168' })
    const inputs = page.container.querySelectorAll('input')
    expect(inputs[0].value).toBe('192')
    expect(inputs[1].value).toBe('168')
    expect(inputs[2].value).toBe('')
    expect(inputs[3].value).toBe('')
    page.unmount()
  })

  // -----------------------------------------------------------------------
  // useEffect — prop value update re-parses the octets
  // -----------------------------------------------------------------------

  test('updating value prop re-parses the octets', async function () {
    let externalValue = '1.2.3.4'
    const onChange = vi.fn(e => { externalValue = e.target.value })
    // Use a wrapper component that owns the value prop
    function Wrapper () {
      const [val, setVal] = React.useState('1.2.3.4')
      React.useEffect(() => {}, [])
      return (
        <div>
          <button onClick={() => setVal('5.6.7.8')}>Change</button>
          <IPAddressInput value={val} onChange={onChange} name="ip" />
        </div>
      )
    }
    const page = renderPage(<Wrapper />)
    const inputs = page.container.querySelectorAll('input')
    expect(inputs[0].value).toBe('1')
    // Click button to change value prop
    const btn = page.container.querySelector('button')
    page.click(btn)
    const inputs2 = page.container.querySelectorAll('input')
    expect(inputs2[0].value).toBe('5')
    expect(inputs2[3].value).toBe('8')
    page.unmount()
  })

  // -----------------------------------------------------------------------
  // handleOctetChange — valid/invalid values
  // -----------------------------------------------------------------------

  test('valid octet value (0–255) updates the input', async function () {
    const onChange = vi.fn()
    const page = renderIP({ value: '0.0.0.0', onChange })
    const inputs = page.container.querySelectorAll('input')
    page.setValue(inputs[0], '192')
    expect(inputs[0].value).toBe('192')
    page.unmount()
  })

  test('octet value > 255 is rejected', async function () {
    const onChange = vi.fn()
    const page = renderIP({ value: '0.0.0.0', onChange })
    const inputs = page.container.querySelectorAll('input')
    page.setValue(inputs[0], '256')
    // Value should not change to 256
    expect(inputs[0].value).toBe('0')
    expect(onChange).not.toHaveBeenCalled()
    page.unmount()
  })

  test('non-numeric octet value is rejected', async function () {
    const onChange = vi.fn()
    const page = renderIP({ value: '1.2.3.4', onChange })
    const inputs = page.container.querySelectorAll('input')
    page.setValue(inputs[0], 'abc')
    expect(inputs[0].value).toBe('1')
    expect(onChange).not.toHaveBeenCalled()
    page.unmount()
  })

  test('empty string octet is allowed (partial input)', async function () {
    const onChange = vi.fn()
    const page = renderIP({ value: '1.2.3.4', onChange })
    const inputs = page.container.querySelectorAll('input')
    page.setValue(inputs[0], '')
    expect(inputs[0].value).toBe('')
    // onChange not called — not all octets complete
    expect(onChange).not.toHaveBeenCalled()
    page.unmount()
  })

  test('onChange called with full IP when all octets are valid', async function () {
    const onChange = vi.fn()
    const page = renderIP({ value: '0.0.0.0', onChange })
    const inputs = page.container.querySelectorAll('input')
    page.setValue(inputs[0], '192')
    page.setValue(inputs[1], '168')
    page.setValue(inputs[2], '1')
    page.setValue(inputs[3], '100')
    expect(onChange).toHaveBeenLastCalledWith({
      target: { name: 'testip', value: '192.168.1.100' }
    })
    page.unmount()
  })

  // -----------------------------------------------------------------------
  // handleKeyDown — dot/space advance focus, backspace on empty retreats
  // -----------------------------------------------------------------------

  test('pressing "." in an octet advances focus to next input', async function () {
    const page = renderIP()
    const inputs = page.container.querySelectorAll('input')
    // Focus the first input
    inputs[0].focus()
    act(() => {
      inputs[0].dispatchEvent(new KeyboardEvent('keydown', { key: '.', bubbles: true, cancelable: true }))
    })
    // After pressing '.', focus should move to inputs[1]
    expect(document.activeElement).toBe(inputs[1])
    page.unmount()
  })

  test('pressing " " in an octet advances focus to next input', async function () {
    const page = renderIP()
    const inputs = page.container.querySelectorAll('input')
    inputs[0].focus()
    act(() => {
      inputs[0].dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
    })
    expect(document.activeElement).toBe(inputs[1])
    page.unmount()
  })

  test('pressing "." in last octet does not advance (index=3)', async function () {
    const page = renderIP()
    const inputs = page.container.querySelectorAll('input')
    inputs[3].focus()
    act(() => {
      inputs[3].dispatchEvent(new KeyboardEvent('keydown', { key: '.', bubbles: true, cancelable: true }))
    })
    // Focus stays on inputs[3] (no next element)
    expect(document.activeElement).toBe(inputs[3])
    page.unmount()
  })

  test('pressing Backspace on empty input retreats focus to previous', async function () {
    const page = renderIP({ value: '192...' })
    const inputs = page.container.querySelectorAll('input')
    // Make input[1] empty and focused
    page.setValue(inputs[1], '')
    inputs[1].focus()
    act(() => {
      inputs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }))
    })
    expect(document.activeElement).toBe(inputs[0])
    page.unmount()
  })

  test('pressing Backspace on empty first input does not retreat (index=0)', async function () {
    const page = renderIP({ value: '' })
    const inputs = page.container.querySelectorAll('input')
    inputs[0].focus()
    act(() => {
      inputs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }))
    })
    // Focus stays on inputs[0]
    expect(document.activeElement).toBe(inputs[0])
    page.unmount()
  })

  test('pressing Backspace on non-empty input does nothing special', async function () {
    const page = renderIP()
    const inputs = page.container.querySelectorAll('input')
    inputs[1].focus()
    // inputs[1] value is '168' (non-empty) — backspace should do nothing
    act(() => {
      inputs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }))
    })
    expect(document.activeElement).toBe(inputs[1])
    page.unmount()
  })

  test('pressing other keys does nothing', async function () {
    const page = renderIP()
    const inputs = page.container.querySelectorAll('input')
    inputs[0].focus()
    act(() => {
      inputs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    expect(document.activeElement).toBe(inputs[0])
    page.unmount()
  })

  // -----------------------------------------------------------------------
  // handlePaste — full IP address paste
  // -----------------------------------------------------------------------

  test('pasting a valid IP address populates all 4 octets and calls onChange', async function () {
    const onChange = vi.fn()
    const page = renderIP({ value: '0.0.0.0', onChange })
    const inputs = page.container.querySelectorAll('input')

    const clipboardData = {
      getData: vi.fn(() => '10.20.30.40')
    }
    act(() => {
      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
      pasteEvent.clipboardData = clipboardData
      inputs[0].dispatchEvent(pasteEvent)
    })

    expect(inputs[0].value).toBe('10')
    expect(inputs[1].value).toBe('20')
    expect(inputs[2].value).toBe('30')
    expect(inputs[3].value).toBe('40')
    expect(onChange).toHaveBeenCalledWith({
      target: { name: 'testip', value: '10.20.30.40' }
    })
    page.unmount()
  })

  test('pasting non-IP text does not update octets', async function () {
    const onChange = vi.fn()
    const page = renderIP({ value: '1.2.3.4', onChange })
    const inputs = page.container.querySelectorAll('input')

    const clipboardData = {
      getData: vi.fn(() => 'not-an-ip')
    }
    act(() => {
      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
      pasteEvent.clipboardData = clipboardData
      inputs[0].dispatchEvent(pasteEvent)
    })

    // Octets should remain unchanged
    expect(inputs[0].value).toBe('1')
    expect(onChange).not.toHaveBeenCalled()
    page.unmount()
  })
})
