// Pure, snapshot-pinned plan. Root owns fresh authored-entity audit, ordinary commit, receipt and semantic-file remapping.
// Public place allocates NEW desk IDs. The real chairs never leave the world. No network or mutation here.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { coreLibrary } from '../../packages/world-compiler/src/library.ts';
export const EDEN_DESK_PAIRS = Object.freeze([
  ['library-desk-east', 'library-desk-chair-east'],
  ...[0, 1, 2].map(level => [`office-f${level}-desk-2`, `office-f${level}-desk-chair-2`]),
]);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])])) : value;
export const repairHash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const entityRef = (text, id) => typeof text === 'string' && (text === id || ['#', '/', ':'].some(delimiter => text.startsWith(id + delimiter)) || text === 'entity:' + id);
function references(value, id) { if (entityRef(value, id)) return true; if (Array.isArray(value)) return value.some(v => references(v, id)); if (value && typeof value === 'object') return Object.entries(value).some(([k, v]) => entityRef(k, id) || references(v, id)); return false; }
const placeFields = new Set(['id', 'by', 'born', 'v', 'name', 'def', 'in', 'p', 'r', 's', 'shape', 'anchor', 'params', 'state', 'seed', 'constraints', 'about', 'owner', 'access', 'schedule', 'price']);

/** expected={snapshotSha256, pairs:[{deskId,seatId}], audit:{seq, uses:[{id,inUse:null|observedUse}], externalReferences:[]}}.
 * Audit is a fresh usedBy read for removed desks plus observed retained-chair use and known active persisted references.
 * It does not assert that unrelated ledger histories, other Souls or their future client queues are empty.
 * Only about.in and about.parts[].anchor.ref exact entity references can be remapped in the same ordinary batch.
 * Other bindings, children, constraints, inventories, removed-desk occupancy or unknown metadata REFUSE rather than lose data.
 */
