import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useStore, service } from '../store';
import type { Prompt, PromptVersion, PromptRun } from '@sentry-prompt/core';

export function PromptDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { state, dispatch } = useStore();

  const prompt = state.prompts.find(p => p.id === id);
  const versions = state.versions.filter(v => v.promptId === id);
  const runs = state.runs.filter(r => r.promptId === id);

  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [model, setModel] = useState('');
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');

  // Run panel state
  const [runInput, setRunInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<PromptRun | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string>('');

  useEffect(() => {
    if (prompt) {
      setName(prompt.name);
      setContent(prompt.content);
      setModel(prompt.model);
      setTemperature(prompt.temperature);
      setMaxTokens(prompt.maxTokens);
      setSystemPrompt(prompt.systemPrompt ?? '');
      // Set the latest version as default
      if (versions.length > 0) {
        const latestVersion = versions.sort((a, b) => b.versionNumber - a.versionNumber)[0];
        setSelectedVersionId(latestVersion.id);
      }
    }
  }, [prompt, versions]);

  if (!prompt) {
    return (
      <div style={styles.container}>
        <p style={styles.error}>Prompt not found.</p>
        <Link to="/prompts" style={styles.link}>
          ← Back to Prompts
        </Link>
      </div>
    );
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !prompt) return;

    const now = new Date().toISOString();
    const updated: Prompt = {
      id: prompt.id,
      name: name.trim(),
      content,
      model,
      temperature,
      maxTokens,
      systemPrompt: systemPrompt.trim() || undefined,
      createdAt: prompt.createdAt,
      updatedAt: now,
    };

    dispatch({ type: 'UPDATE_PROMPT', payload: updated });
    setIsEditing(false);
    setCommitMessage('');
  }

  function handleCreateVersion() {
    if (!content.trim() || !prompt) return;

    const now = new Date().toISOString();
    const versionId = crypto.randomUUID();
    const contentHash = btoa(content).slice(0, 16);

    const version: PromptVersion = {
      id: versionId,
      promptId: prompt.id,
      content,
      model,
      temperature,
      maxTokens,
      systemPrompt: systemPrompt.trim() || undefined,
      contentHash,
      versionNumber: versions.length + 1,
      createdAt: now,
      commitMessage: commitMessage.trim() || undefined,
    };

    dispatch({ type: 'ADD_VERSION', payload: version });
    setSelectedVersionId(versionId);
    setCommitMessage('');
  }

  async function handleRun(e: React.FormEvent) {
    e.preventDefault();
    if (!runInput.trim() || !prompt || !selectedVersionId) return;

    setIsRunning(true);
    setRunError(null);
    setLastRun(null);

    try {
      const run = await service.executePrompt(
        prompt.id,
        selectedVersionId,
        runInput.trim(),
      );

      setLastRun(run);
      dispatch({ type: 'ADD_RUN', payload: run });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setRunError(errorMsg);
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <Link to="/prompts" style={styles.backLink}>
          ← Back to Prompts
        </Link>
        <button
          style={styles.editButton}
          onClick={() => setIsEditing(!isEditing)}
        >
          {isEditing ? 'Cancel' : 'Edit'}
        </button>
      </div>

      {isEditing ? (
        <form onSubmit={handleSave} style={styles.form}>
          <h2 style={styles.formTitle}>Edit Prompt</h2>
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
                onChange={e => setTemperature(parseFloat(e.target.value))}
                style={styles.input}
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Max Tokens</label>
              <input
                type="number"
                min="1"
                value={maxTokens}
                onChange={e => setMaxTokens(parseInt(e.target.value))}
                style={styles.input}
              />
            </div>
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Content *</label>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              style={styles.textarea}
              rows={10}
              required
            />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>System Prompt</label>
            <textarea
              value={systemPrompt}
              onChange={e => setSystemPrompt(e.target.value)}
              style={styles.textarea}
              rows={4}
            />
          </div>
          <button type="submit" style={styles.saveButton}>
            Save Changes
          </button>
        </form>
      ) : (
        <div style={styles.detail}>
          <h2 style={styles.detailTitle}>{prompt.name}</h2>
          <div style={styles.detailMeta}>
            <span style={styles.metaItem}>Model: {prompt.model}</span>
            <span style={styles.metaItem}>Temperature: {prompt.temperature}</span>
            <span style={styles.metaItem}>Max Tokens: {prompt.maxTokens}</span>
            <span style={styles.metaItem}>
              Created: {new Date(prompt.createdAt).toLocaleString()}
            </span>
            <span style={styles.metaItem}>
              Updated: {new Date(prompt.updatedAt).toLocaleString()}
            </span>
          </div>
          {prompt.systemPrompt && (
            <div style={styles.detailSection}>
              <h3 style={styles.detailSectionTitle}>System Prompt</h3>
              <pre style={styles.detailContent}>{prompt.systemPrompt}</pre>
            </div>
          )}
          <div style={styles.detailSection}>
            <h3 style={styles.detailSectionTitle}>Content</h3>
            <pre style={styles.detailContent}>{prompt.content}</pre>
          </div>
        </div>
      )}

      {/* Run Panel */}
      <div style={styles.runSection}>
        <h3 style={styles.runTitle}>Run Prompt</h3>
        <form onSubmit={handleRun} style={styles.runForm}>
          <div style={styles.runFormGrid}>
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
                  versions
                    .sort((a, b) => b.versionNumber - a.versionNumber)
                    .map(v => (
                      <option key={v.id} value={v.id}>
                        v{v.versionNumber} ({v.contentHash})
                      </option>
                    ))
                )}
              </select>
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Input</label>
              <input
                type="text"
                value={runInput}
                onChange={e => setRunInput(e.target.value)}
                placeholder="Enter prompt input..."
                style={styles.input}
                required
              />
            </div>
          </div>
          <button
            type="submit"
            style={{
              ...styles.runButton,
              backgroundColor: isRunning ? '#606070' : '#4a9eff',
            }}
            disabled={isRunning || versions.length === 0}
          >
            {isRunning ? 'Running...' : 'Run'}
          </button>
        </form>

        {runError && (
          <div style={styles.errorBox}>
            <p style={styles.errorText}>Error: {runError}</p>
          </div>
        )}

        {lastRun && (
          <div style={styles.runResult}>
            <h4 style={styles.runResultTitle}>Run Result</h4>
            <div style={styles.runMetrics}>
              <span style={styles.metricItem}>
                Tokens: {lastRun.tokenCount}
              </span>
              <span style={styles.metricItem}>
                Latency: {lastRun.latencyMs}ms
              </span>
              {lastRun.cost !== undefined && (
                <span style={styles.metricItem}>
                  Cost: ${lastRun.cost.toFixed(4)}
                </span>
              )}
              <span style={styles.metricItem}>
                Time: {new Date(lastRun.createdAt).toLocaleString()}
              </span>
            </div>
            <div style={styles.runOutput}>
              <h5 style={styles.runOutputTitle}>Output</h5>
              <pre style={styles.runOutputContent}>
                {lastRun.output || lastRun.error || '(no output)'}
              </pre>
            </div>
          </div>
        )}
      </div>

      <div style={styles.versionsSection}>
        <h3 style={styles.versionsTitle}>
          Versions ({versions.length})
        </h3>
        {versions.length === 0 ? (
          <p style={styles.emptyText}>No versions yet. Edit the prompt and save to create a version.</p>
        ) : (
          <div style={styles.versionsList}>
            {versions
              .sort((a, b) => b.versionNumber - a.versionNumber)
              .map(v => (
                <div key={v.id} style={styles.versionItem}>
                  <div style={styles.versionHeader}>
                    <span style={styles.versionNumber}>v{v.versionNumber}</span>
                    <span style={styles.versionHash}>{v.contentHash}</span>
                    <span style={styles.versionDate}>
                      {new Date(v.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {v.commitMessage && (
                    <p style={styles.commitMessage}>{v.commitMessage}</p>
                  )}
                </div>
              ))}
          </div>
        )}
      </div>

      <div style={styles.createVersionSection}>
        <h3 style={styles.versionsTitle}>Create New Version</h3>
        <div style={styles.createVersionForm}>
          <input
            type="text"
            placeholder="Commit message (optional)"
            value={commitMessage}
            onChange={e => setCommitMessage(e.target.value)}
            style={styles.input}
          />
          <button style={styles.createVersionButton} onClick={handleCreateVersion}>
            Create Version
          </button>
        </div>
      </div>

      {/* Runs History */}
      <div style={styles.runsSection}>
        <h3 style={styles.versionsTitle}>
          Runs ({runs.length})
        </h3>
        {runs.length === 0 ? (
          <p style={styles.emptyText}>No runs yet. Use the run panel above to execute this prompt.</p>
        ) : (
          <div style={styles.runsList}>
            {runs
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              .map(r => (
                <div key={r.id} style={styles.runItem}>
                  <div style={styles.runHeader}>
                    <span style={styles.runDate}>
                      {new Date(r.createdAt).toLocaleString()}
                    </span>
                    <span style={styles.runMetrics}>
                      {r.tokenCount} tokens · {r.latencyMs}ms
                      {r.cost !== undefined && ` · $${r.cost.toFixed(4)}`}
                    </span>
                  </div>
                  <p style={styles.runInput}>
                    <strong>Input:</strong> {r.input}
                  </p>
                  {r.error ? (
                    <p style={styles.runError}>
                      <strong>Error:</strong> {r.error}
                    </p>
                  ) : (
                    <pre style={styles.runOutputPreview}>
                      {r.output?.substring(0, 200)}
                      {r.output && r.output.length > 200 ? '...' : ''}
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
  backLink: {
    color: '#4a9eff',
    textDecoration: 'none',
    fontSize: '14px',
  },
  editButton: {
    backgroundColor: '#2d2d44',
    color: '#e0e0e0',
    border: 'none',
    padding: '8px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
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
    marginBottom: '16px',
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
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
  saveButton: {
    backgroundColor: '#4a9eff',
    color: '#ffffff',
    border: 'none',
    padding: '10px 20px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  error: {
    color: '#ef4444',
    fontSize: '16px',
  },
  link: {
    color: '#4a9eff',
    textDecoration: 'none',
  },
  detail: {
    backgroundColor: '#1a1a2e',
    borderRadius: '8px',
    padding: '24px',
    marginBottom: '24px',
    border: '1px solid #2d2d44',
  },
  detailTitle: {
    color: '#ffffff',
    fontSize: '24px',
    marginBottom: '16px',
  },
  detailMeta: {
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap',
    marginBottom: '24px',
  },
  metaItem: {
    color: '#606070',
    fontSize: '13px',
  },
  detailSection: {
    marginBottom: '24px',
  },
  detailSectionTitle: {
    color: '#a0a0b0',
    fontSize: '14px',
    fontWeight: 600,
    marginBottom: '8px',
  },
  detailContent: {
    backgroundColor: '#0d0d1a',
    borderRadius: '4px',
    padding: '16px',
    color: '#e0e0e0',
    fontSize: '14px',
    whiteSpace: 'pre-wrap',
    fontFamily: 'monospace',
    overflowX: 'auto',
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
    marginBottom: '16px',
  },
  runForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  runFormGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
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
    margin: 0,
  },
  runResult: {
    backgroundColor: '#0d0d1a',
    borderRadius: '6px',
    padding: '16px',
    marginTop: '16px',
    border: '1px solid #2d2d44',
  },
  runResultTitle: {
    color: '#34d399',
    fontSize: '16px',
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
    maxHeight: '200px',
    overflowY: 'auto',
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
  // Versions styles (unchanged)
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
    border: '1px solid #2d2d44',
  },
  versionHeader: {
    display: 'flex',
    gap: '16px',
    alignItems: 'center',
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
    marginLeft: '0',
  },
  createVersionSection: {
    backgroundColor: '#1a1a2e',
    borderRadius: '8px',
    padding: '24px',
    border: '1px solid #2d2d44',
  },
  createVersionForm: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
  },
  createVersionButton: {
    backgroundColor: '#34d399',
    color: '#ffffff',
    border: 'none',
    padding: '10px 20px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 600,
  },
};
