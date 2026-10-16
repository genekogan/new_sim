import type { Context } from 'hono';
import { hashToken, RateLimit } from '../auth.ts';
import { ApiError } from '../souls.ts';
import { CREATION_LIMITS } from '@sim/generators';

/** Reuse the server's sliding window; authenticate before allocating any token bucket. */
export function godTokenLimiter(requireGod: (c: Context) => void) {
  const limits = new RateLimit();
  return (c: Context, bucket: string, max: number) => {
    requireGod(c);
    const token = c.req.header('authorization')!.replace(/^Bearer\s+/i, '');
    const result = limits.allow(`${bucket}:${hashToken(token)}`, max, CREATION_LIMITS.rateWindowMs);
    if (!result.ok) throw new ApiError(429, 'rate-limited', `too many ${bucket} requests`, { retry_after: result.retryAfter, retryAfterMs: result.retryAfter * 1000 });
  };
}
