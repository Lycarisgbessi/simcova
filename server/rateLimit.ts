import type { NextFunction, Request, Response } from 'express';

// Simple sliding-window rate limiter on public write endpoints (§5.2, EXNF-04).
// Buckets live in memory (single-instance deployment); stale entries are pruned
// both opportunistically on hit and by the periodic background sweep in jobs.ts.
export const rateBuckets = new Map<string, number[]>();

const WINDOW_MS = 10 * 60 * 1000;

export function pruneRateBuckets(nowMs = Date.now()): void {
  for (const [key, hits] of rateBuckets) {
    const fresh = hits.filter((t) => nowMs - t < WINDOW_MS);
    if (fresh.length === 0) {
      rateBuckets.delete(key);
    } else if (fresh.length !== hits.length) {
      rateBuckets.set(key, fresh);
    }
  }
}

export function rateLimit(maxHits: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${req.path}:${ip}`;
    const now = Date.now();
    const hits = (rateBuckets.get(key) ?? []).filter((t) => now - t < windowMs);
    if (hits.length >= maxHits) {
      return res.status(429).json({
        error: 'Trop de requêtes effectuées en peu de temps. Veuillez patienter quelques instants.',
      });
    }
    hits.push(now);
    rateBuckets.set(key, hits);
    if (rateBuckets.size > 5000) {
      pruneRateBuckets(now);
    }
    next();
  };
}
