import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  ContentTypeTemplate, ContentSuggestion, MediaItem, ChannelConnection,
  ErrorResponse, ContentType, TemplateField,
} from 'shared';
import {
  fetchContentTypes, fetchContentAdvisorSuggestion, fetchChannels,
  listMedia, createPost, updatePost, generateContent,
} from '../api';

const MAX_CAPTION = 2200;
const MAX_HASHTAGS = 30;
const MAX_CAROUSEL = 10;

const DIMENSION_RECS = [
  { label: 'Square', dims: '1080 × 1080' },
  { label: 'Portrait', dims: '1080 × 1350' },
  { label: 'Landscape', dims: '1080 × 566' },
];

export default function CreatePostPage() {
  const navigate = useNavigate();
  // Data
  const [templates, setTemplates] = useState<ContentTypeTemplate[]>([]);
  const [channels, setChannels] = useState<ChannelConnection[]>([]);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [suggestion, setSuggestion] = useState<ContentSuggestion | null>(null);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);

  // Form state
  const [selectedContentType, setSelectedContentType] = useState<ContentType | ''>('');
  const [selectedChannel, setSelectedChannel] = useState('');
  const [templateFields, setTemplateFields] = useState<Record<string, string>>({});
  const [selectedMedia, setSelectedMedia] = useState<string[]>([]);
  const [caption, setCaption] = useState('');
  const [hashtagInput, setHashtagInput] = useState('');
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [contextInput, setContextInput] = useState('');

  // UI state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [savedPostId, setSavedPostId] = useState<string | null>(null);
  const [violations, setViolations] = useState<string[]>([]);

  // Load initial data
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [typesRes, channelsRes, mediaRes, advisorRes] = await Promise.all([
        fetchContentTypes(),
        fetchChannels(),
        listMedia(1, 100),
        fetchContentAdvisorSuggestion().catch(() => ({ suggestion: null })),
      ]);
      setTemplates(typesRes.contentTypes);
      setChannels(channelsRes.channels);
      setMediaItems(mediaRes.items);
      setSuggestion(advisorRes.suggestion);
      if (channelsRes.channels.length > 0) {
        setSelectedChannel(channelsRes.channels[0].id);
      }
    } catch (err) {
      setError((err as ErrorResponse).message ?? 'Failed to load data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Current template
  const currentTemplate = templates.find(
    (t) => t.contentType === selectedContentType,
  );

  // Accept advisor suggestion
  const acceptSuggestion = () => {
    if (suggestion) {
      handleContentTypeChange(suggestion.contentType);
      setSuggestionDismissed(true);
    }
  };

  // Content type change
  const handleContentTypeChange = (ct: ContentType | '') => {
    setSelectedContentType(ct);
    setTemplateFields({});
  };

  // Template field change
  const handleFieldChange = (name: string, value: string) => {
    setTemplateFields((prev) => ({ ...prev, [name]: value }));
  };

  // Media toggle
  const toggleMedia = (id: string) => {
    setSelectedMedia((prev) => {
      if (prev.includes(id)) return prev.filter((m) => m !== id);
      if (prev.length >= MAX_CAROUSEL) return prev;
      return [...prev, id];
    });
  };

  // Add hashtag
  const addHashtag = () => {
    const tag = hashtagInput.trim().replace(/^#/, '');
    if (!tag) return;
    if (hashtags.length >= MAX_HASHTAGS) return;
    if (!hashtags.includes(tag)) {
      setHashtags((prev) => [...prev, tag]);
    }
    setHashtagInput('');
  };

  const removeHashtag = (tag: string) => {
    setHashtags((prev) => prev.filter((h) => h !== tag));
  };

  // Validate
  const validate = useCallback((): string[] => {
    const v: string[] = [];
    if (caption.length > MAX_CAPTION) v.push(`Caption exceeds ${MAX_CAPTION} characters (${caption.length})`);
    if (hashtags.length > MAX_HASHTAGS) v.push(`Too many hashtags (${hashtags.length}/${MAX_HASHTAGS})`);
    if (selectedMedia.length > MAX_CAROUSEL) v.push(`Too many media items (${selectedMedia.length}/${MAX_CAROUSEL})`);
    if (!selectedContentType) v.push('Content type is required');
    if (!selectedChannel) v.push('Channel is required');
    return v;
  }, [caption, hashtags, selectedMedia, selectedContentType, selectedChannel]);

  useEffect(() => {
    setViolations(validate());
  }, [validate]);

  // Save draft
  const saveDraft = async () => {
    if (!selectedContentType || !selectedChannel) return;
    try {
      setSaving(true);
      setError(null);
      const data = {
        channelConnectionId: selectedChannel,
        contentType: selectedContentType as ContentType,
        caption,
        hashtags,
        templateFields: Object.keys(templateFields).length > 0 ? templateFields : undefined,
        mediaItemIds: selectedMedia.length > 0 ? selectedMedia : undefined,
      };
      if (savedPostId) {
        await updatePost(savedPostId, data);
      } else {
        const post = await createPost(data);
        setSavedPostId(post.id);
        navigate(`/posts/${post.id}`);
      }
    } catch (err) {
      setError((err as ErrorResponse).message ?? 'Failed to save draft.');
    } finally {
      setSaving(false);
    }
  };

  // Submit for review
  const submitForReview = async () => {
    const v = validate();
    if (v.length > 0) {
      setError('Please fix validation issues before submitting.');
      return;
    }
    try {
      setSaving(true);
      setError(null);
      const data = {
        channelConnectionId: selectedChannel,
        contentType: selectedContentType as ContentType,
        caption,
        hashtags,
        templateFields: Object.keys(templateFields).length > 0 ? templateFields : undefined,
        mediaItemIds: selectedMedia.length > 0 ? selectedMedia : undefined,
      };
      let postId = savedPostId;
      if (postId) {
        await updatePost(postId, data);
      } else {
        const post = await createPost(data);
        postId = post.id;
        setSavedPostId(postId);
      }
      // Transition to awaiting_approval via approve endpoint
      const { approvePost: doApprove } = await import('../api');
      await doApprove(postId);
      navigate(`/posts/${postId}`);
    } catch (err) {
      setError((err as ErrorResponse).message ?? 'Failed to submit for review.');
    } finally {
      setSaving(false);
    }
  };

  // Generate content
  const handleGenerate = async () => {
    if (!savedPostId) {
      // Need to save first
      if (!selectedContentType || !selectedChannel) {
        setError('Select a content type and channel before generating.');
        return;
      }
      try {
        setSaving(true);
        const post = await createPost({
          channelConnectionId: selectedChannel,
          contentType: selectedContentType as ContentType,
          caption: caption || '',
          hashtags,
          templateFields: Object.keys(templateFields).length > 0 ? templateFields : undefined,
          mediaItemIds: selectedMedia.length > 0 ? selectedMedia : undefined,
        });
        setSavedPostId(post.id);
        setSaving(false);
        // Now generate
        setGenerating(true);
        const result = await generateContent(post.id, {
          context: contextInput || undefined,
          templateFields: Object.keys(templateFields).length > 0 ? templateFields : undefined,
        });
        setCaption(result.caption);
        setHashtags(result.hashtags);
      } catch (err) {
        setError((err as ErrorResponse).message ?? 'Failed to generate content.');
      } finally {
        setSaving(false);
        setGenerating(false);
      }
      return;
    }
    try {
      setGenerating(true);
      setError(null);
      // Update post first with current fields
      await updatePost(savedPostId, {
        contentType: selectedContentType as ContentType,
        templateFields: Object.keys(templateFields).length > 0 ? templateFields : undefined,
        mediaItemIds: selectedMedia.length > 0 ? selectedMedia : undefined,
      });
      const result = await generateContent(savedPostId, {
        context: contextInput || undefined,
        templateFields: Object.keys(templateFields).length > 0 ? templateFields : undefined,
      });
      setCaption(result.caption);
      setHashtags(result.hashtags);
    } catch (err) {
      setError((err as ErrorResponse).message ?? 'Content generation failed.');
    } finally {
      setGenerating(false);
    }
  };

  // Selected media items for preview
  const previewMedia = mediaItems.filter((m) => selectedMedia.includes(m.id));

  if (loading) return <p>Loading…</p>;

  return (
    <div>
      <h1 style={{ margin: '0 0 1rem' }}>Create Post</h1>

      {error && <div role="alert" style={alertStyle}>{error}</div>}

      {/* Content Advisor Suggestion Banner */}
      {suggestion && !suggestionDismissed && (
        <div style={suggestionBannerStyle}>
          <div style={{ flex: 1 }}>
            <strong>Content Advisor Suggestion:</strong>{' '}
            {suggestion.contentType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
            <span style={{ color: '#666', marginLeft: '0.5rem' }}>— {suggestion.reason}</span>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={acceptSuggestion} style={btnStyle}>Accept</button>
            <button onClick={() => setSuggestionDismissed(true)} style={btnOutlineStyle}>Dismiss</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
        {/* Left column: Form */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Channel selector */}
          <label style={labelStyle}>
            Channel
            <select
              value={selectedChannel}
              onChange={(e) => setSelectedChannel(e.target.value)}
              style={inputStyle}
            >
              <option value="">Select channel…</option>
              {channels.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {ch.externalAccountName} ({ch.channelType})
                </option>
              ))}
            </select>
            {!selectedChannel && <span style={inlineErrorStyle}>Channel is required</span>}
          </label>

          {/* Content Type Selector */}
          <label style={labelStyle}>
            Content Type
            <select
              value={selectedContentType}
              onChange={(e) => handleContentTypeChange(e.target.value as ContentType | '')}
              style={inputStyle}
            >
              <option value="">Select content type…</option>
              {templates.map((t) => (
                <option key={t.contentType} value={t.contentType}>
                  {t.displayName}
                </option>
              ))}
            </select>
            {!selectedContentType && <span style={inlineErrorStyle}>Content type is required</span>}
          </label>

          {/* Template description & guidance */}
          {currentTemplate && (
            <div style={templateInfoStyle}>
              <p style={{ margin: '0 0 0.25rem', fontWeight: 500 }}>{currentTemplate.displayName}</p>
              <p style={{ margin: '0 0 0.5rem', color: '#666', fontSize: '0.85rem' }}>{currentTemplate.description}</p>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#888' }}>
                Layout: {currentTemplate.layoutGuidance.captionStructure} · Suggested media: {currentTemplate.layoutGuidance.suggestedMediaCount}
              </p>
            </div>
          )}

          {/* Template Fields */}
          {currentTemplate && currentTemplate.fields.map((field: TemplateField) => (
            <label key={field.name} style={labelStyle}>
              {field.label}{field.required && <span style={{ color: '#d32f2f' }}> *</span>}
              {field.type === 'textarea' ? (
                <textarea
                  value={templateFields[field.name] ?? ''}
                  onChange={(e) => handleFieldChange(field.name, e.target.value)}
                  placeholder={field.placeholder}
                  rows={3}
                  style={inputStyle}
                />
              ) : field.type === 'boolean' ? (
                <div style={{ marginTop: '0.25rem' }}>
                  <input
                    type="checkbox"
                    checked={templateFields[field.name] === 'true'}
                    onChange={(e) => handleFieldChange(field.name, String(e.target.checked))}
                  />
                </div>
              ) : field.type === 'date' ? (
                <input
                  type="date"
                  value={templateFields[field.name] ?? ''}
                  onChange={(e) => handleFieldChange(field.name, e.target.value)}
                  style={inputStyle}
                />
              ) : (
                <input
                  type="text"
                  value={templateFields[field.name] ?? ''}
                  onChange={(e) => handleFieldChange(field.name, e.target.value)}
                  placeholder={field.placeholder}
                  style={inputStyle}
                />
              )}
            </label>
          ))}

          {/* Context for generation */}
          <label style={labelStyle}>
            Additional Context (optional)
            <textarea
              value={contextInput}
              onChange={(e) => setContextInput(e.target.value)}
              placeholder="Any extra context for AI content generation…"
              rows={2}
              style={inputStyle}
            />
          </label>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={generating || !selectedContentType}
            style={{ ...btnStyle, marginBottom: '1rem', background: generating ? '#999' : '#7c4dff', borderColor: generating ? '#999' : '#7c4dff' }}
          >
            {generating ? 'Generating…' : 'Generate Content'}
          </button>

          {/* Media Picker */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span style={{ fontWeight: 500, fontSize: '0.9rem' }}>
                Media ({selectedMedia.length}/{MAX_CAROUSEL})
              </span>
              {selectedMedia.length >= MAX_CAROUSEL && (
                <span style={inlineErrorStyle}>Maximum {MAX_CAROUSEL} items</span>
              )}
            </div>
            {mediaItems.length === 0 ? (
              <p style={{ color: '#888', fontSize: '0.85rem' }}>No media in library. Upload media first.</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: '0.5rem' }}>
                {mediaItems.map((item) => {
                  const isSelected = selectedMedia.includes(item.id);
                  return (
                    <div
                      key={item.id}
                      onClick={() => toggleMedia(item.id)}
                      style={{
                        position: 'relative',
                        paddingTop: '100%',
                        borderRadius: 4,
                        overflow: 'hidden',
                        cursor: 'pointer',
                        border: isSelected ? '3px solid #1976d2' : '2px solid transparent',
                        boxSizing: 'border-box',
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`${isSelected ? 'Deselect' : 'Select'} ${item.filename}`}
                      aria-pressed={isSelected}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleMedia(item.id); } }}
                    >
                      <img
                        src={item.thumbnailUrl}
                        alt={item.filename}
                        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                        loading="lazy"
                      />
                      {isSelected && (
                        <div style={{
                          position: 'absolute', top: 4, right: 4, background: '#1976d2', color: '#fff',
                          borderRadius: '50%', width: 20, height: 20, display: 'flex', alignItems: 'center',
                          justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700,
                        }}>
                          {selectedMedia.indexOf(item.id) + 1}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Caption Editor */}
          <label style={labelStyle}>
            <span style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Caption</span>
              <span style={{ fontSize: '0.8rem', color: caption.length > MAX_CAPTION ? '#d32f2f' : '#888' }}>
                {caption.length}/{MAX_CAPTION}
              </span>
            </span>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={6}
              style={{
                ...inputStyle,
                borderColor: caption.length > MAX_CAPTION ? '#d32f2f' : '#ccc',
              }}
              placeholder="Write your caption or generate one…"
            />
            {caption.length > MAX_CAPTION && (
              <span style={inlineErrorStyle}>Caption exceeds {MAX_CAPTION} character limit</span>
            )}
          </label>

          {/* Hashtag Editor */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
              <span style={{ fontWeight: 500, fontSize: '0.9rem' }}>Hashtags</span>
              <span style={{ fontSize: '0.8rem', color: hashtags.length > MAX_HASHTAGS ? '#d32f2f' : '#888' }}>
                {hashtags.length}/{MAX_HASHTAGS}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <input
                type="text"
                value={hashtagInput}
                onChange={(e) => setHashtagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addHashtag(); } }}
                placeholder="Add hashtag…"
                style={{ ...inputStyle, flex: 1, marginTop: 0 }}
              />
              <button onClick={addHashtag} disabled={hashtags.length >= MAX_HASHTAGS} style={btnOutlineStyle}>Add</button>
            </div>
            {hashtags.length > MAX_HASHTAGS && (
              <span style={inlineErrorStyle}>Too many hashtags (max {MAX_HASHTAGS})</span>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
              {hashtags.map((tag) => (
                <span key={tag} style={hashtagChipStyle}>
                  #{tag}
                  <button
                    onClick={() => removeHashtag(tag)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', marginLeft: 4, color: '#666', fontWeight: 700, fontSize: '0.8rem' }}
                    aria-label={`Remove hashtag ${tag}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Violations */}
          {violations.length > 0 && (
            <div style={{ ...alertStyle, background: '#fff3e0', color: '#e65100', marginBottom: '1rem' }}>
              <strong>Validation issues:</strong>
              <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.25rem' }}>
                {violations.map((v, i) => <li key={i}>{v}</li>)}
              </ul>
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button onClick={saveDraft} disabled={saving || !selectedContentType || !selectedChannel} style={btnOutlineStyle}>
              {saving ? 'Saving…' : 'Save as Draft'}
            </button>
            <button
              onClick={submitForReview}
              disabled={saving || violations.length > 0}
              style={{ ...btnStyle, opacity: violations.length > 0 ? 0.5 : 1 }}
            >
              {saving ? 'Submitting…' : 'Submit for Review'}
            </button>
          </div>
        </div>

        {/* Right column: Instagram Preview */}
        <div style={{ width: 340, flexShrink: 0 }}>
          <div style={previewPanelStyle}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem' }}>Instagram Preview</h3>

            {/* Dimension recommendations */}
            <div style={{ marginBottom: '0.75rem', fontSize: '0.8rem', color: '#666' }}>
              <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>Recommended Dimensions:</div>
              {DIMENSION_RECS.map((d) => (
                <div key={d.label}>{d.label}: {d.dims}</div>
              ))}
            </div>

            {/* Preview card */}
            <div style={previewCardStyle}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', padding: '0.5rem', gap: '0.5rem' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#1a1a2e' }} />
                <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>chicago_reno</span>
              </div>

              {/* Media preview */}
              <div style={{ background: '#e0e0e0', aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {previewMedia.length > 0 ? (
                  <img
                    src={previewMedia[0].thumbnailUrl}
                    alt="Preview"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <span style={{ color: '#999', fontSize: '0.85rem' }}>No media selected</span>
                )}
              </div>
              {previewMedia.length > 1 && (
                <div style={{ textAlign: 'center', fontSize: '0.75rem', color: '#888', padding: '0.25rem' }}>
                  +{previewMedia.length - 1} more {previewMedia.length - 1 === 1 ? 'image' : 'images'}
                </div>
              )}

              {/* Caption preview */}
              <div style={{ padding: '0.5rem', fontSize: '0.8rem' }}>
                <span style={{ fontWeight: 600 }}>chicago_reno </span>
                <span>{caption || 'Your caption will appear here…'}</span>
              </div>

              {/* Hashtags preview */}
              {hashtags.length > 0 && (
                <div style={{ padding: '0 0.5rem 0.5rem', fontSize: '0.8rem', color: '#00376b' }}>
                  {hashtags.map((t) => `#${t}`).join(' ')}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Styles ──

const btnStyle: React.CSSProperties = {
  padding: '0.5rem 1rem',
  border: '1px solid #1976d2',
  background: '#1976d2',
  color: '#fff',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: '0.9rem',
};

const btnOutlineStyle: React.CSSProperties = {
  padding: '0.5rem 1rem',
  border: '1px solid #1976d2',
  background: 'transparent',
  color: '#1976d2',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: '0.9rem',
};

const alertStyle: React.CSSProperties = {
  background: '#fdecea',
  color: '#611a15',
  padding: '0.75rem 1rem',
  borderRadius: 4,
  marginBottom: '1rem',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: '0.75rem',
  fontSize: '0.9rem',
  fontWeight: 500,
};

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: '0.25rem',
  padding: '0.5rem',
  border: '1px solid #ccc',
  borderRadius: 4,
  fontSize: '0.9rem',
  boxSizing: 'border-box',
};

const inlineErrorStyle: React.CSSProperties = {
  display: 'block',
  color: '#d32f2f',
  fontSize: '0.8rem',
  marginTop: '0.2rem',
};

const suggestionBannerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '1rem',
  background: '#e8f5e9',
  border: '1px solid #a5d6a7',
  borderRadius: 6,
  padding: '0.75rem 1rem',
  marginBottom: '1rem',
};

const templateInfoStyle: React.CSSProperties = {
  background: '#f5f5f5',
  border: '1px solid #e0e0e0',
  borderRadius: 6,
  padding: '0.75rem',
  marginBottom: '0.75rem',
};

const hashtagChipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  background: '#e3f2fd',
  color: '#1565c0',
  padding: '0.2rem 0.5rem',
  borderRadius: 12,
  fontSize: '0.8rem',
};

const previewPanelStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e0e0e0',
  borderRadius: 8,
  padding: '1rem',
  position: 'sticky',
  top: '1.5rem',
};

const previewCardStyle: React.CSSProperties = {
  border: '1px solid #dbdbdb',
  borderRadius: 6,
  overflow: 'hidden',
  background: '#fff',
};
