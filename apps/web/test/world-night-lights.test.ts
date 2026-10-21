import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { paintNightMap, EDEN_NIGHT_SOURCES, EDEN_NIGHT_PATHS, type NightSource, NIGHT_MAP_BOUNDS, setNightLightStrength, nightLightStrength, nightSource, collectNightSources, installNightLighting, paintNightSources } from '../src/WorldNightLights.ts';

const at=(data:Uint8Array,w:number,h:number,x:number,z:number)=>{const {x0,z0,x1,z1}=NIGHT_MAP_BOUNDS,i=Math.floor((x-x0)/(x1-x0)*w),j=Math.floor((z-z0)/(z1-z0)*h),k=(j*w+i)*4;return data[k]+data[k+1]+data[k+2];};

test('light map: a pool peaks under its lamp and fades to dark away from it', () => {
  const t=paintNightMap([{x:40,z:10,radius:3.4,intensity:1.35,color:'#ffc27a',halo:10}],[]),{width:w,height:h,data}=t.image as {width:number;height:number;data:Uint8Array};
  const peak=at(data,w,h,40,10),near=at(data,w,h,44,10),far=at(data,w,h,70,10);
  assert.ok(peak>near&&near>far,`${peak}>${near}>${far}`);assert.equal(far,0);
});

test('light map: clustered lamps add up into brighter shared light (soft-saturated, never clipped hard)', () => {
  const one=paintNightMap([{x:40,z:10,radius:3.4,intensity:1.35,color:'#ffffff',halo:10}],[]),many=paintNightMap([0,1,2,3].map(i=>({x:36+i*3,z:10,radius:3.4,intensity:1.35,color:'#ffffff',halo:10})),[]);
  const g=(t:typeof one)=>at((t.image as any).data,(t.image as any).width,(t.image as any).height,42,16);
  assert.ok(g(many)>g(one));assert.ok(g(many)<765);
});

test('strength follows the sun: zero in daylight, full at night', () => {
  setNightLightStrength(1);assert.equal(nightLightStrength(),0);
  setNightLightStrength(0);assert.ok(nightLightStrength()>.9);
  setNightLightStrength(null);assert.equal(nightLightStrength(),0);
});

test('light kinds: lamps match the residential reference, park lamps and lanterns are smaller and softer', () => {
  const lamp=nightSource(10,0,10,'lamp')!,park=nightSource(10,0,10,'park-lamp')!,lantern=nightSource(10,0,10,'lantern')!;
  assert.deepEqual([lamp.radius,lamp.intensity,lamp.halo],[3.4,1.35,10]);
  assert.ok(park.radius<lamp.radius&&park.intensity<lamp.intensity&&park.halo!<lamp.halo!);
  assert.ok(lantern.radius<park.radius&&lantern.intensity<park.intensity);
  assert.equal(nightSource(10,0,10,'disco'),null);assert.equal(nightSource(NaN,0,10,'lamp'),null);
});

test('published anchors are collected in world space and repaint the installed (shared) map', () => {
  const root=new THREE.Group(),child=new THREE.Group();child.position.set(100,5,-50);child.userData.edenLightSources=[[2,0,3,'lamp'],[0,0,0,'fire',.8],[1,1,1,'nope']];root.add(child);
  const found=collectNightSources(root);
  assert.equal(found.length,2);assert.deepEqual([found[0].x,found[0].base,found[0].z],[102,5,-47]);
  installNightLighting();const tex=THREE.ShaderLib.standard.uniforms.uEdenNightMap.value as THREE.DataTexture;
  assert.equal(tex.clone(),tex,'uniform cloning must share the map so a repaint reaches every material');
  const v0=tex.version,n=paintNightSources(found),{width:w,height:h,data}=tex.image as {width:number;height:number;data:Uint8Array};
  assert.ok(n>found.length);assert.ok(tex.version>v0);
  assert.ok(at(data,w,h,102,-47)>200,'pool under the region lamp');
  // Alpha carries the ground height under the light (5 m here), so pools hug raised ground.
  const {x0,z0,x1,z1}=NIGHT_MAP_BOUNDS,k=(Math.floor((-47-z0)/(z1-z0)*h)*w+Math.floor((102-x0)/(x1-x0)*w))*4;
  assert.ok(Math.abs(data[k+3]/255*100-10-5)<.6,'base '+(data[k+3]/255*100-10));
});

