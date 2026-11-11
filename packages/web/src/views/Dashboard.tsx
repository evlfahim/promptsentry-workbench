import { Link } from 'react-router-dom';
import { useStore } from '../store';
import { useTheme } from '../theme';

export function Dashboard() {
  const { state } = useStore();
  const { colors } = useTheme();

  const stats = [
    { label: 'Prompts', value: state.prompts.length, color: '#4a9eff' },
    { label: 'Versions', value: state.versions.length, color: '#34d399' },
    { label: 'Runs', value: state.runs.length, color: '#f59e0b' },
    { label: 'Test Sets', value: state.testSets.length, color: '#a78bfa' },
  ];

  return (
    <div style={{
      maxWidth: '900px',
      margin: '0 auto',
      padding: '32px 24px',
    }}>
      <h1 style={{
        fontSize: '28px',
        fontWeight: 700,
        color: colors.text,
        marginBottom: '8px',
      }}>Dashboard</h1>
      <p style={{
        fontSize: '16px',
        color: colors.textSecondary,
        marginBottom: '32px',
      }}>Overview of your prompt workbench</p>

      <div className="stats-grid-responsive" style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '16px',
        marginBottom: '32px',
      }}>
        {stats.map(stat => (
          <div key={stat.label} className="stat-card-responsive" style={{
            backgroundColor: colors.bgCard,
            borderRadius: '8px',
            padding: '20px',
            textAlign: 'center',
            borderTop: `3px solid ${stat.color}`,
            border: `1px solid ${colors.bgCardBorder}`,
            transition: 'background-color 0.2s, border-color 0.2s',
          }}>
            <div style={{ fontSize: '32px', fontWeight: 700, color: colors.text }}>{stat.value}</div>
            <div style={{ fontSize: '14px', color: colors.textSecondary, marginTop: '4px' }}>{stat.label}</div>
          </div>
        ))}
      </div>

      <div className="action-buttons-responsive" style={{
        display: 'flex',
        gap: '12px',
        marginBottom: '32px',
        flexWrap: 'wrap',
      }}>
        <Link to="/prompts" style={{
          backgroundColor: colors.accent,
          color: '#ffffff',
          padding: '10px 20px',
          borderRadius: '6px',
          textDecoration: 'none',
          fontWeight: 600,
          fontSize: '14px',
          transition: 'background-color 0.15s',
        }}>
          Manage Prompts
        </Link>
        <Link to="/api-config" style={{
          backgroundColor: colors.bgTertiary,
          color: colors.text,
          padding: '10px 20px',
          borderRadius: '6px',
          textDecoration: 'none',
          fontWeight: 600,
          fontSize: '14px',
          transition: 'background-color 0.15s',
        }}>
          Configure API
        </Link>
      </div>

      {state.prompts.length === 0 && (
        <div style={{
          backgroundColor: colors.bgCard,
          borderRadius: '8px',
          padding: '32px',
          textAlign: 'center',
          border: `1px solid ${colors.bgCardBorder}`,
        }}>
          <p style={{ color: colors.textSecondary, marginBottom: '16px' }}>
            No prompts yet. Create your first prompt to get started.
          </p>
          <Link to="/prompts" style={{
            color: colors.textLink,
            textDecoration: 'none',
            fontWeight: 600,
          }}>
            Go to Prompts →
          </Link>
        </div>
      )}
    </div>
  );
}
