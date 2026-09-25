import type { Entitlements, SettingsService } from '@stormvpn/core';
import { isServerAllowed } from '@stormvpn/core';
import type { Database } from '@stormvpn/database';
import { getCountry } from '@stormvpn/types';
import { conflict, forbidden, notFound, serviceUnavailable } from '../../lib/errors';
import type { ServerCatalog, ServerWithNode } from '../servers/server-catalog';
import { type Candidate, type SelectionContext, selectServer } from './scoring';

export interface SelectionRequest {
  serverId?: string;
  country?: string;
  region?: string;
  city?: string;
  latencies?: Record<string, number>;
}

export interface SelectionOutcome {
  server: ServerWithNode;
  strategy: 'manual' | 'quick';
  score: number | null;
  reason: string;
}

/** Server Selection Engine: manual choice validation and Quick Connect. */
export class ServerSelectionService {
  constructor(
    private readonly db: Database,
    private readonly catalog: ServerCatalog,
    private readonly settings: SettingsService,
    private readonly random: () => number = Math.random,
  ) {}

  toCandidate(server: ServerWithNode): Candidate {
    return {
      id: server.id,
      name: server.name,
      countryCode: server.countryCode,
      city: server.city,
      region: server.region,
      serverClass: server.serverClass,
      latitude: server.latitude,
      longitude: server.longitude,
      status: this.catalog.status(server),
      load: server.node?.loadPercent ?? 100,
      activeConnections: server.node?.activeConnections ?? 0,
      capacity: server.capacity,
    };
  }

  async resolve(
    userId: string,
    entitlements: Entitlements,
    request: SelectionRequest,
    edgeCountryCode: string | null,
  ): Promise<SelectionOutcome> {
    const settings = await this.settings.get();
    if (request.serverId) return this.resolveManual(request.serverId, entitlements, settings.serverOverloadThreshold);

    const user = await this.db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { preferredCountry: true, preferredRegion: true, favorites: { select: { serverId: true } } },
    });
    const locationCountry = getCountry(request.country ?? edgeCountryCode ?? user.preferredCountry);
    const ctx: SelectionContext = {
      allowedCountries: entitlements.allowedCountries,
      serverClasses: entitlements.serverClasses,
      planPriority: entitlements.priority,
      filters: { country: request.country, region: request.region, city: request.city },
      preferences: {
        preferredCountry: user.preferredCountry,
        preferredRegion: user.preferredRegion,
        favoriteServerIds: new Set(user.favorites.map((favorite) => favorite.serverId)),
      },
      clientLocation: locationCountry ? { lat: locationCountry.lat, lon: locationCountry.lon } : null,
      latencies: request.latencies,
      overloadThreshold: settings.serverOverloadThreshold,
    };
    const servers = await this.catalog.listVisible();
    const result = selectServer(servers.map((server) => this.toCandidate(server)), ctx, this.random);
    if (!result) throw serviceUnavailable('no_server_available', 'No suitable server is available right now');
    const server = servers.find((item) => item.id === result.selected.candidate.id)!;
    const latency = result.selected.latencyMs;
    return {
      server,
      strategy: 'quick',
      score: result.selected.score,
      reason: `Lowest combined load/latency score (load ${server.node?.loadPercent ?? 0}%${
        latency !== null ? `, ~${latency} ms` : ''
      })`,
    };
  }

  private async resolveManual(serverId: string, entitlements: Entitlements, overloadThreshold: number): Promise<SelectionOutcome> {
    const server = await this.catalog.get(serverId);
    if (!server || server.status === 'DISABLED') throw notFound('Server');
    const status = this.catalog.status(server);
    if (status !== 'ONLINE' && status !== 'DEGRADED') {
      throw serviceUnavailable('server_unavailable', `${server.name} is currently ${status.toLowerCase()}`);
    }
    if (!isServerAllowed(entitlements, server)) {
      throw forbidden('server_not_in_plan', 'Your plan does not include this server. Upgrade to use it.');
    }
    const load = server.node?.loadPercent ?? 100;
    const active = server.node?.activeConnections ?? 0;
    // Manual choices may use servers up to hard capacity; Quick Connect keeps a safety margin.
    if (active >= server.capacity || load >= Math.max(overloadThreshold, 98)) {
      throw conflict('server_full', `${server.name} is at capacity, please choose another server`);
    }
    return { server, strategy: 'manual', score: null, reason: 'Selected by user' };
  }
}
