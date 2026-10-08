import type {OfficeGuardBox} from '../../../mars/viewer/lib/office-stair-guards.ts';
import {createWorldEdenSurfaceStudy} from './WorldEdenSurfaceStudy.ts';
import {createWorldEdenPlaces} from './WorldEdenPlaces.ts';
import {classroomSlide} from './WorldClassroomLesson.ts';
import {createWorldEdenWind} from './WorldEdenWind.ts';
import {stepSurfaceKit} from './WorldEdenSurfaceKit.ts';
import {collectNightSources,paintNightSources} from './WorldNightLights.ts';
import {paintGroundOcclusion} from './WorldGroundOcclusion.ts';
import {createWorldGroundDetails} from './WorldGroundDetails.ts';
import {EDEN_VIEWER_PLACES} from './WorldEdenPlaceData.ts';
import {applyWorldRealism,applySceneryRealism,releaseWorldRealism,disposeBuildingIdentity,setRealismTime} from './WorldEdenRealism.ts';
import * as THREE from 'three';
import {createAcademicVenueScenery,academicVenuePlan} from '../../../mars/viewer/app/engine-view/content/assets/eden-expansion-assets/venue.ts';
import {createEdenNeighborhood} from '../../../mars/viewer/app/engine-view/content/assets/eden-expansion-assets/neighborhood.ts';
import {createEdenExpansionLandscape} from '../../../mars/viewer/app/engine-view/content/environment/eden-expansion-landscape/landscape.mjs';
import {createEdenPublicQuarter} from '../../../mars/viewer/app/engine-view/content/assets/eden-expansion-assets/public-quarter.ts';
import {expansionHeight} from '../../../mars/viewer/app/engine-view/content/environment/eden-expansion-landscape/layout.mjs';
import {createEdenGardensYard} from '../../../mars/viewer/app/engine-view/content/assets/eden-expansion-assets/gardens-yard.ts';
import {createEdenRegions,FOOTPRINTS} from '../../../mars/viewer/app/engine-view/content/assets/eden-regions/index.ts';
import {createEdenStreetProps} from '../../../mars/viewer/app/engine-view/content/assets/eden-street-props/index.ts';
import {createEdenInteriors} from '../../../mars/viewer/app/engine-view/content/assets/eden-interiors/index.ts';
import {createEdenWayfinding} from '../../../mars/viewer/app/engine-view/content/assets/eden-wayfinding/index.ts';
import {createEdenFacades} from '../../../mars/viewer/app/engine-view/content/assets/eden-facades/index.ts';
import {createEdenEventKit} from '../../../mars/viewer/app/engine-view/content/assets/eden-event-kit/index.ts';
import {createEdenComputers} from '../../../mars/viewer/app/engine-view/content/assets/eden-computers/index.ts';
import {createEdenSportsKit} from '../../../mars/viewer/app/engine-view/content/assets/eden-sports-kit/index.ts';
import {createEdenDistricts} from '../../../mars/viewer/app/engine-view/content/assets/eden-districts/index.ts';
import {createEdenImports} from '../../../mars/viewer/app/engine-view/content/assets/eden-imports/index.ts';
import {createEdenDomeQuarter} from '../../../mars/viewer/app/engine-view/content/assets/eden-expansion-assets/dome-quarter.ts';
import {createEdenLandmarks} from '../../../mars/viewer/app/engine-view/content/assets/eden-expansion-assets/eden-landmarks.ts';
import {createEdenVillageFeatures} from '../../../mars/viewer/app/engine-view/content/assets/eden-expansion-assets/eden-village-features.ts';
import {createEdenStreetDetails} from '../../../mars/viewer/app/engine-view/content/assets/eden-expansion-assets/eden-street-details.ts';
import {createEdenArtistRow} from '../../../mars/viewer/app/engine-view/content/assets/eden-expansion-assets/eden-artist-row.ts';
import {createEdenRiverCrossing} from '../../../mars/viewer/app/engine-view/content/assets/eden-expansion-assets/river-crossing.ts';
import {FixtureViews} from '../../../mars/viewer/app/engine-view/fixtures.ts';
import {setHumanGround} from '../../../mars/viewer/app/engine-view/humans.ts';
import {setDepthFitGround} from '../../../mars/viewer/lib/depth-fit.ts';
import {currentClassroomPresentation,type LocalClassroomPresentation} from './WorldClassroomPresentation.ts';
/** One connected visual assembly. New places never manufacture native actors,
 * support, claims or participation. Existing published fixture draws win. */