export function planEdenDeskRepair(model, expected) {
  const snapshot = model.snapshot();
  assert.equal(repairHash(snapshot), expected.snapshotSha256, 'exact reviewed snapshot');
  assert.equal(expected.audit.seq, snapshot.editSeq, 'fresh authored-entity audit');
  assert.deepEqual(expected.audit.externalReferences, [], 'known active persisted semantic/build references must be absent or concretely handled before planning');
  assert.equal(expected.pairs.length, EDEN_DESK_PAIRS.length);
  const library = coreLibrary(), old = library.get('core/office-desk@1'), next = library.get('core/office-desk@2');
  assert.ok(old && next && old.hash !== next.hash);
  const uses = new Map(expected.audit.uses.map(row => { assert.ok(Object.hasOwn(row, 'inUse'), 'actual observed usedBy is required, not an invented missing/null value'); return [row.id, row.inUse]; }));
  const names = new Map([...model.entities.values()].map(entity => [entity.name, entity]));
  const rows = EDEN_DESK_PAIRS.map(([deskName, seatName], index) => {
    const desk = names.get(deskName), seat = names.get(seatName), pair = expected.pairs[index];
    assert.ok(desk && seat, `${deskName}: expected exact authored pair`);
    assert.equal(seat.id, pair.seatId, 'functional seat ID must remain exact');
    assert.ok(uses.has(desk.id) && uses.get(desk.id) === null, 'removed desk independently observed unused');
    assert.ok(uses.has(seat.id) && (uses.get(seat.id) === null || typeof uses.get(seat.id) === 'object' && uses.get(seat.id) !== null), 'retained chair occupancy observed; an occupied unchanged chair is allowed');
    assert.equal(model.resolvedDef(seat.def)?.name, 'core-office-chair');
    assert.equal(desk.in.parent, seat.in.parent, 'authored pair shares building');
    assert.equal(desk.in.slot, seat.in.slot, 'authored pair shares exact room/floor slot');
    const def = model.resolvedDef(desk.def); assert.ok(def && [old.hash, next.hash].includes(def.hash), 'exact old or new immutable definition');
    if (def.hash === old.hash) assert.equal(desk.id, pair.deskId, 'reviewed old desk identity');
    assert.ok(Object.keys(desk).every(key => placeFields.has(key)), 'no unsupported metadata');
    assert.equal(model.subtree(desk.id).length, 1, 'desk has no children/inventory/attachments');
    assert.ok(!desk.constraints?.length, 'desk has no persistent constraints');
    return { desk, seat, pair, beforeHash: def.hash };
  });
  if (rows.every(row => row.beforeHash === next.hash)) return { schema: 'eden-desk-repair/1', applied: true, ops: [], mapping: rows.map(row => ({ oldId: row.pair.deskId, newId: row.desk.id, seatId: row.seat.id, observedChairUse: uses.get(row.seat.id) })), hashes: { old: old.hash, next: next.hash } };
  assert.ok(rows.every(row => row.beforeHash === old.hash), 'mixed desk revisions require independent review');
  const oldIds = new Set(rows.map(row => row.desk.id)), tmp = new Map(rows.map((row, index) => [row.desk.id, `$desk${index}`]));
  const rewriteAbout = about => {
    if (!about) return about;
    const copy = structuredClone(about);
    if (tmp.has(copy.in)) copy.in = tmp.get(copy.in);
    for (const part of copy.parts ?? []) if (part.anchor?.kind === 'entity' && tmp.has(part.anchor.ref)) part.anchor.ref = tmp.get(part.anchor.ref);
    // Anything beyond the understood semantic fields refuses, including embedded strings or slot suffixes.
    for (const id of oldIds) assert.equal(references(copy, id), false, 'unhandled semantic reference');
    return copy;
  };
  const semantic = [];
  for (const entity of model.entities.values()) {
    const { about, ...rest } = entity;
    for (const id of oldIds) {
      const inspected = entity.id === id ? Object.fromEntries(Object.entries(rest).filter(([key]) => key !== 'id')) : rest;
      assert.equal(references(inspected, id), false, 'inbound entity/constraint/ownership/inventory reference');
    }
    const rewritten = rewriteAbout(about);
    if (repairHash(rewritten ?? null) !== repairHash(about ?? null) && !oldIds.has(entity.id)) semantic.push({ op: 'set', id: entity.id, about: rewritten });
  }
  for (const id of oldIds) assert.equal(references(snapshot.state, id), false, 'persistent world/layer relationship references');
  const ops = rows.map(({ desk }) => ({ op: 'remove', id: desk.id, cascade: false }));
  rows.forEach(({ desk }, index) => {
    const { id, by, born, v, def, about, ...fields } = structuredClone(desk);
    ops.push({ op: 'place', ...fields, def: 'core/office-desk@2', tmp: `$desk${index}`, mode: 'strict' });
  });
  rows.forEach(({ desk }, index) => { if (desk.about) ops.push({ op: 'set', id: `$desk${index}`, about: rewriteAbout(desk.about) }); });
  ops.push(...semantic);
  const guardIds = new Set([...rows.flatMap(row => [row.desk.id, row.seat.id]), ...semantic.map(op => op.id)]);
  const expect = Object.fromEntries([...guardIds].map(id => [id, { id, v: model.entities.get(id).v }]));
  return { schema: 'eden-desk-repair/1', applied: false, expect, beforeSnapshotSha256: expected.snapshotSha256, hashes: { old: old.hash, next: next.hash }, ops,
    mapping: rows.map((row, index) => ({ oldId: row.desk.id, newTmp: `$desk${index}`, seatId: row.seat.id, observedChairUse: uses.get(row.seat.id) })),
    identityChanges: ['desk.id', 'desk.by', 'desk.born', 'desk.v'],
    retained: ['all chair identities and geometry; explicit inbound semantic refs update normally with monotonic v', 'desk name/in/pose/params/state/seed/constraints/semantic about/owner/access/schedule/price', 'old immutable definition'],
    rootRequirements: ['sealed preview with no wouldMove/extra diff, public expect map and fresh removed-desk usedBy audit; no global-seq/all-ledger claim', 'record result.ids old→new mapping; rewrite external semantic files before acceptance', 'retain compiler inverse/old-to-new desk mapping; explicit old desk offers refuse and need fresh resolution; current computer remains chair-bound'] };
}
