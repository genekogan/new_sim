// The original worlds at the site root (launcher --old-worlds-root, stage `legacy`): where root paths go, and the
// old->new redirect switch (lane L2 2026-10-17).
//
// <data>/redirects.json (absent = off), re-read when its mtime changes, so the operator flips it without a restart:
//   { "enabled": false,
//     "home": "/worlds/",                                   // where / goes (optional)
//     "worlds": { "eden": "/worlds/w/eden-2026/", "mars": "/worlds/w/my-mars-college-2026-3/",
//                 "littlemartians": "/worlds/w/little-martians-arium/" } }
// Only a person opening a page is redirected (GET of exactly /, /w/<key> or /w/<key>/ that accepts HTML), with a
// temporary 302 that no browser caches. Everything an agent or a world page uses (the API, sockets, assets, the CLI,
// /w/<key>/?anything-else) is untouched, so the original worlds and their Souls keep running and stay reachable:
// /w/<key>/?stay=1 (any `stay`) always opens the original world.
import { readFileSync, statSync } from 'node:fs';

export const LEGACY_KEYS = Object.freeze(['eden', 'mars', 'littlemartians']);

/** The world the laptop proxy (tools/core/multiworld/proxy.mjs worldForPath) sent a root path to. */
export function legacyWorldFor(path = '/') {
  if (/^\/w\/mars\/202[0-7](?:\/|$)/.test(path)) return 'eden';
  const asset = path.match(/^\/world-assets\/([^/]+)(?:\/|$)/)?.[1];
  if (asset) return LEGACY_KEYS.includes(asset) ? asset : null;
  const world = path.match(/^\/w\/([^/]+)(?:\/|$)/)?.[1];
  if (world) return LEGACY_KEYS.includes(world) ? world : null;
  if (/^\/(?:browser|modular|engine)(?:\/|$)/.test(path)) return 'mars';
  return 'eden';
}

const LOCAL = /^\/(?!\/)[A-Za-z0-9._~\-/]*$/;   // a same-site absolute path, nothing that could leave the origin

/** Check a redirects.json value; returns the normalised switch or throws with a reason. */
export function parseRedirects(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('redirects.json: an object');
  if (typeof v.enabled !== 'boolean') throw new Error('redirects.json: enabled must be true or false');
  const worlds = {};
  for (const [k, to] of Object.entries(v.worlds ?? {})) {
    if (!LEGACY_KEYS.includes(k)) throw new Error(`redirects.json: unknown world ${k}`);
    if (typeof to !== 'string' || !LOCAL.test(to) || to.startsWith(`/w/${k}`)) throw new Error(`redirects.json: ${k} target must be a path on this site, not the world itself`);
    worlds[k] = to;
  }
  if (v.home !== undefined && (typeof v.home !== 'string' || !LOCAL.test(v.home) || v.home === '/')) throw new Error('redirects.json: home must be another path on this site');
  return { enabled: v.enabled, worlds, home: v.home ?? null };
}

/** Where this request goes when the switch is on (null: serve it here). */
export function redirectTarget(sw, req, path, url) {
  if (!sw?.enabled || (req.method !== 'GET' && req.method !== 'HEAD')) return null;
  if (url.searchParams.has('stay')) return null;
  const dest = String(req.headers['sec-fetch-dest'] ?? '');
  if (dest && dest !== 'document') return null;
  if (!String(req.headers.accept ?? '').includes('text/html')) return null;
  const key = path === '/' ? null : path.match(/^\/w\/([a-z]+)\/?$/)?.[1];
  const to = path === '/' ? sw.home : key && LEGACY_KEYS.includes(key) ? sw.worlds[key] : null;
  return to ?? null;   // the query belonged to the original world (a Soul link, a camera): it is not carried over
}

/** The live switch: target(req, path, url). A missing file is off; a bad file is off and logged once per change. */
export function redirectSwitch(file, log = () => {}) {
  let at = -1, sw = null;
  const current = () => {
    let m; try { m = statSync(file).mtimeMs; } catch { at = -1; sw = null; return null; }
    if (m !== at) {
      at = m;
      try { sw = parseRedirects(JSON.parse(readFileSync(file, 'utf8'))); log(`redirects ${sw.enabled ? 'ON' : 'off'} (${file})`); }
      catch (e) { sw = null; log(`redirects off: ${e.message}`); }
    }
    return sw;
  };
  return { target: (req, path, url) => redirectTarget(current(), req, path, url), current };
}
