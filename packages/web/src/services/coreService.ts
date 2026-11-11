/**
 * Service layer that bridges the web UI with @sentry-prompt/core.
 * Provides a unified API for prompts, versions, runs, and execution.
 */
import { DB, OpenAIClient, VersioningEngine, ComparisonEngine } from '@sentry-prompt/core';
import type {
  Prompt,
  PromptCreate,
  PromptUpdate,
  PromptVersion,
  PromptVersionCreate,
  PromptRun,
  PromptRunCreate,
  PromptRunWithExtraParams,
  APIConfig,
  ComparisonResult,
  TestSet,
  TestSetCreate,
  TestRunResult,
  LexicalDiff,
  ExtraParams,
} from '@sentry-prompt/core';

// Helper to map prompt rows from DB
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

// Helper to map version rows from DB
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

// Helper to map run rows from DB
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
    cost: row.cost,
    createdAt: row.created_at,
    error: row.error ?? undefined,
  };
}

export class CoreService {
  private db: DB;
  private versioning: VersioningEngine;
  private comparison: ComparisonEngine;
  private _apiClient: OpenAIClient | null = null;
  private _apiConfig: APIConfig | null = null;

  constructor(dbPath: string) {
    this.db = new DB({ path: dbPath });
    this.versioning = new VersioningEngine(this.db);
    this.comparison = new ComparisonEngine(this.db);
  }

  get apiConfig(): APIConfig | undefined {
    return this._apiConfig ?? undefined;
  }

  async getAPIConfig(): Promise<APIConfig | undefined> {
    const conn = this.db.connection;
    const rows = conn.prepare('SELECT key, value FROM api_config').all() as Array<{ key: string; value: string }>;
    if (rows.length === 0) return undefined;
    const config: APIConfig = { baseUrl: '' };
    for (const row of rows) {
      if (row.key === 'baseUrl') config.baseUrl = row.value;
      if (row.key === 'apiKey') config.apiKey = row.value;
      if (row.key === 'defaultModel') config.defaultModel = row.value;
    }
    return config;
  }

  setAPIConfig(config: APIConfig): void {
    this._apiConfig = config;
    this._apiClient = new OpenAIClient(this.db, config);
  }

  getApiClient(): OpenAIClient {
    if (!this._apiClient || !this._apiConfig) {
      throw new Error('API config not set. Configure API before running prompts.');
    }
    return this._apiClient;
  }

  // ─── Prompts ──────────────────────────────────────────────────────────────

  async listPrompts(): Promise<Prompt[]> {
    const conn = this.db.connection;
    const rows = conn.prepare('SELECT * FROM prompts ORDER BY created_at DESC').all() as any[];
    return rows.map(mapPrompt);
  }

  async getPrompt(id: string): Promise<Prompt | undefined> {
    const conn = this.db.connection;
    const row = conn.prepare('SELECT * FROM prompts WHERE id = ?').get(id) as any;
    return row ? mapPrompt(row) : undefined;
  }

  // ─── Versions ─────────────────────────────────────────────────────────────

  async listVersions(promptId: string): Promise<PromptVersion[]> {
    return this.versioning.listVersions(promptId);
  }

  async getVersion(id: string): Promise<PromptVersion | undefined> {
    return this.versioning.getVersion(id);
  }

  async createVersion(promptId: string, data: PromptVersionCreate): Promise<PromptVersion | undefined> {
    return this.versioning.createVersion(promptId, data);
  }

  async getVersionDiff(versionIdA: string, versionIdB: string): Promise<LexicalDiff> {
    return this.versioning.getVersionDiff(versionIdA, versionIdB);
  }

  async rollbackToVersion(promptId: string, versionId: string): Promise<Prompt> {
    return this.versioning.rollbackToVersion(promptId, versionId);
  }

  // ─── Runs ─────────────────────────────────────────────────────────────────

  async listRuns(promptId?: string): Promise<PromptRun[]> {
    const conn = this.db.connection;
    let rows: any[];
    if (promptId) {
      rows = conn.prepare('SELECT * FROM prompt_runs WHERE prompt_id = ? ORDER BY created_at DESC').all(promptId) as any[];
    } else {
      rows = conn.prepare('SELECT * FROM prompt_runs ORDER BY created_at DESC').all() as any[];
    }
    return rows.map(mapRun);
  }

  async getRun(id: string): Promise<PromptRun | undefined> {
    const conn = this.db.connection;
    const row = conn.prepare('SELECT * FROM prompt_runs WHERE id = ?').get(id) as any;
    return row ? mapRun(row) : undefined;
  }

