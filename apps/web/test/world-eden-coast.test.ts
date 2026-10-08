import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Terrain,coastAt,WATER} from '../../../mars/viewer/app/engine-view/content/assets/eden-regions/terrain.ts';
const t=new Terrain(()=>0);
/** Southernmost land z at a column x (first point, walking south, where the ground drops under the bay level). */
const shore=(x:number)=>{for(let z=60;z<320;z+=.5)if(t.height(x,z)<WATER.bay)return z;return 320;};
test('districts keep the original straight bay edge', () => {
  for(let x=-290;x<=290;x+=10)assert.equal(coastAt(x).w,0,`x=${x}`);
});
test('outer coast meanders: headlands, coves and beaches, not a straight wall (Gene 2026-10-07)', () => {
  for(const side of [1,-1]){
    const zs:number[]=[];for(let x=420;x<=880;x+=8)zs.push(shore(side*x));
    const mean=zs.reduce((a,b)=>a+b,0)/zs.length,sd=Math.sqrt(zs.reduce((a,b)=>a+(b-mean)**2,0)/zs.length);
    assert.ok(sd>10,`side ${side}: shoreline varies (sd ${sd.toFixed(1)} m)`);
    assert.ok(Math.max(...zs)-Math.min(...zs)>45,'headlands and coves');
  }
  let beaches=0,cliffs=0;for(let x=400;x<=880;x+=4){const c=coastAt(x),z=c.zc-6;const h=t.height(x,z);if(h>-.5&&h<2)beaches++;if(h>12)cliffs++;}
  assert.ok(beaches>10&&cliffs>10,`beaches ${beaches}, cliffs ${cliffs}`);
});
test('the camera far plane covers the whole outer terrain (no moving slice through distant ridges)', () => {
  const src=readFileSync(new URL('../src/LiveWorld.tsx',import.meta.url),'utf8');
  const far=Number(/new THREE\.PerspectiveCamera\(45, 1, 0\.1, (\d+)\)/.exec(src)?.[1]);
  assert.ok(far>=Math.hypot(900+150,900+150),`far ${far}`);
});
