import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCENARIOS, REPO, validateScenario, validateCast, validateFile, checkTargets } from '../lib/validate.mjs';
import { templateNames, compassFrom } from '../lib/world-names.mjs';

const read = (f) => JSON.parse(readFileSync(join(SCENARIOS, f), 'utf8'));
const files = readdirSync(SCENARIOS).filter((f) => f.endsWith('.json'));
const casts = readdirSync(join(SCENARIOS, 'casts')).filter((f) => f.endsWith('.json')).map((f) => `casts/${f}`);

test('every scenario and cast in the folder validates (shape, seats, script budgets, expect truth vs the template)', () => {
  for (const f of [...files, ...casts]) assert.deepEqual(validateFile(join(SCENARIOS, f)), [], f);
});

test('the validator catches what would break a run', () => {
  const s = read('wayfind-hello-hamlet.json');
  const bad = structuredClone(s);
  bad.world.kind = 'live'; bad.seats[1].adapter = 'gpt'; bad.director.script[0].seat = 'nobody'; bad.director.script[2].atSec = bad.director.script[1].atSec + 5;
  bad.director.script[3].expect.targets[0].pos = [0, 0]; bad.director.script[4].expect = { kind: 'near', source: 'x' };
  bad.director.script[5].expect.targets[0].ref = 'castle'; bad.director.script[5].expect.targets[0].names = ['castle'];
  const errs = validateScenario(bad).join('\n');
  for (const re of [/world.kind/, /adapter gpt/, /nobody/, /before .* has used its budget/, /template position/, /answer.anyOf/, /"castle" is not a placed name/]) assert.match(errs, re);
});

test('round-2 batteries: 12 requests per seat, chat only, every request with an expect, wayfinding on sonnet + haiku', () => {
  for (const f of ['wayfind-eden-2026.json', 'wayfind-mars-two.json', 'wayfind-hello-hamlet.json', 'look-eden-2026.json', 'look-mars-two.json']) {
    const s = read(f);
    for (const seat of s.seats) {
      const mine = s.director.script.filter((e) => e.seat === seat.id);
      assert.equal(mine.length, 12, `${f} ${seat.id}`);
      assert.ok(mine.every((e) => e.channel === 'chat' && e.expect && e.expect.source.includes(s.world.genesis)), f);
    }
    assert.deepEqual(s.observer.viewport, [1024, 640]);
    if (f.startsWith('wayfind')) {
      assert.deepEqual(s.seats.map((x) => [x.adapter, x.model]), [['claude-headless', 'sonnet'], ['claude-headless', 'haiku']], f);
      const kinds = new Set(s.director.script.map((e) => e.expect.kind));
      for (const k of ['go', 'near', 'find', 'which-way']) assert.ok(kinds.has(k), `${f} has ${k}`);
    } else {
      assert.deepEqual(s.seats.map((x) => x.model), ['sonnet'], f);
      const k = s.director.script.map((e) => e.expect.kind);
      assert.deepEqual(k, Array(4).fill(['go', 'face', 'look']).flat(), `${f}: four walk → face → look triples`);
      assert.ok(s.director.script.some((e) => e.expect.view === 'out'), `${f} asks for a picture once (view --out)`);
    }
  }
});

test('the worlds the batteries name are the ones in the plan', () => {
  assert.equal(read('wayfind-eden-2026.json').world.genesis, 'worlds/templates/eden-2026.json');
  assert.equal(read('wayfind-mars-two.json').world.genesis, 'worlds/templates/mars-two.json');
  assert.equal(read('wayfind-hello-hamlet.json').world.genesis, 'worlds/templates/hello-hamlet.json');
  for (const f of ['newcomer-r2.json', 'pinkteam-r2.json']) { const s = read(f); assert.equal(s.world.genesis, 'worlds/templates/eden-district.json'); assert.equal(s.director.mode, 'persona'); }
  assert.deepEqual(read('newcomer-r2.json').seats.map((x) => [x.model, x.persona]), [['opus', 'newcomer']]);
  assert.deepEqual(read('pinkteam-r2.json').seats.map((x) => [x.model, x.persona]), [['sonnet', 'pinkteam']]);
});

test('world-names reads template truth: positions, children in a parent, compass in the world frame', () => {
  const N = templateNames(join(REPO, 'worlds/templates/hello-hamlet.json'));
  assert.deepEqual(N.get('cottage').pos, [44, 10]);
  assert.equal(N.get('bench').parent, 'cottage'); assert.deepEqual(N.get('bench').pos, [44, 15]);
  assert.deepEqual(N.get('pond').pos.map(Math.round), [-17, 44]);
  assert.equal(compassFrom([0, 0], [0, -10]), 'north'); assert.equal(compassFrom([0, 0], [10, 10]), 'south-east');
  assert.deepEqual(checkTargets('worlds/templates/hello-hamlet.json', [{ ref: 'cottage', pos: [44, 10] }], 'x'), []);
});

test('casts: the loader accepts them; a podium cast names a podium the template places', () => {
  for (const f of casts) assert.deepEqual(validateCast(read(f)), [], f);
  assert.ok(existsSync(join(REPO, 'worlds/templates/eden-2026.json')));
});
