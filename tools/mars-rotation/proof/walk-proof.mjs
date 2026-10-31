import { writeFileSync } from 'node:fs';
import { boot, addSoul, follow, stop, MARS_TWO_TEMPLATE } from './lib.mjs';
import { scratchDir } from '../../lib/paths.mjs';
const b = process.argv[2], port = Number(process.argv[3]);
const tpl = b === '90' ? MARS_TWO_TEMPLATE : scratchDir(`mars/mars-two-${b}.json`);
const out = scratchDir(`mars/rot/walk-${b}`);
const ctx = await boot({ port, template: tpl, out });
const res = { bearing: Number(b), steps: [] };
try {
  const snap = await ctx.api('/v1/world/snapshot', { as: 'public' });
  const id = (n) => snap.entities.find((e) => e.name === n).id;
  await addSoul(ctx);
  const plan = [['walk:mimos/floor'], [`sit:${id('honey-sofa-13')}`, { seated: true, params: { seconds: 600 } }], ['walk:mimos/main-south'], [`sit:${id('red-sofa-12')}`, { seated: true, params: { seconds: 600 } }],
    ['walk:mimos/main'], [`sit:${id('study-chair-4')}`, { seated: true, params: { seconds: 600 } }], ['walk:kitchen/dining-hall'], [`sit:${id('bus-seat-20')}`, { seated: true, params: { seconds: 600 } }],
    ['walk:kitchen/working-kitchen'], ['walk:mimos/floor'], ['walk:shower-1'].slice(0,0)].filter((s) => s.length);
  for (const [cap, opt] of plan) { const r = await follow(ctx, cap, opt ?? {}); res.steps.push(r); console.log(b, cap.slice(0, 40), r.ok ?? r.phase, r.code ?? '', r.room ? `${r.room.building}/${r.room.room}` : '', r.ms ?? ''); writeFileSync(`${out}.json`, JSON.stringify(res, null, 1)); }
} catch (e) { res.error = String(e.stack ?? e); console.log('ERR', e.message); }
finally { writeFileSync(`${out}.json`, JSON.stringify(res, null, 1)); await stop(ctx); }
