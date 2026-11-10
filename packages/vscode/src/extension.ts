import * as vscode from 'vscode';
import { DB, VersioningEngine, OpenAIClient, ComparisonEngine } from '@sentry-prompt/core';

let db: DB | undefined;
let versioningEngine: VersioningEngine | undefined;
let openAIClient: OpenAIClient | undefined;
let comparisonEngine: ComparisonEngine | undefined;

export function activate(context: vscode.ExtensionContext) {
  const dbPath = context.globalStorageUri.fsPath;
  const dbFile = `${dbPath}/promptsentry.db`;

  try {
    db = new DB({ path: dbFile });
    versioningEngine = new VersioningEngine(db);
    comparisonEngine = new ComparisonEngine(db);

    // Default API config
    const apiConfig = {
      baseUrl: vscode.workspace.getConfiguration('promptsentry').get('apiBaseUrl', 'http://localhost:11434/v1'),
      apiKey: vscode.workspace.getConfiguration('promptsentry').get('apiKey', ''),
      defaultModel: vscode.workspace.getConfiguration('promptsentry').get('defaultModel', 'llama3'),
    };
    openAIClient = new OpenAIClient(db, apiConfig);

    registerCommands(context);
    vscode.window.showInformationMessage('PromptSentry Workbench activated');
  } catch (error) {
    vscode.window.showErrorMessage(`PromptSentry activation failed: ${error}`);
  }
}

function registerCommands(context: vscode.ExtensionContext): void {
  const refreshCommand = vscode.commands.registerCommand('promptsentry.refresh', () => {
    vscode.window.showInformationMessage('PromptSentry: Refreshed');
  });

  const newPromptCommand = vscode.commands.registerCommand('promptsentry.newPrompt', async () => {
    const name = await vscode.window.showInputBox({
      prompt: 'Enter prompt name',
      placeHolder: 'My Prompt',
    });
    if (name) {
      vscode.window.showInformationMessage(`PromptSentry: Created prompt "${name}"`);
    }
  });

  const runPromptCommand = vscode.commands.registerCommand('promptsentry.runPrompt', async () => {
    vscode.window.showInformationMessage('PromptSentry: Run Prompt');
  });

  const compareCommand = vscode.commands.registerCommand('promptsentry.compare', async () => {
    vscode.window.showInformationMessage('PromptSentry: Compare Versions');
  });

  context.subscriptions.push(refreshCommand, newPromptCommand, runPromptCommand, compareCommand);
}

export function deactivate() {
  if (db) {
    db.close();
  }
}
