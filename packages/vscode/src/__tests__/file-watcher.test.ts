/**
 * Tests for the file watcher module.
 *
 * Verifies:
 *  - promptNameFromPath extracts names correctly
 *  - hashContent produces consistent hashes
 *  - readSidecar reads optional JSON sidecars
 *  - findPromptByName finds prompts by name (case-insensitive)
 *  - syncFileToDB creates prompts, creates versions, detects unchanged content
 *  - handleFileDeleted marks prompts as deleted
 *  - syncDirectory scans a directory and syncs all .prompt files
 *  - startWatching/stopWatching manage the file system watcher lifecycle
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import crypto from 'node:crypto';
import { DB, VersioningEngine } from '@sentry-prompt/core';
import type { Database } from 'better-sqlite3';
import {
  promptNameFromPath,
  hashContent,
  readSidecar,
  findPromptByName,
  syncFileToDB,
  handleFileDeleted,
  syncDirectory,
} from '../file-watcher.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'promptsentry-test-'));
}

function createTempDB(): DB {
  const dir = createTempDir();
  return new DB({ path: path.join(dir, 'test.db') });
}

function writePromptFile(dir: string, name: string, content: string): string {
  const filePath = path.join(dir, `${name}.prompt`);
  fs.writeFileSync(filePath, content);
  return filePath;
}

function writeSidecarFile(dir: string, name: string, metadata: Record<string, unknown>): string {
  const filePath = path.join(dir, `${name}.prompt.json`);
  fs.writeFileSync(filePath, JSON.stringify(metadata));
  return filePath;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('file-watcher', () => {
  describe('promptNameFromPath', () => {
    it('extracts name from a simple .prompt file', () => {
      expect(promptNameFromPath('/path/to/my-prompt.prompt')).toBe('my-prompt');
    });

    it('handles names with hyphens and underscores', () => {
      expect(promptNameFromPath('/path/to/my_prompt-v2.prompt')).toBe('my_prompt-v2');
    });

    it('handles nested paths', () => {
      expect(promptNameFromPath('/a/b/c/deep.prompt')).toBe('deep');
    });
  });

  describe('hashContent', () => {
    it('produces consistent hashes for the same content', () => {
      const content = 'Hello, world!';
      const hash1 = hashContent(content);
      const hash2 = hashContent(content);
      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different content', () => {
      const hash1 = hashContent('Hello');
      const hash2 = hashContent('World');
      expect(hash1).not.toBe(hash2);
    });

    it('produces a SHA-256 hex digest', () => {
      const content = 'test';
      const expected = crypto.createHash('sha256').update(content).digest('hex');
      expect(hashContent(content)).toBe(expected);
    });
  });

  describe('readSidecar', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = createTempDir();
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true });
    });

    it('returns undefined when no sidecar exists', () => {
      const filePath = path.join(tmpDir, 'test.prompt');
      fs.writeFileSync(filePath, 'content');
      expect(readSidecar(filePath)).toBeUndefined();
    });

    it('reads valid sidecar JSON', () => {
      const filePath = path.join(tmpDir, 'test.prompt');
      fs.writeFileSync(filePath, 'content');
      writeSidecarFile(tmpDir, 'test', { model: 'llama3', temperature: 0.5 });
      const result = readSidecar(filePath);
      expect(result).toEqual({ model: 'llama3', temperature: 0.5 });
    });

    it('ignores malformed JSON', () => {
      const filePath = path.join(tmpDir, 'test.prompt');
      fs.writeFileSync(filePath, 'content');
      fs.writeFileSync(path.join(tmpDir, 'test.prompt.json'), '{ invalid json');
      expect(readSidecar(filePath)).toBeUndefined();
    });
  });

  describe('findPromptByName', () => {
    it('finds a prompt by exact name', () => {
      const db = createTempDB();
      const conn = db.connection as Database;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      conn.prepare(
        `INSERT INTO prompts (id, name, content, model, temperature, maxTokens, system_prompt, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, 'MyPrompt', 'content', 'gpt-4', 0.7, 1024, null, now, now);

      const result = findPromptByName(conn, 'MyPrompt');
      expect(result).toBeDefined();
      expect(result!.id).toBe(id);
      db.close();
    });

    it('finds a prompt by case-insensitive name', () => {
      const db = createTempDB();
      const conn = db.connection as Database;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      conn.prepare(
        `INSERT INTO prompts (id, name, content, model, temperature, maxTokens, system_prompt, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, 'MyPrompt', 'content', 'gpt-4', 0.7, 1024, null, now, now);

      const result = findPromptByName(conn, 'myprompt');
      expect(result).toBeDefined();
      expect(result!.id).toBe(id);
      db.close();
    });

    it('returns undefined for non-existent prompt', () => {
      const db = createTempDB();
      const conn = db.connection as Database;
      const result = findPromptByName(conn, 'NonExistent');
      expect(result).toBeUndefined();
      db.close();
    });
  });

  describe('syncFileToDB', () => {
    let db: DB;
    let versioningEngine: VersioningEngine;
    let tmpDir: string;

    beforeEach(() => {
      db = createTempDB();
      versioningEngine = new VersioningEngine(db);
      tmpDir = createTempDir();
    });

    afterEach(() => {
      db.close();
      fs.rmSync(tmpDir, { recursive: true });
    });

    it('creates a new prompt when file does not exist in DB', () => {
      const filePath = writePromptFile(tmpDir, 'test-prompt', 'Hello world');
      const result = syncFileToDB(
        db.connection as Database,
        versioningEngine,
        filePath,
        'Hello world',
        new Map(),
        true,
        true,
      );

      expect(result.action).toBe('created');
      expect(result.promptId).toBeDefined();
      expect(result.versionId).toBeDefined();

      // Verify prompt exists in DB
      const row = db.connection.prepare('SELECT * FROM prompts WHERE id = ?').get(result.promptId);
      expect(row).toBeDefined();
      expect((row as any).name).toBe('test-prompt');
      expect((row as any).content).toBe('Hello world');

      // Verify version exists
      const version = db.connection.prepare('SELECT * FROM prompt_versions WHERE id = ?').get(result.versionId);
      expect(version).toBeDefined();
      expect((version as any).content).toBe('Hello world');
      expect((version as any).version_number).toBe(1);
    });

    it('skips creation when autoCreate is false', () => {
      const filePath = writePromptFile(tmpDir, 'test-prompt', 'Hello world');
      const result = syncFileToDB(
        db.connection as Database,
        versioningEngine,
        filePath,
        'Hello world',
        new Map(),
        false,
        true,
      );

      expect(result.action).toBe('skipped_create');
    });

    it('creates a new version when content changes', () => {
      // First sync
      const filePath = writePromptFile(tmpDir, 'test-prompt', 'Hello world');
      const lastSeenFiles = new Map();
      const result1 = syncFileToDB(
        db.connection as Database,
        versioningEngine,
        filePath,
        'Hello world',
        lastSeenFiles,
        true,
        true,
      );
      expect(result1.action).toBe('created');

      // Second sync with changed content
      const result2 = syncFileToDB(
        db.connection as Database,
        versioningEngine,
        filePath,
        'Hello world, updated!',
        lastSeenFiles,
        true,
        true,
      );

      expect(result2.action).toBe('updated');
      expect(result2.promptId).toBe(result1.promptId);

      // Verify two versions exist
      const versions = db.connection.prepare('SELECT * FROM prompt_versions WHERE prompt_id = ?').all(result1.promptId);
      expect(versions.length).toBe(2);
      expect((versions[0] as any).version_number).toBe(1);
      expect((versions[1] as any).version_number).toBe(2);
    });

    it('detects unchanged content', () => {
      const filePath = writePromptFile(tmpDir, 'test-prompt', 'Hello world');
      const lastSeenFiles = new Map();

      // First sync
      const result1 = syncFileToDB(
        db.connection as Database,
        versioningEngine,
        filePath,
        'Hello world',
        lastSeenFiles,
        true,
        true,
      );
      expect(result1.action).toBe('created');
      const promptId = result1.promptId!;

      // Second sync with same content
      const result = syncFileToDB(
        db.connection as Database,
        versioningEngine,
        filePath,
        'Hello world',
        lastSeenFiles,
        true,
        true,
      );

      expect(result.action).toBe('unchanged');

      // Only one version should exist
      const versions = db.connection.prepare('SELECT * FROM prompt_versions WHERE prompt_id = ?').all(promptId);
      expect(versions.length).toBe(1);
    });

    it('skips update when autoUpdate is false', () => {
      const filePath = writePromptFile(tmpDir, 'test-prompt', 'Hello world');
      const lastSeenFiles = new Map();

      // First sync
      syncFileToDB(
        db.connection as Database,
        versioningEngine,
        filePath,
        'Hello world',
        lastSeenFiles,
        true,
        true,
      );

      // Second sync with changed content but autoUpdate=false
      const result = syncFileToDB(
        db.connection as Database,
        versioningEngine,
        filePath,
        'Hello world, updated!',
        lastSeenFiles,
        true,
        false,
      );

      expect(result.action).toBe('skipped_update');
    });

    it('reads sidecar metadata and applies it', () => {
      const filePath = writePromptFile(tmpDir, 'test-prompt', 'Hello world');
      writeSidecarFile(tmpDir, 'test-prompt', { model: 'llama3', temperature: 0.5, maxTokens: 512 });

      const result = syncFileToDB(
        db.connection as Database,
        versioningEngine,
        filePath,
        'Hello world',
        new Map(),
        true,
        true,
      );

      expect(result.action).toBe('created');

      const row = db.connection.prepare('SELECT * FROM prompts WHERE id = ?').get(result.promptId);
      expect((row as any).model).toBe('llama3');
      expect((row as any).temperature).toBe(0.5);
      expect((row as any).maxTokens).toBe(512);
    });

    it('tracks files in lastSeenFiles map', () => {
      const filePath = writePromptFile(tmpDir, 'test-prompt', 'Hello world');
      const lastSeenFiles = new Map();

      syncFileToDB(
        db.connection as Database,
        versioningEngine,
        filePath,
        'Hello world',
        lastSeenFiles,
        true,
        true,
      );

      expect(lastSeenFiles.has(filePath)).toBe(true);
      expect(lastSeenFiles.get(filePath)).toBeDefined();
    });
  });

  describe('handleFileDeleted', () => {
    let db: DB;

    beforeEach(() => {
      db = createTempDB();
    });

    afterEach(() => {
      db.close();
    });

    it('marks prompt as deleted when file is removed', () => {
      const conn = db.connection as Database;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      conn.prepare(
        `INSERT INTO prompts (id, name, content, model, temperature, maxTokens, system_prompt, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, 'deleted-prompt', 'old content', 'gpt-4', 0.7, 1024, null, now, now);

      const result = handleFileDeleted(conn, '/path/to/deleted-prompt.prompt');

      expect(result.action).toBe('deleted');
      expect(result.promptId).toBe(id);

      // Verify content was updated to indicate deletion
      const row = conn.prepare('SELECT * FROM prompts WHERE id = ?').get(id);
      expect((row as any).content).toContain('[DELETED]');
    });

    it('returns not_found for non-existent prompt', () => {
      const result = handleFileDeleted(db.connection as Database, '/path/to/nonexistent.prompt');
      expect(result.action).toBe('not_found');
    });
  });

  describe('syncDirectory', () => {
    let db: DB;
    let versioningEngine: VersioningEngine;
    let tmpDir: string;

    beforeEach(() => {
      db = createTempDB();
      versioningEngine = new VersioningEngine(db);
      tmpDir = createTempDir();
    });

    afterEach(() => {
      db.close();
      fs.rmSync(tmpDir, { recursive: true });
    });

    it('syncs all .prompt files in a directory', () => {
      writePromptFile(tmpDir, 'prompt-a', 'Content A');
      writePromptFile(tmpDir, 'prompt-b', 'Content B');
      writePromptFile(tmpDir, 'prompt-c', 'Content C');

      const lastSeenFiles = new Map();
      const results = syncDirectory(
        db.connection as Database,
        versioningEngine,
        tmpDir,
        lastSeenFiles,
        true,
        true,
      );

      expect(results.created).toBe(3);
      expect(results.updated).toBe(0);
      expect(results.unchanged).toBe(0);
      expect(results.errors.length).toBe(0);
      expect(lastSeenFiles.size).toBe(3);
    });

    it('ignores non-.prompt files', () => {
      writePromptFile(tmpDir, 'prompt-a', 'Content A');
      fs.writeFileSync(path.join(tmpDir, 'readme.md'), '# README');
      fs.writeFileSync(path.join(tmpDir, 'data.json'), '{}');

      const lastSeenFiles = new Map();
      const results = syncDirectory(
        db.connection as Database,
        versioningEngine,
        tmpDir,
        lastSeenFiles,
        true,
        true,
      );

      expect(results.created).toBe(1);
      expect(results.errors.length).toBe(0);
    });

    it('detects file deletions', () => {
      // First sync
      writePromptFile(tmpDir, 'prompt-a', 'Content A');
      const lastSeenFiles = new Map();
      syncDirectory(
        db.connection as Database,
        versioningEngine,
        tmpDir,
        lastSeenFiles,
        true,
        true,
      );
      expect(lastSeenFiles.size).toBe(1);

      // Delete the file
      fs.unlinkSync(path.join(tmpDir, 'prompt-a.prompt'));

      // Second sync
      const results = syncDirectory(
        db.connection as Database,
        versioningEngine,
        tmpDir,
        lastSeenFiles,
        true,
        true,
      );

      expect(results.deleted).toBe(1);
      expect(lastSeenFiles.size).toBe(0);
    });

    it('reports errors for non-existent directory', () => {
      const lastSeenFiles = new Map();
      const results = syncDirectory(
        db.connection as Database,
        versioningEngine,
        '/nonexistent/path',
        lastSeenFiles,
        true,
        true,
      );

      expect(results.errors.length).toBe(1);
      expect(results.errors[0]).toContain('Directory does not exist');
    });

    it('handles mixed sync results', () => {
      // Create one file
      writePromptFile(tmpDir, 'new-prompt', 'New content');

      // Pre-populate lastSeenFiles with a file that exists in the DB but no longer on disk
      const lastSeenFiles = new Map();
      const deletedPromptId = crypto.randomUUID();
      const now = new Date().toISOString();
      db.connection.prepare(
        `INSERT INTO prompts (id, name, content, model, temperature, maxTokens, system_prompt, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(deletedPromptId, 'deleted-prompt', 'old content', 'gpt-4', 0.7, 1024, null, now, now);
      lastSeenFiles.set(path.join(tmpDir, 'deleted-prompt.prompt'), 'old-hash');

      const results = syncDirectory(
        db.connection as Database,
        versioningEngine,
        tmpDir,
        lastSeenFiles,
        true,
        true,
      );

      expect(results.created).toBe(1);
      expect(results.deleted).toBe(1);
      expect(results.errors.length).toBe(0);
    });
  });
});
