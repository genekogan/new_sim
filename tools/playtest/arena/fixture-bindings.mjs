// Bind reviewed stable entity paths to this fresh world's generated IDs. Descriptions never enter oracle truth.
import { sha256 } from '../lib/hash.mjs';
export function bindJourneyFixtures(scenario, snapshot) {
  const byId = new Map((snapshot.entities ?? []).map(e => [e.id, e]));
  const path = e => { const names = []; const seen = new Set(); while (e) { if (seen.has(e.id)) throw new Error('fixture parent cycle'); seen.add(e.id); names.unshift(e.name ?? e.id); e = byId.get(e.in?.parent); } return names.join('/'); };
  const byPath = new Map((snapshot.entities ?? []).map(e => [path(e), e]));
  const bindings = [];
  for (const entry of scenario.director?.script ?? []) for (const phase of entry.expect?.journey?.phases ?? []) for (const p of phase.anyOf ?? [phase]) {
    if (!p.receipt?.targetRefs) continue;
    p.receipt.targetIds = p.receipt.targetRefs.map(ref => {
      const entity = byPath.get(ref); if (!entity) throw new Error(`fixture ${entry.id}: required entity ${ref} missing`);
      bindings.push({ ref, id: entity.id, def: entity.def, p: entity.p, parent: entity.in?.parent });
      return entity.id;
    });
  }
  return { schema: 'journey-bindings/1', worldId: snapshot.worldId, snapshotSeq: snapshot.seq, geometrySha256: sha256(JSON.stringify((snapshot.entities ?? []).filter(e => !String(e.id).startsWith('h_')).map(({ id, name, def, p, r, s, shape, in: parent }) => ({ id, name, def, p, r, s, shape, parent })))), bindings };
}
