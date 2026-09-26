import { createServer, type Server } from 'node:http';

/** Minimal liveness/readiness endpoint for container orchestration. */
export function startHealthServer(port: number, check: () => Promise<boolean>): Server {
  const server = createServer((request, response) => {
    if (request.url !== '/health') {
      response.writeHead(404).end();
      return;
    }
    check()
      .then((ok) =>
        response
          .writeHead(ok ? 200 : 503, { 'content-type': 'application/json' })
          .end(JSON.stringify({ status: ok ? 'ok' : 'degraded' })),
      )
      .catch(() => response.writeHead(503).end());
  });
  server.listen(port, '0.0.0.0');
  return server;
}
