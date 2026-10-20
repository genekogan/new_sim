// Captured calm water appearance only. One native-datum plane, no physical waves.
import * as THREE from 'three';
import {inspectNativeShoreTerrain,type NativeShoreTerrainInput} from './native-shore-terrain.ts';
import {FOG_FRAGMENT,FOG_PARS_FRAGMENT,FOG_PARS_VERTEX,FOG_VERTEX,withSceneFog} from './scene-fog.ts';
export type CapturedWaterInput={readonly id:string;readonly datumY:number;readonly wetBoundsXZ:readonly number[]};
type P=[number,number,number];
function waterCopy(input:CapturedWaterInput){
  if(!input||typeof input!=='object'||(Object.getPrototypeOf(input)!==Object.prototype&&Object.getPrototypeOf(input)!==null))throw Error('Unsupported captured water data');
  const keys=Reflect.ownKeys(input),allowed=['id','datumY','wetBoundsXZ'];
  if(keys.length!==allowed.length||keys.some(k=>typeof k!=='string'||!allowed.includes(k)))throw Error('Unsupported captured water keys');
  const d:Record<string,unknown>={};for(const k of allowed){const own=Object.getOwnPropertyDescriptor(input,k);if(!own||!Object.hasOwn(own,'value'))throw Error('Captured water requires own data fields');d[k]=own.value;}
  if(d.id!=='eden-shore-water'||d.datumY!==0)throw Error('Unsupported captured water id or datum');
  if(!Array.isArray(d.wetBoundsXZ)||Reflect.ownKeys(d.wetBoundsXZ).length!==5)throw Error('Unsupported captured water bounds');
  const length=Object.getOwnPropertyDescriptor(d.wetBoundsXZ,'length');if(!length||length.value!==4)throw Error('Unsupported captured water bounds length');
  const expected=[-16,-12,0,12];for(let i=0;i<4;i++){const own=Object.getOwnPropertyDescriptor(d.wetBoundsXZ,String(i));if(!own||!Object.hasOwn(own,'value')||own.value!==expected[i])throw Error('Unsupported captured water bounds values');}
  return{id:'eden-shore-water',datumY:0,wetBoundsXZ:expected};
}
/** Both native terrain and own-data water snapshots refuse before THREE allocation. */
export function inspectCapturedWaterSurface(terrain:NativeShoreTerrainInput,water:CapturedWaterInput){
  const ground=inspectNativeShoreTerrain(terrain),wet=waterCopy(water);
  return{terrain:{...ground,diagonal:'min-min/max-max'},water:wet,vertices:[[-16,0,-12],[0,0,-12],[0,0,12],[-16,0,12]]as P[],indices:[0,2,1,0,3,2],viewTimeRangeSeconds:[0,86400],alpha:{frontOn:.45,grazingIncreaseMax:.10,maximum:.55},appearance:'cosmetic calm-water normals/highlights only; no displacement or native optical/physical certificate'};
}
// Original shore-water.ts recipe adapted locally: same two phase directions,
// weaker slopes/highlights and explicit bounded alpha. No source shader mutation.
// W5: the scene fog (scene-fog.ts) like the land around it; a far pond no longer stays unfogged in rain.
const vertexShader=`varying vec3 vWorld;${FOG_PARS_VERTEX}
void main(){vec4 world=modelMatrix*vec4(position,1.0);vWorld=world.xyz;vec4 mvPosition=viewMatrix*world;gl_Position=projectionMatrix*mvPosition;${FOG_VERTEX}}`;
const fragmentShader=`uniform float uViewTime;uniform float uDaylight;uniform vec3 uBaseColor;uniform float uBaseAlpha;uniform float uGrazingAlpha;varying vec3 vWorld;${FOG_PARS_FRAGMENT}
void main(){
  // Four drifting wave trains (swell to capillary); finer trains fade before they alias. Alpha formula unchanged.
  vec2 p=vWorld.xz;float t=uViewTime;
  vec2 d1=vec2(.82,.57),d2=vec2(-.45,.89),d3=vec2(.97,-.24),d4=vec2(-.71,-.70);
  float a=dot(p,vec2(1.9,.75))+.43*t,b=dot(p,vec2(-.65,3.1))-.27*t;
  float a1=dot(p,d1)*1.3+.9*t,a2=dot(p,d2)*2.3-1.1*t,a3=dot(p,d3)*5.1+1.9*t,a4=dot(p,d4)*8.7-2.6*t;
  float fine=1.0-smoothstep(.6,2.2,fwidth(a4)),mid=1.0-smoothstep(.6,2.2,fwidth(a3));
  vec2 slope=.014*cos(a)*vec2(1.9,.75)+.007*cos(b)*vec2(-.65,3.1)+.026*cos(a1)*d1+.024*cos(a2)*d2+.02*mid*cos(a3)*d3+.017*fine*cos(a4)*d4;
  vec3 normal=normalize(vec3(-slope.x,1.0,-slope.y));
  vec3 light=normalize(vec3(-.35,.8,.2)),eye=normalize(cameraPosition-vWorld);
  float diffuse=.8+.2*max(dot(normal,light),0.0);
  float spec=max(dot(reflect(-light,normal),eye),0.0),highlight=pow(spec,36.0),glint=pow(spec,220.0);
  float grazing=pow(clamp(1.0-abs(dot(normal,eye)),0.0,1.0),3.0),fresnel=pow(clamp(1.0-abs(dot(normal,eye)),0.0,1.0),5.0);
  float swell=.5+.5*sin(a1)*sin(a2);
  vec3 colour=uBaseColor*diffuse*(.9+.16*swell)+vec3(.055,.075,.07)*grazing+vec3(.08,.09,.08)*highlight+vec3(.9,.88,.8)*glint*(.4+.6*fine);
  colour=mix(colour,vec3(.55,.68,.78),fresnel*.35);
  colour+=vec3(.009,.012,.010)*(sin(a)*sin(b));
  // Eden optionally binds scene daylight; the original owner defaults to full day.
  colour*=mix(vec3(.11,.16,.23),vec3(1.0),clamp(uDaylight,0.0,1.0));
  gl_FragColor=vec4(colour,uBaseAlpha+uGrazingAlpha*grazing);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>${FOG_FRAGMENT}}`;
