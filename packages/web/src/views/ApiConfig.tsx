import { useState, useEffect } from 'react';
import { useStore, service } from '../store';
import type { APIConfig } from '@sentry-prompt/core';

export function ApiConfig() {
  const { state, dispatch } = useStore();
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state.apiConfig) {
      setBaseUrl(state.apiConfig.baseUrl);
      setApiKey(state.apiConfig.apiKey ?? '');
      setDefaultModel(state.apiConfig.defaultModel ?? '');
    }
  }, [state.apiConfig]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!baseUrl.trim()) return;

    const config: APIConfig = {
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim() || undefined,
      defaultModel: defaultModel.trim() || undefined,
    };

    setError(null);
    try {
      const savedConfig = await service.setAPIConfig(config);
      dispatch({ type: 'SET_API_CONFIG', payload: savedConfig });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save configuration');
    }
  }

  function handleReset() {
    // Reverts the form to the saved configuration.
    setBaseUrl(state.apiConfig?.baseUrl ?? '');
    setApiKey(state.apiConfig?.apiKey ?? '');
    setDefaultModel(state.apiConfig?.defaultModel ?? '');
    setError(null);
  }

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>API Configuration</h1>
      <p style={styles.subtitle}>
        Configure your OpenAI-compatible endpoint (Ollama, vLLM, etc.)
      </p>

      <form onSubmit={handleSave} style={styles.form}>
        <div style={styles.formGroup}>
          <label style={styles.label}>Base URL *</label>
          <input
            type="text"
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder="http://localhost:11434/v1"
            style={styles.input}
            required
          />
          <span style={styles.hint}>
            Example: http://localhost:11434/v1 (Ollama), http://localhost:8000/v1 (vLLM)
          </span>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>API Key (optional)</label>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="sk-..."
            style={styles.input}
          />
          <span style={styles.hint}>
            Required for most OpenAI-compatible servers. Leave empty for local servers like Ollama.
          </span>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Default Model</label>
          <input
            type="text"
            value={defaultModel}
            onChange={e => setDefaultModel(e.target.value)}
            placeholder="gpt-4, llama3, etc."
            style={styles.input}
          />
          <span style={styles.hint}>
            This model will be used as the default for new prompts.
          </span>
        </div>

        {error && <p style={styles.errorText}>Error: {error}</p>}

        <div style={styles.formActions}>
          <button type="submit" style={styles.saveButton}>
            {saved ? '✓ Saved!' : 'Save Configuration'}
          </button>
          <button type="button" style={styles.resetButton} onClick={handleReset}>
            Reset
          </button>
        </div>
      </form>

      {state.apiConfig && (
        <div style={styles.currentConfig}>
          <h3 style={styles.configTitle}>Current Configuration</h3>
          <div style={styles.configGrid}>
            <div style={styles.configItem}>
              <span style={styles.configLabel}>Base URL</span>
              <span style={styles.configValue}>{state.apiConfig.baseUrl}</span>
            </div>
            <div style={styles.configItem}>
              <span style={styles.configLabel}>API Key</span>
              <span style={styles.configValue}>
                {state.apiConfig.apiKey ? '••••••••' : '(not set)'}
              </span>
            </div>
            <div style={styles.configItem}>
              <span style={styles.configLabel}>Default Model</span>
              <span style={styles.configValue}>
                {state.apiConfig.defaultModel || '(not set)'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '700px',
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
    color: '#a0a0b0',
    marginBottom: '32px',
  },
  form: {
    backgroundColor: '#1a1a2e',
    borderRadius: '8px',
    padding: '24px',
    border: '1px solid #2d2d44',
  },
  formGroup: {
    marginBottom: '20px',
  },
  label: {
    display: 'block',
    color: '#a0a0b0',
    fontSize: '13px',
    fontWeight: 600,
    marginBottom: '6px',
  },
  input: {
    width: '100%',
    backgroundColor: '#0d0d1a',
    border: '1px solid #2d2d44',
    borderRadius: '4px',
    padding: '10px 12px',
    color: '#e0e0e0',
    fontSize: '14px',
    boxSizing: 'border-box',
  },
  hint: {
    display: 'block',
    color: '#606070',
    fontSize: '12px',
    marginTop: '4px',
  },
  formActions: {
    display: 'flex',
    gap: '12px',
    marginTop: '24px',
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
  errorText: {
    color: '#ef4444',
    fontSize: '14px',
    margin: '0 0 8px',
  },
  resetButton: {
    backgroundColor: '#2d2d44',
    color: '#e0e0e0',
    border: 'none',
    padding: '10px 20px',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  currentConfig: {
    marginTop: '32px',
    backgroundColor: '#1a1a2e',
    borderRadius: '8px',
    padding: '24px',
    border: '1px solid #2d2d44',
  },
  configTitle: {
    color: '#e0e0e0',
    fontSize: '16px',
    marginBottom: '16px',
  },
  configGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  configItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  configLabel: {
    color: '#a0a0b0',
    fontSize: '14px',
  },
  configValue: {
    color: '#e0e0e0',
    fontSize: '14px',
    fontFamily: 'monospace',
  },
};
