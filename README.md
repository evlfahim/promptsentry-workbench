# PromptSentry Workbench

> Local-first prompt workbench combining git-style versioning, execution against any OpenAI-compatible endpoint, and rich side-by-side diffs of answers, tokens, and latency with semantic analysis.

## Why PromptSentry?

- **CLI-only tools** like `promptctl` lack integrated execution, metrics, and UI
- **Answer-diff tools** like PromptDiff lack persistent versioning, history, and local-first storage
- **Manual workflows** miss automated metrics, semantic comparison, and reproducible test sets
- No existing tool offers a unified workbench with versioning, execution, and analysis in a local stack

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
├── web/           # @sentry-prompt/web — Vite/React web app + local API server
└── vscode/        # @sentry-prompt/vscode — VS Code extension + webview
```

## Quick Start

### Prerequisites

- Node.js 22+
- npm
- (Optional) Ollama or another OpenAI-compatible endpoint for prompt execution

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

The web app connects to a local API server that wraps the core library. Start the server in a separate terminal:

```bash
npm run server --workspace=packages/web
```

The server listens on `http://127.0.0.1:3001` by default and proxies API requests from the Vite dev server.

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

### Building the VS Code Extension

The VS Code extension is a standard VS Code extension written in TypeScript. It uses esbuild to bundle the extension entry point and the webview app into single files.

#### Extension architecture

```
packages/vscode/
├── src/
│   ├── extension.ts          # VS Code extension entry point (activate/deactivate)
│   ├── webview-app.tsx       # React UI rendered inside the webview
│   ├── webview-bridge.ts     # Message bridge between webview and extension host
│   ├── webview-store.tsx     # React context for webview state
│   ├── file-watcher.ts       # File system watcher for .prompt files
│   ├── theme/theme.tsx       # Dark/light theme provider
│   ├── hooks/useKeyboardShortcuts.ts
│   ├── webview.html          # Webview HTML shell
│   └── __tests__/            # Unit tests
├── esbuild.cjs               # Bundling script (extension + webview)
├── package.json              # Extension manifest (commands, views, settings)
└── tsconfig.json
```

#### Key files

- **`extension.ts`** — Registers all commands, creates the tree view provider, opens the webview panel, and wires up the file watcher.
- **`webview-app.tsx`** — Full React application with routing, theme, keyboard shortcuts, and toast notifications.
- **`webview-bridge.ts`** — Serializes messages between the webview (React) and the extension host (Node.js). The webview calls `postMessage` and the extension forwards to core library methods.
- **`file-watcher.ts`** — Uses `fs.watch` to detect file changes in a directory and syncs them to the database.

#### Build process

```bash
# Full build (TypeScript compile + esbuild bundling)
npm run build --workspace=packages/vscode

# TypeScript compile only
npm run compile --workspace=packages/vscode

# Bundle with esbuild (produces dist/extension.js and dist/webview-*.js)
node packages/vscode/esbuild.cjs
```

#### Packaging for distribution

```bash
npm run package --workspace=packages/vscode
```

This runs `tsc --noEmit` for type-checking, then bundles with esbuild. The output is a single `dist/extension.js` file that VS Code can load.

#### Publishing to the VS Code Marketplace

```bash
# Install VSCE (VS Code Extension Manager)
npm install -g @vscode/vsce

# Package
vsce package -o promptsentry-workbench.vsix

# Publish (requires VS Code Marketplace token)
vsce publish
```

## Web App

The web app provides a full-featured workbench UI with:

