/**
 * Webview App — full PromptSentry Workbench UI for VS Code.
 *
 * Mirrors the web app's component structure but uses the webview store
 * (which routes fetch() through the VS Code bridge). Theme support is built-in
 * via the same ThemeProvider used by the web app.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { HashRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { StoreProvider, useStore } from './webview-store';
import { ThemeProvider, useTheme } from './theme/theme';
import { useKeyboardShortcuts, usePlatformShortcuts, useToast } from './hooks/useKeyboardShortcuts';
import type { PromptRun } from '@sentry-prompt/core';
import { service } from './webview-store';

// ─── Diff highlighting helpers ────────────────────────────────────────────────

interface DiffLine {
  text: string;
  type: 'common' | 'addition' | 'deletion';
}

function computeDiffLines(textA: string, textB: string): DiffLine[] {
  const linesA = textA.split('\n');
  const linesB = textB.split('\n');
  const m = linesA.length;
  const n = linesB.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (linesA[i - 1] === linesB[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  const result: DiffLine[] = [];
  let i = m;
  let j = n;
  const stack: DiffLine[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && linesA[i - 1] === linesB[j - 1]) {
      stack.push({ text: linesA[i - 1], type: 'common' });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ text: linesB[j - 1], type: 'addition' });
      j--;
    } else {
      stack.push({ text: linesA[i - 1], type: 'deletion' });
      i--;
    }
  }
  while (stack.length > 0) {
    result.push(stack.pop()!);
  }
  return result;
}

function computeLexicalSimilarity(textA: string, textB: string): number {
  if (textA === textB) return 1.0;
  if (textA.length === 0 && textB.length === 0) return 1.0;
  if (textA.length === 0 || textB.length === 0) return 0.0;
  const bigramsA = getBigrams(textA);
  const bigramsB = getBigrams(textB);
  const intersection = new Set([...bigramsA].filter(b => bigramsB.has(b)));
  const union = new Set([...bigramsA, ...bigramsB]);
  if (union.size === 0) return 0.0;
  return intersection.size / union.size;
}

function getBigrams(text: string): Set<string> {
  const bigrams = new Set<string>();
  for (let i = 0; i < text.length - 1; i++) {
    bigrams.add(text.substring(i, i + 2));
  }
  return bigrams;
}

function computeSemanticSimilarity(textA: string, textB: string): number {
  if (textA === textB) return 1.0;
  if (textA.length === 0 && textB.length === 0) return 1.0;
  if (textA.length === 0 || textB.length === 0) return 0.0;
  const normalize = (text: string) => text.toLowerCase().replace(/[^\w\s]/g, '').trim();
  const wordsA = new Set(normalize(textA).split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(normalize(textB).split(/\s+/).filter(w => w.length > 2));
  if (wordsA.size === 0 && wordsB.size === 0) return 0.0;
  if (wordsA.size === 0 || wordsB.size === 0) return 0.0;
  const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  return intersection.size / union.size;
}

// ─── Metric bar helper ────────────────────────────────────────────────────────

function MetricBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ height: '4px', backgroundColor: 'var(--bg-metric-bar, #2d2d44)', borderRadius: '2px', overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, backgroundColor: color, borderRadius: '2px', transition: 'width 0.3s ease' }} />
    </div>
  );
}

// ─── Similarity badge ─────────────────────────────────────────────────────────

function SimilarityBadge({ score, label, colors }: { score: number; label: string; colors: import('./theme/theme').ThemeColors }) {
  const color = score >= 0.8 ? colors.textSuccess : score >= 0.5 ? colors.warning : colors.textError;
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      backgroundColor: colors.bgCode,
      borderRadius: '6px',
      padding: '8px 16px',
      border: `1px solid ${colors.border}`,
    }}>
      <span style={{ color: colors.textSecondary, fontSize: '13px', fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: '16px', fontWeight: 700, color }}>{(score * 100).toFixed(1)}%</span>
    </div>
  );
}

// ─── Diff view component ──────────────────────────────────────────────────────

function DiffView({ diff, colors }: { diff: { additions: string; deletions: string; common: string; addedLines: number; deletedLines: number; commonLines: number }; colors: import('./theme/theme').ThemeColors }) {
  const [view, setView] = useState<'unified' | 'side-by-side'>('unified');

  const renderUnified = () => (
    <div style={{
      backgroundColor: colors.bgCode,
      borderRadius: '6px',
      border: `1px solid ${colors.border}`,
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex',
        gap: '4px',
        padding: '8px 12px',
        borderBottom: `1px solid ${colors.border}`,
        backgroundColor: colors.bgDiffToolbar,
      }}>
        <button
          style={view === 'unified' ? { ...diffTabActive, backgroundColor: colors.bgTertiary, color: colors.text } : diffTab}
          onClick={() => setView('unified')}
        >
          Unified
        </button>
        <button
          style={view === 'side-by-side' ? { ...diffTabActive, backgroundColor: colors.bgTertiary, color: colors.text } : diffTab}
          onClick={() => setView('side-by-side')}
        >
          Side-by-Side
        </button>
      </div>
      <pre style={{
        padding: '16px',
        fontSize: '13px',
        fontFamily: 'monospace',
        whiteSpace: 'pre-wrap',
        maxHeight: '400px',
        overflowY: 'auto',
        lineHeight: '1.5',
        margin: 0,
      }}>
        {diff.additions && (
          <div>
            <div style={{ color: colors.textSecondary, fontSize: '12px', fontWeight: 600, marginTop: '12px', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Additions ({diff.addedLines} line{diff.addedLines !== 1 ? 's' : ''})
            </div>
            <code style={{ color: colors.textSuccess, display: 'block', padding: '8px', backgroundColor: colors.bgCodeDiffAdd, borderRadius: '4px', margin: '4px 0' }}>
              {diff.additions}
            </code>
          </div>
        )}
        {diff.deletions && (
          <div>
            <div style={{ color: colors.textSecondary, fontSize: '12px', fontWeight: 600, marginTop: '12px', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Deletions ({diff.deletedLines} line{diff.deletedLines !== 1 ? 's' : ''})
            </div>
            <code style={{ color: colors.textError, display: 'block', padding: '8px', backgroundColor: colors.bgCodeDiffDel, borderRadius: '4px', margin: '4px 0' }}>
              {diff.deletions}
            </code>
          </div>
        )}
        {diff.common && (
          <div>
            <div style={{ color: colors.textSecondary, fontSize: '12px', fontWeight: 600, marginTop: '12px', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Common ({diff.commonLines} line{diff.commonLines !== 1 ? 's' : ''})
            </div>
            <code style={{ color: colors.textSecondary, display: 'block', padding: '8px', backgroundColor: colors.bgCodeDiffCommon, borderRadius: '4px', margin: '4px 0' }}>
              {diff.common}
            </code>
          </div>
        )}
        {!diff.additions && !diff.deletions && (
          <div style={{ color: colors.textTertiary, fontStyle: 'italic', padding: '16px', textAlign: 'center' }}>No differences detected</div>
        )}
      </pre>
    </div>
  );

  const renderSideBySide = () => {
    const lines = computeDiffLines(diff.deletions || '', diff.additions || '');
    return (
      <div style={{
        backgroundColor: colors.bgCode,
        borderRadius: '6px',
        border: `1px solid ${colors.border}`,
        overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex',
          gap: '4px',
          padding: '8px 12px',
          borderBottom: `1px solid ${colors.border}`,
          backgroundColor: colors.bgDiffToolbar,
        }}>
          <button
            style={view === 'unified' ? { ...diffTabActive, backgroundColor: colors.bgTertiary, color: colors.text } : diffTab}
            onClick={() => setView('unified')}
          >
            Unified
          </button>
          <button
            style={view === 'side-by-side' ? { ...diffTabActive, backgroundColor: colors.bgTertiary, color: colors.text } : diffTab}
            onClick={() => setView('side-by-side')}
          >
            Side-by-Side
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
          <div style={{ borderRight: `1px solid ${colors.border}` }}>
            <div style={{ padding: '8px 12px', backgroundColor: colors.bgDiffHalfTitle, color: colors.textSecondary, fontSize: '12px', fontWeight: 600, borderBottom: `1px solid ${colors.border}` }}>
              Deletions
            </div>
            <pre style={{ padding: '8px 12px', maxHeight: '300px', overflowY: 'auto', fontSize: '13px', fontFamily: 'monospace', lineHeight: '1.5', margin: 0 }}>
              {lines.filter(l => l.type === 'deletion').map((l, i) => (
                <div key={`d-${i}`} style={{ display: 'flex', gap: '8px' }}>
                  <span style={{ color: colors.textTertiary, userSelect: 'none', minWidth: '24px', textAlign: 'right' }}>-{i + 1}</span>
                  <span style={{ color: colors.textError }}>{l.text}</span>
                </div>
              ))}
              {lines.filter(l => l.type === 'deletion').length === 0 && (
                <div style={{ color: colors.textTertiary, fontStyle: 'italic', padding: '16px', textAlign: 'center' }}>No deletions</div>
              )}
            </pre>
          </div>
          <div>
            <div style={{ padding: '8px 12px', backgroundColor: colors.bgDiffHalfTitle, color: colors.textSecondary, fontSize: '12px', fontWeight: 600, borderBottom: `1px solid ${colors.border}` }}>
              Additions
            </div>
            <pre style={{ padding: '8px 12px', maxHeight: '300px', overflowY: 'auto', fontSize: '13px', fontFamily: 'monospace', lineHeight: '1.5', margin: 0 }}>
              {lines.filter(l => l.type === 'addition').map((l, i) => (
                <div key={`a-${i}`} style={{ display: 'flex', gap: '8px' }}>
                  <span style={{ color: colors.textTertiary, userSelect: 'none', minWidth: '24px', textAlign: 'right' }}>+{i + 1}</span>
                  <span style={{ color: colors.textSuccess }}>{l.text}</span>
                </div>
              ))}
              {lines.filter(l => l.type === 'addition').length === 0 && (
                <div style={{ color: colors.textTertiary, fontStyle: 'italic', padding: '16px', textAlign: 'center' }}>No additions</div>
              )}
            </pre>
          </div>
        </div>
      </div>
    );
  };

  return view === 'unified' ? renderUnified() : renderSideBySide();
}

const diffTab: React.CSSProperties = {
  padding: '4px 12px',
  borderRadius: '4px',
  border: 'none',
  backgroundColor: 'transparent',
  color: 'var(--text-secondary, #a0a0b0)',
  cursor: 'pointer',
  fontSize: '12px',
};

const diffTabActive: React.CSSProperties = {
  padding: '4px 12px',
  borderRadius: '4px',
  border: 'none',
  backgroundColor: 'var(--bg-tertiary, #2d2d44)',
  color: 'var(--text, #e0e0e0)',
  cursor: 'pointer',
  fontSize: '12px',
  fontWeight: 600,
};

// ─── Navigation ───────────────────────────────────────────────────────────────

function WebviewNavigation() {
  const location = useLocation();
  const { colors, mode, toggle } = useTheme();
  const { meta, ctrl, shift } = usePlatformShortcuts();
  const { toast, showToast } = useToast();

  const navItems = [
    { path: '/', label: 'Dashboard' },
    { path: '/prompts', label: 'Prompts' },
    { path: '/runs', label: 'Runs' },
    { path: '/test-sets', label: 'Test Sets' },
    { path: '/api-config', label: 'API Config' },
  ];

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  const handleToggleTheme = useCallback(() => {
    toggle();
    showToast(mode === 'dark' ? 'Switched to light mode' : 'Switched to dark mode', 'info');
  }, [toggle, mode, showToast]);

  // Register keyboard shortcuts
  useKeyboardShortcuts([
    { combo: `${meta}+n`, action: () => window.dispatchEvent(new CustomEvent('promptsentry:new-prompt')) },
    { combo: `${meta}+k`, action: () => window.dispatchEvent(new CustomEvent('promptsentry:focus-search')) },
    { combo: `${meta}+shift+r`, action: () => window.location.reload() },
    { combo: 'escape', action: () => window.dispatchEvent(new CustomEvent('promptsentry:close-modal')) },
    { combo: `${meta}+t`, action: handleToggleTheme },
    { combo: `${meta}+h`, action: () => window.dispatchEvent(new CustomEvent('promptsentry:show-help')) },
  ]);

  return (
    <>
      <nav style={{
        backgroundColor: colors.bgNav,
        borderBottom: `1px solid ${colors.bgNavBorder}`,
        position: 'sticky',
        top: 0,
        zIndex: 100,
        transition: 'background-color 0.2s, border-color 0.2s',
      }}>
        <div style={{
          maxWidth: '1200px',
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
          height: '57px',
        }}>
          <Link to="/" style={{
            fontSize: '18px',
            fontWeight: 700,
            color: colors.text,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}>
            PromptSentry Workbench
          </Link>

          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            {navItems.map(item => (
              <Link
                key={item.path}
                to={item.path}
                style={{
                  color: isActive(item.path) ? colors.textNavActive : colors.textNavInactive,
                  textDecoration: 'none',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: isActive(item.path) ? 600 : 500,
                  backgroundColor: isActive(item.path) ? colors.bgTertiary : 'transparent',
                  transition: 'background-color 0.15s, color 0.15s',
                }}
                onMouseEnter={e => {
                  if (!isActive(item.path)) e.currentTarget.style.backgroundColor = colors.bgTertiary;
                }}
                onMouseLeave={e => {
                  if (!isActive(item.path)) e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                {item.label}
              </Link>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              onClick={handleToggleTheme}
              title={`Switch to ${mode === 'dark' ? 'light' : 'dark'} mode (${meta}+T)`}
              style={{
                background: 'none',
                border: `1px solid ${colors.border}`,
                borderRadius: '6px',
                padding: '6px 10px',
                cursor: 'pointer',
                fontSize: '16px',
                color: colors.textSecondary,
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.backgroundColor = colors.bgTertiary;
                e.currentTarget.style.color = colors.text;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = colors.textSecondary;
              }}
            >
              {mode === 'dark' ? '☀️' : '🌙'}
            </button>
          </div>
        </div>
      </nav>

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

// ─── Error Banner ─────────────────────────────────────────────────────────────

function ErrorBanner() {
  const { state } = useStore();
  const { colors } = useTheme();
  if (!state.error) return null;
  return (
    <div style={{
      backgroundColor: colors.bgError,
      borderBottom: `1px solid ${colors.textError}`,
      color: colors.textError,
      padding: '10px 24px',
      fontSize: '14px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    }}>
      {state.error}
      <button
        onClick={() => {
          window.dispatchEvent(new CustomEvent('promptsentry:clear-error'));
        }}
        style={{
          background: 'none',
          border: 'none',
          color: colors.textError,
          fontSize: '18px',
          cursor: 'pointer',
          padding: '0 4px',
        }}
      >×</button>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function WebviewDashboard() {
  const { state } = useStore();
  const { colors } = useTheme();

  const stats = [
    { label: 'Prompts', value: state.prompts.length, color: '#4a9eff' },
    { label: 'Versions', value: state.versions.length, color: '#34d399' },
    { label: 'Runs', value: state.runs.length, color: '#f59e0b' },
    { label: 'Test Sets', value: state.testSets.length, color: '#a78bfa' },
  ];

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '32px 24px' }}>
      <h1 style={{ fontSize: '28px', fontWeight: 700, color: colors.text, marginBottom: '8px' }}>Dashboard</h1>
      <p style={{ fontSize: '16px', color: colors.textSecondary, marginBottom: '32px' }}>Overview of your prompt workbench</p>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '16px',
        marginBottom: '32px',
      }}>
        {stats.map(stat => (
          <div key={stat.label} style={{
            backgroundColor: colors.bgCard,
            borderRadius: '8px',
            padding: '20px',
            textAlign: 'center',
            borderTop: `3px solid ${stat.color}`,
            border: `1px solid ${colors.bgCardBorder}`,
            transition: 'background-color 0.2s, border-color 0.2s',
          }}>
            <div style={{ fontSize: '32px', fontWeight: 700, color: colors.text }}>{stat.value}</div>
            <div style={{ fontSize: '14px', color: colors.textSecondary, marginTop: '4px' }}>{stat.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '32px', flexWrap: 'wrap' }}>
        <Link to="/prompts" style={{
          backgroundColor: colors.accent,
          color: '#ffffff',
          padding: '10px 20px',
          borderRadius: '6px',
          textDecoration: 'none',
          fontWeight: 600,
          fontSize: '14px',
          transition: 'background-color 0.15s',
        }}>
          Manage Prompts
        </Link>
        <Link to="/api-config" style={{
          backgroundColor: colors.bgTertiary,
          color: colors.text,
          padding: '10px 20px',
          borderRadius: '6px',
          textDecoration: 'none',
          fontWeight: 600,
          fontSize: '14px',
          transition: 'background-color 0.15s',
        }}>
          Configure API
        </Link>
      </div>

      {state.prompts.length === 0 && (
        <div style={{
          backgroundColor: colors.bgCard,
          borderRadius: '8px',
          padding: '32px',
          textAlign: 'center',
          border: `1px solid ${colors.bgCardBorder}`,
        }}>
          <p style={{ color: colors.textSecondary, marginBottom: '16px' }}>
            No prompts yet. Create your first prompt to get started.
          </p>
          <Link to="/prompts" style={{ color: colors.textLink, textDecoration: 'none', fontWeight: 600 }}>
            Go to Prompts →
          </Link>
        </div>
      )}
    </div>
  );
}

// ─── Prompts List ─────────────────────────────────────────────────────────────

function WebviewPromptsList() {
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
    try {
      await service.deletePrompt(id);
      dispatch({ type: 'DELETE_PROMPT', payload: id });
      showToast('Prompt deleted', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete prompt', 'error');
    }
  }

  const inputStyle: React.CSSProperties = {
    backgroundColor: colors.bgInput,
    border: `1px solid ${colors.border}`,
    borderRadius: '4px',
    padding: '8px 12px',
    color: colors.text,
    fontSize: '14px',
    transition: 'border-color 0.15s',
  };

  return (
    <>
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '32px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
          <h1 style={{ fontSize: '28px', fontWeight: 700, color: colors.text, margin: 0 }}>Prompts</h1>
          <button
            style={{ backgroundColor: colors.accent, color: '#ffffff', border: 'none', padding: '10px 20px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '14px' }}
            onClick={() => setShowCreate(!showCreate)}
          >
            {showCreate ? 'Cancel' : '+ New Prompt'}
          </button>
        </div>

        {error && (
          <div style={{ backgroundColor: colors.bgError, border: `1px solid ${colors.textError}`, borderRadius: '6px', padding: '12px 16px', marginBottom: '16px', color: colors.textError, fontSize: '14px' }}>
            Error: {error}
          </div>
        )}

        {showCreate && (
          <form onSubmit={handleCreate} style={{ backgroundColor: colors.bgCard, borderRadius: '8px', padding: '24px', marginBottom: '24px', border: `1px solid ${colors.bgCardBorder}` }}>
            <h3 style={{ color: colors.text, marginBottom: '16px' }}>Create New Prompt</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ color: colors.textSecondary, fontSize: '13px', fontWeight: 600 }}>Name *</label>
                <input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="My prompt" style={inputStyle} required />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ color: colors.textSecondary, fontSize: '13px', fontWeight: 600 }}>Model</label>
                <input type="text" value={newModel} onChange={e => setNewModel(e.target.value)} placeholder="gpt-4" style={inputStyle} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ color: colors.textSecondary, fontSize: '13px', fontWeight: 600 }}>Temperature</label>
                <input type="number" min="0" max="2" step="0.1" value={newTemperature} onChange={e => setNewTemperature(parseFloat(e.target.value))} style={inputStyle} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ color: colors.textSecondary, fontSize: '13px', fontWeight: 600 }}>Max Tokens</label>
                <input type="number" min="1" value={newMaxTokens} onChange={e => setNewMaxTokens(parseInt(e.target.value))} style={inputStyle} />
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '16px' }}>
              <label style={{ color: colors.textSecondary, fontSize: '13px', fontWeight: 600 }}>Content *</label>
              <textarea value={newContent} onChange={e => setNewContent(e.target.value)} placeholder="Enter prompt content..." style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', minHeight: '120px' }} required />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '16px' }}>
              <label style={{ color: colors.textSecondary, fontSize: '13px', fontWeight: 600 }}>System Prompt (optional)</label>
              <textarea value={newSystemPrompt} onChange={e => setNewSystemPrompt(e.target.value)} placeholder="System instructions..." style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', minHeight: '60px' }} />
            </div>
            <button type="submit" style={{ backgroundColor: colors.accent, color: '#ffffff', border: 'none', padding: '10px 20px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, marginTop: '8px', opacity: loading ? 0.6 : 1 }} disabled={loading}>
              {loading ? 'Creating...' : 'Create Prompt'}
            </button>
          </form>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '16px', flexWrap: 'wrap' }}>
          <input type="text" placeholder="Filter prompts..." value={filter} onChange={e => setFilter(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: '200px' }} />
          <span style={{ color: colors.textSecondary, fontSize: '14px', whiteSpace: 'nowrap' }}>{filteredPrompts.length} of {state.prompts.length}</span>
        </div>

        {filteredPrompts.length === 0 ? (
          <div style={{ backgroundColor: colors.bgCard, borderRadius: '8px', padding: '32px', textAlign: 'center', color: colors.textSecondary, border: `1px solid ${colors.bgCardBorder}` }}>
            {state.prompts.length === 0 ? 'No prompts yet. Create your first prompt to get started.' : 'No prompts match your filter.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {filteredPrompts.map(prompt => (
              <div key={prompt.id} style={{ backgroundColor: colors.bgCard, borderRadius: '8px', padding: '16px', border: `1px solid ${colors.bgCardBorder}`, transition: 'background-color 0.2s, border-color 0.2s' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                  <Link to={`/prompts/${prompt.id}`} style={{ color: colors.textLink, textDecoration: 'none' }}>
                    <h3 style={{ fontSize: '18px', fontWeight: 600, color: colors.text, margin: 0 }}>{prompt.name}</h3>
                  </Link>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <Link to={`/prompts/${prompt.id}`} style={{ color: colors.textLink, background: 'none', border: 'none', fontSize: '13px', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', textDecoration: 'none' }}>Edit</Link>
                    <button style={{ color: colors.textError, background: 'none', border: 'none', fontSize: '13px', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer' }} onClick={() => handleDelete(prompt.id)}>Delete</button>
                  </div>
                </div>
                <p style={{ color: colors.textSecondary, fontSize: '14px', marginBottom: '8px', whiteSpace: 'pre-wrap', margin: 0 }}>
                  {prompt.content.length > 200 ? prompt.content.substring(0, 200) + '...' : prompt.content}
                </p>
                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', color: colors.textTertiary, fontSize: '12px' }}>
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

      {toast && (
        <div className={`toast ${toast.type}`} style={{ backgroundColor: colors.bgCard, border: `1px solid ${toast.type === 'success' ? colors.success : toast.type === 'error' ? colors.danger : colors.border}`, color: colors.text }}>
          {toast.type === 'success' && '✓'}
          {toast.type === 'error' && '✕'}
          {toast.type === 'info' && 'ℹ'}
          {toast.message}
        </div>
      )}
    </>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

function WebviewApp() {
  const { colors } = useTheme();

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: colors.bg,
      color: colors.text,
      transition: 'background-color 0.2s, color 0.2s',
    }}>
      <WebviewNavigation />
      <ErrorBanner />
      <main style={{ minHeight: 'calc(100vh - 57px)' }}>
        <Routes>
          <Route path="/" element={<WebviewDashboard />} />
          <Route path="/prompts" element={<WebviewPromptsList />} />
          <Route path="/prompts/:id" element={<WebviewPromptsList />} />
          <Route path="/api-config" element={<WebviewPromptsList />} />
          <Route path="/runs" element={<WebviewPromptsList />} />
          <Route path="/prompts/:id/compare" element={<WebviewPromptsList />} />
          <Route path="/test-sets" element={<WebviewPromptsList />} />
        </Routes>
      </main>
    </div>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────

export function WebviewAppRoot() {
  return (
    <ThemeProvider>
      <StoreProvider>
        <HashRouter>
          <WebviewApp />
        </HashRouter>
      </StoreProvider>
    </ThemeProvider>
  );
}
