// Morning booklet: one self-contained HTML folder over every run in a runs root (index.html + <run>.html).
// Read-only over run folders; images are referenced in place by paths relative to outDir (nothing is copied).
// node tools/playtest/review/booklet.mjs [--runs-root dir] [--out dir] [--only name,name]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, readJsonl } from '../lib/jsonl.mjs';
import { loadRun, secsBetween } from './run.mjs';
import { bodySummary } from './journal.mjs';
import { computeMetrics, readLedger } from './metrics.mjs';
import { loadSpecs } from './report.mjs';
import { buildStory } from './story.mjs'; // story (worker S)
import { renderStoryHtml } from './story-html.mjs'; // story (worker S)

export const DEFAULT_RUNS_ROOT = '<team>/playtest/runs';
const PHYS = new Set(['inside-solid', 'no-progress', 'stuck-receipt']);

// ---------- small helpers
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtT = (ms) => { if (ms == null || !Number.isFinite(ms)) return '?'; const neg = ms < 0; const s = Math.round(Math.abs(ms) / 1000); return `${neg ? '−' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const num = (v, d = 2) => (v == null ? '—' : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(d)) : esc(v));
const pct = (v) => (typeof v === 'number' ? `${Math.round(v * 100)}%` : '—');
const text = (f) => { try { return readFileSync(f, 'utf8'); } catch { return null; } };
export const chip = (label, cls, title = '') => `<span class="chip ${esc(cls)}"${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</span>`;
const fidChips = (c) => ['H', 'P', 'M', 'W'].filter((k) => c[k]).map((k) => chip(`${k} ${c[k]}`, `f${k}`)).join('') || '<span class="mute">—</span>';
const fidChip = (r) => (r?.fidelity ? chip(`${r.fidelity}${r.class ? ' ' + r.class : ''}`, `f${r.fidelity}`, r.reason ?? '') : chip('unscored', 'fU'));
const oracleChip = (o) => chip(`${o.id}: ${o.status}`, `o-${o.status}`, o.detail ?? '');
const details = (summary, body, open = false) => `<details${open ? ' open' : ''}><summary>${summary}</summary>${body}</details>`;

/** A run-folder path (absolute or relative to the run) as a path relative to outDir, or null when the file is absent. */
function linker(runDir, outDir) {
  return (p) => {
    if (!p) return null;
    const abs = isAbsolute(p) ? p : join(runDir, p.split('#')[0]);
    if (!existsSync(abs)) return null;
    return relative(outDir, abs).split(sep).join('/');
  };
}
const thumb = (href, alt) => (href ? `<a class="tl" href="${esc(href)}"><img class="thumb" loading="lazy" src="${esc(href)}" alt="${esc(alt)}"></a>` : '');

// ---------- minimal markdown → html (headings, bold, italics, code, links, lists, fences, tables, paragraphs)
export function md2html(md, link = (u) => u) {
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, a, u) => { const h = link(u.replace(/&amp;/g, '&')); return h ? thumb(h, a) : `[${a}]`; })
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, a, u) => { const h = /^https?:/.test(u) ? u : link(u.replace(/&amp;/g, '&')); return h ? `<a href="${esc(h)}">${a}</a>` : a; });
  const out = []; const lines = String(md ?? '').split('\n'); let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) { const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; out.push(`<pre class="mono">${esc(buf.join('\n'))}</pre>`); continue; }
    const h = l.match(/^(#{1,6})\s+(.*)$/); if (h) { const n = Math.min(6, h[1].length + 2); out.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue; }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l); const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) { let it = lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''); while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) it += ' ' + lines[i++].trim(); items.push(`<li>${inline(it)}</li>`); }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`); continue;
    }
    if (/^\|.*\|\s*$/.test(l)) {
      const rows = []; while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const body = rows.filter((r) => !/^\|[\s|:-]+\|$/.test(r.trim()));
      out.push(`<div class="scroll"><table>${body.map((r, k) => `<tr>${cells(r).map((c) => (k === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join('')}</tr>`).join('')}</table></div>`); continue;
    }
    if (!l.trim()) { i++; continue; }
    const buf = []; while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*([-*]|\d+\.)\s|\|)/.test(lines[i])) buf.push(lines[i++]);
    if (!buf.length) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return out.join('\n');
}

// ---------- loading
export function listRuns(runsRoot) {
  return (existsSync(runsRoot) ? readdirSync(runsRoot) : [])
    .map((n) => join(runsRoot, n))
    .filter((d) => { try { return statSync(d).isDirectory() && existsSync(join(d, 'scenario.json')); } catch { return false; } })
    .sort((a, b) => basename(b).localeCompare(basename(a)));
}