export function createWorldEdenExpansion(officeGuards:readonly OfficeGuardBox[]=[]){
 const group=new THREE.Group(),owners:{group:THREE.Group;dispose():void}[]=[],hidden:THREE.Object3D[]=[];
 group.name='Eden — connected growing world';
 let visualGround:(x:number,z:number)=>number|null=expansionHeight;
 const proposedGround=(x:number,z:number)=>x>=-30&&x<=30&&z>=-30&&z<=30?0:visualGround(x,z);
 let wind:ReturnType<typeof createWorldEdenWind>|null=null,windWanted=false;
 let surfaceStudy:ReturnType<typeof createWorldEdenSurfaceStudy>|null=null;
 let surfaceGroup:THREE.Group|null=null;
 let extraPlaces:ReturnType<typeof createWorldEdenPlaces>|null=null;
 let lastNative:Record<string,unknown>={};
 let windInput:{group:THREE.Group;plants:any[]}|null=null;
 let venue:ReturnType<typeof createAcademicVenueScenery>,scenery:FixtureViews,closed=false;
 const textures=new Set<THREE.Texture>();let generation=0,slideKey='';
 try{
  const landscape=createEdenExpansionLandscape(true);if(!landscape)throw Error('Landscape unavailable');owners.push(landscape);group.add(landscape.group);visualGround=landscape.sampleVisualGround;windInput={group:landscape.group,plants:landscape.planting.plants};surfaceGroup=landscape.group;
  venue=createAcademicVenueScenery(proposedGround);if(!venue)throw Error('Venue unavailable');owners.push(venue);group.add(venue.group);
  const neighborhood=createEdenNeighborhood(proposedGround,{houseOne:'direct-courtyard',houseThree:'lower-roof-route'});if(!neighborhood)throw Error('Neighborhood unavailable');owners.push(neighborhood);group.add(neighborhood.group);
  const publicQuarter=createEdenPublicQuarter(proposedGround,officeGuards);if(!publicQuarter)throw Error('Public quarter unavailable');owners.push(publicQuarter);group.add(publicQuarter.group);
  const gardenYard=createEdenGardensYard(proposedGround);if(!gardenYard)throw Error('Garden yard unavailable');owners.push(gardenYard);group.add(gardenYard.group);
  // Optional scenery: refuses (null) off flat native ground rather than failing the world.
  const domeQuarter=createEdenDomeQuarter(proposedGround);if(domeQuarter){owners.push(domeQuarter);group.add(domeQuarter.group);}
  const landmarks=createEdenLandmarks(proposedGround);if(landmarks){owners.push(landmarks);group.add(landmarks.group);}
  const village=createEdenVillageFeatures(proposedGround);if(village){owners.push(village);group.add(village.group);}
  const streetDetails=createEdenStreetDetails(proposedGround);if(streetDetails){owners.push(streetDetails);group.add(streetDetails.group);}
  const artistRow=createEdenArtistRow(proposedGround);if(artistRow){owners.push(artistRow);group.add(artistRow.group);}
  // Edge lanes (each owns its module): new regions, street props, interiors, commons wayfinding.
  for(const make of [createEdenRegions,createEdenStreetProps,createEdenInteriors,createEdenWayfinding,createEdenFacades,createEdenEventKit,createEdenComputers,createEdenSportsKit,createEdenDistricts,createEdenImports]){try{const lane=make(proposedGround);if(lane){owners.push(lane);group.add(lane.group);}}catch(error){console.warn('Eden lane scenery unavailable',error);}}
  // Ground details: near-camera grass tufts and wildflowers, worn path edges, field stones, fallen leaves.
  try{const details=createWorldGroundDetails();owners.push(details);group.add(details.group);}catch(error){console.warn('Eden ground details unavailable',error);}
  const bankY=landscape.sampleVisualGround(-81,-22);if(bankY!==null){const bridge=createEdenRiverCrossing({deckTopY:bankY+.35,bankSample:landscape.sampleVisualGround});if(bridge){owners.push(bridge);group.add(bridge.group);}}
  const buildings=[...neighborhood.plan.map(b=>({id:b.id,group:neighborhood.buildingOwners.find(o=>o.id===b.id)?.group as THREE.Group,root:b.root,parts:b.sourceInspection.parts})),...publicQuarter.plan.map(b=>({id:b.id,group:publicQuarter.group.getObjectByName(b.id) as THREE.Group,root:b.root,parts:b.originalInspection.parts}))];
  if(buildings.some(b=>!b.group))throw Error('Selected building owner unavailable');
  extraPlaces=createWorldEdenPlaces({ground:proposedGround,buildings});owners.push(extraPlaces);group.add(extraPlaces.group);
  scenery=new FixtureViews(true);group.add(scenery.group);
 }catch(error){for(const owner of owners.reverse())try{owner.dispose();}catch{}throw error;}
 // Night light pools for every published lamp, lantern, fire and lit window (one repaint of the shared light map).
 try{paintNightSources(collectNightSources(group));}catch(error){console.warn('Eden night light map unavailable',error);}
 // Contact ambient occlusion around every enclosed building and Region house (one paint of the shared map).
 try{paintGroundOcclusion([...EDEN_VIEWER_PLACES.filter(p=>p.enclosed&&p.level===0&&p.kind!=='room'&&p.kind!=='bedroom'&&p.kind!=='kitchen').map(p=>({corners:p.polygon})),...FOOTPRINTS.map(f=>({corners:f.corners}))],proposedGround);}catch(error){console.warn('Eden ground occlusion unavailable',error);}
 // People lying down rest on the visual ground under them (hills and the expansion's relief included).
 setHumanGround(proposedGround);setDepthFitGround(proposedGround);
 applyWorldRealism(group,{buildings:true});let realismAt=-Infinity;
 /** Shader pre-warm: borrow the renderer from one backdrop draw, then (after that frame) compile the whole
  * expansion with KHR_parallel_shader_compile via compileAsync. The scenery is shown once its programs are
  * ready (or after 4 s), so no frame blocks on dozens of synchronous compiles. */
 let warm=false;const bornAt=performance.now();
 const prewarm=(base:THREE.Object3D)=>{let host:THREE.Object3D|null=null;base.traverse(o=>{if(!host&&(o as THREE.Mesh).isMesh&&o.visible&&!Object.hasOwn(o,'onBeforeRender'))host=o;});
  if(!host){warm=true;return;}const h:THREE.Object3D=host;
  h.onBeforeRender=function(renderer:THREE.WebGLRenderer,scene:THREE.Scene,camera:THREE.Camera){delete (h as any).onBeforeRender;setTimeout(()=>{if(closed||warm)return;
   try{const shown=group.visible;group.visible=true;const pending=renderer.compileAsync(group,camera,scene);group.visible=shown;pending.then(()=>{warm=true;},()=>{warm=true;});}catch{warm=true;}},0);};};
 /** Lazily drawn fixtures, commons dressing and native fixtures bring new materials; finish them at most once a second (skinned actors excluded). */
 let backdrop:THREE.Group|null=null;
 const refreshRealism=()=>{const now=performance.now();if(now-realismAt<1000)return;realismAt=now;applyWorldRealism(group,{buildings:true});if(backdrop){applyWorldRealism(backdrop);if(backdrop.parent)applySceneryRealism(backdrop.parent,[group,backdrop]);}};
 const fixtures=academicVenuePlan()!.fixtures;
 const loader=new THREE.TextureLoader(),staticPreviewImage=classroomSlide(0).imageUrl;
 function clearSlide(){generation++;slideKey='';venue!.setProjection(null);for(const texture of textures)texture.dispose();textures.clear();}
 return {group,officeGuards,venue:venue!,sampleVisualGround:(x:number,z:number)=>closed?null:visualGround(x,z),places:[{id:'commons',label:'Inhabited commons',p:[9,5]},{id:'classroom',label:'Classroom · 20 seats',p:[42,-8]},{id:'homes',label:'Furnished neighborhood',p:[44,23]},{id:'forest',label:'Northern woodland',p:[7,-44]},{id:'gardens',label:'Gardens and cultivated plots',p:[52,50]},{id:'dome-quarter',label:'Dome quarter',p:[99.2,36.5]},{id:'amphitheatre',label:'Amphitheatre and observatory',p:[76,82]},{id:'library',label:'Library, office and market',p:[74,5]},{id:'lake',label:'Lake, river and wetlands',p:[-81,1]}],
  replaceCosmeticBackdrop(base:THREE.Group){backdrop=base;realismAt=-Infinity;refreshRealism();prewarm(base);base.traverse(o=>{if(o.name==='outside-ground'&&o.visible){hidden.push(o);o.visible=false;}});},
  sync(nativeEntities:Record<string,unknown>,history=false,seconds=0){if(closed)return;setRealismTime(seconds);stepSurfaceKit(3);if(!warm&&performance.now()-bornAt>4000)warm=true;lastNative=nativeEntities;group.visible=!history&&warm;for(const o of hidden)o.visible=history;if(history){clearSlide();return;}extraPlaces?.sync(nativeEntities,seconds);const missing=fixtures.filter(f=>!Object.hasOwn(nativeEntities,f.id));scenery.onTick({entities:Object.fromEntries(missing.map(f=>[f.id,f]))} as any);scenery.render(0,1);refreshRealism();},
  setSurfaceQuality(quality:'Simple'|'Rich'){if(closed)return false;if(!surfaceStudy&&quality==='Simple')return true;if(!surfaceStudy&&surfaceGroup)try{const own=surfaceGroup;releaseWorldRealism(own.children.flatMap(o=>o instanceof THREE.Mesh&&!(o instanceof THREE.InstancedMesh)&&(o.name.startsWith('NEW expansion cosmetic ground')||o.name.startsWith('Connected countryside and forest path')||o.name.startsWith('Cultivated garden plot'))?[o.material as THREE.Material]:[]));surfaceStudy=createWorldEdenSurfaceStudy(own);}catch{return false;}return surfaceStudy?.setQuality(quality)??false;},
  surfaceInspection(){return surfaceStudy?.inspection()??{quality:'Simple',ownTextures:0,ownMaterials:0,extraMeshes:0,extraGeometry:0,HWFrameQualified:false};},
  setWind(enabled:boolean){windWanted=enabled;},
  updateCosmetics(seconds:number,reducedMotion=false){if(closed)return;extraPlaces?.sync(lastNative,seconds);if(windWanted&&!wind&&windInput)try{const plantMaterials=new Set<THREE.Material>();windInput.group.traverse(o=>{if(o instanceof THREE.Mesh)for(const m of ([] as THREE.Material[]).concat(o.material))plantMaterials.add(m);});releaseWorldRealism(plantMaterials);wind=createWorldEdenWind(windInput.group,windInput.plants);}catch{windWanted=false;}wind?.setEnabled(windWanted);wind?.update(seconds,reducedMotion);},
  placeInspection(){return {omitted:extraPlaces?.omitted??[]};},
  windInspection(){return wind?.inspection()??{enabled:false,batches:0,crowns:0,ownedBufferBytes:0,newTextures:0,extraDraws:0,GPUQualified:false};},
  setLocalPresentation(input:LocalClassroomPresentation|undefined,worldId:string,screenPresent:boolean,history=false){
   if(closed)return;const valid=currentClassroomPresentation(input,worldId,screenPresent,history);const staticPreview=!history&&worldId==='pm-preview-eden-20261005'&&!screenPresent;const key=valid?.imageUrl??(staticPreview?staticPreviewImage:null);venue!.group.userData.projectionMode=valid?'local-current-screen':staticPreview?'local-preview-static':'hidden';if(!key){if(slideKey)clearSlide();return;}if(key===slideKey)return;clearSlide();slideKey=key;const expected=++generation;
   const texture=loader.load(key,()=>{if(closed||expected!==generation){if(textures.delete(texture))texture.dispose();return;}texture.colorSpace=THREE.SRGBColorSpace;venue!.setProjection(texture);},undefined,()=>{if(expected===generation)clearSlide();});textures.add(texture);
  },
  dispose(){if(closed)return;closed=true;setHumanGround(null);setDepthFitGround(null);disposeBuildingIdentity();surfaceStudy?.dispose();surfaceStudy=null;wind?.dispose();wind=null;clearSlide();scenery.dispose();for(const o of hidden)o.visible=true;hidden.length=0;const errors:unknown[]=[];for(const owner of owners.reverse())try{owner.dispose();}catch(e){errors.push(e);}group.removeFromParent();group.clear();if(errors.length)throw new AggregateError(errors,'Eden expansion cleanup');}
 };
}
