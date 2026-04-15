import { query, getClient } from '../config/database.js';
import { PlatformError } from '../errors/index.js';
import type { Rule, RuleGroup, RuleGroupWithRules } from 'shared';

export class RulesService {
  // ── Grouped queries ───────────────────────────────────────────

  /**
   * Fetch all groups with nested rules, ordered by display_order / priority_order.
   */
  async getAllGroupedRules(): Promise<RuleGroupWithRules[]> {
    return this.fetchGroupedRules(false);
  }

  /**
   * Fetch only active rules, grouped and ordered — used for prompt injection.
   */
  async getActiveRulesGrouped(): Promise<RuleGroupWithRules[]> {
    return this.fetchGroupedRules(true);
  }

  // ── Rule CRUD ─────────────────────────────────────────────────

  /**
   * Create a new rule, assigning to "General" group if no groupId provided.
   */
  async createRule(data: {
    name: string;
    description: string;
    ruleGroupId?: string;
    isActive?: boolean;
  }): Promise<Rule> {
    const missing: string[] = [];
    if (!data.name || data.name.trim() === '') missing.push('name');
    if (!data.description || data.description.trim() === '') missing.push('description');

    if (missing.length > 0) {
      throw new PlatformError({
        severity: 'error',
        component: 'RulesService',
        operation: 'createRule',
        description: `Rule creation requires a name and description. Missing: ${missing.join(', ')}.`,
        recommendedActions: ['Provide the missing fields'],
      });
    }

    const groupId = data.ruleGroupId ?? (await this.getDefaultGroupId());

    try {
      // Assign priority_order to one past the current max in the group
      const orderResult = await query(
        'SELECT COALESCE(MAX(priority_order), -1) + 1 AS next_order FROM rules WHERE rule_group_id = $1',
        [groupId],
      );
      const nextOrder = Number(orderResult.rows[0].next_order);

      const result = await query(
        `INSERT INTO rules (name, description, rule_group_id, priority_order, is_active)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, description, rule_group_id, priority_order, is_active, created_at, updated_at`,
        [data.name.trim(), data.description.trim(), groupId, nextOrder, data.isActive ?? true],
      );

      return this.mapRuleRow(result.rows[0]);
    } catch (err: unknown) {
      if (this.isUniqueViolation(err)) {
        throw new PlatformError({
          severity: 'error',
          component: 'RulesService',
          operation: 'createRule',
          description: `A rule named '${data.name.trim()}' already exists in this group.`,
          recommendedActions: ['Choose a different name', 'Move the rule to another group'],
        });
      }
      throw err;
    }
  }

  /**
   * Update an existing rule's fields.
   */
  async updateRule(ruleId: string, data: {
    name?: string;
    description?: string;
    ruleGroupId?: string;
    isActive?: boolean;
  }): Promise<Rule> {
    // Reject whitespace-only name or description
    if (data.name !== undefined && data.name.trim() === '') {
      throw new PlatformError({
        severity: 'error',
        component: 'RulesService',
        operation: 'updateRule',
        description: 'Rule name cannot be empty.',
        recommendedActions: ['Provide a non-empty name'],
      });
    }
    if (data.description !== undefined && data.description.trim() === '') {
      throw new PlatformError({
        severity: 'error',
        component: 'RulesService',
        operation: 'updateRule',
        description: 'Rule description cannot be empty.',
        recommendedActions: ['Provide a non-empty description'],
      });
    }

    const setClauses: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      setClauses.push(`name = $${paramIndex++}`);
      values.push(data.name.trim());
    }
    if (data.description !== undefined) {
      setClauses.push(`description = $${paramIndex++}`);
      values.push(data.description.trim());
    }
    if (data.ruleGroupId !== undefined) {
      setClauses.push(`rule_group_id = $${paramIndex++}`);
      values.push(data.ruleGroupId);
    }
    if (data.isActive !== undefined) {
      setClauses.push(`is_active = $${paramIndex++}`);
      values.push(data.isActive);
    }

    values.push(ruleId);

