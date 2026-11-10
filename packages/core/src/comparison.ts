import crypto from 'node:crypto';
import type { DB } from './db';
import type {
  ComparisonResult,
  LexicalDiff,
  PromptRun,
  PromptRunCreate,
  TestRunResult,
  TestSet,
  TestSetCreate,
} from './types';

export class ComparisonEngine {
  constructor(private db: DB) {}

  /**
   * Compare two runs side by side.
   */
  compareRuns(runIdA: string, runIdB: string): Promise<ComparisonResult> {
    const conn = this.db.connection;

    const rowA = conn
      .prepare(
        `SELECT id, prompt_id, version_id, input, output, model, temperature, max_tokens, system_prompt, token_count, latency_ms, cost, created_at, error FROM prompt_runs WHERE id = ?`,
      )
      .get(runIdA) as (PromptRun & { system_prompt: string | null }) | undefined;

    const rowB = conn
      .prepare(
        `SELECT id, prompt_id, version_id, input, output, model, temperature, max_tokens, system_prompt, token_count, latency_ms, cost, created_at, error FROM prompt_runs WHERE id = ?`,
      )
      .get(runIdB) as (PromptRun & { system_prompt: string | null }) | undefined;

    if (!rowA || !rowB) {
      throw new Error(`One or both runs not found`);
    }

    const runA: PromptRun = {
      id: rowA.id,
      promptId: rowA.prompt_id,
      versionId: rowA.version_id,
      input: rowA.input,
      output: rowA.output,
      model: rowA.model,
      temperature: rowA.temperature,
      maxTokens: rowA.max_tokens,
      systemPrompt: rowA.system_prompt ?? undefined,
      tokenCount: rowA.token_count,
      latencyMs: rowA.latency_ms,
      cost: rowA.cost ?? undefined,
      createdAt: rowA.created_at,
      error: rowA.error ?? undefined,
    };

    const runB: PromptRun = {
      id: rowB.id,
      promptId: rowB.prompt_id,
      versionId: rowB.version_id,
      input: rowB.input,
      output: rowB.output,
      model: rowB.model,
      temperature: rowB.temperature,
      maxTokens: rowB.max_tokens,
      systemPrompt: rowB.system_prompt ?? undefined,
      tokenCount: rowB.token_count,
      latencyMs: rowB.latency_ms,
      cost: rowB.cost ?? undefined,
      createdAt: rowB.created_at,
      error: rowB.error ?? undefined,
    };

    // Compute lexical diff
    const lexicalDiff = this.computeLexicalDiff(runA.output, runB.output);

    // Compute lexical similarity
    const lexicalSimilarity = this.computeLexicalSimilarity(runA.output, runB.output);

    // Compute semantic similarity (using hash-based approximation for now)
    const semanticSimilarity = this.computeSemanticSimilarity(runA.output, runB.output);

    return {
      runA,
      runB,
      lexicalDiff,
      lexicalSimilarity,
      semanticSimilarity,
      latencyDiffMs: runA.latencyMs - runB.latencyMs,
      tokenDiff: runA.tokenCount - runB.tokenCount,
      costDiff: runA.cost !== undefined && runB.cost !== undefined
        ? runA.cost - runB.cost
        : undefined,
    };
  }

  /**
   * Compute lexical diff between two texts.
   */
  private computeLexicalDiff(textA: string, textB: string): LexicalDiff {
    const linesA = textA.split('\n');
    const linesB = textB.split('\n');

    // Simple line-by-line diff
    const additions: string[] = [];
    const deletions: string[] = [];
    let commonLines = 0;
    let addedLines = 0;
    let deletedLines = 0;

    const maxLen = Math.max(linesA.length, linesB.length);

    for (let i = 0; i < maxLen; i++) {
      const lineA = linesA[i];
      const lineB = linesB[i];

      if (lineA === undefined) {
        additions.push(lineB ?? '');
        addedLines++;
      } else if (lineB === undefined) {
        deletions.push(lineA);
        deletedLines++;
      } else if (lineA === lineB) {
        commonLines++;
      } else {
        // Lines differ - treat as both added and deleted
        deletions.push(lineA);
        additions.push(lineB);
        deletedLines++;
        addedLines++;
      }
    }

    return {
      additions: additions.join('\n'),
      deletions: deletions.join('\n'),
      common: '',
      addedLines,
      deletedLines,
      commonLines,
    };
  }

  /**
   * Compute lexical similarity between two texts (0-1).
   */
  private computeLexicalSimilarity(textA: string, textB: string): number {
    if (textA === textB) return 1.0;
    if (textA.length === 0 && textB.length === 0) return 1.0;
    if (textA.length === 0 || textB.length === 0) return 0.0;

    // Use Jaccard similarity on character bigrams
    const bigramsA = this.getBigrams(textA);
    const bigramsB = this.getBigrams(textB);

    const intersection = new Set([...bigramsA].filter(b => bigramsB.has(b)));
    const union = new Set([...bigramsA, ...bigramsB]);

    if (union.size === 0) return 0.0;

    return intersection.size / union.size;
  }

