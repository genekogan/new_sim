import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createEdenOutlookAtmosphere} from '../../../mars/viewer/app/engine-view/content/environment/eden-expansion-outlook/outlook.mjs';
import {Builder} from '../../../mars/viewer/app/engine-view/content/assets/eden-regions/kit.ts';
import {Terrain} from '../../../mars/viewer/app/engine-view/content/assets/eden-regions/terrain.ts';
import {Trees} from '../../../mars/viewer/app/engine-view/content/assets/eden-regions/trees.ts';
import {buildSports,buildHarbour,southPads} from '../../../mars/viewer/app/engine-view/content/assets/eden-regions/south.ts';
import {FOOTPRINTS} from '../../../mars/viewer/app/engine-view/content/assets/eden-regions/buildings.ts';
import {REGION_PLACES} from '../../../mars/viewer/app/engine-view/content/assets/eden-regions/places.ts';
import {buildResort,resortPads} from '../../../mars/viewer/app/engine-view/content/assets/eden-regions/resort-lake.ts';
import {furnishBalconyRooms} from '../../../mars/viewer/app/engine-view/content/assets/eden-regions/buildings.ts';
import {authoredBoundarySweepFraction} from '../../../mars/viewer/lib/authored-boundaries.ts';
import {inspectRoomFurnishing} from '../../../mars/viewer/app/engine-view/content/assets/room-furnishing-kit.ts';
import {COMPUTER_DESKS,createEdenComputers} from '../../../mars/viewer/app/engine-view/content/assets/eden-computers/index.ts';
import {Builder as InteriorBuilder} from '../../../mars/viewer/app/engine-view/content/assets/eden-interiors/kit.ts';
import {EXISTING_ROOMS} from '../../../mars/viewer/app/engine-view/content/assets/eden-interiors/existing.ts';
import {createEdenArtistRow,EDEN_ARTIST_ROW_PLAN} from '../../../mars/viewer/app/engine-view/content/assets/eden-expansion-assets/eden-artist-row.ts';
import {publicActivityClusters} from '../../../mars/viewer/app/engine-view/content/assets/eden-expansion-assets/activity-clusters.ts';
import {nightSource} from '../src/WorldNightLights.ts';

test('textured-sky composition can omit actual block-cloud allocation without removing the woodland',()=>{
 const old=createEdenOutlookAtmosphere({worldSeed:20261006,recordedSeconds:0},true);
 const current=createEdenOutlookAtmosphere({worldSeed:20261006,recordedSeconds:0},true,false);
 assert.ok(old&&current);assert.ok(current.costs.calls<old.costs.calls);assert.ok(current.costs.triangles<old.costs.triangles);
 assert.equal(current.group.children.length,3,'grove and two stone owners retained');
 assert.equal(current.setViewTime(120),true);assert.equal(current.setViewTime(NaN),false);assert.equal(current.setViewTime(null),true);
 old.dispose();current.dispose();current.dispose();assert.equal(current.group.children.length,0);
});

test('actual sports fences separate courts from goal run-off and keep a human-size entry open',()=>{
 const b=new Builder('legacy'),t=new Terrain(()=>0);southPads(t);buildSports(b,t,new Trees());
 const guards=b.boundaries.filter(v=>v.buildingId.startsWith('region-sports-court:'));
 assert.equal(guards.length,10);
 const west=guards.find(v=>v.id==='region-sports-court:0:side:-6.5');assert.equal(west.c[0],93);
 assert.ok(west.c[0]-west.half[0]-(86.05+1.6)>5,'more than five metres between the goal back and court fence');
 assert.ok(authoredBoundarySweepFraction(guards,[99.5,1.65,98],[109,1.65,98],.28,1.65,.1)<1,'closed side blocks a human capsule');
 assert.equal(authoredBoundarySweepFraction(guards,[99.5,1.65,108.7],[99.5,1.65,105],.28,1.65,.1),1,'front gate admits the same capsule');
 const lines=b.buf.get('dressing').p;assert.ok(lines.some((v,i)=>i%3===1&&Math.abs(v-.051)<1e-5),'court lines stand above the .04m pad');
 assert.ok(lines.some((v,i)=>i%3===1&&Math.abs(v-2.43)<1e-5),'goal grid includes a roof, not an opaque sloping cloth');
});

