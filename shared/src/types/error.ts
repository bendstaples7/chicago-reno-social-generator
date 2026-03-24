/** Structured error produced by all platform components */
export interface PlatformError {
  severity: 'error' | 'warning';
  component: string;
  operation: string;
  description: string;
  recommendedActions: string[];
}

/** Formatted error response sent to the frontend */
export interface ErrorResponse {
  severity: 'error' | 'warning';
  component: string;
  operation: string;
  message: string;
  actions: string[];
}
