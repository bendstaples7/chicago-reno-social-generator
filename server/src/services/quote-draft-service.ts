import { query, getClient } from '../config/database.js';
import { PlatformError } from '../errors/index.js';
import type { QuoteDraft, QuoteDraftUpdate, QuoteLineItem } from 'shared';

export class QuoteDraftService {
  /**
   * Save a new quote draft with its line items and media associations.
   */
  async save(draft: QuoteDraft): Promise<QuoteDraft> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `INSERT INTO quote_drafts (id, user_id, customer_request_text, selected_template_id, selected_template_name, catalog_source, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, user_id, customer_request_text, selected_template_id, selected_template_name, catalog_source, status, created_at, updated_at`,
        [
          draft.id,
          draft.userId,
          draft.customerRequestText,
          draft.selectedTemplateId,
          draft.selectedTemplateName,
          draft.catalogSource,
          draft.status,
        ],
      );

      const allItems = [
        ...draft.lineItems.map((item, i) => ({ ...item, resolved: true, displayOrder: i })),
        ...draft.unresolvedItems.map((item, i) => ({ ...item, resolved: false, displayOrder: i })),
      ];

      for (const item of allItems) {
        await client.query(
          `INSERT INTO quote_line_items (id, quote_draft_id, product_catalog_entry_id, product_name, quantity, unit_price, confidence_score, original_text, resolved, unmatched_reason, display_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            item.id,
            draft.id,
            item.productCatalogEntryId,
            item.productName,
            item.quantity,
            item.unitPrice,
            item.confidenceScore,
            item.originalText,
            item.resolved,
            item.unmatchedReason ?? null,
            item.displayOrder,
          ],
        );
      }

      await client.query('COMMIT');
      return this.mapDraftRow(result.rows[0], draft.lineItems, draft.unresolvedItems);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Get a single quote draft by ID, scoped to the user.
   */
  async getById(draftId: string, userId: string): Promise<QuoteDraft> {
    const result = await query(
      `SELECT id, user_id, customer_request_text, selected_template_id, selected_template_name, catalog_source, status, created_at, updated_at
       FROM quote_drafts
       WHERE id = $1 AND user_id = $2`,
      [draftId, userId],
    );

    if (result.rows.length === 0) {
      throw new PlatformError({
        severity: 'error',
        component: 'QuoteDraftService',
        operation: 'getById',
        description: 'The quote draft was not found or you do not have permission to view it.',
        recommendedActions: ['Verify the draft exists in your quotes list'],
      });
    }

    const { lineItems, unresolvedItems } = await this.fetchLineItems(draftId);
    return this.mapDraftRow(result.rows[0], lineItems, unresolvedItems);
  }

  /**
   * List all quote drafts for a user, sorted by creation date descending (newest first).
   */
  async list(userId: string): Promise<QuoteDraft[]> {
    const result = await query(
      `SELECT id, user_id, customer_request_text, selected_template_id, selected_template_name, catalog_source, status, created_at, updated_at
       FROM quote_drafts
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId],
    );

    const drafts: QuoteDraft[] = [];
    for (const row of result.rows) {
      const { lineItems, unresolvedItems } = await this.fetchLineItems(row.id as string);
      drafts.push(this.mapDraftRow(row, lineItems, unresolvedItems));
    }
    return drafts;
  }

  /**
   * Update a quote draft. Supports updating line items, unresolved items,
   * selected template, and status.
   */
  async update(draftId: string, userId: string, updates: QuoteDraftUpdate): Promise<QuoteDraft> {
    // Verify the draft exists and belongs to the user
    await this.getById(draftId, userId);

    const client = await getClient();
    try {
      await client.query('BEGIN');

      const setClauses: string[] = ['updated_at = NOW()'];
      const values: unknown[] = [];
      let paramIndex = 1;

      if (updates.selectedTemplateId !== undefined) {
        setClauses.push('selected_template_id = $' + paramIndex++);
        values.push(updates.selectedTemplateId);
      }
      if (updates.status !== undefined) {
        setClauses.push('status = $' + paramIndex++);
        values.push(updates.status);
      }

      values.push(draftId, userId);
      const updateSql =
        'UPDATE quote_drafts SET ' +
        setClauses.join(', ') +
        ' WHERE id = $' + paramIndex++ +
        ' AND user_id = $' + paramIndex +
        ' RETURNING id, user_id, customer_request_text, selected_template_id, selected_template_name, catalog_source, status, created_at, updated_at';

      const result = await client.query(updateSql, values);

      // Replace line items if provided
      if (updates.lineItems !== undefined || updates.unresolvedItems !== undefined) {
        await client.query('DELETE FROM quote_line_items WHERE quote_draft_id = $1', [draftId]);

        const resolvedItems = (updates.lineItems ?? []) as QuoteLineItem[];
        const unresolvedItemsList = (updates.unresolvedItems ?? []) as QuoteLineItem[];

        const allItems = [
          ...resolvedItems.map((item, i) => ({ ...item, resolved: true, displayOrder: i })),
          ...unresolvedItemsList.map((item, i) => ({ ...item, resolved: false, displayOrder: i })),
        ];

        for (const item of allItems) {
          await client.query(
            `INSERT INTO quote_line_items (id, quote_draft_id, product_catalog_entry_id, product_name, quantity, unit_price, confidence_score, original_text, resolved, unmatched_reason, display_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              item.id,
              draftId,
              item.productCatalogEntryId ?? null,
              item.productName,
              item.quantity,
              item.unitPrice,
              item.confidenceScore,
              item.originalText,
              item.resolved,
              item.unmatchedReason ?? null,
              item.displayOrder,
            ],
          );
        }
      }

      await client.query('COMMIT');

      const { lineItems, unresolvedItems: unresolved } = await this.fetchLineItems(draftId);
      return this.mapDraftRow(result.rows[0], lineItems, unresolved);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Delete a quote draft and its associated line items and media (via CASCADE).
   */
  async delete(draftId: string, userId: string): Promise<boolean> {
    const result = await query(
      'DELETE FROM quote_drafts WHERE id = $1 AND user_id = $2',
      [draftId, userId],
    );

    if (result.rowCount === 0) {
      throw new PlatformError({
        severity: 'error',
        component: 'QuoteDraftService',
        operation: 'delete',
        description: 'The quote draft was not found or you do not have permission to delete it.',
        recommendedActions: ['Verify the draft exists in your quotes list'],
      });
    }

    return true;
  }

  // ── Private helpers ──────────────────────────────────────────

  /**
   * Fetch line items for a draft, split into resolved (lineItems) and unresolved.
   */
  private async fetchLineItems(draftId: string): Promise<{ lineItems: QuoteLineItem[]; unresolvedItems: QuoteLineItem[] }> {
    const result = await query(
      `SELECT id, product_catalog_entry_id, product_name, quantity, unit_price, confidence_score, original_text, resolved, unmatched_reason, display_order
       FROM quote_line_items
       WHERE quote_draft_id = $1
       ORDER BY display_order ASC`,
      [draftId],
    );

    const lineItems: QuoteLineItem[] = [];
    const unresolvedItems: QuoteLineItem[] = [];

    for (const row of result.rows) {
      const item = this.mapLineItemRow(row);
      if (item.resolved) {
        lineItems.push(item);
      } else {
        unresolvedItems.push(item);
      }
    }

    return { lineItems, unresolvedItems };
  }

  private mapLineItemRow(row: Record<string, unknown>): QuoteLineItem {
    return {
      id: row.id as string,
      productCatalogEntryId: (row.product_catalog_entry_id as string) ?? null,
      productName: row.product_name as string,
      quantity: Number(row.quantity),
      unitPrice: Number(row.unit_price),
      confidenceScore: row.confidence_score as number,
      originalText: row.original_text as string,
      resolved: row.resolved as boolean,
      unmatchedReason: (row.unmatched_reason as string) ?? undefined,
    };
  }

  private mapDraftRow(
    row: Record<string, unknown>,
    lineItems: QuoteLineItem[],
    unresolvedItems: QuoteLineItem[],
  ): QuoteDraft {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      customerRequestText: row.customer_request_text as string,
      selectedTemplateId: (row.selected_template_id as string) ?? null,
      selectedTemplateName: (row.selected_template_name as string) ?? null,
      lineItems,
      unresolvedItems,
      catalogSource: row.catalog_source as QuoteDraft['catalogSource'],
      status: row.status as QuoteDraft['status'],
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}
