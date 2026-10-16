import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {desertDustAt,DESERT_DUST_SEED,DUST_CYCLE_MS,DUST_TRANSITION_MS,parseDustOverride} from '../src/atmosphere/desert-dust.ts';
import {hash01} from '../src/atmosphere/weather.ts';
import {createWorldAtmosphere} from '../src/WorldAtmosphere.ts';
import {DUST,MIST} from '../src/atmosphere/chunks.ts';

const HOUR=3_600_000,shift=hash01(DESERT_DUST_SEED,91)*DUST_CYCLE_MS;
const atPhase=(hours:number,cycle=5000)=>cycle*DUST_CYCLE_MS-shift+hours*HOUR;
const clock=(ms:number)=>new Date(ms).toISOString().slice(0,23);

test('desert has 90/8/2 time shares across full cycles, including episode ramps',()=>{
 const counts={clear:0,faint:0,heavy:0};
 for(let i=0;i<60_000;i++){const a=desertDustAt(i*60_000),b=desertDustAt(i*60_000);counts[a.kind]++;assert.deepEqual(a,b);}
 assert.deepEqual(counts,{clear:54000,faint:4800,heavy:1200});
 assert.equal(desertDustAt(atPhase(4)).kind,'faint');assert.equal(desertDustAt(atPhase(49)).kind,'heavy');
 assert.equal(desertDustAt(atPhase(20)).intensity,0);
 for(let cycle=4000;cycle<4100;cycle++){
  const faint=desertDustAt(atPhase(4,cycle)).intensity,heavy=desertDustAt(atPhase(49,cycle)).intensity;
  assert.ok(faint>=.02&&faint<=.05);assert.ok(heavy>=.3&&heavy<=.5);
 }
});

test('episodes have smooth world-clock arrivals/departures and repeat on rewind',()=>{
 for(const [hour,ramp] of [[0,DUST_TRANSITION_MS.faint],[48,DUST_TRANSITION_MS.heavy]] as const){
  const begin=atPhase(hour),end=atPhase(hour+(hour===0?8:2));
  assert.ok(desertDustAt(begin).intensity<1e-10);assert.ok(desertDustAt(end).intensity<1e-10);
  const middle=desertDustAt(begin+ramp),half=desertDustAt(begin+ramp/2);
  assert.ok(Math.abs(half.intensity-middle.intensity*.5)<1e-9);
  assert.ok(Math.abs(desertDustAt(end-ramp/2).intensity-half.intensity)<1e-9);
  assert.ok(Math.abs(desertDustAt(begin+ramp+1).intensity-middle.intensity)<1e-5);
  const first=desertDustAt(begin+ramp/2);desertDustAt(end+100*HOUR);
  assert.deepEqual(desertDustAt(begin+ramp/2),first);
 }
 assert.ok(Number.isFinite(desertDustAt(NaN).intensity));
});

test('dust review overrides are explicit and do not alter scheduled samples',()=>{
 assert.equal(parseDustOverride('?dust=heavy'),'heavy');assert.equal(parseDustOverride('?dust=auto'),null);
 assert.equal(parseDustOverride('?dust=rain'),null);
 assert.equal(desertDustAt(0,DESERT_DUST_SEED,'heavy').intensity,.4);
 assert.equal(desertDustAt(0,DESERT_DUST_SEED,'faint').intensity,.035);
 assert.equal(desertDustAt(0,DESERT_DUST_SEED,'clear').intensity,0);
 assert.notDeepEqual(desertDustAt(atPhase(4),DESERT_DUST_SEED),desertDustAt(atPhase(4),123));
});

function setup(palette='mars-desert'){
 const scene=new THREE.Scene();scene.background=new THREE.Color('#78b2d5');
 const root=new THREE.Group();root.userData.edenSkyPalette=palette;scene.add(root);
 const sun=new THREE.DirectionalLight('#fff5dd',2);sun.castShadow=true;scene.add(sun,sun.target,new THREE.HemisphereLight('#ffffff','#888888',1));
 const camera=new THREE.PerspectiveCamera(50,1,.1,600);camera.position.set(0,2,10);camera.updateMatrixWorld();
 const atmosphere=createWorldAtmosphere(scene);
 const update=(hours:number,seconds:number,indoors=false,reducedMotion=false)=>atmosphere.update({seconds,dt:1/60,daylight:1,camera,eden:true,profile:'world',reducedMotion,clock:clock(atPhase(hours)),indoors:()=>indoors});
 return {scene,sun,camera,atmosphere,update};
}

test('opted-in world gets dust and dry clear skies with no Eden fauna; reloads agree',()=>{
 const a=setup();a.update(49,0);const first=a.atmosphere.inspect();
 assert.equal(first.dust?.kind,'heavy');assert.ok(first.dust!.intensity>=.3);
 assert.deepEqual({...first.state,wind:0},{cloud:0,rain:0,wind:0,fog:0,mist:0,wet:0});
 assert.ok(DUST.value.x>=.3);assert.ok(a.sun.intensity<2);assert.equal(MIST.value.x,0);
 const decor=a.scene.children.find(o=>o.name.startsWith('atmosphere'))!;
 assert.equal(decor.children.find(o=>/birds|fauna/.test(o.name))?.visible??false,false);
 const b=setup();b.update(49,1234);assert.deepEqual(b.atmosphere.inspect().dust,first.dust);
 a.update(20,1500);assert.equal(a.atmosphere.inspect().dust?.intensity,0);assert.equal(DUST.value.x,0);
 assert.equal(a.sun.intensity,2);a.atmosphere.dispose();b.atmosphere.dispose();
});

test('dust suppresses interiors/maps and particles for reduced motion; disposal restores shared uniforms',()=>{
 const a=setup();a.update(49,0);const outside=DUST.value.x;
 a.update(49,2,true);assert.ok(DUST.value.x<outside*.1);
 a.update(49,3,false,true);
 const decor=a.scene.children.find(o=>o.name.startsWith('atmosphere'))!;
 assert.equal(decor.children.find(o=>o.name==='atmosphere: rain')?.visible,false);
 const map=new THREE.OrthographicCamera(-50,50,50,-50,.1,600);map.position.y=100;map.updateMatrixWorld();
 a.scene.onBeforeRender(null as never,a.scene,map,null as never,null as never,null as never);assert.equal(DUST.value.x,0);
 a.atmosphere.dispose();assert.equal(DUST.value.x,0);assert.equal(a.scene.fog,null);assert.equal(a.sun.intensity,2);
});

test('ordinary worlds retain existing atmosphere; explicit owner weather takes precedence',()=>{
 const a=setup('clear-day');a.update(49,0);assert.equal(a.atmosphere.inspect().dust,null);assert.equal(DUST.value.x,0);a.atmosphere.dispose();
 const b=setup();b.atmosphere.update({seconds:0,dt:1/60,daylight:1,camera:b.camera,eden:true,profile:'world',reducedMotion:false,clock:clock(atPhase(49)),weather:{kind:'clear',clouds:0,rain:0,wind:0,fog:0,intensity:1}});
 assert.equal(b.atmosphere.inspect().dust?.intensity,0);assert.equal(DUST.value.x,0);assert.equal(b.atmosphere.inspect().state.mist,0);b.atmosphere.dispose();
});
