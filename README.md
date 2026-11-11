# PromptSentry Workbench

> Local-first prompt workbench combining git-style versioning, execution against any OpenAI-compatible endpoint, and rich side-by-side diffs of answers, tokens, and latency with semantic analysis.

## Features

- **Local SQLite database** for prompts, versions, runs, and metrics
- **Git-style versioning** with content-hash, diffs, and rollback
- **Execution against OpenAI-compatible endpoints** (Ollama, vLLM, local servers)
- **Side-by-side answer diff** with lexical and semantic similarity scores
- **Metrics dashboard**: token counts, latency, cost estimation
- **Test sets** for reproducible A/B comparisons across multiple inputs
- **File watcher** — automatically sync `.prompt` files from a directory to the database
- **VS Code extension** with embedded webview, tree view, and command palette
- **Web app** (Vite/React) sharing the same core library
- **Export/Import** runs and prompts as JSON
- **CI-friendly** JSON output for automation

## Stack

TypeScript, Node.js, Vite, React, better-sqlite3, OpenAI SDK, `diff`, semantic-similarity, VS Code Extension API

## Project Structure

```
packages/
├── core/          # @sentry-prompt/core — DB, versioning, API client, comparison
├── web/           # @sentry-prompt/web — Vite/React web app
└── vscode/        # @sentry-prompt/vscode — VS Code extension + webview
```

## Quick Start

### Prerequisites

- Node.js 22+
- npm

### Install

```bash
npm install
```

### Build all packages

```bash
npm run build
```

### Run the web app

```bash
npm run dev --workspace=packages/web
```

Open http://localhost:5173 in your browser.

### Run the VS Code extension

```bash
npm run build --workspace=packages/vscode
```

Then open the project in VS Code and press `F5` (Run → Start Debugging) to launch the extension host with PromptSentry active.

## File Watcher

The extension can automatically sync `.prompt` files from a directory on your filesystem into the local SQLite database.

### How it works

1. **File naming convention**: A file named `my-prompt.prompt` maps to a prompt called "my-prompt".
2. **Sidecar metadata**: An optional `my-prompt.prompt.json` can specify `model`, `temperature`, `maxTokens`, and `systemPrompt`.
3. **Events**:
   - **File created** → creates a new prompt + initial version
   - **File changed** → creates a new version (only if content changed)
   - **File deleted** → prompt marked as deleted (soft delete)
   - **Sidecar changed** → updates prompt metadata

### Enabling file watching

**From the VS Code command palette:**
1. `Ctrl+Shift+P` → `PromptSentry: Start File Watching`
2. Select the directory to watch
3. The extension will sync all `.prompt` files and start monitoring for changes

**From the Webview UI:**
1. Open the PromptSentry Workbench panel (`PromptSentry: Open Workbench`)
2. On the Dashboard, click "+ Start Watching" under the File Watcher section
3. Enter the directory path

**Via VS Code settings** (`settings.json`):
```json
{
  "promptsentry.watchDirectory": "/path/to/your/prompts",
  "promptsentry.autoCreatePrompts": true,
  "promptsentry.autoUpdateVersions": true
}
```

### Configuration options

| Setting | Type | Default | Description |
|---|---|---|---|
| `promptsentry.watchDirectory` | string | `""` | Directory to watch for `.prompt` files |
| `promptsentry.autoCreatePrompts` | boolean | `true` | Auto-create prompts when new `.prompt` files are detected |
| `promptsentry.autoUpdateVersions` | boolean | `true` | Auto-create versions when `.prompt` files change |

## VS Code Extension

### Commands

| Command | Description |
|---|---|
| `PromptSentry: Refresh Prompts` | Refresh the tree view and webview |
| `PromptSentry: New Prompt` | Create a new prompt via input boxes |
| `PromptSentry: Run Prompt` | Run a prompt against the configured API |
| `PromptSentry: Compare Versions` | Compare two versions side by side |
| `PromptSentry: Open Workbench` | Open the webview panel |
| `PromptSentry: Configure API` | Configure the OpenAI-compatible endpoint |
| `PromptSentry: Start File Watching` | Start watching a directory for `.prompt` files |
| `PromptSentry: Stop File Watching` | Stop watching the current directory |
| `PromptSentry: File Watching Status` | Show current file watching status |

### Tree View

The extension adds a "PromptSentry" view to the VS Code sidebar showing all prompts and their version history.

## Web App

The web app provides a full-featured workbench UI with:

- **Dashboard** — overview stats, recent prompts, file watcher status
- **Prompts** — list, create, edit, delete prompts with version history
- **Runs** — view execution results with token counts and latency
- **Test Sets** — create test sets with multiple inputs, run against prompts, compare results
- **API Config** — configure the OpenAI-compatible endpoint

## Core Library (`@sentry-prompt/core`)

The core package can be used standalone or as a dependency:

```typescript
import { DB, VersioningEngine, OpenAIClient, ComparisonEngine } from '@sentry-prompt/core';

// Initialize
const db = new DB({ path: './prompts.db' });
const versioning = new VersioningEngine(db);
const client = new OpenAIClient(db, { baseUrl: 'http://localhost:11434/v1' });

// Create a prompt and version
const prompt = await versioning.createVersion('prompt-id', {
  promptId: 'prompt-id',
  content: 'Your prompt text here',
  model: 'llama3',
  temperature: 0.7,
  maxTokens: 1024,
  commitMessage: 'Initial version',
});

// Execute against an endpoint
const result = await client.execute({
  promptId: 'prompt-id',
  versionId: prompt.id,
  input: 'Hello world',
  model: 'llama3',
  temperature: 0.7,
  maxTokens: 1024,
}, { saveRun: true });
```

## Running Tests

```bash
# Core library tests
npm run test --workspace=packages/core

# VS Code extension tests
npm run test --workspace=packages/vscode

# Web app tests
npm run test --workspace=packages/web
```

## Building

```bash
# Build everything
npm run build

# Build individual packages
npm run build --workspace=packages/core
npm run build --workspace=packages/web
npm run build --workspace=packages/vscode
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    VS Code Extension                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │  Tree View   │  │  Webview     │  │File Watcher│ │
│  │  (prompts +  │  │  (React UI)  │  │ (syncs    │ │
│  │   versions)  │  │  + bridge    │  │  .prompt  │ │
│  └──────┬───────┘  └──────┬───────┘  └─────┬─────┘ │
│         └─────────────────┼────────────────┘       │
│                           ▼                        │
│              @sentry-prompt/core                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────┐ │
│  │    DB    │ │ Version  │ │   API    │ │Com-   │ │
│  │(SQLite)  │ │  Engine  │ │ Client  │ │ par-  │ │
│  └──────────┘ └──────────┘ └──────────┘ └───────┘ │
└─────────────────────────────────────────────────────┘
                          ▲
                          │ shared core
┌─────────────────────────────────────────────────────┐
│                    Web App (Vite/React)              │
│  ┌──────────────────────────────────────────────┐  │
│  │  Dashboard │ Prompts │ Runs │ Test Sets │ API│  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

## License

MIT
