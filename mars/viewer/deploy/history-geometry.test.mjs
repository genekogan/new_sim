import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import * as T from 'three';
const file=new URL(`../.history-test-${process.pid}.mjs`,import.meta.url);
await build({stdin:{contents:`export * from './app/history/scenes';export {SEAT_HELD_YEARS} from './app/history/kit';`,resolveDir:new URL('..',import.meta.url).pathname,loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile:file.pathname,logLevel:'error'});
T.TextureLoader.prototype.load=function(){return new T.Texture();};
// oxlint-disable-next-line typescript/no-deprecated -- offline scene construction; no renderer
 globalThis.document={createElement:()=>({width:1,height:1,getContext:()=>new Proxy({}, {get:(_t,key)=>key==='createRadialGradient'?()=>({addColorStop(){}}):()=>{}})})};
const {createHistoricalScene,SEAT_HELD_YEARS}=await import(file.href);
after(()=>fs.unlink(file));
function meshes(root,kind){root.updateMatrixWorld(true);const result=[];root.traverse(o=>{if(o instanceof T.Mesh&&(!kind||o.userData.kind===kind))result.push(o);});return result;}
const bounds=o=>new T.Box3().setFromObject(o);
test('2021 corridor is clear ground beneath a sagging canopy, as wide as either wing',()=>{
 const root=createHistoricalScene(2021),main=root.children.find(o=>o.userData.assembly_id==='chiba');
 const decks=meshes(main,'plywood deck sheet');
 for(const deck of decks){const b=bounds(deck);assert.ok(b.max.x<=-2.28||b.min.x>=2.28,'A deck intrudes into the bare-ground corridor');}
 const left=new T.Box3(),right=new T.Box3();for(const deck of decks){const b=bounds(deck);if(b.max.y<.3)(b.max.x<0?left:right).union(b);}
 assert.ok(Math.abs((right.min.x-left.max.x)-left.getSize(new T.Vector3()).x)<.03);
 const shade=meshes(main,'draped silver aluminet')[0],b=bounds(shade);assert.ok(b.min.y>3.4&&b.max.y-b.min.y>.5);assert.equal(shade.userData.walkNoCollision,true);
});
test('2022 ground footprints rotate symmetrically, with four traversable corner gaps',()=>{
 const root=createHistoricalScene(2022),ids=['chiba','east-house','kitchen','west-house'];
 const buildings=ids.map(id=>root.children.find(o=>o.userData.assembly_id===id));
 const footprint=g=>{const b=new T.Box3();for(const m of meshes(g))if(['plywood deck sheet','stair tread'].includes(m.userData.kind)&&bounds(m).max.y<2.6)b.union(bounds(m));return b;};
 const first=footprint(buildings[0]);
 for(let i=1;i<4;i++){
  const b=footprint(buildings[i]),rotation=new T.Matrix4().makeRotationY(-i*Math.PI/2),expected=first.clone().applyMatrix4(rotation);
  assert.ok(b.min.distanceTo(expected.min)<.001&&b.max.distanceTo(expected.max)<.001);
 }
 const north=footprint(buildings[0]),east=footprint(buildings[1]);assert.ok(east.min.x-north.max.x>1.8,'Corner passage must remain open');
 for(const g of buildings)assert.equal(footprint(g).containsPoint(new T.Vector3(0,.2,0)),false);
});
test('2024 PV occupies only the left frontage; glazing and exposed central mural remain',()=>{
 const root=createHistoricalScene(2024),main=root.children.find(o=>o.userData.assembly_id==='chiba');
 const panels=meshes(main,'photovoltaic cells');assert.equal(panels.length,12);for(const p of panels)assert.ok(bounds(p).max.x< -3.5);
 const windows=meshes(main,'plexiglass pane').filter(o=>bounds(o).min.x>0);assert.ok(windows.length>=12);
 const mural=meshes(main,'central flower mural')[0];assert.ok(bounds(mural).getSize(new T.Vector3()).x>3);
 for(const p of panels)assert.equal(bounds(p).intersectsBox(bounds(mural)),false);
});
test('2024 front as photographed (2026-09-29): vertical inset, straight stairs, flaps proud of the inset, plexiglass end wall with an open door',()=>{
 const root=createHistoricalScene(2024),main=root.children.find(o=>o.userData.assembly_id==='chiba');
 const inset=meshes(main,'inset wall');assert.equal(inset.length,3);
 const insetZ=Math.max(...inset.map(o=>bounds(o).max.z));
 for(const o of inset){const b=bounds(o);assert.ok(b.max.z-b.min.z<.05,'inset wall is vertical (thin in z)');}
 // stairs: every tread of a flight at the same depth band (no lean), rising toward the centre, in front of the inset
 const treads=meshes(main,'stair tread').filter(o=>bounds(o).min.z>insetZ-.05);assert.equal(treads.length,24);
 for(const t of treads){const b=bounds(t);assert.ok(b.min.z>insetZ-.01&&b.max.z<insetZ+1.4,'tread against the inset, not leaning');}
 const flap=(kind,side)=>meshes(main,kind).map(bounds).filter(b=>Math.sign(b.min.x+b.max.x)===side);
 for(const [kind,side] of [['left flap',-1],['right flap',1]]){const b=flap(kind,side).reduce((a,c)=>a.union(c),new T.Box3());assert.ok(b.max.z>insetZ+2.4,`${kind} bottom protrudes past the inset`);}
 assert.equal(meshes(main,'flap cheek').length,2);
 const door=meshes(main,'plexiglass door')[0];assert.equal(door.userData.component_id,'chiba-solarium-door');assert.equal(door.userData.door.state,'open');
 const {z:[z0,z1],y:[y0,y1],x}=door.userData.door.opening;assert.ok(z1-z0>1.2&&y1-y0>=2.0);
 // nothing of the chiba assembly occupies the door opening (walkers / camera pass through the gap)
 // exact: sample the opening (±0.2 m through the wall) against each mesh's oriented geometry box
 const pts=[];for(let i=0;i<=8;i++)for(let j=0;j<=10;j++)for(const dx of [-.2,0,.2])pts.push(new T.Vector3(x+dx,y0+.05+(y1-y0-.1)*j/10,z0+.02+(z1-z0-.04)*i/8));
 for(const m of meshes(main)){m.geometry.computeBoundingBox();const inv=m.matrixWorld.clone().invert(),bb=m.geometry.boundingBox.clone().expandByScalar(1e-3);
  assert.equal(pts.some(p=>bb.containsPoint(p.clone().applyMatrix4(inv))),false,`${m.userData.kind} blocks the solarium door`);}
 assert.ok(meshes(main,'plexiglass pane').every(m=>m.material.name==='plexiglass'));
});
// ---- Props stand on their surfaces (OWNER_FEEDBACK §15 "levitating tires", W46) ----
// For every prop piece the lowest vertex is within 1 cm of the surface under its footprint: the highest upward-facing
// structure face (deck sheet, beam, crossbar, platform) below it, else the studio ground (−0.16, the year files' groundY).
const GROUND=-0.16,TOL=.01;
const PROP=/^(table leg|bench foot|stored food crate|white refrigerator|café painted counter|trailer wheel|rv tire|portable toilet body|counter leg|workshop storage bin)$/;
const SUPPORT=/deck|beam|crossbar|platform/;
/** Trailers whose ring passes through Chiba (wheels on the ground, shells through the hall's deck): a layout question, not
 *  a datum one (QUESTIONS Q21 / W46). Asserted so a layout fix shows up here; remove the entry when it no longer applies. */
const TRAILERS_IN_CHIBA={2023:['rv-8','rv-9'],2024:['rv-10','rv-9']};
function propGaps(root){
 root.updateMatrixWorld(true);const all=[],props=[];
 root.traverse(o=>{if(!(o instanceof T.Mesh)||o instanceof T.InstancedMesh)return;all.push(o);if(PROP.test(o.userData.kind??''))props.push(o);});
 const supports=all.filter(o=>SUPPORT.test(o.userData.kind??'')),sides=supports.map(o=>o.material.side);supports.forEach(o=>{o.material.side=T.DoubleSide;});
 const rc=new T.Raycaster(),v=new T.Vector3(),out=[];
 for(const o of props){
  const p=o.geometry.attributes.position,pts=[];let min=Infinity;
  for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);pts.push(v.clone());min=Math.min(min,v.y);}
  const bottom=pts.filter(q=>q.y<min+1e-3),c=bottom.reduce((a,q)=>a.add(q),new T.Vector3()).multiplyScalar(1/bottom.length);
  // the top of the structure (or ground) under a footprint point, looking down from 0.5 m above the prop's bottom
  const under=s=>{rc.set(new T.Vector3(s.x,min+.5,s.z),new T.Vector3(0,-1,0));
   const h=rc.intersectObjects(supports,false).find(h=>h.face.normal.clone().transformDirection(h.object.matrixWorld).y>.5);
   return h&&h.point.y>GROUND?{y:h.point.y,on:h.object.userData.kind}:{y:GROUND,on:'ground'};};
  // it rests on the highest top within 1 cm under any bottom vertex (a leg or crate edge may sit on a beam that stands
  // 2.75 cm proud of the deck) or, if every top is higher, is sunk into the lowest of them
  const tops=[c,...bottom].map(under),resting=tops.filter(t=>t.y<=min+TOL),rest=resting.length?resting.reduce((a,t)=>t.y>a.y?t:a):tops.reduce((a,t)=>t.y<a.y?t:a);
  // and nothing pokes into the core of its footprint (bottom vertices pulled halfway to the centre)
  const core=Math.max(...[c,...bottom.map(q=>q.clone().lerp(c,.5))].map(q=>under(q).y));
  out.push({id:o.userData.component_id,asm:o.userData.assembly_id,kind:o.userData.kind,gap:min-rest.y,on:rest.on,lowest:min,poke:core-min});
 }
 supports.forEach((o,i)=>{o.material.side=sides[i];});
 return out;
}
for(const year of [2020,2021,2022,2023,2024,2025])test(`${year}: every prop stands on its surface (lowest vertex within 1 cm)`,()=>{
 const gaps=propGaps(createHistoricalScene(year)),kinds=new Set(gaps.map(g=>g.kind));
 assert.ok(gaps.length>0&&kinds.has('trailer wheel')||year===2020,`${year}: no props found`);
 if(SEAT_HELD_YEARS.has(year)){
  // held (Kit comment): still unseated, so the year-build pins stand; un-holding it makes this test the place to update
  assert.ok(gaps.some(g=>Math.abs(g.gap)>.1),`${year} is in SEAT_HELD_YEARS but its props are seated`);return;
 }
 const inChiba=TRAILERS_IN_CHIBA[year]??[],bad=[];
 for(const g of gaps){
  if(inChiba.includes(g.asm)&&g.kind==='trailer wheel'){assert.ok(Math.abs(g.lowest-GROUND)<=TOL&&g.on!=='ground',`${g.id}: expected on the ground under Chiba's deck`);continue;}
  if(Math.abs(g.gap)>TOL||g.poke>TOL)bad.push(`${g.id} ${g.gap>=0?'+':''}${g.gap.toFixed(3)} over ${g.on}${g.poke>TOL?`, structure ${g.poke.toFixed(3)} into its footprint`:''}`);
 }
 assert.deepEqual(bad,[],`${year}: props off their surfaces`);
 if(year===2020)for(const [k,n] of [['rv tire',24],['portable toilet body',4],['table leg',4],['counter leg',3],['workshop storage bin',6]])assert.equal(gaps.filter(g=>g.kind===k).length,n,`2020 ${k}`);
 else for(const k of ['table leg','stored food crate','white refrigerator'])assert.ok(kinds.has(k),`${year} ${k}`);
});
test('2020 RV wheels roll along the vehicle: tire ring in the RV\'s length–height plane, axle across it',()=>{
 const root=createHistoricalScene(2020);root.updateMatrixWorld(true);const rv=root.children.find(o=>o.userData.assembly_id==='rv-1');
 const q=new T.Quaternion(),along=new T.Vector3(1,0,0).applyQuaternion(rv.getWorldQuaternion(q));
 const tires=meshes(rv,'rv tire');assert.equal(tires.length,4);
 for(const t of tires){const axis=new T.Vector3(0,0,1).applyQuaternion(t.getWorldQuaternion(q));assert.ok(Math.abs(axis.dot(along))<1e-6&&Math.abs(axis.y)<1e-6,'tire axis across the vehicle');}
});
