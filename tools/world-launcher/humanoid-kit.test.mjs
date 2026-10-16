// node --test tools/world-launcher/humanoid-kit.test.mjs  (port 6309, lane A's range; no world processes)
// Release 3 walk: /worlds/modular/humanoid/kit.json was proxied to "any running world"; with only the old-world eden fork
// awake (it has no such kit) every page's humanoid kit was a 404 and composed bodies fell back to simple figures. The
// launcher now serves this release's humanoid kit itself, under its base, whatever is awake.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLauncher } from './launcher.mjs';

const dir = mkdtempSync(join(tmpdir(), 'launcher-kit-'));
const webDir = join(dir, 'web'); mkdirSync(join(webDir, 'assets'), { recursive: true }); writeFileSync(join(webDir, 'index.html'), '<!doctype html>');
const templatesDir = join(dir, 'templates'); mkdirSync(templatesDir);
const marsWebDir = join(dir, 'mars-web'); mkdirSync(join(marsWebDir, 'modular', 'humanoid', 'parts'), { recursive: true });
writeFileSync(join(marsWebDir, 'modular', 'humanoid', 'kit.json'), '{"kit":1}');
writeFileSync(join(marsWebDir, 'modular', 'humanoid', 'parts', 'a.glb'), 'glTF');
writeFileSync(join(marsWebDir, 'secret.json'), '{}');
const L = await openLauncher({ port: 6309, range: [6301, 6308], base: '/worlds', dataDir: join(dir, 'data'), webDir, templatesDir, marsWebDir, command: () => ({ cmd: process.execPath, args: ['-e', ''] }), eager: 0, log: () => {} });
after(() => L.close?.());
const get = (p) => fetch(`http://127.0.0.1:6309${p}`);

test('the humanoid kit and its parts are served by the launcher with no world awake', async () => {
  const kit = await get('/worlds/modular/humanoid/kit.json');
  assert.equal(kit.status, 200); assert.equal(await kit.text(), '{"kit":1}'); assert.match(kit.headers.get('content-type') ?? '', /json/);
  const part = await get('/worlds/modular/humanoid/parts/a.glb');
  assert.equal(part.status, 200); assert.equal(part.headers.get('content-type'), 'model/gltf-binary');
});

test('nothing outside the kit is served from mars-web this way', async () => {
  for (const p of ['/worlds/modular/humanoid/../../secret.json', '/worlds/modular/humanoid/%2e%2e/%2e%2e/secret.json', '/worlds/modular/humanoid/missing.json']) {
    assert.notEqual((await get(p)).status, 200, p);
  }
});