    try {
      const result = await query(
        `UPDATE rules SET ${setClauses.join(', ')} WHERE id = $${paramIndex}
         RETURNING id, name, description, rule_group_id, priority_order, is_active, created_at, updated_at`,
        values,
      );

      if (result.rows.length === 0) {
        throw new PlatformError({
          severity: 'error',
          component: 'RulesService',
          operation: 'updateRule',
          description: 'The rule was not found.',
          recommendedActions: ['Verify the rule ID is correct'],
        });
      }

      return this.mapRuleRow(result.rows[0]);
    } catch (err: unknown) {
      if (this.isUniqueViolation(err)) {
        const name = data.name ?? 'this rule';
        throw new PlatformError({
          severity: 'error',
          component: 'RulesService',
          operation: 'updateRule',
          description: `A rule named '${name}' already exists in this group.`,
          recommendedActions: ['Choose a different name', 'Move the rule to another group'],
        });
      }
      throw err;
    }
  }

  /**
   * Set a rule to inactive (soft delete).
   */
  async deactivateRule(ruleId: string): Promise<Rule> {
    const result = await query(
      `UPDATE rules SET is_active = false, updated_at = NOW() WHERE id = $1
       RETURNING id, name, description, rule_group_id, priority_order, is_active, created_at, updated_at`,
      [ruleId],
    );

    if (result.rows.length === 0) {
      throw new PlatformError({
        severity: 'error',
        component: 'RulesService',
        operation: 'deactivateRule',
        description: 'The rule was not found.',
        recommendedActions: ['Verify the rule ID is correct'],
      });
    }

    return this.mapRuleRow(result.rows[0]);
  }

  /**
   * Reorder rules within a group to match the provided order.
   */
  async reorderRules(ruleGroupId: string, ruleIds: string[]): Promise<void> {
    // Verify all provided IDs belong to this group
    const existing = await query(
      'SELECT id FROM rules WHERE rule_group_id = $1 ORDER BY priority_order ASC',
      [ruleGroupId],
    );

    const existingIds = new Set(existing.rows.map((r: Record<string, unknown>) => r.id as string));
    const providedIds = new Set(ruleIds);

    if (existingIds.size !== providedIds.size || ![...existingIds].every((id) => providedIds.has(id))) {
      throw new PlatformError({
        severity: 'error',
        component: 'RulesService',
        operation: 'reorderRules',
        description: 'The provided rule IDs do not match the rules in this group.',
        recommendedActions: ['Refresh the page and try again'],
      });
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < ruleIds.length; i++) {
        await client.query(
          'UPDATE rules SET priority_order = $1, updated_at = NOW() WHERE id = $2',
          [i, ruleIds[i]],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ── Group CRUD ────────────────────────────────────────────────

  /**
   * Create a new rule group.
   */
  async createGroup(data: { name: string; description?: string }): Promise<RuleGroup> {
    if (!data.name || data.name.trim() === '') {
      throw new PlatformError({
        severity: 'error',
        component: 'RulesService',
        operation: 'createGroup',
        description: 'Group creation requires a name.',
        recommendedActions: ['Provide a group name'],
      });
    }

    // Check for duplicate group name (case-insensitive)
    const existing = await query(
      'SELECT id FROM rule_groups WHERE LOWER(name) = LOWER($1)',
      [data.name.trim()],
    );
    if (existing.rows.length > 0) {
      throw new PlatformError({
        severity: 'error',
        component: 'RulesService',
        operation: 'createGroup',
        description: `A group named '${data.name.trim()}' already exists.`,
        recommendedActions: ['Choose a different name'],
      });
    }

    // Place new group after existing ones
    const orderResult = await query(
      'SELECT COALESCE(MAX(display_order), -1) + 1 AS next_order FROM rule_groups',
    );
    const nextOrder = Number(orderResult.rows[0].next_order);

    try {
      const result = await query(
        `INSERT INTO rule_groups (name, description, display_order)
         VALUES ($1, $2, $3)
         RETURNING id, name, description, display_order, created_at`,
        [data.name.trim(), data.description?.trim() ?? null, nextOrder],
      );

      return this.mapGroupRow(result.rows[0]);
    } catch (err: unknown) {
      if (this.isUniqueViolation(err)) {
        throw new PlatformError({
          severity: 'error',
          component: 'RulesService',
          operation: 'createGroup',
          description: `A group named '${data.name.trim()}' already exists.`,
          recommendedActions: ['Choose a different name'],
        });
      }
      throw err;
    }
  }

  /**
   * Update an existing rule group.
   */
  async updateGroup(groupId: string, data: {
    name?: string;
    description?: string;
    displayOrder?: number;
  }): Promise<RuleGroup> {
    // Reject whitespace-only name
    if (data.name !== undefined && data.name.trim() === '') {
      throw new PlatformError({
        severity: 'error',
        component: 'RulesService',
        operation: 'updateGroup',
        description: 'Group name cannot be empty.',
        recommendedActions: ['Provide a non-empty name'],
      });
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      setClauses.push(`name = $${paramIndex++}`);
      values.push(data.name.trim());
    }
    if (data.description !== undefined) {
      setClauses.push(`description = $${paramIndex++}`);
      values.push(data.description.trim());
    }
    if (data.displayOrder !== undefined) {
      setClauses.push(`display_order = $${paramIndex++}`);
      values.push(data.displayOrder);
    }

    if (setClauses.length === 0) {
      // Nothing to update — just return the current group
      const current = await query(
        'SELECT id, name, description, display_order, created_at FROM rule_groups WHERE id = $1',
        [groupId],
      );
      if (current.rows.length === 0) {
        throw new PlatformError({
          severity: 'error',
          component: 'RulesService',
          operation: 'updateGroup',
          description: 'The rule group was not found.',
          recommendedActions: ['Verify the group ID is correct'],
        });
      }
      return this.mapGroupRow(current.rows[0]);
    }

    values.push(groupId);

    const result = await query(
      `UPDATE rule_groups SET ${setClauses.join(', ')} WHERE id = $${paramIndex}
       RETURNING id, name, description, display_order, created_at`,
      values,
    );

    if (result.rows.length === 0) {
      throw new PlatformError({
        severity: 'error',
        component: 'RulesService',
        operation: 'updateGroup',
        description: 'The rule group was not found.',
        recommendedActions: ['Verify the group ID is correct'],
      });
    }

    return this.mapGroupRow(result.rows[0]);
  }

  /**
   * Delete a group, reassigning its rules to the "General" group first.
   * The default "General" group cannot be deleted.
   */
  async deleteGroup(groupId: string): Promise<void> {
    // Check if this is the default group
    const group = await query(
      'SELECT id, name FROM rule_groups WHERE id = $1',
      [groupId],
    );

    if (group.rows.length === 0) {
      throw new PlatformError({
        severity: 'error',
        component: 'RulesService',
        operation: 'deleteGroup',
        description: 'The rule group was not found.',
        recommendedActions: ['Verify the group ID is correct'],
      });
    }

    if ((group.rows[0].name as string) === 'General') {
      throw new PlatformError({
        severity: 'error',
        component: 'RulesService',
        operation: 'deleteGroup',
        description: "The default 'General' group cannot be deleted.",
        recommendedActions: ['Delete or reassign rules individually instead'],
      });
    }

    const defaultGroupId = await this.getDefaultGroupId();

    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Reassign all rules in this group to the default group
      await client.query(
        'UPDATE rules SET rule_group_id = $1, updated_at = NOW() WHERE rule_group_id = $2',
        [defaultGroupId, groupId],
      );

      // Delete the group
      await client.query('DELETE FROM rule_groups WHERE id = $1', [groupId]);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Get the default "General" group ID.
   */
  async getDefaultGroupId(): Promise<string> {
    const result = await query(
      "SELECT id FROM rule_groups WHERE name = 'General' ORDER BY created_at ASC LIMIT 1",
    );

    if (result.rows.length === 0) {
      throw new PlatformError({
        severity: 'error',
        component: 'RulesService',
        operation: 'getDefaultGroupId',
        description: 'The default "General" rule group was not found. The database may not be properly migrated.',
        recommendedActions: ['Run database migrations'],
      });
    }

    return result.rows[0].id as string;
  }

  // ── Feedback & line-item-rules ────────────────────────────────

  /**
   * Create a rule from revision feedback text.
   * Uses the feedback as the description and derives a short name from it.
   */
  async createRuleFromFeedback(feedbackText: string, _quoteContext?: string): Promise<Rule> {
    const name = this.deriveRuleName(feedbackText);
    const groupId = await this.getDefaultGroupId();

    return this.createRule({
      name,
      description: feedbackText,
      ruleGroupId: groupId,
      isActive: true,
    });
  }

  /**
   * Persist rule-to-line-item associations for a draft.
   * Clears existing associations for the draft first, then inserts new ones.
   */
  async saveLineItemRules(
    quoteDraftId: string,
    lineItemRules: Array<{ lineItemId: string; ruleIds: string[] }>,
  ): Promise<void> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Clear existing associations for this draft
      await client.query(
        'DELETE FROM line_item_rules WHERE quote_draft_id = $1',
        [quoteDraftId],
      );

      // Insert new associations
      for (const { lineItemId, ruleIds } of lineItemRules) {
        for (const ruleId of ruleIds) {
          await client.query(
            `INSERT INTO line_item_rules (line_item_id, rule_id, quote_draft_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (line_item_id, rule_id) DO NOTHING`,
            [lineItemId, ruleId, quoteDraftId],
          );
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Fetch all rule associations for a draft, returned as a Map of lineItemId → Rule[].
   */
  async getLineItemRules(quoteDraftId: string): Promise<Map<string, Rule[]>> {
    const result = await query(
      `SELECT lir.line_item_id, r.id, r.name, r.description, r.rule_group_id,
              r.priority_order, r.is_active, r.created_at, r.updated_at
       FROM line_item_rules lir
       JOIN rules r ON r.id = lir.rule_id
       WHERE lir.quote_draft_id = $1
       ORDER BY r.priority_order ASC`,
      [quoteDraftId],
    );

    const map = new Map<string, Rule[]>();
    for (const row of result.rows) {
      const lineItemId = row.line_item_id as string;
      const rule = this.mapRuleRow(row);
      const existing = map.get(lineItemId) ?? [];
      existing.push(rule);
      map.set(lineItemId, existing);
    }

    return map;
  }

  // ── Private helpers ───────────────────────────────────────────

  /**
   * Fetch groups with nested rules. When activeOnly is true, only active rules are included.
   */
  private async fetchGroupedRules(activeOnly: boolean): Promise<RuleGroupWithRules[]> {
    const groups = await query(
      'SELECT id, name, description, display_order, created_at FROM rule_groups ORDER BY display_order ASC',
    );

    const rulesQuery = activeOnly
      ? 'SELECT id, name, description, rule_group_id, priority_order, is_active, created_at, updated_at FROM rules WHERE is_active = true ORDER BY priority_order ASC'
      : 'SELECT id, name, description, rule_group_id, priority_order, is_active, created_at, updated_at FROM rules ORDER BY priority_order ASC';

    const rules = await query(rulesQuery);

    // Group rules by rule_group_id
    const rulesByGroup = new Map<string, Rule[]>();
    for (const row of rules.rows) {
      const groupId = row.rule_group_id as string;
      const rule = this.mapRuleRow(row);
      const existing = rulesByGroup.get(groupId) ?? [];
      existing.push(rule);
      rulesByGroup.set(groupId, existing);
    }

    return groups.rows.map((row: Record<string, unknown>) => ({
      ...this.mapGroupRow(row),
      rules: rulesByGroup.get(row.id as string) ?? [],
    }));
  }

  /**
   * Map a database row to a Rule object.
   */
  private mapRuleRow(row: Record<string, unknown>): Rule {
    return {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string,
      ruleGroupId: row.rule_group_id as string,
      priorityOrder: Number(row.priority_order),
      isActive: row.is_active as boolean,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  /**
   * Map a database row to a RuleGroup object.
   */
  private mapGroupRow(row: Record<string, unknown>): RuleGroup {
    return {
      id: row.id as string,
      name: row.name as string,
      description: (row.description as string) ?? null,
      displayOrder: Number(row.display_order),
      createdAt: new Date(row.created_at as string),
    };
  }

  /**
   * Derive a short rule name from feedback text.
   * Truncates to the first sentence or 60 characters, whichever is shorter.
   */
  private deriveRuleName(feedbackText: string): string {
    const trimmed = feedbackText.trim();

    // Try to use the first sentence
    const sentenceEnd = trimmed.search(/[.!?]\s/);
    if (sentenceEnd > 0 && sentenceEnd <= 60) {
      return trimmed.slice(0, sentenceEnd + 1);
    }

    // Truncate at 60 chars on a word boundary
    if (trimmed.length <= 60) {
      return trimmed;
    }

    const truncated = trimmed.slice(0, 60);
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > 20) {
      return truncated.slice(0, lastSpace) + '…';
    }

    return truncated + '…';
  }

  /**
   * Check if a database error is a unique constraint violation.
   */
  private isUniqueViolation(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === '23505'
    );
  }
}
