// Story rendering: the HTML fragment (booklet run pages), the standalone story.html with inlined 640 px JPEG
// thumbnails (publishable on its own), and the plain-text lines REPORT.md lists. Data comes from buildStory.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { writeJson } from '../lib/jsonl.mjs';
import { buildStory, fmtClock } from './story.mjs';
import { loadRun } from './run.mjs';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const LABEL = { say: 'asks', ack: 'ack', result: 'result', reply: 'reply', body: 'moves', move: 'moves', receipt: 'done', 'receipt-fail': 'refused', presence: 'agent', close: 'verdict', pink: 'wish', rating: 'rates', glance: 'watch', final: 'final', gap: 'quiet' };
const label = (m) => (m.verdict?.fidelity === 'W' ? 'W' : LABEL[m.kind] ?? m.kind);
const seatName = (run, seat) => run?.seats?.[seat]?.seat?.soulName ?? (run?.scenario?.seats ?? []).find((x) => x.id === seat)?.soulName ?? seat;

const CSS = `
.st{--st-bg:#fbfaf7;--st-fg:#1d1d1b;--st-mute:#6b6a65;--st-line:#dedbd2;--st-card:#f4f2ec;--st-say:#e8f0fb;--st-rep:#eef4ea;--st-s1:#4f7fc4;--st-s2:#c98a12;--st-s3:#c0392b;--st-H:#1e7a3c;--st-P:#a86a00;--st-M:#6f6d66;--st-W:#b3261e;--st-link:#1f5fa8;color:var(--st-fg)}
@media (prefers-color-scheme:dark){.st{--st-bg:#161614;--st-fg:#e8e6e1;--st-mute:#a19f98;--st-line:#3a3935;--st-card:#211f1c;--st-say:#1c2a3d;--st-rep:#1d2a1d;--st-s1:#7aa5e6;--st-s2:#f0bd5c;--st-s3:#ff8a80;--st-H:#7fd39a;--st-P:#f0bd5c;--st-M:#b5b3ac;--st-W:#ff8a80;--st-link:#8ab8f0}}
:root[data-theme="light"] .st{--st-bg:#fbfaf7;--st-fg:#1d1d1b;--st-mute:#6b6a65;--st-line:#dedbd2;--st-card:#f4f2ec;--st-say:#e8f0fb;--st-rep:#eef4ea}
.st *{box-sizing:border-box}.st a{color:var(--st-link)}
.st-sub{color:var(--st-mute);font-size:.86em;margin:.2em 0 .8em}
.st-film{display:flex;gap:6px;overflow-x:auto;padding:4px 0 10px;margin:0 0 6px;scrollbar-width:thin}
.st-film a{flex:0 0 auto;width:108px;text-decoration:none;color:var(--st-fg);font-size:.72em;line-height:1.25;border-top:3px solid var(--st-line);padding-top:3px}
.st-film a.s1{border-color:var(--st-s1)}.st-film a.s2{border-color:var(--st-s2)}.st-film a.s3{border-color:var(--st-s3)}.st-film a.gap{opacity:.55}
.st-film img{width:108px;height:61px;object-fit:cover;display:block;border-radius:3px;background:var(--st-card)}
.st-film .ph{width:108px;height:61px;border-radius:3px;background:var(--st-card)}
.st-film b{font-variant-numeric:tabular-nums}.st-film span{color:var(--st-mute)}
.st-seatlab{font-size:.78em;color:var(--st-mute);margin:6px 0 2px;font-weight:600}
.st-tl{display:grid;grid-template-columns:52px repeat(var(--cols),minmax(0,1fr));column-gap:14px;row-gap:12px;align-items:start}
.st-colh{font-weight:600;font-size:.86em;color:var(--st-mute);border-bottom:1px solid var(--st-line);padding-bottom:4px}
.st-time{font-variant-numeric:tabular-nums;color:var(--st-mute);font-size:.82em;text-align:right;padding-top:8px;border-right:2px solid var(--st-line);padding-right:8px;align-self:stretch}
.st-m{background:var(--st-card);border:1px solid var(--st-line);border-left:5px solid var(--st-line);border-radius:6px;padding:8px 10px;min-width:0;font-size:.92em;line-height:1.42}
.st-m.s1{border-left-color:var(--st-s1)}.st-m.s2{border-left-color:var(--st-s2)}.st-m.s3{border-left-color:var(--st-s3)}
.st-m.gap{background:transparent;border-style:dashed;color:var(--st-mute);font-size:.86em}.st-m.gap .st-shot img{max-width:240px}
.st-m header{display:flex;gap:6px;flex-wrap:wrap;align-items:baseline;margin-bottom:4px}
.st-m header .t{font-variant-numeric:tabular-nums;font-weight:700}.st-m header .who{color:var(--st-mute);font-size:.86em}.st-m header .ti{font-weight:600;overflow-wrap:anywhere}
.st-row1 .st-in{display:flex;gap:12px;align-items:flex-start}.st-row1 .st-shotw{flex:0 0 46%;max-width:420px}.st-row1 .st-txt{flex:1 1 auto;min-width:0}
.st-shot{display:block}.st-shot img{width:100%;height:auto;display:block;border-radius:4px;border:1px solid var(--st-line)}
.st-cap{font-size:.74em;color:var(--st-mute);margin-top:2px}
.st-say,.st-rep{margin:4px 0;padding:6px 10px;border-radius:12px;overflow-wrap:anywhere;white-space:pre-wrap}
.st-say{background:var(--st-say);border-top-left-radius:3px;font-weight:600}.st-rep{background:var(--st-rep);border-top-right-radius:3px;margin-left:14px;max-height:14em;overflow-y:auto}
.st-say small,.st-rep small{display:block;font-weight:400;color:var(--st-mute);font-size:.78em}
.st-th{font-style:italic;color:var(--st-mute);margin:4px 0;overflow-wrap:anywhere}.st-tx{margin:3px 0;overflow-wrap:anywhere}
.st-did{list-style:none;padding:0;margin:4px 0;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--st-mute)}
.st-did li{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.st-did li::before{content:"⏺ ";opacity:.6}.st-m details summary{cursor:pointer;color:var(--st-mute);font-size:.8em}
.st-ln{font-size:.82em;margin:2px 0;color:var(--st-mute);overflow-wrap:anywhere}.st-ln b{color:var(--st-fg);font-weight:600}
.st-v{margin-top:6px;padding-top:5px;border-top:1px solid var(--st-line);font-size:.88em;overflow-wrap:anywhere}
.st-chip{display:inline-block;border-radius:999px;padding:0 8px;font-size:.8em;font-weight:700;border:1px solid currentColor;margin-right:4px}
.st-chip.fH{color:var(--st-H)}.st-chip.fP{color:var(--st-P)}.st-chip.fM{color:var(--st-M)}.st-chip.fW{color:var(--st-W)}.st-chip.fU{color:var(--st-mute)}
.st-of{display:block;color:var(--st-mute);font-size:.86em}
.st-lb{position:fixed;inset:0;background:rgba(0,0,0,.86);display:flex;align-items:center;justify-content:center;z-index:50;cursor:zoom-out;padding:16px}.st-lb[hidden]{display:none}.st-lb img{max-width:100%;max-height:100%}
@media (max-width:760px){.st-tl{display:block}.st-time,.st-colh{display:none}.st-m{margin:0 0 10px}.st-row1 .st-in{display:block}.st-row1 .st-shotw{max-width:none}}
`;

