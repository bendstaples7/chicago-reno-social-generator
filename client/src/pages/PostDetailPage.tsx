import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Post, PostStatus, ErrorResponse, PublishResult } from 'shared';
import { fetchPost, approvePost, publishPost } from '../api';

const STATUS_CONFIG: Record<PostStatus, { label: string; bg: string; color: string; icon: string }> = {
  draft: { label: 'Draft', bg: '#e0e0e0', color: '#424242', icon: '📝' },
  awaiting_approval: { label: 'Awaiting Approval', bg: '#fff3e0', color: '#e65100', icon: '⏳' },
  approved: { label: 'Approved', bg: '#e0f7f5', color: '#00a89d', icon: '✅' },
  publishing: { label: 'Publishing…', bg: '#e0f7f5', color: '#00a89d', icon: '🔄' },
  published: { label: 'Published', bg: '#e0f7f5', color: '#00897b', icon: '✅' },
  failed: { label: 'Failed', bg: '#fdecea', color: '#611a15', icon: '❌' },
};

export default function PostDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);

  const loadPost = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const p = await fetchPost(id);
      setPost(p);
    } catch (err) {
      setError((err as ErrorResponse).message ?? 'Failed to load post.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadPost(); }, [loadPost]);

  const handleApprove = async () => {
    if (!post) return;
    try {
      setActionLoading(true);
      setError(null);
      await approvePost(post.id);
      await loadPost();
    } catch (err) {
      setError((err as ErrorResponse).message ?? 'Failed to approve post.');
    } finally {
      setActionLoading(false);
    }
  };

  const handlePublish = async () => {
    if (!post) return;
    try {
      setActionLoading(true);
      setError(null);
      setPublishResult(null);
      const result = await publishPost(post.id);
      setPublishResult(result);
      await loadPost();
    } catch (err) {
      setError((err as ErrorResponse).message ?? 'Publishing failed.');
      await loadPost();
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) return <p>Loading post…</p>;
  if (!post) return <p>{error ?? 'Post not found.'}</p>;

  const hashtags: string[] = (() => {
    try { return JSON.parse(post.hashtagsJson); } catch { return []; }
  })();

  const statusCfg = STATUS_CONFIG[post.status] ?? STATUS_CONFIG.draft;

  return (
    <div>
      <button onClick={() => navigate('/social/dashboard')} style={backBtnStyle}>← Back to Dashboard</button>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0 }}>Post Details</h1>
        <span style={{ ...badgeStyle, background: statusCfg.bg, color: statusCfg.color }}>
          {statusCfg.icon} {statusCfg.label}
        </span>
      </div>

      {error && <div role="alert" style={alertStyle}>{error}</div>}

      {/* Publish result feedback */}
      {publishResult && publishResult.success && (
        <div style={successStyle}>
          ✅ Post published successfully!
          {publishResult.externalPostId && (
            <span style={{ marginLeft: '0.5rem', fontSize: '0.85rem', color: '#555' }}>
              External ID: {publishResult.externalPostId}
            </span>
          )}
        </div>
      )}
      {publishResult && !publishResult.success && (
        <div style={alertStyle}>
          ❌ Publishing failed: {publishResult.error ?? 'Unknown error'}
          <button onClick={handlePublish} disabled={actionLoading} style={{ ...retryBtnStyle, marginLeft: '0.75rem' }}>
            {actionLoading ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      )}

      {/* Post content */}
      <div style={cardStyle}>
        <div style={{ marginBottom: '1rem' }}>
          <span style={fieldLabelStyle}>Content Type</span>
          <span style={{ textTransform: 'capitalize' }}>{post.contentType.replace(/_/g, ' ')}</span>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <span style={fieldLabelStyle}>Caption</span>
          <p style={{ margin: '0.25rem 0', whiteSpace: 'pre-wrap' }}>{post.caption || '(no caption)'}</p>
        </div>

        {hashtags.length > 0 && (
          <div style={{ marginBottom: '1rem' }}>
            <span style={fieldLabelStyle}>Hashtags</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.25rem' }}>
              {hashtags.map((tag: string) => (
                <span key={tag} style={hashtagChipStyle}>#{tag}</span>
              ))}
            </div>
          </div>
        )}

        {post.externalPostId && (
          <div style={{ marginBottom: '1rem' }}>
            <span style={fieldLabelStyle}>External Post ID</span>
            <span>{post.externalPostId}</span>
          </div>
        )}

        <div style={{ fontSize: '0.8rem', color: '#888' }}>
          Created: {new Date(post.createdAt).toLocaleString()}
          {post.publishedAt && <> · Published: {new Date(post.publishedAt).toLocaleString()}</>}
        </div>
      </div>

      {/* Action buttons based on status */}
      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
        {post.status === 'draft' && (
          <button onClick={handleApprove} disabled={actionLoading} style={primaryBtnStyle}>
            {actionLoading ? 'Submitting…' : 'Submit for Review'}
          </button>
        )}

        {post.status === 'awaiting_approval' && (
          <button onClick={handleApprove} disabled={actionLoading} style={primaryBtnStyle}>
            {actionLoading ? 'Approving…' : 'Approve'}
          </button>
        )}

        {post.status === 'approved' && (
          <button onClick={handlePublish} disabled={actionLoading} style={publishBtnStyle}>
            {actionLoading ? 'Publishing…' : 'Publish'}
          </button>
        )}

        {post.status === 'failed' && (
          <button onClick={handlePublish} disabled={actionLoading} style={retryBtnStyle}>
            {actionLoading ? 'Retrying…' : 'Retry Publish'}
          </button>
        )}

        {post.status === 'published' && (
          <span style={{ color: '#00a89d', fontWeight: 500 }}>
            ✅ This post has been published.
          </span>
        )}
      </div>
    </div>
  );
}

// ── Styles ──

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

const badgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.3rem',
  padding: '0.3rem 0.75rem',
  borderRadius: 16,
  fontSize: '0.85rem',
  fontWeight: 600,
};

const alertStyle: React.CSSProperties = {
  background: '#fdecea',
  color: '#611a15',
  padding: '0.75rem 1rem',
  borderRadius: 4,
  marginBottom: '1rem',
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
};

const successStyle: React.CSSProperties = {
  background: '#e0f7f5',
  color: '#00897b',
  padding: '0.75rem 1rem',
  borderRadius: 4,
  marginBottom: '1rem',
};

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e0e0e0',
  borderRadius: 8,
  padding: '1.25rem',
};

const fieldLabelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8rem',
  fontWeight: 600,
  color: '#888',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  marginBottom: '0.15rem',
};

const hashtagChipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  background: '#e0f7f5',
  color: '#00a89d',
  padding: '0.2rem 0.5rem',
  borderRadius: 12,
  fontSize: '0.8rem',
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '0.6rem 1.25rem',
  border: '1px solid #00a89d',
  background: '#00a89d',
  color: '#fff',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: '0.9rem',
  fontWeight: 500,
};

const publishBtnStyle: React.CSSProperties = {
  padding: '0.6rem 1.25rem',
  border: '1px solid #00a89d',
  background: '#00a89d',
  color: '#fff',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: '0.9rem',
  fontWeight: 500,
};

const retryBtnStyle: React.CSSProperties = {
  padding: '0.5rem 1rem',
  border: '1px solid #d32f2f',
  background: '#d32f2f',
  color: '#fff',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: '0.85rem',
  fontWeight: 500,
};
