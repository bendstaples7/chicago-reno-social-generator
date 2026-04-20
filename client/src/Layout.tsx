import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useEffect, useState } from 'react';
import { API_BASE } from './api';

const TAB_STORAGE_KEY = 'app_active_tab';

type TabId = 'social' | 'quotes';

const tabs: { id: TabId; label: string; path: string }[] = [
  { id: 'social', label: 'Social Media', path: '/social/dashboard' },
  { id: 'quotes', label: 'Quotes', path: '/quotes' },
];

const socialNavItems = [
  { to: '/social/dashboard', label: 'Dashboard' },
  { to: '/social/posts/quick', label: 'Quick Post' },
  { to: '/social/media', label: 'Media Library' },
  { to: '/social/settings', label: 'Settings' },
  { to: '/social/activity-log', label: 'Activity Log' },
];

const quotesNavItems = [
  { to: '/quotes', label: 'New Quote' },
  { to: '/quotes/drafts', label: 'Saved Drafts' },
  { to: '/quotes/rules', label: 'Rules' },
  { to: '/quotes/catalog', label: 'Catalog & Templates' },
];

function getActiveTab(pathname: string): TabId {
  if (pathname.startsWith('/quotes')) return 'quotes';
  return 'social';
}

function getStoredTab(): TabId {
  try {
    const stored = localStorage.getItem(TAB_STORAGE_KEY);
    if (stored === 'social' || stored === 'quotes') return stored;
  } catch {
    // localStorage unavailable
  }
  return 'social';
}

function storeTab(tab: TabId) {
  try {
    localStorage.setItem(TAB_STORAGE_KEY, tab);
  } catch {
    // localStorage unavailable
  }
}

function SystemsCheckOverlay({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: '#f5f5f5',
    }}>
      <div style={{
        background: '#fff', borderRadius: 8, padding: '2.5rem',
        maxWidth: 480, width: '100%', textAlign: 'center',
        boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
      }}>
        {children}
      </div>
    </div>
  );
}

function InstagramBanner({ instagram, onSkip, onSettings }: {
  instagram: { status: 'expired' | 'not_connected'; accountName?: string };
  onSkip: () => void;
  onSettings: () => void;
}) {
  const message = instagram.status === 'expired'
    ? `Your Instagram connection${instagram.accountName ? ` (${instagram.accountName})` : ''} has expired.`
    : 'Instagram is not connected.';

  return (
    <div role="alert" style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: '1rem', padding: '0.75rem 1.25rem',
      background: '#fff3cd', borderBottom: '1px solid #ffc107',
      color: '#856404', fontSize: '0.9rem',
    }}>
      <span>{message} Connect Instagram in Settings for full functionality.</span>
      <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
        <button
          onClick={onSettings}
          style={{
            background: '#ffc107', color: '#856404', border: 'none',
            padding: '0.35rem 0.75rem', borderRadius: 4, cursor: 'pointer',
            fontWeight: 600, fontSize: '0.85rem',
          }}
        >
          Settings
        </button>
        <button
          onClick={onSkip}
          style={{
            background: 'transparent', color: '#856404', border: '1px solid #c9a800',
            padding: '0.35rem 0.75rem', borderRadius: 4, cursor: 'pointer',
            fontSize: '0.85rem',
          }}
        >
          Skip
        </button>
      </div>
    </div>
  );
}

