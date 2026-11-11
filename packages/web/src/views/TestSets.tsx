import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore, service } from '../store';
import type { TestRunResult } from '@sentry-prompt/core';

export function TestSets() {
  const { state, dispatch } = useStore();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newInputs, setNewInputs] = useState('');
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<TestRunResult[]>([]);
  const [selectedTestSetId, setSelectedTestSetId] = useState<string | null>(null);
  const [selectedPromptId, setSelectedPromptId] = useState<string>('');
  const [selectedVersionId, setSelectedVersionId] = useState<string>('');

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    const inputs = newInputs
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    try {
      const ts = await service.createTestSet({
        name,
        description: newDescription.trim() || undefined,
        inputs,
      });
      dispatch({ type: 'SET_TEST_SETS', payload: [ts, ...state.testSets] });
      setShowCreate(false);
      setNewName('');
      setNewDescription('');
      setNewInputs('');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create test set');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this test set and all its results?')) return;
    try {
      await service.deleteTestSet(id);
      dispatch({ type: 'SET_TEST_SETS', payload: state.testSets.filter(ts => ts.id !== id) });
      if (selectedTestSetId === id) {
        setSelectedTestSetId(null);
        setResults([]);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete test set');
    }
  }

  async function handleRun() {
    if (!selectedTestSetId || !selectedPromptId || !selectedVersionId) return;
    setRunning(selectedTestSetId);
    try {
      const res = await service.runTestSet(selectedTestSetId, selectedPromptId, selectedVersionId);
      setResults(res);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to run test set');
    } finally {
      setRunning(null);
    }
  }

  async function handleClearResults() {
    if (!selectedTestSetId) return;
    if (!confirm('Delete all test run results?')) return;
    try {
      await service.deleteTestRunResults(selectedTestSetId);
      setResults([]);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to clear results');
    }
  }

  async function handleLoadResults() {
    if (!selectedTestSetId) return;
    try {
      const res = await service.getTestRunResults(selectedTestSetId);
      setResults(res);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to load results');
    }
  }

  const selectedTestSet = state.testSets.find(ts => ts.id === selectedTestSetId);
  const selectedPrompt = state.prompts.find(p => p.id === selectedPromptId);
  const versions = selectedPrompt ? state.versions.filter(v => v.promptId === selectedPromptId) : [];

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Test Sets</h1>
        <button style={styles.createButton} onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? 'Cancel' : '+ New Test Set'}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div style={styles.createForm}>
          <h3 style={styles.createTitle}>Create Test Set</h3>
          <div style={styles.formRow}>
            <input
              type="text"
              placeholder="Name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              style={styles.input}
            />
            <input
              type="text"
              placeholder="Description (optional)"
              value={newDescription}
              onChange={e => setNewDescription(e.target.value)}
              style={styles.input}
            />
          </div>
          <div style={styles.formRow}>
            <textarea
              placeholder="Inputs (one per line)"
              value={newInputs}
              onChange={e => setNewInputs(e.target.value)}
              style={styles.textarea}
              rows={5}
            />
          </div>
          <button style={styles.submitButton} onClick={handleCreate}>
            Create
          </button>
        </div>
      )}

      {state.testSets.length === 0 ? (
        <div style={styles.emptyState}>
          No test sets yet. Create one to batch-run prompts across multiple inputs.
        </div>
      ) : (
        <div style={styles.list}>
          {state.testSets.map(ts => (
            <div
              key={ts.id}
              style={{
                ...styles.testSetCard,
                border: selectedTestSetId === ts.id ? '1px solid #4a9eff' : '1px solid #2d2d44',
              }}
            >
              <div style={styles.testSetHeader}>
                <h3 style={styles.testSetName}>{ts.name}</h3>
                <div style={styles.testSetActions}>
                  <button
                    style={styles.smallButton}
                    onClick={() => {
                      setSelectedTestSetId(ts.id);
                      setSelectedPromptId('');
                      setSelectedVersionId('');
                      setResults([]);
                    }}
                  >
                    {selectedTestSetId === ts.id ? 'Close' : 'Run'}
                  </button>
                  <button style={styles.deleteButton} onClick={() => handleDelete(ts.id)}>
                    Delete
                  </button>
                </div>
              </div>
              {ts.description && <p style={styles.description}>{ts.description}</p>}
              <div style={styles.testSetMeta}>
                <span style={styles.metaItem}>{ts.inputs.length} inputs</span>
                <span style={styles.metaItem}>Created {new Date(ts.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Run panel */}
      {selectedTestSet && (
        <div style={styles.runPanel}>
          <h3 style={styles.runTitle}>Run: {selectedTestSet.name}</h3>

          <div style={styles.formRow}>
            <select
              value={selectedPromptId}
              onChange={e => {
                setSelectedPromptId(e.target.value);
                setSelectedVersionId('');
              }}
              style={styles.select}
            >
              <option value="">Select a prompt...</option>
              {state.prompts.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>

            {selectedPromptId && (
              <select
                value={selectedVersionId}
                onChange={e => setSelectedVersionId(e.target.value)}
                style={styles.select}
              >
                <option value="">Select a version...</option>
                {versions.map(v => (
                  <option key={v.id} value={v.id}>
                    v{v.versionNumber}
                  </option>
                ))}
              </select>
            )}
          </div>

          <button
            style={styles.runButton}
            disabled={!selectedPromptId || !selectedVersionId || !!running}
            onClick={handleRun}
          >
            {running ? 'Running...' : 'Run Test Set'}
          </button>

          {results.length > 0 && (
            <div style={styles.resultsSection}>
              <div style={styles.resultsHeader}>
                <h4>Results ({results.length} inputs)</h4>
                <button style={styles.smallButton} onClick={handleLoadResults}>
                  Refresh
                </button>
                <button style={styles.deleteButton} onClick={handleClearResults}>
                  Clear Results
                </button>
              </div>

              {/* Summary stats */}
              <div style={styles.statsRow}>
                <div style={styles.statCard}>
                  <span style={styles.statLabel}>Total</span>
                  <span style={styles.statValue}>{results.length}</span>
                </div>
                <div style={styles.statCard}>
                  <span style={styles.statLabel}>Success</span>
                  <span style={{ ...styles.statValue, color: '#22c55e' }}>
                    {results.filter(r => !r.error).length}
                  </span>
                </div>
                <div style={styles.statCard}>
                  <span style={styles.statLabel}>Errors</span>
                  <span style={{ ...styles.statValue, color: '#ef4444' }}>
                    {results.filter(r => r.error).length}
                  </span>
                </div>
                <div style={styles.statCard}>
                  <span style={styles.statLabel}>Total Latency</span>
                  <span style={styles.statValue}>
                    {results.reduce((s, r) => s + r.latencyMs, 0).toLocaleString()}ms
                  </span>
                </div>
                <div style={styles.statCard}>
                  <span style={styles.statLabel}>Total Tokens</span>
                  <span style={styles.statValue}>
                    {results.reduce((s, r) => s + r.tokenCount, 0).toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Results table */}
              <div style={styles.resultsTable}>
                <div style={styles.tableHeader}>
                  <span style={styles.colInput}>Input</span>
                  <span style={styles.colOutput}>Output</span>
                  <span style={styles.colMetrics}>Tokens / Latency</span>
                  <span style={styles.colStatus}>Status</span>
                </div>
                {results.map((r, i) => (
                  <div key={i} style={styles.tableRow}>
                    <div style={styles.colInput}>
                      <pre style={styles.inputText}>{r.input}</pre>
                    </div>
                    <div style={styles.colOutput}>
                      {r.error ? (
                        <span style={styles.errorText}>{r.error}</span>
                      ) : (
                        <pre style={styles.outputText}>
                          {r.output?.substring(0, 200)}
                          {r.output && r.output.length > 200 ? '...' : ''}
                        </pre>
                      )}
                    </div>
                    <div style={styles.colMetrics}>
                      <span style={styles.metricBadge}>{r.tokenCount} tok</span>
                      <span style={styles.metricBadge}>{r.latencyMs}ms</span>
                      {r.cost !== undefined && (
                        <span style={styles.metricBadge}>${r.cost.toFixed(4)}</span>
                      )}
                    </div>
                    <div style={styles.colStatus}>
                      {r.error ? (
                        <span style={styles.errorBadge}>Error</span>
                      ) : (
                        <span style={styles.successBadge}>OK</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
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
  createButton: {
    backgroundColor: '#4a9eff',
    color: '#ffffff',
    border: 'none',
    padding: '10px 20px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: '14px',
  },
  createForm: {
    backgroundColor: '#1a1a2e',
    borderRadius: '8px',
    padding: '20px',
    border: '1px solid #2d2d44',
    marginBottom: '24px',
  },
  createTitle: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#ffffff',
    margin: '0 0 16px 0',
  },
  formRow: {
    display: 'flex',
    gap: '12px',
    marginBottom: '12px',
  },
  input: {
    backgroundColor: '#0d0d1a',
    border: '1px solid #2d2d44',
    borderRadius: '4px',
    padding: '8px 12px',
    color: '#e0e0e0',
    fontSize: '14px',
    flex: 1,
  },
  textarea: {
    backgroundColor: '#0d0d1a',
    border: '1px solid #2d2d44',
    borderRadius: '4px',
    padding: '8px 12px',
    color: '#e0e0e0',
    fontSize: '14px',
    width: '100%',
    fontFamily: 'monospace',
    resize: 'vertical',
  },
  submitButton: {
    backgroundColor: '#22c55e',
    color: '#ffffff',
    border: 'none',
    padding: '10px 20px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: '14px',
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
    marginBottom: '24px',
  },
  testSetCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: '8px',
    padding: '16px',
  },
  testSetHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '8px',
  },
  testSetName: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#ffffff',
    margin: 0,
  },
  testSetActions: {
    display: 'flex',
    gap: '8px',
  },
  description: {
    color: '#a0a0b0',
    fontSize: '14px',
    margin: '0 0 8px 0',
  },
  testSetMeta: {
    display: 'flex',
    gap: '16px',
  },
  metaItem: {
    color: '#606070',
    fontSize: '12px',
  },
  smallButton: {
    backgroundColor: '#2d2d44',
    color: '#e0e0e0',
    border: 'none',
    padding: '6px 12px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
  },
  deleteButton: {
    backgroundColor: '#ef4444',
    color: '#ffffff',
    border: 'none',
    padding: '6px 12px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
  },
  runPanel: {
    backgroundColor: '#1a1a2e',
    borderRadius: '8px',
    padding: '20px',
    border: '1px solid #2d2d44',
  },
  runTitle: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#ffffff',
    margin: '0 0 16px 0',
  },
  select: {
    backgroundColor: '#0d0d1a',
    border: '1px solid #2d2d44',
    borderRadius: '4px',
    padding: '8px 12px',
    color: '#e0e0e0',
    fontSize: '14px',
    flex: 1,
  },
  runButton: {
    backgroundColor: '#4a9eff',
    color: '#ffffff',
    border: 'none',
    padding: '12px 24px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: '14px',
    marginTop: '12px',
  },
  resultsSection: {
    marginTop: '24px',
  },
  resultsHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
  },
  statsRow: {
    display: 'flex',
    gap: '12px',
    marginBottom: '16px',
    flexWrap: 'wrap',
  },
  statCard: {
    backgroundColor: '#0d0d1a',
    borderRadius: '6px',
    padding: '12px 16px',
    flex: '1 1 120px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  statLabel: {
    color: '#606070',
    fontSize: '12px',
    marginBottom: '4px',
  },
  statValue: {
    color: '#e0e0e0',
    fontSize: '18px',
    fontWeight: 600,
  },
  resultsTable: {
    border: '1px solid #2d2d44',
    borderRadius: '6px',
    overflow: 'hidden',
  },
  tableHeader: {
    display: 'flex',
    backgroundColor: '#0d0d1a',
    padding: '10px 12px',
    fontWeight: 600,
    fontSize: '13px',
    color: '#a0a0b0',
  },
  tableRow: {
    display: 'flex',
    padding: '10px 12px',
    borderBottom: '1px solid #2d2d44',
    gap: '12px',
    alignItems: 'flex-start',
  },
  colInput: {
    flex: '0 0 200px',
  },
  colOutput: {
    flex: 1,
  },
  colMetrics: {
    flex: '0 0 180px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  colStatus: {
    flex: '0 0 60px',
    textAlign: 'center',
  },
  inputText: {
    color: '#a0a0b0',
    fontSize: '13px',
    margin: 0,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  outputText: {
    color: '#e0e0e0',
    fontSize: '13px',
    margin: 0,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  metricBadge: {
    backgroundColor: '#2d2d44',
    borderRadius: '4px',
    padding: '2px 8px',
    fontSize: '11px',
    color: '#a0a0b0',
  },
  errorText: {
    color: '#ef4444',
    fontSize: '13px',
  },
  errorBadge: {
    backgroundColor: '#ef4444',
    color: '#ffffff',
    borderRadius: '4px',
    padding: '2px 8px',
    fontSize: '11px',
  },
  successBadge: {
    backgroundColor: '#22c55e',
    color: '#ffffff',
    borderRadius: '4px',
    padding: '2px 8px',
    fontSize: '11px',
  },
};
