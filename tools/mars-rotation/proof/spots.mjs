// Pick clear ground for the field and water patch items in a fresh local Mars (template, bearing 90). Pure local reads.
import { boot, stop } from './lib.mjs';
const ctx = await boot({ port: 5869, template: '<worktrees>/lane-mars/worlds/templates/mars-two.json', out: '<team>/scratch/mars/rot/spots' });
try {
  const snap = await ctx.api('/v1/world/snapshot', { as: 'public' });
  const fs = snap.entities.find((e) => e.name === 'freeside'); console.log('freeside', fs.p, fs.r);
  const near = (n) => snap.entities.filter((e) => e.in.parent === 'world' && e.p && Math.hypot(e.p[0] - n[0], e.p[e.p.length - 1] - n[1]) < 25).map((e) => `${e.name}@${e.p.map((v) => v.toFixed(1)).join(',')}`);
  console.log('near freeside', near([fs.p[0], fs.p[2]]).join(' '));
  for (const [what, at, size] of [['bowl', [-1.7, -49.1], [0.9, 0.9]], ['beanbag', [0.2, -49.6], [1.7, 1.6]], ['beanbag-alt', [-0.65, -51.4], [1.7, 1.6]], ['beanbag-alt2', [0.9, -48.3], [1.7, 1.6]]])
    console.log(what, at, JSON.stringify((await ctx.query({ clearance: { at, size } })).clearance));
  console.log('free by freeside', JSON.stringify((await ctx.query({ free: { size: [6, 4], near: [fs.p[0], fs.p[2]], radius: 22, count: 8 } })).free));
} finally { await stop(ctx); }
