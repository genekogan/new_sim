// REPORT.md from a bench run (METRICS.md v1). Also: node tools/bench/capacity/report.mjs <out dir> (rebuilds from result files).
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const range = (xs, d = 0) => { const v = xs.filter((x) => x != null && Number.isFinite(x)); if (!v.length) return '—'; const a = Math.min(...v), b = Math.max(...v); const f = (x) => x.toFixed(d); return a === b ? f(a) : `${f(a)}–${f(b)}`; };
const worst = (xs, hi) => { const v = xs.filter((x) => x != null && Number.isFinite(x)); return v.length ? (hi ? Math.max(...v) : Math.min(...v)) : null; };
function slope(points) {   // least squares y = a + b·x
  const p = points.filter(([, y]) => y != null && Number.isFinite(y)); if (p.length < 2) return null;
  const n = p.length, sx = p.reduce((s, [x]) => s + x, 0), sy = p.reduce((s, [, y]) => s + y, 0), sxx = p.reduce((s, [x]) => s + x * x, 0), sxy = p.reduce((s, [x, y]) => s + x * y, 0);
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx); return { perSoul: b, intercept: (sy - b * sx) / n };
}
const BARS = {
  n1: { tick: 0.95, healthz: 200, p99: 1000 }, n6: { tick: 0.8, healthz: 1000, p99: 3000, heap: 60 }, n12: { tick: 0.5, healthz: 1000, p99: 5000, heap: 70 },
};

