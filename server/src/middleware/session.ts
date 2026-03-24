import type { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth-service.js';
import { PlatformError } from '../errors/index.js';
import type { User } from 'shared';

// Extend Express Request to carry the authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

const authService = new AuthService();

/**
 * Express middleware that rejects requests with expired or invalid sessions.
 * Extracts the Bearer token from the Authorization header.
 */
export async function sessionMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return next(
      new PlatformError({
        severity: 'error',
        component: 'AuthModule',
        operation: 'sessionMiddleware',
        description: 'Authentication is required. Please log in.',
        recommendedActions: ['Log in with your @chicago-reno.com email'],
      }),
    );
  }

  const user = await authService.verifySession(token);

  if (!user) {
    return next(
      new PlatformError({
        severity: 'error',
        component: 'AuthModule',
        operation: 'sessionMiddleware',
        description: 'Your session has expired due to inactivity.',
        recommendedActions: ['Log in again to continue'],
      }),
    );
  }

  req.user = user;
  next();
}
