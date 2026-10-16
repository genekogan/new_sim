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
      if (existsSync(join(root, c.req.path))) return serveStatic({ root })(c, next);
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
  for (const route of ['/l/mars', '/l/mars/', '/l/littlemartians', '/l/littlemartians/', '/l/eden', '/l/eden/', '/w/mars/:year']) {
    app.get(route, async (c) => {
      if (c.req.param('year') && !/^202[0-7]$/.test(c.req.param('year')!)) return c.notFound();
      return serveStatic({ root, path: 'index.html' })(c, async () => {});
    });
  }
  app.get('/lab', c => c.redirect('/l/mars'));
  app.get('/studio', c => c.redirect('/w/mars/2026'));
  app.get('/studio/:year', c => /^202[0-7]$/.test(c.req.param('year')) ? c.redirect(`/w/mars/${c.req.param('year')}`) : c.notFound());
}
