#!/usr/bin/env node
// Root schedules this once after source/pins review. Reuses the sole existing
// fixture/server/Chrome cleanup owner; no second server manager.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loadavg } from 'node:os';
import { createFixtureSessions } from './fixture-session.mjs';
import { sourceReceipt } from './source-receipt.mjs';
import { genesis, cases, edits } from './fixture.mjs';
import { chromeLease } from '../god-skill/lib/chrome-lease.mjs';
import { freeMemGb } from '../playtest/lib/platform.mjs';
import { decodeContextPng } from '../../apps/server/src/god/context-sheet.ts';
import { runAgentUsefulness } from './agent-usefulness.mjs';
import { USEFULNESS_PROTOCOL as P, redact } from './agent-usefulness-protocol.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
if (args.length !== 5 || args[0] !== '--execute' || args[1] !== '--pins' || args[3] !== '--out')
  throw Error('Source review required. Command: pnpm exec tsx tools/context-views/agent-usefulness-owner.mjs --execute --pins /absolute/pins.json --out /absolute/new-proof-dir');
const pinsFile = resolve(args[2]), out = resolve(args[4]);
if (!relative(root, out).startsWith('..') || out === root || existsSync(out)) throw Error('proof output must be a new directory outside source root');
const pins = JSON.parse(readFileSync(pinsFile, 'utf8'));
for (const key of ['sourceSha256', 'sourceHead', 'webDir', 'cliSha256', 'skillSha256']) if (!pins[key]) throw Error(`missing reviewed pin ${key}`);
const startedAt = Date.now(), outerDeadline = startedAt + P.outerWallSeconds * 1000, deadline = outerDeadline - 5000;
const stop = new AbortController(), timer = setTimeout(() => stop.abort(new Error('usefulness work deadline; cleanup reserve begins')), deadline - Date.now());
const report = { protocol: P, startedAt, outerDeadline, workDeadline: deadline, pinsSha256: sha(readFileSync(pinsFile)),
  sourceReceipt: sourceReceipt(root, pins.webDir), fixtureSha256: sha(JSON.stringify({ genesis, cases, edits })), phases: [],
  actualModelTurns: 0, passMeaning: 'Protocol integrity only; human usefulness grading remains pending root review.', cleanup: { complete: false } };
if (report.sourceReceipt.sha256 !== pins.sourceSha256 || report.sourceReceipt.head !== pins.sourceHead || report.sourceReceipt.build.some(row => row.missing)) {
  clearTimeout(timer); throw Error('reviewed source/build pin mismatch');
}
mkdirSync(out);
const save = () => writeFileSync(resolve(out, 'owner.json'), JSON.stringify(redact(report), null, 2));
const setPhase = phase => { report.phases.push({ phase, at: Date.now() }); save(); };
const slot = '<team>/lanes/MEASURE.slot';
const claim = `${new Date().toISOString()} context-usefulness pid=${process.pid} until${new Date(outerDeadline).toISOString()}`;
let release, claimed = false, fixtureEntered = false;
const priorEnv = Object.fromEntries(['WEB_DIR', 'EDGE_CONTROLLER_CLI_FILE', 'EDGE_SKILL_FILE', 'PATH'].map(key => [key, process.env[key]]));
try {
  if (loadavg()[0] >= 10 || freeMemGb() < 6) throw Error('ambient admission requires load1<10 and free>=6GiB');
  const current = readFileSync(slot, 'utf8').split('\n').filter(line => line !== process.env.CONTEXT_RESERVED_CLAIM).join('\n');
  if (current.split('\n').some(line => line.trim() && !line.startsWith('#'))) throw Error('MEASURE.slot held');
  writeFileSync(slot, current + '\n' + claim + '\n'); claimed = true;
  release = await chromeLease('context-usefulness root-approved', { slots: 1, waitMs: 1000 });
  process.env.WEB_DIR = resolve(pins.webDir);
  process.env.EDGE_CONTROLLER_CLI_FILE = resolve(root, 'tools/world-launcher/soul/eden.mjs');
  process.env.EDGE_SKILL_FILE = resolve(root, 'tools/world-launcher/soul/skill.md');
  if (sha(readFileSync(process.env.EDGE_CONTROLLER_CLI_FILE)) !== pins.cliSha256 || sha(readFileSync(process.env.EDGE_SKILL_FILE)) !== pins.skillSha256) throw Error('reviewed CLI/skill source pin mismatch');
  const withSession = createFixtureSessions({ root, out, port: 5980, deadline, signal: stop.signal,
    abort: reason => stop.abort(reason), report, save, setPhase, maxStarts: 6, maxDownloads: 12 });
  fixtureEntered = true;
  report.session = await withSession({ variant: 'usefulness-frozen' }, async session => {
    const bootstrap = resolve(out, 'bootstrap'); mkdirSync(bootstrap);
    for (const [endpoint, name, pin] of [['/eden.mjs', 'eden.mjs', pins.cliSha256], ['/skill.md', 'skill.md', pins.skillSha256]]) {
      const response = await session.rawGet(endpoint); if (!response.ok) throw Error(`bootstrap HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer()); if (sha(bytes) !== pin) throw Error(`served ${name} pin mismatch`);
      writeFileSync(resolve(bootstrap, name), bytes);
      (report.bootstrap ??= []).push({ endpoint, bytes: bytes.length, sha256: sha(bytes) }); save();
    }
    report.experiment = await runAgentUsefulness({ session: { ...session, sourceRoot: root, sourceReceipt: report.sourceReceipt },
      decodePng: decodeContextPng, cliFile: resolve(bootstrap, 'eden.mjs'), skillFile: resolve(bootstrap, 'skill.md'),
      cliSha256: pins.cliSha256, skillSha256: pins.skillSha256, out: resolve(out, 'experiment'), deadline, signal: stop.signal });
    report.actualModelTurns = report.experiment.seats.some(seat => seat.actualThreadStarts === undefined) ? null : report.experiment.seats.reduce((sum, seat) => sum + seat.actualThreadStarts, 0);
    report.scheduledAdapterCalls = report.experiment.seats.length;
  });
  report.sourceAfter = sourceReceipt(root, pins.webDir);
  report.pass = report.experiment?.status === 'protocol-valid-awaiting-root-grading' && report.actualModelTurns === 4 &&
    !report.session.error && report.session.cleanup.complete && report.session.totalActualStarts <= 6 && report.sourceAfter.sha256 === pins.sourceSha256;
  if (!report.pass) process.exitCode = 1;
} catch (error) { report.error = String(error.message); report.pass = false; process.exitCode = 1; }
finally {
  clearTimeout(timer); stop.abort(new Error('usefulness owner complete'));
  release?.();
  if (claimed) writeFileSync(slot, readFileSync(slot, 'utf8').split('\n').filter(line => line !== claim).join('\n'));
  for (const [key, value] of Object.entries(priorEnv)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  report.finishedAt = Date.now(); report.wallMs = report.finishedAt - startedAt;
  report.cleanup = { complete: report.session?.cleanup?.complete ?? !fixtureEntered, within600s: report.finishedAt <= outerDeadline, leaseReleased: true, measureClaimReleased: !claimed || !readFileSync(slot, 'utf8').split('\n').includes(claim) };
  if (!report.cleanup.complete || !report.cleanup.within600s) { report.pass = false; process.exitCode = 1; }
  save();
}
