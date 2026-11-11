/**
 * Comprehensive unit tests for the DB module.
 * Covers table creation, schema validation, foreign keys, WAL mode,
 * and various edge cases.
 */
import crypto from 'node:crypto';
import { DB } from '../db.js';

// Use an in-memory temp DB
const testDbPath = crypto.randomUUID();

describe('DB - Table Creation', () => {
  test('creates all required tables', () => {
    const db = new DB({ path: testDbPath });
    const conn = db.connection;

    const tables = conn
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as { name: string }[];

    const tableNames = tables.map(t => t.name);

    expect(tableNames).toContain('prompts');
    expect(tableNames).toContain('prompt_versions');
    expect(tableNames).toContain('prompt_runs');
    expect(tableNames).toContain('test_sets');
    expect(tableNames).toContain('test_set_inputs');
    expect(tableNames).toContain('test_run_results');
    expect(tableNames).toContain('api_config');

    db.close();
  });

  test('creates all required indexes', () => {
    const db = new DB({ path: testDbPath });
    const conn = db.connection;

    const indexes = conn
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name`)
      .all() as { name: string }[];

    const indexNames = indexes.map(i => i.name);

    expect(indexNames).toContain('idx_prompt_versions_prompt_id');
    expect(indexNames).toContain('idx_prompt_versions_hash');
    expect(indexNames).toContain('idx_prompt_runs_prompt_id');
    expect(indexNames).toContain('idx_prompt_runs_version_id');
    expect(indexNames).toContain('idx_test_set_inputs_test_set_id');

    db.close();
  });

  test('tables have correct columns', () => {
    const db = new DB({ path: testDbPath });
    const conn = db.connection;

    // Check prompts table columns
    const promptsColumns = conn
      .prepare(`PRAGMA table_info(prompts)`)
      .all() as { name: string }[];

    const promptColumnNames = promptsColumns.map(c => c.name);
    expect(promptColumnNames).toContain('id');
    expect(promptColumnNames).toContain('name');
    expect(promptColumnNames).toContain('content');
    expect(promptColumnNames).toContain('model');
    expect(promptColumnNames).toContain('temperature');
    expect(promptColumnNames).toContain('maxTokens');
    expect(promptColumnNames).toContain('system_prompt');
    expect(promptColumnNames).toContain('created_at');
    expect(promptColumnNames).toContain('updated_at');

    // Check prompt_versions table columns
    const versionColumns = conn
      .prepare(`PRAGMA table_info(prompt_versions)`)
      .all() as { name: string }[];

    const versionColumnNames = versionColumns.map(c => c.name);
    expect(versionColumnNames).toContain('id');
    expect(versionColumnNames).toContain('prompt_id');
    expect(versionColumnNames).toContain('content');
    expect(versionColumnNames).toContain('model');
    expect(versionColumnNames).toContain('temperature');
    expect(versionColumnNames).toContain('max_tokens');
    expect(versionColumnNames).toContain('system_prompt');
    expect(versionColumnNames).toContain('content_hash');
    expect(versionColumnNames).toContain('version_number');
    expect(versionColumnNames).toContain('created_at');
    expect(versionColumnNames).toContain('commit_message');

    // Check prompt_runs table columns
    const runColumns = conn
      .prepare(`PRAGMA table_info(prompt_runs)`)
      .all() as { name: string }[];

    const runColumnNames = runColumns.map(c => c.name);
    expect(runColumnNames).toContain('id');
    expect(runColumnNames).toContain('prompt_id');
    expect(runColumnNames).toContain('version_id');
    expect(runColumnNames).toContain('input');
    expect(runColumnNames).toContain('output');
    expect(runColumnNames).toContain('model');
    expect(runColumnNames).toContain('temperature');
    expect(runColumnNames).toContain('max_tokens');
    expect(runColumnNames).toContain('system_prompt');
    expect(runColumnNames).toContain('token_count');
    expect(runColumnNames).toContain('latency_ms');
    expect(runColumnNames).toContain('cost');
    expect(runColumnNames).toContain('created_at');
    expect(runColumnNames).toContain('error');

    // Check test_sets table columns
    const testSetColumns = conn
      .prepare(`PRAGMA table_info(test_sets)`)
      .all() as { name: string }[];

    const testSetColumnNames = testSetColumns.map(c => c.name);
    expect(testSetColumnNames).toContain('id');
    expect(testSetColumnNames).toContain('name');
    expect(testSetColumnNames).toContain('description');
    expect(testSetColumnNames).toContain('created_at');
    expect(testSetColumnNames).toContain('updated_at');

    // Check test_set_inputs table columns
    const inputColumns = conn
      .prepare(`PRAGMA table_info(test_set_inputs)`)
      .all() as { name: string }[];

    const inputColumnNames = inputColumns.map(c => c.name);
    expect(inputColumnNames).toContain('id');
    expect(inputColumnNames).toContain('test_set_id');
    expect(inputColumnNames).toContain('input');

    // Check test_run_results table columns
    const resultColumns = conn
      .prepare(`PRAGMA table_info(test_run_results)`)
      .all() as { name: string }[];

    const resultColumnNames = resultColumns.map(c => c.name);
    expect(resultColumnNames).toContain('id');
    expect(resultColumnNames).toContain('test_set_id');
    expect(resultColumnNames).toContain('prompt_id');
    expect(resultColumnNames).toContain('version_id');
    expect(resultColumnNames).toContain('input');
    expect(resultColumnNames).toContain('output');
    expect(resultColumnNames).toContain('token_count');
    expect(resultColumnNames).toContain('latency_ms');
    expect(resultColumnNames).toContain('cost');
    expect(resultColumnNames).toContain('error');
    expect(resultColumnNames).toContain('created_at');

    // Check api_config table columns
    const configColumns = conn
      .prepare(`PRAGMA table_info(api_config)`)
      .all() as { name: string }[];

    const configColumnNames = configColumns.map(c => c.name);
    expect(configColumnNames).toContain('key');
    expect(configColumnNames).toContain('value');

    db.close();
  });
});

describe('DB - Foreign Keys', () => {
  test('foreign keys are enforced', () => {
    const db = new DB({ path: testDbPath });
    const conn = db.connection;

    // Try to insert a prompt_run with non-existent prompt_id
    expect(() => {
      conn.prepare(
        `INSERT INTO prompt_runs (id, prompt_id, version_id, input, output, model, temperature, max_tokens, token_count, latency_ms, created_at)
         VALUES ('test-id', 'non-existent-prompt', 'non-existent-version', 'input', 'output', 'gpt-4', 0.7, 1024, 0, 0, '2024-01-01T00:00:00.000Z')`,
      ).run();
    }).toThrow();

    db.close();
  });

  test('foreign keys are enforced for version_id', () => {
    const db = new DB({ path: testDbPath });
    const conn = db.connection;

    // Insert a prompt first
    conn.prepare(
      `INSERT INTO prompts (id, name, content, model, temperature, maxTokens, created_at, updated_at)
       VALUES ('test-prompt', 'Test', 'Test', 'gpt-4', 0.7, 1024, '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z')`,
    ).run();

    // Try to insert a prompt_run with non-existent version_id
    expect(() => {
      conn.prepare(
        `INSERT INTO prompt_runs (id, prompt_id, version_id, input, output, model, temperature, max_tokens, token_count, latency_ms, created_at)
         VALUES ('test-id', 'test-prompt', 'non-existent-version', 'input', 'output', 'gpt-4', 0.7, 1024, 0, 0, '2024-01-01T00:00:00.000Z')`,
      ).run();
    }).toThrow();

    db.close();
  });

  test('cascade delete works for prompt_versions', () => {
    const db = new DB({ path: testDbPath });
    const conn = db.connection;

    // Insert a prompt and version
    const promptId = crypto.randomUUID();
    const versionId = crypto.randomUUID();

    conn.prepare(
      `INSERT INTO prompts (id, name, content, model, temperature, maxTokens, created_at, updated_at)
       VALUES (?, 'Test', 'Test', 'gpt-4', 0.7, 1024, '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z')`,
    ).run(promptId);

    conn.prepare(
      `INSERT INTO prompt_versions (id, prompt_id, content, model, temperature, max_tokens, content_hash, version_number, created_at)
       VALUES (?, ?, 'Test', 'gpt-4', 0.7, 1024, 'abc', 1, '2024-01-01T00:00:00.000Z')`,
    ).run(versionId, promptId);

    // Delete the prompt
    conn.prepare(`DELETE FROM prompts WHERE id = ?`).run(promptId);

    // Version should be cascade deleted
    const versions = conn
      .prepare(`SELECT * FROM prompt_versions WHERE id = ?`)
      .all(versionId);

    expect(versions).toHaveLength(0);

    db.close();
  });

  test('cascade delete works for test_set_inputs', () => {
    const db = new DB({ path: testDbPath });
    const conn = db.connection;

    const testSetId = crypto.randomUUID();
    const inputId = crypto.randomUUID();

    conn.prepare(
      `INSERT INTO test_sets (id, name, description, created_at, updated_at)
       VALUES (?, 'Test', 'Test', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z')`,
    ).run(testSetId);

    conn.prepare(
      `INSERT INTO test_set_inputs (id, test_set_id, input) VALUES (?, ?, ?)`,
    ).run(inputId, testSetId, 'Test input');

    // Delete the test set
    conn.prepare(`DELETE FROM test_sets WHERE id = ?`).run(testSetId);

    // Input should be cascade deleted
    const inputs = conn
      .prepare(`SELECT * FROM test_set_inputs WHERE id = ?`)
      .all(inputId);

    expect(inputs).toHaveLength(0);

    db.close();
  });
});

