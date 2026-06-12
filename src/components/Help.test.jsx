// @vitest-environment happy-dom
import React, { act } from 'react'
import { describe, test, expect } from 'vitest'
import { renderPage } from '../../test/ui.jsx'
import { HelpTip, HelpSection } from './Help.jsx'

describe('#HelpTip()', function () {
    test('renders a "?" marker with aria-label="help"', function () {
        const page = renderPage(<HelpTip text="This is help text" />)
        const tip = page.container.querySelector('[aria-label="help"]')
        expect(tip).not.toBeNull()
        expect(tip.textContent).toBe('?')
        page.unmount()
    })

    test('accepts a custom placement prop without error', function () {
        const page = renderPage(<HelpTip text="Placed left" placement="left" />)
        const tip = page.container.querySelector('[aria-label="help"]')
        expect(tip).not.toBeNull()
        page.unmount()
    })
})

describe('#HelpSection()', function () {
    test('renders collapsed by default and shows title', function () {
        const page = renderPage(
            <HelpSection title="My Section">
                <p>Hidden content</p>
            </HelpSection>
        )
        const toggle = page.container.querySelector('[role="button"]')
        expect(toggle).not.toBeNull()
        expect(toggle.getAttribute('aria-expanded')).toBe('false')
        expect(toggle.textContent).toContain('My Section')
        page.unmount()
    })

    test('expands on click and collapses again', function () {
        const page = renderPage(
            <HelpSection title="Clickable">
                <p>Content here</p>
            </HelpSection>
        )
        const toggle = page.container.querySelector('[role="button"]')
        expect(toggle.getAttribute('aria-expanded')).toBe('false')
        page.click(toggle)
        expect(toggle.getAttribute('aria-expanded')).toBe('true')
        page.click(toggle)
        expect(toggle.getAttribute('aria-expanded')).toBe('false')
        page.unmount()
    })

    test('defaultOpen=true renders expanded', function () {
        const page = renderPage(
            <HelpSection title="Pre-opened" defaultOpen={true}>
                <p>Visible content</p>
            </HelpSection>
        )
        const toggle = page.container.querySelector('[role="button"]')
        expect(toggle.getAttribute('aria-expanded')).toBe('true')
        page.unmount()
    })

    test('keyboard Enter key toggles the section open', function () {
        const page = renderPage(
            <HelpSection title="KeyboardSection">
                <p>Key content</p>
            </HelpSection>
        )
        const toggle = page.container.querySelector('[role="button"]')
        expect(toggle.getAttribute('aria-expanded')).toBe('false')
        act(() => {
            toggle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        })
        expect(toggle.getAttribute('aria-expanded')).toBe('true')
        page.unmount()
    })

    test('keyboard Space key toggles the section open', function () {
        const page = renderPage(
            <HelpSection title="SpaceSection">
                <p>Space content</p>
            </HelpSection>
        )
        const toggle = page.container.querySelector('[role="button"]')
        expect(toggle.getAttribute('aria-expanded')).toBe('false')
        act(() => {
            toggle.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
        })
        expect(toggle.getAttribute('aria-expanded')).toBe('true')
        page.unmount()
    })

    test('non-activating key (e.g. Tab) does not toggle the section', function () {
        const page = renderPage(
            <HelpSection title="NoToggleSection">
                <p>Should stay closed</p>
            </HelpSection>
        )
        const toggle = page.container.querySelector('[role="button"]')
        expect(toggle.getAttribute('aria-expanded')).toBe('false')
        act(() => {
            toggle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
        })
        // must remain closed — non-activating key is a no-op
        expect(toggle.getAttribute('aria-expanded')).toBe('false')
        page.unmount()
    })

    test('uses default title when none provided', function () {
        const page = renderPage(
            <HelpSection>
                <p>Default title content</p>
            </HelpSection>
        )
        const toggle = page.container.querySelector('[role="button"]')
        expect(toggle.textContent).toContain('How this works')
        page.unmount()
    })
})
