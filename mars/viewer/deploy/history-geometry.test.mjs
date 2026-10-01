import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import * as T from 'three';
const file=new URL(`../.history-test-${process.pid}.mjs`,import.meta.url);
await build({stdin:{contents:`export * from './app/history/scenes';export {SEAT_HELD_YEARS,BAY} from './app/history/kit';export {YEAR_NORTH_AZIMUTH_OFFSET} from './engine/env/sun';export {DECK1_TOP_2022,ROOF_TOP_2022} from './app/history/photographic-corrections';`,resolveDir:new URL('..',import.meta.url).pathname,loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile:file.pathname,logLevel:'error'});
T.TextureLoader.prototype.load=function(url){const texture=new T.Texture();texture.userData.sourceUrl=url;return texture;};
// oxlint-disable-next-line typescript/no-deprecated -- offline scene construction; no renderer
 globalThis.document={createElement:()=>({width:1,height:1,getContext:()=>new Proxy({}, {get:(_t,key)=>key==='createRadialGradient'?()=>({addColorStop(){}}):()=>{}})})};
const {createHistoricalScene,SEAT_HELD_YEARS,BAY,YEAR_NORTH_AZIMUTH_OFFSET,DECK1_TOP_2022,ROOF_TOP_2022,trailerClearance}=await import(file.href);
after(()=>fs.unlink(file));
function meshes(root,kind){root.updateMatrixWorld(true);const result=[];root.traverse(o=>{if(o instanceof T.Mesh&&(!kind||o.userData.kind===kind))result.push(o);});return result;}
const bounds=o=>new T.Box3().setFromObject(o);
test('2021 corridor is clear ground beneath a sagging canopy, as wide as either wing',()=>{
 const root=createHistoricalScene(2021),main=root.children.find(o=>o.userData.assembly_id==='chiba');
 const decks=meshes(main,'plywood deck sheet');
 for(const deck of decks){const b=bounds(deck);assert.ok(b.max.x<=-2.28||b.min.x>=2.28,'A deck intrudes into the bare-ground corridor');}
 const left=new T.Box3(),right=new T.Box3();for(const deck of decks){const b=bounds(deck);(b.max.x<0?left:right).union(b);}
 assert.ok(Math.abs((right.min.x-left.max.x)-left.getSize(new T.Vector3()).x)<.03);
 const shade=meshes(main,'draped silver aluminet')[0],b=bounds(shade);assert.ok(b.min.y>3.0&&b.min.y<3.3&&b.max.y>4.4,'c6730 and Gene aerials: raised silver center and dropped end aprons');const pos=shade.geometry.attributes.position;const center=[],ends=[];for(let i=0;i<pos.count;i++)if(Math.abs(pos.getX(i))<.01)(Math.abs(pos.getZ(i))<1?center:Math.abs(pos.getZ(i))>12?ends:[]).push(pos.getY(i));assert.ok(Math.min(...center)>Math.max(...ends)+.8);assert.equal(shade.userData.walkNoCollision,true);
});
test('2021 Jan 27 aerial fit has an eight-bay hall and an asymmetric seven-trailer camp',()=>{
 const root=createHistoricalScene(2021),main=root.children.find(o=>o.userData.assembly_id==='chiba');root.updateMatrixWorld(true);
 const ground=meshes(main,'rack upright').map(bounds);
 const footprint=ground.reduce((box,b)=>box.union(b),new T.Box3()),size=footprint.getSize(new T.Vector3());
 assert.ok(Math.abs(size.z-(8*BAY+.075))<.001,`hall length ${size.z.toFixed(2)} m`);
 assert.ok(Math.abs(size.x-(3*4.572+.075))<.001,`hall width ${size.x.toFixed(2)} m`);
 const rvs=root.children.filter(o=>/^rv-\d+$/.test(o.userData.assembly_id));assert.equal(rvs.length,7);assert.ok(!rvs.some(o=>o.userData.assembly_id==='rv-4'),'c1285/c6735: old rv-4 pixel pick was empty ground');
 assert.equal(rvs.filter(o=>o.position.x<0).length,4,'four west trailers plus one centered behind the hall');
 assert.ok(rvs.filter(o=>o.position.x>0).every(o=>o.position.z>0||o.position.z<-20),'east side is open between the rear arc and two front trailers');
 for(const rv of rvs){const shell=meshes(rv,'trailer shell')[0],t={x:rv.position.x,z:rv.position.z,angle:rv.rotation.y,length:shell.geometry.parameters.depth};
  const b=footprint;assert.ok(trailerClearance(t,[b.min.x,b.min.z,b.max.x,b.max.z])>=1,`${rv.userData.assembly_id} clears the rack`);}
 assert.ok(root.children.some(o=>o.userData.assembly_id==='school-bus'));
});
test('2022 c273 roof controls retain four distinct measured centers and an open courtyard',()=>{
 const root=createHistoricalScene(2022),ids=['chiba','east-house','kitchen','west-house'];
 const centers=[[1.62,-10.65],[10.43,2.23],[-2.8,10.3],[-11.15,-2.62]];
 for(const [i,id] of ids.entries()){
  const g=root.children.find(o=>o.userData.assembly_id===id);g.updateWorldMatrix(true,true);
  const center=g.localToWorld(new T.Vector3(-BAY/2,0,0));
  assert.ok(Math.hypot(center.x-centers[i][0],center.z-centers[i][1])<.01,`${id} c273 roof-control center`);
  assert.ok(Math.abs(g.rotation.y+i*Math.PI/2)<.001);
  const floor=new T.Box3();for(const m of meshes(g,'plywood deck sheet'))if(bounds(m).max.y<.3)floor.union(bounds(m));
  assert.equal(floor.containsPoint(new T.Vector3(0,.2,0)),false,'courtyard stays open');
  const size=floor.getSize(new T.Vector3());assert.ok(Math.abs(Math.max(size.x,size.z)-3*BAY)<.02);
 }
});
test('2021 aerial vehicles: conventional school bus, cars and differentiated trailers',()=>{
 const root=createHistoricalScene(2021);root.updateMatrixWorld(true);
 const bus=asm(root,'school-bus');
 assert.equal(meshes(bus,'school bus wheel').length,4);
 const hood=bounds(meshes(bus,'school bus hood')[0]),body=bounds(meshes(bus,'yellow school bus body')[0]);
 assert.ok(!body.containsBox(hood),'hood projects beyond passenger body');
 assert.ok(meshes(bus,'bus windscreen').length&&meshes(bus,'school bus folding entry').length);
 const pickup=asm(root,'white-pickup'),trailer=asm(root,'rv-8');
 assert.ok(!bounds(meshes(pickup,'vehicle lower body')[0]).intersectsBox(bounds(meshes(trailer,'trailer shell')[0])),'pickup must not overlap the old misidentified trailer position');
 for(const id of ['olive-pickup','red-pickup','dark-suv','green-car','red-suv','orange-work-pickup','white-pickup','front-green-car']){
  assert.equal(meshes(asm(root,id),'vehicle wheel').length,4);
 }
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
test('2024 Freeside source frontage: PV reaches ground and wing canopies stay below the core',()=>{
 const root=createHistoricalScene(2024),core=asm(root,'kitchen');root.updateMatrixWorld(true);
 const pv=meshes(core,'photovoltaic cells').map(bounds);
 assert.ok(pv.length>0);assert.ok(Math.min(...pv.map(b=>b.min.y))<.1,'solar bottom must not float at head height');
 for(const id of ['freeside-wing','freeside-west-wing']){
  const wing=asm(root,id),covers=meshes(wing,'front wing blue tarp canopy');
  assert.ok(covers.length>0);assert.ok(covers.every(m=>bounds(m).max.y<3),'source wings are lower than the central roof');
 }
});
test('2024 Jan 22 aerial: six-by-three Chiba roof, Freeside about 47 m north, and a mapped U of 18 vehicles',()=>{
 const root=createHistoricalScene(2024);root.updateMatrixWorld(true);
 const chiba=asm(root,'chiba'),freeside=asm(root,'kitchen');
 const roof=new T.Box3();for(const m of meshes(chiba,'plywood deck sheet'))if(m.parent===chiba&&bounds(m).min.y>4.5&&bounds(m).getCenter(new T.Vector3()).z>=-1.5*BAY)roof.union(bounds(m));
 assert.ok(Math.abs((roof.max.x-roof.min.x)-6*BAY)<.1);
 assert.ok(Math.abs((roof.max.z-roof.min.z)-3*BAY)<.1);
 assert.ok(Math.abs(freeside.position.z-chiba.position.z+46.7)<.1);
 assert.ok(Math.abs(freeside.position.x-chiba.position.x+4)<.1);
 const ring=root.children.filter(o=>/^rv-\d+$/.test(o.userData.assembly_id));
 assert.equal(ring.length,18);
 assert.equal(ring.filter(o=>meshes(o,'trailer shell').length).length,9);
 assert.equal(ring.filter(o=>meshes(o,'bus body').length).length,3);
 assert.equal(ring.filter(o=>meshes(o,'van body').length).length,5);
 assert.equal(ring.filter(o=>meshes(o,'car body').length).length,1);
 assert.equal(root.children.filter(o=>/^car-\d+$/.test(o.userData.assembly_id)).length,11);
});
// ---- Props stand on their surfaces (OWNER_FEEDBACK §15 "levitating tires", W46) ----
// For every prop piece the lowest vertex is within 1 cm of the surface under its footprint: the highest upward-facing
// structure face (deck sheet, beam, crossbar, platform) below it, else the studio ground (−0.16, the year files' groundY).
const GROUND=-0.16,TOL=.01;
const PROP=/^(table leg|bench foot|stored food crate|white refrigerator|café painted counter|trailer wheel|rv tire|portable toilet body|counter leg|workshop storage bin)$/;
const SUPPORT=/deck|beam|crossbar|platform/;
/** Trailers whose ring passes through Chiba (wheels on the ground, shells through the hall's deck): a layout question, not
 *  a datum one (QUESTIONS Q21 / W46). Asserted so a layout fix shows up here; remove the entry when it no longer applies. */
const TRAILERS_IN_CHIBA={}; // W51: Q2 answered (none under Chiba in 2023 / 2024); the ring now keeps out (see below)
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
 else for(const k of year===2021?['table leg','counter leg','trailer wheel']:year===2024?['table leg','trailer wheel']:['table leg','stored food crate','white refrigerator'])assert.ok(kinds.has(k),`${year} ${k}`);
});
test('2020 RV wheels roll along the vehicle: tire ring in the RV\'s length–height plane, axle across it',()=>{
 const root=createHistoricalScene(2020);root.updateMatrixWorld(true);const rv=root.children.find(o=>o.userData.assembly_id==='rv-1');
 const q=new T.Quaternion(),along=new T.Vector3(1,0,0).applyQuaternion(rv.getWorldQuaternion(q));
 const tires=meshes(rv,'rv tire');assert.equal(tires.length,4);
 for(const t of tires){const axis=new T.Vector3(0,0,1).applyQuaternion(t.getWorldQuaternion(q));assert.ok(Math.abs(axis.dot(along))<1e-6&&Math.abs(axis.y)<1e-6,'tire axis across the vehicle');}
});

// ---- 2022 reconciliation (Gene's questionnaire 2026-09-29; RECONCILIATION_2022.md §a–§f; W51) ------------------------
const HOUSES=[['chiba','Ba Sing Se'],['east-house','Cahuilla'],['kitchen','Chatsubo'],['west-house','Huaqiangbei']];
const asm=(root,id)=>root.children.find(o=>o.userData.assembly_id===id);
const axisOf=(o,v)=>new T.Vector3(...v).applyQuaternion(o.getWorldQuaternion(new T.Quaternion()));
test('2022 names: Ba Sing Se / Cahuilla / Chatsubo / Huaqiangbei on the kept ids, and no "Chiba" in 2022',()=>{
 const root=createHistoricalScene(2022);
 for(const [id,name] of HOUSES)assert.equal(asm(root,id).name,name);
 root.traverse(o=>assert.ok(!/chiba/i.test(o.name),`2022 shows "${o.name}"`));
});
test('2022 evidence fixes the mural and functional rooms to their photographed wings',()=>{
 const root=createHistoricalScene(2022),ba=asm(root,'chiba'),cahuilla=asm(root,'east-house'),chatsubo=asm(root,'kitchen'),hua=asm(root,'west-house');
 // Review5 replaces the obsolete two-wall count, which encoded a rear mural.
 // c63403 instead shows three courtyard panels; c33157 resolves the painted end.
 const panels=meshes(ba,'plywood wall').filter(o=>String(o.userData.source??'').includes('c63403')&&o.position.z>0);
 assert.equal(panels.length,3,'three photographed courtyard panels');
 const left=panels.find(o=>Math.abs(o.position.x+BAY)<.01),middle=panels.find(o=>Math.abs(o.position.x)<.2),right=panels.find(o=>Math.abs(o.position.x-BAY)<.01);
 assert.ok(left&&middle&&right,'left pier, middle arch and right lower panel');
 assert.ok(left.geometry.parameters.height>4.5&&right.geometry.parameters.height<2.4,'full-height left pier, open upper right room');
 assert.ok(middle.position.z>left.position.z+.25&&Math.abs(right.position.z-left.position.z)<.01,'middle arch projects beyond side panels');
 const end=meshes(ba,'plywood wall').find(o=>String(o.userData.source??'').includes('c33157')&&Math.abs(o.rotation.y-Math.PI/2)<.01);
 assert.ok(end&&end.geometry.parameters.height>4.5,'painted end reaches high roof');
 for(const wing of [cahuilla,chatsubo,hua])assert.equal(meshes(wing,'plywood wall').filter(o=>/\/2022\/(?:review5-bss-|arches)/.test(o.material.map?.userData.sourceUrl??'')).length,0,'Ba Sing Se art not on another wing');
 assert.equal(meshes(cahuilla,'three-basin stainless sink').length,1,'Cahuilla contains Gene-labeled kitchen/water station');
 assert.equal(meshes(chatsubo,'Chatsubo bar counter').length,1,'Chatsubo retains its open bar counter');
 assert.equal(meshes(hua,'upper DJ booth shelf').length,1,'Huaqiangbei retains its open upper performance bay');
 const panel=meshes(hua,'projecting panel cap')[0],side=meshes(hua,'plywood wall').filter(o=>String(o.userData.source??'').includes('c247'));
 assert.ok(panel&&side.length>=5,'Huaqiangbei has the protruding lower wall and solid side piers seen in c247');
});
test('2022 wall faces avoid coplanar overlap and photo panels clear their backing',()=>{
 const root=createHistoricalScene(2022);root.updateMatrixWorld(true);
 const walls=meshes(root).filter(o=>o.userData.kind==='plywood wall'||/photographed.*panel/.test(o.userData.kind??''));
 const face=o=>{o.geometry.computeBoundingBox();const b=o.geometry.boundingBox,center=b.getCenter(new T.Vector3()).applyMatrix4(o.matrixWorld),q=o.getWorldQuaternion(new T.Quaternion());return {o,center,u:new T.Vector3(1,0,0).applyQuaternion(q),n:new T.Vector3(0,0,1).applyQuaternion(q),w:(b.max.x-b.min.x)/2,h:(b.max.y-b.min.y)/2,t:(b.max.z-b.min.z)/2};};
 const faces=walls.map(face),bad=[];
 for(let i=0;i<faces.length;i++)for(let j=i+1;j<faces.length;j++){
  const a=faces[i],b=faces[j];if(Math.abs(a.n.dot(b.n))<.99999)continue;
  const delta=b.center.clone().sub(a.center);
  if(Math.abs(delta.dot(a.u))>=a.w+b.w-.01||Math.abs(delta.y)>=a.h+b.h-.01)continue;
  const distance=Math.abs(delta.dot(a.n));
  if([a.t+b.t,Math.abs(a.t-b.t)].some(d=>Math.abs(distance-d)<.0001))bad.push([a.o.userData.component_id,b.o.userData.component_id]);
 }
 assert.deepEqual(bad,[],'overlapping coplanar wall faces produce flicker');
 const cahuilla=asm(root,'east-house'),photo=meshes(cahuilla,'Cahuilla photographed contour panel')[0];
 const backing=meshes(cahuilla,'plywood wall').find(o=>String(o.userData.source??'').includes('c57008')&&o.position.z>0);
 const p=face(photo),ray=new T.Raycaster(p.center.clone().addScaledVector(p.n,1),p.n.clone().negate());
 const hits=ray.intersectObjects([photo,backing],false),front=hits.find(h=>h.object===photo),back=hits.find(h=>h.object===backing);
 assert.ok(front&&back&&back.distance-front.distance>.001,'photograph face clears its opaque backing');
});
test('2022 finished rooms retain the source-supported open upper areas',()=>{
 const root=createHistoricalScene(2022),ba=asm(root,'chiba'),cahuilla=asm(root,'east-house'),chatsubo=asm(root,'kitchen');
 const swags=meshes(ba,'Ba Sing Se red ceiling fabric');assert.ok(swags.length>0&&swags.every(o=>bounds(o).min.y>4),'February12 red swags remain overhead');
 assert.equal(meshes(ba,'Ba Sing Se upper roof ladder stile').length,2,'narrow photographed upper ladder');
 const upper=ba.getObjectByName('Ba Sing Se upper occupied room');assert.ok(upper&&meshes(upper,'table top').length===1,'occupied upper room table');
 assert.equal(meshes(cahuilla,'Cahuilla photographed contour panel').length,1,'later contour facade finish');
 const end=meshes(cahuilla,'plywood wall').find(o=>String(o.userData.source??'').includes('c33159')&&Math.abs(o.rotation.y-Math.PI/2)<.01);
 assert.ok(end?.material.map&&end.geometry.parameters.height>4.5,'completed Cahuilla end painting');
 assert.equal(meshes(chatsubo,'Chatsubo reflective bar front').length,1,'occupied bar finish');
 const roof=meshes(chatsubo,'plywood deck sheet').filter(o=>Math.abs(o.position.y-4.86)<.01);
 assert.ok(roof.length>0&&roof.every(o=>o.position.x<-.5*BAY),'c273: high roof remains on one end bay');
 assert.ok(Math.abs(roof.reduce((n,o)=>n+o.geometry.parameters.width,0)-BAY)<.05,'no invented full three-bay high roof');
});
test('2022 stairs: treads PARALLEL to the house, one bay wide, climbing across the depth from the sand at the courtyard face to the first-floor deck',()=>{
 const root=createHistoricalScene(2022);root.updateMatrixWorld(true);
 for(const [id] of HOUSES){
  const g=asm(root,id),along=axisOf(g,[1,0,0]),treads=meshes(g,'stair tread').sort((a,b)=>bounds(a).max.y-bounds(b).max.y);
  assert.equal(treads.length,5,`${id}: c477 five broad terraces plus landing`);
  for(const t of treads){assert.ok(Math.abs(axisOf(t,[1,0,0]).dot(along))>Math.cos(Math.PI/180),`${id} tread parallel to the house`);assert.ok(Math.abs(t.geometry.parameters.width-(BAY-.12))<.01,`${id} tread one bay wide`);}
  const p0=bounds(treads[0]).getCenter(new T.Vector3()),p1=bounds(treads.at(-1)).getCenter(new T.Vector3()),climb=p1.clone().sub(p0).setY(0);
  assert.ok(Math.abs(climb.clone().normalize().dot(along))<.01,`${id} climbs across the depth`);
  assert.ok(climb.length()>2.7&&climb.length()<4.6,`${id} run ${climb.length().toFixed(2)} m ≈ the depth`);
  assert.ok(Math.hypot(p0.x,p0.z)<Math.hypot(p1.x,p1.z),`${id} foot on the courtyard side (Q29 default)`);
  const risers=meshes(g,'stair rack support');assert.equal(risers.length,12);assert.ok(Math.abs(Math.min(...risers.map(r=>bounds(r).min.y)))<.005,`${id} rack supports start on the sand`);
  const landing=meshes(g,'stair landing')[0];assert.ok(Math.abs(bounds(landing).max.y-DECK1_TOP_2022)<.01,`${id} landing at the deck top`);
  assert.equal(meshes(g,'stair riser').length,0,'open rack stair has no invented continuous timber risers');
 }
});
// Rotated photographed buildings/vehicles can have intersecting world AABBs while
// their actual footprints are separate. Convex hulls preserve localized ladder
// projections instead of extending them across the whole building width.
function groundRectangle(o){
 const points=[];
 for(const mesh of meshes(o)){mesh.geometry.computeBoundingBox();const b=mesh.geometry.boundingBox;
  for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z])points.push(new T.Vector3(x,y,z).applyMatrix4(mesh.matrixWorld).setY(0));
 }
 points.sort((a,b)=>a.x-b.x||a.z-b.z);
 const cross=(a,b,c)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
 const half=ps=>{const h=[];for(const p of ps){while(h.length>=2&&cross(h.at(-2),h.at(-1),p)<=0)h.pop();h.push(p);}h.pop();return h;};
 return [...half(points),...half([...points].reverse())];
}
function rectangleDistance(a,b){
 const dot=(p,n)=>p.x*n.x+p.z*n.z;
 let separated=false;
 for(const poly of [a,b])for(let i=0;i<poly.length;i++){
  const edge=poly[(i+1)%poly.length].clone().sub(poly[i]),n=new T.Vector3(-edge.z,0,edge.x).normalize();
  const av=a.map(p=>dot(p,n)),bv=b.map(p=>dot(p,n));
  if(Math.max(...av)<Math.min(...bv)||Math.max(...bv)<Math.min(...av))separated=true;
 }
 if(!separated)return 0;
 const pointSegment=(p,a,b)=>{const d=b.clone().sub(a).setY(0),v=p.clone().sub(a).setY(0),t=Math.max(0,Math.min(1,v.dot(d)/d.lengthSq()));return v.sub(d.multiplyScalar(t)).length();};
 return Math.min(...a.flatMap(p=>b.map((q,i)=>pointSegment(p,q,b[(i+1)%b.length]))),...b.flatMap(p=>a.map((q,i)=>pointSegment(p,q,a[(i+1)%a.length]))));
}
test('2022 c273: seven trailers plus separately identified canopy and silver shelter; 2022–2025 trailers stay ≥ 0.5 m off every building, none under Chiba',()=>{
 const clashes=[];
 for(const year of [2022,2023,2024,2025]){
  const root=createHistoricalScene(year);root.updateMatrixWorld(true);
  const rvs=root.children.filter(o=>/^rv-\d+$/.test(o.userData.assembly_id)),blds=root.children.filter(o=>o.userData.assembly_id&&!/^rv-|^car-|^observed-car-|^observed-black-bus$|^yellow-bus$|^people$/.test(o.userData.assembly_id));
  if(year===2022){assert.deepEqual(rvs.map(o=>o.userData.assembly_id),['rv-1','rv-2','rv-3','rv-4','rv-5','rv-6','rv-8']);assert.ok(rvs.slice(0,5).every(o=>o.position.x<-10),'the train stands on the −X side');}
  for(const rv of rvs){
   // 2024 retains rv-N stable ids for mapped bus/van objects as well as trailers.
   const shell=meshes(rv,'trailer shell')[0]??meshes(rv,'bus body')[0]??meshes(rv,'van body')[0]??meshes(rv,'car body')[0]??meshes(rv,'vehicle body')[0];
   assert.ok(shell,`${year} ${rv.userData.assembly_id} has a vehicle shell`);
   for(const b of blds){let c=rectangleDistance(groundRectangle(rv),groundRectangle(b));if(c<.5){const vehicle=groundRectangle(rv);c=Math.min(...meshes(b).map(mesh=>rectangleDistance(vehicle,groundRectangle(mesh))));}if(c<.5)clashes.push(`${year} ${rv.userData.assembly_id} is ${c.toFixed(2)} m from ${b.name}`);}
  }
 }
 assert.deepEqual(clashes,[],'source-fitted vehicle footprints must clear buildings');
});
test('2022 solar: south-facing rows on 45° triangle frames, low edge on the south roof edge (Huaqiangbei one row, Cahuilla two unequal rows; Ba Sing Se three stepped rows; Chatsubo none)',()=>{
 const root=createHistoricalScene(2022);root.updateMatrixWorld(true);
 const n=YEAR_NORTH_AZIMUTH_OFFSET[2022],south=new T.Vector3(Math.sin((180+n)*Math.PI/180),0,-Math.cos((180+n)*Math.PI/180));
 for(const [id,count,rows] of [['chiba',9,3],['east-house',17,2],['kitchen',0,0],['west-house',10,1]]){
  const g=asm(root,id),panels=meshes(g,'solar panel');assert.equal(panels.length,count,`${id} modules`);
  assert.equal(meshes(g,'solar frame rafter').length,count+rows,`${id}: one triangle frame per module edge`);
  const roof=new T.Box3();for(const m of meshes(g,'plywood deck sheet'))if(bounds(m).min.y>4.5)roof.union(bounds(m));
  for(const p of panels){
   const nrm=axisOf(p,[0,1,0]),h=nrm.clone().setY(0).normalize();
   assert.ok(h.angleTo(south)<15*Math.PI/180,`${id} panel faces ${(h.angleTo(south)*180/Math.PI).toFixed(1)}° off south`);
   assert.ok(Math.abs(nrm.angleTo(new T.Vector3(0,1,0))-Math.PI/4)<Math.PI/180,`${id} panel tilt 45°`);
   const b=bounds(p),pos=p.geometry.attributes.position,v=new T.Vector3(),pts=[];for(let i=0;i<pos.count;i++)pts.push(v.fromBufferAttribute(pos,i).applyMatrix4(p.matrixWorld).clone());
   const lo=pts.reduce((a,q)=>q.y<a.y?q:a),hi=pts.reduce((a,q)=>q.y>a.y?q:a);
   assert.ok(lo.dot(south)>hi.dot(south),`${id} low edge on the south side`);
   assert.ok(b.min.y>ROOF_TOP_2022-.01,`${id} module above the roof deck`);
   if(id==='west-house'){const edge=Math.sign(south.x)>0?roof.max.x:roof.min.x;assert.ok(Math.abs(Math.abs(lo.x-edge)-.5072)<.03,`${id} low edge remains at the rack edge, inside the wider c273 roof overhang`);}
  }
 }
 assert.equal(meshes(asm(root,'west-house'),'table top').length,0,'no table at the corner (Q1)');
});

