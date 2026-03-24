import crypto from 'node:crypto';
import { query } from '../config/database.js';
import { PlatformError } from '../errors/index.js';
import type { User } from 'shared';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export class AuthService {
  /**
   * Validate email domain and create or retrieve user + session.
   * Only @chicago-reno.com emails are accepted (case-insensitive).
   */
  async initiateAuth(email: string): Promise<{ user: User; token: string }> {
    if (!email || !email.toLowerCase().endsWith('@chicago-reno.com')) {
      throw new PlatformError({
        severity: 'error',
        component: 'AuthModule',
        operation: 'initiateAuth',
        description: 'Only @chicago-reno.com email addresses can access this platform.',
        recommendedActions: ['Enter a valid @chicago-reno.com email address'],
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Upsert user — create if not exists, otherwise return existing
    const userResult = await query(
      `INSERT INTO users (email, name)
       VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET last_active_at = NOW()
       RETURNING id, email, name, created_at, last_active_at`,
      [normalizedEmail, normalizedEmail.split('@')[0]],
    );

    const row = userResult.rows[0];
    const user: User = {
      id: row.id,
      email: row.email,
      name: row.name,
      createdAt: new Date(row.created_at),
      lastActiveAt: new Date(row.last_active_at),
    };

    // Ensure user_settings row exists
    await query(
      `INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
      [user.id],
    );

    // Create session token
    const token = crypto.randomUUID();
    await query(
      `INSERT INTO sessions (user_id, token) VALUES ($1, $2)`,
      [user.id, token],
    );

    return { user, token };
  }

  /**
   * Verify a session token. Returns the user if the session is valid
   * (exists and last_active_at within 30 minutes). Updates last_active_at on success.
   */
  async verifySession(token: string): Promise<User | null> {
    if (!token) return null;

    const result = await query(
      `SELECT s.id AS session_id, s.last_active_at,
              u.id, u.email, u.name, u.created_at, u.last_active_at AS user_last_active
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = $1`,
      [token],
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    const lastActive = new Date(row.last_active_at);
    const elapsed = Date.now() - lastActive.getTime();

    if (elapsed > SESSION_TTL_MS) {
      // Clean up expired session
      await query(`DELETE FROM sessions WHERE id = $1`, [row.session_id]);
      return null;
    }

    // Touch session — update last_active_at
    await query(
      `UPDATE sessions SET last_active_at = NOW() WHERE id = $1`,
      [row.session_id],
    );

    return {
      id: row.id,
      email: row.email,
      name: row.name,
      createdAt: new Date(row.created_at),
      lastActiveAt: new Date(row.user_last_active),
    };
  }

  /**
   * Destroy a session (logout).
   */
  async logout(token: string): Promise<void> {
    await query(`DELETE FROM sessions WHERE token = $1`, [token]);
  }
}
