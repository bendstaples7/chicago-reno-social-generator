import { query } from '../config/database.js';
import { EmbeddingService } from './embedding-service.js';
import { ActivityLogService } from './activity-log-service.js';

const PAGE_SIZE = 50;
const POINTS_PER_PAGE = 5;
const POINT_BUDGET = 8_000;
const PAUSE_DURATION_MS = 20_000;
const EMBEDDING_BATCH_SIZE = 20;
const API_TIMEOUT_MS = 10_000;

export interface SyncResult {
  totalFetched: number;
  newQuotes: number;
  updatedQuotes: number;
  unchangedQuotes: number;
  embeddingsGenerated: number;
  durationMs: number;
  error?: string;
}

interface JobberQuoteNode {
  id: string;
  quoteNumber: string;
  title: string | null;
  message: string | null;
  quoteStatus: string;
}

interface RelayPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface GraphQLResponse {
  data?: {
    quotes: {
      edges: Array<{ node: JobberQuoteNode }>;
      pageInfo: RelayPageInfo;
    };
  };
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
}

interface CorpusRecord {
  jobber_quote_id: string;
  title: string | null;
  message: string | null;
  quote_status: string;
}

const QUOTES_QUERY = `
  query FetchQuotesForCorpus($first: Int!, $after: String) {
    quotes(first: $first, after: $after) {
      edges {
        node {
          id
          quoteNumber
          title
          message
          quoteStatus
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export class QuoteSyncService {
  private embeddingService: EmbeddingService;
  private activityLog: ActivityLogService;
  private sleepFn: (ms: number) => Promise<void>;

  constructor(
    embeddingService: EmbeddingService,
    activityLog: ActivityLogService,
    sleepFn: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {
    this.embeddingService = embeddingService;
    this.activityLog = activityLog;
    this.sleepFn = sleepFn;
  }

  /**
   * Synchronize the quote corpus with Jobber.
   * Fetches all approved/converted quotes, upserts into corpus,
   * and generates embeddings for new/changed text.
   */
  async sync(): Promise<SyncResult> {
    const startTime = Date.now();
    const result: SyncResult = {
      totalFetched: 0,
      newQuotes: 0,
      updatedQuotes: 0,
      unchangedQuotes: 0,
      embeddingsGenerated: 0,
      durationMs: 0,
    };

    try {
      // Fetch all approved/converted quotes from Jobber
      const quotes = await this.fetchAllQuotes();
      result.totalFetched = quotes.length;

      // Load existing corpus records for comparison
      const existingMap = await this.loadExistingCorpus();

      // Categorize quotes: new, changed, unchanged
      const newQuotes: JobberQuoteNode[] = [];
      const changedQuotes: Array<{ node: JobberQuoteNode; textChanged: boolean }> = [];

      for (const q of quotes) {
        const existing = existingMap.get(q.id);
        if (!existing) {
          newQuotes.push(q);
        } else if (
          existing.title !== q.title ||
          existing.message !== q.message ||
          existing.quote_status !== q.quoteStatus
        ) {
          const textChanged = existing.title !== q.title || existing.message !== q.message;
          changedQuotes.push({ node: q, textChanged });
        } else {
          result.unchangedQuotes++;
        }
      }

      result.newQuotes = newQuotes.length;
      result.updatedQuotes = changedQuotes.length;

      // Collect quotes that need embeddings
      const needsEmbedding: Array<{ quoteId: string; searchableText: string }> = [];

      // Upsert new quotes
      for (const q of newQuotes) {
        const searchableText = buildSearchableText(q.title, q.message);
        await this.upsertQuote(q, searchableText);
        needsEmbedding.push({ quoteId: q.id, searchableText });
      }

      // Upsert changed quotes
      for (const { node: q, textChanged } of changedQuotes) {
        const searchableText = buildSearchableText(q.title, q.message);
        await this.upsertQuote(q, searchableText);
        if (textChanged) {
          needsEmbedding.push({ quoteId: q.id, searchableText });
        }
      }

      // Generate embeddings in batches
      result.embeddingsGenerated = await this.generateEmbeddings(needsEmbedding);

      // Update sync status
      const durationMs = Date.now() - startTime;
      result.durationMs = durationMs;
      await this.updateSyncStatus(result.totalFetched, durationMs, null);

      // Log success
      await this.activityLog.log({
        userId: 'system',
        component: 'QuoteSyncService',
        operation: 'sync',
        severity: 'info',
        description: `Corpus sync completed: ${result.totalFetched} fetched, ${result.newQuotes} new, ${result.updatedQuotes} updated, ${result.embeddingsGenerated} embeddings generated in ${durationMs}ms.`,
      });

      return result;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      result.durationMs = durationMs;
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      result.error = errorMessage;

      // Log error but retain existing corpus
      await this.activityLog.log({
        userId: 'system',
        component: 'QuoteSyncService',
        operation: 'sync',
        severity: 'error',
        description: `Corpus sync failed: ${errorMessage}`,
        recommendedAction: 'Check Jobber API credentials and connectivity. Existing corpus data has been preserved.',
      });

      // Update sync status with error
      await this.updateSyncStatus(null, durationMs, errorMessage);

      return result;
    }
  }

  /**
   * Get the current corpus status.
   */
  async getStatus(): Promise<{ totalQuotes: number; lastSyncAt: string | null }> {
    const result = await query(
      'SELECT total_quotes, last_sync_at FROM quote_corpus_sync_status WHERE id = 1',
    );

    if (result.rows.length === 0) {
      return { totalQuotes: 0, lastSyncAt: null };
    }

    const row = result.rows[0];
    return {
      totalQuotes: Number(row.total_quotes),
      lastSyncAt: row.last_sync_at ? new Date(row.last_sync_at as string).toISOString() : null,
    };
  }

  // ── Private helpers ──────────────────────────────────────────

  /**
   * Fetch all approved/converted quotes from Jobber via paginated GraphQL queries.
   * Tracks estimated API point cost and pauses if approaching the budget.
   */
  private async fetchAllQuotes(): Promise<JobberQuoteNode[]> {
    const allQuotes: JobberQuoteNode[] = [];
    let after: string | null = null;
    let cumulativePoints = 0;

    do {
      // Rate limit: pause if approaching budget
      if (cumulativePoints >= POINT_BUDGET) {
        await this.sleepFn(PAUSE_DURATION_MS);
        cumulativePoints = 0;
      }

      const response = await this.executeGraphql(after);
      cumulativePoints += POINTS_PER_PAGE;

      const connection = response.data?.quotes;
      if (!connection || !connection.edges) break;

      for (const edge of connection.edges) {
        const node = edge.node;
        // Only include approved or converted quotes
        if (node.quoteStatus === 'approved' || node.quoteStatus === 'converted') {
          allQuotes.push(node);
        }
      }

      if (connection.pageInfo.hasNextPage && connection.pageInfo.endCursor) {
        after = connection.pageInfo.endCursor;
      } else {
        break;
      }
    } while (true);

    return allQuotes;
  }

  /**
   * Execute a single GraphQL request to the Jobber API.
   * Handles 429 rate limit errors by waiting and retrying up to `retries` times.
   */
  private async executeGraphql(after: string | null, retries: number = 5): Promise<GraphQLResponse> {
    const accessToken = process.env.JOBBER_ACCESS_TOKEN || '';
    if (!accessToken) {
      throw new Error('JOBBER_ACCESS_TOKEN is not configured');
    }

    const url = process.env.JOBBER_API_URL || 'https://api.getjobber.com/api/graphql';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-JOBBER-GRAPHQL-VERSION': '2025-04-16',
        },
        body: JSON.stringify({
          query: QUOTES_QUERY,
          variables: { first: PAGE_SIZE, after },
        }),
        signal: controller.signal,
      });

      // Handle rate limiting
      if (response.status === 429) {
        if (retries <= 0) {
          throw new Error('Jobber API rate limit: max retries exhausted (429)');
        }
        const retryAfter = response.headers.get('retry-after');
        const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : PAUSE_DURATION_MS;
        await this.sleepFn(waitMs);
        return this.executeGraphql(after, retries - 1);
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Jobber API error (${response.status}): ${text}`);
      }

      const json = (await response.json()) as GraphQLResponse;

      // Check for GraphQL-level throttle errors
      if (json.errors && json.errors.length > 0) {
        const throttleError = json.errors.find(
          (e) => e.extensions?.code === 'THROTTLED' || e.message.toLowerCase().includes('throttl'),
        );
        if (throttleError) {
          if (retries <= 0) {
            throw new Error('Jobber API throttle: max retries exhausted (THROTTLED)');
          }
          const retryMs =
            typeof throttleError.extensions?.retryAfter === 'number'
              ? throttleError.extensions.retryAfter * 1000
              : PAUSE_DURATION_MS;
          await this.sleepFn(retryMs);
          return this.executeGraphql(after, retries - 1);
        }
        throw new Error(`Jobber GraphQL error: ${json.errors[0].message}`);
      }

      return json;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Load all existing corpus records into a map keyed by Jobber quote ID.
   */
  private async loadExistingCorpus(): Promise<Map<string, CorpusRecord>> {
    const result = await query(
      'SELECT jobber_quote_id, title, message, quote_status FROM quote_corpus',
    );
    const map = new Map<string, CorpusRecord>();
    for (const row of result.rows) {
      map.set(row.jobber_quote_id as string, {
        jobber_quote_id: row.jobber_quote_id as string,
        title: row.title as string | null,
        message: row.message as string | null,
        quote_status: row.quote_status as string,
      });
    }
    return map;
  }

  /**
   * Upsert a quote into the corpus table.
   */
  private async upsertQuote(node: JobberQuoteNode, searchableText: string): Promise<void> {
    await query(
      `INSERT INTO quote_corpus (id, jobber_quote_id, quote_number, title, message, quote_status, searchable_text, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (jobber_quote_id) DO UPDATE SET
         quote_number = $2,
         title = $3,
         message = $4,
         quote_status = $5,
         searchable_text = $6,
         updated_at = NOW()`,
      [node.id, node.quoteNumber, node.title, node.message, node.quoteStatus, searchableText],
    );
  }

  /**
   * Generate embeddings for quotes in batches and store them.
   */
  private async generateEmbeddings(
    items: Array<{ quoteId: string; searchableText: string }>,
  ): Promise<number> {
    if (items.length === 0) return 0;

    let generated = 0;

    for (let offset = 0; offset < items.length; offset += EMBEDDING_BATCH_SIZE) {
      const batch = items.slice(offset, offset + EMBEDDING_BATCH_SIZE);
      const texts = batch.map((item) => item.searchableText);

      try {
        const embeddings = await this.embeddingService.embedBatch(texts);

        for (let i = 0; i < batch.length; i++) {
          await query(
            'UPDATE quote_corpus SET embedding = $1, updated_at = NOW() WHERE jobber_quote_id = $2',
            [JSON.stringify(embeddings[i]), batch[i].quoteId],
          );
          generated++;
        }
      } catch (err) {
        // Log embedding failure but continue with remaining batches
        console.error(
          `[QuoteSyncService] Embedding batch failed at offset ${offset}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    return generated;
  }

  /**
   * Update the sync status singleton row.
   */
  private async updateSyncStatus(
    totalQuotes: number | null,
    durationMs: number,
    error: string | null,
  ): Promise<void> {
    try {
      if (totalQuotes !== null) {
        await query(
          `UPDATE quote_corpus_sync_status
           SET last_sync_at = NOW(), total_quotes = $1, last_sync_duration_ms = $2, last_sync_error = NULL
           WHERE id = 1`,
          [totalQuotes, durationMs],
        );
      } else {
        await query(
          `UPDATE quote_corpus_sync_status
           SET last_sync_duration_ms = $1, last_sync_error = $2
           WHERE id = 1`,
          [durationMs, error],
        );
      }
    } catch (err) {
      console.error('[QuoteSyncService] Failed to update sync status:', err);
    }
  }
}

/**
 * Build searchable text from title and message.
 * Handles null/empty values gracefully.
 */
export function buildSearchableText(title: string | null, message: string | null): string {
  const t = title?.trim() || '';
  const m = message?.trim() || '';
  if (t && m) return `${t} ${m}`;
  return t || m;
}
