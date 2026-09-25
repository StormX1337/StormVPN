import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

export interface CreatePrismaClientOptions {
  url: string;
  /** Max pool connections per process (default 10). */
  poolSize?: number;
  logQueries?: boolean;
  applicationName?: string;
}

export type Database = PrismaClient;

/**
 * Creates a Prisma client backed by the node-postgres driver adapter
 * (Prisma 7, no native query engine binary required).
 */
export function createPrismaClient(options: CreatePrismaClientOptions): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: options.url,
    max: options.poolSize ?? 10,
    application_name: options.applicationName ?? 'stormvpn',
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  return new PrismaClient({
    adapter,
    log: options.logQueries ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
}

/** Transaction client type accepted by services that can run inside `$transaction`. */
export type TransactionClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
export type DbClient = PrismaClient | TransactionClient;
