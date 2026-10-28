#!/usr/bin/env node
// Read retained local evidence only. This tool never launches or qualifies a run.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const strip = text => text.replace(/\u001b\[[0-9;]*m/g, '');
const count = value => Array.isArray(value) ? value.length : null;
const zoned = value => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const infrastructure = /preempted|preemption|out.of.memory|ENOSPC|ENOMEM|EADDRINUSE|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|container failed|RemoteError|timed out|killed by signal/i;
const failure = /^\s*not ok \d+\s*-\s*(.+)|\b(?:AssertionError|ERR_ASSERTION|error TS\d+)\b|\bError:\s|\bBail out!/;

function filesBelow(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesBelow(path) : entry.isFile() ? [path] : [];
  });
}

/** Diagnostic observations are not the release harness's qualification decisions. */
export function generateReport({ run, evidence = [], costLedger, releaseEvidence, now = new Date().toISOString() }) {
  const root = resolve(run), artifacts = [], issues = [], observations = [], containers = new Map();
  const consumed = new Map();
  function read(path, kind, optional = false) {
    path = resolve(path);
    if (consumed.has(path)) return consumed.get(path);
    if (!existsSync(path)) { if (!optional) issues.push(`Missing ${kind}: ${path}`); return null; }
    // Do not follow symlinks, including ancestor directories, into unrelated data.
    for (let p = path; p !== dirname(p); p = dirname(p)) if (lstatSync(p).isSymbolicLink()) throw Error(`Refusing symlink evidence: ${p}`);
    const bytes = readFileSync(path), raw = bytes.toString('utf8');
    artifacts.push({ path, kind, bytes: bytes.length, sha256: digest(bytes) }); consumed.set(path, raw);
    return raw;
  }
  function json(path, kind, optional = false) {
    const raw = read(path, kind, optional); if (raw === null) return null;
    try { return JSON.parse(raw); } catch { issues.push(`Invalid JSON ${kind}: ${path}`); return null; }
  }
  function observe(text, stage, path, line, context = {}) {
    if (typeof text !== 'string') return;
    text = strip(text).trim();
    if (/^(?:ok \d+\b|# Subtest:|== )/.test(text)) return;
    if (!failure.test(text) && !infrastructure.test(text) && !/Stopping app|user stopped|SHARDS-MISSING|MERGE PROBLEM/i.test(text)) return;
    const definiteFailure = /^not ok \d+/.test(text) || /\berror TS\d+\b/.test(text) || (stage && /^[1-9]\d*$/.test(String(stages.get(stage)?.exit)));
    const kind = infrastructure.test(text) ? 'infrastructure' : /Stopping app|user stopped/i.test(text) ? 'operator-stop' : failure.test(text) ? definiteFailure ? 'test-or-build-failure' : 'log-message' : 'incomplete-artifact';
    if (!observations.some(o => o.stage === stage && o.text === text && o.kind === kind)) observations.push({ stage: stage || 'unknown', kind, text, path, line, ...context });
  }
  const receipt = json(join(root, 'receipt.json'), 'gate-receipt', true);
  const candidateDir = existsSync(join(root, 'candidate')) ? join(root, 'candidate') : root;
  const meta = json(join(candidateDir, 'out/RUN-METADATA.json'), 'run-metadata', true) || receipt?.runs?.candidate?.metadata || null;
  const identity = {
    sourceSha: meta?.sourceSha || receipt?.refs?.candidate?.sha || null,
    sourceArchiveSha256: meta?.sourceArchiveSha256 || null,
    harnessRef: meta?.harnessRef || receipt?.harness?.ref || null,
    harnessTree: meta?.harnessTree || receipt?.harness?.tree || null,
    suiteTree: receipt?.harness?.suiteTree || receipt?.runs?.candidate?.suiteTree || null,
    harnessArchiveSha256: meta?.harnessArchiveSha256 || receipt?.harness?.archiveSha256 || null,
    nodeRequested: meta?.node || receipt?.node || null,
    nodeVersion: meta?.nodeVersion || null, pnpmVersion: meta?.pnpmVersion || null,
    baselineSha: receipt?.refs?.baseline?.sha || null, baselineSource: receipt?.baseline?.source || null,
  };
  const identityMismatches = [];
  for (const [label, a, b] of [
    ['sourceSha', meta?.sourceSha, receipt?.refs?.candidate?.sha],
    ['harnessRef', meta?.harnessRef, receipt?.harness?.ref],
    ['harnessTree', meta?.harnessTree, receipt?.harness?.tree],
    ['harnessArchiveSha256', meta?.harnessArchiveSha256, receipt?.harness?.archiveSha256],
  ]) if (a && b && a !== b) identityMismatches.push(`${label}: metadata ${a} != receipt ${b}`);
  const stages = new Map();
  const suiteDir = join(candidateDir, 'out/suite');
  const summary = read(join(suiteDir, 'SUMMARY.tsv'), 'suite-summary', true);
  if (summary) {
    const rows = summary.trim().split(/\r?\n/); if (rows.shift() !== 'step\texit\tseconds\tlog') issues.push('Invalid SUMMARY.tsv header');
    for (const row of rows) {
      const [stage, exit, seconds, log, ...extra] = row.split('\t');
      if (!stage || exit === undefined || extra.length || stages.has(stage)) { issues.push(`Malformed/duplicate summary row: ${row}`); continue; }
      stages.set(stage, { stage, exit, elapsedStepSeconds: /^\d+(?:\.\d+)?$/.test(seconds) ? Number(seconds) : null,
        log: log && log !== '-' ? join(suiteDir, basename(log)) : null });
    }
  }
  for (const [stage, item] of Object.entries(receipt?.runs?.candidate?.steps || {})) if (!stages.has(stage)) stages.set(stage, { stage, exit: item.exit, elapsedStepSeconds: null, log: null });
  // Only read local retained files under the supplied run. Never follow receipt paths.
  const localLogs = filesBelow(join(candidateDir, 'out')).filter(p => /(?:\.log|RUN-METADATA\.json|SUMMARY\.tsv)$/.test(p));
  for (const path of [join(candidateDir, 'modal.log'), join(candidateDir, 'gate-driver.log'), ...localLogs]) {
    const raw = read(path, 'retained-log', true); if (raw === null) continue;
    if (basename(path) === 'RUN-METADATA.json' && path !== join(candidateDir, 'out/RUN-METADATA.json')) {
      const groupMeta = json(path, 'group-metadata');
      for (const field of ['sourceSha', 'harnessRef', 'harnessTree', 'harnessArchiveSha256', 'sourceArchiveSha256', 'nodeVersion', 'pnpmVersion']) {
        if (meta?.[field] && groupMeta?.[field] && meta[field] !== groupMeta[field]) identityMismatches.push(`Group metadata mismatch ${field}: ${path}`);
      }
    }
    const stage = /^V\d[^/]*\.log$/.test(basename(path)) ? basename(path, '.log') : null;
    strip(raw).split(/\r?\n/).forEach((line, i) => observe(line, stage, path, i + 1));
  }
  const appIds = new Set();
  for (const raw of consumed.values()) for (const match of raw.matchAll(/\bap-[A-Za-z0-9]+\b/g)) appIds.add(match[0]);
  for (const input of evidence) {
    const path = resolve(input), raw = read(path, 'supplemental-evidence'); if (raw === null) continue;
    if (!path.endsWith('.jsonl')) { strip(raw).split(/\r?\n/).forEach((line, i) => observe(line, null, path, i + 1)); continue; }
    raw.trim().split(/\r?\n/).forEach((line, index) => {
      let event; try { event = JSON.parse(line); } catch { issues.push(`Invalid JSONL at ${path}:${index + 1}`); return; }
      if (event.source && identity.sourceSha && event.source !== identity.sourceSha) { identityMismatches.push(`Supplemental source mismatch at ${path}:${index + 1}`); return; }
      if (event.app && appIds.size && !appIds.has(event.app)) { identityMismatches.push(`Supplemental app mismatch at ${path}:${index + 1}`); return; }
      if (event.app) appIds.add(event.app);
      for (const item of event.inventory || []) {
        const id = item.container_id; if (!id) continue;
        const prior = containers.get(id) || { id, app: item.app_id || event.app || null, startedAt: item.start_time || null };
        prior.lastObservedAt = event.at || prior.lastObservedAt; containers.set(id, prior);
      }
      for (const item of event.reads || []) {
        const context = { container: item.container || null, observedAt: event.at || null };
        for (const log of item.data?.logs || []) {
          const stage = basename(log.file || 'unknown', '.log');
          for (const item of log.failures || []) {
            if (typeof item === 'string') observe(item, stage, path, index + 1, context);
            else if (item && typeof item.title === 'string') {
              const lines = Array.isArray(item.context) ? item.context.filter(v => typeof v === 'string') : [];
              const text = lines.find(v => /^\s*not ok \d+/.test(v)) || `not ok 0 - ${item.title}`;
              observe(text, stage, path, index + 1, { ...context, retainedLogLine: item.line ?? null, detail: lines });
            }
          }
          for (const text of log.last || []) observe(text, stage, path, index + 1, context);
        }
      }
      if (event.event === 'stopping_owned_app') observations.push({ stage: 'run', kind: 'operator-stop', text: event.reason || event.event, path, line: index + 1, observedAt: event.at });
    });
  }
  const required = receipt?.scope?.steps || [];
  const missingStages = required.filter(stage => !stages.has(stage));
  const blockers = [...(receipt?.blockers || []), ...(receipt?.runs?.candidate?.errors || []), ...(meta?.fanout?.problems || [])];
  const incompleteStages = [...stages.values()].filter(s => !/^\d+$/.test(String(s.exit)) && s.exit !== 'SKIP').map(s => s.stage);
  const missingLogs = [...stages.values()].filter(s => s.log && !existsSync(s.log)).map(s => s.log);
  const complete = Boolean(receipt && meta?.suiteCompleted === true && summary && required.length && !missingStages.length && !incompleteStages.length && !missingLogs.length);
  const assertionFailures = observations.filter(o => o.kind === 'test-or-build-failure');
  // Repeated snapshots/log copies are observations, not additional failing assertions.
  const assertionKeys = new Set(assertionFailures.filter(o => /not ok \d+\s*-/.test(o.text)).map(o => `${o.stage}\0${o.text.replace(/^.*?not ok \d+\s*-\s*/, '')}`));
  const infra = observations.some(o => o.kind === 'infrastructure') || (meta?.fanout?.problems || []).some(v => infrastructure.test(v));
  const stopped = observations.some(o => o.kind === 'operator-stop');
  const knownFailed = assertionFailures.length > 0 || [...stages.values()].some(s => /^\d+$/.test(String(s.exit)) && Number(s.exit) !== 0) || (receipt?.newFailures?.length || 0) > 0;
  const receiptPassed = ['pass', 'quarantined'].includes(receipt?.status);
  const quarantinedTitles = (receipt?.quarantined || []).map(q => q.id || '');
  const unaccountedAssertions = assertionFailures.filter(o => /not ok \d+/.test(o.text) && !quarantinedTitles.some(title => title && o.text.endsWith(title)));
  const cpuReceiptClean = complete && receiptPassed && !blockers.length && !identityMismatches.length && !issues.length && !unaccountedAssertions.length && receipt?.newFailures?.length === 0 && receipt?.unexpectedSkips?.length === 0;
  const firstUsefulError = assertionFailures.find(o => /^not ok \d+/.test(o.text)) || assertionFailures[0] || observations.find(o => o.kind === 'infrastructure') || observations.find(o => o.kind !== 'log-message') || (blockers[0] ? { stage: 'receipt', text: blockers[0] } : null);
  const groups = Object.entries(meta?.fanout?.groups || {}).map(([group, value]) => ({ group, suiteExit: value.suiteExit ?? null, shard: value.shard || null, requestedCpu: null, requestedMemoryGiB: null, elapsedContainerSeconds: null }));
  let cost = { estimateUsd: null, actualInvoiceUsd: null, method: 'No cost evidence supplied; no estimate invented.' };
  if (costLedger) {
    const ledger = json(costLedger, 'cost-ledger');
    const matches = (ledger?.runs || []).filter(r => appIds.size ? appIds.has(r.app) : r.name === basename(root));
    if (matches.length === 1) {
      const entry = matches[0]; cost = { app: entry.app, estimateUsd: finite(entry.estimateUsd) ? entry.estimateUsd : null,
        actualInvoiceUsd: finite(entry.actualInvoiceUsd) ? entry.actualInvoiceUsd : null,
        method: ledger.method || 'Supplied estimate; metering method unknown.', requestedResources: ledger.requestedPerGate || null,
        wallSeconds: entry.wallSeconds ?? null, start: entry.start || null, end: entry.end || null, asOf: entry.asOf || ledger.asOf || null,
        rates: ledger.rates || null, unknowns: ledger.unknowns || [], label: 'Requested-resource estimate, not invoice; may overcount finished containers and omit other charges.' };
    } else issues.push(`Cost ledger matches ${matches.length} runs; refusing ambiguous cost attribution`);
  }
  for (const container of containers.values()) {
    const elapsed = (Date.parse(container.lastObservedAt) - Date.parse(container.startedAt)) / 1000;
    container.observedElapsedSecondsLowerBound = finite(elapsed) ? elapsed : null;
    container.elapsedContainerSeconds = null; container.requestedCpu = null; container.requestedMemoryGiB = null;
  }
  const release = { implemented: { status: 'not-established' }, locallyVerified: { status: 'not-established' },
    releaseQualified: { status: 'not-established', reason: 'CPU receipt alone excludes separate release checks; this reporter does not qualify releases.' },
    liveVerified: { status: 'not-established' }, build: null, deployedAt: null };
  if (releaseEvidence) {
    const input = json(releaseEvidence, 'release-evidence');
    if (!input?.sourceSha || input.sourceSha !== identity.sourceSha) issues.push('Release evidence sourceSha missing or differs from run');
    else {
      release.build = typeof input.build === 'string' ? input.build : null;
      if (input.deployedAt !== undefined && !zoned(input.deployedAt)) issues.push('Deployment timestamp missing explicit timezone or invalid');
      else release.deployedAt = input.deployedAt || null;
      // Claims remain visibly claims. Retained paths/hashes let the release owner review them.
      for (const key of ['implemented', 'locallyVerified', 'releaseQualified', 'liveVerified']) {
        const paths = input[key]; if (!Array.isArray(paths) || !paths.length) continue;
        const retained = paths.map(p => {
          const path = isAbsolute(p) ? p : resolve(dirname(resolve(releaseEvidence)), p);
          read(path, `${key}-evidence`); return artifacts.find(a => a.path === resolve(path));
        }).filter(Boolean);
        release[key] = { status: retained.length === paths.length ? 'reported-with-retained-evidence' : 'evidence-missing', artifacts: retained.map(a => a.path),
          reason: 'Supplied release-owner claim; content/acceptance validity is not certified by this reporter.' };
      }
    }
  }
  const perStage = [...stages.values()].map(s => ({ ...s, firstUsefulError: observations.find(o => o.stage === s.stage && o.kind === 'test-or-build-failure' && /^not ok \d+/.test(o.text)) || observations.find(o => o.stage === s.stage && o.kind === 'test-or-build-failure') || observations.find(o => o.stage === s.stage && o.kind !== 'log-message') || null }));
  return { schemaVersion: 1, kind: 'release-diagnostic-report', generatedAt: now, run: root,
    outcome: { status: knownFailed ? (complete ? 'failure-observed' : 'failure-observed-incomplete') : cpuReceiptClean ? 'receipt-reports-clean-cpu-scope' : 'incomplete-or-blocked',
      complete, receiptStatus: receipt?.status || null, cpuReceiptClean,
      comparisonNewFailures: count(receipt?.newFailures), observedDistinctFailingAssertions: assertionKeys.size,
      failureCategory: [knownFailed ? 'test-or-build-failure (product cause requires diagnosis)' : null, infra ? 'infrastructure-interruption-observed' : null, stopped ? 'operator-stop-observed' : null].filter(Boolean),
      firstUsefulError, missingStages, incompleteStages, missingLogs, blockers: [...new Set(blockers)] },
    identity, identityMismatches: [...new Set(identityMismatches)], stages: perStage, observations,
    elapsed: { start: receipt?.startedAt || null, end: receipt?.endedAt || null,
      driverWallSeconds: zoned(receipt?.startedAt) && zoned(receipt?.endedAt) ? (Date.parse(receipt.endedAt) - Date.parse(receipt.startedAt)) / 1000 : null,
      containerElapsedNote: 'Step elapsed excludes install/preparation. Snapshot durations are lower bounds, not billed lifetimes. Missing container lifetimes/resources remain unknown.' },
    groups, containers: [...containers.values()], cost, release, issues,
    retainedEvidence: artifacts,
    nextAction: 'Review the retained errors and artifacts before deciding whether another run is necessary. No rerun is launched or recommended automatically.' };
}

export function formatMarkdown(report) {
  const r = report, show = v => v === null || v === undefined ? 'unknown' : String(v), escape = v => show(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  return [`# Release run diagnostic`, '', `**${r.outcome.status}**; complete=${r.outcome.complete}; receipt=${show(r.outcome.receiptStatus)}; comparison newFailures=${show(r.outcome.comparisonNewFailures)}; observed distinct failing assertions=${r.outcome.observedDistinctFailingAssertions}.`,
    '', `First useful error: ${r.outcome.firstUsefulError ? `${r.outcome.firstUsefulError.stage}: ${r.outcome.firstUsefulError.text} (${r.outcome.firstUsefulError.path || 'receipt'}${r.outcome.firstUsefulError.line ? ':' + r.outcome.firstUsefulError.line : ''})` : 'none retained'}`,
    '', `Category: ${r.outcome.failureCategory.join('; ') || 'undetermined'}.`,
    '', `Source: ${show(r.identity.sourceSha)}. Harness ref: ${show(r.identity.harnessRef)}; tree: ${show(r.identity.harnessTree)}; suite tree: ${show(r.identity.suiteTree)}. Runtime: Node ${show(r.identity.nodeVersion)}, pnpm ${show(r.identity.pnpmVersion)}.`,
    '', `Driver elapsed: ${show(r.elapsed.driverWallSeconds)} s. Exact container elapsed/resources: ${r.containers.length} observed containers; ${r.elapsed.containerElapsedNote}`,
    '', `Estimated requested compute: ${r.cost.estimateUsd === null ? 'unknown' : '$' + r.cost.estimateUsd.toFixed(4)}. Actual invoice: ${r.cost.actualInvoiceUsd === null ? 'unknown' : '$' + r.cost.actualInvoiceUsd}. ${r.cost.label || r.cost.method}`,
    ...(r.cost.requestedResources ? ['', `Ledger request plan: ${show(r.cost.requestedResources.totalCpu)} CPU, ${show(r.cost.requestedResources.totalMemoryGiB)} GiB across the planned containers; allocation to observed container IDs is unknown. Estimate method: ${r.cost.method}`] : []),
    '', `Build: ${show(r.release.build)}. Deployed at (as evidenced, timezone retained): ${show(r.release.deployedAt)}.`,
    ...['implemented', 'locallyVerified', 'releaseQualified', 'liveVerified'].map(k => `- ${k}: ${r.release[k].status}`), '',
    '| Stage | Exit | Step seconds | First retained error |', '| --- | --- | --- | --- |',
    ...r.stages.map(s => `| ${escape(s.stage)} | ${escape(s.exit)} | ${show(s.elapsedStepSeconds)} | ${escape(s.firstUsefulError?.text || '')} |`), '',
    `Missing stages: ${r.outcome.missingStages.join(', ') || 'none listed'}. Incomplete stage statuses: ${r.outcome.incompleteStages.join(', ') || 'none listed'}.`,
    ...[...r.outcome.blockers, ...r.identityMismatches, ...r.issues].map(v => `- ${v}`), '',
    'Retained evidence (full hashes, resources, provenance and observations are in report.json):', '',
    ...r.retainedEvidence.map(a => `- ${a.path} (${a.kind}; SHA-256 ${a.sha256})`), '', r.nextAction, ''].join('\n');
}

export function main(args = process.argv.slice(2)) {
  const options = { evidence: [] }; let out;
  for (let i = 0; i < args.length; i++) {
    const key = args[i]; if (!['--run', '--evidence', '--cost-ledger', '--release-evidence', '--out'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('Usage: report.mjs --run <retained-run-dir> [--evidence <copied-log-or-jsonl>]... [--cost-ledger <json>] [--release-evidence <json>] [--out <new-directory>]');
    const value = args[++i];
    if (key === '--evidence') options.evidence.push(value); else if (key === '--out') out = resolve(value); else options[{ '--run': 'run', '--cost-ledger': 'costLedger', '--release-evidence': 'releaseEvidence' }[key]] = value;
  }
  if (!options.run) throw Error('--run is required');
  if (out && existsSync(out)) throw Error('--out must be a new directory; retained evidence is never overwritten');
  // Output must be separate from retained inputs, including explicitly supplied evidence.
  const inputPaths = [options.run, ...options.evidence, options.costLedger, options.releaseEvidence].filter(Boolean).map(p => resolve(p));
  if (out && inputPaths.some(p => { const rel = relative(p, out); return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)); })) throw Error('--out must be outside retained input paths');
  const report = generateReport(options);
  if (out) { mkdirSync(out, { recursive: true }); writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n'); writeFileSync(join(out, 'report.md'), formatMarkdown(report)); }
  else process.stdout.write(formatMarkdown(report));
  return 0; // Diagnostic generation success; never a release qualification exit code.
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); } catch (e) { console.error(e.message); process.exitCode = 2; }
}
