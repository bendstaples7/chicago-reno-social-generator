import { useState, useEffect, useCallback, useRef } from 'react';
import { syncCorpus, fetchCorpusStatus } from '../api';
import type { SyncResult } from '../api';

export default function CorpusStatusIndicator() {
  const [totalQuotes, setTotalQuotes] = useState<number>(0);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const status = await fetchCorpusStatus();
      setTotalQuotes(status.totalQuotes);
      setLastSyncAt(status.lastSyncAt);
    } catch {
      // handled by global error display
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    setLastResult(null);

    // Start polling status while sync runs
    pollRef.current = setInterval(async () => {
      try {
        const status = await fetchCorpusStatus();
        setTotalQuotes(status.totalQuotes);
        setLastSyncAt(status.lastSyncAt);
      } catch {
        // ignore polling errors
      }
    }, 3000);

    try {
      const result = await syncCorpus();
      if (result.error) {
        setError(result.error);
      }
      setLastResult(result);
      await loadStatus();
    } catch (err: unknown) {
      const message = err && typeof err === 'object' && 'message' in err
        ? (err as { message: string }).message
        : 'Corpus synchronization failed.';
      setError(message);
    } finally {
      setSyncing(false);
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  return (
    <section style={sectionStyle}>
      <h2 style={headingStyle}>Quote Corpus</h2>

      <div style={statsRow}>
        <div style={statBox}>
          <div style={statValue}>{totalQuotes}</div>
          <div style={statLabel}>Indexed Quotes</div>
        </div>
        <div style={statBox}>
          <div style={statValue}>{lastSyncAt ? formatDate(lastSyncAt) : '—'}</div>
          <div style={statLabel}>Last Synced</div>
        </div>
      </div>

      {error && (
        <div role="alert" style={errorStyle}>
          {error}
        </div>
      )}

      {lastResult && !error && (
        <div style={successStyle}>
          Sync complete — {lastResult.newQuotes} new, {lastResult.updatedQuotes} updated, {lastResult.unchangedQuotes} unchanged
        </div>
      )}

      <button
        onClick={handleSync}
        disabled={syncing}
        style={{ ...btnStyle, opacity: syncing ? 0.6 : 1 }}
        type="button"
        aria-label="Sync quote corpus now"
      >
        {syncing ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={spinnerStyle} />
            Syncing…
          </span>
        ) : (
          'Sync Now'
        )}
      </button>
    </section>
  );
}

// ── Styles ──

const sectionStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 8,
  padding: '1.25rem',
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
};

const headingStyle: React.CSSProperties = {
  margin: '0 0 0.75rem',
  fontSize: '1.1rem',
};

const statsRow: React.CSSProperties = {
  display: 'flex',
  gap: '1.5rem',
  marginBottom: '1rem',
};

const statBox: React.CSSProperties = {
  flex: 1,
};

const statValue: React.CSSProperties = {
  fontWeight: 600,
  fontSize: '1rem',
};

const statLabel: React.CSSProperties = {
  fontSize: '0.8rem',
  color: '#888',
  marginTop: 2,
};

const errorStyle: React.CSSProperties = {
  padding: '0.75rem',
  marginBottom: '0.75rem',
  background: '#fdecea',
  color: '#b71c1c',
  borderRadius: 6,
  fontSize: '0.9rem',
};

const successStyle: React.CSSProperties = {
  padding: '0.75rem',
  marginBottom: '0.75rem',
  background: '#e0f7f5',
  color: '#00a89d',
  borderRadius: 6,
  fontSize: '0.9rem',
};

const btnStyle: React.CSSProperties = {
  padding: '0.5rem 1rem',
  border: '1px solid #00a89d',
  background: '#00a89d',
  color: '#fff',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: '0.9rem',
  fontWeight: 500,
};

const spinnerStyle: React.CSSProperties = {
  display: 'inline-block',
  width: 14,
  height: 14,
  border: '2px solid rgba(255,255,255,0.3)',
  borderTopColor: '#fff',
  borderRadius: '50%',
  animation: 'spin 0.6s linear infinite',
};
