// @vitest-environment happy-dom
import React, { act } from 'react'
import { describe, test, expect, vi, afterEach } from 'vitest'

import { renderPage, mockFetch } from '../test/ui.jsx'
import PipelineEditorPage from './pipelineeditor.jsx'

// PipelineEditorPage uses super(props, false) — no socket.io needed.

describe('#pipelineeditorpage()', function () {
    const emptyData = {
        pipelines: {},
        lastPipeline: '',
        customPipelineFallback: ''
    }

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    // ------------------------------------------------------------------
    // Basic rendering
    // ------------------------------------------------------------------

    test('renders page title and editor form', async function () {
        mockFetch({ '/api/custompipelines': emptyData })
        const page = renderPage(<PipelineEditorPage />)
        await page.flush()
        expect(page.container.textContent).toContain('Video Pipeline Editor')
        expect(page.container.textContent).toContain('Camera device')
        expect(page.container.textContent).toContain('Pipeline')
        expect(page.container.textContent).toContain('Enabled')
        page.unmount()
    })

    test('shows "No stream started yet." when lastPipeline is empty', async function () {
        mockFetch({ '/api/custompipelines': emptyData })
        const page = renderPage(<PipelineEditorPage />)
        await page.flush()
        expect(page.container.textContent).toContain('No stream started yet.')
        page.unmount()
    })

    test('shows lastPipeline and Copy button when lastPipeline is non-empty', async function () {
        mockFetch({
            '/api/custompipelines': {
                ...emptyData,
                lastPipeline: 'v4l2src ! video/x-raw ! rtph264pay name=pay0 pt=96'
            }
        })
        const page = renderPage(<PipelineEditorPage />)
        await page.flush()
        expect(page.container.textContent).toContain('v4l2src ! video/x-raw ! rtph264pay name=pay0 pt=96')
        expect(page.container.textContent).toContain('Copy into editor')
        expect(page.container.textContent).not.toContain('No stream started yet.')
        page.unmount()
    })

    test('shows customPipelineFallback Alert when non-empty', async function () {
        mockFetch({
            '/api/custompipelines': {
                ...emptyData,
                customPipelineFallback: '/dev/video0'
            }
        })
        const page = renderPage(<PipelineEditorPage />)
        await page.flush()
        expect(page.container.textContent).toContain('The last stream rejected its custom pipeline')
        expect(page.container.textContent).toContain('/dev/video0')
        page.unmount()
    })

    // ------------------------------------------------------------------
    // pipelines table
    // ------------------------------------------------------------------

    test('renders table rows for saved pipelines', async function () {
        mockFetch({
            '/api/custompipelines': {
                pipelines: {
                    '/dev/video0': { pipeline: 'v4l2src ! rtph264pay name=pay0 pt=96', enabled: true },
                    '/dev/video1': { pipeline: 'v4l2src ! rtph265pay name=pay0 pt=96', enabled: false }
                },
                lastPipeline: '',
                customPipelineFallback: ''
            }
        })
        const page = renderPage(<PipelineEditorPage />)
        await page.flush()
        expect(page.container.textContent).toContain('/dev/video0')
        expect(page.container.textContent).toContain('/dev/video1')
        expect(page.container.textContent).toContain('yes')
        expect(page.container.textContent).toContain('no')
        page.unmount()
    })

    test('Edit button loads the pipeline entry into the editor (entry.pipeline truthy arm)', async function () {
        mockFetch({
            '/api/custompipelines': {
                pipelines: {
                    '/dev/video0': { pipeline: 'v4l2src ! rtph264pay name=pay0 pt=96', enabled: true }
                },
                lastPipeline: '',
                customPipelineFallback: ''
            }
        })
        const page = renderPage(<PipelineEditorPage />)
        await page.flush()
        const editBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Edit')
        page.click(editBtn)
        const deviceInput = page.container.querySelector('input[name="device"]')
        const pipelineInput = page.container.querySelector('textarea[name="pipeline"]')
        expect(deviceInput.value).toBe('/dev/video0')
        expect(pipelineInput.value).toBe('v4l2src ! rtph264pay name=pay0 pt=96')
        page.unmount()
    })

    test('handleEdit with no matching entry sets empty pipeline (falsy arm)', async function () {
        // Start with pipeline defined, then Edit a device whose entry is
        // momentarily missing (simulate by calling handleEdit directly via
        // clicking Edit while pipelines are empty after initial load).
        // We achieve the falsy arm by rendering with an entry that has
        // pipeline = '' (falsy string).
        mockFetch({
            '/api/custompipelines': {
                pipelines: {
                    '/dev/video2': { pipeline: '', enabled: false }
                },
                lastPipeline: '',
                customPipelineFallback: ''
            }
        })
        const page = renderPage(<PipelineEditorPage />)
        await page.flush()
        const editBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Edit')
        page.click(editBtn)
        const pipelineInput = page.container.querySelector('textarea[name="pipeline"]')
        expect(pipelineInput.value).toBe('')
        page.unmount()
    })

    // ------------------------------------------------------------------
    // handleChange
    // ------------------------------------------------------------------

    test('handleChange updates text input (non-checkbox branch)', async function () {
        mockFetch({ '/api/custompipelines': emptyData })
        const page = renderPage(<PipelineEditorPage />)
        await page.flush()
        const deviceInput = page.container.querySelector('input[name="device"]')
        page.setValue(deviceInput, '/dev/video3')
        expect(deviceInput.value).toBe('/dev/video3')
        page.unmount()
    })

    test('handleChange updates checkbox (checkbox branch)', async function () {
        mockFetch({ '/api/custompipelines': emptyData })
        const page = renderPage(<PipelineEditorPage />)
        await page.flush()
        const enabledBox = page.container.querySelector('input[name="enabled"]')
        expect(enabledBox.checked).toBe(false)
        page.click(enabledBox)
        expect(enabledBox.checked).toBe(true)
        page.unmount()
    })

    // ------------------------------------------------------------------
    // handleCopyLast — regex strip branches
    // ------------------------------------------------------------------

    test('handleCopyLast strips trailing udpsink suffix and copies into editor', async function () {
        const lastPipeline = 'v4l2src ! rtph264pay name=pay0 pt=96 ! udpsink host=127.0.0.1 port=5600'
        mockFetch({
            '/api/custompipelines': { ...emptyData, lastPipeline }
        })
        const page = renderPage(<PipelineEditorPage />)
        await page.flush()
        const copyBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Copy into editor')
        page.click(copyBtn)
        const pipelineInput = page.container.querySelector('textarea[name="pipeline"]')
        expect(pipelineInput.value).toBe('v4l2src ! rtph264pay name=pay0 pt=96')
        page.unmount()
    })

    test('handleCopyLast with no udpsink suffix copies the full pipeline', async function () {
        const lastPipeline = 'v4l2src ! rtph264pay name=pay0 pt=96'
        mockFetch({
            '/api/custompipelines': { ...emptyData, lastPipeline }
        })
        const page = renderPage(<PipelineEditorPage />)
        await page.flush()
        const copyBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Copy into editor')
        page.click(copyBtn)
        const pipelineInput = page.container.querySelector('textarea[name="pipeline"]')
        expect(pipelineInput.value).toBe('v4l2src ! rtph264pay name=pay0 pt=96')
        page.unmount()
    })

    // ------------------------------------------------------------------
    // handleValidate — tri-state results
    // ------------------------------------------------------------------

    test('validate result valid=true shows success Alert', async function () {
        mockFetch({
            '/api/custompipelines': emptyData,
            'POST /api/custompipelinevalidate': { valid: true, reason: '' }
        })
        const page = renderPage(<PipelineEditorPage />)
        await page.flush()
        const validateBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Validate')
        page.click(validateBtn)
        await page.flush()
        expect(page.container.textContent).toContain('Pipeline is valid')
        page.unmount()
    })

    test('validate result valid=false shows danger Alert with reason', async function () {
        mockFetch({
            '/api/custompipelines': emptyData,
            'POST /api/custompipelinevalidate': { valid: false, reason: 'unknown element' }
        })
        const page = renderPage(<PipelineEditorPage />)
        await page.flush()
        const validateBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Validate')
        page.click(validateBtn)
        await page.flush()
        expect(page.container.textContent).toContain('Invalid: unknown element')
        page.unmount()
    })

    test('validate result valid=null shows warning Alert with reason', async function () {
        mockFetch({
            '/api/custompipelines': emptyData,
            'POST /api/custompipelinevalidate': { valid: null, reason: 'gst not found' }
        })
        const page = renderPage(<PipelineEditorPage />)
        await page.flush()
        const validateBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Validate')
        page.click(validateBtn)
        await page.flush()
        expect(page.container.textContent).toContain('Could not validate: gst not found')
        page.unmount()
    })

    test('handleValidate catch branch sets error state', async function () {
        // GET succeeds, POST throws
        vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
            const method = (opts.method || 'GET').toUpperCase()
            if (method === 'GET') {
                return { ok: true, status: 200, json: async () => emptyData }
            }
            throw new Error('network error')
        }))
        const page = renderPage(<PipelineEditorPage />)
        await page.flush()
        const validateBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Validate')
        page.click(validateBtn)
        await page.flush()
        expect(document.body.textContent).toContain('Failed to validate pipeline')
        page.unmount()
    })

    // ------------------------------------------------------------------
    // savePipeline — success and error paths
    // ------------------------------------------------------------------

    test('Save button calls savePipeline and updates pipelines on success', async function () {
        const updatedPipelines = {
            '/dev/video0': { pipeline: 'v4l2src ! rtph264pay name=pay0 pt=96', enabled: true }
        }
        mockFetch({
            '/api/custompipelines': emptyData,
            'POST /api/custompipelinemodify': { pipelines: updatedPipelines }
        })
        const page = renderPage(<PipelineEditorPage />)
        await page.flush()
        // Set device and pipeline before saving
        const deviceInput = page.container.querySelector('input[name="device"]')
        page.setValue(deviceInput, '/dev/video0')
        const saveBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Save')
        page.click(saveBtn)
        await page.flush()
        expect(page.container.textContent).toContain('/dev/video0')
        page.unmount()
    })

    test('savePipeline sets error state when API returns data.error', async function () {
        mockFetch({
            '/api/custompipelines': emptyData,
            'POST /api/custompipelinemodify': { error: 'device not found' }
        })
        const page = renderPage(<PipelineEditorPage />)
        await page.flush()
        const saveBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Save')
        page.click(saveBtn)
        await page.flush()
        expect(document.body.textContent).toContain('device not found')
        page.unmount()
    })

    test('savePipeline catch branch sets error state when fetch throws', async function () {
        vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
            const method = (opts.method || 'GET').toUpperCase()
            if (method === 'GET') {
                return { ok: true, status: 200, json: async () => emptyData }
            }
            throw new Error('network error')
        }))
        const page = renderPage(<PipelineEditorPage />)
        await page.flush()
        const saveBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Save')
        page.click(saveBtn)
        await page.flush()
        expect(document.body.textContent).toContain('Failed to save custom pipeline')
        page.unmount()
    })

    test('Delete button calls savePipeline with empty pipeline', async function () {
        let posted = null
        mockFetch({
            '/api/custompipelines': {
                pipelines: {
                    '/dev/video0': { pipeline: 'v4l2src ! rtph264pay name=pay0 pt=96', enabled: true }
                },
                lastPipeline: '',
                customPipelineFallback: ''
            },
            'POST /api/custompipelinemodify': (url, opts) => {
                posted = JSON.parse(opts.body)
                return { pipelines: {} }
            }
        })
        const page = renderPage(<PipelineEditorPage />)
        await page.flush()
        const deleteBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Delete')
        page.click(deleteBtn)
        await page.flush()
        expect(posted).not.toBeNull()
        expect(posted.device).toBe('/dev/video0')
        expect(posted.pipeline).toBe('')
        expect(posted.enabled).toBe(false)
        page.unmount()
    })

    // ------------------------------------------------------------------
    // fetchPipelines catch branch
    // ------------------------------------------------------------------

    test('fetchPipelines catch branch sets error when fetch rejects', async function () {
        vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('net'))))
        const page = renderPage(<PipelineEditorPage />)
        await page.flush()
        expect(document.body.textContent).toContain('Failed to fetch custom pipelines')
        page.unmount()
    })

    test('fetchPipelines catch branch on !response.ok', async function () {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 500, json: async () => ({}) })))
        const page = renderPage(<PipelineEditorPage />)
        await page.flush()
        expect(document.body.textContent).toContain('Failed to fetch custom pipelines')
        page.unmount()
    })

    // ------------------------------------------------------------------
    // HelpTips / HelpSection present (self-documenting UI rule)
    // ------------------------------------------------------------------

    test('help tips are present on form labels', async function () {
        mockFetch({ '/api/custompipelines': emptyData })
        const page = renderPage(<PipelineEditorPage />)
        await page.flush()
        const tips = page.container.querySelectorAll('[aria-label="help"]')
        expect(tips.length).toBeGreaterThan(0)
        page.unmount()
    })
})
