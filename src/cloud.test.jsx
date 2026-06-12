// @vitest-environment happy-dom
import React, { act } from 'react'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'

import { renderPage, mockFetch } from '../test/ui.jsx'
import { lastSocket } from '../test/socketMock.js'
import CloudConfig from './cloud.jsx'

vi.mock('socket.io-client', () => import('../test/socketMock.js'))

describe('#cloudConfigPage()', function () {
  const defaultCloudInfo = {
    doBinUpload: false,
    binUploadLink: 'user@server:/path',
    binLogStatus: 'N/A',
    syncDeletions: false,
    pubkey: []
  }

  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  test('renders title Cloud Upload', async function () {
    mockFetch({ '/api/cloudinfo': defaultCloudInfo })
    const page = renderPage(<CloudConfig />)
    await page.flush()
    expect(page.container.textContent).toContain('Cloud Upload')
    page.unmount()
  })

  test('fetches cloudinfo on mount and renders link field', async function () {
    mockFetch({ '/api/cloudinfo': defaultCloudInfo })
    const page = renderPage(<CloudConfig />)
    await page.flush()
    const input = page.container.querySelector('input[name="binUploadLink"]')
    expect(input).not.toBeNull()
    expect(input.value).toBe('user@server:/path')
    page.unmount()
  })

  test('renders Enable button when doBinUpload=false', async function () {
    mockFetch({ '/api/cloudinfo': defaultCloudInfo })
    const page = renderPage(<CloudConfig />)
    await page.flush()
    expect(page.container.textContent).toContain('Enable')
    page.unmount()
  })

  test('renders Disable button and disabled inputs when doBinUpload=true', async function () {
    const activeInfo = { ...defaultCloudInfo, doBinUpload: true }
    mockFetch({ '/api/cloudinfo': activeInfo })
    const page = renderPage(<CloudConfig />)
    await page.flush()
    expect(page.container.textContent).toContain('Disable')
    const input = page.container.querySelector('input[name="binUploadLink"]')
    expect(input.disabled).toBe(true)
    const checkbox = page.container.querySelector('input[name="syncDeletions"]')
    expect(checkbox.disabled).toBe(true)
    page.unmount()
  })

  test('inputs are enabled when doBinUpload=false', async function () {
    mockFetch({ '/api/cloudinfo': defaultCloudInfo })
    const page = renderPage(<CloudConfig />)
    await page.flush()
    const input = page.container.querySelector('input[name="binUploadLink"]')
    expect(input.disabled).toBe(false)
    const checkbox = page.container.querySelector('input[name="syncDeletions"]')
    expect(checkbox.disabled).toBe(false)
    page.unmount()
  })

  test('renders pubkeys when present', async function () {
    const withPubkeys = { ...defaultCloudInfo, pubkey: ['ssh-rsa AAAAB...key1', 'ssh-ed25519 AAAAC...key2'] }
    mockFetch({ '/api/cloudinfo': withPubkeys })
    const page = renderPage(<CloudConfig />)
    await page.flush()
    expect(page.container.textContent).toContain('ssh-rsa AAAAB...key1')
    expect(page.container.textContent).toContain('ssh-ed25519 AAAAC...key2')
    page.unmount()
  })

  test('renders pubkeys section with empty array (no keys shown)', async function () {
    mockFetch({ '/api/cloudinfo': defaultCloudInfo })
    const page = renderPage(<CloudConfig />)
    await page.flush()
    expect(page.container.textContent).toContain('Publickeys')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // changeHandler — updates binUploadLink via text input
  // -------------------------------------------------------------------------
  test('changeHandler updates binUploadLink on input', async function () {
    mockFetch({ '/api/cloudinfo': defaultCloudInfo })
    const page = renderPage(<CloudConfig />)
    await page.flush()
    const input = page.container.querySelector('input[name="binUploadLink"]')
    page.setValue(input, 'newuser@newhost:/newpath')
    expect(input.value).toBe('newuser@newhost:/newpath')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // toggleSyncDelete — toggles syncDeletions checkbox
  // -------------------------------------------------------------------------
  test('toggleSyncDelete toggles syncDeletions checkbox', async function () {
    mockFetch({ '/api/cloudinfo': defaultCloudInfo })
    const page = renderPage(<CloudConfig />)
    await page.flush()
    const checkbox = page.container.querySelector('input[name="syncDeletions"]')
    // Click the checkbox to toggle it on
    act(() => { checkbox.click() })
    expect(checkbox.checked).toBe(true)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleDoBinUploadSubmit — POSTs with negated doBinUpload
  // -------------------------------------------------------------------------
  test('submit sends POST with !doBinUpload (Enable case: false→true)', async function () {
    let posted = null
    mockFetch({
      '/api/cloudinfo': defaultCloudInfo,
      'POST /api/binlogupload': (url, opts) => {
        posted = JSON.parse(opts.body)
        return { doBinUpload: true, binUploadLink: defaultCloudInfo.binUploadLink, syncDeletions: false, pubkey: [] }
      }
    })
    const page = renderPage(<CloudConfig />)
    await page.flush()
    const button = page.container.querySelector('button')
    page.click(button)
    await page.flush()
    expect(posted).not.toBeNull()
    // doBinUpload was false, so body sends !false = true
    expect(posted.doBinUpload).toBe(true)
    expect(posted.binUploadLink).toBe('user@server:/path')
    page.unmount()
  })

  test('submit sends POST with !doBinUpload (Disable case: true→false)', async function () {
    let posted = null
    const activeInfo = { ...defaultCloudInfo, doBinUpload: true }
    mockFetch({
      '/api/cloudinfo': activeInfo,
      'POST /api/binlogupload': (url, opts) => {
        posted = JSON.parse(opts.body)
        return { doBinUpload: false, binUploadLink: '', syncDeletions: false, pubkey: [] }
      }
    })
    const page = renderPage(<CloudConfig />)
    await page.flush()
    const button = page.container.querySelector('button')
    page.click(button)
    await page.flush()
    expect(posted).not.toBeNull()
    // doBinUpload was true, so body sends !true = false
    expect(posted.doBinUpload).toBe(false)
    page.unmount()
  })

  test('submit includes syncDeletions value in POST body', async function () {
    let posted = null
    const syncInfo = { ...defaultCloudInfo, syncDeletions: true }
    mockFetch({
      '/api/cloudinfo': syncInfo,
      'POST /api/binlogupload': (url, opts) => {
        posted = JSON.parse(opts.body)
        return { ...syncInfo }
      }
    })
    const page = renderPage(<CloudConfig />)
    await page.flush()
    const button = page.container.querySelector('button')
    page.click(button)
    await page.flush()
    expect(posted.syncDeletions).toBe(true)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Socket: CloudBinStatus updates binLogStatus
  // -------------------------------------------------------------------------
  test('CloudBinStatus socket event updates status display', async function () {
    mockFetch({ '/api/cloudinfo': defaultCloudInfo })
    const page = renderPage(<CloudConfig />)
    await page.flush()
    act(() => {
      lastSocket().fire('CloudBinStatus', 'Uploading 3 files...')
    })
    expect(page.container.textContent).toContain('Uploading 3 files...')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Socket: reconnect triggers componentDidMount again
  // -------------------------------------------------------------------------
  test('reconnect socket event re-fetches cloudinfo', async function () {
    mockFetch({ '/api/cloudinfo': defaultCloudInfo })
    const page = renderPage(<CloudConfig />)
    await page.flush()
    act(() => {
      lastSocket().fire('reconnect')
    })
    await page.flush()
    expect(page.container.textContent).toContain('Cloud Upload')
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // showLogin path (basePage integration)
  // -------------------------------------------------------------------------
  test('showLogin=true renders login form', async function () {
    mockFetch({ '/api/cloudinfo': defaultCloudInfo })
    const page = renderPage(<CloudConfig showLogin={true} />)
    await page.flush()
    expect(page.container.textContent).toContain('Please Log In')
    page.unmount()
  })
})
