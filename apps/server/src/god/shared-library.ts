// The shared object library from inside a world (lane C16 `library`, backlog M4; packages/library). A god finds items
// other worlds published, places one (its models and defs come in, version-pinned), and publishes its own defs.
//
//   GET  /v1/god/library?q=&k=                         find: the latest offered version of each matching item
//   GET  /v1/god/library/item?id=<world>/<name>[@n]    one item: record (author, licence, versions), offered?, placed here?
//   POST /v1/god/library/place {item, at?: [x,z], name?, r?, dry?}   models through the gate, then ONE batch: define + place
//   POST /v1/god/library/publish {ref, licence?, attribution?, source?, title?, authorName?}   this world's def → a new version
//
// Every byte string that enters the library or a world through these routes passes ONE moderation seam, `gate`
// (packages/library/src/library-gate.ts `validateUpload`, the call shape of lane C2 `moderation`'s
// `apps/server/src/moderation/validate.ts`). Lane C2 is not on this branch: the local stand-in is the default and
// `deps.gate` takes the real gate when it merges. A model the gate changes (stripped metadata) is refused here: the
// library stores gated bytes, so a clean file comes back byte-identical and keeps its content address.
// The site's library lives in one directory (SIM_LIBRARY_DIR) shared by the worlds of a box; without it the routes say
// so (503 library.unavailable). Built on packages/library only (no @sim/catalog: it is being archived).
import { readFileSync } from 'node:fs';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { ApiError } from '../souls.ts';
import type { GodMode } from './god.ts';
import type { Budget } from './assets.ts';
import { DEFAULT_BUDGET } from './assets.ts';
import { ASSET_POLICY, LibraryError, LibraryUploadRejected, SharedLibrary, validateUpload, WORLD_SLUG, type ShareEntry, type UploadGate, type WorldSource } from '../../../../packages/library/src/index.ts';

export type SharedLibraryDeps = {
  god: GodMode;
  requireGod: (c: Context) => void;
  /** This world's slug on the site (the `<world>` in `<world>/<name>`). */
  slug: string;
  /** The site's library directory (SIM_LIBRARY_DIR); undefined → the routes answer library.unavailable. */
  dir: string | undefined;
  /** The moderation seam (default: the library's local stand-in for lane C2's validateUpload). */
  gate?: UploadGate;
  gateName?: string;
};

const noStore = { 'cache-control': 'no-store' };
const placeSchema = z.object({ item: z.string().min(3).max(120), at: z.tuple([z.number(), z.number()]).optional(), name: z.string().min(1).max(48).optional(), r: z.number().optional(), dry: z.boolean().optional() });
const publishSchema = z.object({ ref: z.string().min(1).max(120), licence: z.enum(['CC0-1.0', 'CC-BY-4.0']).optional(), attribution: z.string().max(200).optional(), source: z.string().max(300).optional(), title: z.string().max(60).optional(), authorName: z.string().max(60).optional() });

/** The library's refusals as HTTP answers. */
const status: Record<string, number> = { 'library.missing': 404, 'library.yanked': 410, 'library.restricted': 403, 'library.licence': 400, 'library.core': 400, 'library.invalid': 400, 'library.conflict': 409, 'library.busy': 409, 'library.immutable': 409, 'library.depth': 400, 'library.cycle': 400 };
function asApi(e: unknown): never {
  if (e instanceof LibraryError) throw new ApiError(status[e.code] ?? 400, e.code, e.message.replace(/^[\w.]+: /, ''));
  if (e instanceof LibraryUploadRejected) throw new ApiError(422, `moderation.${e.code}`, e.message.replace(/^[\w.]+: /, ''));
  const x = e as { status?: number; code?: string; message?: string };
  if (typeof x?.code === 'string' && /^(upload|moderation)\./.test(x.code)) throw new ApiError(x.status ?? 422, x.code, x.message ?? 'refused by moderation');
  throw e;
}
/** What a god reads about one version (never the def bodies). */
const summary = (e: ShareEntry) => ({ id: e.id, version: e.version, ref: e.ref, hash: e.hash, title: e.text.title, description: e.text.description, category: e.text.category, tags: e.text.tags,
  author: e.author, licence: e.licence, defs: e.defs.length, models: e.assets.map((a) => ({ sha: a.sha, ext: a.ext, bytes: a.bytes, ...(a.licence ? { licence: a.licence } : {}) })), core: e.core, moderation: e.moderation, at: e.at });