test('2024 north canopy bypass joins entrance landing to continuous roof edge',()=>{
 const root=createHistoricalScene(2024),g=root.children.find(o=>o.userData.assembly_id==='chiba');
 const steps=meshes(g,'north roof bypass open tread').sort((a,b)=>a.position.y-b.position.y);
 assert.ok(steps.length>=5);
 const roofTop=4.86+.0325,base=2.46+.0325,last=steps.at(-1),first=steps[0];
 assert.ok(Math.abs(last.position.y+.0325-roofTop)<1e-6,'Highest tread meets actual roof top');
 assert.ok(first.position.y+.0325>base&&first.position.y+.0325-base<.4,'Lowest tread rises from north entrance landing');
 for(let i=1;i<steps.length;i++)assert.ok(steps[i].position.y>steps[i-1].position.y&&steps[i].position.z>steps[i-1].position.z);
 for(const step of steps)assert.ok(step.position.z<-1.5*BAY+.2,'Bypass is at north edge, not underneath south roof');
 // The final oriented tread reaches past the north roof edge; the lowest
 // reaches the east edge of the existing north entrance landing (x=0).
 const localBox=o=>{o.geometry.computeBoundingBox();return o.geometry.boundingBox.clone().applyMatrix4(o.matrix);};
 assert.ok(localBox(last).max.z>=-1.5*BAY);
 assert.ok(localBox(first).min.x<=0);
 const rayOrigin=g.localToWorld(new T.Vector3(1.28,5.3,-1.5*BAY-.3));
 const rayDirection=new T.Vector3(0,0,1).transformDirection(g.matrixWorld);
 const guards=meshes(g).filter(o=>/roof guard|roof railing/.test(o.userData.kind??''));
 assert.equal(new T.Raycaster(rayOrigin,rayDirection,0,.6).intersectObjects(guards,false).length,0,'Roof guard leaves bypass entry clear');
});

