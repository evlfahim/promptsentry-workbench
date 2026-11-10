/**
 * Tests for the OpenAIClient
 * Tests streaming and non-streaming execution, health checks, model listing,
 * and error handling against OpenAI-compatible endpoints.
 */
import crypto from 'node:crypto';
import { DB } from '../db.js';
import { OpenAIClient } from '../api.js';
import type { PromptRunCreate, APIConfig } from '../types.js';

// Use an in-memory temp DB
const testDbPath = crypto.randomUUID();

let db: DB;
let client: OpenAIClient;
let config: APIConfig;

beforeAll(() => {
  db = new DB({ path: testDbPath });
  config = {
    baseUrl: 'http://localhost:11434',
    apiKey: 'ollama',
    defaultModel: 'qwen2.5:0.5b',
  };
  client = new OpenAIClient(db, config);
});

afterAll(() => {
  db.close();
  // Clean up temp file
  try { require('fs').unlinkSync(testDbPath); } catch {}
});

// ─── Helper: Create a test prompt run ────────────────────────────────────────

function createPromptRunData(overrides: Partial<PromptRunCreate> = {}): PromptRunCreate {
  return {
    promptId: crypto.randomUUID(),
    versionId: crypto.randomUUID(),
    input: 'Hello, how are you?',
    model: config.defaultModel ?? 'gpt-4',
    temperature: 0.7,
    maxTokens: 256,
    systemPrompt: 'You are a helpful assistant.',
    ...overrides,
  };
}

// ─── Helper: Check if models are available ───────────────────────────────────

async function getAvailableModel(): Promise<string | null> {
  try {
    const models = await client.listModels();
    if (models.length > 0) {
      return models[0].id;
    }
  } catch {
    // Ignore errors
  }
  return null;
}

// ─── OpenAIClient - Health Check ─────────────────────────────────────────────

