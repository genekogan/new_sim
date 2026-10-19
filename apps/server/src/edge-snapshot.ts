// Lane O2 (tranche 2026-10-19): an edge-cacheable first picture of a world.
//
// sim.eden.art sits behind Cloudflare. The world page's HTML (never cached) carries the current snapshot key
// (`window.__simSnapshotKey`), and the page's first snapshot GET asks for `/v1/world/snapshot?v=<key>`. When `v` is the
// current key, that response may be kept by a shared cache (`s-maxage`), so a second visitor anywhere gets the picture
// from the nearest Cloudflare site and only the live socket crosses to Germany. Browsers never keep it (`max-age=0`).
//
// The key fixes everything the picture is made of: the edit seq (entities, defs, ground, constants, state), the builds
// revision (the construction sites) and the moderation version (what is filtered out). Only `tick` and `now` age
// with it; the client adds the response's `Age` to `now`. A `v` that is not current (or no `v`) is answered with the
// current world and `no-store`, so a stale or invented key can never put anything in the edge cache.
// Every other caller (resync, God UI, previews) keeps using the plain URL, which stays `no-store`.
import type { Hono } from 'hono';

/** Shared caches may keep a keyed snapshot this long; browsers revalidate every time. */
export const EDGE_SNAPSHOT_CACHE = 'public, max-age=0, s-maxage=86400';
export const SNAPSHOT_KEY_HEADER = 'x-snapshot-key';
/** The window property the world page's HTML sets (apps/web/src/snapshot-prefetch.ts reads it). */
export const SNAPSHOT_KEY_GLOBAL = '__simSnapshotKey';

export type SnapshotKeyParts = { editSeq: number; buildsRev: number; moderation: string };

/** `<editSeq>.<buildsRev>.<moderation version>`: digits and dots only (safe in a URL and in an inline script). */
export function snapshotKey(p: SnapshotKeyParts): string {
  const key = `${p.editSeq}.${p.buildsRev}.${p.moderation}`;
  if (!/^[0-9]+(\.[0-9]+)*$/.test(key)) throw new Error(`snapshot key is not digits and dots: ${key}`);
  return key;
}

/** Wrap GET /v1/world/snapshot: cacheable only when `?v=` names the key both before and after the picture was made. */
export function mountEdgeSnapshot(app: Hono, currentKey: () => string) {
  app.use('/v1/world/snapshot', async (c, next) => {
    const asked = c.req.query('v'), before = safeKey(currentKey);
    await next();
    const after = safeKey(currentKey);
    if (after) c.res.headers.set(SNAPSHOT_KEY_HEADER, after);
    if (c.req.method === 'GET' && c.res.status === 200 && asked !== undefined && after !== null && asked === before && asked === after) c.res.headers.set('Cache-Control', EDGE_SNAPSHOT_CACHE);
    else c.res.headers.set('Cache-Control', 'no-store');
  });
}

/** The key, or null when it cannot be read (the page and the snapshot must never fail because of it). */
export function safeKey(currentKey: (() => string) | null | undefined): string | null {
  try { return currentKey ? currentKey() : null; } catch { return null; }
}

/** The world page's HTML with the current key set first thing in <head>, before any script that reads it. */
export function withSnapshotKey(html: string, key: string | null): string {
  if (!key) return html;
  const tag = `<script>window.${SNAPSHOT_KEY_GLOBAL}=${JSON.stringify(key)}</script>`;
  const at = html.search(/<head[^>]*>/i);
  if (at < 0) return html;
  const end = html.indexOf('>', at) + 1;
  return html.slice(0, end) + tag + html.slice(end);
}
