import { useState, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useStore, service } from '../store';
import type { ComparisonResult, LexicalDiff, PromptRun, PromptVersion } from '@sentry-prompt/core';

// ─── Diff highlighting helpers ────────────────────────────────────────────────

interface DiffLine {
  text: string;
  type: 'common' | 'addition' | 'deletion';
}

function computeDiffLines(textA: string, textB: string): DiffLine[] {
  // Simple line-based diff using the diff library approach
  const linesA = textA.split('\n');
  const linesB = textB.split('\n');

  // Build a simple LCS-based diff
  const m = linesA.length;
  const n = linesB.length;

  // Compute LCS table
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

  // Backtrack to find diff
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

  // Reverse to get correct order
  while (stack.length > 0) {
    result.push(stack.pop()!);
  }

  return result;
}

// ─── Metric bar helper ────────────────────────────────────────────────────────

function MetricBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={styles.metricBarContainer}>
      <div
        style={{
          ...styles.metricBar,
          width: `${pct}%`,
          backgroundColor: color,
        }}
      />
    </div>
  );
}

// ─── Similarity badge ─────────────────────────────────────────────────────────

function SimilarityBadge({ score, label }: { score: number; label: string }) {
  const color =
    score >= 0.8 ? '#34d399' : score >= 0.5 ? '#fbbf24' : '#ef4444';
  return (
    <div style={styles.similarityBadge}>
      <span style={styles.similarityLabel}>{label}</span>
      <span style={{ ...styles.similarityScore, color }}>{(score * 100).toFixed(1)}%</span>
    </div>
  );
}

// ─── Diff view component ──────────────────────────────────────────────────────

function DiffView({ diff }: { diff: LexicalDiff }) {
  const [view, setView] = useState<'unified' | 'side-by-side'>('unified');

  const renderUnified = () => (
    <div style={styles.diffContainer}>
      <div style={styles.diffToolbar}>
        <button
          style={view === 'unified' ? styles.diffTabActive : styles.diffTab}
          onClick={() => setView('unified')}
        >
          Unified
        </button>
        <button
          style={view === 'side-by-side' ? styles.diffTabActive : styles.diffTab}
          onClick={() => setView('side-by-side')}
        >
          Side-by-Side
        </button>
      </div>
      <pre style={styles.diffContent}>
        {diff.additions && (
          <div>
            <div style={styles.diffSectionTitle}>Additions ({diff.addedLines} line{diff.addedLines !== 1 ? 's' : ''})</div>
            <code style={styles.diffAdd}>{diff.additions}</code>
          </div>
        )}
        {diff.deletions && (
          <div>
            <div style={styles.diffSectionTitle}>Deletions ({diff.deletedLines} line{diff.deletedLines !== 1 ? 's' : ''})</div>
            <code style={styles.diffDel}>{diff.deletions}</code>
          </div>
        )}
        {diff.common && (
          <div>
            <div style={styles.diffSectionTitle}>Common ({diff.commonLines} line{diff.commonLines !== 1 ? 's' : ''})</div>
            <code style={styles.diffCommon}>{diff.common}</code>
          </div>
        )}
        {!diff.additions && !diff.deletions && (
          <div style={styles.noDiff}>No differences detected</div>
        )}
      </pre>
    </div>
  );

  const renderSideBySide = () => {
    const lines = computeDiffLines(diff.deletions || '', diff.additions || '');
    return (
      <div style={styles.diffContainer}>
        <div style={styles.diffToolbar}>
          <button
            style={view === 'unified' ? styles.diffTabActive : styles.diffTab}
            onClick={() => setView('unified')}
          >
            Unified
          </button>
          <button
            style={view === 'side-by-side' ? styles.diffTabActive : styles.diffTab}
            onClick={() => setView('side-by-side')}
          >
            Side-by-Side
          </button>
        </div>
        <div style={styles.diffSideBySide}>
          <div style={styles.diffHalf}>
            <div style={styles.diffHalfTitle}>Deletions</div>
            <pre style={styles.diffDelContent}>
              {lines
                .filter(l => l.type === 'deletion')
                .map((l, i) => (
                  <div key={`d-${i}`} style={styles.diffLine}>
                    <span style={styles.diffLineNum}>-{i + 1}</span>
                    <span style={styles.diffLineContent}>{l.text}</span>
                  </div>
                ))}
              {lines.filter(l => l.type === 'deletion').length === 0 && (
                <div style={styles.noDiff}>No deletions</div>
              )}
            </pre>
          </div>
          <div style={styles.diffHalf}>
            <div style={styles.diffHalfTitle}>Additions</div>
            <pre style={styles.diffAddContent}>
              {lines
                .filter(l => l.type === 'addition')
                .map((l, i) => (
                  <div key={`a-${i}`} style={styles.diffLine}>
                    <span style={styles.diffLineNum}>+{i + 1}</span>
                    <span style={styles.diffLineContent}>{l.text}</span>
                  </div>
                ))}
              {lines.filter(l => l.type === 'addition').length === 0 && (
                <div style={styles.noDiff}>No additions</div>
              )}
            </pre>
          </div>
        </div>
      </div>
    );
  };

  return view === 'unified' ? renderUnified() : renderSideBySide();
}

