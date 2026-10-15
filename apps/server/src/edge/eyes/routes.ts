// Eyes (M3): GET /v1/edge/view — the Soul's own first-person sight (or ?mode=map, a small overhead frame around it).
// Soul-authenticated. Returns {url, tick, heading, gaze, alt}: `alt` is a deterministic caption of the same frame,
// built from server state and the sightline computation (no model call). The JPEG is drawn by ONE long-lived render
// worker (worker.ts), served at a short-lived unguessable URL, cached by (Soul, tick bucket, gaze, size, pose),
// rate limited per Soul and globally. Without a worker (or while it restarts) the answer is 503 with the caption,
// and ?alt=only never renders at all.
import {randomBytes} from 'node:crypto';
import type {Context, Hono} from 'hono';
import {EDGE_CONTRACT, EdgeError, edgeBody, type EdgeDeps, type EdgeSoul} from '../contract.ts';
import type {EdgeLedger} from '../ledger/ledger.ts';
import {planView, type ViewPlan, type ViewRequest} from './view.ts';
import {EyesUnavailable, EyesWorker, NO_RENDERER, type EyesRenderer} from './worker.ts';

const TPS = 20;
export type EyesOptions = {
  renderer?: EyesRenderer; now?: () => number;
  /** One rendered frame per Soul per this many seconds (cache hits and alt=only are free). */
  soulSeconds?: number; globalPerMinute?: number; bucketSeconds?: number; urlSeconds?: number; quality?: number;
};
type Frame = {key: string; img: string; tick: number; alt: string; heading: unknown; gaze: unknown; seen: unknown; at: number; expires: number; ms: number; frameTick: number | null};
const num = (v: string | undefined, d: number) => {const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) ? n : d;};
const envNum = (k: string, d: number) => num(process.env[k], d);
/** Explicit `world` opt-in derives this child's exact path, including a launcher's /worlds prefix. */
export function eyesViewerUrl(setting: string | undefined, cfg: {worldPath: string; publicUrl: string}): string | undefined {
  if (!setting || setting === 'off') return undefined;
  return setting === 'world' ? new URL(cfg.worldPath.replace(/\/$/, '') + '/', cfg.publicUrl).href : setting;
}
/** A inherited manager-wide viewer URL must never draw a different world's scene. */
export function eyesViewerProblem(viewerUrl:string,cfg:{worldPath:string;publicUrl:string}):string|null{
  try{const viewer=new URL(viewerUrl),selected=new URL(cfg.publicUrl),path=cfg.worldPath.replace(/\/$/,'');
    if(!['http:','https:'].includes(viewer.protocol)||viewer.username||viewer.password||viewer.hash)return 'invalid Eyes viewer URL';
    if(viewer.origin!==selected.origin||viewer.pathname.replace(/\/$/,'')!==path)return 'Eyes viewer URL does not match the selected world';
    return null;
  }catch{return 'invalid Eyes viewer URL';}
}

export function parseViewQuery(q: (k: string) => string | undefined): ViewRequest & {altOnly: boolean} {
  const mode = q('mode') === 'map' ? 'map' : 'eyes', small = q('size') === 'small';
  const dw = mode === 'map' ? 256 : small ? 320 : 512, dh = mode === 'map' ? 256 : small ? 180 : 320;
  const w = Math.round(num(q('w'), dw)), h = Math.round(num(q('h'), dh));
  if (!(w >= 64 && w <= 768 && h >= 64 && h <= 512)) throw new EdgeError(400, 'invalid', 'w must be 64..768 and h 64..512 pixels');
  const fov = num(q('fov'), 90); if (!(fov >= 50 && fov <= 120)) throw new EdgeError(400, 'invalid', 'fov (horizontal degrees) must be 50..120');
  const alt = q('alt'); return {mode, w, h, fov, gaze: q('gaze') ?? undefined, altOnly: alt === 'only' || alt === '1' || alt === 'true'};
}

