import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createEdenDaylight,visualDaylight,leafSpell,TWILIGHT_WORLD_HOURS} from './atmosphere/visual-transitions.ts';
import {sunTimes,parseLocalDateTime} from '../../../mars/viewer/engine/env/sun.ts';
import {Rain,LEAVES} from './atmosphere/rain.ts';
import {createConnectedNativeShore} from '../../../mars/viewer/app/engine-view/content/environment/connected-native-shore.ts';
import {EDEN_WATER_DAYLIGHT} from '../../../mars/viewer/app/engine-view/content/environment/eden-water-readability/daylight.ts';
import {shoreBankEdgePositions} from './WorldShoreBankEdges.ts';
// Exact normalized public ground fixture SHA0a1ee95b2a7770996e6c098c048bb8b1b03fbbb69acc4ab18c4e2941f474441e.
const row=[-3.5,-3.5,-3.5,-3.5,-3.5,-3.5,-3.5,-3.5,-3.5,-3.5,-3.5,-3.5,-3.2,-2.9,-2.6,-2.3,-2,-1.87,-1.74,-1.6099999999999999,-1.48,-1.35,-1.22,-1.0899999999999999,-0.96,-0.8300000000000001,-0.7,-0.5700000000000001,-0.43999999999999995,-0.31000000000000005,-0.17999999999999994,-0.050000000000000044,0,0,0];
const metadata={terrain:{id:'commons-shore-terrain/1',diagonal:'min-min/max-max' as const,originXZ:[-62,-12],spacingMetres:1,columns:35,rows:25,heightMetres:Array.from({length:25},()=>[...row])},water:{id:'commons-shore-water/1',datumY:-2,wetBoundsXZ:[-62,-12,-46,12]}};
void test('actual captured native water stays at datum, opt-in day response and two-sided multiangle surface',()=>{
 const o=createConnectedNativeShore(metadata.terrain,metadata.water);o.group.updateMatrixWorld(true);
 const mesh=o.group.getObjectByName(metadata.water.id) as THREE.Mesh<THREE.BufferGeometry,THREE.ShaderMaterial>;
 assert.ok(mesh);assert.equal(mesh.material.side,THREE.DoubleSide);assert.equal(mesh.material.forceSinglePass,true);
 assert.equal(mesh.material.uniforms.uDaylight,EDEN_WATER_DAYLIGHT);
 const a=mesh.geometry.getAttribute('position'),v=new THREE.Vector3();for(let i=0;i<a.count;i++){v.fromBufferAttribute(a,i).applyMatrix4(mesh.matrixWorld);assert.equal(v.y,metadata.water.datumY);}
 let hits=0;for(const [origin,dir]of [[[ -54,4,0],[0,-1,0]],[[-54,-4,0],[0,1,0]]] as const){const ray=new THREE.Raycaster(new THREE.Vector3(...origin),new THREE.Vector3(...dir));assert.equal(ray.intersectObject(mesh).length>0,true);hits++;}assert.equal(hits,2);
 assert.match(mesh.material.fragmentShader,/colour\*=mix/);assert.equal(mesh.geometry.index?.count,6);o.dispose();o.dispose();
});
void test('bank edge closure matches captured triangles and backdrop, leaves west lake connection open',()=>{
 const p=shoreBankEdgePositions(metadata.terrain,-.02);assert.ok(p.length>0);
 for(let i=0;i<p.length;i+=3){assert.ok(p[i+2]===-12||p[i+2]===12);assert.ok(p[i]>=-62&&p[i]<=-28);assert.ok(p[i+1]<=0);}
 assert.ok(p.includes(-3.5));assert.ok(p.includes(-.02));
 // Original heightfield at north/south wet edge is 1.5m BELOW exact water -2.
 assert.equal(metadata.terrain.heightMetres[0][0],-3.5);assert.equal(metadata.water.datumY,-2);
});
void test('Eden ramps span 2.5 world hours, remain smooth at midpoint/endpoints, cache seek is deterministic',()=>{
 assert.equal(TWILIGHT_WORLD_HOURS,2.5);assert.equal(visualDaylight(4.75,6,18),0);assert.equal(visualDaylight(7.25,6,18),1);
 assert.equal(visualDaylight(6,6,18),.5);assert.equal(visualDaylight(18,6,18),.5);
 for(const h of [4.75,6,7.25,16.75,18,19.25])assert.ok(Math.abs(visualDaylight(h+1e-6,6,18)-visualDaylight(h-1e-6,6,18))<2e-6);
 const f=createEdenDaylight(),old={daylight:.3,warmth:.2,blueHour:.1};const noon=f('2026-10-09T12:00:00',old);assert.equal(noon.daylight,1);
 const t=sunTimes('2026-10-09T12:00');const rise=parseLocalDateTime(t.sunriseLocal!);assert.ok(Math.abs(f(t.sunriseLocal!,old).daylight-.5)<1e-12);
 assert.equal(f('2026-10-09T00:00:00',old).daylight,0);f('2026-03-01T12:00',old);assert.deepEqual(f('2026-10-09T12:00:00',old),noon);assert.ok(rise.hour>0);
});
void test('one-third fewer leaves, smooth seeded light/heavy spells, rain/motes capacity unchanged',()=>{
 assert.equal(LEAVES,280);const xs=Array.from({length:230},(_,i)=>leafSpell(i,.8));assert.ok(Math.max(...xs)-Math.min(...xs)>.35);
 for(let i=0;i<230;i++){assert.equal(leafSpell(i,.8),xs[i]);assert.ok(xs[i]>=.18&&xs[i]<=1);assert.ok(Math.abs(leafSpell(i+1e-6,.8)-leafSpell(i-1e-6,.8))<1e-5);}
 const rain=new Rain();rain.update2(50,0,1,1,new THREE.PerspectiveCamera(),1,0,1);assert.equal(rain.lines.geometry.drawRange.count,280*6);
 assert.equal(rain.uniforms.uRain.value.w,leafSpell(50,1));rain.update2(50,0,0,1,new THREE.PerspectiveCamera(),1,0,0);assert.equal(rain.lines.visible,false);rain.dispose();
});
void test('actual Daylight Eden opt-in resets same-clock cache and smooth hemi tint, legacy solar factor retained',async()=>{
 const {Daylight}=await import('./WorldGeometry.ts');const {solarPosition}=await import('../../../mars/viewer/engine/env/sun.ts');const {daylightFactors}=await import('../../../mars/viewer/engine/env/daylight.ts');
 const scene=new THREE.Scene(),d=new Daylight(scene);const stamp=sunTimes('2026-10-09T12:00').sunriseLocal!;
 d.update(stamp);assert.equal(d.daylight,daylightFactors(solarPosition(stamp).elevationDeg).daylight);
 d.setNightLighting(true);d.update(stamp);assert.ok(Math.abs(d.daylight!-.5)<1e-12);
 const hemi=scene.children.find(o=>o instanceof THREE.HemisphereLight) as THREE.HemisphereLight;
 const before=hemi.color.clone();const t=parseLocalDateTime(stamp);const sec=(t.hour*3600+t.minute*60+t.second)+.01;
 d.update(stamp.slice(0,11)+`${Math.floor(sec/3600).toString().padStart(2,'0')}:${Math.floor(sec/60)%60<10?'0':''}${Math.floor(sec/60)%60}:${(sec%60).toFixed(2).padStart(5,'0')}`);
 assert.ok(Math.hypot(before.r-hemi.color.r,before.g-hemi.color.g,before.b-hemi.color.b)<.0001);d.setNightLighting(false);d.update(stamp);assert.equal(d.daylight,daylightFactors(solarPosition(stamp).elevationDeg).daylight);d.dispose();
});