describe('DB - WAL Mode', () => {
  test('WAL journal mode is enabled', () => {
    const db = new DB({ path: testDbPath });
    const conn = db.connection;

    const journalMode = conn
      .prepare(`PRAGMA journal_mode`)
      .get() as { journal_mode: string };

    expect(journalMode.journal_mode).toBe('wal');

    db.close();
  });

  test('foreign keys pragma is enabled', () => {
    const db = new DB({ path: testDbPath });
    const conn = db.connection;

    const fkStatus = conn
      .prepare(`PRAGMA foreign_keys`)
      .get() as { foreign_keys: number };

    expect(fkStatus.foreign_keys).toBe(1);

    db.close();
  });
});

describe('DB - Connection', () => {
  test('connection getter returns the database instance', () => {
    const db = new DB({ path: testDbPath });
    const conn = db.connection;

    // Should be able to execute queries
    const result = conn.prepare(`SELECT 1 as test`).get() as { test: number };
    expect(result.test).toBe(1);

    db.close();
  });

  test('close method works', () => {
    const db = new DB({ path: testDbPath });
    db.close();

    // After close, should not be able to execute queries
    expect(() => {
      db.connection.prepare(`SELECT 1`).get();
    }).toThrow();
  });

  test('can create multiple DB instances', () => {
    const db1 = new DB({ path: testDbPath });
    const db2 = new DB({ path: testDbPath });

    // Both should work independently
    const result1 = db1.connection.prepare(`SELECT 1 as db`).get() as { db: number };
    const result2 = db2.connection.prepare(`SELECT 2 as db`).get() as { db: number };

    expect(result1.db).toBe(1);
    expect(result2.db).toBe(2);

    db1.close();
    db2.close();
  });
});

