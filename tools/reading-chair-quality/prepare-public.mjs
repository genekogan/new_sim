// ROOT PROPOSAL ONLY. Offline saved-evidence planner; no fetch, credentials, DB, engine or native runtime.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
const [inputPath, outputPath] = process.argv.slice(2); assert.ok(inputPath && outputPath);
const input = JSON.parse(readFileSync(inputPath, 'utf8')), read = path => { assert.ok(isAbsolute(path)); return JSON.parse(readFileSync(path, 'utf8')); };
const snapshot = read(input.snapshotPath), queries = read(input.queriesPath), builds = read(input.buildsPath), before = read(input.healthBeforePath), after = read(input.healthAfterPath), endSeq = read(input.seqAfterPath);
assert.equal(before.ok, true); assert.equal(after.ok, true); assert.equal(before.worldId, after.worldId); assert.equal(snapshot.worldId, after.worldId); assert.equal(before.build, after.build, 'same served release during audit');
assert.ok(Number.isFinite(before.tick) && Number.isFinite(after.tick) && after.tick >= before.tick); assert.ok(snapshot.tick >= before.tick && snapshot.tick <= after.tick, 'actual native ticks may advance during audit');
assert.equal(endSeq.seq, snapshot.seq, 'authored edit during audit requires fresh snapshot/queries');
assert.ok(Array.isArray(builds.open) && builds.open.length === 0, 'exact authenticated open-build inventory');
const pairs = [
  ['library-desk-east', 'library-desk-chair-east', 'e_f2f03378', 'e_ee75e661'],
  ['office-f0-desk-2', 'office-f0-desk-chair-2', 'e_c89a22ab', 'e_7f6da347'],
  ['office-f1-desk-2', 'office-f1-desk-chair-2', 'e_be1c5ef3', 'e_8d176c74'],
  ['office-f2-desk-2', 'office-f2-desk-chair-2', 'e_bab28317', 'e_62302f09'],
];
const oldHash = 'd1639b7357bef81463874090868c25984d9d66ca13cbeece43c1711591214bdd', nextHash = '6583bddfe6454990c9611d4c9d3c267eee8cde061a1378c00ceccddbea4e9f0a';
const definitions = [...snapshot.defs, ...snapshot.library], names = new Map(snapshot.entities.map(entity => [entity.name, entity]));
const byId = new Map(snapshot.entities.map(entity => [entity.id, entity]));
const defOf = ref => ref.startsWith('sha:') ? definitions.find(def => def.hash === ref.slice(4)) : [...definitions].reverse().find(def => def.ref === ref || def.ref === ref.replace(/^core\//, 'core-'));
assert.ok(snapshot.library.some(def => def.ref === 'core-office-desk@2' && def.hash === nextHash), 'qualified deployment exposes exact v2');
const fields = new Set(['id','by','born','v','name','def','in','p','r','s','shape','anchor','params','state','seed','constraints','about','owner','access','schedule','price']);
const records = pairs.map(([name, seatName, id, seatId]) => {
  const desk = names.get(name), seat = names.get(seatName); assert.equal(desk?.id, id); assert.equal(seat?.id, seatId);
  assert.equal(desk.in.parent, seat.in.parent); assert.equal(desk.in.slot, seat.in.slot);
  assert.equal(defOf(desk.def)?.hash, oldHash); assert.equal(defOf(seat.def)?.name, 'core-office-chair');
  assert.ok(Object.keys(desk).every(key => fields.has(key)), 'unknown entity metadata refuses'); assert.ok(!desk.constraints?.length);
  assert.equal(snapshot.entities.some(entity => entity.in.parent === id), false, 'no desk children/contents/attachments');
  const dq = queries[id]?.entity, sq = queries[seatId]?.entity; assert.equal(dq?.id, id); assert.equal(sq?.id, seatId);
  assert.ok(Object.hasOwn(dq, 'usedBy')); assert.equal(dq.usedBy, null, 'only the REMOVED desk must be unused');
  assert.ok(Object.hasOwn(sq, 'usedBy'), 'retained chair occupancy is OBSERVED, not required empty');
  assert.deepEqual(dq.children, []); assert.deepEqual(dq.constraints, []);
  return {desk, seat, deskQuery:dq, seatQuery:sq};
});
const removed = records.map(row => row.desk.id);
const refs = (value, id) => typeof value === 'string' ? value.includes(id) : Array.isArray(value) ? value.some(item => refs(item,id)) : value && typeof value === 'object' ? Object.entries(value).some(([key,item]) => key.includes(id) || refs(item,id)) : false;
for (const entity of snapshot.entities) for (const id of removed) {
  const content = structuredClone(entity); if (entity.id === id) delete content.id;
  assert.equal(refs(content,id), false, `persisted inbound or self-reference ${id}: ${entity.id}`);
}
for (const id of removed) assert.equal(refs(snapshot.state,id),false,`world-state forward reference ${id}`);
assert.ok(Array.isArray(input.externalSemanticPaths) && input.externalSemanticPaths.length > 0, 'explicit known active meaning/semantic files required');
const external = input.externalSemanticPaths.map(path => ({path,content:read(path)}));
for (const file of external) for (const id of removed) assert.equal(refs(file.content,id),false,`active semantic reference in ${file.path}`);
const ops = records.map(({desk})=>({op:'remove',id:desk.id,cascade:false}));
records.forEach(({desk},index)=>{const {id,by,born,v,def,...metadata}=structuredClone(desk);ops.push({op:'place',...metadata,def:'core/office-desk@2',tmp:`$desk${index}`,mode:'strict'});});
const guards = new Set(records.flatMap(row=>[row.desk.id,row.seat.id]));
for(const row of records)for(let e=row.desk;e.in.parent!=='world';){e=byId.get(e.in.parent);assert.ok(e);guards.add(e.id);}
const expect=Object.fromEntries([...guards].map(id=>[id,{id,v:byId.get(id).v}]));
const batch={ops,group:'reading-chair-20261028',note:'Replace four childless computer desks with chair-free immutable v2; retain authored office chairs and active chair-bound computer actions.'};
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const report={schema:'eden-public-desk-plan/1',observation:'fresh authenticated authored snapshot + concurrent ordinary query window, not an in-process model fingerprint or all-ledger audit',snapshotSeq:snapshot.seq,tick:snapshot.tick,nativeWindow:{before:before.tick,snapshot:snapshot.tick,after:after.tick,pausedBefore:before.paused,pausedAfter:after.paused,build:after.build,worldId:after.worldId},oldHash,nextHash,batch,expect,mapping:records.map((row,index)=>({oldId:row.desk.id,newTmp:`$desk${index}`,retainedChairId:row.seat.id,observedChairUse:row.seatQuery.usedBy})),evidence:input,evidenceSha256:{snapshot:sha(snapshot),queries:sha(queries),builds:sha(builds),healthBefore:sha(before),healthAfter:sha(after),seqAfter:sha(endSeq),externalSemanticFiles:external.map(file=>({path:file.path,sha256:sha(file.content)}))},unproven:['No exhaustive remote snapshot of all accepted or client-side future plans exists. No empty all-ledger assertion is made.','Native ticks are allowed to advance. No host pause or human Soul control is required. Re-read health/build, seq, old desk versions/state and unused desk queries immediately before commit; authored changes require a fresh plan.','Already accepted power gestures can carry an old desk wave target; effects already committed and preserved on-state, but facing may be skipped. Future cached explicit old desk object actions refuse and require fresh resolution.'],rootChecks:['Qualified source deployed first; exactv2library pin.','POST preview batch; require accepted and wouldMove absent/empty; GET preview/id and verify diff removes EXACT4old desk IDs, upserts EXACT4new desk IDs only; no chair/body moves, no repairs or unexpected state edits.','Commit sealed preview via /v1/god/act with this expect map plus unique stable clientRef; retain result.ids and undo group. Do not use CLI commit alone because it omits extra retained-chair expect guards.','Compare retained chair identities/geometry and new desk metadata; native activity/occupancy may naturally progress, so do not claim identical observation time. Never change the prior world pause state.','Normal native computer capability remains chair-bound. Live acceptance and ordinary stale-ID refusal remain separate checks.']};
mkdirSync(resolve(outputPath));writeFileSync(resolve(outputPath,'plan.json'),JSON.stringify(report,null,2));writeFileSync(resolve(outputPath,'preview-batch.json'),JSON.stringify(batch,null,2));writeFileSync(resolve(outputPath,'expect.json'),JSON.stringify(expect,null,2));console.log('Prepared offline plan; no network or world mutation.');
