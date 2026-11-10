import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store';
import type { Prompt } from '@sentry-prompt/core';

export function PromptsList() {
  const { state, dispatch } = useStore();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newModel, setNewModel] = useState('gpt-4');
  const [newTemperature, setNewTemperature] = useState(0.7);
  const [newMaxTokens, setNewMaxTokens] = useState(1024);
  const [newSystemPrompt, setNewSystemPrompt] = useState('');
  const [filter, setFilter] = useState('');

  const filteredPrompts = state.prompts.filter(p =>
    p.name.toLowerCase().includes(filter.toLowerCase()) ||
    p.content.toLowerCase().includes(filter.toLowerCase())
  );

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;

    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const prompt: Prompt = {
      id,
      name: newName.trim(),
      content: newContent.trim(),
      model: newModel,
      temperature: newTemperature,
      maxTokens: newMaxTokens,
      systemPrompt: newSystemPrompt.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };

    dispatch({ type: 'ADD_PROMPT', payload: prompt });
    setShowCreate(false);
    setNewName('');
    setNewContent('');
    setNewModel('gpt-4');
    setNewTemperature(0.7);
    setNewMaxTokens(1024);
    setNewSystemPrompt('');
  }

  function handleDelete(id: string) {
    if (confirm('Delete this prompt? This cannot be undone.')) {
      dispatch({ type: 'DELETE_PROMPT', payload: id });
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Prompts</h1>
        <button style={styles.createButton} onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? 'Cancel' : '+ New Prompt'}
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} style={styles.createForm}>
          <h3 style={styles.formTitle}>Create New Prompt</h3>
          <div style={styles.formGrid}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Name *</label>
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="My prompt"
                style={styles.input}
                required
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Model</label>
              <input
                type="text"
                value={newModel}
                onChange={e => setNewModel(e.target.value)}
                placeholder="gpt-4"
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
                value={newTemperature}
                onChange={e => setNewTemperature(parseFloat(e.target.value))}
                style={styles.input}
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Max Tokens</label>
              <input
                type="number"
                min="1"
                value={newMaxTokens}
                onChange={e => setNewMaxTokens(parseInt(e.target.value))}
                style={styles.input}
              />
            </div>
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Content *</label>
            <textarea
              value={newContent}
              onChange={e => setNewContent(e.target.value)}
              placeholder="Enter prompt content..."
              style={styles.textarea}
              rows={6}
              required
            />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>System Prompt (optional)</label>
            <textarea
              value={newSystemPrompt}
              onChange={e => setNewSystemPrompt(e.target.value)}
              placeholder="System instructions..."
              style={styles.textarea}
              rows={3}
            />
          </div>
          <button type="submit" style={styles.submitButton}>
            Create Prompt
          </button>
        </form>
      )}

      <div style={styles.filterBar}>
        <input
          type="text"
          placeholder="Filter prompts..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={styles.filterInput}
        />
        <span style={styles.count}>{filteredPrompts.length} of {state.prompts.length}</span>
      </div>

      {filteredPrompts.length === 0 ? (
        <div style={styles.emptyState}>
          {state.prompts.length === 0
            ? 'No prompts yet. Create your first prompt to get started.'
            : 'No prompts match your filter.'}
        </div>
      ) : (
        <div style={styles.list}>
          {filteredPrompts.map(prompt => (
            <div key={prompt.id} style={styles.promptCard}>
              <div style={styles.promptHeader}>
                <Link to={`/prompts/${prompt.id}`} style={styles.promptLink}>
                  <h3 style={styles.promptName}>{prompt.name}</h3>
                </Link>
                <div style={styles.promptActions}>
                  <Link to={`/prompts/${prompt.id}`} style={styles.editButton}>
                    Edit
                  </Link>
                  <button
                    style={styles.deleteButton}
                    onClick={() => handleDelete(prompt.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <p style={styles.promptContent}>
                {prompt.content.length > 200
                  ? prompt.content.substring(0, 200) + '...'
                  : prompt.content}
              </p>
              <div style={styles.promptMeta}>
                <span style={styles.metaItem}>Model: {prompt.model}</span>
                <span style={styles.metaItem}>Temp: {prompt.temperature}</span>
                <span style={styles.metaItem}>Max: {prompt.maxTokens}</span>
                <span style={styles.metaItem}>
                  Created: {new Date(prompt.createdAt).toLocaleDateString()}
                </span>
              </div>
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
  submitButton: {
    backgroundColor: '#4a9eff',
    color: '#ffffff',
    border: 'none',
    padding: '10px 20px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 600,
    marginTop: '8px',
  },
  filterBar: {
    display: 'flex',
    justifyContent: 'space-between',
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
    marginRight: '16px',
  },
  count: {
    color: '#a0a0b0',
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
  },
  promptCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: '8px',
    padding: '16px',
    border: '1px solid #2d2d44',
  },
  promptHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '8px',
  },
  promptLink: {
    color: '#4a9eff',
    textDecoration: 'none',
  },
  promptName: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#ffffff',
    margin: 0,
  },
  promptActions: {
    display: 'flex',
    gap: '8px',
  },
  editButton: {
    color: '#4a9eff',
    textDecoration: 'none',
    fontSize: '13px',
    padding: '4px 8px',
    borderRadius: '4px',
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
  promptContent: {
    color: '#a0a0b0',
    fontSize: '14px',
    marginBottom: '8px',
    whiteSpace: 'pre-wrap',
  },
  promptMeta: {
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap',
  },
  metaItem: {
    color: '#606070',
    fontSize: '12px',
  },
};
