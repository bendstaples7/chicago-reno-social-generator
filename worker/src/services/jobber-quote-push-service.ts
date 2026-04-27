import type { QuoteDraft } from 'shared';
import { PlatformError } from '../errors/index.js';
import type { JobberIntegration } from './jobber-integration.js';

export interface PushResult {
  jobberQuoteId: string;
  jobberQuoteNumber: string;
}

const FETCH_REQUEST_CLIENT_QUERY = `
  query FetchRequestClient($id: EncodedId!) {
    request(id: $id) {
      id
      client {
        id
      }
    }
  }
`;

const QUOTE_CREATE_MUTATION = `
  mutation CreateQuote($input: QuoteCreateInput!) {
    quoteCreate(input: $input) {
      quote {
        id
        quoteNumber
        quoteStatus
      }
      userErrors {
        message
        path
      }
    }
  }
`;

export class JobberQuotePushService {
  private readonly db: D1Database;
  private readonly jobberIntegration: JobberIntegration;

  constructor(db: D1Database, jobberIntegration: JobberIntegration) {
    this.db = db;
    this.jobberIntegration = jobberIntegration;
  }

  /**
   * Push a quote draft to Jobber. Resolves the customer, builds the mutation,
   * executes it, and persists the result back to D1.
   * Throws PlatformError on validation or API failures.
   */
  async pushToJobber(draft: QuoteDraft): Promise<PushResult> {
    if (!draft.jobberRequestId) {
      throw new PlatformError({
        severity: 'error',
        component: 'JobberQuotePushService',
        operation: 'pushToJobber',
        description: 'A Jobber request must be linked to this draft before pushing to Jobber.',
        recommendedActions: ['Generate the quote from a Jobber customer request'],
        statusCode: 400,
      });
    }

    // Step 1: Resolve the customer ID from the linked request
    const clientId = await this.resolveCustomerId(draft.jobberRequestId);

    // Step 2: Build the quoteCreate mutation input
    const { query, variables } = this.buildQuoteCreateInput(draft, clientId);

    // Step 3: Execute the mutation
    const response = await this.jobberIntegration.graphqlRequest<{
      quoteCreate: {
        quote: { id: string; quoteNumber: string; quoteStatus: string } | null;
        userErrors: Array<{ message: string; path: string[] }>;
      };
    }>(query, variables);

    // Step 4: Handle userErrors
    if (response.quoteCreate.userErrors && response.quoteCreate.userErrors.length > 0) {
      throw new PlatformError({
        severity: 'error',
        component: 'JobberQuotePushService',
        operation: 'pushToJobber',
        description: `Jobber rejected the quote: ${response.quoteCreate.userErrors[0].message}`,
        recommendedActions: ['Review the error details and adjust the quote draft'],
        statusCode: 422,
      });
    }

    const quote = response.quoteCreate.quote;
    if (!quote) {
      throw new PlatformError({
        severity: 'error',
        component: 'JobberQuotePushService',
        operation: 'pushToJobber',
        description: 'Jobber returned no quote in the response.',
        recommendedActions: ['Try again'],
        statusCode: 502,
      });
    }

    const result: PushResult = {
      jobberQuoteId: quote.id,
      jobberQuoteNumber: quote.quoteNumber,
    };

    // Step 5: Persist the result back to D1
    await this.persistPushResult(draft.id, result.jobberQuoteId, result.jobberQuoteNumber);

    return result;
  }

  /**
   * Resolve the Jobber client ID from a request ID.
   * First checks D1 webhook cache, then falls back to a live GraphQL query.
   */
  private async resolveCustomerId(jobberRequestId: string): Promise<string> {
    // Try cached webhook data first
    const cached = await this.db.prepare(
      'SELECT request_body FROM jobber_webhook_requests WHERE jobber_request_id = ? AND request_body IS NOT NULL LIMIT 1'
    ).bind(jobberRequestId).first<{ request_body: string }>();

    if (cached?.request_body) {
      try {
        const detail = JSON.parse(cached.request_body);
        if (detail.client?.id) {
          return detail.client.id;
        }
      } catch {
        // Fall through to live query
      }
    }

    // Fall back to live GraphQL query
    const response = await this.jobberIntegration.graphqlRequest<{
      request: { id: string; client: { id: string } | null } | null;
    }>(FETCH_REQUEST_CLIENT_QUERY, { id: jobberRequestId });

    if (!response.request?.client?.id) {
      throw new PlatformError({
        severity: 'error',
        component: 'JobberQuotePushService',
        operation: 'resolveCustomerId',
        description: 'The customer request does not have a linked client in Jobber. Cannot create a quote without a customer.',
        recommendedActions: ['Link a client to the request in Jobber, then retry'],
        statusCode: 422,
      });
    }

    return response.request.client.id;
  }

  /**
   * Build the quoteCreate mutation input from a draft and client ID.
   */
  private buildQuoteCreateInput(
    draft: QuoteDraft,
    clientId: string,
  ): { query: string; variables: Record<string, unknown> } {
    const lineItems = draft.lineItems.map((item) => {
      const mapped: Record<string, unknown> = {
        name: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      };
      if (item.description) {
        mapped.description = item.description;
      }
      if (item.productCatalogEntryId) {
        mapped.productOrServiceId = item.productCatalogEntryId;
      }
      return mapped;
    });

    // Build title with zero-padded draft number
    const paddedNumber = String(draft.draftNumber ?? 0).padStart(3, '0');
    const title = `Draft D-${paddedNumber}`;

    // Build message with unresolved items if any
    let message: string | undefined;
    if (draft.unresolvedItems && draft.unresolvedItems.length > 0) {
      const unresolvedTexts = draft.unresolvedItems.map((item) => `• ${item.originalText}`);
      message = `Unresolved items from original request:\n${unresolvedTexts.join('\n')}`;
    }

    const input: Record<string, unknown> = {
      clientId,
      title,
      lineItems,
    };

    if (message) {
      input.message = message;
    }

    return {
      query: QUOTE_CREATE_MUTATION,
      variables: { input },
    };
  }

  /**
   * Persist the Jobber quote identifiers and update status to 'finalized'.
   */
  private async persistPushResult(
    draftId: string,
    jobberQuoteId: string,
    jobberQuoteNumber: string,
  ): Promise<void> {
    await this.db.prepare(
      `UPDATE quote_drafts SET jobber_quote_id = ?, jobber_quote_number = ?, status = 'finalized', updated_at = datetime('now') WHERE id = ?`
    ).bind(jobberQuoteId, jobberQuoteNumber, draftId).run();
  }
}
