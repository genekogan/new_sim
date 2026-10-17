#!/usr/bin/env node
// Proof for the carry-slot fix on a local copy: the god places a catalogue watering can (core-watering-can, no `item`
// tag) by the water tank; a scripted CLI resident picks it up; the entity world must then hold it in the body's carry
// slot (before the fix the engine's write-back was refused every tick and viewers drew the can on the ground).
//   node tools/mars-m2/proof-carry.mjs <copy out dir>
import { attach, addSoulAs } from './attach.mjs';
import { addSoul, follow, delay } from '../mars-rotation/proof/lib.mjs';
import { readFileSync } from 'node:fs';
const [out] = process.argv.slice(2);
const ctx = await attach(out);
await addSoulAs(ctx, 'carrier' + Date.now().toString(36), 'Carrier ' + Date.now().toString(36).slice(-4));
for (const w of ['walk:freeside', 'walk:water-tank']) { const x = await follow(ctx, w, { timeout: 300000 }); console.log(w, x.ok, x.code ?? ''); }
const me = (await ctx.api('/v1/edge/observe', { as: 'soul' })).self, name = 'catalogue-can-' + Date.now().toString(36);
const s0 = await ctx.api('/v1/world/snapshot', { as: 'public' }), pc = s0.entities.find((e) => e.name === 'watering-can');
// beside the patch's own (reachable) watering can, on the side of the resident
const dx = me.position[0] - pc.p[0], dz = me.position[2] - pc.p[pc.p.length - 1], dl = Math.hypot(dx, dz) || 1;
const spot = [pc.p[0] + 0.7 * dx / dl, pc.p[pc.p.length - 1] + 0.7 * dz / dl];
const placed = await ctx.api('/v1/god/act', { body: { note: 'proof: a catalogue watering can by a resident (local copy only)', ops: [{ op: 'place', def: 'core/watering-can@1', name, p: spot, mode: 'nudge' }] } });
console.log('placed', placed.accepted, JSON.stringify(placed.failures ?? ''));
const snap = await ctx.api('/v1/world/snapshot', { as: 'public' });
const can = snap.entities.find((e) => e.name === name);
await delay(3000);
const r = await follow(ctx, `pick-up:${can.id}`, { timeout: 300000 });
console.log('pick-up', JSON.stringify(r).slice(0, 500));
const o2 = await ctx.api('/v1/edge/observe', { as: 'soul' }); console.log('self', JSON.stringify(o2.self.position), 'can', JSON.stringify(can.p), 'offered', JSON.stringify(o2).includes('pick-up:' + can.id));
let parent = null;
for (let i = 0; i < 20; i++) { await delay(1000); const s = await ctx.api('/v1/world/snapshot', { as: 'public' }); parent = s.entities.find((e) => e.id === can.id)?.in; if (parent?.slot === 'carry') break; }
const body = (await ctx.api('/v1/world/snapshot', { as: 'public' })).entities.find((e) => e.id === parent?.parent);
console.log('can in', JSON.stringify(parent), 'body def', body?.def, 'soul', me?.name ?? '');
const log = readFileSync(`${out}/world/server.log`, 'utf8').split('\n').filter((l) => l.includes('write-back refused') && l.includes(can.id));
console.log('write-back refusals for the can:', log.length);
console.log(parent?.slot === 'carry' && !log.length ? 'PASS' : 'FAIL');
