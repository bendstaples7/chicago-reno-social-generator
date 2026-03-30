import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext';

const navItems = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/posts/quick', label: 'Quick Post' },
  { to: '/media', label: 'Media Library' },
  { to: '/settings', label: 'Settings' },
  { to: '/activity-log', label: 'Activity Log' },
];

export default function Layout() {
  const { user, logout } = useAuth();

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
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
  );
}
