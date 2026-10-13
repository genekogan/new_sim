// Release-only migration. Original P0 blobs/snapshots remain immutable for existing worlds.
import { hashOf, stableStringify, type DefInput } from '@sim/world-compiler';
import { Registry, RegistryError, type IndexEntry } from './registry.ts';
import { def1Hash, def1to2, def2Hash } from './def1to2.ts';
import { item1Schema } from './schema.ts';

export function pinReleaseSeed(registry: Registry, run: string) {
  if (registry.seqs('stable').length !== 1 || registry.seqs('candidate').length !== 1)
    throw new RegistryError('catalog.seed', 'pin seed only in a fresh unpublished import registry');
  const original = registry.current('stable'), byRef = new Map<string, IndexEntry>();
  for (const e of original) for (const ref of [`${e.id}@${e.major}`, ...e.aliases, `sha:${e.def1Hash}`]) byRef.set(ref, e);
  const done = new Map<string, IndexEntry>(), visiting = new Set<string>();
  const pin = (entry: IndexEntry): IndexEntry => {
    const key = `${entry.id}@${entry.major}`, found = done.get(key); if (found) return found;
    if (visiting.has(key)) throw new RegistryError('catalog.dependency', `cyclic seed dependency ${key}`);
    visiting.add(key);
    const parents = new Set<string>(); let restricted = false;
    const reference = (ref: string) => {
      const dependency = byRef.get(ref);
      if (!dependency) throw new RegistryError('catalog.dependency', `unknown seed dependency ${ref} in ${key}`);
      const frozen = pin(dependency); parents.add(frozen.def1Hash!); restricted ||= !frozen.redistribute;
      return 'sha:' + frozen.def1Hash;
    };
    const map = (value: unknown): unknown => {
      if (typeof value === 'string' && (/^sha:[0-9a-f]{64}$/.test(value) || /^(core[/-]|eden\/|mars\/|lm\/)[a-z0-9._-]+@\d+$/.test(value))) return reference(value);
      if (Array.isArray(value)) return value.map(map);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, map(v)]));
      return value;
    };
    const raw = registry.def1(entry.def1Hash!) as DefInput | null;
    if (!raw) throw new RegistryError('registry.missing-def', key);
    const input = { ...raw, ...(raw.extends ? { extends: reference(raw.extends) } : {}),
      make: map(raw.make), params: map(raw.params), components: map(raw.components), ...(raw.contents ? { contents: map(raw.contents) } : {}) } as DefInput;
    const hash = def1Hash(input), up = def1to2(input), rev = def2Hash(up.def2);
    const previous = registry.item(entry.id, entry.major, entry.rev, entry.itemHash)!;
    const licence = restricted && previous.licence.redistribute ? { spdx: 'third-party-restricted' as const, redistribute: false,
      attribution: 'Contains restricted catalogue dependencies', source: previous.licence.source ?? 'catalogue dependency graph' } : previous.licence;
    const changed = hash !== entry.def1Hash;
    const item = item1Schema.parse({ ...previous, rev, def1Hash: hash, licence,
      budgets: { ...previous.budgets, bytes: { ...previous.budgets.bytes, def: Buffer.byteLength(stableStringify(up.def2)) } },
      provenance: { ...previous.provenance, run, parents: [...parents].sort() },
      tests: { ...previous.tests, gates: { ...previous.tests.gates, ...(changed ? { G4: { ok: false, at: new Date().toISOString(), report: 'grandfathered seed: dependency graph hash changed; baseline approval pending', grandfathered: true } } : {}) } } });
    registry.putDef(up.def2); registry.putDef1(hash, input); registry.putItem(item);
    const next = { ...entry, rev, def1Hash: hash, itemHash: hashOf(item), redistribute: licence.redistribute };
    visiting.delete(key); done.set(key, next); return next;
  };
  const entries = original.map(pin);
  const stable = registry.publish('stable', entries, run), candidate = registry.publish('candidate', entries, run);
  registry.log({ op: 'pin-release-seed', run, stable, candidate, originalStable: 1, originalCandidate: 1,
    changed: entries.filter((e, i) => e.def1Hash !== original[i].def1Hash).length });
  return { stable, candidate, entries, changed: entries.filter((e, i) => e.def1Hash !== original[i].def1Hash).length };
}
