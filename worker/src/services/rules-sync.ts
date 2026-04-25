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

const D1_DATABASE_ID = '300f9629-60b2-4e2d-a574-e77bf50235ff';

interface RuleSyncOpts {
  accountId: string;
  apiToken: string;
  isLocal: boolean;
}

/** Escape a value for a SQL single-quoted literal. Returns 'NULL' for null/undefined. */
function sqlVal(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return 'NULL';
  return `'${String(s).replace(/'/g, "''")}'`;
}

export class RulesSyncService {
  private accountId: string;
  private apiToken: string;
  private isLocal: boolean;

  constructor(opts: RuleSyncOpts) {
    this.accountId = opts.accountId;
    this.apiToken = opts.apiToken;
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
      const statements: string[] = [];

      // Upsert the group first (if provided)
      if (group) {
        statements.push(
          `INSERT INTO rule_groups (id, name, description, display_order, created_at) VALUES (${sqlVal(group.id)}, ${sqlVal(group.name)}, ${sqlVal(group.description)}, ${group.displayOrder}, ${sqlVal(group.createdAt.toISOString())}) ON CONFLICT (id) DO UPDATE SET name = excluded.name, description = excluded.description, display_order = excluded.display_order;`
        );
      }

      // Upsert the rule
      const condJson = rule.conditionJson ? JSON.stringify(rule.conditionJson) : null;
      const actJson = rule.actionJson ? JSON.stringify(rule.actionJson) : null;

      statements.push(
        `INSERT INTO rules (id, name, description, rule_group_id, priority_order, is_active, condition_json, action_json, trigger_mode, created_at, updated_at) VALUES (${sqlVal(rule.id)}, ${sqlVal(rule.name)}, ${sqlVal(rule.description)}, ${sqlVal(rule.ruleGroupId)}, ${rule.priorityOrder}, ${rule.isActive ? 1 : 0}, ${sqlVal(condJson)}, ${sqlVal(actJson)}, ${sqlVal(rule.triggerMode)}, ${sqlVal(rule.createdAt.toISOString())}, ${sqlVal(rule.updatedAt.toISOString())}) ON CONFLICT (id) DO UPDATE SET name = excluded.name, description = excluded.description, rule_group_id = excluded.rule_group_id, priority_order = excluded.priority_order, is_active = excluded.is_active, condition_json = excluded.condition_json, action_json = excluded.action_json, trigger_mode = excluded.trigger_mode, updated_at = excluded.updated_at;`
      );

      await this.executeRemote(statements.join('\n'));
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
      const sql = `INSERT INTO rule_groups (id, name, description, display_order, created_at) VALUES (${sqlVal(group.id)}, ${sqlVal(group.name)}, ${sqlVal(group.description)}, ${group.displayOrder}, ${sqlVal(group.createdAt.toISOString())}) ON CONFLICT (id) DO UPDATE SET name = excluded.name, description = excluded.description, display_order = excluded.display_order;`;

      await this.executeRemote(sql);
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
      const sql = [
        `UPDATE rules SET rule_group_id = ${sqlVal(targetGroupId)} WHERE rule_group_id = ${sqlVal(groupId)};`,
        `DELETE FROM rule_groups WHERE id = ${sqlVal(groupId)};`,
      ].join('\n');

      await this.executeRemote(sql);
      console.log(`[RulesSync] Deleted group ${groupId} from remote D1`);
    } catch (err) {
      console.warn(`[RulesSync] Failed to delete group from remote:`, err instanceof Error ? err.message : err);
    }
  }

  private async executeRemote(sql: string): Promise<void> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/d1/database/${D1_DATABASE_ID}/query`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Cloudflare API error (${resp.status}): ${text.slice(0, 200)}`);
    }
  }
}
