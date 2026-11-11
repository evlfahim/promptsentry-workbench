import { Link, useLocation } from 'react-router-dom';
import { useStore } from '../store';
import { useTheme } from '../theme';
import { useState, useRef, useEffect, useCallback } from 'react';
import { usePlatformShortcuts, useToast } from '../hooks/useKeyboardShortcuts';

export function Navigation() {
  const location = useLocation();
  const { state } = useStore();
  const { mode, colors, toggle } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { ctrl, meta, shift } = usePlatformShortcuts();
  const { toast, showToast } = useToast();

  // Close mobile menu on route change or outside click
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMobileOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Close help on Escape
  useEffect(() => {
    if (!showHelp) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowHelp(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showHelp]);

  const navItems = [
    { path: '/', label: 'Dashboard' },
    { path: '/prompts', label: 'Prompts' },
    { path: '/runs', label: 'Runs' },
    { path: '/test-sets', label: 'Test Sets' },
    { path: '/api-config', label: 'API Config' },
  ];

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  const shortcuts = [
    { keys: [meta, 'N'], desc: 'New prompt' },
    { keys: [meta, 'K'], desc: 'Focus search' },
    { keys: [meta, 'T'], desc: 'Toggle theme' },
    { keys: [ctrl, 'R', shift], desc: 'Refresh data' },
    { keys: [meta, 'H'], desc: 'Show shortcuts' },
    { keys: ['Esc'], desc: 'Close modal' },
  ];

  const handleToggleTheme = useCallback(() => {
    toggle();
    showToast(mode === 'dark' ? 'Switched to light mode' : 'Switched to dark mode', 'info');
  }, [toggle, mode, showToast]);

  return (
    <>
      <nav style={{
        backgroundColor: colors.bgNav,
        borderBottom: `1px solid ${colors.bgNavBorder}`,
        position: 'sticky',
        top: 0,
        zIndex: 100,
        transition: 'background-color 0.2s, border-color 0.2s',
      }}>
        <div style={{
          maxWidth: '1200px',
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
          height: '57px',
        }}>
          {/* Brand */}
          <Link to="/" className="nav-brand-responsive" style={{
            fontSize: '18px',
            fontWeight: 700,
            color: colors.text,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}>
            PromptSentry Workbench
          </Link>

          {/* Desktop nav links */}
          <div className="nav-links-desktop" style={{
            display: 'flex',
            gap: '4px',
            alignItems: 'center',
          }}>
            {navItems.map(item => (
              <Link
                key={item.path}
                to={item.path}
                style={{
                  color: isActive(item.path) ? colors.textNavActive : colors.textNavInactive,
                  textDecoration: 'none',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: isActive(item.path) ? 600 : 500,
                  backgroundColor: isActive(item.path) ? colors.bgTertiary : 'transparent',
                  transition: 'background-color 0.15s, color 0.15s',
                }}
                onMouseEnter={e => {
                  if (!isActive(item.path)) e.currentTarget.style.backgroundColor = colors.bgTertiary;
                }}
                onMouseLeave={e => {
                  if (!isActive(item.path)) e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                {item.label}
              </Link>
            ))}
          </div>

          {/* Right side: badge + theme toggle + help + mobile menu */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}>
            {state.prompts.length > 0 && (
              <span style={{
                backgroundColor: colors.bgBadge,
                color: '#ffffff',
                padding: '2px 10px',
                borderRadius: '12px',
                fontSize: '12px',
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}>
                {state.prompts.length} prompt{state.prompts.length !== 1 ? 's' : ''}
              </span>
            )}

            {/* Theme toggle */}
            <button
              onClick={handleToggleTheme}
              title={`Switch to ${mode === 'dark' ? 'light' : 'dark'} mode (${meta}+T)`}
              style={{
                background: 'none',
                border: `1px solid ${colors.border}`,
                borderRadius: '6px',
                padding: '6px 10px',
                cursor: 'pointer',
                fontSize: '16px',
                color: colors.textSecondary,
                transition: 'all 0.15s',
                display: 'flex',
                alignItems: 'center',
                position: 'relative',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.backgroundColor = colors.bgTertiary;
                e.currentTarget.style.color = colors.text;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = colors.textSecondary;
              }}
            >
              {mode === 'dark' ? '☀️' : '🌙'}
              <span style={{
                position: 'absolute',
                bottom: '-20px',
                left: '50%',
                transform: 'translateX(-50%)',
                fontSize: '10px',
                color: colors.textTertiary,
                whiteSpace: 'nowrap',
                opacity: 0,
                transition: 'opacity 0.15s',
                pointerEvents: 'none',
              }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '1'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '0'; }}
              >
                {meta}+T
              </span>
            </button>

            {/* Help button */}
            <button
              onClick={() => setShowHelp(true)}
              title="Keyboard shortcuts"
              style={{
                background: 'none',
                border: `1px solid ${colors.border}`,
                borderRadius: '6px',
                padding: '6px 10px',
                cursor: 'pointer',
                fontSize: '14px',
                color: colors.textSecondary,
                transition: 'all 0.15s',
                display: 'flex',
                alignItems: 'center',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.backgroundColor = colors.bgTertiary;
                e.currentTarget.style.color = colors.text;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = colors.textSecondary;
              }}
            >
              ?
            </button>

            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              style={{
                display: 'none',
                background: 'none',
                border: 'none',
                color: colors.text,
                fontSize: '24px',
                cursor: 'pointer',
                padding: '4px',
              }}
              className="mobile-menu-btn"
            >
              {mobileOpen ? '✕' : '☰'}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div ref={menuRef} className="nav-mobile-menu" style={{
            backgroundColor: colors.bgNav,
            borderTop: `1px solid ${colors.bgNavBorder}`,
            padding: '12px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}>
            {navItems.map(item => (
              <Link
                key={item.path}
                to={item.path}
                style={{
                  color: isActive(item.path) ? colors.textNavActive : colors.textNavInactive,
                  textDecoration: 'none',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  fontSize: '15px',
                  fontWeight: isActive(item.path) ? 600 : 500,
                  backgroundColor: isActive(item.path) ? colors.bgTertiary : 'transparent',
                }}
              >
                {item.label}
              </Link>
            ))}
          </div>
        )}
      </nav>

      {/* Keyboard shortcuts help modal */}
      {showHelp && (
        <div className="shortcut-help-overlay" onClick={() => setShowHelp(false)}>
          <div className="shortcut-help-panel" onClick={e => e.stopPropagation()}>
            <h2 style={{ color: colors.text, margin: '0 0 16px 0' }}>Keyboard Shortcuts</h2>
            {shortcuts.map((s, i) => (
              <div key={i} className="shortcut-row">
                <span className="shortcut-label" style={{ color: colors.textSecondary }}>{s.desc}</span>
                <span className="shortcut-keys">
                  {s.keys.map((k, j) => (
                    <span key={j}>
                      {j > 0 && <span className="shortcut-key-separator">+</span>}
                      <span className="shortcut-key" style={{
                        backgroundColor: colors.bgTertiary,
                        border: `1px solid ${colors.border}`,
                        borderRadius: '4px',
                        padding: '2px 8px',
                        fontSize: '12px',
                        fontFamily: 'monospace',
                        color: colors.text,
                      }}>
                        {k}
                      </span>
                    </span>
                  ))}
                </span>
              </div>
            ))}
            <button
              className="shortcut-close"
              onClick={() => setShowHelp(false)}
              style={{
                backgroundColor: colors.bgTertiary,
                border: `1px solid ${colors.border}`,
                borderRadius: '6px',
                color: colors.text,
                cursor: 'pointer',
                fontSize: '14px',
                marginTop: '16px',
                width: '100%',
                padding: '8px',
              }}
            >
              Close (Esc)
            </button>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div className={`toast ${toast.type}`} style={{
          backgroundColor: colors.bgCard,
          border: `1px solid ${toast.type === 'success' ? colors.success : toast.type === 'error' ? colors.danger : colors.border}`,
          color: colors.text,
        }}>
          {toast.type === 'success' && '✓'}
          {toast.type === 'error' && '✕'}
          {toast.type === 'info' && 'ℹ'}
          {toast.message}
        </div>
      )}
    </>
  );
}
