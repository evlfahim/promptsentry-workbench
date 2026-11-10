import crypto from 'node:crypto';
import { diffLines } from 'diff';
import type { DB } from './db';
import type {
  Prompt,
  PromptVersion,
  PromptVersionCreate,
  LexicalDiff,
} from './types';

// Row types from SQLite (snake_case column names)
interface VersionRow {
  id: string;
  prompt_id: string;
  content: string;
  model: string;
  temperature: number;
  max_tokens: number;
  system_prompt: string | null;
  content_hash: string;
  version_number: number;
  created_at: string;
  commit_message: string | null;
}

interface PromptRow {
  id: string;
  name: string;
  content: string;
  model: string;
  temperature: number;
  maxTokens: number;
  system_prompt: string | null;
  created_at: string;
  updated_at: string;
}

function mapVersion(row: VersionRow): PromptVersion {
  return {
    id: row.id,
    promptId: row.prompt_id,
    content: row.content,
    model: row.model,
    temperature: row.temperature,
    maxTokens: row.max_tokens,
    systemPrompt: row.system_prompt ?? undefined,
    contentHash: row.content_hash,
    versionNumber: row.version_number,
    createdAt: row.created_at,
    commitMessage: row.commit_message ?? undefined,
  };
}

function mapPrompt(row: PromptRow): Prompt {
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    model: row.model,
    temperature: row.temperature,
    maxTokens: row.maxTokens,
    systemPrompt: row.system_prompt ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class VersioningEngine {
  constructor(private db: DB) {}

  /**
   * Create a new version for a prompt, only if content has changed.
   * Returns the new version, or undefined if content is identical.
   */
  createVersion(
    promptId: string,
    data: PromptVersionCreate,
  ): PromptVersion | undefined {
    const conn = this.db.connection;
    const contentHash = this.computeHash(data.content);

    // Check if the latest version has the same content hash
    const latestVersion = conn
      .prepare(
        `SELECT id, content_hash FROM prompt_versions WHERE prompt_id = ? ORDER BY version_number DESC LIMIT 1`,
      )
      .get(promptId) as { id: string; content_hash: string } | undefined;

    if (latestVersion && latestVersion.content_hash === contentHash) {
      return undefined;
    }

    // Get the next version number
    const maxVersion = conn
      .prepare(
        `SELECT COALESCE(MAX(version_number), 0) as max_version FROM prompt_versions WHERE prompt_id = ?`,
      )
      .get(promptId) as { max_version: number };

    const versionNumber = maxVersion.max_version + 1;
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    const insertVersion = conn.prepare(
      `INSERT INTO prompt_versions (id, prompt_id, content, model, temperature, max_tokens, system_prompt, content_hash, version_number, created_at, commit_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    insertVersion.run(
      id,
      promptId,
      data.content,
      data.model,
      data.temperature,
      data.maxTokens,
      data.systemPrompt ?? null,
      contentHash,
      versionNumber,
      createdAt,
      data.commitMessage ?? null,
    );

    return {
      id,
      promptId,
      content: data.content,
      model: data.model,
      temperature: data.temperature,
      maxTokens: data.maxTokens,
      systemPrompt: data.systemPrompt,
      contentHash,
      versionNumber,
      createdAt,
      commitMessage: data.commitMessage,
    };
  }

  /**
   * Get a version by ID.
   */
  getVersion(id: string): PromptVersion | undefined {
    const conn = this.db.connection;
    const row = conn
      .prepare(
        `SELECT id, prompt_id, content, model, temperature, max_tokens, system_prompt, content_hash, version_number, created_at, commit_message FROM prompt_versions WHERE id = ?`,
      )
      .get(id) as VersionRow | undefined;

    if (!row) return undefined;
    return mapVersion(row);
  }

  /**
   * List all versions for a prompt, ordered by version number.
   */
  listVersions(promptId: string): PromptVersion[] {
    const conn = this.db.connection;
    const rows = conn
      .prepare(
        `SELECT id, prompt_id, content, model, temperature, max_tokens, system_prompt, content_hash, version_number, created_at, commit_message FROM prompt_versions WHERE prompt_id = ? ORDER BY version_number ASC`,
      )
      .all(promptId) as VersionRow[];

    return rows.map(mapVersion);
  }

  /**
   * Get the latest version for a prompt.
   */
  getLatestVersion(promptId: string): PromptVersion | undefined {
    const conn = this.db.connection;
    const row = conn
      .prepare(
        `SELECT id, prompt_id, content, model, temperature, max_tokens, system_prompt, content_hash, version_number, created_at, commit_message FROM prompt_versions WHERE prompt_id = ? ORDER BY version_number DESC LIMIT 1`,
      )
      .get(promptId) as VersionRow | undefined;

    if (!row) return undefined;
    return mapVersion(row);
  }

  /**
   * Compute a content hash for deduplication.
   */
  computeHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Get a lexical diff between two versions.
   */
  getVersionDiff(versionIdA: string, versionIdB: string): LexicalDiff {
    const conn = this.db.connection;

    const rowA = conn
      .prepare(
        `SELECT content FROM prompt_versions WHERE id = ?`,
      )
      .get(versionIdA) as { content: string } | undefined;

    const rowB = conn
      .prepare(
        `SELECT content FROM prompt_versions WHERE id = ?`,
      )
      .get(versionIdB) as { content: string } | undefined;

    if (!rowA || !rowB) {
      throw new Error(`One or both versions not found`);
    }

    const diffResult = diffLines(rowA.content, rowB.content);

    let additions = 0;
    let deletions = 0;
    let common = 0;
    let addedLines = 0;
    let deletedLines = 0;
    let commonLines = 0;

    const additionsArr: string[] = [];
    const deletionsArr: string[] = [];

    for (const part of diffResult) {
      if (part.added) {
        additions++;
        addedLines++;
        additionsArr.push(part.value);
      } else if (part.removed) {
        deletions++;
        deletedLines++;
        deletionsArr.push(part.value);
      } else {
        common++;
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

  /**
   * Rollback a prompt to a specific version.
   * Updates the prompt content and creates a new version.
   */
  rollbackToVersion(
    promptId: string,
    versionId: string,
  ): Prompt {
    const conn = this.db.connection;

    const version = this.getVersion(versionId);
    if (!version) {
      throw new Error(`Version ${versionId} not found`);
    }

    const now = new Date().toISOString();

    // Update the prompt
    conn.prepare(
      `UPDATE prompts SET content = ?, model = ?, temperature = ?, maxTokens = ?, system_prompt = ?, updated_at = ? WHERE id = ?`,
    ).run(
      version.content,
      version.model,
      version.temperature,
      version.maxTokens,
      version.systemPrompt ?? null,
      now,
      promptId,
    );

    // Get the updated prompt
    const promptRow = conn
      .prepare(
        `SELECT id, name, content, model, temperature, maxTokens, system_prompt, created_at, updated_at FROM prompts WHERE id = ?`,
      )
      .get(promptId) as PromptRow | undefined;

    if (!promptRow) {
      throw new Error(`Prompt ${promptId} not found after rollback`);
    }

    // Create a new version with the rolled-back content
    this.createVersion(promptId, {
      promptId,
      content: version.content,
      model: version.model,
      temperature: version.temperature,
      maxTokens: version.maxTokens,
      systemPrompt: version.systemPrompt,
      commitMessage: `Rollback to version ${version.versionNumber}`,
    });

    return mapPrompt(promptRow);
  }
}
