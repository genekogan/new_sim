// RL6 replay corpus: outcome classes, argv recovery, and the in-repo subset replayed in process against the pinned
// eden-district genesis + this source's library (no ports, no network, no browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argvCandidates, argvOf, chooseArgv, cliRefusal, outcomeOf, unreplayable } from './lib/replay.mjs';
import { checkSubset, cliPass } from './scripts/replay-corpus.mjs';

const here = dirname(fileURLToPath(import.meta.url)), subsets = join(here, 'replay');

test('outcome classes come from text, JSON and truncated JSON alike', () => {
  assert.equal(outcomeOf({ out: 'placed bench [core/bench@1] at (1, 0, 2)' }), 'ok');
  assert.equal(outcomeOf({ out: 'blocked → next\nREFUSED: overlap.solid (op 0): overlaps tree-3' }), 'refused:overlap.solid');
  assert.equal(outcomeOf({ out: '{"accepted":false,"failures":[{"op":0,"code":"def.unknown","detail":"x"}]}' }), 'refused:def.unknown');
  assert.equal(outcomeOf({ out: '{"accepted":false,"failures":[{"op":4,"code":"overlap.solid","detail":"' + 'x'.repeat(5000) }), 'refused:overlap.solid');
  assert.equal(outcomeOf({ out: { ok: false, failures: [{ code: 'build.lease' }] } }), 'refused:build.lease');
  assert.equal(outcomeOf({ out: { accepted: true, seq: 3 } }), 'ok');
  assert.equal(outcomeOf({ error: 'REFUSED by the CLI: --at needs a value' }), 'cli');
  assert.equal(outcomeOf({ error: 'REFUSED: build.unknown (op -1): church' }), 'refused:build.unknown');
  assert.equal(outcomeOf({ error: 'no such entity gatehouse' }), 'error');
});

test('joined rows re-split with the CLI tables; exact argv wins when recorded', () => {
  assert.deepEqual(argvOf({ cmd: 'build start nave --title Gothic black church --steps shell,roof --at 90,19 --size 40,16' }), ['build', 'start', 'nave', '--title', 'Gothic black church', '--steps', 'shell,roof', '--at', '90,19', '--size', '40,16']);
  assert.deepEqual(argvOf({ cmd: 'act {"ops": [{"op": "remove", "id": "x"}]} --note two words' }), ['act', '{"ops": [{"op": "remove", "id": "x"}]}', '--note', 'two words']);
  assert.deepEqual(argvOf({ cmd: 'place lantern --on pier --count 2 --dry' }), ['place', 'lantern', '--on', 'pier', '--count', '2', '--dry']);
  assert.deepEqual(argvOf({ cmd: 'place x --between a b --name n' }), ['place', 'x', '--between', 'a', 'b', '--name', 'n']);
  assert.deepEqual(argvOf({ cmd: 'ignored', argv: ['place', 'a b', '--param', 'k=v w=2'] }), ['place', 'a b', '--param', 'k=v w=2']);
  // a quoted summary that mentions an option: the prose candidate keeps it as words
  const row = { cmd: 'build done booth with a lantern; night views taken with look --hour 21', out: 'theatre-2: done' };
  assert.equal(argvCandidates(row).length, 2);
  assert.ok(cliRefusal(argvOf(row)));
  assert.deepEqual(chooseArgv(row), ['build', 'done', 'booth with a lantern; night views taken with look --hour 21']);
  // a recorded CLI refusal keeps the reading that the CLI refuses
  assert.ok(cliRefusal(chooseArgv({ cmd: 'place tower --at --facing w --name t', error: 'REFUSED by the CLI: --at needs a value' })));
});

test('rows that cannot replay say why', () => {
  assert.equal(unreplayable({ cmd: 'look --at plaza' }), 'browser');
  assert.equal(unreplayable({ cmd: 'build wait --timeout 5m' }), 'waits for other agents');
  assert.equal(unreplayable({ cmd: 'describe e_0123abcd' }), 'generated id');
  assert.equal(unreplayable({ cmd: 'hours cafe --open 07:00-15:00' }), 'engine (Souls layer)');
  assert.equal(unreplayable({ cmd: 'place tree --param a=1 --param b=2', error: 'REFUSED by the CLI: cannot read "--param a…": several options arrived as ONE argument' }), 'argv joined in transcript');
  assert.equal(unreplayable({ cmd: 'status', error: 'world missing. Run: node eden-god.mjs register <world-url>' }), 'setup');
  assert.equal(unreplayable({ cmd: 'describe house' }), null);
});