function srcFor(run, relTo, inline) {
  const out = (rel) => (!rel ? null : inline?.[rel] ?? (relTo ? relative(relTo, join(run.runDir, rel)).split(sep).join('/') : rel));
  return { thumb: out, full: (rel) => (!rel ? null : inline?.[rel] ?? out(rel)) };
}

function momentHtml(m, i, ctx) {
  const { run, img, single, issueHref } = ctx;
  const p = m.persona ?? {}; const parts = [];
  const shot = img.thumb(m.shot);
  const shotHtml = shot ? `<div class="st-shotw"><a class="st-shot" href="${ctx.keyOf(m.shot) != null ? '#' : esc(img.full(m.shot))}"${ctx.keyOf(m.shot) != null ? '' : ` data-full="${esc(img.full(m.shot))}"`}><img loading="lazy"${ctx.keyOf(m.shot) != null ? ` data-k="${ctx.keyOf(m.shot)}"` : ''} src="${esc(shot)}" alt="${esc(`${m.seat} at ${fmtClock(m.shotT)}`)}"></a><div class="st-cap">${m.shotSource === 'camera' ? 'camera' : "director's view"} at ${fmtClock(m.shotT)}</div></div>` : '';
  if (p.said) parts.push(`<div class="st-say"><small>${esc(m.seat)} on the ${esc(p.channel ?? 'card')}</small>${esc(p.said)}</div>`);
  if (p.thought || p.rating) parts.push(`<p class="st-th">${p.thought ? `“${esc(p.thought)}”` : ''}${p.rating ? ` <span class="st-ln">fun ${esc(p.rating.fun)}/5 · alive ${esc(p.rating.alive)}/5${p.rating.feltLikeGod != null ? ` · god ${esc(p.rating.feltLikeGod)}/5` : ''}</span>` : ''}</p>`);
  if (m.text) parts.push(`<p class="st-tx">${esc(m.text)}</p>`);
  const did = m.agent?.did ?? [];
  if (did.length) parts.push(`<ul class="st-did">${did.slice(0, 6).map((d) => `<li title="${esc(d)}">${esc(d)}</li>`).join('')}</ul>${did.length > 6 ? `<details><summary>${did.length - 6} more agent commands</summary><ul class="st-did">${did.slice(6).map((d) => `<li title="${esc(d)}">${esc(d)}</li>`).join('')}</ul></details>` : ''}`);
  if (m.agent?.said) parts.push(`<div class="st-rep"><small>${esc(seatName(run, m.seat))}'s agent</small>${esc(m.agent.said)}</div>`);
  if (m.card && m.kind !== 'gap') parts.push(`<p class="st-ln"><b>card</b> ${esc(m.card.state ?? '—')}${m.card.ack ? ` · ack “${esc(m.card.ack)}”` : ''}${m.card.result ? ` · result “${esc(m.card.result)}”` : ''}${m.card.presence ? ` · agent ${esc(m.card.presence)}` : ''}</p>`);
  if (m.body) parts.push(`<p class="st-ln"><b>body</b> ${esc([m.body.posture, m.body.place && `in ${m.body.place}`, m.body.activity].filter(Boolean).join(' · ') || '—')}${m.body.changed ? ' · <b>changed</b>' : ''}</p>`);
  for (const v of m.verdicts ?? (m.verdict ? [m.verdict] : [])) {
    const f = v.fidelity ?? 'U';
    parts.push(`<div class="st-v"><span class="st-chip f${esc(f)}">${esc(v.fidelity ?? 'unscored')}${v.class ? ' ' + esc(v.class) : ''}</span><span class="st-ln">${esc(v.requestId)} “${esc(v.asked ?? '')}”</span> ${esc(v.reason ?? '')}${v.issueId ? ` <a href="${esc(issueHref(v.issueId))}">${esc(v.issueId)}: ${esc(v.issueTitle ?? '')}</a>` : ''}${v.oracleFails?.length ? `<span class="st-of">oracle fails: ${v.oracleFails.map((o) => `<span title="${esc(o.detail)}">${esc(o.id)}</span>`).join(', ')}</span>` : ''}</div>`);
  }
  const cls = `st-m s${m.severity ?? 0}${m.kind === 'gap' ? ' gap' : ''}`;
  return `<article class="${cls}" id="${esc(ctx.idOf(m, i))}"><header><span class="t">${fmtClock(m.t)}</span>${single ? '' : `<span class="who">${esc(m.seat)}</span>`}<span class="ti">${esc(m.title)}</span></header><div class="st-in">${shotHtml}<div class="st-txt">${parts.join('')}</div></div></article>`;
}

