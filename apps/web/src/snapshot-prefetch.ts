// Lane L3h: a new world's snapshot GET starts at page entry, not after the Shell chunk, /v1/config, sign-in and the
// socket's welcome (live: 2.7 s in, 0.35 s locally). vite.config.ts writes entryPrefetchScript() into index.html's head
// as a classic inline script, so the request leaves while the module chunks download; WorldEntityLayer.start then takes
// that one response (takeSnapshotPrefetch) instead of fetching again. Same URL, same fetch defaults (a plain GET with
// the page's same-origin credentials, as WorldEntityLayer has always sent it), so the same bytes and visibility.
// No imports: vite.config.ts loads this file in node, and worldKeyFrom is serialised into the page as it stands.

/** Old worlds (main's e8 behaviour; no entity layer, so nothing to prefetch). world-kind.ts re-exports it. */
export const OLD_WORLD_KEYS: readonly string[] = ['eden', 'mars', 'littlemartians', 'toy'];

/** The world key of a page path under BASE ('' or e.g. '/worlds'); 'toy' when the path names none. Self-contained: it is
 *  also serialised into index.html (no free identifiers, plain JS once its types are stripped). */
export function worldKeyFrom(pathname: string, base: string): string {
  const m = (base && pathname.startsWith(base + '/') ? pathname.slice(base.length) : pathname).match(/^\/w\/([a-z][a-z0-9-]{0,31})(?:\/|$)/);
  return m ? m[1] : 'toy';
}

/** The window property the inline script leaves its one request on. */
export const PREFETCH_GLOBAL = '__simSnapshotPrefetch';
type Prefetch = { url: string; response: Promise<Response> };

/** index.html's inline head script: on a new world's page, GET its snapshot now and leave the promise on the window. */
export function entryPrefetchScript(base: string, oldKeys: readonly string[] = OLD_WORLD_KEYS): string {
  return `(function(){try{var b=${JSON.stringify(base)},k=(${worldKeyFrom.toString()})(location.pathname,b);`
    + `if(${JSON.stringify(oldKeys)}.indexOf(k)>=0||typeof fetch!=='function')return;`
    + `var u=b+'/w/'+k+'/v1/world/snapshot',p=fetch(u);p.catch(function(){});window[${JSON.stringify(PREFETCH_GLOBAL)}]={url:u,response:p};}catch(e){}})();`;
}

/** The entry prefetch's response when it was for this exact URL, at most once per page (a later start, a resync or any
 *  other caller fetches afresh). null: there was none (old world, a test, a script-less page) or it is already taken. */
export function takeSnapshotPrefetch(url: string): Promise<Response> | null {
  const w = (typeof window === 'undefined' ? null : window) as unknown as Record<string, Prefetch | undefined> | null;
  const p = w?.[PREFETCH_GLOBAL];
  if (!p) return null;
  delete w![PREFETCH_GLOBAL];
  return p.url === url ? p.response : null;
}
