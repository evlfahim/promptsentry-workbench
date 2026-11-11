import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore, service } from '../store';
import { useTheme } from '../theme';
import { useToast } from '../hooks/useKeyboardShortcuts';
import type { TestRunResult } from '@sentry-prompt/core';

export function TestSets() {
  const { state, dispatch } = useStore();
  const { colors } = useTheme();
  const { toast, showToast } = useToast();
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
    const inputs = newInputs.split('\n').map(s => s.trim()).filter(s => s.length > 0);
    try {
      const ts = await service.createTestSet({ name, description: newDescription.trim() || undefined, inputs });
      dispatch({ type: 'SET_TEST_SETS', payload: [ts, ...state.testSets] });
      setShowCreate(false);
      setNewName('');
      setNewDescription('');
      setNewInputs('');
      showToast('Test set created', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create test set', 'error');
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
      showToast('Test set deleted', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete test set', 'error');
    }
  }

  async function handleRun() {
    if (!selectedTestSetId || !selectedPromptId || !selectedVersionId) return;
    setRunning(selectedTestSetId);
    try {
      const res = await service.runTestSet(selectedTestSetId, selectedPromptId, selectedVersionId);
      setResults(res);
      const successCount = res.filter(r => !r.error).length;
      const errorCount = res.filter(r => r.error).length;
      showToast(`Test set run complete: ${successCount} success, ${errorCount} errors`, errorCount > 0 ? 'error' : 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to run test set', 'error');
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
      showToast('Results cleared', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to clear results', 'error');
    }
  }

  async function handleLoadResults() {
    if (!selectedTestSetId) return;
    try {
      const res = await service.getTestRunResults(selectedTestSetId);
      setResults(res);
      showToast(`Loaded ${res.length} results`, 'info');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load results', 'error');
    }
  }

  const selectedTestSet = state.testSets.find(ts => ts.id === selectedTestSetId);
  const selectedPrompt = state.prompts.find(p => p.id === selectedPromptId);
  const versions = selectedPrompt ? state.versions.filter(v => v.promptId === selectedPromptId) : [];

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
        <div className="header-responsive" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
          <h1 style={{ fontSize: '28px', fontWeight: 700, color: colors.text, margin: 0 }}>Test Sets</h1>
          <button
            style={{
              backgroundColor: colors.accent,
              color: '#ffffff',
              border: 'none',
              padding: '10px 20px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '14px',
            }}
            onClick={() => setShowCreate(!showCreate)}
          >
            {showCreate ? 'Cancel' : '+ New Test Set'}
          </button>
        </div>

        {showCreate && (
          <div className="testset-create-form" style={{
            backgroundColor: colors.bgCard,
            borderRadius: '8px',
            padding: '20px',
            border: `1px solid ${colors.bgCardBorder}`,
            marginBottom: '24px',
          }}>
            <h3 style={{ fontSize: '18px', fontWeight: 600, color: colors.text, margin: '0 0 16px 0' }}>Create Test Set</h3>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
              <input type="text" placeholder="Name" value={newName} onChange={e => setNewName(e.target.value)} style={inputStyle} />
              <input type="text" placeholder="Description (optional)" value={newDescription} onChange={e => setNewDescription(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ marginBottom: '12px' }}>
              <textarea placeholder="Inputs (one per line)" value={newInputs} onChange={e => setNewInputs(e.target.value)} style={{ ...inputStyle, width: '100%', fontFamily: 'monospace', resize: 'vertical', minHeight: '80px' }} rows={5} />
            </div>
            <button style={{ backgroundColor: colors.success, color: '#ffffff', border: 'none', padding: '10px 20px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '14px' }} onClick={handleCreate}>
              Create
            </button>
          </div>
        )}

        {state.testSets.length === 0 ? (
          <div style={{
            backgroundColor: colors.bgCard,
            borderRadius: '8px',
            padding: '32px',
            textAlign: 'center',
            color: colors.textSecondary,
            border: `1px solid ${colors.bgCardBorder}`,
          }}>
            No test sets yet. Create one to batch-run prompts across multiple inputs.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
            {state.testSets.map(ts => (
              <div key={ts.id} className="prompt-card-hover" style={{
                backgroundColor: colors.bgCard,
                borderRadius: '8px',
                padding: '16px',
                border: `1px solid ${selectedTestSetId === ts.id ? colors.accent : colors.bgCardBorder}`,
                transition: 'background-color 0.2s, border-color 0.2s',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                  <h3 style={{ fontSize: '18px', fontWeight: 600, color: colors.text, margin: 0 }}>{ts.name}</h3>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button style={{ backgroundColor: colors.bgTertiary, color: colors.text, border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }} onClick={() => { setSelectedTestSetId(ts.id); setSelectedPromptId(''); setSelectedVersionId(''); setResults([]); }}>
                      {selectedTestSetId === ts.id ? 'Close' : 'Run'}
                    </button>
                    <button style={{ backgroundColor: colors.danger, color: '#ffffff', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }} onClick={() => handleDelete(ts.id)}>
                      Delete
                    </button>
                  </div>
                </div>
                {ts.description && <p style={{ color: colors.textSecondary, fontSize: '14px', margin: '0 0 8px 0' }}>{ts.description}</p>}
                <div style={{ display: 'flex', gap: '16px', color: colors.textTertiary, fontSize: '12px' }}>
                  <span>{ts.inputs.length} inputs</span>
                  <span>Created {new Date(ts.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {selectedTestSet && (
          <div style={{
            backgroundColor: colors.bgCard,
            borderRadius: '8px',
            padding: '20px',
            border: `1px solid ${colors.bgCardBorder}`,
          }}>
            <h3 style={{ fontSize: '18px', fontWeight: 600, color: colors.text, margin: '0 0 16px 0' }}>Run: {selectedTestSet.name}</h3>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
              <select value={selectedPromptId} onChange={e => { setSelectedPromptId(e.target.value); setSelectedVersionId(''); }} style={inputStyle}>
                <option value="">Select a prompt...</option>
                {state.prompts.map(p => (<option key={p.id} value={p.id}>{p.name}</option>))}
              </select>
              {selectedPromptId && (
                <select value={selectedVersionId} onChange={e => setSelectedVersionId(e.target.value)} style={inputStyle}>
                  <option value="">Select a version...</option>
                  {versions.map(v => (<option key={v.id} value={v.id}>v{v.versionNumber}</option>))}
                </select>
              )}
            </div>
            <button
              style={{
                backgroundColor: colors.accent,
                color: '#ffffff',
                border: 'none',
                padding: '12px 24px',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '14px',
                marginTop: '12px',
                opacity: !selectedPromptId || !selectedVersionId || !!running ? 0.6 : 1,
              }}
              disabled={!selectedPromptId || !selectedVersionId || !!running}
              onClick={handleRun}
            >
              {running ? 'Running...' : 'Run Test Set'}
            </button>

            {results.length > 0 && (
              <div style={{ marginTop: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
                  <h4 style={{ color: colors.text, fontSize: '16px', fontWeight: 600, margin: 0 }}>Results ({results.length} inputs)</h4>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button style={{ backgroundColor: colors.bgTertiary, color: colors.text, border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }} onClick={handleLoadResults}>Refresh</button>
                    <button style={{ backgroundColor: colors.danger, color: '#ffffff', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }} onClick={handleClearResults}>Clear Results</button>
                  </div>
                </div>

                {/* Summary stats */}
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
                  {[
                    { label: 'Total', value: results.length.toString() },
                    { label: 'Success', value: results.filter(r => !r.error).toString(), color: colors.success },
                    { label: 'Errors', value: results.filter(r => r.error).toString(), color: colors.danger },
                    { label: 'Total Latency', value: `${results.reduce((s, r) => s + r.latencyMs, 0).toLocaleString()}ms` },
                    { label: 'Total Tokens', value: results.reduce((s, r) => s + r.tokenCount, 0).toLocaleString().toString() },
                  ].map(stat => (
                    <div key={stat.label} style={{
                      backgroundColor: colors.bgCode,
                      borderRadius: '6px',
                      padding: '12px 16px',
                      border: `1px solid ${colors.border}`,
                      flex: '1 1 120px',
                      textAlign: 'center',
                    }}>
                      <span style={{ color: colors.textSecondary, fontSize: '12px', display: 'block', marginBottom: '4px' }}>{stat.label}</span>
                      <span style={{ color: stat.color || colors.text, fontSize: '20px', fontWeight: 700 }}>{stat.value}</span>
                    </div>
                  ))}
                </div>

                {/* Results table */}
                <div className="testset-table-responsive" style={{ overflowX: 'auto' }}>
                  <div style={{ minWidth: '600px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 3fr 1fr 80px', gap: '0', padding: '8px 12px', backgroundColor: colors.bgTableHeader, borderBottom: `1px solid ${colors.border}`, color: colors.textSecondary, fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      <span>Input</span>
                      <span>Output</span>
                      <span>Tokens / Latency</span>
                      <span>Status</span>
                    </div>
                    {results.map((r, i) => (
                      <div key={i} style={{
                        display: 'grid',
                        gridTemplateColumns: '2fr 3fr 1fr 80px',
                        gap: '0',
                        padding: '12px',
                        borderBottom: `1px solid ${colors.border}`,
                        backgroundColor: i % 2 === 0 ? 'transparent' : colors.bgTableRowHover,
                      }}>
                        <div>
                          <pre style={{ color: colors.text, fontSize: '13px', whiteSpace: 'pre-wrap', fontFamily: 'monospace', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', maxHeight: '60px' }}>{r.input}</pre>
                        </div>
                        <div>
                          {r.error ? (
                            <span style={{ color: colors.danger, fontSize: '13px' }}>{r.error}</span>
                          ) : (
                            <pre style={{ color: colors.text, fontSize: '13px', whiteSpace: 'pre-wrap', fontFamily: 'monospace', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', maxHeight: '60px' }}>
                              {r.output?.substring(0, 200)}
                              {r.output && r.output.length > 200 ? '...' : ''}
                            </pre>
                          )}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ backgroundColor: colors.bgTertiary, color: colors.text, padding: '2px 8px', borderRadius: '4px', fontSize: '11px', alignSelf: 'flex-start' }}>{r.tokenCount} tok</span>
                          <span style={{ backgroundColor: colors.bgTertiary, color: colors.text, padding: '2px 8px', borderRadius: '4px', fontSize: '11px', alignSelf: 'flex-start' }}>{r.latencyMs}ms</span>
                          {r.cost !== undefined && <span style={{ backgroundColor: colors.bgTertiary, color: colors.text, padding: '2px 8px', borderRadius: '4px', fontSize: '11px', alignSelf: 'flex-start' }}>${r.cost.toFixed(4)}</span>}
                        </div>
                        <div>
                          {r.error ? (
                            <span style={{ backgroundColor: colors.danger, color: '#ffffff', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>Error</span>
                          ) : (
                            <span style={{ backgroundColor: colors.success, color: '#ffffff', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>OK</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
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