/** HTML fragment: filmstrip + time-aligned timeline (one column per seat). relTo: dir the page lives in (image links
 *  become relative to it); inline: {relPath: dataUri} for a standalone page. */
export function renderStoryHtml(story, run, { relTo = null, inline = null, heading = true, issueHref = () => 'issues.md' } = {}) {
  const seats = Object.keys(story.seats).filter((s) => story.seats[s].moments.length);
  const single = seats.length <= 1; const img = srcFor(run, relTo, inline);
  const index = new Map(); seats.forEach((s) => story.seats[s].moments.forEach((m, i) => index.set(m, i)));
  const idOf = (m) => `m-${m.seat}-${index.get(m)}`;
  const ctx = { run, img, single, issueHref, idOf, keyOf: (rel) => (inline ? keyOf(rel) : null) };
  // Inlined pages carry each picture once (in its card); the filmstrip borrows it by key at load time.
  const keys = new Map(); const keyOf = (rel) => { if (!keys.has(rel)) keys.set(rel, keys.size); return keys.get(rel); };
  const film = seats.map((s) => `${single ? '' : `<div class="st-seatlab">${esc(s)}</div>`}<div class="st-film">${story.seats[s].moments.map((m) => { const t = img.thumb(m.shot); return `<a class="s${m.severity}${m.kind === 'gap' ? ' gap' : ''}" href="#${esc(idOf(m))}" title="${esc(m.title)}">${t ? (inline ? `<img alt="" data-k="${keyOf(m.shot)}">` : `<img loading="lazy" src="${esc(t)}" alt="">`) : '<div class="ph"></div>'}<b>${fmtClock(m.t)}</b> <span>${esc(label(m))}</span></a>`; }).join('')}</div>`).join('');
  // Rows: moments in time order; moments of different seats within 8 s share a row.
  const rows = [];
  for (const m of story.merged) { const r = rows.at(-1); if (r && !r.some((x) => x.seat === m.seat) && m.t - r[0].t <= 8) r.push(m); else rows.push([m]); }
  const head = single ? '' : `<div class="st-colh" style="grid-row:1;grid-column:1"></div>${seats.map((s, k) => `<div class="st-colh" style="grid-row:1;grid-column:${k + 2}">${esc(s)} · ${esc(seatName(run, s))}</div>`).join('')}`;
  const off = single ? 1 : 2;
  const body = rows.map((r, j) => `<div class="st-time" style="grid-row:${j + off};grid-column:1">${fmtClock(r[0].t)}</div>${r.map((m) => `<div style="grid-row:${j + off};grid-column:${seats.indexOf(m.seat) + 2};min-width:0">${momentHtml(m, 0, ctx)}</div>`).join('')}`).join('');
  const n = story.merged.length; const sev = story.merged.filter((m) => m.severity >= 3).length;
  return `<section class="st${single ? ' st-row1' : ''}" id="story"><style>${CSS}</style>${heading ? '<h2 id="story-h">Story</h2>' : ''}
<p class="st-sub">${n} moments over ${fmtClock(story.durationSec)} of play${seats.length > 1 ? ` across ${seats.length} seats` : ''}${sev ? `, ${sev} marked red` : ''}. Each picture is the director's view: the screenshot the player was shown nearest that moment. Times are since play start. Left border: blue notable, amber partial or unanswered, red wrong or physically broken; dashed frames are quiet stretches.</p>
<div>${film}</div><div class="st-tl" style="--cols:${Math.max(1, seats.length)}">${head}${body}</div>
<div class="st-lb" hidden><img alt=""></div><script>(()=>{const s=document.currentScript,lb=s.previousElementSibling,sec=s.parentElement;sec.querySelectorAll('.st-film img[data-k]').forEach(i=>{const o=sec.querySelector('.st-m img[data-k="'+i.dataset.k+'"]');if(o)i.src=o.src});sec.addEventListener('click',e=>{const a=e.target.closest('a.st-shot');if(a){e.preventDefault();lb.querySelector('img').src=a.dataset.full||a.querySelector('img').src;lb.hidden=false;return}if(e.target.closest('.st-lb'))lb.hidden=true});document.addEventListener('keydown',e=>{if(e.key==='Escape')lb.hidden=true})})()</script></section>`;
}

