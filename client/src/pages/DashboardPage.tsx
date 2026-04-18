import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { fetchPosts, fetchChannels, syncInstagramPosts } from '../api';
import type { Post, ChannelConnection } from 'shared';

const cardStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 8,
  padding: '1.5rem',
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  cursor: 'pointer',
  transition: 'box-shadow 0.15s',
};

const statBox: React.CSSProperties = {
  background: '#fff',
  borderRadius: 8,
  padding: '1.25rem',
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  textAlign: 'center',
};

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [posts, setPosts] = useState<Post[]>([]);
  const [channels, setChannels] = useState<ChannelConnection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchPosts().then((r) => setPosts(r.posts)).catch(() => {}),
      fetchChannels().then((r) => setChannels(r.channels)).catch(() => {}),
    ]).finally(() => setLoading(false));
    // Fire-and-forget Instagram sync — non-blocking, cooldown-protected
    syncInstagramPosts().catch(() => {});
  }, []);

  const drafts = posts.filter((p) => p.status === 'draft');
  const published = posts.filter((p) => p.status === 'published');
  const failed = posts.filter((p) => p.status === 'failed');
  const awaiting = posts.filter((p) => p.status === 'awaiting_approval');
  const connected = channels.filter((c) => c.status === 'connected');

  const actions = [
    {
      title: '⚡ Quick Post',
      desc: 'Create a post in under 60 seconds with smart defaults',
      color: '#00a89d',
      onClick: () => navigate('/social/posts/quick'),
    },
    {
      title: '🖼️ Media Library',
      desc: 'Upload photos, generate AI images, and manage your media',
      color: '#ffb74d',
      onClick: () => navigate('/social/media'),
    },
    {
      title: '⚙️ Settings',
      desc: 'Content Advisor mode, Instagram connection, and approval settings',
      color: '#ce93d8',
      onClick: () => navigate('/social/settings'),
    },
  ];

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <h1 style={{ marginBottom: '0.25rem' }}>Dashboard</h1>
      <p style={{ color: '#666', marginTop: 0, marginBottom: '1.5rem' }}>
        Welcome back, {user?.name ?? 'team member'}.
      </p>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        <div style={statBox}>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0a1e24' }}>{loading ? '–' : posts.length}</div>
          <div style={{ fontSize: '0.85rem', color: '#888' }}>Total Posts</div>
        </div>
        <div style={statBox}>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#ff9800' }}>{loading ? '–' : drafts.length}</div>
          <div style={{ fontSize: '0.85rem', color: '#888' }}>Drafts</div>
        </div>
        <div style={statBox}>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#2196f3' }}>{loading ? '–' : awaiting.length}</div>
          <div style={{ fontSize: '0.85rem', color: '#888' }}>Awaiting Review</div>
        </div>
        <div style={statBox}>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#4caf50' }}>{loading ? '–' : published.length}</div>
          <div style={{ fontSize: '0.85rem', color: '#888' }}>Published</div>
        </div>
        <div style={statBox}>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#f44336' }}>{loading ? '–' : failed.length}</div>
          <div style={{ fontSize: '0.85rem', color: '#888' }}>Failed</div>
        </div>
      </div>

      {/* Channel status */}
      {!loading && connected.length === 0 && (
        <div style={{ background: '#fff3e0', border: '1px solid #ffe0b2', borderRadius: 8, padding: '1rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '1.25rem' }}>📡</span>
          <div>
            <strong>{channels.some((c) => c.status === 'expired') ? 'Instagram token expired.' : 'No channels connected.'}</strong>{' '}
            <span style={{ color: '#666' }}>
              Head to{' '}
              <a href="/social/settings" onClick={(e) => { e.preventDefault(); navigate('/social/settings'); }} style={{ color: '#e65100' }}>
                Settings
              </a>{' '}
              to {channels.some((c) => c.status === 'expired') ? 'reconnect' : 'connect'} your Instagram account before publishing.
            </span>
          </div>
        </div>
      )}

      {/* Action cards */}
      <h2 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: '#333' }}>Quick Actions</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        {actions.map((a) => (
          <div
            key={a.title}
            role="button"
            tabIndex={0}
            style={{ ...cardStyle, borderLeft: `4px solid ${a.color}` }}
            onClick={a.onClick}
            onKeyDown={(e) => e.key === 'Enter' && a.onClick()}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)'; }}
          >
            <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.35rem' }}>{a.title}</div>
            <div style={{ fontSize: '0.9rem', color: '#666' }}>{a.desc}</div>
          </div>
        ))}
      </div>

      {/* Recent posts */}
      <h2 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: '#333' }}>Recent Posts</h2>
      {loading ? (
        <p style={{ color: '#999' }}>Loading...</p>
      ) : posts.length === 0 ? (
        <div style={{ ...cardStyle, cursor: 'default', textAlign: 'center', color: '#999', padding: '2rem' }}>
          No posts yet. Create your first post to get started.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {posts.slice(0, 5).map((p) => (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              style={cardStyle}
              onClick={() => navigate(`/social/posts/${p.id}`)}
              onKeyDown={(e) => e.key === 'Enter' && navigate(`/social/posts/${p.id}`)}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)'; }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontWeight: 600 }}>{p.contentType.replace('_', ' ')}</span>
                  <span style={{ color: '#999', marginLeft: '0.75rem', fontSize: '0.85rem' }}>
                    {new Date(p.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <StatusBadge status={p.status} />
              </div>
              {p.caption && (
                <div style={{ color: '#555', fontSize: '0.9rem', marginTop: '0.35rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 600 }}>
                  {p.caption}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const statusColors: Record<string, { bg: string; fg: string }> = {
  draft: { bg: '#fff3e0', fg: '#e65100' },
  awaiting_approval: { bg: '#e0f7f5', fg: '#00a89d' },
  approved: { bg: '#e0f7f5', fg: '#00a89d' },
  publishing: { bg: '#e0f7f5', fg: '#00a89d' },
  published: { bg: '#e0f7f5', fg: '#00a89d' },
  failed: { bg: '#ffebee', fg: '#c62828' },
};

function StatusBadge({ status }: { status: string }) {
  const c = statusColors[status] ?? { bg: '#eee', fg: '#333' };
  return (
    <span style={{ background: c.bg, color: c.fg, padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.8rem', fontWeight: 500 }}>
      {status.replace('_', ' ')}
    </span>
  );
}
