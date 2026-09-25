import { getEntitlements, isServerAllowed } from '@stormvpn/core';
import type { Database } from '@stormvpn/database';
import type { ServerDto } from '@stormvpn/types';
import type { ListServersQuery } from '@stormvpn/validation';
import { notFound } from '../../lib/errors';
import type { ServerCatalog, ServerWithNode } from './server-catalog';
import { toServerDto } from './server.mapper';

export class ServerService {
  constructor(
    private readonly db: Database,
    private readonly catalog: ServerCatalog,
  ) {}

  private async context(userId: string) {
    const [entitlements, favorites] = await Promise.all([
      getEntitlements(this.db, userId),
      this.db.userFavorite.findMany({ where: { userId }, select: { serverId: true } }),
    ]);
    return { entitlements, favorites: new Set(favorites.map((favorite) => favorite.serverId)) };
  }

  private map(server: ServerWithNode, ctx: Awaited<ReturnType<ServerService['context']>>): ServerDto {
    return toServerDto(server, this.catalog.status(server), {
      isFavorite: ctx.favorites.has(server.id),
      allowed: ctx.entitlements ? isServerAllowed(ctx.entitlements, server) : false,
    });
  }

  async list(userId: string, query: ListServersQuery): Promise<ServerDto[]> {
    const ctx = await this.context(userId);
    const search = query.search?.toLowerCase();
    return (await this.catalog.listVisible())
      .filter((server) => !query.country || server.countryCode === query.country)
      .filter((server) => !query.region || server.region === query.region)
      .filter((server) => !query.city || server.city.toLowerCase() === query.city.toLowerCase())
      .filter((server) => !query.serverClass || server.serverClass === query.serverClass)
      .filter(
        (server) =>
          !search ||
          server.name.toLowerCase().includes(search) ||
          server.city.toLowerCase().includes(search) ||
          server.countryCode.toLowerCase() === search,
      )
      .map((server) => this.map(server, ctx))
      .filter((server) => !query.onlyAvailable || (server.allowed && server.status === 'ONLINE'));
  }

  async get(userId: string, serverId: string): Promise<ServerDto> {
    const server = await this.catalog.get(serverId);
    if (!server || server.status === 'DISABLED') throw notFound('Server');
    return this.map(server, await this.context(userId));
  }

  async setFavorite(userId: string, serverId: string, favorite: boolean): Promise<void> {
    const server = await this.catalog.get(serverId);
    if (!server) throw notFound('Server');
    if (favorite) {
      await this.db.userFavorite.upsert({
        where: { userId_serverId: { userId, serverId } },
        create: { userId, serverId },
        update: {},
      });
    } else {
      await this.db.userFavorite.deleteMany({ where: { userId, serverId } });
    }
  }
}