  async createRun(data: PromptRunCreate): Promise<PromptRun> {
    const conn = this.db.connection;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    conn.prepare(
      'INSERT INTO prompt_runs (id, prompt_id, version_id, input, output, model, temperature, max_tokens, system_prompt, token_count, latency_ms, cost, created_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      id,
      data.promptId,
      data.versionId,
      data.input,
      data.output ?? '',
      data.model,
      data.temperature,
      data.maxTokens,
      data.systemPrompt ?? null,
      0,
      0,
      null,
      now,
      data.error ?? null,
    );
    return {
      ...data,
      id,
      createdAt: now,
      output: data.output ?? '',
      tokenCount: 0,
      latencyMs: 0,
    };
  }

  async compareRuns(runIdA: string, runIdB: string): Promise<ComparisonResult> {
    return this.comparison.compareRuns(runIdA, runIdB);
  }

  // ─── Execution ────────────────────────────────────────────────────────────

  async executePrompt(
    promptId: string,
    versionId: string,
    input: string,
    extraParams?: ExtraParams,
  ): Promise<PromptRun> {
    const client = this.getApiClient();
    const version = await this.getVersion(versionId);
    if (!version) {
      throw new Error(`Version ${versionId} not found`);
    }

    const runData: PromptRunWithExtraParams = {
      promptId,
      versionId,
      input,
      model: version.model,
      temperature: version.temperature,
      maxTokens: version.maxTokens,
      systemPrompt: version.systemPrompt,
      extraParams,
    };

    const result = await client.execute(runData, { saveRun: true });

    const savedRun = this.getRun(result.run.versionId);
    if (savedRun) return savedRun;
    
    // Fallback: construct run from result if not found in DB
    return {
      ...result.run,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
  }

  async *executePromptStream(
    promptId: string,
    versionId: string,
    input: string,
    extraParams?: ExtraParams,
  ): AsyncGenerator<{ chunk: string; cumulative: string; metadata: any }, void, unknown> {
    const client = this.getApiClient();
    const version = await this.getVersion(versionId);
    if (!version) {
      throw new Error(`Version ${versionId} not found`);
    }

    const runData: PromptRunWithExtraParams = {
      promptId,
      versionId,
      input,
      model: version.model,
      temperature: version.temperature,
      maxTokens: version.maxTokens,
      systemPrompt: version.systemPrompt,
      extraParams,
    };

    yield* client.executeStreamAsync(runData, { saveRun: true });
  }

  // ─── Test Sets ────────────────────────────────────────────────────────────

  async listTestSets(): Promise<TestSet[]> {
    const conn = this.db.connection;
    const rows = conn.prepare('SELECT * FROM test_sets ORDER BY created_at DESC').all() as any[];
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      inputs: [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async getTestSet(id: string): Promise<TestSet | undefined> {
    const conn = this.db.connection;
    const row = conn.prepare('SELECT * FROM test_sets WHERE id = ?').get(id) as any;
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      inputs: [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async createTestSet(data: TestSetCreate): Promise<TestSet> {
    const conn = this.db.connection;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    conn.prepare(
      'INSERT INTO test_sets (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(id, data.name, data.description ?? null, now, now);
    return { ...data, id, createdAt: now, updatedAt: now };
  }

  async runTestSet(
    testSetId: string,
    promptId: string,
    versionId: string,
  ): Promise<TestRunResult[]> {
    const conn = this.db.connection;
    // Get test set inputs
    const inputRows = conn.prepare('SELECT input FROM test_set_inputs WHERE test_set_id = ?').all(testSetId) as any[];
    if (inputRows.length === 0) return [];

    const results: TestRunResult[] = [];
    for (const inputRow of inputRows) {
      try {
        const run = await this.executePrompt(promptId, versionId, inputRow.input);
        results.push({
          id: crypto.randomUUID(),
          testSetId,
          promptId,
          versionId,
          input: inputRow.input,
          output: run.output,
          tokenCount: run.tokenCount,
          latencyMs: run.latencyMs,
          cost: run.cost,
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        results.push({
          id: crypto.randomUUID(),
          testSetId,
          promptId,
          versionId,
          input: inputRow.input,
          output: '',
          tokenCount: 0,
          latencyMs: 0,
          error: errorMsg,
          createdAt: new Date().toISOString(),
        });
      }
    }
    return results;
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }
}
