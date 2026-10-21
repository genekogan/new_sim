import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { serveStatic } from '@hono/node-server/serve-static';

const PUBLIC_ORIGIN = 'https://sim.mars.college';
// Public, already-published derivatives only. Never source photos, Blender
// projects, capabilities, private room APIs or arbitrary upstream URLs.
export function publicMarsAsset(path: string): boolean {
  if (/[\\%]/.test(path) || path.includes('..')) return false;
  return /^\/(browser|modular|engine|history|2020|models)\/[a-zA-Z0-9_./-]+\.(glb|json|webp|png|jpg|jpeg|svg|bin)$/.test(path)
    || path === '/data/manifest.json';
}

export function mountMarsStatic(app: Hono, root: string) {
  // Copied GLBs have no precompressed sidecars. Stream gzip for browsers that
  // accept it, keeping range responses and already encoded bodies untouched.
  const compressGlb = compress({ encoding: 'gzip', contentTypeFilter: /^model\/gltf-binary(?:;|$)/i });
  app.get('/mars-assets/*', compressGlb, serveStatic({ root, rewriteRequestPath: p => p.replace(/^\/mars-assets/, '') }));
  for (const pattern of ['/engine/*', '/modular/*', '/models/*', '/history/*', '/2020/*', '/browser/*', '/data/manifest.json']) {
    app.get(pattern, compressGlb, async (c, next) => {
      if (!publicMarsAsset(c.req.path)) return c.notFound();
      // lane W1: published files on disk had no Cache-Control (the 1.8 MB character GLBs were cached by heuristics only)
      if (existsSync(join(root, c.req.path))) { const r = await serveStatic({ root })(c, next); const out = r ?? c.res; if (out.status === 200 && !out.headers.has('cache-control')) out.headers.set('cache-control', 'public, max-age=86400, stale-while-revalidate=604800'); return r; }
      const headers = new Headers();
      for (const name of ['range', 'if-none-match', 'if-modified-since']) {
        const value = c.req.header(name); if (value) headers.set(name, value);
      }
      const upstream = await fetch(PUBLIC_ORIGIN + c.req.path, { headers, redirect: 'error', signal: AbortSignal.timeout(120_000) });
      const responseHeaders = new Headers();
      for (const name of ['content-type', 'etag', 'last-modified', 'accept-ranges', 'content-range']) {
        const value = upstream.headers.get(name); if (value) responseHeaders.set(name, value);
      }
      // Node fetch decodes compressed bodies; do not forward compressed length.
      if (!upstream.headers.get('content-encoding') && upstream.headers.has('content-length')) responseHeaders.set('content-length', upstream.headers.get('content-length')!);
      responseHeaders.set('cache-control', upstream.ok ? 'public, max-age=3600' : 'no-store');
      return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
    });
  }
  // lane QA: a root without the lab's index.html (the eden2 legacy forks' mars-web has none) answered these pages with a
  // 500 "res.body.getReader is not a function" (serveStatic found no file and the route returned nothing): a plain 404.
  const labGone = () => new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>No page here</title><body style="font:16px system-ui;max-width:640px;margin:12vh auto;padding:0 20px"><h1>This page is not here any more</h1><p><a href="/">See the worlds</a></p>', { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  for (const route of ['/l/mars', '/l/mars/', '/l/littlemartians', '/l/littlemartians/', '/l/eden', '/l/eden/', '/w/mars/:year']) {
    app.get(route, async (c) => {
      if (c.req.param('year') && !/^202[0-7]$/.test(c.req.param('year')!)) return c.notFound();
      if (!existsSync(join(root, 'index.html'))) return labGone();
      return (await serveStatic({ root, path: 'index.html' })(c, async () => {})) ?? labGone();
    });
  }
  app.get('/lab', c => c.redirect('/l/mars'));
  app.get('/studio', c => c.redirect('/w/mars/2026'));
  app.get('/studio/:year', c => /^202[0-7]$/.test(c.req.param('year')) ? c.redirect(`/w/mars/${c.req.param('year')}`) : c.notFound());
}
