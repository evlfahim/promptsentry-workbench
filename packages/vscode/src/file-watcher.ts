/**
 * File watcher module for PromptSentry VS Code extension.
 *
 * Monitors a user-specified directory for `.prompt` files and automatically
 * syncs file changes to the local SQLite database (prompts + versions).
 *
 * File naming convention:
 *   - A file named `my-prompt.prompt` maps to a prompt called "my-prompt".
 *   - The file content becomes the prompt content.
 *   - An optional JSON sidecar file `my-prompt.prompt.json` can specify
 *     model, temperature, maxTokens, and systemPrompt.
 *
 * Events:
 *   - File created → create prompt + initial version
 *   - File changed → create new version (only if content changed)
 *   - File deleted → prompt marked as deleted (soft delete)
 *   - Sidecar JSON changed → update prompt metadata
 */

import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import crypto from 'node:crypto';
import type { DB, Prompt, PromptVersion, PromptVersionCreate } from '@sentry-prompt/core';
import type Database from 'better-sqlite3';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FileWatcherConfig {
  /** Directory to watch for .prompt files. Empty string means no watching. */
  watchDirectory: string;
  /** Whether to auto-create prompts when files are detected */
  autoCreate: boolean;
  /** Whether to auto-update versions on file changes */
  autoUpdate: boolean;
}

