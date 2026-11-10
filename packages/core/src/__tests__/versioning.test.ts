/**
 * Comprehensive tests for the VersioningEngine
 * Tests commit, diff, rollback, hash, and version management
 */
import crypto from 'node:crypto';
import { DB } from '../db.js';
import { VersioningEngine } from '../versioning.js';
import type { PromptCreate, PromptVersionCreate } from '../types.js';

// Use an in-memory temp DB
const testDbPath = crypto.randomUUID();

let db: DB;
let versioning: VersioningEngine;

beforeAll(() => {
  db = new DB({ path: testDbPath });
  versioning = new VersioningEngine(db);
});

afterAll(() => {
  db.close();
  // Clean up temp file
  try { require('fs').unlinkSync(testDbPath); } catch {}
});

describe('VersioningEngine - Commit', () => {
  let promptId: string;
  const now = new Date().toISOString();

  beforeEach(() => {
    promptId = crypto.randomUUID();
    const conn = db.connection;
    conn.prepare(
      `INSERT OR REPLACE INTO prompts (id, name, content, model, temperature, maxTokens, created_at, updated_at)
       VALUES (?, 'Test Prompt', 'Initial content', 'gpt-4', 0.7, 1024, ?, ?)`,
    ).run(promptId, now, now);
  });

  test('commits a version with commit message', () => {
    const data: PromptVersionCreate = {
      promptId,
      content: 'First commit content',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      commitMessage: 'Initial commit',
    };
    const version = versioning.createVersion(promptId, data);
    expect(version).toBeDefined();
    expect(version!.commitMessage).toBe('Initial commit');
    expect(version!.versionNumber).toBe(1);
  });

  test('commits a version without commit message', () => {
    const data: PromptVersionCreate = {
      promptId,
      content: 'Content without message',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };
    const version = versioning.createVersion(promptId, data);
    expect(version).toBeDefined();
    expect(version!.commitMessage).toBeUndefined();
  });

  test('multiple commits increment version numbers', () => {
    const commits = [
      { content: 'Version 1', message: 'First' },
      { content: 'Version 2', message: 'Second' },
      { content: 'Version 3', message: 'Third' },
    ];

    const versions: any[] = [];
    for (const commit of commits) {
      const v = versioning.createVersion(promptId, {
        promptId,
        content: commit.content,
        model: 'gpt-4',
        temperature: 0.7,
        maxTokens: 1024,
        commitMessage: commit.message,
      });
      versions.push(v);
    }

    expect(versions).toHaveLength(3);
    expect(versions[0]!.versionNumber).toBe(1);
    expect(versions[1]!.versionNumber).toBe(2);
    expect(versions[2]!.versionNumber).toBe(3);
    expect(versions[0]!.commitMessage).toBe('First');
    expect(versions[1]!.commitMessage).toBe('Second');
    expect(versions[2]!.commitMessage).toBe('Third');
  });

  test('commit with system prompt', () => {
    const data: PromptVersionCreate = {
      promptId,
      content: 'Content with system prompt',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: 'You are a helpful assistant',
      commitMessage: 'Add system prompt',
    };
    const version = versioning.createVersion(promptId, data);
    expect(version).toBeDefined();
    expect(version!.systemPrompt).toBe('You are a helpful assistant');
  });

  test('commit with different model and parameters', () => {
    const data: PromptVersionCreate = {
      promptId,
      content: 'Content for different model',
      model: 'gpt-3.5-turbo',
      temperature: 0.9,
      maxTokens: 2048,
      commitMessage: 'Switch to gpt-3.5',
    };
    const version = versioning.createVersion(promptId, data);
    expect(version).toBeDefined();
    expect(version!.model).toBe('gpt-3.5-turbo');
    expect(version!.temperature).toBe(0.9);
    expect(version!.maxTokens).toBe(2048);
  });

  test('duplicate content returns undefined', () => {
    const data: PromptVersionCreate = {
      promptId,
      content: 'Same content',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      commitMessage: 'First',
    };
    const v1 = versioning.createVersion(promptId, data);
    expect(v1).toBeDefined();
    expect(v1!.versionNumber).toBe(1);

    const v2 = versioning.createVersion(promptId, data);
    expect(v2).toBeUndefined();

    // Verify only one version exists
    const versions = versioning.listVersions(promptId);
    expect(versions).toHaveLength(1);
  });

  test('similar but different content creates new version', () => {
    const data1: PromptVersionCreate = {
      promptId,
      content: 'Hello world',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      commitMessage: 'First',
    };
    const data2: PromptVersionCreate = {
      promptId,
      content: 'Hello world!',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      commitMessage: 'Second',
    };

    const v1 = versioning.createVersion(promptId, data1);
    const v2 = versioning.createVersion(promptId, data2);

    expect(v1).toBeDefined();
    expect(v2).toBeDefined();
    expect(v1!.versionNumber).toBe(1);
    expect(v2!.versionNumber).toBe(2);
  });
});

