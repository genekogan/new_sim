import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {installLookToneCurve,installMaterialDetail,setMaterialDetail,lookSettings,lookExposure,shadowFollowBox,stableShadowPCF,installStableShadowFilter,WorldPost} from './WorldLook.ts';
import {setNightLightStrength,nightLightStrength} from '../WorldNightLights.ts';

void test('look settings: entity worlds on, ?look=flat off, phones keep the direct draw and no material detail',()=>{
 const on=lookSettings('',"full",true);
 assert.deepEqual([on.enabled,on.ao,on.detail,on.follow],[true,true,1,true]);
 assert.ok(on.nightExposure>1&&on.poolGain>1);
 const flat=lookSettings('?look=flat','full',true);
 assert.deepEqual([flat.enabled,flat.ao,flat.detail,flat.follow,flat.nightExposure,flat.poolGain],[false,false,0,false,1,1]);
 assert.deepEqual([lookSettings('','full',false).enabled,lookSettings('','full',false).ao],[false,false],'old (non-entity) worlds are untouched');
 const phone=lookSettings('','phone',true);assert.deepEqual([phone.enabled,phone.ao,phone.detail],[true,false,0]);
 assert.equal(lookSettings('?post=0','full',true).ao,false);assert.equal(lookSettings('?detail=0','full',true).detail,0);
});

void test('night exposure: 1 by day and before the first clock, the night value at night, monotonic through dusk',()=>{
 assert.equal(lookExposure(1,1.85),1);assert.equal(lookExposure(null,1.85),1);assert.equal(lookExposure(0.7,1.85),1);
 assert.equal(lookExposure(0,1.85),1.85);
 let prev=Infinity;for(let d=0;d<=1.0001;d+=0.05){const e=lookExposure(d,1.85);assert.ok(e<=prev+1e-12);prev=e;}
});

void test('tone curve: three\'s CustomToneMapping becomes the identity-below-0.8 shoulder (patched once)',()=>{
 installLookToneCurve();installLookToneCurve();
 const c=THREE.ShaderChunk.tonemapping_pars_fragment;
 assert.ok(c.includes('vec3 over = max( color - 0.8, 0.0 );')&&c.includes('color *= toneMappingExposure;'));
 // the curve (mirrored here): identity to 0.8, continuous, monotonic, below 1
 const curve=(x:number)=>Math.min(x,0.8)+0.2*(1-Math.exp(-Math.max(x-0.8,0)/0.2));
 assert.equal(curve(0.5),0.5);assert.ok(Math.abs(curve(0.8)-0.8)<1e-12);assert.ok(curve(3)<1&&curve(3)>curve(1.2)&&curve(1.2)>0.8);
 assert.ok(!c.includes('vec3 CustomToneMapping( vec3 color ) { return color; }'));
 assert.equal(c.split('vec3 CustomToneMapping(').length,2,'defined once');
});

void test('material detail: lit materials only, one shared strength uniform, clamped',()=>{
 installMaterialDetail();installMaterialDetail();
 assert.equal(THREE.ShaderChunk.normal_fragment_maps.split('if ( uEdenDetail.x > 0.0 )').length,2);
 // normal/matcap materials include normal_fragment_maps but not lights_pars_begin: the guard keeps them compiling
 assert.ok(THREE.ShaderChunk.normal_fragment_maps.includes('#if defined( EDEN_DETAIL_PARS ) && ( defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG ) || defined( TOON ) )'));
 assert.ok(THREE.ShaderChunk.lights_pars_begin.includes('#define EDEN_DETAIL_PARS'));
 const u=THREE.ShaderLib.standard.uniforms.uEdenDetail.value,clone=THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms).uEdenDetail.value;
 assert.equal(clone,u,'per-material uniform clones share the plain object');
 setMaterialDetail(3);assert.equal(u.x,1);setMaterialDetail(-1);assert.equal(u.x,0);
});

