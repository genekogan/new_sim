#!/usr/bin/env node
// Arena integration smoke (run manually, ≈ 2–4 min, uses one haiku seat):
//   node tools/playtest/arena/smoke.mjs [--server-root dir] [--out dir] [--port 4995] [--model haiku] [--assist-onboard] [--keep-world]
// Boots a dev world, one claude-headless seat, onboards it with the §6 text, waits for paired, sends ONE card message
// ("sit down") as the owner, lets the wake loop deliver it, waits for the card result (or 120 s), prints a JSON summary
// and tears everything down.
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { provision, stopWorld, healthz } from './provision.mjs';
import { createSeat } from './seat.mjs';
import { sendCard, cardView, cardSummary, publicSoul } from './owner.mjs';
import { writeJson, readJsonl } from '../lib/jsonl.mjs';
import { setAnchor, now, sleep, until } from '../lib/clock.mjs';

const argv = process.argv.slice(2);
const flag = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes(`--${k}`);
const serverRoot = resolve(flag('server-root', `${homedir()}/Eden/sim-wt/soul3-integration`));
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const runDir = resolve(flag('out', `${homedir()}/Eden/team/playtest/runs/${stamp}-arena-smoke`));
const port = Number(flag('port', 4995)), model = flag('model', 'haiku'), resultSec = Number(flag('result-sec', 120));
const log = (...a) => console.error(`[smoke ${now().mono}ms]`, ...a);

setAnchor(performance.now());
const t0 = Date.now(), wall = {};
let world = null, seat = null;
const summary = { ok: false, runDir, port, model, assisted: has('assist-onboard') };
try {
  world = await provision({ runDir, serverRoot, world: { kind: 'dev', slug: 'pt-smoke', port, genesis: 'worlds/templates/hello-hamlet.json' } });
  wall.worldMs = Date.now() - t0; log('world up', world.base, 'eden.mjs', world.cli['eden.mjs.version'], 'skill', world.skill.version);
  summary.world = { base: world.base, build: world.build, skill: world.skill.version, cli: world.cli['eden.mjs.version'], instructions2: world.instructions.mentionsEdenMjs };

  seat = createSeat({ runDir, seat: { id: 'pip', adapter: 'claude-headless', model, effort: 'medium', soulName: 'Pip' }, worldBase: world.base, rails: { maxTurnWallSec: 240 } });
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
  const sent = await sendCard({ ...who, text: 'sit down' });
  log('sent', sent.messageId);
  let card = null, ackAt = null;
  const done = await until(async () => {
    card = cardSummary(await cardView(who));
    if (card.ackText && !ackAt) { ackAt = Date.now(); log('ack', card.ackText); }
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
    ok: !!done, soulId: on.soulId, messageId: sent.messageId,
    resultWithinCutoff: !!done, lateResult: late?.resultText ? { text: late.resultText, outcome: late.outcome, afterSentMs: late.resultAt && late.sentAt ? late.resultAt - late.sentAt : null } : null,
    ackText: card?.ackText ?? null, ackLatencyMs: ackAt ? ackAt - tReq : null, resultText: card?.resultText ?? null, outcome: card?.outcome ?? null,
    publicState: pub?.self?.state ?? pub?.state ?? null, activity: pub?.self?.activity ?? pub?.activity ?? null,
    turns: turns.map((t) => ({ turn: t.turn, reason: t.reason, wallMs: t.wallMs, tools: t.toolCalls.length, exit: t.exit, timedOut: t.timedOut, tokensOut: t.usage?.outputTokens ?? null })),
    tokens: { input: sum('inputTokens'), cached: sum('cachedTokens'), cacheCreation: sum('cacheCreationTokens'), output: sum('outputTokens'), costUsd: Math.round(sum('costUsd') * 10000) / 10000 },
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
