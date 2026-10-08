// Web and loaded-rig consumers share exactly one recorded-contact decoder.
export {shoreDepiction,type ShoreDepiction} from '../../../mars/viewer/app/engine-view/recorded-shore.ts';
// Selected render metadata only. Core capture hashing/binding lives in WorldSceneHistory.
import {hashOf} from '../../../packages/engine-contract/src/hash.ts';
import {nativeShoreSceneV1Schema,decodeShoreAppearanceSourceV1,type NativeShoreSceneV1} from '../../../packages/engine-contract/src/shore-scene.ts';
import {inspectNativeShoreTerrain} from '../../../mars/viewer/app/engine-view/content/environment/native-shore-terrain.ts';
import type {ShoreDesign} from '../../../mars/viewer/app/engine-view/shore-preview.ts';
import type {SpatialScene} from '../../../mars/viewer/engine/spatial/types.ts';
export type WorldShore={metadata:NativeShoreSceneV1;appearance?:ShoreDesign;profile?:'connected-commons-shore/1'};
/** The first qualified visual profile. Unsupported metadata is refused, never
 * silently replaced by a flat clearance grid. Absent shore preserves legacy. */
export function parseWorldShore(raw:unknown,scene:SpatialScene|null):WorldShore|undefined {
 if(raw===undefined)return;
 const metadata=nativeShoreSceneV1Schema.parse(raw),t=metadata.terrain;
 // Exact Core f870, 54c owned shore, a80 native boat, 685 owned boat and 425 helm and 83d location addresses.
 // The boat retains the same terrain/static scene, with its own physical base.
 if(metadata.terrain.id==='commons-shore-terrain/1'){
  // Core C293/C294 and PM R020 consistent-WAL current-world-copy exact east/north extension; original shore grid/water preserved.
  const eastLecture=!!scene&&hashOf(scene)==='903c58c5bce3079c0ce50d1f722eca1cc969cd8744f00d3d1c965c8e82a414e1'&&['09d9d0c8936386298f76b017ec1e905ed3fa56c65d6af6bb15c2c99959b409d1','f47b958df5e496a21882a8e219d9b3dbb0bf417044f7cc435442bbeb457a2c1c'].includes(hashOf(metadata));
  if(!eastLecture&&(!scene||hashOf(scene)!=='fb9116a3d8f05b27d4f5358625859176a33f7543d8087bb7b27b209ef6f5a7ba'||
   ![
    '33a7e41f4250064704ece3205abe386840f2fbf3ed3046753c2c3b5f4797f0fa',
    '4950ae44e7a4cca53fbb77691ff00399d47c19a0771fd07a37d6fe6ca7d95851',
    '6a2e6662c44be7104512ac844879e58c9763e3877c87978bf7ef38faa31e0af4',
    '67e0b7e03a6fb9fdfae1c616af8e35dbe6dabc6012db0d084970873ec4494c48',
    '03699719689c724ade6a2520b0431d184732aba7d67fadd73908bcf1854ff913',
    'c0bf7341f01257bea5580fab1dcdd39e9c5e969abe0a260b0f32f09910d2787c',
    '8bec8d99473d20c9b0be84eb6884438d52756d5811b4ffbddd5f4010736c640c', // Core cbe95935 retained kitchen2/shore fixture
    'bcc62c49261431f26eaa863eab1c4c55d18c9e201c1adc753cf2921bb454b9d9', // Actual retained Root shore + fd/1, identical physical base/grid/water
    '38366c1eac5d1041e117ece543cb594d0319520f9a116abf5a911e7d1e8bbd41', // Prospective c2 social suffix over qualified retained FD shore; no Root scene binding
    'e336a92c1c11d927281e7cc54f51f58258a1f55324aacc31965221ee198037a8', // Actual archived af844 newcomer cp/2; same spatial/terrain/water, no Root activation
    'f43a6a7bac0144c5a6bb6891f2e30f105b93da25b49cfa1e1c2d395a326ce17e', // Actual archived 88f33 safe-wake ss/1; same normalized spatial/terrain/water, no policy activation
   ].includes(hashOf(metadata))))
   throw Error('Unsupported connected commons shoreline capture');
  const appearance=metadata.boat?decodeShoreAppearanceSourceV1(metadata.boat.appearance) as unknown as ShoreDesign:undefined;
  return {metadata,profile:'connected-commons-shore/1',...(appearance?{appearance}:{})};
 }
 inspectNativeShoreTerrain(t);
 const bounds=[t.originXZ[0],t.originXZ[1],t.originXZ[0]+(t.columns-1)*t.spacingMetres,t.originXZ[1]+(t.rows-1)*t.spacingMetres];
 if(!scene||scene.bounds.some((v,i)=>v!==bounds[i])||scene.obstacles.length||scene.links.length||scene.surfaces.length!==1||scene.surfaces[0].y!==0||
  metadata.water.id!=='eden-shore-water'||metadata.water.datumY!==0||metadata.water.wetBoundsXZ.some((v,i)=>v!==[-16,-12,0,12][i]))throw Error('Unsupported captured shoreline rendering profile');
 const appearance=metadata.boat?decodeShoreAppearanceSourceV1(metadata.boat.appearance) as unknown as ShoreDesign:undefined;
 return {metadata,...(appearance?{appearance}:{})};
}
