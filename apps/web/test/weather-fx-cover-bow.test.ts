import './browser-url-fixture.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {COVER_MAP} from '../src/atmosphere/rain-cover.ts';
import {SkyDome,bowSunGate} from '../src/atmosphere/sky.ts';

test('rain cover map never asks three to re-upload its render-target storage', () => {
  const t=COVER_MAP.value;
  t.needsUpdate=true;t.needsUpdate=true;
  // version>0 with isRenderTargetTexture=false made setTexture2D call texSubImage2D on an immutable texture
  assert.equal(t.version,0);
  assert.equal(t.clone(),t);
});

test('rainbow strength follows where the bow can actually be seen', () => {
  const deg=(d:number)=>Math.sin(d*Math.PI/180);
  assert.equal(bowSunGate(deg(-5)),0); // night / sun parked below the horizon
  assert.ok(bowSunGate(deg(20))>.99); // late afternoon: tall arc
  assert.ok(bowSunGate(deg(33.4))>.9); // 10:00 on the review day: low arc still above the horizon
  assert.equal(bowSunGate(deg(45)),0); // noon: the whole bow is below the horizon
});

test('the bow is composited over the fog veil and tints the sky, not a faint add', () => {
  const f=new SkyDome().mesh.material.fragmentShader;
  const veil=f.indexOf('col=mix(col,uHorizon,uBow.w'),bow=f.indexOf('col=mix(col,col*bowTint+bowAdd');
  assert.ok(veil>0&&bow>veil);
});