export function mountSharedLibraryRoutes(app: Hono, d: SharedLibraryDeps) {
  const gate = d.gate ?? validateUpload;
  let lib: SharedLibrary | null = null;
  const library = () => {
    if (!d.dir) throw new ApiError(503, 'library.unavailable', 'this site has no shared library (SIM_LIBRARY_DIR is not set)');
    if (!WORLD_SLUG.test(d.slug)) throw new ApiError(503, 'library.unavailable', `this world's key "${d.slug}" cannot name library items (a-z, 0-9, -; at most 32)`);
    return (lib ??= new SharedLibrary(d.dir, { gate, gateName: d.gateName ?? (d.gate ? 'custom' : 'library-gate/local') }));
  };
  const god = d.god, store = god.assets;
  const budget = (): Budget => ({ ...DEFAULT_BUDGET, ...god.model.constants.limits.budget });
  const has = (ref: string) => { const x = god.model.def(ref); return x && x.ref === ref ? { hash: x.hash } : undefined; };
  const body = async (c: Context) => { try { return await c.req.json(); } catch { throw new ApiError(400, 'bad-json', 'body must be JSON'); } };
  const handle = (fn: (c: Context) => Promise<Response> | Response) => async (c: Context) => { d.requireGod(c); try { return await fn(c); } catch (e) { if (e instanceof ApiError) throw e; return asApi(e); } };

  app.get('/v1/god/library', handle((c) => {
    const q = (c.req.query('q') ?? '').slice(0, 200), k = Math.min(50, Math.max(1, Number(c.req.query('k') ?? 10) || 10));
    const hits = library().find(q, { forWorld: d.slug, k }).map((h) => ({ ...h, placedHere: !!has(h.ref) }));
    return c.json({ contract: 'share/1', world: d.slug, query: q || null, hits, ...(hits.length ? {} : { hint: q ? 'nothing in the shared library matches; try fewer words' : 'the shared library is empty' }) }, 200, noStore);
  }));
  app.get('/v1/god/library/item', handle((c) => {
    const id = c.req.query('id') ?? '', L = library(), e = L.get(id);
    if (!e) throw new ApiError(404, 'library.missing', `${id} is not in the shared library`);
    const offered = L.offered(e, d.slug), versions = L.versions(e.id).map((v) => ({ version: v.version, ref: v.ref, at: v.at, offered: L.offered(v, d.slug).ok, placedHere: !!has(v.ref) }));
    return c.json({ contract: 'share/1', item: summary(e), offered: offered.ok, ...(offered.ok ? {} : { why: offered.why }), versions }, 200, noStore);
  }));
  app.post('/v1/god/library/place', handle(async (c) => {
    const p = placeSchema.safeParse(await body(c));
    if (!p.success) throw new ApiError(400, 'invalid', 'body must be { item: "<world>/<name>[@n]", at?: [x, z], name?, r?, dry? }');
    const L = library(), at = p.data.at ?? [0, 0];
    const plan = L.placement(p.data.item, { world: d.slug, name: p.data.name, p: [at[0], 0, at[1]], ...(p.data.r !== undefined ? { r: p.data.r } : {}), existing: has });
    const models: { sha: string; stored: boolean }[] = [];
    for (const a of plan.assets) {
      // the moderation seam, then this world's own asset checks (its budget)
      const g = gate(L.assetBytes(a), ASSET_POLICY);
      if (g.sha !== a.sha) throw new ApiError(422, 'moderation.changed', `the moderation gate changed model ${a.sha.slice(0, 12)} (now ${g.sha.slice(0, 12)}); it cannot be placed under the library's pin`);
      if (p.data.dry) { models.push({ sha: a.sha, stored: !!store.info(a.sha) }); continue; }
      const had = !!store.info(a.sha);
      let meta;
      try { meta = store.put(g.bytes, { name: `lib-${a.sha.slice(0, 8)}`, ...(a.licence ? { license: a.licence } : {}), ...(a.source ? { source: a.source } : {}), by: 'library', budget: budget() }); }
      catch (e) { const x = e as { status?: number; code?: string; message?: string }; throw new ApiError(x.status ?? 400, x.code ?? 'asset.invalid', `model ${a.sha.slice(0, 12)}: ${x.message ?? 'refused'}`); }
      if (meta.sha !== a.sha) throw new ApiError(422, 'moderation.changed', `${d.slug} stored model ${a.sha.slice(0, 12)} as ${meta.sha.slice(0, 12)}`);
      models.push({ sha: a.sha, stored: !had });
    }
    const note = `library: place ${plan.entry.id}@${plan.entry.version}`;
    const r = p.data.dry ? god.dryrun({ ops: plan.ops }) : god.act({ ops: plan.ops }, note);
    const out = { contract: 'share/1', item: { id: plan.entry.id, version: plan.entry.version, ref: plan.entry.ref, licence: plan.entry.licence.spdx, author: plan.entry.author }, defines: plan.ops.length - 1, models, dry: !!p.data.dry, ...r };
    return c.json(out, r.accepted ? 200 : 409, noStore);
  }));
  app.post('/v1/god/library/publish', handle(async (c) => {
    const p = publishSchema.safeParse(await body(c));
    if (!p.success) throw new ApiError(400, 'invalid', 'body must be { ref, licence?: "CC0-1.0" | "CC-BY-4.0", attribution?, source?, title?, authorName? }');
    const src: WorldSource = {
      world: d.slug,
      async def(ref) { return god.model.def(ref) ?? god.model.def(ref.replace(/^core\//, 'core-')); },
      async asset(sha) {
        const m = store.info(sha), f = store.file(sha); if (!m || !f) return undefined;
        return { bytes: new Uint8Array(readFileSync(f)), ext: m.ext, ...(m.license ? { license: m.license } : {}), ...(m.source ? { source: m.source } : {}), ...(m.name ? { name: m.name } : {}) };
      },
    };
    const licence = { spdx: p.data.licence ?? 'CC0-1.0' as const, ...(p.data.attribution ? { attribution: p.data.attribution } : {}), ...(p.data.source ? { source: p.data.source } : {}) };
    const { entry, created } = await library().publish(src, p.data.ref, { by: `god:${d.slug}`, licence, ...(p.data.title ? { title: p.data.title } : {}), ...(p.data.authorName ? { authorName: p.data.authorName } : {}) });
    return c.json({ contract: 'share/1', ok: true, created, item: summary(entry) }, 200, noStore);
  }));
}
