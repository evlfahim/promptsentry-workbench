/**
 * Additional unit tests for VersioningEngine covering getVersion,
 * getLatestVersion, and other uncovered methods.
 */
import crypto from 'node:crypto';
import { DB } from '../db.js';
import { VersioningEngine } from '../versioning.js';
import type { PromptVersionCreate } from '../types.js';

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
  try { require('fs').unlinkSync(testDbPath); } catch {}
});

// ─── getVersion ──────────────────────────────────────────────────────────────

describe('VersioningEngine - getVersion', () => {
  let promptId: string;
  const now = new Date().toISOString();

  beforeEach(() => {
    promptId = crypto.randomUUID();
    const conn = db.connection;
    conn.prepare(
      `INSERT OR REPLACE INTO prompts (id, name, content, model, temperature, maxTokens, created_at, updated_at)
       VALUES (?, 'Get Version Test', 'Initial', 'gpt-4', 0.7, 1024, ?, ?)`,
    ).run(promptId, now, now);
  });

  test('getVersion returns version by ID', () => {
    const data: PromptVersionCreate = {
      promptId,
      content: 'Version content',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      commitMessage: 'Test commit',
    };
    const version = versioning.createVersion(promptId, data)!;
    const retrieved = versioning.getVersion(version.id);

    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(version.id);
    expect(retrieved!.content).toBe('Version content');
    expect(retrieved!.model).toBe('gpt-4');
    expect(retrieved!.temperature).toBe(0.7);
    expect(retrieved!.maxTokens).toBe(1024);
    expect(retrieved!.commitMessage).toBe('Test commit');
    expect(retrieved!.contentHash).toBeDefined();
    expect(retrieved!.versionNumber).toBe(1);
    expect(retrieved!.createdAt).toBeDefined();
  });

  test('getVersion returns undefined for non-existent version', () => {
    const retrieved = versioning.getVersion('non-existent-id');
    expect(retrieved).toBeUndefined();
  });

  test('getVersion returns version with system prompt', () => {
    const data: PromptVersionCreate = {
      promptId,
      content: 'Content',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: 'You are a helpful assistant',
    };
    const version = versioning.createVersion(promptId, data)!;
    const retrieved = versioning.getVersion(version.id);

    expect(retrieved!.systemPrompt).toBe('You are a helpful assistant');
  });

  test('getVersion returns version without system prompt', () => {
    const data: PromptVersionCreate = {
      promptId,
      content: 'Content',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };
    const version = versioning.createVersion(promptId, data)!;
    const retrieved = versioning.getVersion(version.id);

    expect(retrieved!.systemPrompt).toBeUndefined();
  });

  test('getVersion returns version with empty commit message', () => {
    const data: PromptVersionCreate = {
      promptId,
      content: 'Content',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      commitMessage: '',
    };
    const version = versioning.createVersion(promptId, data)!;
    const retrieved = versioning.getVersion(version.id);

    expect(retrieved!.commitMessage).toBe('');
  });

  test('getVersion returns version with very long content', () => {
    const longContent = 'A'.repeat(10000);
    const data: PromptVersionCreate = {
      promptId,
      content: longContent,
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };
    const version = versioning.createVersion(promptId, data)!;
    const retrieved = versioning.getVersion(version.id);

    expect(retrieved!.content).toBe(longContent);
    expect(retrieved!.content.length).toBe(10000);
  });

  test('getVersion returns version with unicode content', () => {
    const unicodeContent = 'Hello 世界 🌍 مرحبا';
    const data: PromptVersionCreate = {
      promptId,
      content: unicodeContent,
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };
    const version = versioning.createVersion(promptId, data)!;
    const retrieved = versioning.getVersion(version.id);

    expect(retrieved!.content).toBe(unicodeContent);
  });

  test('getVersion returns version with special characters', () => {
    const specialContent = 'Special: @#$%^&*()_+-=[]{}|;:\'",.<>?/\\`~\n\t\r';
    const data: PromptVersionCreate = {
      promptId,
      content: specialContent,
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    };
    const version = versioning.createVersion(promptId, data)!;
    const retrieved = versioning.getVersion(version.id);

    expect(retrieved!.content).toBe(specialContent);
  });

  test('getVersion returns version with different model', () => {
    const data: PromptVersionCreate = {
      promptId,
      content: 'Content',
      model: 'gpt-3.5-turbo',
      temperature: 0.9,
      maxTokens: 2048,
    };
    const version = versioning.createVersion(promptId, data)!;
    const retrieved = versioning.getVersion(version.id);

    expect(retrieved!.model).toBe('gpt-3.5-turbo');
    expect(retrieved!.temperature).toBe(0.9);
    expect(retrieved!.maxTokens).toBe(2048);
  });

  test('getVersion returns version with zero temperature', () => {
    const data: PromptVersionCreate = {
      promptId,
      content: 'Content',
      model: 'gpt-4',
      temperature: 0,
      maxTokens: 1024,
    };
    const version = versioning.createVersion(promptId, data)!;
    const retrieved = versioning.getVersion(version.id);

    expect(retrieved!.temperature).toBe(0);
  });

  test('getVersion returns version with zero maxTokens', () => {
    const data: PromptVersionCreate = {
      promptId,
      content: 'Content',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 0,
    };
    const version = versioning.createVersion(promptId, data)!;
    const retrieved = versioning.getVersion(version.id);

    expect(retrieved!.maxTokens).toBe(0);
  });

  test('getVersion returns version with very large maxTokens', () => {
    const data: PromptVersionCreate = {
      promptId,
      content: 'Content',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 100000,
    };
    const version = versioning.createVersion(promptId, data)!;
    const retrieved = versioning.getVersion(version.id);

    expect(retrieved!.maxTokens).toBe(100000);
  });

  test('getVersion returns version with high temperature', () => {
    const data: PromptVersionCreate = {
      promptId,
      content: 'Content',
      model: 'gpt-4',
      temperature: 2.0,
      maxTokens: 1024,
    };
    const version = versioning.createVersion(promptId, data)!;
    const retrieved = versioning.getVersion(version.id);

    expect(retrieved!.temperature).toBe(2.0);
  });

  test('getVersion returns version with fractional temperature', () => {
    const data: PromptVersionCreate = {
      promptId,
      content: 'Content',
      model: 'gpt-4',
      temperature: 0.123,
      maxTokens: 1024,
    };
    const version = versioning.createVersion(promptId, data)!;
    const retrieved = versioning.getVersion(version.id);

    expect(retrieved!.temperature).toBe(0.123);
  });

  test('getVersion returns version with very long commit message', () => {
    const longMessage = 'A'.repeat(10000);
    const data: PromptVersionCreate = {
      promptId,
      content: 'Content',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      commitMessage: longMessage,
    };
    const version = versioning.createVersion(promptId, data)!;
    const retrieved = versioning.getVersion(version.id);

    expect(retrieved!.commitMessage).toBe(longMessage);
  });

  test('getVersion returns version with unicode commit message', () => {
    const unicodeMessage = 'コミット メッセージ';
    const data: PromptVersionCreate = {
      promptId,
      content: 'Content',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      commitMessage: unicodeMessage,
    };
    const version = versioning.createVersion(promptId, data)!;
    const retrieved = versioning.getVersion(version.id);

    expect(retrieved!.commitMessage).toBe(unicodeMessage);
  });

  test('getVersion returns version with newline in commit message', () => {
    const data: PromptVersionCreate = {
      promptId,
      content: 'Content',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      commitMessage: 'Line 1\nLine 2\nLine 3',
    };
    const version = versioning.createVersion(promptId, data)!;
    const retrieved = versioning.getVersion(version.id);

    expect(retrieved!.commitMessage).toBe('Line 1\nLine 2\nLine 3');
  });

  test('getVersion returns version with special characters in commit message', () => {
    const data: PromptVersionCreate = {
      promptId,
      content: 'Content',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      commitMessage: 'Special: @#$%^&*()',
    };
    const version = versioning.createVersion(promptId, data)!;
    const retrieved = versioning.getVersion(version.id);

    expect(retrieved!.commitMessage).toBe('Special: @#$%^&*()');
  });
});