/** Play start as the personas saw it (first glance minus its elapsedSec); loadRun's anchor otherwise. */
export function playStartMs(run) {
  const xs = Object.values(run.personas).flatMap((p) => p.turns).filter((t) => t.t && t.kind !== 'final' && t.elapsedSec != null).map((t) => Date.parse(t.t) - (t.elapsedSec ?? 0) * 1000).filter(Number.isFinite);
  return xs.length ? Math.min(...xs) : run.anchorMs;
}

export function loadBundle(runDir) {
  const run = loadRun(runDir);
  const ledger = readLedger(join(runDir, 'ledger.tsv'));
  const reviews = readJsonl(join(runDir, 'reviews.jsonl'));
  const oracles = readJsonl(join(runDir, 'oracles.jsonl'));
  let metrics = readJson(join(runDir, 'metrics.json'), null); let metricsLive = false;
  if ((!metrics || !metrics.basics) && run.evidence.length) { try { const live = computeMetrics(run, { ledger, oracles: oracles.length ? oracles : null }); metrics = metrics ? { ...metrics, basics: live.basics } : live; metricsLive = true; } catch { /* keep what is on disk */ } }
  const receipts = (existsSync(join(runDir, 'receipts')) ? readdirSync(join(runDir, 'receipts')) : []).filter((f) => f.endsWith('.json')).sort((a, b) => parseInt(a) - parseInt(b) || a.localeCompare(b)).map((f) => ({ file: f, ...readJson(join(runDir, 'receipts', f), {}) }));
  const verdict = (id) => ledger.find((r) => r.requestId === id) ?? reviews.find((r) => r.requestId === id) ?? null;
  return {
    name: basename(runDir), runDir, run, t0: playStartMs(run), ledger, reviews, oracles, metrics, metricsLive, receipts, verdict,
    issues: readJson(join(runDir, 'issues.json'), []), frs: readJson(join(runDir, 'feature-requests.json'), []),
    emergence: readJson(join(runDir, 'emergence.json'), null), specs: loadSpecs(runDir), report: text(join(runDir, 'REPORT.md')),
  };
}

const seatsOf = (b) => { const s = b.run.scenario ?? {}; return [...(s.seats ?? []).map((x) => ({ ...x, god: false })), ...(s.god ? [{ id: 'god', ...s.god, god: true }] : [])]; };
const playSec = (b) => b.receipts.find((r) => r.step === 'play')?.elapsedSec ?? null;
const counts = (b) => { const c = { H: 0, P: 0, M: 0, W: 0 }; for (const ev of b.run.evidence) { const v = b.verdict(ev.requestId); if (v?.fidelity in c) c[v.fidelity]++; } return c; };
const bodyMoved = (ev) => ev.firstBodyChangeAt && (!ev.cutoffAt || Date.parse(ev.firstBodyChangeAt) <= Date.parse(ev.cutoffAt));
const at = (b, iso) => (iso ? Date.parse(iso) - b.t0 : null);
const firstShot = (ev, L) => (ev.shots ?? []).map(L).find(Boolean) ?? null;

/** Egregious failures for one run: W, physical oracle fails, and requests with neither an ack nor body movement. */
export function egregious(b, L) {
  const out = [];
  for (const ev of b.run.evidence) {
    const why = []; const v = b.verdict(ev.requestId);
    if (v?.fidelity === 'W') why.push(`W${v.class ? ' ' + v.class : ''}`);
    b.oracles.filter((o) => o.requestId === ev.requestId && PHYS.has(o.id) && o.status === 'fail').forEach((o) => why.push(`${o.id} fail`));
    if (!ev.ackAt && !bodyMoved(ev)) why.push('no ack, no body movement');
    if (why.length) out.push({ run: b.name, seat: ev.seat, requestId: ev.requestId, text: ev.text, why, shot: firstShot(ev, L), reason: v?.reason ?? '' });
  }
  return out;
}

