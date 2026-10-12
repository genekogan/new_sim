// Gene's private review artifact. Decisions are exported as data and imported by the operator, never executed as code.
import { hashOf } from '@sim/world-compiler';
import { item1Schema } from './schema.ts';
import { Registry, RegistryError } from './registry.ts';

export type ReviewDecision = { id: string; major: number; rev: string; itemHash?: string; verdict: 'ok' | 'fix' | 'reject'; note: string };
export function reviewQueue(registry: Registry) {
  const stable = new Map(registry.current('stable').map((entry) => [`${entry.id}@${entry.major}`, entry]));
  return registry.current('candidate').filter((entry) => {
    const live = stable.get(`${entry.id}@${entry.major}`);
    return entry.status === 'candidate' && !(live?.rev === entry.rev && live.itemHash === entry.itemHash);
  }).map((entry) => {
    const item = registry.item(entry.id, entry.major, entry.rev, entry.itemHash)!;
    return { entry, item };
  });
}
export function applyReviews(registry: Registry, decisions: ReviewDecision[], by: string, run: string) {
  if (!by.trim()) throw new Error('reviewer name required');
  // Validate the complete import before storing/moving any pointer.
  const updates = decisions.map((decision) => {
    if (!['ok', 'fix', 'reject'].includes(decision.verdict) || typeof decision.note !== 'string') throw new Error('invalid review decision');
    const entry = registry.resolve(`${decision.id}@${decision.major}`, 'candidate');
    if (!entry || entry.rev !== decision.rev || entry.itemHash !== decision.itemHash) throw new RegistryError('review.stale', `${decision.id}@${decision.major} changed; refresh the queue`);
    const previous = registry.item(entry.id, entry.major, entry.rev, entry.itemHash)!;
    const item = item1Schema.parse({ ...previous, review: { by, verdict: decision.verdict, note: decision.note.slice(0, 2000), at: new Date().toISOString() } });
    return { item, entry: { ...entry, itemHash: hashOf(item) } };
  });
  for (const { item } of updates) registry.putItem(item);
  if (!updates.length) return null;
  return registry.publish('candidate', updates.map((update) => update.entry), run);
}

/** Worker-facing promotion gate. P0's lower-level Registry methods remain available for imports and rollback tools. */
export function promoteChecked(registry: Registry, ids: string[], run: string, now = Date.now()) {
  const entries = reviewQueue(registry).map(({ entry }) => entry).filter((entry) => ids.includes(entry.id) || ids.includes(`${entry.id}@${entry.major}`));
  if (!entries.length) throw new RegistryError('registry.nothing', 'no candidate items match');
  const stable = registry.current('stable').map((entry) => registry.item(entry.id, entry.major, entry.rev, entry.itemHash)!);
  for (const entry of entries) {
    const item = registry.item(entry.id, entry.major, entry.rev, entry.itemHash)!;
    if (['G1', 'G2', 'G3', 'G4', 'G5'].some((gate) => !item.tests.gates[gate as 'G1']?.ok)) throw new RegistryError('catalog.gates', `${item.id} lacks passing G1–G5`);
    if (item.review?.verdict === 'fix' || item.review?.verdict === 'reject') throw new RegistryError('review.hold', `${item.id} is held for ${item.review.verdict}`);
    if (item.review?.verdict === 'ok') continue; // Explicit operator-imported Gene/PM review, recorded with immutable metadata.
    const lowRisk = /^(object|furniture|vegetation|component)(\.|$)/.test(item.text.category) && item.provenance.route !== 'glb';
    const knownCategory = stable.some((previous) => previous.text.category === item.text.category);
    const knownInteractions = item.affords.every((verb) => stable.some((previous) => previous.affords.includes(verb)));
    if (!lowRisk || !knownCategory || !knownInteractions) throw new RegistryError('review.required', `${item.id} needs Gene/PM review`);
    if (now - Date.parse(item.provenance.at) < 48 * 3600_000) throw new RegistryError('candidate.young', `${item.id} has not waited48h`);
    if (!item.tests.gates.G7?.ok || Date.parse(item.tests.gates.G7.at) < Date.parse(item.provenance.at)) throw new RegistryError('catalog.G7', `${item.id} needs a later green nightly world regression`);
  }
  return registry.promote(entries.map((entry) => `${entry.id}@${entry.major}`), run);
}
