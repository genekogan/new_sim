/** Which page a path gets (lane QA): the world list at `<base>/`, a world at `<base>/w/<slug>…` (or `<base>/` with a
 *  hash, a single-world server's own view), and a plain "no page here" for anything else. Every unknown path is served
 *  the same index.html, and treating it as a world showed strangers "cannot reach the server: Error: The runtime does
 *  not match the selected world." (sim.eden.art/nope, the retired /l/* lab links). */
export type PageRoute = 'list' | 'world' | 'missing';
export function pageRoute(pathname: string, base: string, hash: string): PageRoute {
  // The launcher owns the public homepage; the original world list lives at /old.
  if (base === '/worlds' && pathname === '/') return 'list';
  if (!base && (pathname === '/old' || pathname === '/old/')) return 'list';
  const rel = base && (pathname === base || pathname.startsWith(base + '/')) ? pathname.slice(base.length) || '/' : base ? null : pathname;
  if (rel === null) return 'missing';
  if (rel === '/' || rel === '/index.html') return hash ? 'world' : 'list';
  return /^\/w\/[a-z][a-z0-9-]{0,31}(?:\/|$)/.test(rel) ? 'world' : 'missing';
}
