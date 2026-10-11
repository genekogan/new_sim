#!/usr/bin/env node
// L7 e2e for the R1 limits a stranger hit (docs/god/R1-NOTES.md "Honest limits"), as the single-file CLI meets
// them on a fresh world: things on tables and in rooms move in the world frame, house-relative walls and
// corners keep doorways clear and stay inside round rooms, several things on one table spread, rims not
// bounding boxes, footpaths from the door, a row's name as a set, unreadable arguments refused, one def in
// full, sky palettes and weather that keep each other, the served examples. No browser.
//   node tools/god-skill/e2e/r1-limits.mjs [--port 5155] [--keep]
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startWorld } from '../dev-world.mjs';
import { argv } from '../examples/_harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(here, '../eden-god.mjs');
const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1] || 5155) || 5155;
const results = [];
const check = (name, cond, detail = '') => { results.push({ name, ok: !!cond }); console.log(`${cond ? '✔' : '✖'} ${name}${cond ? '' : ' — ' + String(detail).slice(0, 500)}`); };

const { child, base } = await startWorld({ slug: 'r1-limits', port, fresh: true });
const dir = mkdtempSync(resolve(tmpdir(), 'eden-god-r1-'));
const g = (line) => { const r = spawnSync(process.execPath, [CLI, ...argv(line)], { cwd: dir, encoding: 'utf8' }); return { ok: r.status === 0 && !/REFUSED/.test(r.stdout), status: r.status, out: (r.stdout + r.stderr).trim() }; };
const j = (line) => JSON.parse(g(line).out);
const ent = (path) => j(`describe ${path} --json`);
const inPoly = (x, z, poly) => { let c = false; for (let i = 0, k = poly.length - 1; i < poly.length; k = i++) { const [xi, zi] = poly[i], [xk, zk] = poly[k]; if ((zi > z) !== (zk > z) && x < ((xk - xi) * (z - zi)) / (zk - zi) + xi) c = !c; } return c; };
try {
  check('register + mint', g(`register ${base} dev:admin`).ok && g('mint').ok);
  // a round house facing north (its door on the north side), a table, two cups
  let r = g('place lighthouse --at -60,-10 --facing n --param floors=1 --param w=8 --param d=8 --name slate');
  check('a round house facing north', r.ok, r.out);
  const house = ent('slate'), room = house.rooms[0];
  const door = house.openings.find((o) => o.kind === 'door');
  r = g(`place round-table --inside slate/${room.id} --name table`);
  r = g('place cup --on slate/table --count 2');
  const c1 = ent('slate/table/cup'), c2 = ent('slate/table/cup-2');
  check('--on table --count 2: two cups at different points', r.ok && Math.hypot(c1.pose.x - c2.pose.x, c1.pose.z - c2.pose.z) > 0.15, `${r.out}\n${JSON.stringify([c1.pose, c2.pose])}`);
  r = g('move slate/table/cup-2 --by 0.1,0');
  const c2b = ent('slate/table/cup-2');
  check('move <thing on a table> --by: no crash, moved in the world frame, still on the table', r.ok && Math.abs(c2b.pose.x - c2.pose.x - 0.1) < 0.03 && c2b.in.parent !== 'world', r.out);
  // walls and corners: house-relative, doorways clear, inside the round wall
  r = g(`place bed --inside slate/${room.id} --wall front --name bed`);
  const bed = ent('slate/bed');
  check('--wall front (the door side) keeps the doorway clear', r.ok && Math.hypot(bed.pose.x - door.at[0], bed.pose.z - door.at[1]) > 1.2, `${r.out} door ${door.at}`);
  r = g(`place bookshelf --inside slate/${room.id} --wall back --name shelf`);
  check('--wall back of a house facing north is its south side', r.ok && ent('slate/shelf').pose.z > -10 + 1.5, r.out);
  r = g(`place floor-lamp --inside slate/${room.id} --corner back-left --name lamp`);
  const lamp = ent('slate/lamp');
  check('--corner in a round room stays inside the wall', r.ok && inPoly(lamp.pose.x, lamp.pose.z, room.polygon) && Math.hypot(lamp.pose.x + 60, lamp.pose.z + 10) < 3.6, `${r.out} ${JSON.stringify(lamp.pose)}`);
  r = g('move slate/lamp --near slate/bed --dir e --dist 0.3');
  const lamp2 = ent('slate/lamp');
  check('move <room item> --near <room item>: stays in the room, beside the bed', r.ok && lamp2.in.parent !== 'world' && Math.hypot(lamp2.pose.x - bed.pose.x, lamp2.pose.z - bed.pose.z) < 3.5, `${r.out} ${JSON.stringify(lamp2.pose)}`);
  r = g('place chair --inside slate --wall up');
  check('a bad wall word is refused with the words that work', !r.ok && /back, front, left, right/.test(r.out), r.out);
  r = g(`describe slate/${room.id}`);
  check('describe <house>/<room>: that room', r.ok && new RegExp(`room .* of slate`).test(r.out) && /holds: .*bed/.test(r.out), r.out);
  g('place cottage --at 40,-40 --facing s --name box');
  const living = ent('box').rooms[0].id;
  r = g(`place wardrobe --inside box/${living} --corner back-left --name wardrobe`);
  const wd = ent('box/wardrobe');
  check('--corner back-left in a square room: back to the back wall, not diagonal', r.ok && wd.pose.faces === 's', `${r.out} faces ${wd.pose.faces}`);
  // rims, footpaths from doors, sets
  g('place pond --circle 80,60,16 --name pond');
  r = g('place reeds --near pond --count 6 --dist 0.5');
  const reeds = [1, 2, 3, 4, 5, 6].map((k) => ent(k === 1 ? 'reeds' : `reeds-${k}`));
  check('--near <area> --count: round the rim, not the bounding-box corners', r.ok && reeds.every((x) => { const d = Math.hypot(x.pose.x - 80, x.pose.z - 60); return d > 13 && d < 19.5; }), reeds.map((x) => `${x.pose.x},${x.pose.z}`).join(' '));
  g("place road --path '[[-140,12],[-90,-10],[-40,-26],[10,-26],[50,-12]]' --width 5 --name lane");
  g('place roundhouse --along lane --t 0.5 --side left --offset 4 --name rose');
  r = g('place footpath --from rose --to lane --name rose-path');
  const rd = ent('rose').openings.find((o) => o.kind === 'door'), fp = ent('rose-path').shape.path;
  check('footpath --from <house> --to <road>: from the door to the nearest point of the road', r.ok && Math.hypot(fp[0][0] - rd.at[0], fp[0][1] - rd.at[1]) < 1.6 && Math.hypot(fp.at(-1)[0] - fp[0][0], fp.at(-1)[1] - fp[0][1]) < 12, `${r.out} ${JSON.stringify(fp)} door ${rd.at}`);
  g('place parasol-table --at 0,60 --row 3 --gap 3 --name stall');
  r = g('place crate --near stall --dir s');
  check('a row\'s name refers to the set (--near stall)', r.ok, r.out);
  r = g('remove stall');
  check('remove <set> removes every member', r.ok && /stall-1, stall-2, stall-3/.test(r.out), r.out);
  // unreadable arguments are refused, never ignored
  r = g("place dog --at 0,0 '--param floors=1 --param w=8'");
  check('several options in one quoted argument: refused', r.status === 2 && /ONE argument/.test(r.out), r.out);
  r = g('place duck --float pond');
  check('an extra word: refused', r.status === 2 && /cannot read: "pond"/.test(r.out), r.out);
  r = g('place tree --at 0,0 --colour red');
  check('an unknown option: refused', r.status === 2 && /no option --colour/.test(r.out), r.out);
  r = g('place tree --at 0,0 --count many');
  check('a non-number: refused', r.status === 2 && /takes a number/.test(r.out), r.out);
  // one def in full
  r = g('defs core/roundhouse@1');
  check('defs <full ref>: that def with its params', r.ok && /^core\/roundhouse@1/.test(r.out) && /params \(--param/.test(r.out) && /rooms at the defaults: living/.test(r.out), r.out.slice(0, 300));
  // sky and weather
  r = g('sky');
  check('sky alone lists the palettes and changes nothing', r.ok && /golden-hour/.test(r.out) && /night/.test(r.out), r.out);
  r = g('sky --palette purple-haze');
  check('an unknown palette is refused', !r.ok && /unknown sky palette/.test(r.out), r.out);
  g('sky --palette golden-hour --sun 0.35'); g('weather --clouds 0.4');
  r = g('sky');
  check('weather keeps the sky (and sky keeps the weather)', /sky golden-hour, sun 0.35; weather clouds 0.4/.test(r.out), r.out);
  // examples served next to the CLI
  r = g('examples hamlet');
  check('examples <name>: the served transcript, saved next to the CLI', r.ok && /place knoll/.test(r.out) && existsSync(resolve(dir, 'examples/hamlet.log')), r.out.slice(0, 300));
} finally {
  if (!args.includes('--keep')) { child.kill(); rmSync(dir, { recursive: true, force: true }); }
}
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
