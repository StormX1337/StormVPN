import {
  type Entitlements,
  getEntitlements,
  getMonthlyTrafficBytes,
  type SettingsService,
} from '@stormvpn/core';
import type { Database, Device } from '@stormvpn/database';
import type { ApiEnv } from '../../env';
import type { Clock } from '../../lib/clock';
import { forbidden, notFound, paymentRequired, serviceUnavailable } from '../../lib/errors';

export interface VpnAccess {
  entitlements: Entitlements;
  device: Device;
}

/**
 * Preconditions for any VPN access (config generation or connection):
 * active + verified account, live subscription, traffic allowance left,
 * device ownership and no global maintenance.
 */
export class VpnAccessGuard {
  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly env: Pick<ApiEnv, 'REQUIRE_EMAIL_VERIFICATION'>,
    private readonly clock: Clock,
  ) {}

  async check(userId: string, deviceId: string): Promise<VpnAccess> {
    const settings = await this.settings.get();
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { role: true, status: true, emailVerifiedAt: true },
    });
    if (settings.maintenanceMode && user.role === 'USER') {
      throw serviceUnavailable(
        'maintenance',
        settings.maintenanceMessage ?? 'StormVPN is under maintenance',
      );
    }
    if (user.status !== 'ACTIVE')
      throw forbidden('account_suspended', 'This account has been suspended');
    if (this.env.REQUIRE_EMAIL_VERIFICATION && !user.emailVerifiedAt) {
      throw forbidden('email_not_verified', 'Please verify your email address first');
    }
    const entitlements = await getEntitlements(this.db, userId);
    if (!entitlements)
      throw paymentRequired('subscription_required', 'An active subscription is required');

    if (entitlements.trafficLimitBytes !== null) {
      const used = await getMonthlyTrafficBytes(this.db, userId, this.clock.now());
      if (used >= entitlements.trafficLimitBytes) {
        throw paymentRequired(
          'traffic_limit_reached',
          'Your monthly traffic allowance is used up. Upgrade for unlimited traffic.',
        );
      }
    }

    const device = await this.db.device.findFirst({ where: { id: deviceId, userId } });
    if (!device) throw notFound('Device');
    const allowedDevices = await this.db.device.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      take: entitlements.maxDevices,
      select: { id: true },
    });
    if (!allowedDevices.some((allowed) => allowed.id === device.id)) {
      throw forbidden(
        'device_limit_reached',
        `Your plan allows ${entitlements.maxDevices} device(s)`,
      );
    }
    return { entitlements, device };
  }
}
