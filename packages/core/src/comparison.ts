/**
 * Comparison engine for PromptSentry Workbench.
 * Computes lexical diffs, similarity scores, and manages test sets.
 */
import crypto from 'node:crypto';
import { diffLines } from 'diff';
import type { DB } from './db.js';
import type {
  ComparisonResult,
  LexicalDiff,
  PromptRun,
  PromptRunCreate,
  TestRunResult,
  TestSet,
  TestSetCreate,
} from './types.js';

// ─── Row types from SQLite (snake_case column names) ─────────────────────────

interface PromptRunRow {
  id: string;
  prompt_id: string;
  version_id: string;
  input: string;
  output: string;
  model: string;
  temperature: number;
  max_tokens: number;
  system_prompt: string | null;
  token_count: number;
  latency_ms: number;
  cost: number | null;
  created_at: string;
  error: string | null;
}

function mapRun(row: PromptRunRow): PromptRun {
  return {
    id: row.id,
    promptId: row.prompt_id,
    versionId: row.version_id,
    input: row.input,
    output: row.output,
    model: row.model,
    temperature: row.temperature,
    maxTokens: row.max_tokens,
    systemPrompt: row.system_prompt ?? undefined,
    tokenCount: row.token_count,
    latencyMs: row.latency_ms,
    cost: row.cost ?? undefined,
    createdAt: row.created_at,
    error: row.error ?? undefined,
  };
}

// ─── Options for runTestSet ──────────────────────────────────────────────────

export interface RunTestSetOptions {
  /** Callback for each test result as it completes */
  onResult?: (result: TestRunResult) => void;
  /** Abort the test set run with this signal */
  signal?: AbortSignal;
}

// ─── ComparisonEngine ────────────────────────────────────────────────────────

export class ComparisonEngine {
  constructor(private db: DB) {}

  // ─── Compare two runs side by side ────────────────────────────────────────

