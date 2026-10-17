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
import {treeBatches} from './trees.mjs';
import {lightOps,propOps} from './street-life.mjs';
import {INTERIOR_DEFS,LIBRARY,LIBRARY_TOPS,CAFE,CAFE_TOPS,OFFICE,OFFICE_TOPS,HOUSES,BARN,BARN_TOPS,SMALL_HOUSES,HOTELS} from './interiors.mjs';
const root=resolve(import.meta.dirname,'../../../..');
const out=resolve(process.env.EDEN_BUILD_OUT??`${root}/.lane/eden-build`);mkdirSync(out,{recursive:true});
const db=new Db(':memory:');
const god=new GodMode(db,{worldId:'eden-2026-build',ownerId:null,tick:()=>0,emit:()=>{},assetDir:`${out}/assets`,seed:'eden-2026'});
const genesis={schema:'genesis/1',name:'Eden 2026',description:'A shared commons between a pond and a colourful village: furnished courtyard homes, libraries, a cafe and campus, market gardens, a park, canals and hills, with paths to lakes and the harbour. A new Eden world; the original Eden remains independent.',constants:{extent:1000,ground:'land'},state:{constitution:'# Eden 2026\nA welcoming shared landscape for rest, study, play, making, conversation and exploration. The commons lies between a pond and a neighbourhood of furnished houses. Paths connect the campus and library annex, cafe, market, gardens, park, canal quarter, hills and harbour.\nOriginal Eden remains preserved independently.',sky:{palette:'eden-summer',sun:.8},ground:{palette:'meadow'},time:{dayTicks:72000,startTick:0,set:{hour:12,n:1},calendar:'06-05'}},batches:[]};
// A root thing placed from old Eden's yard coordinates can land inside an eden-2026 building (a bin in a living room, a
// tree in a kitchen). Outdoor batches leave those out (recorded); open structures (pavilion, bandstand, gazebo, greenhouse,
// market) keep what stands under them.
const OPEN=/pavilion|bandstand|gazebo|greenhouse|market/;
const indoors=([x,z])=>BUILDINGS.some(b=>{if(OPEN.test(b.def)||OPEN.test(b.name))return false;const c=Math.cos(b.r??0),sn=Math.sin(b.r??0),dx=x-b.coords[0],dz=z-b.coords[1],lx=dx*c-dz*sn,lz=dx*sn+dz*c;return Math.abs(lx)<b.w/2+.3&&Math.abs(lz)<b.d/2+.3;});
const OUTDOOR_BATCH=/^(scenery|trees|night lights|street life|commons|courtyard planting|public-life)/;
const stats=[],adjustments=[];
function apply(label,input,droppable=false){if(OUTDOOR_BATCH.test(label)){const kept=input.filter(o=>!(o.op==='place'&&!o.shape&&(!o.in||o.in.parent==='world')&&o.p?.length===2&&!/hill|mountain/.test(o.def)&&indoors(o.p)));if(kept.length<input.length)adjustments.push({indoorsLeftOut:input.filter(o=>!kept.includes(o)).map(o=>o.name),batch:label});input=kept;}
  if(!input.length)return;const ops=structuredClone(input),turns=new Map(),starts=new Map(ops.map((o,i)=>[i,o.p]));let r;
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
apply('interior defs',INTERIOR_DEFS);
for(const b of BUILDING_BATCHES)apply(b.label,b.ops.map(op=>op.name==='region-harbour-lighthouse'?{...op,p:[op.p[0],.1,op.p[1]]}:op));
for(const b of COMMONS_BATCHES)apply(b.label,b.ops);
const furniture=[];
for(const b of BUILDINGS){if(b.autoFurnished||!b.furnishStyle||b.circulation)continue;const f=furnishBatch(god.model,b.name,b.furnishStyle);const rootNames=new Map([...god.model.entities.values()].filter(e=>e.in?.parent==='world'||!e.in).map(e=>[e.id,e.name]));for(const op of f.ops){if(rootNames.has(op.in?.parent))op.in.parent=rootNames.get(op.in.parent);if(op.price){delete op.price;f.notes.push('Public service is free; this template does not enable an economy.');}}apply(`furnish ${b.name}`,f.ops,true);furniture.push({building:b.name,placed:f.ops.length,dropped:f.dropped,notes:f.notes});}
for(const [label,list] of [['interiors: library',LIBRARY],['interiors: library tops',LIBRARY_TOPS],['interiors: cafe',CAFE],['interiors: cafe tops',CAFE_TOPS],['interiors: office',OFFICE],['interiors: office tops',OFFICE_TOPS],['interiors: courtyard houses',HOUSES],['interiors: barn',BARN],['interiors: small houses',SMALL_HOUSES],['interiors: barn tops',BARN_TOPS],['interiors: hotels',HOTELS]])for(let i=0;i<list.length;i+=14)apply(`${label} ${i/14+1}`,list.slice(i,i+14),'any');
// V3: old Eden's town roofs were gardens too: planters (and on bigger roofs a bench or a parasol table) on the flat roofs
// of the canal, old-town, seaside and cliff houses; deterministic by name, optional (droppable)
{const roofOps=[];let k=0;for(const b of BUILDING_BATCHES)for(const op of b.ops){const pr=op.params??{};if(op.op!=='place'||pr.roof!=='flat'||!/^(canal-|market-street-|old-town-|seafront-hotel-|cliff-house-)/.test(op.name??''))continue;
  const w=Number(pr.w??6),d=Number(pr.d??6),h=[...op.name].reduce((a,c)=>(a*31+c.charCodeAt(0))>>>0,7);if(h%3===2)continue;
  roofOps.push({op:'place',def:'core/planter-box@1',name:`${op.name}-roof-planter`.slice(0,48),in:{parent:op.name,slot:'roof'},p:[+(-w/2+1.1).toFixed(2),0,+(d/2-0.8).toFixed(2)]});
  if(w>=5&&d>=6)roofOps.push({op:'place',def:h%2?'core/bench@1':'core/flower-pot@1',name:`${op.name}-roof-${h%2?'bench':'pot'}`.slice(0,48),in:{parent:op.name,slot:'roof'},p:[+(w/2-1.2).toFixed(2),0,+(-d/2+0.9).toFixed(2)]});
  if(w>=10&&d>=8)roofOps.push({op:'place',def:'core/parasol-table@1',name:`${op.name}-roof-parasol`.slice(0,48),in:{parent:op.name,slot:'roof'},p:[0,0,0]});k++;}
 for(let i=0;i<roofOps.length;i+=14)apply(`town roof gardens ${i/14+1}`,roofOps.slice(i,i+14),'any');}
const courtOps=[];for(const c of COURTYARDS){courtOps.push({op:'place',def:'core/flower-pot@1',name:`${c.name}-court-pot`.slice(0,48),p:[c.coords[0]+.7,c.coords[1]-.7]});if(c.court.w>=4) courtOps.push({op:'place',def:'core/round-table@1',name:`${c.name}-court-table`.slice(0,48),p:c.coords});}
for(let i=0;i<courtOps.length;i+=10)apply(`courtyard planting ${i/10+1}`,courtOps.slice(i,i+10));
for(const b of LANDSCAPE_BATCHES.filter(b=>b.phase==='detail'))apply(b.name,b.ops);
apply('suburb streets',[...[[[172,34],[244,34]],[[172,74],[244,74]],[[172,112],[244,112]],[[206,34],[206,112]]].map((path,i)=>({op:'place',def:'core/footpath@1',name:`land-suburb-street-${i+1}`,shape:{path},params:{width:3,material:'cobble',maxGrade:0,autoBridge:false,edging:false}}))]);
for(const b of SCENERY_BATCHES)apply(b.label,b.ops,'any');
{const box=a=>{const xs=a.map(q=>q[0]),zs=a.map(q=>q[1]);return[Math.min(...xs),Math.min(...zs),Math.max(...xs),Math.max(...zs)];};
 const existing=LANDSCAPE_BATCHES.flatMap(b=>b.ops).filter(o=>o.def==='core/woodland@1'&&o.shape?.area).map(o=>box(o.shape.area));
 const t=treeBatches(existing);for(let i=0;i<t.length;i+=12)apply(`trees ${i/12+1}`,t.slice(i,i+12),'any');}
{// old street props stood in old Eden's yards; some of those spots are inside eden-2026's buildings (a bin in a living room):
// a prop inside any building's walls (0.3 m margin) is left out
const l=lightOps();for(let i=0;i<l.length;i+=14)apply(`night lights ${i/14+1}`,l.slice(i,i+14),'any');
const p=propOps();for(let i=0;i<p.length;i+=14)apply(`street life ${i/14+1}`,p.slice(i,i+14),'any');}
// lane E-life's patch (activity things old Eden residents used: gym, courts, music, post boxes, easels); folded in, droppable
{const life=JSON.parse(readFileSync(`${root}/worlds/patches/eden-life-20261017/batch.json`)).ops;apply('eden life defs',life.filter(o=>o.op==='define'));const pl=life.filter(o=>o.op!=='define');for(let i=0;i<pl.length;i+=10)apply(`eden life ${i/10+1}`,pl.slice(i,i+10),'any');}
const places=JSON.parse(readFileSync(`${root}/worlds/eden/places.v1.json`)).places;
// Invisible native land-use regions preserve outdoor destinations without
// painting duplicate plazas over the gardens/water. Interior destinations are
// the real building rooms, not stale source floor polygons.
const zoneOps=places.filter(p=>p.id!=='eden'&&!p.id.startsWith('int-')&&!/^commons-mat-/.test(p.id)&&!BUILDINGS.some(b=>b.originalPlaceId===p.id)).map(p=>({op:'place',def:'core/zone@1',name:`place-${p.id.replaceAll('.','-')}`.slice(0,48),shape:{area:p.polygon},params:{use:/farm|garden|vineyard/.test(p.id)?'farm':/market|cafe|shop|hotel/.test(p.id)?'commercial':/commons|campus|library/.test(p.id)?'civic':/lake|pond|river|mountain|shore/.test(p.id)?'wild':'park'}}));
for(let i=0;i<zoneOps.length;i+=12)apply(`named outdoor places ${i/12+1}`,zoneOps.slice(i,i+12));
// lane E-life's old place schedules, on the named places above (worlds/patches/eden-life-20261017/schedules.json)
{const ex=JSON.parse(readFileSync(`${root}/worlds/patches/eden-life-20261017/extras.json`)).ops;apply('eden life extras defs',ex.filter(o=>o.op==='define'));apply('eden life extras',ex.filter(o=>o.op!=='define'),'any');}
// lane L4a: the rest of old Eden's band (stage guitar/keys/bass, bandstand viola, amphitheatre guitar) (worlds/patches/eden-music-20261017)
{const mu=JSON.parse(readFileSync(`${root}/worlds/patches/eden-music-20261017/music.json`)).ops;apply('eden music defs',mu.filter(o=>o.op==='define'));apply('eden music',mu.filter(o=>o.op!=='define'),'any');}
apply('eden life schedules',JSON.parse(readFileSync(`${root}/worlds/patches/eden-life-20261017/schedules.json`)).ops);
const coverage=places.map(p=>({id:p.id,name:p.name,polygon:p.polygon,parent:p.parent,buildings:BUILDINGS.filter(b=>b.originalPlaceId===p.id).map(b=>b.name),zone:zoneOps.find(o=>o.name===`place-${p.id.replaceAll('.','-')}`.slice(0,48))?.name??null}));
writeFileSync(`${root}/worlds/templates/eden-2026.json`,JSON.stringify(genesis,null,2)+'\n');
writeFileSync(`${out}/inventory.json`,JSON.stringify({contract:'eden-2026-inventory/1',batches:stats,entities:god.model.entities.size,adjustments,buildings:BUILDINGS.map(b=>({...b,actualPose:god.model.get(b.name)?god.model.worldPose(god.model.get(b.name)):null})),courtyards:COURTYARDS,furniture,places:coverage,landmarks:LANDMARKS,landscapeNotes:LANDSCAPE_NOTES},null,2));
writeFileSync(`${out}/snapshot.json`,JSON.stringify(god.publicSnapshot()));
console.log('WROTE eden-2026.json',god.model.entities.size,'entities',genesis.batches.length,'accepted batches');db.close();
