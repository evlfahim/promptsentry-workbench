import * as vscode from 'vscode';
import crypto from 'node:crypto';
import {
  DB,
  VersioningEngine,
  OpenAIClient,
  ComparisonEngine,
  type Prompt,
  type PromptVersion,
  type PromptRun,
  type APIConfig,
  type PromptCreate,
  type PromptUpdate,
  type PromptVersionCreate,
  type PromptRunCreate,
  type ComparisonResult,
  type LexicalDiff,
} from '@sentry-prompt/core';

// ─── State ────────────────────────────────────────────────────────────────────

let db: DB | undefined;
let versioningEngine: VersioningEngine | undefined;
let openAIClient: OpenAIClient | undefined;
let comparisonEngine: ComparisonEngine | undefined;
let treeView: vscode.TreeView<PromptTreeNode> | undefined;
let treeDataProvider: PromptSentryTreeDataProvider | undefined;
let webviewPanel: vscode.WebviewPanel | undefined;
let apiConfig: APIConfig | undefined;

// ─── Tree View Types ─────────────────────────────────────────────────────────

export enum TreeNodeType {
  Prompt = 'prompt',
  Version = 'version',
  Run = 'run',
}

export interface PromptTreeNode {
  type: TreeNodeType;
  id: string;
  label: string;
  prompt?: Prompt;
  version?: PromptVersion;
  run?: PromptRun;
  collapsibleState: vscode.TreeItemCollapsibleState;
  iconPath?: vscode.ThemeIcon;
}

// ─── Tree Data Provider ──────────────────────────────────────────────────────

class PromptSentryTreeDataProvider implements vscode.TreeDataProvider<PromptTreeNode> {
  private _onDidChangeTreeData: vscode.EventEmitter<PromptTreeNode | undefined | null | void> =
    new vscode.EventEmitter<PromptTreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: PromptTreeNode): vscode.TreeItem {
    const treeItem: vscode.TreeItem = {
      label: element.label,
      collapsibleState: element.collapsibleState,
      iconPath: element.iconPath,
    };

    if (element.type === TreeNodeType.Prompt) {
      treeItem.command = {
        command: 'promptsentry.openPanel',
        title: 'Open PromptSentry Workbench',
        arguments: [{ promptId: element.id }],
      };
    }

    return treeItem;
  }

  async getChildren(element?: PromptTreeNode): Promise<PromptTreeNode[]> {
    if (!db || !versioningEngine) {
      return [];
    }

    if (!element) {
      // Root level: list all prompts using core's DB method
      const prompts = await this.listPrompts();
      return prompts.map((p) => ({
        type: TreeNodeType.Prompt,
        id: p.id,
        label: p.name,
        prompt: p,
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        iconPath: new vscode.ThemeIcon('symbol-class'),
      }));
    }

    if (element.type === TreeNodeType.Prompt) {
      // Prompt level: list versions using core's VersioningEngine
      const versions = versioningEngine.listVersions(element.id);
      if (versions.length === 0) {
        return [
          {
            type: TreeNodeType.Prompt,
            id: 'no-versions',
            label: 'No versions yet',
            collapsibleState: vscode.TreeItemCollapsibleState.None,
            iconPath: new vscode.ThemeIcon('info'),
          },
        ];
      }
      return versions.map((v) => ({
        type: TreeNodeType.Version,
        id: v.id,
        label: `v${v.versionNumber} - ${v.content.substring(0, 50)}...`,
        version: v,
        collapsibleState: vscode.TreeItemCollapsibleState.None,
        iconPath: new vscode.ThemeIcon('history'),
      }));
    }

    return [];
  }

  private async listPrompts(): Promise<Prompt[]> {
    // Use the core DB's connection to list prompts
    const conn = db!.connection;
    const rows = conn.prepare('SELECT * FROM prompts ORDER BY updated_at DESC').all() as any[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      content: row.content,
      model: row.model,
      temperature: row.temperature,
      maxTokens: row.maxTokens,
      systemPrompt: row.system_prompt ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }
}

// ─── Webview Panel ───────────────────────────────────────────────────────────

async function createWebviewPanel(context: vscode.ExtensionContext, promptId?: string): Promise<vscode.WebviewPanel> {
  const panel = vscode.window.createWebviewPanel(
    'promptsentry.workbench',
    'PromptSentry Workbench',
    vscode.ViewColumn.Two,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    },
  );

  panel.webview.html = await getWebviewContent(panel.webview, context);

  // ── Message bridge: webview ↔ extension core ──────────────────────────────
  // The React UI talks to /api/* endpoints via a fetch() interceptor that
  // routes through postMessage.  The extension intercepts those api-request
  // messages, executes the core logic, and sends back api-response messages.

  panel.webview.onDidReceiveMessage(
    async (message: any) => {
      // ── API request bridge ────────────────────────────────────────────────
      if (message.type === 'api-request') {
        const { id, method, path, body } = message;
        try {
          const result = await handleApiRequest(method, path, body);
          panel.webview.postMessage({ type: 'api-response', id, status: 200, body: result });
        } catch (error) {
          const status = (error as any)?.status ?? 500;
          const errorMessage = error instanceof Error ? error.message : 'Internal error';
          panel.webview.postMessage({
            type: 'api-response',
            id,
            status,
            body: { error: errorMessage },
          });
        }
        return;
      }

      // ── Pass-through for other message types (e.g. from webview bridge) ──
      switch (message.type) {
        case 'ready':
          // Webview is ready; send initial API config
          panel.webview.postMessage({ type: 'apiConfig', data: apiConfig });
          break;

        case 'openApiConfig':
          vscode.commands.executeCommand('promptsentry.openApiConfig');
          break;

        case 'newPrompt':
          vscode.commands.executeCommand('promptsentry.newPrompt');
          break;

        case 'refresh':
          treeDataProvider?.refresh();
          panel.webview.postMessage({ type: 'refreshed' });
          break;

        default:
          // Unknown message type — ignore silently
          break;
      }
    },
    undefined,
    context.subscriptions,
  );

  panel.onDidDispose(
    () => {
      webviewPanel = undefined;
    },
    null,
    context.subscriptions,
  );

  return panel;
}

