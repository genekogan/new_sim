// What the public world list (/__sim/worlds.json: the /worlds/ homepage, a world's "other worlds", Soul travel) shows,
// and in what order. An unlisted world is left out of that list only: its page, API, skill and owner/operator routes
// answer exactly as before, so anyone with its URL still reaches it (QA2 F4, 2026-10-21).

/** Bench/audit worlds the team keeps but strangers should not land on first: bench-hamlet holds Gene's Soul,
 *  bench-eden is the audit copy of Eden. Unlisted unless the registry says otherwise (`unlisted: false`). */
export const UNLISTED_SLUGS = Object.freeze(['bench-hamlet', 'bench-eden']);
/** Shown first, in this order: the flagship worlds (Eden 2026, Mars College 2026). */
export const FEATURED_SLUGS = Object.freeze(['eden-2026', 'my-mars-college-2026-3']);

/** A registry row's explicit `unlisted` (owner or operator) wins; otherwise the bench slugs and any "… (scratch)" name. */
export function isUnlisted(w) {
  if (typeof w?.unlisted === 'boolean') return w.unlisted;
  return UNLISTED_SLUGS.includes(w?.slug) || /\(scratch\)\s*$/i.test(String(w?.name ?? ''));
}

/** Featured first; then the most Souls; then the newest. `souls(w)` reads the freshest count the launcher has. */
export function listingOrder(souls = (w) => w.souls) {
  const feat = (w) => { const i = FEATURED_SLUGS.indexOf(w.slug); return i < 0 ? FEATURED_SLUGS.length : i; };
  return (a, b) => feat(a) - feat(b) || (Number(souls(b)) || 0) - (Number(souls(a)) || 0) || b.createdAt - a.createdAt;
}

/** The public list: listed worlds only, in listing order. */
export function publicWorlds(worlds, souls) { return worlds.filter((w) => !isUnlisted(w)).sort(listingOrder(souls)); }
