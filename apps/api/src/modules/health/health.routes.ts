import type { FastifyInstance } from 'fastify';

/** Liveness/readiness probes for Docker/Kubernetes. */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  const quiet = { logLevel: 'warn' as const, config: { rateLimit: false as const } };

  app.get('/live', quiet, async () => ({ status: 'ok' }));

  app.get('/ready', quiet, async (_request, reply) => {
    const checks: Record<string, 'ok' | 'error'> = {};
    await Promise.all([
      app.deps.db.$queryRaw`SELECT 1`.then(
        () => (checks.database = 'ok'),
        () => (checks.database = 'error'),
      ),
      app.deps.redis.ping().then(
        () => (checks.redis = 'ok'),
        () => (checks.redis = 'error'),
      ),
    ]);
    const healthy = Object.values(checks).every((value) => value === 'ok');
    return reply.status(healthy ? 200 : 503).send({ status: healthy ? 'ok' : 'degraded', checks });
  });
}
