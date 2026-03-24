import type { PlatformError as PlatformErrorInterface } from 'shared';

/**
 * Concrete error class implementing the PlatformError interface.
 * Extends Error so it can be thrown and caught in standard try/catch flows.
 */
export class PlatformError extends Error implements PlatformErrorInterface {
  public readonly severity: 'error' | 'warning';
  public readonly component: string;
  public readonly operation: string;
  public readonly description: string;
  public readonly recommendedActions: string[];
  public readonly statusCode?: number;

  constructor(params: PlatformErrorInterface & { statusCode?: number }) {
    super(params.description);
    this.name = 'PlatformError';

    if (!params.recommendedActions || params.recommendedActions.length === 0) {
      throw new Error('PlatformError requires at least one recommended action');
    }

    this.severity = params.severity;
    this.component = params.component;
    this.operation = params.operation;
    this.description = params.description;
    this.recommendedActions = params.recommendedActions;
    this.statusCode = params.statusCode;
  }
}
