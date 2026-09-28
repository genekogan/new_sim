// Gene's questions page: docs/engineering/QUESTIONS_FOR_GENE.md → docs/engineering/questions/index.html.
// Usage (from viewer/): node deploy/questions-html.mjs [--check]
// Each question block carries a fenced ```question block (field list in QUESTIONS_FOR_GENE.md, "Gene's page").
// Fails loudly on a missing field, an unknown urgency, a missing image, or engine vocabulary in the plain text.
// --check: exit 1 if index.html is not what the Markdown generates (nothing written).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/engineering');
const SRC = path.join(ENG, 'QUESTIONS_FOR_GENE.md');
const OUT = path.join(ENG, 'questions/index.html');
const REQUIRED = ['id', 'urgency', 'plain', 'context', 'changes'];
const REQUIRED_OPEN = ['options', 'images'];
const URGENCY = {
  first: { tag: 'worth answering first', head: 'Worth answering first' },
  fidelity: { tag: 'improves fidelity', head: 'Improves fidelity' },
  none: { tag: 'blocks nothing', head: 'Blocks nothing (housekeeping)' },
};
// engine words that must not reach Gene's plain text unless the block defines them in `terms`
const BANNED = ['seat', 'kit', 'protected state', 'raster', 'pin', 'lattice', 'datum', 'upright', 'checkpoint', 'fixture', 'entity'];

const fail = (msg) => {
  console.error(`questions-html: ${msg}`);
  process.exit(1);
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The ```question block: `key: value` lines and `key:` + `  - item` lists. */
function parseFields(text, where) {
  const out = {};
  let list = null;
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    const item = /^\s+-\s+(.*)$/.exec(raw);
    if (item) {
      if (!list) fail(`${where}: list item outside a list: "${raw.trim()}"`);
      out[list].push(item[1].trim());
      continue;
    }
    const kv = /^([a-z]+):\s*(.*)$/.exec(raw);
    if (!kv) fail(`${where}: cannot parse line "${raw}"`);
    const [, k, v] = kv;
    if (k in out) fail(`${where}: field "${k}" given twice`);
    if (v) (out[k] = v), (list = null);
    else (out[k] = []), (list = k);
  }
  return out;
}

function parse(md) {
  const blocks = [];
  const heads = [...md.matchAll(/^### (.+)$/gm)];
  heads.forEach((h, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].index : md.length;
    let body = md.slice(h.index, end);
    const cut = /^## /m.exec(body.slice(4)); // a following section heading ends the block
    if (cut) body = body.slice(0, cut.index + 4);
    const title = h[1].trim();
    const fence = /^```question\n([\s\S]*?)\n```$/m.exec(body);
    if (!fence) fail(`"${title}": no \`\`\`question block under the heading`);
    const f = parseFields(fence[1], title);
    for (const k of REQUIRED) if (!f[k] || (Array.isArray(f[k]) && !f[k].length)) fail(`"${title}": missing field "${k}"`);
    const answered = f.status === 'answered';
    if (f.status && !answered) fail(`"${title}": status must be "answered" (got "${f.status}")`);
    if (!answered) for (const k of REQUIRED_OPEN) if (!Array.isArray(f[k]) || !f[k].length) fail(`"${title}": missing list "${k}"`);
    if (!URGENCY[f.urgency]) fail(`"${title}": urgency must be first | fidelity | none (got "${f.urgency}")`);
    if (!new RegExp(`^${f.id}\\.`).test(title)) fail(`"${title}": id "${f.id}" does not match the heading`);
    const terms = (f.terms ?? []).map((t) => {
      const [word, def] = t.split(' | ');
      if (!word || !def) fail(`"${title}": term "${t}" must be "word | definition"`);
      return { word, def };
    });
    const defined = new Set(terms.map((t) => t.word.toLowerCase()));
    for (const k of ['plain', 'context', 'changes', 'options']) {
      const text = [].concat(f[k] ?? []).join(' ').toLowerCase();
      for (const w of BANNED) if (!defined.has(w) && new RegExp(`\\b${w}s?\\b`).test(text)) fail(`"${title}": engine word "${w}" in ${k}; rephrase or define it in terms`);
    }
    const images = (f.images ?? []).map((t) => {
      const [src, caption] = t.split(' | ');
      if (!src || !caption) fail(`"${title}": image "${t}" must be "path | caption"`);
      if (src === 'none') return { none: true, caption };
      if (!src.startsWith('questions/')) fail(`"${title}": image ${src} must live under docs/engineering/questions/ (the page is served on its own)`);
      if (!existsSync(path.join(ENG, src))) fail(`"${title}": image ${src} does not exist`);
      return { src: src.slice('questions/'.length), caption };
    });
    // the Gene: line and its wrapped continuation lines (up to a blank line)
    const gene = /^\**Gene[^:\n]*:\**[ \t]*(.*(?:\n(?!\s*\n).+)*)$/m.exec(body.slice(fence.index + fence[0].length));
    if (!gene) fail(`"${title}": no "Gene:" line`);
    const order = f.order === undefined ? 100 : Number(f.order);
    if (!Number.isFinite(order)) fail(`"${title}": order must be a number`);
    const engineer = body.slice(fence.index + fence[0].length).replace(/^\n+/, '').trim();
    blocks.push({ ...f, title, terms, images, order, answered, answer: gene[1].replace(/\s*\n\s*/g, ' ').trim(), engineer });
  });
  const ids = blocks.map((b) => b.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) fail(`duplicate id ${dup}`);
  return blocks;
}

