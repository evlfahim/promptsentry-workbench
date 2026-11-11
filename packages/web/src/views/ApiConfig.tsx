import { useState, useEffect } from 'react';
import { useStore, service } from '../store';
import { useTheme } from '../theme';
import type { APIConfig } from '@sentry-prompt/core';

export function ApiConfig() {
  const { state, dispatch } = useStore();
  const { colors } = useTheme();
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
    setBaseUrl(state.apiConfig?.baseUrl ?? '');
    setApiKey(state.apiConfig?.apiKey ?? '');
    setDefaultModel(state.apiConfig?.defaultModel ?? '');
    setError(null);
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    backgroundColor: colors.bgInput,
    border: `1px solid ${colors.border}`,
    borderRadius: '4px',
    padding: '10px 12px',
    color: colors.text,
    fontSize: '14px',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s',
  };

  return (
    <div style={{ maxWidth: '700px', margin: '0 auto', padding: '32px 24px' }}>
      <h1 style={{ fontSize: '28px', fontWeight: 700, color: colors.text, marginBottom: '8px' }}>API Configuration</h1>
      <p style={{ color: colors.textSecondary, marginBottom: '32px' }}>
        Configure your OpenAI-compatible endpoint (Ollama, vLLM, etc.)
      </p>

      <form onSubmit={handleSave} style={{
        backgroundColor: colors.bgCard,
        borderRadius: '8px',
        padding: '24px',
        border: `1px solid ${colors.bgCardBorder}`,
      }}>
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', color: colors.textSecondary, fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>Base URL *</label>
          <input
            type="text"
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder="http://localhost:11434/v1"
            style={inputStyle}
            required
          />
          <span style={{ display: 'block', color: colors.textTertiary, fontSize: '12px', marginTop: '4px' }}>
            Example: http://localhost:11434/v1 (Ollama), http://localhost:8000/v1 (vLLM)
          </span>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', color: colors.textSecondary, fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>API Key (optional)</label>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="sk-..."
            style={inputStyle}
          />
          <span style={{ display: 'block', color: colors.textTertiary, fontSize: '12px', marginTop: '4px' }}>
            Required for most OpenAI-compatible servers. Leave empty for local servers like Ollama.
          </span>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', color: colors.textSecondary, fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>Default Model</label>
          <input
            type="text"
            value={defaultModel}
            onChange={e => setDefaultModel(e.target.value)}
            placeholder="gpt-4, llama3, etc."
            style={inputStyle}
          />
          <span style={{ display: 'block', color: colors.textTertiary, fontSize: '12px', marginTop: '4px' }}>
            This model will be used as the default for new prompts.
          </span>
        </div>

        {error && <p style={{ color: colors.textError, fontSize: '14px', margin: '0 0 8px' }}>Error: {error}</p>}

        <div className="action-buttons-responsive" style={{ display: 'flex', gap: '12px', marginTop: '24px', flexWrap: 'wrap' }}>
          <button type="submit" style={{
            backgroundColor: colors.accent,
            color: '#ffffff',
            border: 'none',
            padding: '10px 20px',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: 600,
          }}>
            {saved ? '✓ Saved!' : 'Save Configuration'}
          </button>
          <button type="button" style={{
            backgroundColor: colors.bgTertiary,
            color: colors.text,
            border: 'none',
            padding: '10px 20px',
            borderRadius: '6px',
            cursor: 'pointer',
          }} onClick={handleReset}>
            Reset
          </button>
        </div>
      </form>

      {state.apiConfig && (
        <div style={{
          marginTop: '32px',
          backgroundColor: colors.bgCard,
          borderRadius: '8px',
          padding: '24px',
          border: `1px solid ${colors.bgCardBorder}`,
        }}>
          <h3 style={{ color: colors.text, fontSize: '16px', marginBottom: '16px' }}>Current Configuration</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <span style={{ color: colors.textSecondary, fontSize: '14px' }}>Base URL</span>
              <span style={{ color: colors.text, fontSize: '14px', fontFamily: 'monospace' }}>{state.apiConfig.baseUrl}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <span style={{ color: colors.textSecondary, fontSize: '14px' }}>API Key</span>
              <span style={{ color: colors.text, fontSize: '14px', fontFamily: 'monospace' }}>
                {state.apiConfig.apiKey ? '••••••••' : '(not set)'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <span style={{ color: colors.textSecondary, fontSize: '14px' }}>Default Model</span>
              <span style={{ color: colors.text, fontSize: '14px', fontFamily: 'monospace' }}>
                {state.apiConfig.defaultModel || '(not set)'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
