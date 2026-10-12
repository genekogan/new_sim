// Registry serving: channel snapshots and item words are hot; engine defs stay cold until resolved.
// One instance can be shared by every world's model with the same licence context. No model calls, no catalogue copy.
import { hashOf, vocab, type DefLibrary, type StoredDef } from '@sim/world-compiler';
import { Registry, RegistryError, type Channel, type IndexEntry } from './registry.ts';
import { item1Schema, REDISTRIBUTABLE, type Item1 } from './schema.ts';
import { facetsOf } from './import-core.ts';
import { hotSet, renderT0, TieredLibrary } from './tiers.ts';
import { buildLexicalIndex, lexical, type Index, type Doc } from './embed.ts';

export type ServingOptions = { channel?: Channel; hot?: number; ownerIsGene?: boolean; export?: boolean; pollMs?: number };
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
  private managed = new Set<string>();
  private checkedAt = 0;
  private exportPointers = '';
  private exportPermissions = new Map<string, boolean>();
  lastError: string | null = null;
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
  refresh(force = false): boolean {
    if (!force && this.seq !== undefined && Date.now() - this.checkedAt < (this.context.pollMs ?? 0)) return false;
    this.checkedAt = Date.now();
    try { return this.loadSnapshot(); }
    catch (error) {
      if (this.seq === undefined) throw error;
      this.lastError = String(error);
      return false; // Keep the last good complete snapshot available to worlds.
    }
  }
  private loadSnapshot(): boolean {
    const seq = this.registry.pointers()[this.channel];
    if (seq === this.seq) return false;
    if (seq === null) throw new RegistryError('registry.empty', `no ${this.channel} snapshot`);
    if (!this.registry.seqs(this.channel).includes(seq)) throw new RegistryError('registry.missing-index', `${this.channel}/${seq}`);
    const snapshot = this.registry.snapshot(this.channel, seq);
    const managed = new Set(snapshot.flatMap((e) => [`${e.id}@${e.major}`, ...e.aliases]));
    const entries = snapshot.filter((e) => this.registry.offerable(e, this.context));
    const items = new Map<string, Item1>(), rows = new Map<string, vocab.ManifestRow>();
    for (const e of entries) {
      const it = item1Schema.parse(this.registry.item(e.id, e.major, e.rev, e.itemHash));
      if (it.id !== e.id || it.major !== e.major || it.rev !== e.rev || (e.itemHash && hashOf(it) !== e.itemHash))
        throw new RegistryError('registry.invalid-item', `${e.id}@${e.major} does not match its index`);
      if (it.licence.redistribute !== e.redistribute || it.licence.redistribute !== REDISTRIBUTABLE[it.licence.spdx])
        throw new RegistryError('registry.invalid-licence', `${e.id}@${e.major} index differs from its licence`);
      const ref = `${e.id}@${e.major}`;
      // P0 indexes have no compact row. Convert once without retaining/parsing engine StoredDefs.
      const row = e.row ?? vocab.manifestRow({ ...this.registry.def(e.rev), description: it.text.first, category: it.text.category, synonyms: it.text.synonyms } as never,
        { bytes: it.budgets.bytes.assets, publicRef: ref });
      items.set(ref, it);
      rows.set(ref, { ...row, ref, cat: it.text.category, syn: it.text.synonyms, doc: it.text.first.slice(0, 100), tris: it.budgets.tris.lod0 });
      if (!e.facets) e.facets = facetsOf(this.registry.def1(e.def1Hash!) as StoredDef);
    }
    const hot = hotSet([...items.values()], this.context.hot ?? 300);
    const docs: Doc[] = entries.map((e) => {
      const it = items.get(`${e.id}@${e.major}`)!;
      return { id: `${e.id}@${e.major}`, title: it.text.title, synonyms: it.text.synonyms, category: it.text.category,
        affords: it.affords, first: it.text.first, description: it.text.description, line: e.line };
    });
    const index = buildLexicalIndex(docs), tiered = new TieredLibrary(this.registry, hot, this.channel, entries);
    this.entries = entries; this.items = items; this.rows = rows; this.index = index; this.tiered = tiered; this.seq = seq;
    this.managed = managed;
    this.lastError = null;
    return true;
  }
  get(key: string): StoredDef | undefined { this.refresh(); return this.tiered.get(key); }
  placementRef(key: string): string | null | undefined {
    this.refresh();
    const d = this.tiered.get(key);
    return d ? 'sha:' + d.hash : this.managed.has(key) ? null : undefined;
  }
  manages(ref: string) { this.refresh(); return this.managed.has(ref); }
  /** Historical revisions keep their licence after yank or channel rollback. Used only for explicit export metadata. */
  canExport(hash: string): boolean {
    const pointers = JSON.stringify(this.registry.pointers());
    if (pointers !== this.exportPointers) {
      const permissions = new Map<string, boolean>();
      for (const channel of ['stable', 'candidate'] as const) for (const seq of this.registry.seqs(channel))
        for (const entry of this.registry.snapshot(channel, seq)) if (entry.def1Hash)
          permissions.set(entry.def1Hash, (permissions.get(entry.def1Hash) ?? true) && entry.redistribute);
      this.exportPermissions = permissions; this.exportPointers = pointers;
    }
    return this.exportPermissions.get(hash) ?? true;
  }
  details(ref: string): CatalogHit | undefined {
    return this.list().find((h) => h.row.ref === ref || h.entry.aliases.includes(ref) || h.entry.def1Hash === ref.replace(/^sha:/, ''));
  }
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
      const engineFacet = facet.includes(':') ? facet : `verb:${facet}`;
      if (h.entry.facets?.includes(engineFacet)) return true;
      if (facet.startsWith('sound:')) return it.sound?.kinds.includes(facet.slice(6));
      if (facet.startsWith('behavior:')) return it.behaviour?.kind === facet.slice(9);
      if (facet === 'sound') return !!it.sound;
      if (facet === 'behavior') return !!it.behaviour;
      return false;
    });
}
