// Registry serving: channel snapshots and item words are hot; engine defs stay cold until resolved.
// One instance can be shared by every world's model with the same licence context. No model calls, no catalogue copy.
import { hashOf, vocab, type DefLibrary, type StoredDef } from '@sim/world-compiler';
import { Registry, RegistryError, type Channel, type IndexEntry } from './registry.ts';
import { item1Schema, type Item1 } from './schema.ts';
import { hotSet, renderT0, TieredLibrary } from './tiers.ts';
import { buildLexicalIndex, lexical, type Index, type Doc } from './embed.ts';

export type ServingOptions = { channel?: Channel; hot?: number; ownerIsGene?: boolean; export?: boolean };
export type CatalogHit = { entry: IndexEntry; item: Item1; row: vocab.ManifestRow; score: number; why: string[] };

export class RegistryCatalog implements DefLibrary {
  readonly id: string;
  private seq: number | null | undefined;
  private entries: IndexEntry[] = [];
  private items = new Map<string, Item1>();
  private rows = new Map<string, vocab.ManifestRow>();
  private index: Index = buildLexicalIndex([]);
  private tiered!: TieredLibrary;
  private context: ServingOptions;
  readonly registry: Registry;
  constructor(registry: Registry, options: ServingOptions = {}) {
    this.registry = registry;
    this.context = options;
    this.id = `registry:${options.channel ?? 'stable'}`;
    this.refresh();
  }
  get version() { this.refresh(); return String(this.seq); }
  get channel() { return this.context.channel ?? 'stable'; }
  /** Build the new view completely before replacing the last good snapshot. A bad publication never half-loads. */
  refresh(): boolean {
    const seq = this.registry.pointers()[this.channel];
    if (seq === this.seq) return false;
    if (seq === null) throw new RegistryError('registry.empty', `no ${this.channel} snapshot`);
    const entries = this.registry.current(this.channel).filter((e) => this.registry.offerable(e, this.context));
    const items = new Map<string, Item1>(), rows = new Map<string, vocab.ManifestRow>();
    for (const e of entries) {
      const it = item1Schema.parse(this.registry.item(e.id, e.major, e.rev, e.itemHash));
      if (it.id !== e.id || it.major !== e.major || it.rev !== e.rev || (e.itemHash && hashOf(it) !== e.itemHash))
        throw new RegistryError('registry.invalid-item', `${e.id}@${e.major} does not match its index`);
      if (it.licence.redistribute !== e.redistribute)
        throw new RegistryError('registry.invalid-licence', `${e.id}@${e.major} index differs from its licence`);
      const ref = `${e.id}@${e.major}`;
      // P0 indexes have no compact row. Convert once without retaining/parsing engine StoredDefs.
      const row = e.row ?? vocab.manifestRow({ ...this.registry.def(e.rev), description: it.text.first, category: it.text.category, synonyms: it.text.synonyms } as never,
        { bytes: it.budgets.bytes.assets, publicRef: ref });
      items.set(ref, it);
      rows.set(ref, { ...row, ref, cat: it.text.category, syn: it.text.synonyms, doc: it.text.first.slice(0, 100), tris: it.budgets.tris.lod0 });
    }
    const hot = hotSet([...items.values()], this.context.hot ?? 300);
    const docs: Doc[] = entries.map((e) => {
      const it = items.get(`${e.id}@${e.major}`)!;
      return { id: `${e.id}@${e.major}`, title: it.text.title, synonyms: it.text.synonyms, category: it.text.category,
        affords: it.affords, first: it.text.first, description: it.text.description, line: e.line };
    });
    const index = buildLexicalIndex(docs), tiered = new TieredLibrary(this.registry, hot, this.channel, entries);
    this.entries = entries; this.items = items; this.rows = rows; this.index = index; this.tiered = tiered; this.seq = seq;
    return true;
  }
  get(key: string): StoredDef | undefined { this.refresh(); return this.tiered.get(key); }
  all(): readonly StoredDef[] { this.refresh(); return this.tiered.all(); }
  stats() { this.refresh(); return { seq: this.seq, offered: this.entries.length, ...this.tiered.stats, ...this.tiered.inMemory() }; }
  t0() { this.refresh(); return renderT0([...this.items.values()], hotSet([...this.items.values()], this.context.hot ?? 300)); }
  list(facets: vocab.Facets = {}): CatalogHit[] {
    this.refresh();
    return this.entries.map((entry) => {
      const ref = `${entry.id}@${entry.major}`;
      return { entry, item: this.items.get(ref)!, row: this.rows.get(ref)!, score: 0, why: [] as string[] };
    }).filter((h) => matches(h, facets));
  }
  find(q: string, options: { k?: number; facets?: vocab.Facets } = {}): CatalogHit[] {
    this.refresh();
    const allowed = new Map(this.list(options.facets).map((h) => [h.row.ref, h]));
    if (!q.trim()) return [...allowed.values()].slice(0, options.k ?? 10);
    // Rank the complete index before faceting; a match can be cold and never needs its def to rank.
    return lexical(this.index, q).filter((h) => allowed.has(this.index.ids[h.i]))
      .slice(0, options.k ?? 10).map((h) => ({ ...allowed.get(this.index.ids[h.i])!, score: h.s, why: h.why.map((w) => `word:${w}`) }));
  }
  taxonomy() {
    const counts = new Map<string, number>();
    for (const { item } of this.list()) for (let p = item.text.category; p; p = p.includes('.') ? p.slice(0, p.lastIndexOf('.')) : '')
      counts.set(p, (counts.get(p) ?? 0) + 1);
    return vocab.TAXONOMY.map((t) => ({ ...t, count: counts.get(t.id) ?? 0 }));
  }
}

function matches(h: CatalogHit, f: vocab.Facets) {
  const { row: r, item: it } = h;
  return (!f.category || r.cat === f.category || r.cat.startsWith(f.category + '.')) && (!f.form || r.form === f.form)
    && (!f.tag || r.tags.includes(f.tag)) && (f.has ?? []).every((facet) => {
      if (facet.startsWith('slot:')) return r.ifc.split(' ').some((s) => s === facet.slice(5) || s.startsWith(facet.slice(5) + ':'));
      if (facet.startsWith('action:')) return it.affords.includes(facet.slice(7));
      if (facet.startsWith('sound:')) return it.sound?.kinds.includes(facet.slice(6));
      if (facet.startsWith('behavior:')) return it.behaviour?.kind === facet.slice(9);
      if (facet === 'sound') return !!it.sound;
      if (facet === 'behavior') return !!it.behaviour;
      return it.affords.includes(facet);
    });
}