void test('occlusion pass: depth rebuilt at texel centres with a highp sampler (no striped self-occlusion), stable 4×4 rotation',()=>{
 const post=new WorldPost() as unknown as {ao:THREE.ShaderMaterial;blur:THREE.ShaderMaterial;params:{radius:number}};
 const ao=post.ao.fragmentShader,blur=post.blur.fragmentShader;
 assert.ok(ao.includes('uniform highp sampler2D tDepth')&&ao.includes('floor( uv * uDepthSize ) + 0.5'));
 assert.ok(!/texture2D\( tDepth, suv \)/.test(ao),'samples go through edenViewAt');
 assert.ok(!ao.includes('interleavedGradientNoise')&&ao.includes('mod( gl_FragCoord.xy, 4.0 )'),'deterministic 4×4 pattern, removed by the 4×4 blur');
 assert.ok(blur.includes('for ( int j = -2; j <= 1; j ++ ) for ( int i = -2; i <= 1; i ++ )'));
 assert.ok(post.params.radius>0);
 (post as unknown as WorldPost).dispose();
});

void test('shadow follow: the sun\'s shadow box sits on a build far from the origin, snapped, deterministic, soft',()=>{
 // 3.2 fitted the box once to the origin's ±45 m: a build at z 380 (nordic-village) had no shadows at all
 const target={x:58.33,y:4.2,z:381.7},eye={x:30,y:30,z:410};
 const box=shadowFollowBox(target,eye,2048)!;
 assert.ok(box.half>=24&&box.half<=160&&box.half%8===0);
 assert.ok(Math.abs(box.cx-target.x)<=box.texel/2+1e-9&&Math.abs(box.cz-target.z)<=box.texel/2+1e-9,'centred on the target');
 assert.ok(Math.abs(box.cx/box.texel-Math.round(box.cx/box.texel))<1e-6,'snapped to whole texels');
 assert.ok(box.radius>=1.25&&box.radius<=3.5&&box.normalBias>=0.05);
 assert.equal(shadowFollowBox({...target,x:target.x+box.texel*0.2},eye,2048)!.key,box.key,'sub-texel jitter changes nothing');
 assert.deepEqual(shadowFollowBox(target,eye,2048),box,'deterministic');
 const far=shadowFollowBox(target,{x:target.x-150,y:target.y+120,z:target.z+150},2048)!;assert.ok(far.half>box.half&&far.radius<=box.radius);
 assert.equal(shadowFollowBox(target,{x:NaN,y:0,z:0},2048),null);
 assert.ok(shadowFollowBox(target,eye,1024)!.texel>box.texel,'the phone map has larger texels');
});

void test('lamp pools: the look gain scales the night light strength (1 keeps the old curve)',()=>{
 setNightLightStrength(0);assert.equal(nightLightStrength(),1);
 setNightLightStrength(0,1.7);assert.equal(nightLightStrength(),1.7);
 setNightLightStrength(1,1.7);assert.equal(nightLightStrength(),0);
});

void test('daylight PCF integrates full maps densely while retaining phone and other shadow algorithms',()=>{
 const original=THREE.ShaderChunk.shadowmap_pars_fragment,patched=stableShadowPCF(original);
 assert.notEqual(patched,original,'the pinned Three sampling block is recognized');
 assert.equal(stableShadowPCF(patched),patched,'the filter is idempotent');
 assert.ok(patched.includes('shadowMapSize.x >= 2048.0'));
 assert.ok(patched.includes('vogelDiskSample( edenSample, 16, phi )'));
 assert.ok(patched.includes('vogelDiskSample( 4, 5, phi )'),'phone fallback retained');
 assert.equal(patched.slice(patched.indexOf('#elif defined( SHADOWMAP_TYPE_VSM )')),original.slice(original.indexOf('#elif defined( SHADOWMAP_TYPE_VSM )')),'VSM, basic and point-shadow implementations unchanged');
 assert.equal(stableShadowPCF('unknown upstream implementation'),'unknown upstream implementation');
 installStableShadowFilter();const once=THREE.ShaderChunk.shadowmap_pars_fragment;installStableShadowFilter();assert.equal(THREE.ShaderChunk.shadowmap_pars_fragment,once);
});
