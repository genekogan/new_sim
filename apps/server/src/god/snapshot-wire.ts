// Lane W3 (2026-10-19): the viewer's world snapshot on the wire — share and repeat, never the same bytes twice.
//   GET /v1/world/snapshot?defs=ref[&v=<key>]  the snapshot (built once per world state by snapshot-cache.ts, edge-
//        cacheable under O2's key) without `defs` and `ground` and without entity params equal to their def's default;
//        `defsRef`/`groundRef` (also headers x-defs-ref / x-ground-ref) name the parts. The client puts it back exactly
//        (apps/web/src/snapshot-wire.ts expandSnapshot).
//   GET /v1/world/part/<ref>  a part, content-addressed (sha256 of its JSON, 32 hex) and immutable: one download per
//        browser for every world and visit with the same defs (or ground). Parts are cut from the moderation-filtered
//        snapshot, and those cut under an older moderation version are dropped.
// Plain /v1/world/snapshot (CLI, god UI, resync fallbacks, tests) is unchanged.
import { createHash } from 'node:crypto';
import { brotliCompress, brotliCompressSync, constants as Z, gzipSync } from 'node:zlib';
import type { Hono } from 'hono';
import { acceptsEncoding } from './snapshot-cache.ts';

export type SplitSnapshot = { body: Record<string, unknown>; parts: { defs: unknown[]; ground: unknown }; refs: { defs: string; ground: string } };
const refOf = (json: string) => createHash('sha256').update(json).digest('hex').slice(0, 32);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Split a world/1 snapshot for the wire (see the header). */
export function splitSnapshot(snap: Record<string, unknown>): SplitSnapshot {
  const { defs = [], ground = null, entities = [], ...rest } = snap as { defs?: { name?: string; version?: number; params?: Record<string, { default?: unknown }> }[]; ground?: unknown; entities?: { def?: string; params?: Record<string, unknown> }[] } & Record<string, unknown>;
  const byRef = new Map(defs.map((d) => [`${d.name}@${d.version}`, d.params ?? {}]));
  const lean = entities.map((e) => {
    const spec = e.def ? byRef.get(e.def) : undefined; if (!e.params || !spec) return e;
    const params: Record<string, unknown> = {}; for (const [k, v] of Object.entries(e.params)) { const s = spec[k]; if (!(s && typeof s === 'object' && 'default' in s && same(s.default, v))) params[k] = v; }
    return { ...e, params };
  });
  const refs = { defs: refOf(JSON.stringify(defs)), ground: refOf(JSON.stringify(ground)) };
  return { body: { ...rest, entities: lean, defsRef: refs.defs, groundRef: refs.ground, paramsDefaulted: true }, parts: { defs, ground }, refs };
}

type Part = { raw: Buffer; br: Buffer; gz?: Buffer; version: string };
const KEEP = 8;
/** The parts of the last few wire snapshots, compressed (brotli-9 at once, brotli-11 from the threadpool). */
export class SnapshotParts {
  private rows = new Map<string, Part>();
  private version = '';
  current: { defs: string; ground: string } | null = null;
  /** Split a (moderation-filtered) snapshot cut under `version`; keeps its parts and returns the wire body. */
  cut(snap: Record<string, unknown>, version: string): Record<string, unknown> {
    if (version !== this.version) { this.version = version; this.rows.clear(); }
    const s = splitSnapshot(snap);
    for (const [name, ref] of Object.entries(s.refs) as ['defs' | 'ground', string][]) {
      if (this.rows.has(ref)) { const r = this.rows.get(ref)!; this.rows.delete(ref); this.rows.set(ref, r); continue; }
      const raw = Buffer.from(JSON.stringify(s.parts[name])), row: Part = { raw, br: brotliCompressSync(raw, opts(9, raw.length)), version };
      brotliCompress(raw, opts(11, raw.length), (err, out) => { if (!err && out.length < row.br.length) row.br = out; });
      this.rows.set(ref, row); while (this.rows.size > KEEP) this.rows.delete(this.rows.keys().next().value!);
    }
    this.current = s.refs; return s.body;
  }
  get(ref: string): Part | undefined { const r = this.rows.get(ref); return r && r.version === this.version ? r : undefined; }
}
const opts = (q: number, n: number) => ({ params: { [Z.BROTLI_PARAM_QUALITY]: q, [Z.BROTLI_PARAM_SIZE_HINT]: n, [Z.BROTLI_PARAM_MODE]: Z.BROTLI_MODE_TEXT } });

export function mountSnapshotParts(app: Hono, parts: SnapshotParts) {
  app.get('/v1/world/part/:ref', (c) => {
    const ref = c.req.param('ref'), row = /^[0-9a-f]{32}$/.test(ref) ? parts.get(ref) : undefined;
    if (!row) return c.json({ error: 'unknown part; fetch /v1/world/snapshot?defs=ref again' }, 404, { 'cache-control': 'no-store' });
    const h: Record<string, string> = { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'public, max-age=31536000, immutable', vary: 'Accept-Encoding' };
    const enc = c.req.header('accept-encoding');
    if (acceptsEncoding(enc, 'br')) return c.body(new Uint8Array(row.br), 200, { ...h, 'content-encoding': 'br' });
    if (acceptsEncoding(enc, 'gzip')) { row.gz ??= gzipSync(row.raw); return c.body(new Uint8Array(row.gz), 200, { ...h, 'content-encoding': 'gzip' }); }
    return c.body(new Uint8Array(row.raw), 200, h);
  });
}
