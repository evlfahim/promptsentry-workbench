import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store';
import type { PromptRun } from '@sentry-prompt/core';

export function Runs() {
  const { state, dispatch } = useStore();
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

  function handleDelete(id: string) {
    if (confirm('Delete this run?')) {
      dispatch({ type: 'SET_RUNS', payload: state.runs.filter(r => r.id !== id) });
    }
  }

  function handleClearAll() {
    if (confirm('Delete all runs? This cannot be undone.')) {
      dispatch({ type: 'SET_RUNS', payload: [] });
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Runs</h1>
        <button style={styles.clearButton} onClick={handleClearAll}>
          Clear All
        </button>
      </div>

      <div style={styles.filterBar}>
        <input
          type="text"
          placeholder="Filter runs..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={styles.filterInput}
        />
        <select
          value={selectedPromptId}
          onChange={e => setSelectedPromptId(e.target.value)}
          style={styles.filterInput}
        >
          <option value="">All Prompts</option>
          {state.prompts.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <span style={styles.count}>{filteredRuns.length} of {state.runs.length}</span>
      </div>

      {filteredRuns.length === 0 ? (
        <div style={styles.emptyState}>
          {state.runs.length === 0
            ? 'No runs yet. Execute a prompt to see runs here.'
            : 'No runs match your filter.'}
        </div>
      ) : (
        <div style={styles.list}>
          {filteredRuns
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .map(run => (
              <div key={run.id} style={styles.runCard}>
                <div style={styles.runHeader}>
                  <Link to={`/prompts/${run.promptId}`} style={styles.promptLink}>
                    <h3 style={styles.runPromptName}>
                      {state.prompts.find(p => p.id === run.promptId)?.name || 'Unknown Prompt'}
                    </h3>
                  </Link>
                  <div style={styles.runActions}>
                    <span style={styles.runDate}>
                      {new Date(run.createdAt).toLocaleString()}
                    </span>
                    <button
                      style={styles.deleteButton}
                      onClick={() => handleDelete(run.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <div style={styles.runMetrics}>
                  <span style={styles.metricItem}>
                    Tokens: {run.tokenCount}
                  </span>
                  <span style={styles.metricItem}>
                    Latency: {run.latencyMs}ms
                  </span>
                  {run.cost !== undefined && (
                    <span style={styles.metricItem}>
                      Cost: ${run.cost.toFixed(4)}
                    </span>
                  )}
                  <span style={styles.metricItem}>
                    Model: {run.model}
                  </span>
                </div>
                <p style={styles.runInput}>
                  <strong>Input:</strong> {run.input}
                </p>
                {run.error ? (
                  <div style={styles.errorBox}>
                    <p style={styles.errorText}>Error: {run.error}</p>
                  </div>
                ) : (
                  <pre style={styles.runOutput}>
                    {run.output?.substring(0, 300)}
                    {run.output && run.output.length > 300 ? '...' : ''}
                  </pre>
                )}
              </div>
            ))}
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
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px',
  },
  title: {
    fontSize: '28px',
    fontWeight: 700,
    color: '#e0e0e0',
    margin: 0,
  },
  clearButton: {
    backgroundColor: '#ef4444',
    color: '#ffffff',
    border: 'none',
    padding: '10px 20px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: '14px',
  },
  filterBar: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    marginBottom: '16px',
  },
  filterInput: {
    backgroundColor: '#0d0d1a',
    border: '1px solid #2d2d44',
    borderRadius: '4px',
    padding: '8px 12px',
    color: '#e0e0e0',
    fontSize: '14px',
    flex: 1,
  },
  count: {
    color: '#a0a0b0',
    fontSize: '14px',
    whiteSpace: 'nowrap',
  },
  emptyState: {
    backgroundColor: '#1a1a2e',
    borderRadius: '8px',
    padding: '32px',
    textAlign: 'center',
    color: '#a0a0b0',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  runCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: '8px',
    padding: '16px',
    border: '1px solid #2d2d44',
  },
  runHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '8px',
  },
  promptLink: {
    color: '#4a9eff',
    textDecoration: 'none',
  },
  runPromptName: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#ffffff',
    margin: 0,
  },
  runActions: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  runDate: {
    color: '#606070',
    fontSize: '12px',
  },
  deleteButton: {
    color: '#ef4444',
    background: 'none',
    border: 'none',
    fontSize: '13px',
    padding: '4px 8px',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  runMetrics: {
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap',
    marginBottom: '8px',
  },
  metricItem: {
    color: '#606070',
    fontSize: '12px',
  },
  runInput: {
    color: '#a0a0b0',
    fontSize: '14px',
    marginBottom: '8px',
  },
  errorBox: {
    backgroundColor: '#2d1a1a',
    borderRadius: '6px',
    padding: '12px 16px',
    marginBottom: '8px',
    border: '1px solid #ef4444',
  },
  errorText: {
    color: '#ef4444',
    fontSize: '14px',
    margin: 0,
  },
  runOutput: {
    backgroundColor: '#0d0d1a',
    borderRadius: '4px',
    padding: '12px',
    color: '#e0e0e0',
    fontSize: '14px',
    whiteSpace: 'pre-wrap',
    fontFamily: 'monospace',
    maxHeight: '200px',
    overflowY: 'auto',
  },
};