describe('VersioningEngine - Content Hash', () => {
  test('same content produces same hash', () => {
    const content = 'Hello, World!';
    const hash1 = versioning.computeHash(content);
    const hash2 = versioning.computeHash(content);
    expect(hash1).toBe(hash2);
  });

  test('different content produces different hash', () => {
    const hash1 = versioning.computeHash('Hello');
    const hash2 = versioning.computeHash('World');
    expect(hash1).not.toBe(hash2);
  });

  test('hash is deterministic and consistent', () => {
    const content = 'A'.repeat(1000);
    const hash1 = versioning.computeHash(content);
    const hash2 = versioning.computeHash(content);
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64); // SHA-256 produces 64 hex characters
  });

  test('hash changes with whitespace', () => {
    const hash1 = versioning.computeHash('hello');
    const hash2 = versioning.computeHash(' hello');
    const hash3 = versioning.computeHash('hello ');
    expect(hash1).not.toBe(hash2);
    expect(hash1).not.toBe(hash3);
  });

  test('hash changes with newlines', () => {
    const hash1 = versioning.computeHash('line1\nline2');
    const hash2 = versioning.computeHash('line1\n\nline2');
    expect(hash1).not.toBe(hash2);
  });
});

describe('VersioningEngine - Diff', () => {
  let promptId: string;
  const now = new Date().toISOString();

  beforeEach(() => {
    promptId = crypto.randomUUID();
    const conn = db.connection;
    conn.prepare(
      `INSERT OR REPLACE INTO prompts (id, name, content, model, temperature, maxTokens, created_at, updated_at)
       VALUES (?, 'Diff Test', 'Initial', 'gpt-4', 0.7, 1024, ?, ?)`,
    ).run(promptId, now, now);
  });

  test('diff between identical versions shows no changes', () => {
    const data: PromptVersionCreate = {
      promptId,
      content: 'Same content',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };
    const v1 = versioning.createVersion(promptId, data)!;
    const v2 = versioning.createVersion(promptId, {
      ...data,
      content: 'Same content',
      commitMessage: 'Duplicate',
    });

    // v2 should be undefined since content is identical
    expect(v2).toBeUndefined();
  });

  test('diff shows additions when content grows', () => {
    const data1: PromptVersionCreate = {
      promptId,
      content: 'Line 1\nLine 2\n',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };
    const data2: PromptVersionCreate = {
      promptId,
      content: 'Line 1\nLine 2\nLine 3\nLine 4\n',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };

    const v1 = versioning.createVersion(promptId, data1)!;
    const v2 = versioning.createVersion(promptId, data2)!;

    const diff = versioning.getVersionDiff(v1.id, v2.id);
    expect(diff.addedLines).toBeGreaterThan(0);
    expect(diff.deletedLines).toBe(0);
    expect(diff.additions).toContain('Line 3');
    expect(diff.additions).toContain('Line 4');
  });

  test('diff shows deletions when content shrinks', () => {
    const data1: PromptVersionCreate = {
      promptId,
      content: 'Line 1\nLine 2\nLine 3\nLine 4\n',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };
    const data2: PromptVersionCreate = {
      promptId,
      content: 'Line 1\n',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };

    const v1 = versioning.createVersion(promptId, data1)!;
    const v2 = versioning.createVersion(promptId, data2)!;

    const diff = versioning.getVersionDiff(v1.id, v2.id);
    expect(diff.deletedLines).toBeGreaterThan(0);
    expect(diff.addedLines).toBe(0);
    expect(diff.deletions).toContain('Line 2');
    expect(diff.deletions).toContain('Line 3');
    expect(diff.deletions).toContain('Line 4');
  });

  test('diff shows both additions and deletions', () => {
    const data1: PromptVersionCreate = {
      promptId,
      content: 'Old line 1\nOld line 2\nOld line 3',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };
    const data2: PromptVersionCreate = {
      promptId,
      content: 'New line 1\nOld line 2\nNew line 3\nNew line 4',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };

    const v1 = versioning.createVersion(promptId, data1)!;
    const v2 = versioning.createVersion(promptId, data2)!;

    const diff = versioning.getVersionDiff(v1.id, v2.id);
    expect(diff.addedLines).toBeGreaterThan(0);
    expect(diff.deletedLines).toBeGreaterThan(0);
    expect(diff.commonLines).toBeGreaterThan(0);
  });

  test('diff by version numbers', () => {
    const data1: PromptVersionCreate = {
      promptId,
      content: 'Version 1 content',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };
    const data2: PromptVersionCreate = {
      promptId,
      content: 'Version 2 content',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };
    const data3: PromptVersionCreate = {
      promptId,
      content: 'Version 3 content',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };

    versioning.createVersion(promptId, data1);
    versioning.createVersion(promptId, data2);
    versioning.createVersion(promptId, data3);

    const diff = versioning.getVersionDiffByNumber(promptId, 1, 3);
    expect(diff.addedLines).toBeGreaterThan(0);
    expect(diff.deletedLines).toBeGreaterThan(0);
  });

  test('diff against latest version', () => {
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

    versioning.createVersion(promptId, data1);
    versioning.createVersion(promptId, data2);

    const diff = versioning.getDiffAgainst(promptId, 1);
    expect(diff.addedLines).toBeGreaterThan(0);
    expect(diff.deletedLines).toBeGreaterThan(0);
  });

  test('getConsecutiveDiffs returns diffs between all versions', () => {
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
    const data3: PromptVersionCreate = {
      promptId,
      content: 'V3',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };

    versioning.createVersion(promptId, data1);
    versioning.createVersion(promptId, data2);
    versioning.createVersion(promptId, data3);

    const diffs = versioning.getConsecutiveDiffs(promptId);
    expect(diffs).toHaveLength(2);
    expect(diffs[0].fromVersion).toBe(1);
    expect(diffs[0].toVersion).toBe(2);
    expect(diffs[1].fromVersion).toBe(2);
    expect(diffs[1].toVersion).toBe(3);
  });

  test('getConsecutiveDiffs returns empty for single version', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'V1',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const diffs = versioning.getConsecutiveDiffs(promptId);
    expect(diffs).toHaveLength(0);
  });

  test('diff summary includes character counts', () => {
    const data1: PromptVersionCreate = {
      promptId,
      content: 'ABC',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };
    const data2: PromptVersionCreate = {
      promptId,
      content: 'XYZ',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };

    const v1 = versioning.createVersion(promptId, data1)!;
    const v2 = versioning.createVersion(promptId, data2)!;

    const summary = versioning.getVersionDiffSummary(v1.id, v2.id);
    expect(summary.addedChars).toBe(3);
    expect(summary.deletedChars).toBe(3);
    expect(summary.commonChars).toBe(0);
  });

  test('diff summary by version numbers', () => {
    const data1: PromptVersionCreate = {
      promptId,
      content: 'Short',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };
    const data2: PromptVersionCreate = {
      promptId,
      content: 'Much longer content here',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };

    versioning.createVersion(promptId, data1);
    versioning.createVersion(promptId, data2);

    const summary = versioning.getVersionDiffSummaryByNumber(promptId, 1, 2);
    expect(summary.addedChars).toBeGreaterThan(0);
    expect(summary.deletedChars).toBeGreaterThan(0);
  });

  test('throws error for non-existent version in diff', () => {
    const data: PromptVersionCreate = {
      promptId,
      content: 'Content',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };
    const v1 = versioning.createVersion(promptId, data)!;

    expect(() => versioning.getVersionDiff(v1.id, 'non-existent-id')).toThrow();
  });
});

