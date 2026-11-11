import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useStore, service } from '../store';
import type { PromptRun } from '@sentry-prompt/core';

export function PromptDetail() {
  const { id } = useParams<{ id: string }>();
  const { state, dispatch } = useStore();

  const prompt = state.prompts.find(p => p.id === id);
  const versions = useMemo(
    () => state.versions.filter(v => v.promptId === id).sort((a, b) => b.versionNumber - a.versionNumber),
    [state.versions, id],
  );
  const runs = useMemo(
    () =>
      state.runs
        .filter(r => r.promptId === id)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
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
      <div style={styles.container}>
        {state.isLoading ? (
          <p style={styles.emptyText}>Loading…</p>
        ) : (
          <p style={styles.error}>Prompt not found.</p>
        )}
        <Link to="/prompts" style={styles.link}>
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
      } else {
        setSaveNotice('Saved (no changes to version)');
      }
      setCommitMessage('');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save prompt');
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
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsRunning(false);
    }
  }

  const selectedVersion = versions.find(v => v.id === selectedVersionId);
  const apiConfigured = Boolean(state.apiConfig?.baseUrl);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <Link to="/prompts" style={styles.backLink}>
            ← Back to Prompts
          </Link>
          {versions.length >= 2 && (
            <Link to={`/prompts/${id}/compare`} style={styles.compareLink}>
              ↔ Compare
            </Link>
          )}
        </div>
        <span style={styles.metaItem}>
          Updated {new Date(prompt.updatedAt).toLocaleString()}
        </span>
      </div>

      {/* Editor */}
      <form onSubmit={handleSave} style={styles.form}>
        <h2 style={styles.formTitle}>
          Edit Prompt {isDirty && <span style={styles.dirtyBadge}>unsaved changes</span>}
        </h2>
        <div style={styles.formGrid}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              style={styles.input}
              required
            />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Model</label>
            <input
              type="text"
              value={model}
              onChange={e => setModel(e.target.value)}
              placeholder={state.apiConfig?.defaultModel || 'llama3'}
              style={styles.input}
            />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Temperature</label>
            <input
              type="number"
              min="0"
              max="2"
              step="0.1"
              value={temperature}
              onChange={e => setTemperature(parseFloat(e.target.value) || 0)}
              style={styles.input}
            />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Max Tokens</label>
            <input
              type="number"
              min="1"
              value={maxTokens}
              onChange={e => setMaxTokens(parseInt(e.target.value, 10) || 1)}
              style={styles.input}
            />
          </div>
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>System Prompt</label>
          <textarea
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            style={styles.textarea}
            rows={3}
          />
        </div>
        <div style={{ ...styles.formGroup, marginTop: '16px' }}>
          <label style={styles.label}>Content *</label>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            style={styles.textarea}
            rows={10}
            required
          />
          <span style={styles.hint}>
            Use <code>{'{{input}}'}</code> where the run input should go; otherwise the input is appended.
          </span>
        </div>
        <div style={styles.saveRow}>
          <input
            type="text"
            placeholder="Commit message (optional)"
            value={commitMessage}
            onChange={e => setCommitMessage(e.target.value)}
            style={{ ...styles.input, flex: 1 }}
          />
          <button
            type="submit"
            style={{ ...styles.saveButton, opacity: isSaving || !isDirty ? 0.6 : 1 }}
            disabled={isSaving || !isDirty}
          >
            {isSaving ? 'Saving…' : 'Save & Commit'}
          </button>
          <button
            type="button"
            style={styles.secondaryButton}
            onClick={handleRevert}
            disabled={isSaving || !isDirty}
          >
            Revert
          </button>
        </div>
        {saveError && <p style={styles.errorText}>Error: {saveError}</p>}
        {saveNotice && !saveError && <p style={styles.noticeText}>{saveNotice}</p>}
      </form>

      {/* Run Panel */}
      <div style={styles.runSection}>
        <h3 style={styles.runTitle}>Run Prompt</h3>
        {!apiConfigured && (
          <p style={styles.warningText}>
            No API endpoint configured. <Link to="/api-config" style={styles.link}>Configure API →</Link>
          </p>
        )}
        <form onSubmit={handleRun} style={styles.runForm}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Version</label>
            <select
              value={selectedVersionId}
              onChange={e => setSelectedVersionId(e.target.value)}
              style={styles.input}
              disabled={versions.length === 0}
            >
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
              <span style={styles.hint}>Unsaved editor changes are not used — save first to run them.</span>
            )}
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Input</label>
            <textarea
              value={runInput}
              onChange={e => setRunInput(e.target.value)}
              placeholder="Text to insert at {{input}} (optional)"
              style={styles.textarea}
              rows={4}
            />
          </div>
          <button
            type="submit"
            style={{
              ...styles.runButton,
              backgroundColor: isRunning ? '#606070' : '#4a9eff',
            }}
            disabled={isRunning || !selectedVersion}
          >
            {isRunning ? 'Running…' : `Run v${selectedVersion?.versionNumber ?? '?'}`}
          </button>
        </form>

        {runError && (
          <div style={styles.errorBox}>
            <p style={styles.errorText}>Error: {runError}</p>
          </div>
        )}

        {lastRun && (
          <div style={styles.runResult}>
            <h4 style={{ ...styles.runResultTitle, color: lastRun.error ? '#ef4444' : '#34d399' }}>
              {lastRun.error ? 'Run Failed' : 'Run Result'}
            </h4>
            <div style={styles.runMetrics}>
              <span style={styles.metricItem}>Model: {lastRun.model}</span>
              <span style={styles.metricItem}>Tokens: {lastRun.tokenCount}</span>
              <span style={styles.metricItem}>Latency: {lastRun.latencyMs}ms</span>
              {lastRun.cost != null && (
                <span style={styles.metricItem}>Cost: ${lastRun.cost.toFixed(4)}</span>
              )}
              <span style={styles.metricItem}>
                Time: {new Date(lastRun.createdAt).toLocaleString()}
              </span>
            </div>
            <div style={styles.runOutput}>
              <h5 style={styles.runOutputTitle}>{lastRun.error ? 'Error' : 'Output'}</h5>
              <pre style={styles.runOutputContent}>
                {lastRun.error || lastRun.output || '(no output)'}
              </pre>
            </div>
          </div>
        )}
      </div>

      {/* Versions */}
      <div style={styles.versionsSection}>
        <h3 style={styles.versionsTitle}>Versions ({versions.length})</h3>
        {versions.length === 0 ? (
          <p style={styles.emptyText}>No versions yet. Save the prompt to create one.</p>
        ) : (
          <div style={styles.versionsList}>
            {versions.map(v => (
              <div
                key={v.id}
                style={{
                  ...styles.versionItem,
                  borderColor: v.id === selectedVersionId ? '#4a9eff' : '#2d2d44',
                }}
              >
                <div style={styles.versionHeader}>
                  <span style={styles.versionNumber}>v{v.versionNumber}</span>
                  <span style={styles.versionHash}>{v.contentHash.slice(0, 12)}</span>
                  <span style={styles.versionDate}>{new Date(v.createdAt).toLocaleString()}</span>
                  <span style={styles.versionDate}>
                    {v.model} · t={v.temperature} · max {v.maxTokens}
                  </span>
                  <button
                    type="button"
                    style={styles.smallButton}
                    onClick={() => setSelectedVersionId(v.id)}
                  >
                    Select for run
                  </button>
                </div>
                {v.commitMessage && <p style={styles.commitMessage}>{v.commitMessage}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Runs History */}
      <div style={styles.runsSection}>
        <h3 style={styles.versionsTitle}>Runs ({runs.length})</h3>
        {runs.length === 0 ? (
          <p style={styles.emptyText}>No runs yet. Use the run panel above to execute this prompt.</p>
        ) : (
          <div style={styles.runsList}>
            {runs.map(r => (
              <div key={r.id} style={styles.runItem}>
                <div style={styles.runHeader}>
                  <span style={styles.runDate}>
                    v{versions.find(v => v.id === r.versionId)?.versionNumber ?? '?'} ·{' '}
                    {new Date(r.createdAt).toLocaleString()}
                  </span>
                  <span style={styles.metricItem}>
                    {r.tokenCount} tokens · {r.latencyMs}ms
                    {r.cost != null && ` · $${r.cost.toFixed(4)}`}
                  </span>
                </div>
                <p style={styles.runInput}>
                  <strong>Input:</strong> {r.input.length > 200 ? r.input.substring(0, 200) + '…' : r.input}
                </p>
                {r.error ? (
                  <p style={styles.runError}>
                    <strong>Error:</strong> {r.error}
                  </p>
                ) : (
                  <pre style={styles.runOutputPreview}>
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
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  backLink: {
    color: '#4a9eff',
    textDecoration: 'none',
    fontSize: '14px',
  },
  compareLink: {
    color: '#34d399',
    textDecoration: 'none',
    fontSize: '14px',
    marginLeft: '16px',
  },
  form: {
    backgroundColor: '#1a1a2e',
    borderRadius: '8px',
    padding: '24px',
    marginBottom: '24px',
    border: '1px solid #2d2d44',
  },
  formTitle: {
    color: '#e0e0e0',
    marginTop: 0,
    marginBottom: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  dirtyBadge: {
    backgroundColor: '#f59e0b',
    color: '#0d0d1a',
    fontSize: '11px',
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: '10px',
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '16px',
    marginBottom: '16px',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  label: {
    color: '#a0a0b0',
    fontSize: '13px',
    fontWeight: 600,
  },
  hint: {
    color: '#606070',
    fontSize: '12px',
  },
  input: {
    backgroundColor: '#0d0d1a',
    border: '1px solid #2d2d44',
    borderRadius: '4px',
    padding: '8px 12px',
    color: '#e0e0e0',
    fontSize: '14px',
  },
  textarea: {
    backgroundColor: '#0d0d1a',
    border: '1px solid #2d2d44',
    borderRadius: '4px',
    padding: '8px 12px',
    color: '#e0e0e0',
    fontSize: '14px',
    resize: 'vertical',
    fontFamily: 'monospace',
  },
  saveRow: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    marginTop: '16px',
  },
  saveButton: {
    backgroundColor: '#4a9eff',
    color: '#ffffff',
    border: 'none',
    padding: '10px 20px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  secondaryButton: {
    backgroundColor: '#2d2d44',
    color: '#e0e0e0',
    border: 'none',
    padding: '10px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  smallButton: {
    marginLeft: 'auto',
    backgroundColor: '#2d2d44',
    color: '#e0e0e0',
    border: 'none',
    padding: '4px 10px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
  },
  error: {
    color: '#ef4444',
    fontSize: '16px',
  },
  link: {
    color: '#4a9eff',
    textDecoration: 'none',
  },
  metaItem: {
    color: '#606070',
    fontSize: '13px',
  },
  noticeText: {
    color: '#34d399',
    fontSize: '14px',
    margin: '12px 0 0',
  },
  warningText: {
    color: '#f59e0b',
    fontSize: '14px',
    marginTop: 0,
  },
  // Run panel styles
  runSection: {
    backgroundColor: '#1a1a2e',
    borderRadius: '8px',
    padding: '24px',
    marginBottom: '24px',
    border: '1px solid #2d2d44',
  },
  runTitle: {
    color: '#e0e0e0',
    fontSize: '18px',
    marginTop: 0,
    marginBottom: '16px',
  },
  runForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  runButton: {
    backgroundColor: '#4a9eff',
    color: '#ffffff',
    border: 'none',
    padding: '10px 20px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 600,
    alignSelf: 'flex-start',
  },
  errorBox: {
    backgroundColor: '#2d1a1a',
    borderRadius: '6px',
    padding: '12px 16px',
    marginTop: '12px',
    border: '1px solid #ef4444',
  },
  errorText: {
    color: '#ef4444',
    fontSize: '14px',
    margin: '12px 0 0',
  },
  runResult: {
    backgroundColor: '#0d0d1a',
    borderRadius: '6px',
    padding: '16px',
    marginTop: '16px',
    border: '1px solid #2d2d44',
  },
  runResultTitle: {
    fontSize: '16px',
    marginTop: 0,
    marginBottom: '12px',
  },
  runMetrics: {
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap',
    marginBottom: '12px',
  },
  metricItem: {
    color: '#a0a0b0',
    fontSize: '13px',
  },
  runOutput: {
    marginTop: '12px',
  },
  runOutputTitle: {
    color: '#a0a0b0',
    fontSize: '14px',
    fontWeight: 600,
    marginTop: 0,
    marginBottom: '8px',
  },
  runOutputContent: {
    backgroundColor: '#1a1a2e',
    borderRadius: '4px',
    padding: '12px',
    color: '#e0e0e0',
    fontSize: '14px',
    whiteSpace: 'pre-wrap',
    fontFamily: 'monospace',
    maxHeight: '400px',
    overflowY: 'auto',
    margin: 0,
  },
  // Runs history styles
  runsSection: {
    marginBottom: '24px',
  },
  runsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  runItem: {
    backgroundColor: '#1a1a2e',
    borderRadius: '6px',
    padding: '12px 16px',
    border: '1px solid #2d2d44',
  },
  runHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  runDate: {
    color: '#606070',
    fontSize: '12px',
  },
  runInput: {
    color: '#a0a0b0',
    fontSize: '13px',
    marginBottom: '4px',
    whiteSpace: 'pre-wrap',
  },
  runError: {
    color: '#ef4444',
    fontSize: '13px',
  },
  runOutputPreview: {
    backgroundColor: '#0d0d1a',
    borderRadius: '4px',
    padding: '8px 12px',
    color: '#e0e0e0',
    fontSize: '13px',
    whiteSpace: 'pre-wrap',
    fontFamily: 'monospace',
    marginTop: '4px',
  },
  // Versions styles
  versionsSection: {
    marginBottom: '24px',
  },
  versionsTitle: {
    color: '#e0e0e0',
    fontSize: '18px',
    marginBottom: '16px',
  },
  emptyText: {
    color: '#a0a0b0',
  },
  versionsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  versionItem: {
    backgroundColor: '#1a1a2e',
    borderRadius: '6px',
    padding: '12px 16px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#2d2d44',
  },
  versionHeader: {
    display: 'flex',
    gap: '16px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  versionNumber: {
    color: '#4a9eff',
    fontWeight: 600,
    fontSize: '14px',
  },
  versionHash: {
    color: '#606070',
    fontSize: '12px',
    fontFamily: 'monospace',
  },
  versionDate: {
    color: '#606070',
    fontSize: '12px',
  },
  commitMessage: {
    color: '#a0a0b0',
    fontSize: '13px',
    marginTop: '4px',
    marginBottom: 0,
  },
};