  /**
   * Compare two runs side by side.
   * Computes lexical diff, lexical similarity, semantic similarity,
   * and metric deltas (latency, tokens, cost).
   */
  compareRuns(runIdA: string, runIdB: string): ComparisonResult {
    const conn = this.db.connection;

    const rowA = conn
      .prepare(
        `SELECT id, prompt_id, version_id, input, output, model, temperature, max_tokens, system_prompt, token_count, latency_ms, cost, created_at, error FROM prompt_runs WHERE id = ?`,
      )
      .get(runIdA) as PromptRunRow | undefined;

    const rowB = conn
      .prepare(
        `SELECT id, prompt_id, version_id, input, output, model, temperature, max_tokens, system_prompt, token_count, latency_ms, cost, created_at, error FROM prompt_runs WHERE id = ?`,
      )
      .get(runIdB) as PromptRunRow | undefined;

    if (!rowA || !rowB) {
      throw new Error(`One or both runs not found`);
    }

    const runA = mapRun(rowA);
    const runB = mapRun(rowB);

    // Compute lexical diff using the diff library (same as versioning)
    const lexicalDiff = this.computeLexicalDiff(runA.output, runB.output);

    // Compute lexical similarity (character bigram Jaccard)
    const lexicalSimilarity = this.computeLexicalSimilarity(runA.output, runB.output);

    // Compute semantic similarity (word-level Jaccard on normalized tokens)
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

  // ─── Lexical diff ─────────────────────────────────────────────────────────

  /**
   * Compute a proper lexical diff between two texts using the `diff` library.
   * Returns additions, deletions, and line counts.
   */
  computeLexicalDiff(textA: string, textB: string): LexicalDiff {
    const diffResult = diffLines(textA, textB);

    const additionsArr: string[] = [];
    const deletionsArr: string[] = [];
    let addedLines = 0;
    let deletedLines = 0;
    let commonLines = 0;

    for (const part of diffResult) {
      if (part.added) {
        addedLines++;
        additionsArr.push(part.value);
      } else if (part.removed) {
        deletedLines++;
        deletionsArr.push(part.value);
      } else {
        commonLines++;
      }
    }

    return {
      additions: additionsArr.join(''),
      deletions: deletionsArr.join(''),
      common: '',
      addedLines,
      deletedLines,
      commonLines,
    };
  }

  // ─── Lexical similarity ───────────────────────────────────────────────────

  /**
   * Compute lexical similarity between two texts (0-1).
   * Uses Jaccard similarity on character bigrams.
   */
  computeLexicalSimilarity(textA: string, textB: string): number {
    if (textA === textB) return 1.0;
    if (textA.length === 0 && textB.length === 0) return 1.0;
    if (textA.length === 0 || textB.length === 0) return 0.0;

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

  // ─── Semantic similarity ──────────────────────────────────────────────────

  /**
   * Compute semantic similarity using word-level Jaccard similarity.
   * Normalizes texts (lowercase, strip punctuation, filter short words)
   * and compares word sets. This is a lightweight approximation of
   * true semantic similarity — in production, use actual embeddings.
   */
  computeSemanticSimilarity(textA: string, textB: string): number {
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

  // ─── Test set execution ───────────────────────────────────────────────────

  /**
   * Run a test set against a prompt version.
   * Executes each input through the API and records results.
   *
   * @param testSetId - ID of the test set to run
   * @param promptId - ID of the prompt to use
   * @param versionId - ID of the version to use
   * @param options - Optional callbacks and abort signal
   * @returns Array of test run results
   */
  async runTestSet(
    testSetId: string,
    promptId: string,
    versionId: string,
    options: RunTestSetOptions = {},
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

    // Get prompt metadata to build the API request
    const promptRow = conn
      .prepare(
        `SELECT model, temperature, maxTokens, system_prompt FROM prompts WHERE id = ?`,
      )
      .get(promptId) as {
        model: string;
        temperature: number;
        maxTokens: number;
        system_prompt: string | null;
      } | undefined;

    if (!promptRow) {
      throw new Error(`Prompt ${promptId} not found`);
    }

    // Get version metadata
    const versionRow = conn
      .prepare(
        `SELECT model, temperature, max_tokens, system_prompt FROM prompt_versions WHERE id = ?`,
      )
      .get(versionId) as {
        model: string;
        temperature: number;
        maxTokens: number;
        system_prompt: string | null;
      } | undefined;

    if (!versionRow) {
      throw new Error(`Version ${versionId} not found`);
    }

    const results: TestRunResult[] = [];

    for (const row of rows) {
      // Check for abort
      if (options.signal?.aborted) {
        break;
      }

      const startTime = Date.now();
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();

      try {
        // Use version metadata if available, otherwise fall back to prompt metadata
        const model = versionRow.model || promptRow.model;
        const temperature = versionRow.temperature ?? promptRow.temperature;
        const maxTokens = versionRow.maxTokens ?? promptRow.maxTokens;
        const systemPrompt = versionRow.system_prompt ?? promptRow.system_prompt;

        // Build the API request
        const messages: Array<{ role: string; content: string }> = [];
        if (systemPrompt) {
          messages.push({ role: 'system', content: systemPrompt });
        }
        messages.push({ role: 'user', content: row.input });

        // Make the API call (non-streaming)
        const apiKey = process.env.OPENAI_API_KEY || 'ollama';
        const baseUrl = process.env.OPENAI_BASE_URL || 'http://localhost:11434/v1';

        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey !== 'ollama' ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            model,
            messages,
            temperature,
            max_tokens: maxTokens,
            stream: false,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`API error ${response.status}: ${errorText}`);
        }

        const apiResponse = await response.json() as {
          choices: Array<{ message: { content: string }; finish_reason?: string }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        };

        const output = apiResponse.choices[0]?.message?.content ?? '';
        const latencyMs = Date.now() - startTime;

        // Extract token count from API response or estimate
        const tokenCount = apiResponse.usage?.completion_tokens
          ?? Math.ceil(output.length / 4);

        const result: TestRunResult = {
          id,
          testSetId,
          promptId,
          versionId,
          input: row.input,
          output,
          tokenCount,
          latencyMs,
          createdAt,
        };

        results.push(result);

        // Notify callback
        if (options.onResult) {
          options.onResult(result);
        }
      } catch (error) {
        const latencyMs = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        const result: TestRunResult = {
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
        };

        results.push(result);

        // Notify callback even on error
        if (options.onResult) {
          options.onResult(result);
        }
      }
    }

    return results;
  }

  // ─── Cost estimation ──────────────────────────────────────────────────────

  /**
   * Estimate the cost of an API call based on model and token counts.
   * Uses rough per-token pricing from common OpenAI-compatible models.
   */
  estimateCost(params: { model: string; promptTokens: number; completionTokens: number }): number {
    const model = params.model.toLowerCase();
    let promptPricePer1K = 0.000005; // default $0.005/1K tokens
    let completionPricePer1K = 0.000015; // default $0.015/1K tokens

    // GPT-4 pricing
    if (model.includes('gpt-4')) {
      if (model.includes('4o')) {
        promptPricePer1K = 0.0000025; // $0.0025/1K
        completionPricePer1K = 0.00001; // $0.01/1K
      } else if (model.includes('4-turbo')) {
        promptPricePer1K = 0.00001; // $0.01/1K
        completionPricePer1K = 0.00003; // $0.03/1K
      } else if (model.includes('4-32k')) {
        promptPricePer1K = 0.00006; // $0.06/1K
        completionPricePer1K = 0.00018; // $0.18/1K
      } else {
        promptPricePer1K = 0.00003; // $0.03/1K
        completionPricePer1K = 0.00006; // $0.06/1K
      }
    }
    // GPT-3.5 pricing
    else if (model.includes('gpt-3')) {
      promptPricePer1K = 0.0000015; // $0.0015/1K
      completionPricePer1K = 0.000002; // $0.002/1K
    }
    // Ollama/local models are typically free
    else if (model.includes('ollama') || model.includes('local')) {
      promptPricePer1K = 0;
      completionPricePer1K = 0;
    }

    const promptCost = (params.promptTokens / 1000) * promptPricePer1K;
    const completionCost = (params.completionTokens / 1000) * completionPricePer1K;

    return Math.round((promptCost + completionCost) * 10000) / 10000;
  }

  // ─── Test set management ──────────────────────────────────────────────────

  /**
   * Create a test set with the given inputs.
   */
  createTestSet(data: TestSetCreate): TestSet {
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
   * Get a test set by ID, including its inputs.
   */
  getTestSet(id: string): TestSet | undefined {
    const conn = this.db.connection;

    const row = conn
      .prepare(
        `SELECT id, name, description, created_at, updated_at FROM test_sets WHERE id = ?`,
      )
      .get(id) as { id: string; name: string; description: string | null; created_at: string; updated_at: string } | undefined;

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
   * List all test sets with their input counts.
   */
  listTestSets(): TestSet[] {
    const conn = this.db.connection;

    const rows = conn
      .prepare(
        `SELECT id, name, description, created_at, updated_at FROM test_sets ORDER BY created_at DESC`,
      )
      .all() as { id: string; name: string; description: string | null; created_at: string; updated_at: string }[];

    return rows.map((row) => {
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
    });
  }
}
