// One immutable owner fixture, four fresh Codex threads. This module owns no
// server/browser lifecycle. Import from the owner's reviewed tsx wrapper.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { turn, bareCommand } from '../playtest/arena/adapters/codex-headless.mjs';
import { run } from '../playtest/lib/proc.mjs';
import { providerPolicy, requireProviders } from '../playtest/lib/provider-policy.mjs';
import { USEFULNESS_PROTOCOL as P, TARGETS, promptFor, rawUsage, toolInventory, countWords, redact } from './agent-usefulness-protocol.mjs';
import { validateSeatCall } from './agent-usefulness-cli.mjs';
import { watchAdapter } from './agent-usefulness-process.mjs';
import { physicalFingerprint } from './photographer-runner.mjs';
import { pinCodexRuntime } from './agent-usefulness-runtime.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonHash = value => sha(JSON.stringify(value));

export function auditCommands(stream, arm) {
  const inventory = toolInventory(stream), errors = []; let bootstrap = 0, cli = 0;
  for (const item of inventory.commands) {
    const command = bareCommand(item.command).trim();
    if (command === 'cat skill.md') { bootstrap++; continue; }
    if (/[\r\n`$;&|<>\\]/.test(command)) { errors.push('shell composition or substitution forbidden'); continue; }
    const tokens = command.match(/"[^"\n]*"|'[^'\n]*'|[^\s"']+/g) ?? [];
    if (tokens.join(' ') !== command.replace(/\s+/g, ' ')) { errors.push('unsupported shell quoting'); continue; }
    const args = tokens.map(token => /^["']/.test(token) ? token.slice(1, -1) : token);
    if (args[0] !== 'node' || args[1] !== 'eden.mjs') { errors.push('command bypassed readonly wrapper'); continue; }
    cli++; try { validateSeatCall(args.slice(2), arm); } catch (error) { errors.push(error.message); }
  }
  if (bootstrap !== 1) errors.push('exactly one bootstrap skill read required');
  if (cli > P.cliCalls) errors.push('readonly CLI call ceiling exceeded');
  if (inventory.other.length) errors.push('unsupported tool event');
  return { ...inventory, shellCalls: inventory.commands.length, cliCalls: cli, bootstrapReads: bootstrap, errors };
}

export function auditImages({ inventory, downloads, cwd, canonicalCwd = cwd, arm }) {
  const errors = [], opened = [];
  for (const image of inventory.images) {
    const path = typeof image.path === 'string' ? resolve(cwd, image.path) : null;
    const download = downloads.find(value => [resolve(cwd, value.file), resolve(canonicalCwd, value.file)].includes(path));
    if (!image.completed || !download?.decoded) errors.push('native image_view lacks matching decoded download');
    else opened.push(download.file);
  }
  if (arm === 'text' && (downloads.length || inventory.images.length)) errors.push('text seat accessed images');
  if (arm === 'visual' && !opened.length) errors.push('visual exposure unproven: no native image_view');
  for (const download of downloads) if (!opened.includes(download.file)) errors.push('downloaded PNG was not opened natively');
  return { imageToolCalls: inventory.images.length, opened, errors };
}

/** Required owner fields: session(public fixture), decodePng(existing shared
 * decoder), cliFile/skillFile+expected SHA, out, absolute deadline, abort signal.
 * Owner must enforce outer600s, global actual-job admission and final cleanup. */
export async function runAgentUsefulness(owner) {
  const { session, decodePng, cliFile, skillFile, cliSha256, skillSha256, out, deadline, signal } = owner;
  const startedAt = Date.now(), outerDeadline = Math.min(deadline, startedAt + P.outerWallSeconds * 1000);
  if (!Number.isFinite(deadline) || !signal || typeof decodePng !== 'function') throw Error('owner deadline/signal/shared PNG decoder required');
  const base = new URL(session.base);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password || base.protocol !== 'http:') throw Error('isolated public loopback fixture required');
  const check = () => { signal.throwIfAborted(); if (Date.now() >= outerDeadline) throw Error('usefulness outer deadline'); };
  const receipt = { protocol: P, startedAt, deadline: outerDeadline, status: 'preflight', seats: [], warm: [],
    sourceReceipt: session.sourceReceipt, accounting: '120000 input+output is a post-turn validity gate, not a hard spending cap.',
    limits: 'Four descriptive trials do not establish navigation reliability. Tool restrictions are admission wrappers plus post-turn audit; the adapter sandbox permits networking.' };
  mkdirSync(out, { recursive: true });
  const save = () => writeFileSync(join(out, 'agent-usefulness.json'), JSON.stringify(redact(receipt), null, 2));
  const request = async (path, body) => { check(); const response = await session.request(path, body, null); check(); if (!response.ok) throw Error(`fixture HTTP ${response.status}`); return response; };
  const getJson = async (path, body) => (await request(path, body)).json();
  const snapshot = async () => physicalFingerprint(await getJson('/v1/world/snapshot'));
  const files = { 'eden.mjs': readFileSync(join(here, 'agent-usefulness-cli.mjs')), 'eden-served.mjs': readFileSync(cliFile), 'skill.md': readFileSync(skillFile) };
  if (!cliSha256 || sha(files['eden-served.mjs']) !== cliSha256 || !skillSha256 || sha(files['skill.md']) !== skillSha256) throw Error('served CLI/skill pin mismatch');
  receipt.bootstrapHashes = Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, sha(bytes)]));
  receipt.runnerHashes = Object.fromEntries(['agent-usefulness.mjs', 'agent-usefulness-owner.mjs', 'agent-usefulness-protocol.mjs', 'agent-usefulness-cli.mjs', 'agent-usefulness-process.mjs', 'agent-usefulness-runtime.mjs'].map(name => [name, sha(readFileSync(join(here, name)))]));
  const refs = Object.fromEntries(Object.entries(TARGETS).map(([name, id]) => {
    const found = session.bindings.find(binding => binding.id === id); if (!found?.ref) throw Error(`missing actual fixture binding ${id}`); return [name, found.ref];
  }));
  receipt.bindings = refs; save();
  try {
    for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_API_BASE', 'CODEX_API_BASE_URL'])
      if (process.env[key]) throw Error(`provider override present: ${key}; no value recorded`);
    receipt.codexRuntime = pinCodexRuntime();
    const policy = providerPolicy({ providers: { allowed: ['codex'] }, seats: [{ adapter: 'codex-headless' }], director: { mode: 'scripted' }, review: { mode: 'deterministic' } });
    const version = await run('codex', ['--version'], { maxWallMs: 3000 });
    const login = await run('codex', ['login', 'status'], { maxWallMs: 3000 });
    requireProviders(policy, { codex: version.code === 0 ? String(version.stdout).trim() : null });
    if (String(version.stdout).trim() !== receipt.codexRuntime.version) throw Error('pinned Codex version mismatch; no fallback');
    if (login.code !== 0 || !/Logged in using ChatGPT/.test(String(login.stdout) + String(login.stderr))) throw Error('Codex subscription login unavailable; no fallback');
    receipt.provider = { policy, version: String(version.stdout).trim(), login: 'ChatGPT subscription verified' };
    receipt.physicalBefore = await snapshot();
    const download = async (name, url) => {
      if (!url?.startsWith('/v1/world/context/')) throw Error('non-context image URL');
      // Originals are not renderer jobs; the shared helper's renderer-download
      // trace cross-check excludes them. This suite owns their byte/count ledger.
      const response = name === 'prewarm-original' ? await session.rawGet(url) : await request(url);
      check(); if (!response.ok) throw Error(`PNG HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer()); check();
      if (bytes.length > 8 * 1024 * 1024) throw Error('PNG download exceeds8MiB');
      const decoded = decodePng(bytes); if (!decoded?.width || !decoded?.height) throw Error('PNG failed shared decoder');
      writeFileSync(join(out, `${name}.png`), bytes);
      return { file: `${name}.png`, sha256: sha(bytes), bytes: bytes.length, width: decoded.width, height: decoded.height, decoded: true };
    };
    session.setPhase('usefulness:prewarm');
    for (const name of ['fountain', 'room', 'seat']) {
      const ref = refs[name], until = Math.min(outerDeadline, Date.now() + 15000); let view;
      do {
        view = (await getJson('/v1/world/context/views', { refs: [ref], detail: true })).views?.[0];
        if (view?.status !== 'pending') break;
        await delay(Math.min(200, Math.max(1, until - Date.now())), undefined, { signal });
      } while (Date.now() < until);
      if (view?.status !== 'ready' || !view.url || !view.key) throw Error(`prewarm ${name} unavailable`);
      receipt.warm.push({ name, ref, view, ...await download(`prewarm-${name}`, view.url) }); save();
    }
    const original = (await getJson('/v1/world/context?ref=' + encodeURIComponent(refs.original))).targets?.[0]?.original;
    if (!original?.version) throw Error('exact original version missing');
    const originalPng = await download('prewarm-original', original.url);
    if (originalPng.sha256 !== original.version) throw Error('original version differs from downloaded bytes');
    receipt.warm.push({ name: 'original', ref: refs.original, original, ...originalPng }); save();
    const readyKeys = async () => {
      for (const warm of receipt.warm.filter(value => value.view)) {
        const current = (await getJson('/v1/world/context/views', { refs: [warm.ref], detail: true })).views?.[0];
        if (current?.status !== 'ready' || current.key !== warm.view.key || current.url !== warm.view.url) throw Error('prewarmed architecture changed');
      }
      const current = (await getJson('/v1/world/context?ref=' + encodeURIComponent(refs.original))).targets?.[0]?.original;
      if (current?.version !== original.version || current?.url !== original.url) throw Error('original version changed');
    };
    const jobStarts = () => session.jobEvents().filter(event => event.phase === 'start');
    const prewarmJobs = jobStarts(); receipt.prewarmJobs = session.jobEvents();
    for (const [index, arm] of P.order.entries()) {
      check(); if (outerDeadline - Date.now() < (P.sessionWallSeconds + P.killReserveSeconds) * 1000) throw Error('full seat+cleanup reserve unavailable');
      await readyKeys(); if (await snapshot() !== receipt.physicalBefore) throw Error('fixture changed before seat');
      const cwd = mkdtempSync(join(tmpdir(), 'eden-usefulness-'));
      for (const [name, bytes] of Object.entries(files)) writeFileSync(join(cwd, name), bytes);
      // Hash membership permits only warmed requests without handing exact refs
      // or fixture answers to the seat's control file.
      const control = { arm, cliSha256, allowedImageRefHashes: receipt.warm.map(warm => sha(`${warm.ref}:${warm.name === 'original'}`)) }, publicState = { world: session.base };
      writeFileSync(join(cwd, '.usefulness-session.json'), JSON.stringify(control));
      writeFileSync(join(cwd, '.eden-agent.json'), JSON.stringify(publicState));
      const row = { index: index + 1, arm, cwd, startedAt: Date.now(), status: 'running' }; receipt.seats.push(row); save();
      session.setPhase(`usefulness:${index + 1}:${arm}`);
      const custody = watchAdapter({ signal, deadline: row.startedAt + 119000, codexBinary: receipt.codexRuntime.binary, registerProcess: session.registerProcess });
      let result; try { result = await turn({ cwd, model: P.model, effort: P.effort, text: promptFor(arm), maxWallSec: P.adapterWallSeconds }); }
      finally { row.cleanup = await custody.close(); }
      row.wallMs = Date.now() - row.startedAt; row.adapterWallMs = result.wallMs;
      row.usage = rawUsage(result.stream); row.answer = result.finalText; row.answerWords = countWords(row.answer);
      row.actualThreadStarts = result.stream.filter(event => event.type === 'thread.started').length;
      writeFileSync(join(out, `seat-${index + 1}-stream.json`), JSON.stringify(redact(result.stream), null, 2)); save(); check();
      row.commands = auditCommands(result.stream, arm);
      const ledgerPath = join(cwd, '.usefulness-calls.jsonl');
      row.ledger = readdirSync(cwd).includes('.usefulness-calls.jsonl') ? readFileSync(ledgerPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
      row.downloads = row.ledger.filter(call => call.file).map(call => {
        const file = join(cwd, call.file); if (!readdirSync(cwd).includes(call.file) || !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) return { ...call, decoded: false };
        const bytes = readFileSync(file), decoded = bytes.length <= 8 * 1024 * 1024 ? decodePng(bytes) : null;
        const expected = receipt.warm.find(warm => warm.ref === call.ref && (call.original ? warm.name === 'original' : warm.name !== 'original'));
        const copy = `seat-${index + 1}-${call.file}`; writeFileSync(join(out, copy), bytes);
        return { ...call, retained: copy, bytes: bytes.length, sha256: sha(bytes), decoded: Boolean(decoded?.width && decoded?.height), expectedSha256: expected?.sha256 ?? null };
      });
      row.images = auditImages({ inventory: row.commands, downloads: row.downloads, cwd, canonicalCwd: realpathSync(cwd), arm });
      row.answerEvidence = { mentionedRefs: Object.fromEntries(Object.entries(refs).map(([name, ref]) => [name, String(row.answer).includes(ref)])),
        exactOriginalVersionMentioned: String(row.answer).includes(original.version),
        humanGrading: 'pending-root: relationship, source distinction, two visual differences and original appearance; exact refs alone do not prove usefulness' };
      row.errors = [...row.commands.errors, ...row.images.errors];
      if (result.stream.filter(event => event.type === 'turn.completed').length !== 1 || result.stream.filter(event => event.type === 'thread.started').length !== 1)
        row.errors.push('expected exactly one fresh model turn/thread');
      for (const [name, bytes] of Object.entries(files)) if (sha(readFileSync(join(cwd, name))) !== sha(bytes)) row.errors.push('bootstrap file changed');
      if (jsonHash(JSON.parse(readFileSync(join(cwd, '.usefulness-session.json')))) !== jsonHash(control) || jsonHash(JSON.parse(readFileSync(join(cwd, '.eden-agent.json')))) !== jsonHash(publicState)) row.errors.push('public control changed');
      if (row.downloads.some(image => !image.decoded || image.sha256 !== image.expectedSha256)) row.errors.push('download did not match pinned qualified image');
      const allowed = new Set([...Object.keys(files), '.usefulness-session.json', '.eden-agent.json', '.usefulness-calls.jsonl', ...row.downloads.map(image => image.file)]);
      if (readdirSync(cwd).some(name => !allowed.has(name))) row.errors.push('unexpected seat write');
      if (row.ledger.length !== row.commands.cliCalls || row.ledger.length > P.cliCalls) row.errors.push('CLI ledger differs from observed calls');
      if (result.exit !== 0 || result.timedOut || row.wallMs > 120000 || !row.answer || row.answerWords > P.answerWords) row.errors.push('answer/turn/time limit failed');
      if (row.usage.totalAccountedTokens === null || row.usage.totalAccountedTokens > P.maxAccountedTokens) row.errors.push('post-turn token gate failed or missing');
      if (!row.cleanup.sawCodex || row.cleanup.remaining.length || row.cleanup.samplingError) row.errors.push('Codex process cleanup unproven');
      if (jsonHash(jobStarts()) !== jsonHash(prewarmJobs)) row.errors.push('unexpected capture work during seats');
      if (await snapshot() !== receipt.physicalBefore) row.errors.push('world changed during seat');
      row.status = row.errors.length ? 'invalid' : 'valid';
      save();
      if (row.errors.length) throw Error(`seat ${index + 1} invalid; no retry`);
    }
    receipt.physicalAfter = await snapshot(); receipt.contextJobs = session.jobEvents(); receipt.totalDownloadedImages = 4 + receipt.seats.reduce((sum, seat) => sum + seat.downloads.length, 0);
    if (receipt.totalDownloadedImages > P.totalImageDownloads) throw Error('download budget exceeded');
    receipt.status = 'protocol-valid-awaiting-root-grading';
  } catch (error) { receipt.status = 'failed'; receipt.error = String(error.message); }
  finally { receipt.contextJobs = session.jobEvents(); receipt.finishedAt = Date.now(); receipt.wallMs = receipt.finishedAt - startedAt; save(); }
  return receipt;
}