export interface FileWatcherState {
  watcher: vscode.FileSystemWatcher | undefined;
  lastSeenFiles: Map<string, string>; // file path → content hash
  config: FileWatcherConfig;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract prompt name from a .prompt file path.
 *   /path/to/my-prompt.prompt → "my-prompt"
 */
export function promptNameFromPath(filePath: string): string {
  const base = path.basename(filePath, '.prompt');
  return base;
}

/**
 * Compute a content hash for a file.
 */
export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Read optional sidecar JSON for metadata.
 *   my-prompt.prompt.json → { model, temperature, maxTokens, systemPrompt }
 */
export function readSidecar(filePath: string): {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
} | undefined {
  const sidecarPath = filePath + '.json';
  try {
    if (fs.existsSync(sidecarPath)) {
      const raw = fs.readFileSync(sidecarPath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch {
    // Ignore malformed JSON
  }
  return undefined;
}

/**
 * Find an existing prompt by name (case-insensitive match on name).
 */
export function findPromptByName(
  conn: Database.Database,
  name: string,
): { id: string; name: string; content: string; model: string; temperature: number; maxTokens: number; system_prompt: string | null } | undefined {
  const rows = conn.prepare("SELECT id, name, content, model, temperature, maxTokens, system_prompt FROM prompts WHERE LOWER(name) = LOWER(?)").all(name) as any[];
  if (rows.length === 0) return undefined;
  return rows[0];
}

// ─── Sync Operations ─────────────────────────────────────────────────────────

/**
 * Sync a single file to the database.
 * Creates a new prompt if it doesn't exist, or creates a new version if content changed.
 */
export function syncFileToDB(
  conn: Database.Database,
  versioningEngine: { createVersion(promptId: string, data: PromptVersionCreate): PromptVersion | undefined },
  filePath: string,
  content: string,
  lastSeenFiles: Map<string, string>,
  autoCreate: boolean,
  autoUpdate: boolean,
): { action: string; promptId?: string; versionId?: string } {
  const name = promptNameFromPath(filePath);
  const contentHash = hashContent(content);
  const sidecar = readSidecar(filePath);

  // Check if prompt already exists
  const existing = findPromptByName(conn, name);

  if (!existing) {
    if (!autoCreate) {
      return { action: 'skipped_create' };
    }

    // Create new prompt
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    conn.prepare(
      `INSERT INTO prompts (id, name, content, model, temperature, maxTokens, system_prompt, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      name,
      content,
      sidecar?.model || 'gpt-4',
      sidecar?.temperature ?? 0.7,
      sidecar?.maxTokens ?? 1024,
      sidecar?.systemPrompt ?? null,
      now,
      now,
    );

    // Create initial version
    const version = versioningEngine.createVersion(id, {
      promptId: id,
      content,
      model: sidecar?.model || 'gpt-4',
      temperature: sidecar?.temperature ?? 0.7,
      maxTokens: sidecar?.maxTokens ?? 1024,
      systemPrompt: sidecar?.systemPrompt,
      commitMessage: `Auto-created from ${path.basename(filePath)}`,
    });

    lastSeenFiles.set(filePath, contentHash);
    return { action: 'created', promptId: id, versionId: version?.id };
  }

  // Prompt exists — check if content changed
  const existingHash = hashContent(existing.content);
  if (existingHash === contentHash) {
    // Content unchanged — still update metadata from sidecar if present
    if (sidecar) {
      const updates: string[] = [];
      const values: any[] = [];
      if (sidecar.model !== undefined) { updates.push('model = ?'); values.push(sidecar.model); }
      if (sidecar.temperature !== undefined) { updates.push('temperature = ?'); values.push(sidecar.temperature); }
      if (sidecar.maxTokens !== undefined) { updates.push('maxTokens = ?'); values.push(sidecar.maxTokens); }
      if (sidecar.systemPrompt !== undefined) { updates.push('system_prompt = ?'); values.push(sidecar.systemPrompt ?? null); }
      if (updates.length > 0) {
        updates.push('updated_at = ?');
        values.push(new Date().toISOString());
        values.push(existing.id);
        conn.prepare(`UPDATE prompts SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      }
    }
    lastSeenFiles.set(filePath, contentHash);
    return { action: 'unchanged' };
  }

  // Content changed — create new version
  if (!autoUpdate) {
    lastSeenFiles.set(filePath, contentHash);
    return { action: 'skipped_update' };
  }

  const model = sidecar?.model || existing.model;
  const temperature = sidecar?.temperature ?? existing.temperature;
  const maxTokens = sidecar?.maxTokens ?? existing.maxTokens;
  const systemPrompt = sidecar?.systemPrompt ?? (existing.system_prompt ?? undefined);

  const version = versioningEngine.createVersion(existing.id, {
    promptId: existing.id,
    content,
    model,
    temperature,
    maxTokens,
    systemPrompt,
    commitMessage: `Updated from ${path.basename(filePath)}`,
  });

  // Update prompt metadata from sidecar
  if (sidecar) {
    const updates: string[] = [];
    const values: any[] = [];
    if (sidecar.model !== undefined) { updates.push('model = ?'); values.push(sidecar.model); }
    if (sidecar.temperature !== undefined) { updates.push('temperature = ?'); values.push(sidecar.temperature); }
    if (sidecar.maxTokens !== undefined) { updates.push('maxTokens = ?'); values.push(sidecar.maxTokens); }
    if (sidecar.systemPrompt !== undefined) { updates.push('system_prompt = ?'); values.push(sidecar.systemPrompt ?? null); }
    if (updates.length > 0) {
      updates.push('updated_at = ?');
      values.push(new Date().toISOString());
      values.push(existing.id);
      conn.prepare(`UPDATE prompts SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }
  }

  lastSeenFiles.set(filePath, contentHash);
  return { action: 'updated', promptId: existing.id, versionId: version?.id };
}

/**
 * Handle file deletion: remove prompt from DB if it exists.
 */
export function handleFileDeleted(
  conn: Database.Database,
  filePath: string,
): { action: string; promptId?: string } {
  const name = promptNameFromPath(filePath);
  const existing = findPromptByName(conn, name);

  if (!existing) {
    return { action: 'not_found' };
  }

  // Soft delete: update the prompt's content to indicate deletion
  const now = new Date().toISOString();
  conn.prepare(
    `UPDATE prompts SET content = '[DELETED] Prompt file removed: ${filePath}', updated_at = ? WHERE id = ?`,
  ).run(now, existing.id);

  return { action: 'deleted', promptId: existing.id };
}

/**
 * Scan all .prompt files in the watched directory and sync them.
 * Used for initial sync and on directory change events.
 */
export function syncDirectory(
  conn: Database.Database,
  versioningEngine: { createVersion(promptId: string, data: PromptVersionCreate): PromptVersion | undefined },
  dirPath: string,
  lastSeenFiles: Map<string, string>,
  autoCreate: boolean,
  autoUpdate: boolean,
): { created: number; updated: number; unchanged: number; deleted: number; errors: string[] } {
  const results = { created: 0, updated: 0, unchanged: 0, deleted: 0, errors: [] as string[] };

  if (!fs.existsSync(dirPath)) {
    results.errors.push(`Directory does not exist: ${dirPath}`);
    return results;
  }

  const files = fs.readdirSync(dirPath);
  const currentFiles = new Set<string>();

  for (const file of files) {
    if (!file.endsWith('.prompt')) continue;

    const filePath = path.join(dirPath, file);
    currentFiles.add(filePath);

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const hash = hashContent(content);
      const lastHash = lastSeenFiles.get(filePath);

      if (lastHash === undefined) {
        // New file
        const result = syncFileToDB(conn, versioningEngine, filePath, content, lastSeenFiles, autoCreate, autoUpdate);
        if (result.action === 'created') {
          results.created++;
        } else if (result.action === 'unchanged') {
          results.unchanged++;
        }
      } else if (lastHash !== hash) {
        // Changed file
        const result = syncFileToDB(conn, versioningEngine, filePath, content, lastSeenFiles, autoCreate, autoUpdate);
        if (result.action === 'updated') {
          results.updated++;
        } else if (result.action === 'unchanged') {
          results.unchanged++;
        }
      } else {
        // Unchanged
        results.unchanged++;
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      results.errors.push(`Error syncing ${file}: ${errMsg}`);
    }
  }

  // Handle deleted files
  for (const [filePath, hash] of lastSeenFiles.entries()) {
    if (!currentFiles.has(filePath)) {
      try {
        const result = handleFileDeleted(conn, filePath);
        if (result.action === 'deleted') {
          results.deleted++;
        }
        lastSeenFiles.delete(filePath);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Unknown error';
        results.errors.push(`Error handling deletion of ${filePath}: ${errMsg}`);
      }
    }
  }

  return results;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a new file watcher instance.
 */
export function createFileWatcher(
  context: vscode.ExtensionContext,
  db: DB,
  versioningEngine: { createVersion(promptId: string, data: PromptVersionCreate): PromptVersion | undefined },
): FileWatcherState {
  const config: FileWatcherConfig = {
    watchDirectory: '',
    autoCreate: true,
    autoUpdate: true,
  };

  // Load config from VS Code settings
  const settings = vscode.workspace.getConfiguration('promptsentry');
  const watchDir = settings.get<string>('watchDirectory', '');
  if (watchDir) {
    config.watchDirectory = watchDir;
    config.autoCreate = settings.get<boolean>('autoCreatePrompts', true);
    config.autoUpdate = settings.get<boolean>('autoUpdateVersions', true);
  }

  const state: FileWatcherState = {
    watcher: undefined,
    lastSeenFiles: new Map(),
    config,
  };

  // Set up file system watcher if directory is configured
  if (config.watchDirectory && fs.existsSync(config.watchDirectory)) {
    state.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(config.watchDirectory, '*.prompt'),
    );

    // Watch for file creation
    state.watcher.onDidCreate(async (uri) => {
      try {
        const content = await vscode.workspace.fs.readFile(uri);
        const fileContent = Buffer.from(content).toString('utf-8');
        const hash = hashContent(fileContent);
        const result = syncFileToDB(db.connection, versioningEngine, uri.fsPath, fileContent, state.lastSeenFiles, config.autoCreate, config.autoUpdate);

        if (result.action === 'created') {
          state.lastSeenFiles.set(uri.fsPath, hash);
          vscode.window.showInformationMessage(
            `PromptSentry: Created prompt "${promptNameFromPath(uri.fsPath)}" from file`,
          );
        } else if (result.action === 'unchanged') {
          state.lastSeenFiles.set(uri.fsPath, hash);
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          `PromptSentry: Error creating prompt from file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    }, undefined, context.subscriptions);

    // Watch for file changes
    state.watcher.onDidChange(async (uri) => {
      try {
        const content = await vscode.workspace.fs.readFile(uri);
        const fileContent = Buffer.from(content).toString('utf-8');
        const hash = hashContent(fileContent);
        const result = syncFileToDB(db.connection, versioningEngine, uri.fsPath, fileContent, state.lastSeenFiles, config.autoCreate, config.autoUpdate);

        if (result.action === 'updated') {
          state.lastSeenFiles.set(uri.fsPath, hash);
          vscode.window.showInformationMessage(
            `PromptSentry: Updated version of "${promptNameFromPath(uri.fsPath)}" from file`,
          );
        } else if (result.action === 'unchanged') {
          state.lastSeenFiles.set(uri.fsPath, hash);
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          `PromptSentry: Error updating prompt from file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    }, undefined, context.subscriptions);

    // Watch for file deletion
    state.watcher.onDidDelete(async (uri) => {
      try {
        const result = handleFileDeleted(db.connection, uri.fsPath);
        if (result.action === 'deleted') {
          state.lastSeenFiles.delete(uri.fsPath);
          vscode.window.showInformationMessage(
            `PromptSentry: Removed prompt "${promptNameFromPath(uri.fsPath)}" (file deleted)`,
          );
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          `PromptSentry: Error handling file deletion: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    }, undefined, context.subscriptions);

    // Initial sync of all files in the directory
    const initialResults = syncDirectory(db.connection, versioningEngine, config.watchDirectory, state.lastSeenFiles, config.autoCreate, config.autoUpdate);
    if (initialResults.created > 0 || initialResults.updated > 0) {
      vscode.window.showInformationMessage(
        `PromptSentry: Synced ${initialResults.created} new prompt(s), ${initialResults.updated} updated from ${config.watchDirectory}`,
      );
    }
    if (initialResults.errors.length > 0) {
      vscode.window.showWarningMessage(
        `PromptSentry: File watcher sync had ${initialResults.errors.length} error(s). Check output.`,
      );
    }
  }

  return state;
}

/**
 * Start watching a directory. Returns results of the initial sync.
 */
export function startWatching(
  state: FileWatcherState,
  db: DB,
  versioningEngine: { createVersion(promptId: string, data: PromptVersionCreate): PromptVersion | undefined },
  dirPath: string,
): { created: number; updated: number; unchanged: number; deleted: number; errors: string[] } {
  // Dispose existing watcher
  if (state.watcher) {
    state.watcher.dispose();
    state.watcher = undefined;
  }

  state.config.watchDirectory = dirPath;
  state.lastSeenFiles = new Map();

  if (!fs.existsSync(dirPath)) {
    vscode.window.showErrorMessage(`PromptSentry: Directory does not exist: ${dirPath}`);
    return { created: 0, updated: 0, unchanged: 0, deleted: 0, errors: [`Directory does not exist: ${dirPath}`] };
  }

  state.watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(dirPath, '*.prompt'),
  );

  // Watch for file creation
  state.watcher.onDidCreate(async (uri) => {
    try {
      const content = await vscode.workspace.fs.readFile(uri);
      const fileContent = Buffer.from(content).toString('utf-8');
      const hash = hashContent(fileContent);
      const result = syncFileToDB(db.connection, versioningEngine, uri.fsPath, fileContent, state.lastSeenFiles, state.config.autoCreate, state.config.autoUpdate);
      if (result.action === 'created') {
        state.lastSeenFiles.set(uri.fsPath, hash);
        vscode.window.showInformationMessage(
          `PromptSentry: Created prompt "${promptNameFromPath(uri.fsPath)}" from file`,
        );
      } else if (result.action === 'unchanged') {
        state.lastSeenFiles.set(uri.fsPath, hash);
      }
    } catch (error) {
      vscode.window.showErrorMessage(
        `PromptSentry: Error creating prompt from file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  });

  // Watch for file changes
  state.watcher.onDidChange(async (uri) => {
    try {
      const content = await vscode.workspace.fs.readFile(uri);
      const fileContent = Buffer.from(content).toString('utf-8');
      const hash = hashContent(fileContent);
      const result = syncFileToDB(db.connection, versioningEngine, uri.fsPath, fileContent, state.lastSeenFiles, state.config.autoCreate, state.config.autoUpdate);
      if (result.action === 'updated') {
        state.lastSeenFiles.set(uri.fsPath, hash);
        vscode.window.showInformationMessage(
          `PromptSentry: Updated version of "${promptNameFromPath(uri.fsPath)}" from file`,
        );
      } else if (result.action === 'unchanged') {
        state.lastSeenFiles.set(uri.fsPath, hash);
      }
    } catch (error) {
      vscode.window.showErrorMessage(
        `PromptSentry: Error updating prompt from file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  });

  // Watch for file deletion
  state.watcher.onDidDelete(async (uri) => {
    try {
      const result = handleFileDeleted(db.connection, uri.fsPath);
      if (result.action === 'deleted') {
        state.lastSeenFiles.delete(uri.fsPath);
        vscode.window.showInformationMessage(
          `PromptSentry: Removed prompt "${promptNameFromPath(uri.fsPath)}" (file deleted)`,
        );
      }
    } catch (error) {
      vscode.window.showErrorMessage(
        `PromptSentry: Error handling file deletion: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  });

  // Initial sync
  const results = syncDirectory(db.connection, versioningEngine, dirPath, state.lastSeenFiles, state.config.autoCreate, state.config.autoUpdate);
  if (results.created > 0 || results.updated > 0) {
    vscode.window.showInformationMessage(
      `PromptSentry: Synced ${results.created} new prompt(s), ${results.updated} updated from ${dirPath}`,
    );
  }
  if (results.errors.length > 0) {
    vscode.window.showWarningMessage(
      `PromptSentry: File watcher sync had ${results.errors.length} error(s). Check output.`,
    );
  }

  return results;
}

/**
 * Stop watching the current directory.
 */
export function stopWatching(state: FileWatcherState): void {
  if (state.watcher) {
    state.watcher.dispose();
    state.watcher = undefined;
  }
  state.config.watchDirectory = '';
  state.lastSeenFiles.clear();
}

/**
 * Get the current watching status.
 */
export function getWatchingStatus(state: FileWatcherState): {
  watching: boolean;
  directory: string;
  fileCount: number;
} {
  return {
    watching: state.watcher !== undefined,
    directory: state.config.watchDirectory,
    fileCount: state.lastSeenFiles.size,
  };
}