test('2024 observed buses vans and cars have grounded low-poly wheels',()=>{
 const root=createHistoricalScene(2024);root.updateMatrixWorld(true);
 const vehicles=root.children.filter(g=>g.children.some(m=>/^(bus body|van body|car body|small vehicle body)$/.test(m.userData.kind??'')));
 assert.ok(vehicles.length>15);
 const geometries=new Set();
 for(const g of vehicles){
  const tires=meshes(g,'observed vehicle tire');assert.equal(tires.length,4,g.name);
  for(const tire of tires){geometries.add(tire.geometry);tire.geometry.computeBoundingBox();const b=tire.geometry.boundingBox.clone().applyMatrix4(tire.matrix);assert.ok(Math.abs(b.min.y+.16)<.001,'Tire bottom reaches local ground');}
  assert.ok(meshes(g,'observed vehicle front bumper').length===1);
 }
 assert.equal(geometries.size,1,'Fleet reuses one low-poly tire geometry');
});

test('2025 source auditorium rises toward south entrance with a continuous upper landing',()=>{
 const root=createHistoricalScene(2025),g=root.children.find(o=>o.userData.assembly_id==='chiba');
 const tiers=meshes(g,'auditorium tiered timber platform').sort((a,b)=>a.position.z-b.position.z);
 assert.equal(tiers.length,6,'nominal seating schedule retained pending measured spacing');
 for(let i=1;i<tiers.length;i++){
  assert.ok(tiers[i].position.y>tiers[i-1].position.y,'c72601/c72606: rises toward south entrance');
  const a=tiers[i-1],b=tiers[i];assert.ok(Math.abs((a.position.z+a.geometry.parameters.depth/2)-(b.position.z-b.geometry.parameters.depth/2))<.011,'adjacent tier plan extents touch');
 }
 const high=tiers.at(-1),landing=meshes(g,'projecting enclosure roof')[0];
 assert.ok(Math.abs(high.position.y+high.geometry.parameters.height/2-landing.position.y-landing.geometry.parameters.height/2)<.01,'no vertical drop from entry landing into auditorium');
 assert.ok(Math.abs(high.position.z+high.geometry.parameters.depth/2-landing.position.z+landing.geometry.parameters.depth/2)<.01,'no gap at entry threshold');
 assert.ok(tiers[0].position.z>-3*BAY/2+2,'north low-end stage remains open');
});

test('2024 c33391 west facade has enclosed rooms with real doors below open stepped terraces',()=>{
 const root=createHistoricalScene(2024),g=root.children.find(o=>o.userData.assembly_id==='chiba'),west=g.children.find(o=>o.userData.assembly_id==='west-terrace');
 const walls=meshes(west,'plywood wall').filter(o=>Math.abs(o.position.x+BAY/2)<.001);
 assert.ok(walls.length>10,'white outer wall is divided around source openings');
 for(const z of [-4.4,3.33])assert.ok(!walls.some(o=>Math.abs(o.position.z-z)<o.geometry.parameters.width/2&&Math.abs(o.position.y-1.3)<o.geometry.parameters.height/2),'tall west door is not sealed by wall');
 assert.equal(meshes(west,'west facade window glazing').length,3);
});
