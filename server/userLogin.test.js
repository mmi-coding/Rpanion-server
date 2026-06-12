const assert = require('assert')
const path = require('path')
const userLogin = require('./userLogin.js')
const fs = require('fs')

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
  })
})