// ---------- page shell
const CSS = `
:root{--bg:#fbfaf7;--fg:#1d1d1b;--mute:#6b6a65;--line:#dedbd2;--card:#f2f0ea;--link:#1f5fa8;--H:#1e7a3c;--P:#a86a00;--M:#76746d;--W:#b3261e;--Hb:#e3f3e7;--Pb:#fcefd6;--Mb:#ebeae6;--Wb:#fbe3e1}
@media (prefers-color-scheme:dark){:root{--bg:#161614;--fg:#e8e6e1;--mute:#a19f98;--line:#3a3935;--card:#211f1c;--link:#8ab8f0;--H:#7fd39a;--P:#f0bd5c;--M:#b5b3ac;--W:#ff8a80;--Hb:#183522;--Pb:#3a2c10;--Mb:#2b2a27;--Wb:#3d1916}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
main{max-width:860px;margin:0;padding:24px 16px 64px}main.wide{max-width:1280px}main.wide .box{max-width:860px}
h1{font-size:1.6em;margin:.2em 0 .4em;line-height:1.2;overflow-wrap:anywhere}h2{font-size:1.25em;margin:2em 0 .5em;border-bottom:1px solid var(--line);padding-bottom:.2em}h3{font-size:1.05em;margin:1.4em 0 .3em}h4,h5,h6{font-size:1em;margin:1em 0 .3em}
a{color:var(--link)}p,li{overflow-wrap:anywhere}.mute{color:var(--mute)}.small{font-size:.86em}
code,.mono,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.84em}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:10px;margin:.5em 0;max-height:32em;overflow-y:auto}
.scroll{overflow-x:auto;max-width:100%;margin:.5em 0}table{border-collapse:collapse;font-size:.88em;min-width:100%}th,td{border-bottom:1px solid var(--line);padding:5px 7px;text-align:left;vertical-align:top}th{color:var(--mute);font-weight:600}.nw{white-space:nowrap}
.chip{display:inline-block;border-radius:999px;padding:0 8px;margin:1px 2px 1px 0;font-size:.78em;line-height:1.7;font-weight:600;white-space:nowrap;border:1px solid transparent}
.fH{background:var(--Hb);color:var(--H);border-color:var(--H)}.fP{background:var(--Pb);color:var(--P);border-color:var(--P)}.fM{background:var(--Mb);color:var(--M);border-color:var(--M)}.fW{background:var(--Wb);color:var(--W);border-color:var(--W)}.fU{color:var(--mute);border-color:var(--line)}
.o-pass{color:var(--H);border-color:var(--H)}.o-fail{background:var(--Wb);color:var(--W);border-color:var(--W)}.o-unknown{color:var(--mute);border-color:var(--line)}
.box{border:1px solid var(--line);background:var(--card);border-radius:8px;padding:10px 14px;margin:1em 0}.box.bad{border-color:var(--W)}
.thumb{width:220px;max-width:100%;height:auto;border:1px solid var(--line);border-radius:4px;display:block}a.tl{display:inline-block;margin:4px 6px 4px 0;vertical-align:top}img{max-width:100%}
.ev{border-left:3px solid var(--line);padding:4px 0 4px 12px;margin:14px 0}.ev.req{border-color:var(--link)}.ev.god{border-color:var(--P)}
.t{font-variant-numeric:tabular-nums;color:var(--mute);font-size:.86em;margin-right:6px}.say{font-weight:600}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start}.row>div{flex:1 1 260px;min-width:0}
details{margin:.3em 0}summary{cursor:pointer;color:var(--mute)}.egr li{margin:.5em 0;list-style:none}.egr ul{padding-left:0}
.egr .row{flex-wrap:nowrap;gap:10px}.egr .thumb{width:96px}.egr li{margin:.35em 0}.egr .ph{flex:0 0 96px}
@media (max-width:640px){table.cards,table.cards tbody,table.cards tr,table.cards td{display:block;width:100%}table.cards tr:first-child{display:none}table.cards tr{border:1px solid var(--line);border-radius:8px;margin:0 0 12px;padding:6px 10px}table.cards td{border:0;padding:3px 0}table.cards td::before{content:attr(data-l);display:block;color:var(--mute);font-size:.78em}}
@media print{details{display:block}details>summary{display:none}.thumb{width:160px}main{max-width:none}}
`;
const page = (title, body, wide = false) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body><main${wide ? ' class="wide"' : ''}>${body}</main></body></html>\n`;

// ---------- story (worker S): the run as 10–30 important moments with the director's view; see story.mjs
const storyLinks = (b, L) => `<a href="${esc(b.name)}.html#story">story</a>${L('story.html') ? ` (<a href="${esc(L('story.html'))}">standalone</a>)` : ''}`;
function storySection(b, outDir) {
  if (!b.run.evidence.length && !Object.keys(b.run.personas).length) return '';
  try { return renderStoryHtml(buildStory(b.run), b.run, { relTo: outDir, issueHref: () => '#review' }); } catch (e) { return `<h2 id="story">Story</h2><p class="mute small">The story could not be built: ${esc(e.message)}</p>`; }
}
// ---------- end story

// ---------- index
function scorecard(m) {
  const b = m?.basics; if (!b) return '<span class="mute">no metrics</span>';
  return `walk ${pct(b.walkArrivalRate)} (${b.walksArrived ?? 0}/${b.walksArrivalKnown ?? 0}) · moved ${b.bodyMovedInBudget ?? 0}/${b.requests ?? 0} · ack ${b.ackMedianSec == null ? '—' : num(b.ackMedianSec, 1) + ' s'} · stuck ${b.stuck ?? 0} · wrong ${b.wrong ?? 0} · hits ${b.hits ?? 0}`;
}

export function renderIndex(allBundles, outDir) {
  // Runs that never delivered a request (failed starts, aborted runs) are listed apart so they do not read as results.
  const failedStarts = allBundles.filter((b) => !b.run.evidence.length);
  const bundles = allBundles.filter((b) => b.run.evidence.length);
  const rows = []; const egr = []; const caveats = [];
  for (const b of bundles) {
    const L = linker(b.runDir, outDir); const s = b.run.scenario ?? {}; const c = counts(b);
    egr.push(...egregious(b, L));
    const load = b.run.preflight?.checks?.laptopLoad; const tick = b.run.world?.healthz?.tickMs;
    caveats.push(`<li><a href="${esc(b.name)}.html">${esc(b.name)}</a>: laptop load ${Array.isArray(load) ? esc(load.join(' / ')) : '<span class="mute">not recorded</span>'} · world tick ${tick ? `${num(tick.avg, 1)} ms avg, ${num(tick.max, 0)} ms max (n ${tick.n})` : '<span class="mute">not recorded</span>'}</li>`);
    const seats = seatsOf(b).map((x) => `<div>${esc(x.id)}${x.god ? ' (god)' : ''}: ${esc(x.adapter)} ${esc(x.model ?? 'default')}${x.effort ? '/' + esc(x.effort) : ''}, ${esc(x.persona)}</div>`).join('');
    const story = b.emergence?.narrative?.storyRating ?? b.metrics?.emergence?.storyRating;
    const status = !b.run.evidence.length ? 'no requests' : !b.metrics ? 'not reviewed' : !existsSync(join(b.runDir, 'metrics.json')) ? 'in progress' : b.metricsLive ? 'basics computed live' : '';
    rows.push(`<tr><td data-l="scenario"><a href="${esc(b.name)}.html">${esc(s.name ?? b.name)}</a><div class="small mute">${esc(b.name)}${status ? ` · ${status}` : ''} · ${storyLinks(b, L)}</div></td><td data-l="world">${esc(s.world?.slug ?? b.run.world?.slug ?? '')}<div class="small mute">${esc((s.world?.genesis ?? '').split('/').pop())}</div></td><td data-l="seats" class="small">${seats}</td><td data-l="duration">${playSec(b) != null ? `${Math.round(playSec(b))} s` : '—'}<div class="small mute">plan ${esc(s.durationSec ?? '?')} s</div></td><td data-l="basics" class="small">${scorecard(b.metrics)}</td><td data-l="fidelity">${fidChips(c)}</td><td data-l="story">${story ?? '—'}</td><td data-l="issues / FRs">${b.issues.length} / ${b.frs.length}</td></tr>`);
  }
  const egrHtml = egr.length ? `<ul>${egr.map((e) => `<li><div class="row"><div class="ph">${e.shot ? thumb(e.shot, e.requestId) : ''}</div><div title="${esc(e.reason)}">${e.why.map((w) => chip(w, 'fW')).join('')} <span class="mono">"${esc(e.text)}"</span><div class="small mute"><a href="${esc(e.run)}.html#${esc(e.requestId)}">${esc(e.run)}</a> · ${esc(e.seat)} · ${esc(e.requestId)}</div></div></div></li>`).join('')}</ul>` : '<p class="mute">None.</p>';
  const body = `<h1>Playtest booklet</h1><p class="mute small">${bundles.length} run(s) with results, newest first. Built ${esc(new Date().toISOString().slice(0, 16).replace('T', ' '))} UTC.</p>
