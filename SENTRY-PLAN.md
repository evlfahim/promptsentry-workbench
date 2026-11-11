# PromptSentry Workbench

> Local-first prompt workbench combining git-style versioning, execution against any OpenAI-compatible endpoint, and rich side-by-side diffs of answers, tokens, and latency with semantic analysis.

Task: Local LLM prompt workbench: save, version and compare prompts side by side against any OpenAI-compatible endpoint (vLLM, Ollama), with diff of answers, token counts and latency; later a VS Code plugin #plugin #vscode #web

## Why it is better than what exists
- CLI-only tools like promptctl lack integrated execution, metrics, and UI
- Answer-diff tools like PromptDiff lack persistent versioning, history, and local-first storage
- Manual workflows miss automated metrics, semantic comparison, and reproducible test sets
- No existing tool offers a unified workbench with versioning, execution, and analysis in a local stack

## Features
- Local SQLite database for prompts, versions, runs, and metrics
- Git-style versioning with content-hash, diffs, and rollback
- Execution against OpenAI-compatible endpoints (Ollama, vLLM, local servers)
- Side-by-side answer diff with lexical and semantic similarity scores
- Metrics dashboard: token counts, latency, cost estimation
- Test sets for reproducible A/B comparisons across versions
- Plugin architecture: core library separate from UI and extension
- VS Code extension with embedded webview and file watchers
- Export/Import runs and prompts as JSON
- CI-friendly JSON output for automation

## Stack
TypeScript, Node.js, Vite, React, better-sqlite3, OpenAI SDK, semantic-similarity, VS Code Extension API

## Becoming a plugin
Core logic in `@sentry-prompt/core` handles DB, API, and diffing; VS Code extension wraps core with `vscode-webview` for UI and file watchers; Web app shares same core via ESM.

## Steps
- [x] 1. Initialize monorepo with `packages/core`, `packages/web`, `packages/vscode` and define shared TypeScript types
- [x] 2. Implement `better-sqlite3` schema for prompts, versions, runs, and metrics, and verify with a test query
- [x] 3. Build versioning engine with content-hash, text diff, and rollback logic, and test commit/diff/rollback commands
- [x] 4. Create OpenAI-compatible client supporting streaming and non-streaming, and verify against a local Ollama instance
- [x] 5. Implement comparison engine calculating token counts, latency, lexical diff, and semantic similarity, and validate output structure
- [x] 6. Scaffold Web UI with Vite/React, list prompts, and verify navigation and state management
- [x] 7. Build prompt editor and run panel, connect to core API, and verify saving and executing prompts
- [x] 8. Implement side-by-side comparison view with diffs and metrics, and verify rendering of answer differences
- [x] 9. Add test set support for batch runs and verify A/B comparison workflow across multiple inputs
- [x] 10. Scaffold VS Code extension with `extension.ts`, manifest, and command palette integration
- [ ] 11. Integrate `@sentry-prompt/core` into extension, expose DB and API methods, and verify extension imports work
- [ ] 12. Embed Webview in extension, bridge messages between core and UI, and verify UI renders in VS Code
- [ ] 13. Add file watcher to sync external prompt files with local versions, and verify auto-detection of changes
- [ ] 14. Polish Web UI and Webview with dark mode, keyboard shortcuts, and responsive layout, and verify cross-platform consistency
- [ ] 15. Write unit tests for core logic covering versioning, API, and comparison, and verify 100% coverage on critical paths
- [ ] 16. Write README with setup instructions, usage examples, and guide to building the VS Code plugin, and verify all commands work
