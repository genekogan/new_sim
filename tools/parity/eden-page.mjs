#!/usr/bin/env node
// Eden comparison page: real old Eden (live) captured; new side is a slot for lane engine's eden-2026.
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const [viewsJson,liveDir,review]=process.argv.slice(2);
const v=JSON.parse(readFileSync(viewsJson,'utf8')),dir=resolve(review,'images/eden');mkdirSync(dir,{recursive:true});
const live=JSON.parse(readFileSync(resolve(liveDir,'live.json'),'utf8'));
const items=[];
for(const [t,h] of Object.entries(v.timePresets))for(const w of v.views){const e={id:`${w.id}-${t}`,label:`${w.label} · ${t[0].toUpperCase()+t.slice(1)}`,old:{},new:{}};
  for(const d of [1,2]){const f=`${e.id}-dpr${d}-old.png`;copyFileSync(resolve(liveDir,f),resolve(dir,f));e.old[d]=`images/eden/${f}`;
    const nf=resolve(dir,`${e.id}-dpr${d}-new.png`);if(existsSync(nf))e.new[d]=`images/eden/${e.id}-dpr${d}-new.png`;}
  items.push(e);}
const data=JSON.stringify(items).replaceAll('<','\\u003c');
writeFileSync(resolve(review,'eden.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Eden · old and new</title>
<style>*{box-sizing:border-box}body{margin:0;background:#171b21;color:#ecede9;font:15px/1.5 system-ui,sans-serif}main{max-width:1420px;margin:auto;padding:28px}h1{margin:0;font-size:32px}p{max-width:980px;color:#c9cdc8}a{color:#b4e4e0}nav{display:flex;gap:12px;flex-wrap:wrap;margin:18px 0}select,button{background:#29323b;color:#fff;border:1px solid #46525d;border-radius:6px;padding:7px 10px;font:inherit}.frames{display:grid;grid-template-columns:1fr 1fr;gap:10px}.frame h3{margin:0 0 6px;font-size:14px}img{width:100%;display:block;border-radius:4px;background:#000}.slot{aspect-ratio:3/2;border:1px dashed #6b7780;display:grid;place-items:center;text-align:center;color:#a8b3b4;padding:20px}@media(max-width:800px){.frames{grid-template-columns:1fr}}</style>
<main><a href="index.html">All comparisons</a><h1>Eden: old world / eden-2026</h1>
<p><b>Old side: the real old Eden with its full content</b>, loaded as a read-only stranger from <code>https://sim.eden.art/worlds/w/eden/</code> on ${live.at.slice(0,10)}; no sign-in, no clicks, nothing changed. Camera and hour of day were set only inside the capture browser (day 12:00, dusk 19:00, night 22:00) to the 12 named views in <code>t3-engine-eden-views.json</code>, same world coordinates for both sides. <b>New side: pending eden-2026 (lane engine).</b> Engine adds files named <code>images/eden/&lt;view&gt;-&lt;day|dusk|night&gt;-dpr&lt;1|2&gt;-new.png</code> from the same poses, then re-runs <code>node tools/parity/eden-page.mjs</code>. The resident-action table is not yet captured.</p>
<nav><label>View <select id="v"></select></label> <label>Pixels <select id="d"><option value="1">DPR 1</option><option value="2">DPR 2</option></select></label><button id="p" aria-label="Previous view">←</button><button id="n" aria-label="Next view">→</button></nav>
<div class="frames"><div class="frame"><h3>Old /w/eden (live content)</h3><img id="o" alt="old Eden"></div><div class="frame"><h3>New eden-2026</h3><div id="w"></div></div></div></main>
<script>const I=${data},v=document.getElementById('v'),d=document.getElementById('d'),o=document.getElementById('o'),w=document.getElementById('w');
I.forEach((e,i)=>v.add(new Option(e.label,i)));
function show(){const e=I[v.value],k=d.value;o.src=e.old[k];w.innerHTML=e.new[k]?'<img src="'+e.new[k]+'" alt="new Eden">':'<div class="slot">pending eden-2026 (lane engine)</div>';}
v.onchange=d.onchange=show;p.onclick=()=>{v.value=(+v.value+I.length-1)%I.length;show()};n.onclick=()=>{v.value=(+v.value+1)%I.length;show()};show();</script></html>`);
console.log('eden page',items.length,'views');
