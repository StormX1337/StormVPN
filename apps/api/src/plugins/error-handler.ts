import type { FastifyError, FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import type { ApiErrorBody } from '@stormvpn/types';
import { AppError } from '../lib/errors';

function body(code: string, message: string, requestId: string, details?: unknown): ApiErrorBody {
  return { error: { code, message, requestId, ...(details === undefined ? {} : { details }) } };
}

/** Uniform error envelope; internal details are logged but never returned to clients. */
export const errorHandlerPlugin = fp(async (app: FastifyInstance) => {
  app.setErrorHandler((error: FastifyError | AppError | Error, request, reply) => {
    if (error instanceof AppError) {
      if (error.statusCode === 429 && error.details && typeof error.details === 'object') {
        const retry = (error.details as { retryAfterSeconds?: number }).retryAfterSeconds;
        if (retry) void reply.header('retry-after', String(retry));
      }
      return reply
        .status(error.statusCode)
        .send(body(error.code, error.message, request.id, error.details));
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      const issues = error.validation.map((issue) => ({
        path: issue.instancePath.replace(/^\//, '').replace(/\//g, '.'),
        message: issue.message,
      }));
      return reply
        .status(400)
        .send(body('validation_error', 'Request validation failed', request.id, { issues }));
    }
    const statusCode = (error as FastifyError).statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      const code =
        statusCode === 429
          ? 'rate_limited'
          : ((error as FastifyError).code ?? 'bad_request').toLowerCase();
      return reply.status(statusCode).send(body(code, error.message, request.id));
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply
      .status(500)
      .send(body('internal_error', 'An unexpected error occurred', request.id));
  });

  app.setNotFoundHandler((request, reply) => {
    return reply
      .status(404)
      .send(
        body('route_not_found', `Route ${request.method} ${request.url} not found`, request.id),
      );
  });
});