test('the CLI writes exact argv into a transcript (quoting survives), with tokens redacted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'god-transcript-')), tr = join(dir, 't.jsonl');
  try {
    writeFileSync(join(dir, '.eden-god.json'), JSON.stringify({ transcript: tr }));
    const run = args => spawnSync(process.execPath, [join(here, 'eden-god.mjs'), ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, EDEN_GOD_TRACE: '' } });
    // (a plain "--param a=1 --param b=2" in one argument is now read as separate words — fix cliargs — so the refusal
    // recorded here is one with quotes inside, which the CLI never splits)
    run(['help', 'two words']); run(['place', 'bench', '--param "label=a b" --scale 2', '--note', 'god_world_secret']);
    const rows = readFileSync(tr, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.deepEqual(rows[0].argv, ['help', 'two words']);
    assert.deepEqual(rows[1].argv, ['place', 'bench', '--param "label=a b" --scale 2', '--note', 'god_…']);
    assert.equal(outcomeOf(rows[1]), 'cli');
    assert.equal(unreplayable(rows[1]), null); // the joined cmd could not replay this refusal; exact argv can
    assert.match(cliRefusal(argvOf(rows[1])), /ONE argument/);
    assert.notEqual(cliRefusal(argvOf({ cmd: rows[1].cmd })), cliRefusal(argvOf(rows[1])));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('subset rows read today exactly as they were read when recorded (no CLI regressions)', () => {
  for (const f of readdirSync(subsets).filter(f => f.endsWith('.json'))) {
    const c = cliPass(JSON.parse(readFileSync(join(subsets, f), 'utf8')).rows.map(r => ({ ...r, ...(r.recorded === 'cli' ? { error: r.error ?? 'REFUSED by the CLI' } : {}) })));
    assert.deepEqual(c.regressions, [], f); assert.deepEqual(c.loosened, [], f);
  }
});

for (const f of readdirSync(subsets).filter(f => f.endsWith('.json')).sort()) {
  test(`replay subset ${f}: every comparable row gives its expected outcome class`, async () => {
    const r = await checkSubset(join(subsets, f));
    assert.ok(r.summary.compared >= 40, `${f}: only ${r.summary.compared} rows compared`);
    assert.deepEqual(r.wrong.map(w => `${w.file}:${w.line} ${w.argv.join(' ').slice(0, 80)} expected ${w.expected ?? w.recorded}, got ${w.replayed}: ${w.detail ?? ''}`), [],
      'a changed outcome: fix the regression, or rewrite the subset with node tools/god-skill/scripts/replay-corpus.mjs <runs> --run <name> --write-subset tools/god-skill/replay --reasons <file>');
  });
}

test('a changed outcome is caught: a synthetic run whose recorded classes no longer hold', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'god-replay-subset-'));
  try {
    const at = i => new Date(Date.UTC(2026, 9, 15, 12, 0, i)).toISOString();
    const rows = [
      { at: at(0), cmd: 'status', recorded: 'ok' },
      { at: at(1), cmd: 'place bench --at 40,40 --name replay-bench', recorded: 'ok' },
      { at: at(2), cmd: 'describe replay-bench', recorded: 'ok' },
      { at: at(3), cmd: 'describe no-such-thing', recorded: 'ok' },          // recorded wrongly: today it is an error
      { at: at(4), cmd: 'set replay-bench --dry', recorded: 'ok' },          // recorded wrongly: the CLI refuses --dry on set
      { at: at(5), cmd: 'remove replay-bench', recorded: 'ok' },
    ];
    writeFileSync(join(dir, 'synthetic.json'), JSON.stringify({ run: 'synthetic', genesis: 'worlds/templates/eden-district.json', files: {}, rows }));
    const r = await checkSubset(join(dir, 'synthetic.json'));
    assert.deepEqual(r.wrong.map(w => [w.argv[0], w.replayed]), [['describe', 'error'], ['set', 'cli']]);
    assert.equal(r.summary.compared, 6);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
