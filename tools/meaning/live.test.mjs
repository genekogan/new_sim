import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {materialize,applyOps} from './materialize.mjs';
import {planLive,verifyMeaning,parseLiveArgs} from './live.mjs';
const target={expectedWorldId:'meaning-test-world'};
const snapshot=w=>({...w.snapshot(),worldId:target.expectedWorldId});
const overlay=()=>JSON.parse(readFileSync(new URL('../../worlds/meaning/hello-hamlet.json',import.meta.url),'utf8'));
test('live meaning preserves custom work, binds real live IDs, verifies and repeats without writes',()=>{
 const source=materialize('hello-hamlet').world.snapshot(),m=materialize('hello-hamlet',{seed:'lived-world'}).world;
 applyOps(m,[{op:'place',def:'core/bench@1',name:'owners-new-bench',p:[45,45]},{op:'set',id:'pond',about:{title:'Owner’s pond'}}]);
 const before=structuredClone(snapshot(m)),plan=planLive(before,overlay(),source,target);
 assert.equal(plan.report.kept[0].ref,'pond');assert.equal(plan.report.skipped.length,0);
 for(const b of plan.batches)applyOps(m,b.ops);
 assert.deepEqual(verifyMeaning(before,m.snapshot(),plan),[]);
 assert.equal(m.get('pond').about.title,'Owner’s pond');assert.ok(m.get('owners-new-bench'));
 const again=planLive(snapshot(m),overlay(),source,target);assert.equal(again.batches.length,0);
 const cottage=m.get('cottage');assert.equal(cottage.about.parts[0].anchor.ref,cottage.id);
});
test('changed geometry and absent interaction anchors are skipped instead of mislabeled',()=>{
 const source=materialize('hello-hamlet').world.snapshot(),m=materialize('hello-hamlet',{seed:'changed-world'}).world;
 applyOps(m,[{op:'move',id:'cottage',p:[55,0]}]);
 const o=overlay();o.about.pond.parts=[{id:'fake-seat',title:'Seat',anchor:{kind:'entity',ref:'missing-bench'}}];
 const plan=planLive(snapshot(m),o,source,target);
 assert.ok(plan.report.skipped.some(x=>x.ref==='cottage'&&/physical/.test(x.why)));
 assert.ok(plan.report.skipped.some(x=>x.ref==='pond'&&/missing/.test(x.why)));
 assert.ok(plan.batches.every(b=>Buffer.byteLength(JSON.stringify(b))<56000));
});

test('fresh plans over the same preimage have independent request identities',()=>{
 const m=materialize('hello-hamlet').world,source=m.snapshot(),before=snapshot(m);
 const first=planLive(before,overlay(),source,target),second=planLive(before,overlay(),source,target);
 assert.ok((first.group+'-rollback').length<=60,'rollback group must fit server schema');
 assert.notEqual(first.planId,second.planId);assert.notEqual(first.group,second.group);
 assert.notEqual(first.batches[0].clientRef,second.batches[0].clientRef);
 assert.deepEqual(first.batches.map(b=>b.ops),second.batches.map(b=>b.ops),'only transaction identities change');
});
test('explicit target and live source identity reject mismatches before looking up entities',()=>{
 const wrong={worldId:'wrong'};Object.defineProperty(wrong,'entities',{get(){throw Error('entity planning must not run');}});
 assert.throws(()=>planLive(wrong,overlay(),{},target),/wrong live world/);
 assert.throws(()=>planLive({worldId:'meaning-test-world'},overlay(),{}),/explicit expected/);
 const live={schema:'world-meaning/1',source:{snapshotSha:'reviewed'},about:{}};
 assert.throws(()=>planLive({worldId:target.expectedWorldId},live,{worldId:'another-world'},target),/source snapshot belongs/);
 assert.throws(()=>planLive({worldId:target.expectedWorldId},live,{},target),/source snapshot belongs/);
});
test('plan CLI requires an explicit world before any credential or service access',()=>{
 const args=['plan','overlay.json','/does-not-exist','receipt.json'];
 assert.throws(()=>parseLiveArgs(args),/requires --expected-world-id/);
 assert.throws(()=>parseLiveArgs([...args,'--expected-world-id']),/requires one/);
 assert.throws(()=>parseLiveArgs([...args,'--expected-world-id','a','--expected-world-id','b']),/requires one/);
 assert.equal(parseLiveArgs([...args,'source.json','--expected-world-id','my-live-world']).expectedWorldId,'my-live-world');
 assert.equal(parseLiveArgs(['apply','overlay.json','folder','receipt.json']).mode,'apply','existing receipt already binds apply/rollback target');
});
