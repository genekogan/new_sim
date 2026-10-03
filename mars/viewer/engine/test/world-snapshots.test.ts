import test from 'node:test';import assert from 'node:assert/strict';
import {WORLD_SNAPSHOTS} from '../../app/lab/world-snapshots.ts';
for(const s of WORLD_SNAPSHOTS)test(`world snapshot: ${s.name} is browser-local, clock-free and has no Soul ownership`,()=>{
 const rt=s.build!();assert.ok(Object.values(rt.world.entities).some(e=>e.kind==='human'));assert.ok(Object.values(rt.world.entities).every(e=>!(e.human as unknown as {soul?:string}|undefined)?.soul));const time=rt.world.env.datetime;
 s.start(rt);for(let i=0;i<20;i++)rt.step();assert.equal(rt.world.env.datetime,time);assert.deepEqual(rt.violations,[]);assert.ok(s.expect(rt).every(c=>c.ok));
});
