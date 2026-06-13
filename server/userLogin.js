const fs = require('fs').promises;
const bcrypt = require('bcryptjs');

const logpaths = require('./paths.js')

class userLogin {
  constructor () {
    this.usersFile = logpaths.usersFile
  }

  // Read and parse the users file. Throws on I/O / parse error, which each
  // public method catches.
  async _loadUsers () {
    return JSON.parse(await fs.readFile(this.usersFile, 'utf8'))
  }

  // Serialize and persist the users array.
  async _saveUsers (users) {
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
  async checkLoginDetails(username, password) {
    try {
      const users = await this._loadUsers()

      const user = users.find(user => user.username === username)
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
      return users.map(user => ({ ...user, role: user.role || 'admin' }))
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
  async getUserRole(username) {
    try {
      const users = await this._loadUsers()
      const user = users.find(user => user.username === username)
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
  async addUser(username, password, role = 'readonly') {
    try {
      // New users default to least-privilege ('readonly'); only 'admin' or
      // 'readonly' are valid roles.
      if (role !== 'admin' && role !== 'readonly') {
        return false
      }

      const users = await this._loadUsers()

      const user = users.find(user => user.username === username)
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
  async deleteUser(username) {
    try {
      const users = await this._loadUsers()

      //if there's only 1 user remaining, don't allow deletion
      if (users.length === 1) {
        return false
      }

      const index = users.findIndex(user => user.username === username)
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
  async changePassword(username, password) {
    try {
      const users = await this._loadUsers()

      const user = users.find(user => user.username === username)
      if (!user) {
        return false
      }

      if(password === '') {
        return false
      }

      user.passwordhash = await bcrypt.hash(password, 10)

      await this._saveUsers(users)
      return true
    } catch (error) {
      console.error('Error changing password:', error)
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
  async updateRole(username, role) {
    try {
      if (role !== 'admin' && role !== 'readonly') {
        return false
      }

      const users = await this._loadUsers()

      const user = users.find(user => user.username === username)
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

module.exports = userLogin