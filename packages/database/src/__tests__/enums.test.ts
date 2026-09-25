import { describe, expect, it } from 'vitest';
import * as types from '@stormvpn/types';
import * as db from '../../generated/prisma/enums';

const pairs = [
  'Role',
  'UserStatus',
  'ClientType',
  'DevicePlatform',
  'SubscriptionStatus',
  'BillingInterval',
  'BillingProvider',
  'PaymentStatus',
  'InvoiceStatus',
  'CouponDuration',
  'Region',
  'ServerStatus',
  'NodeStatus',
  'ServerClass',
  'VpnProtocol',
  'ProviderType',
  'PeerStatus',
  'ConnectionStatus',
  'ConnectionSource',
  'Severity',
  'ActorType',
  'RiskSubjectType',
] as const;

describe('enum parity between Prisma schema and @stormvpn/types', () => {
  it.each(pairs)('%s matches', (name) => {
    const prismaEnum = (db as Record<string, Record<string, string>>)[name];
    const sharedEnum = (types as unknown as Record<string, Record<string, string>>)[name];
    expect(prismaEnum, `Prisma enum ${name}`).toBeDefined();
    expect(Object.values(sharedEnum!).sort()).toEqual(Object.values(prismaEnum!).sort());
  });
});