describe('DB - Data Operations', () => {
  test('can insert and retrieve prompts', () => {
    const db = new DB({ path: testDbPath });
    const conn = db.connection;

    const promptId = crypto.randomUUID();
    const now = new Date().toISOString();

    conn.prepare(
      `INSERT INTO prompts (id, name, content, model, temperature, maxTokens, created_at, updated_at)
       VALUES (?, 'Test Prompt', 'Test content', 'gpt-4', 0.7, 1024, ?, ?)`,
    ).run(promptId, now, now);

    const prompt = conn
      .prepare(`SELECT * FROM prompts WHERE id = ?`)
      .get(promptId) as any;

    expect(prompt.id).toBe(promptId);
    expect(prompt.name).toBe('Test Prompt');
    expect(prompt.content).toBe('Test content');
    expect(prompt.model).toBe('gpt-4');
    expect(prompt.temperature).toBe(0.7);
    expect(prompt.maxTokens).toBe(1024);

    db.close();
  });

  test('can insert and retrieve prompt_versions', () => {
    const db = new DB({ path: testDbPath });
    const conn = db.connection;

    const promptId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const now = new Date().toISOString();

    conn.prepare(
      `INSERT INTO prompts (id, name, content, model, temperature, maxTokens, created_at, updated_at)
       VALUES (?, 'Test', 'Test', 'gpt-4', 0.7, 1024, ?, ?)`,
    ).run(promptId, now, now);

    conn.prepare(
      `INSERT INTO prompt_versions (id, prompt_id, content, model, temperature, max_tokens, content_hash, version_number, created_at)
       VALUES (?, ?, 'Version content', 'gpt-4', 0.7, 1024, 'abc123', 1, ?)`,
    ).run(versionId, promptId, now);

    const version = conn
      .prepare(`SELECT * FROM prompt_versions WHERE id = ?`)
      .get(versionId) as any;

    expect(version.id).toBe(versionId);
    expect(version.prompt_id).toBe(promptId);
    expect(version.content).toBe('Version content');
    expect(version.content_hash).toBe('abc123');
    expect(version.version_number).toBe(1);

    db.close();
  });

  test('can insert and retrieve prompt_runs', () => {
    const db = new DB({ path: testDbPath });
    const conn = db.connection;

    const promptId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    const now = new Date().toISOString();

    conn.prepare(
      `INSERT INTO prompts (id, name, content, model, temperature, maxTokens, created_at, updated_at)
       VALUES (?, 'Test', 'Test', 'gpt-4', 0.7, 1024, ?, ?)`,
    ).run(promptId, now, now);

    conn.prepare(
      `INSERT INTO prompt_versions (id, prompt_id, content, model, temperature, max_tokens, content_hash, version_number, created_at)
       VALUES (?, ?, 'Test', 'gpt-4', 0.7, 1024, 'abc', 1, ?)`,
    ).run(versionId, promptId, now);

    conn.prepare(
      `INSERT INTO prompt_runs (id, prompt_id, version_id, input, output, model, temperature, max_tokens, token_count, latency_ms, cost, created_at, error)
       VALUES (?, ?, ?, 'Test input', 'Test output', 'gpt-4', 0.7, 1024, 10, 100, 0.001, ?, NULL)`,
    ).run(runId, promptId, versionId, now);

    const run = conn
      .prepare(`SELECT * FROM prompt_runs WHERE id = ?`)
      .get(runId) as any;

    expect(run.id).toBe(runId);
    expect(run.prompt_id).toBe(promptId);
    expect(run.version_id).toBe(versionId);
    expect(run.input).toBe('Test input');
    expect(run.output).toBe('Test output');
    expect(run.token_count).toBe(10);
    expect(run.latency_ms).toBe(100);
    expect(run.cost).toBe(0.001);
    expect(run.error).toBeNull();

    db.close();
  });

  test('can insert and retrieve test_sets', () => {
    const db = new DB({ path: testDbPath });
    const conn = db.connection;

    const testSetId = crypto.randomUUID();
    const inputId = crypto.randomUUID();
    const now = new Date().toISOString();

    conn.prepare(
      `INSERT INTO test_sets (id, name, description, created_at, updated_at)
       VALUES (?, 'Test Set', 'Test description', ?, ?)`,
    ).run(testSetId, now, now);

    conn.prepare(
      `INSERT INTO test_set_inputs (id, test_set_id, input) VALUES (?, ?, ?)`,
    ).run(inputId, testSetId, 'Test input');

    const testSet = conn
      .prepare(`SELECT * FROM test_sets WHERE id = ?`)
      .get(testSetId) as any;

    expect(testSet.id).toBe(testSetId);
    expect(testSet.name).toBe('Test Set');
    expect(testSet.description).toBe('Test description');

    const input = conn
      .prepare(`SELECT * FROM test_set_inputs WHERE id = ?`)
      .get(inputId) as any;

    expect(input.id).toBe(inputId);
    expect(input.test_set_id).toBe(testSetId);
    expect(input.input).toBe('Test input');

    db.close();
  });

  test('can insert and retrieve api_config', () => {
    const db = new DB({ path: testDbPath });
    const conn = db.connection;

    conn.prepare(
      `INSERT INTO api_config (key, value) VALUES (?, ?)`,
    ).run('baseUrl', 'http://localhost:11434');

    conn.prepare(
      `INSERT INTO api_config (key, value) VALUES (?, ?)`,
    ).run('apiKey', 'test-key');

    const config = conn
      .prepare(`SELECT * FROM api_config WHERE key = ?`)
      .get('baseUrl') as any;

    expect(config.key).toBe('baseUrl');
    expect(config.value).toBe('http://localhost:11434');

    const apiKey = conn
      .prepare(`SELECT * FROM api_config WHERE key = ?`)
      .get('apiKey') as any;

    expect(apiKey.key).toBe('apiKey');
    expect(apiKey.value).toBe('test-key');

    db.close();
  });

  test('can update prompts', () => {
    const db = new DB({ path: testDbPath });
    const conn = db.connection;

    const promptId = crypto.randomUUID();
    const now = new Date().toISOString();

    conn.prepare(
      `INSERT INTO prompts (id, name, content, model, temperature, maxTokens, created_at, updated_at)
       VALUES (?, 'Original', 'Original content', 'gpt-4', 0.7, 1024, ?, ?)`,
    ).run(promptId, now, now);

    const updatedAt = new Date().toISOString();
    conn.prepare(
      `UPDATE prompts SET content = ?, model = ?, temperature = ?, maxTokens = ?, updated_at = ? WHERE id = ?`,
    ).run('Updated content', 'gpt-3.5', 0.9, 2048, updatedAt, promptId);

    const prompt = conn
      .prepare(`SELECT * FROM prompts WHERE id = ?`)
      .get(promptId) as any;

    expect(prompt.content).toBe('Updated content');
    expect(prompt.model).toBe('gpt-3.5');
    expect(prompt.temperature).toBe(0.9);
    expect(prompt.maxTokens).toBe(2048);
    expect(prompt.updated_at).toBe(updatedAt);

    db.close();
  });

  test('can delete prompts', () => {
    const db = new DB({ path: testDbPath });
    const conn = db.connection;

    const promptId = crypto.randomUUID();
    const now = new Date().toISOString();

    conn.prepare(
      `INSERT INTO prompts (id, name, content, model, temperature, maxTokens, created_at, updated_at)
       VALUES (?, 'Test', 'Test', 'gpt-4', 0.7, 1024, ?, ?)`,
    ).run(promptId, now, now);

    conn.prepare(`DELETE FROM prompts WHERE id = ?`).run(promptId);

    const prompt = conn
      .prepare(`SELECT * FROM prompts WHERE id = ?`)
      .get(promptId);

    expect(prompt).toBeUndefined();

    db.close();
  });

  test('can insert test_run_results', () => {
    const db = new DB({ path: testDbPath });
    const conn = db.connection;

    const resultId = crypto.randomUUID();
    const testSetId = crypto.randomUUID();
    const promptId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const now = new Date().toISOString();

    conn.prepare(
      `INSERT INTO test_sets (id, name, description, created_at, updated_at)
       VALUES (?, 'Test', 'Test', ?, ?)`,
    ).run(testSetId, now, now);

    conn.prepare(
      `INSERT INTO prompts (id, name, content, model, temperature, maxTokens, created_at, updated_at)
       VALUES (?, 'Test', 'Test', 'gpt-4', 0.7, 1024, ?, ?)`,
    ).run(promptId, now, now);

    conn.prepare(
      `INSERT INTO prompt_versions (id, prompt_id, content, model, temperature, max_tokens, content_hash, version_number, created_at)
       VALUES (?, ?, 'Test', 'gpt-4', 0.7, 1024, 'abc', 1, ?)`,
    ).run(versionId, promptId, now);

    conn.prepare(
      `INSERT INTO test_run_results (id, test_set_id, prompt_id, version_id, input, output, token_count, latency_ms, cost, error, created_at)
       VALUES (?, ?, ?, ?, 'Test input', 'Test output', 10, 100, 0.001, NULL, ?)`,
    ).run(resultId, testSetId, promptId, versionId, now);

    const result = conn
      .prepare(`SELECT * FROM test_run_results WHERE id = ?`)
      .get(resultId) as any;

    expect(result.id).toBe(resultId);
    expect(result.test_set_id).toBe(testSetId);
    expect(result.prompt_id).toBe(promptId);
    expect(result.version_id).toBe(versionId);
    expect(result.input).toBe('Test input');
    expect(result.output).toBe('Test output');
    expect(result.token_count).toBe(10);
    expect(result.latency_ms).toBe(100);
    expect(result.cost).toBe(0.001);
    expect(result.error).toBeNull();

    db.close();
  });
});