<section class="box bad egr"><h2 style="margin-top:0">Egregious failures</h2><p class="small mute">Every W, every inside-solid / stuck / no-progress oracle fail, and every request with no ack and no body movement.</p>${egrHtml}</section>
<section class="box"><h3 style="margin-top:0">Harness caveats</h3><p class="small">Speed numbers (ack, first body change, walk) were measured with the playtest harness, the seats and the world all on one laptop: they are under load and read slower than an unloaded server would be. Load averages are 1 / 5 / 15 min from pre-flight; tick is the world's own tick time at provision.</p><ul class="small">${caveats.join('')}</ul></section>
<h2>Runs</h2><div class="scroll"><table class="cards"><tr><th>scenario</th><th>world</th><th>seats</th><th>duration</th><th>basics</th><th>fidelity</th><th>story</th><th>issues / FRs</th></tr>${rows.join('')}</table></div>`;
  const failedHtml = failedStarts.length ? `<details class="small"><summary>${failedStarts.length} failed or aborted start(s), kept for the record</summary><ul>${failedStarts.map((b) => { const ab = existsSync(join(b.runDir, 'ABORTED.json')); const f = existsSync(join(b.runDir, 'receipts/9-failure.json')); return `<li><a href="${esc(b.name)}.html">${esc(b.name)}</a> · ${ab ? 'aborted' : f ? 'failed start' : 'no requests'}</li>`; }).join('')}</ul></details>` : '';
  return page('Playtest booklet', body + failedHtml, true);
}

// ---------- run page
const axisOf = (sheet) => sheet?.match(/you are at\s+\*\*([\d.]+)\*\*/i)?.[1] ?? null;
const personaTitle = (sheet) => sheet?.match(/^#\s+(.+)$/m)?.[1] ?? null;
function onboardPrompt(chat) { const lines = String(chat ?? '').split('\n'); const i = lines.findIndex((l) => l.startsWith('> ')); if (i < 0) return null; const out = []; for (let k = i; k < lines.length && lines[k].startsWith('>'); k++) out.push(lines[k].replace(/^>\s?/, '')); return out.join('\n'); }
function shownText(t, shownJson) {
  if (t.prompt) { const p = t.prompt; const a = p.indexOf('[Glance at'); const z = p.lastIndexOf('Answer with the JSON'); return p.slice(a >= 0 ? a : 0, z > a ? z : undefined).trim(); }
  const c = shownJson?.legible?.card; if (!c) return null;
  return Object.entries(c).filter(([, v]) => v != null && v !== '' && typeof v !== 'object').map(([k, v]) => `${k}: ${v}`).join('\n');
}

function setupSection(b, L) {
  const { run } = b; const s = run.scenario ?? {}; const tick = run.world?.healthz?.tickMs; const pf = run.preflight;
  const out = [`<h2 id="setup">Setup</h2><div class="scroll"><table>
