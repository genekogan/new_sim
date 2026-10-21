import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {createEdenRegions,edenRegionSteps,type EdenRegions} from '../../../mars/viewer/app/engine-view/content/assets/eden-regions/index.ts';

// F12: the old Eden page builds the regions in idle slices (edenRegionSteps) and the first expansion takes them only when its
// ground answers every recorded edge query the same. Stepping must give exactly createEdenRegions' output for that ground.
const ground=(x:number,z:number)=>x>=-30&&x<=30&&z>=-30&&z<=30?0:Math.sin(x/17)*.4+Math.cos(z/23)*.3;
const digest=(r:EdenRegions)=>{const h=createHash('sha256');r.group.traverse(o=>{h.update(o.name);const g=(o as THREE.Mesh).geometry;if(!g)return;
 for(const [k,a] of Object.entries(g.attributes)){h.update(k);const v=(a as THREE.BufferAttribute).array;h.update(Buffer.from(v.buffer,v.byteOffset,v.byteLength));}
 if(g.index)h.update(Buffer.from(g.index.array.buffer,g.index.array.byteOffset,g.index.array.byteLength));});
 h.update(JSON.stringify(r.authoredBoundaries));return h.digest('hex');};

test('regions built in steps (with other work between them) equal one synchronous build; the edge ground is all they read', () => {
  const whole=createEdenRegions(ground)!,want=digest(whole);whole.dispose();
  const asked:number[]=[],steps=edenRegionSteps((x,z)=>{asked.push(x,z);return ground(x,z);});let r=steps.next(),n=0;
  while(!r.done){n++;new THREE.Vector3(n,0,0).normalize();r=steps.next();}
  assert.ok(n>30,`steps ${n}`);const stepped=r.value!;assert.equal(digest(stepped),want);
  for(let i=0;i<asked.length;i+=2){const [x,z]=[asked[i],asked[i+1]];assert.ok(Math.abs(x-(-100))<.02||Math.abs(x-105)<.02||Math.abs(z-(-65))<.02||Math.abs(z-85)<.02||(x>-100&&x<105&&z>-65&&z<85),`query ${x},${z}`);}
  stepped.dispose();
  const other=createEdenRegions((x,z)=>ground(x,z)+.25)!;assert.notEqual(digest(other),want);other.dispose();
});
