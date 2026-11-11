import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore, service } from '../store';
import { useTheme } from '../theme';
import { useToast } from '../hooks/useKeyboardShortcuts';

export function Runs() {
  const { state, dispatch } = useStore();
  const { colors } = useTheme();
  const { toast, showToast } = useToast();
  const [filter, setFilter] = useState('');
  const [selectedPromptId, setSelectedPromptId] = useState<string>('');

  const filteredRuns = state.runs.filter(r => {
    const matchesFilter = !filter ||
      r.input.toLowerCase().includes(filter.toLowerCase()) ||
      r.output?.toLowerCase().includes(filter.toLowerCase()) ||
      r.error?.toLowerCase().includes(filter.toLowerCase());
    const matchesPrompt = !selectedPromptId || r.promptId === selectedPromptId;
    return matchesFilter && matchesPrompt;
  });

  async function handleDelete(id: string) {
    if (!confirm('Delete this run?')) return;
    try {
      await service.deleteRun(id);
      dispatch({ type: 'DELETE_RUN', payload: id });
      showToast('Run deleted', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete run', 'error');
    }
  }

  async function handleClearAll() {
    if (!confirm('Delete all runs? This cannot be undone.')) return;
    try {
      await service.deleteAllRuns();
      dispatch({ type: 'SET_RUNS', payload: [] });
      showToast('All runs cleared', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete runs', 'error');
    }
  }

  const inputStyle: React.CSSProperties = {
    backgroundColor: colors.bgInput,
    border: `1px solid ${colors.border}`,
    borderRadius: '4px',
    padding: '8px 12px',
    color: colors.text,
    fontSize: '14px',
    flex: 1,
    transition: 'border-color 0.15s',
  };

  return (
    <>
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '32px 24px' }}>
        <div className="header-responsive" style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '24px',
          flexWrap: 'wrap',
          gap: '12px',
        }}>
          <h1 style={{ fontSize: '28px', fontWeight: 700, color: colors.text, margin: 0 }}>Runs</h1>
          <button
            style={{
              backgroundColor: colors.danger,
              color: '#ffffff',
              border: 'none',
              padding: '10px 20px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '14px',
            }}
            onClick={handleClearAll}
          >
            Clear All
          </button>
        </div>

        <div className="filter-responsive" style={{
          display: 'flex',
          gap: '12px',
          alignItems: 'center',
          marginBottom: '16px',
          flexWrap: 'wrap',
        }}>
          <input
            type="text"
            placeholder="Filter runs..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={inputStyle}
          />
          <select
            value={selectedPromptId}
            onChange={e => setSelectedPromptId(e.target.value)}
            style={{
              ...inputStyle,
              flex: 'none',
              width: '200px',
            }}
          >
            <option value="">All Prompts</option>
            {state.prompts.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <span style={{ color: colors.textSecondary, fontSize: '14px', whiteSpace: 'nowrap' }}>
            {filteredRuns.length} of {state.runs.length}
          </span>
        </div>

        {filteredRuns.length === 0 ? (
          <div style={{
            backgroundColor: colors.bgCard,
            borderRadius: '8px',
            padding: '32px',
            textAlign: 'center',
            color: colors.textSecondary,
            border: `1px solid ${colors.bgCardBorder}`,
          }}>
            {state.runs.length === 0
              ? 'No runs yet. Execute a prompt to see runs here.'
              : 'No runs match your filter.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {filteredRuns
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              .map(run => (
                <div key={run.id} className="run-result-card" style={{
                  backgroundColor: colors.bgCard,
                  borderRadius: '8px',
                  padding: '16px',
                  border: `1px solid ${colors.bgCardBorder}`,
                }}>
                  <div className="prompt-list-item" style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: '8px',
                    flexWrap: 'wrap',
                    gap: '8px',
                  }}>
                    <Link to={`/prompts/${run.promptId}`} style={{ color: colors.textLink, textDecoration: 'none' }}>
                      <h3 style={{ fontSize: '18px', fontWeight: 600, color: colors.text, margin: 0 }}>
                        {state.prompts.find(p => p.id === run.promptId)?.name || 'Unknown Prompt'}
                      </h3>
                    </Link>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span style={{ color: colors.textTertiary, fontSize: '12px' }}>
                        {new Date(run.createdAt).toLocaleString()}
                      </span>
                      <button
                        style={{ color: colors.textError, background: 'none', border: 'none', fontSize: '13px', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer' }}
                        onClick={() => handleDelete(run.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="metrics-responsive" style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '8px' }}>
                    <span style={{ color: colors.textSecondary, fontSize: '12px' }}>Tokens: {run.tokenCount}</span>
                    <span style={{ color: colors.textSecondary, fontSize: '12px' }}>Latency: {run.latencyMs}ms</span>
                    {run.cost !== undefined && <span style={{ color: colors.textSecondary, fontSize: '12px' }}>Cost: ${run.cost.toFixed(4)}</span>}
                    <span style={{ color: colors.textSecondary, fontSize: '12px' }}>Model: {run.model}</span>
                  </div>
                  <p style={{ color: colors.textSecondary, fontSize: '14px', marginBottom: '8px', margin: 0 }}>
                    <strong>Input:</strong> {run.input}
                  </p>
                  {run.error ? (
                    <div style={{
                      backgroundColor: colors.bgError,
                      borderRadius: '6px',
                      padding: '12px 16px',
                      marginBottom: '8px',
                      border: `1px solid ${colors.textError}`,
                    }}>
                      <p style={{ color: colors.textError, fontSize: '14px', margin: 0 }}>Error: {run.error}</p>
                    </div>
                  ) : (
                    <pre style={{
                      backgroundColor: colors.bgCode,
                      borderRadius: '4px',
                      padding: '12px',
                      color: colors.text,
                      fontSize: '14px',
                      whiteSpace: 'pre-wrap',
                      fontFamily: 'monospace',
                      maxHeight: '200px',
                      overflowY: 'auto',
                    }}>
                      {run.output?.substring(0, 300)}
                      {run.output && run.output.length > 300 ? '...' : ''}
                    </pre>
                  )}
                </div>
              ))}
          </div>
        )}
      </div>

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