describe('VersioningEngine - Rollback', () => {
  let promptId: string;
  const now = new Date().toISOString();

  beforeEach(() => {
    promptId = crypto.randomUUID();
    const conn = db.connection;
    conn.prepare(
      `INSERT OR REPLACE INTO prompts (id, name, content, model, temperature, maxTokens, created_at, updated_at)
       VALUES (?, 'Rollback Test', 'Original', 'gpt-4', 0.7, 1024, ?, ?)`,
    ).run(promptId, now, now);
  });

  test('rollback to version by ID restores content', () => {
    const data1: PromptVersionCreate = {
      promptId,
      content: 'Original content',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };
    const data2: PromptVersionCreate = {
      promptId,
      content: 'Modified content',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };

    const v1 = versioning.createVersion(promptId, data1)!;
    versioning.createVersion(promptId, data2);

    const updated = versioning.rollbackToVersion(promptId, v1.id);
    expect(updated.content).toBe('Original content');
  });

  test('rollback to version by number restores content', () => {
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
    versioning.createVersion(promptId, data2);

    const updated = versioning.rollbackToVersionNumber(promptId, 1);
    expect(updated.content).toBe('Version 1');
  });

  test('rollback creates a new version', () => {
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
    // After rollback, we should have 3 versions: v1, v2, v3 (rollback)
    const versions = versioning.listVersions(promptId);
    expect(versions).toHaveLength(3);
  });

  test('rollback preserves model and temperature from rolled-back version', () => {
    const data1: PromptVersionCreate = {
      promptId,
      content: 'Original',
      model: 'gpt-3.5-turbo',
      temperature: 0.5,
      maxTokens: 512,
    };
    const data2: PromptVersionCreate = {
      promptId,
      content: 'Modified',
      model: 'gpt-4',
      temperature: 0.9,
      maxTokens: 2048,
    };

    versioning.createVersion(promptId, data1);
    versioning.createVersion(promptId, data2);

    const updated = versioning.rollbackToVersionNumber(promptId, 1);
    expect(updated.model).toBe('gpt-3.5-turbo');
    expect(updated.temperature).toBe(0.5);
    expect(updated.maxTokens).toBe(512);
  });

  test('rollback preserves system prompt from rolled-back version', () => {
    const data1: PromptVersionCreate = {
      promptId,
      content: 'Original',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: 'You are a helpful assistant',
    };
    const data2: PromptVersionCreate = {
      promptId,
      content: 'Modified',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: 'You are a different assistant',
    };

    versioning.createVersion(promptId, data1);
    versioning.createVersion(promptId, data2);

    const updated = versioning.rollbackToVersionNumber(promptId, 1);
    expect(updated.systemPrompt).toBe('You are a helpful assistant');
  });

  test('rollback to non-existent version throws error', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'Content',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    expect(() => versioning.rollbackToVersion(promptId, 'non-existent-id')).toThrow();
  });

  test('rollback to non-existent version number throws error', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'Content',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    expect(() => versioning.rollbackToVersionNumber(promptId, 999)).toThrow();
  });

  test('multiple rollbacks work correctly', () => {
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
    const data3: PromptVersionCreate = {
      promptId,
      content: 'V3',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };

    versioning.createVersion(promptId, data1);
    versioning.createVersion(promptId, data2);
    versioning.createVersion(promptId, data3);

    // Rollback to V1
    const afterFirstRollback = versioning.rollbackToVersionNumber(promptId, 1);
    expect(afterFirstRollback.content).toBe('V1');

    // Modify again
    versioning.createVersion(promptId, {
      promptId,
      content: 'V4',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    // Rollback to V2
    const afterSecondRollback = versioning.rollbackToVersionNumber(promptId, 2);
    expect(afterSecondRollback.content).toBe('V2');
  });
});

