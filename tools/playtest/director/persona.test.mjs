import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PersonaSession, parseSheet, loadSheet, normalizeDecision, PERSONA_DIR } from './persona.mjs';
import { PNG_1x1 } from './fakes.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'pt-persona-test-'));
const good = { say: { channel: 'card', text: 'go say hi to the duck' }, waitSec: 15, thought: 'is that a duck?', rating: null, desires: [], complaints: [], quick: true, done: false };
function fakeModel(answers) {
  const calls = [];
  const fn = async (args) => { calls.push(args); const a = answers[Math.min(calls.length - 1, answers.length - 1)]; return { text: a, json: null, exit: 0, timedOut: false, sessionId: args.sessionId ?? 'sess-1', usage: null, wallMs: 1 }; };
  fn.calls = calls; return fn;
}
function shown(dir) { const p = join(dir, 'shot.png'); writeFileSync(p, PNG_1x1); return { elapsedSec: 12, screenshotPath: p, legible: { signs: ['Mill'] }, cardView: null, chatRendered: '', lastRequests: [] }; }

test('all twelve sheets parse, stay short, carry the contract and no internals', () => {
  const names = readdirSync(PERSONA_DIR).filter((f) => f.endsWith('.md')).map((f) => f.replace('.md', '')).sort();
  assert.deepEqual(names, ['boundary', 'casual', 'expert', 'first-timer', 'newcomer', 'pinkteam', 'pinkteam-god', 'social', 'spectator', 'storyteller', 'storyteller-god', 'tinkerer']);
  for (const n of names) {
    const { text } = loadSheet(n); const { meta, body } = parseSheet(text);
    assert.equal(meta.persona, n); assert.ok(meta.axis >= 0 && meta.axis <= 1); assert.equal(meta.glanceSec.length, 2);
    assert.ok(text.split('\n').length < 120, n);
    assert.ok(body.includes('"waitSec"') && body.includes('"quick"') && body.includes('"done"'), n);
    if (meta.role === 'creator') assert.ok(body.includes('feltLikeGod'), n);
    assert.ok(!/eden\.mjs|eden-agent|receipt|\bAPI\b|endpoint|soulId|skill\.md|\btick\b|\binbox\b/i.test(body), n);
    if (['boundary', 'pinkteam', 'pinkteam-god'].includes(n)) assert.match(body, /make the world fail/);
    if (n !== 'expert') assert.ok(!meta.maySeeSkill, n);
  }
});

