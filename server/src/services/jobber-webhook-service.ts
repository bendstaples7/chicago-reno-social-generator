import crypto from 'node:crypto';
import { query as dbQuery } from '../config/database.js';
import { ActivityLogService } from './activity-log-service.js';
import { JobberTokenStore } from './jobber-token-store.js';
import type { JobberCustomerRequest } from 'shared';

const JOBBER_GRAPHQL_URL = 'https://api.getjobber.com/api/graphql';

/** Webhook payload shape from Jobber */
export interface JobberWebhookPayload {
  data: {
    webHookEvent: {
      topic: string;
      appId: string;
      accountId: string;
      itemId: string;
      occurredAt: string;
    };
  };
}

/** Full request detail fetched after webhook notification */
interface RequestDetail {
  id: string;
  title: string | null;
  companyName: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  requestStatus: string;
  createdAt: string;
  jobberWebUri: string;
  client?: { id: string; firstName: string | null; lastName: string | null; companyName: string | null };
  notes: {
    edges: Array<{
      node: {
        message?: string;
        createdAt?: string;
        createdBy?: { __typename: string };
      };
    }>;
  };
  noteAttachments: {
    edges: Array<{
      node: { url: string; fileName: string; contentType: string };
    }>;
  };
}

const REQUEST_DETAIL_QUERY = `
  query FetchRequestDetail($id: EncodedId!) {
    request(id: $id) {
      id
      title
      companyName
      contactName
      phone
      email
      requestStatus
      createdAt
      jobberWebUri
      client { id firstName lastName companyName }
      notes(first: 20) {
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
      noteAttachments(first: 20) {
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
`;

export class JobberWebhookService {
  private activityLog: ActivityLogService;
  private tokenStore: JobberTokenStore;

  constructor(activityLog: ActivityLogService) {
    this.activityLog = activityLog;
    this.tokenStore = new JobberTokenStore();
  }

  /**
   * Verify the HMAC signature on an incoming Jobber webhook.
   */
  verifySignature(rawBody: string, signature: string): boolean {
    const secret = process.env.JOBBER_CLIENT_SECRET;
    if (!secret) return false;

    const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
    try {
      return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
    } catch {
      return false;
    }
  }

