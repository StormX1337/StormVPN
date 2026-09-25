import type { User } from '@stormvpn/database';
import type { UserDto } from '@stormvpn/types';

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    emailVerified: user.emailVerifiedAt !== null,
    twoFactorEnabled: user.totpEnabledAt !== null,
    preferredCountry: user.preferredCountry,
    preferredRegion: user.preferredRegion,
    createdAt: user.createdAt.toISOString(),
  };
}
