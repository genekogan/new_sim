#!/usr/bin/env node
// Arena integration smoke (run manually, ≈ 2–4 min, uses one haiku seat):
//   node tools/playtest/arena/smoke.mjs [--server-root dir] [--out dir] [--port 4995] [--model haiku] [--assist-onboard] [--keep-world]
// Boots a dev world, one claude-headless seat, onboards it with the §6 text, waits for paired, sends ONE card message
// ("sit down") as the owner, lets the wake loop deliver it, waits for the card result (or 120 s), prints a JSON summary
// and tears everything down.
import { join, resolve } from 'node:path';
import { provision, stopWorld, healthz } from './provision.mjs';
import { createSeat } from './seat.mjs';
import { sendCard, cardView, cardSummary, publicSoul } from './owner.mjs';
import { writeJson, readJsonl } from '../lib/jsonl.mjs';
import { setAnchor, now, sleep, until } from '../lib/clock.mjs';
import { REPO_ROOT, scratchDir } from '../../lib/paths.mjs';

const argv = process.argv.slice(2);
const flag = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes(`--${k}`);
const serverRoot = resolve(flag('server-root', process.env.PLAYTEST_SERVER_ROOT ?? REPO_ROOT));
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const runDir = resolve(flag('out', join(process.env.PLAYTEST_RUNS_ROOT ?? scratchDir('playtest/runs'), `${stamp}-arena-smoke`)));
const adapter = flag('adapter', 'claude-headless');
if (!['claude-headless', 'codex-headless'].includes(adapter)) throw new Error('unknown adapter; no substitution allowed');
const port = Number(flag('port', 4995)), model = flag('model', adapter === 'codex-headless' ? '' : 'haiku'), resultSec = Number(flag('result-sec', 120));
const log = (...a) => console.error(`[smoke ${now().mono}ms]`, ...a);