/** Self-contained page (the CLI's story.html). */
export function storyPage(story, run, opts = {}) {
  const s = run.scenario ?? {};
  const name = String(s.name ?? story.run ?? 'Playtest').replace(/[-_]+/g, ' ');
  const seats = [...(s.seats ?? []).map((x) => `${x.id}: ${x.adapter} ${x.model ?? ''}, ${x.persona}`), ...(s.god ? [`god: ${s.god.adapter} ${s.god.model ?? ''}, ${s.god.persona}`] : [])];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(name.split(' ').slice(0, 3).join(' '))} story</title>
<style>:root{--bg:#fbfaf7;--fg:#1d1d1b;--mute:#6b6a65}@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#161614;--fg:#e8e6e1;--mute:#a19f98}}:root[data-theme="dark"]{--bg:#161614;--fg:#e8e6e1;--mute:#a19f98}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}main{max-width:1280px;padding:20px 16px 64px;margin:0 auto}h1{font-size:1.45em;margin:.1em 0 .2em}.meta{color:var(--mute);font-size:.86em;margin:0}</style></head>
<body><main><h1>${esc(name)} — the story</h1><p class="meta">${esc(story.run)} · ${esc(seats.join(' · '))}</p>${renderStoryHtml(story, run, { ...opts, heading: false })}</main></body></html>\n`;
}

/** Plain-text lines for REPORT.md: `m:ss · who · what`, with the shot path (relative to the run folder). */
export function storyLines(story, run = null) {
  return story.merged.map((m) => {
    const agentish = ['ack', 'result', 'reply'].includes(m.kind);
    const who = agentish ? `${seatName(run, m.seat)}'s agent` : m.seat;
    const what = [m.title, m.persona?.said && `"${m.persona.said}"`, agentish && m.agent?.said && `"${m.agent.said.replace(/\s+/g, ' ').slice(0, 140)}"`, m.verdict && `${m.verdict.fidelity ?? '?'}${m.verdict.class ? ' ' + m.verdict.class : ''}${m.verdict.issueId ? ` (${m.verdict.issueId})` : ''}`].filter(Boolean).join(' — ');
    return `${fmtClock(m.t)} · ${who} · ${what}${m.shot ? ` · ${m.shot}` : ''}`;
  });
}

