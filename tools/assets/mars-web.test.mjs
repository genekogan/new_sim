// node --test tools/assets/mars-web.test.mjs — the character-set check and the build stamp (issue #395). No media needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { characterSet, inputStamp, missingCharacters } from './mars-web.mjs';

test('the character set covers the kit, its rigs and parts, and the animated bodies', () => {
  const paths = characterSet().map(f => f.path);
  for (const p of ['modular/humanoid/kit.json', 'modular/humanoid/rig-masc.glb', 'modular/humanoid/rig-fem.glb',
    'modular/environment/animated-casual.mesh.glb', 'modular/environment/animated-punk.mesh.glb',
    'modular/environment/animated-woman.mesh.glb', 'modular/environment/clips-ual.glb']) assert.ok(paths.includes(p), p);
  assert.ok(paths.filter(p => p.startsWith('modular/humanoid/parts/')).length > 50, 'humanoid parts');
});

test('missingCharacters names absent and wrong-sized files, and nothing when all are in place', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mars-web-'));
  try {
    const set = [{ path: 'modular/humanoid/kit.json', bytes: 3 }, { path: 'modular/environment/a.glb', bytes: 4 }];
    assert.deepEqual(missingCharacters(dir, set), set.map(f => f.path), 'empty site: everything is missing');
    mkdirSync(join(dir, 'modular/humanoid'), { recursive: true }); mkdirSync(join(dir, 'modular/environment'));
    writeFileSync(join(dir, 'modular/humanoid/kit.json'), '{}\n'); writeFileSync(join(dir, 'modular/environment/a.glb'), 'ab');
    assert.deepEqual(missingCharacters(dir, set), ['modular/environment/a.glb'], 'a truncated file counts as missing');
    writeFileSync(join(dir, 'modular/environment/a.glb'), 'abcd');
    assert.deepEqual(missingCharacters(dir, set), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the stamp changes with an input and ignores outputs and dependencies', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mars-web-'));
  try {
    mkdirSync(join(dir, 'public/modular'), { recursive: true }); mkdirSync(join(dir, 'dist/client'), { recursive: true });
    mkdirSync(join(dir, 'node_modules/x'), { recursive: true });
    writeFileSync(join(dir, 'index.html'), '<p>'); writeFileSync(join(dir, 'public/modular/kit.json'), '{}');
    const a = inputStamp(dir, []);
    assert.equal(inputStamp(dir, []), a, 'stable');
    writeFileSync(join(dir, 'dist/client/out.js'), 'x'); writeFileSync(join(dir, 'node_modules/x/i.js'), 'x');
    assert.equal(inputStamp(dir, []), a, 'outputs and dependencies are not inputs');
    writeFileSync(join(dir, 'public/modular/kit.json'), '{"a":1}');
    const b = inputStamp(dir, []);
    assert.notEqual(b, a, 'a changed public file');
    utimesSync(join(dir, 'index.html'), new Date(2001, 0, 1), new Date(2001, 0, 1));
    assert.notEqual(inputStamp(dir, []), b, 'a touched source file');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
