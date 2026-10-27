import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {materialize,applyOps} from './materialize.mjs';
import {planLive,verifyMeaning} from './live.mjs';
const overlay=()=>JSON.parse(readFileSync(new URL('../../worlds/meaning/hello-hamlet.json',import.meta.url),'utf8'));
test('live meaning preserves custom work, binds real live IDs, verifies and repeats without writes',()=>{
 const source=materialize('hello-hamlet').world.snapshot(),m=materialize('hello-hamlet',{seed:'lived-world'}).world;
 applyOps(m,[{op:'place',def:'core/bench@1',name:'owners-new-bench',p:[45,45]},{op:'set',id:'pond',about:{title:'Owner’s pond'}}]);
 const before=structuredClone(m.snapshot()),plan=planLive(before,overlay(),source);
 assert.equal(plan.report.kept[0].ref,'pond');assert.equal(plan.report.skipped.length,0);
 for(const b of plan.batches)applyOps(m,b.ops);
 assert.deepEqual(verifyMeaning(before,m.snapshot(),plan),[]);
 assert.equal(m.get('pond').about.title,'Owner’s pond');assert.ok(m.get('owners-new-bench'));
 const again=planLive(m.snapshot(),overlay(),source);assert.equal(again.batches.length,0);
 const cottage=m.get('cottage');assert.equal(cottage.about.parts[0].anchor.ref,cottage.id);
});
test('changed geometry and absent interaction anchors are skipped instead of mislabeled',()=>{
 const source=materialize('hello-hamlet').world.snapshot(),m=materialize('hello-hamlet',{seed:'changed-world'}).world;
 applyOps(m,[{op:'move',id:'cottage',p:[55,0]}]);
 const o=overlay();o.about.pond.parts=[{id:'fake-seat',title:'Seat',anchor:{kind:'entity',ref:'missing-bench'}}];
 const plan=planLive(m.snapshot(),o,source);
 assert.ok(plan.report.skipped.some(x=>x.ref==='cottage'&&/physical/.test(x.why)));
 assert.ok(plan.report.skipped.some(x=>x.ref==='pond'&&/missing/.test(x.why)));
 assert.ok(plan.batches.every(b=>Buffer.byteLength(JSON.stringify(b))<56000));
});
