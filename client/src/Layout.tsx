import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useEffect, useState } from 'react';

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

export default function Layout() {
  const { user, logout } = useAuth();
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

  const navItems = activeTab === 'social' ? socialNavItems : quotesNavItems;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Top-level tab bar */}
      <div style={{ display: 'flex', background: '#0f0f23', borderBottom: '2px solid #1a1a2e' }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabClick(tab.id)}
            style={{
              padding: '0.75rem 1.5rem',
              background: activeTab === tab.id ? '#1a1a2e' : 'transparent',
              color: activeTab === tab.id ? '#4fc3f7' : '#888',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid #4fc3f7' : '2px solid transparent',
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
        <nav style={{ width: 220, background: '#1a1a2e', color: '#fff', padding: '1rem', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '2rem' }}>Chicago Reno</div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, flex: 1 }}>
            {navItems.map((item) => (
              <li key={item.to} style={{ marginBottom: '0.5rem' }}>
                <NavLink
                  to={item.to}
                  style={({ isActive }) => ({
                    color: isActive ? '#4fc3f7' : '#ccc',
                    textDecoration: 'none',
                    display: 'block',
                    padding: '0.5rem 0.75rem',
                    borderRadius: 4,
                    background: isActive ? 'rgba(79,195,247,0.1)' : 'transparent',
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
