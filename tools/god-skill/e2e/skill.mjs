#!/usr/bin/env node
// L7 e2e: the god skill as a client agent uses it — the single-file CLI against a fresh world, every
// relation of the solver, bulk selection, groups and group undo, export → import round trip, the
// diagnostics, the offline mirror, and a lint that every command SKILL.md teaches exists in the CLI.
// No browser (look is exercised by the examples).
//   node tools/god-skill/e2e/skill.mjs [--port 5153] [--keep]
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startWorld } from '../dev-world.mjs';
import { argv } from '../examples/_harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(here, '../eden-god.mjs');
const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1] || 5153) || 5153;
const results = [];
const check = (name, cond, detail = '') => { results.push({ name, ok: !!cond }); console.log(`${cond ? '✔' : '✖'} ${name}${cond ? '' : ' — ' + String(detail).slice(0, 400)}`); };

// ---- lint: every command in SKILL.md exists (and the bundle is fresh)
const skill = readFileSync(resolve(here, '../SKILL.md'), 'utf8');
const { COMMANDS } = await import(CLI);
const taught = new Set();
for (const block of skill.matchAll(/```\n([\s\S]*?)```/g)) for (const line of block[1].split('\n')) { const w = line.trim().replace(/^node eden-god\.mjs\s+/, '').split(/\s+/)[0]; if (w && /^[a-z][a-z-]*$/.test(w) && !['mkdir', 'curl', 'cd', 'local'].includes(w)) taught.add(w); }
for (const m of skill.matchAll(/`([a-z][a-z-]+)(?: [^`]*)?`/g)) if (COMMANDS[m[1]] === undefined && /^(map|defs|place|move|set|recolor|remove|clone|select|group|undo|redo|history|look|describe|where|free|plan|preview|resolve|schema|define|define-kit|export|import|sky|weather|constitution|expand|flag|flags|prayers|answer|furnish|register|pair|mint)$/.test(m[1])) taught.add(m[1]);
const missing = [...taught].filter((c) => !COMMANDS[c]);
check(`SKILL.md teaches only real commands (${taught.size} checked)`, missing.length === 0, missing.join(', '));
check(`SKILL.md is ≤ 400 lines (${skill.split('\n').length})`, skill.split('\n').length <= 400);
const fresh = spawnSync(process.execPath, [resolve(here, '../build.mjs'), '--check'], { encoding: 'utf8' });
check('eden-god.mjs bundle is fresh', fresh.status === 0, fresh.stderr);

// ---- a fresh world and a folder like a client agent's
const { child, base } = await startWorld({ slug: 'skill-e2e', port, fresh: true });
const dir = mkdtempSync(resolve(tmpdir(), 'eden-god-e2e-'));
const g = (line) => { const r = spawnSync(process.execPath, [CLI, ...argv(line)], { cwd: dir, encoding: 'utf8' }); return { ok: r.status === 0 && !/REFUSED/.test(r.stdout), out: (r.stdout + r.stderr).trim() }; };
const j = (line) => JSON.parse(g(line).out);
const ent = (path) => j(`describe ${path} --json`);
try {
  check('register + mint', g(`register ${base} dev:admin`).ok && g('mint').ok);
  check('place with a refusal-free hamlet', g('place cottage --at 0,0 --facing s --name home').ok && g('place fountain --at 0,30 --name fountain').ok);
  // near + facing
  let r = g('place bench --near fountain --facing fountain --name b1');
  const b1 = ent('b1');
  check('near: outside the fountain, within 6 m, facing it', r.ok && Math.hypot(b1.pose.x, b1.pose.z - 30) > 2 && Math.hypot(b1.pose.x, b1.pose.z - 30) < 8 && b1.constraints.find((c) => c.kind === 'facing')?.ok, r.out);
  r = g('place bench --near fountain --count 3 --facing fountain --dist 1.5 --name ring');
  check('near --count 3: three benches, all facing the fountain', r.ok && ['ring-1', 'ring-2', 'ring-3'].every((n) => ent(n).constraints.find((c) => c.kind === 'facing')?.ok), r.out);
  // collision repair: a bench right on the fountain gets moved and says so
  r = g('place bench --at fountain --name squeezed');
  check('at an occupied spot: repaired (suggestion or nudge) and reported', r.ok && /blocked|suggest|nudge/.test(r.out), r.out);
  // against
  r = g('place wall --against home.n --name back-wall');
  const bw = ent('back-wall');
  check('against home.n: north of the cottage, flush', r.ok && bw.pose.z < -3 && bw.pose.z > -4, r.out);
  // between
  g('flag a --at -20,0'); g('flag b --at 20,0');
  r = g('place rock --between flag:a flag:b --name mid');
  check('between two flags: the midpoint', r.ok && Math.abs(ent('mid').pose.x) < 0.5 && Math.abs(ent('mid').pose.z) < 0.5 || /blocked/.test(r.out), r.out);
  // a building with rooms (define one from building/1 so this runs on any build)
  g(`define '${JSON.stringify({ name: 'e2e-house', make: { kind: 'gen', gen: 'building/1' }, size: { box: [8, 6, 6] }, tags: ['building'] })}'`);
  check('a two-floor building', g('place e2e-house@1 --at 40,0 --param floors=2 --param w=10 --param d=8 --name house').ok);
  const house = ent('house');
  check('describe lists rooms on two floors and a door', house.rooms.length >= 2 && new Set(house.rooms.map((x) => x.floor)).size >= 2 && house.openings.some((o) => o.kind === 'door'), JSON.stringify(house.rooms));
  const up = house.rooms.find((x) => x.floor >= 1).id, down = house.rooms.find((x) => x.floor === 0).id;
  r = g(`place table --inside house/${down} --name table`);
  check('inside: the table is in the ground-floor room', r.ok && ent('house/table').in.slot === down, r.out);
  r = g(`place chair --inside house/${down} --count 2 --facing house/table --name chair`);
  check('inside --count 2: two chairs beside the table, facing it', r.ok && ent('house/chair-1').in.parent === 'house' && ent('house/chair-2').constraints.some((c) => c.kind === 'facing'), r.out);
  r = g(`place chair --inside house/${up} --corner ne --name corner-chair`);
  check('inside --corner ne upstairs', r.ok && ent('house/corner-chair').in.slot === up, r.out);
  r = g('place bowl --on house/table --name bowl');
  check('on: the bowl on the table top', r.ok && ent('house/table/bowl').in.slot === 'top', r.out);
  check('inside a thing without rooms is explained', /no rooms/.test(g('place chair --inside fountain').out));
  // paths: road from/to, along with sides, across
  g(`define '${JSON.stringify({ name: 'e2e-road', form: 'path', layer: 'surface', make: { kind: 'gen', gen: 'road/1' }, size: { box: [6, 0.1, 6] } })}'`);
  r = g('place e2e-road@1 --from home --to house --width 5 --name lane');
  check('a road from the cottage to the house (edges, not centres)', r.ok, r.out);
  g(`define '${JSON.stringify({ name: 'e2e-road2', form: 'path', layer: 'surface', make: { kind: 'gen', gen: 'road/1' }, size: { box: [6, 0.1, 6] } })}'`);
  r = g(`place e2e-road2@1 --path '[[-100,80],[100,80]]' --width 6 --name avenue`);
  r = g('place lamp-post --along avenue --row 3 --gap 20 --side left --offset 1 --name north-lamp');
  const nl = [1, 2, 3].map((k) => ent(`north-lamp-${k}`));
  check('along avenue, left side = north (walker\'s left going east)', r.ok && nl.every((x) => x.pose.z < 80 - 3), r.out + JSON.stringify(nl.map((x) => x.pose)));
  r = g('place lamp-post --along avenue --row 3 --gap 20 --side right --offset 1 --name south-lamp');
  check('along avenue, right side = south', r.ok && [1, 2, 3].every((k) => ent(`south-lamp-${k}`).pose.z > 80 + 3), r.out);
  check('along constraints hold after placement', /all constraints hold|0 constraint/.test(g('resolve').out) || !/along/.test(g('resolve').out), g('resolve').out);
  // select + bulk, groups + group undo
  const before = j('select --def lamp-post --json').length;
  r = g('select --def lamp-post --near avenue --radius 200 --recolor #223344');
  check('select + bulk recolor in one batch', r.ok && /changed/.test(r.out), r.out);
  g('group orchard');
  g('place tree --at -60,-60 --grid 3x2 --gap 4 --name orchard');
  g('place tree --near orchard-1 --dist 6 --name stray');
  g('group --off');
  const nTrees = j('select --def tree --json').length;
  r = g('undo --group orchard');
  check('undo --group removes the whole group', r.ok && j('select --def tree --json').length === nTrees - 7 && before > 0, r.out);
  // diagnostics
  const w = j('where 40,0 --json');
  check('where: inside the house, in a room', w.room?.building === 'house', JSON.stringify(w));
  check('free plots', /\(/.test(g('free 10x10 --near home').out));
  check('history shows edits with their ops', /place cottage/.test(g('history 50').out));
  check('plan describes a batch without building it', /would be accepted/.test(g(`plan '${JSON.stringify({ ops: [{ op: 'place', def: 'core/rock@1', p: [-90, -90] }] })}'`).out));
  check('preview gives a ghost URL', /preview=pv_/.test(g(`preview '${JSON.stringify({ ops: [{ op: 'place', def: 'core/rock@1', p: [-90, -90] }] })}'`).out));
  check('defs search', /core\/bench@1/.test(g('defs bench').out));
  check('define-kit (search first, then define)', /defined birdbath@1/.test(g(`define-kit '${JSON.stringify({ name: 'birdbath', tags: ['garden'], shapes: [{ kind: 'cyl', at: [0, 0, 0], r: 0.18, h: 0.8, material: 'stone' }, { kind: 'cyl', at: [0, 0.8, 0], r: 0.5, h: 0.12, material: 'stone' }] })}'`).out) && g('place birdbath@1 --near home --dir e').ok);
  // export → import into a second world
  const n0 = j('select --all --json').length;
  r = g('export world.genesis.json');
  check('export writes genesis/1', r.ok && existsSync(resolve(dir, 'world.genesis.json')), r.out);
  const two = await startWorld({ slug: 'skill-e2e-2', port: port + 1, fresh: true });
  const dir2 = mkdtempSync(resolve(tmpdir(), 'eden-god-e2e2-'));
  const g2 = (line) => { const x = spawnSync(process.execPath, [CLI, ...argv(line)], { cwd: dir2, encoding: 'utf8' }); return { ok: x.status === 0 && !/REFUSED/.test(x.stdout), out: (x.stdout + x.stderr).trim() }; };
  g2(`register ${two.base} dev:admin`); g2('mint');
  r = g2(`import ${resolve(dir, 'world.genesis.json')}`);
  const n1 = JSON.parse(g2('select --all --json').out).length;
  check(`import rebuilds the world (${n1} of ${n0} things)`, r.ok && n1 === n0, r.out);
  two.child.kill(); rmSync(dir2, { recursive: true, force: true });
  // offline mirror: the server goes away, reads still answer from the cache
  child.kill(); await new Promise((res) => setTimeout(res, 800));
  r = g('map');
  check('offline: map answers from the mirror and says so', r.ok && /OFFLINE/.test(r.out), r.out);
} catch (e) { check('harness', false, e.stack); }
finally { try { child.kill(); } catch { /* gone */ } if (!args.includes('--keep')) rmSync(dir, { recursive: true, force: true }); }
const failed = results.filter((x) => !x.ok).length;
console.log(`\n${failed ? '✖' : '✔'} skill e2e: ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
