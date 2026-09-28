// Stable historical component ids + legacy layout migration (docs/engineering/HISTORY_IDS.md).
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import * as T from 'three';
import {validateLayout,legacyId} from '../lib/layout.ts';
const file=new URL(`../.history-ids-test-${process.pid}.mjs`,import.meta.url);
await build({stdin:{contents:`export * from './app/history/scenes';export {add2026Details} from './app/history/details-2026';`,resolveDir:new URL('..',import.meta.url).pathname,loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile:file.pathname,logLevel:'error'});
T.TextureLoader.prototype.load=function(){return new T.Texture();};
// oxlint-disable-next-line typescript/no-deprecated -- offline scene construction; no renderer
globalThis.document={createElement:()=>({width:1,height:1,getContext:()=>new Proxy({}, {get:(_t,key)=>key==='createRadialGradient'?()=>({addColorStop(){}}):()=>{}})})};
const {createHistoricalScene,add2026Details}=await import(file.href);
after(()=>fs.unlink(file));
const table=JSON.parse(await fs.readFile(new URL('../app/history/id-migration.json',import.meta.url),'utf8'));
const idsOf=root=>{const ids=[];root.traverse(o=>{if(o.userData.component_id)ids.push(o.userData.component_id);});return ids;};
const details2026=()=>{const root=new T.Group(),chiba=new T.Group();chiba.name='Chiba';root.add(chiba);add2026Details(root);return root;};
const build2=year=>year===2026?details2026():createHistoricalScene(year);
const YEARS=[2020,2021,2022,2023,2024,2025,2026];
const memo=new Map(),current=year=>{if(!memo.has(year))memo.set(year,idsOf(build2(year)));return memo.get(year);};

test('history ids: every year rebuilds with identical, unique, semantic ids',()=>{
 for(const year of YEARS){
  const a=current(year),b=idsOf(build2(year));
  assert.deepEqual(b,a,`${year} ids differ between builds`);
  assert.equal(new Set(a).size,a.length,`${year} has duplicate ids`);
  for(const id of a)assert.match(id,/^(person-\d+|[a-z0-9-]+-[a-z0-9-]+-[0-9a-f]{8}(-\d+)?|[a-z0-9-]+-(mars-letters|aluminet|flower-mural|entry-sign|solarium-door))$/,`${year}: ${id}`);
 }
});
test('history ids: inserting a component early in 2021 leaves every original id intact',()=>{
 let dummy;
 const hooks={assembly(k,g){if(g.userData.assembly_id==='chiba'&&!dummy)dummy=k.box(g,'rack upright',[.075,4.8768,.075],[1.234,2.4384,-3.21]);}};
 const root=createHistoricalScene(2021,hooks),before=current(2021),after2=idsOf(root);
 assert.ok(dummy,'hook did not run');
 // The dummy really is early: the first main-hall component (the legacy serial scheme
 // would have renumbered all ~700 chiba ids after it).
 let first;root.traverse(o=>{if(!first&&o.userData.assembly_id==='chiba'&&o.userData.component_id)first=o;});
 assert.equal(first,dummy);
 assert.equal(after2.length,before.length+1);
 const set=new Set(after2);for(const id of before)assert.ok(set.has(id),`id lost after insertion: ${id}`);
 assert.ok(!before.includes(dummy.userData.component_id));
});
test('history ids: explicit names pin plan-addressable pieces',()=>{
 assert.ok(current(2021).includes('chiba-mars-letters'));assert.ok(current(2021).includes('chiba-aluminet'));
 assert.ok(current(2024).includes('chiba-flower-mural'));assert.ok(current(2024).includes('chiba-entry-sign'));assert.ok(current(2024).includes('chiba-solarium-door'));
});
test('history ids: frozen migration table maps every legacy id to a live component',()=>{
 assert.equal(table.schema,'mars-history-id-migration/1');let entries=0,removed=0;
 for(const year of YEARS){const live=new Set(current(year));
  for(const [asm,run] of Object.entries(table.years[year]??{}))run.ids.forEach((s,i)=>{if(s===null){removed++;return;}entries++;
   assert.ok(live.has(`${asm}-${s}`),`${year} ${asm}-${run.start+i} → ${asm}-${s} no longer exists; add an alias instead of regenerating`);});
 }
 // 7,942 live legacy entries until 2026-09-29; the Chiba 2024 reconstruction edit removed the right-flap salvaged
 // windows (84 entries: backing, glazing, frames → null = removed; HISTORY_IDS.md). 9 older nulls predate it.
 // W46 (props seated on their surfaces, 2026-09-29) re-pointed 243 entries at successors, removing none: 2020 70
 // (toilets 12, RV wheels 48, workshop legs + bins 10), 2021 58, 2023 41, 2024 41, 2025 33; 2022 and 2026 held.
 assert.equal(entries,7942-84);assert.equal(removed,9+84);
 assert.equal(legacyId(table,2021,'person-3'),undefined);
});
test('layouts: legacy ids migrate, unmappable legacy ids warn and drop, stable ids pass',()=>{
 const baseline=new Set([...current(2021),'chiba','rv-1']),stock=new Set(['modular-bench']);
 const t=(x=0)=>({position:[x,0,0],quaternion:[0,0,0,1],scale:[1,1,1]});
 const first=legacyId(table,2021,'chiba-1'),rv=legacyId(table,2021,'rv-2-5');
 assert.ok(baseline.has(first)&&baseline.has(rv));
 const warnings=[];
 const layout=validateLayout({schema_version:1,base_model:'mars-campus-modular-v1',year:2021,edits:[
  {id:'chiba-1',...t(1)},{id:'rv-2-5',...t(2)},{id:'rv-1',...t(3)},{id:'chiba-99999',...t(4)},
  {id:'added-a',added:'copy:chiba-7',...t(5)},{id:'added-b',added:'modular-bench',...t(6)},{id:current(2021)[40],...t(7)}]},
  baseline,stock,2021,table,m=>warnings.push(m));
 assert.deepEqual(layout.edits.map(e=>e.id),[first,rv,'rv-1','added-a','added-b',current(2021)[40]]);
 assert.equal(layout.edits[3].added,`copy:${legacyId(table,2021,'chiba-7')}`);
 assert.equal(warnings.length,1);assert.match(warnings[0],/chiba-99999/);
 // Without the table, legacy ids are unknown; non-legacy unknown ids are still rejected with it.
 assert.throws(()=>validateLayout({schema_version:1,base_model:'mars-campus-modular-v1',year:2021,edits:[{id:'chiba-1',...t()}]},baseline,stock,2021),/Unknown baseline/);
 assert.throws(()=>validateLayout({schema_version:1,base_model:'mars-campus-modular-v1',year:2021,edits:[{id:'nowhere',...t()}]},baseline,stock,2021,table),/Unknown baseline/);
 // Legacy ids are per year: a 2021 serial does not leak into 2022.
 assert.notEqual(legacyId(table,2022,'chiba-1'),first);
});
