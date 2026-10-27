import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';
import{enrich}from'./overlay.mjs';import{applyOps}from'./materialize.mjs';import{physicalGenesisSha256}from'../playtest/lib/physical-fixture.mjs';
const overlay=()=>JSON.parse(readFileSync(new URL('../../worlds/meaning/hello-hamlet.json',import.meta.url),'utf8'));
test('meaning is a physical no-op, anchored to actual slots and repeat-idempotent',()=>{
 const o=overlay(),r=enrich('hello-hamlet',o);assert.equal(r.report.warnings.length,0);
 const ops=r.template.batches.filter(b=>b.note?.startsWith('World meaning v1:')).flatMap(b=>b.ops);
 const again=applyOps(r.world,ops);assert.equal(again.diff.upserts.length,0);assert.equal(again.diff.tiles.length,0);
 const corrupted=structuredClone(r.template);corrupted.batches.push({ops:[{op:'move',id:'cottage',p:[40,0]}]});assert.notEqual(physicalGenesisSha256(corrupted),r.report.physicalSha256);
});
test('stale sources, nonexistent slots and unknown schema keys cannot publish',()=>{
 const stale=overlay();stale.source.sha='stale';assert.throws(()=>enrich('hello-hamlet',stale),/source drift/);
 const bad=overlay();bad.about.cottage.parts[0].anchor.slot='invented-room';assert.throws(()=>enrich('hello-hamlet',bad),/about.invalid/);
 const typo=overlay();typo.about.cottage.titel='Invisible title';assert.throws(()=>enrich('hello-hamlet',typo),/unknown|noncanonical/);
});
