// Morning summary: ONE self-contained HTML page over every run with results in a runs root (the night at a glance).
// Read-only over run folders; chosen thumbnails are copied (resized to ≤ 640 px JPEG: sips on macOS, ImageMagick/ffmpeg on Linux) into an assets dir
// and referenced by relative path. No external resources, no base64.
// node tools/playtest/review/summary.mjs [--runs-root dir] [--out file.html] [--assets dir] [--max-shots 12] [--night-log file]
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { toJpeg } from '../lib/platform.mjs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RUNS_ROOT, esc as esc0, chip, md2html, listRuns, loadBundle } from './booklet.mjs';
import { computeMetrics } from './metrics.mjs';
import { similar } from './reviewer.mjs';

export const DEFAULT_NIGHT_LOG = process.env.PLAYTEST_NIGHT_LOG ?? null; // an optional coordinator night log (markdown)
const PHYS = new Set(['inside-solid', 'no-progress', 'stuck-receipt']);
const CLASSES = ['O1', 'O2', 'O3', 'O4', 'O5'];

// Absolute home paths never reach the page text (only Developer-draft links may carry a path).
const scrub = (s) => String(s ?? '').replace(/(?:\/[^/\s]+)+\/playtest\/runs\//g, 'runs/').replace(/\/(?:Users|home)\/[^/\s]+\//g, '~/');
const esc = (s) => esc0(scrub(s));
const rel = (from, to) => relative(from, to).split(sep).join('/');
const pct = (v) => (typeof v === 'number' ? `${Math.round(v * 100)}%` : '—');
const n1 = (v) => (v == null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(1));
const cut = (s, n) => { const t = scrub(s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };
const sentences = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=[A-Z"`(])/);
const read = (f) => { try { return readFileSync(f, 'utf8'); } catch { return null; } };
const isBasics = (b) => /^basics-walk-act/.test(b.run.scenario?.name ?? b.name);

// ---------- data
const seatsOf = (b) => { const s = b.run.scenario ?? {}; return [...(s.seats ?? []).map((x) => ({ ...x, god: false })), ...(s.god ? [{ id: 'god', ...s.god, god: true }] : [])]; };
const seatLabel = (x) => `${x.id}${x.god ? ' (god)' : ''}: ${x.adapter ?? '?'} ${x.model ?? 'default'}`;
const personaOf = (b, seat) => seatsOf(b).find((x) => x.id === seat)?.persona ?? seat;
const fid = (rows) => { const c = { H: 0, P: 0, M: 0, W: 0 }; rows.forEach((r) => { if (r.fidelity in c) c[r.fidelity]++; }); return c; };

/** Runs with results: an evidence folder and a ledger (everything else is a failed or unfinished start). */
export function resultRuns(runsRoot) {
  return listRuns(runsRoot).filter((d) => existsSync(join(d, 'evidence')) && existsSync(join(d, 'ledger.tsv')));
}

/** Basics block for one seat of a run (the run's own evidence, ledger and oracles filtered to that seat). */
export function seatBasics(b, seat) {
  const evidence = b.run.evidence.filter((e) => e.seat === seat); if (!evidence.length) return null;
  const ids = new Set(evidence.map((e) => e.requestId)); const ledger = b.ledger.filter((r) => ids.has(r.requestId));
  try {
    const m = computeMetrics({ ...b.run, evidence }, { ledger, oracles: b.oracles.length ? b.oracles.filter((o) => ids.has(o.requestId)) : null });
    return { ...m.basics, ...fid(ledger) };
  } catch { return { requests: evidence.length, ...fid(ledger) }; }
}

/** The latest shot of the request's own seat taken inside the request window (sent..cutoff); absolute path or null. */
export function pickShot(b, ev) {
  const abs = (p) => (p ? (isAbsolute(p) ? p : join(b.runDir, p)) : null);
  const t0 = Date.parse(ev.sentAt); const t1 = Date.parse(ev.cutoffAt ?? ev.resultAt ?? ev.sentAt) || t0;
  const own = new Set((ev.shots ?? []).map(abs));
  const idx = b.run.shotsIndex.filter((s) => s.path && (own.has(abs(s.path)) || s.cam === ev.seat))
    .map((s) => ({ ...s, ms: Date.parse(s.t), file: abs(s.path) })).filter((s) => s.ms <= t1 && existsSync(s.file));
  const inWin = idx.filter((s) => s.ms >= t0).sort((a, z) => a.ms - z.ms);
  if (inWin.length) return inWin.at(-1).file;
  const evShot = [...own].filter((p) => existsSync(p)).at(-1); if (evShot) return evShot;
  const dir = join(b.runDir, 'shots', ev.seat); const cutMono = t1 - b.run.anchorMs;
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^\d+\.(png|jpe?g)$/.test(f)).map((f) => ({ f, mono: parseInt(f, 10) })).filter((x) => x.mono <= cutMono).sort((a, z) => a.mono - z.mono) : [];
  return files.length ? join(dir, files.at(-1).f) : (idx.sort((a, z) => a.ms - z.ms).at(-1)?.file ?? null);
}

/** Every W and every inside-solid / stuck oracle fail across runs; physical fails first, then newest run first. */
export function egregiousAll(bundles) {
  const out = [];
  for (const b of bundles) for (const ev of b.run.evidence) {
    const v = b.verdict(ev.requestId); const why = [];
    b.oracles.filter((o) => o.requestId === ev.requestId && PHYS.has(o.id) && o.status === 'fail').forEach((o) => why.push(`${o.id} fail`));
    const phys = why.length > 0;
    if (v?.fidelity === 'W') why.push(`W${v.class ? ' ' + v.class : ''}`);
    if (why.length) out.push({ b, ev, run: b.name, seat: ev.seat, requestId: ev.requestId, text: ev.text, why, phys, reason: v?.reason ?? '' });
  }
  return out.sort((a, z) => (z.phys - a.phys) || z.run.localeCompare(a.run) || a.requestId.localeCompare(z.requestId));
}

const ENGINE = /\b(no (such )?(verb|capability|action|animation|way to)|isn'?t (a |an )?(verb|capability)|not (a |an )?(verb|capability)|does ?n[o']t exist|world (has|offers) no|has no (verb|capability|way)|not supported by the world|no .{0,30}(verb|capability) (for|exists))/i;
const AGENT = /\b(latency|too slow|slowly|took (about |over )?\d+|minutes? (later|before|of silence)|silence|ignored|no reply|never replied|never answered|acknowledg|waited|away)\b/i;
/** Merge feature requests across runs by similar title / want / wording; tag engine-vs-agent only when the Reviewer's text says so. */
export function mergeFeatureRequests(bundles) {
  const groups = [];
  for (const b of bundles) for (const f of b.frs) {
    const words = f.wordings ?? []; const n = (f.count ?? 0) + (f.desireCount ?? 0) || 1;
    const vs = (f.requestIds ?? []).map((id) => b.verdict(id)).filter(Boolean);
    const reasons = vs.map((v) => v.reason ?? '').join(' '); const cls = vs.map((v) => v.class).filter(Boolean);
    // Compare with each group's first title/want only, so merges cannot snowball through accumulated wordings.
    const g = groups.find((x) => similar(x.title, f.title) || (f.want && similar(x.want, f.want)));
    const personas = (f.personas ?? []).map((s) => personaOf(b, s));
    if (g) { g.count += n; personas.forEach((p) => { if (!g.personas.includes(p)) g.personas.push(p); }); words.forEach((w) => { if (!g.wordings.includes(w)) g.wordings.push(w); }); if (!g.runs.includes(b.name)) g.runs.push(b.name); g.text += ' ' + reasons + ' ' + (f.want ?? ''); g.cls.push(...cls); continue; }
    groups.push({ title: f.title, want: f.want ?? f.title, wordings: [...words], personas, runs: [b.name], count: n, text: `${f.title} ${f.want ?? ''} ${reasons}`, cls: [...cls] });
  }
  // The Reviewer's class decides when it is unanimous (O4 missing vocabulary / O1 loop failure); its wording otherwise.
  for (const g of groups) {
    const e = g.cls.length ? g.cls.every((c) => c === 'O4') : ENGINE.test(g.text);
    const a = g.cls.length ? g.cls.every((c) => c === 'O1') : AGENT.test(g.want + ' ' + g.title) || (AGENT.test(g.text) && !ENGINE.test(g.text));
    g.kind = e && !a ? 'engine/world' : a && !e ? 'agent/latency' : null; delete g.text;
  }
  return groups.sort((a, z) => z.count - a.count || z.personas.length - a.personas.length);
}

export function issueStats(bundles) {
  const classes = Object.fromEntries([...CLASSES, 'none'].map((k) => [k, 0])); const groups = [];
  for (const b of bundles) for (const i of b.issues) {
    classes[CLASSES.includes(i.class) ? i.class : 'none']++;
    const n = (i.requestIds ?? []).length || 1; const g = groups.find((x) => similar(x.title, i.title));
    if (g) { g.count += n; if (!g.runs.includes(b.name)) g.runs.push(b.name); if (i.class) g.classes.add(i.class); continue; }
    groups.push({ title: i.title, count: n, runs: [b.name], classes: new Set(i.class ? [i.class] : []) });
  }
  return { classes, top: groups.sort((a, z) => z.count - a.count || z.runs.length - a.runs.length).slice(0, 10) };
}

/** The night log's caveat sentences and its harness sections. */
export function readNightLog(file) {
  const md = read(file) ?? ''; const sections = []; let cur = null;
  for (const l of md.split('\n')) { const h = l.match(/^##\s+(.*)$/); if (h) { cur = { heading: h[1].trim(), body: [] }; sections.push(cur); } else if (cur) cur.body.push(l); }
  sections.forEach((s) => { s.body = s.body.join('\n').trim(); });
  const all = md.replace(/^#.*$/gm, '').split(/\n\s*\n|\n(?=\s*[-*]\s)/).flatMap((para) => sentences(para.replace(/^\s*[-*]\s+/, '')));
  const memory = all.find((s) => /memory-bound/i.test(s) && /GB/.test(s)) ?? all.find((s) => /memory-bound/i.test(s));
  const load = all.find((s) => /under load/i.test(s) && /speed/i.test(s)) ?? all.find((s) => /under load/i.test(s));
  const harness = sections.filter((s) => /^open harness|harness items/i.test(s.heading));
  const last = sections.filter((s) => !harness.includes(s)).at(-1) ?? null;
  return { exists: !!md, title: md.match(/^#\s+(.*)$/m)?.[1] ?? null, caveat: [memory, load].filter(Boolean), harness, last };
}

/** Items of a markdown section as bullets: its own bullet list, or its prose split at semicolons. */
const bullets = (body) => { const li = body.split('\n').filter((l) => /^\s*[-*]\s+/.test(l)); if (li.length) return body; return body.replace(/\s+/g, ' ').trim().replace(/\.$/, '').split(/;\s+/).map((x) => `- ${x.charAt(0).toUpperCase()}${x.slice(1)}.`).join('\n'); };

// ---------- images
/** ≤ 640 px wide JPEG under ~120 KB: sips on macOS, ImageMagick or ffmpeg elsewhere (lib/platform.mjs). */
export function sipsThumb(src, dst) {
  for (const q of [72, 55, 40]) {
    toJpeg(src, dst, { quality: q, maxWidth: 640 });
    if (statSync(dst).size < 120 * 1024) break;
  }
  return dst;
}

// ---------- page
const CSS = `
:root{--bg:#fbfaf7;--fg:#1d1d1b;--mute:#6b6a65;--line:#dedbd2;--card:#f2f0ea;--hi:#fff6d8;--link:#1f5fa8;--H:#1e7a3c;--P:#a86a00;--M:#76746d;--W:#b3261e;--Hb:#e3f3e7;--Pb:#fcefd6;--Mb:#ebeae6;--Wb:#fbe3e1}
@media (prefers-color-scheme:dark){:root{--bg:#161614;--fg:#e8e6e1;--mute:#a19f98;--line:#3a3935;--card:#211f1c;--hi:#2e2a17;--link:#8ab8f0;--H:#7fd39a;--P:#f0bd5c;--M:#b5b3ac;--W:#ff8a80;--Hb:#183522;--Pb:#3a2c10;--Mb:#2b2a27;--Wb:#3d1916}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
main{max-width:1040px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:1.7em;margin:.2em 0 .2em;line-height:1.2}h2{font-size:1.25em;margin:2.2em 0 .5em;border-bottom:1px solid var(--line);padding-bottom:.2em}h3{font-size:1.02em;margin:1.2em 0 .3em}h4,h5,h6{font-size:1em;margin:1em 0 .3em}
a{color:var(--link)}p,li,td{overflow-wrap:anywhere}.mute{color:var(--mute)}.small{font-size:.86em}
code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.86em}
.scroll{overflow-x:auto;max-width:100%;margin:.5em 0}table{border-collapse:collapse;font-size:.88em;width:100%}th,td{border-bottom:1px solid var(--line);padding:5px 7px;text-align:left;vertical-align:top}th{color:var(--mute);font-weight:600}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
tr.hi>td{background:var(--hi)}tr.sub>td{font-size:.94em}tr.sub>td:first-child{padding-left:20px}
.chip{display:inline-block;border-radius:999px;padding:0 8px;margin:1px 2px 1px 0;font-size:.78em;line-height:1.7;font-weight:600;white-space:nowrap;border:1px solid var(--line)}
.fH{background:var(--Hb);color:var(--H);border-color:var(--H)}.fP{background:var(--Pb);color:var(--P);border-color:var(--P)}.fW{background:var(--Wb);color:var(--W);border-color:var(--W)}.fM{background:var(--Mb);color:var(--M);border-color:var(--M)}
.box{border:1px solid var(--line);background:var(--card);border-radius:8px;padding:10px 14px;margin:1em 0}.box p{margin:.4em 0}
.stats{display:flex;flex-wrap:wrap;gap:8px 22px;margin:.6em 0 1em}.stats div{min-width:0}.stats b{font-size:1.35em;display:block;line-height:1.1;font-variant-numeric:tabular-nums}
.egr{list-style:none;padding:0;margin:0}.egr li{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--line)}.egr .ph{flex:0 0 200px}.egr .tx{flex:1 1 auto;min-width:0}
.thumb{width:200px;max-width:100%;height:auto;border:1px solid var(--line);border-radius:4px;display:block}
ol.fr{padding-left:1.4em}ol.fr li{margin:.5em 0}details{margin:.3em 0}summary{cursor:pointer;color:var(--mute)}
.conclusion{font-weight:600;margin:.6em 0}.nw{white-space:nowrap}
@media (max-width:640px){.egr li{flex-direction:column}.egr .ph{flex:none;width:100%}.thumb{width:100%}
table.cards,table.cards tbody,table.cards tr,table.cards td{display:block;width:100%}table.cards tr:first-child{display:none}table.cards tr{border:1px solid var(--line);border-radius:8px;margin:0 0 10px;padding:6px 10px}table.cards tr.sub{margin-left:14px}table.cards td{border:0;padding:2px 0;text-align:left}table.cards tr.sub>td:first-child{padding-left:0}table.cards td.n{display:inline-block;width:auto;margin-right:16px}table.cards td[data-l]::before{content:attr(data-l) ": ";color:var(--mute);font-size:.86em}}
`;

function header(bundles, night, failedStarts) {
  const reqs = bundles.reduce((a, b) => a + b.run.evidence.length, 0);
  const issues = bundles.reduce((a, b) => a + b.issues.length, 0); const frs = bundles.reduce((a, b) => a + b.frs.length, 0);
  const pf = bundles.map((b) => ({ b, q: b.run.preflight?.checks?.quota })).find((x) => x.q);
  const day = (night.title?.match(/\d{4}-\d{2}-\d{2}(\/\d{2})?/)?.[0]) ?? bundles.at(-1)?.name.slice(0, 8).replace(/(\d{4})(\d\d)(\d\d)/, '$1-$2-$3') ?? '';
  const span = bundles.length ? `${bundles.at(-1).name.slice(9, 13).replace(/(\d\d)(\d\d)/, '$1:$2')}–${bundles[0].name.slice(9, 13).replace(/(\d\d)(\d\d)/, '$1:$2')} UTC` : '';
  const quota = pf ? `${pf.q.fiveH ?? '?'}% 5h · ${pf.q.week ?? '?'}% week · ${pf.q.fable ?? '?'}% Fable` : null;
  const caveat = night.caveat.length ? night.caveat.map(esc).join(' ') : 'Speed numbers were measured with the harness, the seats and the worlds all on one laptop and read slower than an unloaded server would; fidelity and oracle facts are unaffected.';
  const coord = bundles.filter((b) => existsSync(join(b.runDir, 'COORDINATOR-NOTES.md')));
  return `<h1>Playtest, first night</h1><p class="mute">${esc(day)} · runs started ${esc(span)} · built ${esc(new Date().toISOString().slice(0, 16).replace('T', ' '))} UTC</p>
<div class="stats"><div><b>${bundles.length}</b><span class="small mute">runs with results</span></div><div><b>${reqs}</b><span class="small mute">requests</span></div><div><b>${issues}</b><span class="small mute">issues</span></div><div><b>${frs}</b><span class="small mute">feature requests</span></div>${quota ? `<div><b>${esc(pf.q.week ?? '?')}%</b><span class="small mute">week quota at the last run (${esc(quota)})</span></div>` : ''}</div>
<div class="box"><p><strong>Read the speed numbers as under load.</strong> ${caveat}</p>
${coord.length ? `<p class="small">Harness-caveated runs (a coordinator note sits beside the scores):</p><ul class="small">${coord.map((b) => `<li><strong>${esc(b.run.scenario?.name ?? b.name)}</strong> <span class="mute">${esc(b.name)}</span>: ${esc(cut(sentences(read(join(b.runDir, 'COORDINATOR-NOTES.md')))[0], 320))}</li>`).join('')}</ul>` : ''}
${failedStarts ? `<p class="small mute">${failedStarts} failed or unfinished start(s) (no evidence or no ledger) are left out.</p>` : ''}</div>`;
}

function scorecardSection(bundles) {
  const row = (cls, first, seats, k, c) => `<tr class="${cls}"><td data-l="run">${first}</td><td data-l="seats" class="small">${seats}</td><td data-l="walks asked / arrived" class="n">${k ? `${k.walkRequests ?? '—'} / ${k.walksArrived ?? '—'}${k.walksArrivalKnown ? ` <span class="mute">(${pct(k.walkArrivalRate)}${k.walksArrivalKnown < k.walkRequests ? ` of ${k.walksArrivalKnown} known` : ''})</span>` : ''}` : '—'}</td><td data-l="body moved in budget" class="n">${k ? `${k.bodyMovedInBudget ?? '—'} / ${k.requests ?? '—'}` : '—'}</td><td data-l="ack median" class="n">${k?.ackMedianSec == null ? '—' : n1(k.ackMedianSec) + ' s'}</td><td data-l="stuck" class="n">${k?.stuck ?? '—'}</td><td data-l="inside-solid" class="n">${k?.insideSolid ?? '—'}</td><td data-l="W" class="n">${c.W ? chip(String(c.W), 'fW') : '0'}</td><td data-l="H" class="n">${c.H}</td></tr>`;
  const rows = []; const seatRows = [];
  for (const b of bundles.filter((x) => x.metrics?.basics)) {
    const hi = isBasics(b); const c = fid(b.ledger);
    rows.push(row(hi ? 'hi' : '', `<strong>${esc(b.run.scenario?.name ?? b.name)}</strong><div class="small mute">${esc(b.name.slice(9, 15).replace(/(\d\d)(\d\d)(\d\d)/, '$1:$2'))} UTC</div>`, seatsOf(b).map((x) => esc(seatLabel(x))).join('<br>'), b.metrics.basics, c));
    for (const x of seatsOf(b)) {
      const k = seatBasics(b, x.id); if (!k) continue;
      seatRows.push({ b, x, k, basics: hi });
      if (hi) rows.push(row('hi sub', `<span class="small">↳ ${esc(x.id)}</span>`, esc(`${x.adapter} ${x.model ?? 'default'}`), k, k));
    }
  }
  // One computed line: who had no W, best arrival, most W, over the basics batteries when present (all seats otherwise).
  const pool = seatRows.some((r) => r.basics) ? seatRows.filter((r) => r.basics) : seatRows;
  const who = (r) => `${r.x.adapter} ${r.x.model ?? 'default'} (${r.x.id}, ${r.b.run.scenario?.name ?? r.b.name})`;
  const zeroW = pool.filter((r) => r.k.requests >= 3 && r.k.W === 0);
  const arr = pool.filter((r) => r.k.walksArrivalKnown > 0).sort((a, z) => z.k.walkArrivalRate - a.k.walkArrivalRate || z.k.walksArrived - a.k.walksArrived);
  const mostW = [...pool].sort((a, z) => z.k.W - a.k.W)[0];
  const parts = [];
  if (zeroW.length) parts.push(`W = 0 for ${zeroW.map((r) => `${who(r)}, H ${r.k.H} of ${r.k.requests}`).join('; ')}`);
  if (arr.length) parts.push(`Best arrival: ${who(arr[0])} at ${arr[0].k.walksArrived}/${arr[0].k.walksArrivalKnown} (${pct(arr[0].k.walkArrivalRate)})`);
  if (mostW?.k.W) parts.push(`Most W: ${who(mostW)} with ${mostW.k.W} of ${mostW.k.requests}`);
  const concl = parts.length ? `${pool.some((r) => r.basics) ? 'Basics batteries' : 'All seats'}: ${parts.join('. ')}.` : 'No seat had enough scored requests for a conclusion.';
  return `<h2 id="basics">Basics scorecard across runs</h2><p class="conclusion">${esc(concl)}</p>
<p class="small mute">The two basics-walk-act batteries (12 identical walk/act requests per seat, scripted, oracle-scored) are highlighted with a row per seat. The first battery sent requests on a clock while seat turns took 200–300 s, so several of its W are request pile-up; the second waited for each request to close. Arrival is the strict arrival oracle (at the named spot by the cutoff); stopping short counts as not arrived.</p>
<div class="scroll"><table class="cards"><tr><th>run</th><th>seats (adapter, model)</th><th class="n">walks asked / arrived</th><th class="n">body moved in budget</th><th class="n">ack median</th><th class="n">stuck</th><th class="n">inside-solid</th><th class="n">W</th><th class="n">H</th></tr>${rows.join('')}</table></div>`;
}

function egregiousSection(bundles, { outFile, assetsDir, maxShots, thumb }) {
  const all = egregiousAll(bundles); const shown = all.slice(0, maxShots); const outDir = dirname(outFile);
  const items = shown.map((e) => {
    let img = '';
    const src = pickShot(e.b, e.ev);
    if (src && thumb) { const dst = join(assetsDir, `${e.run}-${e.requestId}.jpg`.replace(/[^\w.-]/g, '_')); try { thumb(src, dst); img = `<img class="thumb" src="${esc0(rel(outDir, dst))}" alt="${esc(e.requestId)} at cutoff">`; } catch { img = ''; } }
    return `<li><div class="ph">${img || '<span class="small mute">no shot</span>'}</div><div class="tx">${e.why.map((w) => chip(w, 'fW')).join('')} <span class="mono">"${esc(e.text)}"</span>
<div class="small mute">${esc(e.b.run.scenario?.name ?? e.run)} · ${esc(e.seat)} (${esc(seatsOf(e.b).find((x) => x.id === e.seat)?.adapter ?? '?')} ${esc(seatsOf(e.b).find((x) => x.id === e.seat)?.model ?? '')}) · ${esc(e.requestId)}</div>
${e.reason ? `<p class="small"><strong>Reviewer:</strong> ${esc(cut(e.reason, 200))}</p>` : ''}</div></li>`;
  });
  const rest = all.slice(maxShots);
  return `<h2 id="egregious">Egregious failures</h2><p class="small mute">${all.length} in all: every W and every inside-solid or stuck oracle fail. Physical fails first, then newest run first; the picture is the seat's latest shot before the request closed.</p>
${items.length ? `<ul class="egr">${items.join('')}</ul>` : '<p class="mute">None.</p>'}
${rest.length ? `<details><summary>${rest.length} more</summary><ul class="small">${rest.map((e) => `<li>${e.why.map((w) => esc(w)).join(', ')}: "${esc(e.text)}" <span class="mute">${esc(e.b.run.scenario?.name ?? e.run)} · ${esc(e.seat)} · ${esc(e.requestId)}</span></li>`).join('')}</ul></details>` : ''}`;
}

function frSection(bundles) {
  const groups = mergeFeatureRequests(bundles); const top = groups.slice(0, 15);
  return `<h2 id="wanted">What players wanted</h2><p class="small mute">${groups.length} distinct wishes after merging similar ones across runs; top ${top.length} by count. Tagged only where the Reviewer's text says whether the world lacks the verb (engine/world) or the agent was slow or silent (agent/latency).</p>
${top.length ? `<ol class="fr">${top.map((g) => `<li><strong>${esc(g.title)}</strong> ×${g.count} ${g.kind ? chip(g.kind, g.kind === 'engine/world' ? 'fP' : 'fM') : ''}<div class="small mute">${esc(g.personas.join(', '))} · ${g.runs.length} run(s)</div>${g.wordings[0] && g.wordings[0] !== g.title ? `<div class="small">e.g. "${esc(cut(g.wordings[0], 200))}"</div>` : ''}</li>`).join('')}</ol>` : '<p class="mute">None.</p>'}`;
}

function issuesSection(bundles) {
  const { classes, top } = issueStats(bundles);
  const names = { O1: 'loop failure', O2: 'misinterpretation', O3: 'execution failure', O4: 'missing vocabulary', O5: 'incoherence', none: 'unclassed' };
  return `<h2 id="issues">Issues by class</h2><div class="scroll"><table><tr>${Object.keys(classes).map((k) => `<th class="n">${esc(k)}</th>`).join('')}</tr><tr>${Object.values(classes).map((v) => `<td class="n"><strong>${v}</strong></td>`).join('')}</tr><tr>${Object.keys(classes).map((k) => `<td class="small mute n">${esc(names[k] ?? '')}</td>`).join('')}</tr></table></div>
<h3>Top issue titles</h3><ol>${top.map((g) => `<li>${esc(g.title)} <span class="small mute">×${g.count} request(s) · ${g.runs.length} run(s)${g.classes.size ? ` · ${esc([...g.classes].join('/'))}` : ''}</span></li>`).join('')}</ol>`;
}

function draftsSection(bundles, outDir) {
  const rows = bundles.flatMap((b) => b.specs.map((s) => ({ b, s })));
  return `<h2 id="drafts">Developer drafts</h2><p class="small"><strong>DRAFT — NOT IMPLEMENTED.</strong> ${rows.length} spec(s); each proposes a cause, an owning area, an approach and a bar. Links open the file from the local folder.</p>
${rows.length ? `<div class="scroll"><table class="cards"><tr><th>id</th><th>title</th><th>run</th></tr>${rows.map(({ b, s }) => { const f = join(b.runDir, s.file); const title = [...b.issues, ...b.frs].find((x) => x.id === s.id)?.title ?? s.title; return `<tr><td data-l="id" class="nw"><a href="${esc0(rel(outDir, f))}">${esc(s.id)}</a></td><td data-l="title">${esc(cut(title, 180))}</td><td data-l="run" class="small mute nw">${esc(b.run.scenario?.name ?? b.name)}</td></tr>`; }).join('')}</table></div>` : '<p class="mute">No drafts.</p>'}`;
}

function runsSection(bundles, runsRoot, outDir) {
  return `<h2 id="runs">Runs</h2><ul>${bundles.map((b) => { const c = fid(b.ledger); const bk = join(runsRoot, 'booklet', `${b.name}.html`); return `<li><strong>${esc(b.run.scenario?.name ?? b.name)}</strong> <span class="small mute">${esc(b.name)} · ${b.run.evidence.length} requests · H ${c.H} P ${c.P} M ${c.M} W ${c.W}</span><br><a href="${esc0(rel(outDir, join(b.runDir, 'REPORT.md')))}">REPORT.md</a> · <a href="${esc0(rel(outDir, bk))}">booklet page</a></li>`; }).join('')}</ul>`;
}

function harnessSection(bundles, night) {
  const noLink = () => null;
  const out = ['<h2 id="harness">Harness notes</h2>'];
  for (const s of night.harness) out.push(`<h3>From the night log: ${esc(s.heading)}</h3>`, md2html(scrub(bullets(s.body)), noLink));
  if (night.last) out.push(`<h3>Night log, last entry: ${esc(night.last.heading)}</h3>`, md2html(scrub(night.last.body), noLink));
  if (!night.exists) out.push('<p class="mute">Night log not found.</p>');
  out.push('<h3>Per run (REPORT.md section 8)</h3>');
  for (const b of bundles) {
    const sec = b.report?.match(/## 8\. Harness notes\s*\n([\s\S]*?)(?=\n## |$)/)?.[1]?.trim();
    out.push(`<p class="small"><strong>${esc(b.run.scenario?.name ?? b.name)}</strong> <span class="mute">${esc(b.name)}</span></p>${sec ? md2html(scrub(sec), noLink).replace(/<ul>/g, '<ul class="small">') : '<p class="small mute">No harness section.</p>'}`);
  }
  return out.join('\n');
}

export function renderSummary(bundles, { runsRoot, outFile, assetsDir, maxShots = 12, night, failedStarts = 0, thumb = null }) {
  const outDir = dirname(outFile);
  const body = [header(bundles, night, failedStarts), scorecardSection(bundles), egregiousSection(bundles, { outFile, assetsDir, maxShots, thumb }), frSection(bundles), issuesSection(bundles), draftsSection(bundles, outDir), runsSection(bundles, runsRoot, outDir), harnessSection(bundles, night)].join('\n');
  const nav = ['basics', 'egregious', 'wanted', 'issues', 'drafts', 'runs', 'harness'].map((x) => `<a href="#${x}">${x}</a>`).join(' · ');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Playtest first night</title><style>${CSS}</style></head><body><main><p class="small">${nav}</p>${body}</main></body></html>\n`;
}

export function buildSummary({ runsRoot = DEFAULT_RUNS_ROOT, outFile = null, assetsDir = null, maxShots = 12, nightLog = DEFAULT_NIGHT_LOG, thumb = sipsThumb } = {}) {
  const root = resolve(runsRoot); const out = resolve(outFile ?? join(root, 'summary', 'index.html')); const assets = resolve(assetsDir ?? join(dirname(out), 'assets'));
  mkdirSync(dirname(out), { recursive: true }); mkdirSync(assets, { recursive: true });
  const dirs = resultRuns(root); const failedStarts = listRuns(root).length - dirs.length;
  const bundles = dirs.map(loadBundle);
  const html = renderSummary(bundles, { runsRoot: root, outFile: out, assetsDir: assets, maxShots, night: readNightLog(nightLog), failedStarts, thumb });
  writeFileSync(out, html);
  return { out, assets, bytes: Buffer.byteLength(html), runs: bundles.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2); const opt = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const r = buildSummary({ runsRoot: opt('--runs-root') ?? DEFAULT_RUNS_ROOT, outFile: opt('--out'), assetsDir: opt('--assets'), maxShots: Number(opt('--max-shots') ?? 12), nightLog: opt('--night-log') ?? DEFAULT_NIGHT_LOG });
  process.stdout.write(JSON.stringify({ ok: true, ...r }) + '\n');
}