/** Plain text with the block's terms as hover titles (first occurrence). */
function withTerms(text, terms) {
  let html = esc(text);
  for (const t of terms) {
    const re = new RegExp(`\\b(${t.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?)\\b`, 'i');
    html = html.replace(re, `<abbr title="${esc(t.def)}">$1</abbr>`);
  }
  return html;
}

function card(b) {
  const u = URGENCY[b.urgency];
  const pics = b.images
    .map((im) =>
      im.none
        ? `<div class="noimg"><strong>No picture for this one.</strong> ${esc(im.caption)}</div>`
        : `<figure${im.src.endsWith('.svg') ? ' class="wide"' : ''}><a href="${esc(im.src)}" target="_blank" rel="noopener"><img src="${esc(im.src)}" alt="${esc(im.caption)}" loading="lazy"></a><figcaption>${esc(im.caption)}</figcaption></figure>`,
    )
    .join('\n');
  const opts = [...b.options, "Don't know / skip"]
    .map((o) => `<label class="opt"><input type="radio" name="${b.id}" value="${esc(o)}"> <span>${esc(o)}</span></label>`)
    .join('\n');
  const terms = b.terms.length ? `<p class="terms">${b.terms.map((t) => `<b>${esc(t.word)}</b>: ${esc(t.def)}`).join('<br>')}</p>` : '';
  const prior = b.answer ? `<p class="prior">Already written in the file: “${esc(b.answer)}”</p>` : '';
  return `<article class="card" id="${b.id}" data-id="${b.id}" data-plain="${esc(b.plain)}">
<div class="qid">${b.id}</div>
<h3>${withTerms(b.plain, b.terms)}</h3>
<p class="context">${withTerms(b.context, b.terms)}</p>
<div class="pics">
${pics}
</div>
<fieldset class="answer">
<legend>Your answer</legend>
${prior}${opts}
<label class="angle"><input type="checkbox" data-k="angle"> Show me a different angle</label>
<textarea data-k="note" rows="2" placeholder="Anything to add (optional): a number, a correction, a memory"></textarea>
</fieldset>
<p class="changes"><span class="tag ${b.urgency}">${u.tag}</span> <strong>What changes if you answer:</strong> ${withTerms(b.changes, b.terms)}</p>
${terms}<details class="eng"><summary>Engineer's notes (not needed to answer)</summary><pre>${esc(b.engineer)}</pre></details>
</article>`;
}

