import { Prisma } from '../generated/prisma/client';

/** True when the error is a unique constraint violation (optionally on a given field). */
export function isUniqueViolation(error: unknown, field?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  if (!field) return true;
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  const fields = Array.isArray(target) ? target.map(String) : typeof target === 'string' ? [target] : [];
  const message = error.message;
  return fields.some((item) => item.includes(field)) || message.includes(field);
}

export function isNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}

/** Serialization failure / deadlock – safe to retry the transaction. */
export function isRetryableTransactionError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2028'].includes(error.code);
}
