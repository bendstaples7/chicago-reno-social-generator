import { useState, useEffect, useCallback } from 'react';
import type { ActivityLogEntry } from 'shared';
import { fetchActivityLog } from '../api';

const severityColors: Record<string, string> = {
  error: '#b71c1c',
  warning: '#e65100',
  info: '#00a89d',
};

const severityBg: Record<string, string> = {
  error: '#fdecea',
  warning: '#fff3e0',
  info: '#e0f7f5',
};

export default function ActivityLogPage() {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const limit = 20;

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await fetchActivityLog(p, limit);
      setEntries(res.entries);
      setHasMore(res.entries.length === limit);
    } catch {
      // handled by global error display
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(page); }, [page, load]);

  return (
    <div style={{ maxWidth: 900 }}>
      <h1>Activity Log</h1>

      {loading && entries.length === 0 ? (
        <p>Loading activity log…</p>
      ) : entries.length === 0 ? (
        <p style={{ color: '#666' }}>No activity log entries yet.</p>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {entries.map((entry) => (
              <div
                key={entry.id}
                style={{
                  background: '#fff', borderRadius: 8, padding: '1rem',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                  borderLeft: `4px solid ${severityColors[entry.severity] || '#999'}`,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <span style={{
                      fontSize: '0.75rem', fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                      background: severityBg[entry.severity] || '#f5f5f5',
                      color: severityColors[entry.severity] || '#333',
                      textTransform: 'uppercase',
                    }}>
                      {entry.severity}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{entry.component}</span>
                    <span style={{ color: '#999', fontSize: '0.85rem' }}>· {entry.operation}</span>
                  </div>
                  <span style={{ fontSize: '0.8rem', color: '#999' }}>
                    {new Date(entry.createdAt).toLocaleString()}
                  </span>
                </div>
                <p style={{ margin: '0.25rem 0', fontSize: '0.9rem' }}>{entry.description}</p>
                {entry.recommendedAction && (
                  <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#00a89d' }}>
                    Recommended: {entry.recommendedAction}
                  </p>
                )}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '1.5rem' }}>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1 || loading}
              style={{ padding: '0.5rem 1rem', borderRadius: 6, border: '1px solid #ccc', background: '#fff', cursor: page === 1 ? 'default' : 'pointer', opacity: page === 1 ? 0.5 : 1 }}
            >
              Previous
            </button>
            <span style={{ alignSelf: 'center', fontSize: '0.9rem', color: '#666' }}>Page {page}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasMore || loading}
              style={{ padding: '0.5rem 1rem', borderRadius: 6, border: '1px solid #ccc', background: '#fff', cursor: !hasMore ? 'default' : 'pointer', opacity: !hasMore ? 0.5 : 1 }}
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
