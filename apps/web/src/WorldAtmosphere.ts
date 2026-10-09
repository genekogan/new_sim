import {twilightColour} from './atmosphere/twilight.ts';
import * as THREE from 'three';
import {WIND,WindPatches} from './atmosphere/wind.ts';
import {Fauna} from './atmosphere/fauna.ts';
import {Balloons} from './atmosphere/balloons.ts';
import {Fireflies,Smoke} from './atmosphere/particles.ts';
import {findAnchors,underCover} from './atmosphere/finder.ts';
import {insideBuilding} from './atmosphere/indoors.ts';
import {installAtmosphereChunks,ATMOS,MIST,SHEEN,NOISE_MAP} from './atmosphere/chunks.ts';
import {SkyDome} from './atmosphere/sky.ts';
import {MotionPatches,ROTOR,RIPPLE,SKY_OBJECTS} from './atmosphere/motion.ts';
import {Rain} from './atmosphere/rain.ts';
import {Halos} from './atmosphere/halos.ts';
import {Lighthouse} from './atmosphere/lighthouse.ts';
import {FogBanks} from './atmosphere/fogbanks.ts';
import {SURF} from '../../../mars/viewer/app/engine-view/content/assets/eden-regions/coast-surf.ts';
import {skyBodies,type SkyBodies} from './atmosphere/astro.ts';
import {setGrade,clearGrade} from './atmosphere/grade.ts';
import {setWindowLife} from './WorldNightLights.ts';
import {ScaledNumber,TintedColor,overcast} from './atmosphere/lighting.ts';
import {type WeatherState,type WeatherKind,type WeatherOverride,weatherKindAt,targetFor,easeWeather,copyWeather,parseWeatherOverride,cycleKind,clockMs,hourOf,hash01} from './atmosphere/weather.ts';
/** World Motion & Weather lane entry point (owned by that lane): wind, flags,
 * birds, smoke, water motion, clouds, rain, fog. Presentation only.
 *
 * Everything here is decorative: no simulation, entity or camera authority.
 * Own objects live directly under the scene root (never inside a camera
 * visibility/raycast root). Other modules are found by traversing the given
 * scene at most once every few seconds; with `eden` false every change is
 * restored. URL overrides for review: `?weather=clear|cloudy|rain|wind|fog` (applied at once),
 * `cycle` (45 s each), `afterrain` (rain clearing → wet ground, rainbow), `off` (atmosphere fully off).
 *
 * Map (atmosphere/): weather.ts deterministic schedule + easing (pure); chunks.ts fog-chunk patch
 * (fog layer, low mist, cloud shadows, wet ground/puddles; one noise texture); wind.ts plant/cloth
 * sway by material patch; motion.ts windmill sails, fountain ripples, ornamental clouds; sky.ts dome
 * (clouds, stars, rainbow); rain.ts rain + blown leaves; fauna.ts birds/gulls/ducks/butterflies;
 * particles.ts fireflies/moths and chimney smoke; finder.ts the periodic scene scan; lighting.ts
 * exact multiply/restore of Daylight-owned values. */
export type AtmosphereFrame={seconds:number;dt:number;daylight:number|null;camera:THREE.Camera;eden:boolean;reducedMotion:boolean;
 /** World clock (ISO) when the caller has it; weather falls back to the wall clock. */
 clock?:string|null};