// ─── Main Comparison View ─────────────────────────────────────────────────────

export function ComparisonView() {
  const { id } = useParams<{ id: string }>();
  const { state, dispatch } = useStore();

  // Filter runs for this prompt
  const promptRuns = useMemo(
    () =>
      state.runs
        .filter(r => r.promptId === id)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [state.runs, id],
  );

  const promptVersions = useMemo(
    () =>
      state.versions
        .filter(v => v.promptId === id)
        .sort((a, b) => b.versionNumber - a.versionNumber),
    [state.versions, id],
  );

  // Selection state
  const [runIdA, setRunIdA] = useState('');
  const [runIdB, setRunIdB] = useState('');
  const [compareBy, setCompareBy] = useState<'runs' | 'versions'>('runs');
  const [versionIdA, setVersionIdA] = useState('');
  const [versionIdB, setVersionIdB] = useState('');
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [lexicalDiff, setLexicalDiff] = useState<LexicalDiff | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-select the two most recent runs when runs mode is active
  const [autoSelect, setAutoSelect] = useState(true);

  const selectedRunA = promptRuns.find(r => r.id === runIdA);
  const selectedRunB = promptRuns.find(r => r.id === runIdB);
  const selectedVersionA = promptVersions.find(v => v.id === versionIdA);
  const selectedVersionB = promptVersions.find(v => v.id === versionIdB);

  // Auto-select two most recent runs when entering runs mode
  const hasSelection = runIdA && runIdB;

  async function handleCompare() {
    if (compareBy === 'runs' && runIdA && runIdB) {
      setIsComparing(true);
      setError(null);
      try {
        const result = await service.compareRuns(runIdA, runIdB);
        setComparison(result);
        // Also compute lexical diff on the outputs
        const diff = null; // We don't have direct access to version diff here, compute manually
        // Compute lexical diff manually from the comparison result
        const diffLines = computeDiffLines(result.runA.output, result.runB.output);
        const additionsArr: string[] = [];
        const deletionsArr: string[] = [];
        let addedLines = 0;
        let deletedLines = 0;
        let commonLines = 0;
        for (const line of diffLines) {
          if (line.type === 'addition') {
            addedLines++;
            additionsArr.push(line.text);
          } else if (line.type === 'deletion') {
            deletedLines++;
            deletionsArr.push(line.text);
          } else {
            commonLines++;
          }
        }
        setLexicalDiff({
          additions: additionsArr.join('\n'),
          deletions: deletionsArr.join('\n'),
          common: '',
          addedLines,
          deletedLines,
          commonLines,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Comparison failed');
      } finally {
        setIsComparing(false);
      }
    } else if (compareBy === 'versions' && versionIdA && versionIdB) {
      setIsComparing(true);
      setError(null);
      try {
        // For version comparison, we need to fetch the version details and compare their content
        const versions = state.versions;
        const vA = versions.find(v => v.id === versionIdA);
        const vB = versions.find(v => v.id === versionIdB);
        if (!vA || !vB) {
          throw new Error('One or both versions not found');
        }
        // Compute diff manually
        const diffLines = computeDiffLines(vA.content, vB.content);
        const additionsArr: string[] = [];
        const deletionsArr: string[] = [];
        let addedLines = 0;
        let deletedLines = 0;
        let commonLines = 0;
        for (const line of diffLines) {
          if (line.type === 'addition') {
            addedLines++;
            additionsArr.push(line.text);
          } else if (line.type === 'deletion') {
            deletedLines++;
            deletionsArr.push(line.text);
          } else {
            commonLines++;
          }
        }
        setLexicalDiff({
          additions: additionsArr.join('\n'),
          deletions: deletionsArr.join('\n'),
          common: '',
          addedLines,
          deletedLines,
          commonLines,
        });
        // Create a synthetic comparison result
        const runA: PromptRun = {
          id: `v${vA.versionNumber}`,
          promptId: vA.promptId,
          versionId: vA.id,
          input: '',
          output: vA.content,
          model: vA.model,
          temperature: vA.temperature,
          maxTokens: vA.maxTokens,
          systemPrompt: vA.systemPrompt,
          tokenCount: Math.ceil(vA.content.length / 4),
          latencyMs: 0,
          createdAt: vA.createdAt,
        };
        const runB: PromptRun = {
          id: `v${vB.versionNumber}`,
          promptId: vB.promptId,
          versionId: vB.id,
          input: '',
          output: vB.content,
          model: vB.model,
          temperature: vB.temperature,
          maxTokens: vB.maxTokens,
          systemPrompt: vB.systemPrompt,
          tokenCount: Math.ceil(vB.content.length / 4),
          latencyMs: 0,
          createdAt: vB.createdAt,
        };
        // Compute similarity scores
        const lexicalSimilarity = computeLexicalSimilarity(vA.content, vB.content);
        const semanticSimilarity = computeSemanticSimilarity(vA.content, vB.content);
        setComparison({
          runA,
          runB,
          lexicalDiff: {
            additions: additionsArr.join('\n'),
            deletions: deletionsArr.join('\n'),
            common: '',
            addedLines,
            deletedLines,
            commonLines,
          },
          lexicalSimilarity,
          semanticSimilarity,
          latencyDiffMs: 0,
          tokenDiff: runA.tokenCount - runB.tokenCount,
          costDiff: undefined,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Comparison failed');
      } finally {
        setIsComparing(false);
      }
    }
  }

  // Auto-select when switching to runs mode
  if (compareBy === 'runs' && autoSelect && promptRuns.length >= 2 && !hasSelection) {
    setRunIdA(promptRuns[0].id);
    setRunIdB(promptRuns[1].id);
    setAutoSelect(false);
  }

  // Reset auto-select when switching modes
  function handleModeChange(mode: 'runs' | 'versions') {
    setCompareBy(mode);
    setAutoSelect(true);
    setComparison(null);
    setLexicalDiff(null);
    setError(null);
    if (mode === 'runs') {
      setRunIdA('');
      setRunIdB('');
    } else {
      setVersionIdA('');
      setVersionIdB('');
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <Link to={`/prompts/${id}`} style={styles.backLink}>
          ← Back to Prompt
        </Link>
        <h1 style={styles.title}>Compare</h1>
      </div>

      {/* Mode selector */}
      <div style={styles.modeSelector}>
        <button
          style={compareBy === 'runs' ? styles.modeBtnActive : styles.modeBtn}
          onClick={() => handleModeChange('runs')}
        >
          Compare Runs
        </button>
        <button
          style={compareBy === 'versions' ? styles.modeBtnActive : styles.modeBtn}
          onClick={() => handleModeChange('versions')}
        >
          Compare Versions
        </button>
      </div>

      {/* Selection controls */}
      <div style={styles.selectionSection}>
        {compareBy === 'runs' ? (
          <div style={styles.selectionGrid}>
            <div style={styles.selectionGroup}>
              <label style={styles.label}>Run A</label>
              <select
                value={runIdA}
                onChange={e => { setRunIdA(e.target.value); setAutoSelect(false); }}
                style={styles.select}
                disabled={promptRuns.length < 2}
              >
                <option value="">Select a run...</option>
                {promptRuns.map(r => (
                  <option key={r.id} value={r.id}>
                    v{promptVersions.find(v => v.id === r.versionId)?.versionNumber ?? '?'} · {r.model} · {r.latencyMs}ms · {r.tokenCount} tokens
                  </option>
                ))}
              </select>
            </div>
            <div style={styles.selectionGroup}>
              <label style={styles.label}>Run B</label>
              <select
                value={runIdB}
                onChange={e => { setRunIdB(e.target.value); setAutoSelect(false); }}
                style={styles.select}
                disabled={promptRuns.length < 2}
              >
                <option value="">Select a run...</option>
                {promptRuns.map(r => (
                  <option key={r.id} value={r.id}>
                    v{promptVersions.find(v => v.id === r.versionId)?.versionNumber ?? '?'} · {r.model} · {r.latencyMs}ms · {r.tokenCount} tokens
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <div style={styles.selectionGrid}>
            <div style={styles.selectionGroup}>
              <label style={styles.label}>Version A</label>
              <select
                value={versionIdA}
                onChange={e => setVersionIdA(e.target.value)}
                style={styles.select}
                disabled={promptVersions.length < 2}
              >
                <option value="">Select a version...</option>
                {promptVersions.map(v => (
                  <option key={v.id} value={v.id}>
                    v{v.versionNumber} · {v.model} · t={v.temperature} · {v.commitMessage || ''}
                  </option>
                ))}
              </select>
            </div>
            <div style={styles.selectionGroup}>
              <label style={styles.label}>Version B</label>
              <select
                value={versionIdB}
                onChange={e => setVersionIdB(e.target.value)}
                style={styles.select}
                disabled={promptVersions.length < 2}
              >
                <option value="">Select a version...</option>
                {promptVersions.map(v => (
                  <option key={v.id} value={v.id}>
                    v{v.versionNumber} · {v.model} · t={v.temperature} · {v.commitMessage || ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <button
          style={{
            ...styles.compareButton,
            opacity: isComparing ? 0.6 : 1,
          }}
          onClick={handleCompare}
          disabled={
            isComparing ||
            (compareBy === 'runs' ? !runIdA || !runIdB : !versionIdA || !versionIdB)
          }
        >
          {isComparing ? 'Comparing…' : 'Compare'}
        </button>
      </div>

      {error && (
        <div style={styles.errorBox}>
          <p style={styles.errorText}>Error: {error}</p>
        </div>
      )}

      {/* Results */}
      {comparison && (
        <div style={styles.resultsSection}>
          {/* Similarity scores */}
          <div style={styles.similaritySection}>
            <h3 style={styles.sectionTitle}>Similarity Scores</h3>
            <div style={styles.similarityGrid}>
              <SimilarityBadge score={comparison.lexicalSimilarity} label="Lexical" />
              <SimilarityBadge score={comparison.semanticSimilarity} label="Semantic" />
            </div>
          </div>

          {/* Metrics comparison */}
          <div style={styles.metricsSection}>
            <h3 style={styles.sectionTitle}>Metrics Comparison</h3>
            <div style={styles.metricsGrid}>
              {/* Latency */}
              <div style={styles.metricCard}>
                <div style={styles.metricLabel}>Latency</div>
                <div style={styles.metricValues}>
                  <span style={styles.metricValue}>{comparison.runA.latencyMs}ms</span>
                  <span style={styles.metricArrow}>
                    {comparison.latencyDiffMs > 0 ? '↑' : comparison.latencyDiffMs < 0 ? '↓' : '='}{' '}
                    {Math.abs(comparison.latencyDiffMs)}ms
                  </span>
                  <span style={styles.metricValue}>{comparison.runB.latencyMs}ms</span>
                </div>
                <MetricBar
                  value={comparison.runA.latencyMs}
                  max={Math.max(comparison.runA.latencyMs, comparison.runB.latencyMs, 1)}
                  color="#4a9eff"
                />
              </div>

              {/* Tokens */}
              <div style={styles.metricCard}>
                <div style={styles.metricLabel}>Tokens</div>
                <div style={styles.metricValues}>
                  <span style={styles.metricValue}>{comparison.runA.tokenCount}</span>
                  <span style={styles.metricArrow}>
                    {comparison.tokenDiff > 0 ? '↑' : comparison.tokenDiff < 0 ? '↓' : '='}{' '}
                    {Math.abs(comparison.tokenDiff)}
                  </span>
                  <span style={styles.metricValue}>{comparison.runB.tokenCount}</span>
                </div>
                <MetricBar
                  value={comparison.runA.tokenCount}
                  max={Math.max(comparison.runA.tokenCount, comparison.runB.tokenCount, 1)}
                  color="#34d399"
                />
              </div>

              {/* Cost */}
              {comparison.costDiff !== undefined && (
                <div style={styles.metricCard}>
                  <div style={styles.metricLabel}>Cost</div>
                  <div style={styles.metricValues}>
                    <span style={styles.metricValue}>${comparison.runA.cost?.toFixed(4) ?? '0.0000'}</span>
                    <span style={styles.metricArrow}>
                      {comparison.costDiff > 0 ? '↑' : comparison.costDiff < 0 ? '↓' : '='}{' '}
                      ${Math.abs(comparison.costDiff).toFixed(4)}
                    </span>
                    <span style={styles.metricValue}>${comparison.runB.cost?.toFixed(4) ?? '0.0000'}</span>
                  </div>
                  <MetricBar
                    value={comparison.runA.cost ?? 0}
                    max={Math.max(comparison.runA.cost ?? 0, comparison.runB.cost ?? 0, 0.0001)}
                    color="#fbbf24"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Side-by-side output diff */}
          <div style={styles.outputSection}>
            <h3 style={styles.sectionTitle}>Output Comparison</h3>
            <div style={styles.outputGrid}>
              <div style={styles.outputPanel}>
                <div style={styles.outputPanelHeader}>
                  <span style={styles.outputPanelTitle}>Run A</span>
                  <span style={styles.outputPanelMeta}>
                    {comparison.runA.model} · {comparison.runA.latencyMs}ms
                  </span>
                </div>
                <pre style={styles.outputContent}>
                  {comparison.runA.output || '(no output)'}
                </pre>
              </div>
              <div style={styles.outputPanel}>
                <div style={styles.outputPanelHeader}>
                  <span style={styles.outputPanelTitle}>Run B</span>
                  <span style={styles.outputPanelMeta}>
                    {comparison.runB.model} · {comparison.runB.latencyMs}ms
                  </span>
                </div>
                <pre style={styles.outputContent}>
                  {comparison.runB.output || '(no output)'}
                </pre>
              </div>
            </div>
          </div>

          {/* Lexical diff */}
          {lexicalDiff && (
            <div style={styles.diffSection}>
              <h3 style={styles.sectionTitle}>
                Lexical Diff ({lexicalDiff.addedLines} added, {lexicalDiff.deletedLines} deleted, {lexicalDiff.commonLines} common)
              </h3>
              <DiffView diff={lexicalDiff} />
            </div>
          )}
        </div>
      )}

      {/* No runs/versions message */}
      {!comparison && !error && compareBy === 'runs' && promptRuns.length < 2 && (
        <div style={styles.emptyState}>
          <p>Need at least 2 runs to compare. Execute the prompt multiple times first.</p>
          <Link to={`/prompts/${id}`} style={styles.link}>
            Go to Prompt →
          </Link>
        </div>
      )}
      {!comparison && !error && compareBy === 'versions' && promptVersions.length < 2 && (
        <div style={styles.emptyState}>
          <p>Need at least 2 versions to compare. Save the prompt with different content or parameters.</p>
          <Link to={`/prompts/${id}`} style={styles.link}>
            Go to Prompt →
          </Link>
        </div>
      )}
    </div>
  );
}

// ─── Similarity helpers (mirrors comparison.ts for client-side use) ───────────

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

  const normalize = (text: string) =>
    text.toLowerCase().replace(/[^\w\s]/g, '').trim();

  const wordsA = new Set(
    normalize(textA).split(/\s+/).filter(w => w.length > 2),
  );
  const wordsB = new Set(
    normalize(textB).split(/\s+/).filter(w => w.length > 2),
  );

  if (wordsA.size === 0 && wordsB.size === 0) return 0.0;
  if (wordsA.size === 0 || wordsB.size === 0) return 0.0;

  const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);

  return intersection.size / union.size;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '1200px',
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
    fontSize: '24px',
    fontWeight: 700,
    color: '#e0e0e0',
    margin: 0,
  },
  backLink: {
    color: '#4a9eff',
    textDecoration: 'none',
    fontSize: '14px',
  },
  modeSelector: {
    display: 'flex',
    gap: '8px',
    marginBottom: '24px',
  },
  modeBtn: {
    padding: '8px 20px',
    borderRadius: '6px',
    border: '1px solid #2d2d44',
    backgroundColor: '#1a1a2e',
    color: '#a0a0b0',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
  },
  modeBtnActive: {
    padding: '8px 20px',
    borderRadius: '6px',
    border: '1px solid #4a9eff',
    backgroundColor: '#1a2a4e',
    color: '#4a9eff',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 600,
  },
  selectionSection: {
    display: 'flex',
    gap: '16px',
    alignItems: 'flex-end',
    marginBottom: '24px',
    flexWrap: 'wrap',
  },
  selectionGrid: {
    display: 'flex',
    gap: '16px',
    flex: 1,
    minWidth: '300px',
  },
  selectionGroup: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  label: {
    color: '#a0a0b0',
    fontSize: '13px',
    fontWeight: 600,
  },
  select: {
    backgroundColor: '#0d0d1a',
    border: '1px solid #2d2d44',
    borderRadius: '4px',
    padding: '8px 12px',
    color: '#e0e0e0',
    fontSize: '14px',
  },
  compareButton: {
    backgroundColor: '#4a9eff',
    color: '#ffffff',
    border: 'none',
    padding: '10px 24px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: '14px',
    whiteSpace: 'nowrap',
  },
  errorBox: {
    backgroundColor: '#2d1a1a',
    borderRadius: '6px',
    padding: '12px 16px',
    marginBottom: '24px',
    border: '1px solid #ef4444',
  },
  errorText: {
    color: '#ef4444',
    fontSize: '14px',
    margin: 0,
  },
  resultsSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
  },
  sectionTitle: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#e0e0e0',
    marginTop: 0,
    marginBottom: '16px',
  },
  // Similarity scores
  similaritySection: {
    backgroundColor: '#1a1a2e',
    borderRadius: '8px',
    padding: '20px',
    border: '1px solid #2d2d44',
  },
  similarityGrid: {
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap',
  },
  similarityBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    backgroundColor: '#0d0d1a',
    borderRadius: '6px',
    padding: '8px 16px',
    border: '1px solid #2d2d44',
  },
  similarityLabel: {
    color: '#a0a0b0',
    fontSize: '13px',
    fontWeight: 500,
  },
  similarityScore: {
    fontSize: '16px',
    fontWeight: 700,
  },
  // Metrics
  metricsSection: {
    backgroundColor: '#1a1a2e',
    borderRadius: '8px',
    padding: '20px',
    border: '1px solid #2d2d44',
  },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '16px',
  },
  metricCard: {
    backgroundColor: '#0d0d1a',
    borderRadius: '6px',
    padding: '16px',
    border: '1px solid #2d2d44',
  },
  metricLabel: {
    color: '#a0a0b0',
    fontSize: '13px',
    fontWeight: 600,
    marginBottom: '8px',
  },
  metricValues: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  metricValue: {
    color: '#e0e0e0',
    fontSize: '14px',
    fontWeight: 600,
  },
  metricArrow: {
    color: '#a0a0b0',
    fontSize: '13px',
  },
  metricBarContainer: {
    height: '4px',
    backgroundColor: '#2d2d44',
    borderRadius: '2px',
    overflow: 'hidden',
  },
  metricBar: {
    height: '100%',
    borderRadius: '2px',
    transition: 'width 0.3s ease',
  },
  // Output comparison
  outputSection: {
    backgroundColor: '#1a1a2e',
    borderRadius: '8px',
    padding: '20px',
    border: '1px solid #2d2d44',
  },
  outputGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
  },
  outputPanel: {
    backgroundColor: '#0d0d1a',
    borderRadius: '6px',
    border: '1px solid #2d2d44',
    overflow: 'hidden',
  },
  outputPanelHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    borderBottom: '1px solid #2d2d44',
    backgroundColor: '#1a1a2e',
  },
  outputPanelTitle: {
    color: '#4a9eff',
    fontSize: '14px',
    fontWeight: 600,
  },
  outputPanelMeta: {
    color: '#606070',
    fontSize: '12px',
  },
  outputContent: {
    padding: '16px',
    color: '#e0e0e0',
    fontSize: '14px',
    whiteSpace: 'pre-wrap',
    fontFamily: 'monospace',
    maxHeight: '400px',
    overflowY: 'auto',
    margin: 0,
    lineHeight: '1.6',
  },
  // Diff section
  diffSection: {
    backgroundColor: '#1a1a2e',
    borderRadius: '8px',
    padding: '20px',
    border: '1px solid #2d2d44',
  },
  diffContainer: {
    backgroundColor: '#0d0d1a',
    borderRadius: '6px',
    border: '1px solid #2d2d44',
    overflow: 'hidden',
  },
  diffToolbar: {
    display: 'flex',
    gap: '4px',
    padding: '8px 12px',
    borderBottom: '1px solid #2d2d44',
    backgroundColor: '#1a1a2e',
  },
  diffTab: {
    padding: '4px 12px',
    borderRadius: '4px',
    border: 'none',
    backgroundColor: 'transparent',
    color: '#a0a0b0',
    cursor: 'pointer',
    fontSize: '12px',
  },
  diffTabActive: {
    padding: '4px 12px',
    borderRadius: '4px',
    border: 'none',
    backgroundColor: '#2d2d44',
    color: '#e0e0e0',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 600,
  },
  diffContent: {
    padding: '16px',
    fontSize: '13px',
    fontFamily: 'monospace',
    whiteSpace: 'pre-wrap',
    maxHeight: '400px',
    overflowY: 'auto',
    lineHeight: '1.5',
  },
  diffSectionTitle: {
    color: '#a0a0b0',
    fontSize: '12px',
    fontWeight: 600,
    marginTop: '12px',
    marginBottom: '4px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  diffAdd: {
    color: '#34d399',
    display: 'block',
    padding: '8px',
    backgroundColor: '#0d2818',
    borderRadius: '4px',
    margin: '4px 0',
  },
  diffDel: {
    color: '#ef4444',
    display: 'block',
    padding: '8px',
    backgroundColor: '#2d1a1a',
    borderRadius: '4px',
    margin: '4px 0',
  },
  diffCommon: {
    color: '#a0a0b0',
    display: 'block',
    padding: '8px',
    backgroundColor: '#1a1a2e',
    borderRadius: '4px',
    margin: '4px 0',
  },
  noDiff: {
    color: '#606070',
    fontStyle: 'italic',
    padding: '16px',
    textAlign: 'center',
  },
  // Side-by-side diff
  diffSideBySide: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 0,
  },
  diffHalf: {
    borderRight: '1px solid #2d2d44',
  },
  diffHalfTitle: {
    padding: '8px 12px',
    backgroundColor: '#1a1a2e',
    color: '#a0a0b0',
    fontSize: '12px',
    fontWeight: 600,
    borderBottom: '1px solid #2d2d44',
  },
  diffDelContent: {
    padding: '8px 12px',
    maxHeight: '300px',
    overflowY: 'auto',
    fontSize: '13px',
    fontFamily: 'monospace',
    lineHeight: '1.5',
    margin: 0,
  },
  diffAddContent: {
    padding: '8px 12px',
    maxHeight: '300px',
    overflowY: 'auto',
    fontSize: '13px',
    fontFamily: 'monospace',
    lineHeight: '1.5',
    margin: 0,
  },
  diffLine: {
    display: 'flex',
    gap: '8px',
  },
  diffLineNum: {
    color: '#606070',
    userSelect: 'none',
    minWidth: '24px',
    textAlign: 'right',
  },
  diffLineContent: {
    color: '#e0e0e0',
  },
  // Empty state
  emptyState: {
    backgroundColor: '#1a1a2e',
    borderRadius: '8px',
    padding: '32px',
    textAlign: 'center',
    color: '#a0a0b0',
    border: '1px solid #2d2d44',
  },
  link: {
    color: '#4a9eff',
    textDecoration: 'none',
    display: 'inline-block',
    marginTop: '12px',
  },
};
