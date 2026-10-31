import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';

export const layout = JSON.parse(readFileSync(new URL('./layout.json', import.meta.url), 'utf8'));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const changedSeats = layout.seats.filter(s => !same(s.before, s.after));
export const templateBatch = () => ({
  group: layout.id,
  note: 'Keep the four named Chiba tier cushions on their existing supported treads, clear of the central stair landings and static solids; preserve all seat definitions and capability identities.',
  ops: changedSeats.map(s => ({op: 'move', id: s.name, p: [...s.after], r: s.r})),
});

/** Snapshot-bound public edits only. The owner must supply fresh native vacancy
 * reads for the three moving fixtures; moving an occupied fixture is not a repair. */
export function makePatch(snapshot, {vacant, group = `${layout.id}-${randomBytes(4).toString('hex')}`} = {}) {
  assert.equal(snapshot.contract, 'world/1', 'public authored-world snapshot required');
  assert.equal(typeof snapshot.worldId, 'string', 'world identity required');
  assert(new RegExp(`^${layout.id}-[a-z0-9-]{1,24}$`).test(group), 'unique patch group required');
  const byName = name => {
    const es = snapshot.entities.filter(e => e.name === name && e.in?.parent === 'world');
    assert.equal(es.length, 1, `one root-level ${name} required`);
    return es[0];
  };
  const check = (e, expected, p) => {
    const d = snapshot.defs.find(d => e.def === d.ref || e.def === `sha:${d.hash}`);
    assert(d && d.hash === expected.hash && d.ref === expected.ref, `${expected.name} definition changed`);
    assert(same(e.p, p) && e.r === expected.r && (e.s ?? 1) === 1, `${expected.name} source pose changed`);
    assert(!e.schedule?.events?.length, `${expected.name} has a schedule`);
    assert(Number.isSafeInteger(e.v), `${expected.name} revision required`);
  };
  const chiba = byName(layout.source.name);
  check(chiba, layout.source, layout.source.p);
  const entries = layout.seats.map(s => ({seat: s, entity: byName(s.name)}));
  for (const {seat, entity} of entries) check(entity, seat, seat.before);
  for (const s of changedSeats) assert(vacant?.[s.name] === true, `fresh native vacancy proof required for ${s.name}`);
  const moved = entries.filter(({seat}) => changedSeats.includes(seat));
  const batch = {...templateBatch(), group, clientRef: group,
    expect: Object.fromEntries([chiba, ...entries.map(x => x.entity)].map(e => [e.id, {id: e.id, v: e.v}])),
    ops: moved.map(({seat, entity}) => ({op: 'move', id: entity.id, p: [...seat.after], r: seat.r})),
  };
  // Explicit guarded inverse is useful even if the server's group undo is no
  // longer at the head. It refuses any intervening revision of a moved fixture.
  const rollback = {
    expect: Object.fromEntries([chiba, ...entries.map(x => x.entity)].map(entity => [entity.id, {id: entity.id,
      v: entity.v + (moved.some(x => x.entity.id === entity.id) ? 1 : 0)}])),
    ops: moved.map(({seat, entity}) => ({op: 'move', id: entity.id, p: [...seat.before], r: seat.r})),
    note: 'Restore the three Chiba cushion poses; first clear the moving fixtures and verify no intervening authored edits.',
  };
  return {schema: 'mars-chiba-seating-patch/1', worldId: snapshot.worldId, beforeSeq: snapshot.seq, batch, rollback,
    undo: {method: 'POST', path: `/v1/god/undo?group=${encodeURIComponent(group)}`},
    retained: ['all entity IDs', 'all definition bytes', 'all semantic capability IDs', 'tier-3 and presenter poses', 'all colliders, body radii and stair links']};
}

/** Only append to the fully materialized fidelity/rotation template. The older
 * base-campus generator must not apply world-frame moves before its later patches. */
export function integrateTemplate(template) {
  const existing = template.batches.filter(b => b.group === layout.id);
  if (existing.length) {
    assert.equal(existing.length, 1, 'duplicate seating batches');
    assert(same(existing[0], templateBatch()), 'existing seating batch differs');
    assert.equal(template.batches.at(-1).group, layout.id, 'seating repair must be the final batch');
    return false;
  }
  const last = new Map();
  for (const b of template.batches) for (const o of b.ops) {
    if (o.op === 'place' && o.name) last.set(o.name, {p: o.p, r: o.r ?? 0});
    if (o.op === 'move' && last.has(o.id)) last.set(o.id, {p: o.p, r: o.r ?? last.get(o.id).r});
  }
  for (const s of [layout.source, ...layout.seats]) {
    const p = last.get(s.name);
    assert(p && same(p.p, s.before ?? s.p) && p.r === s.r, `${s.name} final source template pose changed`);
  }
  template.batches.push(templateBatch());
  return true;
}