<tr><th>scenario</th><td>${esc(s.name)} <span class="mute small">v${esc(s.version ?? '?')} · seed ${esc(s.seed ?? '—')} · director ${esc(s.director?.mode ?? '?')} · ${esc(s.durationSec ?? '?')} s planned${playSec(b) != null ? `, ${Math.round(playSec(b))} s played` : ''}</span></td></tr>
<tr><th>world</th><td>${esc(run.world?.kind ?? s.world?.kind ?? '')} <code>${esc(s.world?.slug ?? run.world?.slug ?? '')}</code> · genesis <code>${esc(s.world?.genesis ?? '—')}</code> · build <code>${esc(run.world?.build ?? '?')}</code> · tick ${tick ? `${num(tick.avg, 1)} ms avg / ${num(tick.max, 0)} max` : '—'}${run.world?.bootMs ? ` · boot ${Math.round(run.world.bootMs / 1000)} s` : ''}</td></tr>
<tr><th>pre-flight</th><td>${pf ? `laptop load ${Array.isArray(pf.checks?.laptopLoad) ? esc(pf.checks.laptopLoad.join(' / ')) : '<span class="mute">not recorded</span>'} · quota ${esc(pf.allow?.note ?? '—')}` : '<span class="mute">none</span>'}</td></tr>
</table></div>`];
  for (const x of seatsOf(b)) {
    const st = run.seats[x.id] ?? {}; const seat = st.seat ?? {}; const sheet = run.personas[x.id]?.sheet;
    const ob = seat.onboard ?? {}; const onboardTurn = (st.turns ?? []).find((t) => t.reason === 'onboard') ?? (st.turns ?? [])[0];
    out.push(`<h3>${esc(x.id)}${x.god ? ' (god)' : ''}${seat.soulName ? ` — Soul ${esc(seat.soulName)}` : ''}</h3>
<p class="small">${esc(x.adapter)} · model ${esc(x.model ?? 'default')}${x.effort ? ' / ' + esc(x.effort) : ''} · persona <strong>${esc(x.persona)}</strong>${personaTitle(sheet) ? ` (${esc(personaTitle(sheet))})` : ''}${axisOf(sheet) ? ` · watcher→breaker axis ${esc(axisOf(sheet))}` : ''} · persona model ${esc(x.personaModel ?? 'opus')} · onboarding ${ob.pairedWithinSec != null ? `paired in ${esc(ob.pairedWithinSec)} s` : '—'}${ob.onboardTurnWallMs ? `, turn ${Math.round(ob.onboardTurnWallMs / 1000)} s` : ''}${ob.ok === false ? ' ' + chip('onboard failed', 'fW') : ''}</p>
${onboardPrompt(st.chat) ? `<div class="small mute">Onboarding prompt the seat received:</div><pre class="mono">${esc(onboardPrompt(st.chat))}</pre>` : ''}
${onboardTurn?.finalText ? details('Final onboarding message', `<pre class="mono">${esc(onboardTurn.finalText)}</pre>`) : ''}
${sheet ? details('Persona sheet', `<pre class="mono">${esc(sheet)}</pre>`) : ''}
${x.god && st.chat ? details('God chat (as rendered)', `<pre class="mono">${esc(st.chat)}</pre>`) : ''}`);
  }
  return out.join('\n');
}

function outcomeHtml(b, ev, L) {
  const v = b.verdict(ev.requestId); const rank = { fail: 0, pass: 1, unknown: 2 }; const ors = b.oracles.filter((o) => o.requestId === ev.requestId).sort((a, z) => (rank[a.status] ?? 3) - (rank[z.status] ?? 3));
  const last = [...(ev.samples ?? [])].filter((x) => !ev.cutoffAt || Date.parse(x.t) <= Date.parse(ev.cutoffAt)).at(-1);
  const shots = (ev.shots ?? []).map(L).filter(Boolean); const pick = shots.length <= 3 ? shots : [shots[0], shots[Math.floor(shots.length / 2)], shots.at(-1)];
  return `<div class="ev req" id="${esc(ev.requestId)}"><span class="t">${fmtT(at(b, ev.cutoffAt) ?? at(b, ev.sentAt))}</span><strong>${esc(ev.requestId)} closed</strong> <span class="mute small">(${esc(ev.cutoffReason ?? '?')}, sent ${fmtT(at(b, ev.sentAt))} by ${esc(ev.seat)} on ${esc(ev.channel)})</span> ${fidChip(v)}
