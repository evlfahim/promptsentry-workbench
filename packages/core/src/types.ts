/**
 * Shared types for PromptSentry Workbench
 * Used by @sentry-prompt/core, @sentry-prompt/web, and @sentry-prompt/vscode
 */

// ─── Prompt ───────────────────────────────────────────────────────────────────

export interface Prompt {
  id: string;
  name: string;
  content: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt?: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

export type PromptCreate = Omit<Prompt, 'id' | 'createdAt' | 'updatedAt'>;
export type PromptUpdate = Partial<PromptCreate>;

// ─── Version ──────────────────────────────────────────────────────────────────

export interface PromptVersion {
  id: string;
  promptId: string;
  content: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt?: string;
  contentHash: string;
  versionNumber: number;
  createdAt: string; // ISO 8601
  commitMessage?: string;
}

export type PromptVersionCreate = Omit<
  PromptVersion,
  'id' | 'contentHash' | 'versionNumber' | 'createdAt'
>;

// ─── Run ──────────────────────────────────────────────────────────────────────

export interface PromptRun {
  id: string;
  promptId: string;
  versionId: string;
  input: string;
  output: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt?: string;
  tokenCount: number;
  latencyMs: number;
  cost?: number;
  createdAt: string; // ISO 8601
  error?: string;
}

export interface PromptRunCreate {
  promptId: string;
  versionId: string;
  input: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt?: string;
  output?: string;
  error?: string;
}

export type PromptRunWithExtraParams = PromptRunCreate & {
  extraParams?: ExtraParams;
};

// ─── Comparison ───────────────────────────────────────────────────────────────

export interface LexicalDiff {
  additions: string;
  deletions: string;
  common: string;
  addedLines: number;
  deletedLines: number;
  commonLines: number;
}

export interface ComparisonResult {
  runA: PromptRun;
  runB: PromptRun;
  lexicalDiff: LexicalDiff;
  lexicalSimilarity: number; // 0-1
  semanticSimilarity: number; // 0-1
  latencyDiffMs: number; // A - B
  tokenDiff: number; // A - B
  costDiff?: number; // A - B
}

// ─── Test Set ─────────────────────────────────────────────────────────────────

export interface TestSet {
  id: string;
  name: string;
  description?: string;
  inputs: string[];
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

export type TestSetCreate = Omit<TestSet, 'id' | 'createdAt' | 'updatedAt'>;

export interface TestRunResult {
  id: string;
  testSetId: string;
  promptId: string;
  versionId: string;
  input: string;
  output: string;
  tokenCount: number;
  latencyMs: number;
  cost?: number;
  error?: string;
  createdAt: string; // ISO 8601
}

// ─── API Configuration ────────────────────────────────────────────────────────

export interface ExtraParams {
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string | string[];
  seed?: number;
  logprobs?: boolean;
  topLogprobs?: number;
  responseFormat?: { type: 'json_object' | 'text' };
  n?: number;
}

export interface APIConfig {
  baseUrl: string;
  apiKey?: string;
  defaultModel?: string;
}

// ─── Database ─────────────────────────────────────────────────────────────────

export interface DatabaseConfig {
  path: string;
}

// ─── Core API ─────────────────────────────────────────────────────────────────

export interface CoreAPI {
  // Prompts
  createPrompt(data: PromptCreate): Promise<Prompt>;
  getPrompt(id: string): Promise<Prompt | undefined>;
  listPrompts(): Promise<Prompt[]>;
  updatePrompt(id: string, data: PromptUpdate): Promise<Prompt>;
  deletePrompt(id: string): Promise<void>;

  // Versions
  createVersion(promptId: string, data: PromptVersionCreate): Promise<PromptVersion>;
  getVersion(id: string): Promise<PromptVersion | undefined>;
  listVersions(promptId: string): Promise<PromptVersion[]>;
  getVersionDiff(versionIdA: string, versionIdB: string): Promise<LexicalDiff>;
  rollbackToVersion(promptId: string, versionId: string): Promise<Prompt>;

  // Runs
  createRun(data: PromptRunCreate): Promise<PromptRun>;
  getRun(id: string): Promise<PromptRun | undefined>;
  listRuns(promptId?: string): Promise<PromptRun[]>;
  compareRuns(runIdA: string, runIdB: string): Promise<ComparisonResult>;

  // Test Sets
  createTestSet(data: TestSetCreate): Promise<TestSet>;
  getTestSet(id: string): Promise<TestSet | undefined>;
  listTestSets(): Promise<TestSet[]>;
  runTestSet(
    testSetId: string,
    promptId: string,
    versionId: string,
  ): Promise<TestRunResult[]>;

  // API Config
  setAPIConfig(config: APIConfig): Promise<void>;
  getAPIConfig(): Promise<APIConfig | undefined>;
}
