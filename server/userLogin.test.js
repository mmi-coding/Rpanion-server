const assert = require('assert')
const path = require('path')
const os = require('os')
const userLogin = require('./userLogin.js')
const fs = require('fs')

const rbacTmpFile = path.join(os.tmpdir(), 'rpanion-rbac-users-test.json')

describe('User Login Functions', function () {
  let originalUserFile

  before(function () {
    // Backup the original user.json file
    originalUserFile = fs.readFileSync(path.join(__dirname, '..', 'config', 'user.json'), 'utf8')
  })

  after(function () {
    // Restore the original user.json file
    fs.writeFileSync(path.join(__dirname, '..', 'config', 'user.json'), originalUserFile, 'utf8')
  })

  it('#logininit()', function () {
    const userMgmt = new userLogin()

    // check initial status
    assert.equal(userMgmt.usersFile, path.join(__dirname, '..', 'config', 'user.json'))
  })

  it('#checkLoginDetails()', async function () {
    const userMgmt = new userLogin()
        
    // check initial status
    const result = await userMgmt.checkLoginDetails('admin', 'admin')
    assert.equal(result, true)
  })

  it('#getAllUsers()', async function () {
    const userMgmt = new userLogin()
                
    // check initial status
    const result = await userMgmt.getAllUsers()
    assert.equal(result.length, 1)
  })

  it('#addUser()', async function () {
    const userMgmt = new userLogin()
                
    // check initial status
    const result = await userMgmt.addUser('test', 'test')
    assert.equal(result, true)
  })

  it('#deleteUser()', async function () {
    const userMgmt = new userLogin()
                        
    // check initial status
    const result = await userMgmt.deleteUser('test')
    assert.equal(result, true)
  })

  it('#changePassword()', async function () {
    const userMgmt = new userLogin()
                                        
    // check initial status
    const result = await userMgmt.changePassword('admin', 'admin')
    assert.equal(result, true)
  })

  it('#changePassword() - invalid user', async function () {
    const userMgmt = new userLogin()
                                                        
    // check initial status
    const result = await userMgmt.changePassword('test', 'test')
    assert.equal(result, false)
  })

  it('#changePassword() - invalid password', async function () {
    const userMgmt = new userLogin()
                                                                        
    // check initial status
    const result = await userMgmt.changePassword('admin', '')
    assert.equal(result, false)
  })

  it('#changePassword() - invalid user and password', async function () {
    const userMgmt = new userLogin()

    // check initial status
    const result = await userMgmt.changePassword('test', 'test')
    assert.equal(result, false)
  })

  it('#checkLoginDetails() - unknown user', async function () {
    const userMgmt = new userLogin()
    const result = await userMgmt.checkLoginDetails('ghost', 'whatever')
    assert.equal(result, false)
  })

  it('#checkLoginDetails() - wrong password', async function () {
    const userMgmt = new userLogin()
    const result = await userMgmt.checkLoginDetails('admin', 'wrongpassword')
    assert.equal(result, false)
  })

  it('#addUser() - duplicate username', async function () {
    const userMgmt = new userLogin()
    const result = await userMgmt.addUser('admin', 'whatever')
    assert.equal(result, false)
  })

  it('#deleteUser() - last user cannot be deleted', async function () {
    const userMgmt = new userLogin()
    // config/user.json holds a single user at this point
    const users = await userMgmt.getAllUsers()
    assert.equal(users.length, 1)
    const result = await userMgmt.deleteUser(users[0].username)
    assert.equal(result, false)
  })

  it('#deleteUser() - unknown user', async function () {
    const userMgmt = new userLogin()
    // need >1 user so the last-user guard doesn't trigger first
    assert.equal(await userMgmt.addUser('seconduser', 'pw'), true)
    const result = await userMgmt.deleteUser('ghost')
    assert.equal(result, false)
    assert.equal(await userMgmt.deleteUser('seconduser'), true)
  })

  it('#unreadableUsersFile()', async function () {
    // every method returns its failure value when the users file is missing
    const userMgmt = new userLogin()
    userMgmt.usersFile = '/nonexistent/users.json'

    assert.equal(await userMgmt.checkLoginDetails('admin', 'admin'), false)
    assert.deepEqual(await userMgmt.getAllUsers(), [])
    assert.equal(await userMgmt.addUser('x', 'y'), false)
    assert.equal(await userMgmt.deleteUser('x'), false)
    assert.equal(await userMgmt.changePassword('x', 'y'), false)
    assert.equal(await userMgmt.getUserRole('x'), null)
    assert.equal(await userMgmt.updateRole('x', 'admin'), false)
  })

  describe('RBAC roles', function () {
  let userMgmt

  beforeEach(function () {
    // Isolated users file: a pre-RBAC user (no role), an admin and a read-only.
    fs.writeFileSync(rbacTmpFile, JSON.stringify([
      { username: 'legacy', passwordhash: 'x' },
      { username: 'boss', passwordhash: 'y', role: 'admin' },
      { username: 'viewer', passwordhash: 'z', role: 'readonly' }
    ], null, 2))
    userMgmt = new userLogin()
    userMgmt.usersFile = rbacTmpFile
  })

  after(function () {
    if (fs.existsSync(rbacTmpFile)) {
      fs.unlinkSync(rbacTmpFile)
    }
  })

  it('#getAllUsers() defaults a missing role to admin', async function () {
    const users = await userMgmt.getAllUsers()
    assert.equal(users.find(u => u.username === 'legacy').role, 'admin')
    assert.equal(users.find(u => u.username === 'viewer').role, 'readonly')
  })

  it('#getUserRole() returns the stored role', async function () {
    assert.equal(await userMgmt.getUserRole('viewer'), 'readonly')
    assert.equal(await userMgmt.getUserRole('boss'), 'admin')
  })

  it('#getUserRole() defaults a missing role to admin', async function () {
    assert.equal(await userMgmt.getUserRole('legacy'), 'admin')
  })

  it('#getUserRole() returns null for an unknown user', async function () {
    assert.equal(await userMgmt.getUserRole('ghost'), null)
  })

  it('#addUser() stores a valid role', async function () {
    assert.equal(await userMgmt.addUser('newadmin', 'pw', 'admin'), true)
    assert.equal(await userMgmt.getUserRole('newadmin'), 'admin')
  })

  it('#addUser() defaults new users to readonly', async function () {
    assert.equal(await userMgmt.addUser('plain', 'pw'), true)
    assert.equal(await userMgmt.getUserRole('plain'), 'readonly')
  })

  it('#addUser() rejects an invalid role', async function () {
    assert.equal(await userMgmt.addUser('bad', 'pw', 'superuser'), false)
  })

  it('#updateRole() changes a user role', async function () {
    assert.equal(await userMgmt.updateRole('viewer', 'admin'), true)
    assert.equal(await userMgmt.getUserRole('viewer'), 'admin')
  })

  it('#updateRole() rejects an invalid role', async function () {
    assert.equal(await userMgmt.updateRole('viewer', 'root'), false)
  })

  it('#updateRole() returns false for an unknown user', async function () {
    assert.equal(await userMgmt.updateRole('ghost', 'admin'), false)
  })
  })
})