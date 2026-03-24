import { Router } from 'express';
import { AuthService } from '../services/auth-service.js';

const router = Router();
const authService = new AuthService();

/**
 * POST /auth/login
 * Validate email domain and create session.
 */
router.post('/login', async (req, res, next) => {
  try {
    const { email } = req.body as { email?: string };
    const result = await authService.initiateAuth(email ?? '');
    res.json({ user: result.user, token: result.token });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/verify
 * Check if the current session token is still valid.
 */
router.post('/verify', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const user = await authService.verifySession(token);

    if (!user) {
      res.status(401).json({ valid: false });
      return;
    }

    res.json({ valid: true, user });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/logout
 * Destroy the current session.
 */
router.post('/logout', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
    await authService.logout(token);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