// METRICS.md v2 (Stage B): worker off vs on side by side, the Stage B target, the recorded eden2 "before" (main, v1 load)
const SB_TARGET = { tick: 0.9, readP99Ms: 300 };
const BEFORE_EDEN2 = {   // README "Recorded baseline", eden2 slice, main da5269cd0, METRICS v1 load (CLI spawn-to-exit read p99): not the same load
  n6: { tick: '0.05–0.06', read: '43.8 s', healthz: '5000' }, n12: { tick: '0.04–0.08', read: '57.5 s', healthz: '5000' }, n24: { tick: '0.07–0.11', read: '59.8 s', healthz: '5000' },
  incident: { tick: '0.07–0.12', read: '59.5 s', healthz: '5000' }, hostile: { tick: '0.02', read: '—', healthz: '5000' },
};
function stageB(L, receipt, by) {
  const h = receipt.host, sbh = (rs, k) => rs.map((r) => r.stageb?.headline?.[k]), H = (rs, k) => rs.map((r) => r.headline[k]);
  L.push('## Stage B — read worker off vs on (METRICS v2; worse active window per run; range over repeats)', '');
  L.push(`Load: ${h.stageb?.cliSouls ?? '?'} CLI Souls + the rest raw-HTTP Souls (the CLI's requests and retry etiquette), a read every 3–5 s, an act every 15–30 s, one listener each, ${h.stageb?.viewers ?? '?'} viewer sockets; world budget ${h.stageb?.worldBudgetRps ?? 'launcher default'} C1/C2 rps; read workers ${h.readWorker ? `${h.readWorker.workers} (mode ${h.readWorker.mode})` : 'n/a'}; CPUs ${h.cpus ?? 'whole host'}. Read/act p99 = the raw Souls' request wall time incl. designed waits; CLI p99 = spawn to exit.`, '');
  L.push('| arm | N | worker | tick service | healthz p99 ms | read p99 ms | p99 here / observe / caps / resolve / around ms | act p99 ms | CLI read p99 ms | reads/s | refused | worker-served (here on worker) | fallbacks | CPU-s/s process / main / workers | RSS peak MB | heap peak MB | timeouts | oracle equal/compared |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  const bases = [...new Set(receipt.arms.map((a) => a.split('@')[0]))];
  for (const base of bases) for (const key of receipt.arms.filter((a) => a.split('@')[0] === base)) {
    const rs = by[key] ?? []; if (!rs.length) { L.push(`| ${base} | | ${key.split('@')[1] ?? ''} | failed |`); continue; }
    const kinds = ['here', 'observe', 'caps', 'resolve', 'around'].map((k) => range(rs.map((r) => r.stageb?.headline?.readP99ByKind?.[k]))).join(' / ');
    const orc = rs.map((r) => r.stageb?.headline?.oracle).filter(Boolean), oc = orc.length ? `${orc.reduce((s, o) => s + o.equal, 0)}/${orc.reduce((s, o) => s + o.compared, 0)}` : '—';
    const share = range(sbh(rs, 'workerServedShare'), 2), hw = range(sbh(rs, 'hereOnWorkerShare'), 2);
    L.push(`| ${base} | ${rs[0].N} | ${key.split('@')[1] ?? '—'} | ${range(H(rs, 'tickService'), 3)} | ${range(H(rs, 'healthzP99Ms'))} | ${range(sbh(rs, 'rawReadP99Ms'))} | ${kinds} | ${range(sbh(rs, 'rawActP99Ms'))} | ${range(sbh(rs, 'cliReadP99Ms'))} | ${range(sbh(rs, 'readsPerS'), 1)} | ${range(sbh(rs, 'rawReadRefusedShare'), 2)} | ${share} (${hw}) | ${range(sbh(rs, 'fallbacks'))} | ${range(sbh(rs, 'processCpuSPerS'), 2)} / ${range(sbh(rs, 'mainCpuSPerS'), 2)} / ${range(sbh(rs, 'workerCpuSPerS'), 2)} | ${range(H(rs, 'rssPeakMb'))} | ${range(H(rs, 'heapPeakMb'))} | ${range(sbh(rs, 'timeouts'))} | ${oc} |`);
  }
  L.push('', 'worker-served = of the requests the launcher routed to a worker, the share it answered itself (the rest it forwarded to main over its intents port); here on worker = raw `here` answers the worker computed (x-sim-read-cpu-ms). Oracle = B-facade\'s HTTP cross-thread compare of `here` (main\'s port, then a worker\'s, same Soul, equal tick) on the sampled share of reads.', '');
  // r3 (2026-10-31): the world's level through the windows and the answered-only latency, apart from the designed waits
  L.push('### What the Souls were answered (r3: answered = 2xx, Retry-After waits taken out; levels = /healthz `load.level` samples in the active windows)', '');
  L.push('| arm | worker | green gate | active levels (worse window) | answered read p99 ms | answered act p99 ms | read wall p99 ms (incl. waits) | refused | reads that waited | refusals by who:code | world tick p99 max ms | service5s min | queue oldest max ms |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const key of receipt.arms) {
    const rs = by[key] ?? []; if (!rs.length) continue;
    const gate = rs.map((r) => r.stageb?.gate ? (r.stageb.gate.ok ? `${r.stageb.gate.waitedS} s` : `NOT (${r.stageb.gate.waitedS} s)`) : 'off').join(' · ');
    const lv = rs.map((r) => { const a = r.windows?.activeA?.levels, b = r.windows?.activeB?.levels, red = (x) => (x?.red ?? 0) + (x?.black ?? 0), w = red(a) >= red(b) ? a : b; return w ? Object.entries(w).map(([k, v]) => `${k} ${v}`).join(' ') : '—'; }).join(' · ');
    const W = (k) => rs.map((r) => Math.max(...['activeA', 'activeB'].map((n) => r.windows?.[n]?.[k] ?? -Infinity))).map((x) => (x === -Infinity ? null : x));
    const Wmin = (k) => rs.map((r) => Math.min(...['activeA', 'activeB'].map((n) => r.windows?.[n]?.[k] ?? Infinity))).map((x) => (x === Infinity ? null : x));
    const tags = {}; for (const r of rs) for (const n of ['activeA', 'activeB']) for (const [t, c] of Object.entries(r.stageb?.windows?.[n]?.refusalsByTag ?? {})) tags[t] = (tags[t] ?? 0) + c;
    L.push(`| ${key} | ${key.split('@')[1] ?? '—'} | ${gate} | ${lv} | ${range(sbh(rs, 'rawReadOkP99Ms'))} | ${range(sbh(rs, 'rawActOkP99Ms'))} | ${range(sbh(rs, 'rawReadP99Ms'))} | ${range(sbh(rs, 'rawReadRefusedShare'), 2)} | ${range(sbh(rs, 'rawReadWaitedShare'), 2)} | ${Object.entries(tags).map(([t, c]) => `${t} ${c}`).join(', ') || '—'} | ${range(W('tickP99MaxMs'))} | ${range(Wmin('service5sMin'), 2)} | ${range(W('queueOldestMaxMs'))} |`);
  }
  L.push('');
  const pins = Object.values(by).flat().map((r) => r.stageb?.pins).filter((p) => p?.length);
  if (pins.length) L.push(`CPU pinning (taskset -a): ${[...new Set(pins.flat().map((p) => `${p.ok ? 'ok' : 'FAILED'} ${p.allowed ?? ''}`))].join(', ')}; ${pins.filter((p) => p.length > 1).length} runs re-pinned after a world restart.`, '');
  const ex = Object.values(by).flat().flatMap((r) => r.stageb?.headline?.oracle?.examples ?? []).slice(0, 3);
  if (ex.length) L.push('Oracle differences (first fields): ' + ex.map((d) => d.map((x) => `\`${x.path}\` main ${x.live} / worker ${x.replica}`).join('; ')).join(' · '), '');
  L.push(`### Stage B target (tranche: N = 100 tick service ≥ ${SB_TARGET.tick}, reads ≤ ${SB_TARGET.readP99Ms} ms p99)${h.indicative ? ' — INDICATIVE host: shown, not judged' : ''}`, '');
  L.push('| arm | worker | tick service | read p99 ms | timeouts | verdict | eden2 before (main da5269cd0, v1 load): tick · read p99 · healthz p99 |', '|---|---|---|---|---|---|---|');
  for (const key of receipt.arms) {
    const rs = by[key] ?? [], base = key.split('@')[0], b = BEFORE_EDEN2[base];
    const t = worst(H(rs, 'tickService'), false), p = worst(sbh(rs, 'rawReadP99Ms'), true), to = worst(sbh(rs, 'timeouts'), true);
    const pass = rs.length && t >= SB_TARGET.tick && p != null && p <= SB_TARGET.readP99Ms && !to && !rs.some((r) => r.headline.wedge);
    L.push(`| ${base} | ${key.split('@')[1] ?? '—'} | ${t ?? '—'} | ${p ?? '—'} | ${to ?? '—'} | ${!rs.length ? 'no run' : h.indicative ? (pass ? 'meets (indicative)' : 'misses (indicative)') : base === 'n100' ? (pass ? '**PASS**' : '**FAIL**') : pass ? 'meets' : 'misses'} | ${b ? `${b.tick} · ${b.read} · ${b.healthz}` : '—'} |`);
  }
  L.push('');
}

export function report(receipt, results) {
  const h = receipt.host, ok = results.filter((r) => !r.failed), by = {};
  for (const r of ok) (by[r.key ?? r.arm] ??= []).push(r);
  const L = [];
  L.push(`# Capacity bench report — ${h.label}${h.indicative ? ' (INDICATIVE: not an eden2 slice; numbers never pass or fail a bar)' : ''}`, '');
  L.push(`Metrics: \`${receipt.metrics}\`. Generated ${receipt.at}. Two repeats per arm are shown as ranges (min–max).`, '');
  L.push('| receipt | value |', '|---|---|');
  for (const [k, v] of Object.entries({ source: `${h.sourceSha}${h.sourceDirty ? ' (dirty)' : ''}`, bench: h.benchSha, fixture: `${h.fixture} sha256 ${h.fixtureSha256}`, 'Soul CLI': `${h.cliVersion} sha256 ${h.cliSha256}`, world: `${h.worldKey} / ${h.worldId} (${h.engine})`,
    host: `${h.hostname} · ${h.cpu} · ${h.cores} cores · ${h.kernel} · node ${h.node}`, slice: h.slice ?? 'none (whole host)', heap: `${h.heapMb} MB cap`, phases: JSON.stringify(h.phases), 'CLI startup': `${h.cliStartupMedianMs} ms median (inside every act/read time)` })) L.push(`| ${k} | ${String(v).replace(/\|/g, '/')} |`);
  if (h.viaLauncher) L.push(`| path | through the root's own launcher on :${h.viaLauncher.port} (children ${h.viaLauncher.childRange}, public origin ${h.viaLauncher.publicOrigin}: behind-proxy rules; hostile Souls one X-Forwarded-For each); heap from live.json when the world writes one, else — |`);
  L.push('');
  const failed = results.filter((r) => r.failed); if (failed.length) { L.push('**Failed runs:** ' + failed.map((r) => `${r.key ?? r.arm} r${r.rep}: ${r.failed}`).join('; '), ''); }

  L.push('## Arms (worse of the two active windows per run; range over repeats)', '');
  L.push('| arm | N | tick service | healthz p99 ms | act p99 ms | read p99 ms | heap peak MB (% cap) | RSS peak MB | wedge (longest gap s) | timeouts | C1 ok/refused/err | C2 ok/refused/err | listeners per Soul |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const arm of receipt.arms) {
    const rs = by[arm] ?? []; if (!rs.length) { L.push(`| ${arm} | — | failed |`); continue; }
    const H = (k) => rs.map((r) => r.headline[k]);
    const oc = (cls) => { let o = 0, f = 0, e = 0; for (const r of rs) for (const w of ['activeA', 'activeB']) { const x = r.windows[w].outcomes[cls] ?? {}; o += x.ok ?? 0; f += x.refused ?? 0; e += (x.error ?? 0) + (x.unreachable ?? 0) + (x.timeout ?? 0); } return `${o}/${f}/${e}`; };
    L.push(`| ${arm} | ${rs[0].N} | ${range(H('tickService'), 3)} | ${range(H('healthzP99Ms'))} | ${range(H('actP99Ms'))} | ${range(H('readP99Ms'))} | ${range(H('heapPeakMb'))} (${range(H('heapPeakPctCap'), 1)} %) | ${range(H('rssPeakMb'))} | ${rs.some((r) => r.headline.wedge) ? '**YES**' : 'no'} (${range(H('longestHealthzGapS'), 1)}) | ${range(H('timeouts'))} | ${oc('C1')} | ${oc('C2')} | ${range(H('maxListenersPerSoul'))}${arm === 'incident' ? ` (superseded ${range(H('listenSuperseded'))}, already ${range(H('listenAlready'))})` : ''} |`);
  }
  L.push('');

  if (receipt.v === 2) stageB(L, receipt, by);
  const mean = (arm, k, sub) => { const v = by[arm].map((r) => (sub ? r.stageb?.headline : r.headline)?.[k]).filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  for (const mode of [...new Set(receipt.arms.map((a) => a.split('@')[1] ?? ''))]) {
    const ns = receipt.arms.filter((a) => /^n\d+(@|$)/.test(a) && (a.split('@')[1] ?? '') === mode && by[a]?.length);
    L.push(`## M8 — marginal cost per additional agent${mode ? ` (read worker ${mode})` : ''} (least squares over ${ns.join('/') || 'no n arms'}, mean of repeats)`, '');
    L.push('| quantity | per added Soul | with no Souls (intercept) | per arm |', '|---|---|---|---|');
    const rows = [['idleCpuSPerS', 'world CPU, idle (listen + wait + viewer)', 'CPU-s/s', 4], ['activeCpuSPerS', 'world CPU, active load', 'CPU-s/s', 4], ['idleRssMb', 'RSS, idle', 'MB', 1], ['idleHeapMb', 'V8 heap, idle', 'MB', 1]];
    if (receipt.v === 2) rows.push(['mainCpuSPerS', 'main thread(s) CPU, active (process − workers)', 'CPU-s/s', 4, true], ['workerCpuSPerS', 'read workers CPU, active', 'CPU-s/s', 4, true]);
    for (const [k, label, unit, d, sub] of rows) {
      const s = slope(ns.map((a) => [by[a][0].N, mean(a, k, sub)]));
      L.push(`| ${label} | ${s ? `${s.perSoul.toFixed(d)} ${unit}` : '—'} | ${s ? `${s.intercept.toFixed(d)} ${unit}` : '—'} | ${ns.map((a) => `${a} ${mean(a, k, sub)?.toFixed(d) ?? '—'}`).join(' · ')} |`);
    }
    L.push('');
  }
  L.push('', 'A cheap agent is one whose idle and active slopes are small against the intercept; CPU-s/s of 1.0 is one whole core.', '');

  const cal = (by.n1 ?? []).map((r) => r.calibration).filter(Boolean);
  if (cal.length) {
    L.push('## M7 — world CPU-s per request (n1 calibration, 1 Soul, serial; idle rate subtracted)', '', '| class | CPU-s per request | CLI p50 ms |', '|---|---|---|');
    for (const op of ['here', 'observe', 'caps', 'resolve', 'around', 'act', 'say']) L.push(`| ${op} | ${range(cal.map((c) => c[op]?.cpuSPerReq), 4)} | ${range(cal.map((c) => c[op]?.p50Ms))} |`);
    L.push('');
  }
  if (by.hostile?.length) {
    L.push('## Hostile clients (4 instant-retry raw loops per Soul, 6 Souls; whole run after join)', '', '| repeat | requests | ok | designed refusals | 5xx | other 4xx | failed | p99 ms |', '|---|---|---|---|---|---|---|---|');
    for (const r of by.hostile) { const x = r.hostile; L.push(`| r${r.rep} | ${x.requests} | ${x.ok} | ${x.refused} | ${x.error5xx} | ${x.other4xx} | ${x.failed} | ${x.p99Ms} |`); }
    L.push('');
  }

  const lv = ok.filter((r) => r.launcher !== undefined);
  if (lv.length) {
    L.push('## Launcher (its view of the world at the end of each run; launcher CPU is the worse active window)', '', '| run | world status | restarts | refusals by code (launcher ceilings) | launcher CPU-s/s |', '|---|---|---|---|---|');
    for (const r of lv) { const x = r.launcher ?? {}, c = [r.windows.activeA.launcherCpuSPerS, r.windows.activeB.launcherCpuSPerS].filter((v) => v != null);
      L.push(`| ${r.arm} r${r.rep} | ${x.status ?? '—'} | ${x.restarts ?? '—'} | ${x.refused ? (Object.entries(x.refused).map(([k, v]) => `${k} ${v}`).join(', ') || 'none') : 'n/a (no ceilings in this launcher)'} | ${c.length ? Math.max(...c).toFixed(3) : '—'} |`); }
    L.push('');
  }

  L.push('## Pass table (tranche §2)', '');
  if (h.indicative) L.push('Not judged: laptop/other host. Only an eden2 cgroup slice run gates (LESSONS-20261026 §1).', '');
  else {
    L.push('| arm | tick service | healthz p99 | act/read p99 | heap | wedge | verdict |', '|---|---|---|---|---|---|---|');
    for (const arm of receipt.arms) {
      const rs = by[arm] ?? []; if (!rs.length) { L.push(`| ${arm} | | | | | | FAIL (no run) |`); continue; }
      const H = (k, hi) => worst(rs.map((r) => r.headline[k]), hi), wedge = rs.some((r) => r.headline.wedge), b = receipt.v === 2 ? null : BARS[arm], marks = [];
      if (b) {
        const t = H('tickService', false) >= b.tick, hz = H('healthzP99Ms', true) <= b.healthz, p = Math.max(H('actP99Ms', true) ?? 0, H('readP99Ms', true) ?? 0) <= b.p99, hp = b.heap ? H('heapPeakPctCap', true) <= b.heap : true;
        marks.push(t, hz, p, hp);
        L.push(`| ${arm} | ${t ? 'pass' : '**fail**'} | ${hz ? 'pass' : '**fail**'} | ${p ? 'pass' : '**fail**'} | ${b.heap ? (hp ? 'pass' : '**fail**') : '—'} | ${wedge ? '**WEDGED**' : 'never'} | ${marks.every(Boolean) && !wedge ? 'PASS' : 'FAIL'} |`);
      } else {
        const base = arm.split('@')[0], sb = receipt.v === 2 && /^n\d+$/.test(base), extra = sb ? H('timeouts', true) === 0 : base === 'n24' ? H('timeouts', true) === 0 : H('maxListenersPerSoul', true) <= 1;
        L.push(`| ${arm} | | | ${sb || base === 'n24' ? `timeouts ${H('timeouts', true)}` : `listeners/Soul ${H('maxListenersPerSoul', true)}`} | | ${wedge ? '**WEDGED**' : 'never'} | ${extra && !wedge ? 'PASS' : 'FAIL'} |`);
      }
    }
    L.push('');
  }
  return L.join('\n') + '\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2], receipt = JSON.parse(readFileSync(join(out, 'receipt.json'), 'utf8'));
  const results = readdirSync(out).filter((d) => existsSync(join(out, d, 'result.json'))).map((d) => JSON.parse(readFileSync(join(out, d, 'result.json'), 'utf8')));
  writeFileSync(join(out, 'REPORT.md'), report(receipt, results)); console.log(join(out, 'REPORT.md'));
}
