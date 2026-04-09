import { ActivityLogService } from './activity-log-service.js';
import type { ProductCatalogEntry, QuoteTemplate } from 'shared';

const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const API_TIMEOUT_MS = 10_000;

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

export class JobberIntegration {
  private activityLog: ActivityLogService;
  private available: boolean = true;
  private cacheTtlMs: number;

  private productCatalogCache: CacheEntry<ProductCatalogEntry[]> | null = null;
  private templateLibraryCache: CacheEntry<QuoteTemplate[]> | null = null;

  private clientId: string;
  private clientSecret: string;
  private accessToken: string;
  private apiUrl: string;

  constructor(
    activityLog: ActivityLogService,
    opts: {
      clientId: string;
      clientSecret: string;
      accessToken: string;
      apiUrl?: string;
      cacheTtlMs?: number;
    },
  ) {
    this.activityLog = activityLog;
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.accessToken = opts.accessToken;
    this.apiUrl = opts.apiUrl || 'https://api.getjobber.com/api';
    this.cacheTtlMs = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  }

  /**
   * Check whether the Jobber API is currently reachable.
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
  }

  /**
   * Fetch the product catalog from Jobber, returning cached data when within TTL.
   * On API failure, logs the error, sets available = false, and returns an empty array.
   */
  async fetchProductCatalog(): Promise<ProductCatalogEntry[]> {
    if (this.productCatalogCache && !this.isCacheExpired(this.productCatalogCache)) {
      return this.productCatalogCache.data;
    }

    try {
      const data = await this.apiRequest<JobberProductResponse[]>('/products');
      const catalog: ProductCatalogEntry[] = data.map((p) => ({
        id: p.id,
        name: p.name,
        unitPrice: p.unit_price,
        description: p.description ?? '',
        category: p.category ?? undefined,
        source: 'jobber' as const,
      }));

      this.productCatalogCache = { data: catalog, fetchedAt: Date.now() };
      this.available = true;
      return catalog;
    } catch (err) {
      await this.handleApiError('fetchProductCatalog', err);
      return [];
    }
  }

  /**
   * Fetch the template library from Jobber, returning cached data when within TTL.
   * On API failure, logs the error, sets available = false, and returns an empty array.
   */
  async fetchTemplateLibrary(): Promise<QuoteTemplate[]> {
    if (this.templateLibraryCache && !this.isCacheExpired(this.templateLibraryCache)) {
      return this.templateLibraryCache.data;
    }

    try {
      const data = await this.apiRequest<JobberTemplateResponse[]>('/templates');
      const templates: QuoteTemplate[] = data.map((t) => ({
        id: t.id,
        name: t.name,
        content: t.content,
        category: t.category ?? undefined,
        source: 'jobber' as const,
      }));

      this.templateLibraryCache = { data: templates, fetchedAt: Date.now() };
      this.available = true;
      return templates;
    } catch (err) {
      await this.handleApiError('fetchTemplateLibrary', err);
      return [];
    }
  }

  private isCacheExpired<T>(entry: CacheEntry<T>): boolean {
    return Date.now() - entry.fetchedAt >= this.cacheTtlMs;
  }

  private async apiRequest<T>(path: string): Promise<T> {
    if (!this.accessToken) {
      throw new Error('JOBBER_ACCESS_TOKEN is not configured');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.apiUrl}${path}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          'X-Jobber-Client-Id': this.clientId,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Jobber API error (${response.status}): ${await response.text()}`);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async handleApiError(operation: string, err: unknown): Promise<void> {
    this.available = false;

    const description =
      err instanceof Error && err.name === 'AbortError'
        ? `Jobber API request timed out during ${operation}`
        : `Jobber API error during ${operation}: ${err instanceof Error ? err.message : 'Unknown error'}`;

    await this.activityLog.log({
      userId: 'system',
      component: 'JobberIntegration',
      operation,
      severity: 'error',
      description,
      recommendedAction: 'Check Jobber API credentials and connectivity. Using manual fallback mode.',
    });
  }
}

/** Raw product shape from Jobber API */
interface JobberProductResponse {
  id: string;
  name: string;
  unit_price: number;
  description?: string;
  category?: string;
}

/** Raw template shape from Jobber API */
interface JobberTemplateResponse {
  id: string;
  name: string;
  content: string;
  category?: string;
}
