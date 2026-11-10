import Database from 'better-sqlite3';
import type { DatabaseConfig } from './types.js';

export class DB {
  private db: Database.Database;

  constructor(config: DatabaseConfig) {
    this.db = new Database(config.path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.ensureTables();
  }

  private ensureTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS prompts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        content TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT 'gpt-4',
        temperature REAL NOT NULL DEFAULT 0.7,
        maxTokens INTEGER NOT NULL DEFAULT 1024,
        system_prompt TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS prompt_versions (
        id TEXT PRIMARY KEY,
        prompt_id TEXT NOT NULL,
        content TEXT NOT NULL,
        model TEXT NOT NULL,
        temperature REAL NOT NULL,
        max_tokens INTEGER NOT NULL,
        system_prompt TEXT,
        content_hash TEXT NOT NULL,
        version_number INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        commit_message TEXT,
        FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt_id ON prompt_versions(prompt_id);
      CREATE INDEX IF NOT EXISTS idx_prompt_versions_hash ON prompt_versions(content_hash);

      CREATE TABLE IF NOT EXISTS prompt_runs (
        id TEXT PRIMARY KEY,
        prompt_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        input TEXT NOT NULL,
        output TEXT NOT NULL,
        model TEXT NOT NULL,
        temperature REAL NOT NULL,
        max_tokens INTEGER NOT NULL,
        system_prompt TEXT,
        token_count INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        cost REAL,
        created_at TEXT NOT NULL,
        error TEXT,
        FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE,
        FOREIGN KEY (version_id) REFERENCES prompt_versions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_prompt_runs_prompt_id ON prompt_runs(prompt_id);
      CREATE INDEX IF NOT EXISTS idx_prompt_runs_version_id ON prompt_runs(version_id);

      CREATE TABLE IF NOT EXISTS test_sets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS test_set_inputs (
        id TEXT PRIMARY KEY,
        test_set_id TEXT NOT NULL,
        input TEXT NOT NULL,
        FOREIGN KEY (test_set_id) REFERENCES test_sets(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_test_set_inputs_test_set_id ON test_set_inputs(test_set_id);

      CREATE TABLE IF NOT EXISTS test_run_results (
        id TEXT PRIMARY KEY,
        test_set_id TEXT NOT NULL,
        prompt_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        input TEXT NOT NULL,
        output TEXT NOT NULL,
        token_count INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        cost REAL,
        error TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (test_set_id) REFERENCES test_sets(id) ON DELETE CASCADE,
        FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE,
        FOREIGN KEY (version_id) REFERENCES prompt_versions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS api_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  get connection(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}
