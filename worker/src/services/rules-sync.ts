/**
 * Rules Sync Service
 *
 * Pushes rule changes from local D1 to remote D1 (and vice versa) via the
 * Cloudflare D1 HTTP API. Used to keep local dev and production rules in sync
 * automatically after every create/update/deactivate operation.
 *
 * In local dev: pushes changes to remote (production) D1.
 * In production: no-op (changes are already in remote D1).
 */

interface RuleSyncOpts {
  accountId: string;
  apiToken: string;
  databaseId: string;
  isLocal: boolean;
}

interface D1Statement {
  sql: string;
  params: unknown[];
}

export class RulesSyncService {
  private accountId: string;
  private apiToken: string;
  private databaseId: string;
  private isLocal: boolean;

  constructor(opts: RuleSyncOpts) {
    this.accountId = opts.accountId;
    this.apiToken = opts.apiToken;
    this.databaseId = opts.databaseId;
    this.isLocal = opts.isLocal;
  }

  /** Returns true if sync is possible (has credentials and is running locally). */
  canSync(): boolean {
    return this.isLocal && !!this.accountId && !!this.apiToken;
  }

  /**
   * Push a rule (and its group) to remote D1.
   * Uses INSERT OR REPLACE to upsert by ID.
   * Fire-and-forget — errors are logged but don't propagate.
   */
  async pushRule(rule: {
    id: string;
    name: string;
    description: string;
    ruleGroupId: string;
    priorityOrder: number;
    isActive: boolean;
    conditionJson?: unknown;
    actionJson?: unknown;
    triggerMode: string;
    createdAt: Date;
    updatedAt: Date;
  }, group?: {
    id: string;
    name: string;
    description: string | null;
    displayOrder: number;
    createdAt: Date;
  }): Promise<void> {
    if (!this.canSync()) return;

    try {
      const statements: D1Statement[] = [];

      // Upsert the group first (if provided)
      if (group) {
        statements.push({
          sql: `INSERT INTO rule_groups (id, name, description, display_order, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name, description = excluded.description, display_order = excluded.display_order;`,
          params: [
            group.id,
            group.name,
            group.description,
            group.displayOrder,
            group.createdAt.toISOString(),
          ],
        });
      }

      // Upsert the rule
      const condJson = rule.conditionJson ? JSON.stringify(rule.conditionJson) : null;
      const actJson = rule.actionJson ? JSON.stringify(rule.actionJson) : null;

      statements.push({
        sql: `INSERT INTO rules (id, name, description, rule_group_id, priority_order, is_active, condition_json, action_json, trigger_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name, description = excluded.description, rule_group_id = excluded.rule_group_id, priority_order = excluded.priority_order, is_active = excluded.is_active, condition_json = excluded.condition_json, action_json = excluded.action_json, trigger_mode = excluded.trigger_mode, updated_at = excluded.updated_at;`,
        params: [
          rule.id,
          rule.name,
          rule.description,
          rule.ruleGroupId,
          rule.priorityOrder,
          rule.isActive ? 1 : 0,
          condJson,
          actJson,
          rule.triggerMode,
          rule.createdAt.toISOString(),
          rule.updatedAt.toISOString(),
        ],
      });

      await this.executeRemote(statements);
      console.log(`[RulesSync] Pushed rule "${rule.name}" to remote D1`);
    } catch (err) {
      console.warn(`[RulesSync] Failed to push rule "${rule.name}":`, err instanceof Error ? err.message : err);
    }
  }

  /**
   * Push a rule group to remote D1.
   */
  async pushGroup(group: {
    id: string;
    name: string;
    description: string | null;
    displayOrder: number;
    createdAt: Date;
  }): Promise<void> {
    if (!this.canSync()) return;

    try {
      const statements: D1Statement[] = [{
        sql: `INSERT INTO rule_groups (id, name, description, display_order, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name, description = excluded.description, display_order = excluded.display_order;`,
        params: [
          group.id,
          group.name,
          group.description,
          group.displayOrder,
          group.createdAt.toISOString(),
        ],
      }];

      await this.executeRemote(statements);
      console.log(`[RulesSync] Pushed group "${group.name}" to remote D1`);
    } catch (err) {
      console.warn(`[RulesSync] Failed to push group "${group.name}":`, err instanceof Error ? err.message : err);
    }
  }

  /**
   * Delete a rule group from remote D1 and reassign its rules.
   */
  async deleteGroupRemote(groupId: string, targetGroupId: string): Promise<void> {
    if (!this.canSync()) return;

    try {
      const statements: D1Statement[] = [
        {
          sql: `UPDATE rules SET rule_group_id = ? WHERE rule_group_id = ?;`,
          params: [targetGroupId, groupId],
        },
        {
          sql: `DELETE FROM rule_groups WHERE id = ?;`,
          params: [groupId],
        },
      ];

      await this.executeRemote(statements);
      console.log(`[RulesSync] Deleted group ${groupId} from remote D1`);
    } catch (err) {
      console.warn(`[RulesSync] Failed to delete group from remote:`, err instanceof Error ? err.message : err);
    }
  }

  private async executeRemote(statements: D1Statement[]): Promise<void> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/d1/database/${this.databaseId}/query`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(statements),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Cloudflare API error (${resp.status}): ${text.slice(0, 200)}`);
    }

    const body = await resp.json() as { result: { success: boolean; error?: string }[] };

    if (!Array.isArray(body.result)) {
      throw new Error(`Unexpected D1 response: missing result array`);
    }

    const failures = body.result
      .map((r, i) => ({ index: i, success: r.success, error: r.error }))
      .filter((r) => !r.success);

    if (failures.length > 0) {
      const details = failures
        .map((f) => `statement[${f.index}]: ${f.error ?? 'unknown error'}`)
        .join('; ');
      throw new Error(`D1 batch execution failed: ${details}`);
    }
  }
}
