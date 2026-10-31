// node --test tools/assets/mars-web.test.mjs — the character-set check and the build stamp (issue #395). No media needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { characterSet, inputStamp, main, missingCharacters, STAMP } from './mars-web.mjs';

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

test('main builds when stale, skips when current, and fails or warns when the character set cannot be there', () => {
  const viewer = mkdtempSync(join(tmpdir(), 'mars-web-'));
  try {
    const set = [{ path: 'modular/humanoid/kit.json', bytes: 2 }, { path: 'modular/environment/a.glb', bytes: 4 }];
    const logs = [], log = (l) => logs.push(l);
    let builds = 0;
    const copy = (v) => { builds++; cpSync(join(v, 'public'), join(v, 'dist/client'), { recursive: true }); };
    const run = (argv = [], build = copy) => main(argv, log, { viewer, set, extra: [], build });
    assert.equal(run(['--check']), 1, '--check on a missing site fails');
    assert.equal(run(), 0); assert.equal(builds, 0, 'media not pulled: warn, build nothing');
    assert.match(logs.at(-1), /^warning: 2 character files missing .*pnpm assets:pull/);
    mkdirSync(join(viewer, 'public/modular/humanoid'), { recursive: true }); mkdirSync(join(viewer, 'public/modular/environment'));
    writeFileSync(join(viewer, 'public/modular/humanoid/kit.json'), '{}'); writeFileSync(join(viewer, 'public/modular/environment/a.glb'), 'abcd');
    assert.equal(run(), 0); assert.equal(builds, 1, 'first run builds');
    assert.ok(existsSync(join(viewer, 'dist/client', STAMP)), 'and stamps');
    assert.equal(run(['--check']), 0);
    assert.equal(run(), 0); assert.equal(builds, 1, 'current: no build');
    writeFileSync(join(viewer, 'index.html'), '<p>');
    assert.equal(run(), 0); assert.equal(builds, 2, 'a changed input rebuilds');
    unlinkSync(join(viewer, 'dist/client/modular/environment/a.glb'));
    assert.equal(run(), 0); assert.equal(builds, 3, 'a character file gone from the site rebuilds, stamp or not');
    assert.equal(run(['--force']), 0); assert.equal(builds, 4, '--force rebuilds');
    const lossy = (v) => { copy(v); unlinkSync(join(v, 'dist/client/modular/humanoid/kit.json')); };
    assert.equal(run(['--force'], lossy), 1, 'a build that leaves the set out fails');
    assert.match(logs.at(-1), /left 1 character files out/);
  } finally { rmSync(viewer, { recursive: true, force: true }); }
});
