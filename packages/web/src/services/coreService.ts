/**
 * Browser client for the local PromptSentry API server (packages/web/server).
 * The core library uses better-sqlite3 and Node APIs, so the UI reaches it over HTTP.
 */
import type {
  APIConfig,
  ComparisonResult,
  LexicalDiff,
  Prompt,
  PromptCreate,
  PromptRun,
  PromptUpdate,
  PromptVersion,
  TestRunResult,
  TestSet,
  TestSetCreate,
} from '@sentry-prompt/core';

export interface SavePromptResult {
  prompt: Prompt;
  /** The version created by this save, or null if nothing changed. */
  version: PromptVersion | null;
}

const BASE = '/api';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Cannot reach the PromptSentry API server. Start it with `npm run server -w @sentry-prompt/web`.');
  }
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) {
    throw new Error(data?.error ?? `Request failed: ${res.status} ${res.statusText}`);
  }
  return data as T;
}

export const api = {
  getAPIConfig: () => request<APIConfig | null>('GET', '/config'),
  setAPIConfig: (config: APIConfig) => request<APIConfig>('PUT', '/config', config),

  listPrompts: () => request<Prompt[]>('GET', '/prompts'),
  getPrompt: (id: string) => request<Prompt>('GET', `/prompts/${encodeURIComponent(id)}`),
  createPrompt: (data: PromptCreate & { commitMessage?: string }) =>
    request<SavePromptResult>('POST', '/prompts', data),
  updatePrompt: (id: string, data: PromptUpdate & { commitMessage?: string }) =>
    request<SavePromptResult>('PUT', `/prompts/${encodeURIComponent(id)}`, data),
  deletePrompt: (id: string) => request<void>('DELETE', `/prompts/${encodeURIComponent(id)}`),

  listVersions: (promptId?: string) =>
    request<PromptVersion[]>(
      'GET',
      promptId ? `/prompts/${encodeURIComponent(promptId)}/versions` : '/versions',
    ),

  executePrompt: (promptId: string, input: string, versionId?: string) =>
    request<PromptRun>('POST', `/prompts/${encodeURIComponent(promptId)}/run`, { input, versionId }),

  listRuns: (promptId?: string) =>
    request<PromptRun[]>('GET', promptId ? `/runs?promptId=${encodeURIComponent(promptId)}` : '/runs'),
  deleteRun: (id: string) => request<void>('DELETE', `/runs/${encodeURIComponent(id)}`),
  deleteAllRuns: () => request<void>('DELETE', '/runs'),

  compareRuns: (runIdA: string, runIdB: string) =>
    request<ComparisonResult>('POST', '/runs/compare', { runIdA, runIdB }),

  compareVersions: (versionIdA: string, versionIdB: string) =>
    request<LexicalDiff>('POST', '/versions/compare', { versionIdA, versionIdB }),

  // ─── Test Sets ────────────────────────────────────────────────────────────

  listTestSets: () => request<TestSet[]>('GET', '/test-sets'),
  createTestSet: (data: TestSetCreate) => request<TestSet>('POST', '/test-sets', data),
  getTestSet: (id: string) => request<TestSet>('GET', `/test-sets/${encodeURIComponent(id)}`),
  updateTestSet: (id: string, data: { name?: string; description?: string; inputs?: string[] }) =>
    request<TestSet>('PUT', `/test-sets/${encodeURIComponent(id)}`, data),
  deleteTestSet: (id: string) => request<void>('DELETE', `/test-sets/${encodeURIComponent(id)}`),
  runTestSet: (testSetId: string, promptId: string, versionId: string) =>
    request<TestRunResult[]>('POST', `/test-sets/${encodeURIComponent(testSetId)}/run`, { promptId, versionId }),
  getTestRunResults: (testSetId: string) =>
    request<TestRunResult[]>('GET', `/test-sets/${encodeURIComponent(testSetId)}/results`),
  deleteTestRunResults: (testSetId: string) =>
    request<void>('DELETE', `/test-sets/${encodeURIComponent(testSetId)}/results`),
};
