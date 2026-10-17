#!/usr/bin/env node
// What a resident can do, place by place, on a local copy: a scripted CLI resident (no LLM) walks to each named place
// and records whether it got there and which verbs it is then offered (and any object actions nearby).
//   node tools/mars-m2/probe-places.mjs <copy out dir> <place,place,...> [--out <json>]
import { writeFileSync } from 'node:fs';
import { attach, addSoulAs } from './attach.mjs';
import { follow } from '../mars-rotation/proof/lib.mjs';
const [dir, list] = process.argv.slice(2), outIdx = process.argv.indexOf('--out');
const ctx = await attach(dir);
await addSoulAs(ctx, 'probe' + Date.now().toString(36), 'Probe ' + Date.now().toString(36).slice(-4));
const offered = async () => {
  const o = await ctx.api('/v1/edge/observe', { as: 'soul' });
  const caps = JSON.stringify(o).match(/"([a-z][a-z-]*:[^"\s]{1,80})"/g)?.map((s) => s.slice(1, -1)) ?? [];
  const verbs = [...new Set(caps.map((c) => c.split(':')[0]))].sort();
  const objects = [...new Set(caps.filter((c) => c.startsWith('object:')).map((c) => c.split(':')[2]))].sort();
  return { at: o.self?.position, verbs, objects, sample: caps.filter((c) => /^(sit|lie|walk|rest|pray|swim|read|gather|dance|yoga)/.test(c)).slice(0, 12) };
};
const rows = [{ place: '(arrival)', ...(await offered()) }];
for (const place of list.split(',')) {
  const r = await follow(ctx, `walk:${place}`, { timeout: 300000 });
  rows.push({ place, ok: r.ok ?? false, code: r.code ?? null, s: Math.round((r.ms ?? 0) / 1000), ...(await offered()) });
  console.log(JSON.stringify(rows.at(-1)).slice(0, 600));
}
if (outIdx > 0) writeFileSync(process.argv[outIdx + 1], JSON.stringify(rows, null, 1));
