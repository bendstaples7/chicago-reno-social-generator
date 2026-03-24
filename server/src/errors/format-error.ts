import type { ErrorResponse } from 'shared';
import type { PlatformError } from './platform-error.js';

/**
 * Maps a PlatformError instance to the ErrorResponse shape sent to the frontend.
 */
export function formatErrorResponse(error: PlatformError): ErrorResponse {
  return {
    severity: error.severity,
    component: error.component,
    operation: error.operation,
    message: error.description,
    actions: error.recommendedActions,
  };
}
