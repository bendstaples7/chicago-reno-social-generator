import { EmbeddingService } from './embedding-service.js';
import { ActivityLogService } from './activity-log-service.js';
import { JobberIntegration } from './jobber-integration.js';

const EMBEDDING_BATCH_SIZE = 20;

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
  private readonly db: D1Database;
  private readonly embeddingService: EmbeddingService;
  private readonly activityLog: ActivityLogService;
  private readonly jobberIntegration: JobberIntegration;

  constructor(
    db: D1Database,
    embeddingService: EmbeddingService,
    activityLog: ActivityLogService,
    jobberIntegration: JobberIntegration,
  ) {
    this.db = db;
    this.embeddingService = embeddingService;
    this.activityLog = activityLog;
    this.jobberIntegration = jobberIntegration;
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
      if (!this.jobberIntegration.isAvailable()) {
        throw new Error('Jobber API is not available. Check credentials and connectivity.');
      }

      // Fetch all approved/converted quotes from Jobber
      const quotes = await this.fetchAllQuotes();
      result.totalFetched = quotes.length;

      // Load existing corpus records for comparison
      const existingMap = await this.loadExistingCorpus();

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

      const durationMs = Date.now() - startTime;
      result.durationMs = durationMs;
      await this.updateSyncStatus(result.totalFetched, durationMs, null);

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

      await this.activityLog.log({
        userId: 'system',
        component: 'QuoteSyncService',
        operation: 'sync',
        severity: 'error',
        description: `Corpus sync failed: ${errorMessage}`,
        recommendedAction: 'Check Jobber API credentials and connectivity.',
      });

      await this.updateSyncStatus(null, durationMs, errorMessage);
      return result;
    }
  }

  /**
   * Get the current corpus status.
   */
  async getStatus(): Promise<{ totalQuotes: number; lastSyncAt: string | null }> {
    try {
      const row = await this.db.prepare(
        'SELECT total_quotes, last_sync_at FROM quote_corpus_sync_status WHERE id = 1'
      ).first() as { total_quotes: number; last_sync_at: string | null } | null;

      if (!row) {
        return { totalQuotes: 0, lastSyncAt: null };
      }

      return {
        totalQuotes: Number(row.total_quotes),
        lastSyncAt: row.last_sync_at ? new Date(row.last_sync_at).toISOString() : null,
      };
    } catch {
      return { totalQuotes: 0, lastSyncAt: null };
    }
  }

  // ── Private helpers ──────────────────────────────────────────

  /**
   * Fetch all approved/converted quotes from Jobber via the integration's
   * paginated GraphQL helper. Filters to approved/converted status.
   */
  private async fetchAllQuotes(): Promise<JobberQuoteNode[]> {
    // Use the integration's graphql infrastructure by fetching templates
    // (which uses the same quotes query) — but we need the raw nodes.
    // Instead, we'll do our own paginated fetch using the Jobber API directly.
    const allQuotes: JobberQuoteNode[] = [];
    let after: string | null = null;
    const PAGE_SIZE = 50;

    do {
      const response = await this.executeGraphql(after, PAGE_SIZE);
      const connection = response?.quotes;
      if (!connection || !connection.edges) break;

      for (const edge of connection.edges) {
        const node = edge.node;
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
   * Execute a GraphQL query against the Jobber API.
   * Reuses the access token from the JobberIntegration instance.
   */
  private async executeGraphql(
    after: string | null,
    pageSize: number,
  ): Promise<{
    quotes: {
      edges: Array<{ node: JobberQuoteNode }>;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  }> {
    // Access the integration's token by making a test call
    // We need to use fetch directly since the integration doesn't expose raw graphql
    const accessToken = (this.jobberIntegration as any).accessToken as string;
    const apiUrl = (this.jobberIntegration as any).apiUrl as string || 'https://api.getjobber.com/api/graphql';

    if (!accessToken) {
      throw new Error('Jobber access token is not available');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-JOBBER-GRAPHQL-VERSION': '2025-04-16',
        },
        body: JSON.stringify({
          query: QUOTES_QUERY,
          variables: { first: pageSize, after },
        }),
        signal: controller.signal,
      });

      if (response.status === 429) {
        // Rate limited — wait and retry
        await new Promise((r) => setTimeout(r, 20_000));
        return this.executeGraphql(after, pageSize);
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Jobber API error (${response.status}): ${text}`);
      }

      const json = (await response.json()) as {
        data?: {
          quotes: {
            edges: Array<{ node: JobberQuoteNode }>;
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
          };
        };
        errors?: Array<{ message: string }>;
      };

      if (json.errors && json.errors.length > 0) {
        const isThrottled = json.errors.some((e) => /throttle/i.test(e.message));
        if (isThrottled) {
          await new Promise((r) => setTimeout(r, 20_000));
          return this.executeGraphql(after, pageSize);
        }
        throw new Error(`Jobber GraphQL error: ${json.errors[0].message}`);
      }

      return json.data!;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async loadExistingCorpus(): Promise<Map<string, CorpusRecord>> {
    const result = await this.db.prepare(
      'SELECT jobber_quote_id, title, message, quote_status FROM quote_corpus'
    ).all();

    const map = new Map<string, CorpusRecord>();
    for (const row of result.results as Record<string, unknown>[]) {
      map.set(row.jobber_quote_id as string, {
        jobber_quote_id: row.jobber_quote_id as string,
        title: row.title as string | null,
        message: row.message as string | null,
        quote_status: row.quote_status as string,
      });
    }
    return map;
  }

  private async upsertQuote(node: JobberQuoteNode, searchableText: string): Promise<void> {
    const existing = await this.db.prepare(
      'SELECT id FROM quote_corpus WHERE jobber_quote_id = ?'
    ).bind(node.id).first();

    if (existing) {
      await this.db.prepare(
        `UPDATE quote_corpus SET
           quote_number = ?, title = ?, message = ?, quote_status = ?,
           searchable_text = ?, updated_at = datetime('now')
         WHERE jobber_quote_id = ?`
      ).bind(node.quoteNumber, node.title, node.message, node.quoteStatus, searchableText, node.id).run();
    } else {
      await this.db.prepare(
        `INSERT INTO quote_corpus (id, jobber_quote_id, quote_number, title, message, quote_status, searchable_text)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), node.id, node.quoteNumber, node.title, node.message, node.quoteStatus, searchableText).run();
    }
  }

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
          await this.db.prepare(
            "UPDATE quote_corpus SET embedding = ?, updated_at = datetime('now') WHERE jobber_quote_id = ?"
          ).bind(JSON.stringify(embeddings[i]), batch[i].quoteId).run();
          generated++;
        }
      } catch (err) {
        console.error(
          `[QuoteSyncService] Embedding batch failed at offset ${offset}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    return generated;
  }

  private async updateSyncStatus(
    totalQuotes: number | null,
    durationMs: number,
    error: string | null,
  ): Promise<void> {
    try {
      if (totalQuotes !== null) {
        await this.db.prepare(
          `UPDATE quote_corpus_sync_status
           SET last_sync_at = datetime('now'), total_quotes = ?, last_sync_duration_ms = ?, last_sync_error = NULL
           WHERE id = 1`
        ).bind(totalQuotes, durationMs).run();
      } else {
        await this.db.prepare(
          `UPDATE quote_corpus_sync_status
           SET last_sync_duration_ms = ?, last_sync_error = ?
           WHERE id = 1`
        ).bind(durationMs, error).run();
      }
    } catch (err) {
      console.error('[QuoteSyncService] Failed to update sync status:', err);
    }
  }
}

export function buildSearchableText(title: string | null, message: string | null): string {
  const t = title?.trim() || '';
  const m = message?.trim() || '';
  if (t && m) return `${t} ${m}`;
  return t || m;
}
