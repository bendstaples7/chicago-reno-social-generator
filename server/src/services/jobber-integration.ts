import { ActivityLogService } from './activity-log-service.js';
import { query as dbQuery } from '../config/database.js';
import type { ProductCatalogEntry, QuoteTemplate, JobberCustomerRequest } from 'shared';
import { readFileSync, writeFileSync, renameSync } from 'fs';
import { resolve } from 'path';

const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const API_TIMEOUT_MS = 10_000;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGES = 100;

// ── Internal GraphQL response types ──────────────────────────────────

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
}

interface RelayConnection<T> {
  edges: Array<{ node: T }>;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

interface JobberProductNode {
  id: string;
  name: string;
  description: string | null;
  defaultUnitCost: number;
  category: string;
}

interface JobberQuoteNode {
  id: string;
  quoteNumber: string;
  title: string | null;
  message: string | null;
  quoteStatus: string;
}

interface JobberRequestNode {
  id: string;
  title: string | null;
  companyName: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  requestStatus: string;
  createdAt: string;
  jobberWebUri: string;
  notes: {
    edges: Array<{ node: { message?: string; createdAt?: string; createdBy?: { __typename: string } } }>;
  };
  noteAttachments: {
    edges: Array<{ node: { url: string; fileName: string; contentType: string } }>;
  };
}

// ── Cache helper ─────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

// ── GraphQL queries ──────────────────────────────────────────────────

const PRODUCTS_QUERY = `
  query FetchProducts($first: Int!, $after: String) {
    productsAndServices(first: $first, after: $after) {
      edges {
        node {
          id
          name
          description
          defaultUnitCost
          category
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const QUOTES_QUERY = `
  query FetchQuoteTemplates($first: Int!, $after: String) {
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

const REQUESTS_QUERY = `
  query FetchRequests($first: Int!, $after: String) {
    requests(first: $first, after: $after) {
      edges {
        node {
          id
          title
          companyName
          contactName
          phone
          email
          requestStatus
          createdAt
          jobberWebUri
          notes(first: 5) {
            edges {
              node {
                ... on RequestNote {
                  message
                  createdAt
                  createdBy {
                    __typename
                  }
                }
              }
            }
          }
          noteAttachments(first: 5) {
            edges {
              node {
                url
                fileName
                contentType
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// ── Main class ───────────────────────────────────────────────────────

export class JobberIntegration {
  private activityLog: ActivityLogService;
  private available: boolean = true;
  private cacheTtlMs: number;

  private productCatalogCache: CacheEntry<ProductCatalogEntry[]> | null = null;
  private templateLibraryCache: CacheEntry<QuoteTemplate[]> | null = null;
  private customerRequestsCache: CacheEntry<JobberCustomerRequest[]> | null = null;

  private accessToken: string;
  private refreshToken: string;
  private clientId: string;
  private clientSecret: string;

  constructor(activityLog: ActivityLogService, cacheTtlMs: number = DEFAULT_CACHE_TTL_MS) {
    this.activityLog = activityLog;
    this.cacheTtlMs = cacheTtlMs;
    this.accessToken = process.env.JOBBER_ACCESS_TOKEN || '';
    this.refreshToken = process.env.JOBBER_REFRESH_TOKEN || '';
    this.clientId = process.env.JOBBER_CLIENT_ID || '';
    this.clientSecret = process.env.JOBBER_CLIENT_SECRET || '';
  }

  /**
   * Check whether the Jobber API is currently reachable.
   * Returns false after an API error until a successful fetch restores it.
   */
  isAvailable(): boolean {
    return this.available;
  }

  /**
   * Clear all cached data, forcing fresh fetches on next call.
   */
  invalidateCache(): void {
    this.productCatalogCache = null;
    this.templateLibraryCache = null;
    this.customerRequestsCache = null;
  }

  // ── Product Catalog ──────────────────────────────────────────────

  /**
   * Fetch the product catalog from Jobber, returning cached data when within TTL.
   * On API failure, logs the error, sets available = false, and returns an empty array.
   */
  async fetchProductCatalog(): Promise<ProductCatalogEntry[]> {
    if (this.productCatalogCache && !this.isCacheExpired(this.productCatalogCache)) {
      return this.productCatalogCache.data;
    }

    let catalog: ProductCatalogEntry[] = [];

    try {
      const nodes = await this.fetchAllPages<JobberProductNode>(
        PRODUCTS_QUERY,
        { first: DEFAULT_PAGE_SIZE, after: null },
        ['productsAndServices'],
      );

      if (nodes.length > 0) {
        catalog = nodes.map((p) => ({
          id: p.id,
          name: p.name,
          unitPrice: p.defaultUnitCost,
          description: p.description ?? '',
          category: p.category ?? undefined,
          source: 'jobber' as const,
        }));
      }
    } catch (err) {
      // API failed — log but don't give up yet, try DB fallback below
      await this.handleApiError('fetchProductCatalog', err);
    }

    // Fallback: load from imported CSV products in database
    if (catalog.length === 0) {
      catalog = await this.loadImportedProducts();
      if (catalog.length > 0) {
        // Restore availability since we have products from the DB
        this.available = true;
      }
    }

    this.productCatalogCache = { data: catalog, fetchedAt: Date.now() };
    if (catalog.length > 0) {
      this.available = true;
    }
    return catalog;
  }

  /**
   * Load products from the jobber_products table (imported from CSV).
   */
  private async loadImportedProducts(): Promise<ProductCatalogEntry[]> {
    try {
      const result = await dbQuery(
        'SELECT id, name, description, category, unit_price FROM jobber_products WHERE active = true ORDER BY name',
      );
      return result.rows.map((row: Record<string, unknown>) => ({
        id: row.id as string,
        name: row.name as string,
        unitPrice: Number(row.unit_price),
        description: (row.description as string) ?? '',
        category: (row.category as string) ?? undefined,
        source: 'jobber' as const,
      }));
    } catch {
      return [];
    }
  }

  // ── Template Library ─────────────────────────────────────────────

  /**
   * Fetch the template library from Jobber, returning cached data when within TTL.
   * On API failure, logs the error, sets available = false, and returns an empty array.
   */
  async fetchTemplateLibrary(): Promise<QuoteTemplate[]> {
    if (this.templateLibraryCache && !this.isCacheExpired(this.templateLibraryCache)) {
      return this.templateLibraryCache.data;
    }

    let templates: QuoteTemplate[] = [];

    try {
      const nodes = await this.fetchAllPages<JobberQuoteNode>(
        QUOTES_QUERY,
        { first: DEFAULT_PAGE_SIZE, after: null },
        ['quotes'],
      );

      templates = nodes.map((t) => ({
        id: t.id,
        name: t.title || `Quote #${t.quoteNumber}`,
        content: t.message || '',
        source: 'jobber' as const,
      }));

      // Persist to DB cache for offline fallback
      if (templates.length > 0) {
        await this.cacheTemplatesToDb(templates);
      }
    } catch (err) {
      await this.handleApiError('fetchTemplateLibrary', err);
    }

    // Fallback: load from DB cache
    if (templates.length === 0) {
      templates = await this.loadCachedTemplates();
      if (templates.length > 0) {
        this.available = true;
      }
    }

    this.templateLibraryCache = { data: templates, fetchedAt: Date.now() };
    if (templates.length > 0) {
      this.available = true;
    }
    return templates;
  }

  private async cacheTemplatesToDb(templates: QuoteTemplate[]): Promise<void> {
    try {
      for (const t of templates) {
        await dbQuery(
          'INSERT INTO jobber_templates_cache (id, name, content) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET name = $2, content = $3, cached_at = NOW()',
          [t.id, t.name, t.content],
        );
      }
    } catch {
      /* ignore cache write failures */
    }
  }

  private async loadCachedTemplates(): Promise<QuoteTemplate[]> {
    try {
      const result = await dbQuery('SELECT id, name, content FROM jobber_templates_cache ORDER BY name');
      return result.rows.map((row: Record<string, unknown>) => ({
        id: row.id as string,
        name: row.name as string,
        content: (row.content as string) ?? '',
        source: 'jobber' as const,
      }));
    } catch {
      return [];
    }
  }

  // ── Customer Requests ────────────────────────────────────────────

  /**
   * Fetch customer requests from Jobber, returning cached data when within TTL.
   * On failure, logs the error and returns [] but does NOT set available = false.
   */
  async fetchCustomerRequests(): Promise<JobberCustomerRequest[]> {
    if (this.customerRequestsCache && !this.isCacheExpired(this.customerRequestsCache)) {
      return this.customerRequestsCache.data;
    }

    try {
      const nodes = await this.fetchAllPages<JobberRequestNode>(
        REQUESTS_QUERY,
        { first: DEFAULT_PAGE_SIZE, after: null },
        ['requests'],
      );

      const requests: JobberCustomerRequest[] = nodes.map((r) => {
        const structuredNotes = r.notes.edges
          .filter((e) => e.node?.message)
          .map((e) => {
            const typeName = e.node.createdBy?.__typename ?? '';
            let createdBy: 'team' | 'client' | 'system' = 'system';
            if (typeName === 'User') createdBy = 'team';
            else if (typeName === 'Client') createdBy = 'client';
            return {
              message: e.node.message!,
              createdBy,
              createdAt: e.node.createdAt ?? r.createdAt,
            };
          });

        return {
          id: r.id,
          title: r.title || 'Untitled Request',
          clientName: r.companyName || r.contactName || 'Unknown',
          description: r.notes.edges[0]?.node?.message || '',
          notes: r.notes.edges
            .map((e) => e.node?.message)
            .filter((m): m is string => !!m),
          structuredNotes,
          imageUrls: (r.noteAttachments?.edges ?? [])
            .filter((e) => e.node.contentType.startsWith('image/'))
            .map((e) => e.node.url),
          jobberWebUri: r.jobberWebUri,
          createdAt: r.createdAt,
        };
      });

      // Sort by createdAt descending (newest first)
      requests.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      this.customerRequestsCache = { data: requests, fetchedAt: Date.now() };
      return requests;
    } catch (err) {
      // Log error but do NOT set available = false
      const description =
        err instanceof Error && err.name === 'AbortError'
          ? 'Jobber API request timed out during fetchCustomerRequests'
          : `Jobber API error during fetchCustomerRequests: ${err instanceof Error ? err.message : 'Unknown error'}`;

      try {
        await this.activityLog.log({
          userId: 'system',
          component: 'JobberIntegration',
          operation: 'fetchCustomerRequests',
          severity: 'error',
          description,
          recommendedAction: 'Check Jobber API credentials and connectivity. Customer requests are unavailable but manual entry still works.',
        });
      } catch (logErr) {
        console.error('Failed to write to activity log:', logErr);
      }

      return [];
    }
  }

  // ── Private helpers ──────────────────────────────────────────────

  private isCacheExpired<T>(entry: CacheEntry<T>): boolean {
    return Date.now() - entry.fetchedAt >= this.cacheTtlMs;
  }

  /**
   * Send a GraphQL query to the Jobber API and return the parsed data.
   * Automatically refreshes the access token on 401 and retries once.
   */
  private async graphqlRequest<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const result = await this.executeGraphql<T>(query, variables);

    // If we got a 401 and have a refresh token, try refreshing and retry once
    if (result.status === 401 && this.refreshToken) {
      const refreshed = await this.refreshAccessToken();
      if (refreshed) {
        const retry = await this.executeGraphql<T>(query, variables);
        if (retry.status !== undefined) {
          throw new Error(`Jobber API error (${retry.status}): ${retry.errorText}`);
        }
        return retry.data!;
      }
    }

    if (result.status !== undefined) {
      throw new Error(`Jobber API error (${result.status}): ${result.errorText}`);
    }

    return result.data!;
  }

  private async executeGraphql<T>(query: string, variables?: Record<string, unknown>): Promise<{
    data?: T;
    status?: number;
    errorText?: string;
  }> {
    if (!this.accessToken) {
      throw new Error('JOBBER_ACCESS_TOKEN is not configured');
    }

    const url = process.env.JOBBER_API_URL || 'https://api.getjobber.com/api/graphql';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          'X-JOBBER-GRAPHQL-VERSION': '2025-04-16',
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        return { status: response.status, errorText: text };
      }

      const json = (await response.json()) as GraphQLResponse<T>;

      if (json.errors && json.errors.length > 0) {
        throw new Error(`Jobber GraphQL error: ${json.errors[0].message}`);
      }

      if (!json.data) {
        throw new Error('Jobber GraphQL response missing data field');
      }

      return { data: json.data };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Refresh the Jobber access token using the refresh token.
   * Returns true if the refresh succeeded.
   */
  private async refreshAccessToken(): Promise<boolean> {
    try {
      const tokenUrl = process.env.JOBBER_TOKEN_URL || 'https://api.getjobber.com/api/oauth/token';
      const body = new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
      });

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      if (!response.ok) {
        console.error(`[JobberIntegration] Token refresh failed (${response.status}): ${await response.text()}`);
        return false;
      }

      const data = (await response.json()) as { access_token: string; refresh_token?: string };
      this.accessToken = data.access_token;

      // If refresh token rotation is enabled, Jobber returns a new refresh token
      if (data.refresh_token) {
        this.refreshToken = data.refresh_token;
      }

      // Persist new tokens to .env so they survive server restarts
      try {
        const envPath = resolve(import.meta.dirname, '../../.env');
        let envContent = '';
        try {
          envContent = readFileSync(envPath, 'utf-8');
        } catch {
          envContent = '';
        }
        const originalContent = envContent;

        const accessTokenRegex = /^JOBBER_ACCESS_TOKEN=.*/m;
        if (accessTokenRegex.test(envContent)) {
          envContent = envContent.replace(
            accessTokenRegex,
            `JOBBER_ACCESS_TOKEN=${data.access_token}`,
          );
        } else {
          console.warn('[JobberIntegration] JOBBER_ACCESS_TOKEN not found in .env — appending');
          envContent += `\nJOBBER_ACCESS_TOKEN=${data.access_token}\n`;
        }

        if (data.refresh_token) {
          const refreshTokenRegex = /^JOBBER_REFRESH_TOKEN=.*/m;
          if (refreshTokenRegex.test(envContent)) {
            envContent = envContent.replace(
              refreshTokenRegex,
              `JOBBER_REFRESH_TOKEN=${data.refresh_token}`,
            );
          } else {
            console.warn('[JobberIntegration] JOBBER_REFRESH_TOKEN not found in .env — appending');
            envContent += `\nJOBBER_REFRESH_TOKEN=${data.refresh_token}\n`;
          }
        }

        if (envContent === originalContent) {
          console.warn('[JobberIntegration] .env content unchanged after token replacement');
        }

        writeFileSync(envPath + '.tmp', envContent, 'utf-8');
        renameSync(envPath + '.tmp', envPath);
        console.log('[JobberIntegration] Tokens persisted to .env');
      } catch (writeErr) {
        console.error('[JobberIntegration] Failed to persist tokens to .env:', writeErr);
      }

      console.log('[JobberIntegration] Access token refreshed successfully');
      return true;
    } catch (err) {
      console.error('[JobberIntegration] Token refresh error:', err);
      return false;
    }
  }

  /**
   * Paginate through a Relay-style connection, accumulating all nodes.
   */
  private async fetchAllPages<TNode>(
    query: string,
    variables: Record<string, unknown>,
    connectionPath: string[],
    pageSize: number = DEFAULT_PAGE_SIZE,
  ): Promise<TNode[]> {
    const allNodes: TNode[] = [];
    let after: string | null = null;
    let pageCount = 0;

    do {
      if (pageCount >= MAX_PAGES) {
        console.warn(`[JobberIntegration] fetchAllPages: hit MAX_PAGES limit (${MAX_PAGES}), stopping pagination with ${allNodes.length} nodes collected`);
        break;
      }

      const vars = { ...variables, first: pageSize, after };
      const data = await this.graphqlRequest<Record<string, unknown>>(query, vars);
      pageCount++;

      // Navigate to the connection object using the path
      let connection: unknown = data;
      for (const key of connectionPath) {
        connection = (connection as Record<string, unknown>)[key];
      }

      const typed = connection as RelayConnection<TNode>;
      if (!typed || !typed.edges) {
        break;
      }

      for (const edge of typed.edges) {
        allNodes.push(edge.node);
      }

      if (typed.pageInfo.hasNextPage && typed.pageInfo.endCursor) {
        after = typed.pageInfo.endCursor;
      } else {
        break;
      }
    } while (true);

    return allNodes;
  }

  private async handleApiError(operation: string, err: unknown): Promise<void> {
    this.available = false;

    const description =
      err instanceof Error && err.name === 'AbortError'
        ? `Jobber API request timed out during ${operation}`
        : `Jobber API error during ${operation}: ${err instanceof Error ? err.message : 'Unknown error'}`;

    try {
      await this.activityLog.log({
        userId: 'system',
        component: 'JobberIntegration',
        operation,
        severity: 'error',
        description,
        recommendedAction: 'Check Jobber API credentials and connectivity. Using manual fallback mode.',
      });
    } catch (logErr) {
      console.error('Failed to write to activity log:', logErr);
    }
  }
}
