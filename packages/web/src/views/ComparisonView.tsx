import { useState, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useStore, service } from '../store';
import { useTheme } from '../theme';
import { useToast } from '../hooks/useKeyboardShortcuts';
import type { ComparisonResult, LexicalDiff, PromptRun, PromptVersion } from '@sentry-prompt/core';

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

function SimilarityBadge({ score, label, colors }: { score: number; label: string; colors: import('../theme').ThemeColors }) {
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

function DiffView({ diff, colors }: { diff: LexicalDiff; colors: import('../theme').ThemeColors }) {
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
        <div className="diff-side-by-side-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
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

// ─── Similarity helpers ───────────────────────────────────────────────────────

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

// ─── Main Comparison View ─────────────────────────────────────────────────────

export function ComparisonView() {
  const { id } = useParams<{ id: string }>();
  const { state, dispatch } = useStore();
  const { colors } = useTheme();
  const { toast, showToast } = useToast();

  const promptRuns = useMemo(
    () => state.runs.filter(r => r.promptId === id).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [state.runs, id],
  );

  const promptVersions = useMemo(
    () => state.versions.filter(v => v.promptId === id).sort((a, b) => b.versionNumber - a.versionNumber),
    [state.versions, id],
  );

  const [runIdA, setRunIdA] = useState('');
  const [runIdB, setRunIdB] = useState('');
  const [compareBy, setCompareBy] = useState<'runs' | 'versions'>('runs');
  const [versionIdA, setVersionIdA] = useState('');
  const [versionIdB, setVersionIdB] = useState('');
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [lexicalDiff, setLexicalDiff] = useState<LexicalDiff | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoSelect, setAutoSelect] = useState(true);

  const hasSelection = runIdA && runIdB;

  async function handleCompare() {
    if (compareBy === 'runs' && runIdA && runIdB) {
      setIsComparing(true);
      setError(null);
      try {
        const result = await service.compareRuns(runIdA, runIdB);
        setComparison(result);
        const diffLines = computeDiffLines(result.runA.output, result.runB.output);
        const additionsArr: string[] = [];
        const deletionsArr: string[] = [];
        let addedLines = 0, deletedLines = 0, commonLines = 0;
        for (const line of diffLines) {
          if (line.type === 'addition') { addedLines++; additionsArr.push(line.text); }
          else if (line.type === 'deletion') { deletedLines++; deletionsArr.push(line.text); }
          else { commonLines++; }
        }
        setLexicalDiff({ additions: additionsArr.join('\n'), deletions: deletionsArr.join('\n'), common: '', addedLines, deletedLines, commonLines });
        showToast('Comparison complete', 'success');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Comparison failed');
        showToast('Comparison failed', 'error');
      } finally {
        setIsComparing(false);
      }
    } else if (compareBy === 'versions' && versionIdA && versionIdB) {
      setIsComparing(true);
      setError(null);
      try {
        const vA = state.versions.find(v => v.id === versionIdA);
        const vB = state.versions.find(v => v.id === versionIdB);
        if (!vA || !vB) throw new Error('One or both versions not found');
        const diffLines = computeDiffLines(vA.content, vB.content);
        const additionsArr: string[] = [];
        const deletionsArr: string[] = [];
        let addedLines = 0, deletedLines = 0, commonLines = 0;
        for (const line of diffLines) {
          if (line.type === 'addition') { addedLines++; additionsArr.push(line.text); }
          else if (line.type === 'deletion') { deletedLines++; deletionsArr.push(line.text); }
          else { commonLines++; }
        }
        setLexicalDiff({ additions: additionsArr.join('\n'), deletions: deletionsArr.join('\n'), common: '', addedLines, deletedLines, commonLines });
        const runA: PromptRun = { id: `v${vA.versionNumber}`, promptId: vA.promptId, versionId: vA.id, input: '', output: vA.content, model: vA.model, temperature: vA.temperature, maxTokens: vA.maxTokens, systemPrompt: vA.systemPrompt, tokenCount: Math.ceil(vA.content.length / 4), latencyMs: 0, createdAt: vA.createdAt };
        const runB: PromptRun = { id: `v${vB.versionNumber}`, promptId: vB.promptId, versionId: vB.id, input: '', output: vB.content, model: vB.model, temperature: vB.temperature, maxTokens: vB.maxTokens, systemPrompt: vB.systemPrompt, tokenCount: Math.ceil(vB.content.length / 4), latencyMs: 0, createdAt: vB.createdAt };
        setComparison({ runA, runB, lexicalDiff: { additions: additionsArr.join('\n'), deletions: deletionsArr.join('\n'), common: '', addedLines, deletedLines, commonLines }, lexicalSimilarity: computeLexicalSimilarity(vA.content, vB.content), semanticSimilarity: computeSemanticSimilarity(vA.content, vB.content), latencyDiffMs: 0, tokenDiff: runA.tokenCount - runB.tokenCount, costDiff: undefined });
        showToast('Comparison complete', 'success');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Comparison failed');
        showToast('Comparison failed', 'error');
      } finally {
        setIsComparing(false);
      }
    }
  }

  if (compareBy === 'runs' && autoSelect && promptRuns.length >= 2 && !hasSelection) {
    setRunIdA(promptRuns[0].id);
    setRunIdB(promptRuns[1].id);
    setAutoSelect(false);
  }

  function handleModeChange(mode: 'runs' | 'versions') {
    setCompareBy(mode);
    setAutoSelect(true);
    setComparison(null);
    setLexicalDiff(null);
    setError(null);
    if (mode === 'runs') { setRunIdA(''); setRunIdB(''); }
    else { setVersionIdA(''); setVersionIdB(''); }
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
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 24px' }}>
        <div className="header-responsive" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
          <Link to={`/prompts/${id}`} style={{ color: colors.textLink, textDecoration: 'none', fontSize: '14px' }}>
            ← Back to Prompt
          </Link>
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: colors.text, margin: 0 }}>Compare</h1>
        </div>

        {/* Mode selector */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', flexWrap: 'wrap' }}>
          <button
            style={compareBy === 'runs' ? { padding: '8px 20px', borderRadius: '6px', border: `1px solid ${colors.accent}`, backgroundColor: colors.accentLight, color: colors.accent, cursor: 'pointer', fontSize: '14px', fontWeight: 600 } : { padding: '8px 20px', borderRadius: '6px', border: `1px solid ${colors.border}`, backgroundColor: colors.bgCard, color: colors.textSecondary, cursor: 'pointer', fontSize: '14px', fontWeight: 500 }}
            onClick={() => handleModeChange('runs')}
          >
            Compare Runs
          </button>
          <button
            style={compareBy === 'versions' ? { padding: '8px 20px', borderRadius: '6px', border: `1px solid ${colors.accent}`, backgroundColor: colors.accentLight, color: colors.accent, cursor: 'pointer', fontSize: '14px', fontWeight: 600 } : { padding: '8px 20px', borderRadius: '6px', border: `1px solid ${colors.border}`, backgroundColor: colors.bgCard, color: colors.textSecondary, cursor: 'pointer', fontSize: '14px', fontWeight: 500 }}
            onClick={() => handleModeChange('versions')}
          >
            Compare Versions
          </button>
        </div>

        {/* Selection controls */}
        <div className="comparison-select-stack" style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', marginBottom: '24px', flexWrap: 'wrap' }}>
          {compareBy === 'runs' ? (
            <>
              <div style={{ flex: 1, minWidth: '200px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ color: colors.textSecondary, fontSize: '13px', fontWeight: 600 }}>Run A</label>
                <select value={runIdA} onChange={e => { setRunIdA(e.target.value); setAutoSelect(false); }} style={inputStyle} disabled={promptRuns.length < 2}>
                  <option value="">Select a run...</option>
                  {promptRuns.map(r => (<option key={r.id} value={r.id}>v{promptVersions.find(v => v.id === r.versionId)?.versionNumber ?? '?'} · {r.model} · {r.latencyMs}ms · {r.tokenCount} tokens</option>))}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: '200px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ color: colors.textSecondary, fontSize: '13px', fontWeight: 600 }}>Run B</label>
                <select value={runIdB} onChange={e => { setRunIdB(e.target.value); setAutoSelect(false); }} style={inputStyle} disabled={promptRuns.length < 2}>
                  <option value="">Select a run...</option>
                  {promptRuns.map(r => (<option key={r.id} value={r.id}>v{promptVersions.find(v => v.id === r.versionId)?.versionNumber ?? '?'} · {r.model} · {r.latencyMs}ms · {r.tokenCount} tokens</option>))}
                </select>
              </div>
            </>
          ) : (
            <>
              <div style={{ flex: 1, minWidth: '200px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ color: colors.textSecondary, fontSize: '13px', fontWeight: 600 }}>Version A</label>
                <select value={versionIdA} onChange={e => setVersionIdA(e.target.value)} style={inputStyle} disabled={promptVersions.length < 2}>
                  <option value="">Select a version...</option>
                  {promptVersions.map(v => (<option key={v.id} value={v.id}>v{v.versionNumber} · {v.model} · t={v.temperature} · {v.commitMessage || ''}</option>))}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: '200px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ color: colors.textSecondary, fontSize: '13px', fontWeight: 600 }}>Version B</label>
                <select value={versionIdB} onChange={e => setVersionIdB(e.target.value)} style={inputStyle} disabled={promptVersions.length < 2}>
                  <option value="">Select a version...</option>
                  {promptVersions.map(v => (<option key={v.id} value={v.id}>v{v.versionNumber} · {v.model} · t={v.temperature} · {v.commitMessage || ''}</option>))}
                </select>
              </div>
            </>
          )}
          <button
            style={{
              backgroundColor: colors.accent,
              color: '#ffffff',
              border: 'none',
              padding: '10px 24px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '14px',
              whiteSpace: 'nowrap',
              opacity: isComparing ? 0.6 : 1,
            }}
            onClick={handleCompare}
            disabled={isComparing || (compareBy === 'runs' ? !runIdA || !runIdB : !versionIdA || !versionIdB)}
          >
            {isComparing ? 'Comparing…' : 'Compare'}
          </button>
        </div>

        {error && (
          <div style={{
            backgroundColor: colors.bgError,
            borderRadius: '6px',
            padding: '12px 16px',
            marginBottom: '24px',
            border: `1px solid ${colors.textError}`,
          }}>
            <p style={{ color: colors.textError, fontSize: '14px', margin: 0 }}>Error: {error}</p>
          </div>
        )}

        {/* Results */}
        {comparison && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Similarity scores */}
            <div className="similarity-stack-mobile" style={{
              backgroundColor: colors.bgCard,
              borderRadius: '8px',
              padding: '20px',
              border: `1px solid ${colors.bgCardBorder}`,
            }}>
              <h3 style={{ color: colors.text, fontSize: '18px', fontWeight: 600, marginTop: 0, marginBottom: '16px' }}>Similarity Scores</h3>
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                <SimilarityBadge score={comparison.lexicalSimilarity} label="Lexical" colors={colors} />
                <SimilarityBadge score={comparison.semanticSimilarity} label="Semantic" colors={colors} />
              </div>
            </div>

            {/* Metrics comparison */}
            <div style={{
              backgroundColor: colors.bgCard,
              borderRadius: '8px',
              padding: '20px',
              border: `1px solid ${colors.bgCardBorder}`,
            }}>
              <h3 style={{ color: colors.text, fontSize: '18px', fontWeight: 600, marginTop: 0, marginBottom: '16px' }}>Metrics Comparison</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
                {/* Latency */}
                <div style={{ backgroundColor: colors.bgCode, borderRadius: '6px', padding: '16px', border: `1px solid ${colors.border}` }}>
                  <div style={{ color: colors.textSecondary, fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>Latency</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ color: colors.text, fontSize: '14px', fontWeight: 600 }}>{comparison.runA.latencyMs}ms</span>
                    <span style={{ color: colors.textSecondary, fontSize: '13px' }}>
                      {comparison.latencyDiffMs > 0 ? '↑' : comparison.latencyDiffMs < 0 ? '↓' : '='} {Math.abs(comparison.latencyDiffMs)}ms
                    </span>
                    <span style={{ color: colors.text, fontSize: '14px', fontWeight: 600 }}>{comparison.runB.latencyMs}ms</span>
                  </div>
                  <MetricBar value={comparison.runA.latencyMs} max={Math.max(comparison.runA.latencyMs, comparison.runB.latencyMs, 1)} color="#4a9eff" />
                </div>
                {/* Tokens */}
                <div style={{ backgroundColor: colors.bgCode, borderRadius: '6px', padding: '16px', border: `1px solid ${colors.border}` }}>
                  <div style={{ color: colors.textSecondary, fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>Tokens</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ color: colors.text, fontSize: '14px', fontWeight: 600 }}>{comparison.runA.tokenCount}</span>
                    <span style={{ color: colors.textSecondary, fontSize: '13px' }}>
                      {comparison.tokenDiff > 0 ? '↑' : comparison.tokenDiff < 0 ? '↓' : '='} {Math.abs(comparison.tokenDiff)}
                    </span>
                    <span style={{ color: colors.text, fontSize: '14px', fontWeight: 600 }}>{comparison.runB.tokenCount}</span>
                  </div>
                  <MetricBar value={comparison.runA.tokenCount} max={Math.max(comparison.runA.tokenCount, comparison.runB.tokenCount, 1)} color="#34d399" />
                </div>
                {/* Cost */}
                {comparison.costDiff !== undefined && (
                  <div style={{ backgroundColor: colors.bgCode, borderRadius: '6px', padding: '16px', border: `1px solid ${colors.border}` }}>
                    <div style={{ color: colors.textSecondary, fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>Cost</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ color: colors.text, fontSize: '14px', fontWeight: 600 }}>${comparison.runA.cost?.toFixed(4) ?? '0.0000'}</span>
                      <span style={{ color: colors.textSecondary, fontSize: '13px' }}>
                        {comparison.costDiff > 0 ? '↑' : comparison.costDiff < 0 ? '↓' : '='} ${Math.abs(comparison.costDiff).toFixed(4)}
                      </span>
                      <span style={{ color: colors.text, fontSize: '14px', fontWeight: 600 }}>${comparison.runB.cost?.toFixed(4) ?? '0.0000'}</span>
                    </div>
                    <MetricBar value={comparison.runA.cost ?? 0} max={Math.max(comparison.runA.cost ?? 0, comparison.runB.cost ?? 0, 0.0001)} color="#fbbf24" />
                  </div>
                )}
              </div>
            </div>

            {/* Side-by-side output diff */}
            <div style={{
              backgroundColor: colors.bgCard,
              borderRadius: '8px',
              padding: '20px',
              border: `1px solid ${colors.bgCardBorder}`,
            }}>
              <h3 style={{ color: colors.text, fontSize: '18px', fontWeight: 600, marginTop: 0, marginBottom: '16px' }}>Output Comparison</h3>
              <div className="comparison-stack-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div style={{ backgroundColor: colors.bgCode, borderRadius: '6px', border: `1px solid ${colors.border}`, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: `1px solid ${colors.border}`, backgroundColor: colors.bgCard }}>
                    <span style={{ color: colors.textLink, fontSize: '14px', fontWeight: 600 }}>Run A</span>
                    <span style={{ color: colors.textTertiary, fontSize: '12px' }}>{comparison.runA.model} · {comparison.runA.latencyMs}ms</span>
                  </div>
                  <pre style={{ padding: '16px', color: colors.text, fontSize: '14px', whiteSpace: 'pre-wrap', fontFamily: 'monospace', maxHeight: '400px', overflowY: 'auto', margin: 0, lineHeight: '1.6' }}>
                    {comparison.runA.output || '(no output)'}
                  </pre>
                </div>
                <div style={{ backgroundColor: colors.bgCode, borderRadius: '6px', border: `1px solid ${colors.border}`, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: `1px solid ${colors.border}`, backgroundColor: colors.bgCard }}>
                    <span style={{ color: colors.textLink, fontSize: '14px', fontWeight: 600 }}>Run B</span>
                    <span style={{ color: colors.textTertiary, fontSize: '12px' }}>{comparison.runB.model} · {comparison.runB.latencyMs}ms</span>
                  </div>
                  <pre style={{ padding: '16px', color: colors.text, fontSize: '14px', whiteSpace: 'pre-wrap', fontFamily: 'monospace', maxHeight: '400px', overflowY: 'auto', margin: 0, lineHeight: '1.6' }}>
                    {comparison.runB.output || '(no output)'}
                  </pre>
                </div>
              </div>
            </div>

            {/* Lexical diff */}
            {lexicalDiff && (
              <div style={{
                backgroundColor: colors.bgCard,
                borderRadius: '8px',
                padding: '20px',
                border: `1px solid ${colors.bgCardBorder}`,
              }}>
                <h3 style={{ color: colors.text, fontSize: '18px', fontWeight: 600, marginTop: 0, marginBottom: '16px' }}>
                  Lexical Diff ({lexicalDiff.addedLines} added, {lexicalDiff.deletedLines} deleted, {lexicalDiff.commonLines} common)
                </h3>
                <DiffView diff={lexicalDiff} colors={colors} />
              </div>
            )}
          </div>
        )}

        {!comparison && !error && compareBy === 'runs' && promptRuns.length < 2 && (
          <div style={{
            backgroundColor: colors.bgCard,
            borderRadius: '8px',
            padding: '32px',
            textAlign: 'center',
            color: colors.textSecondary,
            border: `1px solid ${colors.bgCardBorder}`,
          }}>
            <p>Need at least 2 runs to compare. Execute the prompt multiple times first.</p>
            <Link to={`/prompts/${id}`} style={{ color: colors.textLink, textDecoration: 'none', display: 'inline-block', marginTop: '12px' }}>
              Go to Prompt →
            </Link>
          </div>
        )}
        {!comparison && !error && compareBy === 'versions' && promptVersions.length < 2 && (
          <div style={{
            backgroundColor: colors.bgCard,
            borderRadius: '8px',
            padding: '32px',
            textAlign: 'center',
            color: colors.textSecondary,
            border: `1px solid ${colors.bgCardBorder}`,
          }}>
            <p>Need at least 2 versions to compare. Save the prompt with different content or parameters.</p>
            <Link to={`/prompts/${id}`} style={{ color: colors.textLink, textDecoration: 'none', display: 'inline-block', marginTop: '12px' }}>
              Go to Prompt →
            </Link>
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
