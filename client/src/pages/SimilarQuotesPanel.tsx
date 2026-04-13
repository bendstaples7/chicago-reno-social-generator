import { useState } from 'react';
import type { SimilarQuote } from 'shared';

interface Props {
  similarQuotes: SimilarQuote[];
}

function scoreBadgeStyle(score: number): React.CSSProperties {
  const pct = score * 100;
  const bg = pct > 70 ? '#e0f7f5' : pct >= 50 ? '#fff8e1' : '#f5f5f5';
  const color = pct > 70 ? '#00a89d' : pct >= 50 ? '#f9a825' : '#757575';
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

export default function SimilarQuotesPanel({ similarQuotes }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!similarQuotes || similarQuotes.length === 0) return null;

  const toggle = (id: string) =>
    setExpandedId((prev) => (prev === id ? null : id));

  return (
    <div style={panelStyle}>
      <h2 style={headingStyle}>Similar Past Quotes</h2>
      <ul style={listStyle}>
        {similarQuotes.map((sq) => {
          const isOpen = expandedId === sq.jobberQuoteId;
          return (
            <li key={sq.jobberQuoteId} style={itemStyle}>
              <button
                type="button"
                onClick={() => toggle(sq.jobberQuoteId)}
                style={rowBtnStyle}
                aria-expanded={isOpen}
              >
                <span style={titleTextStyle}>
                  {sq.title || '(untitled)'}{' '}
                  <span style={quoteNumStyle}>#{sq.quoteNumber}</span>
                </span>
                <span style={scoreBadgeStyle(sq.similarityScore)}>
                  {Math.round(sq.similarityScore * 100)}%
                </span>
              </button>
              {isOpen && (
                <div style={detailStyle}>
                  {sq.message || <em style={{ color: '#999' }}>No message text.</em>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e0e0e0',
  borderRadius: 8,
  padding: '1rem 1.25rem',
  marginBottom: '1rem',
};

const headingStyle: React.CSSProperties = {
  margin: '0 0 0.75rem',
  fontSize: '1.1rem',
  fontWeight: 600,
};

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
};

const itemStyle: React.CSSProperties = {
  borderBottom: '1px solid #f0f0f0',
};

const rowBtnStyle: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  background: 'none',
  border: 'none',
  padding: '0.6rem 0',
  cursor: 'pointer',
  fontSize: '0.9rem',
  textAlign: 'left',
};

const titleTextStyle: React.CSSProperties = {
  flex: 1,
  marginRight: '0.75rem',
};

const quoteNumStyle: React.CSSProperties = {
  color: '#888',
  fontSize: '0.85rem',
};

const detailStyle: React.CSSProperties = {
  padding: '0.5rem 0 0.75rem',
  fontSize: '0.85rem',
  color: '#555',
  whiteSpace: 'pre-wrap',
};