setAnchor(performance.now());
const t0 = Date.now(), wall = {};
let world = null, seat = null;
const summary = { ok: false, runDir, port, model, adapter, assisted: has('assist-onboard') };
try {
  world = await provision({ runDir, serverRoot, world: { kind: 'dev', slug: 'pt-smoke', port, genesis: 'worlds/templates/hello-hamlet.json' } });
  wall.worldMs = Date.now() - t0; log('world up', world.base, 'eden.mjs', world.cli['eden.mjs.version'], 'skill', world.skill.version);
  summary.world = { base: world.base, build: world.build, skill: world.skill.version, cli: world.cli['eden.mjs.version'], instructions2: world.instructions.mentionsEdenMjs };

  seat = createSeat({ runDir, seat: { id: 'pip', adapter, model, effort: 'medium', soulName: 'Pip', wake: true }, worldBase: world.base, rails: { maxTurnWallSec: 240 } });
  const tOn = Date.now();
  const on = await seat.onboard({ timeoutSec: 180, assist: has('assist-onboard') });
  wall.onboardMs = Date.now() - tOn; log('onboard', on.ok ? `paired ${on.soulId} (${on.soulName})` : `NOT paired: ${JSON.stringify(on.status).slice(0, 200)}`);
  summary.onboard = { ok: on.ok, soulId: on.soulId, soulName: on.soulName, pairedWithinSec: seat.info.onboard?.pairedWithinSec, finalText: on.turn?.finalText?.slice(0, 400) ?? null, effortApplied: seat.info.effortApplied ?? null };
  if (!on.ok) throw new Error('onboarding did not reach paired within 180 s (recorded, not assisted)');

  const who = { base: world.base, soulId: on.soulId, identity: seat.info.ownerIdentity };
  seat.wakeLoop();
  const listening = await until(async () => (await cardView(who))?.presence === 'listening', { timeoutMs: 20000, everyMs: 500 });
  log('presence before send', listening ? 'listening' : cardSummary(await cardView(who)).presence);

  const tReq = Date.now();
  const requestText = flag('text', 'Sit down on the bench by the cottage and remain seated for at least 60 seconds. Tell me when you are seated, while still sitting.');
  const snapshot = await (await fetch(`${world.base}/v1/world/snapshot`)).json();
  const bench = snapshot.entities.find(e => e.name === 'bench');
  if (!bench) throw new Error('smoke fixture has no bench');
  const sent = await sendCard({ ...who, text: requestText });
  log('sent', sent.messageId);
  let card = null, ackAt = null, atResult = null; const postureSamples = [];
  const done = await until(async () => {
    card = cardSummary(await cardView(who));
    if (card.ackText && !ackAt) { ackAt = Date.now(); log('ack', card.ackText); }
    const body = await publicSoul(who);
    postureSamples.push({ t: new Date().toISOString(), state: body?.self?.state, receipts: body?.receipts ?? [] });
    if (card.resultText && !atResult) atResult = body;
    return card.resultText ? card : null;
  }, { timeoutMs: resultSec * 1000, everyMs: 2000 });
  wall.requestMs = Date.now() - tReq;
  log(done ? `result: ${card.resultText}` : `no result within ${resultSec} s`);
  await seat.stop(); // waits for an in-flight wake turn
  const late = done ? null : cardSummary(await cardView(who)); // after the in-flight turn ended: a result that came past the cutoff
  const pub = await publicSoul(who).catch((e) => ({ error: String(e) }));
  const turns = readJsonl(join(runDir, 'seats/pip/turns.jsonl')), cost = readJsonl(join(runDir, 'seats/pip/cost.jsonl'));
  const sum = (k) => cost.reduce((a, c) => a + (c[k] ?? 0), 0);
  Object.assign(summary, {
    ok: !!done && /sit|seated/i.test(atResult?.self?.state ?? '') && (atResult?.receipts ?? []).some(r => r.capability === `sit:${bench.id}` || r.chosen?.seat === bench.id) && /sit|seated/i.test(pub?.self?.state ?? '') && turns.some(t => t.reason === 'wake'),
    requestText, expectedBench: { id: bench.id, name: bench.name }, stateAtFirstResult: atResult?.self?.state ?? null, postureSamples, soulId: on.soulId, messageId: sent.messageId,
    resultWithinCutoff: !!done, lateResult: late?.resultText ? { text: late.resultText, outcome: late.outcome, afterSentMs: late.resultAt && late.sentAt ? late.resultAt - late.sentAt : null } : null,
    ackText: card?.ackText ?? null, ackLatencyMs: ackAt ? ackAt - tReq : null, resultText: card?.resultText ?? null, outcome: card?.outcome ?? null,
    publicState: pub?.self?.state ?? pub?.state ?? null, activity: pub?.self?.activity ?? pub?.activity ?? null,
    turns: turns.map((t) => ({ turn: t.turn, reason: t.reason, wallMs: t.wallMs, tools: t.toolCalls.length, exit: t.exit, timedOut: t.timedOut, tokensOut: t.usage?.outputTokens ?? null })),
    tokens: { input: sum('inputTokens'), cached: sum('cachedTokens'), cacheCreation: sum('cacheCreationTokens'), output: sum('outputTokens'), costUsd: cost.some(c => c.costUsd != null) ? Math.round(sum('costUsd') * 10000) / 10000 : null, billing: adapter === 'codex-headless' ? 'subscription; dollar cost unavailable' : 'reported API-equivalent' },
    wakes: readJsonl(join(runDir, 'seats/pip/listen.jsonl')).filter((l) => l.messages?.length).length,
  });
} catch (e) {
  summary.error = String(e?.message ?? e);
} finally {
  if (seat) await seat.stop().catch(() => {});
  if (world) {
    writeJson(join(runDir, 'server', 'healthz-after.json'), await healthz(world.base));
    if (!has('keep-world')) summary.worldStopped = (await stopWorld({ pid: world.pid })).stopped;
  }
  wall.totalMs = Date.now() - t0; summary.wall = wall;
  writeJson(join(runDir, 'smoke-summary.json'), summary);
  console.log(JSON.stringify(summary, null, 1));
  process.exit(summary.ok ? 0 : 1);
}
