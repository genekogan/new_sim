import { writeFileSync, rmSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { boot, addSoul, follow, stop } from './lib.mjs';
const exec = promisify(execFile), N = process.execPath;
const P = '<worktrees>/lane-mars/tools/mars-rotation/patch.mjs', rc = '<team>/scratch/mars/rot/rotation.receipt.json', tf = '<team>/scratch/mars/rot/god.tok';
if (existsSync(rc)) rmSync(rc);
const ctx = await boot({ port: 5864, template: '<worktrees>/lane-mars/worlds/templates/mars-two.json', out: '<team>/scratch/mars/rot/patch-local' });
const res = {};
const run = async (...a) => { try { const r = await exec(N, [P, '--base', ctx.base, '--receipt', rc, '--token-file', tf, ...a], { maxBuffer: 1e7 }); return r.stdout.trim(); } catch (e) { return 'FAIL ' + (e.stderr || e.message).split('\n').filter((l) => /Error|refused|assert/i.test(l)).slice(0, 2).join(' | '); } };
try {
  writeFileSync(tf, JSON.stringify({ token: ctx.god }), { mode: 0o600 });
  const snap0 = await ctx.api('/v1/world/snapshot', { as: 'public' });
  res.review = (await run('--bearing', '82')).slice(0, 400);
  res.apply = await run('--bearing', '82', '--apply'); console.log(res.apply);
  const snap1 = await ctx.api('/v1/world/snapshot', { as: 'public' });
  const t82 = JSON.parse((await import('node:fs')).readFileSync('<team>/scratch/mars/mars-two-82.json', 'utf8'));
  const want = new Map(t82.batches.flatMap((b) => b.ops.filter((o) => o.op === 'place' && !o.in).map((o) => [o.name, o])));
  let maxd = 0, n = 0; for (const e of snap1.entities) { const o = want.get(e.name); if (o?.p && e.in.parent === 'world' && e.p) { n++; maxd = Math.max(maxd, Math.abs(e.p[0] - o.p[0]), Math.abs(e.p[e.p.length - 1] - o.p[o.p.length - 1])); } }
  res.vs82 = { compared: n, maxPoseErr: maxd };
  // residents walk the live-patched world
  await addSoul(ctx); const id = (n) => snap1.entities.find((e) => e.name === n).id;
  res.walk = [];
  for (const [cap, opt] of [['walk:mimos/floor'], [`sit:${id('honey-sofa-13')}`, { seated: true, params: { seconds: 600 } }], ['walk:mimos/main'], [`sit:${id('study-chair-4')}`, { seated: true, params: { seconds: 600 } }], ['walk:kitchen/dining-hall'], ['walk:kitchen/working-kitchen']]) { const r = await follow(ctx, cap, opt ?? {}); res.walk.push({ cap: cap.slice(0, 22), ok: r.ok, code: r.code, room: r.room && r.room.building + '/' + r.room.room }); console.log(cap.slice(0, 24), r.ok, r.code ?? ''); }
  res.rollbackWithResident = await run('--rollback', '--apply');
  console.log(res.rollbackWithResident);
} catch (e) { res.error = String(e.stack ?? e); console.log(e.message); } finally { writeFileSync('<team>/scratch/mars/rot/patch-local.json', JSON.stringify(res, null, 1)); await stop(ctx); rmSync(tf, { force: true }); }
