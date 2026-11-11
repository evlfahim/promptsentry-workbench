/**
 * Server-side service that wraps @sentry-prompt/core.
 * Runs in Node (better-sqlite3 cannot run in the browser); the web UI
 * talks to it over HTTP via the routes in ./app.ts.
 */
import crypto from 'node:crypto';
import { DB, OpenAIClient, VersioningEngine, ComparisonEngine } from '@sentry-prompt/core';
import type {
  APIConfig,
  ComparisonResult,
  LexicalDiff,
  Prompt,
  PromptCreate,
  PromptRun,
  PromptUpdate,
  PromptVersion,
  PromptVersionCreate,
} from '@sentry-prompt/core';

// ─── Row mappers ──────────────────────────────────────────────────────────────

function mapPrompt(row: any): Prompt {
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

function mapVersion(row: any): PromptVersion {
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

function mapRun(row: any): PromptRun {
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

/** Error carrying an HTTP status, thrown for client-side mistakes. */
export class ServiceError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Build the user message sent to the model from a prompt template and run input.
 * `{{input}}` in the template is replaced by the input; otherwise the input is
 * appended after a blank line.
 */
export function renderPrompt(template: string, input: string): string {
  if (template.includes('{{input}}')) {
    return template.split('{{input}}').join(input);
  }
  if (!input.trim()) return template;
  if (!template.trim()) return input;
  return `${template}\n\n${input}`;
}

export interface SavePromptResult {
  prompt: Prompt;
  /** The version created by this save, or null if nothing changed. */
  version: PromptVersion | null;
}

export class WorkbenchService {
  private db: DB;
  private versioning: VersioningEngine;
  private comparison: ComparisonEngine;
  private client: OpenAIClient | null = null;
  private config: APIConfig | undefined;

  constructor(dbPath: string) {
    this.db = new DB({ path: dbPath });
    this.versioning = new VersioningEngine(this.db);
    this.comparison = new ComparisonEngine(this.db);
    this.config = this.loadAPIConfig();
    if (this.config?.baseUrl) {
      this.client = new OpenAIClient(this.db, this.config);
    }
  }

  // ─── API config ───────────────────────────────────────────────────────────

  private loadAPIConfig(): APIConfig | undefined {
    const rows = this.db.connection
      .prepare('SELECT key, value FROM api_config')
      .all() as Array<{ key: string; value: string }>;
    if (rows.length === 0) return undefined;
    const config: APIConfig = { baseUrl: '' };
    for (const row of rows) {
      if (row.key === 'baseUrl') config.baseUrl = row.value;
      if (row.key === 'apiKey') config.apiKey = row.value;
      if (row.key === 'defaultModel') config.defaultModel = row.value;
    }
    return config;
  }

  getAPIConfig(): APIConfig | undefined {
    return this.config;
  }

  setAPIConfig(config: APIConfig): APIConfig {
    const baseUrl = (config.baseUrl ?? '').trim().replace(/\/+$/, '');
    if (!baseUrl) throw new ServiceError(400, 'baseUrl is required');
    const next: APIConfig = {
      baseUrl,
      apiKey: config.apiKey?.trim() || undefined,
      defaultModel: config.defaultModel?.trim() || undefined,
    };

    const conn = this.db.connection;
    const upsert = conn.prepare('INSERT OR REPLACE INTO api_config (key, value) VALUES (?, ?)');
    const remove = conn.prepare('DELETE FROM api_config WHERE key = ?');
    conn.transaction(() => {
      upsert.run('baseUrl', next.baseUrl);
      if (next.apiKey) upsert.run('apiKey', next.apiKey);
      else remove.run('apiKey');
      if (next.defaultModel) upsert.run('defaultModel', next.defaultModel);
      else remove.run('defaultModel');
    })();

    this.config = next;
    this.client = new OpenAIClient(this.db, next);
    return next;
  }

  // ─── Prompts ──────────────────────────────────────────────────────────────

  listPrompts(): Prompt[] {
    const rows = this.db.connection
      .prepare('SELECT * FROM prompts ORDER BY created_at DESC')
      .all() as any[];
    return rows.map(mapPrompt);
  }

  getPrompt(id: string): Prompt | undefined {
    const row = this.db.connection.prepare('SELECT * FROM prompts WHERE id = ?').get(id) as any;
    return row ? mapPrompt(row) : undefined;
  }

  /** Create a prompt and its first version (v1). */
  createPrompt(data: PromptCreate & { commitMessage?: string }): SavePromptResult {
    const name = data.name?.trim();
    if (!name) throw new ServiceError(400, 'name is required');
    if (typeof data.content !== 'string') throw new ServiceError(400, 'content is required');

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const prompt: Prompt = {
      id,
      name,
      content: data.content,
      model: data.model?.trim() || this.config?.defaultModel || 'gpt-4',
      temperature: Number.isFinite(data.temperature) ? data.temperature : 0.7,
      maxTokens: Number.isFinite(data.maxTokens) ? data.maxTokens : 1024,
      systemPrompt: data.systemPrompt?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };

    this.db.connection
      .prepare(
        `INSERT INTO prompts (id, name, content, model, temperature, maxTokens, system_prompt, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        prompt.id,
        prompt.name,
        prompt.content,
        prompt.model,
        prompt.temperature,
        prompt.maxTokens,
        prompt.systemPrompt ?? null,
        prompt.createdAt,
        prompt.updatedAt,
      );

    const version = this.commitVersion(prompt, data.commitMessage?.trim() || 'Initial version');
    return { prompt, version };
  }

  /**
   * Update a prompt and commit a new version when content or parameters changed.
   */
  updatePrompt(id: string, data: PromptUpdate & { commitMessage?: string }): SavePromptResult {
    const existing = this.getPrompt(id);
    if (!existing) throw new ServiceError(404, `Prompt ${id} not found`);

    const updated: Prompt = {
      ...existing,
      name: data.name !== undefined ? data.name.trim() || existing.name : existing.name,
      content: data.content ?? existing.content,
      model: data.model !== undefined ? data.model.trim() || existing.model : existing.model,
      temperature:
        data.temperature !== undefined && Number.isFinite(data.temperature)
          ? data.temperature
          : existing.temperature,
      maxTokens:
        data.maxTokens !== undefined && Number.isFinite(data.maxTokens)
          ? data.maxTokens
          : existing.maxTokens,
      systemPrompt:
        data.systemPrompt !== undefined ? data.systemPrompt.trim() || undefined : existing.systemPrompt,
      updatedAt: new Date().toISOString(),
    };

    this.db.connection
      .prepare(
        `UPDATE prompts SET name = ?, content = ?, model = ?, temperature = ?, maxTokens = ?, system_prompt = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        updated.name,
        updated.content,
        updated.model,
        updated.temperature,
        updated.maxTokens,
        updated.systemPrompt ?? null,
        updated.updatedAt,
        id,
      );

    const version = this.commitVersion(updated, data.commitMessage?.trim() || undefined);
    return { prompt: updated, version };
  }

  deletePrompt(id: string): void {
    const conn = this.db.connection;
    conn.transaction(() => {
      conn.prepare('DELETE FROM prompt_runs WHERE prompt_id = ?').run(id);
      conn.prepare('DELETE FROM test_run_results WHERE prompt_id = ?').run(id);
      conn.prepare('DELETE FROM prompt_versions WHERE prompt_id = ?').run(id);
      conn.prepare('DELETE FROM prompts WHERE id = ?').run(id);
    })();
  }

  // ─── Versions ─────────────────────────────────────────────────────────────

  listVersions(promptId?: string): PromptVersion[] {
    const conn = this.db.connection;
    const rows = promptId
      ? (conn
          .prepare('SELECT * FROM prompt_versions WHERE prompt_id = ? ORDER BY version_number DESC')
          .all(promptId) as any[])
      : (conn.prepare('SELECT * FROM prompt_versions ORDER BY created_at DESC').all() as any[]);
    return rows.map(mapVersion);
  }

  getVersion(id: string): PromptVersion | undefined {
    const row = this.db.connection
      .prepare('SELECT * FROM prompt_versions WHERE id = ?')
      .get(id) as any;
    return row ? mapVersion(row) : undefined;
  }

  /**
   * Commit the prompt's current state as a version, if it differs from the latest one.
   * The core engine dedupes on content only, so parameter-only changes
   * (model, temperature, max tokens, system prompt) are committed here directly.
   */
  private commitVersion(prompt: Prompt, commitMessage?: string): PromptVersion | null {
    const snapshot: PromptVersionCreate = {
      promptId: prompt.id,
      content: prompt.content,
      model: prompt.model,
      temperature: prompt.temperature,
      maxTokens: prompt.maxTokens,
      systemPrompt: prompt.systemPrompt,
      commitMessage,
    };

    const created = this.versioning.createVersion(prompt.id, snapshot);
    if (created) return created;

    const latest = this.listVersions(prompt.id)[0];
    if (
      latest &&
      latest.model === snapshot.model &&
      latest.temperature === snapshot.temperature &&
      latest.maxTokens === snapshot.maxTokens &&
      (latest.systemPrompt ?? '') === (snapshot.systemPrompt ?? '')
    ) {
      return null;
    }

    const version: PromptVersion = {
      id: crypto.randomUUID(),
      ...snapshot,
      contentHash: this.versioning.computeHash(snapshot.content),
      versionNumber: (latest?.versionNumber ?? 0) + 1,
      createdAt: new Date().toISOString(),
      commitMessage: commitMessage ?? 'Update parameters',
    };
    this.db.connection
      .prepare(
        `INSERT INTO prompt_versions (id, prompt_id, content, model, temperature, max_tokens, system_prompt, content_hash, version_number, created_at, commit_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        version.id,
        version.promptId,
        version.content,
        version.model,
        version.temperature,
        version.maxTokens,
        version.systemPrompt ?? null,
        version.contentHash,
        version.versionNumber,
        version.createdAt,
        version.commitMessage ?? null,
      );
    return version;
  }

  // ─── Runs ─────────────────────────────────────────────────────────────────

  listRuns(promptId?: string): PromptRun[] {
    const conn = this.db.connection;
    const rows = promptId
      ? (conn
          .prepare('SELECT * FROM prompt_runs WHERE prompt_id = ? ORDER BY created_at DESC')
          .all(promptId) as any[])
      : (conn.prepare('SELECT * FROM prompt_runs ORDER BY created_at DESC').all() as any[]);
    return rows.map(mapRun);
  }

  getRun(id: string): PromptRun | undefined {
    const row = this.db.connection.prepare('SELECT * FROM prompt_runs WHERE id = ?').get(id) as any;
    return row ? mapRun(row) : undefined;
  }

  deleteRun(id: string): void {
    this.db.connection.prepare('DELETE FROM prompt_runs WHERE id = ?').run(id);
  }

  deleteAllRuns(): void {
    this.db.connection.prepare('DELETE FROM prompt_runs').run();
  }

  /**
   * Compare two runs side by side.
   */
  compareRuns(runIdA: string, runIdB: string): ComparisonResult {
    return this.comparison.compareRuns(runIdA, runIdB);
  }

  /**
   * Get a lexical diff between two versions.
   */
  getVersionDiff(versionIdA: string, versionIdB: string): LexicalDiff {
    const versionA = this.getVersion(versionIdA);
    const versionB = this.getVersion(versionIdB);
    if (!versionA || !versionB) {
      throw new ServiceError(404, 'One or both versions not found');
    }
    return this.comparison.computeLexicalDiff(versionA.content, versionB.content);
  }

  /**
   * Execute a prompt version against the configured endpoint and persist the run.
   * Endpoint failures are recorded on the returned run's `error` field.
   */
  async executePrompt(promptId: string, input: string, versionId?: string): Promise<PromptRun> {
    if (!this.client || !this.config) {
      throw new ServiceError(400, 'API not configured. Set a base URL on the API Config page first.');
    }
    const prompt = this.getPrompt(promptId);
    if (!prompt) throw new ServiceError(404, `Prompt ${promptId} not found`);

    const version = versionId ? this.getVersion(versionId) : this.listVersions(promptId)[0];
    if (!version || version.promptId !== promptId) {
      throw new ServiceError(404, versionId ? `Version ${versionId} not found` : 'Prompt has no versions');
    }

    const result = await this.client.execute(
      {
        promptId,
        versionId: version.id,
        input: renderPrompt(version.content, input),
        model: version.model || this.config.defaultModel || 'gpt-4',
        temperature: version.temperature,
        maxTokens: version.maxTokens,
        systemPrompt: version.systemPrompt,
      },
      { saveRun: true },
    );

    // The client does not return the saved row's id, so read back the newest run.
    const row = this.db.connection
      .prepare('SELECT * FROM prompt_runs WHERE version_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .get(version.id) as any;
    if (row) return mapRun(row);

    return {
      ...result.run,
      id: crypto.randomUUID(),
      output: result.output,
      createdAt: new Date().toISOString(),
    };
  }

  close(): void {
    this.db.close();
  }
}