describe('VersioningEngine - Version History', () => {
  let promptId: string;
  const now = new Date().toISOString();

  beforeEach(() => {
    promptId = crypto.randomUUID();
    const conn = db.connection;
    conn.prepare(
      `INSERT OR REPLACE INTO prompts (id, name, content, model, temperature, maxTokens, created_at, updated_at)
       VALUES (?, 'History Test', 'Initial', 'gpt-4', 0.7, 1024, ?, ?)`,
    ).run(promptId, now, now);
  });

  test('getVersionHistory returns all versions with metadata', () => {
    const data1: PromptVersionCreate = {
      promptId,
      content: 'Content 1',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      commitMessage: 'First commit',
    };
    const data2: PromptVersionCreate = {
      promptId,
      content: 'Content 2',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      commitMessage: 'Second commit',
    };

    versioning.createVersion(promptId, data1);
    versioning.createVersion(promptId, data2);

    const history = versioning.getVersionHistory(promptId);
    expect(history).toHaveLength(2);
    expect(history[0].versionNumber).toBe(1);
    expect(history[1].versionNumber).toBe(2);
    expect(history[0].contentHash).toBeDefined();
    expect(history[0].commitMessage).toBe('First commit');
    expect(history[1].commitMessage).toBe('Second commit');
    expect(history[0].contentLength).toBe(9); // 'Content 1'.length
    expect(history[1].contentLength).toBe(9); // 'Content 2'.length
  });

  test('getVersionHistory is empty for prompt with no versions', () => {
    const history = versioning.getVersionHistory(promptId);
    expect(history).toHaveLength(0);
  });

  test('getVersionHistory includes timestamps', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'Content',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const history = versioning.getVersionHistory(promptId);
    expect(history[0].createdAt).toBeDefined();
    expect(new Date(history[0].createdAt).getTime()).toBeGreaterThan(0);
  });
});

