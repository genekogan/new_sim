#!/usr/bin/env node
// Refresh the NEW side of one comparison page in team/reviews/sim-compare-20261015/ (lane M, 2026-10-17) from a running
// local copy: the same named views (tools/parity/comparison-poses.mjs; Mars cameras turned with the campus to the live
// bearing), real Chrome at 960x640 CSS, dpr 1 and 2, plus optional new-only views. Old-side images are never touched;
// earlier candidate images stay on disk. Writes <view>-dpr<n>-candidate-<tag>.png and -pair-<tag>.png, then points the
// page at them and states what the new side now is.
//   node tools/mars-m2/refresh-compare.mjs --world mars|littlemartians --base <copy URL> --review <dir> --tag <tag>
//        --side "<new-side heading>" --scope "<one paragraph>" [--bearing 82] [--extra-views <json>] [--only a,b]
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { comparisonPoses } from '../parity/comparison-poses.mjs';
import { turn } from '../mars-rotation/patch.mjs';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const world = flag('world'), base = flag('base'), review = flag('review'), tag = flag('tag'), bearing = Number(flag('bearing', 90));
assert(world && base && review && tag, '--world --base --review --tag');
const template = JSON.parse(readFileSync(`${ROOT}/worlds/templates/${world === 'mars' ? 'mars-two' : 'littlemartians-two'}.json`, 'utf8'));
const only = flag('only') ? new Set(flag('only').split(',')) : null;
const turned = (p) => { if (world !== 'mars' || bearing === 90) return p; const q = turn([p[0], p[1], p[2]], 0, bearing).p; return [q[0], p[1], q[2]]; };
const poses = comparisonPoses(ROOT, world, template).filter((p) => !only || only.has(p.name));
const extras = flag('extra-views') ? JSON.parse(readFileSync(flag('extra-views'), 'utf8')) : [];
const views = [
  ...poses.map((p) => ({ name: p.name, eye: turned(p.candidate.eye), at: turned(p.candidate.at), hour: `${String(p.hour).padStart(2, '0')}:00` })),
  ...extras.map((v) => (v.frame ? v : { ...v, eye: turned(v.eye), at: turned(v.at) })),
];
const images = resolve(review, 'images', world), tmp = `${images}/.n3-views.json`;
writeFileSync(tmp, JSON.stringify(views));
execFileSync(process.execPath, [`${ROOT}/tools/mars-m2/shots.mjs`, '--base', base, '--views', tmp, '--out', images, '--tag', tag, '--size', '960x640', '--dpr', '1,2'], { stdio: 'inherit' });
for (const v of views) for (const d of [1, 2]) renameSync(`${images}/${v.name}-${tag}-dpr${d}.png`, `${images}/${v.name}-dpr${d}-candidate-${tag}.png`);
const sideHead = flag('side', 'New (refreshed)');
// pairs: old | new with the same one-line header as the originals (python + PIL)
const oldHead = world === 'mars' ? 'Old /w/mars (live content, sim.eden.art/worlds)' : 'Old /w/littlemartians (live content, sim.eden.art/worlds)';
execFileSync('python3', ['-c', `
import sys, json
from PIL import Image, ImageDraw, ImageFont
images, tag, views, oldh, newh = sys.argv[1], sys.argv[2], json.loads(sys.argv[3]), sys.argv[4], sys.argv[5]
import os
for name in views:
  for d in (1, 2):
    new = Image.open(f'{images}/{name}-dpr{d}-candidate-{tag}.png').convert('RGB')
    oldp = f'{images}/{name}-dpr{d}-old.png'
    old = Image.open(oldp).convert('RGB') if os.path.exists(oldp) else Image.new('RGB', new.size, (16, 18, 23))
    W, H, top = new.size[0], new.size[1], 32 * d
    out = Image.new('RGB', (2 * W, H + top), (23, 32, 44)); out.paste(old.resize((W, H)), (0, top)); out.paste(new, (W, top))
    g = ImageDraw.Draw(out); f = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 12 * d)
    g.text((12 * d, 9 * d), oldh if os.path.exists(oldp) else 'No old-world counterpart (new view)', fill=(236, 237, 233), font=f); g.text((W + 12 * d, 9 * d), newh, fill=(236, 237, 233), font=f)
    out.save(f'{images}/{name}-dpr{d}-pair-{tag}.png')
`, images, tag, JSON.stringify(views.map((v) => v.name)), oldHead, sideHead], { stdio: 'inherit' });
// the page: point candidate/pair at the new files, add new-only views, state the new side
const page = resolve(review, `${world}.html`); let html = readFileSync(page, 'utf8');
const m = /<script>const views=(\[.*?\]),v=document/.exec(html); assert(m, 'views JSON not found in page');
const data = JSON.parse(m[1]);
for (const v of views) {
  let row = data.find((x) => x.name === v.name);
  if (!row) { row = { name: v.name, label: v.label ?? v.name, note: v.note ?? '', hour: Number(v.hour.slice(0, 2)), kind: 'new', shots: {} }; data.push(row); }
  for (const d of ['1', '2']) { row.shots[d] = { ...(row.shots[d] ?? {}), candidate: `images/${world}/${v.name}-dpr${d}-candidate-${tag}.png`, pair: `images/${world}/${v.name}-dpr${d}-pair-${tag}.png` }; delete row.shots[d].error; }
}
html = html.replace(m[1], JSON.stringify(data).replace(/<\/script/g, '<\\/script'));
html = html.replace(/(<div class="frame"><h3>)New [^<]*(<\/h3><div id="candidate">)/, `$1${sideHead}$2`);
const note = `<p class="scope" id="refresh-${tag}"><b>Refreshed ${tag}:</b> ${flag('scope', '')}</p>`;
html = html.includes(`id="refresh-${tag}"`) ? html.replace(new RegExp(`<p class="scope" id="refresh-${tag}">.*?</p>`), note) : html.replace('<nav><label>View', `${note}\n<nav><label>View`);
writeFileSync(page, html);
console.log('page', page, 'views', views.length, existsSync(page));
