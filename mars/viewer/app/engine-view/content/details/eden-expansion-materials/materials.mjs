import * as T from 'three';
import {sidecarPixels} from '../candidate05-rich-sidecar/pixels.mjs';
/** Materials for NEW owned Eden assembly only. This is not a selector for existing scene materials. */
export const EDEN_FINISHES=Object.freeze(Object.fromEntries(Object.entries({
 'classroom-timber':{color:'#b99b73',roughness:.91,metalness:0,recipe:'timber'},
 'classroom-stone':{color:'#b8b2a4',roughness:.96,metalness:0},
 'house-wall-ivory':{color:'#ddd4bc',roughness:.97,metalness:0},
 'house-wall-sand':{color:'#cdbfa7',roughness:.97,metalness:0},
 'house-wall-sage':{color:'#b7bdae',roughness:.97,metalness:0},
 'garden-soil':{color:'#70533b',roughness:1,metalness:0,recipe:'soil'},
 'path-gravel':{color:'#baae91',roughness:1,metalness:0,recipe:'gravel'},
 'forest-bark':{color:'#70533b',roughness:.98,metalness:0,recipe:'bark'},
 'canopy-leaf':{color:'#52734a',roughness:1,metalness:0},
 'orchard-leaf':{color:'#5b7f4c',roughness:1,metalness:0},
 'meadow-green':{color:'#82915c',roughness:1,metalness:0,side:T.DoubleSide},
 'bank-stone':{color:'#aaa694',roughness:.97,metalness:0},
 'wetland-soil':{color:'#695c49',roughness:1,metalness:0,recipe:'soil'},
 'orchard-soil':{color:'#725943',roughness:1,metalness:0,recipe:'soil'},
 'bridge-timber':{color:'#a38968',roughness:.94,metalness:0,recipe:'timber'},
 'farm-timber':{color:'#aa906b',roughness:.92,metalness:0,recipe:'timber'},
 'farm-wall':{color:'#c5bda5',roughness:.98,metalness:0},
 'birch-palette-bark':{color:'#ffffff',roughness:1,metalness:0,vertexColors:true,flatShading:true},
 'birch-palette-leaf':{color:'#ffffff',roughness:.96,metalness:0,vertexColors:true,flatShading:true},
 'bankstone-palette':{color:'#ffffff',roughness:1,metalness:0,vertexColors:true,flatShading:true},
 'arid-dust-palette':{color:'#ffffff',roughness:1,metalness:0,vertexColors:true},
 'volcanic-ground-palette':{color:'#ffffff',roughness:.94,metalness:.06,vertexColors:true},
 'volcanic-rock-palette':{color:'#ffffff',roughness:.65,metalness:.06,vertexColors:true},
 'classroom-shell-timber':{color:'#73583f',roughness:.9,metalness:0,recipe:'timber'},
 'classroom-shell-plaster':{color:'#e3d6bd',roughness:.9,metalness:0},
 'classroom-shell-stone':{color:'#a79880',roughness:.9,metalness:0},
 'original-platform-timber':{color:'#a7784f',roughness:1,metalness:0,recipe:'timber'},
 'meadow-authored-grass':{color:'#ffffff',roughness:1,metalness:0,side:T.DoubleSide,vertexColors:true},
 'birch-neutral-bark':{color:'#ffffff',roughness:1,metalness:0,vertexColors:true,flatShading:true,recipe:'bark',projection:'triplanar',gain:1.25},
 'birch-original-leaf':{color:'#ffffff',roughness:1,metalness:0,vertexColors:true,flatShading:true},
 'new-ground-neutral-grass':{color:'#ffffff',roughness:1,metalness:0,vertexColors:true,recipe:'grass'},
}).map(([k,v])=>[k,Object.freeze(v)])));
const data=o=>!!o&&Object.getPrototypeOf(o)===Object.prototype&&Object.values(Object.getOwnPropertyDescriptors(o)).every(d=>'value'in d);
const fallback=reason=>Object.freeze({quality:'Simple',material:null,owned:false,reason,dispose(){return Object.freeze({closed:true,attempts:0,faults:Object.freeze([])});}});
const vertex=T.ShaderLib.standard.vertexShader,fragment=T.ShaderLib.standard.fragmentShader;
const chunks=['begin_vertex','map_fragment','roughnessmap_fragment'].map(k=>T.ShaderChunk[k]);
const exact=s=>T.REVISION==='185'&&T.ShaderLib.standard.vertexShader===vertex&&T.ShaderLib.standard.fragmentShader===fragment&&chunks.every((v,i)=>T.ShaderChunk[['begin_vertex','map_fragment','roughnessmap_fragment'][i]]===v)&&s.vertexShader===vertex&&s.fragmentShader===fragment&&vertex.split('#include <begin_vertex>').length===2&&['map_fragment','roughnessmap_fragment'].every(k=>fragment.split('#include <'+k+'>').length===2);
/** A new material owned by caller's new assembly; never clones or assigns a borrowed source material. */
export function createEdenFinish(input){
 if(!data(input)||!Object.hasOwn(EDEN_FINISHES,input.role)||input.targetKind!=='new-owned-unmapped'||typeof input.owner!=='string'||!input.owner.trim()||input.owner.length>160||input.originalMaterial!==undefined||!['Simple','Rich'].includes(input.quality??'Simple'))return fallback('Unknown/borrowed/mapped target: preserve original Simple material');
 const spec=EDEN_FINISHES[input.role],material=new T.MeshStandardMaterial({color:spec.color,roughness:spec.roughness,metalness:spec.metalness,side:spec.side??T.FrontSide,vertexColors:spec.vertexColors??false,flatShading:spec.flatShading??false}),maps=[];let closed=false,attempts=0;const faults=[];
 const dispose=()=>{if(closed)return Object.freeze({closed,attempts,faults:Object.freeze([...faults])});closed=true;for(const t of maps){attempts++;try{T.Texture.prototype.dispose.call(t);}catch{faults.push('owned-map-listener');}}attempts++;try{T.Material.prototype.dispose.call(material);}catch{faults.push('owned-material-listener');}return Object.freeze({closed,attempts,faults:Object.freeze([...faults])});};
 const state=()=>Object.freeze({closed,maps:maps.length,decodedBytes:maps.reduce((n,t)=>n+t.image.data.byteLength,0),estimatedMipBytes:maps.length*349524,ownMaterials:1,ownMeshes:0,ownGeometry:0,GPUQualified:false});
 // Baseline palette definitions are immediately usable; optional Rich needs explicit caller part coordinates.
 const p=input.projection,projection=data(p)&&['X','Y','Z','XZ','XYZ'].includes(p.axis)&&Array.isArray(p.metresPerUnit)&&p.metresPerUnit.length===3&&p.metresPerUnit.every(v=>Number.isFinite(v)&&v>0&&v<=128);
 if(input.quality!=='Rich'||!spec.recipe||!projection||(spec.projection==='triplanar'?(p.axis!=='XYZ'||p.metresPerUnit.some(v=>v!==1)):p.axis==='XYZ'||(['timber','bark'].includes(spec.recipe)?p.axis==='XZ':p.axis!=='XZ')))return Object.freeze({quality:'Simple',owned:true,owner:input.owner,role:input.role,material,reason:'Owned baseline palette; optional recipe/part-metre axes not qualified',state,dispose});
 try{
  const pixels=sidecarPixels(spec.recipe,13);for(const a of [pixels.color,pixels.roughness]){const t=new T.DataTexture(a,256,256,T.RGBAFormat,T.UnsignedByteType);maps.push(t);t.colorSpace=T.NoColorSpace;t.wrapS=t.wrapT=T.RepeatWrapping;t.minFilter=T.LinearMipmapLinearFilter;t.magFilter=T.LinearFilter;t.generateMipmaps=true;t.needsUpdate=true;}
  material.map=maps[0];material.roughnessMap=maps[1];const scale=[...p.metresPerUnit],axis=p.axis,role=input.role,uniforms={edenMean:{value:pixels.mean},edenGain:{value:spec.gain??pixels.gain}},means=[pixels.mean,spec.gain??pixels.gain];
  const coordinates=axis==='X'?'vec2(edenP.z,edenP.x)':axis==='Y'?'vec2(edenP.x,edenP.y)':axis==='Z'?'vec2(edenP.x,edenP.z)':'edenP.xz';const end=axis==='XZ'?'0.0':`step(.8,abs(normal.${axis.toLowerCase()}))`;
  const expectedHooks={};
  material.onBeforeCompile=s=>{if(closed||material.onBeforeCompile!==expectedHooks.compile||material.customProgramCacheKey!==expectedHooks.key||material.map!==maps[0]||material.roughnessMap!==maps[1]||uniforms.edenMean.value!==means[0]||uniforms.edenGain.value!==means[1]||!exact(s))throw Error('Owned expansion finish/source/template closed or changed');
   if(spec.projection==='triplanar'){
    s.vertexShader='varying vec3 vEdenMetres;varying vec3 vEdenLocalNormal;\n'+vertex.replace('#include <begin_vertex>','#include <begin_vertex>\nvEdenMetres=position;vEdenLocalNormal=normal;');
    const prefix='varying vec3 vEdenMetres;varying vec3 vEdenLocalNormal;uniform float edenMean;uniform float edenGain;\n',weights='vec3 edenWeights=pow(abs(vEdenLocalNormal),vec3(4.0));float edenSum=dot(edenWeights,vec3(1.0));edenWeights=edenSum>.0001?edenWeights/edenSum:vec3(0.0,1.0,0.0);',tile=pixels.tile.toFixed(8);
    s.fragmentShader=prefix+fragment.replace('#include <map_fragment>',`#ifdef USE_MAP\n${weights}\nvec3 edenSamples=vec3(texture2D(map,vEdenMetres.yz/${tile}).r,texture2D(map,vEdenMetres.xz/${tile}).r,texture2D(map,vEdenMetres.xy/${tile}).r);\ndiffuseColor.rgb*=1.0+(dot(edenSamples,edenWeights)-edenMean)*edenGain;\n#endif`).replace('#include <roughnessmap_fragment>',`float roughnessFactor=roughness;\n#ifdef USE_ROUGHNESSMAP\nvec3 edenRoughWeights=pow(abs(vEdenLocalNormal),vec3(4.0));float edenRoughSum=dot(edenRoughWeights,vec3(1.0));edenRoughWeights=edenRoughSum>.0001?edenRoughWeights/edenRoughSum:vec3(0.0,1.0,0.0);\nroughnessFactor*=dot(vec3(texture2D(roughnessMap,vEdenMetres.yz/${tile}).g,texture2D(roughnessMap,vEdenMetres.xz/${tile}).g,texture2D(roughnessMap,vEdenMetres.xy/${tile}).g),edenRoughWeights);\n#endif`);Object.assign(s.uniforms,uniforms);return;
   }
   s.vertexShader='varying vec2 vEdenFinishUV;varying float vEdenEnd;\n'+vertex.replace('#include <begin_vertex>',`#include <begin_vertex>\nvec3 edenP=position*vec3(${scale.map(v=>v.toFixed(8)).join(',')});\nvEdenFinishUV=${coordinates}/${pixels.tile.toFixed(8)};vEdenEnd=${end};`);
   const signal=spec.recipe==='timber'?'texture2D(map,vEdenFinishUV).r':'.67*texture2D(map,vEdenFinishUV).r+.33*texture2D(map,mat2(.7986,-.6018,.6018,.7986)*vEdenFinishUV/1.71+vec2(.31,.73)).r';
   s.fragmentShader='varying vec2 vEdenFinishUV;varying float vEdenEnd;uniform float edenMean;uniform float edenGain;\n'+fragment.replace('#include <map_fragment>',`#ifdef USE_MAP\ndiffuseColor.rgb*=mix(1.0+(${signal}-edenMean)*edenGain,1.0,vEdenEnd);\n#endif`).replace('#include <roughnessmap_fragment>','float roughnessFactor=roughness;\n#ifdef USE_ROUGHNESSMAP\nroughnessFactor*=mix(texture2D(roughnessMap,vEdenFinishUV).g,1.0,vEdenEnd);\n#endif');Object.assign(s.uniforms,uniforms);
  };material.customProgramCacheKey=()=>`eden-expansion-finish/1:${role}:${axis}:${scale.join(',')}:256:13`;expectedHooks.compile=material.onBeforeCompile;expectedHooks.key=material.customProgramCacheKey;
  return Object.freeze({quality:'RichPrepared',owned:true,owner:input.owner,role,material,state,dispose});
 }catch{dispose();return fallback('Optional preparation fault; owned cleanup attempted');}
}
