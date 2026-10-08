import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { paintNightMap, NIGHT_MAP_BOUNDS, setNightLightStrength, nightLightStrength, nightSource, collectNightSources, installNightLighting, paintNightSources } from '../src/WorldNightLights.ts';

const at=(data:Uint8Array,w:number,h:number,x:number,z:number)=>{const {x0,z0,x1,z1}=NIGHT_MAP_BOUNDS,i=Math.floor((x-x0)/(x1-x0)*w),j=Math.floor((z-z0)/(z1-z0)*h),k=(j*w+i)*4;return data[k]+data[k+1]+data[k+2];};

test('light map: a pool peaks under its lamp and fades to dark away from it', () => {
  const t=paintNightMap([{x:40,z:10,radius:3.4,intensity:1.35,color:'#ffc27a',halo:10}],[]),{width:w,height:h,data}=t.image as {width:number;height:number;data:Uint8Array};
  const peak=at(data,w,h,40,10),near=at(data,w,h,44,10),far=at(data,w,h,70,10);
  assert.ok(peak>near&&near>far,`${peak}>${near}>${far}`);assert.equal(far,0);
});

test('light map: clustered lamps add up into brighter shared light (soft-saturated, never clipped hard)', () => {
  const one=paintNightMap([{x:40,z:10,radius:3.4,intensity:1.35,color:'#ffffff',halo:10}],[]),many=paintNightMap([0,1,2,3].map(i=>({x:36+i*3,z:10,radius:3.4,intensity:1.35,color:'#ffffff',halo:10})),[]);
  const g=(t:typeof one)=>at((t.image as any).data,(t.image as any).width,(t.image as any).height,42,16);
  assert.ok(g(many)>g(one));assert.ok(g(many)<765);
});

test('strength follows the sun: zero in daylight, full at night', () => {
  setNightLightStrength(1);assert.equal(nightLightStrength(),0);
  setNightLightStrength(0);assert.ok(nightLightStrength()>.9);
  setNightLightStrength(null);assert.equal(nightLightStrength(),0);
});

test('light kinds: lamps match the residential reference, park lamps and lanterns are smaller and softer', () => {
  const lamp=nightSource(10,0,10,'lamp')!,park=nightSource(10,0,10,'park-lamp')!,lantern=nightSource(10,0,10,'lantern')!;
  assert.deepEqual([lamp.radius,lamp.intensity,lamp.halo],[3.4,1.35,10]);
  assert.ok(park.radius<lamp.radius&&park.intensity<lamp.intensity&&park.halo!<lamp.halo!);
  assert.ok(lantern.radius<park.radius&&lantern.intensity<park.intensity);
  assert.equal(nightSource(10,0,10,'disco'),null);assert.equal(nightSource(NaN,0,10,'lamp'),null);
});

test('published anchors are collected in world space and repaint the installed (shared) map', () => {
  const root=new THREE.Group(),child=new THREE.Group();child.position.set(100,5,-50);child.userData.edenLightSources=[[2,0,3,'lamp'],[0,0,0,'fire',.8],[1,1,1,'nope']];root.add(child);
  const found=collectNightSources(root);
  assert.equal(found.length,2);assert.deepEqual([found[0].x,found[0].base,found[0].z],[102,5,-47]);
  installNightLighting();const tex=THREE.ShaderLib.standard.uniforms.uEdenNightMap.value as THREE.DataTexture;
  assert.equal(tex.clone(),tex,'uniform cloning must share the map so a repaint reaches every material');
  const v0=tex.version,n=paintNightSources(found),{width:w,height:h,data}=tex.image as {width:number;height:number;data:Uint8Array};
  assert.ok(n>found.length);assert.ok(tex.version>v0);
  assert.ok(at(data,w,h,102,-47)>200,'pool under the region lamp');
  // Alpha carries the ground height under the light (5 m here), so pools hug raised ground.
  const {x0,z0,x1,z1}=NIGHT_MAP_BOUNDS,k=(Math.floor((-47-z0)/(z1-z0)*h)*w+Math.floor((102-x0)/(x1-x0)*w))*4;
  assert.ok(Math.abs(data[k+3]/255*100-10-5)<.6,'base '+(data[k+3]/255*100-10));
});
