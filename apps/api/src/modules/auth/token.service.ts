import { jwtVerify, SignJWT, errors as joseErrors } from 'jose';
import { generatePrefixedToken, generateToken, sha256Hex } from '@stormvpn/crypto/node';
import type { Role } from '@stormvpn/database';
import type { ApiEnv } from '../../env';
import type { Clock } from '../../lib/clock';
import { unauthorized } from '../../lib/errors';

export interface AccessTokenClaims {
  userId: string;
  sessionId: string;
  role: Role;
}

export interface SignedToken {
  token: string;
  expiresAt: Date;
}

/**
 * Short-lived HS256 JWT access tokens (stateless, carry the session id so
 * revocation is enforced by the session check) + opaque refresh tokens that
 * are stored only as SHA-256 hashes.
 */
export class TokenService {
  private readonly secret: Uint8Array;

  constructor(
    private readonly env: Pick<ApiEnv, 'JWT_ACCESS_SECRET' | 'JWT_ISSUER' | 'JWT_AUDIENCE' | 'ACCESS_TOKEN_TTL_SECONDS'>,
    private readonly clock: Clock,
  ) {
    this.secret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
  }

  async signAccessToken(claims: AccessTokenClaims): Promise<SignedToken> {
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + this.env.ACCESS_TOKEN_TTL_SECONDS * 1000);
    const token = await new SignJWT({ sid: claims.sessionId, role: claims.role, typ: 'access' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.userId)
      .setIssuer(this.env.JWT_ISSUER)
      .setAudience(this.env.JWT_AUDIENCE)
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .setJti(generateToken(12))
      .sign(this.secret);
    return { token, expiresAt };
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        issuer: this.env.JWT_ISSUER,
        audience: this.env.JWT_AUDIENCE,
        algorithms: ['HS256'],
        currentDate: this.clock.now(),
      });
      if (payload.typ !== 'access' || typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
        throw unauthorized('invalid_token', 'Invalid access token');
      }
      return { userId: payload.sub, sessionId: payload.sid, role: payload.role as Role };
    } catch (error) {
      if (error instanceof joseErrors.JWTExpired) throw unauthorized('token_expired', 'Access token expired');
      if (error instanceof Error && error.name === 'AppError') throw error;
      throw unauthorized('invalid_token', 'Invalid access token');
    }
  }

  generateRefreshToken(): { token: string; hash: string } {
    const token = generatePrefixedToken('srt', 32);
    return { token, hash: sha256Hex(token) };
  }
}
