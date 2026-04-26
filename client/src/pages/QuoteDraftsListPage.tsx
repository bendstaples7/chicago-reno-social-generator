import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { QuoteDraft, ErrorResponse } from 'shared';
import { fetchDrafts, deleteDraft } from '../api';

export default function QuoteDraftsListPage() {
  const navigate = useNavigate();

  const [drafts, setDrafts] = useState<QuoteDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadDrafts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await fetchDrafts();
      setDrafts(result);
    } catch (err) {
      setError((err as ErrorResponse).message ?? 'Failed to load drafts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadDrafts(); }, [loadDrafts]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this draft? This cannot be undone.')) return;
    try {
      setDeletingId(id);
      await deleteDraft(id);
      setDrafts((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      setError((err as ErrorResponse).message ?? 'Failed to delete draft.');
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={loadingContainerStyle}>
          <span style={spinnerStyle} />
          <p style={{ margin: '0.75rem 0 0', color: '#555' }}>Loading saved drafts…</p>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <h1 style={titleStyle}>Saved Drafts</h1>

      {error && (
        <div role="alert" style={alertStyle}>{error}</div>
      )}

      {drafts.length === 0 ? (
        <div style={emptyStyle}>
          <p style={{ margin: 0, color: '#888' }}>No saved drafts yet.</p>
          <button onClick={() => navigate('/quotes')} style={{ ...linkBtnStyle, marginTop: '0.75rem' }}>
            Create a new quote →
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {drafts.map((draft) => (
            <div key={draft.id} style={cardStyle}>
              <div
                style={cardContentStyle}
                onClick={() => navigate('/quotes/drafts/' + draft.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') navigate('/quotes/drafts/' + draft.id); }}
                aria-label={`View draft from ${new Date(draft.createdAt).toLocaleDateString()}`}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.95rem', color: '#061216' }}>
                      D-{String(draft.draftNumber).padStart(3, '0')}
                    </span>
                    {draft.clientName && (
                      <span style={{ fontSize: '0.85rem', color: '#555' }}>
                        — {draft.clientName}
                      </span>
                    )}
                  </div>
                  <p style={requestTextStyle}>
                    {draft.customerRequestText
                      ? draft.customerRequestText.length > 120
                        ? draft.customerRequestText.slice(0, 120) + '…'
                        : draft.customerRequestText
                      : 'No request text'}
                  </p>
                  <div style={metaRowStyle}>
                    <span style={metaStyle}>
                      {new Date(draft.createdAt).toLocaleDateString()} · {new Date(draft.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span style={metaStyle}>
                      {draft.lineItems.length} item{draft.lineItems.length !== 1 ? 's' : ''}
                    </span>
                    {draft.unresolvedItems.length > 0 && (
                      <span style={unresolvedBadgeStyle}>
                        ⚠️ {draft.unresolvedItems.length} unresolved
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(draft.id); }}
                disabled={deletingId === draft.id}
                style={deleteBtnStyle}
                aria-label="Delete draft"
                type="button"
              >
                {deletingId === draft.id ? '…' : '🗑'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ── Styles ──

const containerStyle: React.CSSProperties = { maxWidth: 800, margin: '0 auto' };
const titleStyle: React.CSSProperties = { margin: '0 0 1.25rem', fontSize: '1.5rem' };

const loadingContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '3rem 0',
};

const spinnerStyle: React.CSSProperties = {
  display: 'inline-block',
  width: 28,
  height: 28,
  border: '3px solid #e0e0e0',
  borderTopColor: '#00a89d',
  borderRadius: '50%',
  animation: 'spin 0.6s linear infinite',
};

const alertStyle: React.CSSProperties = {
  background: '#fdecea',
  color: '#611a15',
  padding: '0.75rem 1rem',
  borderRadius: 4,
  marginBottom: '1rem',
};

const emptyStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: '3rem 1rem',
  background: '#fff',
  borderRadius: 8,
  border: '1px solid #e0e0e0',
};

const linkBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#00a89d',
  cursor: 'pointer',
  fontSize: '0.9rem',
  padding: 0,
};

const cardStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  background: '#fff',
  border: '1px solid #e0e0e0',
  borderRadius: 8,
  overflow: 'hidden',
};

const cardContentStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  padding: '0.75rem 1rem',
  cursor: 'pointer',
  minWidth: 0,
};

const requestTextStyle: React.CSSProperties = {
  margin: '0 0 0.4rem',
  fontSize: '0.9rem',
  fontWeight: 500,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const metaRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.75rem',
  alignItems: 'center',
  flexWrap: 'wrap',
};

const metaStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  color: '#888',
};

const unresolvedBadgeStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: '#e65100',
  background: '#fff3e0',
  padding: '0.1rem 0.4rem',
  borderRadius: 10,
};

const deleteBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  borderLeft: '1px solid #e0e0e0',
  padding: '0.75rem 1rem',
  cursor: 'pointer',
  fontSize: '1rem',
  color: '#888',
  alignSelf: 'stretch',
  display: 'flex',
  alignItems: 'center',
};
