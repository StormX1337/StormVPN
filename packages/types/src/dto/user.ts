import type { IsoDate } from './common';
import type { ClientType, Region, Role, SecurityEventType, Severity, UserStatus } from '../enums';

export interface UserDto {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  status: UserStatus;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  preferredCountry: string | null;
  preferredRegion: Region | null;
  createdAt: IsoDate;
}

export interface AuthResultDto {
  user: UserDto;
  /** Only returned to native clients (header `x-stormvpn-client: native`). */
  tokens?: {
    accessToken: string;
    accessTokenExpiresAt: IsoDate;
    refreshToken: string;
    refreshTokenExpiresAt: IsoDate;
  };
}

export interface MfaChallengeDto {
  mfaRequired: true;
  mfaToken: string;
}

export type LoginResultDto = AuthResultDto | MfaChallengeDto;

export interface SessionDto {
  id: string;
  clientType: ClientType;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: IsoDate;
  lastUsedAt: IsoDate;
  expiresAt: IsoDate;
  current: boolean;
}

export interface SecurityEventDto {
  id: string;
  type: SecurityEventType;
  severity: Severity;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: IsoDate;
}

export interface TwoFactorSetupDto {
  secret: string;
  otpauthUrl: string;
}

export interface BackupCodesDto {
  backupCodes: string[];
}

export interface PublicIpDto {
  ip: string;
  country: string | null;
  protected: boolean;
}
