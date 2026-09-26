import type { PrismaClient, VPNServer } from '../../generated/prisma/client';

const MB = 1024 ** 2;

/** Deterministic pseudo-random daily volumes so dashboards have realistic history in development. */
export async function seedTraffic(prisma: PrismaClient, userIds: string[], servers: VPNServer[]): Promise<void> {
  const today = new Date();
  const days = 30;
  for (const [userIndex, userId] of userIds.entries()) {
    await prisma.trafficUsage.deleteMany({ where: { userId } });
    const rows = [];
    for (let offset = days - 1; offset >= 0; offset--) {
      const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - offset));
      const weekday = day.getUTCDay();
      const weekend = weekday === 0 || weekday === 6 ? 1.6 : 1;
      const wave = 1 + 0.35 * Math.sin((offset + userIndex * 3) / 2.3);
      const server = servers[(offset + userIndex) % servers.length]!;
      const download = Math.round((900 + userIndex * 400) * MB * weekend * wave);
      rows.push({ userId, serverId: server.id, day, txBytes: BigInt(download), rxBytes: BigInt(Math.round(download * 0.18)) });
    }
    await prisma.trafficUsage.createMany({ data: rows });
  }
}
