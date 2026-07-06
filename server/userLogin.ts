const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const logpaths = require('./paths')

class userLogin {
  usersFile: string

  constructor () {
    this.usersFile = logpaths.usersFile
  }

  // Read and parse the users file. Throws on I/O / parse error, which each
  // public method catches.
  async _loadUsers () {
    return JSON.parse(await fs.readFile(this.usersFile, 'utf8'))
  }

  // Serialize and persist the users array.
  async _saveUsers (users: any[]) {
    await fs.writeFile(this.usersFile, JSON.stringify(users, null, 2))
  }

  /**
   * Checks the login details of a user.
   *
   * @param {string} username - The username of the user.
   * @param {string} password - The password of the user.
   * @returns {Promise<boolean>} - A promise that resolves to true if the login details are correct, otherwise false.
   * @throws {Error} - Throws an error if there is an issue reading the users file.
   */
  async checkLoginDetails(username: string, password: string) {
    try {
      const users = await this._loadUsers()

      const user = users.find((user: any) => user.username === username)
      if (user) {
        const match = await bcrypt.compare(password, user.passwordhash)
        return match
      }
      return false
    } catch (error) {
      console.error('Error reading users file:', error)
      return false
    }
  }

  /**
   * Returns a list of all users.
   *
   * @returns {Array} - An array of users.
   * @throws {Error} - Throws an error if there is an issue reading the users file.
   */
  async getAllUsers() {
    try {
      const users = await this._loadUsers()
      // Normalise: users created before RBAC have no role; treat them as admin.
      return users.map((user: any) => ({ ...user, role: user.role || 'admin' }))
    } catch (error) {
      console.error('Error getting users:', error)
      return []
    }
  }

  /**
   * Returns a user's role ('admin' or 'readonly').
   *
   * @param {string} username - The username of the user.
   * @returns {Promise<string|null>} - The role, 'admin' for pre-RBAC users
   *   without a stored role, or null if the user does not exist / on error.
   */
  async getUserRole(username: string) {
    try {
      const users = await this._loadUsers()
      const user = users.find((user: any) => user.username === username)
      if (!user) {
        return null
      }
      return user.role || 'admin'
    } catch (error) {
      console.error('Error getting user role:', error)
      return null
    }
  }

  /**
   * Adds a new user.
   *
   * @param {string} username - The username of the user.
   * @param {string} password - The password of the user.
   * @returns {Promise<boolean>} - A promise that resolves to true if the user was added successfully, otherwise false.
   * @throws {Error} - Throws an error if there is an issue reading the users file.
   */
  async addUser(username: string, password: string, role = 'readonly') {
    try {
      // New users default to least-privilege ('readonly'); only 'admin' or
      // 'readonly' are valid roles.
      if (role !== 'admin' && role !== 'readonly') {
        return false
      }

      const users = await this._loadUsers()

      const user = users.find((user: any) => user.username === username)
      if (user) {
        return false
      }

      const passwordhash = await bcrypt.hash(password, 10)
      users.push({ username, passwordhash, role })

      await this._saveUsers(users)
      return true
    } catch (error) {
      console.error('Error adding user:', error)
      return false
    }
  }

  /**
   * Deletes a user.
   *
   * @param {string} username - The username of the user.
   * @returns {Promise<boolean>} - A promise that resolves to true if the user was deleted successfully, otherwise false.
   * @throws {Error} - Throws an error if there is an issue reading the users file.
   */
  async deleteUser(username: string) {
    try {
      const users = await this._loadUsers()

      //if there's only 1 user remaining, don't allow deletion
      if (users.length === 1) {
        return false
      }

      const index = users.findIndex((user: any) => user.username === username)
      if (index === -1) {
        return false
      }

      users.splice(index, 1)

      await this._saveUsers(users)
      return true
    } catch (error) {
      console.error('Error deleting user:', error)
      return false
    }
  }

