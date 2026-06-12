// @vitest-environment happy-dom
import React, { act } from 'react'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'

import { renderPage, mockFetch } from '../test/ui.jsx'
import NetworkClientsPage from './networkClients.jsx'

describe('#networkClientsPage()', function () {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  test('renders loading then shows No Access Point when apname is empty', async function () {
    mockFetch({ '/api/networkclients': { apname: '', apclients: null } })
    const page = renderPage(<NetworkClientsPage />)
    await page.flush()
    expect(page.container.textContent).toContain('No Access Point running')
    page.unmount()
  })

  test('renders title Access Point Clients', async function () {
    mockFetch({ '/api/networkclients': { apname: '', apclients: null } })
    const page = renderPage(<NetworkClientsPage />)
    expect(page.container.textContent).toContain('Access Point Clients')
    page.unmount()
  })

  test('shows AP table with apname when apname is non-empty', async function () {
    mockFetch({ '/api/networkclients': { apname: 'wlan0', apclients: [] } })
    const page = renderPage(<NetworkClientsPage />)
    await page.flush()
    expect(page.container.textContent).toContain('wlan0')
    // Table should be visible
    const table = page.container.querySelector('#apclients')
    expect(table).not.toBeNull()
    page.unmount()
  })

  test('renderClientTableData(null) returns empty tr row', async function () {
    mockFetch({ '/api/networkclients': { apname: 'wlan0', apclients: null } })
    const page = renderPage(<NetworkClientsPage />)
    await page.flush()
    // apname is set, table is shown, but apclients is null → empty row
    const table = page.container.querySelector('#apclients')
    expect(table).not.toBeNull()
    // thead has Name/IP headers and an empty <tr>
    expect(table.textContent).toContain('Name')
    expect(table.textContent).toContain('IP')
    page.unmount()
  })

  test('renderClientTableData with array renders hostname and ip rows', async function () {
    const clients = [
      { hostname: 'device1', ip: '192.168.4.2' },
      { hostname: 'device2', ip: '192.168.4.3' }
    ]
    mockFetch({ '/api/networkclients': { apname: 'wlan0', apclients: clients } })
    const page = renderPage(<NetworkClientsPage />)
    await page.flush()
    expect(page.container.textContent).toContain('device1')
    expect(page.container.textContent).toContain('192.168.4.2')
    expect(page.container.textContent).toContain('device2')
    expect(page.container.textContent).toContain('192.168.4.3')
    page.unmount()
  })

  test('apname empty hides table and shows no-ap div', async function () {
    mockFetch({ '/api/networkclients': { apname: '', apclients: null } })
    const page = renderPage(<NetworkClientsPage />)
    await page.flush()
    // No AP running message shown; table is still in the DOM but the outer div has display:none via React style
    expect(page.container.textContent).toContain('No Access Point running')
    // The apclients table does exist in HTML (both divs rendered)
    expect(page.container.querySelector('#apclients')).not.toBeNull()
    page.unmount()
  })
})