<div class="mono">"${esc(ev.text)}"</div>
<ul class="small"><li>card ack: ${ev.ackText ? `<span class="mono">"${esc(ev.ackText)}"</span> after ${secsBetween(ev.sentAt, ev.ackAt)} s` : '<span class="mute">none</span>'}</li>
<li>${ev.channel === 'chat' ? 'chat reply' : 'card result'}: ${ev.resultText ? `<span class="mono">"${esc(ev.resultText)}"</span> after ${secsBetween(ev.sentAt, ev.resultAt)} s` : '<span class="mute">none</span>'}</li>
<li>body: ${esc(bodySummary(ev))}${last ? ` · at cutoff: ${esc(last.place ?? '?')}, ${esc(last.posture ?? '?')}, ${esc(last.activity ?? last.doing ?? '?')}` : ''}${ev.firstBodyChangeAt ? ` · first change after ${secsBetween(ev.sentAt, ev.firstBodyChangeAt)} s` : ''}</li></ul>
<div>${ors.map(oracleChip).join('') || '<span class="small mute">no oracle results</span>'}</div>
${v ? `<p class="small"><strong>Reviewer:</strong> ${esc(v.reason ?? '')}${v.vetoed ? ` <em>(${esc(v.vetoed)})</em>` : ''}</p>` : ''}
<div>${pick.map((h) => thumb(h, ev.requestId)).join('')}</div></div>`;
}

function timeline(b, L) {
  const { run } = b; const items = [];
  for (const [seat, p] of Object.entries(run.personas)) {
    for (const t of p.turns) {
      const tAt = at(b, t.t) ?? 0; const d = t.decision ?? {};
      const n = t.n ?? t.turn; const shownJson = readJson(t.shownFile ?? join(run.runDir, 'personas', seat, t.shown ?? `shown/${n}.json`), null);
      const png = L(t.png ?? shownJson?.screenshotPath ?? `personas/${seat}/shown/${n}.png`) ?? L(`personas/${seat}/shown/${n}.png`);
      const ev = d.say ? run.evidence.find((e) => e.seat === seat && e.text === d.say.text && Math.abs(at(b, e.sentAt) - tAt) < 120000) ?? run.evidence.find((e) => e.requestId === t.requestId) : null;
      const st = shownText(t, shownJson);
      if (t.kind === 'final') { items.push({ at: tAt, html: `<div class="ev"><span class="t">${fmtT(tAt)}</span><strong>${esc(seat)} final rating</strong>${d.rating ? ` fun ${d.rating.fun}/5, alive ${d.rating.alive}/5` : ''}</div>` }); continue; }
      items.push({ at: tAt, html: `<div class="ev"><span class="t">${fmtT(tAt)}</span><strong>${esc(seat)}</strong> glance ${esc(n)}${d.rating ? ` · fun ${d.rating.fun}/5, alive ${d.rating.alive}/5` : ''}
<div class="row">${png ? `<div style="flex:0 0 auto">${thumb(png, `${seat} glance ${n}`)}</div>` : ''}<div>
${d.thought ? `<p><em>"${esc(d.thought)}"</em></p>` : ''}
${d.say ? `<p>→ <span class="say mono">"${esc(d.say.text)}"</span> <span class="small mute">on ${esc(d.say.channel)}</span>${ev ? ` <a class="small" href="#${esc(ev.requestId)}">${esc(ev.requestId)}</a>` : ''}</p>` : '<p class="small mute">kept watching</p>'}
${(d.complaints ?? []).map((c) => `<div class="small">complaint: "${esc(c)}"</div>`).join('')}${(d.desires ?? []).map((c) => `<div class="small">wished: "${esc(c)}"</div>`).join('')}
${st ? details('What it was shown as text', `<pre class="mono">${esc(st)}</pre>`) : ''}</div></div></div>` });
    }
  }
  for (const ev of run.evidence) items.push({ at: (at(b, ev.cutoffAt) ?? at(b, ev.sentAt)) + 0.5, html: outcomeHtml(b, ev, L) });
  const god = run.seats.god;
  if (god) for (const t of god.turns) items.push({ at: at(b, t.endedAt ?? t.startedAt) ?? 0, html: `<div class="ev god"><span class="t">${fmtT(at(b, t.endedAt ?? t.startedAt))}</span><strong>god turn ${esc(t.turn)}</strong> <span class="small mute">${esc(t.reason ?? '')} · ${(t.toolCalls ?? []).length} tool call(s)</span>${t.finalText ? `<pre class="mono">${esc(t.finalText)}</pre>` : ''}${(t.toolCalls ?? []).length ? details('commands', `<pre class="mono">${esc(t.toolCalls.map((c) => c.cmd).join('\n'))}</pre>`) : ''}</div>` });
  items.sort((a, z) => a.at - z.at);
  return `<h2 id="play">Play</h2><p class="small mute">Times are since play start (the persona's first glance). Each glance shows the screenshot the persona was shown; request outcomes appear when the request closed.</p>${items.map((i) => i.html).join('\n') || '<p class="mute">No glances or requests recorded.</p>'}`;
}

