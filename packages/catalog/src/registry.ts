// The registry: content-addressed, append-only, with channels (CATALOG-PROGRAM (c) "Channels, publishing, rollback").
//
//   defs/<h2>.json                     def/2, by its rev (hash of the canonical def/2)
//   defs1/<h1>.json                    the def/1 engine view, by the hash worlds pin today (so a stored def maps to its item)
//   items/<ns>/<name>/<major>/<rev>.json   item/1 at publish time (immutable)
//   index/<channel>/<seq>.json         an immutable index snapshot: [{ id, major, rev, status, tier, line }]
//   channels.json                      { stable: <seq> | null, candidate: <seq> | null } — the ONLY mutable file
//   ledger.jsonl                       one line per run / publish / promote / yank / rollback (append-only)
//
// Every file but channels.json and ledger.jsonl is write-once: writing different bytes to an existing path throws
// `registry.immutable`. A rollback is one pointer write. A yank writes a new snapshot; worlds that placed the item keep
// it (they pin the hash and blobs are never deleted). P0 keeps it on local disk; the same layout goes to R2 (docs/god/CDN.md).
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, appendFileSync, linkSync, unlinkSync, rmdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { hashOf, stableStringify } from '@sim/world-compiler';
import { def2Schema, item1Schema, type Def2, type Item1 } from './schema.ts';

export const CHANNELS = ['stable', 'candidate'] as const;
export type Channel = (typeof CHANNELS)[number];
export type IndexEntry = { id: string; major: number; rev: string; itemHash?: string; status: Item1['status']; tier: Item1['tier']; aliases: string[]; def1Hash?: string; line: string; redistribute: boolean; row?: import('@sim/world-compiler').vocab.ManifestRow };
export type Pointers = Record<Channel, number | null>;
export class RegistryError extends Error { readonly code: string; constructor(code: string, msg: string) { super(`${code}: ${msg}`); this.code = code; } }

const canon = (v: unknown) => stableStringify(v) + '\n';

export class Registry {
  readonly root: string;
  constructor(root: string) { this.root = root; mkdirSync(root, { recursive: true }); }

