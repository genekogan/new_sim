// Lane W1 (3.14 rollback): a ?shot=1&eye=&at= page framed its camera, then a broadcast frame moved it before React's next
// render switched the mode to manual (the socket's takes now arrive during the first build, so broadcast has a take to
// sample). The framing must switch the live mode at once. Real check: team/scratch/t4/r/lookcheck.mjs (and the throttled
// team/scratch/t4/w1/probe/lookthrottle.mjs) put the camera at the eye 3/3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('the entity world framing switches the live camera mode to manual synchronously (no broadcast frame after eye/at)', () => {
  const source = readFileSync(new URL('./LiveWorld.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('const frameEntityWorld=()=>'); assert.ok(start > 0, 'frameEntityWorld is there');
  const body = source.slice(start, source.indexOf('};', source.indexOf("setCameraMode('manual')", start)) + 2);
  assert.match(body, /camera\.position\.set\(eye\[0\],eye\[1\],eye\[2\]\)/, 'eye/at set the camera');
  assert.match(body, /context\.current\.cameraMode='manual';context\.current\.setCameraMode\('manual'\)/, 'mode switched before the next frame');
  // the broadcast branch of the render loop reads the live mode, so the switch above is what keeps it off the camera
  assert.match(source, /if \(context\.current\.cameraMode === 'broadcast'\) \{\n\s*const shot = broadcast\.sample\(/);
});
