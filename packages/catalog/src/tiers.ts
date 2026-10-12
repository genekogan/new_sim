// Hot/cold tiers (Gene, Q3: "a hot set loaded and in agent context; cold storage promoted on demand"; don't let
// low-use items clog memory, context or disk). See docs/god/CATALOG-P0.md §2.
//
//   hot   in the agent's T0 context (as category exemplars) and held in server memory as parsed defs
//   cold  on disk in the registry (defs1/<hash>.json), listed only as an index line; loaded and PROMOTED the first time
//         a world resolves it (TieredLibrary), so a world never fails on a cold ref and the hot set follows use
//
// Hotness = use first (P0 proxy: placements in the genesis templates and in sampled worlds; P2: the play stats of
// CATALOG-PROGRAM (d)), then 3 exemplars per category (so T0 covers every category), then bodies and the base kit.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { WorldModel, vocab, type DefInput, type DefLibrary, type StoredDef } from '@sim/world-compiler';
import type { Item1 } from './schema.ts';
import type { IndexEntry, Registry } from './registry.ts';

/** How often each def ref is placed by the genesis templates (worlds/templates/*.json): what gods actually use. */
export function templateUse(dir = new URL('../../../worlds/templates/', import.meta.url)): Map<string, number> {
  const out = new Map<string, number>();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) for (const m of readFileSync(new URL(f, dir), 'utf8').matchAll(/"def":\s*"(core[/-][a-z0-9._-]+@\d+)"/g)) { const k = m[1].replace('core/', 'core-'); out.set(k, (out.get(k) ?? 0) + 1); }
  return out;
}

const ALWAYS = /^eden\/(humanoid|floater|flag|box|zone)$/;
/** The hot set: used items first, then exemplars so every category is represented, capped at `n`. */
export function hotSet(items: Item1[], n = 300, use = templateUse()): Set<string> {
  const used = (it: Item1) => Math.max(0, ...it.aliases.map((a) => use.get(a) ?? 0));
  const quality = (it: Item1) => (it.licence.redistribute ? 2 : 0) + (it.budgets.bytes.assets === 0 ? 1 : 0) + Math.min(it.text.synonyms.length, 6) / 6;
  const rank = (a: Item1, b: Item1) => used(b) - used(a) || quality(b) - quality(a) || (a.id < b.id ? -1 : 1);
  const hot = new Set<string>(items.filter((it) => ALWAYS.test(it.id)).map((it) => it.id));
  // T0 coverage first: exemplars any owner's world may use (redistributable), best-used first
  const exRank = (a: Item1, b: Item1) => Number(b.licence.redistribute) - Number(a.licence.redistribute) || rank(a, b);
  for (const it of exemplars(items, 3, exRank).flatMap((c) => c.items)) hot.add(it.id);
  for (const it of [...items].sort(rank)) { if (hot.size >= n) break; if (used(it) > 0) hot.add(it.id); }
  for (const it of [...items].sort(rank)) { if (hot.size >= n) break; hot.add(it.id); }
  return hot;
}

/** Up to `per` exemplars per category (best first). */
export function exemplars(items: Item1[], per: number, rank: (a: Item1, b: Item1) => number) {
  const byCat = new Map<string, Item1[]>();
  for (const it of items) { const l = byCat.get(it.text.category) ?? []; l.push(it); byCat.set(it.text.category, l); }
  return [...byCat].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([cat, l]) => ({ cat, count: l.length, items: l.sort(rank).slice(0, per) }));
}

/** T0: what a god reads once per session: the taxonomy with counts and 3 exemplars per category, the conventions and
 *  actuators, and how to go further (find / category pages / one def). Returns the text and its size. */
export function renderT0(items: Item1[], hot: Set<string>): { text: string; bytes: number; tokens: number; categories: number } {
  const use = templateUse(), used = (it: Item1) => Math.max(0, ...it.aliases.map((a) => use.get(a) ?? 0));
  const rank = (a: Item1, b: Item1) => Number(b.licence.redistribute) - Number(a.licence.redistribute) || Number(hot.has(b.id)) - Number(hot.has(a.id)) || used(b) - used(a) || (a.id < b.id ? -1 : 1);
  const cats = exemplars(items, 3, rank);
  const label = (c: string) => vocab.CATEGORIES.get(c)?.label ?? c;
  const lines = [
    `# Eden catalogue T0: ${items.length} items in ${cats.length} categories. Never load it all: \`find <what you want>\` returns the top 10 with why; \`catalog --category <c>\` pages one category (50 a page); \`defs <ref>\` one def in full.`,
    `conventions (any item): ${Object.keys(vocab.CONVENTIONS).join(' ')} · actuators: ${Object.keys(vocab.ACTUATORS).join(' ')} · refs: eden/<x>@1 (= core/<x>@1), lm/<x>@1, mars/<x>@1`,
    ...cats.map((c) => `${c.cat} (${label(c.cat)}, ${c.count}): ${c.items.map((it) => it.id.replace(/^eden\//, '')).join(', ')}`),
  ];
  const text = lines.join('\n') + '\n';
  return { text, bytes: Buffer.byteLength(text), tokens: Math.round(Buffer.byteLength(text) / 4), categories: cats.length };
}

