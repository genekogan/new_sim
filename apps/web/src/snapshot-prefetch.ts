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

/** The window properties the inline script leaves its requests on. */
export const PREFETCH_GLOBAL = '__simSnapshotPrefetch';
export const CONFIG_GLOBAL = '__simConfigPrefetch';
export const SOCKET_GLOBAL = '__simSocketPrefetch';
type Prefetch = { url: string; response: Promise<Response> };
/** Lane W1: the world's WebSocket, opened at page entry with an anonymous hello (P7: in its URL, `?hello=`, said by the
 *  server at the upgrade); useSim's Connection adopts it (queue:
 *  every message that arrived before then, in order). Closed after 20 s if nothing adopted it. */
export type BootSocket = { url: string; ws: WebSocket; queue: unknown[]; hello: string; sent: boolean; adopted?: boolean };

/** index.html's inline head script: on a new world's page, GET its snapshot and /v1/config now, and (with `hello`, the
 *  exact anonymous hello the page's Connection would send) open the world's socket and say hello, so the page's first
 *  round trips to the server all leave at once instead of one after another (research B, 2026-10-19). */
export function entryPrefetchScript(base: string, oldKeys: readonly string[] = OLD_WORLD_KEYS, hello?: string): string {
  return `(function(){try{var b=${JSON.stringify(base)},k=(${worldKeyFrom.toString()})(location.pathname,b);`
    + `if(${JSON.stringify(oldKeys)}.indexOf(k)>=0||typeof fetch!=='function')return;`
    + `var w=b+'/w/'+k,g=function(n,u){var p=fetch(u);p.catch(function(){});window[n]={url:u,response:p};};`
    // W3: the wire form (snapshot-wire.ts); its defs/ground part fetches start as soon as the response headers name them
    + `var x=window.__simSnapshotKey,n=w+'/v1/world/snapshot?defs=ref';g(${JSON.stringify(PREFETCH_GLOBAL)},typeof x==='string'&&x?n+'&v='+encodeURIComponent(x):n);g(${JSON.stringify(CONFIG_GLOBAL)},w+'/v1/config');`
    // P7: the parts the HTML names (window.__simSnapshotParts) leave at once; any other the snapshot's headers name, then
    + `var sp=window[${JSON.stringify(PREFETCH_GLOBAL)}],pp=sp.parts={},pf=function(f){if(typeof f==='string'&&/^[0-9a-f]{32}$/.test(f)&&!pp[f]){pp[f]=fetch(w+'/v1/world/part/'+f);pp[f].catch(function(){});}},hp=window.__simSnapshotParts;if(hp&&hp.forEach)hp.forEach(pf);`
    + `sp.response.then(function(r){['x-defs-ref','x-ground-ref'].forEach(function(h){pf(r.headers.get(h));});},function(){});`
    // P7: the hello rides in the socket's URL (the server says it at the upgrade), not from the open event: that waited
    // for the page's main thread, busy building the world, and the join with it (~1 s on a phone)
    + (hello ? `if(typeof WebSocket!=='function')return;var h=${JSON.stringify(hello)},u=(location.protocol==='https:'?'wss':'ws')+'://'+location.host+w+'/ws',s=new WebSocket(u+'?hello='+encodeURIComponent(h)),o={url:u,ws:s,queue:[],hello:h,sent:true};`
      + `s.onmessage=function(e){o.queue.push(e.data);};`
      + `setTimeout(function(){if(!o.adopted)try{s.close();}catch(e){}},20000);window[${JSON.stringify(SOCKET_GLOBAL)}]=o;` : '')
    + `}catch(e){}})();`;
}

/** Lane O2: the world server puts the current snapshot's key on the page (window.__simSnapshotKey); the first start
 *  GETs `<snapshot>?v=<key>`, which the edge may cache (the entry prefetch already did); every later fetch (resync) uses
 *  the plain no-store URL. */
export function entryWireUrl(plain: string): string {
  const x = typeof window === 'undefined' ? undefined : (window as unknown as { __simSnapshotKey?: unknown }).__simSnapshotKey;
  return `${plain}?defs=ref` + (typeof x === 'string' && x ? `&v=${encodeURIComponent(x)}` : '');
}
export function entrySnapshotUrl(plain: string): string {
  const x = typeof window === 'undefined' ? undefined : (window as unknown as { __simSnapshotKey?: unknown }).__simSnapshotKey;
  return typeof x === 'string' && x ? `${plain}?v=${encodeURIComponent(x)}` : plain;
}

/** The entry socket when it was opened for this exact URL and is still usable, at most once per page. */
export function takeBootSocket(url: string): BootSocket | null {
  const w = (typeof window === 'undefined' ? null : window) as unknown as Record<string, BootSocket | undefined> | null;
  const o = w?.[SOCKET_GLOBAL];
  if (!o) return null;
  delete w![SOCKET_GLOBAL];
  if (o.url !== url || o.ws.readyState > 1) { try { o.ws.close(); } catch { /* already closing */ } return null; }
  o.adopted = true;
  return o;
}

/** The entry config GET when it was for this exact URL, at most once per page (a retry fetches afresh). */
export function takeConfigPrefetch(url: string): Promise<Response> | null { return takePrefetch(CONFIG_GLOBAL, url); }

function takePrefetch(name: string, url: string): Promise<Response> | null {
  const w = (typeof window === 'undefined' ? null : window) as unknown as Record<string, Prefetch | undefined> | null;
  const p = w?.[name];
  if (!p) return null;
  delete w![name];
  return p.url === url ? p.response : null;
}

/** The entry prefetch's response when it was for this exact URL, at most once per page (a later start, a resync or any
 *  other caller fetches afresh). null: there was none (old world, a test, a script-less page) or it is already taken. */
export function takeSnapshotPrefetch(url: string): Promise<Response> | null {
  const w = (typeof window === 'undefined' ? null : window) as unknown as Record<string, (Prefetch & { parts?: Record<string, Promise<Response>> }) | undefined> | null;
  const p = w?.[PREFETCH_GLOBAL]; if (p && p.url === url) parts = p.parts ?? {};
  return takePrefetch(PREFETCH_GLOBAL, url);
}
let parts: Record<string, Promise<Response>> = {};
/** A part (snapshot-wire.ts) the entry prefetch started for the snapshot just taken, at most once. */
export function takePartPrefetch(ref: string): Promise<Response> | null { const p = parts[ref] ?? null; delete parts[ref]; return p; }
