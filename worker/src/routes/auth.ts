import { Hono } from 'hono';
import type { Bindings } from '../bindings.js';
import { AuthService } from '../services/auth-service.js';

const app = new Hono<{ Bindings: Bindings }>();

/**
 * POST /login
 * Validate email domain and create session.
 */
app.post('/login', async (c) => {
  const body = await c.req.json() as { email?: string };
  const authService = new AuthService(c.env.DB);
  const result = await authService.initiateAuth(body.email ?? '');
  return c.json({ user: result.user, token: result.token });
});

/**
 * POST /verify
 * Check if the current session token is still valid.
 */
app.post('/verify', async (c) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : '';
  const authService = new AuthService(c.env.DB);
  const user = await authService.verifySession(token);

  if (!user) {
    return c.json({ valid: false }, 401);
  }

  return c.json({ valid: true, user });
});

/**
 * POST /logout
 * Destroy the current session.
 */
app.post('/logout', async (c) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : '';
  const authService = new AuthService(c.env.DB);
  await authService.logout(token);
  return c.json({ success: true });
});

export default app;
