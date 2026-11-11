/**
 * End-to-end test of saving and executing prompts through the web API,
 * using an in-memory DB and a fake OpenAI-compatible endpoint.
 * Run with: npm run test -w @sentry-prompt/web
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Prompt, PromptRun, PromptVersion, TestSet, TestRunResult } from '@sentry-prompt/core';
import { createApp } from './app.js';
import { WorkbenchService, renderPrompt } from './service.js';

interface ChatRequest {
  model: string;
  temperature: number;
  max_tokens: number;
  messages: Array<{ role: string; content: string }>;
}

const llmRequests: ChatRequest[] = [];

// Fake OpenAI-compatible endpoint: echoes the last user message.
const llm = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ChatRequest;
      llmRequests.push(body);
      const user = body.messages.filter(m => m.role === 'user').pop()?.content ?? '';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: body.model,
          choices: [
            { index: 0, message: { role: 'assistant', content: `echo: ${user}` }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      );
      return;
    }
    // Any other path behaves like a bad request (not retried by the SDK).
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'bad endpoint' } }));
  });
});

const service = new WorkbenchService(':memory:');
const app = http.createServer(createApp(service));
let llmUrl = '';
let appUrl = '';

async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(appUrl + path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : undefined) as T };
}

function listen(server: http.Server): Promise<string> {
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });
}

before(async () => {
  llmUrl = await listen(llm);
  appUrl = await listen(app);
});

after(() => {
  app.close();
  llm.close();
  service.close();
});

describe('renderPrompt', () => {
  it('substitutes {{input}}', () => {
    assert.equal(renderPrompt('Translate: {{input}}', 'hola'), 'Translate: hola');
  });
  it('appends input when there is no placeholder', () => {
    assert.equal(renderPrompt('Summarize.', 'text'), 'Summarize.\n\ntext');
  });
  it('returns the template alone for empty input', () => {
    assert.equal(renderPrompt('Say hi', '  '), 'Say hi');
  });
});

describe('web API: save and execute prompts', () => {
  let prompt: Prompt;
  let v1: PromptVersion;

  it('reports health', async () => {
    const { status, data } = await api('GET', '/api/health');
    assert.equal(status, 200);
    assert.deepEqual(data, { status: 'ok' });
  });

  it('creates a prompt with an initial version', async () => {
    const { status, data } = await api<{ prompt: Prompt; version: PromptVersion }>('POST', '/api/prompts', {
      name: 'Greeter',
      content: 'Greet {{input}} politely.',
      model: 'test-model',
      temperature: 0.2,
      maxTokens: 64,
      systemPrompt: 'You are kind.',
    });
    assert.equal(status, 201);
    assert.equal(data.prompt.name, 'Greeter');
    assert.equal(data.version.versionNumber, 1);
    assert.equal(data.version.commitMessage, 'Initial version');
    prompt = data.prompt;
    v1 = data.version;

    const list = await api<Prompt[]>('GET', '/api/prompts');
    assert.equal(list.data.length, 1);
  });

  it('rejects a prompt without a name', async () => {
    const { status } = await api('POST', '/api/prompts', { name: ' ', content: 'x' });
    assert.equal(status, 400);
  });

  it('refuses to run before the API is configured', async () => {
    const { status, data } = await api<{ error: string }>('POST', `/api/prompts/${prompt.id}/run`, { input: 'Ada' });
    assert.equal(status, 400);
    assert.match(data.error, /not configured/);
  });

  it('saves API config', async () => {
    const { status, data } = await api('PUT', '/api/config', { baseUrl: `${llmUrl}/v1/`, defaultModel: 'test-model' });
    assert.equal(status, 200);
    assert.equal(data.baseUrl, `${llmUrl}/v1`);
    const read = await api('GET', '/api/config');
    assert.equal(read.data.defaultModel, 'test-model');
  });

  it('commits a new version only when something changed', async () => {
    const edit = await api<{ prompt: Prompt; version: PromptVersion | null }>('PUT', `/api/prompts/${prompt.id}`, {
      content: 'Greet {{input}} warmly.',
      commitMessage: 'warmer',
    });
    assert.equal(edit.status, 200);
    assert.equal(edit.data.prompt.content, 'Greet {{input}} warmly.');
    assert.equal(edit.data.version?.versionNumber, 2);
    assert.equal(edit.data.version?.commitMessage, 'warmer');

    const same = await api('PUT', `/api/prompts/${prompt.id}`, { content: 'Greet {{input}} warmly.' });
    assert.equal(same.data.version, null);

    const params = await api('PUT', `/api/prompts/${prompt.id}`, { temperature: 0.9 });
    assert.equal(params.data.version.versionNumber, 3);
    assert.equal(params.data.version.temperature, 0.9);

    const versions = await api<PromptVersion[]>('GET', `/api/prompts/${prompt.id}/versions`);
    assert.deepEqual(
      versions.data.map(v => v.versionNumber),
      [3, 2, 1],
    );
  });

  it('executes the latest version and persists the run', async () => {
    const { status, data: run } = await api<PromptRun>('POST', `/api/prompts/${prompt.id}/run`, { input: 'Ada' });
    assert.equal(status, 201);
    assert.equal(run.error, undefined);
    assert.equal(run.output, 'echo: Greet Ada warmly.');
    assert.equal(run.tokenCount, 5);
    assert.ok(run.latencyMs >= 0);
    assert.equal(run.model, 'test-model');

    const sent = llmRequests[llmRequests.length - 1];
    assert.equal(sent.model, 'test-model');
    assert.equal(sent.temperature, 0.9);
    assert.equal(sent.max_tokens, 64);
    assert.deepEqual(sent.messages[0], { role: 'system', content: 'You are kind.' });

    const runs = await api<PromptRun[]>('GET', `/api/runs?promptId=${prompt.id}`);
    assert.equal(runs.data.length, 1);
    assert.equal(runs.data[0].id, run.id);

    const one = await api<PromptRun>('GET', `/api/runs/${run.id}`);
    assert.equal(one.data.output, run.output);
  });

  it('executes a specific older version', async () => {
    const { data: run } = await api<PromptRun>('POST', `/api/prompts/${prompt.id}/run`, {
      input: 'Bob',
      versionId: v1.id,
    });
    assert.equal(run.versionId, v1.id);
    assert.equal(run.output, 'echo: Greet Bob politely.');
    assert.equal(llmRequests[llmRequests.length - 1].temperature, 0.2);
  });

  it('records endpoint errors on the run', async () => {
    await api('PUT', '/api/config', { baseUrl: `${llmUrl}/broken/v1` });
    const { status, data: run } = await api<PromptRun>('POST', `/api/prompts/${prompt.id}/run`, { input: 'Eve' });
    assert.equal(status, 201);
    assert.ok(run.error, 'expected run.error to be set');
    assert.equal(run.output, '');
    await api('PUT', '/api/config', { baseUrl: `${llmUrl}/v1` });
  });

  it('compares two runs side by side', async () => {
    // Run the prompt twice with different inputs to get two runs
    const { data: run1 } = await api<PromptRun>('POST', `/api/prompts/${prompt.id}/run`, { input: 'Alice' });
    const { data: run2 } = await api<PromptRun>('POST', `/api/prompts/${prompt.id}/run`, { input: 'Bob' });

    assert.ok(run1.id);
    assert.ok(run2.id);
    assert.notEqual(run1.id, run2.id);

    // Compare the two runs
    const { status, data: comparison } = await api<{
      runA: PromptRun;
      runB: PromptRun;
      lexicalSimilarity: number;
      semanticSimilarity: number;
      latencyDiffMs: number;
      tokenDiff: number;
      lexicalDiff: { addedLines: number; deletedLines: number; commonLines: number };
    }>('POST', '/api/runs/compare', { runIdA: run1.id, runIdB: run2.id });

    assert.equal(status, 201);
    assert.equal(comparison.runA.id, run1.id);
    assert.equal(comparison.runB.id, run2.id);
    assert.ok(comparison.lexicalSimilarity >= 0 && comparison.lexicalSimilarity <= 1);
    assert.ok(comparison.semanticSimilarity >= 0 && comparison.semanticSimilarity <= 1);
    assert.ok(typeof comparison.latencyDiffMs === 'number');
    assert.ok(typeof comparison.tokenDiff === 'number');
    assert.ok(comparison.lexicalDiff.addedLines >= 0);
    assert.ok(comparison.lexicalDiff.deletedLines >= 0);
  });

  it('rejects compare with missing run IDs', async () => {
    const { status } = await api('POST', '/api/runs/compare', { runIdA: 'abc' });
    assert.equal(status, 400);

    const { status: status2 } = await api('POST', '/api/runs/compare', {});
    assert.equal(status2, 400);
  });

  it('deletes runs and prompts', async () => {
    const runs = await api<PromptRun[]>('GET', '/api/runs');
    assert.ok(runs.data.length >= 3, `expected at least 3 runs, got ${runs.data.length}`);
    assert.equal((await api('DELETE', `/api/runs/${runs.data[0].id}`)).status, 204);
    assert.equal((await api<PromptRun[]>('GET', '/api/runs')).data.length, runs.data.length - 1);

    assert.equal((await api('DELETE', `/api/prompts/${prompt.id}`)).status, 204);
    assert.equal((await api('GET', `/api/prompts/${prompt.id}`)).status, 404);
    assert.equal((await api<PromptRun[]>('GET', '/api/runs')).data.length, 0);
  });

  it('returns 404 for unknown routes', async () => {
    assert.equal((await api('GET', '/api/nope')).status, 404);
  });
});

describe('web API: test sets', () => {
  let prompt: Prompt;
  let v1: PromptVersion;
  let testSetId: string;

  before(async () => {
    // Create a dedicated prompt for test set tests (the main suite deletes its prompt)
    const { data } = await api<{ prompt: Prompt; version: PromptVersion }>('POST', '/api/prompts', {
      name: 'Test Set Prompt',
      content: 'Respond to: {{input}}',
      model: 'test-model',
      temperature: 0.2,
      maxTokens: 64,
    });
    prompt = data.prompt;
    v1 = data.version;
  });

  it('creates a test set with inputs', async () => {
    const { status, data } = await api('POST', '/api/test-sets', {
      name: 'Greeting Tests',
      description: 'Test various greetings',
      inputs: ['Hello', 'Hi there', 'Good morning'],
    });
    assert.equal(status, 201);
    assert.equal(data.name, 'Greeting Tests');
    assert.equal(data.description, 'Test various greetings');
    assert.deepEqual(data.inputs, ['Hello', 'Hi there', 'Good morning']);
    assert.ok(data.id);
    assert.ok(data.createdAt);
    assert.ok(data.updatedAt);
    testSetId = data.id;
  });

  it('rejects a test set without a name', async () => {
    const { status } = await api('POST', '/api/test-sets', { name: ' ', inputs: ['x'] });
    assert.equal(status, 400);
  });

  it('creates a test set with no inputs', async () => {
    const { status, data } = await api('POST', '/api/test-sets', { name: 'Empty Set' });
    assert.equal(status, 201);
    assert.deepEqual(data.inputs, []);
  });

  it('lists test sets', async () => {
    const { status, data } = await api<TestSet[]>('GET', '/api/test-sets');
    assert.equal(status, 200);
    assert.ok(data.length >= 2);
    const found = data.find(ts => ts.id === testSetId);
    assert.ok(found);
    assert.equal(found.name, 'Greeting Tests');
    assert.deepEqual(found.inputs, ['Hello', 'Hi there', 'Good morning']);
  });

  it('gets a specific test set', async () => {
    const { status, data } = await api<TestSet>('GET', `/api/test-sets/${testSetId}`);
    assert.equal(status, 200);
    assert.equal(data.name, 'Greeting Tests');
    assert.deepEqual(data.inputs, ['Hello', 'Hi there', 'Good morning']);
  });

  it('returns 404 for unknown test set', async () => {
    const { status } = await api('GET', '/api/test-sets/nonexistent-id');
    assert.equal(status, 404);
  });

  it('updates a test set', async () => {
    const { status, data } = await api<TestSet>('PUT', `/api/test-sets/${testSetId}`, {
      name: 'Updated Greeting Tests',
      description: 'Updated description',
      inputs: ['Hello', 'Hi'],
    });
    assert.equal(status, 200);
    assert.equal(data.name, 'Updated Greeting Tests');
    assert.equal(data.description, 'Updated description');
    assert.deepEqual(data.inputs, ['Hello', 'Hi']);
  });

  it('executes a test set against a prompt', async () => {
    // First ensure API is configured
    await api('PUT', '/api/config', { baseUrl: `${llmUrl}/v1`, defaultModel: 'test-model' });

    const { status, data } = await api<TestRunResult[]>('POST', `/api/test-sets/${testSetId}/run`, {
      promptId: prompt.id,
      versionId: v1.id,
    });
    assert.equal(status, 201);
    assert.ok(data.length > 0);
    assert.ok(data.every(r => r.testSetId === testSetId));
    assert.ok(data.every(r => r.promptId === prompt.id));
    assert.ok(data.every(r => r.versionId === v1.id));
    assert.ok(data.every(r => r.latencyMs >= 0));
    assert.ok(data.every(r => r.tokenCount >= 0));
    // Check that outputs are present (echo from fake LLM)
    assert.ok(data.every(r => r.output.includes('echo:')));
  });

  it('gets test run results', async () => {
    const { status, data } = await api<TestRunResult[]>('GET', `/api/test-sets/${testSetId}/results`);
    assert.equal(status, 200);
    assert.ok(data.length >= 2); // at least the 2 inputs from the updated test set
    assert.ok(data.every(r => r.testSetId === testSetId));
  });

  it('deletes test run results', async () => {
    await api('DELETE', `/api/test-sets/${testSetId}/results`);
    const { status, data } = await api<TestRunResult[]>('GET', `/api/test-sets/${testSetId}/results`);
    assert.equal(status, 200);
    assert.equal(data.length, 0);
  });

  it('deletes a test set and its results', async () => {
    // Create a test set with results
    const { status: createStatus, data: ts } = await api<TestSet>('POST', '/api/test-sets', {
      name: 'Delete Me',
      inputs: ['test'],
    });
    assert.equal(createStatus, 201);
    assert.ok(ts.id);

    const { status: runStatus } = await api<TestRunResult[]>('POST', `/api/test-sets/${ts.id}/run`, {
      promptId: prompt.id,
      versionId: v1.id,
    });
    assert.equal(runStatus, 201);

    // Verify it exists
    const { status: getBefore } = await api<TestRunResult[]>('GET', `/api/test-sets/${ts.id}/results`);
    assert.equal(getBefore, 200);

    // Delete the test set
    const { status } = await api('DELETE', `/api/test-sets/${ts.id}`);
    assert.equal(status, 204);

    // Verify it's gone
    const { status: getAfter } = await api('GET', `/api/test-sets/${ts.id}`);
    assert.equal(getAfter, 404);
  });

  it('rejects running a test set with a nonexistent prompt', async () => {
    const { status } = await api('POST', `/api/test-sets/${testSetId}/run`, {
      promptId: 'nonexistent-prompt-id',
      versionId: v1.id,
    });
    assert.equal(status, 404);
  });

  it('rejects running a test set with missing promptId', async () => {
    const { status } = await api('POST', `/api/test-sets/${testSetId}/run`, { versionId: v1.id });
    assert.equal(status, 400);
  });

  it('rejects running a test set with missing versionId', async () => {
    const { status } = await api('POST', `/api/test-sets/${testSetId}/run`, { promptId: prompt.id });
    assert.equal(status, 400);
  });
});
