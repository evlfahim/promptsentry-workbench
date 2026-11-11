/**
 * Webview-specific App component for VS Code.
 * Uses state-based navigation instead of BrowserRouter since webviews
 * don't have a real URL bar.
 */
import React, { useState, useCallback } from 'react';
import { StoreProvider, useStore, service } from './webview-store';
import type { Prompt, PromptVersion, PromptRun, APIConfig, TestSet } from '@sentry-prompt/core';

// ─── Navigation types ────────────────────────────────────────────────────────

export type Route =
  | { type: 'dashboard' }
  | { type: 'prompts' }
  | { type: 'promptDetail'; promptId: string }
  | { type: 'apiConfig' }
  | { type: 'runs' }
  | { type: 'comparison'; runIdA?: string; runIdB?: string }
  | { type: 'testSets' };

// ─── Shared styles ───────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  app: {
    minHeight: '100vh',
    backgroundColor: '#0d0d1a',
    color: '#e0e0e0',
  },
  main: {
    minHeight: 'calc(100vh - 56px)',
  },
  nav: {
    backgroundColor: '#1a1a2e',
    borderBottom: '1px solid #2d2d44',
    padding: '0 24px',
    position: 'sticky',
    top: 0,
    zIndex: 100,
  },
  navInner: {
    maxWidth: '1200px',
    margin: '0 auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: '56px',
  },
  logo: {
    fontSize: '18px',
    fontWeight: 700,
    color: '#4a9eff',
  },
  navLinks: {
    display: 'flex',
    gap: '4px',
  },
  navLink: {
    backgroundColor: 'transparent',
    color: '#a0a0b0',
    border: 'none',
    padding: '8px 16px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
  },
  navLinkActive: {
    backgroundColor: '#2d2d44',
    color: '#ffffff',
    border: 'none',
    padding: '8px 16px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 600,
  },
  errorBanner: {
    backgroundColor: '#2d1a1a',
    borderBottom: '1px solid #ef4444',
    color: '#ef4444',
    padding: '10px 24px',
    fontSize: '14px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  errorClose: {
    background: 'none',
    border: 'none',
    color: '#ef4444',
    fontSize: '18px',
    cursor: 'pointer',
    padding: '0 4px',
  },
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
  subtitle: {
    fontSize: '16px',
    color: '#a0a0b0',
    marginBottom: '32px',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '16px',
    marginBottom: '32px',
  },
  statCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: '8px',
    padding: '20px',
    textAlign: 'center',
  },
  statValue: {
    fontSize: '32px',
    fontWeight: 700,
    color: '#ffffff',
  },
  statLabel: {
    fontSize: '14px',
    color: '#a0a0b0',
    marginTop: '4px',
  },
  actions: {
    display: 'flex',
    gap: '12px',
    marginBottom: '32px',
  },
  primaryButton: {
    backgroundColor: '#4a9eff',
    color: '#ffffff',
    padding: '10px 20px',
    borderRadius: '6px',
    border: 'none',
    fontWeight: 600,
    fontSize: '14px',
    cursor: 'pointer',
  },
  secondaryButton: {
    backgroundColor: '#2d2d44',
    color: '#e0e0e0',
    padding: '10px 20px',
    borderRadius: '6px',
    border: 'none',
    fontWeight: 600,
    fontSize: '14px',
    cursor: 'pointer',
  },
  emptyState: {
    backgroundColor: '#1a1a2e',
    borderRadius: '8px',
    padding: '32px',
    textAlign: 'center',
    color: '#a0a0b0',
  },
  emptyText: {
    color: '#a0a0b0',
    marginBottom: '16px',
  },
  link: {
    color: '#4a9eff',
    background: 'none',
    border: 'none',
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: '14px',
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
    gap: '16px',
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
    cursor: 'pointer',
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
    background: 'none',
    border: 'none',
    fontSize: '13px',
    padding: '4px 8px',
    borderRadius: '4px',
    cursor: 'pointer',
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
    color: '#606070',
    fontSize: '12px',
  },
  errorBox: {
    backgroundColor: '#2d1a1a',
    border: '1px solid #ef4444',
    borderRadius: '6px',
    padding: '12px 16px',
    marginBottom: '16px',
    color: '#ef4444',
    fontSize: '14px',
  },
  backButton: {
    backgroundColor: 'transparent',
    color: '#4a9eff',
    border: 'none',
    fontSize: '14px',
    cursor: 'pointer',
    marginBottom: '16px',
    padding: '0',
  },
  detailGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '24px',
    marginTop: '24px',
  },
  detailCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: '8px',
    padding: '20px',
    border: '1px solid #2d2d44',
  },
  detailTitle: {
    color: '#e0e0e0',
    marginBottom: '12px',
    fontSize: '16px',
  },
  detailContent: {
    backgroundColor: '#0d0d1a',
    padding: '12px',
    borderRadius: '4px',
    fontSize: '13px',
    whiteSpace: 'pre-wrap',
    fontFamily: 'monospace',
    color: '#e0e0e0',
    maxHeight: '200px',
    overflow: 'auto',
  },
  detailMeta: {
    display: 'flex',
    gap: '16px',
    marginTop: '12px',
    color: '#606070',
    fontSize: '12px',
  },
  versionList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  versionItem: {
    padding: '8px',
    backgroundColor: '#0d0d1a',
    borderRadius: '4px',
  },
  versionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '4px',
  },
  versionNumber: {
    color: '#4a9eff',
    fontWeight: 600,
    fontSize: '13px',
  },
  versionDate: {
    color: '#606070',
    fontSize: '12px',
  },
  versionContent: {
    color: '#a0a0b0',
    fontSize: '12px',
    whiteSpace: 'pre-wrap',
  },
  runList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  runItem: {
    padding: '8px',
    backgroundColor: '#0d0d1a',
    borderRadius: '4px',
  },
  runInput: {
    color: '#a0a0b0',
    fontSize: '12px',
    whiteSpace: 'pre-wrap',
    marginBottom: '4px',
  },
  runMeta: {
    display: 'flex',
    gap: '12px',
    color: '#606070',
    fontSize: '11px',
  },
  runDetail: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    marginTop: '8px',
  },
  runSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  runText: {
    backgroundColor: '#0d0d1a',
    padding: '8px',
    borderRadius: '4px',
    fontSize: '12px',
    whiteSpace: 'pre-wrap',
    fontFamily: 'monospace',
    color: '#e0e0e0',
    maxHeight: '150px',
    overflow: 'auto',
    margin: 0,
  },
  recentSection: {
    marginTop: '32px',
  },
  sectionTitle: {
    color: '#e0e0e0',
    marginBottom: '16px',
    fontSize: '20px',
  },
  recentItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    backgroundColor: '#1a1a2e',
    borderRadius: '8px',
    marginBottom: '8px',
    cursor: 'pointer',
    border: '1px solid #2d2d44',
  },
  recentName: {
    color: '#4a9eff',
    fontWeight: 500,
  },
  recentMeta: {
    color: '#606070',
    fontSize: '12px',
  },
};

