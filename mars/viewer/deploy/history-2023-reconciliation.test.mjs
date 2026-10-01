import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import * as T from 'three';
const file=new URL(`../.history-2023-reconciliation-${process.pid}.mjs`,import.meta.url);
await build({stdin:{contents:`export {make2023} from './app/history/year-2023';export {Kit,BAY} from './app/history/kit';export * from './app/history/details-2023-reconciliation';`,resolveDir:new URL('..',import.meta.url).pathname,loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile:file.pathname,logLevel:'error'});
T.TextureLoader.prototype.load=function(url){const t=new T.Texture();t.userData.sourceUrl=url;return t;};
// oxlint-disable-next-line typescript/no-deprecated -- offline Three texture fixture, no browser
globalThis.document={createElement:()=>({width:1,height:1,getContext:()=>new Proxy({}, {get:(_t,key)=>key==='createRadialGradient'?()=>({addColorStop(){}}):()=>{}})})};
const {Kit,BAY,make2023,add2023RotapolisKitchen}=await import(file.href);after(()=>fs.unlink(file));
const meshes=(g,name)=>{const a=[];g.traverse(o=>{if(o.isMesh&&(!name||o.name===name)){let visible=true;for(let q=o;q;q=q.parent)if(!q.visible)visible=false;if(visible)a.push(o);}});return a;};
const asm=(r,id)=>{let a;r.traverse(o=>{if(o.userData.assembly_id===id&&!o.userData.layer)a??=o;});return a;};
const combined=()=>{const k=new Kit(2023);make2023(k);return k.finalize();};

test('2023 occupied Rotapolis doorway cuts all end-wall triangles and retains adjacent enclosure',()=>{
 const k=new Kit(2023),g=k.assembly('kitchen-interior','test source kitchen');add2023RotapolisKitchen(k,g,4.572);const root=k.finalize();root.updateMatrixWorld(true);
 const infill=meshes(g).filter(m=>m.name.includes('infill')||m.name.includes('header'));
 const hit=(z,y)=>new T.Raycaster(new T.Vector3(BAY/2+.3,y,z),new T.Vector3(-1,0,0),0,.5).intersectObjects(infill,false);
 assert.equal(hit(-.55,1.3).length,0,'real door aperture, not dark pixels');
 const leaf=meshes(g).filter(m=>m.name.startsWith('2023 Rotapolis white door'));
 assert.equal(new T.Raycaster(new T.Vector3(BAY/2+1,1.3,-.55),new T.Vector3(-1,0,0),0,1.2).intersectObjects(leaf,false).length,0,'held-open leaf leaves the middle of the entry clear');
 assert.ok(hit(-1.75,1.3).length>0&&hit(1.2,1.3).length>0,'joined lower side cladding');
 assert.ok(hit(-.55,2.3).length>0,'joined header above opening');
 assert.equal(meshes(g,'2023 Rotapolis red refrigerator').length,1);
 assert.equal(meshes(g,'2023 Rotapolis black chest freezer').length,1);
 assert.equal(meshes(g,'white refrigerator').length,0,'source has undercounter red fridge and black chest freezer');
 assert.equal(meshes(g,'2023 Rotapolis stove burner').length,2);
 const fridge=meshes(g,'2023 Rotapolis red refrigerator')[0],freezer=meshes(g,'2023 Rotapolis black chest freezer')[0];
 for(const m of [fridge,freezer])assert.ok(Math.abs(new T.Box3().setFromObject(m).min.y-.2525)<1e-6,'rigid equipment meets plywood floor');
});

test('2023 fleet retains source census and distinct slideout while mirrors remain outside cabin bodies',()=>{
 const r=combined(),fleet=r.children.filter(g=>g.children.some(o=>o.name==='vehicle body'));assert.equal(fleet.length,18);
 for(const g of fleet){const body=g.children.find(o=>o.name==='vehicle body');
  for(const s of [-1,1]){const mirror=meshes(g,`2023 mirror housing ${s}`)[0];assert.ok(mirror,`${g.userData.assembly_id} mirror`);
   assert.ok(Math.abs(mirror.position.x)-mirror.geometry.parameters.width/2>body.geometry.parameters.width/2,'housing projects outside body without clipping');}
  assert.equal(meshes(g,'motor vehicle tire').length,4);
 }
 assert.equal(r.children.filter(g=>/^rv-[1-5]$/.test(g.userData.assembly_id)).length,5);
 assert.ok(!r.children.some(g=>/^rv-(?:[6-9]|1[0-6])$/.test(g.userData.assembly_id)),'retired invented trailers stay absent');
 const slide=meshes(asm(r,'rv-1'),'2023 slideout body')[0];assert.ok(slide.position.x<-1.175&&slide.geometry.parameters.width>.5);
 assert.equal(meshes(asm(r,'rv-5'),'2023 Mesa Ridge dark front').length,1);
});

test('2023 rooms contain photographed equipment and added IDs are unique across actual combined hierarchy',()=>{
 const r=combined(),ids=meshes(r).map(m=>m.userData.component_id);assert.equal(new Set(ids).size,ids.length);assert.ok(ids.every(Boolean));
 const media=asm(r,'media-cave'),classroom=asm(r,'2023-classroom-detail');
 assert.equal(meshes(media).filter(m=>m.name.startsWith('2023 media speaker ')&&!m.name.includes('tripod')).length,2);
 assert.equal(meshes(media,'2023 media hanging projector').length,1);
 assert.equal(meshes(classroom,'2023 classroom white board').length,1);
 assert.equal(meshes(classroom).filter(m=>m.name.includes('ladder back')).length,12);
 const table=meshes(classroom,'2023 classroom table white tabletop')[0];
 for(const chair of meshes(classroom).filter(m=>m.name.includes('upholstered seat'))){assert.ok(!new T.Box3().setFromObject(table).intersectsBox(new T.Box3().setFromObject(chair)),'chairs do not intersect worktop');}
});

test('2023 occupied lower auditorium remains hollow beneath middle landing and has supported continuous tiers',()=>{
 const r=combined(),g=asm(r,'chiba');r.updateMatrixWorld(true);
 const flat=meshes(g,'plywood deck sheet').filter(m=>Math.abs(m.position.y-2.46)<.01&&Math.abs(m.position.x)<BAY/2);
 assert.equal(flat.length,3,'old three component transforms retained');
 for(const m of flat){m.geometry.computeBoundingBox();assert.ok(m.geometry.boundingBox.getSize(new T.Vector3()).z<.5,'middle slab cut to front landing');}
 const hit=new T.Raycaster(new T.Vector3(0,2.40,0),new T.Vector3(0,1,0),0,.15).intersectObjects(flat,false);assert.equal(hit.length,0,'no hidden triangles through auditorium volume');
 const tiers=meshes(g,'2023 lower auditorium plywood tier').sort((a,b)=>a.position.z-b.position.z);assert.equal(tiers.length,7);
 assert.ok(tiers[0].position.y<.6&&Math.abs(tiers.at(-1).position.y-2.46)<.001,'ground-to-middle audience, separate from upper stair');
 for(let i=1;i<tiers.length;i++)assert.ok(Math.abs(tiers[i].position.z-tiers[i-1].position.z-tiers[i].geometry.parameters.depth)<.02,'no large holes between broad seats');
 const beamHits=[];g.traverse(o=>{if(o.visible&&o.name==='12 foot orange beam'){const p=g.worldToLocal(o.getWorldPosition(new T.Vector3()));if(Math.abs(p.x)<.01&&Math.abs(p.y-2.48)<.01)beamHits.push(o);}});assert.equal(beamHits.length,0,'anonymous nested frame beams cannot cross hollow auditorium');
});

test('2023 Chatsubo longitudinal art partition has real doorway beside the forward ant panel',()=>{
 const r=combined(),bar=asm(r,'chatsubo');r.updateMatrixWorld(true);
 const walls=meshes(bar).filter(m=>m.name.includes('partition')||m.name.includes('lintel'));
 const ray=new T.Raycaster(bar.localToWorld(new T.Vector3(BAY/2+.2,1.35,.57)),new T.Vector3(-1,0,0),0,.4);
 assert.equal(ray.intersectObjects(walls,false).length,0,'bar opening is physically passable');
 const ant=meshes(asm(r,'chiba'),'plywood wall').find(m=>m.material.map?.userData.sourceUrl?.includes('ant-mural'));assert.ok(ant.position.z>2,'March29 ant panel is forward of swirl doorway');
 assert.equal(meshes(bar,'2023 bar actual landscape counter face').length,1);
});

test('2023 untouched1497 original owners survive and source-quarantined proxy triangles stay invisible',async()=>{
 const originals=JSON.parse(await fs.readFile(new URL('./history-2023-original-owner-ids.json',import.meta.url),'utf8'));
 const r=combined(),all=new Map();r.traverse(o=>{if(o.userData.component_id){assert.ok(!all.has(o.userData.component_id),'no duplicated owner IDs, including invisible hierarchy');all.set(o.userData.component_id,o);}});
 assert.equal(originals.length,1497);for(const id of originals)assert.ok(all.has(id),`${id} retained`);
 const oldFridge=[...all.values()].find(o=>o.name==='white refrigerator');assert.ok(oldFridge&&!oldFridge.visible&&oldFridge.userData.walkNoCollision,'old refrigerator quarantined, not silently rebound');
 const flat=meshes(asm(r,'chiba'),'plywood deck sheet').filter(m=>Math.abs(m.position.y-2.46)<.01&&Math.abs(m.position.x)<BAY/2);assert.ok(flat.every(m=>originals.includes(m.userData.component_id)),'corrected cloned landing sheets keep original owner IDs');
});

test('2023 added PV worktables and portable toilets stand on Studio soil rather than hovering',()=>{
 const r=combined(),power=asm(r,'2023-pv-work-aisle'),toilets=asm(r,'2023-blue-portable-toilets');r.updateMatrixWorld(true);
 for(const g of [power,toilets])for(const m of meshes(g).filter(m=>m.name.includes('tool bench leg')||m.name.includes('battery box')||m.name.includes('toilet blue body'))){assert.ok(Math.abs(new T.Box3().setFromObject(m).min.y+.16)<.001,`${m.name} grounded`);}
 const geometries=new Set();for(const fleet of r.children.filter(g=>g.children.some(o=>o.name==='vehicle body')))for(const tire of meshes(fleet,'motor vehicle tire')){geometries.add(tire.geometry);assert.ok(Math.abs(new T.Box3().setFromObject(tire).min.y+.16)<.001,'vehicle tires meet soil');}assert.equal(geometries.size,2,'all motor tires share only two observed class sizes');
});

test('2023 source round shelter windows contact actual faceted cover triangles',()=>{
 const r=combined(),g=asm(r,'2023-white-faceted-shelter'),cover=meshes(g,'2023 faceted white shelter cover')[0];r.updateMatrixWorld(true);
 const windows=meshes(g,'2023 shelter round window');assert.equal(windows.length,2);
 for(const pane of windows){const normal=new T.Vector3(0,0,1).applyQuaternion(pane.getWorldQuaternion(new T.Quaternion()));const p=pane.getWorldPosition(new T.Vector3());const h=new T.Raycaster(p.clone().addScaledVector(normal,.1),normal.clone().negate(),0,.15).intersectObject(cover,false)[0];assert.ok(h&&Math.abs(h.distance-.107)<.002,'round pane is flush7mm off actual triangle, not nominal sphere');}
});


test('2023 fitted parking leaves the real kitchen entry and trailer corners clear',()=>{
 const r=combined();r.updateMatrixWorld(true);
 const van=new T.Box3().setFromObject(asm(r,'census-v08'));
 const door=meshes(asm(r,'kitchen-interior')).filter(m=>m.name.startsWith('2023 Rotapolis white door'));
 const sweep=new T.Box3();for(const leaf of door)sweep.union(new T.Box3().setFromObject(leaf));
 assert.ok(van.min.x-sweep.max.x>.6,'held-open leaf has practical exterior clearance');
 const trailers=[1,2,3,4,5].map(n=>new T.Box3().setFromObject(asm(r,`rv-${n}`)));
 for(let a=0;a<5;a++)for(let b=a+1;b<5;b++)assert.ok(!trailers[a].intersectsBox(trailers[b]),`trailers ${a+1}/${b+1} do not touch`);
});


test('2023 fitted chest freezer clears every actual retained rack beam at its whole footprint',()=>{
 const r=combined();r.updateMatrixWorld(true);const freezer=meshes(asm(r,'kitchen-interior'),'2023 Rotapolis black chest freezer')[0];
 const b=new T.Box3().setFromObject(freezer);assert.ok(Math.abs(b.min.y-.2525)<1e-6);
 for(const beam of meshes(r,'12 foot orange beam'))assert.ok(!b.intersectsBox(new T.Box3().setFromObject(beam)),beam.userData.component_id);
 const lid=meshes(asm(r,'kitchen-interior'),'2023 Rotapolis black chest freezer lid')[0];assert.equal(lid.position.z,freezer.position.z);
});
