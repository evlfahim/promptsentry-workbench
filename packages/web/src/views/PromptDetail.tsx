import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useStore, service } from '../store';
import { useTheme } from '../theme';
import { useToast } from '../hooks/useKeyboardShortcuts';
import type { PromptRun } from '@sentry-prompt/core';

export function PromptDetail() {
  const { id } = useParams<{ id: string }>();
  const { state, dispatch } = useStore();
  const { colors } = useTheme();
  const { toast, showToast } = useToast();

  const prompt = state.prompts.find(p => p.id === id);
  const versions = useMemo(
    () => state.versions.filter(v => v.promptId === id).sort((a, b) => b.versionNumber - a.versionNumber),
    [state.versions, id],
  );
  const runs = useMemo(
    () => state.runs.filter(r => r.promptId === id).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [state.runs, id],
  );

  // Editor state
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [model, setModel] = useState('');
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [commitMessage, setCommitMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  // Run panel state
  const [runInput, setRunInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<PromptRun | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string>('');

  // Load the prompt into the editor when it first becomes available or the route changes.
  const loadedPromptId = prompt?.id;
  useEffect(() => {
    if (!prompt) return;
    setName(prompt.name);
    setContent(prompt.content);
    setModel(prompt.model);
    setTemperature(prompt.temperature);
    setMaxTokens(prompt.maxTokens);
    setSystemPrompt(prompt.systemPrompt ?? '');
    setCommitMessage('');
    setSaveError(null);
    setSaveNotice(null);
    setLastRun(null);
    setRunError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedPromptId]);

  // Default the run panel to the latest version; keep the selection valid.
  const latestVersionId = versions[0]?.id ?? '';
  useEffect(() => {
    if (!versions.some(v => v.id === selectedVersionId)) {
      setSelectedVersionId(latestVersionId);
    }
  }, [versions, selectedVersionId, latestVersionId]);

  if (!prompt) {
    return (
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '32px 24px' }}>
        {state.isLoading ? (
          <p style={{ color: colors.text, fontSize: '16px' }}>Loading…</p>
        ) : (
          <p style={{ color: colors.textError, fontSize: '16px' }}>Prompt not found.</p>
        )}
        <Link to="/prompts" style={{ color: colors.textLink, textDecoration: 'none' }}>
          ← Back to Prompts
        </Link>
      </div>
    );
  }

  const isDirty =
    name !== prompt.name ||
    content !== prompt.content ||
    model !== prompt.model ||
    temperature !== prompt.temperature ||
    maxTokens !== prompt.maxTokens ||
    systemPrompt.trim() !== (prompt.systemPrompt ?? '');

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt || !name.trim()) return;

    setIsSaving(true);
    setSaveError(null);
    setSaveNotice(null);
    try {
      const result = await service.updatePrompt(prompt.id, {
        name: name.trim(),
        content,
        model: model.trim(),
        temperature,
        maxTokens,
        systemPrompt: systemPrompt.trim(),
        commitMessage: commitMessage.trim() || undefined,
      });
      dispatch({ type: 'UPDATE_PROMPT', payload: result.prompt });
      setName(result.prompt.name);
      setModel(result.prompt.model);
      setSystemPrompt(result.prompt.systemPrompt ?? '');
      if (result.version) {
        dispatch({ type: 'ADD_VERSION', payload: result.version });
        setSelectedVersionId(result.version.id);
        setSaveNotice(`Saved as v${result.version.versionNumber}`);
        showToast(`Saved as v${result.version.versionNumber}`, 'success');
      } else {
        setSaveNotice('Saved (no changes to version)');
        showToast('No changes to version', 'info');
      }
      setCommitMessage('');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save prompt');
      showToast('Failed to save prompt', 'error');
    } finally {
      setIsSaving(false);
    }
  }

  function handleRevert() {
    if (!prompt) return;
    setName(prompt.name);
    setContent(prompt.content);
    setModel(prompt.model);
    setTemperature(prompt.temperature);
    setMaxTokens(prompt.maxTokens);
    setSystemPrompt(prompt.systemPrompt ?? '');
    setCommitMessage('');
    setSaveError(null);
    showToast('Reverted to last saved version', 'info');
  }

  async function handleRun(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt || !selectedVersionId) return;

    setIsRunning(true);
    setRunError(null);
    setLastRun(null);
    try {
      const run = await service.executePrompt(prompt.id, runInput, selectedVersionId);
      setLastRun(run);
      dispatch({ type: 'ADD_RUN', payload: run });
      if (run.error) {
        showToast('Run failed', 'error');
      } else {
        showToast(`Run completed (${run.latencyMs}ms)`, 'success');
      }
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Unknown error');
      showToast('Run failed', 'error');
    } finally {
      setIsRunning(false);
    }
  }

  const selectedVersion = versions.find(v => v.id === selectedVersionId);
  const apiConfigured = Boolean(state.apiConfig?.baseUrl);

  const inputStyle: React.CSSProperties = {
    backgroundColor: colors.bgInput,
    border: `1px solid ${colors.border}`,
    borderRadius: '4px',
    padding: '8px 12px',
    color: colors.text,
    fontSize: '14px',
    transition: 'border-color 0.15s',
  };

  const textareaStyle: React.CSSProperties = {
    ...inputStyle,
    resize: 'vertical',
    fontFamily: 'monospace',
  };

  const labelStyle: React.CSSProperties = {
    color: colors.textSecondary,
    fontSize: '13px',
    fontWeight: 600,
  };

  return (
    <>
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '32px 24px' }}>
        <div className="detail-header-responsive" style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '24px',
          flexWrap: 'wrap',
          gap: '12px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
            <Link to="/prompts" style={{ color: colors.textLink, textDecoration: 'none', fontSize: '14px' }}>
              ← Back to Prompts
            </Link>
            {versions.length >= 2 && (
              <Link to={`/prompts/${id}/compare`} style={{ color: colors.textSuccess, textDecoration: 'none', fontSize: '14px' }}>
                ↔ Compare
              </Link>
            )}
          </div>
          <span style={{ color: colors.textTertiary, fontSize: '13px' }}>
            Updated {new Date(prompt.updatedAt).toLocaleString()}
          </span>
        </div>

        {/* Editor */}
        <form onSubmit={handleSave} style={{
          backgroundColor: colors.bgCard,
          borderRadius: '8px',
          padding: '24px',
          marginBottom: '24px',
          border: `1px solid ${colors.bgCardBorder}`,
        }}>
          <h2 style={{ color: colors.text, marginTop: 0, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            Edit Prompt
            {isDirty && (
              <span style={{
                backgroundColor: colors.warning,
                color: '#0d0d1a',
                fontSize: '11px',
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: '10px',
              }}>
                unsaved changes
              </span>
            )}
          </h2>
          <div className="form-grid-responsive" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '16px',
            marginBottom: '16px',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={labelStyle}>Name *</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} style={inputStyle} required />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={labelStyle}>Model</label>
              <input type="text" value={model} onChange={e => setModel(e.target.value)} placeholder={state.apiConfig?.defaultModel || 'llama3'} style={inputStyle} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={labelStyle}>Temperature</label>
              <input type="number" min="0" max="2" step="0.1" value={temperature} onChange={e => setTemperature(parseFloat(e.target.value) || 0)} style={inputStyle} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={labelStyle}>Max Tokens</label>
              <input type="number" min="1" value={maxTokens} onChange={e => setMaxTokens(parseInt(e.target.value, 10) || 1)} style={inputStyle} />
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '16px' }}>
            <label style={labelStyle}>System Prompt</label>
            <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} style={{ ...textareaStyle, minHeight: '60px' }} rows={3} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '16px' }}>
            <label style={labelStyle}>Content *</label>
            <textarea value={content} onChange={e => setContent(e.target.value)} style={{ ...textareaStyle, minHeight: '200px' }} rows={10} required />
            <span style={{ color: colors.textTertiary, fontSize: '12px', marginTop: '4px' }}>
              Use <code style={{ backgroundColor: colors.bgTertiary, padding: '2px 4px', borderRadius: '3px' }}>{'{{input}}'}</code> where the run input should go; otherwise the input is appended.
            </span>
          </div>
          <div className="action-buttons-responsive" style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Commit message (optional)"
              value={commitMessage}
              onChange={e => setCommitMessage(e.target.value)}
              style={{ ...inputStyle, flex: 1, minWidth: '200px' }}
            />
            <button
              type="submit"
              style={{
                backgroundColor: colors.accent,
                color: '#ffffff',
                border: 'none',
                padding: '10px 20px',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                opacity: isSaving || !isDirty ? 0.6 : 1,
              }}
              disabled={isSaving || !isDirty}
            >
              {isSaving ? 'Saving…' : 'Save & Commit'}
            </button>
            <button
              type="button"
              style={{
                backgroundColor: colors.bgTertiary,
                color: colors.text,
                border: 'none',
                padding: '10px 16px',
                borderRadius: '6px',
                cursor: 'pointer',
                opacity: isSaving || !isDirty ? 0.6 : 1,
              }}
              onClick={handleRevert}
              disabled={isSaving || !isDirty}
            >
              Revert
            </button>
          </div>
          {saveError && <p style={{ color: colors.textError, fontSize: '14px', margin: '12px 0 0' }}>Error: {saveError}</p>}
          {saveNotice && !saveError && <p style={{ color: colors.textSuccess, fontSize: '14px', margin: '12px 0 0' }}>{saveNotice}</p>}
        </form>

        {/* Run Panel */}
        <div style={{
          backgroundColor: colors.bgCard,
          borderRadius: '8px',
          padding: '24px',
          marginBottom: '24px',
          border: `1px solid ${colors.bgCardBorder}`,
        }}>
          <h3 style={{ color: colors.text, fontSize: '18px', marginTop: 0, marginBottom: '16px' }}>Run Prompt</h3>
          {!apiConfigured && (
            <p style={{ color: colors.textWarning, fontSize: '14px', marginTop: 0 }}>
              No API endpoint configured. <Link to="/api-config" style={{ color: colors.textLink, textDecoration: 'none' }}>Configure API →</Link>
            </p>
          )}
          <form onSubmit={handleRun} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={labelStyle}>Version</label>
              <select value={selectedVersionId} onChange={e => setSelectedVersionId(e.target.value)} style={inputStyle} disabled={versions.length === 0}>
                {versions.length === 0 ? (
                  <option value="">No versions available</option>
                ) : (
                  versions.map(v => (
                    <option key={v.id} value={v.id}>
                      v{v.versionNumber} · {v.model} · t={v.temperature}
                      {v.commitMessage ? ` — ${v.commitMessage}` : ''}
                    </option>
                  ))
                )}
              </select>
              {isDirty && (
                <span style={{ color: colors.textTertiary, fontSize: '12px', marginTop: '4px' }}>
                  Unsaved editor changes are not used — save first to run them.
                </span>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={labelStyle}>Input</label>
              <textarea
                value={runInput}
                onChange={e => setRunInput(e.target.value)}
                placeholder="Text to insert at {{input}} (optional)"
                style={{ ...textareaStyle, minHeight: '80px' }}
                rows={4}
              />
            </div>
            <button
              type="submit"
              style={{
                backgroundColor: isRunning ? colors.textTertiary : colors.accent,
                color: '#ffffff',
                border: 'none',
                padding: '10px 20px',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 600,
                alignSelf: 'flex-start',
              }}
              disabled={isRunning || !selectedVersion}
            >
              {isRunning ? 'Running…' : `Run v${selectedVersion?.versionNumber ?? '?'}`}
            </button>
          </form>

          {runError && (
            <div style={{
              backgroundColor: colors.bgError,
              borderRadius: '6px',
              padding: '12px 16px',
              marginTop: '12px',
              border: `1px solid ${colors.textError}`,
            }}>
              <p style={{ color: colors.textError, fontSize: '14px', margin: '12px 0 0' }}>Error: {runError}</p>
            </div>
          )}

          {lastRun && (
            <div style={{
              backgroundColor: colors.bgCode,
              borderRadius: '6px',
              padding: '16px',
              marginTop: '16px',
              border: `1px solid ${colors.border}`,
            }}>
              <h4 style={{ fontSize: '16px', marginTop: 0, marginBottom: '12px', color: lastRun.error ? colors.textError : colors.textSuccess }}>
                {lastRun.error ? 'Run Failed' : 'Run Result'}
              </h4>
              <div className="metrics-responsive" style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '12px' }}>
                <span style={{ color: colors.textSecondary, fontSize: '13px' }}>Model: {lastRun.model}</span>
                <span style={{ color: colors.textSecondary, fontSize: '13px' }}>Tokens: {lastRun.tokenCount}</span>
                <span style={{ color: colors.textSecondary, fontSize: '13px' }}>Latency: {lastRun.latencyMs}ms</span>
                {lastRun.cost != null && <span style={{ color: colors.textSecondary, fontSize: '13px' }}>Cost: ${lastRun.cost.toFixed(4)}</span>}
                <span style={{ color: colors.textSecondary, fontSize: '13px' }}>Time: {new Date(lastRun.createdAt).toLocaleString()}</span>
              </div>
              <div>
                <h5 style={{ color: colors.textSecondary, fontSize: '14px', fontWeight: 600, marginTop: 0, marginBottom: '8px' }}>
                  {lastRun.error ? 'Error' : 'Output'}
                </h5>
                <pre style={{
                  backgroundColor: colors.bgCodeAlt,
                  borderRadius: '4px',
                  padding: '12px',
                  color: colors.text,
                  fontSize: '14px',
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'monospace',
                  maxHeight: '400px',
                  overflowY: 'auto',
                  margin: 0,
                }}>
                  {lastRun.error || lastRun.output || '(no output)'}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Versions */}
        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ color: colors.text, fontSize: '18px', marginBottom: '16px' }}>Versions ({versions.length})</h3>
          {versions.length === 0 ? (
            <p style={{ color: colors.textSecondary }}>No versions yet. Save the prompt to create one.</p>
          ) : (
            <div className="version-list-responsive" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {versions.map(v => (
                <div key={v.id} style={{
                  backgroundColor: colors.bgCard,
                  borderRadius: '6px',
                  padding: '12px 16px',
                  borderWidth: '1px',
                  borderStyle: 'solid',
                  borderColor: v.id === selectedVersionId ? colors.accent : colors.bgCardBorder,
                }}>
                  <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ color: colors.accent, fontWeight: 600, fontSize: '14px' }}>v{v.versionNumber}</span>
                    <span style={{ color: colors.textTertiary, fontSize: '12px', fontFamily: 'monospace' }}>{v.contentHash.slice(0, 12)}</span>
                    <span style={{ color: colors.textTertiary, fontSize: '12px' }}>{new Date(v.createdAt).toLocaleString()}</span>
                    <span style={{ color: colors.textTertiary, fontSize: '12px' }}>{v.model} · t={v.temperature} · max {v.maxTokens}</span>
                    <button
                      type="button"
                      style={{
                        marginLeft: 'auto',
                        backgroundColor: colors.bgTertiary,
                        color: colors.text,
                        border: 'none',
                        padding: '4px 10px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px',
                      }}
                      onClick={() => setSelectedVersionId(v.id)}
                    >
                      Select for run
                    </button>
                  </div>
                  {v.commitMessage && <p style={{ color: colors.textSecondary, fontSize: '13px', marginTop: '4px', marginBottom: 0 }}>{v.commitMessage}</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Runs History */}
        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ color: colors.text, fontSize: '18px', marginBottom: '16px' }}>Runs ({runs.length})</h3>
          {runs.length === 0 ? (
            <p style={{ color: colors.textSecondary }}>No runs yet. Use the run panel above to execute this prompt.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {runs.map(r => (
                <div key={r.id} className="run-result-card" style={{
                  backgroundColor: colors.bgCard,
                  borderRadius: '6px',
                  padding: '12px 16px',
                  border: `1px solid ${colors.bgCardBorder}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                    <span style={{ color: colors.textTertiary, fontSize: '12px' }}>
                      v{versions.find(v => v.id === r.versionId)?.versionNumber ?? '?'} · {new Date(r.createdAt).toLocaleString()}
                    </span>
                    <span style={{ color: colors.textSecondary, fontSize: '13px' }}>
                      {r.tokenCount} tokens · {r.latencyMs}ms
                      {r.cost != null && ` · $${r.cost.toFixed(4)}`}
                    </span>
                  </div>
                  <p style={{ color: colors.textSecondary, fontSize: '13px', marginBottom: '4px', whiteSpace: 'pre-wrap', margin: 0 }}>
                    <strong>Input:</strong> {r.input.length > 200 ? r.input.substring(0, 200) + '…' : r.input}
                  </p>
                  {r.error ? (
                    <p style={{ color: colors.textError, fontSize: '13px' }}>
                      <strong>Error:</strong> {r.error}
                    </p>
                  ) : (
                    <pre style={{
                      backgroundColor: colors.bgCode,
                      borderRadius: '4px',
                      padding: '8px 12px',
                      color: colors.text,
                      fontSize: '13px',
                      whiteSpace: 'pre-wrap',
                      fontFamily: 'monospace',
                      marginTop: '4px',
                    }}>
                      {r.output?.substring(0, 200)}
                      {r.output && r.output.length > 200 ? '…' : ''}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
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
