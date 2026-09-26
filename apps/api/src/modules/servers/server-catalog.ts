import type { Database, NodeStatus, VPNNode, VPNServer } from '@stormvpn/database';
import type { Clock } from '../../lib/clock';

export type ServerWithNode = VPNServer & { node: VPNNode | null };

/**
 * Effective availability as seen by customers: combines the admin controlled
 * server state, the emergency kill switch and heartbeat freshness.
 */
export function effectiveStatus(
  server: ServerWithNode,
  now: Date,
  offlineAfterSeconds: number,
): NodeStatus {
  if (server.status === 'MAINTENANCE') return 'MAINTENANCE';
  if (server.status === 'DISABLED' || server.killSwitchEngaged) return 'OFFLINE';
  const node = server.node;
  if (!node?.lastHeartbeatAt) return 'OFFLINE';
  if (now.getTime() - node.lastHeartbeatAt.getTime() > offlineAfterSeconds * 1000) return 'OFFLINE';
  return node.status;
}

/**
 * Read model of all servers + node metrics. Cached for a few seconds per API
 * instance: server lists are read on every dashboard view and quick connect,
 * while metrics only change with heartbeats.
 */
export class ServerCatalog {
  private cache: { servers: ServerWithNode[]; expiresAt: number } | undefined;

  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    private readonly offlineAfterSeconds: number,
    private readonly ttlMs = 3_000,
  ) {}

  async list(): Promise<ServerWithNode[]> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) return this.cache.servers;
    const servers = await this.db.vPNServer.findMany({
      where: { deletedAt: null },
      include: { node: true },
      orderBy: [{ countryCode: 'asc' }, { city: 'asc' }, { name: 'asc' }],
    });
    this.cache = { servers, expiresAt: now + this.ttlMs };
    return servers;
  }

  /** Servers visible to customers (disabled servers are hidden). */
  async listVisible(): Promise<ServerWithNode[]> {
    return (await this.list()).filter((server) => server.status !== 'DISABLED');
  }

  async get(id: string): Promise<ServerWithNode | null> {
    return (await this.list()).find((server) => server.id === id) ?? null;
  }

  status(server: ServerWithNode): NodeStatus {
    return effectiveStatus(server, this.clock.now(), this.offlineAfterSeconds);
  }

  invalidate(): void {
    this.cache = undefined;
  }
}