  /**
   * Get character bigrams from a string.
   */
  private getBigrams(text: string): Set<string> {
    const bigrams = new Set<string>();
    for (let i = 0; i < text.length - 1; i++) {
      bigrams.add(text.substring(i, i + 2));
    }
    return bigrams;
  }

  /**
   * Compute semantic similarity using hash-based approximation.
   * This is a simplified approach - in production, use actual semantic embeddings.
   */
  private computeSemanticSimilarity(textA: string, textB: string): number {
    if (textA === textB) return 1.0;
    if (textA.length === 0 && textB.length === 0) return 1.0;
    if (textA.length === 0 || textB.length === 0) return 0.0;

    // Normalize texts
    const normalize = (text: string) => text.toLowerCase().trim();
    const normA = normalize(textA);
    const normB = normalize(textB);

    // Split into words
    const wordsA = new Set(normA.split(/\s+/).filter(w => w.length > 2));
    const wordsB = new Set(normB.split(/\s+/).filter(w => w.length > 2));

    if (wordsA.size === 0 && wordsB.size === 0) return 0.0;
    if (wordsA.size === 0 || wordsB.size === 0) return 0.0;

    // Compute Jaccard similarity on words
    const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
    const union = new Set([...wordsA, ...wordsB]);

    return intersection.size / union.size;
  }

  /**
   * Run a test set against a prompt version.
   */
  async runTestSet(
    testSetId: string,
    promptId: string,
    versionId: string,
  ): Promise<TestRunResult[]> {
    const conn = this.db.connection;

    // Get all inputs for the test set
    const rows = conn
      .prepare(
        `SELECT input FROM test_set_inputs WHERE test_set_id = ?`,
      )
      .all(testSetId) as { input: string }[];

    if (rows.length === 0) {
      return [];
    }

    const results: TestRunResult[] = [];

    for (const row of rows) {
      const startTime = Date.now();
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();

      try {
        // In a real implementation, this would call the API client
        // For now, we'll create a placeholder result
        const output = `[Test output for: ${row.input.substring(0, 50)}...]`;
        const latencyMs = Date.now() - startTime;
        const tokenCount = Math.ceil(output.length / 4);

        results.push({
          id,
          testSetId,
          promptId,
          versionId,
          input: row.input,
          output,
          tokenCount,
          latencyMs,
          createdAt,
        });
      } catch (error) {
        const latencyMs = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        results.push({
          id,
          testSetId,
          promptId,
          versionId,
          input: row.input,
          output: '',
          tokenCount: 0,
          latencyMs,
          error: errorMessage,
          createdAt,
        });
      }
    }

    return results;
  }

  /**
   * Create a test set.
   */
  createTestSet(data: TestSetCreate): Promise<TestSet> {
    const conn = this.db.connection;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    conn.prepare(
      `INSERT INTO test_sets (id, name, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(id, data.name, data.description ?? null, now, now);

    // Insert inputs
    for (const input of data.inputs) {
      const inputId = crypto.randomUUID();
      conn.prepare(
        `INSERT INTO test_set_inputs (id, test_set_id, input) VALUES (?, ?, ?)`,
      ).run(inputId, id, input);
    }

    return {
      id,
      name: data.name,
      description: data.description,
      inputs: data.inputs,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Get a test set by ID.
   */
  getTestSet(id: string): Promise<TestSet | undefined> {
    const conn = this.db.connection;

    const row = conn
      .prepare(
        `SELECT id, name, description, created_at, updated_at FROM test_sets WHERE id = ?`,
      )
      .get(id) as (TestSet & { description: string | null }) | undefined;

    if (!row) return undefined;

    // Get inputs
    const inputRows = conn
      .prepare(
        `SELECT input FROM test_set_inputs WHERE test_set_id = ?`,
      )
      .all(id) as { input: string }[];

    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      inputs: inputRows.map(r => r.input),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * List all test sets.
   */
  listTestSets(): Promise<TestSet[]> {
    const conn = this.db.connection;

    const rows = conn
      .prepare(
        `SELECT id, name, description, created_at, updated_at FROM test_sets ORDER BY created_at DESC`,
      )
      .all() as (TestSet & { description: string | null })[];

    return Promise.all(rows.map(async (row) => {
      const inputRows = conn
        .prepare(
          `SELECT input FROM test_set_inputs WHERE test_set_id = ?`,
        )
        .all(row.id) as { input: string }[];

      return {
        id: row.id,
        name: row.name,
        description: row.description ?? undefined,
        inputs: inputRows.map(r => r.input),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    }));
  }
}

import crypto from 'node:crypto';