/** Compute tiers for the current stable snapshot and record them (tiers/<seq>.json is write-once like every snapshot). */
export function writeTiers(reg: Registry, o: { hot?: number; run?: string } = {}) {
  const entries = reg.current('stable');
  const items = entries.map((e) => reg.item(e.id, e.major, e.rev, e.itemHash)!).filter(Boolean);
  const hot = hotSet(items, o.hot ?? 300), t0 = renderT0(items, hot);
  const seq = reg.pointers().stable!;
  const rec = { seq, hot: [...hot].sort(), cold: items.length - hot.size, t0 };
  (reg as unknown as { writeOnce(rel: string, body: string): void }).writeOnce(`tiers/${seq}-${o.hot ?? 300}.json`, JSON.stringify(rec) + '\n');
  reg.log({ op: 'tiers', run: o.run, seq, hot: hot.size, cold: rec.cold, t0Bytes: t0.bytes, t0Tokens: t0.tokens });
  return { seq, hot: hot.size, cold: rec.cold, t0: { bytes: t0.bytes, tokens: t0.tokens, categories: t0.categories } };
}

/**
 * A DefLibrary over the registry with tiers: hot defs parsed in memory at start; a cold def is read from the registry
 * (defs1/<hash>.json) the first time any world asks for it, then kept (promoted). The engine's WorldModel uses it
 * exactly like the in-process core library (P1 swaps GodMode's coreLibrary() for this).
 */
export class TieredLibrary implements DefLibrary {
  readonly id: string; readonly version: string;
  private keys = new Map<string, IndexEntry>();          // name@v, core/<x>@v, sha:<h1>, id@major → entry
  private live = new Map<string, StoredDef>();           // def1 hash → parsed def (hot + promoted)
  private scratch = new WorldModel({ constants: { ground: 'land', extent: 1000 }, seed: 'tiered' });
  readonly stats = { hot: 0, promoted: 0, loads: 0, bytesLoaded: 0 };
  private reg: Registry;
  constructor(reg: Registry, hot: Set<string>, channel: 'stable' | 'candidate' = 'stable', entries = reg.current(channel)) {
    this.reg = reg; this.id = `registry:${channel}`; this.version = String(reg.pointers()[channel]);
    for (const e of entries) { for (const a of e.aliases) this.keys.set(a, e); this.keys.set(`${e.id}@${e.major}`, e); if (e.def1Hash) this.keys.set('sha:' + e.def1Hash, e); }
    for (const e of entries) if (hot.has(e.id)) { this.load(e); this.stats.hot++; }
    this.stats.promoted = 0; this.stats.loads = 0;
  }
  private load(e: IndexEntry): StoredDef | undefined {
    if (!e.def1Hash) return undefined;
    const hit = this.live.get(e.def1Hash); if (hit) return hit;
    const raw = this.reg.def1(e.def1Hash) as DefInput | null; if (!raw) return undefined;
    this.stats.loads++; this.stats.bytesLoaded += JSON.stringify(raw).length;
    const d = this.scratch.defineDef(raw, 'core', 0);
    if (d.hash !== e.def1Hash) throw new Error(`registry def ${e.id} hashes to ${d.hash.slice(0, 12)}, index says ${e.def1Hash.slice(0, 12)}`);
    this.live.set(e.def1Hash, d); return d;
  }
  get(key: string): StoredDef | undefined {
    const e = this.keys.get(key); if (!e) return undefined;
    const was = e.def1Hash ? this.live.has(e.def1Hash) : true;
    const d = this.load(e); if (d && !was) this.stats.promoted++;
    return d;
  }
  /** What is in memory (hot + promoted). Search and listing go through the index lines and `find`, never this. */
  all(): readonly StoredDef[] { return [...this.live.values()]; }
  inMemory() { return { defs: this.live.size, bytes: [...this.live.values()].reduce((a, d) => a + JSON.stringify(d).length, 0) }; }
}