// ─── getLatestVersion ────────────────────────────────────────────────────────

describe('VersioningEngine - getLatestVersion', () => {
  let promptId: string;
  const now = new Date().toISOString();

  beforeEach(() => {
    promptId = crypto.randomUUID();
    const conn = db.connection;
    conn.prepare(
      `INSERT OR REPLACE INTO prompts (id, name, content, model, temperature, maxTokens, created_at, updated_at)
       VALUES (?, 'Latest Test', 'Initial', 'gpt-4', 0.7, 1024, ?, ?)`,
    ).run(promptId, now, now);
  });

  test('getLatestVersion returns undefined for prompt with no versions', () => {
    const latest = versioning.getLatestVersion(promptId);
    expect(latest).toBeUndefined();
  });

  test('getLatestVersion returns the latest version', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'V1',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    versioning.createVersion(promptId, {
      promptId,
      content: 'V2',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    versioning.createVersion(promptId, {
      promptId,
      content: 'V3',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const latest = versioning.getLatestVersion(promptId);

    expect(latest).toBeDefined();
    expect(latest!.content).toBe('V3');
    expect(latest!.versionNumber).toBe(3);
  });

  test('getLatestVersion returns version after rollback', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'V1',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    versioning.createVersion(promptId, {
      promptId,
      content: 'V2',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    versioning.rollbackToVersionNumber(promptId, 1);

    const latest = versioning.getLatestVersion(promptId);

    expect(latest).toBeDefined();
    expect(latest!.content).toBe('V1');
    expect(latest!.versionNumber).toBe(3); // Rollback creates a new version
  });

  test('getLatestVersion returns version with system prompt', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'Content',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: 'You are a helpful assistant',
    });

    const latest = versioning.getLatestVersion(promptId);

    expect(latest!.systemPrompt).toBe('You are a helpful assistant');
  });

  test('getLatestVersion returns version with commit message', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'Content',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      commitMessage: 'Test commit',
    });

    const latest = versioning.getLatestVersion(promptId);

    expect(latest!.commitMessage).toBe('Test commit');
  });

  test('getLatestVersion returns version with different model', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'Content',
      model: 'gpt-3.5-turbo',
      temperature: 0.9,
      maxTokens: 2048,
    });

    const latest = versioning.getLatestVersion(promptId);

    expect(latest!.model).toBe('gpt-3.5-turbo');
    expect(latest!.temperature).toBe(0.9);
    expect(latest!.maxTokens).toBe(2048);
  });

  test('getLatestVersion returns version with empty content', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: '',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const latest = versioning.getLatestVersion(promptId);

    expect(latest!.content).toBe('');
  });

  test('getLatestVersion returns version with unicode content', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'Hello 世界 🌍',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const latest = versioning.getLatestVersion(promptId);

    expect(latest!.content).toBe('Hello 世界 🌍');
  });
});