/**
 * Route an API request to the appropriate handler using the core DB.
 * Mirrors the routes defined in packages/web/server/app.ts.
 */
async function handleApiRequest(method: string, path: string, body: any): Promise<any> {
  if (!db) {
    throw { status: 500, message: 'Database not initialized' };
  }
  const conn = db.connection;

  // ── Health ──────────────────────────────────────────────────────────────
  if (method === 'GET' && path === '/api/health') {
    return { status: 'ok' };
  }

  // ── Config ──────────────────────────────────────────────────────────────
  if (method === 'GET' && path === '/api/config') {
    return apiConfig ?? null;
  }
  if (method === 'PUT' && path === '/api/config') {
    const config = body ?? {};
    const baseUrl = (config.baseUrl ?? '').trim().replace(/\/+$/, '');
    if (!baseUrl) throw { status: 400, message: 'baseUrl is required' };
    const next: APIConfig = {
      baseUrl,
      apiKey: config.apiKey?.trim() || undefined,
      defaultModel: config.defaultModel?.trim() || undefined,
    };
    const upsert = conn.prepare('INSERT OR REPLACE INTO api_config (key, value) VALUES (?, ?)');
    const remove = conn.prepare('DELETE FROM api_config WHERE key = ?');
    conn.transaction(() => {
      upsert.run('baseUrl', next.baseUrl);
      if (next.apiKey) upsert.run('apiKey', next.apiKey);
      else remove.run('apiKey');
      if (next.defaultModel) upsert.run('defaultModel', next.defaultModel);
      else remove.run('defaultModel');
    })();
    if (openAIClient && db) {
      openAIClient = new OpenAIClient(db, next);
    }
    apiConfig = next;
    return next;
  }

  // ── Prompts ─────────────────────────────────────────────────────────────
  if (method === 'GET' && path === '/api/prompts') {
    const rows = conn.prepare('SELECT * FROM prompts ORDER BY created_at DESC').all() as any[];
    return rows.map(mapPromptRow);
  }
  if (method === 'POST' && path === '/api/prompts') {
    return createPrompt(body ?? {});
  }
  if (method === 'GET' && /^\/api\/prompts\/[^/]+$/.test(path)) {
    const id = decodeURIComponent(path.split('/').pop()!);
    const row = conn.prepare('SELECT * FROM prompts WHERE id = ?').get(id) as any;
    if (!row) throw { status: 404, message: `Prompt ${id} not found` };
    return mapPromptRow(row);
  }
  if (method === 'PUT' && /^\/api\/prompts\/[^/]+$/.test(path)) {
    const id = decodeURIComponent(path.split('/').pop()!);
    return updatePrompt(id, body ?? {});
  }
  if (method === 'DELETE' && /^\/api\/prompts\/[^/]+$/.test(path)) {
    const id = decodeURIComponent(path.split('/').pop()!);
    deletePrompt(id);
    return undefined;
  }

  // ── Versions ────────────────────────────────────────────────────────────
  if (method === 'GET' && /^\/api\/prompts\/[^/]+\/versions$/.test(path)) {
    const promptId = decodeURIComponent(path.split('/')[3]);
    if (!versioningEngine) throw { status: 500, message: 'Versioning engine not initialized' };
    return versioningEngine.listVersions(promptId);
  }
  if (method === 'GET' && path === '/api/versions') {
    // List all versions across all prompts
    if (!versioningEngine) throw { status: 500, message: 'Versioning engine not initialized' };
    // We need to list all prompts first, then get versions for each
    const promptRows = conn.prepare('SELECT id FROM prompts').all() as { id: string }[];
    const allVersions: any[] = [];
    for (const pr of promptRows) {
      allVersions.push(...versioningEngine.listVersions(pr.id));
    }
    return allVersions;
  }
  if (method === 'POST' && path === '/api/versions/compare') {
    if (!versioningEngine) throw { status: 500, message: 'Versioning engine not initialized' };
    const rowA = conn.prepare('SELECT content FROM prompt_versions WHERE id = ?').get(body?.versionIdA) as { content: string } | undefined;
    const rowB = conn.prepare('SELECT content FROM prompt_versions WHERE id = ?').get(body?.versionIdB) as { content: string } | undefined;
    const contentA = rowA?.content;
    const contentB = rowB?.content;
    if (!contentA || !contentB) throw { status: 404, message: 'One or both versions not found' };
    return comparisonEngine!.computeLexicalDiff(contentA, contentB);
  }

  // ── Runs ────────────────────────────────────────────────────────────────
  if (method === 'POST' && /^\/api\/prompts\/[^/]+\/run$/.test(path)) {
    const promptId = decodeURIComponent(path.split('/')[3]);
    const input = typeof body?.input === 'string' ? body.input : '';
    const versionId = typeof body?.versionId === 'string' && body.versionId ? body.versionId : undefined;
    return executePrompt(promptId, input, versionId);
  }
  if (method === 'GET' && path === '/api/runs') {
    const promptId = new URLSearchParams(path.split('?')[1] ?? '').get('promptId');
    const rows = promptId
      ? conn.prepare('SELECT * FROM prompt_runs WHERE prompt_id = ? ORDER BY created_at DESC').all(promptId) as any[]
      : conn.prepare('SELECT * FROM prompt_runs ORDER BY created_at DESC').all() as any[];
    return rows.map(mapRunRow);
  }
  if (method === 'DELETE' && path === '/api/runs') {
    conn.prepare('DELETE FROM prompt_runs').run();
    return undefined;
  }
  if (method === 'GET' && /^\/api\/runs\/[^/]+$/.test(path)) {
    const id = decodeURIComponent(path.split('/').pop()!);
    const row = conn.prepare('SELECT * FROM prompt_runs WHERE id = ?').get(id) as any;
    if (!row) throw { status: 404, message: `Run ${id} not found` };
    return mapRunRow(row);
  }
  if (method === 'DELETE' && /^\/api\/runs\/[^/]+$/.test(path)) {
    const id = decodeURIComponent(path.split('/').pop()!);
    conn.prepare('DELETE FROM prompt_runs WHERE id = ?').run(id);
    return undefined;
  }
  if (method === 'POST' && path === '/api/runs/compare') {
    if (!comparisonEngine) throw { status: 500, message: 'Comparison engine not initialized' };
    return comparisonEngine.compareRuns(body?.runIdA, body?.runIdB);
  }

  // ── Test Sets ───────────────────────────────────────────────────────────
  if (method === 'GET' && path === '/api/test-sets') {
    const rows = conn.prepare('SELECT * FROM test_sets ORDER BY created_at DESC').all() as any[];
    return rows.map(mapTestSetRow);
  }
  if (method === 'POST' && path === '/api/test-sets') {
    return createTestSet(body ?? {});
  }
  if (method === 'GET' && /^\/api\/test-sets\/[^/]+$/.test(path)) {
    const id = decodeURIComponent(path.split('/').pop()!);
    const row = conn.prepare('SELECT * FROM test_sets WHERE id = ?').get(id) as any;
    if (!row) throw { status: 404, message: `Test set ${id} not found` };
    return mapTestSetRow(row);
  }
  if (method === 'PUT' && /^\/api\/test-sets\/[^/]+$/.test(path)) {
    const id = decodeURIComponent(path.split('/').pop()!);
    return updateTestSet(id, body ?? {});
  }
  if (method === 'DELETE' && /^\/api\/test-sets\/[^/]+$/.test(path)) {
    const id = decodeURIComponent(path.split('/').pop()!);
    conn.transaction(() => {
      conn.prepare('DELETE FROM test_run_results WHERE test_set_id = ?').run(id);
      conn.prepare('DELETE FROM test_set_inputs WHERE test_set_id = ?').run(id);
      conn.prepare('DELETE FROM test_sets WHERE id = ?').run(id);
    })();
    return undefined;
  }
  if (method === 'POST' && /^\/api\/test-sets\/[^/]+\/run$/.test(path)) {
    const testSetId = decodeURIComponent(path.split('/')[3]);
    return runTestSet(testSetId, body?.promptId, body?.versionId);
  }
  if (method === 'GET' && /^\/api\/test-sets\/[^/]+\/results$/.test(path)) {
    const testSetId = decodeURIComponent(path.split('/')[3]);
    const rows = conn
      .prepare('SELECT * FROM test_run_results WHERE test_set_id = ? ORDER BY created_at ASC')
      .all(testSetId) as any[];
    return rows.map(mapTestRunResultRow);
  }
  if (method === 'DELETE' && /^\/api\/test-sets\/[^/]+\/results$/.test(path)) {
    const testSetId = decodeURIComponent(path.split('/')[3]);
    conn.prepare('DELETE FROM test_run_results WHERE test_set_id = ?').run(testSetId);
    return undefined;
  }

  throw { status: 404, message: `Not found: ${method} ${path}` };
}

