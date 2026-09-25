import { sha256Hex } from '@stormvpn/crypto/node';
import type { ApiEnv } from '../../env';
import type { RedisCounter } from '../../lib/counter';
import { tooManyRequests } from '../../lib/errors';

const IP_FAILURE_LIMIT = 50;
const IP_WINDOW_SECONDS = 3600;

/**
 * Login brute-force protection: per account (email) and per source IP.
 * Accounts are locked temporarily after N failures; the response is identical
 * whether or not the account exists.
 */
export class BruteForceGuard {
  constructor(
    private readonly counter: RedisCounter,
    private readonly env: Pick<ApiEnv, 'LOGIN_MAX_FAILURES' | 'LOGIN_LOCKOUT_MINUTES'>,
  ) {}

  private accountKey(email: string): string {
    return `bf:login:acct:${sha256Hex(email)}`;
  }

  private ipKey(ip: string): string {
    return `bf:login:ip:${ip}`;
  }

  async assertAllowed(email: string, ip: string): Promise<void> {
    const [account, source] = await Promise.all([
      this.counter.peek(this.accountKey(email)),
      this.counter.peek(this.ipKey(ip)),
    ]);
    if (account.count >= this.env.LOGIN_MAX_FAILURES) {
      throw tooManyRequests('account_locked', 'Too many failed attempts. Try again later.', account.ttlSeconds);
    }
    if (source.count >= IP_FAILURE_LIMIT) {
      throw tooManyRequests('too_many_attempts', 'Too many failed attempts. Try again later.', source.ttlSeconds);
    }
  }

  /** Records a failure and returns true when this failure locked the account. */
  async recordFailure(email: string, ip: string): Promise<boolean> {
    const window = this.env.LOGIN_LOCKOUT_MINUTES * 60;
    const [account] = await Promise.all([
      this.counter.hit(this.accountKey(email), this.env.LOGIN_MAX_FAILURES, window),
      this.counter.hit(this.ipKey(ip), IP_FAILURE_LIMIT, IP_WINDOW_SECONDS),
    ]);
    return account.count === this.env.LOGIN_MAX_FAILURES;
  }

  async reset(email: string): Promise<void> {
    await this.counter.reset(this.accountKey(email));
  }
}