  // ---------------------------------------------------------------- write-once storage
  private writeOnce(rel: string, body: string): 'new' | 'same' {
    const p = join(this.root, rel);
    if (existsSync(p)) { if (readFileSync(p, 'utf8') !== body) throw new RegistryError('registry.immutable', `${rel} exists with other content`); return 'same'; }
    mkdirSync(dirname(p), { recursive: true });
    const tmp = `${p}.tmp-${process.pid}`; writeFileSync(tmp, body, { flag: 'wx' });
    try {
      // link is atomic and never replaces an existing blob, even when two workers publish together.
      try { linkSync(tmp, p); return 'new'; }
      catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        if (readFileSync(p, 'utf8') !== body) throw new RegistryError('registry.immutable', `${rel} exists with other content`);
        return 'same';
      }
    } finally { unlinkSync(tmp); }
  }
  private read<T>(rel: string): T | null { const p = join(this.root, rel); return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : null; }

  /** Store a def/2 by its content hash (idempotent). */
  putDef(d2: Def2): string { const d = def2Schema.parse(d2); const h = hashOf(d); this.writeOnce(`defs/${h}.json`, canon(d)); return h; }
  /** Store the def/1 engine view under the hash worlds pin (idempotent). */
  putDef1(h1: string, d1: unknown): void { this.writeOnce(`defs1/${h1}.json`, canon(d1)); }
  def(h: string): Def2 | null { return this.read<Def2>(`defs/${h}.json`); }
  def1(h1: string): unknown { return this.read(`defs1/${h1}.json`); }
  /** Store an item at its rev; the def it names must already be stored. */
  putItem(item: Item1): string {
    const it = item1Schema.parse(item);
    if (!existsSync(join(this.root, `defs/${it.rev}.json`))) throw new RegistryError('registry.missing-def', `${it.id}@${it.major} rev ${it.rev.slice(0, 12)} has no def`);
    // Item metadata has its own content hash. Text/review/gates may change without changing the world-pinned def.
    const rel = `items/${it.id}/${it.major}/${it.rev}/${hashOf(it)}.json`;
    this.writeOnce(rel, canon(it));
    // Keep the first P0-compatible record immutable; new index snapshots explicitly pin itemHash.
    const legacy = `items/${it.id}/${it.major}/${it.rev}.json`;
    if (!existsSync(join(this.root, legacy))) this.writeOnce(legacy, canon(it));
    return rel;
  }
  item(id: string, major: number, rev: string, itemHash?: string): Item1 | null { return this.read<Item1>(itemHash ? `items/${id}/${major}/${rev}/${itemHash}.json` : `items/${id}/${major}/${rev}.json`); }

  // ---------------------------------------------------------------- channels
  pointers(): Pointers { return this.read<Pointers>('channels.json') ?? { stable: null, candidate: null }; }
  private setPointers(p: Pointers) { const f = join(this.root, 'channels.json'), tmp = `${f}.tmp-${process.pid}`; writeFileSync(tmp, canon(p)); renameSync(tmp, f); }
  private mutate<T>(fn: () => T): T {
    const lock = join(this.root, '.publish-lock');
    try { mkdirSync(lock); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new RegistryError('registry.busy', 'another publisher holds .publish-lock; retry after it completes');
      throw e;
    }
    try { return fn(); } finally { rmdirSync(lock); }
  }
  seqs(ch: Channel): number[] { const d = join(this.root, 'index', ch); return existsSync(d) ? readdirSync(d).filter((f) => /^\d+\.json$/.test(f)).map((f) => Number(f.slice(0, -5))).sort((a, b) => a - b) : []; }
  snapshot(ch: Channel, seq: number | null = this.pointers()[ch]): IndexEntry[] { return seq === null ? [] : (this.read<IndexEntry[]>(`index/${ch}/${seq}.json`) ?? []); }
  /** What a channel serves now (yanked entries kept in the index for provenance, but not offered). */
  current(ch: Channel, opts: { includeYanked?: boolean } = {}): IndexEntry[] { return this.snapshot(ch).filter((e) => opts.includeYanked || e.status !== 'yanked'); }

  private writeIndex(ch: Channel, entries: IndexEntry[], why: Record<string, unknown>): number {
    const seq = (this.seqs(ch).at(-1) ?? 0) + 1;
    const sorted = [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.major - b.major));
    this.writeOnce(`index/${ch}/${seq}.json`, canon(sorted));
    const p = this.pointers(); p[ch] = seq; this.setPointers(p);
    this.log({ ...why, channel: ch, seq, entries: sorted.length });
    return seq;
  }
  log(rec: Record<string, unknown>) { appendFileSync(join(this.root, 'ledger.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...rec }) + '\n'); }
  ledger(): Record<string, unknown>[] { const f = join(this.root, 'ledger.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; }

  /** Publish entries into a channel: a new immutable snapshot = the current one with these (id, major) replaced or added. */
  publish(ch: Channel, entries: IndexEntry[], run: string): number {
    return this.mutate(() => this.publishLocked(ch, entries, run));
  }
  private publishLocked(ch: Channel, entries: IndexEntry[], run: string): number {
    for (const e of entries) if (!this.item(e.id, e.major, e.rev, e.itemHash)) throw new RegistryError('registry.missing-item', `${e.id}@${e.major} ${e.rev.slice(0, 12)}`);
    const key = (e: IndexEntry) => `${e.id}@${e.major}`;
    const next = new Map(this.snapshot(ch).map((e) => [key(e), e]));
    for (const e of entries) next.set(key(e), e);
    return this.writeIndex(ch, [...next.values()], { op: 'publish', run, changed: entries.length });
  }
  /** Promote candidate entries (all, or the given ids) to stable, marking them stable. */
  promote(ids: string[] | 'all', run: string): number {
    return this.mutate(() => {
    const pick = this.current('candidate').filter((e) => ids === 'all' || ids.includes(e.id) || ids.includes(`${e.id}@${e.major}`));
    if (!pick.length) throw new RegistryError('registry.nothing', 'no candidate entries match');
    return this.publishLocked('stable', pick.map((e) => ({ ...e, status: 'stable' as const })), run);
    });
  }
  /** Repoint a channel to its previous snapshot: one write, effective on the next poll. */
  rollback(ch: Channel, run: string, to?: number): number {
    return this.mutate(() => {
    const cur = this.pointers()[ch], seqs = this.seqs(ch);
    const target = to ?? [...seqs].reverse().find((s) => cur !== null && s < cur);
    if (target === undefined || !seqs.includes(target)) throw new RegistryError('registry.nothing', `no earlier ${ch} snapshot`);
    const p = this.pointers(); p[ch] = target; this.setPointers(p);
    this.log({ op: 'rollback', run, channel: ch, from: cur, to: target });
    return target;
    });
  }
  /** Yank: gone from search and new placement in every channel; worlds that placed it keep it (they pin its hash). */
  yank(id: string, major: number, run: string, reason: string): number[] {
    return this.mutate(() => {
    const out: number[] = [];
    for (const ch of CHANNELS) {
      const snap = this.snapshot(ch); const hit = snap.some((e) => e.id === id && e.major === major && e.status !== 'yanked');
      if (hit) out.push(this.writeIndex(ch, snap.map((e) => (e.id === id && e.major === major ? { ...e, status: 'yanked' as const } : e)), { op: 'yank', run, id, major, reason }));
    }
    if (!out.length) throw new RegistryError('registry.nothing', `${id}@${major} is not offered`);
    return out;
    });
  }

  // ---------------------------------------------------------------- resolution
  /** id@major, an alias (core/x@1, core-x@1), or a def/1 hash → the entry a channel serves. */
  resolve(ref: string, ch: Channel = 'stable'): IndexEntry | null {
    const all = this.current(ch, { includeYanked: true });
    const m = /^(.+)@(\d+)$/.exec(ref);
    const hit = (m && all.find((e) => e.id === m[1] && e.major === Number(m[2])))
      ?? all.find((e) => e.aliases.includes(ref)) ?? all.find((e) => e.def1Hash === ref || e.rev === ref) ?? null;
    return hit && hit.status === 'yanked' && !/^[0-9a-f]{64}$/.test(ref) ? null : hit;   // a pinned hash always resolves
  }
  /** Redistribution limit (Gene, Q2): a restricted item is never offered to other owners' worlds or exported. */
  offerable(e: IndexEntry, ctx: { ownerIsGene?: boolean; export?: boolean }): boolean { return e.status !== 'yanked' && (e.redistribute || (!!ctx.ownerIsGene && !ctx.export)); }
}
