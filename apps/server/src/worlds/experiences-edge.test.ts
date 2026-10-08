import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {validatedLmExperiences,lmExperienceEdgeProfile} from './experiences-edge.ts';import type {WorldHost} from '../world.ts';
const fixture=JSON.parse(readFileSync(new URL('./testdata/lm-experiences.v1.json',import.meta.url),'utf8'));
test('published LM experiences retain only self walk/rest visits and body admission truth',()=>{
 const rows=validatedLmExperiences(fixture.experiences,fixture.regions);assert.equal(rows.length,4);
 let seen=0;const host={engine:{world:{regions:fixture.regions},canPerform:(p:any)=>{seen++;assert.equal(p.actor,'self');assert.ok(p.steps.every((s:any)=>!s.params.actor&&!s.params.actors));return {code:'body.unsupported',message:'fixture body cannot take this route'};}}} as unknown as WorldHost;
 const caps:any[]=[],plans=new Map();lmExperienceEdgeProfile(host,fixture.experiences)({soulId:'own',entityId:'self',name:'Self',owner:'fixture'},caps,plans);
 assert.equal(seen,4);assert.equal(caps.length,4);assert.ok(caps.every(c=>c.verb==='walk'&&c.id.startsWith('walk:experience-')&&!c.available&&c.blocked.code==='body.unsupported'));assert.equal(plans.size,4);
});
test('experience data refuses unknown regions, peer authority, limb programs and oversized duration',()=>{
 for(const change of [(e:any)=>{e.place='unknown'},(e:any)=>{e.steps[0].params.actor='other'},(e:any)=>{e.steps[0].verb='mars:classroom_session'},(e:any)=>{e.steps[1].params.seconds=601},(e:any)=>{e.at=[1e9,1e9]},(e:any)=>{e.steps[1].params.other='peer'}]){
  const data=structuredClone(fixture.experiences);change(data.experiences[0]);assert.throws(()=>validatedLmExperiences(data,fixture.regions),/world-experiences.invalid/);
 }
});