/** JPEG thumbnails (≤ 640 px, ≤ 120 KB each) as data URIs; quality steps down until each and the whole set fit. */
export function inlineThumbs(runDir, paths, { maxEach = 120_000, maxTotal = 3_400_000 } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'pt-story-')); const out = {};
  try {
    const enc = (rel, q, px) => { const f = join(tmp, `${Object.keys(out).length}-${q}.jpg`); execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(q), '-Z', String(px), join(runDir, rel), '--out', f], { stdio: 'ignore' }); return readFileSync(f); };
    let q = 60, px = 640;
    for (let pass = 0; pass < 4; pass++) {
      let total = 0;
      for (const rel of paths) {
        let buf; try { buf = enc(rel, q, px); if (buf.length > maxEach) buf = enc(rel, Math.max(25, q - 25), px); } catch { continue; }
        out[rel] = `data:image/jpeg;base64,${buf.toString('base64')}`; total += out[rel].length;
      }
      if (total <= maxTotal) break;
      q = Math.max(25, q - 15); if (pass >= 1) px = 480;
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  return out;
}

/** story.json + standalone story.html in the run folder. */
export function writeStory(runDir, { out = null, maxMoments = 30, run = null } = {}) {
  run = run ?? loadRun(runDir);
  const story = buildStory(run, { maxMoments });
  writeJson(join(runDir, 'story.json'), story);
  const shots = [...new Set(story.merged.map((m) => m.shot).filter(Boolean))];
  const inline = inlineThumbs(runDir, shots);
  const path = out ? (out.startsWith('/') ? out : join(runDir, out)) : join(runDir, 'story.html');
  writeFileSync(path, storyPage(story, run, { inline }));
  return { path, bytes: statSync(path).size, moments: story.merged.length, json: join(runDir, 'story.json') };
}
