import { boot, addSoul, follow, cliAct, stop } from './lib.mjs';
const ctx = await boot({ port: 5867, template: '<worktrees>/lane-mars/worlds/templates/mars-two.json', out: '<team>/scratch/mars/rot/bus' });
try { await addSoul(ctx); const snap = await ctx.api('/v1/world/snapshot', { as: 'public' });
 console.log((await follow(ctx,'walk:kitchen/dining-hall')).ok);
 for (const n of ['bus-seat-20','bus-seat-21','bus-seat-23','bus-seat-25']) { const e=snap.entities.find(x=>x.name===n); const a = await cliAct(ctx,`sit:${e.id}`,{seconds:30}); console.log(n, a.accepted, a.code, a.reason, JSON.stringify(a.diagnostic??'').slice(0,300)); await new Promise(r=>setTimeout(r,500)); }
 const t = await cliAct(ctx,'sit:here',{seconds:30}); console.log('here', t.accepted, t.code, t.reason, JSON.stringify(t.resolved??'').slice(0,200));
} finally { await stop(ctx); }