describe('DB - Edge Cases', () => {
  test('handles empty string content', () => {
    const db = new DB({ path: testDbPath });
    const conn = db.connection;

    const promptId = crypto.randomUUID();
    const now = new Date().toISOString();

    conn.prepare(
      `INSERT INTO prompts (id, name, content, model, temperature, maxTokens, created_at, updated_at)
       VALUES (?, 'Empty', '', 'gpt-4', 0.7, 1024, ?, ?)`,
    ).run(promptId, now, now);

    const prompt = conn
      .prepare(`SELECT content FROM prompts WHERE id = ?`)
      .get(promptId) as { content: string };

    expect(prompt.content).toBe('');

    db.close();
  });

  test('handles very long content', () => {
    const db = new DB({ path: testDbPath });
    const conn = db.connection;

    const promptId = crypto.randomUUID();
    const now = new Date().toISOString();
    const longContent = 'A'.repeat(100000);

    conn.prepare(
      `INSERT INTO prompts (id, name, content, model, temperature, maxTokens, created_at, updated_at)
       VALUES (?, 'Long', ?, 'gpt-4', 0.7, 1024, ?, ?)`,
    ).run(promptId, longContent, now, now);

    const prompt = conn
      .prepare(`SELECT content FROM prompts WHERE id = ?`)
      .get(promptId) as { content: string };

    expect(prompt.content).toBe(longContent);

    db.close();
  });

  test('handles unicode content', () => {
    const db = new DB({ path: testDbPath });
    const conn = db.connection;

    const promptId = crypto.randomUUID();
    const now = new Date().toISOString();
    const unicodeContent = 'Hello 世界 🌍 مرحبا';

    conn.prepare(
      `INSERT INTO prompts (id, name, content, model, temperature, maxTokens, created_at, updated_at)
       VALUES (?, 'Unicode', ?, 'gpt-4', 0.7, 1024, ?, ?)`,
    ).run(promptId, unicodeContent, now, now);

    const prompt = conn
      .prepare(`SELECT content FROM prompts WHERE id = ?`)
      .get(promptId) as { content: string };

    expect(prompt.content).toBe(unicodeContent);

    db.close();
  });

  test('handles special characters in content', () => {
    const db = new DB({ path: testDbPath });
    const conn = db.connection;

    const promptId = crypto.randomUUID();
    const now = new Date().toISOString();
    const specialContent = 'Special: @#$%^&*()_+-=[]{}|;:\'",.<>?/\\`~\n\t\r';

    conn.prepare(
      `INSERT INTO prompts (id, name, content, model, temperature, maxTokens, created_at, updated_at)
       VALUES (?, 'Special', ?, 'gpt-4', 0.7, 1024, ?, ?)`,
    ).run(promptId, specialContent, now, now);

    const prompt = conn
      .prepare(`SELECT content FROM prompts WHERE id = ?`)
      .get(promptId) as { content: string };

    expect(prompt.content).toBe(specialContent);

    db.close();
  });

  test('handles null values in optional columns', () => {
    const db = new DB({ path: testDbPath });
    const conn = db.connection;

    const promptId = crypto.randomUUID();
    const now = new Date().toISOString();

    conn.prepare(
      `INSERT INTO prompts (id, name, content, model, temperature, maxTokens, system_prompt, created_at, updated_at)
       VALUES (?, 'Null Test', 'Test', 'gpt-4', 0.7, 1024, NULL, ?, ?)`,
    ).run(promptId, now, now);

    const prompt = conn
      .prepare(`SELECT system_prompt FROM prompts WHERE id = ?`)
      .get(promptId) as { system_prompt: string | null };

    expect(prompt.system_prompt).toBeNull();

    db.close();
  });

  test('handles zero values in numeric columns', () => {
    const db = new DB({ path: testDbPath });
    const conn = db.connection;

    const promptId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    const now = new Date().toISOString();

    conn.prepare(
      `INSERT INTO prompts (id, name, content, model, temperature, maxTokens, created_at, updated_at)
       VALUES (?, 'Test', 'Test', 'gpt-4', 0.7, 1024, ?, ?)`,
    ).run(promptId, now, now);

    conn.prepare(
      `INSERT INTO prompt_versions (id, prompt_id, content, model, temperature, max_tokens, content_hash, version_number, created_at)
       VALUES (?, ?, 'Test', 'gpt-4', 0.7, 1024, 'abc', 0, ?)`,
    ).run(versionId, promptId, now);

    conn.prepare(
      `INSERT INTO prompt_runs (id, prompt_id, version_id, input, output, model, temperature, max_tokens, token_count, latency_ms, cost, created_at, error)
       VALUES (?, ?, ?, 'input', 'output', 'gpt-4', 0.7, 1024, 0, 0, 0.0, ?, NULL)`,
    ).run(runId, promptId, versionId, now);

    const run = conn
      .prepare(`SELECT token_count, latency_ms, cost FROM prompt_runs WHERE id = ?`)
      .get(runId) as { token_count: number; latency_ms: number; cost: number | null };

    expect(run.token_count).toBe(0);
    expect(run.latency_ms).toBe(0);
    expect(run.cost).toBe(0.0);

    db.close();
  });

  test('handles large token counts', () => {
    const db = new DB({ path: testDbPath });
    const conn = db.connection;

    const promptId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    const now = new Date().toISOString();

    conn.prepare(
      `INSERT INTO prompts (id, name, content, model, temperature, maxTokens, created_at, updated_at)
       VALUES (?, 'Test', 'Test', 'gpt-4', 0.7, 1024, ?, ?)`,
    ).run(promptId, now, now);

    conn.prepare(
      `INSERT INTO prompt_versions (id, prompt_id, content, model, temperature, max_tokens, content_hash, version_number, created_at)
       VALUES (?, ?, 'Test', 'gpt-4', 0.7, 1024, 'abc', 1, ?)`,
    ).run(versionId, promptId, now);

    conn.prepare(
      `INSERT INTO prompt_runs (id, prompt_id, version_id, input, output, model, temperature, max_tokens, token_count, latency_ms, cost, created_at, error)
       VALUES (?, ?, ?, 'input', 'output', 'gpt-4', 0.7, 1024, 999999999, 999999999, 999999.9999, ?, NULL)`,
    ).run(runId, promptId, versionId, now);

    const run = conn
      .prepare(`SELECT token_count, latency_ms, cost FROM prompt_runs WHERE id = ?`)
      .get(runId) as { token_count: number; latency_ms: number; cost: number };

    expect(run.token_count).toBe(999999999);
    expect(run.latency_ms).toBe(999999999);
    expect(run.cost).toBe(999999.9999);

    db.close();
  });

  test('can insert multiple rows with same prompt_id', () => {
    const db = new DB({ path: testDbPath });
    const conn = db.connection;

    const promptId = crypto.randomUUID();
    const now = new Date().toISOString();

    conn.prepare(
      `INSERT INTO prompts (id, name, content, model, temperature, maxTokens, created_at, updated_at)
       VALUES (?, 'Test', 'Test', 'gpt-4', 0.7, 1024, ?, ?)`,
    ).run(promptId, now, now);

    // Insert multiple versions
    for (let i = 1; i <= 5; i++) {
      const versionId = crypto.randomUUID();
      conn.prepare(
        `INSERT INTO prompt_versions (id, prompt_id, content, model, temperature, max_tokens, content_hash, version_number, created_at)
         VALUES (?, ?, 'Version ${i}', 'gpt-4', 0.7, 1024, 'hash${i}', ${i}, ?)`,
      ).run(versionId, promptId, now);
    }

    const versions = conn
      .prepare(`SELECT COUNT(*) as count FROM prompt_versions WHERE prompt_id = ?`)
      .get(promptId) as { count: number };

    expect(versions.count).toBe(5);

    db.close();
  });

  test('can insert multiple test_set_inputs for same test_set_id', () => {
    const db = new DB({ path: testDbPath });
    const conn = db.connection;

    const testSetId = crypto.randomUUID();
    const now = new Date().toISOString();

    conn.prepare(
      `INSERT INTO test_sets (id, name, description, created_at, updated_at)
       VALUES (?, 'Test', 'Test', ?, ?)`,
    ).run(testSetId, now, now);

    // Insert multiple inputs
    for (let i = 1; i <= 10; i++) {
      const inputId = crypto.randomUUID();
      conn.prepare(
        `INSERT INTO test_set_inputs (id, test_set_id, input) VALUES (?, ?, ?)`,
      ).run(inputId, testSetId, `Input ${i}`);
    }

    const inputs = conn
      .prepare(`SELECT COUNT(*) as count FROM test_set_inputs WHERE test_set_id = ?`)
      .get(testSetId) as { count: number };

    expect(inputs.count).toBe(10);

    db.close();
  });
});
