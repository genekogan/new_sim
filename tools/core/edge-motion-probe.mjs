// Live-copy motion check (P0 re-animate): boot a PRIVATE copy of an edge world in-process (no port is served;
// the clock is driven here), report every Soul body, run 60 s with no acts, then have each named Soul act
// `wander:here` and run 60 s more. Prints how far each body moved and how many distinct positions it showed.
// Fake minds, $0, no model credentials. Never point it at a live data dir: it copies the DB first.
// Usage: node tools/core/edge-motion-probe.mjs <descriptor.json> <sim.db copy> <scratch dir> [entityId,...]
import {cpSync,mkdirSync,rmSync,readFileSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';
import {openEdgeServerV1} from './edge-server.mjs';
const [descPath,dbCopy,scratch,list]=process.argv.slice(2);
if(!descPath||!dbCopy||!scratch)throw Error('usage: edge-motion-probe.mjs <descriptor.json> <sim.db copy> <scratch dir> [entityId,...]');
const d=JSON.parse(readFileSync(descPath,'utf8')),flags=d.flags??{},dir=scratch+'/motion-probe-data';
if(dir.startsWith(d.dataDir))throw Error('scratch must not be the descriptor data dir');
rmSync(dir,{recursive:true,force:true});mkdirSync(dir,{recursive:true});cpSync(dbCopy,dir+'/sim.db');
const app=await openEdgeServerV1({input:d.input,dataDir:dir,worldId:d.worldId,port:4952,webDir:d.webDir,build:'local-motion-probe',placeData:d.placeData,seedObjects:d.objects,skillFile:d.skillFile,cliFile:d.cliFile,localSoulLimit:Number(d.localSoulLimit??16),
  humanRest:flags.humanRest??true,provisions:flags.provisions??true,sequences:flags.sequences??true,floorGoals:flags.floorGoals??true,kitchen:flags.kitchen??true,shore:flags.shore??true,foodDeliveryId:flags.foodDeliveryId,quietLandingCourtesy:flags.quietLandingCourtesy??true,social:flags.social??true,approachRetention:flags.approachRetention??true,closedGoals:flags.closedGoals??true,activateExpansion:flags.activateExpansion??true,ambient:false});
app.host.stop();
const W=app.host.engine.world,minds=[...app.host.minds.values()];
const bodies=list?list.split(','):minds.map(m=>m.entityId);
const pose=id=>W.entities[id].pose.p,start=Object.fromEntries(bodies.map(id=>[id,[...pose(id)]]));
const moved=()=>bodies.map(id=>+Math.hypot(pose(id)[0]-start[id][0],pose(id)[2]-start[id][2]).toFixed(1));
const run=async n=>{for(let i=0;i<n;i++){app.host.tickOnce();if(i%20===0){await setImmediate();app.host.drainInputs();}}};
const state=()=>bodies.map(id=>`${id} ${pose(id).map(v=>v.toFixed(1)).join(',')} L${W.entities[id].human.level} ${W.entities[id].human.activity}`).join('\n');
console.log(JSON.stringify({tick:W.tick,edgeMotionV1:app.host.engine.cfg?.edgeMotionV1===true}));console.log(state());
await run(1200);console.log('60 s, no acts: moved',JSON.stringify(moved()));console.log(state());
const pump=setInterval(()=>app.host.drainInputs(),5),receipts=[];
for(const id of bodies){const m=minds.find(x=>x.entityId===id);receipts.push(await app.edge.act({soulId:m.soulId,entityId:id,name:m.name,owner:m.owner},{capability:'wander:here',params:{seconds:40}}));}
clearInterval(pump);
for(const id of bodies)start[id]=[...pose(id)];
const seen=Object.fromEntries(bodies.map(id=>[id,new Set()]));
for(let k=0;k<12;k++){await run(100);for(const id of bodies)seen[id].add(pose(id).map(v=>v.toFixed(1)).join(','));}
console.log('60 s after wander:here: moved',JSON.stringify(moved()),'distinct positions /12',JSON.stringify(bodies.map(id=>seen[id].size)));
console.log('receipts',JSON.stringify(receipts.map(r=>r.receipt?app.edge.receipt(r.receipt.soulId,r.receipt.id).phase:r.code)));
await app.close().catch(e=>console.log('close:',e.message));rmSync(dir,{recursive:true,force:true});process.exit(0);
