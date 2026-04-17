import { PlatformError } from '../errors/index.js';
import type { Rule, RuleGroup, RuleGroupWithRules } from 'shared';

export class RulesService {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

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
    const id = crypto.randomUUID();

    // Assign priority_order to one past the current max in the group
    const orderRow = await this.db.prepare(
      'SELECT COALESCE(MAX(priority_order), -1) + 1 AS next_order FROM rules WHERE rule_group_id = ?'
    ).bind(groupId).first() as { next_order: number } | null;
    const nextOrder = orderRow?.next_order ?? 0;

    try {
      await this.db.prepare(
        `INSERT INTO rules (id, name, description, rule_group_id, priority_order, is_active)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(id, data.name.trim(), data.description.trim(), groupId, nextOrder, (data.isActive ?? true) ? 1 : 0).run();

      const row = await this.db.prepare(
        'SELECT id, name, description, rule_group_id, priority_order, is_active, created_at, updated_at FROM rules WHERE id = ?'
      ).bind(id).first() as Record<string, unknown>;

      return this.mapRuleRow(row);
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

    const setClauses: string[] = ["updated_at = datetime('now')"];
    const values: unknown[] = [];

    if (data.name !== undefined) {
      setClauses.push('name = ?');
      values.push(data.name.trim());
    }
    if (data.description !== undefined) {
      setClauses.push('description = ?');
      values.push(data.description.trim());
    }
    if (data.ruleGroupId !== undefined) {
      setClauses.push('rule_group_id = ?');
      values.push(data.ruleGroupId);
    }
    if (data.isActive !== undefined) {
      setClauses.push('is_active = ?');
      values.push(data.isActive ? 1 : 0);
    }

    values.push(ruleId);

    try {
      await this.db.prepare(
        `UPDATE rules SET ${setClauses.join(', ')} WHERE id = ?`
      ).bind(...values).run();

      const row = await this.db.prepare(
        'SELECT id, name, description, rule_group_id, priority_order, is_active, created_at, updated_at FROM rules WHERE id = ?'
      ).bind(ruleId).first() as Record<string, unknown> | null;

      if (!row) {
        throw new PlatformError({
          severity: 'error',
          component: 'RulesService',
          operation: 'updateRule',
          description: 'The rule was not found.',
          recommendedActions: ['Verify the rule ID is correct'],
        });
      }

      return this.mapRuleRow(row);
    } catch (err: unknown) {
      if (err instanceof PlatformError) throw err;
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
    await this.db.prepare(
      "UPDATE rules SET is_active = 0, updated_at = datetime('now') WHERE id = ?"
    ).bind(ruleId).run();

    const row = await this.db.prepare(
      'SELECT id, name, description, rule_group_id, priority_order, is_active, created_at, updated_at FROM rules WHERE id = ?'
    ).bind(ruleId).first() as Record<string, unknown> | null;

    if (!row) {
      throw new PlatformError({
        severity: 'error',
        component: 'RulesService',
        operation: 'deactivateRule',
        description: 'The rule was not found.',
        recommendedActions: ['Verify the rule ID is correct'],
      });
    }

    return this.mapRuleRow(row);
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
    const existing = await this.db.prepare(
      'SELECT id FROM rule_groups WHERE name = ? COLLATE NOCASE'
    ).bind(data.name.trim()).first();

    if (existing) {
      throw new PlatformError({
        severity: 'error',
        component: 'RulesService',
        operation: 'createGroup',
        description: `A group named '${data.name.trim()}' already exists.`,
        recommendedActions: ['Choose a different name'],
      });
    }

    const id = crypto.randomUUID();

    // Place new group after existing ones
    const orderRow = await this.db.prepare(
      'SELECT COALESCE(MAX(display_order), -1) + 1 AS next_order FROM rule_groups'
    ).first() as { next_order: number } | null;
    const nextOrder = orderRow?.next_order ?? 0;

    try {
      await this.db.prepare(
        `INSERT INTO rule_groups (id, name, description, display_order)
         VALUES (?, ?, ?, ?)`
      ).bind(id, data.name.trim(), data.description?.trim() ?? null, nextOrder).run();

      const row = await this.db.prepare(
        'SELECT id, name, description, display_order, created_at FROM rule_groups WHERE id = ?'
      ).bind(id).first() as Record<string, unknown>;

      return this.mapGroupRow(row);
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

    if (data.name !== undefined) {
      setClauses.push('name = ?');
      values.push(data.name.trim());
    }
    if (data.description !== undefined) {
      setClauses.push('description = ?');
      values.push(data.description.trim());
    }
    if (data.displayOrder !== undefined) {
      setClauses.push('display_order = ?');
      values.push(data.displayOrder);
    }

    if (setClauses.length === 0) {
      const current = await this.db.prepare(
        'SELECT id, name, description, display_order, created_at FROM rule_groups WHERE id = ?'
      ).bind(groupId).first() as Record<string, unknown> | null;

      if (!current) {
        throw new PlatformError({
          severity: 'error',
          component: 'RulesService',
          operation: 'updateGroup',
          description: 'The rule group was not found.',
          recommendedActions: ['Verify the group ID is correct'],
        });
      }
      return this.mapGroupRow(current);
    }

    values.push(groupId);

    await this.db.prepare(
      `UPDATE rule_groups SET ${setClauses.join(', ')} WHERE id = ?`
    ).bind(...values).run();

    const row = await this.db.prepare(
      'SELECT id, name, description, display_order, created_at FROM rule_groups WHERE id = ?'
    ).bind(groupId).first() as Record<string, unknown> | null;

    if (!row) {
      throw new PlatformError({
        severity: 'error',
        component: 'RulesService',
        operation: 'updateGroup',
        description: 'The rule group was not found.',
        recommendedActions: ['Verify the group ID is correct'],
      });
    }

    return this.mapGroupRow(row);
  }

  /**
   * Delete a group, reassigning its rules to the "General" group first.
   * The default "General" group cannot be deleted.
   */
  async deleteGroup(groupId: string): Promise<void> {
    const group = await this.db.prepare(
      'SELECT id, name FROM rule_groups WHERE id = ?'
    ).bind(groupId).first() as { id: string; name: string } | null;

    if (!group) {
      throw new PlatformError({
        severity: 'error',
        component: 'RulesService',
        operation: 'deleteGroup',
        description: 'The rule group was not found.',
        recommendedActions: ['Verify the group ID is correct'],
      });
    }

    if (group.name === 'General') {
      throw new PlatformError({
        severity: 'error',
        component: 'RulesService',
        operation: 'deleteGroup',
        description: "The default 'General' group cannot be deleted.",
        recommendedActions: ['Delete or reassign rules individually instead'],
      });
    }

    const defaultGroupId = await this.getDefaultGroupId();

    // Use batch to reassign rules then delete the group atomically
    await this.db.batch([
      this.db.prepare(
        "UPDATE rules SET rule_group_id = ?, updated_at = datetime('now') WHERE rule_group_id = ?"
      ).bind(defaultGroupId, groupId),
      this.db.prepare('DELETE FROM rule_groups WHERE id = ?').bind(groupId),
    ]);
  }

  /**
   * Get the default "General" group ID.
   */
  async getDefaultGroupId(): Promise<string> {
    const row = await this.db.prepare(
      "SELECT id FROM rule_groups WHERE name = 'General' ORDER BY created_at ASC LIMIT 1"
    ).first() as { id: string } | null;

    if (!row) {
      throw new PlatformError({
        severity: 'error',
        component: 'RulesService',
        operation: 'getDefaultGroupId',
        description: 'The default "General" rule group was not found. The database may not be properly migrated.',
        recommendedActions: ['Run database migrations'],
      });
    }

    return row.id;
  }

  // ── Feedback & line-item-rules ────────────────────────────────

  /**
   * Create a rule from revision feedback text.
   */
  async createRuleFromFeedback(feedbackText: string): Promise<Rule> {
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
    const statements: D1PreparedStatement[] = [
      this.db.prepare('DELETE FROM line_item_rules WHERE quote_draft_id = ?').bind(quoteDraftId),
    ];

    for (const { lineItemId, ruleIds } of lineItemRules) {
      for (const ruleId of ruleIds) {
        statements.push(
          this.db.prepare(
            `INSERT OR IGNORE INTO line_item_rules (line_item_id, rule_id, quote_draft_id)
             VALUES (?, ?, ?)`
          ).bind(lineItemId, ruleId, quoteDraftId),
        );
      }
    }

    await this.db.batch(statements);
  }

  /**
   * Fetch all rule associations for a draft, returned as a Map of lineItemId → Rule[].
   */
  async getLineItemRules(quoteDraftId: string): Promise<Map<string, Rule[]>> {
    const result = await this.db.prepare(
      `SELECT lir.line_item_id, r.id, r.name, r.description, r.rule_group_id,
              r.priority_order, r.is_active, r.created_at, r.updated_at
       FROM line_item_rules lir
       JOIN rules r ON r.id = lir.rule_id
       WHERE lir.quote_draft_id = ?
       ORDER BY r.priority_order ASC`
    ).bind(quoteDraftId).all();

    const map = new Map<string, Rule[]>();
    for (const row of result.results as Record<string, unknown>[]) {
      const lineItemId = row.line_item_id as string;
      const rule = this.mapRuleRow(row);
      const existing = map.get(lineItemId) ?? [];
      existing.push(rule);
      map.set(lineItemId, existing);
    }

    return map;
  }

  // ── Private helpers ───────────────────────────────────────────

  private async fetchGroupedRules(activeOnly: boolean): Promise<RuleGroupWithRules[]> {
    const groupsResult = await this.db.prepare(
      'SELECT id, name, description, display_order, created_at FROM rule_groups ORDER BY display_order ASC'
    ).all();

    const rulesQuery = activeOnly
      ? 'SELECT id, name, description, rule_group_id, priority_order, is_active, created_at, updated_at FROM rules WHERE is_active = 1 ORDER BY priority_order ASC'
      : 'SELECT id, name, description, rule_group_id, priority_order, is_active, created_at, updated_at FROM rules ORDER BY priority_order ASC';

    const rulesResult = await this.db.prepare(rulesQuery).all();

    // Group rules by rule_group_id
    const rulesByGroup = new Map<string, Rule[]>();
    for (const row of rulesResult.results as Record<string, unknown>[]) {
      const groupId = row.rule_group_id as string;
      const rule = this.mapRuleRow(row);
      const existing = rulesByGroup.get(groupId) ?? [];
      existing.push(rule);
      rulesByGroup.set(groupId, existing);
    }

    return (groupsResult.results as Record<string, unknown>[]).map((row) => ({
      ...this.mapGroupRow(row),
      rules: rulesByGroup.get(row.id as string) ?? [],
    }));
  }

  private mapRuleRow(row: Record<string, unknown>): Rule {
    return {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string,
      ruleGroupId: row.rule_group_id as string,
      priorityOrder: Number(row.priority_order),
      isActive: row.is_active === 1 || row.is_active === true,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  private mapGroupRow(row: Record<string, unknown>): RuleGroup {
    return {
      id: row.id as string,
      name: row.name as string,
      description: (row.description as string) ?? null,
      displayOrder: Number(row.display_order),
      createdAt: new Date(row.created_at as string),
    };
  }

  private deriveRuleName(feedbackText: string): string {
    const trimmed = feedbackText.trim();
    const sentenceEnd = trimmed.search(/[.!?]\s/);
    if (sentenceEnd > 0 && sentenceEnd <= 60) {
      return trimmed.slice(0, sentenceEnd + 1);
    }
    if (trimmed.length <= 60) return trimmed;
    const truncated = trimmed.slice(0, 60);
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > 20) return truncated.slice(0, lastSpace) + '…';
    return truncated + '…';
  }

  private isUniqueViolation(err: unknown): boolean {
    // D1/SQLite uses SQLITE_CONSTRAINT (code 19) or includes "UNIQUE constraint failed" in message
    if (typeof err === 'object' && err !== null) {
      const msg = (err as { message?: string }).message ?? '';
      return msg.includes('UNIQUE constraint failed');
    }
    return false;
  }
}
