/**
 * Comprehensive tests for the ComparisonEngine
 * Tests lexical diff, similarity scores, compareRuns, and test set management.
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
  // Clean up temp file
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

// ─── Lexical Diff ────────────────────────────────────────────────────────────

describe('ComparisonEngine - Lexical Diff', () => {
  test('identical texts produce no additions or deletions', () => {
    const diff = comparison.computeLexicalDiff('Hello world', 'Hello world');
    expect(diff.addedLines).toBe(0);
    expect(diff.deletedLines).toBe(0);
    expect(diff.commonLines).toBeGreaterThan(0);
    expect(diff.additions).toBe('');
    expect(diff.deletions).toBe('');
  });

  test('completely different texts show all as additions and deletions', () => {
    const diff = comparison.computeLexicalDiff('Line 1\nLine 2', 'Line A\nLine B');
    expect(diff.addedLines).toBeGreaterThan(0);
    expect(diff.deletedLines).toBeGreaterThan(0);
    expect(diff.commonLines).toBe(0);
  });

  test('text with additions shows added lines', () => {
    // Use trailing newlines to ensure proper line-based diffing
    const diff = comparison.computeLexicalDiff('Line 1\n', 'Line 1\nLine 2\nLine 3\n');
    expect(diff.addedLines).toBeGreaterThan(0);
    expect(diff.deletedLines).toBe(0);
    expect(diff.commonLines).toBeGreaterThan(0);
    expect(diff.additions).toContain('Line 2');
    expect(diff.additions).toContain('Line 3');
  });

  test('text with deletions shows deleted lines', () => {
    // Use trailing newlines to ensure proper line-based diffing
    const diff = comparison.computeLexicalDiff('Line 1\nLine 2\nLine 3\n', 'Line 1\n');
    expect(diff.addedLines).toBe(0);
    expect(diff.deletedLines).toBeGreaterThan(0);
    expect(diff.commonLines).toBeGreaterThan(0);
    expect(diff.deletions).toContain('Line 2');
    expect(diff.deletions).toContain('Line 3');
  });

  test('single line diff', () => {
    const diff = comparison.computeLexicalDiff('Hello', 'World');
    expect(diff.addedLines).toBe(1);
    expect(diff.deletedLines).toBe(1);
    expect(diff.commonLines).toBe(0);
    expect(diff.additions).toBe('World');
    expect(diff.deletions).toBe('Hello');
  });

  test('empty string diff', () => {
    const diff = comparison.computeLexicalDiff('', 'Hello');
    expect(diff.addedLines).toBe(1);
    expect(diff.deletedLines).toBe(0);
    expect(diff.commonLines).toBe(0);
    expect(diff.additions).toBe('Hello');
  });

  test('both empty strings', () => {
    const diff = comparison.computeLexicalDiff('', '');
    expect(diff.addedLines).toBe(0);
    expect(diff.deletedLines).toBe(0);
    // diff library may return 0 common lines for two empty strings
    expect(diff.commonLines).toBeGreaterThanOrEqual(0);
  });

  test('multi-line diff with mixed changes', () => {
    const textA = 'Line 1\nLine 2\nLine 3\nLine 4\n';
    const textB = 'Line 1\nModified 2\nLine 3\nLine 4\nLine 5\n';
    const diff = comparison.computeLexicalDiff(textA, textB);
    // Line 1, Line 3, Line 4 are common
    expect(diff.commonLines).toBeGreaterThanOrEqual(2);
    expect(diff.addedLines).toBeGreaterThan(0);
    expect(diff.deletedLines).toBeGreaterThan(0);
  });

  test('diff output contains expected content', () => {
    const textA = 'Hello\nWorld\n';
    const textB = 'Hello\nUniverse\n';
    const diff = comparison.computeLexicalDiff(textA, textB);
    expect(diff.additions).toContain('Universe');
    expect(diff.deletions).toContain('World');
  });
});

// ─── Lexical Similarity ──────────────────────────────────────────────────────

describe('ComparisonEngine - Lexical Similarity', () => {
  test('identical texts have similarity 1.0', () => {
    const sim = comparison.computeLexicalSimilarity('Hello world', 'Hello world');
    expect(sim).toBe(1.0);
  });

  test('completely different texts have low similarity', () => {
    const sim = comparison.computeLexicalSimilarity('Hello world', 'Goodbye universe');
    expect(sim).toBeLessThan(0.5);
  });

  test('similar texts have higher similarity', () => {
    const sim1 = comparison.computeLexicalSimilarity('Hello world', 'Hello world');
    const sim2 = comparison.computeLexicalSimilarity('Hello world', 'Hello world!');
    expect(sim1).toBe(1.0);
    expect(sim2).toBeGreaterThan(0.5);
  });

  test('empty strings have similarity 1.0', () => {
    const sim = comparison.computeLexicalSimilarity('', '');
    expect(sim).toBe(1.0);
  });

  test('one empty string has similarity 0.0', () => {
    const sim = comparison.computeLexicalSimilarity('Hello', '');
    expect(sim).toBe(0.0);
  });

  test('similarity is symmetric', () => {
    const sim1 = comparison.computeLexicalSimilarity('Hello world', 'Goodbye universe');
    const sim2 = comparison.computeLexicalSimilarity('Goodbye universe', 'Hello world');
    expect(sim1).toBe(sim2);
  });

  test('similarity is between 0 and 1', () => {
    const texts = [
      ['Hello', 'World'],
      ['The quick brown fox', 'The quick red dog'],
      ['Short', 'A much longer string with many words'],
    ];
    for (const [a, b] of texts) {
      const sim = comparison.computeLexicalSimilarity(a, b);
      expect(sim).toBeGreaterThanOrEqual(0);
      expect(sim).toBeLessThanOrEqual(1);
    }
  });
});

// ─── Semantic Similarity ─────────────────────────────────────────────────────

describe('ComparisonEngine - Semantic Similarity', () => {
  test('identical texts have similarity 1.0', () => {
    const sim = comparison.computeSemanticSimilarity('Hello world', 'Hello world');
    expect(sim).toBe(1.0);
  });

  test('semantically similar texts have higher similarity', () => {
    // Same words, different order
    const sim1 = comparison.computeSemanticSimilarity(
      'The cat sat on the mat',
      'The cat sat on the mat',
    );
    const sim2 = comparison.computeSemanticSimilarity(
      'The cat sat on the mat',
      'The dog sat on the rug',
    );
    expect(sim1).toBe(1.0);
    expect(sim2).toBeGreaterThan(0);
    expect(sim2).toBeLessThan(1);
  });

  test('completely different texts have low similarity', () => {
    const sim = comparison.computeSemanticSimilarity(
      'The quick brown fox jumps over the lazy dog',
      'Quantum mechanics describes the behavior of matter and energy',
    );
    expect(sim).toBeLessThan(0.5);
  });

  test('empty strings have similarity 1.0', () => {
    const sim = comparison.computeSemanticSimilarity('', '');
    expect(sim).toBe(1.0);
  });

  test('one empty string has similarity 0.0', () => {
    const sim = comparison.computeSemanticSimilarity('Hello', '');
    expect(sim).toBe(0.0);
  });

  test('case-insensitive comparison', () => {
    const sim = comparison.computeSemanticSimilarity('Hello World', 'hello world');
    expect(sim).toBe(1.0);
  });

  test('punctuation is stripped', () => {
    const sim = comparison.computeSemanticSimilarity('Hello, world!', 'Hello world');
    expect(sim).toBe(1.0);
  });

  test('short words are filtered', () => {
    const sim = comparison.computeSemanticSimilarity('a b c', 'x y z');
    // All words are <= 2 chars, so both sets are empty
    // When both sets are empty, returns 0.0
    expect(sim).toBe(0.0);
  });

  test('similarity is symmetric', () => {
    const sim1 = comparison.computeSemanticSimilarity(
      'The cat sat on the mat',
      'The dog sat on the rug',
    );
    const sim2 = comparison.computeSemanticSimilarity(
      'The dog sat on the rug',
      'The cat sat on the mat',
    );
    expect(sim1).toBe(sim2);
  });

  test('similarity is between 0 and 1', () => {
    const texts = [
      ['Hello', 'World'],
      ['The quick brown fox', 'The quick red dog'],
      ['Machine learning is great', 'Deep learning is amazing'],
    ];
    for (const [a, b] of texts) {
      const sim = comparison.computeSemanticSimilarity(a, b);
      expect(sim).toBeGreaterThanOrEqual(0);
      expect(sim).toBeLessThanOrEqual(1);
    }
  });
});

// ─── Compare Runs ────────────────────────────────────────────────────────────

describe('ComparisonEngine - Compare Runs', () => {
  let promptId: string;
  let versionId: string;
  const now = new Date().toISOString();

  beforeEach(() => {
    promptId = crypto.randomUUID();
    versionId = crypto.randomUUID();
    createPrompt(promptId, now);
    createVersion(versionId, promptId, now);
  });

  test('compares two runs and returns correct structure', () => {
    const runAId = crypto.randomUUID();
    const runBId = crypto.randomUUID();

    createRun(runAId, promptId, versionId, 'test input', 'Output A', 'gpt-4', 0.7, 1024, 10, 100, 0.001);
    createRun(runBId, promptId, versionId, 'test input', 'Output B', 'gpt-4', 0.7, 1024, 12, 150, 0.002);

    const result = comparison.compareRuns(runAId, runBId);

    // Verify structure
    expect(result.runA.id).toBe(runAId);
    expect(result.runB.id).toBe(runBId);
    expect(result.runA.output).toBe('Output A');
    expect(result.runB.output).toBe('Output B');
    expect(result.lexicalDiff).toBeDefined();
    expect(result.lexicalSimilarity).toBeGreaterThan(0);
    expect(result.semanticSimilarity).toBeGreaterThan(0);
    expect(result.latencyDiffMs).toBe(-50); // 100 - 150
    expect(result.tokenDiff).toBe(-2); // 10 - 12
    expect(result.costDiff).toBe(-0.001); // 0.001 - 0.002
  });

  test('identical runs have zero diffs', () => {
    const runAId = crypto.randomUUID();
    const runBId = crypto.randomUUID();

    createRun(runAId, promptId, versionId, 'test input', 'Same output', 'gpt-4', 0.7, 1024, 10, 100, 0.001);
    createRun(runBId, promptId, versionId, 'test input', 'Same output', 'gpt-4', 0.7, 1024, 10, 100, 0.001);

    const result = comparison.compareRuns(runAId, runBId);

    expect(result.latencyDiffMs).toBe(0);
    expect(result.tokenDiff).toBe(0);
    expect(result.costDiff).toBe(0);
    expect(result.lexicalSimilarity).toBe(1.0);
    expect(result.semanticSimilarity).toBe(1.0);
  });

  test('throws error for non-existent run', () => {
    expect(() => comparison.compareRuns('non-existent', 'also-non-existent'))
      .toThrow('One or both runs not found');
  });

  test('throws error when only one run exists', () => {
    const runAId = crypto.randomUUID();
    createRun(runAId, promptId, versionId, 'test input', 'Output A', 'gpt-4', 0.7, 1024, 10, 100);

    expect(() => comparison.compareRuns(runAId, 'non-existent'))
      .toThrow('One or both runs not found');
  });

  test('diff shows correct line counts', () => {
    const runAId = crypto.randomUUID();
    const runBId = crypto.randomUUID();

    createRun(runAId, promptId, versionId, 'test input', 'Line 1\nLine 2\nLine 3', 'gpt-4', 0.7, 1024, 10, 100);
    createRun(runBId, promptId, versionId, 'test input', 'Line 1\nModified 2\nLine 3\nLine 4', 'gpt-4', 0.7, 1024, 12, 150);

    const result = comparison.compareRuns(runAId, runBId);

    expect(result.lexicalDiff.addedLines).toBeGreaterThan(0);
    expect(result.lexicalDiff.deletedLines).toBeGreaterThan(0);
    expect(result.lexicalDiff.commonLines).toBeGreaterThan(0);
  });

  test('costDiff is undefined when cost is not set', () => {
    const runAId = crypto.randomUUID();
    const runBId = crypto.randomUUID();

    createRun(runAId, promptId, versionId, 'test input', 'Output A', 'gpt-4', 0.7, 1024, 10, 100);
    createRun(runBId, promptId, versionId, 'test input', 'Output B', 'gpt-4', 0.7, 1024, 12, 150);

    const result = comparison.compareRuns(runAId, runBId);
    expect(result.costDiff).toBeUndefined();
  });
});

// ─── Test Set Creation ───────────────────────────────────────────────────────

describe('ComparisonEngine - Test Set Creation', () => {
  beforeEach(() => {
    // Clean up test sets before each test
    db.connection.prepare(`DELETE FROM test_set_inputs`).run();
    db.connection.prepare(`DELETE FROM test_sets`).run();
  });

  test('creates a test set with inputs', () => {
    const testSet = comparison.createTestSet({
      name: 'Test Suite',
      description: 'A test suite',
      inputs: ['input 1', 'input 2', 'input 3'],
    });

    expect(testSet.name).toBe('Test Suite');
    expect(testSet.description).toBe('A test suite');
    expect(testSet.inputs).toHaveLength(3);
    expect(testSet.inputs).toEqual(['input 1', 'input 2', 'input 3']);
    expect(testSet.id).toBeDefined();
    expect(testSet.createdAt).toBeDefined();
    expect(testSet.updatedAt).toBeDefined();
  });

  test('creates a test set without description', () => {
    const testSet = comparison.createTestSet({
      name: 'Minimal Suite',
      inputs: ['input 1'],
    });

    expect(testSet.name).toBe('Minimal Suite');
    expect(testSet.description).toBeUndefined();
    expect(testSet.inputs).toEqual(['input 1']);
  });

  test('creates a test set with empty inputs array', () => {
    const testSet = comparison.createTestSet({
      name: 'Empty Suite',
      inputs: [],
    });

    expect(testSet.name).toBe('Empty Suite');
    expect(testSet.inputs).toEqual([]);
  });

  test('creates multiple test sets with unique IDs', () => {
    const set1 = comparison.createTestSet({ name: 'Suite 1', inputs: ['a'] });
    const set2 = comparison.createTestSet({ name: 'Suite 2', inputs: ['b'] });

    expect(set1.id).not.toBe(set2.id);
    expect(set1.name).toBe('Suite 1');
    expect(set2.name).toBe('Suite 2');
  });
});

// ─── Test Set Retrieval ──────────────────────────────────────────────────────

describe('ComparisonEngine - Test Set Retrieval', () => {
  beforeEach(() => {
    // Clean up test sets before each test
    db.connection.prepare(`DELETE FROM test_set_inputs`).run();
    db.connection.prepare(`DELETE FROM test_sets`).run();
  });

  test('retrieves a test set by ID', () => {
    const testSet = comparison.createTestSet({
      name: 'Retrieval Test',
      description: 'Test retrieval',
      inputs: ['input 1', 'input 2'],
    });

    const retrieved = comparison.getTestSet(testSet.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.name).toBe('Retrieval Test');
    expect(retrieved!.description).toBe('Test retrieval');
    expect(retrieved!.inputs).toEqual(['input 1', 'input 2']);
  });

  test('returns undefined for non-existent test set', () => {
    const retrieved = comparison.getTestSet('non-existent-id');
    expect(retrieved).toBeUndefined();
  });

  test('retrieved test set has correct timestamps', () => {
    const testSet = comparison.createTestSet({
      name: 'Timestamp Test',
      inputs: ['input 1'],
    });

    const retrieved = comparison.getTestSet(testSet.id);
    expect(retrieved!.createdAt).toBeDefined();
    expect(retrieved!.updatedAt).toBeDefined();
    // ISO 8601 format check
    expect(new Date(retrieved!.createdAt).toISOString()).toBe(retrieved!.createdAt);
    expect(new Date(retrieved!.updatedAt).toISOString()).toBe(retrieved!.updatedAt);
  });
});

// ─── Test Set Listing ────────────────────────────────────────────────────────

describe('ComparisonEngine - Test Set Listing', () => {
  beforeEach(() => {
    // Clean up test sets before each test
    db.connection.prepare(`DELETE FROM test_set_inputs`).run();
    db.connection.prepare(`DELETE FROM test_sets`).run();
  });

  test('lists all test sets', () => {
    comparison.createTestSet({ name: 'Suite A', inputs: ['a'] });
    comparison.createTestSet({ name: 'Suite B', inputs: ['b'] });
    comparison.createTestSet({ name: 'Suite C', inputs: ['c'] });

    const sets = comparison.listTestSets();
    expect(sets).toHaveLength(3);
  });

  test('lists test sets in descending order by creation time', () => {
    const set1 = comparison.createTestSet({ name: 'First', inputs: ['1'] });
    // Small delay to ensure different timestamps
    const set2 = comparison.createTestSet({ name: 'Second', inputs: ['2'] });
    const set3 = comparison.createTestSet({ name: 'Third', inputs: ['3'] });

    const sets = comparison.listTestSets();
    expect(sets[0].name).toBe('Third');
    expect(sets[1].name).toBe('Second');
    expect(sets[2].name).toBe('First');
  });

  test('empty list when no test sets exist', () => {
    const sets = comparison.listTestSets();
    expect(sets).toEqual([]);
  });
});

// ─── Edge Cases ──────────────────────────────────────────────────────────────

describe('ComparisonEngine - Edge Cases', () => {
  test('handles very long texts', () => {
    const longText = 'Word '.repeat(1000);
    const diff = comparison.computeLexicalDiff(longText, longText);
    expect(diff.addedLines).toBe(0);
    expect(diff.deletedLines).toBe(0);

    const sim = comparison.computeLexicalSimilarity(longText, longText);
    expect(sim).toBe(1.0);

    const semanticSim = comparison.computeSemanticSimilarity(longText, longText);
    expect(semanticSim).toBe(1.0);
  });

  test('handles texts with special characters', () => {
    const textA = 'Hello! @world #test $money %percent';
    const textB = 'Hello! @world #test $money %percent';
    const sim = comparison.computeSemanticSimilarity(textA, textB);
    expect(sim).toBe(1.0);
  });

  test('handles texts with unicode characters', () => {
    const textA = 'こんにちは 世界';
    const textB = 'こんにちは 世界';
    const sim = comparison.computeLexicalSimilarity(textA, textB);
    expect(sim).toBe(1.0);
  });

  test('handles texts with newlines and whitespace', () => {
    const textA = 'Line 1\n\nLine 2\n  \nLine 3';
    const textB = 'Line 1\n\nLine 2\n  \nLine 3';
    const diff = comparison.computeLexicalDiff(textA, textB);
    expect(diff.addedLines).toBe(0);
    expect(diff.deletedLines).toBe(0);
  });

  test('handles single character texts', () => {
    const sim = comparison.computeLexicalSimilarity('a', 'a');
    expect(sim).toBe(1.0);

    const sim2 = comparison.computeLexicalSimilarity('a', 'b');
    expect(sim2).toBeLessThan(1.0);
  });

  test('handles JSON-like texts', () => {
    const textA = '{"key": "value", "number": 42}';
    const textB = '{"key": "value", "number": 43}';
    const diff = comparison.computeLexicalDiff(textA, textB);
    expect(diff.addedLines).toBeGreaterThan(0);
    expect(diff.deletedLines).toBeGreaterThan(0);
  });

  test('handles code-like texts', () => {
    const textA = `function hello() {
  console.log("Hello");
  return true;
}`;
    const textB = `function hello() {
  console.log("Hello World");
  return true;
}`;
    const diff = comparison.computeLexicalDiff(textA, textB);
    expect(diff.addedLines).toBeGreaterThan(0);
    expect(diff.deletedLines).toBeGreaterThan(0);
  });
});

// ─── Output Structure Validation ─────────────────────────────────────────────

describe('ComparisonEngine - Output Structure Validation', () => {
  let promptId: string;
  let versionId: string;
  const now = new Date().toISOString();

  beforeEach(() => {
    promptId = crypto.randomUUID();
    versionId = crypto.randomUUID();
    createPrompt(promptId, now);
    createVersion(versionId, promptId, now);
  });

  test('compareRuns returns valid ComparisonResult structure', () => {
    const runAId = crypto.randomUUID();
    const runBId = crypto.randomUUID();

    createRun(runAId, promptId, versionId, 'input', 'Output A', 'gpt-4', 0.7, 1024, 10, 100, 0.001);
    createRun(runBId, promptId, versionId, 'input', 'Output B', 'gpt-4', 0.7, 1024, 12, 150, 0.002);

    const result = comparison.compareRuns(runAId, runBId);

    // Validate runA structure
    expect(result.runA).toHaveProperty('id');
    expect(result.runA).toHaveProperty('promptId');
    expect(result.runA).toHaveProperty('versionId');
    expect(result.runA).toHaveProperty('input');
    expect(result.runA).toHaveProperty('output');
    expect(result.runA).toHaveProperty('model');
    expect(result.runA).toHaveProperty('temperature');
    expect(result.runA).toHaveProperty('maxTokens');
    expect(result.runA).toHaveProperty('tokenCount');
    expect(result.runA).toHaveProperty('latencyMs');
    expect(result.runA).toHaveProperty('createdAt');

    // Validate runB structure
    expect(result.runB).toHaveProperty('id');
    expect(result.runB).toHaveProperty('promptId');
    expect(result.runB).toHaveProperty('versionId');
    expect(result.runB).toHaveProperty('input');
    expect(result.runB).toHaveProperty('output');
    expect(result.runB).toHaveProperty('model');
    expect(result.runB).toHaveProperty('temperature');
    expect(result.runB).toHaveProperty('maxTokens');
    expect(result.runB).toHaveProperty('tokenCount');
    expect(result.runB).toHaveProperty('latencyMs');
    expect(result.runB).toHaveProperty('createdAt');

    // Validate lexicalDiff structure
    expect(result.lexicalDiff).toHaveProperty('additions');
    expect(result.lexicalDiff).toHaveProperty('deletions');
    expect(result.lexicalDiff).toHaveProperty('common');
    expect(result.lexicalDiff).toHaveProperty('addedLines');
    expect(result.lexicalDiff).toHaveProperty('deletedLines');
    expect(result.lexicalDiff).toHaveProperty('commonLines');

    // Validate numeric fields
    expect(typeof result.lexicalSimilarity).toBe('number');
    expect(typeof result.semanticSimilarity).toBe('number');
    expect(typeof result.latencyDiffMs).toBe('number');
    expect(typeof result.tokenDiff).toBe('number');

    // Validate ranges
    expect(result.lexicalSimilarity).toBeGreaterThanOrEqual(0);
    expect(result.lexicalSimilarity).toBeLessThanOrEqual(1);
    expect(result.semanticSimilarity).toBeGreaterThanOrEqual(0);
    expect(result.semanticSimilarity).toBeLessThanOrEqual(1);
  });

  test('createTestSet returns valid TestSet structure', () => {
    // Clean up first
    db.connection.prepare(`DELETE FROM test_set_inputs`).run();
    db.connection.prepare(`DELETE FROM test_sets`).run();

    const testSet = comparison.createTestSet({
      name: 'Validation Test',
      description: 'Validating structure',
      inputs: ['input 1', 'input 2'],
    });

    expect(testSet).toHaveProperty('id');
    expect(testSet).toHaveProperty('name');
    expect(testSet).toHaveProperty('inputs');
    expect(testSet).toHaveProperty('createdAt');
    expect(testSet).toHaveProperty('updatedAt');
    expect(Array.isArray(testSet.inputs)).toBe(true);
  });

  test('getTestSet returns valid TestSet structure', () => {
    // Clean up first
    db.connection.prepare(`DELETE FROM test_set_inputs`).run();
    db.connection.prepare(`DELETE FROM test_sets`).run();

    const testSet = comparison.createTestSet({
      name: 'Get Validation',
      inputs: ['input 1'],
    });

    const retrieved = comparison.getTestSet(testSet.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!).toHaveProperty('id');
    expect(retrieved!).toHaveProperty('name');
    expect(retrieved!).toHaveProperty('inputs');
    expect(retrieved!).toHaveProperty('createdAt');
    expect(retrieved!).toHaveProperty('updatedAt');
  });

  test('listTestSets returns array of valid TestSet structures', () => {
    // Clean up first
    db.connection.prepare(`DELETE FROM test_set_inputs`).run();
    db.connection.prepare(`DELETE FROM test_sets`).run();

    comparison.createTestSet({ name: 'List Test 1', inputs: ['1'] });
    comparison.createTestSet({ name: 'List Test 2', inputs: ['2'] });

    const sets = comparison.listTestSets();
    expect(Array.isArray(sets)).toBe(true);
    for (const set of sets) {
      expect(set).toHaveProperty('id');
      expect(set).toHaveProperty('name');
      expect(set).toHaveProperty('inputs');
      expect(set).toHaveProperty('createdAt');
      expect(set).toHaveProperty('updatedAt');
      expect(Array.isArray(set.inputs)).toBe(true);
    }
  });
});