  /**
   * Changes the password of a user.
   *
   * @param {string} username - The username of the user.
   * @param {string} password - The new password of the user.
   * @returns {Promise<boolean>} - A promise that resolves to true if the password was changed successfully, otherwise false.
   * @throws {Error} - Throws an error if there is an issue reading the users file.
   */
  async changePassword(username: string, password: string) {
    try {
      const users = await this._loadUsers()

      const user = users.find((user: any) => user.username === username)
      if (!user) {
        return false
      }

      if(password === '') {
        return false
      }

      user.passwordhash = await bcrypt.hash(password, 10)
      // The password is no longer the auto-generated/default one — clear the
      // "must change" flag so the default-credentials banner stops showing.
      if (user.mustChangePassword) {
        delete user.mustChangePassword
      }

      await this._saveUsers(users)
      // Remove the stale on-disk initial-password hint (best-effort; usually
      // absent because the operator already changed it or never had one).
      try {
        await fs.unlink(logpaths.initialPasswordFile)
      } catch (e) { /* not present — nothing to remove */ }
      return true
    } catch (error) {
      console.error('Error changing password:', error)
      return false
    }
  }

  /**
   * Guarantees a usable admin login always exists — the never-locked-out
   * invariant. If the users file is missing/unreadable/empty or has no admin
   * account, a fresh admin is created with a random password, which is written
   * (mode 0600) to logpaths.initialPasswordFile for on-device retrieval. Called
   * once at server startup. On a device that already has an admin this is a
   * no-op, so an operator's changed password is never reverted.
   *
   * @returns {Promise<{provisioned: boolean, password?: string, error?: boolean}>}
   */
  async ensureInitialAdmin() {
    try {
      let users: any[] = []
      try {
        users = await this._loadUsers()
      } catch (e) {
        users = [] // missing/corrupt file → provision a fresh admin
      }
      if (!Array.isArray(users)) {
        users = []
      }
      const hasAdmin = users.some((u: any) => (u.role || 'admin') === 'admin')
      if (hasAdmin) {
        return { provisioned: false }
      }

      // base64url keeps the password shell/URL-safe for the operator to paste.
      const password = crypto.randomBytes(12).toString('base64url')
      const passwordhash = await bcrypt.hash(password, 10)
      const next = users.filter((u: any) => u.username !== 'admin')
      next.push({ username: 'admin', passwordhash, role: 'admin', mustChangePassword: true })

      await fs.mkdir(path.dirname(this.usersFile), { recursive: true })
      await this._saveUsers(next)

      try {
        await fs.writeFile(
          logpaths.initialPasswordFile,
          'Rpanion auto-generated initial admin login — CHANGE IT after first login.\n\n' +
          '  username: admin\n' +
          '  password: ' + password + '\n',
          { mode: 0o600 }
        )
        await fs.chmod(logpaths.initialPasswordFile, 0o600)
      } catch (e) {
        // best-effort: the password is also emitted on the console below
        console.error('Could not write initial-password file:', e)
      }
      console.warn('[rpanion] No admin account found — generated a random initial ' +
        'admin password (username: admin). Retrieve it from ' + logpaths.initialPasswordFile +
        ' and change it after logging in.')
      return { provisioned: true, password }
    } catch (error) {
      console.error('ensureInitialAdmin failed:', error)
      return { provisioned: false, error: true }
    }
  }

  /**
   * Whether an admin is still using the shipped default ("admin") or an
   * auto-generated initial password (mustChangePassword flag). Drives the
   * "change the default password" banner. Checks the named user if given, else
   * any admin account.
   *
   * @param {string} [username]
   * @returns {Promise<boolean>}
   */
  async defaultCredentialsInUse(username?: string) {
    try {
      const users = await this._loadUsers()
      const candidates = username
        ? users.filter((u: any) => u.username === username)
        : users.filter((u: any) => (u.role || 'admin') === 'admin')
      for (const u of candidates) {
        if (u.mustChangePassword === true) {
          return true
        }
        if (await bcrypt.compare('admin', u.passwordhash)) {
          return true
        }
      }
      return false
    } catch (error) {
      return false
    }
  }

  /**
   * Changes the role of a user.
   *
   * @param {string} username - The username of the user.
   * @param {string} role - The new role ('admin' or 'readonly').
   * @returns {Promise<boolean>} - True if the role was changed, otherwise false.
   * @throws {Error} - Throws an error if there is an issue reading the users file.
   */
  async updateRole(username: string, role: string) {
    try {
      if (role !== 'admin' && role !== 'readonly') {
        return false
      }

      const users = await this._loadUsers()

      const user = users.find((user: any) => user.username === username)
      if (!user) {
        return false
      }

      user.role = role

      await this._saveUsers(users)
      return true
    } catch (error) {
      console.error('Error changing role:', error)
      return false
    }
  }

}

export = userLogin