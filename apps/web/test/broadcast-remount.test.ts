// DIRECTOR2 (run2): a #watch visitor on an entity world was switched to "your camera" with no input between 141 s and
// 195 s: a scene re-mount (owner epoch: a new Soul, a reconnect) re-ran the arrival framing, which keeps the camera pose
// and set the mode to manual. A visitor watching Broadcast stays in Broadcast across the re-mount.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('an entity-world re-mount keeps a Broadcast viewer in Broadcast', () => {
  const source = readFileSync(new URL('../src/LiveWorld.tsx', import.meta.url), 'utf8');
  assert.match(source, /entityView\.current=\{[^}]*broadcast:context\.current\.cameraMode==='broadcast'\}/, 'the cleanup remembers Broadcast');
  const start = source.indexOf('const frameEntityWorld=()=>'), body = source.slice(start, source.indexOf("context.current.setCameraMode('manual')", start));
  const remount = body.slice(body.indexOf('else if(entityView.current)'));
  assert.match(remount, /if\(entityView\.current\.broadcast&&context\.current\.cameraMode==='broadcast'\)\{[^}]*return;\}/, 'returns before the manual switch');
});
