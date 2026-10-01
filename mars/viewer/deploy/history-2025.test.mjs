import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import * as T from 'three';

const file=new URL(`../.history-2025-test-${process.pid}.mjs`,import.meta.url);
await build({stdin:{contents:`export * from './app/history/scenes';export {BAY} from './app/history/kit';`,resolveDir:new URL('..',import.meta.url).pathname,loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile:file.pathname,logLevel:'error'});
T.TextureLoader.prototype.load=function(){return new T.Texture();};
// oxlint-disable-next-line typescript/no-deprecated -- offline canvas stub; no browser DOM call
globalThis.document={createElement:()=>({width:1,height:1,getContext:()=>new Proxy({}, {get:()=>()=>{}})})};
const {createHistoricalScene,BAY,trailerClearance}=await import(file.href);
after(()=>fs.unlink(file));
const members=(root,id)=>root.children.find(o=>o.userData.assembly_id===id);
const meshes=(o,name)=>{const found=[];o.traverse(x=>{if(x instanceof T.Mesh&&(!name||x.userData.kind===name))found.push(x);});return found;};

test('2025 distinct architecture follows Gene-labeled courtyard and lateral Freeside topology',()=>{
 const root=createHistoricalScene(2025),chiba=members(root,'chiba'),free=members(root,'kitchen'),body=members(root,'bodywork-dojo'),tool=members(root,'secondary-house'),pods=members(root,'utility-booths');
 assert.ok(chiba&&free&&body&&tool&&pods);
 assert.ok(free.position.x<chiba.position.x-3*BAY&&free.position.z>chiba.position.z&&free.position.z<tool.position.z,'c538/c509: Freeside is west, not behind Chiba');
 assert.ok(tool.position.z>chiba.position.z+6*BAY&&Math.abs(tool.position.x-chiba.position.x)<4*BAY,'Tool Camp faces Chiba across the common courtyard');
 assert.ok(body.position.x>tool.position.x+2*BAY&&body.position.z>chiba.position.z&&body.position.z<tool.position.z);
 assert.ok(pods.position.x<free.position.x&&pods.position.z>free.position.z&&pods.position.z<tool.position.z);
 assert.equal(body.userData.entity_id,'mars_bodywork_residency_2025');
 assert.ok(meshes(body,'black dojo mat').length===1);
 const uprights=meshes(body,'rack upright');assert.ok(uprights.some(u=>Math.abs(u.position.x)<.1&&Math.abs(u.position.z)<BAY),'c45835/c45838: exposed internal rack columns');
 assert.equal(meshes(tool,'photovoltaic cells').length,52,'13 columns by four rows in the reviewed roof orbit');
 const roof=new T.Box3();for(const m of meshes(tool,'dark tarp roof'))roof.union(new T.Box3().setFromObject(m));
 const toolRoof=meshes(tool,'dark tarp roof')[0];assert.ok(Math.abs(toolRoof.geometry.parameters.width-10.9728)<.02&&Math.abs(toolRoof.geometry.parameters.depth-8.5344)<.02);
 assert.ok(Math.abs(body.rotation.y+Math.PI/2)<.35,'c509 Bodywork long roof runs approximately north/south');
 assert.equal(root.children.filter(o=>/^rv-\d+$/.test(o.userData.assembly_id)).length,10);
});

test('2025 Chiba frontage, photographed side surfaces and rooftop motif are represented',()=>{
 const root=createHistoricalScene(2025),g=members(root,'chiba');
 const uprights=meshes(g,'19 foot central upright');assert.equal(uprights.length,2);
 const east=meshes(g,'Chiba east plywood facade photo')[0],north=meshes(g,'Chiba north patchwork facade photo')[0];
 assert.ok(east&&north&&east.userData.source.includes('c72596')&&north.userData.source.includes('c72594'));
 const petals=meshes(g,'red pentagonal roof petal');assert.equal(petals.length,5);for(const petal of petals)assert.equal(petal.geometry.parameters.segments,5);
 const panels=meshes(g,'solar panel');assert.equal(panels.length,8);assert.equal(panels.filter(p=>p.position.x<0).length,4);
 assert.equal(meshes(g,'north solar plywood back').length,4);
 const terraces=meshes(g,'upper side terrace tread');assert.equal(terraces.length,4);
 for(const side of [-1,1])assert.deepEqual(terraces.filter(t=>Math.sign(t.position.x)===side).map(t=>t.position.y),[3.88,4.4]);
 assert.equal(meshes(g,'staggered rack stair platform').length,5,'sixth level is the shared enclosure-roof landing');
 assert.ok(uprights.every(u=>u.position.z>0),'c72595: raised center uprights are on south frontage');
 const b=new T.Box3();for(const m of meshes(g,'plywood deck sheet'))if(new T.Box3().setFromObject(m).max.y<.3)b.union(new T.Box3().setFromObject(m));
 const size=b.getSize(new T.Vector3());assert.ok(Math.abs(size.x-3*BAY)<.02&&Math.abs(size.z-3*BAY)<.02);
 for(const rv of root.children.filter(o=>/^rv-\d+$/.test(o.userData.assembly_id))){const shell=(meshes(rv,'trailer shell')[0]??meshes(rv,'vehicle body')[0]),t={x:rv.position.x,z:rv.position.z,angle:rv.rotation.y,length:(shell.geometry.computeBoundingBox(),shell.geometry.boundingBox.max.z-shell.geometry.boundingBox.min.z)};assert.ok(trailerClearance(t,[b.min.x,b.min.z,b.max.x,b.max.z])>=.5);}
});

test('2025 decorated projecting room stays clear of its photo layers and sofa rests on ground',()=>{
 const root=createHistoricalScene(2025),g=members(root,'chiba');root.updateMatrixWorld(true);
 const art=meshes(g,'projecting room stickered door source')[0],door=meshes(g,'projecting room door')[0];
 const a=new T.Box3().setFromObject(art),b=new T.Box3().setFromObject(door);
 assert.ok(a.min.z>b.max.z+.01,'photo must not fight the physical door face');
 assert.ok(meshes(g,'projecting room portrait source').length);
 const feet=meshes(g,'pink sofa foot');assert.equal(feet.length,4);
 for(const foot of feet)assert.ok(Math.abs(new T.Box3().setFromObject(foot).min.y+.16)<.001,'sofa feet rest on ground');
});
test('2025 Jan 23 source census distinguishes trailers, buses and smaller vehicles',()=>{
 const root=createHistoricalScene(2025),rvs=root.children.filter(o=>/^rv-\d+$/.test(o.userData.assembly_id));
 assert.equal(rvs.filter(o=>meshes(o,'trailer shell').length).length,9);
 assert.equal(meshes(members(root,'rv-10'),'vehicle body').length,1);
 assert.equal(meshes(members(root,'observed-black-bus'),'vehicle body').length,1);
 assert.equal(root.children.filter(o=>/^observed-car-\d+$/.test(o.userData.assembly_id)).length,10);
});

test('2025 c538 Freeside has four landscape modules and distinct left window/right service hatch',()=>{
 const root=createHistoricalScene(2025),g=members(root,'kitchen');
 assert.equal(meshes(g,'solar panel').length,4);
 assert.equal(meshes(g,'photovoltaic cells').length,4);
 for(const p of meshes(g,'solar panel'))assert.ok(p.geometry.parameters.width>p.geometry.parameters.depth);
 assert.equal(meshes(g,'Freeside left glazed window').length,1);
 assert.equal(meshes(g,'Freeside service counter sill').length,1);
 assert.equal(meshes(g,'Freeside photographed black white door art').length,1);
 assert.equal(meshes(g,'stair tread').length,0,'c538 open center is at grade without invented exterior flight');
});

test('2025 Tool Camp has an open upper middle bay, equipped workshop and two observed hydroponic rigs',()=>{
 const root=createHistoricalScene(2025),tool=members(root,'secondary-house');
 const upper=meshes(tool,'plywood deck sheet').filter(m=>Math.abs(m.position.y-2.46)<.01);
 assert.equal(upper.length,6,'two side bays retain their original sheets');
 assert.ok(upper.every(m=>Math.abs(m.position.x)>=BAY/2),'central upper bay is open');
 assert.equal(meshes(tool,'Tool Camp miter saw blade').length,1);
 assert.equal(meshes(tool,'Tool Camp drill press column').length,1);
 assert.equal(meshes(tool,'Tool Camp stored table saw').length,1);
 assert.equal(meshes(tool,'Tool Camp white grow channel').length,4,'c554: four-tier white PVC rack');
 assert.equal(meshes(tool,'Tool Camp blue grow channel').length,6,'c554: three paired blue-channel tiers');
 assert.equal(meshes(tool,'Tool Camp upper pod doorway').length,1);
 const bus=members(root,'rv-10'),body=meshes(bus,'vehicle body')[0];assert.equal(body.material.color.getHexString(),'286b9a');
});

test('2025 Chiba front stair entry stays open and auditorium intermediate level is hollow',()=>{
 const root=createHistoricalScene(2025),g=members(root,'chiba');
 const beams=meshes(g,'12 foot orange beam').filter(m=>Math.abs(m.position.y-2.48)<.01&&Math.abs(m.position.x)<.1&&m.position.z>-BAY/2+.05);
 assert.equal(beams.length,0,'no mid-level bay beam cuts across the auditorium void');
 const sheets=meshes(g,'plywood deck sheet').filter(m=>Math.abs(m.position.y-2.48)<.01&&Math.abs(m.position.x)<BAY/2);
 assert.equal(sheets.length,0,'c72606: no upper floor crosses the central void, including north end');
 const treads=meshes(g,'upper flight open timber tread');
 const low=[-1,1].map(side=>treads.filter(m=>Math.sign(m.position.x)===side).sort((a,b)=>a.position.y-b.position.y)[0]);
 assert.equal(low.length,2);
 const entry=low[1].position.x-low[1].geometry.parameters.width/2-(low[0].position.x+low[0].geometry.parameters.width/2);
 assert.ok(entry>=.60,'shared entry has a usable gap between lowest flights');
 assert.equal(meshes(g,'stair rail').length,0,'generic rails do not enclose the shared entry');
 const shelf=meshes(g,'front roof ornament shelf')[0];assert.ok(shelf.position.y>5.5,'ornament rests on raised beam, not a low plank across access');
 const roof=meshes(g,'projecting enclosure roof')[0];assert.ok(roof&&roof.position.z>1.5*BAY,'under-stair enclosure projects from original wall');
 const platforms=meshes(g,'staggered rack stair platform');
 for(const m of platforms.filter(m=>m.position.y<2.4&&m.position.z<roof.position.z+1.1))assert.ok(m.position.x-m.geometry.parameters.width/2>.15,'lower flights pass east of enclosed room');
});

test('2025 c72596 east door is a real opening through cladding and photo surface',()=>{
 const root=createHistoricalScene(2025),g=members(root,'chiba');root.updateMatrixWorld(true);
 const facade=meshes(g).filter(m=>m.name==='Chiba east plywood facade photo'||(m.userData.kind==='plywood wall'&&Math.abs(m.position.x-1.5*BAY)<.1));
 const hit=(y,z)=>{const origin=g.localToWorld(new T.Vector3(1.5*BAY+.25,y,z));const dir=new T.Vector3(-1,0,0).transformDirection(g.matrixWorld);return new T.Raycaster(origin,dir,0,.6).intersectObjects(facade,false);};
 assert.equal(hit(1.4,-3.84).length,0,'Doorway must not be merely dark photo pixels on a solid wall');
 assert.ok(hit(1.4,-2.6).length>0,'Adjacent lower cladding remains enclosed');
 assert.ok(hit(3.4,-3.84).length>0,'Upper plywood remains above doorway');
});

test('2025 observed motor vehicles retain four grounded shared tires and class silhouettes',()=>{
 const root=createHistoricalScene(2025);root.updateMatrixWorld(true);const geometries=new Set();
 const fleet=root.children.filter(g=>g.children.some(o=>o.userData.kind==='vehicle body'));
 for(const g of fleet){
  const tires=meshes(g,'vehicle wheel');assert.equal(tires.length,4);
  for(const tire of tires){geometries.add(tire.geometry);tire.geometry.computeBoundingBox();const b=tire.geometry.boundingBox.clone().applyMatrix4(tire.matrix);assert.ok(Math.abs(b.min.y+.16)<.001);}
  assert.equal(meshes(g,'vehicle side glazing').length,2);
 }
 assert.equal(geometries.size,1);
});


test('2025 late occupied frontal terraces are deep and flights connect the shared room roof landing',()=>{
 const root=createHistoricalScene(2025),g=members(root,'chiba');
 const landing=meshes(g,'projecting enclosure roof')[0];
 assert.equal(landing.geometry.parameters.width,BAY);
 assert.equal(meshes(g,'front stair shared landing').length,0,'shared landing must not duplicate enclosure roof');
 const broad=meshes(g,'staggered rack stair platform');
 assert.ok(broad.every(m=>Math.abs(m.geometry.parameters.width-(BAY-.08))<.001),'source rack spans do not taper');
 const terraces=meshes(g,'upper side terrace tread');
 for(const side of [-1,1]){
  const decks=terraces.filter(m=>Math.sign(m.position.x)===side);
  assert.ok(decks.every(m=>m.geometry.parameters.depth===1.22));
  const lower=decks.find(m=>m.position.y===3.88),upper=decks.find(m=>m.position.y===4.4);
  assert.ok(Math.abs(lower.position.z-upper.position.z-1.22)<.001,'two contiguous deep levels meet main roof edge');
  assert.ok(Math.abs(upper.position.z-.61-1.5*BAY)<.001);
  const flight=meshes(g,'upper flight open timber tread').filter(m=>Math.sign(m.position.x)===side).sort((a,b)=>a.position.y-b.position.y);
  assert.equal(flight.length,side<0?4:6);
  assert.ok(flight[0].position.y-landing.position.y<.37);
  assert.ok(Math.abs(flight.at(-1).position.y-lower.position.y)<.001);
  assert.ok(Math.abs(flight.at(-1).position.x)+flight.at(-1).geometry.parameters.width/2>=BAY/2,'flight reaches side platform in plan');
 }
});

test('2025 late central entry is an actual opening in joined door infill, and notched boards support each upper tread',()=>{
 const root=createHistoricalScene(2025),g=members(root,'chiba');root.updateMatrixWorld(true);
 const wallKinds=['upper entrance reused door','upper entrance outer plywood infill','upper entrance continuous header'];
 const wall=meshes(g).filter(m=>wallKinds.includes(m.userData.kind));
 const through=(x,y)=>{const origin=g.localToWorld(new T.Vector3(x,y,1.5*BAY+.3));const dir=new T.Vector3(0,0,-1).transformDirection(g.matrixWorld);return new T.Raycaster(origin,dir,0,.7).intersectObjects(wall,false);};
 assert.equal(through(0,3.5).length,0,'dark entrance is open geometry, never a painted black plane');
 for(const x of [-1.65,-1,1,1.65])assert.ok(through(x,3.5).length>0,'door panels join the side infill');
 assert.ok(through(0,4.7).length>0,'continuous header joins the infill above the opening');
 const boards=meshes(g,'upper flight timber stringer');assert.equal(boards.length,4);
 for(const tread of meshes(g,'upper flight open timber tread')){
  const sameSide=boards.filter(m=>Math.sign(m.position.x)===Math.sign(tread.position.x));
  for(const board of sameSide){
   const origin=g.localToWorld(new T.Vector3(tread.position.x,tread.position.y+.3,board.position.z+.0325));
   const dir=new T.Vector3(0,-1,0).transformDirection(g.matrixWorld);
   const hit=new T.Raycaster(origin,dir,0,.7).intersectObject(board,false)[0];
   assert.ok(hit,'notched stringer runs underneath every tread');
   assert.ok(Math.abs(g.worldToLocal(hit.point).y-(tread.position.y-.0325))<.002,'stringer top contacts tread underside');
  }
 }
});


test('2025 central void reaches north wall and both upper side terraces have grounded rack end frames',()=>{
 const root=createHistoricalScene(2025),g=members(root,'chiba');
 const cross=meshes(g,'12 foot orange beam').filter(m=>Math.abs(m.position.x)<.1&&Math.abs(m.position.y-2.48)<.01&&m.position.z>-1.5*BAY+.05);
 assert.equal(cross.length,0,'no intermediate beams bridge the central void');
 const posts=meshes(g,'front terrace rack upright');assert.equal(posts.length,8);
 for(const side of [-1,1]){
  const sidePosts=posts.filter(m=>Math.sign(m.position.x)===side);assert.equal(sidePosts.length,4);
  assert.ok(sidePosts.every(m=>Math.abs(m.position.y-m.geometry.parameters.height/2)<.001&&m.position.y+m.geometry.parameters.height/2>4.91));
  const steps=meshes(g,'upper side terrace tread').filter(m=>Math.sign(m.position.x)===side);
  assert.ok(steps.every(m=>m.position.y>3.75&&m.position.y<4.91));
 }
 assert.equal(meshes(g,'front terrace end diagonal').length,8);
});

test('2025 occupied auditorium presenter is at the low end and furniture meets its gallery',()=>{
 const root=createHistoricalScene(2025),g=members(root,'chiba');root.updateMatrixWorld(true);
 const presenter=g.children.find(o=>o.userData.assembly_id==='presenter-station');assert.ok(presenter.position.z<0,'north low end, not high entrance');
 const classroom=members(root,'classroom');for(const m of meshes(classroom,'Upstairs pink sofa grounded foot'))assert.ok(Math.abs(m.position.y-m.geometry.parameters.height/2-2.4925)<.001);
 assert.equal(meshes(g,'Auditorium loose dark chair seat').length,3);
});
test('2025 Bodywork courtyard doorway is physically open and cloth sags below supports',()=>{
 const root=createHistoricalScene(2025),g=members(root,'bodywork-dojo');root.updateMatrixWorld(true);
 const ray=new T.Raycaster(g.localToWorld(new T.Vector3(-1.58*BAY,1.35,BAY+1)),new T.Vector3(0,0,-1).transformDirection(g.matrixWorld),0,1.5);
 const all=meshes(g).filter(o=>o.userData.kind==='plywood wall'||o.userData.kind==='Bodywork pale courtyard door');
 assert.equal(ray.intersectObjects(all,false).length,0,'door leaf and plywood must leave the entry clear');
 const cloth=meshes(g,'dojo ceiling fabric');assert.equal(cloth.length,2);for(const c of cloth){c.geometry.computeBoundingBox();assert.ok(c.geometry.boundingBox.min.y<-.30);assert.ok(c.geometry.boundingBox.max.y<.001);}
});
test('2025 Solar Sam canopy and bus have observed distinct structure and livery',()=>{
 const root=createHistoricalScene(2025),canopy=members(root,'solar-sam-scissor'),bus=members(root,'rv-10');
 assert.ok(canopy);assert.equal(meshes(canopy,'Scissor canopy primary timber post').length,8);
 assert.equal(meshes(canopy,'Scissor canopy actual red Chiba sign').length,1);
 assert.equal(meshes(bus,'Sam bus photographed white cab flank').length,2);assert.equal(meshes(bus,'Sam bus photographed yellow lower band').length,2);
 assert.equal(meshes(bus,'Sam bus rectangular mirror housing').length,2);
 for(const v of root.children.filter(o=>String(o.userData.assembly_id||'').startsWith('observed-car-')))assert.equal(meshes(v,'Vehicle side mirror housing').length,2,'mirror pass must run after vehicle creation');
});
test('2025 tapered pod edits do not mutate shared geometry or detach their curtain',()=>{
 const root=createHistoricalScene(2025),pods=members(root,'utility-booths'),sides=meshes(pods,'pod side wall'),doors=meshes(pods,'pod door');
 assert.equal(new Set(sides.map(m=>m.geometry)).size,6);
 for(const m of sides){const p=m.geometry.getAttribute('position');let min=Infinity,max=-Infinity;for(let i=0;i<p.count;i++)if(p.getY(i)>.9){min=Math.min(min,p.getX(i));max=Math.max(max,p.getX(i));}assert.ok(Math.abs(Math.abs((min+max)/2)-.45)<.001);}
 for(const m of doors){m.geometry.computeBoundingBox();assert.ok(Math.abs(m.geometry.boundingBox.min.x)<.001);assert.ok(Math.abs(m.geometry.boundingBox.max.x-.82)<.001);}
 assert.equal(meshes(pods,'Freeside first pod actual red patterned door curtain')[0].parent,doors[0]);
 const round=meshes(members(root,'kitchen'),'Freeside rear round glazing')[0];assert.ok(round.position.y>1.8,'later occupied picture places the round pane high');
 assert.equal(meshes(members(root,'kitchen'),'Freeside actual blue-edged pentagon roof painting').length,6);
});
