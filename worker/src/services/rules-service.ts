import { PlatformError } from '../errors/index.js';
import type { Rule, RuleGroup, RuleGroupWithRules, StructuredRule, RuleCondition, RuleAction, TriggerMode } from 'shared';
import { validateCondition, validateActions } from './rules-engine.js';

/** Standard column list for rule SELECT queries */
const RULE_COLUMNS = 'id, name, description, rule_group_id, priority_order, is_active, condition_json, action_json, trigger_mode, created_at, updated_at';

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

  /**
   * Fetch active structured rules (those with valid condition and action JSON).
   * Returns typed StructuredRule[] for use by the rules engine.
   * Skips rules with invalid JSON (logs warning, doesn't throw).
   */
  async getActiveStructuredRules(): Promise<StructuredRule[]> {
    const result = await this.db.prepare(
      `SELECT ${RULE_COLUMNS} FROM rules
       WHERE is_active = 1
         AND condition_json IS NOT NULL
         AND action_json IS NOT NULL
       ORDER BY priority_order ASC`
    ).all();

    const structuredRules: StructuredRule[] = [];

    for (const row of result.results as Record<string, unknown>[]) {
      try {
        const conditionRaw = JSON.parse(row.condition_json as string);
        const actionsRaw = JSON.parse(row.action_json as string);

        // Validate condition schema
        const condResult = validateCondition(conditionRaw);
        if (!condResult.valid) {
          console.warn(`Skipping rule ${row.id}: invalid condition — ${condResult.error}`);
          continue;
        }

        // Validate actions schema
        const actResult = validateActions(actionsRaw);
        if (!actResult.valid) {
          console.warn(`Skipping rule ${row.id}: invalid actions — ${actResult.errors?.join('; ')}`);
          continue;
        }

        structuredRules.push({
          id: row.id as string,
          name: row.name as string,
          priorityOrder: Number(row.priority_order),
          triggerMode: (row.trigger_mode as TriggerMode) ?? 'chained',
          condition: conditionRaw as RuleCondition,
          actions: actionsRaw as RuleAction[],
        });
      } catch {
        console.warn(`Skipping rule ${row.id}: failed to parse condition/action JSON`);
      }
    }

    return structuredRules;
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
    conditionJson?: RuleCondition;
    actionJson?: RuleAction[];
    triggerMode?: TriggerMode;
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

    // Reject providing only one of conditionJson/actionJson
    const hasCondition = data.conditionJson !== undefined;
    const hasAction = data.actionJson !== undefined;
    if (hasCondition !== hasAction) {
      throw new PlatformError({
        severity: 'warning',
        component: 'RulesService',
        operation: 'createRule',
        description: 'Structured rules require both conditionJson and actionJson. Provide both or neither.',
        recommendedActions: ['Provide both conditionJson and actionJson together'],
        statusCode: 400,
      });
    }

    // Validate structured rule schemas if provided
    if (data.conditionJson !== undefined) {
      const condResult = validateCondition(data.conditionJson);
      if (!condResult.valid) {
        throw new PlatformError({
          severity: 'warning',
          component: 'RulesService',
          operation: 'createRule',
          description: `Invalid condition schema: ${condResult.error}`,
          recommendedActions: ['Fix the condition JSON and retry'],
          statusCode: 400,
        });
      }
    }

    if (data.actionJson !== undefined) {
      const actResult = validateActions(data.actionJson);
      if (!actResult.valid) {
        throw new PlatformError({
          severity: 'warning',
          component: 'RulesService',
          operation: 'createRule',
          description: `Invalid action schema: ${actResult.errors?.join('; ')}`,
          recommendedActions: ['Fix the action JSON and retry'],
          statusCode: 400,
        });
      }
    }

    const VALID_TRIGGER_MODES = new Set(['on_create', 'chained']);
    if (data.triggerMode !== undefined && !VALID_TRIGGER_MODES.has(data.triggerMode)) {
      throw new PlatformError({
        severity: 'warning',
        component: 'RulesService',
        operation: 'createRule',
        description: `Invalid trigger mode: "${data.triggerMode}". Must be "on_create" or "chained".`,
        recommendedActions: ['Use "on_create" or "chained" as the trigger mode'],
        statusCode: 400,
      });
    }

    const groupId = data.ruleGroupId ?? (await this.getDefaultGroupId());
    const id = crypto.randomUUID();
    const conditionJsonStr = data.conditionJson ? JSON.stringify(data.conditionJson) : null;
    const actionJsonStr = data.actionJson ? JSON.stringify(data.actionJson) : null;
    const triggerMode = data.triggerMode ?? 'chained';

    try {
      // Atomic INSERT with computed priority_order to avoid race conditions
      await this.db.prepare(
        `INSERT INTO rules (id, name, description, rule_group_id, priority_order, is_active, condition_json, action_json, trigger_mode)
         SELECT ?, ?, ?, ?, COALESCE(MAX(priority_order), -1) + 1, ?, ?, ?, ?
         FROM rules WHERE rule_group_id = ?`
      ).bind(
        id,
        data.name.trim(),
        data.description.trim(),
        groupId,
        (data.isActive ?? true) ? 1 : 0,
        conditionJsonStr,
        actionJsonStr,
        triggerMode,
        groupId,
      ).run();

      const row = await this.db.prepare(
        `SELECT ${RULE_COLUMNS} FROM rules WHERE id = ?`
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
    conditionJson?: RuleCondition | null;
    actionJson?: RuleAction[] | null;
    triggerMode?: TriggerMode;
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

    // Reject providing only one of conditionJson/actionJson
    const hasCondition = data.conditionJson !== undefined;
    const hasAction = data.actionJson !== undefined;
    if (hasCondition !== hasAction) {
      throw new PlatformError({
        severity: 'warning',
        component: 'RulesService',
        operation: 'updateRule',
        description: 'Structured rules require both conditionJson and actionJson. Provide both or neither.',
        recommendedActions: ['Provide both conditionJson and actionJson together'],
        statusCode: 400,
      });
    }

    const VALID_TRIGGER_MODES = new Set(['on_create', 'chained']);
    if (data.triggerMode !== undefined && !VALID_TRIGGER_MODES.has(data.triggerMode as string)) {
      throw new PlatformError({
        severity: 'warning',
        component: 'RulesService',
        operation: 'updateRule',
        description: `Invalid trigger mode: "${data.triggerMode}". Must be "on_create" or "chained".`,
        recommendedActions: ['Use "on_create" or "chained" as the trigger mode'],
        statusCode: 400,
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

    // Validate and apply structured rule fields
    if (data.conditionJson !== undefined) {
      if (data.conditionJson !== null) {
        const condResult = validateCondition(data.conditionJson);
        if (!condResult.valid) {
          throw new PlatformError({
            severity: 'warning',
            component: 'RulesService',
            operation: 'updateRule',
            description: `Invalid condition schema: ${condResult.error}`,
            recommendedActions: ['Fix the condition JSON and retry'],
            statusCode: 400,
          });
        }
      }
      setClauses.push('condition_json = ?');
      values.push(data.conditionJson !== null ? JSON.stringify(data.conditionJson) : null);
    }

    if (data.actionJson !== undefined) {
      if (data.actionJson !== null) {
        const actResult = validateActions(data.actionJson);
        if (!actResult.valid) {
          throw new PlatformError({
            severity: 'warning',
            component: 'RulesService',
            operation: 'updateRule',
            description: `Invalid action schema: ${actResult.errors?.join('; ')}`,
            recommendedActions: ['Fix the action JSON and retry'],
            statusCode: 400,
          });
        }
      }
      setClauses.push('action_json = ?');
      values.push(data.actionJson !== null ? JSON.stringify(data.actionJson) : null);
    }

    if (data.triggerMode !== undefined) {
      setClauses.push('trigger_mode = ?');
      values.push(data.triggerMode);
    }

    values.push(ruleId);

    try {
      await this.db.prepare(
        `UPDATE rules SET ${setClauses.join(', ')} WHERE id = ?`
      ).bind(...values).run();

      const row = await this.db.prepare(
        `SELECT ${RULE_COLUMNS} FROM rules WHERE id = ?`
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
      `SELECT ${RULE_COLUMNS} FROM rules WHERE id = ?`
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

    try {
      // Atomic INSERT with computed display_order to avoid race conditions
      await this.db.prepare(
        `INSERT INTO rule_groups (id, name, description, display_order)
         SELECT ?, ?, ?, COALESCE(MAX(display_order), -1) + 1
         FROM rule_groups`
      ).bind(id, data.name.trim(), data.description?.trim() ?? null).run();

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

    // Prevent renaming the default "General" group
    if (data.name !== undefined) {
      const defaultGroupId = await this.getDefaultGroupId();
      if (groupId === defaultGroupId) {
        throw new PlatformError({
          severity: 'error',
          component: 'RulesService',
          operation: 'updateGroup',
          description: "The default 'General' group cannot be renamed.",
          recommendedActions: ['Create a new group instead'],
        });
      }

      // Check for duplicate group name (case-insensitive), excluding the current group
      const duplicate = await this.db.prepare(
        'SELECT id FROM rule_groups WHERE name = ? COLLATE NOCASE AND id != ?'
      ).bind(data.name.trim(), groupId).first();

      if (duplicate) {
        throw new PlatformError({
          severity: 'error',
          component: 'RulesService',
          operation: 'updateGroup',
          description: `A group named '${data.name.trim()}' already exists.`,
          recommendedActions: ['Choose a different name'],
        });
      }
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

    const defaultGroupId = await this.getDefaultGroupId();

    if (group.id === defaultGroupId) {
      throw new PlatformError({
        severity: 'error',
        component: 'RulesService',
        operation: 'deleteGroup',
        description: "The default 'General' group cannot be deleted.",
        recommendedActions: ['Delete or reassign rules individually instead'],
      });
    }

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

  // ── AI Title Summarization ───────────────────────────────────

  /**
   * Use OpenAI to generate a concise, descriptive title for a rule based on its description.
   * Falls back to the simple truncation method if the API call fails.
   */
  async summarizeRuleTitle(
    description: string,
    apiKey: string,
    apiUrl?: string,
  ): Promise<string> {
    if (!apiKey) return this.deriveRuleName(description);

    const url = apiUrl || 'https://api.openai.com/v1/chat/completions';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content:
                'You are a concise title generator for business rules used in a home renovation quoting system. ' +
                'Given a rule description, produce a short, clear title (max 8 words) that summarizes the rule\'s intent. ' +
                'Do NOT use quotes or punctuation at the end. Just return the title text, nothing else.',
            },
            { role: 'user', content: description },
          ],
          temperature: 0.2,
          max_tokens: 30,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        console.warn(`Rule title summarization failed (${response.status}), falling back to truncation`);
        return this.deriveRuleName(description);
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      const title = data.choices?.[0]?.message?.content?.trim();
      if (!title || title.length === 0) return this.deriveRuleName(description);
      // Cap at 80 chars just in case
      return title.length > 80 ? title.slice(0, 80) : title;
    } catch {
      clearTimeout(timeout);
      console.warn('Rule title summarization error, falling back to truncation');
      return this.deriveRuleName(description);
    }
  }

  /**
   * Regenerate summarized titles for all rules that currently have truncated names.
   * Returns the count of rules updated.
   */
  async regenerateAllTitles(apiKey: string, apiUrl?: string): Promise<{ updated: number; total: number }> {
    const result = await this.db.prepare(
      `SELECT ${RULE_COLUMNS} FROM rules ORDER BY priority_order ASC`
    ).all();

    const rules = (result.results as Record<string, unknown>[]).map((row) => this.mapRuleRow(row));
    let updated = 0;

    for (const rule of rules) {
      // Only regenerate if the name looks like a truncation of the description
      const nameIsTruncated = rule.description.toLowerCase().startsWith(rule.name.toLowerCase().replace('…', ''))
        || rule.name.endsWith('…');

      if (nameIsTruncated) {
        const newTitle = await this.summarizeRuleTitle(rule.description, apiKey, apiUrl);
        if (newTitle !== rule.name) {
          await this.db.prepare(
            'UPDATE rules SET name = ?, updated_at = datetime(\'now\') WHERE id = ?'
          ).bind(newTitle, rule.id).run();
          updated++;
        }
      }
    }

    return { updated, total: rules.length };
  }

  /**
   * Auto-categorize rules into trade-based groups by matching rule descriptions
   * against known trade keywords. Rules that don't match any trade stay in their
   * current group.
   */
  async autoCategorizeRules(): Promise<{ moved: number; total: number }> {
    // Trade keywords mapped to group names (case-insensitive matching against rule description)
    // Order matters: more specific patterns are checked before broader ones to avoid
    // misclassification (e.g., "shower surround" → Tile, not Plumbing).
    // Exterior is checked before Tile so "drain tile" (exterior waterproofing) isn't
    // caught by Tile's generic \btile\b pattern.
    const tradeKeywords: Array<{ groupName: string; patterns: RegExp }> = [
      { groupName: 'Exterior', patterns: /\b(exterior|drain tile|siding|gutter)\b/i },
      { groupName: 'Tile', patterns: /\b((?<!drain )tile|tiling|durock|shower surround|shower pan|waterproof|grout)\b/i },
      { groupName: 'Painting', patterns: /\b(paint|painting|primer)\b/i },
      { groupName: 'Electrical', patterns: /\b(electric|electrical|outlet|switch|circuit|wiring|dimmer|can light|light fixture|vanity light)\b/i },
      { groupName: 'Plumbing', patterns: /\b(plumb|plumbing|toilet|shower|faucet|disposal|drain|valve|pipe|sink)\b/i },
      { groupName: 'Carpentry', patterns: /\b(carpentry|cabinet|baseboard|trim|door|window frame|medicine cabinet|wood)\b/i },
      { groupName: 'Drywall', patterns: /\b(drywall|hole patch)\b/i },
      { groupName: 'HVAC', patterns: /\b(hvac|furnace|vent|heating|cooling|air condition)\b/i },
      { groupName: 'Demo', patterns: /\b(demo|demolition|tear out|rip out)\b/i },
      { groupName: 'Insulation', patterns: /\b(insulation|insulate)\b/i },
      { groupName: 'Appliances', patterns: /\b(appliance|range hood|dishwasher|refrigerator|microwave|stove)\b/i },
      { groupName: 'Countertops', patterns: /\b(countertop|counter top|granite|quartz|laminate counter)\b/i },
    ];

    // Fetch all groups to build a name→id map
    const groupsResult = await this.db.prepare(
      'SELECT id, name FROM rule_groups'
    ).all();
    const groupNameToId = new Map<string, string>();
    for (const row of groupsResult.results as Record<string, unknown>[]) {
      groupNameToId.set((row.name as string).toLowerCase(), row.id as string);
    }

    // Fetch all rules
    const rulesResult = await this.db.prepare(
      `SELECT ${RULE_COLUMNS} FROM rules ORDER BY priority_order ASC`
    ).all();
    const rules = (rulesResult.results as Record<string, unknown>[]).map((row) => this.mapRuleRow(row));

    let moved = 0;
    const statements: D1PreparedStatement[] = [];

    for (const rule of rules) {
      // Try to match rule description + name against trade keywords
      const textToMatch = `${rule.name} ${rule.description}`;
      let matchedGroupName: string | null = null;

      for (const { groupName, patterns } of tradeKeywords) {
        if (patterns.test(textToMatch)) {
          matchedGroupName = groupName;
          break;
        }
      }

      if (matchedGroupName) {
        const targetGroupId = groupNameToId.get(matchedGroupName.toLowerCase());
        if (targetGroupId && targetGroupId !== rule.ruleGroupId) {
          statements.push(
            this.db.prepare(
              "UPDATE rules SET rule_group_id = ?, updated_at = datetime('now') WHERE id = ?"
            ).bind(targetGroupId, rule.id),
          );
          moved++;
        }
      }
    }

    if (statements.length > 0) {
      await this.db.batch(statements);
    }

    return { moved, total: rules.length };
  }

  // ── Feedback & line-item-rules ────────────────────────────────

  /**
   * Create a rule from revision feedback text.
   * Uses AI summarization for the title when an API key is provided.
   */
  async createRuleFromFeedback(feedbackText: string, apiKey?: string, apiUrl?: string): Promise<Rule> {
    const name = apiKey
      ? await this.summarizeRuleTitle(feedbackText, apiKey, apiUrl)
      : this.deriveRuleName(feedbackText);
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
              r.priority_order, r.is_active, r.condition_json, r.action_json,
              r.trigger_mode, r.created_at, r.updated_at
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
      ? `SELECT ${RULE_COLUMNS} FROM rules WHERE is_active = 1 ORDER BY priority_order ASC`
      : `SELECT ${RULE_COLUMNS} FROM rules ORDER BY priority_order ASC`;

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
    let conditionJson: RuleCondition | null = null;
    let actionJson: RuleAction[] | null = null;
    let triggerMode: TriggerMode = 'chained';

    if (row.condition_json != null && typeof row.condition_json === 'string') {
      try {
        conditionJson = JSON.parse(row.condition_json) as RuleCondition;
      } catch {
        // Invalid JSON — treat as legacy rule
        conditionJson = null;
      }
    }

    if (row.action_json != null && typeof row.action_json === 'string') {
      try {
        actionJson = JSON.parse(row.action_json) as RuleAction[];
      } catch {
        // Invalid JSON — treat as legacy rule
        actionJson = null;
      }
    }

    if (row.trigger_mode != null && typeof row.trigger_mode === 'string') {
      triggerMode = row.trigger_mode as TriggerMode;
    }

    return {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string,
      ruleGroupId: row.rule_group_id as string,
      priorityOrder: Number(row.priority_order),
      isActive: row.is_active === 1 || row.is_active === true,
      conditionJson,
      actionJson,
      triggerMode,
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
