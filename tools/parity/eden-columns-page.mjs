#!/usr/bin/env node
// Eden comparison page with several eden-2026 columns (lane E-look, 2026-10-17): old /w/eden captures stay as they are
// (images/eden/<view>-<hour>-dpr<d>-old.png); each later eden-2026 capture is a column listed in eden-columns.json:
//   [{ "suffix": "new", "label": "...", "note": "..." }, { "suffix": "e26-<sha>", ... }]   (newest last)
// Add a column: copy a capture-new.mjs output dir in with
//   node tools/parity/eden-columns-page.mjs <review dir> --add <capture dir> <suffix> "<label>" "<note>"
// then (or anyway) the page is rebuilt from the manifest. Agents give no verdict; Gene judges.
import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
const [review, flag, from, suffix, label, note] = process.argv.slice(2);
const img = resolve(review, 'images/eden'), manifest = resolve(review, 'eden-columns.json');
const views = JSON.parse(readFileSync(resolve(review, 'sources/t3-engine-eden-views.json'), 'utf8'));
let cols = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')) : [{ suffix: 'new', label: 'eden-2026 @ d4d0845a (lane engine, Oct 16)', note: 'first pass: landmarks rebuilt as core-kit entities' }];
if (flag === '--add') {
  let n = 0;
  for (const f of readdirSync(from)) { const m = /^(.+-dpr[12])-new\.png$/.exec(f); if (!m) continue; copyFileSync(resolve(from, f), resolve(img, `${m[1]}-${suffix}.png`)); n++; }
  cols = cols.filter(c => c.suffix !== suffix).concat([{ suffix, label, note: note ?? '' }]);
  console.log('copied', n, 'images as', suffix);
}
writeFileSync(manifest, JSON.stringify(cols, null, 2) + '\n');
const items = [];
for (const [t] of Object.entries(views.timePresets)) for (const w of views.views) {
  const id = `${w.id}-${t}`, e = { id, label: `${w.label} · ${t[0].toUpperCase() + t.slice(1)}`, old: {}, cols: {} };
  for (const d of [1, 2]) { e.old[d] = `images/eden/${id}-dpr${d}-old.png`; for (const c of cols) if (existsSync(resolve(img, `${id}-dpr${d}-${c.suffix}.png`))) (e.cols[c.suffix] ??= {})[d] = `images/eden/${id}-dpr${d}-${c.suffix}.png`; }
  items.push(e);
}
const data = JSON.stringify({ items, cols }).replaceAll('<', '\\u003c');
writeFileSync(resolve(review, 'eden.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Eden · old and new</title>
<style>*{box-sizing:border-box}body{margin:0;background:#171b21;color:#ecede9;font:15px/1.5 system-ui,sans-serif}main{max-width:1680px;margin:auto;padding:28px 16px}h1{margin:0;font-size:32px}p,li{max-width:1000px;color:#c9cdc8}a{color:#b4e4e0}nav{display:flex;gap:12px;flex-wrap:wrap;margin:18px 0}select,button{background:#29323b;color:#fff;border:1px solid #46525d;border-radius:6px;padding:7px 10px;font:inherit}.frames{display:grid;grid-template-columns:repeat(var(--n),1fr);gap:10px}.frame h3{margin:0 0 6px;font-size:14px}.frame small{display:block;color:#a8b3b4;margin:-4px 0 6px}img{width:100%;display:block;border-radius:4px;background:#000}.slot{aspect-ratio:3/2;border:1px dashed #6b7780;display:grid;place-items:center;color:#a8b3b4}@media(max-width:800px){.frames{grid-template-columns:1fr}}</style>
<main><a href="index.html">All comparisons</a><h1>Eden: old world / eden-2026</h1>
<p><b>Old side:</b> the real old Eden with its full content, loaded as a read-only stranger from <code>https://sim.eden.art/worlds/w/eden/</code> on 2026-10-16 (no sign-in, nothing changed). <b>New side:</b> eden-2026 on a local dev world (fake minds), one column per capture, newest last. Every column uses the same 12 camera poses (<code>t3-engine-eden-views.json</code>, same world coordinates) at 12:00, 19:00 and 22:00, in real Chrome on the Metal GPU, at DPR 1 and 2. This page gives no verdict: compare old against new and decide.</p>
<nav><label>View <select id="v"></select></label> <label>Pixels <select id="d"><option value="1">DPR 1</option><option value="2">DPR 2</option></select></label> <label>New columns <select id="c"><option value="last">newest only</option><option value="all">all</option></select></label><button id="p" aria-label="Previous view">←</button><button id="n" aria-label="Next view">→</button></nav>
<div class="frames" id="f"></div></main>
<script>const D=${data},v=document.getElementById('v'),d=document.getElementById('d'),c=document.getElementById('c'),f=document.getElementById('f');
D.items.forEach((e,i)=>v.add(new Option(e.label,i)));
const fig=(h,s,src,alt)=>'<div class="frame"><h3>'+h+'</h3>'+(s?'<small>'+s+'</small>':'')+(src?'<img src="'+src+'" alt="'+alt+'">':'<div class="slot">not captured</div>')+'</div>';
function show(){const e=D.items[v.value],k=d.value,cs=c.value==='all'?D.cols:D.cols.slice(-1);
 f.style.setProperty('--n',1+cs.length);f.innerHTML=fig('Old /w/eden (live content)','',e.old[k],'old Eden')+cs.map(x=>fig(x.label,x.note,(e.cols[x.suffix]||{})[k],x.label)).join('');}
v.onchange=d.onchange=c.onchange=show;p.onclick=()=>{v.value=(+v.value+D.items.length-1)%D.items.length;show()};n.onclick=()=>{v.value=(+v.value+1)%D.items.length;show()};show();</script></html>`);
console.log('eden page', items.length, 'views,', cols.length, 'new columns');
