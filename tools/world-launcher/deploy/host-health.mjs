#!/usr/bin/env node
// Host disk/memory check for eden2 (lane OPS2). Run every 10 min by sim-worlds-health@<stage>.timer as simworlds.
//   node host-health.mjs <dataDir> [--disk-path /] [--min-free-pct 15] [--min-free-gb 20] [--min-mem-mb 1536]
// Writes <dataDir>/host-health.json (always, atomically) and appends one line to <dataDir>/host-health.log whenever a
// threshold is breached (ALERT) or clears (RECOVERED). The launcher folds the JSON into /__sim/healthz: `hostOk` for
// everyone, the numbers for direct (loopback) requests. Alert when disk free < 15% OR < 20 GB, or MemAvailable < 1.5 GB.
// No dependencies, no network, no external notification channel. Exit 0 always (a failed check must not flap the unit).
import { appendFileSync, readFileSync, renameSync, statfsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function memAvailableMb(meminfo) {
  const m = /^MemAvailable:\s+(\d+)\s+kB/m.exec(meminfo);
  return m ? Math.round(Number(m[1]) / 1024) : null;
}

export function evaluate({ diskTotalBytes, diskFreeBytes, memMb }, t = {}) {
  const minPct = t.minFreePct ?? 15, minGb = t.minFreeGb ?? 20, minMem = t.minMemMb ?? 1536;
  const diskFreeGb = +(diskFreeBytes / 1e9).toFixed(1), diskFreePct = +(100 * diskFreeBytes / diskTotalBytes).toFixed(1);
  const problems = [];
  if (diskFreePct < minPct) problems.push(`disk free ${diskFreePct}% < ${minPct}%`);
  if (diskFreeGb < minGb) problems.push(`disk free ${diskFreeGb} GB < ${minGb} GB`);
  if (memMb == null) problems.push('MemAvailable unreadable');
  else if (memMb < minMem) problems.push(`MemAvailable ${memMb} MB < ${minMem} MB`);
  return { ok: problems.length === 0, diskFreeGb, diskFreePct, memAvailableMb: memMb, problems,
    thresholds: { minFreePct: minPct, minFreeGb: minGb, minMemMb: minMem } };
}

function main(argv) {
  const dataDir = argv[0];
  if (!dataDir) { console.error('usage: host-health.mjs <dataDir> [--disk-path /] [--min-free-pct N] [--min-free-gb N] [--min-mem-mb N]'); return; }
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i > 0 ? argv[i + 1] : d; };
  const diskPath = opt('disk-path', '/');
  const out = join(dataDir, 'host-health.json'), log = join(dataDir, 'host-health.log');
  let prev = null; try { prev = JSON.parse(readFileSync(out, 'utf8')); } catch {}
  let status;
  try {
    const s = statfsSync(diskPath);
    status = evaluate({ diskTotalBytes: s.blocks * s.bsize, diskFreeBytes: s.bavail * s.bsize, memMb: memAvailableMb(readFileSync('/proc/meminfo', 'utf8')) },
      { minFreePct: Number(opt('min-free-pct', 15)), minFreeGb: Number(opt('min-free-gb', 20)), minMemMb: Number(opt('min-mem-mb', 1536)) });
  } catch (e) { status = { ok: false, problems: [`check failed: ${e.message}`] }; }
  status = { ...status, at: new Date().toISOString(), diskPath };
  const tmp = `${out}.tmp`; writeFileSync(tmp, JSON.stringify(status) + '\n'); renameSync(tmp, out);
  if (!status.ok) appendFileSync(log, `${status.at} ALERT ${status.problems.join('; ')}\n`);
  else if (prev && prev.ok === false) appendFileSync(log, `${status.at} RECOVERED disk ${status.diskFreeGb} GB (${status.diskFreePct}%) mem ${status.memAvailableMb} MB\n`);
  console.log(JSON.stringify(status));
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
