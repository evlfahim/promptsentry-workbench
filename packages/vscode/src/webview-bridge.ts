/**
 * Webview bridge — intercepts fetch() calls to /api/* and routes them through
 * VS Code's postMessage / receiveMessage pattern so the React UI can talk to
 * the extension's core logic without needing a separate HTTP server.
 *
 * Message protocol:
 *   Webview → Extension:  { type: 'api-request', id, method, path, body }
 *   Extension → Webview:  { type: 'api-response', id, status, body }
 *   Extension → Webview:  { type: 'error', message }
 *   Webview → Extension:  { type: 'ready' }
 *   Extension → Webview:  { type: 'ready' }
 *
 * All other message types are passed through unchanged.
 */

// ─── Global state ────────────────────────────────────────────────────────────

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

interface PendingRequest {
  resolve: (value: Response) => void;
  reject: (reason: Error) => void;
}

const pendingRequests = new Map<string, PendingRequest>();
let vscodeApi: VsCodeApi | null = null;
let ready = false;

// ─── Message handler ─────────────────────────────────────────────────────────

function onMessage(event: MessageEvent) {
  const msg = event.data as Record<string, unknown>;
  if (!msg || typeof msg !== 'object') return;

  switch (msg.type) {
    case 'ready':
      ready = true;
      break;

    case 'api-response': {
      const id = msg.id as string | undefined;
      if (!id) break;
      const pending = pendingRequests.get(id);
      if (!pending) break;
      pendingRequests.delete(id);

      const status = typeof msg.status === 'number' ? msg.status : 200;
      const body = msg.body;

      // Build a Response-like object
      let bodyText = '';
      if (body !== undefined && body !== null) {
        if (typeof body === 'string') {
          bodyText = body;
        } else {
          bodyText = JSON.stringify(body);
        }
      }

      const response = new Response(bodyText, {
        status,
        headers: new Headers({ 'Content-Type': 'application/json' }),
      });
      (response as any)._rawBody = body; // keep parsed body for convenience
      pending.resolve(response);
      break;
    }

    case 'error': {
      const message = msg.message as string;
      // Reject all pending requests on error
      for (const [id, pending] of pendingRequests) {
        pending.reject(new Error(message));
        pendingRequests.delete(id);
      }
      break;
    }

    default:
      // Pass through other message types to the extension
      if (vscodeApi) {
        vscodeApi.postMessage(msg);
      }
  }
}

// ─── Fetch interceptor ───────────────────────────────────────────────────────

let originalFetch: typeof fetch | undefined;

function installFetchInterceptor() {
  originalFetch = window.fetch;

  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(input.toString(), window.location.href);

    // Only intercept /api/* requests
    if (!url.pathname.startsWith('/api/')) {
      return originalFetch!.call(window, input, init);
    }

    const method = (init?.method ?? 'GET').toUpperCase();
    let body: unknown = init?.body;

    // For POST/PUT/PATCH, parse the body
    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      if (body instanceof FormData) {
        // FormData not supported via postMessage; serialize
        const obj: Record<string, string> = {};
        body.forEach((value, key) => {
          obj[key] = typeof value === 'string' ? value : value.name;
        });
        body = obj;
      } else if (body instanceof URLSearchParams) {
        body = Object.fromEntries(body.entries());
      } else if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch {
          // Keep as string
        }
      }
    }

    // Generate a unique request ID
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // Create a promise that will be resolved when the extension responds
    const responsePromise = new Promise<Response>((resolve, reject) => {
      pendingRequests.set(requestId, { resolve, reject });
    });

    // Send the request to the extension
    if (vscodeApi) {
      vscodeApi.postMessage({
        type: 'api-request',
        id: requestId,
        method,
        path: url.pathname + url.search,
        body,
      });
    }

    return responsePromise;
  };
}

// ─── Initialization ──────────────────────────────────────────────────────────

function initBridge() {
  try {
    // @ts-expect-error — acquireVsCodeApi is provided by VS Code at runtime
    vscodeApi = window.acquireVsCodeApi();
  } catch {
    console.error('Failed to acquire VS Code API');
    return;
  }

  // Install the fetch interceptor
  installFetchInterceptor();

  // Listen for messages from the extension
  window.addEventListener('message', onMessage);

  // Send ready signal
  if (vscodeApi) {
    vscodeApi.postMessage({ type: 'ready' });
  }
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initBridge);
} else {
  initBridge();
}
