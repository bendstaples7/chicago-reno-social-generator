import type { ActivityLogEntry, PaginationParams } from 'shared';

export class ActivityLogService {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async log(entry: Omit<ActivityLogEntry, 'id' | 'createdAt'>): Promise<void> {
    try {
      const id = crypto.randomUUID();
      await this.db.prepare(
        'INSERT INTO activity_log_entries (id, user_id, component, operation, severity, description, recommended_action) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        id,
        entry.userId,
        entry.component,
        entry.operation,
        entry.severity,
        entry.description,
        entry.recommendedAction ?? null,
      ).run();
    } catch (err) {
      // Log failures are non-fatal — don't crash the caller
      // (e.g. userId='system' violates FK constraint on activity_log_entries)
      console.warn('[ActivityLog] Failed to write log entry:', err instanceof Error ? err.message : err);
    }
  }

  async getEntries(userId: string, pagination: PaginationParams): Promise<ActivityLogEntry[]> {
    const page = Math.max(1, Math.floor(pagination.page) || 1);
    const limit = Math.min(100, Math.max(1, Math.floor(pagination.limit) || 20));
    const offset = (page - 1) * limit;

    const result = await this.db.prepare(
      'SELECT id, user_id, component, operation, severity, description, recommended_action, created_at FROM activity_log_entries WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).bind(userId, limit, offset).all();

    return (result.results as any[]).map((row) => ({
      id: row.id as string,
      userId: row.user_id as string,
      component: row.component as string,
      operation: row.operation as string,
      severity: row.severity as ActivityLogEntry['severity'],
      description: row.description as string,
      recommendedAction: (row.recommended_action as string) ?? undefined,
      createdAt: new Date(row.created_at as string),
    }));
  }
}
