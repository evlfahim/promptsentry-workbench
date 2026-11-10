import { Link } from 'react-router-dom';
import { useStore } from '../store';

export function Dashboard() {
  const { state } = useStore();

  const stats = [
    { label: 'Prompts', value: state.prompts.length, color: '#4a9eff' },
    { label: 'Versions', value: state.versions.length, color: '#34d399' },
    { label: 'Runs', value: state.runs.length, color: '#f59e0b' },
    { label: 'Test Sets', value: state.testSets.length, color: '#a78bfa' },
  ];

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Dashboard</h1>
      <p style={styles.subtitle}>Overview of your prompt workbench</p>

      <div style={styles.statsGrid}>
        {stats.map(stat => (
          <div key={stat.label} style={{ ...styles.statCard, borderTop: `3px solid ${stat.color}` }}>
            <div style={styles.statValue}>{stat.value}</div>
            <div style={styles.statLabel}>{stat.label}</div>
          </div>
        ))}
      </div>

      <div style={styles.actions}>
        <Link to="/prompts" style={styles.primaryButton}>
          Manage Prompts
        </Link>
        <Link to="/api-config" style={styles.secondaryButton}>
          Configure API
        </Link>
      </div>

      {state.prompts.length === 0 && (
        <div style={styles.emptyState}>
          <p style={styles.emptyText}>No prompts yet. Create your first prompt to get started.</p>
          <Link to="/prompts" style={styles.link}>
            Go to Prompts →
          </Link>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '900px',
    margin: '0 auto',
    padding: '32px 24px',
  },
  title: {
    fontSize: '28px',
    fontWeight: 700,
    color: '#e0e0e0',
    marginBottom: '8px',
  },
  subtitle: {
    fontSize: '16px',
    color: '#a0a0b0',
    marginBottom: '32px',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '16px',
    marginBottom: '32px',
  },
  statCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: '8px',
    padding: '20px',
    textAlign: 'center',
  },
  statValue: {
    fontSize: '32px',
    fontWeight: 700,
    color: '#ffffff',
  },
  statLabel: {
    fontSize: '14px',
    color: '#a0a0b0',
    marginTop: '4px',
  },
  actions: {
    display: 'flex',
    gap: '12px',
    marginBottom: '32px',
  },
  primaryButton: {
    backgroundColor: '#4a9eff',
    color: '#ffffff',
    padding: '10px 20px',
    borderRadius: '6px',
    textDecoration: 'none',
    fontWeight: 600,
    fontSize: '14px',
  },
  secondaryButton: {
    backgroundColor: '#2d2d44',
    color: '#e0e0e0',
    padding: '10px 20px',
    borderRadius: '6px',
    textDecoration: 'none',
    fontWeight: 600,
    fontSize: '14px',
  },
  emptyState: {
    backgroundColor: '#1a1a2e',
    borderRadius: '8px',
    padding: '32px',
    textAlign: 'center',
  },
  emptyText: {
    color: '#a0a0b0',
    marginBottom: '16px',
  },
  link: {
    color: '#4a9eff',
    textDecoration: 'none',
    fontWeight: 600,
  },
};