// ─── listVersions ────────────────────────────────────────────────────────────

describe('VersioningEngine - listVersions', () => {
  let promptId: string;
  const now = new Date().toISOString();

  beforeEach(() => {
    promptId = crypto.randomUUID();
    const conn = db.connection;
    conn.prepare(
      `INSERT OR REPLACE INTO prompts (id, name, content, model, temperature, maxTokens, created_at, updated_at)
       VALUES (?, 'List Test', 'Initial', 'gpt-4', 0.7, 1024, ?, ?)`,
    ).run(promptId, now, now);
  });

  test('listVersions returns empty array for prompt with no versions', () => {
    const versions = versioning.listVersions(promptId);
    expect(versions).toEqual([]);
  });

  test('listVersions returns versions in order', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'V1',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    versioning.createVersion(promptId, {
      promptId,
      content: 'V2',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    versioning.createVersion(promptId, {
      promptId,
      content: 'V3',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions).toHaveLength(3);
    expect(versions[0].versionNumber).toBe(1);
    expect(versions[1].versionNumber).toBe(2);
    expect(versions[2].versionNumber).toBe(3);
  });

  test('listVersions returns versions with correct content', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'Content 1',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    versioning.createVersion(promptId, {
      promptId,
      content: 'Content 2',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].content).toBe('Content 1');
    expect(versions[1].content).toBe('Content 2');
  });

  test('listVersions returns versions with correct commit messages', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'V1',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      commitMessage: 'First',
    });

    versioning.createVersion(promptId, {
      promptId,
      content: 'V2',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      commitMessage: 'Second',
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].commitMessage).toBe('First');
    expect(versions[1].commitMessage).toBe('Second');
  });

  test('listVersions returns versions with correct content hashes', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'Content',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].contentHash).toBeDefined();
    expect(versions[0].contentHash.length).toBe(64); // SHA-256 hex
  });

  test('listVersions returns versions with correct timestamps', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'Content',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].createdAt).toBeDefined();
    expect(new Date(versions[0].createdAt).getTime()).toBeGreaterThan(0);
  });

  test('listVersions returns versions with correct promptId', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'Content',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].promptId).toBe(promptId);
  });

  test('listVersions returns versions with correct model and temperature', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'Content',
      model: 'gpt-3.5-turbo',
      temperature: 0.9,
      maxTokens: 2048,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].model).toBe('gpt-3.5-turbo');
    expect(versions[0].temperature).toBe(0.9);
    expect(versions[0].maxTokens).toBe(2048);
  });

  test('listVersions returns versions with system prompt', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'Content',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: 'You are helpful',
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].systemPrompt).toBe('You are helpful');
  });

  test('listVersions returns versions without system prompt', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'Content',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].systemPrompt).toBeUndefined();
  });

  test('listVersions returns versions with empty content', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: '',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].content).toBe('');
  });

  test('listVersions returns versions with unicode content', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'Hello 世界',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].content).toBe('Hello 世界');
  });

  test('listVersions returns versions with special characters', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: '@#$%^&*()',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].content).toBe('@#$%^&*()');
  });

  test('listVersions returns versions with newlines', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'Line 1\nLine 2\nLine 3',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].content).toBe('Line 1\nLine 2\nLine 3');
  });

  test('listVersions returns versions with very long content', () => {
    const longContent = 'A'.repeat(10000);
    versioning.createVersion(promptId, {
      promptId,
      content: longContent,
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].content).toBe(longContent);
    expect(versions[0].content.length).toBe(10000);
  });

  test('listVersions returns versions with different models', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'V1',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    versioning.createVersion(promptId, {
      promptId,
      content: 'V2',
      model: 'gpt-3.5-turbo',
      temperature: 0.9,
      maxTokens: 2048,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].model).toBe('gpt-4');
    expect(versions[1].model).toBe('gpt-3.5-turbo');
  });

  test('listVersions returns versions with different temperatures', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'V1',
      model: 'gpt-4',
      temperature: 0.1,
      maxTokens: 1024,
    });

    versioning.createVersion(promptId, {
      promptId,
      content: 'V2',
      model: 'gpt-4',
      temperature: 1.0,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].temperature).toBe(0.1);
    expect(versions[1].temperature).toBe(1.0);
  });

  test('listVersions returns versions with different maxTokens', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'V1',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 256,
    });

    versioning.createVersion(promptId, {
      promptId,
      content: 'V2',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 4096,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].maxTokens).toBe(256);
    expect(versions[1].maxTokens).toBe(4096);
  });

  test('listVersions returns versions with zero temperature', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'V1',
      model: 'gpt-4',
      temperature: 0,
      maxTokens: 1024,
    });

    versioning.createVersion(promptId, {
      promptId,
      content: 'V2',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].temperature).toBe(0);
    expect(versions[1].temperature).toBe(0.7);
  });

  test('listVersions returns versions with zero maxTokens', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'V1',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 0,
    });

    versioning.createVersion(promptId, {
      promptId,
      content: 'V2',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].maxTokens).toBe(0);
    expect(versions[1].maxTokens).toBe(1024);
  });

  test('listVersions returns versions with very large maxTokens', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'V1',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 100000,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].maxTokens).toBe(100000);
  });

  test('listVersions returns versions with high temperature', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'V1',
      model: 'gpt-4',
      temperature: 2.0,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].temperature).toBe(2.0);
  });

  test('listVersions returns versions with fractional temperature', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'V1',
      model: 'gpt-4',
      temperature: 0.123,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].temperature).toBe(0.123);
  });

  test('listVersions returns versions with empty commit message', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'V1',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      commitMessage: '',
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].commitMessage).toBe('');
  });

  test('listVersions returns versions with unicode commit message', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'V1',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      commitMessage: 'コミット',
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].commitMessage).toBe('コミット');
  });

  test('listVersions returns versions with newline in commit message', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'V1',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      commitMessage: 'Line 1\nLine 2',
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].commitMessage).toBe('Line 1\nLine 2');
  });

  test('listVersions returns versions with special characters in commit message', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'V1',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      commitMessage: '@#$%^&*()',
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].commitMessage).toBe('@#$%^&*()');
  });

  test('listVersions returns versions with very long commit message', () => {
    const longMessage = 'A'.repeat(10000);
    versioning.createVersion(promptId, {
      promptId,
      content: 'V1',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      commitMessage: longMessage,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].commitMessage).toBe(longMessage);
  });

  test('listVersions returns versions with different system prompts', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'V1',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: 'System 1',
    });

    versioning.createVersion(promptId, {
      promptId,
      content: 'V2',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: 'System 2',
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].systemPrompt).toBe('System 1');
    expect(versions[1].systemPrompt).toBe('System 2');
  });

  test('listVersions returns versions with mixed system prompts', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'V1',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: 'System 1',
    });

    versioning.createVersion(promptId, {
      promptId,
      content: 'V2',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].systemPrompt).toBe('System 1');
    expect(versions[1].systemPrompt).toBeUndefined();
  });

  test('listVersions returns versions with empty system prompt', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'V1',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: '',
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].systemPrompt).toBe('');
  });

  test('listVersions returns versions with unicode system prompt', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'V1',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: 'あなたはアシスタントです',
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].systemPrompt).toBe('あなたはアシスタントです');
  });

  test('listVersions returns versions with newline in system prompt', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'V1',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: 'Line 1\nLine 2',
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].systemPrompt).toBe('Line 1\nLine 2');
  });

  test('listVersions returns versions with special characters in system prompt', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'V1',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: '@#$%^&*()',
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].systemPrompt).toBe('@#$%^&*()');
  });

  test('listVersions returns versions with very long system prompt', () => {
    const longSystemPrompt = 'A'.repeat(10000);
    versioning.createVersion(promptId, {
      promptId,
      content: 'V1',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: longSystemPrompt,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].systemPrompt).toBe(longSystemPrompt);
  });

  test('listVersions returns versions with empty content and system prompt', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: '',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: '',
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].content).toBe('');
    expect(versions[0].systemPrompt).toBe('');
  });

  test('listVersions returns versions with unicode content and system prompt', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'Hello 世界',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: 'あなたはアシスタントです',
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].content).toBe('Hello 世界');
    expect(versions[0].systemPrompt).toBe('あなたはアシスタントです');
  });

  test('listVersions returns versions with emoji content and system prompt', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'Hello 🌍',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
      systemPrompt: '🤖 I am a robot',
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].content).toBe('Hello 🌍');
    expect(versions[0].systemPrompt).toBe('🤖 I am a robot');
  });

  test('listVersions returns versions with tab and carriage return', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'Line 1\tLine 2\r\nLine 3',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].content).toBe('Line 1\tLine 2\r\nLine 3');
  });

  test('listVersions returns versions with null bytes', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'Line 1\x00Line 2',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].content).toBe('Line 1\x00Line 2');
  });

  test('listVersions returns versions with backslash', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'Path: C:\\Users\\test',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].content).toBe('Path: C:\\Users\\test');
  });

  test('listVersions returns versions with forward slash', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'Path: /usr/local/bin',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].content).toBe('Path: /usr/local/bin');
  });

  test('listVersions returns versions with quote characters', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'He said "Hello" and \'Goodbye\'',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].content).toBe('He said "Hello" and \'Goodbye\'');
  });

  test('listVersions returns versions with backtick', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: '`code` and ```code block```',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].content).toBe('`code` and ```code block```');
  });

  test('listVersions returns versions with tilde', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: '~/.bashrc and ~/Documents',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].content).toBe('~/.bashrc and ~/Documents');
  });

  test('listVersions returns versions with dollar sign', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: '$HOME and $PATH',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].content).toBe('$HOME and $PATH');
  });

  test('listVersions returns versions with percent sign', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: '100% complete',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].content).toBe('100% complete');
  });

  test('listVersions returns versions with ampersand', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'A & B',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].content).toBe('A & B');
  });

  test('listVersions returns versions with pipe', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'A | B',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].content).toBe('A | B');
  });

  test('listVersions returns versions with colon', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'Key: Value',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].content).toBe('Key: Value');
  });

  test('listVersions returns versions with semicolon', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'A; B; C',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].content).toBe('A; B; C');
  });

  test('listVersions returns versions with at sign', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'user@example.com',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].content).toBe('user@example.com');
  });

  test('listVersions returns versions with hash', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: '#hashtag',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].content).toBe('#hashtag');
  });

  test('listVersions returns versions with asterisk', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'A * B',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].content).toBe('A * B');
  });

  test('listVersions returns versions with plus', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'A + B',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].content).toBe('A + B');
  });

  test('listVersions returns versions with equals', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'A = B',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].content).toBe('A = B');
  });

  test('listVersions returns versions with less than and greater than', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'A < B > C',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].content).toBe('A < B > C');
  });

  test('listVersions returns versions with comma', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'A, B, C',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].content).toBe('A, B, C');
  });

  test('listVersions returns versions with period', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'A. B. C.',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].content).toBe('A. B. C.');
  });

  test('listVersions returns versions with question mark', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'A? B? C?',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].content).toBe('A? B? C?');
  });

  test('listVersions returns versions with exclamation mark', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: 'A! B! C!',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].content).toBe('A! B! C!');
  });

  test('listVersions returns versions with all special characters', () => {
    versioning.createVersion(promptId, {
      promptId,
      content: '@#$%^&*()_+-=[]{}|;:\'",.<>?/\\`~!?,',
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1024,
    });

    const versions = versioning.listVersions(promptId);

    expect(versions[0].content).toBe('@#$%^&*()_+-=[]{}|;:\'",.<>?/\\`~!?,');
  });
});
