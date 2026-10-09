import {DecorativeMotion} from '../decorative-motion.ts';
import * as THREE from 'three';
import {validAuthoredBoundary,type AuthoredBoundaryBox} from '../../../../../lib/authored-boundaries.ts';
import type {Ground} from '../eden-expansion-assets/venue.ts';
import {Builder,Materials,rng,pick} from './kit.ts';
import {SEABED,Terrain,outside,fbm,WATER,INNER} from './terrain.ts';
import {bakeShore,seaSurfPatch,tidePools} from './coast-surf.ts';
import {Trees} from './trees.ts';
import {FOOTPRINTS,CHIMNEYS,LIGHTS} from './buildings.ts';
export {FOOTPRINTS};
import {buildCanalQuarter,buildOldTown,canalPads,CANAL_BOUNDS} from './canal-quarter.ts';
import {buildSouthAvenue,buildPark,buildSports,buildFarm,buildHarbour,southPads,PARK_BOUNDS,SPORTS_BOUNDS,FARM_BOUNDS,HARBOUR_BOUNDS} from './south.ts';
import {buildNorthAvenue,buildVineyard,buildCampus,buildArtists,northPads,VINE_BOUNDS,CAMPUS_BOUNDS,ARTS_BOUNDS} from './north.ts';
import {buildResort,buildLakeShore,buildCampsite,resortPads,RESORT_BOUNDS,LAKE_BOUNDS,CAMP_BOUNDS} from './resort-lake.ts';
import {buildRailway,buildCountry,buildTownLife,countryPads,STATION_BOUNDS} from './country.ts';
import {buildAbbey,buildCourtyards,buildMakersYard,abbeyPads,ABBEY_BOUNDS,YARD_BOUNDS} from './abbey-yard.ts';
import {buildSuburb,buildCastle,suburbPads,SUBURB_BOUNDS} from './suburb.ts';
import {buildBotanic,buildObservatory,botanicPads,BOTANIC_BOUNDS,OBS_BOUNDS} from './botanic.ts';
import {buildLife} from './life.ts';
import {buildRiver,riverPads,RIVER_BOUNDS} from './river.ts';
import {buildCliffVillage,cliffPads,CLIFF_BOUNDS} from './cliff-village.ts';
import {buildCrossroads,crossPads,CROSS_BOUNDS} from './crossroads.ts';
import {buildGolf,golfPads,GOLF_BOUNDS} from './golf.ts';
import {buildFairground,fairPads,FAIR_BOUNDS} from './fairground.ts';
import {buildAlpine,alpinePads,ALPINE_BOUNDS} from './alpine.ts';
import {buildHillVillage,hillPads,HILL_BOUNDS} from './hill-village.ts';
/** World Regions lane entry point (owned by that lane). New regions, districts
 * and buildings beyond/around the current Eden layout. Scenery only: no native
 * support, collision, route, seat or place grant until Core admits them. */
