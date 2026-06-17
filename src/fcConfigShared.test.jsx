import { describe, test, expect } from 'vitest'
import { fmt, onoff, stateVariant } from './fcConfigShared'

describe('fcConfigShared', () => {
  test('fmt → em dash for null/undefined, value otherwise', () => {
    expect(fmt(null)).toBe('—')
    expect(fmt(undefined)).toBe('—')
    expect(fmt(0)).toBe(0)
    expect(fmt('x')).toBe('x')
  })

  test('onoff → dash / On / Off', () => {
    expect(onoff(null)).toBe('—')
    expect(onoff(undefined)).toBe('—')
    expect(onoff(1)).toBe('On')
    expect(onoff(0)).toBe('Off')
  })

  test('stateVariant maps every download state', () => {
    expect(stateVariant('complete')).toBe('success')
    expect(stateVariant('downloading')).toBe('info')
    expect(stateVariant('partial')).toBe('warning')
    expect(stateVariant('failed')).toBe('danger')
    expect(stateVariant('idle')).toBe('secondary')
    expect(stateVariant('anything-else')).toBe('secondary')
  })
})