export function createCapturedWaterSurface(terrain:NativeShoreTerrainInput,water:CapturedWaterInput):{group:THREE.Group;setViewTime(seconds:number):void;dispose():void}{
  const spec=inspectCapturedWaterSurface(terrain,water),group=new THREE.Group();group.name='Captured native-datum calm-water appearance';
  const geometry=new THREE.BufferGeometry();let material:THREE.ShaderMaterial|undefined;let mesh:THREE.Mesh<THREE.BufferGeometry,THREE.ShaderMaterial>|undefined;
  const release=()=>{const errors:unknown[]=[];for(const f of[()=>group.removeFromParent(),()=>geometry.dispose(),()=>material?.dispose(),()=>group.clear()])try{f();}catch(e){errors.push(e);}return errors;};
  try{
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(spec.vertices.flat(),3));geometry.setIndex(spec.indices);geometry.computeVertexNormals();
    material=withSceneFog(new THREE.ShaderMaterial({uniforms:{uViewTime:{value:0},uDaylight:{value:1},uBaseColor:{value:new THREE.Color('#4f969b')},uBaseAlpha:{value:spec.alpha.frontOn},uGrazingAlpha:{value:spec.alpha.grazingIncreaseMax}},vertexShader,fragmentShader,transparent:true,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true}));
    mesh=new THREE.Mesh(geometry,material);mesh.name='eden-shore-water';mesh.castShadow=false;group.add(mesh);
  }catch(error){const errors=release();if(errors.length)throw new AggregateError([error,...errors],'Captured water creation and rollback failed',{cause:error});throw error;}
  const ownedMaterial=material;let closed=false;
  return{group,setViewTime(seconds:number){if(closed)throw Error('Captured water surface disposed');if(!Number.isFinite(seconds)||seconds<0||seconds>86400)throw Error('View time must be finite seconds in [0,86400]');ownedMaterial.uniforms.uViewTime.value=seconds;},dispose(){if(closed)return;closed=true;const errors=release();if(errors.length)throw new AggregateError(errors,'Captured water surface disposal failed',{cause:errors[0]});}};
}
