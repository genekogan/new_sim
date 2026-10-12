#!/usr/bin/env node
// Local private artifact only; no web application routes or remote writes.
// node tools/catalog/review-queue.mjs <registry> <render-report.json> <out-dir>
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Registry, reviewQueue } from '../../packages/catalog/src/index.ts';
const grandfathered = (item) => item.provenance.tool === 'catalog import-core' || Object.values(item.tests.gates).some((g) => g.grandfathered);
export function generateReviewQueue(registry, report, reportFile, out, entries = reviewQueue(registry)) {
const reportRoot = dirname(resolve(reportFile));
// Existing seed failures stay visible as held diagnostics, even when seed stable == candidate.
const present = new Set(entries.map(({ entry }) => `${entry.id}@${entry.major}`));
for (const entry of registry.current('candidate')) {
  const item = registry.item(entry.id, entry.major, entry.rev, entry.itemHash);
  const render = report.items.find((r) => r.defHash === entry.def1Hash);
  if (!present.has(`${entry.id}@${entry.major}`) && grandfathered(item) && render && (!render.ok || render.status === 'unqualified')) entries.push({ item, entry });
}
const rows = entries.map(({ item, entry }) => {
  const render = report.items.find((r) => r.defHash === entry.def1Hash && [`${item.id}@${item.major}`, ...item.aliases].includes(r.id));
  const def = registry.def(entry.rev), engine = registry.def1(entry.def1Hash);
  const required = ['default'];
  for (const [name, param] of Object.entries(def?.params ?? {})) if (param.type === 'enum')
    for (const value of param.values) if (value !== param.default) required.push(`${name}=${value}`);
  for (const [field, value] of [['on', true], ['open', true], ['lit', true], ['playing', true], ['level', 1]])
    if (engine?.state?.[field] && engine.state[field].default !== value) required.push(`${field}=${value}`);
  const four = ['front-left', 'front-right', 'back', 'above'];
  const hardware = typeof report.gpu === 'string' && report.gpu.trim() && !/swiftshader|llvmpipe|software|softpipe/i.test(report.gpu);
  const missing = required.flatMap((label) => four.filter((view) => !render?.views?.some((v) => v.label === label && v.view === view && v.file)).map((view) => `${label}/${view}`));
  const reasons = [
    ...(!render ? ['missing exact-hash render'] : []),
    ...(!hardware ? ['hardware renderer not qualified'] : []),
    ...(report.selection?.targeted ? ['targeted diagnostics are not publication proof'] : []),
    ...(!def || !engine ? ['missing immutable definition'] : []),
    ...(render && (!render.ok || render.status === 'unqualified') ? ['render failed or remains unqualified', ...(render.errors ?? [])] : []),
    ...(missing.length ? [`missing required views: ${missing.join(', ')}`] : []),
  ];
  const seed = grandfathered(item), held = seed || reasons.length > 0;
  if (!seed && reasons.length) throw new Error(`review proof refused for ${item.id}@${item.major}: ${reasons.join('; ')}`);
  const images = (render?.views ?? []).map((view, index) => {
    const file = view.file.startsWith('/tmp/g4/') ? resolve(reportRoot, view.file.slice('/tmp/g4/'.length)) : resolve(reportRoot, view.file);
    const rel = relative(reportRoot, file);
    if (rel.startsWith('..')) throw new Error('render image must exist inside its report folder');
    if (!existsSync(file)) {
      if (!seed) throw new Error('render image must exist inside its report folder');
      reasons.push(`missing image: ${view.label}/${view.view}`); return null;
    }
    mkdirSync(join(out, 'images'), { recursive: true });
    const destination = `images/${entry.def1Hash}-${index}.png`; copyFileSync(file, join(out, destination));
    return { src: destination, label: `${view.label}/${view.view}` };
  }).filter(Boolean);
  return { id: item.id, major: item.major, rev: item.rev, itemHash: entry.itemHash, title: item.text.title, first: item.text.first,
    budgets: item.budgets, gates: item.tests.gates, previous: item.review, images,
    held, proofStatus: seed ? 'Grandfathered seed — held; baseline approval pending' : 'Exact-hash hardware proof complete', reasons };
});
mkdirSync(out, { recursive: true });
const data = JSON.stringify(rows).replace(/</g, '\\u003c');
writeFileSync(join(out, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Private catalogue review</title>
<style>body{font:16px system-ui;background:#f6f3ee;color:#23282a;max-width:1040px;margin:24px auto;padding:0 20px}article{background:white;padding:20px;margin:20px 0;border:1px solid #ddd;border-radius:10px}h2{margin:0}img{width:185px;height:185px;object-fit:contain}figure{display:inline-block;margin:6px}figcaption{font-size:12px}button,select,textarea{font:inherit}textarea{display:block;width:95%;min-height:50px;margin:10px 0}pre{font-size:12px;white-space:pre-wrap}button{padding:10px 16px}label{display:block}.numbers{font-size:14px;color:#556}.gates{font-size:14px;display:flex;gap:16px;margin:12px 0}.bad{color:#a33}details{margin:10px 0}</style>
<h1>Private catalogue review</h1><p>Candidate items only. Export your decisions, then import them with the catalogue CLI. This page makes no network writes and promotes no items.</p><div id="queue"></div><button id="export">Export decisions</button><script>
const rows=${data}, queue=document.getElementById('queue'), inputs=[];
for(const row of rows){const article=document.createElement('article'), heading=document.createElement('h2');heading.textContent=row.title+' ('+row.id+'@'+row.major+')';article.append(heading);
 const description=document.createElement('p');description.textContent=row.first;article.append(description);
 const proof=document.createElement('p');proof.className=row.held?'bad':'numbers';proof.textContent=row.proofStatus+(row.reasons.length?' · '+row.reasons.join('; '):'');article.append(proof);
 for(const image of row.images){const figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption');img.src=image.src;img.alt=row.title+' '+image.label;caption.textContent=image.label;figure.append(img,caption);article.append(figure);}
 const numbers=document.createElement('p');numbers.className='numbers';numbers.textContent=row.budgets.tris.lod0+' triangles · '+row.budgets.draws+' draws · '+row.budgets.materials+' materials · '+(row.budgets.bytes.assets/1024).toFixed(0)+' KB assets';article.append(numbers);
 const gates=document.createElement('div');gates.className='gates';for(const [name,result] of Object.entries(row.gates)){const badge=document.createElement('span');badge.textContent=name+' '+(result.ok?'OK':'FAIL');if(!result.ok)badge.className='bad';gates.append(badge);}article.append(gates);
 const details=document.createElement('details'),summary=document.createElement('summary'),diagnostics=document.createElement('pre');summary.textContent='Gate details';diagnostics.textContent=JSON.stringify({budgets:row.budgets,gates:row.gates},null,2);details.append(summary,diagnostics);article.append(details);
 const label=document.createElement('label'),select=document.createElement('select');label.textContent='Verdict';for(const [value,text]of [['','Not reviewed'],['ok','OK'],['fix','Request fix'],['reject','Reject']]){const option=document.createElement('option');option.value=value;option.textContent=text;if(value==='ok'&&row.held)option.disabled=true;select.append(option);}label.append(select);article.append(label);
 const note=document.createElement('textarea');note.setAttribute('aria-label','Review note for '+row.title);note.placeholder='Optional note';article.append(note);queue.append(article);inputs.push({row,select,note});}
document.getElementById('export').onclick=()=>{const decisions=inputs.filter(i=>i.select.value&&!(i.row.held&&i.select.value==='ok')).map(({row,select,note})=>({id:row.id,major:row.major,rev:row.rev,itemHash:row.itemHash,verdict:select.value,note:note.value}));const url=URL.createObjectURL(new Blob([JSON.stringify(decisions,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='catalogue-reviews.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
</script></html>`);
writeFileSync(join(out, 'queue.json'), JSON.stringify({ at: new Date().toISOString(), candidates: rows }, null, 2));
return { candidates: rows.length, out: join(out, 'index.html'), rows };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [regArg, reportArg, outArg] = process.argv.slice(2);
  const result = generateReviewQueue(new Registry(resolve(regArg)), JSON.parse(readFileSync(reportArg, 'utf8')), reportArg, resolve(outArg));
  console.log(JSON.stringify({ candidates: result.candidates, out: result.out }));
}