- **Dashboard** — overview stats, recent prompts, file watcher status
- **Prompts** — list, create, edit, delete prompts with version history
- **Runs** — view execution results with token counts and latency
- **Test Sets** — create test sets with multiple inputs, run against prompts, compare results
- **API Config** — configure the OpenAI-compatible endpoint
- **Dark / Light mode** — toggle with the ☀️/🌙 button or `Ctrl+T`
- **Responsive layout** — adapts to mobile, tablet, and desktop viewports
- **Keyboard shortcuts** — see below

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+N` / `⌘N` | Create a new prompt |
| `Ctrl+K` / `⌘K` | Focus the search/filter input |
| `Ctrl+T` / `⌘T` | Toggle dark/light theme |
| `Ctrl+Shift+R` / `⌘⇧R` | Refresh all data |
| `Ctrl+H` / `⌘H` | Show keyboard shortcuts help |
| `Esc` | Close modals and overlays |

Shortcuts are platform-aware: Mac shows `⌘`, `⌃`, `⇧`, `⌥`; Windows/Linux shows `Ctrl`, `Shift`, `Alt`.

### Toast Notifications

The UI shows brief toast notifications for actions like prompt creation, deletion, save confirmations, and run results. Toasts auto-dismiss after 3 seconds and are color-coded (green for success, red for errors, blue for info).

### Responsive Design

The UI adapts to different screen sizes:

- **Desktop (> 768px)**: Full navigation bar, side-by-side diffs, multi-column grids
- **Tablet (≤ 768px)**: Hamburger menu, stacked diff views, single-column forms
- **Mobile (≤ 480px)**: Compact cards, full-width buttons, scrollable tables
- **Print**: Hides navigation and buttons, ensures readable output
- **Accessibility**: `:focus-visible` outlines, `prefers-reduced-motion` support, system theme detection

### Web App Architecture

```
packages/web/
├── src/
│   ├── App.tsx                 # Router and layout shell
│   ├── main.tsx                # React entry point
│   ├── store.tsx               # React context for app state
│   ├── theme.tsx               # Theme provider
│   ├── global.css              # Global styles + responsive breakpoints
│   ├── components/
│   │   └── Navigation.tsx      # Top navigation bar
│   ├── hooks/
│   │   └── useKeyboardShortcuts.ts
│   ├── services/
│   │   └── coreService.ts      # HTTP client wrapping the API server
│   └── views/
│       ├── ApiConfig.tsx       # API endpoint configuration
│       ├── ComparisonView.tsx  # Side-by-side diff view
│       ├── Dashboard.tsx       # Overview dashboard
│       ├── PromptDetail.tsx    # Prompt editor with version history
│       ├── PromptsList.tsx     # Prompt list with search/filter
│       ├── Runs.tsx            # Execution results viewer
│       └── TestSets.tsx        # Test set management
├── server/
│   ├── index.ts                # HTTP server entry point
│   ├── app.ts                  # Route definitions
│   ├── service.ts              # WorkbenchService (wraps @sentry-prompt/core)
│   └── app.test.ts             # Integration tests
├── vite.config.ts
└── package.json
```

The web app is split into two parts:

1. **Client** (`src/`) — React UI served by Vite in development, bundled for production.
2. **Server** (`server/`) — Node.js HTTP server using `better-sqlite3` (which cannot run in the browser). The Vite dev server proxies `/api` requests to this server.

In production, the server serves both the API and the static React build.

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

### Core modules

| Module | Description |
|---|---|
| `db.ts` | SQLite database schema, connection management, WAL mode |
| `versioning.ts` | Git-style versioning: create, diff, rollback, content-hash |
| `api.ts` | OpenAI-compatible client: execute, streaming, model listing, health checks |
| `comparison.ts` | Lexical diff, lexical similarity, semantic similarity, cost estimation, test set runner |
| `types.ts` | Shared TypeScript interfaces for all packages |

## Running Tests

```bash
# Core library tests (with coverage)
npm run test --workspace=packages/core

# VS Code extension tests
npm run test --workspace=packages/vscode

# Web app tests (server integration tests)
npm run test --workspace=packages/web

# Run all tests across the monorepo
npm run test
```

### Test Coverage

The core library has comprehensive unit and integration tests covering all critical paths:

| Module | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| `db.ts` | 100% | 100% | 100% | 100% |
| `comparison.ts` | 97.5% | 88.5% | 100% | 99.3% |
| `versioning.ts` | 92.7% | 77.3% | 100% | 92.2% |
| `api.ts` | 29.1% | 9.9% | 62.5% | 28.2% |

> **Note:** `api.ts` tests are integration tests against a live Ollama endpoint. All critical paths (execute, executeStream, listModels, healthCheck, configuration, error handling, DB save) are covered. The lower coverage reflects code paths that require a live API server (streaming chunks, async generators, model retrieval).

### Test Categories

- **Versioning** — commit, diff, rollback, hash, version history, edge cases (empty content, unicode, special characters, long content)
- **Comparison** — lexical diff, lexical similarity, semantic similarity, compare runs, test set management, cost estimation, edge cases
- **API** — non-streaming execute, streaming execute, executeStreamAsync, listModels, getModel, healthCheck, configuration, error handling, DB integration
- **DB** — table creation, schema validation, foreign keys, WAL mode, data operations, edge cases
- **Integration** — end-to-end workflows combining versioning, comparison, and DB operations

## Building

```bash
# Build everything
npm run build

# Build individual packages
npm run build --workspace=packages/core
npm run build --workspace=packages/web
npm run build --workspace=packages/vscode

# Clean build artifacts
npm run clean
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
