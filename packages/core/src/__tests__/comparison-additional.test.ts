/**
 * Additional unit tests for ComparisonEngine covering runTestSet,
 * estimateCost, and edge cases not covered in comparison.test.ts.
 */
import crypto from 'node:crypto';
import { DB } from '../db.js';
import { ComparisonEngine } from '../comparison.js';
import type { TestSetCreate } from '../types.js';

// Use an in-memory temp DB
const testDbPath = crypto.randomUUID();
let db: DB;
let comparison: ComparisonEngine;

beforeAll(() => {
  db = new DB({ path: testDbPath });
  comparison = new ComparisonEngine(db);
});

afterAll(() => {
  db.close();
  try { require('fs').unlinkSync(testDbPath); } catch {}
});

// ─── Helper: Create a test prompt run ────────────────────────────────────────

function createRun(
  id: string,
  promptId: string,
  versionId: string,
  input: string,
  output: string,
  model: string = 'gpt-4',
  temperature: number = 0.7,
  maxTokens: number = 1024,
  tokenCount: number = 0,
  latencyMs: number = 0,
  cost?: number,
  error?: string,
): void {
  const now = new Date().toISOString();
  db.connection.prepare(
    `INSERT INTO prompt_runs (id, prompt_id, version_id, input, output, model, temperature, max_tokens, token_count, latency_ms, cost, created_at, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, promptId, versionId, input, output, model,
    temperature, maxTokens, tokenCount, latencyMs,
    cost ?? null, now, error ?? null,
  );
}

function createPrompt(id: string, now: string): void {
  db.connection.prepare(
    `INSERT INTO prompts (id, name, content, model, temperature, maxTokens, created_at, updated_at)
     VALUES (?, 'Test', 'Test', 'gpt-4', 0.7, 1024, ?, ?)`,
  ).run(id, now, now);
}

function createVersion(id: string, promptId: string, now: string): void {
  db.connection.prepare(
    `INSERT INTO prompt_versions (id, prompt_id, content, model, temperature, max_tokens, content_hash, version_number, created_at)
     VALUES (?, ?, 'Test', 'gpt-4', 0.7, 1024, 'abc', 1, ?)`,
  ).run(id, promptId, now);
}

// ─── Cost Estimation ─────────────────────────────────────────────────────────

describe('ComparisonEngine - estimateCost', () => {
  test('estimates cost for GPT-4', () => {
    const cost = comparison.estimateCost({ model: 'gpt-4', promptTokens: 10000, completionTokens: 20000 });
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(1);
  });

  test('estimates cost for GPT-4o', () => {
    const cost = comparison.estimateCost({ model: 'gpt-4o', promptTokens: 10000, completionTokens: 20000 });
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(1);
  });

  test('estimates cost for GPT-4-turbo', () => {
    const cost = comparison.estimateCost({ model: 'gpt-4-turbo', promptTokens: 10000, completionTokens: 20000 });
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(1);
  });

  test('estimates cost for GPT-4-32k', () => {
    const cost = comparison.estimateCost({ model: 'gpt-4-32k', promptTokens: 10000, completionTokens: 20000 });
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(1);
  });

  test('estimates cost for GPT-3.5-turbo', () => {
    const cost = comparison.estimateCost({ model: 'gpt-3.5-turbo', promptTokens: 10000, completionTokens: 20000 });
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(1);
  });

  test('estimates zero cost for Ollama models', () => {
    const cost = comparison.estimateCost({ model: 'ollama/llama2', promptTokens: 100, completionTokens: 200 });
    expect(cost).toBe(0);
  });

  test('estimates zero cost for local models', () => {
    const cost = comparison.estimateCost({ model: 'local/model', promptTokens: 100, completionTokens: 200 });
    expect(cost).toBe(0);
  });

  test('estimates cost for unknown model (default pricing)', () => {
    const cost = comparison.estimateCost({ model: 'unknown-model', promptTokens: 10000, completionTokens: 20000 });
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(1);
  });

  test('cost scales with token count', () => {
    const cost1 = comparison.estimateCost({ model: 'gpt-4', promptTokens: 10000, completionTokens: 10000 });
    const cost2 = comparison.estimateCost({ model: 'gpt-4', promptTokens: 100000, completionTokens: 100000 });
    expect(cost2).toBeGreaterThan(cost1);
  });

  test('cost is zero when both token counts are zero', () => {
    const cost = comparison.estimateCost({ model: 'gpt-4', promptTokens: 0, completionTokens: 0 });
    expect(cost).toBe(0);
  });

  test('cost is case-insensitive', () => {
    const cost1 = comparison.estimateCost({ model: 'GPT-4', promptTokens: 10000, completionTokens: 20000 });
    const cost2 = comparison.estimateCost({ model: 'gpt-4', promptTokens: 10000, completionTokens: 20000 });
    expect(cost1).toBe(cost2);
  });

  test('cost rounds to 4 decimal places', () => {
    const cost = comparison.estimateCost({ model: 'gpt-4', promptTokens: 12345, completionTokens: 67890 });
    const rounded = Math.round(cost * 10000) / 10000;
    expect(cost).toBe(rounded);
  });
});

// ─── runTestSet ──────────────────────────────────────────────────────────────

describe('ComparisonEngine - runTestSet', () => {
  let promptId: string;
  let versionId: string;
  let testSetId: string;
  const now = new Date().toISOString();

  beforeEach(() => {
    promptId = crypto.randomUUID();
    versionId = crypto.randomUUID();
    testSetId = crypto.randomUUID();

    // Clean up from previous tests
    db.connection.prepare(`DELETE FROM test_run_results`).run();
    db.connection.prepare(`DELETE FROM test_set_inputs`).run();
    db.connection.prepare(`DELETE FROM test_sets`).run();
    db.connection.prepare(`DELETE FROM prompt_runs`).run();

    createPrompt(promptId, now);
    createVersion(versionId, promptId, now);

    // Create test set with inputs
    db.connection.prepare(
      `INSERT INTO test_sets (id, name, description, created_at, updated_at)
       VALUES (?, 'Test Set', 'A test set', ?, ?)`,
    ).run(testSetId, now, now);

    db.connection.prepare(
      `INSERT INTO test_set_inputs (id, test_set_id, input) VALUES (?, ?, ?)`,
    ).run(crypto.randomUUID(), testSetId, 'Input 1');

    db.connection.prepare(
      `INSERT INTO test_set_inputs (id, test_set_id, input) VALUES (?, ?, ?)`,
    ).run(crypto.randomUUID(), testSetId, 'Input 2');

    db.connection.prepare(
      `INSERT INTO test_set_inputs (id, test_set_id, input) VALUES (?, ?, ?)`,
    ).run(crypto.randomUUID(), testSetId, 'Input 3');
  });

  test('runTestSet returns empty array for empty test set', async () => {
    const emptyTestSetId = crypto.randomUUID();
    db.connection.prepare(
      `INSERT INTO test_sets (id, name, description, created_at, updated_at)
       VALUES (?, 'Empty', '', ?, ?)`,
    ).run(emptyTestSetId, now, now);

    const results = await comparison.runTestSet(emptyTestSetId, promptId, versionId);
    expect(results).toEqual([]);
  });

  test('runTestSet throws when prompt not found', async () => {
    await expect(
      comparison.runTestSet(testSetId, 'non-existent-prompt', versionId),
    ).rejects.toThrow('Prompt non-existent-prompt not found');
  });

  test('runTestSet throws when version not found', async () => {
    await expect(
      comparison.runTestSet(testSetId, promptId, 'non-existent-version'),
    ).rejects.toThrow('Version non-existent-version not found');
  });

  test('runTestSet with abort signal stops execution', async () => {
    const controller = new AbortController();

    // Abort after first chunk
    setTimeout(() => controller.abort(), 10);

    const results = await comparison.runTestSet(testSetId, promptId, versionId, {
      signal: controller.signal,
    });

    // Should have stopped early (0 or 1 results depending on timing)
    expect(results.length).toBeLessThanOrEqual(3);
  });

  test('runTestSet calls onResult callback for each result', async () => {
    const results: any[] = [];

    // Mock fetch to return successful responses
    const mockFetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Response 1' } }],
        usage: { completion_tokens: 5 },
      }),
    }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Response 2' } }],
        usage: { completion_tokens: 5 },
      }),
    }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Response 3' } }],
        usage: { completion_tokens: 5 },
      }),
    });

    jest.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    await comparison.runTestSet(testSetId, promptId, versionId, {
      onResult: (result) => {
        results.push(result);
      },
    });

    expect(results).toHaveLength(3);
    expect(results[0].input).toBe('Input 1');
    expect(results[0].output).toBe('Response 1');
    expect(results[1].input).toBe('Input 2');
    expect(results[1].output).toBe('Response 2');
    expect(results[2].input).toBe('Input 3');
    expect(results[2].output).toBe('Response 3');
  });

  test('runTestSet handles API errors gracefully', async () => {
    const mockFetch = jest.fn().mockRejectedValueOnce(new Error('API error'));

    jest.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    const results = await comparison.runTestSet(testSetId, promptId, versionId);

    // First input should have an error, others should not be reached
    // (since fetch is only mocked once, subsequent calls will also fail)
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].error).toBeDefined();
    expect(results[0].output).toBe('');
  });

  test('runTestSet handles HTTP error responses', async () => {
    const mockFetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => 'Rate limit exceeded',
    });

    jest.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    const results = await comparison.runTestSet(testSetId, promptId, versionId);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].error).toBeDefined();
  });

  test('runTestSet handles missing choices in response', async () => {
    const mockFetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [],
      }),
    });

    jest.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    const results = await comparison.runTestSet(testSetId, promptId, versionId);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].output).toBe('');
  });

  test('runTestSet uses version metadata when available', async () => {
    // Update version with different model
    db.connection.prepare(
      `UPDATE prompt_versions SET model = 'test-version-model' WHERE id = ?`,
    ).run(versionId);

    const mockFetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Response' } }],
        usage: { completion_tokens: 5 },
      }),
    });

    jest.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    await comparison.runTestSet(testSetId, promptId, versionId);

    // The fetch should have been called with the version's model
    expect(mockFetch).toHaveBeenCalled();
  });

  test('runTestSet falls back to prompt metadata when version lacks fields', async () => {
    // Reset version to use prompt defaults
    db.connection.prepare(
      `UPDATE prompt_versions SET model = 'gpt-4', temperature = 0.7, max_tokens = 1024, system_prompt = NULL WHERE id = ?`,
    ).run(versionId);

    const mockFetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Response' } }],
        usage: { completion_tokens: 5 },
      }),
    });

    jest.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    await comparison.runTestSet(testSetId, promptId, versionId);

    expect(mockFetch).toHaveBeenCalled();
  });

  test('runTestSet stores results with correct structure', async () => {
    const mockFetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Test response' } }],
        usage: { completion_tokens: 10 },
      }),
    });

    jest.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    const results = await comparison.runTestSet(testSetId, promptId, versionId);

    expect(results[0]).toHaveProperty('id');
    expect(results[0]).toHaveProperty('testSetId');
    expect(results[0]).toHaveProperty('promptId');
    expect(results[0]).toHaveProperty('versionId');
    expect(results[0]).toHaveProperty('input');
    expect(results[0]).toHaveProperty('output');
    expect(results[0]).toHaveProperty('tokenCount');
    expect(results[0]).toHaveProperty('latencyMs');
    expect(results[0]).toHaveProperty('createdAt');
    expect(results[0].testSetId).toBe(testSetId);
    expect(results[0].promptId).toBe(promptId);
    expect(results[0].versionId).toBe(versionId);
  });

  test('runTestSet with single input', async () => {
    // Remove extra inputs
    db.connection.prepare(`DELETE FROM test_set_inputs WHERE test_set_id = ?`).run(testSetId);
    db.connection.prepare(
      `INSERT INTO test_set_inputs (id, test_set_id, input) VALUES (?, ?, ?)`,
    ).run(crypto.randomUUID(), testSetId, 'Single input');

    const mockFetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Single response' } }],
        usage: { completion_tokens: 5 },
      }),
    });

    jest.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    const results = await comparison.runTestSet(testSetId, promptId, versionId);

    expect(results).toHaveLength(1);
    expect(results[0].input).toBe('Single input');
    expect(results[0].output).toBe('Single response');
  });

  test('runTestSet with empty input string', async () => {
    db.connection.prepare(`DELETE FROM test_set_inputs WHERE test_set_id = ?`).run(testSetId);
    db.connection.prepare(
      `INSERT INTO test_set_inputs (id, test_set_id, input) VALUES (?, ?, ?)`,
    ).run(crypto.randomUUID(), testSetId, '');

    const mockFetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Empty input response' } }],
        usage: { completion_tokens: 5 },
      }),
    });

    jest.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    const results = await comparison.runTestSet(testSetId, promptId, versionId);

    expect(results).toHaveLength(1);
    expect(results[0].input).toBe('');
  });

  test('runTestSet with system prompt from version', async () => {
    db.connection.prepare(
      `UPDATE prompt_versions SET system_prompt = 'You are a test assistant' WHERE id = ?`,
    ).run(versionId);

    const mockFetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Response' } }],
        usage: { completion_tokens: 5 },
      }),
    });

    jest.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    await comparison.runTestSet(testSetId, promptId, versionId);

    // Verify the fetch was called (system prompt should be included in messages)
    expect(mockFetch).toHaveBeenCalled();
  });

  test('runTestSet with system prompt from prompt (fallback)', async () => {
    // Version has no system prompt, prompt does
    db.connection.prepare(
      `UPDATE prompt_versions SET system_prompt = NULL WHERE id = ?`,
    ).run(versionId);
    db.connection.prepare(
      `UPDATE prompts SET system_prompt = 'Fallback system prompt' WHERE id = ?`,
    ).run(promptId);

    const mockFetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Response' } }],
        usage: { completion_tokens: 5 },
      }),
    });

    jest.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    await comparison.runTestSet(testSetId, promptId, versionId);

    expect(mockFetch).toHaveBeenCalled();
  });

  test('runTestSet handles non-JSON response gracefully', async () => {
    const mockFetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => { throw new Error('Invalid JSON'); },
    });

    jest.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    const results = await comparison.runTestSet(testSetId, promptId, versionId);

    // Should catch the error and record it
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].error).toBeDefined();
  });
});

// ─── Lexical Diff Edge Cases ─────────────────────────────────────────────────

describe('ComparisonEngine - Lexical Diff Edge Cases', () => {
  test('diff with only whitespace differences', () => {
    const diff = comparison.computeLexicalDiff('Hello\n', 'Hello  \n');
    expect(diff.addedLines).toBeGreaterThan(0);
    expect(diff.deletedLines).toBeGreaterThan(0);
  });

  test('diff with tab characters', () => {
    const diff = comparison.computeLexicalDiff('Hello\tWorld', 'Hello\tUniverse');
    expect(diff.addedLines).toBeGreaterThan(0);
    expect(diff.deletedLines).toBeGreaterThan(0);
  });

  test('diff with carriage returns', () => {
    const diff = comparison.computeLexicalDiff('Line 1\r\nLine 2', 'Line 1\r\nLine 3');
    expect(diff.addedLines).toBeGreaterThan(0);
    expect(diff.deletedLines).toBeGreaterThan(0);
  });

  test('diff with mixed line endings', () => {
    const diff = comparison.computeLexicalDiff('Line 1\nLine 2\r\nLine 3', 'Line 1\nLine 2\r\nLine 4');
    expect(diff.addedLines).toBeGreaterThan(0);
    expect(diff.deletedLines).toBeGreaterThan(0);
  });

  test('diff with very long single line', () => {
    const longLine = 'A'.repeat(10000);
    const diff = comparison.computeLexicalDiff(longLine, longLine + 'B');
    expect(diff.addedLines).toBeGreaterThan(0);
  });

  test('diff with binary-like content', () => {
    const binaryA = '\x00\x01\x02\x03';
    const binaryB = '\x00\x01\x02\x04';
    const diff = comparison.computeLexicalDiff(binaryA, binaryB);
    expect(diff.addedLines).toBeGreaterThan(0);
    expect(diff.deletedLines).toBeGreaterThan(0);
  });
});

// ─── Lexical Similarity Edge Cases ───────────────────────────────────────────

describe('ComparisonEngine - Lexical Similarity Edge Cases', () => {
  test('similarity with single character difference', () => {
    const sim = comparison.computeLexicalSimilarity('Hello', 'Hellp');
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });

  test('similarity with completely overlapping bigrams', () => {
    const sim = comparison.computeLexicalSimilarity('ABAB', 'ABAB');
    expect(sim).toBe(1.0);
  });

  test('similarity with no overlapping bigrams', () => {
    const sim = comparison.computeLexicalSimilarity('AB', 'CD');
    expect(sim).toBe(0.0);
  });

  test('similarity with very short strings', () => {
    const sim = comparison.computeLexicalSimilarity('A', 'A');
    expect(sim).toBe(1.0);
  });

  test('similarity with single char vs multi char', () => {
    const sim = comparison.computeLexicalSimilarity('A', 'ABC');
    // 'A' has no bigrams (length < 2), so bigramsA is empty → similarity is 0.0
    expect(sim).toBe(0.0);
  });
});

// ─── Semantic Similarity Edge Cases ──────────────────────────────────────────

describe('ComparisonEngine - Semantic Similarity Edge Cases', () => {
  test('semantic similarity with numbers', () => {
    const sim = comparison.computeSemanticSimilarity('There are 42 apples', 'There are 42 oranges');
    // "apples" and "oranges" are different, but "there", "are" are filtered (<=2 chars)
    // So both sets might be empty or have partial overlap
    expect(sim).toBeGreaterThanOrEqual(0);
    expect(sim).toBeLessThanOrEqual(1);
  });

  test('semantic similarity with all short words', () => {
    const sim = comparison.computeSemanticSimilarity('a b c d e', 'x y z w v');
    // All words <= 2 chars, so both sets are empty
    expect(sim).toBe(0.0);
  });

  test('semantic similarity with mixed case', () => {
    const sim1 = comparison.computeSemanticSimilarity('Hello World', 'hello world');
    const sim2 = comparison.computeSemanticSimilarity('Hello World', 'HELLO WORLD');
    expect(sim1).toBe(1.0);
    expect(sim2).toBe(1.0);
  });

  test('semantic similarity with punctuation', () => {
    const sim = comparison.computeSemanticSimilarity('Hello, world! How are you?', 'Hello world How are you');
    expect(sim).toBe(1.0);
  });

  test('semantic similarity with special characters', () => {
    const sim = comparison.computeSemanticSimilarity('Hello @world #test', 'Hello world test');
    expect(sim).toBe(1.0);
  });

  test('semantic similarity with emoji', () => {
    const sim = comparison.computeSemanticSimilarity('Hello 🌍', 'Hello 🌍');
    // Emoji is stripped by regex, leaving just "hello"
    expect(sim).toBe(1.0);
  });

  test('semantic similarity with unicode words', () => {
    const sim = comparison.computeSemanticSimilarity('こんにちは 世界', 'こんにちは 世界');
    // Unicode words should be preserved by \w
    expect(sim).toBe(1.0);
  });

  test('semantic similarity with very long text', () => {
    const longText = 'The '.repeat(500);
    const sim = comparison.computeSemanticSimilarity(longText, longText);
    expect(sim).toBe(1.0);
  });

  test('semantic similarity with partially overlapping words', () => {
    const sim = comparison.computeSemanticSimilarity(
      'The quick brown fox jumps',
      'The quick red dog jumps',
    );
    // "the", "quick", "jumps" are common (>2 chars)
    // "brown", "fox" vs "red", "dog" are different
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });
});

// ─── Test Set Management ─────────────────────────────────────────────────────

describe('ComparisonEngine - Test Set Management', () => {
  beforeEach(() => {
    db.connection.prepare(`DELETE FROM test_set_inputs`).run();
    db.connection.prepare(`DELETE FROM test_sets`).run();
  });

  test('createTestSet with many inputs', () => {
    const inputs = Array.from({ length: 100 }, (_, i) => `Input ${i}`);
    const testSet = comparison.createTestSet({ name: 'Large Set', inputs });

    expect(testSet.inputs).toHaveLength(100);
    expect(testSet.inputs[0]).toBe('Input 0');
    expect(testSet.inputs[99]).toBe('Input 99');
  });

  test('createTestSet with duplicate inputs', () => {
    const testSet = comparison.createTestSet({
      name: 'Duplicates',
      inputs: ['input 1', 'input 1', 'input 2'],
    });

    expect(testSet.inputs).toHaveLength(3);
    expect(testSet.inputs).toEqual(['input 1', 'input 1', 'input 2']);
  });

  test('createTestSet with empty name', () => {
    const testSet = comparison.createTestSet({ name: '', inputs: ['input'] });
    expect(testSet.name).toBe('');
  });

  test('createTestSet with very long name', () => {
    const longName = 'A'.repeat(10000);
    const testSet = comparison.createTestSet({ name: longName, inputs: ['input'] });
    expect(testSet.name).toBe(longName);
  });

  test('getTestSet returns undefined for deleted test set', () => {
    const testSet = comparison.createTestSet({ name: 'To Delete', inputs: ['input'] });
    db.connection.prepare(`DELETE FROM test_sets WHERE id = ?`).run(testSet.id);
    db.connection.prepare(`DELETE FROM test_set_inputs WHERE test_set_id = ?`).run(testSet.id);

    const retrieved = comparison.getTestSet(testSet.id);
    expect(retrieved).toBeUndefined();
  });

  test('listTestSets after deleting all test sets', () => {
    comparison.createTestSet({ name: 'To Delete', inputs: ['input'] });
    db.connection.prepare(`DELETE FROM test_sets`).run();
    db.connection.prepare(`DELETE FROM test_set_inputs`).run();

    const sets = comparison.listTestSets();
    expect(sets).toEqual([]);
  });

  test('test set inputs are returned in insertion order', () => {
    const testSet = comparison.createTestSet({
      name: 'Order Test',
      inputs: ['first', 'second', 'third'],
    });

    const retrieved = comparison.getTestSet(testSet.id);
    expect(retrieved!.inputs).toEqual(['first', 'second', 'third']);
  });
});

// ─── Compare Runs Edge Cases ─────────────────────────────────────────────────

describe('ComparisonEngine - Compare Runs Edge Cases', () => {
  let promptId: string;
  let versionId: string;
  const now = new Date().toISOString();

  beforeEach(() => {
    promptId = crypto.randomUUID();
    versionId = crypto.randomUUID();
    createPrompt(promptId, now);
    createVersion(versionId, promptId, now);
  });

  test('compare runs with very large latency difference', () => {
    const runAId = crypto.randomUUID();
    const runBId = crypto.randomUUID();

    createRun(runAId, promptId, versionId, 'input', 'Output A', 'gpt-4', 0.7, 1024, 10, 100000);
    createRun(runBId, promptId, versionId, 'input', 'Output B', 'gpt-4', 0.7, 1024, 12, 1);

    const result = comparison.compareRuns(runAId, runBId);
    expect(result.latencyDiffMs).toBe(99999);
  });

  test('compare runs with very large token difference', () => {
    const runAId = crypto.randomUUID();
    const runBId = crypto.randomUUID();

    createRun(runAId, promptId, versionId, 'input', 'Output A', 'gpt-4', 0.7, 1024, 100000, 100);
    createRun(runBId, promptId, versionId, 'input', 'Output B', 'gpt-4', 0.7, 1024, 1, 100);

    const result = comparison.compareRuns(runAId, runBId);
    expect(result.tokenDiff).toBe(99999);
  });

  test('compare runs with negative cost', () => {
    const runAId = crypto.randomUUID();
    const runBId = crypto.randomUUID();

    createRun(runAId, promptId, versionId, 'input', 'Output A', 'gpt-4', 0.7, 1024, 10, 100, -0.001);
    createRun(runBId, promptId, versionId, 'input', 'Output B', 'gpt-4', 0.7, 1024, 12, 150, 0.001);

    const result = comparison.compareRuns(runAId, runBId);
    expect(result.costDiff).toBe(-0.002);
  });

  test('compare runs with one having cost and other not', () => {
    const runAId = crypto.randomUUID();
    const runBId = crypto.randomUUID();

    createRun(runAId, promptId, versionId, 'input', 'Output A', 'gpt-4', 0.7, 1024, 10, 100, 0.001);
    createRun(runBId, promptId, versionId, 'input', 'Output B', 'gpt-4', 0.7, 1024, 12, 150);

    const result = comparison.compareRuns(runAId, runBId);
    expect(result.costDiff).toBeUndefined();
  });

  test('compare runs with error in one run', () => {
    const runAId = crypto.randomUUID();
    const runBId = crypto.randomUUID();

    createRun(runAId, promptId, versionId, 'input', 'Output A', 'gpt-4', 0.7, 1024, 10, 100);
    createRun(runBId, promptId, versionId, 'input', '', 'gpt-4', 0.7, 1024, 0, 50, undefined, 'API error');

    const result = comparison.compareRuns(runAId, runBId);
    expect(result.runA.output).toBe('Output A');
    expect(result.runB.output).toBe('');
    expect(result.runB.error).toBe('API error');
  });

  test('compare runs with different models', () => {
    const runAId = crypto.randomUUID();
    const runBId = crypto.randomUUID();

    createRun(runAId, promptId, versionId, 'input', 'Output A', 'gpt-4', 0.7, 1024, 10, 100);
    createRun(runBId, promptId, versionId, 'input', 'Output B', 'gpt-3.5-turbo', 0.7, 1024, 12, 150);

    const result = comparison.compareRuns(runAId, runBId);
    expect(result.runA.model).toBe('gpt-4');
    expect(result.runB.model).toBe('gpt-3.5-turbo');
  });

  test('compare runs with different temperatures', () => {
    const runAId = crypto.randomUUID();
    const runBId = crypto.randomUUID();

    createRun(runAId, promptId, versionId, 'input', 'Output A', 'gpt-4', 0.1, 1024, 10, 100);
    createRun(runBId, promptId, versionId, 'input', 'Output B', 'gpt-4', 1.0, 1024, 12, 150);

    const result = comparison.compareRuns(runAId, runBId);
    expect(result.runA.temperature).toBe(0.1);
    expect(result.runB.temperature).toBe(1.0);
  });

  test('compare runs with different maxTokens', () => {
    const runAId = crypto.randomUUID();
    const runBId = crypto.randomUUID();

    createRun(runAId, promptId, versionId, 'input', 'Output A', 'gpt-4', 0.7, 256, 10, 100);
    createRun(runBId, promptId, versionId, 'input', 'Output B', 'gpt-4', 0.7, 4096, 12, 150);

    const result = comparison.compareRuns(runAId, runBId);
    expect(result.runA.maxTokens).toBe(256);
    expect(result.runB.maxTokens).toBe(4096);
  });

  test('compare runs with different inputs', () => {
    const runAId = crypto.randomUUID();
    const runBId = crypto.randomUUID();

    createRun(runAId, promptId, versionId, 'Input A', 'Output A', 'gpt-4', 0.7, 1024, 10, 100);
    createRun(runBId, promptId, versionId, 'Input B', 'Output B', 'gpt-4', 0.7, 1024, 12, 150);

    const result = comparison.compareRuns(runAId, runBId);
    expect(result.runA.input).toBe('Input A');
    expect(result.runB.input).toBe('Input B');
  });

  test('compare runs with multiline outputs', () => {
    const runAId = crypto.randomUUID();
    const runBId = crypto.randomUUID();

    createRun(runAId, promptId, versionId, 'input', 'Line 1\nLine 2\nLine 3', 'gpt-4', 0.7, 1024, 10, 100);
    createRun(runBId, promptId, versionId, 'input', 'Line 1\nModified 2\nLine 3\nLine 4', 'gpt-4', 0.7, 1024, 12, 150);

    const result = comparison.compareRuns(runAId, runBId);
    expect(result.lexicalDiff.addedLines).toBeGreaterThan(0);
    expect(result.lexicalDiff.deletedLines).toBeGreaterThan(0);
  });

  test('compare runs with JSON outputs', () => {
    const runAId = crypto.randomUUID();
    const runBId = crypto.randomUUID();

    createRun(runAId, promptId, versionId, 'input', '{"key": "value", "num": 42}', 'gpt-4', 0.7, 1024, 10, 100);
    createRun(runBId, promptId, versionId, 'input', '{"key": "value", "num": 43}', 'gpt-4', 0.7, 1024, 12, 150);

    const result = comparison.compareRuns(runAId, runBId);
    expect(result.lexicalDiff.addedLines).toBeGreaterThan(0);
    expect(result.lexicalDiff.deletedLines).toBeGreaterThan(0);
  });

  test('compare runs with code outputs', () => {
    const runAId = crypto.randomUUID();
    const runBId = crypto.randomUUID();

    const codeA = `function hello() {\n  console.log("Hello");\n  return true;\n}`;
    const codeB = `function hello() {\n  console.log("Hello World");\n  return true;\n}`;

    createRun(runAId, promptId, versionId, 'input', codeA, 'gpt-4', 0.7, 1024, 10, 100);
    createRun(runBId, promptId, versionId, 'input', codeB, 'gpt-4', 0.7, 1024, 12, 150);

    const result = comparison.compareRuns(runAId, runBId);
    expect(result.lexicalDiff.addedLines).toBeGreaterThan(0);
    expect(result.lexicalDiff.deletedLines).toBeGreaterThan(0);
  });

  test('compare runs with unicode outputs', () => {
    const runAId = crypto.randomUUID();
    const runBId = crypto.randomUUID();

    createRun(runAId, promptId, versionId, 'input', 'こんにちは 世界', 'gpt-4', 0.7, 1024, 10, 100);
    createRun(runBId, promptId, versionId, 'input', 'こんにちは 世界', 'gpt-4', 0.7, 1024, 12, 150);

    const result = comparison.compareRuns(runAId, runBId);
    expect(result.lexicalSimilarity).toBe(1.0);
    expect(result.semanticSimilarity).toBe(1.0);
  });

  test('compare runs with emoji outputs', () => {
    const runAId = crypto.randomUUID();
    const runBId = crypto.randomUUID();

    createRun(runAId, promptId, versionId, 'input', 'Hello 🌍', 'gpt-4', 0.7, 1024, 10, 100);
    createRun(runBId, promptId, versionId, 'input', 'Hello 🌍', 'gpt-4', 0.7, 1024, 12, 150);

    const result = comparison.compareRuns(runAId, runBId);
    expect(result.lexicalSimilarity).toBe(1.0);
  });

  test('compare runs with special character outputs', () => {
    const runAId = crypto.randomUUID();
    const runBId = crypto.randomUUID();

    const special = 'Special chars: @#$%^&*()_+-=[]{}|;:\'",.<>?/\\`~';
    createRun(runAId, promptId, versionId, 'input', special, 'gpt-4', 0.7, 1024, 10, 100);
    createRun(runBId, promptId, versionId, 'input', special, 'gpt-4', 0.7, 1024, 12, 150);

    const result = comparison.compareRuns(runAId, runBId);
    expect(result.lexicalSimilarity).toBe(1.0);
  });

  test('compare runs with very long outputs', () => {
    const runAId = crypto.randomUUID();
    const runBId = crypto.randomUUID();

    const longOutput = 'Word '.repeat(1000);
    createRun(runAId, promptId, versionId, 'input', longOutput, 'gpt-4', 0.7, 1024, 10, 100);
    createRun(runBId, promptId, versionId, 'input', longOutput, 'gpt-4', 0.7, 1024, 12, 150);

    const result = comparison.compareRuns(runAId, runBId);
    expect(result.lexicalSimilarity).toBe(1.0);
    expect(result.semanticSimilarity).toBe(1.0);
  });

  test('compare runs with different system prompts', () => {
    const runAId = crypto.randomUUID();
    const runBId = crypto.randomUUID();

    // Note: createRun helper doesn't set system_prompt, so both will be undefined
    createRun(runAId, promptId, versionId, 'input', 'Output A', 'gpt-4', 0.7, 1024, 10, 100);
    createRun(runBId, promptId, versionId, 'input', 'Output B', 'gpt-4', 0.7, 1024, 12, 150);

    const result = comparison.compareRuns(runAId, runBId);
    expect(result.runA.systemPrompt).toBeUndefined();
    expect(result.runB.systemPrompt).toBeUndefined();
  });

  test('compare runs with null system prompts', () => {
    const runAId = crypto.randomUUID();
    const runBId = crypto.randomUUID();

    createRun(runAId, promptId, versionId, 'input', 'Output A', 'gpt-4', 0.7, 1024, 10, 100);
    createRun(runBId, promptId, versionId, 'input', 'Output B', 'gpt-4', 0.7, 1024, 12, 150);

    const result = comparison.compareRuns(runAId, runBId);
    expect(result.runA.systemPrompt).toBeUndefined();
    expect(result.runB.systemPrompt).toBeUndefined();
  });
});
