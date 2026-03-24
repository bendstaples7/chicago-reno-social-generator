import { vi } from 'vitest';

export interface MockD1PreparedStatement {
  bind: ReturnType<typeof vi.fn>;
  first: ReturnType<typeof vi.fn>;
  all: ReturnType<typeof vi.fn>;
  run: ReturnType<typeof vi.fn>;
  raw: ReturnType<typeof vi.fn>;
}

export interface MockD1Database {
  prepare: ReturnType<typeof vi.fn>;
  batch: ReturnType<typeof vi.fn>;
  exec: ReturnType<typeof vi.fn>;
  dump: ReturnType<typeof vi.fn>;
  _stmts: MockD1PreparedStatement[];
}

function createMockStatement(): MockD1PreparedStatement {
  const stmt: MockD1PreparedStatement = {
    bind: vi.fn(),
    first: vi.fn().mockResolvedValue(null),
    all: vi.fn().mockResolvedValue({ results: [], success: true }),
    run: vi.fn().mockResolvedValue({ success: true, meta: {} }),
    raw: vi.fn().mockResolvedValue([]),
  };
  // bind() returns the same statement for chaining
  stmt.bind.mockReturnValue(stmt);
  return stmt;
}

/**
 * Creates a mock D1Database for use in unit tests.
 *
 * Each call to db.prepare() creates and returns a new MockD1PreparedStatement
 * that is also pushed onto db._stmts for inspection.
 *
 * To configure return values, grab the statement from _stmts after the
 * service call, or use mockImplementation on prepare to return pre-configured
 * statements.
 */
export function createMockD1(): MockD1Database {
  const stmts: MockD1PreparedStatement[] = [];

  const db: MockD1Database = {
    prepare: vi.fn().mockImplementation(() => {
      const stmt = createMockStatement();
      stmts.push(stmt);
      return stmt;
    }),
    batch: vi.fn().mockResolvedValue([]),
    exec: vi.fn().mockResolvedValue({ count: 0 }),
    dump: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    _stmts: stmts,
  };

  return db;
}

/**
 * Helper: configure db.prepare() to return a sequence of pre-built statements.
 * Useful when you need to set up return values before the service call.
 */
export function configurePrepareResults(
  db: MockD1Database,
  results: Array<{ first?: unknown; all?: { results: unknown[] }; run?: unknown }>,
): void {
  const stmts: MockD1PreparedStatement[] = [];
  for (const r of results) {
    const stmt = createMockStatement();
    if (r.first !== undefined) stmt.first.mockResolvedValue(r.first);
    if (r.all !== undefined) stmt.all.mockResolvedValue(r.all);
    if (r.run !== undefined) stmt.run.mockResolvedValue(r.run);
    stmts.push(stmt);
  }

  let callIndex = 0;
  db.prepare.mockImplementation(() => {
    if (callIndex < stmts.length) {
      const stmt = stmts[callIndex];
      db._stmts.push(stmt);
      callIndex++;
      return stmt;
    }
    // Fallback: return a default statement
    const fallback = createMockStatement();
    db._stmts.push(fallback);
    return fallback;
  });
}
