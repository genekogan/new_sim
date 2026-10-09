// Bounded optional recipe on the original exact water owner, no new geometry/topology.
import * as THREE from 'three';
import {EDEN_WATER_DAYLIGHT} from './daylight.ts';
import {inspectCapturedWaterSurface,createCapturedWaterSurface} from '../captured-water-surface.ts';
// Submerged bodies must read as underwater (Gene, Oct 6): .68 front alpha showed whole
// legs of treading swimmers. Absorption proxy now hides most of what lies below the datum.
export const EDEN_WATER_READABILITY=Object.freeze({baseColor:'#286a8d',frontAlpha:.88,grazingAlpha:.12,maximumAlpha:1,scope:'cosmetic contrast/absorption proxy only, no physical optics/depth/contact/waterheight'});
export function inspectEdenWaterReadability(terrain,water,enabled=false){
 if(enabled!==true)return null;
 try{const original=inspectCapturedWaterSurface(terrain,water);return{original,recipe:{...EDEN_WATER_READABILITY},drawCalls:1,triangles:2,extraGeometry:0,extraMaterials:0,textures:0,shaderChanged:false,nativeDatumChanged:false};}catch{return null;}
}
/** Caller may choose this instead of its existing createCapturedWaterSurface call.
 * Defaultoff original owner is unchanged; unknown enabled profile returns null/Simple. */
export function createEdenReadableWater(terrain,water,enabled=false){
 if(enabled!==true)return createCapturedWaterSurface(terrain,water);
 const inspection=inspectEdenWaterReadability(terrain,water,true);if(!inspection)return null;
 const owner=createCapturedWaterSurface(terrain,water);
 try{const mesh=owner.group.children[0],material=mesh?.material;if(!mesh?.isMesh||!material?.isShaderMaterial||!material.uniforms.uBaseColor?.value?.isColor||!material.uniforms.uBaseAlpha||!material.uniforms.uGrazingAlpha)throw Error('Unknown original water target');
 material.uniforms.uDaylight=EDEN_WATER_DAYLIGHT;
 material.uniforms.uBaseColor.value.set(EDEN_WATER_READABILITY.baseColor);material.uniforms.uBaseAlpha.value=EDEN_WATER_READABILITY.frontAlpha;material.uniforms.uGrazingAlpha.value=EDEN_WATER_READABILITY.grazingAlpha;
 mesh.userData.cameraTransparent=true;return{...owner,inspection};
 }catch(cause){try{owner.dispose();}catch(cleanup){throw new AggregateError([cause,cleanup],'Readable water returned-owner rollback failed',{cause});}return null;}
}
/** Linear source-over estimate only, not renderer/tonemapping/depth simulation. */
export function waterBedContrastEstimate(bedHex,enabled=false){
 const bed=new THREE.Color(bedHex),water=new THREE.Color(enabled?EDEN_WATER_READABILITY.baseColor:'#4f969b'),alpha=enabled?EDEN_WATER_READABILITY.frontAlpha:.45,mix=bed.clone().multiplyScalar(1-alpha).add(water.multiplyScalar(alpha));return{linearRGB:mix.toArray(),sRGB:mix.clone().convertLinearToSRGB().toArray(),alpha,scope:'analytic flat-view source-over colour only/no pixel proof'};
}
