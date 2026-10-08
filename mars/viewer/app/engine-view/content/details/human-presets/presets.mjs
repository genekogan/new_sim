import audit from './audit.json' with {type:'json'};
const freeze=o=>{for(const v of Object.values(o))if(v&&typeof v==='object')freeze(v);return Object.freeze(o);};
export const PRESET_VERSION='human-presets/1';
export const HUMAN_ASSETS=freeze(structuredClone(audit.sourceGLBs));
const toLinear=hex=>[1,3,5].map(i=>{const v=parseInt(hex.slice(i,i+2),16)/255;return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4);});
const palettes=[
 ['casual-river','River / short hair','casual',{Skin:'#b97750',LightBrown:'#356477',Red_Dark:'#2c3538',White:'#ded8cc',Eyebrows:'#482d22',Hair:'#482d22',LightBlue:'#26384a'}],
 ['casual-clay','Clay / short hair','casual',{Skin:'#deb38b',LightBrown:'#bd623c',Red_Dark:'#4c352d',White:'#e0d8c8',Eyebrows:'#242127',Hair:'#242127',LightBlue:'#303b43'}],
 ['punk-sage','Sage / spiked hair','punk',{Skin:'#8b5941',White:'#d9d6b9',Black:'#26382e',Eyebrows:'#315648',Red_Dark:'#315648',Red:'#4e8664',Earrings:'#c5a154',LightBlue:'#44564b'}],
 ['punk-plum','Plum / spiked hair','punk',{Skin:'#cf8f72',White:'#cbc2d1',Black:'#292533',Eyebrows:'#4c304d',Red_Dark:'#4c304d',Red:'#784f75',Earrings:'#adb7bc',LightBlue:'#424252'}],
 ['longhair-ocean','Ocean / long hair','woman',{Skin:'#b57552',White:'#307589',Grey:'#263b43',Hair_Brown:'#463027',Hair_Blond:'#73513e',Orange:'#303d54'}],
 ['longhair-citrus','Citrus / long hair','woman',{Skin:'#e1b98e',White:'#c0a554',Grey:'#4b433b',Hair_Brown:'#423026',Hair_Blond:'#b09162',Orange:'#596353'}]
];
function recipe([id,label,template,colors]) {
 const source=HUMAN_ASSETS[template];
 const materialSlots=source.materials.map((m,index)=>{const original=m.pbrMetallicRoughness.baseColorFactor,hex=colors[m.name];let factor=hex?[...toLinear(hex),original[3]]:[...original];let operation=hex?'owned-clone-base-color':'retain-original';
  if(m.name==='Skin_Darker'){const skin=toLinear(colors.Skin),base=source.materials.find(m=>m.name==='Skin').pbrMetallicRoughness.baseColorFactor;factor=[...skin.map((v,i)=>v*original[i]/base[i]),original[3]];operation='owned-clone-paired-skin-shade';}
  return {index,name:m.name,operation,sRGBHex:hex??null,baseColorLinear:factor,originalBaseColorLinear:[...original],retainMetallicRoughnessSideAlpha:true,retainOriginalMaps:true,bindings:source.primitives.filter(p=>p.material===index).map(p=>({node:p.node,mesh:p.mesh,primitive:p.primitive,vertexColors:[...p.vertexColors]}))};});
 return freeze({id,label,version:PRESET_VERSION,template,sourceAssetSHA256:source.sha256,sourceURL:'/modular/environment/animated-'+template+'.glb?v=ual-1',quality:'InertPreset',bindingGranted:false,materialSlots,
  geometryRigRootClips:'retain exact existing pipeline; no shape/hair/accessory replacement',accessory:template==='punk'?'original earrings only; factor tint, no add/remove':'original model only; no accessory slot fabricated',
  costs:{conditionalOwnedMaterialClones:materialSlots.filter(m=>m.operation!=='retain-original').length,extraTextures:0,extraGeometry:0,extraDraws:0,actualHeapGPUFrame:null}});
}
export const HUMAN_PRESETS=Object.freeze(palettes.map(recipe));
function keyHash(key){let h=2166136261;for(const b of new TextEncoder().encode(key)){h^=b;h=Math.imul(h,16777619)>>>0;}return h;}
export function presetForSoul(stableSoulId,version=PRESET_VERSION){
 if(version!==PRESET_VERSION||typeof stableSoulId!=='string'||stableSoulId.length<1||stableSoulId.length>128||/[\u0000-\u001f\u007f]/u.test(stableSoulId))return Object.freeze({quality:'Simple',bindingGranted:false,reason:'Explicit stable Soul key and supported preset version required'});
 return HUMAN_PRESETS[keyHash(stableSoulId)%HUMAN_PRESETS.length];
}
/** Metadata association only. No material/mesh/rig access or mutable input writes. */
export function presetForAsset(stableSoulId,version,assetSHA256){const p=presetForSoul(stableSoulId,version);return p.quality==='InertPreset'&&p.sourceAssetSHA256===assetSHA256?p:Object.freeze({quality:'Simple',bindingGranted:false,reason:'Actual original selected GLB hash must match; renderer-owned hooks/maps/rig guards still required'});}
/** Optional palette selection preserves the actual existing template/rig identity. */
export function compatiblePresetForSoul(stableSoulKey,existingTemplateName,version,actualSourceGLBSHA){
 if(version!==PRESET_VERSION||typeof stableSoulKey!=='string'||stableSoulKey.length<1||stableSoulKey.length>128||/[\u0000-\u001f\u007f]/u.test(stableSoulKey)||(existingTemplateName!=='casual'&&existingTemplateName!=='punk'&&existingTemplateName!=='woman')||typeof actualSourceGLBSHA!=='string')return Object.freeze({quality:'Simple',bindingGranted:false,reason:'Explicit stable Soul key, existing template and supported version/hash required'});
 if(actualSourceGLBSHA!==HUMAN_ASSETS[existingTemplateName].sha256)return Object.freeze({quality:'Simple',bindingGranted:false,reason:'Actual existing original template GLB hash must match'});
 const offset=existingTemplateName==='casual'?0:existingTemplateName==='punk'?2:4;
 return HUMAN_PRESETS[offset+keyHash(stableSoulKey)%2];
}

