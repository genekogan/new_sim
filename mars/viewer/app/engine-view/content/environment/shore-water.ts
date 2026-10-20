// Cosmetic original water normals/colour; flat true datum, never native wave contacts.
import * as THREE from 'three';
import { ThreeResources } from '../../../../lib/three-resources.ts';
import type { ShoreDesign } from '../../shore-preview.ts';
import type { ContentView } from './commons.ts';
import { dryShoreInspection } from './dry-shore.ts';
import { FOG_FRAGMENT, FOG_PARS_FRAGMENT, FOG_PARS_VERTEX, FOG_VERTEX, withSceneFog } from './scene-fog.ts';
export function inspectShoreWater(design:ShoreDesign){
  dryShoreInspection(design); // accepted full bounded grid/known rectangle preflight, no geometry
  if(design.water.datumY!==0)throw Error('Water appearance requires pinned datum Y0');
  return {nativeDatumY:0,cosmeticOffsetY:.003,vertices:[[-16,.003,-12],[0,.003,-12],[0,.003,12],[-16,.003,12]],indices:[0,2,1,0,3,2],viewTimeRangeSeconds:[0,86400],appearance:'flat teal surface with cosmetic normals/colour only'};
}
// W5: the scene fog (scene-fog.ts), like the land around it.
const vertexShader=`varying vec3 vWorld;${FOG_PARS_VERTEX}
void main(){vec4 world=modelMatrix*vec4(position,1.0);vWorld=world.xyz;vec4 mvPosition=viewMatrix*world;gl_Position=projectionMatrix*mvPosition;${FOG_VERTEX}}`;
const fragmentShader=`uniform float uViewTime;uniform vec3 uBaseColor;varying vec3 vWorld;${FOG_PARS_FRAGMENT}
void main(){
  float a=dot(vWorld.xz,vec2(1.9,.75))+.43*uViewTime;
  float b=dot(vWorld.xz,vec2(-.65,3.1))-.27*uViewTime;
  vec2 slope=.025*cos(a)*vec2(1.9,.75)+.012*cos(b)*vec2(-.65,3.1);
  vec3 normal=normalize(vec3(-slope.x,1.0,-slope.y));
  vec3 light=normalize(vec3(-.35,.8,.2)),eye=normalize(cameraPosition-vWorld);
  float diffuse=.78+.22*max(dot(normal,light),0.0);
  float highlight=pow(max(dot(reflect(-light,normal),eye),0.0),36.0);
  float grazing=pow(1.0-abs(dot(normal,eye)),3.0);
  vec3 colour=uBaseColor*diffuse+vec3(.12,.17,.17)*grazing+vec3(.16,.17,.14)*highlight;
  colour+=vec3(.018,.024,.019)*(sin(a)*sin(b));
  gl_FragColor=vec4(colour,.9);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>${FOG_FRAGMENT}}`;
export function createShoreWater(design:ShoreDesign):ContentView & {setViewTime(seconds:number):void}{
  const data=inspectShoreWater(design),group=new THREE.Group(),resources=new ThreeResources();group.name='Flat shore cosmetic water appearance';
  const geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(data.vertices.flat(),3));geometry.setIndex(data.indices);geometry.computeVertexNormals();
  const material=withSceneFog(new THREE.ShaderMaterial({uniforms:{uViewTime:{value:0},uBaseColor:{value:new THREE.Color('#4f969b')}},vertexShader,fragmentShader,transparent:true,depthWrite:false,side:THREE.DoubleSide}));
  const mesh=new THREE.Mesh(geometry,material);mesh.name='flat native datum plus cosmetic .003 water';group.add(mesh);resources.object(group);let closed=false;
  return {group,setViewTime(seconds:number){if(closed)throw Error('Water appearance disposed');if(!Number.isFinite(seconds)||seconds<0||seconds>86400)throw Error('View time must be finite seconds in [0,86400]');material.uniforms.uViewTime.value=seconds;},dispose(){if(closed)return;closed=true;const errors:unknown[]=[];
    // Capture the created owners, never a later borrowed mesh replacement.
    try{group.removeFromParent();}catch(error){errors.push(error);}
    for(const owner of new Set<THREE.BufferGeometry|THREE.Material>([geometry,material])){try{owner.dispose();}catch(error){errors.push(error);}}
    try{group.remove(mesh);}catch(error){errors.push(error);}
    if(errors.length)throw new AggregateError(errors,'Water appearance disposal failed');
  }};
}