test('moved clubhouse and fish-market map polygons match their actual transformed house footprints',()=>{
 const before=FOOTPRINTS.length,b=new Builder('legacy'),t=new Terrain(()=>0);southPads(t);
 buildSports(b,t,new Trees());buildHarbour(b,t,new Trees());
 const drawn=FOOTPRINTS.slice(before);
 for(const [id,center]of[['region-sports-ground.clubhouse',[22.5,117]],['region-harbour.fish-market',[20.5,132]]]){
  const body=drawn.find(v=>Math.abs((v.x0+v.x1)/2-center[0])<1e-6&&Math.abs((v.z0+v.z1)/2-center[1])<1e-6);
  assert.ok(body,'actual transformed building exists');
  const place=REGION_PLACES.find(v=>v.id===id);assert.ok(place);
  const xs=place.polygon.map(v=>v[0]),zs=place.polygon.map(v=>v[1]);
  const mapBounds=[Math.min(...xs),Math.min(...zs),Math.max(...xs),Math.max(...zs)];
  const bodyBounds=[body.x0,body.z0,body.x1,body.z1];
  for(let i=0;i<4;i++)assert.ok(Math.abs(mapBounds[i]-bodyBounds[i])<1e-6,`${id} map bound ${i} matches the drawn shell`);
  assert.equal(place.capacity,Math.round((body.x1-body.x0)*(body.z1-body.z0)/2.5));
 }
});

test('pictured resort hotel IDs retain actual shells; decorative room geometry leaves the entry lane and walls clear',()=>{
 const b=new Builder('legacy'),t=new Terrain(()=>0);resortPads(t);buildResort(b,t,new Trees());
 const hotels=[...new Set(b.boundaries.filter(v=>v.buildingId.startsWith('region-house:')&&Math.abs(v.c[2]-126)<1).map(v=>v.buildingId))];
 assert.equal(hotels.length,4,'four actual seeded seafront hotel shells');
 const furniture=new Builder('decorative');furnishBalconyRooms(furniture,[{x:0,floorY:3.12,width:2.6,depth:1.2,index:'test'}],10,'#c45a4a');
 for(const soup of furniture.buf.values())for(let i=0;i<soup.p.length;i+=3){const [x,y,z]=soup.p.slice(i,i+3);assert.ok(y>=3.12-1e-6,'feet on the actual rendered floor');assert.ok(Math.abs(x)>.56,'continuous human-width door-to-rear lane');assert.ok(z>-4.68&&z<4.68,'inside the hollow shell');}
 assert.equal(furniture.boundaries.length,0,'furniture does not grant native access or invent blocking walls');
});

test('library desktop uses the original desktop centre and floor; both desk chairs face their desks',()=>{
 const top=inspectRoomFurnishing('desk-cabinet').proposedTops.find(v=>v.name==='desktop');
 const desk=COMPUTER_DESKS.find(v=>v.id==='library-east');
 assert.deepEqual(desk.at,[76.5+(top.min[0]+top.max[0])/2,.1+top.max[1],-9]);
 const computers=createEdenComputers(()=>0);assert.ok(computers);
 const positions=computers.group.children[0].geometry.attributes.position;const tower=[];
 for(let i=0;i<positions.count;i++)if(Math.abs(positions.getX(i)-76.07)<.11&&Math.abs(positions.getZ(i)+9)<.23&&positions.getY(i)<.6)tower.push(positions.getY(i));
 assert.ok(tower.length);assert.ok(Math.abs(Math.min(...tower)-.1)<1e-6,'tower rests on the library floor');computers.dispose();
 const room=new InteriorBuilder();EXISTING_ROOMS.find(v=>v.id==='eden-library-1').draw(room);
 const chairs=room.boxes.filter(v=>v.label==='library desk chairs');assert.ok(chairs.length>=12);
 for(const x of[70.65,75.65])assert.ok(chairs.some(v=>Math.abs((v.min[0]+v.max[0])/2-x)<.01&&v.min[2]>-8.2&&v.max[2]<-8.02&&v.max[1]>.9),'chair back is south of the seat, facing the northern desk');
});

test('requested main mural has no obsolete fallback furniture and reuses ground night-light sources',()=>{
 assert.ok(!publicActivityClusters().some(v=>v.id==='eden-library-reading-forecourt'));
 const owner=createEdenArtistRow(()=>0);assert.ok(owner);const wall=owner.group.getObjectByName('mural-wall');assert.deepEqual(wall.position.toArray(),[73.5,0,5.4]);
 wall.updateWorldMatrix(true,true);const box=new THREE.Box3().setFromObject(wall.getObjectByName('mural-wall-body'));assert.ok(box.min.z>5.2,'moved clear of the former sidewalk/forecourt band');
 assert.equal(wall.userData.edenLightSources.length,3);for(const [x,y,z,kind,scale]of wall.userData.edenLightSources){const light=nightSource(x,y,z,kind,scale);assert.ok(light&&light.base===0&&light.intensity>0);}
 assert.equal(EDEN_ARTIST_ROW_PLAN.status.includes('no physical admission'),true);owner.dispose();
});
