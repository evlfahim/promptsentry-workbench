/**
 * Integration test: verify core functionality end-to-end
 */
import crypto from 'node:crypto';
import { DB } from './db';
import { VersioningEngine } from './versioning';
import { ComparisonEngine } from './comparison';
import type { PromptCreate, PromptVersionCreate } from './types';

// Use an in-memory temp DB
const testDbPath = crypto.randomUUID();

let db: DB;
let versioning: VersioningEngine;
let comparison: ComparisonEngine;

beforeAll(() => {
  db = new DB({ path: testDbPath });
  versioning = new VersioningEngine(db);
  comparison = new ComparisonEngine(db);
});

afterAll(() => {
  db.close();
  // Clean up temp file
  try { require('fs').unlinkSync(testDbPath); } catch {}
});

describe('VersioningEngine', () => {
  const promptId = crypto.randomUUID();
  const now = new Date().toISOString();

  beforeEach(() => {
    const conn = db.connection;
    conn.prepare(
      `INSERT INTO prompts (id, name, content, model, temperature, maxTokens, created_at, updated_at)
       VALUES (?, 'Test Prompt', 'Hello world', 'gpt-4', 0.7, 1024, ?, ?)`,
    ).run(promptId, now, now);
  });

  test('creates a version', () => {
    const data: PromptVersionCreate = {
      promptId,
      content: 'Hello world v2',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };
    const version = versioning.createVersion(promptId, data);
    expect(version).toBeDefined();
    expect(version!.versionNumber).toBe(1);
    expect(version!.content).toBe('Hello world v2');
  });

  test('skips duplicate content', () => {
    const data: PromptVersionCreate = {
      promptId,
      content: 'Hello world',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };
    versioning.createVersion(promptId, data);
    const result = versioning.createVersion(promptId, data);
    expect(result).toBeUndefined();
  });

  test('increments version numbers', () => {
    const data1: PromptVersionCreate = {
      promptId,
      content: 'Version 1',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };
    const data2: PromptVersionCreate = {
      promptId,
      content: 'Version 2',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };
    versioning.createVersion(promptId, data1);
    const v2 = versioning.createVersion(promptId, data2);
    expect(v2!.versionNumber).toBe(2);
  });

  test('lists versions in order', () => {
    const data1: PromptVersionCreate = {
      promptId,
      content: 'V1',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };
    const data2: PromptVersionCreate = {
      promptId,
      content: 'V2',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };
    versioning.createVersion(promptId, data1);
    versioning.createVersion(promptId, data2);
    const versions = versioning.listVersions(promptId);
    expect(versions).toHaveLength(2);
    expect(versions[0].versionNumber).toBe(1);
    expect(versions[1].versionNumber).toBe(2);
  });

  test('computes hash', () => {
    const hash1 = versioning.computeHash('hello');
    const hash2 = versioning.computeHash('hello');
    const hash3 = versioning.computeHash('world');
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
  });

  test('gets version diff', () => {
    const data1: PromptVersionCreate = {
      promptId,
      content: 'Line 1\nLine 2\nLine 3',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };
    const data2: PromptVersionCreate = {
      promptId,
      content: 'Line 1\nLine 2 modified\nLine 3\nLine 4',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };
    const v1 = versioning.createVersion(promptId, data1)!;
    const v2 = versioning.createVersion(promptId, data2)!;
    const diff = versioning.getVersionDiff(v1.id, v2.id);
    expect(diff.addedLines).toBeGreaterThan(0);
    expect(diff.deletedLines).toBeGreaterThan(0);
  });

  test('rollback creates new version', () => {
    const data1: PromptVersionCreate = {
      promptId,
      content: 'Original',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };
    const data2: PromptVersionCreate = {
      promptId,
      content: 'Modified',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };
    const v1 = versioning.createVersion(promptId, data1)!;
    versioning.createVersion(promptId, data2);
    const updated = versioning.rollbackToVersion(promptId, v1.id);
    expect(updated.content).toBe('Original');
    const versions = versioning.listVersions(promptId);
    expect(versions).toHaveLength(3);
  });
});

describe('ComparisonEngine', () => {
  const promptId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const now = new Date().toISOString();

  beforeEach(() => {
    const conn = db.connection;
    conn.prepare(
      `INSERT INTO prompts (id, name, content, model, temperature, maxTokens, created_at, updated_at)
       VALUES (?, 'Test', 'Test', 'gpt-4', 0.7, 1024, ?, ?)`,
    ).run(promptId, now, now);
    conn.prepare(
      `INSERT INTO prompt_versions (id, prompt_id, content, model, temperature, max_tokens, content_hash, version_number, created_at)
       VALUES (?, ?, 'Test', 'gpt-4', 0.7, 1024, 'abc', 1, ?)`,
    ).run(versionId, promptId, now);
  });

  test('compares two runs', () => {
    const conn = db.connection;
    const runAId = crypto.randomUUID();
    const runBId = crypto.randomUUID();

    conn.prepare(
      `INSERT INTO prompt_runs (id, prompt_id, version_id, input, output, model, temperature, max_tokens, token_count, latency_ms, created_at)
       VALUES (?, ?, ?, 'test input', 'Output A', 'gpt-4', 0.7, 1024, 10, 100, ?)`,
    ).run(runAId, promptId, versionId, now);

    conn.prepare(
      `INSERT INTO prompt_runs (id, prompt_id, version_id, input, output, model, temperature, max_tokens, token_count, latency_ms, created_at)
       VALUES (?, ?, ?, 'test input', 'Output B', 'gpt-4', 0.7, 1024, 12, 150, ?)`,
    ).run(runBId, promptId, versionId, now);

    const result = comparison.compareRuns(runAId, runBId);
    expect(result.runA.output).toBe('Output A');
    expect(result.runB.output).toBe('Output B');
    expect(result.lexicalSimilarity).toBeGreaterThan(0);
    expect(result.latencyDiffMs).toBe(-50);
    expect(result.tokenDiff).toBe(-2);
  });

  test('creates and retrieves test set', () => {
    const testSet = comparison.createTestSet({
      name: 'Test Suite',
      description: 'A test suite',
      inputs: ['input 1', 'input 2', 'input 3'],
    });
    expect(testSet.name).toBe('Test Suite');
    expect(testSet.inputs).toHaveLength(3);

    const retrieved = comparison.getTestSet(testSet.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.name).toBe('Test Suite');
    expect(retrieved!.inputs).toEqual(['input 1', 'input 2', 'input 3']);
  });

  test('lists test sets', () => {
    comparison.createTestSet({ name: 'Suite A', inputs: ['a'] });
    comparison.createTestSet({ name: 'Suite B', inputs: ['b'] });
    const sets = comparison.listTestSets();
    expect(sets).toHaveLength(2);
  });
});

describe('DB', () => {
  test('creates tables', () => {
    const testDb = new DB({ path: crypto.randomUUID() });
    const conn = testDb.connection;
    const tables = conn
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as { name: string }[];
    const tableNames = tables.map(t => t.name);
    testDb.close();

    expect(tableNames).toContain('prompts');
    expect(tableNames).toContain('prompt_versions');
    expect(tableNames).toContain('prompt_runs');
    expect(tableNames).toContain('test_sets');
    expect(tableNames).toContain('test_set_inputs');
    expect(tableNames).toContain('test_run_results');
    expect(tableNames).toContain('api_config');
  });
});
