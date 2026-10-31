import { boot, addSoul, follow, cliAct, stop, MARS_TWO_TEMPLATE } from './lib.mjs';
import { scratchDir } from '../../lib/paths.mjs';
const ctx = await boot({ port: 5869, template: MARS_TWO_TEMPLATE, out: scratchDir('mars/rot/w5') });
try {
 const r = await ctx.api('/v1/god/act', { body: { note: 'provisioning probe', ops: [
  { op: 'place', def: 'core/water-tank@1', name: 'tank', p: [10, -5] },
  { op: 'place', def: 'core/watering-can@1', name: 'can', p: [8, -4] },
  { op: 'place', def: 'core/potted-plant@1', name: 'plant', p: [12, -4] },
  { op: 'place', def: 'core/planter-box@1', name: 'planter', p: [12, -7] },
  { op: 'place', def: 'core/rain-barrel@1', name: 'barrel', p: [6, -6] } ] } });
 console.log('placed', r.accepted, JSON.stringify(r.failures ?? '').slice(0, 300));
 for (const n of ['tank', 'can', 'plant', 'planter', 'barrel']) { const d = (await ctx.query({ describe: n })).describe; console.log(n, JSON.stringify({ behaviours: d.behaviours, slots: d.slots, state: d.state, params: d.params })); }
 await addSoul(ctx);
 const caps = await ctx.api('/v1/edge/capabilities', { as: 'soul' }); console.log([...new Set(caps.capabilities.map((c) => c.verb))].join(' '));

 const lv = async (n) => (await ctx.query({ describe: n })).describe.state;
 const id = (n) => ctx.ids?.[n];
 const snap = await ctx.api('/v1/world/snapshot', { as: 'public' }); const E = (n) => snap.entities.find((e) => e.name === n).id;
 const step = async (cap, p) => { const r = await follow(ctx, cap, { params: p }); console.log(cap.slice(0, 40), r.ok, r.code ?? '', r.reason ?? ''); return r; };
 await step('walk:can'); await step(`pick-up:${E('can')}`);
 console.log('can', await lv('can'), 'tank', await lv('tank'));
 await step('walk:tank'); 
 let caps2 = await ctx.api('/v1/edge/capabilities', { as: 'soul' }); console.log(caps2.capabilities.filter((c) => /object|water|pour|fill/.test(c.id + c.label)).map((c) => c.id + ' | ' + c.label).join('\n'));
 await step(`object:${E('tank')}:fill`); console.log('after tank fill: can', await lv('can'), 'tank', await lv('tank'));
 await step('walk:plant'); caps2 = await ctx.api('/v1/edge/capabilities', { as: 'soul' }); console.log(caps2.capabilities.filter((c) => /object|water|pour|empty/.test(c.id + c.label)).map((c) => c.id + ' | ' + c.label).join('\n'));
} finally { await stop(ctx); }
