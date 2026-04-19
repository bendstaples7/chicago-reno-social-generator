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
  instagram: {
    status: 'connected' | 'expired' | 'not_connected';
    accountName?: string;
  };
}