export default function Layout() {
  const { user, logout, systemsStatus, recheckSystems, skipInstagram, skipJobberSession } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = getActiveTab(location.pathname);
  const [lastSocialPath, setLastSocialPath] = useState('/social/dashboard');
  const [lastQuotesPath, setLastQuotesPath] = useState('/quotes');

  // Track the last visited path within each section for state preservation
  useEffect(() => {
    if (location.pathname.startsWith('/social')) {
      setLastSocialPath(location.pathname);
    } else if (location.pathname.startsWith('/quotes')) {
      setLastQuotesPath(location.pathname);
    }
  }, [location.pathname]);

  // Persist active tab to localStorage
  useEffect(() => {
    storeTab(activeTab);
  }, [activeTab]);

  const handleTabClick = (tab: TabId) => {
    if (tab === activeTab) return;
    const targetPath = tab === 'social' ? lastSocialPath : lastQuotesPath;
    navigate(targetPath);
  };

  // Systems check states — render before the normal shell
  if (systemsStatus.state === 'checking') {
    return (
      <SystemsCheckOverlay>
        <div
          aria-label="Verifying connections"
          style={{
            width: 40, height: 40, border: '4px solid #e0e0e0',
            borderTop: '4px solid #00a89d', borderRadius: '50%',
            animation: 'spin 0.8s linear infinite', margin: '0 auto 1rem',
          }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <p style={{ color: '#555', margin: 0 }}>Verifying external connections…</p>
      </SystemsCheckOverlay>
    );
  }

  if (systemsStatus.state === 'jobber_unavailable') {
    return (
      <SystemsCheckOverlay>
        <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>🔗</div>
        <h2 style={{ margin: '0 0 0.75rem', color: '#333' }}>Connect Jobber</h2>
        <p style={{ color: '#666', marginBottom: '1.5rem', lineHeight: 1.5 }}>
          Jobber is required for quote generation and customer request management.
          Connect your Jobber account to continue.
        </p>
        <a
          href={`${API_BASE}/api/jobber-auth/authorize`}
          style={{
            display: 'inline-block', background: '#00a89d', color: '#fff',
            padding: '0.65rem 1.5rem', borderRadius: 6, textDecoration: 'none',
            fontWeight: 600, fontSize: '0.95rem',
          }}
        >
          Connect Jobber
        </a>
      </SystemsCheckOverlay>
    );
  }

  if (systemsStatus.state === 'error') {
    return (
      <SystemsCheckOverlay>
        <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>⚠️</div>
        <h2 style={{ margin: '0 0 0.75rem', color: '#333' }}>Connection Error</h2>
        <p style={{ color: '#666', marginBottom: '1.5rem', lineHeight: 1.5 }}>
          {systemsStatus.message}
        </p>
        <button
          onClick={recheckSystems}
          style={{
            background: '#00a89d', color: '#fff', border: 'none',
            padding: '0.65rem 1.5rem', borderRadius: 6, cursor: 'pointer',
            fontWeight: 600, fontSize: '0.95rem',
          }}
        >
          Retry
        </button>
      </SystemsCheckOverlay>
    );
  }

  const navItems = activeTab === 'social' ? socialNavItems : quotesNavItems;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Jobber session warning banner — non-blocking, shown when cookies expired/missing */}
      {systemsStatus.state === 'jobber_session_expired' && (
        <div role="alert" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '1rem', padding: '0.75rem 1.25rem',
          background: '#fff3cd', borderBottom: '1px solid #ffc107',
          color: '#856404', fontSize: '0.9rem',
        }}>
          <span>Jobber session cookies expired. Some request details may be incomplete.</span>
          <button
            onClick={skipJobberSession}
            style={{
              background: 'transparent', color: '#856404', border: '1px solid #c9a800',
              padding: '0.35rem 0.75rem', borderRadius: 4, cursor: 'pointer',
              fontSize: '0.85rem', flexShrink: 0,
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Instagram warning banner — shown above the tab bar when instagram_issue */}
      {systemsStatus.state === 'instagram_issue' && (
        <InstagramBanner
          instagram={systemsStatus.instagram}
          onSkip={skipInstagram}
          onSettings={() => navigate('/social/settings')}
        />
      )}

      {/* Top-level tab bar */}
      <div style={{ display: 'flex', background: '#061216', borderBottom: '2px solid #0a1e24' }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabClick(tab.id)}
            style={{
              padding: '0.75rem 1.5rem',
              background: activeTab === tab.id ? '#0a1e24' : 'transparent',
              color: activeTab === tab.id ? '#00a89d' : '#888',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid #00a89d' : '2px solid transparent',
              cursor: 'pointer',
              fontWeight: activeTab === tab.id ? 700 : 400,
              fontSize: '0.95rem',
              transition: 'color 0.15s, background 0.15s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Sidebar + content area */}
      <div style={{ display: 'flex', flex: 1 }}>
        <nav style={{ width: 220, background: '#0a1e24', color: '#fff', padding: '1rem', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '2rem' }}>Chicago Reno</div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, flex: 1 }}>
            {navItems.map((item) => (
              <li key={item.to} style={{ marginBottom: '0.5rem' }}>
                <NavLink
                  to={item.to}
                  style={({ isActive }) => ({
                    color: isActive ? '#00a89d' : '#ccc',
                    textDecoration: 'none',
                    display: 'block',
                    padding: '0.5rem 0.75rem',
                    borderRadius: 4,
                    background: isActive ? 'rgba(0,168,157,0.1)' : 'transparent',
                  })}
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
          <div style={{ borderTop: '1px solid #333', paddingTop: '0.75rem', fontSize: '0.85rem' }}>
            <div style={{ marginBottom: '0.5rem', color: '#aaa' }}>{user?.email}</div>
            <button
              onClick={logout}
              style={{ background: 'none', border: '1px solid #666', color: '#ccc', padding: '0.35rem 0.75rem', borderRadius: 4, cursor: 'pointer', width: '100%' }}
            >
              Log out
            </button>
          </div>
        </nav>
        <main style={{ flex: 1, padding: '1.5rem', background: '#f5f5f5' }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
