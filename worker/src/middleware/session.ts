import { createMiddleware } from 'hono/factory';
import type { Bindings } from '../bindings.js';
import type { User } from 'shared';
import { AuthService } from '../services/auth-service.js';
import { PlatformError } from '../errors/index.js';

type SessionEnv = {
  Bindings: Bindings;
  Variables: { user: User };
};

export const sessionMiddleware = createMiddleware<SessionEnv>(
  async (c, next) => {
    const authHeader = c.req.header('Authorization');
    const token = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null;

    if (!token) {
      throw new PlatformError({
        severity: 'error',
        component: 'AuthModule',
        operation: 'sessionMiddleware',
        description: 'Authentication is required. Please log in.',
        recommendedActions: ['Log in with your @chicago-reno.com email'],
        statusCode: 401,
      });
    }

    const authService = new AuthService(c.env.DB);
    const user = await authService.verifySession(token);

    if (!user) {
      throw new PlatformError({
        severity: 'error',
        component: 'AuthModule',
        operation: 'sessionMiddleware',
        description: 'Your session has expired due to inactivity.',
        recommendedActions: ['Log in again to continue'],
        statusCode: 401,
      });
    }

    c.set('user', user);
    await next();
  },
);
