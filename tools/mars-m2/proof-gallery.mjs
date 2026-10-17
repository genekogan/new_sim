#!/usr/bin/env node
// Proof for mars-gallery-20261017 on a local copy: a scripted CLI resident (no LLM) walks to Chiba, puts the Mars College
// card up on the hall projection, switches the gallery monitors off and on, and restores the flower. Prints each step.
//   node tools/mars-m2/proof-gallery.mjs <copy out dir> [--leave-card]
import { attach } from './attach.mjs';
import { addSoul, follow } from '../mars-rotation/proof/lib.mjs';
const [out] = process.argv.slice(2), leave = process.argv.includes('--leave-card');
const ctx = await attach(out);
const snap = await ctx.api('/v1/world/snapshot', { as: 'public' });
const id = (n) => snap.entities.find((e) => e.name === n)?.id;
const st = async (n) => (await ctx.query({ describe: id(n) })).describe.state;
const log = [];
const step = async (cap, opt = {}) => { const r = await follow(ctx, cap, { timeout: 300000, ...opt }); const row = { cap: cap.replace(/e_[0-9a-f]+/, (m) => snap.entities.find((e) => e.id === m)?.name ?? m), ok: r.ok ?? false, code: r.code ?? null, room: r.room ? `${r.room.building}/${r.room.room}` : null, s: Math.round((r.ms ?? 0) / 1000) }; log.push(row); console.log(JSON.stringify(row)); return r; };
await addSoul(ctx, 'Gallery Walker');
const o = await ctx.api('/v1/edge/observe', { as: 'soul' });
const offered = JSON.stringify(o).match(/object:e_[0-9a-f]+:(show-card|show-flower|switch-off|switch-on)/g) ?? [];
console.log('offered near arrival', [...new Set(offered)].length);
await step('walk:chiba');
console.log('projection before', JSON.stringify(await st('hall-projection')));
await step(`object:${id('hall-projection')}:show-card`);
console.log('projection after card', JSON.stringify(await st('hall-projection')));
await step(`object:${id('gallery-monitors')}:switch-off`);
console.log('monitors after off', JSON.stringify(await st('gallery-monitors')));
await step(`object:${id('gallery-monitors')}:switch-on`);
await step(`object:${id('gallery-monitors')}:show-card`);
console.log('monitors', JSON.stringify(await st('gallery-monitors')));
if (!leave) { await step(`object:${id('hall-projection')}:show-flower`); await step(`object:${id('gallery-monitors')}:show-flower`); }
console.log('final', JSON.stringify({ projection: await st('hall-projection'), monitors: await st('gallery-monitors') }));
console.log('PASS', log.every((r) => r.ok));