// ─── Navigation component ────────────────────────────────────────────────────

export function Navigation() {
  const { state, dispatch } = useStore();
  const [currentRoute, setCurrentRoute] = useState<Route>({ type: 'dashboard' });

  const navigate = useCallback((route: Route) => {
    setCurrentRoute(route);
  }, []);

  const navigateToPrompt = useCallback((promptId: string) => {
    setCurrentRoute({ type: 'promptDetail', promptId });
  }, []);

  return (
    <nav style={S.nav}>
      <div style={S.navInner}>
        <span style={S.logo}>🚀 PromptSentry</span>
        <div style={S.navLinks}>
          <button
            style={currentRoute.type === 'dashboard' ? S.navLinkActive : S.navLink}
            onClick={() => navigate({ type: 'dashboard' })}
          >
            Dashboard
          </button>
          <button
            style={currentRoute.type === 'prompts' ? S.navLinkActive : S.navLink}
            onClick={() => navigate({ type: 'prompts' })}
          >
            Prompts
          </button>
          <button
            style={currentRoute.type === 'runs' ? S.navLinkActive : S.navLink}
            onClick={() => navigate({ type: 'runs' })}
          >
            Runs
          </button>
          <button
            style={currentRoute.type === 'testSets' ? S.navLinkActive : S.navLink}
            onClick={() => navigate({ type: 'testSets' })}
          >
            Test Sets
          </button>
          <button
            style={currentRoute.type === 'apiConfig' ? S.navLinkActive : S.navLink}
            onClick={() => navigate({ type: 'apiConfig' })}
          >
            API Config
          </button>
        </div>
      </div>
    </nav>
  );
}

