import type { Request, Response, NextFunction } from 'express';
import { PlatformError } from '../errors/platform-error.js';
import { formatErrorResponse } from '../errors/format-error.js';
import type { ActivityLogService } from '../services/activity-log-service.js';

/**
 * Express error-handling middleware.
 * Catches PlatformError instances, logs them, and returns a formatted JSON response.
 * Non-PlatformError errors are wrapped in a generic PlatformError.
 */

let activityLogService: ActivityLogService | null = null;

/**
 * Wire in the ActivityLogService once it's available.
 */
export function setActivityLogService(service: ActivityLogService): void {
  activityLogService = service;
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
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

  // Log to console (ActivityLogService will replace this in task 2.3)
  console.log(
    `[${platformError.severity.toUpperCase()}] ${platformError.component}.${platformError.operation}: ${platformError.description}`,
  );

  // Log to ActivityLogService if wired in
  if (activityLogService) {
    const userId = ((_req as unknown as Record<string, unknown>).userId as string) ?? 'system';
    activityLogService.log({
      userId,
      component: platformError.component,
      operation: platformError.operation,
      severity: platformError.severity,
      description: platformError.description,
      recommendedAction: platformError.recommendedActions[0],
    }).catch((logErr) => {
      console.error('Failed to write to activity log:', logErr);
    });
  }

  const statusCode = platformError.severity === 'warning' ? 400 : 500;
  res.status(statusCode).json(formatErrorResponse(platformError));
}
