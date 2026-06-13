// Augment Express's Request with the JWT payload that authenticateToken attaches
// (req.user) so auth.ts and the route modules type req.user?.role.
import 'express';

declare global {
  namespace Express {
    interface Request {
      user?: { username?: string; role?: string; [key: string]: unknown };
    }
  }
}

export {};