export function mountEdgeEyes(app: Hono, deps: EdgeDeps & {ledger: EdgeLedger}, options: EyesOptions = {}) {
  const now = options.now ?? Date.now;
  const viewerUrl=eyesViewerUrl(process.env.EDGE_EYES,deps.souls.cfg),problem=viewerUrl?eyesViewerProblem(viewerUrl,deps.souls.cfg):null;
  const refused:EyesRenderer={status:()=>({...NO_RENDERER.status(),detail:problem}),render:()=>Promise.reject(new EyesUnavailable(problem!)),close(){}};
  const renderer: EyesRenderer = options.renderer ?? (problem?refused:viewerUrl ? new EyesWorker({viewerUrl, timeoutMs: envNum('EDGE_EYES_TIMEOUT_SECONDS', 90) * 1000}) : NO_RENDERER);
  // Operators may tighten these budgets, never exceed the published 30 s / 12 per minute bounds.
  const soulMs = Math.max(30, options.soulSeconds ?? envNum('EDGE_EYES_SOUL_SECONDS', 30)) * 1000,
    globalPerMinute = Math.max(1, Math.min(12, Math.floor(options.globalPerMinute ?? envNum('EDGE_EYES_GLOBAL_PER_MINUTE', 12))));
  const bucketTicks = Math.max(1, Math.round((options.bucketSeconds ?? envNum('EDGE_EYES_BUCKET_SECONDS', 10)) * TPS));
  const urlMs = (options.urlSeconds ?? envNum('EDGE_EYES_URL_SECONDS', 600)) * 1000, quality = options.quality ?? envNum('EDGE_EYES_QUALITY', 0.7);
  const frames = new Map<string, Frame>(), images = new Map<string, {jpeg: Buffer; expires: number}>(), lastRender = new Map<string, number>(), recent: number[] = [];
  const sweep = () => {
    const t = now();
    for (const [k, f] of frames) if (f.expires <= t) frames.delete(k);
    for (const [k, i] of images) if (i.expires <= t) images.delete(k);
    while (images.size > 300) images.delete(images.keys().next().value!);
    while (frames.size > 300) frames.delete(frames.keys().next().value!);
  };
  const fail = (c: Context, status: number, code: string, message: string, extra: object = {}) => {c.header('Cache-Control', 'no-store'); return c.json({contract: EDGE_CONTRACT, error: {code, message}, ...extra}, status as 400);};
  const limit = (s: EdgeSoul, key: string, n: number) => {const r = deps.souls.limits.allow(`edge-${key}:${s.soulId}`, n, 60_000); if (!r.ok) throw new EdgeError(429, 'rate-limited', 'too many requests; slow down');};
  const summary = (p: ViewPlan) => ({tick: p.tick, heading: p.sight.heading, gaze: p.sight.gaze, mode: p.request.mode, fov: Math.round(p.sight.pose.hfov * 180 / Math.PI), size: [p.request.w, p.request.h],
    where: p.sight.where, light: p.sight.light, alt: p.sight.alt,
    seen: {souls: p.sight.souls.map(o => ({soulId: o.soulId, name: o.name, distance: o.distance, side: o.side, doing: o.state, activity: o.activity, facingYou: o.facingYou})),
      things: p.sight.things.map(t => ({id: t.id, name: t.name, kind: t.kind, distance: t.distance, side: t.side, ...(t.count ? {count: t.count} : {})}))},
    untrusted: true});
  /** Cache key: same Soul, same tick bucket, same gaze and size, and (coarsely) the same pose. */
  const keyOf = (s: EdgeSoul, p: ViewPlan) => {
    const e = p.render.pose;
    return [s.soulId, Math.floor(p.tick / bucketTicks), p.request.mode, p.sight.gaze.mode, p.sight.gaze.target ?? '', p.request.w, p.request.h, Math.round(e.hfov * 180 / Math.PI),
      Math.round(e.p[0] * 2), Math.round(e.p[1] * 4), Math.round(e.p[2] * 2), Math.round(e.yaw * 18 / Math.PI), p.render.show.join(',')].join('|');
  };

  app.get('/v1/edge/view', async c => {
    c.header('Cache-Control', 'no-store');
    try {
      const s = deps.soul(c), q = parseViewQuery(k => c.req.query(k));
      limit(s, q.altOnly ? 'view-alt' : 'view', 60);
      let plan = planView(deps.ledger, s, q);
      if (q.mode === 'eyes' && q.gaze !== undefined) {
        // Gaze is an owner's explicit attention request. The body keeps walking/sitting; subsequent no-gaze frames
        // observe the same logged head target that here reports. Invalid visibility/query already refused above.
        const p = plan.render.pose, at: [number,number] = [p.p[0] + 6 * Math.cos(p.yaw), p.p[2] + 6 * Math.sin(p.yaw)];
        await deps.ledger.intents.attend(s, `look:${q.gaze || 'ahead'}`, {at,until:deps.host.engine.world.tick+200,kind:'look'}, undefined, {direction:q.gaze || 'ahead',seconds:10});
        plan = planView(deps.ledger,s,q);
      }
      const base = summary(plan);
      if (q.altOnly) { return c.json(edgeBody({...base, url: null, image: 'not requested (alt=only)'}));}
      sweep();
      const key = keyOf(s, plan), hit = frames.get(key), t = now();
      if (hit && images.has(hit.img)) return c.json(edgeBody({...base, tick: hit.tick, alt: hit.alt, seen: hit.seen, url: `/v1/edge/view/img/${hit.img}.jpg`, expiresAt: new Date(hit.expires).toISOString(), cached: true, render: {ms: hit.ms, frameTick: hit.frameTick}}));
      const st = renderer.status();
      if (st.state !== 'ready') return fail(c, 503, 'eyes.unavailable', `No picture right now (${st.detail ?? st.state}); the caption below describes the same view.`, {...base, url: null});
      const last = lastRender.get(s.soulId);
      if (last !== undefined && t - last < soulMs) {const ra = Math.ceil((soulMs - (t - last)) / 1000); c.header('Retry-After', String(ra)); return fail(c, 429, 'eyes.rate-limited', `One picture every ${Math.round(soulMs / 1000)} s per Soul; use the caption (alt) meanwhile.`, {...base, url: null, retry_after: ra});}
      while (recent.length && t - recent[0] >= 60_000) recent.shift();
      if (recent.length >= globalPerMinute) {const ra = Math.max(1, Math.ceil((60_000 - (t - recent[0])) / 1000)); c.header('Retry-After', String(ra)); return fail(c, 429, 'eyes.busy', 'The world is drawing many pictures right now; use the caption (alt) and try again shortly.', {...base, url: null, retry_after: ra});}
      lastRender.set(s.soulId, t); recent.push(t);
      let out;
      try {out = await renderer.render({...plan.render, quality});}
      catch (error) {
        if (error instanceof EyesUnavailable) {if(lastRender.get(s.soulId)===t)lastRender.delete(s.soulId); return fail(c, 503, 'eyes.unavailable', `No picture right now (${error.reason}); the caption below describes the same view.`, {...base, url: null});}
        throw error;
      }
      const img = randomBytes(16).toString('hex'), expires = now() + urlMs;
      images.set(img, {jpeg: out.jpeg, expires});
      frames.set(key, {key, img, tick: plan.tick, alt: base.alt, heading: base.heading, gaze: base.gaze, seen: base.seen, at: t, expires, ms: Math.round(out.ms), frameTick: out.frameTick});
      return c.json(edgeBody({...base, url: `/v1/edge/view/img/${img}.jpg`, expiresAt: new Date(expires).toISOString(), cached: false, bytes: out.jpeg.length,
        render: {ms: Math.round(out.ms), queueMs: Math.max(0, Math.round(out.queueMs)), frameTick: out.frameTick, renderer: st.renderer}}));
    } catch (error) {
      if (error instanceof EdgeError) return fail(c, error.status, error.code, error.message);
      console.error('[edge] eyes fault', error instanceof Error ? (error.stack ?? error.message).split('\n').slice(0, 4).join(' | ') : String(error));
      return fail(c, 503, 'unavailable', 'the view could not be computed; retry');
    }
  });
  // Short-lived capability URL for one rendered frame (unguessable; expires; no other data).
  app.get('/v1/edge/view/img/:file', c => {
    sweep();
    const m = /^([0-9a-f]{32})\.jpg$/.exec(c.req.param('file') ?? ''), i = m ? images.get(m[1]) : undefined;
    if (!i) return fail(c, 404, 'not-found', 'this picture has expired; ask for a new view');
    return c.body(new Uint8Array(i.jpeg), 200, {'Content-Type': 'image/jpeg', 'Cache-Control': `private, max-age=${Math.max(0, Math.floor((i.expires - now()) / 1000))}`, 'X-Content-Type-Options': 'nosniff'});
  });
  // Public: render worker health (no Soul data).
  app.get('/v1/edge/view/status', c => {c.header('Cache-Control', 'no-store'); return c.json(edgeBody({eyes: renderer.status(), limits: {soulSeconds: soulMs / 1000, globalPerMinute, bucketSeconds: bucketTicks / TPS, urlSeconds: urlMs / 1000}}));});
  return {renderer, close: () => renderer.close()};
}