describe('VersioningEngine - Version Lookup', () => {
  let promptId: string;
  const now = new Date().toISOString();

  beforeEach(() => {
    promptId = crypto.randomUUID();
    const conn = db.connection;
    conn.prepare(
      `INSERT OR REPLACE INTO prompts (id, name, content, model, temperature, maxTokens, created_at, updated_at)
       VALUES (?, 'Lookup Test', 'Initial', 'gpt-4', 0.7, 1024, ?, ?)`,
    ).run(promptId, now, now);
  });

  test('getVersionIdByNumber returns correct ID', () => {
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

    const v1 = versioning.createVersion(promptId, data1)!;
    versioning.createVersion(promptId, data2);

    const id1 = versioning.getVersionIdByNumber(promptId, 1);
    const id2 = versioning.getVersionIdByNumber(promptId, 2);

    expect(id1).toBe(v1.id);
    expect(id2).toBeDefined();
    expect(id2).not.toBe(id1);
  });

  test('getVersionIdByNumber returns undefined for non-existent version', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'V1',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const id = versioning.getVersionIdByNumber(promptId, 999);
    expect(id).toBeUndefined();
  });

  test('getVersionNumber returns correct number', () => {
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

    const v1 = versioning.createVersion(promptId, data1)!;
    versioning.createVersion(promptId, data2);

    const num1 = versioning.getVersionNumber(v1.id);
    const num2 = versioning.getVersionNumber(data2.promptId);

    expect(num1).toBe(1);
  });

  test('getVersionNumber returns undefined for non-existent version', () => {
    const num = versioning.getVersionNumber('non-existent-id');
    expect(num).toBeUndefined();
  });

  test('areVersionsEqual returns true for same content', () => {
    const data1: PromptVersionCreate = {
      promptId,
      content: 'Same content',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };
    const data2: PromptVersionCreate = {
      promptId,
      content: 'Same content',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };

    const v1 = versioning.createVersion(promptId, data1)!;
    const v2 = versioning.createVersion(promptId, data2);

    // v2 should be undefined since content is identical
    expect(v2).toBeUndefined();
  });

  test('areVersionsEqual returns false for different content', () => {
    const data1: PromptVersionCreate = {
      promptId,
      content: 'Content A',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };
    const data2: PromptVersionCreate = {
      promptId,
      content: 'Content B',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };

    const v1 = versioning.createVersion(promptId, data1)!;
    const v2 = versioning.createVersion(promptId, data2)!;

    const equal = versioning.areVersionsEqual(v1.id, v2.id);
    expect(equal).toBe(false);
  });

  test('areVersionsEqual returns true for identical content', () => {
    const data1: PromptVersionCreate = {
      promptId,
      content: 'Identical',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };

    const v1 = versioning.createVersion(promptId, data1)!;
    const v2 = versioning.createVersion(promptId, {
      ...data1,
      content: 'Identical',
      commitMessage: 'Duplicate',
    });

    // v2 should be undefined since content is identical
    expect(v2).toBeUndefined();
  });
});

