// RL6 skill lint: SKILL.md and HELP are read by the CLI's own reader, and every example or file the skill points at
// is served by a world (in process; no ports).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COMMANDS, EXAMPLES } from './cli.mjs';
import { concrete, examplesHeadingCount, helpCommands, lint, lintArgv, servedPaths, skillCommands, variants } from './lib/skill-lint.mjs';

const skill = readFileSync(new URL('./SKILL.md', import.meta.url), 'utf8');
const show = r => r.failures.map(f => `${f.where}:${f.line} ${f.argv.join(' ')} — ${f.error.slice(0, 140)}`);

test('every command written in SKILL.md passes the CLI reader', () => {
  const r = lint(skillCommands(skill));
  assert.ok(r.checked >= 150, `only ${r.checked} commands found in SKILL.md`);
  assert.deepEqual(show(r), []);
});

test('every command in the CLI HELP passes the CLI reader', async () => {
  const r = lint(helpCommands(await COMMANDS.help([], {})));
  assert.ok(r.checked >= 80, `only ${r.checked} commands found in HELP`);
  assert.deepEqual(show(r), []);
});

test('usage notation is read the way an agent reads it, and real mistakes still fail', () => {
  assert.deepEqual(variants('move <ref> --near … | --at … | --by dx,dz   # children ride along').map(concrete), [['move', '<ref>', '--near', '…'], ['move', '<ref>', '--at', '…'], ['move', '<ref>', '--by', '1,1']]);
  assert.deepEqual(variants('time 19:30 | time 7pm').map(v => v.join(' ')), ['time 19:30', 'time 7pm']);
  assert.deepEqual(variants('select [filters] [--remove|--by|--recolor]').map(concrete), [['select', '--remove'], ['select', '--by', '1,1'], ['select', '--recolor', 'x']]);
  assert.deepEqual(variants('doctor [--fix] [--local] [--json] (holders, stale locks; --fix breaks only stale ownership)'), [['doctor', '--fix', '--local', '--json']]);
  assert.deepEqual(variants("define-kit '{\"name\":\"b\", \"shapes\":[]}'"), [['define-kit', '{"name":"b", "shapes":[]}']]);
  assert.deepEqual(variants('the god reads prayers · flags'), [['flags']]);
  for (const bad of ['set observatory --param roofPitch=60 --dry', 'place bench --in pier', 'describe a b', 'look --dsit 30', 'move x --by 1', 'place tree --grid 3', 'place x --param floors']) {
    assert.ok(lintArgv(variants(bad)[0]), `${bad} should fail`);
  }
  assert.equal(lintArgv(variants('look --dist m')[0]), null, 'a word for a numeric option is a placeholder, not a mistake');
  const r = lint([{ line: 1, text: 'place cottage --at 0,0 --colour red', where: 'block' }]);
  assert.equal(r.failures.length, 1); assert.match(r.failures[0].error, /place has no option --colour/);
});

test('SKILL.md counts its recorded examples correctly', () => {
  assert.equal(examplesHeadingCount(skill), Object.keys(EXAMPLES).length);
});

test('every listed example and every file the skill points at is served', async () => {
  const { replayWorld } = await import('../../apps/server/src/god/replay-world.ts');
  const world = replayWorld({ schema: 'genesis/1', batches: [] });
  try {
    const paths = servedPaths(skill, EXAMPLES);
    for (const name of Object.keys(EXAMPLES)) assert.ok(paths.includes(`/god/examples/${name}.log`));
    assert.ok(paths.includes('/god/kit-primitives.png') && paths.includes('/god/examples/light-motion.mjs'), paths.join(' '));
    const missing = [];
    for (const path of paths) { const r = await world.app.request(path); if (r.status !== 200) missing.push(`${path} ${r.status}`); await r.arrayBuffer(); }
    assert.deepEqual(missing, []);
    assert.equal((await world.app.request('/god/examples/church-massing.log')).status, 404, 'a missing example is a 404, which the lint would catch if it were listed');
  } finally { world.close(); }
});
