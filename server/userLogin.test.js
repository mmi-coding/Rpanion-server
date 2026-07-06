const assert = require('assert')
const path = require('path')
const os = require('os')
const userLogin = require('./userLogin')
const fs = require('fs')
const logpaths = require('./paths')

const rbacTmpFile = path.join(os.tmpdir(), 'rpanion-rbac-users-test.json')
const provisionTmpUsers = path.join(os.tmpdir(), 'rpanion-provision-users-test.json')
const provisionTmpPw = path.join(os.tmpdir(), 'rpanion-provision-initpw-test.txt')

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

  describe('Initial admin provisioning (S1 — never locked out)', function () {
    const tmpUsers = provisionTmpUsers
    const tmpPw = provisionTmpPw
    let origInitPw

    beforeEach(function () {
      origInitPw = logpaths.initialPasswordFile
      logpaths.initialPasswordFile = tmpPw
      for (const f of [tmpUsers, tmpPw]) {
        if (fs.existsSync(f)) fs.unlinkSync(f)
      }
    })

    afterEach(function () {
      logpaths.initialPasswordFile = origInitPw
      for (const f of [tmpUsers, tmpPw]) {
        if (fs.existsSync(f)) fs.unlinkSync(f)
      }
    })

    it('#ensureInitialAdmin() provisions a random admin when the file is missing', async function () {
      const userMgmt = new userLogin()
      userMgmt.usersFile = tmpUsers // does not exist
      const res = await userMgmt.ensureInitialAdmin()
      assert.equal(res.provisioned, true)
      assert.ok(res.password && res.password.length >= 12)
      // a usable admin now exists with the generated password
      assert.equal(await userMgmt.checkLoginDetails('admin', res.password), true)
      assert.equal(await userMgmt.getUserRole('admin'), 'admin')
      // the initial-password hint file was written mode 0600 and contains the pw
      assert.ok(fs.existsSync(tmpPw))
      assert.equal(fs.statSync(tmpPw).mode & 0o777, 0o600)
      assert.ok(fs.readFileSync(tmpPw, 'utf8').includes(res.password))
    })

    it('#ensureInitialAdmin() provisions when users exist but none is an admin', async function () {
      fs.writeFileSync(tmpUsers, JSON.stringify([{ username: 'viewer', passwordhash: 'z', role: 'readonly' }]))
      const userMgmt = new userLogin()
      userMgmt.usersFile = tmpUsers
      const res = await userMgmt.ensureInitialAdmin()
      assert.equal(res.provisioned, true)
      const users = await userMgmt.getAllUsers()
      assert.ok(users.find(u => u.username === 'admin' && u.role === 'admin'))
      assert.ok(users.find(u => u.username === 'viewer'))
    })

    it('#ensureInitialAdmin() is a no-op when an admin already exists (no revert)', async function () {
      fs.writeFileSync(tmpUsers, JSON.stringify([{ username: 'admin', passwordhash: 'x', role: 'admin' }]))
      const userMgmt = new userLogin()
      userMgmt.usersFile = tmpUsers
      const res = await userMgmt.ensureInitialAdmin()
      assert.equal(res.provisioned, false)
      assert.equal(fs.existsSync(tmpPw), false) // nothing written
    })

    it('#ensureInitialAdmin() treats a role-less legacy user as an admin (no-op)', async function () {
      // pre-RBAC users have no role and are treated as admin, so a fresh admin
      // must NOT be provisioned on top of them (covers the u.role||'admin' path)
      fs.writeFileSync(tmpUsers, JSON.stringify([{ username: 'legacy', passwordhash: 'x' }]))
      const userMgmt = new userLogin()
      userMgmt.usersFile = tmpUsers
      const res = await userMgmt.ensureInitialAdmin()
      assert.equal(res.provisioned, false)
      assert.equal(fs.existsSync(tmpPw), false)
    })

    it('#ensureInitialAdmin() treats a non-array file as empty and provisions', async function () {
      fs.writeFileSync(tmpUsers, JSON.stringify({ not: 'an array' }))
      const userMgmt = new userLogin()
      userMgmt.usersFile = tmpUsers
      const res = await userMgmt.ensureInitialAdmin()
      assert.equal(res.provisioned, true)
    })

    it('#ensureInitialAdmin() still provisions if the hint file cannot be written', async function () {
      logpaths.initialPasswordFile = path.join(os.tmpdir(), 'rpanion-no-such-dir-xyz', 'initpw.txt')
      const userMgmt = new userLogin()
      userMgmt.usersFile = tmpUsers
      const res = await userMgmt.ensureInitialAdmin()
      assert.equal(res.provisioned, true) // hint-write failure is non-fatal
    })

    it('#ensureInitialAdmin() returns error when the users file cannot be saved', async function () {
      const userMgmt = new userLogin()
      userMgmt.usersFile = tmpUsers
      userMgmt._saveUsers = async () => { throw new Error('disk full') }
      const res = await userMgmt.ensureInitialAdmin()
      assert.equal(res.provisioned, false)
      assert.equal(res.error, true)
    })

    it('#defaultCredentialsInUse() flags the initial admin, then clears on change', async function () {
      const userMgmt = new userLogin()
      userMgmt.usersFile = tmpUsers
      await userMgmt.ensureInitialAdmin()
      assert.equal(await userMgmt.defaultCredentialsInUse(), true)
      assert.equal(await userMgmt.defaultCredentialsInUse('admin'), true)
      assert.ok(fs.existsSync(tmpPw))
      // changing the password clears the flag AND removes the hint file
      assert.equal(await userMgmt.changePassword('admin', 'a-strong-new-pw'), true)
      assert.equal(await userMgmt.defaultCredentialsInUse('admin'), false)
      assert.equal(fs.existsSync(tmpPw), false)
    })

    it('#defaultCredentialsInUse() flags a literal admin:admin password', async function () {
      const hash = JSON.parse(originalUserFile)[0].passwordhash // real bcrypt hash of "admin"
      fs.writeFileSync(tmpUsers, JSON.stringify([{ username: 'admin', passwordhash: hash, role: 'admin' }]))
      const userMgmt = new userLogin()
      userMgmt.usersFile = tmpUsers
      assert.equal(await userMgmt.defaultCredentialsInUse('admin'), true)
    })

    it('#defaultCredentialsInUse() is false for a changed password and on error', async function () {
      const bcrypt = require('bcryptjs')
      fs.writeFileSync(tmpUsers, JSON.stringify([{ username: 'admin', passwordhash: bcrypt.hashSync('something-else', 10), role: 'admin' }]))
      const userMgmt = new userLogin()
      userMgmt.usersFile = tmpUsers
      assert.equal(await userMgmt.defaultCredentialsInUse('admin'), false)
      userMgmt.usersFile = '/nonexistent/users.json' // unreadable → false, not throw
      assert.equal(await userMgmt.defaultCredentialsInUse(), false)
    })
  })
})