// ─── Error Banner ────────────────────────────────────────────────────────────

export function ErrorBanner() {
  const { state, dispatch } = useStore();
  if (!state.error) return null;
  return (
    <div style={S.errorBanner}>
      {state.error}
      <button style={S.errorClose} onClick={() => dispatch({ type: 'SET_ERROR', payload: null })}>×</button>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export function App() {
  const { state, dispatch } = useStore();
  const [currentRoute, setCurrentRoute] = useState<Route>({ type: 'dashboard' });

  const navigate = useCallback((route: Route) => {
    setCurrentRoute(route);
  }, []);

  const navigateToPrompt = useCallback((promptId: string) => {
    setCurrentRoute({ type: 'promptDetail', promptId });
  }, []);

  return (
    <div style={S.app}>
      <Navigation />
      <ErrorBanner />
      <main style={S.main}>
        {currentRoute.type === 'dashboard' && <Dashboard navigate={navigate} navigateToPrompt={navigateToPrompt} />}
        {currentRoute.type === 'prompts' && <PromptsList navigate={navigateToPrompt} />}
        {currentRoute.type === 'promptDetail' && <PromptDetail promptId={currentRoute.promptId} navigate={navigate} />}
        {currentRoute.type === 'apiConfig' && <ApiConfig />}
        {currentRoute.type === 'runs' && <Runs />}
        {currentRoute.type === 'testSets' && <TestSets />}
      </main>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

interface DashboardProps {
  navigate: (route: Route) => void;
  navigateToPrompt: (promptId: string) => void;
}

export function Dashboard({ navigate, navigateToPrompt }: DashboardProps) {
  const { state } = useStore();

  const stats = [
    { label: 'Prompts', value: state.prompts.length, color: '#4a9eff' },
    { label: 'Versions', value: state.versions.length, color: '#34d399' },
    { label: 'Runs', value: state.runs.length, color: '#f59e0b' },
    { label: 'Test Sets', value: state.testSets.length, color: '#a78bfa' },
  ];

  return (
    <div style={S.container}>
      <h1 style={S.title}>Dashboard</h1>
      <p style={S.subtitle}>Overview of your prompt workbench</p>

      <div style={S.statsGrid}>
        {stats.map(stat => (
          <div key={stat.label} style={{ ...S.statCard, borderTop: `3px solid ${stat.color}` }}>
            <div style={S.statValue}>{stat.value}</div>
            <div style={S.statLabel}>{stat.label}</div>
          </div>
        ))}
      </div>

      <div style={S.actions}>
        <button style={S.primaryButton} onClick={() => navigate({ type: 'prompts' })}>
          Manage Prompts
        </button>
        <button style={S.secondaryButton} onClick={() => navigate({ type: 'apiConfig' })}>
          Configure API
        </button>
      </div>

      {/* File Watching Status */}
      <FileWatcherStatus navigate={navigate} />

      {state.prompts.length === 0 && (
        <div style={S.emptyState}>
          <p style={S.emptyText}>No prompts yet. Create your first prompt to get started.</p>
          <button style={S.link} onClick={() => navigate({ type: 'prompts' })}>
            Go to Prompts →
          </button>
        </div>
      )}

      {state.prompts.length > 0 && (
        <div style={S.recentSection}>
          <h2 style={S.sectionTitle}>Recent Prompts</h2>
          {state.prompts.slice(0, 5).map(prompt => (
            <div key={prompt.id} style={S.recentItem} onClick={() => navigateToPrompt(prompt.id)}>
              <div style={S.recentName}>{prompt.name}</div>
              <div style={S.recentMeta}>{new Date(prompt.updatedAt).toLocaleDateString()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── File Watcher Status ──────────────────────────────────────────────────────

interface FileWatcherStatusProps {
  navigate: (route: Route) => void;
}

export function FileWatcherStatus({ navigate }: FileWatcherStatusProps) {
  const { dispatch } = useStore();
  const [status, setStatus] = useState<{ watching: boolean; directory: string; fileCount: number }>({
    watching: false,
    directory: '',
    fileCount: 0,
  });
  const [showStart, setShowStart] = useState(false);
  const [newDir, setNewDir] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadStatus() {
    try {
      const s = await service.getFileWatcherStatus();
      setStatus(s);
    } catch {
      // Ignore — status will show as not watching
    }
  }

  React.useEffect(() => {
    loadStatus();
  }, []);

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    if (!newDir.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const results = await service.startFileWatcher(newDir.trim());
      setShowStart(false);
      setNewDir('');
      await loadStatus();
      if (results.created > 0 || results.updated > 0) {
        dispatch({ type: 'SET_ERROR', payload: null });
        // Refresh data
        const [prompts, versions, runs, testSets] = await Promise.all([
          service.listPrompts(),
          service.listVersions(),
          service.listRuns(),
          service.listTestSets(),
        ]);
        dispatch({ type: 'SET_PROMPTS', payload: prompts });
        dispatch({ type: 'SET_VERSIONS', payload: versions });
        dispatch({ type: 'SET_RUNS', payload: runs });
        dispatch({ type: 'SET_TEST_SETS', payload: testSets });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start file watcher');
    }
    setLoading(false);
  }

  async function handleStop() {
    if (!confirm('Stop file watching?')) return;
    try {
      await service.stopFileWatcher();
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop file watcher');
    }
  }

  const watchingStyle = {
    ...S.statCard,
    borderTop: `3px solid ${status.watching ? '#34d399' : '#ef4444'}`,
  };

  return (
    <div style={{ marginBottom: '32px' }}>
      <h2 style={{ ...S.sectionTitle, marginBottom: '16px' }}>File Watcher</h2>
      <div style={{ ...S.statCard, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: status.watching ? '#34d399' : '#ef4444' }}>
            {status.watching ? '● Watching' : '○ Not Watching'}
          </div>
          {status.watching && (
            <div style={{ fontSize: '13px', color: '#a0a0b0', marginTop: '4px' }}>
              {status.directory} — {status.fileCount} file(s) tracked
            </div>
          )}
          {!status.watching && (
            <div style={{ fontSize: '13px', color: '#a0a0b0', marginTop: '4px' }}>
              Sync .prompt files from a directory automatically
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {!status.watching && (
            <button style={S.secondaryButton} onClick={() => setShowStart(!showStart)}>
              {showStart ? 'Cancel' : '+ Start Watching'}
            </button>
          )}
          {status.watching && (
            <button style={{ ...S.secondaryButton, color: '#ef4444' }} onClick={handleStop}>
              Stop
            </button>
          )}
        </div>
      </div>

      {error && <div style={{ ...S.errorBox, marginTop: '8px' }}>{error}</div>}

      {showStart && (
        <form onSubmit={handleStart} style={{ ...S.createForm, marginTop: '12px' }}>
          <h3 style={S.formTitle}>Start File Watching</h3>
          <div style={S.formGroup}>
            <label style={S.label}>Directory Path</label>
            <input
              type="text"
              value={newDir}
              onChange={e => setNewDir(e.target.value)}
              placeholder="/path/to/prompts"
              style={S.input}
              required
            />
          </div>
          <button type="submit" style={S.submitButton} disabled={loading}>
            {loading ? 'Starting...' : 'Start Watching'}
          </button>
        </form>
      )}
    </div>
  );
}

// ─── Prompts List ─────────────────────────────────────────────────────────────

interface PromptsListProps {
  navigate: (promptId: string) => void;
}

export function PromptsList({ navigate }: PromptsListProps) {
  const { state, dispatch } = useStore();
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create prompt');
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete prompt');
    }
  }

  return (
    <div style={S.container}>
      <div style={S.header}>
        <h1 style={S.title}>Prompts</h1>
        <button style={S.createButton} onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? 'Cancel' : '+ New Prompt'}
        </button>
      </div>

      {error && <div style={S.errorBox}>Error: {error}</div>}

      {showCreate && (
        <form onSubmit={handleCreate} style={S.createForm}>
          <h3 style={S.formTitle}>Create New Prompt</h3>
          <div style={S.formGrid}>
            <div style={S.formGroup}>
              <label style={S.label}>Name *</label>
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="My prompt"
                style={S.input}
                required
              />
            </div>
            <div style={S.formGroup}>
              <label style={S.label}>Model</label>
              <input
                type="text"
                value={newModel}
                onChange={e => setNewModel(e.target.value)}
                placeholder="gpt-4"
                style={S.input}
              />
            </div>
            <div style={S.formGroup}>
              <label style={S.label}>Temperature</label>
              <input
                type="number"
                min="0"
                max="2"
                step="0.1"
                value={newTemperature}
                onChange={e => setNewTemperature(parseFloat(e.target.value))}
                style={S.input}
              />
            </div>
            <div style={S.formGroup}>
              <label style={S.label}>Max Tokens</label>
              <input
                type="number"
                min="1"
                value={newMaxTokens}
                onChange={e => setNewMaxTokens(parseInt(e.target.value))}
                style={S.input}
              />
            </div>
          </div>
          <div style={S.formGroup}>
            <label style={S.label}>Content *</label>
            <textarea
              value={newContent}
              onChange={e => setNewContent(e.target.value)}
              placeholder="Enter prompt content..."
              style={S.textarea}
              rows={6}
              required
            />
          </div>
          <div style={S.formGroup}>
            <label style={S.label}>System Prompt (optional)</label>
            <textarea
              value={newSystemPrompt}
              onChange={e => setNewSystemPrompt(e.target.value)}
              placeholder="System instructions..."
              style={S.textarea}
              rows={3}
            />
          </div>
          <button type="submit" style={S.submitButton} disabled={loading}>
            {loading ? 'Creating...' : 'Create Prompt'}
          </button>
        </form>
      )}

      <div style={S.filterBar}>
        <input
          type="text"
          placeholder="Filter prompts..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={S.filterInput}
        />
        <span style={S.count}>{filteredPrompts.length} of {state.prompts.length}</span>
      </div>

      {filteredPrompts.length === 0 ? (
        <div style={S.emptyState}>
          {state.prompts.length === 0
            ? 'No prompts yet. Create your first prompt to get started.'
            : 'No prompts match your filter.'}
        </div>
      ) : (
        <div style={S.list}>
          {filteredPrompts.map(prompt => (
            <div key={prompt.id} style={S.promptCard}>
              <div style={S.promptHeader}>
                <div style={S.promptLink} onClick={() => navigate(prompt.id)}>
                  <h3 style={S.promptName}>{prompt.name}</h3>
                </div>
                <div style={S.promptActions}>
                  <button
                    style={S.editButton}
                    onClick={() => navigate(prompt.id)}
                  >
                    Edit
                  </button>
                  <button
                    style={S.deleteButton}
                    onClick={() => handleDelete(prompt.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <p style={S.promptContent}>
                {prompt.content.length > 200
                  ? prompt.content.substring(0, 200) + '...'
                  : prompt.content}
              </p>
              <div style={S.promptMeta}>
                <span>Model: {prompt.model}</span>
                <span>Temp: {prompt.temperature}</span>
                <span>Max: {prompt.maxTokens}</span>
                <span>
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

// ─── Prompt Detail ────────────────────────────────────────────────────────────

interface PromptDetailProps {
  promptId: string;
  navigate: (route: Route) => void;
}

export function PromptDetail({ promptId, navigate }: PromptDetailProps) {
  const { state, dispatch } = useStore();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editTemperature, setEditTemperature] = useState(0.7);
  const [editMaxTokens, setEditMaxTokens] = useState(1024);
  const [editSystemPrompt, setEditSystemPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const prompt = state.prompts.find(p => p.id === promptId);
  const versions = state.versions.filter(v => v.promptId === promptId).sort((a, b) => b.versionNumber - a.versionNumber);
  const runs = state.runs.filter(r => r.promptId === promptId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (!prompt) {
    return (
      <div style={S.container}>
        <button style={S.backButton} onClick={() => navigate({ type: 'prompts' })}>← Back to Prompts</button>
        <div style={S.emptyState}>Prompt not found</div>
      </div>
    );
  }

  if (editing) {
    return (
      <div style={S.container}>
        <button style={S.backButton} onClick={() => { setEditing(false); setError(null); }}>← Cancel</button>
        <h1 style={S.title}>Edit Prompt</h1>
        {error && <div style={S.errorBox}>{error}</div>}
        <form onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setLoading(true);
          try {
            const { prompt: updated, version } = await service.updatePrompt(promptId, {
              name: editName,
              content: editContent,
              model: editModel,
              temperature: editTemperature,
              maxTokens: editMaxTokens,
              systemPrompt: editSystemPrompt || undefined,
            });
            dispatch({ type: 'UPDATE_PROMPT', payload: updated });
            if (version) dispatch({ type: 'ADD_VERSION', payload: version });
            setEditing(false);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update');
          }
          setLoading(false);
        }} style={S.createForm}>
          <div style={S.formGrid}>
            <div style={S.formGroup}>
              <label style={S.label}>Name</label>
              <input type="text" value={editName} onChange={e => setEditName(e.target.value)} style={S.input} />
            </div>
            <div style={S.formGroup}>
              <label style={S.label}>Model</label>
              <input type="text" value={editModel} onChange={e => setEditModel(e.target.value)} style={S.input} />
            </div>
            <div style={S.formGroup}>
              <label style={S.label}>Temperature</label>
              <input type="number" min="0" max="2" step="0.1" value={editTemperature} onChange={e => setEditTemperature(parseFloat(e.target.value))} style={S.input} />
            </div>
            <div style={S.formGroup}>
              <label style={S.label}>Max Tokens</label>
              <input type="number" min="1" value={editMaxTokens} onChange={e => setEditMaxTokens(parseInt(e.target.value))} style={S.input} />
            </div>
          </div>
          <div style={S.formGroup}>
            <label style={S.label}>Content</label>
            <textarea value={editContent} onChange={e => setEditContent(e.target.value)} style={S.textarea} rows={8} />
          </div>
          <div style={S.formGroup}>
            <label style={S.label}>System Prompt</label>
            <textarea value={editSystemPrompt} onChange={e => setEditSystemPrompt(e.target.value)} style={S.textarea} rows={3} />
          </div>
          <button type="submit" style={S.submitButton} disabled={loading}>
            {loading ? 'Saving...' : 'Save'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={S.container}>
      <button style={S.backButton} onClick={() => navigate({ type: 'prompts' })}>← Back to Prompts</button>
      <h1 style={S.title}>{prompt.name}</h1>
      
      <div style={S.detailGrid}>
        <div style={S.detailCard}>
          <h3 style={S.detailTitle}>Prompt</h3>
          <pre style={S.detailContent}>{prompt.content}</pre>
          <div style={S.detailMeta}>
            <span>Model: {prompt.model}</span>
            <span>Temp: {prompt.temperature}</span>
            <span>Max: {prompt.maxTokens}</span>
          </div>
          <button style={S.editButton} onClick={() => {
            setEditName(prompt.name);
            setEditContent(prompt.content);
            setEditModel(prompt.model);
            setEditTemperature(prompt.temperature);
            setEditMaxTokens(prompt.maxTokens);
            setEditSystemPrompt(prompt.systemPrompt || '');
            setEditing(true);
          }}>Edit</button>
        </div>

        <div style={S.detailCard}>
          <h3 style={S.detailTitle}>Versions ({versions.length})</h3>
          {versions.length === 0 ? (
            <p style={S.emptyText}>No versions yet</p>
          ) : (
            <div style={S.versionList}>
              {versions.map(v => (
                <div key={v.id} style={S.versionItem}>
                  <div style={S.versionHeader}>
                    <span style={S.versionNumber}>v{v.versionNumber}</span>
                    <span style={S.versionDate}>{new Date(v.createdAt).toLocaleDateString()}</span>
                  </div>
                  <div style={S.versionContent}>{v.content.substring(0, 100)}...</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={S.detailCard}>
          <h3 style={S.detailTitle}>Runs ({runs.length})</h3>
          {runs.length === 0 ? (
            <p style={S.emptyText}>No runs yet</p>
          ) : (
            <div style={S.runList}>
              {runs.slice(0, 10).map(r => (
                <div key={r.id} style={S.runItem}>
                  <div style={S.runInput}>{r.input.substring(0, 80)}...</div>
                  <div style={S.runMeta}>
                    <span>{r.latencyMs}ms</span>
                    <span>{r.tokenCount} tokens</span>
                    {r.error && <span style={{ color: '#ef4444' }}>Error</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── API Config ───────────────────────────────────────────────────────────────

export function ApiConfig() {
  const { state, dispatch } = useStore();
  const [baseUrl, setBaseUrl] = useState(state.apiConfig?.baseUrl || '');
  const [apiKey, setApiKey] = useState(state.apiConfig?.apiKey || '');
  const [defaultModel, setDefaultModel] = useState(state.apiConfig?.defaultModel || '');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setLoading(true);
    try {
      const config = await service.setAPIConfig({
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim() || undefined,
        defaultModel: defaultModel.trim() || undefined,
      });
      dispatch({ type: 'SET_API_CONFIG', payload: config });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
    setLoading(false);
  }

  return (
    <div style={S.container}>
      <h1 style={S.title}>API Configuration</h1>
      <p style={S.subtitle}>Configure your OpenAI-compatible endpoint</p>
      
      {error && <div style={S.errorBox}>{error}</div>}
      {success && <div style={{ ...S.errorBox, borderColor: '#34d399', color: '#34d399', backgroundColor: '#1a2e1a' }}>Configuration saved successfully!</div>}

      <form onSubmit={handleSave} style={S.createForm}>
        <div style={S.formGroup}>
          <label style={S.label}>Base URL *</label>
          <input
            type="text"
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder="http://localhost:11434/v1"
            style={S.input}
            required
          />
        </div>
        <div style={S.formGroup}>
          <label style={S.label}>API Key (optional)</label>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="sk-..."
            style={S.input}
          />
        </div>
        <div style={S.formGroup}>
          <label style={S.label}>Default Model</label>
          <input
            type="text"
            value={defaultModel}
            onChange={e => setDefaultModel(e.target.value)}
            placeholder="llama3"
            style={S.input}
          />
        </div>
        <button type="submit" style={S.submitButton} disabled={loading}>
          {loading ? 'Saving...' : 'Save Configuration'}
        </button>
      </form>
    </div>
  );
}

// ─── Runs ─────────────────────────────────────────────────────────────────────

export function Runs() {
  const { state } = useStore();
  const [filter, setFilter] = useState('');
  const [selectedPromptId, setSelectedPromptId] = useState<string>('');

  const filteredRuns = state.runs
    .filter(r => {
      if (selectedPromptId && r.promptId !== selectedPromptId) return false;
      if (filter && !r.input.toLowerCase().includes(filter.toLowerCase()) && !r.output?.toLowerCase().includes(filter.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div style={S.container}>
      <h1 style={S.title}>Runs</h1>
      
      <div style={S.filterBar}>
        <input
          type="text"
          placeholder="Filter runs..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={S.filterInput}
        />
        <select
          value={selectedPromptId}
          onChange={e => setSelectedPromptId(e.target.value)}
          style={S.input}
        >
          <option value="">All Prompts</option>
          {state.prompts.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {filteredRuns.length === 0 ? (
        <div style={S.emptyState}>No runs found</div>
      ) : (
        <div style={S.list}>
          {filteredRuns.map(run => (
            <div key={run.id} style={S.promptCard}>
              <div style={S.promptHeader}>
                <div style={S.promptName}>
                  {state.prompts.find(p => p.id === run.promptId)?.name || 'Unknown Prompt'}
                </div>
                <div style={S.promptMeta}>
                  <span>{run.latencyMs}ms</span>
                  <span>{run.tokenCount} tokens</span>
                  {run.error && <span style={{ color: '#ef4444' }}>Error</span>}
                </div>
              </div>
              <div style={S.runDetail}>
                <div style={S.runSection}>
                  <strong>Input:</strong>
                  <pre style={S.runText}>{run.input}</pre>
                </div>
                <div style={S.runSection}>
                  <strong>Output:</strong>
                  <pre style={S.runText}>{run.output || 'No output'}</pre>
                </div>
              </div>
              <div style={S.promptMeta}>
                <span>Model: {run.model}</span>
                <span>Created: {new Date(run.createdAt).toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Test Sets ────────────────────────────────────────────────────────────────

export function TestSets() {
  const { state, dispatch } = useStore();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newInputs, setNewInputs] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;

    setError(null);
    setLoading(true);
    try {
      const inputs = newInputs.split('\n').map(s => s.trim()).filter(s => s.length > 0);
      const testSet = await service.createTestSet({
        name: newName.trim(),
        description: newDescription.trim() || undefined,
        inputs,
      });
      dispatch({ type: 'SET_TEST_SETS', payload: [...state.testSets, testSet] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create test set');
    }
    setLoading(false);
    setShowCreate(false);
    setNewName('');
    setNewDescription('');
    setNewInputs('');
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this test set?')) return;
    try {
      await service.deleteTestSet(id);
      dispatch({ type: 'SET_TEST_SETS', payload: state.testSets.filter(ts => ts.id !== id) });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  }

  return (
    <div style={S.container}>
      <div style={S.header}>
        <h1 style={S.title}>Test Sets</h1>
        <button style={S.createButton} onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? 'Cancel' : '+ New Test Set'}
        </button>
      </div>

      {error && <div style={S.errorBox}>{error}</div>}

      {showCreate && (
        <form onSubmit={handleCreate} style={S.createForm}>
          <h3 style={S.formTitle}>Create Test Set</h3>
          <div style={S.formGroup}>
            <label style={S.label}>Name *</label>
            <input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="My test set" style={S.input} required />
          </div>
          <div style={S.formGroup}>
            <label style={S.label}>Description</label>
            <input type="text" value={newDescription} onChange={e => setNewDescription(e.target.value)} placeholder="Optional description" style={S.input} />
          </div>
          <div style={S.formGroup}>
            <label style={S.label}>Inputs (one per line) *</label>
            <textarea value={newInputs} onChange={e => setNewInputs(e.target.value)} placeholder={"Test input 1\nTest input 2\nTest input 3"} style={S.textarea} rows={6} required />
          </div>
          <button type="submit" style={S.submitButton} disabled={loading}>
            {loading ? 'Creating...' : 'Create Test Set'}
          </button>
        </form>
      )}

      {state.testSets.length === 0 ? (
        <div style={S.emptyState}>No test sets yet. Create your first test set to run batch comparisons.</div>
      ) : (
        <div style={S.list}>
          {state.testSets.map(ts => (
            <div key={ts.id} style={S.promptCard}>
              <div style={S.promptHeader}>
                <h3 style={S.promptName}>{ts.name}</h3>
                <button style={S.deleteButton} onClick={() => handleDelete(ts.id)}>Delete</button>
              </div>
              {ts.description && <p style={S.promptContent}>{ts.description}</p>}
              <div style={S.promptMeta}>
                <span>{ts.inputs.length} inputs</span>
                <span>Created: {new Date(ts.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