function reviewSection(b, L) {
  const { run } = b; const out = ['<h2 id="review">Review</h2><h3>Ledger</h3>'];
  const rows = run.evidence.map((ev) => { const v = b.verdict(ev.requestId); return `<tr><td class="nw"><a href="#${esc(ev.requestId)}">${esc(ev.requestId)}</a></td><td>${esc(ev.seat)}</td><td>${esc(ev.channel)}</td><td class="mono">${esc(ev.text)}</td><td>${fidChip(v)}</td><td>${v ? (String(v.noticedByPlayer) === 'true' ? 'yes' : 'no') : ''}</td><td class="small">${esc(v?.vetoed ?? '')}</td></tr>`; });
  out.push(rows.length ? `<div class="scroll"><table><tr><th>request</th><th>seat</th><th>ch</th><th>asked</th><th>score</th><th>noticed</th><th>note</th></tr>${rows.join('')}</table></div>` : '<p class="mute">No requests.</p>');
  out.push('<h3>Issues</h3>', b.issues.length ? b.issues.map((i) => `<div class="box"><strong>${esc(i.id)}: ${esc(i.title)}</strong> ${fidChip(i)} <span class="small mute">${esc((i.requestIds ?? []).join(', '))}</span>
<p class="small"><strong>Asked</strong> <span class="mono">"${esc(i.asked)}"</span></p><p class="small"><strong>Happened</strong> ${esc(i.happened)}</p><p class="small"><strong>Expected</strong> ${esc(i.expected)}</p><p class="small mute">${esc(i.whereWhen)} · ${esc(i.frequency)}</p>
${(i.evidence ?? []).length ? details('evidence', `<ul class="small">${i.evidence.map((e) => { const h = /^[\w./-]+\.(png|json|jsonl|md|tsv)(#.*)?$/.test(e) ? L(e) : null; return `<li>${h ? `<a href="${esc(h)}">${esc(e)}</a>` : esc(e)}</li>`; }).join('')}</ul>`) : ''}</div>`).join('') : '<p class="mute">None raised.</p>');
  out.push('<h3>Feature requests</h3>', b.frs.length ? `<ul>${b.frs.map((f) => `<li><strong>${esc(f.title)}</strong> ×${(f.count ?? 0) + (f.desireCount ?? 0)} <span class="small mute">(${esc((f.personas ?? []).join(', '))})</span>${(f.wordings ?? []).length > 1 || (f.wordings?.[0] && f.wordings[0] !== f.title) ? `<ul class="small">${f.wordings.map((w) => `<li>"${esc(w)}"</li>`).join('')}</ul>` : ''}</li>`).join('')}</ul>` : '<p class="mute">None.</p>');
  const em = b.metrics?.emergence;
  out.push('<h3>Emergence and story</h3>', em ? `<div class="scroll"><table><tr><th>story</th><th>O5</th><th>co-location</th><th>conversations</th><th>shared</th><th>imitation</th><th>entropy</th><th>chains</th></tr><tr><td>${num(em.storyRating)}</td><td>${num(em.o5Count)}</td><td>${em.coLocationRatio == null ? '— (one Soul)' : num(em.coLocationRatio) + '×'}</td><td>${num(em.conversations)}</td><td>${num(em.unpromptedShared)}</td><td>${num(em.imitation)}</td><td>${num(em.meanActivityEntropyBits)}</td><td>${num(em.chainsGe2)}</td></tr></table></div>` : '<p class="mute">No emergence metrics.</p>');
  if (b.emergence?.narrative?.strangerReading) out.push(`<p>${esc(b.emergence.narrative.strangerReading)}</p>`);
  for (const [seat, p] of Object.entries(run.personas)) { const f = p.ratings?.final ?? null; if (f?.fun != null) out.push(`<p class="small"><strong>${esc(seat)} at the end:</strong> fun ${f.fun}/5, alive ${f.alive}/5${f.words ? ` — "${esc(f.words)}"` : ''}</p>`); }
  return out.join('\n');
}

function draftsSection(b, L) {
  const out = ['<h2 id="drafts">Developer drafts</h2><p class="small"><strong>DRAFT — NOT IMPLEMENTED.</strong> Each spec proposes a cause, an owning area, an approach and a bar; none was applied.</p>'];
  if (!b.specs.length) out.push('<p class="mute">No drafts in this run.</p>');
  const link = (u) => L(u) ?? (/^https?:/.test(u) ? u : null);
  for (const s of b.specs) { const md = text(join(b.runDir, s.file)); const title = [...b.issues, ...b.frs].find((x) => x.id === s.id)?.title ?? s.title; out.push(details(`<strong>${esc(s.id)}</strong>: ${esc(title)} <span class="small">(${esc(s.kind)})</span>`, md ? `<div class="box">${md2html(md, link)}</div>` : '<p class="mute">file missing</p>')); }
  return out.join('\n');
}

function harnessSection(b, L) {
  const out = ['<h2 id="harness">Harness notes</h2>'];
  const sec = b.report?.match(/## 8\. Harness notes\s*\n([\s\S]*)$/)?.[1];
  out.push(sec ? md2html(sec, L) : '<p class="mute">No REPORT.md harness section.</p>');
  const bad = b.receipts.filter((r) => r.ok === false || r.error);
  const cams = bad.filter((r) => /camera/i.test(r.error ?? ''));
  out.push('<h3>Receipts</h3>', `<p class="small">${b.receipts.map((r) => chip(`${r.file.replace(/\.json$/, '')}${r.ok === false ? ' fail' : ''}`, r.ok === false ? 'o-fail' : 'o-pass')).join('')}</p>`);
  bad.forEach((r) => out.push(`<p class="small"><strong>${esc(r.file)}</strong>${cams.includes(r) ? ' (camera failure)' : ''}:</p><pre class="mono">${esc(String(r.error ?? JSON.stringify(r)).split('\n').slice(0, 4).join('\n'))}</pre>`));
  if (b.metricsLive) out.push(`<p class="small mute">${existsSync(join(b.runDir, 'metrics.json')) ? 'metrics.json predates the basics scorecard; basics' : 'metrics.json is not written yet; the numbers on this page'} were computed from the evidence on disk at build time.</p>`);
  return out.join('\n');
}

export function renderRunPage(b, outDir) {
  const L = linker(b.runDir, outDir); const s = b.run.scenario ?? {};
  const raw = ['REPORT.md', 'journal.md', 'metrics.json', 'replay.json', 'issues.md', 'feature-requests.md', 'ledger.tsv'].map((f) => [f, L(f)]).filter(([, h]) => h);
  const body = `<p class="small"><a href="index.html">← booklet</a></p><h1>${esc(s.name ?? b.name)}</h1><p class="mute small">${esc(b.name)}</p>
<div class="box small"><strong>Basics:</strong> ${scorecard(b.metrics)} · ${fidChips(counts(b))}</div>
<p class="small">${['setup', 'story', 'play', 'review', 'drafts', 'harness', 'raw'].map((x) => `<a href="#${x}">${x}</a>`).join(' · ')}</p>
${setupSection(b, L)}
${storySection(b, outDir)}
${timeline(b, L)}
${reviewSection(b, L)}
${draftsSection(b, L)}
${harnessSection(b, L)}
<h2 id="raw">Raw</h2><p>${raw.map(([f, h]) => `<a href="${esc(h)}">${esc(f)}</a>`).join(' · ') || '<span class="mute">none yet</span>'}</p>`;
  return page(`${s.name ?? b.name} — playtest`, body, seatsOf(b).length > 1); // wide for the story's seat columns (worker S)
}

export function buildBooklet({ runsRoot = DEFAULT_RUNS_ROOT, outDir = null, runs = null, only = null } = {}) {
  const root = resolve(runsRoot); const out = resolve(outDir ?? join(root, 'booklet'));
  let dirs = runs?.length ? runs.map((d) => resolve(d)) : listRuns(root);
  if (only?.length) dirs = dirs.filter((d) => only.some((n) => basename(d) === n || basename(d).includes(n)));
  dirs.sort((a, b) => basename(b).localeCompare(basename(a)));
  mkdirSync(out, { recursive: true });
  const bundles = dirs.map(loadBundle); const pages = [];
  for (const b of bundles) { const f = join(out, `${b.name}.html`); writeFileSync(f, renderRunPage(b, out)); pages.push(f); }
  const index = join(out, 'index.html'); writeFileSync(index, renderIndex(bundles, out));
  return { index, pages, outDir: out };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2); const opt = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const r = buildBooklet({ runsRoot: opt('--runs-root') ?? DEFAULT_RUNS_ROOT, outDir: opt('--out'), only: opt('--only')?.split(',').filter(Boolean) ?? null });
  process.stdout.write(JSON.stringify({ ok: true, index: r.index, pages: r.pages.length }) + '\n');
}
