import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { QuoteDraft, QuoteLineItem, ErrorResponse, RuleGroupWithRules, Rule } from 'shared';
import { fetchDraft, reviseDraft, fetchRules, fetchJobberRequestDetail } from '../api';
import type { JobberRequestDetail } from '../api';
import SimilarQuotesPanel from './SimilarQuotesPanel';

export default function QuoteDraftPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [draft, setDraft] = useState<QuoteDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [revising, setRevising] = useState(false);
  const [revisionError, setRevisionError] = useState<string | null>(null);
  const [feedbackValidation, setFeedbackValidation] = useState<string | null>(null);
  const [expandedRuleRows, setExpandedRuleRows] = useState<Set<string>>(new Set());
  const [ruleGroups, setRuleGroups] = useState<RuleGroupWithRules[]>([]);
  const [createRuleToggle, setCreateRuleToggle] = useState(false);
  const [ruleCreatedMsg, setRuleCreatedMsg] = useState<string | null>(null);
  const [ruleCreationWarning, setRuleCreationWarning] = useState<string | null>(null);
  const [requestDetail, setRequestDetail] = useState<JobberRequestDetail | null>(null);

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

  useEffect(() => {
    fetchRules().then(setRuleGroups).catch(() => { /* rules are supplementary; ignore errors */ });
  }, []);

  // Fetch Jobber request details when draft has a jobberRequestId
  useEffect(() => {
    if (!draft?.jobberRequestId) return;
    fetchJobberRequestDetail(draft.jobberRequestId)
      .then((data) => setRequestDetail(data.request))
      .catch(() => { /* supplementary; ignore errors */ });
  }, [draft?.jobberRequestId]);

  const handleSubmitFeedback = async () => {
    if (!id || !feedbackText.trim()) {
      setFeedbackValidation('Please enter feedback before submitting.');
      return;
    }
    setFeedbackValidation(null);
    setRevisionError(null);
    setRuleCreatedMsg(null);
    setRuleCreationWarning(null);
    setRevising(true);
    try {
      const updated = await reviseDraft(id, feedbackText, createRuleToggle || undefined);
      setDraft(updated);
      setFeedbackText('');
      setCreateRuleToggle(false);
      if (updated.ruleCreated) {
        setRuleCreatedMsg(`Rule "${updated.ruleCreated.name}" was created and will apply to future quotes.`);
        // Refresh rules so traceability panel has the latest
        fetchRules().then(setRuleGroups).catch(() => {});
      } else if (updated.ruleCreationError) {
        setRuleCreationWarning(`Quote revised successfully, but rule creation failed: ${updated.ruleCreationError}`);
      }
    } catch (err) {
      setRevisionError((err as ErrorResponse).message ?? 'Revision failed. Please try again.');
    } finally {
      setRevising(false);
    }
  };

  // Build a lookup map: ruleId -> Rule
  const ruleById = new Map<string, Rule>();
  for (const group of ruleGroups) {
    for (const rule of group.rules) {
      ruleById.set(rule.id, rule);
    }
  }

  // Build a lookup map: ruleId -> group name
  const groupNameByRuleId = new Map<string, string>();
  for (const group of ruleGroups) {
    for (const rule of group.rules) {
      groupNameByRuleId.set(rule.id, group.name);
    }
  }

  const toggleRuleRow = (itemId: string) => {
    setExpandedRuleRows((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  /** Get applied rules for a line item, grouped by group name */
  const getAppliedRulesGrouped = (item: QuoteLineItem): Map<string, Rule[]> => {
    const grouped = new Map<string, Rule[]>();
    if (!item.ruleIdsApplied || item.ruleIdsApplied.length === 0) return grouped;
    for (const ruleId of item.ruleIdsApplied) {
      const rule = ruleById.get(ruleId);
      if (!rule) continue;
      const groupName = groupNameByRuleId.get(ruleId) ?? 'Unknown';
      const list = grouped.get(groupName) ?? [];
      list.push(rule);
      grouped.set(groupName, list);
    }
    return grouped;
  };

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
  const showSidePanel = !!(draft.customerRequestText || requestDetail);

  return (
    <div style={{ display: 'flex', gap: '1.5rem', maxWidth: showSidePanel ? 1200 : 800, margin: '0 auto' }}>
      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0 }}>
      <button onClick={() => navigate('/quotes')} style={backBtnStyle}>← Back to New Quote</button>

      <h1 style={titleStyle}>Quote Draft D-{String(draft.draftNumber).padStart(3, '0')}</h1>

      {/* Selected template */}
      {draft.selectedTemplateName && (
        <div style={templateBannerStyle}>
          <span style={{ fontWeight: 600 }}>Template:</span> {draft.selectedTemplateName}
        </div>
      )}

      {/* Similar past quotes panel — hidden when empty */}
      {draft.similarQuotes && draft.similarQuotes.length > 0 && (
        <SimilarQuotesPanel similarQuotes={draft.similarQuotes} />
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
                  <th style={{ ...thStyle, textAlign: 'center', width: 40 }}>Rules</th>
                </tr>
              </thead>
              <tbody>
                {draft.lineItems.map((item: QuoteLineItem) => {
                  const isExpanded = expandedRuleRows.has(item.id);
                  const appliedGrouped = getAppliedRulesGrouped(item);
                  const hasRules = appliedGrouped.size > 0;
                  return (
                    <React.Fragment key={item.id}>
                      <tr style={{ verticalAlign: 'top' }}>
                        <td style={tdStyle}>{item.productName}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{item.quantity}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>${item.unitPrice.toFixed(2)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <span style={confidenceBadgeStyle(item.confidenceScore)}>
                            {item.confidenceScore}%
                          </span>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          <button
                            onClick={() => toggleRuleRow(item.id)}
                            style={infoIconBtnStyle}
                            aria-label={isExpanded ? 'Hide applied rules' : 'Show applied rules'}
                            aria-expanded={isExpanded}
                            title="View applied rules"
                          >
                            ℹ
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td
                            colSpan={5}
                            style={{ padding: 0, border: 'none' }}
                          >
                            <div
                              onClick={() => toggleRuleRow(item.id)}
                              style={ruleTraceabilityPanelStyle}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleRuleRow(item.id); } }}
                              aria-label="Click to close rules panel"
                            >
                              {!hasRules ? (
                                <p style={noRulesTextStyle}>No specific rules were applied</p>
                              ) : (
                                Array.from(appliedGrouped.entries()).map(([groupName, rules]) => (
                                  <div key={groupName} style={{ marginBottom: '0.5rem' }}>
                                    <p style={ruleGroupHeadingStyle}>{groupName}</p>
                                    {rules.map((rule) => (
                                      <div key={rule.id} style={ruleEntryStyle}>
                                        <span style={ruleNameStyle}>{rule.name}</span>
                                        <span style={ruleDescStyle}>{rule.description}</span>
                                      </div>
                                    ))}
                                  </div>
                                ))
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
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

      {/* Feedback input */}
      <div style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Revise This Quote</h2>
        <p style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', color: '#666' }}>
          Describe the changes you want (e.g., "increase drywall to 12 sheets", "remove painting").
        </p>
        <textarea
          value={feedbackText}
          onChange={(e) => {
            setFeedbackText(e.target.value);
            if (feedbackValidation) setFeedbackValidation(null);
          }}
          disabled={revising}
          placeholder="Type your feedback here…"
          rows={3}
          style={feedbackInputStyle}
          aria-label="Feedback for quote revision"
        />
        {feedbackValidation && (
          <p style={validationMsgStyle} role="alert">{feedbackValidation}</p>
        )}
        {revisionError && (
          <div role="alert" style={revisionErrorStyle}>{revisionError}</div>
        )}
        <div style={toggleRowStyle}>
          <label style={toggleLabelStyle}>
            <span
              role="switch"
              aria-checked={createRuleToggle}
              tabIndex={0}
              onClick={() => setCreateRuleToggle((v) => !v)}
              onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setCreateRuleToggle((v) => !v); } }}
              style={{
                ...toggleTrackStyle,
                background: createRuleToggle ? '#00a89d' : '#ccc',
              }}
            >
              <span style={{
                ...toggleThumbStyle,
                transform: createRuleToggle ? 'translateX(16px)' : 'translateX(0)',
              }} />
            </span>
            <span style={{ fontSize: '0.85rem', color: '#555' }}>Also save as rule for future quotes</span>
          </label>
        </div>
        <button
          onClick={handleSubmitFeedback}
          disabled={!feedbackText.trim() || revising}
          style={{
            ...submitBtnStyle,
            opacity: (!feedbackText.trim() || revising) ? 0.5 : 1,
            cursor: (!feedbackText.trim() || revising) ? 'not-allowed' : 'pointer',
          }}
        >
          {revising ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={smallSpinnerStyle} /> Revising…
            </span>
          ) : (
            'Submit Feedback'
          )}
        </button>
        {ruleCreatedMsg && (
          <div style={ruleCreatedMsgStyle} role="status">{ruleCreatedMsg}</div>
        )}
        {ruleCreationWarning && (
          <div style={ruleCreationWarningStyle} role="alert">{ruleCreationWarning}</div>
        )}
      </div>

      {/* Revision history */}
      {draft.revisionHistory && draft.revisionHistory.length > 0 && (
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Revision History</h2>
          <div style={historyListStyle}>
            {draft.revisionHistory.map((entry) => (
              <div key={entry.id} style={historyEntryStyle}>
                <p style={{ margin: 0, fontSize: '0.9rem' }}>{entry.feedbackText}</p>
                <span style={historyTimestampStyle}>
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Draft metadata */}
      <div style={{ fontSize: '0.8rem', color: '#888', marginTop: '1.5rem' }}>
        Created: {new Date(draft.createdAt).toLocaleString()}
        {' · '}
        Source: {draft.catalogSource === 'jobber' ? 'Jobber' : 'Manual'}
      </div>
      </div>{/* end main content column */}

      {/* Request details side panel */}
      {showSidePanel && (
        <aside style={sidePanelStyle}>
          <h2 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem', fontWeight: 600 }}>Request Details</h2>

          {requestDetail?.title && (
            <div style={{ marginBottom: '0.75rem' }}>
              <h3 style={sidePanelLabelStyle}>Title</h3>
              <p style={sidePanelTextStyle}>{requestDetail.title}</p>
            </div>
          )}

          {requestDetail?.clientName && (
            <div style={{ marginBottom: '0.75rem' }}>
              <h3 style={sidePanelLabelStyle}>Client</h3>
              <p style={sidePanelTextStyle}>{requestDetail.clientName}</p>
            </div>
          )}

          {draft.customerRequestText && (
            <div style={{ marginBottom: '0.75rem' }}>
              <h3 style={sidePanelLabelStyle}>{requestDetail ? 'Request Body' : 'Customer Request'}</h3>
              <p style={{ ...sidePanelTextStyle, whiteSpace: 'pre-wrap' }}>{draft.customerRequestText}</p>
            </div>
          )}

          {requestDetail && requestDetail.description && requestDetail.description !== draft.customerRequestText && (
            <div style={{ marginBottom: '0.75rem' }}>
              <h3 style={sidePanelLabelStyle}>Description</h3>
              <p style={{ ...sidePanelTextStyle, whiteSpace: 'pre-wrap' }}>{requestDetail.description}</p>
            </div>
          )}

          {requestDetail && requestDetail.imageUrls.length > 0 && (
            <div style={{ marginBottom: '0.75rem' }}>
              <h3 style={sidePanelLabelStyle}>Images ({requestDetail.imageUrls.length})</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {requestDetail.imageUrls.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                    <img
                      src={url}
                      alt={`Request image ${i + 1}`}
                      style={{ width: '100%', borderRadius: 6, border: '1px solid #e0e0e0', cursor: 'pointer' }}
                    />
                  </a>
                ))}
              </div>
            </div>
          )}

          {requestDetail && requestDetail.notes.length > 0 && (
            <div style={{ marginBottom: '0.75rem' }}>
              <h3 style={sidePanelLabelStyle}>Notes ({requestDetail.notes.length})</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {requestDetail.notes.map((note, i) => (
                  <div key={i} style={sidePanelNoteStyle}>
                    <p style={{ margin: 0, fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>{note.message}</p>
                    <span style={{ fontSize: '0.7rem', color: '#999', marginTop: '0.2rem', display: 'block' }}>
                      {note.createdBy === 'team' ? '👤 Team' : '💬 Client'}
                      {note.createdAt && ` · ${new Date(note.createdAt).toLocaleDateString()}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}

// ── Styles ──

const containerStyle: React.CSSProperties = { maxWidth: 800, margin: '0 auto' };
const titleStyle: React.CSSProperties = { margin: '0 0 1rem', fontSize: '1.5rem' };

const backBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#00a89d',
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
  borderTopColor: '#00a89d',
  borderRadius: '50%',
  animation: 'spin 0.6s linear infinite',
};

const templateBannerStyle: React.CSSProperties = {
  background: '#e0f7f5',
  color: '#00a89d',
  padding: '0.6rem 1rem',
  borderRadius: 6,
  marginBottom: '1.25rem',
  fontSize: '0.9rem',
};

const requestSectionStyle: React.CSSProperties = {
  background: '#f8f9fa',
  border: '1px solid #e0e0e0',
  borderRadius: 8,
  padding: '1rem 1.25rem',
  marginBottom: '1rem',
};

const requestBodyStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.9rem',
  color: '#333',
  whiteSpace: 'pre-wrap',
  lineHeight: 1.5,
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
  const bg = score >= 90 ? '#e0f7f5' : score >= 70 ? '#fff3e0' : '#fdecea';
  const color = score >= 90 ? '#00a89d' : score >= 70 ? '#e65100' : '#611a15';
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

const feedbackInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.6rem 0.75rem',
  border: '1px solid #ccc',
  borderRadius: 6,
  fontSize: '0.9rem',
  fontFamily: 'inherit',
  resize: 'vertical',
  boxSizing: 'border-box',
};

const validationMsgStyle: React.CSSProperties = {
  color: '#d32f2f',
  fontSize: '0.8rem',
  margin: '0.25rem 0 0',
};

const revisionErrorStyle: React.CSSProperties = {
  background: '#fdecea',
  color: '#611a15',
  padding: '0.5rem 0.75rem',
  borderRadius: 4,
  fontSize: '0.85rem',
  marginTop: '0.5rem',
};

const submitBtnStyle: React.CSSProperties = {
  marginTop: '0.75rem',
  padding: '0.5rem 1.25rem',
  background: '#00a89d',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  fontSize: '0.9rem',
  fontWeight: 600,
};

const smallSpinnerStyle: React.CSSProperties = {
  display: 'inline-block',
  width: 14,
  height: 14,
  border: '2px solid rgba(255,255,255,0.3)',
  borderTopColor: '#fff',
  borderRadius: '50%',
  animation: 'spin 0.6s linear infinite',
};

const historyListStyle: React.CSSProperties = {
  maxHeight: 300,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
};

const historyEntryStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  background: '#f9f9f9',
  borderRadius: 6,
  border: '1px solid #eee',
};

const historyTimestampStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: '#999',
  marginTop: '0.25rem',
  display: 'block',
};

// ── Rule Traceability Styles ──

const infoIconBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontSize: '1rem',
  padding: '0.15rem 0.35rem',
  borderRadius: 4,
  color: '#00a89d',
  lineHeight: 1,
};

const ruleTraceabilityPanelStyle: React.CSSProperties = {
  textAlign: 'left',
  background: '#f8f9fa',
  border: '1px solid #e0e0e0',
  borderRadius: 6,
  padding: '0.75rem 1rem',
  margin: '0.25rem 0.75rem 0.5rem',
  cursor: 'pointer',
};

const noRulesTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  color: '#888',
  fontStyle: 'italic',
};

const ruleGroupHeadingStyle: React.CSSProperties = {
  margin: '0 0 0.25rem',
  fontSize: '0.8rem',
  fontWeight: 600,
  color: '#555',
  textTransform: 'uppercase',
  letterSpacing: '0.3px',
};

const ruleEntryStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.1rem',
  padding: '0.25rem 0 0.25rem 0.5rem',
  borderLeft: '2px solid #00a89d',
  marginBottom: '0.35rem',
};

const ruleNameStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  fontWeight: 600,
  color: '#333',
};

const ruleDescStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: '#666',
};

// ── Rule Creation Toggle Styles ──

const toggleRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  marginTop: '0.5rem',
};

const toggleLabelStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.5rem',
  cursor: 'pointer',
};

const toggleTrackStyle: React.CSSProperties = {
  display: 'inline-block',
  width: 36,
  height: 20,
  borderRadius: 10,
  position: 'relative',
  transition: 'background 0.2s',
  flexShrink: 0,
};

const toggleThumbStyle: React.CSSProperties = {
  display: 'block',
  width: 16,
  height: 16,
  borderRadius: '50%',
  background: '#fff',
  position: 'absolute',
  top: 2,
  left: 2,
  transition: 'transform 0.2s',
  boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
};

const ruleCreatedMsgStyle: React.CSSProperties = {
  background: '#e0f7f5',
  color: '#00695c',
  padding: '0.5rem 0.75rem',
  borderRadius: 4,
  fontSize: '0.85rem',
  marginTop: '0.5rem',
};

const ruleCreationWarningStyle: React.CSSProperties = {
  background: '#fff8e1',
  color: '#e65100',
  padding: '0.5rem 0.75rem',
  borderRadius: 4,
  fontSize: '0.85rem',
  marginTop: '0.5rem',
};

// ── Request Details Side Panel Styles ──

const sidePanelStyle: React.CSSProperties = {
  width: 320,
  flexShrink: 0,
  background: '#f8f9fa',
  border: '1px solid #e0e0e0',
  borderRadius: 8,
  padding: '1rem 1.25rem',
  alignSelf: 'flex-start',
  position: 'sticky',
  top: '1rem',
  maxHeight: 'calc(100vh - 2rem)',
  overflowY: 'auto',
};

const sidePanelLabelStyle: React.CSSProperties = {
  margin: '0 0 0.25rem',
  fontSize: '0.75rem',
  fontWeight: 600,
  color: '#888',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const sidePanelTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.9rem',
  color: '#333',
  lineHeight: 1.4,
};

const sidePanelNoteStyle: React.CSSProperties = {
  padding: '0.5rem 0.6rem',
  background: '#fff',
  borderRadius: 6,
  border: '1px solid #eee',
};
