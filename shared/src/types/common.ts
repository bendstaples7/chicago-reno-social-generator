/** Pagination parameters for list endpoints */
export interface PaginationParams {
  page: number;
  limit: number;
}

/** Aggregated status of all external service connections */
export interface SystemsStatusResponse {
  jobber: {
    available: boolean;
  };
  jobberSession: {
    configured: boolean;
    expired: boolean;
  };
  instagram: {
    status: 'connected' | 'expired' | 'not_connected';
    accountName?: string;
  };
}