/** Additive source version; all version1 APIs and six entries above remain unchanged. */
export const SOCIAL_PRESET_VERSION='human-presets/social-8/2';
const additionalCasual=[
 ['casual-ochre','Ochre / short hair','casual',{Skin:'#8f5b3f',LightBrown:'#c58a2e',Red_Dark:'#493727',White:'#eadcbd',Eyebrows:'#302319',Hair:'#302319',LightBlue:'#3d4d3c'}],
 ['casual-violet','Violet / short hair','casual',{Skin:'#e3bc98',LightBrown:'#7855a8',Red_Dark:'#36303e',White:'#e4dce9',Eyebrows:'#573e32',Hair:'#6c4a34',LightBlue:'#45415e'}]
];
export const SOCIAL_HUMAN_PRESETS=freeze([...HUMAN_PRESETS,...additionalCasual.map(recipe)].map(p=>({...p,version:SOCIAL_PRESET_VERSION})));
export const SOCIAL_PUBLIC_SOURCE=freeze({sceneSHA256:'edf6635cb78095db4a9575afcecff61fb68eebc062317441d249c13f37338557',takesSHA256:'59d2c9e675a923b8911168a094f468063a679efcc5b777fb94b233ca3ddaecdb',renderSceneRef:'b1f3cebde1a19742aeac2cc7b43f564824fa451d011e0dbc1a6b0a2e8e288abb'});
export const SOCIAL_PUBLIC_ASSIGNMENTS=freeze([
 ['h_006a68883b','s_006a68883b','casual','casual-river'],
 ['h_282ec6f92c','s_282ec6f92c','casual','casual-clay'],
 ['h_4158faee14','s_4158faee14','casual','casual-ochre'],
 ['h_52ec515f8c','s_52ec515f8c','woman','longhair-ocean'],
 ['h_6e60aea722','s_6e60aea722','casual','casual-violet'],
 ['h_9537069334','s_9537069334','casual','casual-river'],
 ['h_9915b192c3','s_9915b192c3','woman','longhair-citrus'],
 ['h_cf86d2c238','s_cf86d2c238','casual','casual-clay']
].map(([actorId,stableSoulKey,template,presetId])=>({actorId,stableSoulKey,template,presetId,version:SOCIAL_PRESET_VERSION,sourceAssetSHA256:HUMAN_ASSETS[template].sha256})));
/** Exact audited public cohort mapping, not a template writer or global rehash. */
export function socialPresetForSoul(stableSoulKey,existingTemplateName,version,actualSourceGLBSHA){
 if(version!==SOCIAL_PRESET_VERSION||typeof stableSoulKey!=='string'||stableSoulKey.length<1||stableSoulKey.length>128||/[\u0000-\u001f\u007f]/u.test(stableSoulKey)||(existingTemplateName!=='casual'&&existingTemplateName!=='punk'&&existingTemplateName!=='woman')||typeof actualSourceGLBSHA!=='string')return Object.freeze({quality:'Simple',bindingGranted:false,reason:'Explicit social source version/stable key/template/hash required'});
 const row=SOCIAL_PUBLIC_ASSIGNMENTS.find(p=>p.stableSoulKey===stableSoulKey);
 if(!row||row.template!==existingTemplateName||row.sourceAssetSHA256!==actualSourceGLBSHA)return Object.freeze({quality:'Simple',bindingGranted:false,reason:'Unknown or drifted audited public Soul/template/source remains Simple'});
 return SOCIAL_HUMAN_PRESETS.find(p=>p.id===row.presetId)??Object.freeze({quality:'Simple',bindingGranted:false,reason:'Missing audited palette remains Simple'});
}
/** Exact id AND version resolution for an explicit provenance-guarded material adapter. */
export function presetByIdAndVersion(id,version){
 if(typeof id!=='string'||(version!==PRESET_VERSION&&version!==SOCIAL_PRESET_VERSION))return Object.freeze({quality:'Simple',bindingGranted:false,reason:'Unsupported appearance source version/id'});
 return(version===PRESET_VERSION?HUMAN_PRESETS:SOCIAL_HUMAN_PRESETS).find(p=>p.id===id)??Object.freeze({quality:'Simple',bindingGranted:false,reason:'Unknown versioned preset id'});
}
