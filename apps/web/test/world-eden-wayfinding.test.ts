import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {FINGERPOSTS,WAYPOINTS,WHATS_ON,BOARD,wayfindingParts,createEdenWayfinding} from '../../../mars/viewer/app/engine-view/content/assets/eden-wayfinding/index.ts';
const places:{id:string;parent:string|null;polygon:[number,number][];schedule?:{cron:string;label:string}[]}[]=JSON.parse(readFileSync(new URL('../../../worlds/eden/places.v1.json',import.meta.url),'utf8')).places;
const PLACE_OF:Record<string,string>={'Fire circle':'social-eden-fire-circle','Long table':'social-eden-dining','Classroom':'eden-classroom-1','Pond':'shore-water','Pond bank':'shore-bank','Stage':'commons-deck','Sleeping mats':'field','Stone garden':'eden-stone-garden','Bandstand':'eden-bandstand','Kiosks':'eden-market-kiosks','North woods':'eden-north-woods','Gardens':'eden-gardens','Market hall':'eden-market-1','Tea house':'eden-tea-house','Dome':'eden-dome','Amphitheatre':'eden-amphitheatre'};
const inside=([x,z]:readonly [number,number],poly:[number,number][])=>{let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const [xi,zi]=poly[i],[xj,zj]=poly[j];if((zi>z)!==(zj>z)&&x<(xj-xi)*(z-zi)/(zj-zi)+xi)c=!c;}return c;};
test('the board lists exactly the daily happenings at walkable places', () => {
  const expected=new Set<string>();
  for(const [name,id] of Object.entries(PLACE_OF))for(const s of places.find(p=>p.id===id)?.schedule??[]){const [m,h]=s.cron.split(' ');expected.add(`${h.padStart(2,'0')}:${m.padStart(2,'0')} ${name}`);}
  assert.deepEqual(new Set(WHATS_ON.map(([t,,where])=>`${t} ${where}`)),expected);
});
test('every finger names a real place and points at it', () => {
  for(const post of FINGERPOSTS)for(const name of post.to){assert.ok(WAYPOINTS[name],name);if(PLACE_OF[name]&&name!=='Sleeping mats'){const p=places.find(q=>q.id===PLACE_OF[name])!;const [x0,z0]=WAYPOINTS[name];const xs=p.polygon.map(v=>v[0]),zs=p.polygon.map(v=>v[1]);assert.ok(x0>=Math.min(...xs)-2&&x0<=Math.max(...xs)+2&&z0>=Math.min(...zs)-2&&z0<=Math.max(...zs)+2,name+' waypoint at its place');}}
  const built=wayfindingParts(()=>0)!;assert.equal(built.fingers,FINGERPOSTS.reduce((n,p)=>n+p.to.length,0));
});
test('posts and the board stand on open commons ground, never inside a walk target', () => {
  const field=places.find(p=>p.id==='field')!,targets=places.filter(p=>p.parent==='field'||p.id==='shore-bank'||p.id==='shore-water'||p.id==='eden-classroom-1');
  for(const at of [...FINGERPOSTS.map(p=>p.at),BOARD.at]){
    assert.ok(inside(at,field.polygon)||inside(at,places.find(p=>p.id==='eden-east')!.polygon),`${at} on commons/east ground`);
    for(const t of targets)assert.ok(!inside(at,t.polygon),`${at} inside ${t.id}`);
  }
});
test('scenery budget: two draws at most, camera-transparent, refuses without ground', () => {
  assert.equal(createEdenWayfinding(()=>null),null);
  const lane=createEdenWayfinding(()=>0)!;let draws=0;lane.group.traverse(o=>{if((o as THREE.Mesh).isMesh){draws++;assert.equal(o.userData.cameraTransparent,true);assert.equal((o as THREE.Mesh).castShadow,false);}});
  assert.ok(draws<=2&&draws>=1);assert.equal(lane.stats.lines,WHATS_ON.length);lane.dispose();
});