test('light map: the separable paint writes the same bytes as the per-texel gaussians (Eden sources, paths, every kind)', () => {
  // The paint before F12 (two exps per texel), kept here as the reference.
  const reference=(sources:readonly NightSource[],paths:readonly (readonly [number,number])[][])=>{
    const w=1536,h=1024,{x0,z0,x1,z1}=NIGHT_MAP_BOUNDS,sx=(x1-x0)/w,sz=(z1-z0)/h,acc=new Float32Array(w*h*4),wsum=new Float32Array(w*h),c=new THREE.Color(),data=new Uint8Array(w*h*4);
    const splat=(x:number,z:number,radius:number,intensity:number,color:string,halo:number,base:number)=>{
      c.set(color);const reach=Math.max(radius,halo)*2.2,i0=Math.max(0,Math.floor((x-reach-x0)/sx)),i1=Math.min(w-1,Math.ceil((x+reach-x0)/sx)),j0=Math.max(0,Math.floor((z-reach-z0)/sz)),j1=Math.min(h-1,Math.ceil((z+reach-z0)/sz));
      const r2=radius*radius,h2=halo*halo;
      for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){const dx=x0+(i+.5)*sx-x,dz=z0+(j+.5)*sz-z,d2=dx*dx+dz*dz;
        const v=intensity*(Math.exp(-d2/r2)+.18*Math.exp(-d2/h2));if(v<1e-4)continue;const k=(j*w+i)*4;acc[k]+=v*c.r;acc[k+1]+=v*c.g;acc[k+2]+=v*c.b;acc[k+3]+=v*base;wsum[k>>2]+=v;}};
    for(const s of sources)splat(s.x,s.z,s.radius,s.intensity,s.color,s.halo??s.radius*2.5,s.base??0);
    for(const p of paths)for(let i=1;i<p.length;i++){const [a,b]=[p[i-1],p[i]],len=Math.hypot(b[0]-a[0],b[1]-a[1]);for(let t=0;t<=len;t+=1.5)splat(a[0]+(b[0]-a[0])*t/len,a[1]+(b[1]-a[1])*t/len,1.3,.07,'#ffcf8a',3,0);}
    for(let k=0;k<acc.length;k+=4){const wt=wsum[k>>2];for(let ch=0;ch<3;ch++){const v=acc[k+ch];data[k+ch]=Math.round(255*Math.min(1,1.25*v/(1+v)));}
      const base=wt>1e-4?acc[k+3]/wt:0;data[k+3]=Math.round(255*Math.min(1,Math.max(0,(base+10)/100)));}
    return data;};
  let seed=5;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
  const kinds=['lamp','park-lamp','lantern','window','fire','string','mural-uplight'],extra:NightSource[]=[];
  for(let n=0;n<400;n++){const s=nightSource(-260+rnd()*600,rnd()*12-2,-230+rnd()*440,kinds[n%kinds.length],.5+rnd());if(s)extra.push(s);}
  const sources=[...EDEN_NIGHT_SOURCES,...extra];assert.ok(extra.length>300);
  const got=paintNightMap(sources,EDEN_NIGHT_PATHS).image.data as Uint8Array,want=reference(sources,EDEN_NIGHT_PATHS);
  let lit=0,diff=0;for(let k=0;k<want.length;k++){if(want[k])lit++;if(got[k]!==want[k])diff++;}
  assert.ok(lit>100000,`lit ${lit}`);assert.equal(diff,0,`${diff} bytes differ`);
});
