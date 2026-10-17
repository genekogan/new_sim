#!/usr/bin/env node
// Reproducible, library-first genesis. Every batch passes the real God compiler.
// Run with DATA_DIR and EDEN_BUILD_OUT in lane scratch; no running world needed.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {Db} from '../../../../apps/server/src/db.ts';
import {GodMode} from '../../../../apps/server/src/god/god.ts';
import {furnishBatch} from '../../lib/furnish.mjs';
import {LANDSCAPE_BATCHES,LANDMARKS,LANDSCAPE_NOTES} from './landscape.mjs';
import {BUILDING_BATCHES,BUILDINGS,COURTYARDS} from './buildings.mjs';
import {COMMONS_DEFS,COMMONS_BATCHES} from './commons.mjs';
import {SCENERY_BATCHES} from './scenery.mjs';
const root=resolve(import.meta.dirname,'../../../..');
const out=resolve(process.env.EDEN_BUILD_OUT??`${root}/.lane/eden-build`);mkdirSync(out,{recursive:true});
const db=new Db(':memory:');
const god=new GodMode(db,{worldId:'eden-2026-build',ownerId:null,tick:()=>0,emit:()=>{},assetDir:`${out}/assets`,seed:'eden-2026'});
const genesis={schema:'genesis/1',name:'Eden 2026',description:'A shared commons between a pond and a colourful village: furnished courtyard homes, libraries, a cafe and campus, market gardens, a park, canals and hills, with paths to lakes and the harbour. A new Eden world; the original Eden remains independent.',constants:{extent:1000,ground:'land'},state:{constitution:'# Eden 2026\nA welcoming shared landscape for rest, study, play, making, conversation and exploration. The commons lies between a pond and a neighbourhood of furnished houses. Paths connect the campus and library annex, cafe, market, gardens, park, canal quarter, hills and harbour.\nOriginal Eden remains preserved independently.',sky:{palette:'clear-day',sun:.8},ground:{palette:'grass'},time:{dayTicks:72000,startTick:0,set:{hour:12,n:1}}},batches:[]};
const stats=[],adjustments=[];
function apply(label,input,droppable=false){if(!input.length)return;const ops=structuredClone(input),turns=new Map(),starts=new Map(ops.map((o,i)=>[i,o.p]));let r;
  for(let attempt=0;attempt<40;attempt++){
    r=god.act({ops,group:'eden-2026'},label);if(r.accepted)break;
    const f=r.failures?.[0],op=ops[f?.op],p=f?.suggest?.p,start=starts.get(f?.op);
    // The compiler's collision-free suggestion may make a small, recorded
    // street setback. Never drop a source landmark or bypass admission.
    if(f?.code==='overlap.solid'&&p&&op?.op==='place'&&start?.length===2&&Math.hypot(p[0]-start[0],p[1]-start[1])<=4){adjustments.push({name:op.name,from:op.p,to:p,reason:f.detail});op.p=p;continue;}
    // Stricter trunk entrance checks (architecture.sealed): turn the building whose door is blocked to face another
    // side (half turn, then quarter turns), recorded. The building and its place stay; only its facing changes.
    if(f?.code==='architecture.sealed'){let b=ops.find(o=>o.op==='place'&&o.name===f.measured?.building);
      // The sealed building was placed earlier: the nearest new placement in this batch is what blocks its door.
      if(!b){const e=god.model.get(f.measured?.building),q=e&&god.model.worldPose(e);if(q)b=ops.filter(o=>o.op==="place"&&o.p?.length===2).map(o=>[Math.hypot(o.p[0]-q.x,o.p[1]-q.z),o]).filter(([d])=>d<15).sort((x,y)=>x[0]-y[0])[0]?.[1];}
      if(b){const t=turns.get(b)??{n:0,r0:b.r??0};turns.set(b,t);if(t.n<3){b.r=+(t.r0+[Math.PI,Math.PI/2,-Math.PI/2][t.n++]).toFixed(3);adjustments.push({name:b.name,turned:{from:t.r0,to:b.r},reason:f.detail});continue;}
        // A numbered filler house (e.g. cliff-house-21) packed too tight on every side is left out, recorded; named landmarks never are.
        if(/-\d+$/.test(b.name)){const gone=new Set([b.name]);adjustments.push({dropped:[b.name],code:f.code,reason:f.detail});console.log('  dropped filler',b.name,f.code);for(let i=ops.length-1;i>=0;i--)if(gone.has(ops[i].name)||gone.has(ops[i].in?.parent))ops.splice(i,1);if(!ops.length)return;continue;}}}
    // Furniture is optional: a piece the compiler refuses is dropped (with anything on it) and recorded, never forced.
    if(droppable&&f&&ops[f.op]&&(f.code==='overlap.solid'||droppable==='any')){const gone=new Set([ops[f.op].name]);let n=-1;while(gone.size!==n){n=gone.size;for(const o of ops)if(o.in&&gone.has(o.in.parent))gone.add(o.name);}adjustments.push({dropped:[...gone],code:f.code,reason:f.detail});if(droppable==='any')console.log('  dropped',[...gone].join(','),f.code,String(f.detail).slice(0,160));for(let i=ops.length-1;i>=0;i--)if(gone.has(ops[i].name))ops.splice(i,1);if(!ops.length)return;continue;}
    writeFileSync(`${out}/REFUSAL.json`,JSON.stringify({label,ops,result:r},null,2));throw Error(`${label}: ${JSON.stringify(r.failures)}`);
  }
  if(!r?.accepted)throw Error(`collision-setback limit: ${label}`);
  genesis.batches.push({note:label,group:'eden-2026',ops});stats.push({label,ops:ops.length,entities:god.model.entities.size});console.log(label,ops.length,god.model.entities.size);
}
apply('world state',[{op:'world',state:genesis.state}]);
for(const b of LANDSCAPE_BATCHES.filter(b=>b.phase==='terrain'))apply(b.name,b.ops);
apply('commons sleeping mat definition',COMMONS_DEFS);
for(const b of BUILDING_BATCHES)apply(b.label,b.ops.map(op=>op.name==='region-harbour-lighthouse'?{...op,p:[op.p[0],.1,op.p[1]]}:op));
for(const b of COMMONS_BATCHES)apply(b.label,b.ops);
const furniture=[];
for(const b of BUILDINGS){if(b.autoFurnished||!b.furnishStyle||b.circulation)continue;const f=furnishBatch(god.model,b.name,b.furnishStyle);const rootNames=new Map([...god.model.entities.values()].filter(e=>e.in?.parent==='world'||!e.in).map(e=>[e.id,e.name]));for(const op of f.ops){if(rootNames.has(op.in?.parent))op.in.parent=rootNames.get(op.in.parent);if(op.price){delete op.price;f.notes.push('Public service is free; this template does not enable an economy.');}}apply(`furnish ${b.name}`,f.ops,true);furniture.push({building:b.name,placed:f.ops.length,dropped:f.dropped,notes:f.notes});}
const courtOps=[];for(const c of COURTYARDS){courtOps.push({op:'place',def:'core/flower-pot@1',name:`${c.name}-court-pot`.slice(0,48),p:[c.coords[0]+.7,c.coords[1]-.7]});if(c.court.w>=4) courtOps.push({op:'place',def:'core/round-table@1',name:`${c.name}-court-table`.slice(0,48),p:c.coords});}
for(let i=0;i<courtOps.length;i+=10)apply(`courtyard planting ${i/10+1}`,courtOps.slice(i,i+10));
for(const b of LANDSCAPE_BATCHES.filter(b=>b.phase==='detail'))apply(b.name,b.ops);
apply('suburb streets',[...[[[172,34],[244,34]],[[172,74],[244,74]],[[172,112],[244,112]],[[206,34],[206,112]]].map((path,i)=>({op:'place',def:'core/footpath@1',name:`land-suburb-street-${i+1}`,shape:{path},params:{width:3,material:'cobble',maxGrade:0,autoBridge:false,edging:false}}))]);
for(const b of SCENERY_BATCHES)apply(b.label,b.ops,'any');
const places=JSON.parse(readFileSync(`${root}/worlds/eden/places.v1.json`)).places;
// Invisible native land-use regions preserve outdoor destinations without
// painting duplicate plazas over the gardens/water. Interior destinations are
// the real building rooms, not stale source floor polygons.
const zoneOps=places.filter(p=>p.id!=='eden'&&!p.id.startsWith('int-')&&!/^commons-mat-/.test(p.id)&&!BUILDINGS.some(b=>b.originalPlaceId===p.id)).map(p=>({op:'place',def:'core/zone@1',name:`place-${p.id.replaceAll('.','-')}`.slice(0,48),shape:{area:p.polygon},params:{use:/farm|garden|vineyard/.test(p.id)?'farm':/market|cafe|shop|hotel/.test(p.id)?'commercial':/commons|campus|library/.test(p.id)?'civic':/lake|pond|river|mountain|shore/.test(p.id)?'wild':'park'}}));
for(let i=0;i<zoneOps.length;i+=12)apply(`named outdoor places ${i/12+1}`,zoneOps.slice(i,i+12));
const coverage=places.map(p=>({id:p.id,name:p.name,polygon:p.polygon,parent:p.parent,buildings:BUILDINGS.filter(b=>b.originalPlaceId===p.id).map(b=>b.name),zone:zoneOps.find(o=>o.name===`place-${p.id.replaceAll('.','-')}`.slice(0,48))?.name??null}));
writeFileSync(`${root}/worlds/templates/eden-2026.json`,JSON.stringify(genesis,null,2)+'\n');
writeFileSync(`${out}/inventory.json`,JSON.stringify({contract:'eden-2026-inventory/1',batches:stats,entities:god.model.entities.size,adjustments,buildings:BUILDINGS.map(b=>({...b,actualPose:god.model.get(b.name)?god.model.worldPose(god.model.get(b.name)):null})),courtyards:COURTYARDS,furniture,places:coverage,landmarks:LANDMARKS,landscapeNotes:LANDSCAPE_NOTES},null,2));
writeFileSync(`${out}/snapshot.json`,JSON.stringify(god.publicSnapshot()));
console.log('WROTE eden-2026.json',god.model.entities.size,'entities',genesis.batches.length,'accepted batches');db.close();
