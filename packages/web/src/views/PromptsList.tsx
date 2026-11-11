import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useStore, service } from '../store';
import { useTheme } from '../theme';
import { useKeyboardShortcuts, useToast } from '../hooks/useKeyboardShortcuts';

export function PromptsList() {
  const { state, dispatch } = useStore();
  const { colors } = useTheme();
  const { toast, showToast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newModel, setNewModel] = useState('gpt-4');
  const [newTemperature, setNewTemperature] = useState(0.7);
  const [newMaxTokens, setNewMaxTokens] = useState(1024);
  const [newSystemPrompt, setNewSystemPrompt] = useState('');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Listen for keyboard shortcut events
  useEffect(() => {
    function handleNewPrompt() { setShowCreate(true); }
    function handleFocusSearch() {
      const input = document.querySelector<HTMLInputElement>('input[placeholder="Filter prompts..."]');
      input?.focus();
    }
    window.addEventListener('promptsentry:new-prompt', handleNewPrompt);
    window.addEventListener('promptsentry:focus-search', handleFocusSearch);
    return () => {
      window.removeEventListener('promptsentry:new-prompt', handleNewPrompt);
      window.removeEventListener('promptsentry:focus-search', handleFocusSearch);
    };
  }, []);

  const filteredPrompts = state.prompts.filter(p =>
    p.name.toLowerCase().includes(filter.toLowerCase()) ||
    p.content.toLowerCase().includes(filter.toLowerCase())
  );

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;

    setError(null);
    setLoading(true);
    try {
      const { prompt, version } = await service.createPrompt({
        name: newName.trim(),
        content: newContent.trim(),
        model: newModel.trim() || state.apiConfig?.defaultModel || 'gpt-4',
        temperature: newTemperature,
        maxTokens: newMaxTokens,
        systemPrompt: newSystemPrompt.trim() || undefined,
      });
      dispatch({ type: 'ADD_PROMPT', payload: prompt });
      if (version) dispatch({ type: 'ADD_VERSION', payload: version });
      showToast('Prompt created successfully', 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create prompt');
      showToast('Failed to create prompt', 'error');
      setLoading(false);
      return;
    }

    setShowCreate(false);
    setNewName('');
    setNewContent('');
    setNewModel('gpt-4');
    setNewTemperature(0.7);
    setNewMaxTokens(1024);
    setNewSystemPrompt('');
    setLoading(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this prompt? This cannot be undone.')) return;
    setError(null);
    try {
      await service.deletePrompt(id);
      dispatch({ type: 'DELETE_PROMPT', payload: id });
      showToast('Prompt deleted', 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete prompt');
      showToast('Failed to delete prompt', 'error');
    }
  }

  return (
    <>
      <div style={{
        maxWidth: '900px',
        margin: '0 auto',
        padding: '32px 24px',
      }}>
        <div className="header-responsive" style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '24px',
          flexWrap: 'wrap',
          gap: '12px',
        }}>
          <h1 style={{ fontSize: '28px', fontWeight: 700, color: colors.text, margin: 0 }}>Prompts</h1>
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
              transition: 'background-color 0.15s',
            }}
            onClick={() => setShowCreate(!showCreate)}
          >
            {showCreate ? 'Cancel' : '+ New Prompt'}
          </button>
        </div>

        {error && (
          <div style={{
            backgroundColor: colors.bgError,
            border: `1px solid ${colors.textError}`,
            borderRadius: '6px',
            padding: '12px 16px',
            marginBottom: '16px',
            color: colors.textError,
            fontSize: '14px',
          }}>
            Error: {error}
          </div>
        )}

        {showCreate && (
          <form onSubmit={handleCreate} style={{
            backgroundColor: colors.bgCard,
            borderRadius: '8px',
            padding: '24px',
            marginBottom: '24px',
            border: `1px solid ${colors.bgCardBorder}`,
          }}>
            <h3 style={{ color: colors.text, marginBottom: '16px' }}>Create New Prompt</h3>
            <div className="form-grid-responsive" style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '16px',
              marginBottom: '16px',
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ color: colors.textSecondary, fontSize: '13px', fontWeight: 600 }}>Name *</label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="My prompt"
                  style={{
                    backgroundColor: colors.bgInput,
                    border: `1px solid ${colors.border}`,
                    borderRadius: '4px',
                    padding: '8px 12px',
                    color: colors.text,
                    fontSize: '14px',
                    transition: 'border-color 0.15s',
                  }}
                  required
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ color: colors.textSecondary, fontSize: '13px', fontWeight: 600 }}>Model</label>
                <input
                  type="text"
                  value={newModel}
                  onChange={e => setNewModel(e.target.value)}
                  placeholder="gpt-4"
                  style={{
                    backgroundColor: colors.bgInput,
                    border: `1px solid ${colors.border}`,
                    borderRadius: '4px',
                    padding: '8px 12px',
                    color: colors.text,
                    fontSize: '14px',
                  }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ color: colors.textSecondary, fontSize: '13px', fontWeight: 600 }}>Temperature</label>
                <input
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  value={newTemperature}
                  onChange={e => setNewTemperature(parseFloat(e.target.value))}
                  style={{
                    backgroundColor: colors.bgInput,
                    border: `1px solid ${colors.border}`,
                    borderRadius: '4px',
                    padding: '8px 12px',
                    color: colors.text,
                    fontSize: '14px',
                  }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ color: colors.textSecondary, fontSize: '13px', fontWeight: 600 }}>Max Tokens</label>
                <input
                  type="number"
                  min="1"
                  value={newMaxTokens}
                  onChange={e => setNewMaxTokens(parseInt(e.target.value))}
                  style={{
                    backgroundColor: colors.bgInput,
                    border: `1px solid ${colors.border}`,
                    borderRadius: '4px',
                    padding: '8px 12px',
                    color: colors.text,
                    fontSize: '14px',
                  }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '16px' }}>
              <label style={{ color: colors.textSecondary, fontSize: '13px', fontWeight: 600 }}>Content *</label>
              <textarea
                value={newContent}
                onChange={e => setNewContent(e.target.value)}
                placeholder="Enter prompt content..."
                style={{
                  backgroundColor: colors.bgInput,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '4px',
                  padding: '8px 12px',
                  color: colors.text,
                  fontSize: '14px',
                  resize: 'vertical',
                  fontFamily: 'monospace',
                  minHeight: '120px',
                }}
                required
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '16px' }}>
              <label style={{ color: colors.textSecondary, fontSize: '13px', fontWeight: 600 }}>System Prompt (optional)</label>
              <textarea
                value={newSystemPrompt}
                onChange={e => setNewSystemPrompt(e.target.value)}
                placeholder="System instructions..."
                style={{
                  backgroundColor: colors.bgInput,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '4px',
                  padding: '8px 12px',
                  color: colors.text,
                  fontSize: '14px',
                  resize: 'vertical',
                  fontFamily: 'monospace',
                  minHeight: '60px',
                }}
              />
            </div>
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
                marginTop: '8px',
                opacity: loading ? 0.6 : 1,
              }}
              disabled={loading}
            >
              {loading ? 'Creating...' : 'Create Prompt'}
            </button>
          </form>
        )}

        <div className="filter-responsive" style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
          gap: '16px',
          flexWrap: 'wrap',
        }}>
          <input
            type="text"
            placeholder="Filter prompts..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{
              backgroundColor: colors.bgInput,
              border: `1px solid ${colors.border}`,
              borderRadius: '4px',
              padding: '8px 12px',
              color: colors.text,
              fontSize: '14px',
              flex: 1,
              minWidth: '200px',
              transition: 'border-color 0.15s',
            }}
          />
          <span style={{ color: colors.textSecondary, fontSize: '14px', whiteSpace: 'nowrap' }}>
            {filteredPrompts.length} of {state.prompts.length}
          </span>
        </div>

        {filteredPrompts.length === 0 ? (
          <div style={{
            backgroundColor: colors.bgCard,
            borderRadius: '8px',
            padding: '32px',
            textAlign: 'center',
            color: colors.textSecondary,
            border: `1px solid ${colors.bgCardBorder}`,
          }}>
            {state.prompts.length === 0
              ? 'No prompts yet. Create your first prompt to get started.'
              : 'No prompts match your filter.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {filteredPrompts.map(prompt => (
              <div key={prompt.id} className="prompt-card-hover" style={{
                backgroundColor: colors.bgCard,
                borderRadius: '8px',
                padding: '16px',
                border: `1px solid ${colors.bgCardBorder}`,
                transition: 'background-color 0.2s, border-color 0.2s',
              }}>
                <div className="prompt-list-item" style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: '8px',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}>
                  <Link to={`/prompts/${prompt.id}`} style={{
                    color: colors.textLink,
                    textDecoration: 'none',
                  }}>
                    <h3 style={{ fontSize: '18px', fontWeight: 600, color: colors.text, margin: 0 }}>
                      {prompt.name}
                    </h3>
                  </Link>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <Link to={`/prompts/${prompt.id}`} style={{
                      color: colors.textLink,
                      background: 'none',
                      border: 'none',
                      fontSize: '13px',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      textDecoration: 'none',
                    }}>
                      Edit
                    </Link>
                    <button
                      style={{
                        color: colors.textError,
                        background: 'none',
                        border: 'none',
                        fontSize: '13px',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                      }}
                      onClick={() => handleDelete(prompt.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <p style={{
                  color: colors.textSecondary,
                  fontSize: '14px',
                  marginBottom: '8px',
                  whiteSpace: 'pre-wrap',
                  margin: 0,
                }}>
                  {prompt.content.length > 200
                    ? prompt.content.substring(0, 200) + '...'
                    : prompt.content}
                </p>
                <div style={{
                  display: 'flex',
                  gap: '16px',
                  flexWrap: 'wrap',
                  color: colors.textTertiary,
                  fontSize: '12px',
                }}>
                  <span>Model: {prompt.model}</span>
                  <span>Temp: {prompt.temperature}</span>
                  <span>Max: {prompt.maxTokens}</span>
                  <span>Created: {new Date(prompt.createdAt).toLocaleDateString()}</span>
                </div>
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