function page(blocks) {
  const open = blocks.filter((b) => !b.answered);
  const done = blocks.filter((b) => b.answered);
  const groups = Object.keys(URGENCY)
    .map((k) => {
      const cards = open.filter((b) => b.urgency === k).sort((a, b) => a.order - b.order);
      return cards.length ? `<section><h2>${URGENCY[k].head}</h2>\n${cards.map(card).join('\n')}</section>` : '';
    })
    .join('\n');
  const record = done.map((b) => `<li><b>${b.id}.</b> ${esc(b.plain)}<br><span class="rec">You said: ${esc(b.answer || '(no answer recorded)')}</span></li>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Questions for Gene</title>
<!-- GENERATED by viewer/deploy/questions-html.mjs from docs/engineering/QUESTIONS_FOR_GENE.md. Do not edit by hand. -->
<style>
:root{--bg:#f6f4ef;--card:#fff;--ink:#1c1c1c;--soft:#5d5a55;--line:#ddd7cc;--accent:#c2410c;--first:#b91c1c;--fid:#1d4ed8;--none:#6b7280;--pick:#fff4e8}
@media (prefers-color-scheme: dark){:root{--bg:#161616;--card:#212121;--ink:#ecebe8;--soft:#aaa6a0;--line:#3a3833;--accent:#fb923c;--first:#f87171;--fid:#93c5fd;--none:#9ca3af;--pick:#2e2519}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:920px;margin:0 auto;padding:24px 16px 80px}
h1{font-size:30px;margin:8px 0 4px}
.lede{color:var(--soft);margin:0 0 18px}
h2{font-size:15px;text-transform:uppercase;letter-spacing:.08em;color:var(--soft);margin:36px 0 10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;margin:0 0 22px;position:relative}
.card.answered{border-color:var(--accent)}
.qid{position:absolute;top:14px;right:16px;font-size:13px;color:var(--soft)}
h3{font-size:21px;line-height:1.35;margin:0 40px 8px 0}
.context{color:var(--soft);margin:0 0 14px}
abbr{text-decoration:underline dotted;cursor:help}
.pics{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:12px;margin:0 0 16px}
figure{margin:0}
figure.wide{grid-column:1/-1}
figure.wide img{max-width:900px;border:0}
figure img{width:100%;height:auto;display:block;border-radius:8px;border:1px solid var(--line);background:#fff}
figcaption{font-size:14px;color:var(--soft);margin-top:4px}
.noimg{grid-column:1/-1;border:1px dashed var(--line);border-radius:8px;padding:14px;font-size:15px}
fieldset.answer{border:1px solid var(--line);border-radius:10px;padding:10px 14px 14px;margin:0 0 12px}
legend{font-weight:700;padding:0 6px}
.opt{display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border-radius:8px;cursor:pointer}
.opt:hover{background:var(--pick)}
.opt input{margin-top:5px;transform:scale(1.25)}
.opt:has(input:checked){background:var(--pick);font-weight:600}
.angle{display:block;margin:8px 10px;font-size:15px;color:var(--soft);cursor:pointer}
textarea{width:100%;font:inherit;font-size:15px;padding:8px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--ink);margin-top:6px}
.prior{margin:4px 10px 8px;font-size:15px}
.changes{margin:0;font-size:15px}
.tag{display:inline-block;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:2px 8px;border-radius:99px;border:1.5px solid;margin-right:6px}
.tag.first{color:var(--first)}.tag.fidelity{color:var(--fid)}.tag.none{color:var(--none)}
.terms{font-size:14px;color:var(--soft);margin:10px 0 0}
details.eng{margin-top:10px;font-size:14px;color:var(--soft)}
details.eng pre{white-space:pre-wrap;font-size:12.5px;background:var(--bg);padding:10px;border-radius:8px}
.bar{position:sticky;bottom:0;background:var(--card);border-top:1px solid var(--line);padding:12px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:center}
button{font:inherit;font-weight:600;padding:10px 18px;border-radius:8px;border:0;background:var(--accent);color:#fff;cursor:pointer}
#progress{color:var(--soft);font-size:15px}
#out{display:none;width:100%;max-width:920px;min-height:160px;font:13px/1.4 ui-monospace,monospace}
.record li{margin-bottom:10px}.rec{color:var(--soft);font-size:15px}
</style>
</head>
<body>
<main>
<h1>Questions for Gene</h1>
<p class="lede">${open.length} open questions about how the campus was really built. Nothing is waiting on them: each has a default the model uses today. Answer any you like, in any order, over as many days as you want. Your answers stay in this browser; when you are done, press <b>Export answers</b> and paste the result to Claude. Red outlines in the pictures mark the thing being asked about; captions say which pictures are real photos, which are the model, and which are diagrams.</p>
${groups}
<section><h2>Already answered</h2><ul class="record">${record}</ul></section>
</main>
<div class="bar"><span id="progress"></span><button id="export" type="button">Export answers</button><textarea id="out" readonly aria-label="Exported answers"></textarea></div>
<script>
(function () {
  var KEY = 'mars-questions-answers-v1';
  var state = {};
  try { state = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { state = {}; }
  var save = function () { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };
  var cards = [].slice.call(document.querySelectorAll('.card'));
  var progress = document.getElementById('progress');
  function count() {
    var n = cards.filter(function (c) { var s = state[c.dataset.id]; return s && (s.choice || s.note); }).length;
    progress.textContent = n + ' of ' + cards.length + ' answered';
    cards.forEach(function (c) { var s = state[c.dataset.id]; c.classList.toggle('answered', !!(s && (s.choice || s.note))); });
  }
  cards.forEach(function (c) {
    var id = c.dataset.id, s = state[id] || (state[id] = {});
    c.querySelectorAll('input[type=radio]').forEach(function (r) {
      if (s.choice === r.value) r.checked = true;
      r.addEventListener('change', function () { s.choice = r.value; save(); count(); });
    });
    var angle = c.querySelector('[data-k=angle]'), note = c.querySelector('[data-k=note]');
    angle.checked = !!s.angle; note.value = s.note || '';
    angle.addEventListener('change', function () { s.angle = angle.checked; save(); count(); });
    note.addEventListener('input', function () { s.note = note.value; save(); count(); });
  });
  count();
  document.getElementById('export').addEventListener('click', function () {
    var lines = ['## Gene\\'s answers (questions page, ' + new Date().toISOString().slice(0, 10) + ')', ''];
    cards.forEach(function (c) {
      var s = state[c.dataset.id] || {};
      if (!s.choice && !s.note && !s.angle) return;
      var parts = [];
      if (s.choice) parts.push(s.choice);
      if (s.note) parts.push('Note: ' + s.note.replace(/\\s+/g, ' ').trim());
      if (s.angle) parts.push('(asks for a different angle)');
      lines.push('- **' + c.dataset.id + '** (' + c.dataset.plain + '): ' + parts.join('. ').trim());
    });
    if (lines.length === 2) lines.push('(no answers yet)');
    var text = lines.join('\\n') + '\\n';
    var out = document.getElementById('out');
    out.value = text; out.style.display = 'block';
    var done = function (ok) { document.getElementById('export').textContent = ok ? 'Copied: paste it to Claude' : 'Select the text below and copy it'; };
    try { navigator.clipboard.writeText(text).then(function () { done(true); }, function () { out.select(); done(false); }); }
    catch (e) { out.select(); done(false); }
  });
})();
</script>
</body>
</html>
`;
}

const html = page(parse(readFileSync(SRC, 'utf8')));
if (process.argv.includes('--check')) {
  const cur = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (cur !== html) fail(`${path.relative(process.cwd(), OUT)} is stale: run node deploy/questions-html.mjs`);
  console.log('questions-html: up to date');
} else {
  writeFileSync(OUT, html);
  const blocks = parse(readFileSync(SRC, 'utf8'));
  console.log(`questions-html: wrote ${path.relative(process.cwd(), OUT)} (${blocks.filter((b) => !b.answered).length} open cards, ${blocks.filter((b) => b.answered).length} answered, ${(html.length / 1024).toFixed(0)} KB)`);
}