export type AtmosphereInspection={active:boolean;rotor:boolean;fountainWater:number;skyClouds:number;kind:WeatherKind|null;state:WeatherState;windMaterials:number;windModes:Record<string,number>;smokeSources:number;flowers:number;meadow:number;roofs:number;water:number;harbour:boolean;scans:number;drawCalls:number};
const SCAN_AT=[0,1.5,5,12,25,45];const RESCAN_EVERY=30;
const WHITE=new THREE.Color(1,1,1);
const pulse=(u:number,c:number,w:number)=>{const x=(u-c)/w;return Math.exp(-x*x);};
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function createWorldAtmosphere(scene:THREE.Scene):{update(frame:AtmosphereFrame):void;dispose():void;inspect():AtmosphereInspection}{
 const override:WeatherOverride=typeof location!=='undefined'?parseWeatherOverride(location.search):null;
 const root=new THREE.Group();root.name='atmosphere (decorative; not a camera root)';root.userData.cameraTransparent=true;
 const fauna=new Fauna(),fireflies=new Fireflies(),smoke=new Smoke(),sky=new SkyDome(),rain=new Rain(),balloons=new Balloons(),halos=new Halos(),lighthouse=new Lighthouse(),fogBanks=new FogBanks();
 root.add(sky.mesh,fauna.mesh,fireflies.points,smoke.points,rain.lines,balloons.mesh,halos.mesh,lighthouse.group,fogBanks.mesh);
 // Fog is installed once, before anything compiles, at zero density (inert) so weather never recompiles programs.
 installAtmosphereChunks();sky.uniforms.uNoise.value=NOISE_MAP.value;
 const fog=new THREE.FogExp2(0xffffff,0);const ownsFog=!scene.fog;if(ownsFog)scene.fog=fog;
 const lights:{sun:ScaledNumber|null;hemi:ScaledNumber|null;sunLight:THREE.DirectionalLight|null}={sun:null,hemi:null,sunLight:null};
 const background=new TintedColor(()=>(scene.background as THREE.Color|null)?.isColor?scene.background as THREE.Color:null);
 const cWarm=new THREE.Color(),cSky=new THREE.Color(),cGrey=new THREE.Color(),cFog=new THREE.Color(),cTmp=new THREE.Color(),sunDir=new THREE.Vector3();
 let driftX=0,driftZ=0;
 const wind=new WindPatches(),motion=new MotionPatches();let sailAngle=0;
 const own=(o:THREE.Object3D)=>o===root;
 const state:WeatherState={cloud:0,rain:0,wind:0,fog:0,mist:0,wet:0},target:WeatherState={...state};
 let clockAt=0,clockNow=0,active=false,closed=false,initialised=false,expansionSeen=-1,scans=0,nextScan=0,kind:WeatherKind|null=null,lastFound={flowers:0,meadow:0,roofs:0,water:0,harbour:false};
 // Pixel scale for world-sized point sprites, read where the renderer is known (no allocation).
 const size=new THREE.Vector2();
 const pointScale=function(this:THREE.Points,renderer:THREE.WebGLRenderer,_s:THREE.Scene,camera:THREE.Camera){
  renderer.getDrawingBufferSize(size);const fov=(camera as THREE.PerspectiveCamera).isPerspectiveCamera?(camera as THREE.PerspectiveCamera).fov:50;
  const k=size.y/(2*Math.tan(fov*Math.PI/360));fireflies.uniforms.uFly.value.z=k;smoke.uniforms.uSmoke.value.z=k;};
 fireflies.points.onBeforeRender=pointScale;smoke.points.onBeforeRender=pointScale;
 halos.mesh.onBeforeRender=function(renderer:THREE.WebGLRenderer,_s:THREE.Scene,camera:THREE.Camera){renderer.getDrawingBufferSize(size);
  const fov=(camera as THREE.PerspectiveCamera).isPerspectiveCamera?(camera as THREE.PerspectiveCamera).fov:50;halos.uniforms.uHalo.value.z=size.y/(fov*Math.PI/180);};
 // Sky bodies (sun, moon and phase, star rotation) from the world clock, recomputed about once a second.
 let bodies:SkyBodies|null=null,bodiesAt=-Infinity,bodiesClock='';
 const lightList:[number,number,number,string,number][]=[],lv=new THREE.Vector3();
 /** Published night lights (lamps, lanterns, fires) in world space, for the glow sprites. */
 function collectLights(){lightList.length=0;scene.updateWorldMatrix(true,false);
  scene.traverse(o=>{if(o===root)return;const list=o.userData?.edenLightSources;if(!Array.isArray(list))return;o.updateWorldMatrix(true,false);
   for(const a of list){if(!Array.isArray(a)||a.length<3)continue;lv.set(+a[0],+a[1],+a[2]).applyMatrix4(o.matrixWorld);lightList.push([lv.x,lv.y,lv.z,String(a[3]??'lamp'),a[4]===undefined?1:+a[4]]);}});
  // The commons campfire (native fixture) and the garden fire circle publish no anchors of their own.
  if(lightList.length)lightList.push([24,0,-7,'fire',1],[47,0,64,'fire',.8]);
  halos.setSources(lightList);}
 function scan(seconds:number){
  wind.scan(scene,scans,scans===0?0:1,own);motion.scan(scene,own);
  const f=findAnchors(scene,own,!fauna.ducksPlaced);covers=f.covers;
  if(f.sun&&f.sun!==lights.sunLight){lights.sun?.restore();const sun=f.sun;lights.sun=new ScaledNumber(()=>sun.intensity,v=>{sun.intensity=v;});lights.sunLight=sun;}
  if(f.hemi&&!lights.hemi){const hemi=f.hemi;lights.hemi=new ScaledNumber(()=>hemi.intensity,v=>{hemi.intensity=v;});}
  if(f.flowers.length)fauna.setFlowers(f.flowers);if(f.water.length)fauna.setWater(f.water);if(f.harbour)fauna.setGulls(f.harbour.x,f.harbour.z);if(f.roofs.length)fauna.setPerches(f.roofs);if(f.meadow.length)fireflies.setSites(f.meadow);if(f.lamps.length)fireflies.setLamps(f.lamps);smoke.setSources(f.smoke);
  lastFound={flowers:f.flowers.length,meadow:f.meadow.length,roofs:f.roofs.length,water:f.water.length,harbour:!!f.harbour};
  collectLights();
  scans++;const since=seconds-expansionSeen;nextScan=expansionSeen+(scans<SCAN_AT.length?SCAN_AT[scans]:since+RESCAN_EVERY);
 }
 function deactivate(){
  if(!active)return;active=false;WIND.value.y=0;root.visible=false;
  lights.sun?.restore();lights.hemi?.restore();background.restore();clearGrade();halos.mesh.visible=false;fog.density=0;MIST.value.x=0;MIST.value.w=0;ATMOS.value.x=0;SHEEN.value.w=0;RIPPLE.value.y=0;SURF.value.y=0;SKY_OBJECTS.value.x=SKY_OBJECTS.value.y=0;SKY_OBJECTS.value.z=1;ROTOR.value.w=sailAngle=0;
 }
 /** Clouds dim the sun and grey the sky; fog/mist thicken the air; rain wets the ground. */
 function applyWeather(frame:AtmosphereFrame,day:number){
  const base=background.sample();
  skyWanted=!!base;sky.mesh.visible=skyWanted;
  if(base){
   overcast(base,cGrey);cSky.copy(base).lerp(cGrey,state.cloud*.8);
   cFog.copy(cGrey).multiplyScalar(1.08+.1*day).lerp(cSky,.35);
   cTmp.copy(cSky).lerp(cFog,Math.min(1,state.fog*.9+state.rain*.25));background.write(cTmp);
   fog.color.copy(cFog);SHEEN.value.x=cSky.r;SHEEN.value.y=cSky.g;SHEEN.value.z=cSky.b;
   // Sky dome: zenith = the (weathered) background, hazier toward the horizon.
   sky.uniforms.uZenith.value.copy(cTmp).multiplyScalar(.94);
   sky.uniforms.uHorizon.value.copy(cTmp).lerp(WHITE,.16*day).lerp(cFog,Math.min(1,state.fog+state.mist*.3));
   // Clouds: bright and silver by day; at night barely distinct from the sky.
   // ... and warm-lit by a low sun (Daylight warms the sun colour at dawn/dusk).
   cTmp.copy(cGrey).lerp(WHITE,.55);if(lights.sunLight)cTmp.multiply(cWarm.copy(WHITE).lerp(lights.sunLight.color,.85).multiplyScalar(1.12));
   sky.uniforms.uCloudLit.value.copy(cGrey).multiplyScalar(1.12).lerp(cTmp,Math.min(1,day*1.4));
   sky.uniforms.uCloudShade.value.copy(cGrey).multiplyScalar(.88-.24*day);
  }
  // Fog is a ground layer: looking down from high up (overview) passes through less of it.
  mistWanted=Math.min(1,state.mist+state.fog*.35);
  forCamera(frame.camera);
  lights.sun?.apply(1-.72*state.cloud);lights.hemi?.apply(1-.1*state.cloud-.08*state.fog);
  // Cloud shadows drift downwind; fewer but crisper in fair weather, broad and faint under overcast.
  const drift=frame.reducedMotion?0:(2+6*state.wind)*.011*Math.min(frame.dt,.25);driftX=(driftX+WIND.value.z*drift)%1000;driftZ=(driftZ+WIND.value.w*drift)%1000;
  ATMOS.value.x=day*(.28*(1-state.cloud)+.1)*(1-state.fog*.8);ATMOS.value.y=.74-state.cloud*.42;ATMOS.value.z=-driftX;ATMOS.value.w=-driftZ;
  MIST.value.w=state.wet;
  sky.uniforms.uCloud.value.set(Math.min(1,.18+.82*state.cloud+state.rain*.1),driftX*2.2,driftZ*2.2,day);
  const sun=lights.sunLight;if(sun){sunDir.copy(sun.position).sub(sun.target.position).normalize();sky.uniforms.uSunDir.value.copy(sunDir);}
  // A rainbow opposite the sun once rain passes while the ground is still wet.
  sky.uniforms.uBow.value.x=smooth(.3,.8,state.wet)*(1-smooth(.08,.35,state.rain))*(1-smooth(.5,.8,state.cloud))*smooth(.4,.8,day);
  // Stars on clear nights (clouds and fog hide them).
  sky.uniforms.uBow.value.y=(1-smooth(.05,.3,day))*(1-smooth(.3,.75,state.cloud))*(1-state.fog)*(1-state.mist*.5);sky.uniforms.uBow.value.z=frame.reducedMotion?0:frame.seconds%600;
  // Distant lightning in a storm: brief double pulses in the cloud deck only (no scene light flash), a few per minute.
  const storm=frame.reducedMotion?0:smooth(.9,.99,state.cloud)*smooth(.8,.97,state.rain)*smooth(.65,.8,state.wind);
  let flash=0;
  if(storm>0){const cell=Math.floor(frame.seconds/9),u=frame.seconds-cell*9-hash01(cell,71)*7;
   if(hash01(cell,72)<.55*storm&&u>0&&u<.6){flash=(pulse(u,.02,.05)+.65*pulse(u,.2,.05)+.3*pulse(u,.34,.04))*storm;
    const a=hash01(cell,73)*Math.PI*2;sky.uniforms.uFlash.value.set(0,Math.cos(a)*.96,.28,Math.sin(a)*.96);}}
  sky.uniforms.uFlash.value.x=flash;
  // Sky bodies, dawn/dusk glow, night-sky visibility and the colour grade.
  if(frame.clock&&(Math.abs(frame.seconds-bodiesAt)>=1||Math.abs((Date.parse(frame.clock)||0)-(Date.parse(bodiesClock)||0))>60e3)){bodiesAt=frame.seconds;bodiesClock=frame.clock;bodies=skyBodies(frame.clock,bodies??undefined)??bodies;}
  if(!frame.clock)bodies=null;
  const u=sky.uniforms,b=bodies;
  if(b){const sunUp=smooth(-1.2,.8,b.sunElevation);u.uSun.value.set(b.sun.x,b.sun.y,b.sun.z,sunUp*(1-state.fog*.9));
   if(lights.sunLight)u.uSunColor.value.copy(lights.sunLight.color);
   const moonUp=smooth(-1.5,1.5,Math.asin(Math.max(-1,Math.min(1,b.moon.y)))*180/Math.PI);
   u.uMoon.value.set(b.moon.x,b.moon.y,b.moon.z,moonUp*(.3+.7*(1-day))*(1-state.fog*.85));
   u.uMoonLight.value.set(b.illumination,1-smooth(.05,.4,day),1-.75*b.illumination,0);
   u.uStarRot.value.copy(b.starRotation);
   // warm band on the sun's side at dawn/dusk, into a rosy-violet afterglow in the blue hour; less under cloud
   const dusk=(b.warmth*smooth(-.2,.6,day)*.55+b.blueHour*.35)*(1-.75*state.cloud)*(1-state.fog);
   if(lights.sunLight)cWarm.copy(lights.sunLight.color).lerp(cTmp.setRGB(1,.55,.38),.5).lerp(cTmp.setRGB(.62,.42,.62),b.blueHour*.7);else cWarm.setRGB(1,.6,.4);
   const glow=twilightColour(b.sunElevation,state.cloud,Math.floor(clockNow/86400000));
   cWarm.lerp(cTmp.setRGB(...glow.rgb),glow.strength*.6);
   u.uDusk.value.set(cWarm.r,cWarm.g,cWarm.b,dusk+glow.strength*.12*(1-state.fog));
   u.uCloudLit.value.lerp(cTmp.setRGB(...glow.rgb).multiplyScalar(.95),glow.strength*.28*(1-state.fog));
   sky.uniforms.uBow.value.y*=1-.5*b.illumination*moonUp;
   setGrade(day,b.warmth,b.blueHour,state.cloud);
  }else{u.uSun.value.w=0;u.uMoon.value.w=0;u.uDusk.value.w=0;u.uMoonLight.value.set(0,0,1,0);setGrade(day,0,0,state.cloud);}
  halos.update(frame.reducedMotion?0:frame.seconds,Math.pow(1-day,1.5));
  sky.follow(frame.camera);
 }
 /** Camera-dependent parts, redone for every render of the scene (the viewer camera, and on-demand eyes /
  * overhead / map snapshots): fog is a ground layer (thin from high up, none for orthographic map views),
  * and rain/sky follow whichever camera is drawing. */
 const camAt=new THREE.Vector3();let mistWanted=0,rainWanted=false,covers:number[]=[];
 function forCamera(camera:THREE.Camera){
  const ortho=!!(camera as THREE.OrthographicCamera).isOrthographicCamera;camera.getWorldPosition(camAt);
  const indoors=!ortho&&(insideBuilding(camAt.x,camAt.y,camAt.z)||underCover(covers,camAt));
  const layer=ortho?0:(indoors?.25:1)/(1+Math.max(0,camAt.y-6)/10);
  fog.density=ortho?0:.0009+(state.fog*.022+state.rain*.0055)*layer+state.cloud*.0006;
  MIST.value.x=ortho||indoors?0:mistWanted;
  sky.uniforms.uBow.value.w=Math.min(.9,state.fog*.9*layer+state.rain*.25);
  // No rain, leaves or motes for a camera indoors / under a roof (they are camera-local and would fall through ceilings).
  rain.lines.visible=rainWanted&&!ortho&&!indoors;rain.uniforms.uCam.value.copy(camAt);
  sky.mesh.visible=skyWanted&&!ortho;if(!ortho){sky.mesh.position.copy(camAt);sky.mesh.updateMatrix();sky.mesh.updateMatrixWorld(true);}
 }
 let skyWanted=false;
 // Capture the callback value; disposal restores this exact function, and invocation below supplies its Scene receiver.
 const previousBeforeRender=Reflect.get(scene,'onBeforeRender') as THREE.Object3D['onBeforeRender'];
 const beforeRender:THREE.Object3D['onBeforeRender']=function(this:THREE.Object3D,renderer,s,camera,geometry,material,group){
  previousBeforeRender.call(this,renderer,s,camera,geometry,material,group);if(active&&!closed)forCamera(camera);};
 scene.onBeforeRender=beforeRender;
 function windDirection(seconds:number,ms:number){
  const day=Math.floor(ms/86_400_000),a=hash01(day,313)*Math.PI*2+Math.sin(seconds/420)*.35;
  WIND.value.z=Math.cos(a);WIND.value.w=Math.sin(a);
 }
 const api={
  update(frame:AtmosphereFrame){
   if(closed)return;
   if(!frame.eden||override?.kind==='off'){deactivate();return;}
   const seconds=frame.seconds;
   // `eden` means the expansion is in the scene this frame: scan now so wind patches compile with its pre-warm.
   if(expansionSeen<0){expansionSeen=seconds;nextScan=seconds;}
   if(seconds>=nextScan)scan(seconds);
   // Weather target from the world clock (or the review override), eased over minutes.
   // (Re)read the clock about once a second: the schedule is coarse, and this keeps frames allocation-free.
   if(!initialised||Math.abs(seconds-clockAt)>=1){clockAt=seconds;clockNow=clockMs(frame.clock)??Date.now();const hour=frame.daylight===null?null:hourOf(clockNow);
    kind=override?.kind==='cycle'?cycleKind(seconds):override?override.kind as WeatherKind:weatherKindAt(clockNow);targetFor(kind,hour,target);
    if(!initialised&&override?.from)targetFor(override.from,hour,state);}
   const ms=clockNow;
   if(!initialised){if(!override?.from)copyWeather(state,target);initialised=true;}else easeWeather(state,target,frame.dt*(override?.kind==='cycle'?4:1));
   windDirection(seconds,ms);
   // Rooms behind lit windows switch on and off with the hour of the world clock.
   setWindowLife(frame.daylight===null?null:hourOf(ms),frame.reducedMotion?0:seconds);
   const day=frame.daylight===null?1:Math.max(0,Math.min(1,frame.daylight)),still=frame.reducedMotion;
   applyWeather(frame,day);
   if(!active){active=true;if(!root.parent)scene.add(root);root.visible=true;}
   const t=seconds%7200;
   // Wind: calm breeze .28 .. gale 1 (the shader adds travelling gusts).
   WIND.value.x=t;WIND.value.y=still?0:.15+state.wind*.95;
   // Windmill sails turn with the wind (angle integrated, so speed changes never jump); fountain ripples.
   if(!still)sailAngle=(sailAngle+Math.min(frame.dt,.25)*(.18+state.wind*1.1))%(Math.PI*2);ROTOR.value.w=sailAngle;
   // The static ornamental sky clouds drift slowly to and fro downwind and grey under overcast.
   if(!still){const a=seconds/170,b=seconds/97;SKY_OBJECTS.value.x=WIND.value.z*14*Math.sin(a)-WIND.value.w*5*Math.sin(b);SKY_OBJECTS.value.y=WIND.value.w*14*Math.sin(a)+WIND.value.z*5*Math.sin(b);}
   SKY_OBJECTS.value.z=(1-.5*state.cloud-.15*state.rain)*(.3+.7*day);
   RIPPLE.value.x=t;RIPPLE.value.y=still?0:1;MIST.value.y=still?0:seconds%600;SHEEN.value.w=still?0:state.rain;
   const birds=still?0:Math.max(0,Math.min(1,(day-.15)/.35))*(1-state.rain*.9)*(1-state.fog*.6)*(1-Math.max(0,state.wind-.7)*1.5);
   const butterflies=still?0:Math.max(0,Math.min(1,(day-.4)/.3))*(1-state.rain)*(1-state.cloud*.5)*(1-state.wind*.6);
   fauna.update(t,birds,butterflies,day,still?0:1);
   // the lighthouse sweeps from dusk to dawn, its beam stronger in mist and fog
   lighthouse.update(still?0:t,Math.pow(1-day,1.5),state.fog+state.mist*.5+state.rain*.3);
   // fog banks roll over the sea in fog and mist, and on still early mornings
   {const h=hourOf(ms),dawn=smooth(4.5,6.5,h)*(1-smooth(8.5,10.5,h));fogBanks.update(still?0:t,Math.min(1,state.fog*1.1+state.mist*.6+dawn*.45*(1-state.wind)*(1-state.rain)),WIND.value.z,WIND.value.w,state.wind,fog.color);}
   // the sea: swell and surf (livelier in wind; still for reduced motion)
   SURF.value.x=still?0:t;SURF.value.y=1;SURF.value.z=state.wind;
   if(!still)balloons.update(t);
   fireflies.update(t,still?0:Math.max(0,1-day*3)*(1-state.rain)*(1-state.wind*.7),fireflies.uniforms.uFly.value.z);
   smoke.update(t,still?0:1-state.rain*.5,smoke.uniforms.uSmoke.value.z,day,WIND.value.z,WIND.value.w,state.wind);
   // Autumn leaves blow through in wind (a few drift down on any breezy day).
   const leaves=still?0:Math.max(0,Math.min(1,(state.wind-.3)/.5))*(1-state.rain*.7)*(.15+.85*Math.min(1,day*2));
   // Rain comes in heavier and lighter spells (smooth, tens of seconds) rather than at a constant rate.
   const spell=.72+.18*Math.sin(seconds*.037+1.3)+.1*Math.sin(seconds*.11+.4);
   // Sunlit pollen/seed motes drift near the camera on fair, breezy-but-not-windy days.
   const motes=still?0:smooth(.45,.8,day)*(1-smooth(.35,.7,state.cloud))*(1-smooth(.6,.9,state.wind))*(1-state.rain)*(1-state.fog);
   // ... and in a real wind the same particles become fine dust skimming low over the ground (desert setting); dry ground only.
   const dust=still?0:smooth(.65,.95,state.wind)*(1-smooth(.15,.4,state.wet));
   rain.update2(t,still?0:state.rain*spell,leaves,day,frame.camera,WIND.value.z,WIND.value.w,state.wind,Math.max(motes,dust),dust>motes?1:0);rainWanted=rain.lines.visible;
  },
  inspect(){return {active,kind,state:{...state},rotor:motion.rotorFound,fountainWater:motion.waterFound,skyClouds:motion.skyClouds,windMaterials:wind.count,windModes:wind.modes(),smokeSources:smoke.sourceCount,flowers:lastFound.flowers,meadow:lastFound.meadow,roofs:lastFound.roofs,water:lastFound.water,harbour:lastFound.harbour,scans,drawCalls:root.children.filter(o=>o.visible).length};},
  dispose(){if(closed)return;closed=true;if(review&&(globalThis as Record<string,unknown>).edenAtmosphere===api)delete (globalThis as Record<string,unknown>).edenAtmosphere;deactivate();wind.dispose();motion.dispose();fauna.dispose();balloons.dispose();fireflies.dispose();smoke.dispose();sky.dispose();rain.dispose();halos.dispose();lighthouse.dispose();fogBanks.dispose();root.removeFromParent();if(ownsFog&&scene.fog===fog)scene.fog=null;if(scene.onBeforeRender===beforeRender)scene.onBeforeRender=previousBeforeRender;},
 };
 // Review hook (only with ?weather=… or ?atmos in the URL): window.edenAtmosphere.inspect() in the console.
 const review=typeof location!=='undefined'&&/[?&](weather|atmos)\b/.test(location.search);
 if(review)(globalThis as Record<string,unknown>).edenAtmosphere=api;
 return api;
}