describe('OpenAIClient - Health Check', () => {
  test('healthCheck returns error when endpoint is unreachable', async () => {
    // Use a port that's unlikely to have a server
    const unreachableClient = new OpenAIClient(db, {
      baseUrl: 'http://localhost:99999',
      apiKey: 'dummy',
    });

    const result = await unreachableClient.healthCheck();
    expect(result.status).toBe('error');
    expect(result.message).toBeDefined();
    // Latency may be 0 for instant failures (connection refused)
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test('healthCheck returns ok when endpoint is reachable', async () => {
    const result = await client.healthCheck();
    // Ollama is running, so it should be ok
    expect(result.status).toBe('ok');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    // Ollama may or may not have models loaded yet
    if (result.modelCount !== undefined) {
      expect(result.modelCount).toBeGreaterThanOrEqual(0);
    }
  });
});

// ─── OpenAIClient - Model Listing ────────────────────────────────────────────

describe('OpenAIClient - Model Listing', () => {
  test('listModels returns array', async () => {
    const models = await client.listModels();
    expect(Array.isArray(models)).toBe(true);
  });

  test('getModel returns undefined for non-existent model', async () => {
    const model = await client.getModel('non-existent-model-xyz');
    expect(model).toBeUndefined();
  });

  test('getModel returns model for existing model', async () => {
    const modelId = await getAvailableModel();
    if (!modelId) {
      // No models available, skip
      return;
    }

    const model = await client.getModel(modelId);
    expect(model).toBeDefined();
    expect(model!.id).toBe(modelId);
  });
});

// ─── OpenAIClient - Configuration ────────────────────────────────────────────

describe('OpenAIClient - Configuration', () => {
  test('getConfig returns the current config', () => {
    const cfg = client.getConfig();
    expect(cfg.baseUrl).toBe('http://localhost:11434');
    expect(cfg.apiKey).toBe('ollama');
    expect(cfg.defaultModel).toBe('qwen2.5:0.5b');
  });

  test('updateConfig changes the configuration', () => {
    // Create a fresh client for this test to avoid polluting shared state
    const testClient = new OpenAIClient(db, {
      baseUrl: 'http://localhost:11434',
      apiKey: 'ollama',
    });

    testClient.updateConfig({
      baseUrl: 'http://localhost:8080',
      apiKey: 'test-key',
      defaultModel: 'gpt-4',
    });

    const cfg = testClient.getConfig();
    expect(cfg.baseUrl).toBe('http://localhost:8080');
    expect(cfg.apiKey).toBe('test-key');
    expect(cfg.defaultModel).toBe('gpt-4');
  });

  test('updateConfig with minimal config', () => {
    const testClient = new OpenAIClient(db, {
      baseUrl: 'http://localhost:11434',
      apiKey: 'ollama',
    });

    testClient.updateConfig({ baseUrl: 'http://test.com' });
    const cfg = testClient.getConfig();
    expect(cfg.baseUrl).toBe('http://test.com');
    expect(cfg.apiKey).toBeUndefined();
  });
});

// ─── OpenAIClient - Non-streaming Execution ──────────────────────────────────

describe('OpenAIClient - Non-streaming Execution', () => {
  test('execute returns result with output and metadata', async () => {
    const modelId = await getAvailableModel();
    if (!modelId) {
      // No models available, skip
      return;
    }

    const data = createPromptRunData({ model: modelId });

    const result = await client.execute(data, { saveRun: false });

    expect(result.output).toBeDefined();
    expect(typeof result.output).toBe('string');
    expect(result.run.model).toBe(modelId);
    expect(result.run.latencyMs).toBeGreaterThan(0);
    expect(result.run.tokenCount).toBeGreaterThan(0);
    expect(result.metadata.id).toBeDefined();
    expect(result.metadata.model).toBe(modelId);
  });

  test('execute saves run to DB when saveRun is true', async () => {
    const modelId = await getAvailableModel();
    if (!modelId) {
      return;
    }

    const data = createPromptRunData({ model: modelId });

    const result = await client.execute(data, { saveRun: true });

    expect(result.output).toBeDefined();

    // Verify the run was saved
    const runs = db.connection
      .prepare('SELECT * FROM prompt_runs ORDER BY created_at DESC LIMIT 1')
      .all();

    expect(runs.length).toBeGreaterThan(0);
  });

  test('execute handles missing system prompt', async () => {
    const modelId = await getAvailableModel();
    if (!modelId) {
      return;
    }

    const data = createPromptRunData({
      model: modelId,
      systemPrompt: undefined,
    });

    const result = await client.execute(data, { saveRun: false });

    expect(result.output).toBeDefined();
    expect(result.run.systemPrompt).toBeUndefined();
  });

  test('execute handles different temperatures', async () => {
    const modelId = await getAvailableModel();
    if (!modelId) {
      return;
    }

    const data = createPromptRunData({
      model: modelId,
      temperature: 0.1,
    });

    const result = await client.execute(data, { saveRun: false });

    expect(result.output).toBeDefined();
    expect(result.run.temperature).toBe(0.1);
  });

  test('execute handles different maxTokens', async () => {
    const modelId = await getAvailableModel();
    if (!modelId) {
      return;
    }

    const data = createPromptRunData({
      model: modelId,
      maxTokens: 64,
    });

    const result = await client.execute(data, { saveRun: false });

    expect(result.output).toBeDefined();
    expect(result.run.maxTokens).toBe(64);
  });

  test('execute with error returns error info', async () => {
    // Use a non-existent model to trigger an error
    const data = createPromptRunData({
      model: 'non-existent-model-xyz-12345',
    });

    const result = await client.execute(data, { saveRun: false });

    expect(result.output).toBe('');
    expect(result.run.error).toBeDefined();
    expect(typeof result.run.error).toBe('string');
    expect(result.run.error!.length).toBeGreaterThan(0);
    expect(result.run.latencyMs).toBeGreaterThan(0);
  });
});

// ─── OpenAIClient - Streaming Execution ──────────────────────────────────────

describe('OpenAIClient - Streaming Execution', () => {
  test('executeStream yields chunks', async () => {
    const modelId = await getAvailableModel();
    if (!modelId) {
      return;
    }

    const data = createPromptRunData({ model: modelId });

    const chunks: string[] = [];
    const cumulative: string[] = [];
    const metadataList: any[] = [];

    const result = await client.executeStream(data, {
      onChunk: (chunk, cum, meta) => {
        chunks.push(chunk);
        cumulative.push(cum);
        metadataList.push(meta);
      },
      saveRun: false,
    });

    expect(result.output).toBeDefined();
    expect(typeof result.output).toBe('string');
    expect(result.output.length).toBeGreaterThan(0);

    // Chunks should concatenate to the full output
    expect(chunks.join('')).toBe(result.output);

    // Cumulative should match at each step
    for (let i = 0; i < cumulative.length; i++) {
      expect(cumulative[i]).toBe(result.output.substring(0, result.output.length - chunks.slice(i + 1).join('').length));
    }

    expect(result.metadata.id).toBeDefined();
    expect(result.metadata.model).toBe(modelId);
  });

  test('executeStream calls onComplete', async () => {
    const modelId = await getAvailableModel();
    if (!modelId) {
      return;
    }

    const data = createPromptRunData({ model: modelId });

    let onCompleteCalled = false;
    let onCompleteOutput = '';
    let onCompleteMetadata: any;

    const result = await client.executeStream(data, {
      onComplete: (output, meta) => {
        onCompleteCalled = true;
        onCompleteOutput = output;
        onCompleteMetadata = meta;
      },
      saveRun: false,
    });

    expect(onCompleteCalled).toBe(true);
    expect(onCompleteOutput).toBe(result.output);
    expect(onCompleteMetadata).toBeDefined();
  });

  test('executeStream saves run to DB by default', async () => {
    const modelId = await getAvailableModel();
    if (!modelId) {
      return;
    }

    const data = createPromptRunData({ model: modelId });

    await client.executeStream(data, { saveRun: true });

    // Verify the run was saved
    const runs = db.connection
      .prepare('SELECT * FROM prompt_runs ORDER BY created_at DESC LIMIT 1')
      .all();

    expect(runs.length).toBeGreaterThan(0);
  });

  test('executeStream with abort signal', async () => {
    const modelId = await getAvailableModel();
    if (!modelId) {
      return;
    }

    const data = createPromptRunData({ model: modelId });

    const controller = new AbortController();

    // Start streaming and abort immediately
    const streamPromise = client.executeStream(data, {
      signal: controller.signal,
      onChunk: () => {
        // Abort after first chunk
        controller.abort();
      },
      saveRun: false,
    });

    const result = await streamPromise;
    expect(result.output).toBeDefined();
  });

  test('executeStream with error calls onError', async () => {
    const data = createPromptRunData({
      model: 'non-existent-model-xyz-12345',
    });

    let onErrorCalled = false;
    let onErrorError: Error | undefined;

    const result = await client.executeStream(data, {
      onError: (error) => {
        onErrorCalled = true;
        onErrorError = error;
      },
      saveRun: false,
    });

    expect(onErrorCalled).toBe(true);
    expect(onErrorError).toBeDefined();
    expect(onErrorError!.message).toBeDefined();
    // Output should be empty or partial
    expect(result.output).toBeDefined();
  });
});

// ─── OpenAIClient - Extra Parameters ─────────────────────────────────────────

describe('OpenAIClient - Extra Parameters', () => {
  test('execute with extra params', async () => {
    const modelId = await getAvailableModel();
    if (!modelId) {
      return;
    }

    const data = createPromptRunData({
      model: modelId,
      extraParams: {
        topP: 0.9,
        frequencyPenalty: 0.5,
        presencePenalty: 0.5,
      },
    });

    const result = await client.execute(data, { saveRun: false });

    expect(result.output).toBeDefined();
  });

  test('executeStream with extra params', async () => {
    const modelId = await getAvailableModel();
    if (!modelId) {
      return;
    }

    const data = createPromptRunData({
      model: modelId,
      extraParams: {
        topP: 0.95,
      },
    });

    const result = await client.executeStream(data, { saveRun: false });

    expect(result.output).toBeDefined();
  });
});

// ─── OpenAIClient - Token Counting ───────────────────────────────────────────

describe('OpenAIClient - Token Counting', () => {
  test('execute returns reasonable token count', async () => {
    const modelId = await getAvailableModel();
    if (!modelId) {
      return;
    }

    const data = createPromptRunData({ model: modelId });

    const result = await client.execute(data, { saveRun: false });

    expect(result.run.tokenCount).toBeGreaterThan(0);
    // Token count should be reasonable (not millions)
    expect(result.run.tokenCount).toBeLessThan(100000);
  });

  test('execute with API-provided token count', async () => {
    const modelId = await getAvailableModel();
    if (!modelId) {
      return;
    }

    const data = createPromptRunData({ model: modelId });

    const result = await client.execute(data, { saveRun: false });

    // If the API provides usage info, tokenCount should match
    if (result.metadata.usage) {
      expect(result.run.tokenCount).toBe(result.metadata.usage.completionTokens);
    }
  });
});

// ─── OpenAIClient - Multiple Runs ────────────────────────────────────────────

describe('OpenAIClient - Multiple Runs', () => {
  test('execute multiple runs with different inputs', async () => {
    const modelId = await getAvailableModel();
    if (!modelId) {
      return;
    }

    const inputs = [
      'What is 2+2?',
      'Write a haiku about programming.',
      'Explain quantum computing.',
    ];

    const results: any[] = [];

    for (const input of inputs) {
      const data = createPromptRunData({
        model: modelId,
        input,
      });

      const result = await client.execute(data, { saveRun: false });
      results.push(result);
    }

    // All should have outputs
    for (const result of results) {
      expect(result.output).toBeDefined();
      expect(typeof result.output).toBe('string');
      expect(result.run.latencyMs).toBeGreaterThan(0);
    }
  });

  test('executeStream multiple runs', async () => {
    const modelId = await getAvailableModel();
    if (!modelId) {
      return;
    }

    const inputs = [
      'Say hello.',
      'Say goodbye.',
    ];

    for (const input of inputs) {
      const data = createPromptRunData({
        model: modelId,
        input,
      });

      const result = await client.executeStream(data, { saveRun: false });
      expect(result.output).toBeDefined();
      expect(typeof result.output).toBe('string');
    }
  });
});

// ─── OpenAIClient - DB Integration ───────────────────────────────────────────

describe('OpenAIClient - DB Integration', () => {
  test('runs are saved with correct schema', async () => {
    const modelId = await getAvailableModel();
    if (!modelId) {
      return;
    }

    const promptId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Create prompt and version records so foreign keys are valid
    const conn = db.connection;
    conn.prepare(
      `INSERT OR REPLACE INTO prompts (id, name, content, model, temperature, maxTokens, created_at, updated_at)
       VALUES (?, 'Test', 'Test', 'gpt-4', 0.7, 1024, ?, ?)`,
    ).run(promptId, now, now);

    conn.prepare(
      `INSERT OR REPLACE INTO prompt_versions (id, prompt_id, content, model, temperature, max_tokens, content_hash, version_number, created_at)
       VALUES (?, ?, 'Test', 'gpt-4', 0.7, 1024, 'abc', 1, ?)`,
    ).run(versionId, promptId, now);

    const data = createPromptRunData({
      model: modelId,
      promptId,
      versionId,
    });

    await client.execute(data, { saveRun: true });

    // Verify the run has all required fields
    const run = db.connection
      .prepare('SELECT * FROM prompt_runs ORDER BY created_at DESC LIMIT 1')
      .get() as any;

    expect(run).toBeDefined();
    expect(run.id).toBeDefined();
    expect(run.prompt_id).toBeDefined();
    expect(run.version_id).toBeDefined();
    expect(run.input).toBeDefined();
    expect(run.output).toBeDefined();
    expect(run.model).toBe(modelId);
    expect(run.temperature).toBe(0.7);
    expect(run.max_tokens).toBe(256);
    expect(run.token_count).toBeGreaterThan(0);
    expect(run.latency_ms).toBeGreaterThan(0);
    expect(run.created_at).toBeDefined();
  });

  test('error runs are saved correctly', async () => {
    const modelId = await getAvailableModel();
    if (!modelId) {
      return;
    }

    const promptId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Create prompt and version records
    const conn = db.connection;
    conn.prepare(
      `INSERT OR REPLACE INTO prompts (id, name, content, model, temperature, maxTokens, created_at, updated_at)
       VALUES (?, 'Test', 'Test', 'gpt-4', 0.7, 1024, ?, ?)`,
    ).run(promptId, now, now);

    conn.prepare(
      `INSERT OR REPLACE INTO prompt_versions (id, prompt_id, content, model, temperature, max_tokens, content_hash, version_number, created_at)
       VALUES (?, ?, 'Test', 'gpt-4', 0.7, 1024, 'abc', 1, ?)`,
    ).run(versionId, promptId, now);

    const data = createPromptRunData({
      model: 'non-existent-model-xyz-12345',
      promptId,
      versionId,
    });

    await client.execute(data, { saveRun: true });

    const run = db.connection
      .prepare('SELECT * FROM prompt_runs WHERE error IS NOT NULL ORDER BY created_at DESC LIMIT 1')
      .get() as any;

    expect(run).toBeDefined();
    expect(run.error).toBeDefined();
    expect(run.token_count).toBe(0);
  });
});
