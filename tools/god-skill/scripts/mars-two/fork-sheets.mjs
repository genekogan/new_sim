#!/usr/bin/env node
// MARSLAND-FORK: side-by-side sheets, one per view: columns are image sets with the same camera (e.g. sim.mars.college
// release 43 | local 7d9688f source | the fork before | the fork after). Labels on top.
//   node fork-sheets.mjs <out-dir> <label>=<dir>:<suffix> ... [--views a,b,c] [--w 800]
//   e.g. live=…/source-v2:-sim  src=…/source-v2:-local  before=…/fork/prod:-prod  after=…/fork/src2:-fork
import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const sharp = createRequire(createRequire(new URL('../../../../apps/server/package.json', import.meta.url)).resolve('@gltf-transform/functions'))('sharp');
const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args.splice(i, 2)[1] : d; };
const views = flag('views', '').split(',').filter(Boolean), W = Number(flag('w', 800)), sfx = flag('sfx', '');
const [out, ...cols] = args; mkdirSync(out, { recursive: true });
const sets = cols.map((c) => { const [label, rest] = c.split('='); const i = rest.lastIndexOf(':'); return { label, dir: rest.slice(0, i), suffix: rest.slice(i + 1) }; });
for (const v of views) {
  const imgs = [];
  for (const s of sets) { const f = join(s.dir, `${v}${s.suffix}${sfx}.png`); imgs.push(existsSync(f) ? await sharp(f).resize({ width: W }).png().toBuffer() : null); }
  let H = 0; for (const b of imgs) if (b) H = Math.max(H, (await sharp(b).metadata()).height);
  const top = 34, comp = [];
  sets.forEach((s, i) => {
    if (imgs[i]) comp.push({ input: imgs[i], left: i * (W + 8), top });
    comp.push({ input: Buffer.from(`<svg width="${W}" height="${top}"><text x="8" y="23" font-family="Helvetica" font-size="18" fill="#eee">${s.label} - ${v}${imgs[i] ? '' : ' (missing)'}</text></svg>`), left: i * (W + 8), top: 0 });
  });
  await sharp({ create: { width: sets.length * (W + 8) - 8, height: H + top, channels: 3, background: '#161616' } }).composite(comp).png().toFile(join(out, `${v}-sheet${sfx}.png`));
  console.log(join(out, `${v}-sheet${sfx}.png`));
}
