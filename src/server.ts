import http from 'node:http';

type Middleware = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  next: (err?: Error) => void,
) => void;

/**
 * Compose the HTTP server. Order: `/health`, then the setup-page middleware (Phase 12b —
 * calls next() for non-`/setup` paths), then the Probot webhook middleware, then 404.
 * Both middlewares are optional so tests and earlier phases work unchanged.
 */
export function createServer(webhookMiddleware?: Middleware, setupMiddleware?: Middleware): http.Server {
  const notFound = (res: http.ServerResponse): void => {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  };

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    const runWebhook = (): void => {
      if (webhookMiddleware) {
        webhookMiddleware(req, res, () => notFound(res));
      } else {
        notFound(res);
      }
    };

    if (setupMiddleware) {
      setupMiddleware(req, res, runWebhook);
    } else {
      runWebhook();
    }
  });

  return server;
}
