/*
 * auth.js
 * Authentication + user management, extracted from index.js. Owns the JWT
 * signing secret, the logout token blacklist and the RBAC write-allowlist, and
 * exposes both the authenticateToken middleware (injected into every other route
 * module) and the auth/user routes.
 */
import type { Request, Response, NextFunction } from 'express'
const { Router } = require('express')
const { check, validationResult } = require('express-validator')
const jwt = require('jsonwebtoken')
const crypto = require('crypto')

// Generate a new key if not provided
function generateSecretKey () {
  return crypto.randomBytes(64).toString('hex')
}

export = function authModule ({ userMgmt }: { userMgmt: any }) {
  const RPANION_SECRET_KEY = process.env.RPANION_SECRET_KEY || generateSecretKey()
  const tokenBlacklist = new Set()
  // Non-idempotent HTTP methods a read-only user may not use. Enforcing on the
  // verb (not just POST) closes the bypass where a PUT/PATCH/DELETE mutation
  // (e.g. DELETE /api/hudfonts/:id) sidesteps the RBAC gate.
  const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
  // RBAC: read-only users may not perform mutating requests. These endpoints are
  // exempt because they are not configuration mutations (auth/logout housekeeping).
  const WRITE_ALLOWLIST = new Set(['/api/auth', '/api/logout'])

  // Middleware to check if the request has a valid token
  function authenticateToken (req: Request, res: Response, next: NextFunction) {
    // Skip authentication in development mode
    if (process.env.NODE_ENV === 'development' || process.env.DISABLE_AUTH === '1') {
      return next();
    }

    // Determine if this is a Socket.IO request
    const isSocketIO = typeof res.status !== 'function'

    // Helper function to send error responses
    const sendError = (statusCode: number, message: string) => {
      if (isSocketIO) {
        return next(new Error(message))
      }
      return res.status(statusCode).json({ message })
    }

    // Extract token. Normally from the Authorization header, but also accept a
    // ?token= query param so browser-loaded resources that can't set headers
    // (e.g. an <img> MJPEG preview, EventSource) can authenticate.
    let token;
    try {
      const authHeader = req.headers['authorization']
      token = (authHeader && authHeader.split(' ')[1]) || (typeof req.query.token === 'string' ? req.query.token : undefined)
    } catch (err) /* istanbul ignore next -- header property access cannot throw in express */ {
      return sendError(401, 'Access denied. No token provided.')
    }

    if (!token) {
      return sendError(401, 'Access denied. No token provided.')
    }

    // Check if the token is blacklisted
    if (tokenBlacklist.has(token)) {
      return sendError(401, 'Invalid token')
    }

    // Verify token. Pin the algorithm to HS256 (the one used to sign) so a token
    // presenting a different `alg` header cannot be accepted (defence in depth).
    jwt.verify(token, RPANION_SECRET_KEY, { algorithms: ['HS256'] }, (err: any, user: any) => {
      if (err) {
        return sendError(403, 'Invalid token')
      }
      req.user = user
      // RBAC: read-only users may only read. Block every mutating (non-idempotent)
      // request except the auth/logout housekeeping endpoints.
      if (MUTATING_METHODS.has(req.method) && user.role === 'readonly' && !WRITE_ALLOWLIST.has(req.path)) {
        return sendError(403, 'Read-only user: write access denied')
      }
      next()
    })
  }

  // RBAC: hard admin gate for the few routes that expose a root-level primitive
  // (e.g. the camera-switcher "command" mode runs an operator-supplied shell
  // command as root — see server/cameraSwitcher.ts). Mount it AFTER
  // authenticateToken, which always sets req.user when auth is enforced. When
  // auth is globally disabled (dev / DISABLE_AUTH=1) authenticateToken passes
  // through without setting req.user, so an unset req.user is the signal that
  // auth was intentionally bypassed and we honour it — no separate env check to
  // drift from authenticateToken.
  function requireAdmin (req: Request, res: Response, next: NextFunction) {
    if (req.user && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin role required' })
    }
    return next()
  }

  const router = Router()

  // User login
  router.post('/api/login', [check('username').escape().isLength({ min: 2, max:20 }), check('password').escape().isLength({ min: 2, max:20 })], async (req: Request, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/login', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }
    // Capture the input fields
    const username = req.body.username
    const password = req.body.password

    userMgmt.checkLoginDetails(username, password).then(async (match: any) => {
      if (match) {
        // Generate a token with user information, including the RBAC role
        const role = await userMgmt.getUserRole(username)
        const token = jwt.sign({ username: username, role: role }, RPANION_SECRET_KEY, {
          expiresIn: '1h', // Token expires in 1 hour
        })
        res.send({
          token: token
        })
      } else {
        res.status(401).send(JSON.stringify({error: 'Invalid username or password'}))
      }
    })
  })

  // List all users
  router.get('/api/users', authenticateToken, (req: Request, res: Response) => {
    userMgmt.getAllUsers().then((users: any) => {
      res.send(JSON.stringify({users: users}))
    })
  })

  // Update existing user password
  router.post('/api/updateUserPassword', authenticateToken, [check('username').escape().isLength({ min: 2, max:20 }), check('password').escape().isLength({ min: 2, max:20 })], async (req: Request, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/updateUserPassword', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }
    const { username, password } = req.body;

    /* istanbul ignore next -- unreachable: express-validator min:2 on both fields already rejects missing/empty values before this guard */
    if (!username || !password) {
      //return res.status(400).send({
      //  error: 'Username and password are required'
      //})
      res.status(400).send(JSON.stringify({error: 'Username and password are required'}))
    }

    userMgmt.changePassword(username, password).then((success: any) => {
      if (success) {
        res.send(JSON.stringify({infoMessage: 'User password updated successfully'}))
      } else {
        res.status(500).send(JSON.stringify({error: 'Error updating user password'}))
      }
    })
  })

  // Create new user
  router.post('/api/createUser', authenticateToken, [check('username').escape().isLength({ min: 2, max:20 }), check('password').escape().isLength({ min: 2, max:20 }), check('role').optional().isIn(['admin', 'readonly'])], async (req: Request, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/createUser', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }
    const { username, password, role } = req.body

    /* istanbul ignore next -- unreachable: express-validator min:2 on both fields already rejects missing/empty values before this guard */
    if (!username || !password) {
      return res.status(400).send(JSON.stringify({error: 'Username and password are required'}))
    }

    userMgmt.addUser(username, password, role).then((success: any) => {
      if (success) {
        res.send(JSON.stringify({infoMessage: 'User created successfully'}))
      } else {
        res.status(500).send(JSON.stringify({error: 'Error creating user'}))
      }
    })
  })

  // Update an existing user's role (admin only, enforced by authenticateToken)
  router.post('/api/updateUserRole', authenticateToken, [check('username').escape().isLength({ min: 2, max:20 }), check('role').isIn(['admin', 'readonly'])], (req: Request, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/updateUserRole', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }
    const { username, role } = req.body

    userMgmt.updateRole(username, role).then((success: any) => {
      if (success) {
        res.send(JSON.stringify({infoMessage: 'User role updated successfully'}))
      } else {
        res.status(500).send(JSON.stringify({error: 'Error updating user role'}))
      }
    })
  })

  // Delete a user
  router.post('/api/deleteUser', authenticateToken, [check('username').escape().isLength({ min: 2, max:20 })], (req: Request, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      console.log('Bad POST vars in /api/deleteUser', { message: JSON.stringify(errors.array()) })
      return res.status(422).json({ error: JSON.stringify(errors.array()) })
    }
    const { username } = req.body

    /* istanbul ignore next -- unreachable: express-validator min:2 on username already rejects missing/empty value before this guard */
    if (!username) {
      return res.status(400).send(JSON.stringify({error: 'Username is required'}))
    }

    userMgmt.deleteUser(username).then((success: any) => {
      if (success) {
        res.send(JSON.stringify({infoMessage: 'User deleted successfully'}))
      } else {
        res.status(500).send(JSON.stringify({error: 'Error deleting user'}))
      }
    })
  })

  // User logout
  router.post('/api/logout', authenticateToken, async (req: Request, res: Response) => {
    const authHeader = req.headers['authorization']
    const token = authHeader && authHeader.split(' ')[1]

    // Add token to the blacklist
    tokenBlacklist.add(token)

    res.send({
      token: token
    })
  })

  // Simple token authentication call
  router.post('/api/auth', authenticateToken, async (req: Request, res: Response) => {
    const authEnabled = !(process.env.NODE_ENV === 'development' || process.env.DISABLE_AUTH === '1')

    // Surface whether the shipped default / auto-generated initial admin
    // password is still in use, so the UI can nag the operator to change it (S1).
    // defaultCredentialsInUse never throws (it returns false on any error).
    const mustChangePassword = await userMgmt.defaultCredentialsInUse(req.user?.username)

    res.setHeader('Content-Type', 'application/json')
    res.send(JSON.stringify({
      authEnabled,
      role: req.user?.role,
      mustChangePassword
    }))
  })

  return { authenticateToken, requireAdmin, router }
}
