import { Link, useLocation } from 'react-router-dom';
import { useStore } from '../store';

export function Navigation() {
  const location = useLocation();
  const { state } = useStore();

  const navItems = [
    { path: '/', label: 'Dashboard' },
    { path: '/prompts', label: 'Prompts' },
    { path: '/runs', label: 'Runs' },
    { path: '/test-sets', label: 'Test Sets' },
    { path: '/api-config', label: 'API Config' },
  ];

  return (
    <nav style={styles.nav}>
      <div style={styles.navBrand}>
        <Link to="/" style={styles.brandLink}>
          PromptSentry Workbench
        </Link>
      </div>
      <div style={styles.navLinks}>
        {navItems.map(item => (
          <Link
            key={item.path}
            to={item.path}
            style={{
              ...styles.navLink,
              ...(location.pathname === item.path ||
              (item.path !== '/' && location.pathname.startsWith(item.path))
                ? styles.navLinkActive
                : {}),
            }}
          >
            {item.label}
          </Link>
        ))}
      </div>
      <div style={styles.navStatus}>
        {state.prompts.length > 0 && (
          <span style={styles.badge}>{state.prompts.length} prompt{state.prompts.length !== 1 ? 's' : ''}</span>
        )}
      </div>
    </nav>
  );
}

const styles: Record<string, React.CSSProperties> = {
  nav: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 24px',
    backgroundColor: '#1a1a2e',
    color: '#e0e0e0',
    borderBottom: '1px solid #2d2d44',
  },
  navBrand: {
    fontSize: '18px',
    fontWeight: 700,
  },
  brandLink: {
    color: '#e0e0e0',
    textDecoration: 'none',
  },
  navLinks: {
    display: 'flex',
    gap: '8px',
  },
  navLink: {
    color: '#a0a0b0',
    textDecoration: 'none',
    padding: '6px 12px',
    borderRadius: '4px',
    fontSize: '14px',
    transition: 'background-color 0.2s, color 0.2s',
  },
  navLinkActive: {
    color: '#ffffff',
    backgroundColor: '#3d3d5c',
  },
  navStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  badge: {
    backgroundColor: '#4a9eff',
    color: '#ffffff',
    padding: '2px 8px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: 600,
  },
};
