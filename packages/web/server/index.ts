/**
 * Local API server for the PromptSentry web UI.
 *
 *   PROMPTSENTRY_DB    SQLite file path (default: ./promptsentry.sqlite)
 *   PROMPTSENTRY_PORT  Port to listen on (default: 3001)
 *
 * The Vite dev server proxies /api to this server.
 */
import http from 'node:http';
import { createApp } from './app.js';
import { WorkbenchService } from './service.js';

const dbPath = process.env.PROMPTSENTRY_DB || 'promptsentry.sqlite';
const port = Number(process.env.PROMPTSENTRY_PORT) || 3001;

const service = new WorkbenchService(dbPath);
const server = http.createServer(createApp(service));

server.listen(port, '127.0.0.1', () => {
  console.log(`PromptSentry API listening on http://127.0.0.1:${port} (db: ${dbPath})`);
});

function shutdown() {
  server.close(() => {
    service.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