test('first step sends sheet + setting + glance; later steps resume the same session', async () => {
  const runDir = tmp(); const cm = fakeModel([JSON.stringify(good), 'Sure! ```json\n' + JSON.stringify({ ...good, say: null, waitSec: 30 }) + '\n```']);
  const p = PersonaSession({ runDir, seat: 'pip', sheet: 'newcomer', model: 'opus', setting: { worldName: 'Eden 2026', soulName: 'Pip' }, callModel: cm });
  const d1 = await p.step({ shown: shown(runDir) });
  assert.deepEqual(d1.say, good.say); assert.equal(d1.quick, true);
  const c1 = cm.calls[0];
  assert.equal(c1.resume, false);
  assert.deepEqual(c1.allowedTools, [`Read(/${resolve(runDir, 'personas/pip/shown')}/**)`]);
  assert.ok(c1.prompt.includes('# The newcomer') && !c1.prompt.includes('"persona":"newcomer"'));
  assert.ok(c1.prompt.includes('"Eden 2026"') && c1.prompt.includes('"Pip"'));
  assert.ok(c1.prompt.includes(join(runDir, 'personas/pip/shown/1.png')));
  assert.ok(c1.cwd.startsWith(tmpdir()) && !c1.cwd.startsWith(runDir));
  const d2 = await p.step({ shown: shown(runDir) });
  assert.equal(d2.say, null); assert.equal(d2.waitSec, 30);
  assert.equal(cm.calls[1].resume, true); assert.equal(cm.calls[1].sessionId, 'sess-1'); assert.equal(cm.calls[1].cwd, c1.cwd);
  assert.ok(!cm.calls[1].prompt.includes('# The newcomer'));
  const dir = join(runDir, 'personas/pip');
  assert.ok(existsSync(join(dir, 'shown/1.json')) && existsSync(join(dir, 'shown/1.png')) && existsSync(join(dir, 'sheet.md')));
  const turns = readFileSync(join(dir, 'turns.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(turns.length, 2); assert.equal(turns[0].parseError, false);
  assert.equal(JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8')).sessionId, 'sess-1');
});

test('one bad answer → JSON nudge → parsed', async () => {
  const runDir = tmp(); const cm = fakeModel(['hmm, let me think about the duck', JSON.stringify(good)]);
  const p = PersonaSession({ runDir, seat: 'a', sheet: 'newcomer', callModel: cm });
  const d = await p.step({ shown: shown(runDir) });
  assert.deepEqual(d.say, good.say);
  assert.equal(cm.calls.length, 2); assert.match(cm.calls[1].prompt, /JSON object only/); assert.equal(cm.calls[1].resume, true);
  assert.equal(JSON.parse(readFileSync(join(runDir, 'personas/a/turns.jsonl'), 'utf8')).retried, true);
});

test('two bad answers → fallback {say:null, waitSec:20, parseError:true}', async () => {
  const runDir = tmp(); const cm = fakeModel(['no', '{"not":"a decision"}']);
  const p = PersonaSession({ runDir, seat: 'a', sheet: 'casual', callModel: cm });
  const d = await p.step({ shown: shown(runDir) });
  assert.equal(d.say, null); assert.equal(d.waitSec, 20); assert.equal(d.parseError, true); assert.equal(cm.calls.length, 2);
});

test('a failed first call is retried as a fresh first call next step', async () => {
  const runDir = tmp(); let i = 0;
  const cm = async (args) => { i += 1; cm.calls.push(args); return i === 1 ? { text: '', exit: 1, sessionId: args.sessionId } : { text: JSON.stringify(good), exit: 0, sessionId: 's2' }; };
  cm.calls = [];
  const p = PersonaSession({ runDir, seat: 'a', sheet: 'newcomer', callModel: cm });
  assert.equal((await p.step({ shown: shown(runDir) })).parseError, true);
  await p.step({ shown: shown(runDir) });
  assert.equal(cm.calls[1].resume, false); assert.ok(cm.calls[1].prompt.includes('# The newcomer'));
});

test('finalRating asks for the whole-session judgement', async () => {
  const runDir = tmp(); const fin = { say: null, waitSec: 0, rating: { fun: 4, alive: 2, feltLikeGod: 5 }, desires: ['I wanted the river to flow'], complaints: [], quick: false, done: true };
  const cm = fakeModel([JSON.stringify(good), JSON.stringify(fin)]);
  const p = PersonaSession({ runDir, seat: 'g', sheet: 'pinkteam-god', callModel: cm });
  await p.step({ shown: shown(runDir) });
  const f = await p.finalRating();
  assert.deepEqual(f.rating, { fun: 4, alive: 2, feltLikeGod: 5 }); assert.equal(f.done, true);
  assert.match(cm.calls[1].prompt, /feltLikeGod/);
});

test('only the expert sheet gets the skill file', async () => {
  const runDir = tmp(); const skill = join(runDir, 'SKILL.md'); writeFileSync(skill, 'skill');
  const cmA = fakeModel([JSON.stringify(good)]); const cmB = fakeModel([JSON.stringify(good)]);
  await PersonaSession({ runDir, seat: 'gene', sheet: 'expert', skillPath: skill, callModel: cmA }).step({ shown: shown(runDir) });
  await PersonaSession({ runDir, seat: 'kid', sheet: 'newcomer', skillPath: skill, callModel: cmB }).step({ shown: shown(runDir) });
  assert.ok(existsSync(join(runDir, 'personas/gene/shown/skill.md')) && cmA.calls[0].prompt.includes('instructions file is at'));
  assert.ok(!existsSync(join(runDir, 'personas/kid/shown/skill.md')) && !cmB.calls[0].prompt.includes('instructions file'));
});

test('normalizeDecision guards the shape', () => {
  assert.equal(normalizeDecision(null), null); assert.equal(normalizeDecision([1]), null); assert.equal(normalizeDecision({ foo: 1 }), null);
  const d = normalizeDecision({ say: { channel: 'email', text: 'x' }, waitSec: 99999, rating: { fun: 9, alive: 0 }, desires: ['a', 3, ''] });
  assert.equal(d.say, null); assert.equal(d.waitSec, 900); assert.deepEqual(d.rating, { fun: 5, alive: 1 }); assert.deepEqual(d.desires, ['a']);
  assert.equal(normalizeDecision({ say: null, waitSec: 'soon' }).waitSec, 20);
});
