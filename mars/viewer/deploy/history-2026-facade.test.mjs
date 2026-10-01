import {test,after} from'node:test';import assert from'node:assert/strict';import fs from'node:fs/promises';import{build}from'esbuild';import * as T from'three';
const file=new URL(`../.facade-test-${process.pid}.mjs`,import.meta.url);await build({stdin:{contents:`export * from './app/history/details-2026-facade';`,resolveDir:new URL('..',import.meta.url).pathname,loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile:file.pathname,logLevel:'error'});T.TextureLoader.prototype.load=function(){return new T.Texture();};const{add2026FacadeDetails}=await import(file.href);after(()=>fs.unlink(file));
test('bounded west facade changes only outward finish, retaining ID, vertices, other faces and idempotency',()=>{
 const root=new T.Group(),chiba=new T.Group();chiba.name='Chiba';root.add(chiba);root.rotation.y=.2;
 const u=new T.Vector3(.9045,0,.4265).normalize(),v=new T.Vector3(.4265,0,-.9045).normalize(),origin=new T.Vector3(-8.47875,0,8.925);
 const wall=new T.Mesh(new T.BoxGeometry(.025,6.122027874-3.167496443,11.29201689-.136175644),new T.MeshStandardMaterial());wall.name='wood_component-0666';wall.userData.component_id=wall.name;wall.position.copy(origin).addScaledVector(u,-.033).addScaledVector(v,(.136175644+11.29201689)/2);wall.position.y=(3.167496443+6.122027874)/2;wall.rotation.y=-Math.atan2(.4265,.9045);chiba.add(wall);root.updateMatrixWorld(true);
 const before=wall.geometry.index?wall.geometry.toNonIndexed():wall.geometry;const positions=Array.from(before.attributes.position.array),oldMaterial=wall.material;
 assert.equal(add2026FacadeDetails(root)[0],wall);assert.equal(wall.userData.component_id,'wood_component-0666');assert.equal(wall.parent,chiba);assert.deepEqual(Array.from(wall.geometry.attributes.position.array),positions);assert.equal(wall.material[0],oldMaterial);
 assert.equal(wall.userData.review2026WestWall.faces,2);assert.ok(wall.geometry.groups.some(g=>g.materialIndex===0));
 for(const g of wall.geometry.groups.filter(g=>g.materialIndex===1))for(let i=g.start;i<g.start+g.count;i++){const uv=wall.geometry.attributes.uv;assert.ok(uv.getX(i)>-.002&&uv.getX(i)<1.002);assert.ok(uv.getY(i)>-.002&&uv.getY(i)<1.002);}
 const geom=wall.geometry;assert.deepEqual(add2026FacadeDetails(root),[]);assert.equal(wall.geometry,geom);
});
test('missing target never textures other campus walls',()=>{assert.deepEqual(add2026FacadeDetails(new T.Group()),[]);});
