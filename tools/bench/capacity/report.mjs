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

export function report(receipt, results) {
  const h = receipt.host, ok = results.filter((r) => !r.failed), by = {};
  for (const r of ok) (by[r.arm] ??= []).push(r);
  const L = [];
  L.push(`# Capacity bench report — ${h.label}${h.indicative ? ' (INDICATIVE: not an eden2 slice; numbers never pass or fail a bar)' : ''}`, '');
  L.push(`Metrics: \`${receipt.metrics}\`. Generated ${receipt.at}. Two repeats per arm are shown as ranges (min–max).`, '');
  L.push('| receipt | value |', '|---|---|');
  for (const [k, v] of Object.entries({ source: `${h.sourceSha}${h.sourceDirty ? ' (dirty)' : ''}`, bench: h.benchSha, fixture: `${h.fixture} sha256 ${h.fixtureSha256}`, 'Soul CLI': `${h.cliVersion} sha256 ${h.cliSha256}`, world: `${h.worldKey} / ${h.worldId} (${h.engine})`,
    host: `${h.hostname} · ${h.cpu} · ${h.cores} cores · ${h.kernel} · node ${h.node}`, slice: h.slice ?? 'none (whole host)', heap: `${h.heapMb} MB cap`, phases: JSON.stringify(h.phases), 'CLI startup': `${h.cliStartupMedianMs} ms median (inside every act/read time)` })) L.push(`| ${k} | ${String(v).replace(/\|/g, '/')} |`);
  L.push('');
  const failed = results.filter((r) => r.failed); if (failed.length) { L.push('**Failed runs:** ' + failed.map((r) => `${r.arm} r${r.rep}: ${r.failed}`).join('; '), ''); }

  L.push('## Arms (worse of the two active windows per run; range over repeats)', '');
  L.push('| arm | N | tick service | healthz p99 ms | act p99 ms | read p99 ms | heap peak MB (% cap) | RSS peak MB | wedge (longest gap s) | timeouts | C1 ok/refused/err | C2 ok/refused/err | listeners per Soul |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const arm of receipt.arms) {
    const rs = by[arm] ?? []; if (!rs.length) { L.push(`| ${arm} | — | failed |`); continue; }
    const H = (k) => rs.map((r) => r.headline[k]);
    const oc = (cls) => { let o = 0, f = 0, e = 0; for (const r of rs) for (const w of ['activeA', 'activeB']) { const x = r.windows[w].outcomes[cls] ?? {}; o += x.ok ?? 0; f += x.refused ?? 0; e += (x.error ?? 0) + (x.unreachable ?? 0) + (x.timeout ?? 0); } return `${o}/${f}/${e}`; };
    L.push(`| ${arm} | ${rs[0].N} | ${range(H('tickService'), 3)} | ${range(H('healthzP99Ms'))} | ${range(H('actP99Ms'))} | ${range(H('readP99Ms'))} | ${range(H('heapPeakMb'))} (${range(H('heapPeakPctCap'), 1)} %) | ${range(H('rssPeakMb'))} | ${rs.some((r) => r.headline.wedge) ? '**YES**' : 'no'} (${range(H('longestHealthzGapS'), 1)}) | ${range(H('timeouts'))} | ${oc('C1')} | ${oc('C2')} | ${range(H('maxListenersPerSoul'))}${arm === 'incident' ? ` (superseded ${range(H('listenSuperseded'))}, already ${range(H('listenAlready'))})` : ''} |`);
  }
  L.push('');

  L.push('## M8 — marginal cost per additional agent (least squares over n1/n6/n12/n24, mean of repeats)', '');
  const ns = ['n1', 'n6', 'n12', 'n24'].filter((a) => by[a]?.length);
  const mean = (arm, k) => { const v = by[arm].map((r) => r.headline[k]).filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  L.push('| quantity | per added Soul | with no Souls (intercept) | per arm |', '|---|---|---|---|');
  for (const [k, label, unit, d] of [['idleCpuSPerS', 'world CPU, idle (listen + wait + viewer)', 'CPU-s/s', 4], ['activeCpuSPerS', 'world CPU, active load', 'CPU-s/s', 4], ['idleRssMb', 'RSS, idle', 'MB', 1], ['idleHeapMb', 'V8 heap, idle', 'MB', 1]]) {
    const s = slope(ns.map((a) => [by[a][0].N, mean(a, k)]));
    L.push(`| ${label} | ${s ? `${s.perSoul.toFixed(d)} ${unit}` : '—'} | ${s ? `${s.intercept.toFixed(d)} ${unit}` : '—'} | ${ns.map((a) => `${a} ${mean(a, k)?.toFixed(d) ?? '—'}`).join(' · ')} |`);
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

  L.push('## Pass table (tranche §2)', '');
  if (h.indicative) L.push('Not judged: laptop/other host. Only an eden2 cgroup slice run gates (LESSONS-20261026 §1).', '');
  else {
    L.push('| arm | tick service | healthz p99 | act/read p99 | heap | wedge | verdict |', '|---|---|---|---|---|---|---|');
    for (const arm of receipt.arms) {
      const rs = by[arm] ?? []; if (!rs.length) { L.push(`| ${arm} | | | | | | FAIL (no run) |`); continue; }
      const H = (k, hi) => worst(rs.map((r) => r.headline[k]), hi), wedge = rs.some((r) => r.headline.wedge), b = BARS[arm], marks = [];
      if (b) {
        const t = H('tickService', false) >= b.tick, hz = H('healthzP99Ms', true) <= b.healthz, p = Math.max(H('actP99Ms', true) ?? 0, H('readP99Ms', true) ?? 0) <= b.p99, hp = b.heap ? H('heapPeakPctCap', true) <= b.heap : true;
        marks.push(t, hz, p, hp);
        L.push(`| ${arm} | ${t ? 'pass' : '**fail**'} | ${hz ? 'pass' : '**fail**'} | ${p ? 'pass' : '**fail**'} | ${b.heap ? (hp ? 'pass' : '**fail**') : '—'} | ${wedge ? '**WEDGED**' : 'never'} | ${marks.every(Boolean) && !wedge ? 'PASS' : 'FAIL'} |`);
      } else {
        const extra = arm === 'n24' ? H('timeouts', true) === 0 : H('maxListenersPerSoul', true) <= 1;
        L.push(`| ${arm} | | | ${arm === 'n24' ? `timeouts ${H('timeouts', true)}` : `listeners/Soul ${H('maxListenersPerSoul', true)}`} | | ${wedge ? '**WEDGED**' : 'never'} | ${extra && !wedge ? 'PASS' : 'FAIL'} |`);
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
