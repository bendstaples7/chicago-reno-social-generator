import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { QuoteDraft, QuoteLineItem, ErrorResponse } from 'shared';
import { fetchDraft } from '../api';

export default function QuoteDraftPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [draft, setDraft] = useState<QuoteDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDraft = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const d = await fetchDraft(id);
      setDraft(d);
    } catch (err) {
      setError((err as ErrorResponse).message ?? 'Failed to load quote draft.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadDraft(); }, [loadDraft]);

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={loadingContainerStyle}>
          <span style={spinnerStyle} />
          <p style={{ margin: '0.75rem 0 0', color: '#555' }}>Loading quote draft…</p>
        </div>
      </div>
    );
  }

  if (error || !draft) {
    return (
      <div style={containerStyle}>
        <button onClick={() => navigate('/quotes')} style={backBtnStyle}>← Back to New Quote</button>
        <div role="alert" style={alertStyle}>{error ?? 'Quote draft not found.'}</div>
      </div>
    );
  }

  const hasUnresolved = draft.unresolvedItems.length > 0;

  return (
    <div style={containerStyle}>
      <button onClick={() => navigate('/quotes')} style={backBtnStyle}>← Back to New Quote</button>

      <h1 style={titleStyle}>Quote Draft</h1>

      {/* Selected template */}
      {draft.selectedTemplateName && (
        <div style={templateBannerStyle}>
          <span style={{ fontWeight: 600 }}>Template:</span> {draft.selectedTemplateName}
        </div>
      )}

      {/* Matched line items table */}
      <div style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Matched Line Items</h2>
        {draft.lineItems.length === 0 ? (
          <p style={{ color: '#888', margin: '0.5rem 0' }}>No matched line items.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Product Name</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Quantity</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Unit Price</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {draft.lineItems.map((item: QuoteLineItem) => (
                  <tr key={item.id}>
                    <td style={tdStyle}>{item.productName}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{item.quantity}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>${item.unitPrice.toFixed(2)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <span style={confidenceBadgeStyle(item.confidenceScore)}>
                        {item.confidenceScore}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Unresolved items section — hidden when zero */}
      {hasUnresolved && (
        <div style={unresolvedSectionStyle}>
          <h2 style={{ ...sectionTitleStyle, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={warningIconStyle}>⚠️</span>
            Unresolved Items
          </h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Original Text</th>
                  <th style={thStyle}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {draft.unresolvedItems.map((item: QuoteLineItem) => (
                  <tr key={item.id}>
                    <td style={tdStyle}>{item.originalText}</td>
                    <td style={tdStyle}>{item.unmatchedReason ?? 'Unknown'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Draft metadata */}
      <div style={{ fontSize: '0.8rem', color: '#888', marginTop: '1.5rem' }}>
        Created: {new Date(draft.createdAt).toLocaleString()}
        {' · '}
        Source: {draft.catalogSource === 'jobber' ? 'Jobber' : 'Manual'}
      </div>
    </div>
  );
}

// ── Styles ──

const containerStyle: React.CSSProperties = { maxWidth: 800, margin: '0 auto' };
const titleStyle: React.CSSProperties = { margin: '0 0 1rem', fontSize: '1.5rem' };

const backBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#1976d2',
  cursor: 'pointer',
  fontSize: '0.9rem',
  padding: 0,
  marginBottom: '1rem',
  display: 'inline-block',
};

const alertStyle: React.CSSProperties = {
  background: '#fdecea',
  color: '#611a15',
  padding: '0.75rem 1rem',
  borderRadius: 4,
  marginBottom: '1rem',
};

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
  borderTopColor: '#1976d2',
  borderRadius: '50%',
  animation: 'spin 0.6s linear infinite',
};

const templateBannerStyle: React.CSSProperties = {
  background: '#e3f2fd',
  color: '#1565c0',
  padding: '0.6rem 1rem',
  borderRadius: 6,
  marginBottom: '1.25rem',
  fontSize: '0.9rem',
};

const sectionStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e0e0e0',
  borderRadius: 8,
  padding: '1rem 1.25rem',
  marginBottom: '1rem',
};

const unresolvedSectionStyle: React.CSSProperties = {
  background: '#fff8e1',
  border: '1px solid #ffe082',
  borderRadius: 8,
  padding: '1rem 1.25rem',
  marginBottom: '1rem',
};

const sectionTitleStyle: React.CSSProperties = {
  margin: '0 0 0.75rem',
  fontSize: '1.1rem',
  fontWeight: 600,
};

const warningIconStyle: React.CSSProperties = {
  fontSize: '1.1rem',
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.5rem 0.75rem',
  borderBottom: '2px solid #e0e0e0',
  fontSize: '0.8rem',
  fontWeight: 600,
  color: '#888',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const tdStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  borderBottom: '1px solid #f0f0f0',
  fontSize: '0.9rem',
};

function confidenceBadgeStyle(score: number): React.CSSProperties {
  const bg = score >= 90 ? '#e8f5e9' : score >= 70 ? '#fff3e0' : '#fdecea';
  const color = score >= 90 ? '#2e7d32' : score >= 70 ? '#e65100' : '#611a15';
  return {
    display: 'inline-block',
    padding: '0.15rem 0.5rem',
    borderRadius: 12,
    fontSize: '0.8rem',
    fontWeight: 600,
    background: bg,
    color,
  };
}
