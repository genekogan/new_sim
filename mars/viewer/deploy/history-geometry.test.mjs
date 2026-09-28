import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import * as T from 'three';
const file=new URL(`../.history-test-${process.pid}.mjs`,import.meta.url);
await build({entryPoints:['app/history/scenes.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:file.pathname});
T.TextureLoader.prototype.load=function(){return new T.Texture();};
// oxlint-disable-next-line typescript/no-deprecated -- offline scene construction; no renderer
 globalThis.document={createElement:()=>({width:1,height:1,getContext:()=>new Proxy({}, {get:(_t,key)=>key==='createRadialGradient'?()=>({addColorStop(){}}):()=>{}})})};
const {createHistoricalScene}=await import(file.href);
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