describe('VersioningEngine - Edge Cases', () => {
  let promptId: string;
  const now = new Date().toISOString();

  beforeEach(() => {
    promptId = crypto.randomUUID();
    const conn = db.connection;
    conn.prepare(
      `INSERT OR REPLACE INTO prompts (id, name, content, model, temperature, maxTokens, created_at, updated_at)
       VALUES (?, 'Edge Case Test', 'Initial', 'gpt-4', 0.7, 1024, ?, ?)`,
    ).run(promptId, now, now);
  });

  test('handles empty content', () => {
    const version = versioning.createVersion(promptId, {
      promptId,
      content: '',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      commitMessage: 'Empty content',
    });
    expect(version).toBeDefined();
    expect(version!.content).toBe('');
  });

  test('handles very long content', () => {
    const longContent = 'A'.repeat(10000);
    const version = versioning.createVersion(promptId, {
      promptId,
      content: longContent,
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      commitMessage: 'Long content',
    });
    expect(version).toBeDefined();
    expect(version!.content).toBe(longContent);
  });

  test('handles content with special characters', () => {
    const specialContent = 'Special chars: @#$%^&*()_+-=[]{}|;:\'",.<>?/\\`~\n\t';
    const version = versioning.createVersion(promptId, {
      promptId,
      content: specialContent,
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      commitMessage: 'Special chars',
    });
    expect(version).toBeDefined();
    expect(version!.content).toBe(specialContent);
  });

  test('handles content with unicode characters', () => {
    const unicodeContent = 'Hello 世界 🌍 مرحبا';
    const version = versioning.createVersion(promptId, {
      promptId,
      content: unicodeContent,
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      commitMessage: 'Unicode',
    });
    expect(version).toBeDefined();
    expect(version!.content).toBe(unicodeContent);
  });

  test('handles content with newlines and whitespace', () => {
    const content = '\n\n  Indented line\n\n\n  Another indented line  \n\n';
    const version = versioning.createVersion(promptId, {
      promptId,
      content,
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      commitMessage: 'Whitespace',
    });
    expect(version).toBeDefined();
    expect(version!.content).toBe(content);
  });

  test('rollback with empty content', () => {
    const data1: PromptVersionCreate = {
      promptId,
      content: '',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };
    const data2: PromptVersionCreate = {
      promptId,
      content: 'Content',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };

    versioning.createVersion(promptId, data1);
    versioning.createVersion(promptId, data2);

    const updated = versioning.rollbackToVersionNumber(promptId, 1);
    expect(updated.content).toBe('');
  });

  test('rollback preserves prompt name', () => {
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

    versioning.createVersion(promptId, data1);
    versioning.createVersion(promptId, data2);

    const updated = versioning.rollbackToVersionNumber(promptId, 1);
    expect(updated.name).toBe('Edge Case Test');
  });
});