// ── Row mappers (mirroring server/service.ts) ────────────────────────────────

function mapPromptRow(row: any): any {
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

function mapVersionRow(row: any): any {
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

function mapRunRow(row: any): any {
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

function mapTestSetRow(row: any): any {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    inputs: [], // will be populated separately
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTestRunResultRow(row: any): any {
  return {
    id: row.id,
    testSetId: row.test_set_id,
    promptId: row.prompt_id,
    versionId: row.version_id,
    input: row.input,
    output: row.output,
    tokenCount: row.token_count,
    latencyMs: row.latency_ms,
    cost: row.cost ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at,
  };
}

/**
 * Build the HTML for the webview, loading the React app from the built dist
 * or from the source files in development mode.
 */
async function getWebviewContent(webview: vscode.Webview, context: vscode.ExtensionContext): Promise<string> {
  // Read the webview HTML template
  const htmlPath = vscode.Uri.joinPath(context.extensionUri, 'src', 'webview.html');
  let html = await readWebviewHtml(htmlPath);

  // Replace CSP placeholder
  html = html.replace(/{{cspSource}}/g, webview.cspSource);

  // Replace script sources with webview URIs
  const bridgeUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview-bridge.js'));
  const appUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview-app.js'));

  html = html.replace('/webview-bridge.ts', bridgeUri.toString());
  html = html.replace('/webview-app.tsx', appUri.toString());

  return html;
}

async function readWebviewHtml(uri: vscode.Uri): Promise<string> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString('utf-8');
  } catch {
    // Fallback: return a minimal HTML if the file can't be read
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PromptSentry Workbench</title>
</head>
<body>
  <div id="root">
    <div style="padding:20px;text-align:center;color:#e0e0e0;">
      <h1>🚀 PromptSentry Workbench</h1>
      <p>Loading...</p>
    </div>
  </div>
</body>
</html>`;
  }
}

// ─── Core API Wrappers ───────────────────────────────────────────────────────

/**
 * Create a new prompt using the core DB directly.
 * This mirrors the WorkbenchService.createPrompt logic from the web server.
 */
async function createPrompt(data: PromptCreate): Promise<Prompt> {
  if (!db) {
    throw new Error('Database not initialized');
  }
  const conn = db.connection;
  const id = require('node:crypto').randomUUID();
  const now = new Date().toISOString();

  conn
    .prepare(
      `INSERT INTO prompts (id, name, content, model, temperature, maxTokens, system_prompt, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      data.name,
      data.content,
      data.model,
      data.temperature,
      data.maxTokens,
      data.systemPrompt ?? null,
      now,
      now,
    );

  // Create initial version using core's VersioningEngine
  if (versioningEngine) {
    versioningEngine.createVersion(id, {
      promptId: id,
      content: data.content,
      model: data.model,
      temperature: data.temperature,
      maxTokens: data.maxTokens,
      systemPrompt: data.systemPrompt,
      commitMessage: 'Initial version',
    });
  }

  return {
    id,
    name: data.name,
    content: data.content,
    model: data.model,
    temperature: data.temperature,
    maxTokens: data.maxTokens,
    systemPrompt: data.systemPrompt,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Update a prompt using the core DB directly.
 */
async function updatePrompt(id: string, data: PromptUpdate): Promise<Prompt> {
  if (!db) {
    throw new Error('Database not initialized');
  }
  const conn = db.connection;
  const now = new Date().toISOString();

  const updates: string[] = [];
  const values: any[] = [];

  if (data.name !== undefined) {
    updates.push('name = ?');
    values.push(data.name);
  }
  if (data.content !== undefined) {
    updates.push('content = ?');
    values.push(data.content);
  }
  if (data.model !== undefined) {
    updates.push('model = ?');
    values.push(data.model);
  }
  if (data.temperature !== undefined) {
    updates.push('temperature = ?');
    values.push(data.temperature);
  }
  if (data.maxTokens !== undefined) {
    updates.push('maxTokens = ?');
    values.push(data.maxTokens);
  }
  if (data.systemPrompt !== undefined) {
    updates.push('system_prompt = ?');
    values.push(data.systemPrompt ?? null);
  }

  if (updates.length === 0) {
    throw new Error('No fields to update');
  }

  updates.push('updated_at = ?');
  values.push(now);
  values.push(id);

  conn.prepare(`UPDATE prompts SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  // Create a new version if content changed, using core's VersioningEngine
  if (versioningEngine && data.content !== undefined) {
    versioningEngine.createVersion(id, {
      promptId: id,
      content: data.content,
      model: data.model || '',
      temperature: data.temperature ?? 0,
      maxTokens: data.maxTokens ?? 0,
      systemPrompt: data.systemPrompt,
      commitMessage: data.name !== undefined ? `Rename to ${data.name}` : 'Update content',
    });
  }

  const row = conn
    .prepare('SELECT * FROM prompts WHERE id = ?')
    .get(id) as any;

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

/**
 * Delete a prompt and all its associated data using the core DB.
 */
async function deletePrompt(id: string): Promise<void> {
  if (!db) {
    throw new Error('Database not initialized');
  }
  const conn = db.connection;
  conn.transaction(() => {
    conn.prepare('DELETE FROM prompt_runs WHERE prompt_id = ?').run(id);
    conn.prepare('DELETE FROM test_run_results WHERE prompt_id = ?').run(id);
    conn.prepare('DELETE FROM prompt_versions WHERE prompt_id = ?').run(id);
    conn.prepare('DELETE FROM prompts WHERE id = ?').run(id);
  })();
}

/**
 * Run a prompt against the configured OpenAI-compatible endpoint.
 * Uses the core's OpenAIClient for execution.
 */
async function runPrompt(data: PromptRunCreate): Promise<any> {
  if (!openAIClient) {
    throw new Error('OpenAI client not initialized');
  }

  const result = await openAIClient.execute(
    {
      ...data,
      extraParams: undefined,
    },
    { saveRun: true },
  );

  return {
    run: result.run,
    output: result.output,
    metadata: result.metadata,
  };
}

/**
 * Compare two runs using the core's ComparisonEngine.
 */
async function compareRuns(runIdA: string, runIdB: string): Promise<ComparisonResult> {
  if (!comparisonEngine) {
    throw new Error('Comparison engine not initialized');
  }
  return comparisonEngine.compareRuns(runIdA, runIdB);
}

/**
 * Get API config from the core DB.
 */
async function getAPIConfig(): Promise<APIConfig | undefined> {
  if (!db) {
    return undefined;
  }
  const conn = db.connection;

  const baseUrl = conn.prepare("SELECT value FROM api_config WHERE key = 'baseUrl'").get() as
    | { value: string }
    | undefined;
  const apiKey = conn.prepare("SELECT value FROM api_config WHERE key = 'apiKey'").get() as
    | { value: string }
    | undefined;
  const defaultModel = conn.prepare("SELECT value FROM api_config WHERE key = 'defaultModel'").get() as
    | { value: string }
    | undefined;

  if (!baseUrl) {
    return undefined;
  }

  return {
    baseUrl: baseUrl.value,
    apiKey: apiKey?.value,
    defaultModel: defaultModel?.value,
  };
}

/**
 * Save API config to the core DB and update the OpenAI client.
 */
async function saveAPIConfig(config: APIConfig): Promise<void> {
  if (!db) {
    throw new Error('Database not initialized');
  }
  const conn = db.connection;

  conn
    .prepare("INSERT OR REPLACE INTO api_config (key, value) VALUES ('baseUrl', ?)")
    .run(config.baseUrl);

  if (config.apiKey !== undefined) {
    conn
      .prepare("INSERT OR REPLACE INTO api_config (key, value) VALUES ('apiKey', ?)")
      .run(config.apiKey);
  }

  if (config.defaultModel !== undefined) {
    conn
      .prepare("INSERT OR REPLACE INTO api_config (key, value) VALUES ('defaultModel', ?)")
      .run(config.defaultModel);
  }

  // Update the OpenAI client with new config
  if (openAIClient && db) {
    openAIClient = new OpenAIClient(db, config);
  }

  // Update the module-level apiConfig
  apiConfig = config;
}

/**
 * Create a version for a prompt using the core's VersioningEngine.
 * This is a convenience wrapper used by the runPrompt command.
 */
async function createVersion(promptId: string, data: PromptVersionCreate): Promise<PromptVersion | undefined> {
  if (!versioningEngine) {
    throw new Error('Versioning engine not initialized');
  }
  return versioningEngine.createVersion(promptId, data);
}

/**
 * Execute a prompt version against the configured endpoint and persist the run.
 * This is the version used by the webview API bridge.
 */
async function executePrompt(promptId: string, input: string, versionId?: string): Promise<any> {
  if (!openAIClient) {
    throw { status: 400, message: 'OpenAI client not initialized' };
  }
  if (!db) {
    throw { status: 500, message: 'Database not initialized' };
  }

  const prompt = mapPromptRow(db.connection.prepare('SELECT * FROM prompts WHERE id = ?').get(promptId));
  if (!prompt) {
    throw { status: 404, message: `Prompt ${promptId} not found` };
  }

  const version = versionId
    ? mapVersionRow(db.connection.prepare('SELECT * FROM prompt_versions WHERE id = ?').get(versionId))
    : mapVersionRow(db.connection.prepare('SELECT * FROM prompt_versions WHERE prompt_id = ? ORDER BY version_number DESC LIMIT 1').get(promptId));

  if (!version) {
    throw { status: 404, message: versionId ? `Version ${versionId} not found` : 'Prompt has no versions' };
  }

  const result = await openAIClient.execute(
    {
      promptId,
      versionId: version.id,
      input,
      model: version.model || apiConfig?.defaultModel || 'gpt-4',
      temperature: version.temperature,
      maxTokens: version.maxTokens,
      systemPrompt: version.systemPrompt,
    },
    { saveRun: true },
  );

  // Read back the newest run for this version
  const row = db.connection
    .prepare('SELECT * FROM prompt_runs WHERE version_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
    .get(version.id) as any;
  if (row) return mapRunRow(row);

  return {
    ...result.run,
    id: require('node:crypto').randomUUID(),
    output: result.output,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Create a test set with inputs.
 */
function createTestSet(data: any): any {
  if (!db) {
    throw { status: 500, message: 'Database not initialized' };
  }
  const name = data?.name?.trim();
  if (!name) throw { status: 400, message: 'name is required' };

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const inputs = data?.inputs || [];
  const conn = db.connection;

  conn.transaction(() => {
    conn.prepare(
      `INSERT INTO test_sets (id, name, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(id, name, data?.description?.trim() ?? null, now, now);

    const insertInput = conn.prepare(
      `INSERT INTO test_set_inputs (id, test_set_id, input) VALUES (?, ?, ?)`,
    );
    for (const input of inputs) {
      insertInput.run(crypto.randomUUID(), id, input);
    }
  })();

  const row = conn.prepare('SELECT * FROM test_sets WHERE id = ?').get(id) as any;
  const testSet = mapTestSetRow(row);

  // Populate inputs
  const inputRows = conn.prepare('SELECT input FROM test_set_inputs WHERE test_set_id = ?').all(id) as { input: string }[];
  testSet.inputs = inputRows.map(r => r.input);

  return testSet;
}

/**
 * Update a test set.
 */
function updateTestSet(id: string, data: any): any {
  if (!db) {
    throw { status: 500, message: 'Database not initialized' };
  }
  const conn = db.connection;
  const existing = conn.prepare('SELECT * FROM test_sets WHERE id = ?').get(id) as any;
  if (!existing) throw { status: 404, message: `Test set ${id} not found` };

  const name = data?.name !== undefined ? data.name.trim() || existing.name : existing.name;
  const description = data?.description !== undefined ? data.description.trim() || undefined : existing.description;
  const now = new Date().toISOString();

  conn.transaction(() => {
    conn.prepare(
      `UPDATE test_sets SET name = ?, description = ?, updated_at = ? WHERE id = ?`,
    ).run(name, description ?? null, now, id);

    // Replace all inputs
    conn.prepare('DELETE FROM test_set_inputs WHERE test_set_id = ?').run(id);
    const insertInput = conn.prepare(
      `INSERT INTO test_set_inputs (id, test_set_id, input) VALUES (?, ?, ?)`,
    );
    if (data?.inputs) {
      for (const input of data.inputs) {
        insertInput.run(crypto.randomUUID(), id, input);
      }
    }
  })();

  const row = conn.prepare('SELECT * FROM test_sets WHERE id = ?').get(id) as any;
  const testSet = mapTestSetRow(row);

  // Populate inputs
  const inputRows = conn.prepare('SELECT input FROM test_set_inputs WHERE test_set_id = ?').all(id) as { input: string }[];
  testSet.inputs = inputRows.map(r => r.input);

  return testSet;
}

/**
 * Run a test set: iterate over all inputs, execute the prompt/version for each,
 * and persist results.
 */
async function runTestSet(testSetId: string, promptId: string, versionId: string): Promise<any[]> {
  if (!db) {
    throw { status: 500, message: 'Database not initialized' };
  }
  if (!openAIClient) {
    throw { status: 400, message: 'OpenAI client not initialized' };
  }
  if (!apiConfig) {
    throw { status: 400, message: 'API not configured' };
  }

  const conn = db.connection;

  // Get test set
  const testSetRow = conn.prepare('SELECT * FROM test_sets WHERE id = ?').get(testSetId) as any;
  if (!testSetRow) throw { status: 404, message: 'Test set not found' };

  // Get inputs
  const inputRows = conn.prepare('SELECT input FROM test_set_inputs WHERE test_set_id = ?').all(testSetId) as { input: string }[];

  // Get prompt metadata
  const promptRow = conn.prepare('SELECT model, temperature, maxTokens, system_prompt FROM prompts WHERE id = ?').get(promptId) as any;
  if (!promptRow) throw { status: 404, message: 'Prompt not found' };

  // Get version metadata
  const versionRow = conn.prepare('SELECT model, temperature, maxTokens, system_prompt FROM prompt_versions WHERE id = ?').get(versionId) as any;
  if (!versionRow) throw { status: 404, message: 'Version not found' };

  const results: any[] = [];

  for (const inputRow of inputRows) {
    const startTime = Date.now();
    const resultId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    try {
      const model = versionRow.model || promptRow.model;
      const temperature = versionRow.temperature ?? promptRow.temperature;
      const maxTokens = versionRow.maxTokens ?? promptRow.maxTokens;
      const systemPrompt = versionRow.system_prompt ?? promptRow.system_prompt;

      const messages: Array<{ role: string; content: string }> = [];
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      messages.push({ role: 'user', content: inputRow.input });

      const response = await fetch(`${apiConfig.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiConfig.apiKey ? { Authorization: `Bearer ${apiConfig.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
          stream: false,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error ${response.status}: ${errorText}`);
      }

      const apiResponse = await response.json() as {
        choices: Array<{ message: { content: string } }>;
        usage?: { completion_tokens?: number };
      };

      const output = apiResponse.choices[0]?.message?.content ?? '';
      const latencyMs = Date.now() - startTime;
      const tokenCount = apiResponse.usage?.completion_tokens ?? Math.ceil(output.length / 4);

      // Save result
      conn.prepare(
        `INSERT INTO test_run_results (id, test_set_id, prompt_id, version_id, input, output, token_count, latency_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(resultId, testSetId, promptId, versionId, inputRow.input, output, tokenCount, latencyMs, createdAt);

      results.push({
        id: resultId,
        testSetId,
        promptId,
        versionId,
        input: inputRow.input,
        output,
        tokenCount,
        latencyMs,
        createdAt,
      });
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const resultId = crypto.randomUUID();
      const createdAt = new Date().toISOString();

      conn.prepare(
        `INSERT INTO test_run_results (id, test_set_id, prompt_id, version_id, input, output, token_count, latency_ms, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(resultId, testSetId, promptId, versionId, inputRow.input, '', 0, latencyMs, errorMessage, createdAt);

      results.push({
        id: resultId,
        testSetId,
        promptId,
        versionId,
        input: inputRow.input,
        output: '',
        tokenCount: 0,
        latencyMs,
        error: errorMessage,
        createdAt,
      });
    }
  }

  return results;
}

// ─── Activation ──────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  const dbPath = context.globalStorageUri.fsPath;
  const dbFile = `${dbPath}/promptsentry.db`;

  try {
    // ── Initialize core components ──────────────────────────────────────────
    // DB: the core database layer wrapping better-sqlite3
    db = new DB({ path: dbFile });

    // VersioningEngine: handles git-style versioning (create, diff, rollback)
    versioningEngine = new VersioningEngine(db);

    // ComparisonEngine: handles run comparison (lexical/semantic similarity)
    comparisonEngine = new ComparisonEngine(db);

    // ── Load API config from VS Code settings ───────────────────────────────
    const vscodeConfig = vscode.workspace.getConfiguration('promptsentry');
    apiConfig = {
      baseUrl: vscodeConfig.get('apiBaseUrl', 'http://localhost:11434/v1'),
      apiKey: vscodeConfig.get('apiKey', ''),
      defaultModel: vscodeConfig.get('defaultModel', 'llama3'),
    };

    // OpenAIClient: executes prompts against OpenAI-compatible endpoints
    openAIClient = new OpenAIClient(db, apiConfig);

    // ── Register tree view ──────────────────────────────────────────────────
    const treeDataProvider = new PromptSentryTreeDataProvider();
    treeView = vscode.window.createTreeView('promptsentryView', {
      treeDataProvider,
    });
    context.subscriptions.push(treeView);

    // ── Register commands ───────────────────────────────────────────────────
    const commands = [
      // Refresh: refreshes the tree view
      vscode.commands.registerCommand('promptsentry.refresh', () => {
        treeDataProvider?.refresh();
        vscode.window.showInformationMessage('PromptSentry: Refreshed');
      }),

      // New Prompt: creates a new prompt via input boxes
      vscode.commands.registerCommand('promptsentry.newPrompt', async () => {
        const name = await vscode.window.showInputBox({
          prompt: 'Enter prompt name',
          placeHolder: 'My Prompt',
          validateInput: (value) => (value ? '' : 'Prompt name is required'),
        });

        if (!name) {
          return;
        }

        const content = await vscode.window.showInputBox({
          prompt: 'Enter prompt content',
          placeHolder: 'Your prompt text here...',
          value: 'Explain quantum computing in simple terms:',
          validateInput: (value) => (value ? '' : 'Prompt content is required'),
        });

        if (!content) {
          return;
        }

        const model = await vscode.window.showInputBox({
          prompt: 'Enter model name',
          placeHolder: apiConfig?.defaultModel || 'llama3',
          value: apiConfig?.defaultModel,
        });

        const prompt = await createPrompt({
          name,
          content,
          model: model || apiConfig?.defaultModel || 'llama3',
          temperature: 0.7,
          maxTokens: 1024,
        });

        vscode.window.showInformationMessage(`PromptSentry: Created prompt "${prompt.name}"`);
        treeDataProvider?.refresh();
      }),

      // Run Prompt: runs a prompt against the API with status bar feedback
      vscode.commands.registerCommand('promptsentry.runPrompt', async () => {
        if (!db || !openAIClient) {
          vscode.window.showErrorMessage('PromptSentry: Not initialized');
          return;
        }

        // Get prompts from DB
        const conn = db.connection;
        const rows = conn.prepare('SELECT id, name FROM prompts ORDER BY name').all() as any[];

        if (rows.length === 0) {
          vscode.window.showErrorMessage('PromptSentry: No prompts found. Create one first.');
          return;
        }

        // Show quick pick for prompt selection
        const promptItems = rows.map((row) => ({
          label: row.name,
          description: `ID: ${row.id}`,
          id: row.id,
        }));

        const selected = await vscode.window.showQuickPick(promptItems, {
          placeHolder: 'Select a prompt to run',
        });

        if (!selected) {
          return;
        }

        // Get input
        const input = await vscode.window.showInputBox({
          prompt: 'Enter input for the prompt',
          placeHolder: 'Your input text...',
          value: '',
        });

        if (!input) {
          return;
        }

        // Get version using core's VersioningEngine
        const versions = versioningEngine!.listVersions(selected.id);

        let versionId: string;
        if (versions.length === 0) {
          // Create a version from the current prompt
          const currentPrompt = rows.find((r: any) => r.id === selected.id);
          const version = await createVersion(selected.id, {
            promptId: selected.id,
            content: currentPrompt!.content,
            model: currentPrompt!.model,
            temperature: currentPrompt!.temperature,
            maxTokens: currentPrompt!.maxTokens,
            systemPrompt: currentPrompt!.system_prompt ?? undefined,
          });
          if (!version) {
            vscode.window.showErrorMessage('PromptSentry: Failed to create initial version');
            return;
          }
          versionId = version.id;
        } else {
          // Show quick pick for version
          const versionItems = versions.map((v) => ({
            label: `v${v.versionNumber}`,
            description: v.content.substring(0, 50) + '...',
            id: v.id,
          }));

          const selectedVersion = await vscode.window.showQuickPick(versionItems, {
            placeHolder: 'Select a version',
          });

          if (!selectedVersion) {
            return;
          }
          versionId = selectedVersion.id;
        }

        // Show status bar
        const statusBar = vscode.window.createStatusBarItem(
          vscode.StatusBarAlignment.Right,
          100,
        );
        statusBar.text = '$(loading~spin) PromptSentry: Running prompt...';
        statusBar.show();

        try {
          const result = await runPrompt({
            promptId: selected.id,
            versionId,
            input,
            model: apiConfig?.defaultModel || 'llama3',
            temperature: 0.7,
            maxTokens: 1024,
          });

          statusBar.text = `$(check) PromptSentry: Run complete (${result.run.latencyMs}ms)`;
          setTimeout(() => statusBar.hide(), 3000);

          // Show output in a new editor
          const doc = await vscode.workspace.openTextDocument({
            content: result.output,
            language: 'markdown',
          });
          await vscode.window.showTextDocument(doc);
        } catch (error) {
          statusBar.text = `$(error) PromptSentry: Run failed`;
          setTimeout(() => statusBar.hide(), 3000);
          vscode.window.showErrorMessage(
            `PromptSentry: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }

        treeDataProvider?.refresh();
      }),

      // Compare: compares two versions and shows a markdown diff in a new editor
      vscode.commands.registerCommand('promptsentry.compare', async () => {
        if (!db) {
          vscode.window.showErrorMessage('PromptSentry: Not initialized');
          return;
        }

        // Get prompts
        const conn = db.connection;
        const rows = conn.prepare('SELECT id, name FROM prompts ORDER BY name').all() as any[];

        if (rows.length === 0) {
          vscode.window.showErrorMessage('PromptSentry: No prompts found.');
          return;
        }

        // Show quick pick for prompt
        const promptItems = rows.map((row) => ({
          label: row.name,
          description: `ID: ${row.id}`,
          id: row.id,
        }));

        const selectedPrompt = await vscode.window.showQuickPick(promptItems, {
          placeHolder: 'Select a prompt to compare versions',
        });

        if (!selectedPrompt) {
          return;
        }

        // Get versions using core's VersioningEngine
        const versions = versioningEngine!.listVersions(selectedPrompt.id);

        if (versions.length < 2) {
          vscode.window.showInformationMessage(
            'PromptSentry: Need at least 2 versions to compare.',
          );
          return;
        }

        // Show quick pick for first version
        const versionItems = versions.map((v) => ({
          label: `v${v.versionNumber}`,
          description: v.content.substring(0, 50) + '...',
          id: v.id,
        }));

        const selectedVersionA = await vscode.window.showQuickPick(versionItems, {
          placeHolder: 'Select first version',
        });

        if (!selectedVersionA) {
          return;
        }

        // Show quick pick for second version (exclude first)
        const otherVersions = versions.filter((v) => v.id !== selectedVersionA.id);
        const otherVersionItems = otherVersions.map((v) => ({
          label: `v${v.versionNumber}`,
          description: v.content.substring(0, 50) + '...',
          id: v.id,
        }));

        const selectedVersionB = await vscode.window.showQuickPick(otherVersionItems, {
          placeHolder: 'Select second version',
        });

        if (!selectedVersionB) {
          return;
        }

        // Get diff using core's VersioningEngine
        const diff = versioningEngine!.getVersionDiff(selectedVersionA.id, selectedVersionB.id);

        // Show diff in a new editor
        const diffContent = `# PromptSentry: Version Diff\n\n## Versions\n- **Version A**: v${versions.find((v) => v.id === selectedVersionA.id)!.versionNumber}\n- **Version B**: v${versions.find((v) => v.id === selectedVersionB.id)!.versionNumber}\n\n## Summary\n- **Added lines**: ${diff.addedLines}\n- **Deleted lines**: ${diff.deletedLines}\n- **Common lines**: ${diff.commonLines}\n\n## Additions\n\`\`\`\n${diff.additions}\n\`\`\`\n\n## Deletions\n\`\`\`\n${diff.deletions}\n\`\`\``;

        const doc = await vscode.workspace.openTextDocument({
          content: diffContent,
          language: 'markdown',
        });
        await vscode.window.showTextDocument(doc);
      }),

      // Open Panel: opens/closes the webview panel
      vscode.commands.registerCommand('promptsentry.openPanel', async (args?: { promptId?: string }) => {
        if (!webviewPanel) {
          webviewPanel = await createWebviewPanel(context, args?.promptId);
        } else {
          webviewPanel.reveal(vscode.ViewColumn.Two);
        }
      }),

      // Open API Config: configures API settings via input boxes
      vscode.commands.registerCommand('promptsentry.openApiConfig', async () => {
        const currentConfig = await getAPIConfig();

        const baseUrl = await vscode.window.showInputBox({
          prompt: 'Enter API base URL',
          placeHolder: 'http://localhost:11434/v1',
          value: currentConfig?.baseUrl || 'http://localhost:11434/v1',
        });

        if (baseUrl === undefined) {
          return;
        }

        const apiKey = await vscode.window.showInputBox({
          prompt: 'Enter API key (leave empty for local models)',
          placeHolder: 'sk-...',
          value: currentConfig?.apiKey || '',
          password: true,
        });

        if (apiKey === undefined) {
          return;
        }

        const defaultModel = await vscode.window.showInputBox({
          prompt: 'Enter default model',
          placeHolder: 'llama3',
          value: currentConfig?.defaultModel || 'llama3',
        });

        if (defaultModel === undefined) {
          return;
        }

        await saveAPIConfig({
          baseUrl,
          apiKey,
          defaultModel,
        });

        // Update VS Code settings
        const vscodeConfig = vscode.workspace.getConfiguration('promptsentry');
        await vscodeConfig.update('apiBaseUrl', baseUrl, true);
        await vscodeConfig.update('apiKey', apiKey, true);
        await vscodeConfig.update('defaultModel', defaultModel, true);

        vscode.window.showInformationMessage('PromptSentry: API configuration saved');
      }),
    ];

    context.subscriptions.push(...commands);

    vscode.window.showInformationMessage('PromptSentry Workbench activated');
  } catch (error) {
    vscode.window.showErrorMessage(
      `PromptSentry activation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

export function deactivate() {
  if (db) {
    db.close();
  }
}
