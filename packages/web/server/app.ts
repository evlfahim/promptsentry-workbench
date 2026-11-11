/**
 * HTTP routes for the PromptSentry web UI. Plain node:http, JSON in/out.
 *
 *   GET    /api/health
 *   GET    /api/config                PUT /api/config
 *   GET    /api/prompts               POST /api/prompts
 *   GET    /api/prompts/:id           PUT /api/prompts/:id      DELETE /api/prompts/:id
 *   GET    /api/prompts/:id/versions
 *   POST   /api/prompts/:id/run       { input, versionId? }
 *   GET    /api/versions
 *   GET    /api/runs[?promptId=]      DELETE /api/runs
 *   GET    /api/runs/:id              DELETE /api/runs/:id
 *   POST   /api/runs/compare          { runIdA, runIdB }
 *   POST   /api/versions/compare      { versionIdA, versionIdB }
 *   GET    /api/test-sets             POST /api/test-sets
 *   GET    /api/test-sets/:id         PUT /api/test-sets/:id      DELETE /api/test-sets/:id
 *   POST   /api/test-sets/:id/run     { promptId, versionId }
 *   GET    /api/test-sets/:id/results
 *   DELETE /api/test-sets/:id/results
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ServiceError, type WorkbenchService } from './service.js';

type Handler = (
  params: string[],
  body: any,
  query: URLSearchParams,
) => unknown | Promise<unknown>;

interface Route {
  method: string;
  pattern: RegExp;
  handler: Handler;
}

const MAX_BODY_BYTES = 5 * 1024 * 1024;

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new ServiceError(413, 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new ServiceError(400, 'Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, data: unknown): void {
  if (status === 204) {
    res.writeHead(204);
    res.end();
    return;
  }
  const json = JSON.stringify(data ?? null);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

export function createApp(service: WorkbenchService) {
  const routes: Route[] = [];
  const add = (method: string, path: string, handler: Handler) => {
    const pattern = new RegExp('^' + path.replace(/:\w+/g, '([^/]+)') + '/?$');
    routes.push({ method, pattern, handler });
  };

  add('GET', '/api/health', () => ({ status: 'ok' }));

  add('GET', '/api/config', () => service.getAPIConfig() ?? null);
  add('PUT', '/api/config', (_p, body) => service.setAPIConfig(body ?? {}));

  add('GET', '/api/prompts', () => service.listPrompts());
  add('POST', '/api/prompts', (_p, body) => service.createPrompt(body ?? {}));
  add('GET', '/api/prompts/:id', ([id]) => {
    const prompt = service.getPrompt(id);
    if (!prompt) throw new ServiceError(404, `Prompt ${id} not found`);
    return prompt;
  });
  add('PUT', '/api/prompts/:id', ([id], body) => service.updatePrompt(id, body ?? {}));
  add('DELETE', '/api/prompts/:id', ([id]) => {
    service.deletePrompt(id);
    return undefined;
  });
  add('GET', '/api/prompts/:id/versions', ([id]) => service.listVersions(id));
  add('POST', '/api/prompts/:id/run', ([id], body) => {
    const input = typeof body?.input === 'string' ? body.input : '';
    const versionId = typeof body?.versionId === 'string' && body.versionId ? body.versionId : undefined;
    return service.executePrompt(id, input, versionId);
  });

  add('GET', '/api/versions', () => service.listVersions());

  add('GET', '/api/runs', (_p, _b, query) => service.listRuns(query.get('promptId') ?? undefined));
  add('DELETE', '/api/runs', () => {
    service.deleteAllRuns();
    return undefined;
  });
  add('GET', '/api/runs/:id', ([id]) => {
    const run = service.getRun(id);
    if (!run) throw new ServiceError(404, `Run ${id} not found`);
    return run;
  });
  add('DELETE', '/api/runs/:id', ([id]) => {
    service.deleteRun(id);
    return undefined;
  });

  add('POST', '/api/runs/compare', (_p, body) => {
    const runIdA = typeof body?.runIdA === 'string' ? body.runIdA : '';
    const runIdB = typeof body?.runIdB === 'string' ? body.runIdB : '';
    if (!runIdA || !runIdB) throw new ServiceError(400, 'runIdA and runIdB are required');
    return service.compareRuns(runIdA, runIdB);
  });

  add('POST', '/api/versions/compare', (_p, body) => {
    const versionIdA = typeof body?.versionIdA === 'string' ? body.versionIdA : '';
    const versionIdB = typeof body?.versionIdB === 'string' ? body.versionIdB : '';
    if (!versionIdA || !versionIdB) throw new ServiceError(400, 'versionIdA and versionIdB are required');
    return service.getVersionDiff(versionIdA, versionIdB);
  });

  // ─── Test Sets ────────────────────────────────────────────────────────────

  add('GET', '/api/test-sets', () => service.listTestSets());
  add('POST', '/api/test-sets', (_p, body) => service.createTestSet(body ?? {}));
  add('GET', '/api/test-sets/:id', ([id]) => {
    const ts = service.getTestSet(id);
    if (!ts) throw new ServiceError(404, `Test set ${id} not found`);
    return ts;
  });
  add('PUT', '/api/test-sets/:id', ([id], body) => service.updateTestSet(id, body ?? {}));
  add('DELETE', '/api/test-sets/:id', ([id]) => {
    service.deleteTestSet(id);
    return undefined;
  });
  add('POST', '/api/test-sets/:id/run', async ([id], body) => {
    const promptId = typeof body?.promptId === 'string' ? body.promptId : '';
    const versionId = typeof body?.versionId === 'string' ? body.versionId : '';
    if (!promptId) throw new ServiceError(400, 'promptId is required');
    if (!versionId) throw new ServiceError(400, 'versionId is required');
    return service.runTestSet(id, promptId, versionId);
  });
  add('GET', '/api/test-sets/:id/results', ([id]) => service.getTestRunResults(id));
  add('DELETE', '/api/test-sets/:id/results', ([id]) => {
    service.deleteTestRunResults(id);
    return undefined;
  });

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';

    try {
      let pathMatched = false;
      for (const route of routes) {
        const match = route.pattern.exec(url.pathname);
        if (!match) continue;
        pathMatched = true;
        if (route.method !== method) continue;

        const body = method === 'GET' || method === 'DELETE' ? undefined : await readBody(req);
        const params = match.slice(1).map(decodeURIComponent);
        const result = await route.handler(params, body, url.searchParams);
        send(res, result === undefined ? 204 : method === 'POST' ? 201 : 200, result);
        return;
      }
      send(res, pathMatched ? 405 : 404, { error: pathMatched ? 'Method not allowed' : 'Not found' });
    } catch (err) {
      if (err instanceof ServiceError) {
        send(res, err.status, { error: err.message });
      } else {
        console.error(err);
        send(res, 500, { error: err instanceof Error ? err.message : 'Internal server error' });
      }
    }
  };
}