  /**
   * Process an incoming webhook event. Fetches full request details from
   * the Jobber GraphQL API and stores them in the database.
   */
  async processWebhook(payload: JobberWebhookPayload): Promise<void> {
    const { topic, itemId, accountId } = payload.data.webHookEvent;

    // Only handle request-related topics
    if (!topic.startsWith('REQUEST_')) {
      return;
    }

    try {
      // Fetch full request details from Jobber GraphQL API
      const detail = await this.fetchRequestDetail(itemId);

      if (!detail) {
        await this.logEvent('warning', 'processWebhook',
          `Could not fetch request detail for ${itemId} (topic: ${topic})`);
        // Still store the raw webhook even without detail
        await this.storeWebhookData(itemId, topic, accountId, null, payload);
        return;
      }

      // Build structured data
      const imageUrls = (detail.noteAttachments?.edges ?? [])
        .filter((e) => e.node.contentType.startsWith('image/'))
        .map((e) => e.node.url);

      const description = detail.notes.edges
        .map((e) => e.node?.message)
        .filter((m): m is string => !!m)
        .join('\n\n');

      const clientDetail = detail.client;
      const clientName = detail.companyName
        || detail.contactName
        || (clientDetail ? `${clientDetail.firstName || ''} ${clientDetail.lastName || ''}`.trim() || clientDetail.companyName : null)
        || null;

      await this.storeWebhookData(itemId, topic, accountId, {
        title: detail.title,
        clientName,
        description,
        imageUrls,
        detail,
      }, payload);

      await this.logEvent('info', 'processWebhook',
        `Processed ${topic} for request ${itemId}: "${detail.title || 'Untitled'}"`);
    } catch (err) {
      await this.logEvent('error', 'processWebhook',
        `Failed to process webhook ${topic} for ${itemId}: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }

  /**
   * Fetch full request details from the Jobber GraphQL API.
   */
  private async fetchRequestDetail(requestId: string): Promise<RequestDetail | null> {
    let accessToken = process.env.JOBBER_ACCESS_TOKEN;

    // Prefer the DB-persisted token (survives refreshes across restarts)
    try {
      const stored = await this.tokenStore.load();
      if (stored) {
        accessToken = stored.accessToken;
      }
    } catch {
      // Fall back to process.env
    }

    if (!accessToken) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const res = await fetch(JOBBER_GRAPHQL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'X-JOBBER-GRAPHQL-VERSION': '2025-04-16',
        },
        body: JSON.stringify({
          query: REQUEST_DETAIL_QUERY,
          variables: { id: requestId },
        }),
        signal: controller.signal,
      });

      if (!res.ok) return null;

      const json = await res.json() as { data?: { request?: RequestDetail }; errors?: unknown[] };
      return json.data?.request ?? null;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Store webhook data in the database.
   */
  private async storeWebhookData(
    jobberRequestId: string,
    topic: string,
    accountId: string,
    detail: {
      title: string | null;
      clientName: string | null;
      description: string;
      imageUrls: string[];
      detail: RequestDetail;
    } | null,
    rawPayload: JobberWebhookPayload,
  ): Promise<void> {
    await dbQuery(
      `INSERT INTO jobber_webhook_requests
        (jobber_request_id, topic, account_id, title, client_name, description, request_body, image_urls, raw_payload, processed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (jobber_request_id, topic) DO UPDATE SET
         title = COALESCE(EXCLUDED.title, jobber_webhook_requests.title),
         client_name = COALESCE(EXCLUDED.client_name, jobber_webhook_requests.client_name),
         description = COALESCE(EXCLUDED.description, jobber_webhook_requests.description),
         request_body = COALESCE(EXCLUDED.request_body, jobber_webhook_requests.request_body),
         image_urls = COALESCE(EXCLUDED.image_urls, jobber_webhook_requests.image_urls),
         raw_payload = EXCLUDED.raw_payload,
         processed_at = COALESCE(EXCLUDED.processed_at, jobber_webhook_requests.processed_at)`,
      [
        jobberRequestId,
        topic,
        accountId,
        detail?.title ?? null,
        detail?.clientName ?? null,
        detail?.description ?? null,
        detail ? JSON.stringify(detail.detail) : null,
        detail ? JSON.stringify(detail.imageUrls) : '[]',
        JSON.stringify(rawPayload),
        detail ? new Date() : null,
      ],
    );
  }

  /**
   * Get all requests that have been received via webhook, enriched with
   * full detail data. Returns them as JobberCustomerRequest objects.
   */
  async getWebhookRequests(): Promise<JobberCustomerRequest[]> {
    // Include all webhook requests, preferring rows with full detail (processed_at IS NOT NULL)
    // but falling back to unprocessed rows so new requests aren't lost.
    const result = await dbQuery(
      `SELECT DISTINCT ON (jobber_request_id)
        jobber_request_id, title, client_name, description, image_urls, request_body, received_at
       FROM jobber_webhook_requests
       ORDER BY jobber_request_id, processed_at DESC NULLS LAST, received_at DESC`,
    );

    // Backfill on read: for rows missing request_body, try fetching detail now.
    // Limit to 5 per request to avoid slow responses when many rows are incomplete.
    const rows = result.rows as Array<Record<string, unknown>>;
    const incompleteIds = rows
      .filter((r) => !r.request_body)
      .map((r) => r.jobber_request_id as string)
      .slice(0, 5);

    if (incompleteIds.length > 0) {
      for (const id of incompleteIds) {
        try {
          const detail = await this.fetchRequestDetail(id);
          if (!detail) continue;

          const imageUrls = (detail.noteAttachments?.edges ?? [])
            .filter((e) => e.node.contentType.startsWith('image/'))
            .map((e) => e.node.url);
          const description = detail.notes.edges
            .map((e) => e.node?.message)
            .filter((m): m is string => !!m)
            .join('\n\n');
          const clientDetail = detail.client;
          const clientName = detail.companyName
            || detail.contactName
            || (clientDetail ? `${clientDetail.firstName || ''} ${clientDetail.lastName || ''}`.trim() || clientDetail.companyName : null)
            || null;

          await dbQuery(
            `UPDATE jobber_webhook_requests
             SET title = $1, client_name = $2, description = $3, request_body = $4, image_urls = $5, processed_at = NOW()
             WHERE jobber_request_id = $6 AND request_body IS NULL`,
            [detail.title ?? null, clientName, description || null, JSON.stringify(detail), JSON.stringify(imageUrls), id],
          );

          // Update the in-memory row so we don't need to re-query
          const row = rows.find((r) => r.jobber_request_id === id);
          if (row) {
            row.title = detail.title;
            row.client_name = clientName;
            row.description = description;
            row.request_body = JSON.stringify(detail);
            row.image_urls = imageUrls;
          }
        } catch {
          // Best-effort — skip this one
        }
      }
    }

    return rows.map((row: Record<string, unknown>): JobberCustomerRequest | null => {
      let structuredNotes: { message: string; createdBy: 'team' | 'client' | 'system'; createdAt: string }[] = [];
      let imageUrls: string[] = [];

      try {
        imageUrls = (row.image_urls as string[]) ?? [];
      } catch { imageUrls = []; }

      // Parse the stored request body to extract notes and the original Jobber createdAt
      let jobberCreatedAt: string | null = null;
      let jobberWebUri = '';
      if (row.request_body) {
        try {
          const detail = JSON.parse(row.request_body as string) as RequestDetail;
          jobberCreatedAt = detail.createdAt ?? null;
          jobberWebUri = detail.jobberWebUri ?? '';
          structuredNotes = detail.notes.edges
            .filter((e) => e.node?.message)
            .map((e) => {
              const typeName = e.node.createdBy?.__typename ?? '';
              let createdBy: 'team' | 'client' | 'system' = 'system';
              if (typeName === 'User') createdBy = 'team';
              else if (typeName === 'Client') createdBy = 'client';
              return {
                message: e.node.message!,
                createdBy,
                createdAt: e.node.createdAt ?? new Date(row.received_at as string).toISOString(),
              };
            });
        } catch { /* ignore parse errors */ }
      }

      // If we don't have the real Jobber createdAt, skip this request entirely.
      // Using received_at (webhook receipt time) as a substitute caused old requests
      // to appear with recent dates and sort to the top of the list.
      if (!jobberCreatedAt) {
        return null;
      }

      return {
        id: row.jobber_request_id as string,
        title: (row.title as string) || 'Untitled Request',
        clientName: (row.client_name as string) || 'Unknown',
        description: (row.description as string) || '',
        notes: structuredNotes.map((n) => n.message),
        structuredNotes,
        imageUrls,
        jobberWebUri,
        createdAt: jobberCreatedAt,
      };
    }).filter((r): r is JobberCustomerRequest => r !== null);
  }

  private async logEvent(severity: 'info' | 'warning' | 'error', operation: string, description: string): Promise<void> {
    try {
      await this.activityLog.log({
        userId: 'system',
        component: 'JobberWebhookService',
        operation,
        severity,
        description,
      });
    } catch (logErr) {
      console.error('Webhook log error:', logErr);
    }
  }
}
