import type { ErrorHandler } from 'hono';
import { PlatformError } from '../errors/platform-error.js';
import { formatErrorResponse } from '../errors/format-error.js';
import type { Bindings } from '../bindings.js';

export const errorHandler: ErrorHandler<{ Bindings: Bindings }> = async (err, c) => {
  let platformError: PlatformError;

  if (err instanceof PlatformError) {
    platformError = err;
  } else {
    platformError = new PlatformError({
      severity: 'error',
      component: 'Server',
      operation: 'unknown',
      description: err.message || 'An unexpected error occurred.',
      recommendedActions: ['Try again', 'Contact support if the problem persists'],
    });
  }

  const statusCode = platformError.severity === 'warning' ? 400 : 500;

  // Best-effort log to activity_log_entries
  try {
    const db = c.env.DB;
    if (db) {
      const id = crypto.randomUUID();
      // Try to get user from context for user_id
      let userId = 'system';
      try {
        const user = c.get('user' as never) as { id: string } | undefined;
        if (user && user.id) {
          userId = user.id;
        }
      } catch (_) {
        // no user in context
      }
      await db.prepare(
        'INSERT INTO activity_log_entries (id, user_id, component, operation, severity, description) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(id, userId, platformError.component, platformError.operation, platformError.severity, platformError.description).run();
    }
  } catch (_) {
    // do not throw if logging fails
  }

  return c.json(formatErrorResponse(platformError), statusCode as any);
};
