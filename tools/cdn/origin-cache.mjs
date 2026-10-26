// Origin cache rules for immutable responses and mutable asset views (lane CACHE, 2026-10-22). cdn-walk.mjs applies it to every same-origin
// response of a cold page load, so a new immutable class the origin serves without a long-lived cache policy, or one
// Cloudflare will not cache at all, fails the ship walk instead of costing every stranger a trip to eden2.
//   content-addressed (hash in the path: Vite `/assets/<name>-<hash>.<ext>`, `/assets/<sha256>.<ext>`, `/v1/world/part/<hash>`,
//     `/art/<sha256>`, profile photos): `immutable` and max-age >= 30 days;
//   release-stable (same bytes for a build, name not hashed: `/modular`, `/mars-assets`, `/world-assets`, `.wasm`, fonts):
//     max-age >= 1 hour;
//   mutable-view (source identities that may select new renditions): public, no-cache, never immutable;
//     Cloudflare DYNAMIC/BYPASS can occur for these origin validators. Legacy GLB aliases may be mutable core views or
//     immutable uploaded content; their response must satisfy one complete policy.
//   immutable/stable: Cloudflare must be able to cache it (cf-cache-status DYNAMIC or BYPASS is a miss). A first request after a
//     release is a MISS/EXPIRED and is not counted; HIT/REVALIDATED/STALE/UPDATING/MISS/EXPIRED all pass.
// Only 200 responses on the origin host are judged; assets.eden.art has its own checks in cdn-walk.
const DAY = 86400;
const VIEW = /^(?:\/worlds)?(?:\/w\/[a-z][a-z0-9-]{0,31})?\/asset-view\/[0-9a-f]{64}\.glb$/;
const LEGACY_GLB = /^(?:\/worlds)?(?:\/w\/[a-z][a-z0-9-]{0,31})?\/assets\/[0-9a-f]{64}\.glb$/;
const HASHED = [
  /^(?:\/worlds)?\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/,      // Vite content hash (8 chars, base64url)
  /^(?:\/worlds)?(?:\/w\/[a-z][a-z0-9-]{0,31})?\/assets\/[0-9a-f]{64}\.[a-z0-9]+$/, // content-addressed stored objects
  /^(?:\/worlds)?\/w\/[a-z][a-z0-9-]{0,31}\/v1\/world\/part\/[0-9a-f]{16,}$/,
  /\/art\/[0-9a-f]{64}\.[a-z0-9]+$/,
  /\/profile-photo\/[0-9a-f]{16,}$/,
];
const STABLE = [
  /^(?:\/worlds)?\/(?:modular|mars-assets|world-assets)\//,
  /\.(?:wasm|woff2?|ttf|otf)$/i,
];
export function originCacheClass(path) {
  const p = path.split('?')[0];
  if (VIEW.test(p)) return 'mutable-view';
  if (LEGACY_GLB.test(p)) return 'legacy-glb';
  if (HASHED.some((r) => r.test(p))) return 'hashed';
  if (STABLE.some((r) => r.test(p))) return 'stable';
  return null;
}
const maxAge = (cc) => { const m = /(?:^|[,\s])max-age=(\d+)/i.exec(cc ?? ''); return m ? Number(m[1]) : 0; };
const directive = (cc, name) => new RegExp('(?:^|,)\\s*' + name + '\\s*(?:,|$)', 'i').test(cc);
// -> null when fine (or outside the checked classes), else a one-line problem.
export function originCacheProblem({ path, status, headers }) {
  if (status !== 200) return null;
  const cls = originCacheClass(path); if (!cls) return null;
  const cc = headers['cache-control'] ?? '', cf = (headers['cf-cache-status'] ?? '').toUpperCase(), age = maxAge(cc);
  if (/no-store|private/i.test(cc)) return `origin ${cls} asset not publicly cacheable (${cc}): ${path}`;
  const revalidated = cls === 'mutable-view' || cls === 'legacy-glb' && directive(cc, 'no-cache');
  if (revalidated && (!directive(cc, 'public') || !directive(cc, 'no-cache') || directive(cc, 'immutable'))) return `origin mutable asset view without public + no-cache or with immutable (${cc || 'none'}): ${path}`;
  if ((cls === 'hashed' || cls === 'legacy-glb' && !revalidated) && (!directive(cc, 'immutable') || age < 30 * DAY)) return `origin hashed asset without immutable + 30d max-age (${cc || 'none'}): ${path}`;
  if (cls === 'stable' && age < 3600) return `origin release-stable asset with max-age < 1h (${cc || 'none'}): ${path}`;
  if ((cf === 'DYNAMIC' || cf === 'BYPASS') && !revalidated) return `Cloudflare ${cf} for an origin ${cls} asset: ${path}`;
  return null;
}
