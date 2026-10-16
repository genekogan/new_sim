// W2: god screenshots use the host's renderer, never a caller-controlled URL or browser credentials.
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { ApiError } from '../souls.ts';
import { godTokenLimiter } from './rate-limit.ts';
import { renderLook, pngSize, sweepLookProfiles, lookAdvice } from './look-renderer.ts';

export const LOOK_LIMITS = { perMinute: 20, queued: 4, timeoutMs: 60_000 } as const;
const coord = z.number().finite().min(-1_000_000).max(1_000_000);
const point = z.tuple([coord, coord, coord]);
export const lookSchema = z.object({
  eye: point, at: point,
  hideRoofs: z.boolean().default(false), cut: z.number().finite().min(-1000).max(1000).nullable().default(null),
  span: z.number().finite().min(0).max(1_000_000).default(0),
  hour: z.string().regex(/^(?:[01]?\d|2[0-3])(?::[0-5]\d)?$/).transform(h => { const [hour, minute = '00'] = h.split(':'); return `${hour.padStart(2, '0')}:${minute}`; }).optional(),
  weather: z.string().regex(/^[a-z][a-z-]{0,31}$/).optional(),
  width: z.number().int().min(1).max(1600).default(1024),
  height: z.number().int().min(1).max(1000).default(640),
}).strict().refine(v => Math.hypot(...v.eye.map((n, i) => n - v.at[i])) > 0.01, 'eye and at must be distinct');
export type Look = z.infer<typeof lookSchema>;
export type LookRenderer = (worldUrl: string, shot: Look, expect: number, signal: AbortSignal) => Promise<Uint8Array>;

/** r2.1: the count a remote look waits for (60% of it in layer.drawn). Only what the viewer's entity layer draws:
 *  resident bodies (`components.body`, make 'none') and prefab containers (make 'parts') are never drawn there, so
 *  counting every entity made looks time out in body-heavy worlds. */
type DrawableModel = { entities: Map<string, { def: string }>; resolvedDef(ref: string): { make: { kind: string }; components: { body?: unknown } } | null | undefined };
export function drawableEntities(model: DrawableModel): number {
  let n = 0;
  for (const e of model.entities.values()) { const def = model.resolvedDef(e.def); if (def && !def.components?.body && def.make.kind !== 'none' && def.make.kind !== 'parts') n++; }
  return n;
}

type Job = { run(signal: AbortSignal): Promise<Uint8Array>; resolve(png: Uint8Array): void; reject(e: unknown): void; controller: AbortController; timer: ReturnType<typeof setTimeout>; dispose(): void };

/** One active render per mounted world. Queue wait counts against the same absolute deadline.
 * An expired active job holds its slot until its renderer has actually disposed Chrome. */
export class LookQueue {
  private active = false;
  private jobs: Job[] = [];
  private timeoutMs: number;
  private maxQueued: number;
  constructor(timeoutMs: number = LOOK_LIMITS.timeoutMs, maxQueued: number = LOOK_LIMITS.queued) { this.timeoutMs = timeoutMs; this.maxQueued = maxQueued; }
  run(run: Job['run'], signal?: AbortSignal): Promise<Uint8Array> {
    if (signal?.aborted) return Promise.reject(new ApiError(499, 'look.cancelled', 'look request was cancelled'));
    if (this.active && this.jobs.length >= this.maxQueued) return Promise.reject(new ApiError(429, 'look.busy', 'world renderer queue is full; retry shortly', { retry_after: 3, retryAfterMs: 3000 }));
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const abort = (error: ApiError) => {
        controller.abort(error); reject(error);
        const i = this.jobs.indexOf(job);
        if (i >= 0) { this.jobs.splice(i, 1); job.dispose(); }
      };
      const cancelled = () => abort(new ApiError(499, 'look.cancelled', 'look request was cancelled'));
      const timer = setTimeout(() => abort(new ApiError(504, 'look.timeout', 'world renderer did not finish within its deadline; retry shortly')), this.timeoutMs);
      const job: Job = { run, resolve, reject, controller, timer, dispose: () => { clearTimeout(timer); signal?.removeEventListener('abort', cancelled); } };
      signal?.addEventListener('abort', cancelled, { once: true });
      this.jobs.push(job); void this.drain();
    });
  }
  private async drain() {
    if (this.active) return;
    const job = this.jobs.shift(); if (!job) return;
    this.active = true;
    try { job.resolve(await job.run(job.controller.signal)); }
    catch (e) { job.reject(e); }
    finally { job.dispose(); this.active = false; void this.drain(); }
  }
}

export function mountLookRoutes(app: Hono, d: {
  requireGod(c: Context): unknown;
  worldUrl?: string;
  entities(): number;
  renderer?: LookRenderer;
  queue?: LookQueue;
}) {
  const limit = godTokenLimiter(d.requireGod), queue = d.queue ?? new LookQueue();
  // Startup housekeeping is asynchronous and finishes before the first real render.
  const swept = d.renderer ? Promise.resolve() : sweepLookProfiles().catch((e: NodeJS.ErrnoException) => { console.warn('[god.look] profile sweep failed:', e.code); });
  app.use('/v1/god/look', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
  app.post('/v1/god/look', async c => {
    try { limit(c, 'look', LOOK_LIMITS.perMinute); }
    catch (e) { if (e instanceof ApiError && e.status === 429) e.extra = { ...e.extra, retryAfterMs: Number(e.extra?.retry_after ?? 1) * 1000 }; throw e; }
    const parsed = lookSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, 'look.invalid', 'look needs finite eye/at triples and valid shot parameters (maximum 1600×1000)', { issues: parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) });
    if (!d.worldUrl) throw new ApiError(503, 'look.unavailable', `world renderer URL is not configured. ${lookAdvice}`);
    const started = Date.now();
    const png = await queue.run(async signal => { await swept; return (d.renderer ?? renderLook)(d.worldUrl!, parsed.data, d.entities(), signal); }, c.req.raw.signal);
    return c.body(png as never, 200, { 'content-type': 'image/png', 'cache-control': 'no-store', 'x-look-ms': String(Date.now() - started), 'x-look-size': pngSize(png) });
  });
}
