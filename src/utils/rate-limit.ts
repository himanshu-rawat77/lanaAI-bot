import type { Context, MiddlewareFn } from "grammy";

type Bucket = { count: number; resetAt: number };

export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number
  ) {}

  check(userId: string): { allowed: boolean; retryAfterSec: number } {
    const now = Date.now();
    const current = this.buckets.get(userId);
    if (!current || now > current.resetAt) {
      this.buckets.set(userId, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfterSec: 0 };
    }

    if (current.count >= this.maxRequests) {
      return { allowed: false, retryAfterSec: Math.ceil((current.resetAt - now) / 1000) };
    }

    current.count += 1;
    this.buckets.set(userId, current);
    return { allowed: true, retryAfterSec: 0 };
  }
}

export function createRateLimitMiddleware(
  limiter: InMemoryRateLimiter
): MiddlewareFn<Context> {
  return async (ctx, next) => {
    if (!ctx.from?.id) {
      await next();
      return;
    }

    const result = limiter.check(String(ctx.from.id));
    if (!result.allowed) {
      await ctx.reply(`Too many requests. Please wait ${result.retryAfterSec}s and try again.`);
      return;
    }

    await next();
  };
}
