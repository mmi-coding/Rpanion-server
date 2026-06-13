// @vitest-environment happy-dom
import React, { act } from 'react'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'

import { renderPage, mockFetch } from '../test/ui.jsx'
import UserManagement from './userManagement.jsx'

vi.mock('socket.io-client', () => import('../test/socketMock.js'))

const defaultUsers = { users: [{ username: 'admin', role: 'admin' }, { username: 'pilot', role: 'readonly' }] }

describe('#UserManagement()', function () {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  // -------------------------------------------------------------------------
  // Basic render
  // -------------------------------------------------------------------------
  test('renders title "User Management"', async function () {
    mockFetch({ '/api/users': defaultUsers })
    const page = renderPage(<UserManagement />)
    await page.flush()
    expect(page.container.textContent).toContain('User Management')
    page.unmount()
  })

  test('renders user list from GET /api/users', async function () {
    mockFetch({ '/api/users': defaultUsers })
    const page = renderPage(<UserManagement />)
    await page.flush()
    expect(page.container.textContent).toContain('admin')
    expect(page.container.textContent).toContain('pilot')
    page.unmount()
  })

  test('fetchUsers catch path logs error without crashing', async function () {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('net error'))))
    const page = renderPage(<UserManagement />)
    await page.flush()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Error fetching users'), expect.any(Error))
    consoleSpy.mockRestore()
    page.unmount()
  })

  test('fetchUsers: non-ok response throws error and logs', async function () {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })))
    const page = renderPage(<UserManagement />)
    await page.flush()
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Delete User modal
  // -------------------------------------------------------------------------
  test('Delete User button opens deleteUser modal', async function () {
    mockFetch({ '/api/users': defaultUsers })
    const page = renderPage(<UserManagement />)
    await page.flush()
    const deleteBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Delete User')
    page.click(deleteBtn)
    await page.flush()
    // Modal title in portal
    const modalTitle = [...document.body.querySelectorAll('.modal-title')].find(el => el.textContent === 'Delete User')
    expect(modalTitle).toBeDefined()
    page.unmount()
  })

  test('handleSubmit deleteUser POSTs to /api/deleteUser and refreshes', async function () {
    const fetch = mockFetch({
      '/api/users': defaultUsers,
      'POST /api/deleteUser': { users: [{ username: 'pilot' }] }
    })
    const page = renderPage(<UserManagement />)
    await page.flush()
    const deleteBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Delete User')
    page.click(deleteBtn)
    await page.flush()
    // The submit button in the modal footer - for deleteUser it reads "Delete User"
    // isFormValid: username ('admin') is truthy + modalType is 'deleteUser' → valid
    const submitBtn = [...document.body.querySelectorAll('.modal-footer button')].find(b => b.textContent === 'Delete User')
    expect(submitBtn).toBeDefined()
    expect(submitBtn.disabled).toBe(false)
    act(() => { submitBtn.click() })
    await page.flush()
    expect(fetch).toHaveBeenCalledWith('/api/deleteUser', expect.objectContaining({ method: 'POST' }))
    page.unmount()
  })

  test('deleteUser: !response.ok throws and logs error', async function () {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/users') return { ok: true, status: 200, json: async () => defaultUsers }
      if (method === 'POST' && url === '/api/deleteUser') return { ok: false, status: 400, json: async () => ({ users: [] }) }
      throw new Error(`unhandled: ${method} ${url}`)
    }))
    const page = renderPage(<UserManagement />)
    await page.flush()
    const deleteBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Delete User')
    page.click(deleteBtn)
    await page.flush()
    const submitBtn = [...document.body.querySelectorAll('.modal-footer button')].find(b => b.textContent === 'Delete User')
    act(() => { submitBtn.click() })
    await page.flush()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Error deleting user'), expect.any(Error))
    consoleSpy.mockRestore()
    page.unmount()
  })

  test('deleteUser catch path logs error', async function () {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/users') return { ok: true, status: 200, json: async () => defaultUsers }
      if (method === 'POST' && url === '/api/deleteUser') throw new Error('delete net error')
      throw new Error(`unhandled: ${method} ${url}`)
    }))
    const page = renderPage(<UserManagement />)
    await page.flush()
    const deleteBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Delete User')
    page.click(deleteBtn)
    await page.flush()
    const submitBtn = [...document.body.querySelectorAll('.modal-footer button')].find(b => b.textContent === 'Delete User')
    act(() => { submitBtn.click() })
    await page.flush()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Error deleting user'), expect.any(Error))
    consoleSpy.mockRestore()
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Change Password modal
  // -------------------------------------------------------------------------
  test('Change Password button opens changePassword modal', async function () {
    mockFetch({ '/api/users': defaultUsers })
    const page = renderPage(<UserManagement />)
    await page.flush()
    const changePwdBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Change Password')
    page.click(changePwdBtn)
    await page.flush()
    const modalTitle = [...document.body.querySelectorAll('.modal-title')].find(el => el.textContent === 'Change Password')
    expect(modalTitle).toBeDefined()
    page.unmount()
  })

  test('handleSubmit changePassword POSTs to /api/updateUserPassword', async function () {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const fetch = mockFetch({
      '/api/users': defaultUsers,
      'POST /api/updateUserPassword': { users: defaultUsers.users }
    })
    const page = renderPage(<UserManagement />)
    await page.flush()
    const changePwdBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Change Password')
    page.click(changePwdBtn)
    await page.flush()
    // Fill in password fields
    const pwdInput = document.body.querySelector('input[name="password"]')
    const confirmInput = document.body.querySelector('input[name="confirmPassword"]')
    page.setValue(pwdInput, 'newpass')
    page.setValue(confirmInput, 'newpass')
    await page.flush()
    // Submit button for changePassword
    const submitBtn = [...document.body.querySelectorAll('.modal-footer button')].find(b => b.textContent === 'Change Password' && !b.disabled)
    expect(submitBtn).toBeDefined()
    act(() => { submitBtn.click() })
    await page.flush()
    expect(fetch).toHaveBeenCalledWith('/api/updateUserPassword', expect.objectContaining({ method: 'POST' }))
    consoleSpy.mockRestore()
    page.unmount()
  })

  test('changePassword: !response.ok throws and logs error', async function () {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/users') return { ok: true, status: 200, json: async () => defaultUsers }
      if (method === 'POST' && url === '/api/updateUserPassword') return { ok: false, status: 400, json: async () => ({ users: [] }) }
      throw new Error(`unhandled: ${method} ${url}`)
    }))
    const page = renderPage(<UserManagement />)
    await page.flush()
    const changePwdBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Change Password')
    page.click(changePwdBtn)
    await page.flush()
    const pwdInput = document.body.querySelector('input[name="password"]')
    const confirmInput = document.body.querySelector('input[name="confirmPassword"]')
    page.setValue(pwdInput, 'newpass')
    page.setValue(confirmInput, 'newpass')
    await page.flush()
    const submitBtn = [...document.body.querySelectorAll('.modal-footer button')].find(b => b.textContent === 'Change Password' && !b.disabled)
    act(() => { submitBtn.click() })
    await page.flush()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Error updating password'), expect.any(Error))
    consoleSpy.mockRestore()
    page.unmount()
  })

  test('changePassword catch path logs error', async function () {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/users') return { ok: true, status: 200, json: async () => defaultUsers }
      if (method === 'POST' && url === '/api/updateUserPassword') throw new Error('pw net error')
      throw new Error(`unhandled: ${method} ${url}`)
    }))
    const page = renderPage(<UserManagement />)
    await page.flush()
    const changePwdBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Change Password')
    page.click(changePwdBtn)
    await page.flush()
    const pwdInput = document.body.querySelector('input[name="password"]')
    const confirmInput = document.body.querySelector('input[name="confirmPassword"]')
    page.setValue(pwdInput, 'newpass')
    page.setValue(confirmInput, 'newpass')
    await page.flush()
    const submitBtn = [...document.body.querySelectorAll('.modal-footer button')].find(b => b.textContent === 'Change Password' && !b.disabled)
    act(() => { submitBtn.click() })
    await page.flush()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Error updating password'), expect.any(Error))
    consoleSpy.mockRestore()
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Add User modal
  // -------------------------------------------------------------------------
  test('Add New User button opens addUser modal', async function () {
    mockFetch({ '/api/users': defaultUsers })
    const page = renderPage(<UserManagement />)
    await page.flush()
    const addBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Add New User')
    page.click(addBtn)
    await page.flush()
    const modalTitle = [...document.body.querySelectorAll('.modal-title')].find(el => el.textContent === 'Add User')
    expect(modalTitle).toBeDefined()
    page.unmount()
  })

  test('addUser modal submit disabled when passwords do not match', async function () {
    mockFetch({ '/api/users': defaultUsers })
    const page = renderPage(<UserManagement />)
    await page.flush()
    const addBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Add New User')
    page.click(addBtn)
    await page.flush()
    const usernameInput = document.body.querySelector('input[name="username"]')
    const pwdInput = document.body.querySelector('input[name="password"]')
    const confirmInput = document.body.querySelector('input[name="confirmPassword"]')
    page.setValue(usernameInput, 'newuser')
    page.setValue(pwdInput, 'pass1')
    page.setValue(confirmInput, 'pass2') // mismatch
    await page.flush()
    const submitBtn = [...document.body.querySelectorAll('.modal-footer button')].find(b => b.textContent === 'Add User')
    expect(submitBtn.disabled).toBe(true)
    page.unmount()
  })

  test('handleSubmit addUser POSTs to /api/createUser when passwords match', async function () {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const fetch = mockFetch({
      '/api/users': defaultUsers,
      'POST /api/createUser': { users: [...defaultUsers.users, { username: 'newuser' }] }
    })
    const page = renderPage(<UserManagement />)
    await page.flush()
    const addBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Add New User')
    page.click(addBtn)
    await page.flush()
    const usernameInput = document.body.querySelector('input[name="username"]')
    const pwdInput = document.body.querySelector('input[name="password"]')
    const confirmInput = document.body.querySelector('input[name="confirmPassword"]')
    page.setValue(usernameInput, 'newuser')
    page.setValue(pwdInput, 'samepass')
    page.setValue(confirmInput, 'samepass')
    await page.flush()
    const submitBtn = [...document.body.querySelectorAll('.modal-footer button')].find(b => b.textContent === 'Add User' && !b.disabled)
    expect(submitBtn).toBeDefined()
    act(() => { submitBtn.click() })
    await page.flush()
    expect(fetch).toHaveBeenCalledWith('/api/createUser', expect.objectContaining({ method: 'POST' }))
    consoleSpy.mockRestore()
    page.unmount()
  })

  test('addUser: !response.ok throws and logs error', async function () {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/users') return { ok: true, status: 200, json: async () => defaultUsers }
      if (method === 'POST' && url === '/api/createUser') return { ok: false, status: 400, json: async () => ({ users: [] }) }
      throw new Error(`unhandled: ${method} ${url}`)
    }))
    const page = renderPage(<UserManagement />)
    await page.flush()
    const addBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Add New User')
    page.click(addBtn)
    await page.flush()
    const usernameInput = document.body.querySelector('input[name="username"]')
    const pwdInput = document.body.querySelector('input[name="password"]')
    const confirmInput = document.body.querySelector('input[name="confirmPassword"]')
    page.setValue(usernameInput, 'newuser')
    page.setValue(pwdInput, 'samepass')
    page.setValue(confirmInput, 'samepass')
    await page.flush()
    const submitBtn = [...document.body.querySelectorAll('.modal-footer button')].find(b => b.textContent === 'Add User' && !b.disabled)
    expect(submitBtn).toBeDefined()
    act(() => { submitBtn.click() })
    await page.flush()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Error adding new user'), expect.any(Error))
    consoleSpy.mockRestore()
    page.unmount()
  })

  test('addUser catch path logs error', async function () {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/users') return { ok: true, status: 200, json: async () => defaultUsers }
      if (method === 'POST' && url === '/api/createUser') throw new Error('create net error')
      throw new Error(`unhandled: ${method} ${url}`)
    }))
    const page = renderPage(<UserManagement />)
    await page.flush()
    const addBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Add New User')
    page.click(addBtn)
    await page.flush()
    const usernameInput = document.body.querySelector('input[name="username"]')
    const pwdInput = document.body.querySelector('input[name="password"]')
    const confirmInput = document.body.querySelector('input[name="confirmPassword"]')
    page.setValue(usernameInput, 'newuser')
    page.setValue(pwdInput, 'samepass')
    page.setValue(confirmInput, 'samepass')
    await page.flush()
    const submitBtn = [...document.body.querySelectorAll('.modal-footer button')].find(b => b.textContent === 'Add User' && !b.disabled)
    expect(submitBtn).toBeDefined()
    act(() => { submitBtn.click() })
    await page.flush()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Error adding new user'), expect.any(Error))
    consoleSpy.mockRestore()
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // handleSubmit with unknown modalType (exercises false branch of else-if deleteUser)
  // -------------------------------------------------------------------------
  test('handleSubmit with unknown modalType runs cleanup only (no API call)', async function () {
    mockFetch({ '/api/users': defaultUsers })
    let ref = null
    const Wrapper = () => <UserManagement ref={r => { ref = r }} />
    const page = renderPage(<Wrapper />)
    await page.flush()
    // Set an unknown modal type directly
    act(() => { ref.setState({ showModal: true, modalType: 'unknown', username: 'test' }) })
    await page.flush()
    // Call handleSubmit directly (no fetch should be made beyond /api/users)
    await act(async () => { await ref.handleSubmit() })
    await page.flush()
    // Should not have crashed; modal is now closed
    expect(ref.state.showModal).toBe(false)
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // RBAC: role column + change role
  // -------------------------------------------------------------------------
  test('renders the role for each user', async function () {
    mockFetch({ '/api/users': defaultUsers })
    const page = renderPage(<UserManagement />)
    await page.flush()
    const rows = [...page.container.querySelectorAll('#users tbody tr')]
    expect(rows.some(r => r.textContent.includes('admin'))).toBe(true)
    expect(rows.some(r => r.textContent.includes('readonly'))).toBe(true)
    // An admin shows "Make Read-only"; a read-only user shows "Make Admin"
    const btns = [...page.container.querySelectorAll('button')].map(b => b.textContent)
    expect(btns).toContain('Make Read-only')
    expect(btns).toContain('Make Admin')
    page.unmount()
  })

  test('handleChangeRole POSTs to /api/updateUserRole and refreshes', async function () {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const fetch = mockFetch({
      '/api/users': defaultUsers,
      'POST /api/updateUserRole': { users: defaultUsers.users }
    })
    const page = renderPage(<UserManagement />)
    await page.flush()
    // Click both directions so each branch of the role-toggle target is exercised
    const makeReadonly = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Make Read-only')
    act(() => { makeReadonly.click() })
    await page.flush()
    const makeAdmin = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Make Admin')
    act(() => { makeAdmin.click() })
    await page.flush()
    const roleCalls = fetch.mock.calls.filter(c => c[0] === '/api/updateUserRole')
    expect(JSON.parse(roleCalls[0][1].body).role).toBe('readonly')
    expect(JSON.parse(roleCalls[1][1].body).role).toBe('admin')
    consoleSpy.mockRestore()
    page.unmount()
  })

  test('handleChangeRole: !response.ok throws and logs error', async function () {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/users') return { ok: true, status: 200, json: async () => defaultUsers }
      if (method === 'POST' && url === '/api/updateUserRole') return { ok: false, status: 400, json: async () => ({}) }
      throw new Error(`unhandled: ${method} ${url}`)
    }))
    const page = renderPage(<UserManagement />)
    await page.flush()
    const roleBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Make Read-only')
    act(() => { roleBtn.click() })
    await page.flush()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Error updating user role'), expect.any(Error))
    consoleSpy.mockRestore()
    page.unmount()
  })

  test('handleChangeRole catch path logs error', async function () {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase()
      if (url === '/api/users') return { ok: true, status: 200, json: async () => defaultUsers }
      if (method === 'POST' && url === '/api/updateUserRole') throw new Error('role net error')
      throw new Error(`unhandled: ${method} ${url}`)
    }))
    const page = renderPage(<UserManagement />)
    await page.flush()
    const roleBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Make Read-only')
    act(() => { roleBtn.click() })
    await page.flush()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Error updating user role'), expect.any(Error))
    consoleSpy.mockRestore()
    page.unmount()
  })

  test('addUser sends the role chosen in the role selector', async function () {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const fetch = mockFetch({
      '/api/users': defaultUsers,
      'POST /api/createUser': { users: defaultUsers.users }
    })
    const page = renderPage(<UserManagement />)
    await page.flush()
    const addBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Add New User')
    page.click(addBtn)
    await page.flush()
    page.setValue(document.body.querySelector('input[name="username"]'), 'newuser')
    page.setValue(document.body.querySelector('input[name="password"]'), 'samepass')
    page.setValue(document.body.querySelector('input[name="confirmPassword"]'), 'samepass')
    const roleSelect = document.body.querySelector('select[name="role"]')
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(roleSelect), 'value').set
      setter.call(roleSelect, 'admin')
      roleSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await page.flush()
    const submitBtn = [...document.body.querySelectorAll('.modal-footer button')].find(b => b.textContent === 'Add User' && !b.disabled)
    act(() => { submitBtn.click() })
    await page.flush()
    const createCall = fetch.mock.calls.find(c => c[0] === '/api/createUser')
    expect(JSON.parse(createCall[1].body).role).toBe('admin')
    consoleSpy.mockRestore()
    page.unmount()
  })

  // -------------------------------------------------------------------------
  // Modal close via Cancel
  // -------------------------------------------------------------------------
  test('Cancel button in modal closes it', async function () {
    mockFetch({ '/api/users': defaultUsers })
    const page = renderPage(<UserManagement />)
    await page.flush()
    const addBtn = [...page.container.querySelectorAll('button')].find(b => b.textContent === 'Add New User')
    page.click(addBtn)
    await page.flush()
    // Modal is open
    const modalTitle = [...document.body.querySelectorAll('.modal-title')].find(el => el.textContent === 'Add User')
    expect(modalTitle).toBeDefined()
    const cancelBtn = [...document.body.querySelectorAll('.modal-footer button')].find(b => b.textContent === 'Cancel')
    act(() => { cancelBtn.click() })
    await page.flush()
    // Modal should be gone
    const modalAfter = [...document.body.querySelectorAll('.modal-title')].find(el => el.textContent === 'Add User')
    expect(modalAfter).toBeUndefined()
    page.unmount()
  })
})