export const REGION_DISTRICTS:{id:string;bounds:readonly [number,number,number,number]}[]=[
 {id:'canal-quarter-old-town-market',bounds:CANAL_BOUNDS},
 {id:'hillside-village-lookout',bounds:HILL_BOUNDS},
 {id:'park-pond-playground',bounds:PARK_BOUNDS},{id:'sports-ground',bounds:SPORTS_BOUNDS},{id:'farm-hamlet',bounds:FARM_BOUNDS},{id:'harbour-boardwalk-beach',bounds:HARBOUR_BOUNDS},
 {id:'vineyard-orchard-terraces',bounds:VINE_BOUNDS},{id:'campus-library-annex',bounds:CAMPUS_BOUNDS},{id:'artists-village',bounds:ARTS_BOUNDS},
 {id:'seaside-resort-marina',bounds:RESORT_BOUNDS},{id:'west-lake-shore',bounds:LAKE_BOUNDS},{id:'forest-campsite',bounds:CAMP_BOUNDS},
 {id:'railway-station',bounds:STATION_BOUNDS},{id:'abbey-courtyard-quarter',bounds:ABBEY_BOUNDS},{id:'makers-yard',bounds:YARD_BOUNDS},{id:'east-suburb',bounds:SUBURB_BOUNDS},{id:'botanic-garden',bounds:BOTANIC_BOUNDS},{id:'west-river',bounds:RIVER_BOUNDS},{id:'cliff-village',bounds:CLIFF_BOUNDS},{id:'east-crossroads',bounds:CROSS_BOUNDS},{id:'golf-course',bounds:GOLF_BOUNDS},{id:'festival-meadow',bounds:FAIR_BOUNDS},{id:'alpine-cable-car',bounds:ALPINE_BOUNDS},{id:'observatory',bounds:OBS_BOUNDS},
];
export {REGION_PLACES} from './places.ts';
/** Explore-menu views of the Regions (camera → target, world metres); each camera checked to sit outside buildings. */
export const REGION_EXPLORE:readonly {id:string;label:string;camera:[number,number,number];target:[number,number,number]}[]=Object.freeze([
 {id:'region-east-panorama',label:'Eastern panorama: canal town and hills',camera:[95,45,-60],target:[170,0,30]},
 {id:'region-canal-quarter',label:'Canal quarter',camera:[137,12,-44],target:[137,1,10]},
 {id:'region-old-town-plaza',label:'Old town plaza',camera:[124,9,64],target:[150,3,77]},
 {id:'region-market-street',label:'Market street',camera:[112,4,92],target:[135,2,100]},
 {id:'region-hillside-village',label:'Hillside village',camera:[160,45,40],target:[218,10,-14]},
 {id:'region-lookout-temple',label:'Lookout temple',camera:[250,30,10],target:[226,22,-22]},
 {id:'region-east-suburb',label:'East suburb',camera:[250,22,122],target:[214,0,74]},
 {id:'region-railway-station',label:'Railway station',camera:[126,7,-28],target:[150,2,-50]},
 {id:'region-makers-yard',label:'Makers’ yard',camera:[116,12,-58],target:[146,2,-90]},
 {id:'region-south-panorama',label:'Southern panorama: park, sports and harbour',camera:[0,60,40],target:[10,0,130]},
 {id:'region-park',label:'Park with pond and gazebo',camera:[-24,10,90],target:[-4,0,112]},
 {id:'region-sports-ground',label:'Sports ground',camera:[40,12,90],target:[66,1,112]},
 {id:'region-farm-hamlet',label:'Farm hamlet',camera:[-52,14,98],target:[-78,3,122]},
 {id:'region-harbour',label:'Harbour and lighthouse',camera:[20,9,122],target:[45,1,152]},
 {id:'region-seaside-resort',label:'Seaside resort',camera:[110,40,80],target:[170,0,140]},
 {id:'region-north-panorama',label:'Northern panorama: campus and vineyard',camera:[0,55,-30],target:[10,0,-110]},
 {id:'region-vineyard',label:'Vineyard terraces',camera:[60,40,-40],target:[60,10,-150]},
 {id:'region-campus',label:'Campus quad',camera:[-12,10,-72],target:[-12,3,-105]},
 {id:'region-artists-village',label:'Artists’ village',camera:[-52,12,-86],target:[-76,2,-100]},
 {id:'region-west-lake',label:'West lake shore',camera:[-104,10,-30],target:[-150,0,-20]},
 {id:'region-campsite',label:'Forest campsite',camera:[-122,9,-88],target:[-142,1,-104]},
 {id:'region-abbey',label:'Abbey on the knoll',camera:[-126,16,108],target:[-160,6,100]},
 {id:'region-courtyard-quarter',label:'Courtyard-house quarter',camera:[-102,18,50],target:[-128,0,72]},
 {id:'region-castle-ruin',label:'Castle ruin and turbines',camera:[-120,30,-130],target:[-165,15,-185]},
 {id:'region-japanese-garden',label:'Japanese garden and pagoda',camera:[-60,9,-136],target:[-78,2,-156]},
 {id:'region-observatory',label:'Observatory above the vineyard',camera:[70,24,-160],target:[92,16,-188]},
 {id:'region-west-river',label:'West river and stone bridge',camera:[-160,80,40],target:[-240,0,-40]},
 {id:'region-watermill',label:'Watermill',camera:[-246,8,-96],target:[-226,3,-108]},
 {id:'region-fishing-hamlet',label:'Fishing hamlet at the river mouth',camera:[-190,14,110],target:[-222,0,140]},
 {id:'region-cliff-village',label:'Whitewashed cliff village',camera:[270,22,160],target:[282,8,108]},
 {id:'region-east-crossroads',label:'East crossroads: petrol station and pub',camera:[258,20,16],target:[284,10,-12]},
 {id:'region-golf-course',label:'Golf course',camera:[176,26,-100],target:[218,2,-150]},
 {id:'region-festival-meadow',label:'Festival meadow: big top and balloons',camera:[246,22,90],target:[278,4,50]},
 {id:'region-alpine',label:'Alpine chalets and cable car',camera:[30,40,-170],target:[-4,30,-270]},
 {id:'region-night-town',label:'Canal town by night (best after dusk)',camera:[95,45,-60],target:[170,0,30]},
]);
export const FAR_CLEAR=35;
const inDistrict=(x:number,z:number,m=0)=>REGION_DISTRICTS.some(d=>x>d.bounds[0]-m&&x<d.bounds[2]+m&&z>d.bounds[1]-m&&z<d.bounds[3]+m);
export function createEdenRegions(ground:Ground):{group:THREE.Group;dispose():void;stats:{draws:number;triangles:number};sampleVisualGround:Ground;authoredBoundaries:AuthoredBoundaryBox[]}|null{
 if(typeof ground!=='function')return null;
 FOOTPRINTS.length=0;CHIMNEYS.length=0;LIGHTS.length=0;
 const edge=(x:number,z:number)=>{const y=ground(Math.min(Math.max(x,INNER[0]+.01),INNER[2]-.01),Math.min(Math.max(z,INNER[1]+.01),INNER[3]-.01));return typeof y==='number'&&Number.isFinite(y)?y:0;};
 const group=new THREE.Group();group.name='Eden Regions — districts beyond the edge (scenery only)';group.userData.nativeSupport='none: visual scenery, Core admission pending';
 const motion=new DecorativeMotion(),motionMaterials:THREE.Material[]=[];
 const mats=new Materials(),geos:THREE.BufferGeometry[]=[];let tris=0,closed=false;
 const dispose=()=>{if(closed)return;closed=true;group.removeFromParent();for(const g of geos)g.dispose();mats.dispose();for(const m of motionMaterials)m.dispose();group.clear();};
 try{
  const t=new Terrain(edge),trees=new Trees();// far forests + every district's distant trees
  const farB=new Builder('legacy'),winB=new Builder('legacy'),isFar=(x:number,z:number)=>outside(x,z)>FAR_CLEAR+6;
  canalPads(t);countryPads(t);hillPads(t);southPads(t);northPads(t);resortPads(t);abbeyPads(t);suburbPads(t);botanicPads(t);riverPads(t);cliffPads(t);crossPads(t);golfPads(t);fairPads(t);alpinePads(t);
  // Districts are authored separately but drawn per SECTOR (north/south/east/west of the inhabited rectangle):
  // a few shared draws and ray objects instead of a dozen per district. Distant parts and window glass go to
  // their own shared sinks.
  const sectors={southWest:new Builder('legacy'),northWest:new Builder('legacy'),north:new Builder('legacy'),south:new Builder('legacy'),east:new Builder('legacy'),eastEdge:new Builder('legacy'),eastEdgeSouth:new Builder('legacy'),eastEdgeNorth:new Builder('legacy'),west:new Builder('legacy')},sectorTrees={southWest:new Trees(),northWest:new Trees(),north:new Trees(),south:new Trees(),east:new Trees(),eastEdge:new Trees(),eastEdgeSouth:new Trees(),eastEdgeNorth:new Trees(),west:new Trees()};
  const sectorOf=(x:number,z:number):keyof typeof sectors=>z<INNER[1]?(x<0?'northWest':'north'):z>INNER[3]?(x<0?'southWest':'south'):x>INNER[2]?(x<136.5?(z<10?'eastEdgeNorth':z<60?'eastEdge':'eastEdgeSouth'):'east'):'west';
  const district=(name:string,fn:(b:Builder,tr:Trees)=>void)=>{const b=new Builder('legacy'),tr=new Trees();fn(b,tr);b.drain((x,z,k)=>k==='glass'?winB:isFar(x,z)?farB:sectors[sectorOf(x,z)]);
   for(const tt of tr.list)(isFar(tt.x,tt.z)?trees:sectorTrees[sectorOf(tt.x,tt.z)]).list.push(tt);void name;};
  district('Canal quarter (scenery only)',(b,tr)=>buildCanalQuarter(b,t,tr));
  district('Old town plaza and market street (scenery only)',(b,tr)=>buildOldTown(b,t,tr));
  district('Hillside village and lookout temple (scenery only)',(b,tr)=>buildHillVillage(b,t,tr));
  district('South avenue (scenery only)',(b,tr)=>buildSouthAvenue(b,t,tr));
  district('Park with pond, gazebo and playground (scenery only)',(b,tr)=>buildPark(b,t,tr));
  district('Sports ground and courts (scenery only)',(b,tr)=>buildSports(b,t,tr));
  district('Farm hamlet with silos (scenery only)',(b,tr)=>buildFarm(b,t,tr));
  district('Harbour boardwalk, beach and lighthouse (scenery only)',(b,tr)=>buildHarbour(b,t,tr));
  district('North avenue (scenery only)',(b,tr)=>buildNorthAvenue(b,t,tr));
  district('Vineyard and orchard terraces with hill villa (scenery only)',(b,tr)=>buildVineyard(b,t,tr));
  district('Campus quad and library annex (scenery only)',(b,tr)=>buildCampus(b,t,tr));
  district('Artists village (scenery only)',(b,tr)=>buildArtists(b,t,tr));
  district('Seaside resort, ferris wheel and marina (scenery only)',(b,tr)=>buildResort(b,t,tr,motion.sink));
  district('West lake shore hamlet and boathouses (scenery only)',(b,tr)=>buildLakeShore(b,t,tr));
  district('Forest campsite and lodge (scenery only)',(b,tr)=>buildCampsite(b,t,tr));
  district('Railway, station and parked train (scenery only)',(b,tr)=>buildRailway(b,t,tr));
  district('Country roads, farmsteads and wind turbines (scenery only)',(b,tr)=>buildCountry(b,t,tr,(x,z)=>!inDistrict(x,z,12)));
  district('Old town cafe tables, bikes and planters (scenery only)',(b,tr)=>buildTownLife(b,t,tr));
  district('Abbey on the knoll with cloister and lavender (scenery only)',(b,tr)=>buildAbbey(b,t,tr));
  district('Courtyard-house quarter (scenery only)',(b,tr)=>buildCourtyards(b,t,tr));
  district('Makers yard, water tower and greenhouses (scenery only)',(b,tr)=>buildMakersYard(b,t,tr));
  district('Suburb with lawns, pools and a cul-de-sac (scenery only)',(b,tr)=>buildSuburb(b,t,tr));
  district('Castle ruin on the north-west crag (scenery only)',(b,tr)=>buildCastle(b,t,tr));
  district('Botanic garden: Japanese garden, pagoda, tea house, palm house (scenery only)',(b,tr)=>buildBotanic(b,t,tr));
  district('Observatory above the vineyard (scenery only)',(b,tr)=>buildObservatory(b,t,tr));
  district('Bunting, laundry, parked cars and boats at sea (scenery only)',b=>buildLife(b,t,motion.sink));
  district('West river, watermill, stone bridge and fishing hamlet (scenery only)',(b,tr)=>buildRiver(b,t,tr));
  district('Whitewashed cliff village, chapel, windmills and harbour (scenery only)',(b,tr)=>buildCliffVillage(b,t,tr));
  district('East crossroads: petrol station, pub, bus stop (scenery only)',(b,tr)=>buildCrossroads(b,t,tr));
  district('Golf course and clubhouse (scenery only)',(b,tr)=>buildGolf(b,t,tr));
  district('Festival meadow: big top, helter-skelter, balloons (scenery only)',(b,tr)=>buildFairground(b,t,tr));
  district('Alpine chalets and cable car (scenery only)',(b,tr)=>buildAlpine(b,t,tr));
  // Countryside and far forests outside the districts.
  const r=rng(424242);
  for(let i=0;i<5200&&trees.list.length<850;i++){const x=-330+r()*700,z=-300+r()*560,d=outside(x,z);if(d<14||inDistrict(x,z,6))continue;const h=t.height(x,z);if(h<.2||h>58)continue;
   const dens=fbm(x/60,z/60);if(dens<.5-(d>150?.08:0))continue;const conifer=h>14||d>170||r()<.25;trees.add(x,h,z,(conifer?1.1:1)*(.8+r()*.8)*(d>150?1.6:1),conifer?'conifer':pick(r,['round','round','poplar'] as const),conifer?pick(r,['#3f6a3c','#4a7a44','#365e38']):pick(r,['#6f9a4e','#5f8a46','#7fa84f','#8aa850']),r()*6);}
  for(const k of Object.keys(sectors) as (keyof typeof sectors)[]){const g=new THREE.Group();g.name='Regions '+k+' districts (scenery only)';group.add(g);tris+=sectors[k].emit(g,mats,'Regions '+k+' districts',geos,{glassSink:winB});tris+=sectorTrees[k].emit(g,mats,geos);}
  const fg=new THREE.Group();fg.name='Regions distant district parts (scenery only; never in camera rays)';group.add(fg);tris+=farB.emit(fg,mats,'Regions distant districts',geos,{allClear:true,glassSink:winB});
  {const W=winB.b('glass');if(W.p.length){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(W.p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(W.n,3));g.setAttribute('color',new THREE.Float32BufferAttribute(W.c,3));g.computeBoundingBox();g.computeBoundingSphere();geos.push(g);
   const m=new THREE.Mesh(g,mats.windows());m.name='Regions window glass and lamp heads (night-lit)';m.userData.cameraTransparent=true;m.matrixAutoUpdate=false;fg.add(m);tris+=W.p.length/9;}}
  tris+=motion.emit(group,mats,geos,motionMaterials);
  const tg=new THREE.Group();tg.name='Regions trees and far forests (scenery only)';group.add(tg);
  tris+=trees.emit(tg,mats,geos,true);
  // Terrain and open water last (largest meshes).
  const land=new THREE.Group();land.name='Regions terrain and open water (scenery only)';group.add(land);
  tris+=t.build(land,mats,geos);
  const wb=new Builder('legacy');
  // Open sea to the horizon (the camera sees ~2 km); beyond the districts it reaches into the coves of the outer coast.
  wb.quad('water',[-300,WATER.bay,138],[300,WATER.bay,138],[300,WATER.bay,4000],[-300,WATER.bay,4000],'#4d7f93');
  // Deep seabed under the open sea beyond the terrain (the translucent sea never shows a terrain edge).
  for(const [x0,x1,z0] of [[-300,300,138],[300,4000,90],[-4000,-300,90]] as const)wb.quad('ground',[x0,-8,z0],[x1,-8,z0],[x1,-8,4000],[x0,-8,4000],SEABED);
  for(const s of [1,-1])wb.quad('water',s>0?[300,WATER.bay,90]:[-4000,WATER.bay,90],s>0?[4000,WATER.bay,90]:[-300,WATER.bay,90],s>0?[4000,WATER.bay,4000]:[-300,WATER.bay,4000],s>0?[300,WATER.bay,4000]:[-4000,WATER.bay,4000],'#4d7f93');
  wb.quad('water',[-99.9,WATER.lake,-48],[-99.9,WATER.lake,50],[-200,WATER.lake,50],[-200,WATER.lake,-48],'#557f86');
  tidePools(wb,(x,z)=>t.height(x,z),WATER.bay);
  tris+=wb.emit(land,mats,'Regions open water',geos);
  // Coast: swell, surf lines, beach wash and cliff foam on the sea surface, from a shore map baked once.
  {bakeShore((x,z)=>t.height(x,z),WATER.bay);const water=mats.get('water');water.onBeforeCompile=seaSurfPatch(WATER.bay);water.customProgramCacheKey=()=>'eden-regions-sea-surf-v1';}
  // Meshes lying wholly > FAR_CLEAR m outside the inhabited rectangle can never stand between a Broadcast
  // camera and a subject: keep them out of the per-ray object set (materials are shared with near districts,
  // so their realism finish is unchanged).
  const box=new THREE.Box3();group.traverse(o=>{const m=o as THREE.Mesh;if(!m.isMesh||m.userData.cameraTransparent||/terrain/.test(m.name))return;m.geometry.computeBoundingBox();box.copy(m.geometry.boundingBox!);
   if((m as THREE.InstancedMesh).isInstancedMesh){const im=m as THREE.InstancedMesh;im.computeBoundingBox();const bb=im.boundingBox;if(bb)box.copy(bb);}
   const dx=Math.max(INNER[0]-box.max.x,0,box.min.x-INNER[2]),dz=Math.max(INNER[1]-box.max.z,0,box.min.z-INNER[3]);if(Math.hypot(dx,dz)>FAR_CLEAR)m.userData.cameraTransparent=true;});
  // Chimney smoke: the 16 chimneys nearest the inhabited rectangle (the atmosphere draws at most 24 sources; Eden's own stoves take a few).
  group.userData.edenSmokeSources=[...CHIMNEYS].sort((a,b)=>outside(a[0],a[2])-outside(b[0],b[2])).slice(0,16).map(([x,y,z])=>[x,y,z,1]);
  // Night light anchors (lamp posts, lanterns, fires, windowed houses): the viewer paints them into its night light map.
  group.userData.edenLightSources=LIGHTS.map(l=>[...l]);
  // Clear festival meadow patch: outside the big top/stage, tethered balloons,
  // stall arc and 23 m light ring. Read the drawn triangles, not terrain guesses.
  {const x=295,z=62,samples=[[-1,-1],[1,-1],[-1,1],[1,1],[0,0]].map(([dx,dz])=>t.sampleRenderedGround(x+dx,z+dz));
   if(samples.every((y):y is number=>typeof y==='number'&&Number.isFinite(y))&&Math.max(...samples as number[])-Math.min(...samples as number[])<.03)group.userData.edenBalloonLanding=[x,Math.max(...samples as number[]),z];}
  group.updateMatrixWorld(true);
  let draws=0;group.traverse(o=>{if((o as THREE.Mesh).isMesh)draws++;});
  group.userData.stats={draws,triangles:tris};
  const authoredBoundaries:AuthoredBoundaryBox[]=[],seen=new Set<string>();group.traverse(o=>{for(const b of o.userData.edenAuthoredBoundaries??[]){if(!validAuthoredBoundary(b)||seen.has(b.id))throw Error('regions.invalid-authored-boundary');seen.add(b.id);authoredBoundaries.push({...b,c:[...b.c],half:[...b.half]});}});authoredBoundaries.sort((a,b)=>a.id.localeCompare(b.id));group.userData.edenAuthoredBoundaries=authoredBoundaries;
  return {group,dispose,stats:{draws,triangles:tris},sampleVisualGround:(x,z)=>closed?null:t.sampleRenderedGround(x,z),authoredBoundaries};
 }catch(e){dispose();throw e;}
}
