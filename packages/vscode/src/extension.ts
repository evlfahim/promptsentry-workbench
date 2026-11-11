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

function createWebviewPanel(context: vscode.ExtensionContext, promptId?: string): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    'promptsentry.workbench',
    'PromptSentry Workbench',
    vscode.ViewColumn.Two,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    },
  );

  panel.webview.html = getWebviewContent(panel.webview);

  panel.webview.onDidReceiveMessage(
    async (message: any) => {
      switch (message.type) {
        case 'ready':
          // Send initial API config
          panel.webview.postMessage({ type: 'apiConfig', data: apiConfig });
          break;

        case 'getPrompts': {
          if (!db) {
            panel.webview.postMessage({ type: 'prompts', data: [] });
            return;
          }
          const conn = db.connection;
          const rows = conn.prepare('SELECT * FROM prompts ORDER BY updated_at DESC').all() as any[];
          const prompts = rows.map((row) => ({
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
          panel.webview.postMessage({ type: 'prompts', data: prompts });
          break;
        }

        case 'getPrompt': {
          if (!db) {
            panel.webview.postMessage({ type: 'prompt', data: null });
            return;
          }
          const conn = db.connection;
          const row = conn.prepare('SELECT * FROM prompts WHERE id = ?').get(message.id) as any;
          if (row) {
            panel.webview.postMessage({
              type: 'prompt',
              data: {
                id: row.id,
                name: row.name,
                content: row.content,
                model: row.model,
                temperature: row.temperature,
                maxTokens: row.maxTokens,
                systemPrompt: row.system_prompt ?? undefined,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
              },
            });
          } else {
            panel.webview.postMessage({ type: 'prompt', data: null });
          }
          break;
        }

        case 'createPrompt': {
          try {
            const prompt = await createPrompt(message.data);
            panel.webview.postMessage({ type: 'promptCreated', data: prompt });
            treeDataProvider?.refresh();
          } catch (error) {
            panel.webview.postMessage({
              type: 'error',
              message: error instanceof Error ? error.message : 'Failed to create prompt',
            });
          }
          break;
        }

        case 'updatePrompt': {
          try {
            const prompt = await updatePrompt(message.id, message.data);
            panel.webview.postMessage({ type: 'promptUpdated', data: prompt });
            treeDataProvider?.refresh();
          } catch (error) {
            panel.webview.postMessage({
              type: 'error',
              message: error instanceof Error ? error.message : 'Failed to update prompt',
            });
          }
          break;
        }

        case 'deletePrompt': {
          try {
            await deletePrompt(message.id);
            panel.webview.postMessage({ type: 'promptDeleted', id: message.id });
            treeDataProvider?.refresh();
          } catch (error) {
            panel.webview.postMessage({
              type: 'error',
              message: error instanceof Error ? error.message : 'Failed to delete prompt',
            });
          }
          break;
        }

        case 'getVersions': {
          if (!db || !versioningEngine) {
            panel.webview.postMessage({ type: 'versions', data: [] });
            return;
          }
          // Use core's VersioningEngine to list versions
          const versions = versioningEngine.listVersions(message.promptId);
          panel.webview.postMessage({ type: 'versions', data: versions });
          break;
        }

        case 'createVersion': {
          try {
            // Use core's VersioningEngine to create a version
            const version = await versioningEngine!.createVersion(message.promptId, message.data);
            panel.webview.postMessage({ type: 'versionCreated', data: version });
            treeDataProvider?.refresh();
          } catch (error) {
            panel.webview.postMessage({
              type: 'error',
              message: error instanceof Error ? error.message : 'Failed to create version',
            });
          }
          break;
        }

        case 'runPrompt': {
          try {
            const result = await runPrompt(message.data);
            panel.webview.postMessage({ type: 'runComplete', data: result });
            treeDataProvider?.refresh();
          } catch (error) {
            panel.webview.postMessage({
              type: 'error',
              message: error instanceof Error ? error.message : 'Failed to run prompt',
            });
          }
          break;
        }

        case 'compareRuns': {
          try {
            // Use core's ComparisonEngine to compare runs
            const comparison = await comparisonEngine!.compareRuns(message.runIdA, message.runIdB);
            panel.webview.postMessage({ type: 'comparison', data: comparison });
          } catch (error) {
            panel.webview.postMessage({
              type: 'error',
              message: error instanceof Error ? error.message : 'Failed to compare runs',
            });
          }
          break;
        }

        case 'getAPIConfig': {
          panel.webview.postMessage({ type: 'apiConfig', data: apiConfig });
          break;
        }

        case 'saveAPIConfig': {
          try {
            await saveAPIConfig(message.data);
            panel.webview.postMessage({ type: 'apiConfigSaved' });
          } catch (error) {
            panel.webview.postMessage({
              type: 'error',
              message: error instanceof Error ? error.message : 'Failed to save API config',
            });
          }
          break;
        }

        case 'getRuns': {
          if (!db) {
            panel.webview.postMessage({ type: 'runs', data: [] });
            return;
          }
          const conn = db.connection;
          const rows = conn
            .prepare('SELECT * FROM prompt_runs WHERE prompt_id = ? ORDER BY created_at DESC')
            .all(message.promptId) as any[];
          const runs = rows.map((row) => ({
            id: row.id,
            promptId: row.prompt_id,
            versionId: row.version_id,
            input: row.input,
            output: row.output,
            model: row.model,
            temperature: row.temperature,
            maxTokens: row.maxTokens,
            systemPrompt: row.system_prompt ?? undefined,
            tokenCount: row.token_count,
            latencyMs: row.latency_ms,
            cost: row.cost ?? undefined,
            createdAt: row.created_at,
            error: row.error ?? undefined,
          }));
          panel.webview.postMessage({ type: 'runs', data: runs });
          break;
        }

        case 'getTestSets': {
          if (!db) {
            panel.webview.postMessage({ type: 'testSets', data: [] });
            return;
          }
          const conn = db.connection;
          const rows = conn
            .prepare('SELECT * FROM test_sets ORDER BY created_at DESC')
            .all() as any[];
          const testSets = rows.map((row) => ({
            id: row.id,
            name: row.name,
            description: row.description ?? undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }));
          panel.webview.postMessage({ type: 'testSets', data: testSets });
          break;
        }

        case 'createTestSet': {
          try {
            const conn = db!.connection;
            const id = crypto.randomUUID();
            const now = new Date().toISOString();
            conn.prepare(
              `INSERT INTO test_sets (id, name, description, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?)`,
            ).run(id, message.data.name, message.data.description ?? null, now, now);

            if (message.data.inputs) {
              const insertInput = conn.prepare(
                `INSERT INTO test_set_inputs (id, test_set_id, input) VALUES (?, ?, ?)`,
              );
              for (const input of message.data.inputs) {
                insertInput.run(crypto.randomUUID(), id, input);
              }
            }

            const row = conn.prepare('SELECT * FROM test_sets WHERE id = ?').get(id) as any;
            panel.webview.postMessage({
              type: 'testSetCreated',
              data: {
                id: row.id,
                name: row.name,
                description: row.description ?? undefined,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
              },
            });
          } catch (error) {
            panel.webview.postMessage({
              type: 'error',
              message: error instanceof Error ? error.message : 'Failed to create test set',
            });
          }
          break;
        }

        case 'runTestSet': {
          try {
            const conn = db!.connection;
            const testSetRow = conn
              .prepare('SELECT * FROM test_sets WHERE id = ?')
              .get(message.testSetId) as any;
            if (!testSetRow) {
              panel.webview.postMessage({
                type: 'error',
                message: 'Test set not found',
              });
              return;
            }

            // Get inputs
            const inputRows = conn
              .prepare('SELECT input FROM test_set_inputs WHERE test_set_id = ?')
              .all(message.testSetId) as { input: string }[];

            // Get prompt metadata
            const promptRow = conn
              .prepare('SELECT model, temperature, maxTokens, system_prompt FROM prompts WHERE id = ?')
              .get(message.promptId) as any;

            if (!promptRow) {
              panel.webview.postMessage({
                type: 'error',
                message: 'Prompt not found',
              });
              return;
            }

            // Get version metadata
            const versionRow = conn
              .prepare('SELECT model, temperature, maxTokens, system_prompt FROM prompt_versions WHERE id = ?')
              .get(message.versionId) as any;

            if (!versionRow) {
              panel.webview.postMessage({
                type: 'error',
                message: 'Version not found',
              });
              return;
            }

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

                const response = await fetch(`${apiConfig!.baseUrl}/chat/completions`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    ...(apiConfig!.apiKey ? { Authorization: `Bearer ${apiConfig!.apiKey}` } : {}),
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
                const tokenCount = apiResponse.usage?.completion_tokens
                  ?? Math.ceil(output.length / 4);

                // Save result
                conn.prepare(
                  `INSERT INTO test_run_results (id, test_set_id, prompt_id, version_id, input, output, token_count, latency_ms, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                ).run(
                  resultId, message.testSetId, message.promptId, message.versionId,
                  inputRow.input, output, tokenCount, latencyMs, createdAt,
                );

                results.push({
                  id: resultId,
                  testSetId: message.testSetId,
                  promptId: message.promptId,
                  versionId: message.versionId,
                  input: inputRow.input,
                  output,
                  tokenCount,
                  latencyMs,
                  createdAt,
                });

                panel.webview.postMessage({
                  type: 'testRunResult',
                  data: results[results.length - 1],
                });
              } catch (error) {
                const latencyMs = Date.now() - startTime;
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                const resultId = crypto.randomUUID();
                const createdAt = new Date().toISOString();

                conn.prepare(
                  `INSERT INTO test_run_results (id, test_set_id, prompt_id, version_id, input, output, token_count, latency_ms, error, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                ).run(
                  resultId, message.testSetId, message.promptId, message.versionId,
                  inputRow.input, '', 0, latencyMs, errorMessage, createdAt,
                );

                results.push({
                  id: resultId,
                  testSetId: message.testSetId,
                  promptId: message.promptId,
                  versionId: message.versionId,
                  input: inputRow.input,
                  output: '',
                  tokenCount: 0,
                  latencyMs,
                  error: errorMessage,
                  createdAt,
                });

                panel.webview.postMessage({
                  type: 'testRunResult',
                  data: results[results.length - 1],
                });
              }
            }

            panel.webview.postMessage({
              type: 'testSetComplete',
              data: { results, total: results.length },
            });
          } catch (error) {
            panel.webview.postMessage({
              type: 'error',
              message: error instanceof Error ? error.message : 'Failed to run test set',
            });
          }
          break;
        }

        case 'getTestResults': {
          if (!db) {
            panel.webview.postMessage({ type: 'testResults', data: [] });
            return;
          }
          const conn = db.connection;
          const rows = conn
            .prepare('SELECT * FROM test_run_results WHERE test_set_id = ? ORDER BY created_at ASC')
            .all(message.testSetId) as any[];
          const results = rows.map((row) => ({
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
          }));
          panel.webview.postMessage({ type: 'testResults', data: results });
          break;
        }

        case 'getVersionDiff': {
          if (!versioningEngine) {
            panel.webview.postMessage({ type: 'error', message: 'Versioning engine not initialized' });
            return;
          }
          try {
            const diff = versioningEngine.getVersionDiff(message.versionIdA, message.versionIdB);
            panel.webview.postMessage({ type: 'versionDiff', data: diff });
          } catch (error) {
            panel.webview.postMessage({
              type: 'error',
              message: error instanceof Error ? error.message : 'Failed to get version diff',
            });
          }
          break;
        }

        case 'rollbackVersion': {
          try {
            if (!versioningEngine || !db) {
              throw new Error('Versioning engine not initialized');
            }
            const prompt = versioningEngine.rollbackToVersion(message.promptId, message.versionId);
            panel.webview.postMessage({ type: 'versionRolledBack', data: prompt });
            treeDataProvider?.refresh();
          } catch (error) {
            panel.webview.postMessage({
              type: 'error',
              message: error instanceof Error ? error.message : 'Failed to rollback version',
            });
          }
          break;
        }

        case 'listModels': {
          try {
            if (!openAIClient) {
              panel.webview.postMessage({ type: 'error', message: 'OpenAI client not initialized' });
              return;
            }
            const models = await openAIClient.listModels();
            panel.webview.postMessage({ type: 'models', data: models });
          } catch (error) {
            panel.webview.postMessage({
              type: 'error',
              message: error instanceof Error ? error.message : 'Failed to list models',
            });
          }
          break;
        }
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

function getWebviewContent(webview: vscode.Webview): string {
  const viteDevUrl = 'http://localhost:5173'; // Vite dev server URL

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'unsafe-inline'; img-src ${webview.cspSource} data:;">
  <title>PromptSentry Workbench</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      margin: 0;
      padding: 20px;
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    h1 {
      color: var(--vscode-titleBar-activeForeground);
      border-bottom: 1px solid var(--vscode-panel-border);
      padding-bottom: 10px;
    }
    .status {
      padding: 10px;
      margin: 10px 0;
      border-radius: 4px;
      background-color: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
    }
    .status.success {
      border-color: #4ec9b0;
      color: #4ec9b0;
    }
    .status.error {
      border-color: #f44747;
      color: #f44747;
    }
    .status.info {
      border-color: #007acc;
      color: #007acc;
    }
    button {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 8px 16px;
      border-radius: 2px;
      cursor: pointer;
      font-size: 14px;
    }
    button:hover {
      background-color: var(--vscode-button-hoverBackground);
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-top: 20px;
    }
    .card {
      background-color: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 15px;
    }
    .card h3 {
      margin-top: 0;
      color: var(--vscode-titleBar-activeForeground);
    }
    pre {
      background-color: var(--vscode-textCodeBlock-background);
      padding: 10px;
      border-radius: 4px;
      overflow-x: auto;
      font-size: 12px;
    }
    .loading {
      display: inline-block;
      width: 20px;
      height: 20px;
      border: 2px solid var(--vscode-input-border);
      border-radius: 50%;
      border-top-color: var(--vscode-button-background);
      animation: spin 1s ease-in-out infinite;
      margin-right: 10px;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚀 PromptSentry Workbench</h1>
    <div id="status" class="status info">
      <span class="loading"></span>
      Initializing...
    </div>
    <div class="grid">
      <div class="card">
        <h3>Quick Actions</h3>
        <button onclick="vscode.postMessage({type: 'openApiConfig'})">Configure API</button>
        <button onclick="vscode.postMessage({type: 'newPrompt'})">New Prompt</button>
        <button onclick="vscode.postMessage({type: 'refresh'})">Refresh</button>
      </div>
      <div class="card">
        <h3>Status</h3>
        <div id="status-details">Connecting to extension...</div>
      </div>
    </div>
    <div class="card" style="margin-top: 20px;">
      <h3>Instructions</h3>
      <p>PromptSentry Workbench helps you manage, version, and test prompts against OpenAI-compatible endpoints.</p>
      <ul>
        <li>Use the <strong>PromptSentry</strong> sidebar to browse prompts and versions</li>
        <li>Click <strong>Open Workbench</strong> to interact with prompts in this panel</li>
        <li>Configure your API endpoint via <strong>PromptSentry: Configure API</strong></li>
      </ul>
    </div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    
    // Send a ready message
    vscode.postMessage({ type: 'ready' });
    
    // Listen for messages from extension
    window.addEventListener('message', event => {
      const message = event.data;
      const statusEl = document.getElementById('status');
      const statusDetails = document.getElementById('status-details');
      
      switch (message.type) {
        case 'ready':
          statusEl.className = 'status success';
          statusEl.innerHTML = '✅ Connected to PromptSentry';
          statusDetails.textContent = 'Extension is active and ready.';
          break;
        case 'error':
          statusEl.className = 'status error';
          statusEl.innerHTML = '❌ ' + message.message;
          break;
        case 'prompts':
          statusDetails.textContent = 'Loaded ' + message.data.length + ' prompts.';
          break;
        case 'apiConfig':
          if (message.data) {
            statusDetails.textContent = 'API: ' + message.data.baseUrl;
          }
          break;
      }
    });
  </script>
</body>
</html>`;
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
      vscode.commands.registerCommand('promptsentry.openPanel', (args?: { promptId?: string }) => {
        if (!webviewPanel) {
          webviewPanel = createWebviewPanel(context, args?.promptId);
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
