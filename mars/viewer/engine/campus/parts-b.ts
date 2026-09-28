// Year build phase B (owner feedback 2026-09-28 §7, §9; W13): what each Kit feature of a rack building is
// made of, as engine parts with target poses — the material rules. HYPOTHETICAL / PROVISIONAL throughout:
// the procedural reconstruction (app/history/kit.ts) draws decks, stairs, walls and solar as plain boxes,
// several of them through each other (deck sheets through frame planes and 8 cm into their beams, walls
// centred on beam lines, rail posts inside the end frame). Each rule below places real lumber / sheet goods
// where they can physically be and states its offset from the Kit drawing; anything a rule cannot place is
// returned in `unplaced` with the reason — never forced.
//
//   deck sheet (Kit strip 4 ft × L)  → plywood pieces laid straight on the beams (rules.ts beamDeckRule),
//        joints ON beams, each piece a whole-foot 4 ft sheet ≤ 8 ft (the 2022 15 ft strip: 6 + 6 + 3 ft),
//        notched (catalog-phase-b.ts) where the strip's long edge lies on a frame line. Offset: the sheet
//        rests on the beams' top (the Kit centres it on the beam centreline: its top 3.8 cm below the beams').
//   plywood wall (Kit W × H)          → 4 ft panels stood up, cut to H (2.23 / 2.20 m), a 3 ft ripped panel for
//        a 3 ft remainder; plane: against the outer face of the beam line / frame plane the Kit centres the
//        wall on (offset = member half thickness + half the panel, outward).
//   stair (Kit n treads)              → six 2x12 stringers (two under each frame at the top frame line), two
//        2x10 boards per tread (centred on the Kit tread), 2x12 risers, 2x4 posts bolted to the tread ends and
//        2x4 handrails on the post tops, only for the 2022 rack-house template (KIT_STAIR_2022).
//   solar panel (Kit module)          → a catalog panel of the Kit module's size on two panel rails on the
//        deck under it (rails ∥ the tilt axis, shared by two neighbouring panels), tilted as the Kit tilts it.
import { datan, datan2, dcos, dot2, dsin, obbOverlap, rot2, type OBB2, type Vec2 } from '../core/math.ts';
import { CATALOG, def } from '../world/catalog.ts';
import { KIT_STAIR_2022, kitStringerGeometry, BOARD_T, TREAD_BOARD_W, TREAD_BACK_W, TREAD_PAIR } from '../world/catalog-phase-b.ts';
import type { Pose } from '../world/types.ts';
import type { AsmNode, AssemblyGraph } from './assembly.ts';
import type { KitStair } from '../construction/setpart.ts';

export const PARTS_B_VERSION = 'mars-year-build-parts/b1';
/** Risers: the rule exists (2x10 on the tread below) but no verb can set one yet — reported unplaced. */
const RISERS = false;
const FT = 0.3048;
const PLY_T = 0.01905;
const SHEET_W = 4 * FT;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const hyp = (a: number, b: number) => Math.sqrt(a * a + b * b);

export type PartKind = 'deck' | 'wall' | 'stair' | 'solar';
export type PartRole = 'deck-piece' | 'wall-panel' | 'stringer' | 'tread-board' | 'riser' | 'post' | 'handrail' | 'panel' | 'panel-rail';
export type PartB = {
  /** Engine entity id. */
  id: string;
  /** Kit node(s) the part (helps) reproduce; rails serve two panels. */
  nodes: string[];
  kind: PartKind;
  role: PartRole;
  def: string;
  /** Stock piece taken off a bundle, and whether it is cut (to `def`) at the station. */
  stock: string;
  cut: boolean;
  /** Target pose (engine convention: base centre, yaw, roll / pitch). */
  pose: Pose;
  /** Where it goes, for sequencing: level y of the surface it rests on / hangs from, a sort key, side (±1 along x of the building). */
  y: number;
  key: number[];
  meta: Record<string, number | string>;
};
export type KitRef = { node: string; kind: PartKind; feature: string; c: [number, number, number]; yaw: number; size: [number, number, number]; offset: string };
export type UnplacedB = { node: string; kind: string; reason: string };
export type PartsB = { version: typeof PARTS_B_VERSION; assembly: string; parts: PartB[]; kit: KitRef[]; unplaced: UnplacedB[]; stairs: KitStair[] };

const axisU = (yaw: number): Vec2 => rot2([1, 0], yaw);
const axisV = (yaw: number): Vec2 => rot2([0, 1], yaw);
const xz = (n: AsmNode): Vec2 => [n.box.c[0], n.box.c[2]];
const plan = (n: AsmNode): OBB2 => ({ c: xz(n), half: [n.box.size[0] / 2, n.box.size[2] / 2], yaw: n.box.yaw });

/** Engine top of a Kit beam node: its seat (box centre) + half the catalog beam height. */
export const beamTop = (b: AsmNode) => r4(b.box.c[1] + def(b.def!).size[1] / 2);

/** Map every phase-B feature of `assembly` to engine parts (deterministic, sorted). */
/**
 * `opts.flip(strip)`: split this deck strip from its +u end (its short piece on the −u side) — the generator asks for
 * it where there is no room beside the house on the −u side to raise the long pieces (e.g. a neighbour's stair).
 */
export function phaseBParts(g: AssemblyGraph, assembly: string, opts: { flip?: (strip: AsmNode) => boolean } = {}): PartsB {
  const nodes = g.nodes.filter((n) => n.assembly === assembly);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const frames = nodes.filter((n) => n.kind === 'upright');
  const beams = nodes.filter((n) => n.kind === 'beam');
  const parts: PartB[] = [];
  const kit: KitRef[] = [];
  const unplaced: UnplacedB[] = [];
  const stairs: KitStair[] = [];
  const un = (n: AsmNode, reason: string) => unplaced.push({ node: n.id, kind: `feature:${n.feature}`, reason });
  const centre: Vec2 = frames.length ? [frames.reduce((s, f) => s + f.box.c[0], 0) / frames.length, frames.reduce((s, f) => s + f.box.c[2], 0) / frames.length] : [0, 0];
  const deckSheets = nodes.filter((n) => n.feature === 'deck-sheet');
  // ---------------- decks
  for (const n of deckSheets) {
    if (!/plywood deck sheet/.test(n.kitDef)) { un(n, `"${n.kitDef}" is not a plywood deck strip (no material rule)`); continue; }
    const under = g.edges.filter((e) => e.from === n.id && (e.rel === 'supported-by' || e.rel === 'rests-on')).map((e) => byId.get(e.to)!).filter((b) => b?.kind === 'beam');
    if (under.length < 2) { un(n, `rests on ${under.length} beam(s) in the Kit; a sheet needs ≥ 2`); continue; }
    const u = axisU(n.box.yaw), v = axisV(n.box.yaw);
    if (under.some((b) => Math.abs(dot2(axisU(b.box.yaw), u)) > 0.02)) { un(n, 'its beams do not run across the strip'); continue; }
    if (Math.abs(n.box.size[2] - SHEET_W) > 0.012) { un(n, `strip width ${n.box.size[2].toFixed(3)} m is not a 4 ft sheet`); continue; }
    const cu = dot2(xz(n), u), cv = dot2(xz(n), v);
    const s0 = cu - n.box.size[0] / 2, s1 = cu + n.box.size[0] / 2;
    const pos = [...new Set(under.map((b) => r4(dot2(xz(b), u))))].sort((a, b) => a - b);
    const top = Math.max(...under.map(beamTop));
    if (under.some((b) => Math.abs(beamTop(b) - top) > 0.005)) { un(n, 'its beams are not level'); continue; }
    if (Math.abs(pos[0] - s0) > 0.01 || Math.abs(pos[pos.length - 1] - s1) > 0.01) { un(n, `strip ends (${s0.toFixed(3)} / ${s1.toFixed(3)} along it) are not on beams (${pos[0].toFixed(3)} / ${pos[pos.length - 1].toFixed(3)})`); continue; }
    // greedy: from one end, the farthest beam ≤ 8 ft away at a whole-foot distance (joints on beams); from the +u end when flipped
    const pieces: [number, number, number][] = [];
    const whole = (d: number) => d <= 8 * FT + 0.01 && Math.abs(d / FT - Math.round(d / FT)) * FT <= 0.01;
    let bad = '';
    if (opts.flip?.(n)) {
      let s = pos[pos.length - 1];
      while (s > pos[0] + 0.01) {
        const c = pos.filter((b) => b < s - 0.01 && whole(s - b))[0];
        if (c === undefined) { bad = `no beam within 8 ft of ${s.toFixed(3)} at a whole-foot distance: the strip cannot be cut into 4 ft sheets jointed on its beams`; break; }
        pieces.unshift([c, s, Math.round((s - c) / FT)]);
        s = c;
      }
    } else {
      let s = pos[0];
      while (s < pos[pos.length - 1] - 0.01) {
        const c = pos.filter((b) => b > s + 0.01 && whole(b - s)).pop();
        if (c === undefined) { bad = `no beam within 8 ft of ${s.toFixed(3)} at a whole-foot distance: the strip cannot be cut into 4 ft sheets jointed on its beams`; break; }
        pieces.push([s, c, Math.round((c - s) / FT)]);
        s = c;
      }
    }
    if (bad) { un(n, bad); continue; }
    const level = r4(n.box.c[1]);
    const ref: KitRef = { node: n.id, kind: 'deck', feature: n.kitDef, c: n.box.c, yaw: n.box.yaw, size: n.box.size, offset: `on the beams: top ${(top + PLY_T - n.box.y1).toFixed(3)} m above the Kit's (the Kit centres its sheets on the beam centreline)` };
    const out: PartB[] = [];
    for (const [i, [a, b, ft]] of pieces.entries()) {
      const mid = (a + b) / 2;
      const c: Vec2 = [u[0] * mid + v[0] * cv, u[1] * mid + v[1] * cv];
      const fp: OBB2 = { c, half: [(b - a) / 2, SHEET_W / 2], yaw: n.box.yaw };
      const notched = frames.some((f) => obbOverlap(fp, plan(f), -0.01));
      const d = `plywood-4x${ft}${notched ? 'n' : ''}`;
      if (!CATALOG[d]) { bad = `no ${notched ? 'notched ' : ''}4x${ft} plywood def for piece ${i + 1}`; break; }
      out.push({
        id: `${n.id}-p${i + 1}`, nodes: [n.id], kind: 'deck', role: 'deck-piece', def: d, stock: 'plywood-4x8', cut: d !== 'plywood-4x8',
        pose: { p: [r4(c[0]), top, r4(c[1])], yaw: n.box.yaw }, y: top, key: [level, cv, i], meta: { piece: i + 1, of: pieces.length, ft, notched: notched ? 1 : 0, level, along: r4(mid), strip: r4(cv) },
      });
    }
    if (bad) { un(n, bad); continue; }
    parts.push(...out);
    kit.push(ref);
  }
  // ---------------- walls
  for (const n of nodes.filter((x) => x.feature === 'wall')) {
    if (!/plywood wall/.test(n.kitDef)) { un(n, `"${n.kitDef}" has no material rule (plywood walls only)`); continue; }
    const [W, H] = [n.box.size[0], n.box.size[1]];
    const hd = [['2230mm', 2.23], ['2200mm', 2.2]].find(([, h]) => Math.abs((h as number) - H) <= 0.01)?.[0] as string | undefined;
    if (!hd) { un(n, `wall height ${H.toFixed(3)} m has no panel def (2.23 / 2.20 m)`); continue; }
    const n4 = Math.floor((W + 0.01) / SHEET_W);
    const rest = W - n4 * SHEET_W;
    const widths: number[] = Array.from({ length: n4 }, () => 4);
    if (rest > 0.01) {
      if (Math.abs(rest - 3 * FT) <= 0.01 && CATALOG[`plywood-3x${hd}`]) widths.push(3);
      else { un(n, `wall ${W.toFixed(3)} m wide leaves ${rest.toFixed(3)} m after ${n4} 4 ft panels: no panel rule`); continue; }
    }
    const u = axisU(n.box.yaw), nv = axisV(n.box.yaw);
    const c0 = xz(n);
    // the rack line the Kit centres the wall on: a beam line (beams running along it) or a frame plane
    const onBeam = beams.some((b) => Math.abs(dot2(axisU(b.box.yaw), u)) > 0.98 && Math.abs(dot2([b.box.c[0] - c0[0], b.box.c[2] - c0[1]], nv)) < 0.01 && b.box.y0 < n.box.y1 && b.box.y1 > n.box.y0);
    const onFrame = frames.some((f) => Math.abs(dot2(axisU(f.box.yaw), u)) > 0.98 && Math.abs(dot2([f.box.c[0] - c0[0], f.box.c[2] - c0[1]], nv)) < 0.01);
    if (!onBeam && !onFrame) { un(n, 'no rack beam line or frame plane behind it to fasten to'); continue; }
    const half = onBeam ? def('beam-12ft').size[2] / 2 : def(frames[0].def!).size[2] / 2;
    const out = Math.sign(dot2([c0[0] - centre[0], c0[1] - centre[1]], nv)) || 1;
    const off = out * (half + PLY_T / 2);
    const cu = dot2(c0, u), cvv = dot2(c0, nv) + off;
    let a = cu - W / 2;
    const ps: PartB[] = [];
    for (const [i, wf] of widths.entries()) {
      const w = wf * FT, mid = a + w / 2;
      a += w;
      const d = `plywood-${wf}x${hd}`;
      const cen: Vec2 = [u[0] * mid + nv[0] * cvv, u[1] * mid + nv[1] * cvv];
      // standing panel: roll π/2 (local x up), local z along the wall; yaw so local z ∥ u: rot2([0,1], yaw) = u
      const yaw = datan2(-u[0], u[1]);
      const th = rot2([-PLY_T / 2, 0], yaw); // box centre offset from the pose origin (local y → −X)
      const Hd = def(d).size[0];
      ps.push({
        id: `${n.id}-p${i + 1}`, nodes: [n.id], kind: 'wall', role: 'wall-panel', def: d, stock: 'plywood-4x8', cut: true,
        pose: { p: [r4(cen[0] - th[0]), r4(n.box.y0 + Hd / 2), r4(cen[1] - th[1])], yaw: r4(yaw), roll: Math.PI / 2 },
        y: r4(n.box.y0), key: [r4(n.box.y0), i], meta: { panel: i + 1, of: widths.length, ft: wf, line: onBeam ? 'beam' : 'frame', out, rip: wf === 3 ? 1 : 0 },
      });
    }
    parts.push(...ps);
    kit.push({ node: n.id, kind: 'wall', feature: n.kitDef, c: n.box.c, yaw: n.box.yaw, size: n.box.size, offset: `${(half + PLY_T / 2).toFixed(4)} m outward: against the outer face of the ${onBeam ? 'beam line' : 'frame plane'} the Kit centres the wall on` });
  }
  // ---------------- stair
  stairParts(nodes, frames, parts, kit, unplaced, stairs);
  // ---------------- solar
  solarParts(nodes, deckSheets, beams, byId, g, parts, kit, unplaced);
  parts.sort((a, b) => (a.id < b.id ? -1 : 1));
  kit.sort((a, b) => (a.node < b.node ? -1 : 1));
  unplaced.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.node < b.node ? -1 : 1));
  return { version: PARTS_B_VERSION, assembly, parts, kit, unplaced, stairs };
}

function stairParts(nodes: AsmNode[], frames: AsmNode[], parts: PartB[], kit: KitRef[], unplaced: UnplacedB[], stairs: KitStair[]) {
  const st = nodes.filter((n) => n.feature === 'stair-part');
  if (!st.length) return;
  const un = (n: AsmNode, reason: string) => unplaced.push({ node: n.id, kind: 'feature:stair-part', reason });
  const treads = st.filter((n) => n.kitDef === 'stair tread').sort((a, b) => a.box.c[1] - b.box.c[1]);
  const T = KIT_STAIR_2022;
  const going = T.run / T.treads, riser = T.rise / T.treads;
  const why = (() => {
    if (treads.length !== T.treads) return `${treads.length} treads (the stringer rule covers the 2022 rack-house stair: ${T.treads})`;
    if (treads.some((t) => Math.abs(t.box.size[0] - T.width) > 0.01)) return `tread width ${treads[0].box.size[0].toFixed(3)} m ≠ ${T.width.toFixed(3)} m`;
    for (let i = 1; i < treads.length; i++) {
      const d = hyp(treads[i].box.c[0] - treads[i - 1].box.c[0], treads[i].box.c[2] - treads[i - 1].box.c[2]);
      if (Math.abs(d - going) > 0.01 || Math.abs(treads[i].box.c[1] - treads[i - 1].box.c[1] - riser) > 0.01) return `tread spacing ${d.toFixed(3)} / ${(treads[i].box.c[1] - treads[i - 1].box.c[1]).toFixed(3)} m ≠ going ${going.toFixed(3)} / rise ${riser.toFixed(4)} m`;
    }
    return null;
  })();
  if (why) { for (const n of st) un(n, `stair template has no stringer rule: ${why}`); return; }
  const t1 = treads[0], tn = treads[treads.length - 1];
  const along = axisU(t1.box.yaw); // tread long axis
  const dv: Vec2 = [tn.box.c[0] - t1.box.c[0], tn.box.c[2] - t1.box.c[2]];
  const dl = hyp(dv[0], dv[1]);
  const dir: Vec2 = [dv[0] / dl, dv[1] / dl]; // ascent, horizontal
  const depth = t1.box.size[2];
  const front: Vec2 = [t1.box.c[0] - dir[0] * depth / 2, t1.box.c[2] - dir[1] * depth / 2]; // s = 0, tread 1 front edge
  const sOf = (p: Vec2) => dot2([p[0] - front[0], p[1] - front[1]], dir);
  const lat0 = dot2(xz(t1), along);
  const tw = T.width;
  const at = (s: number, lat: number): Vec2 => [front[0] + dir[0] * s + along[0] * (lat - dot2(front, along)), front[1] + dir[1] * s + along[1] * (lat - dot2(front, along))];
  const G = kitStringerGeometry(T);
  // the frames at the top: their plane across dir, at tread n's slot end (the stair's top frame line)
  const slotEnd = sOf(xz(tn)) + going / 2;
  const top = frames.filter((f) => Math.abs(dot2(axisU(f.box.yaw), along)) > 0.98 && Math.abs(sOf(xz(f)) - slotEnd) < 0.03);
  const lo = lat0 - tw / 2, hi = lat0 + tw / 2;
  const stringerLat: number[] = [];
  for (const f of top.sort((a, b) => dot2(xz(a), along) - dot2(xz(b), along))) {
    const fc = dot2(xz(f), along), fh = f.box.size[0] / 2;
    for (const l of [fc - fh + 0.086, fc + fh - 0.086]) {
      const ll = Math.max(lo + 0.024, Math.min(hi - 0.024, l));
      if (ll > fc - fh + 0.019 && ll < fc + fh - 0.019) stringerLat.push(r4(ll));
    }
  }
  if (stringerLat.length < 2) { for (const n of st) un(n, `no end frame at the stair's top (${top.length} found) for the stringers to bear on`); return; }
  // stair axes: yaw of a part whose local x runs up the stair
  const yawUp = datan2(dir[1], dir[0]);
  const alongYaw = t1.box.yaw;
  const theta = datan(G.tan);
  const ref = (n: AsmNode, offset: string) => kit.push({ node: n.id, kind: 'stair', feature: n.kitDef, c: n.box.c, yaw: n.box.yaw, size: n.box.size, offset });
  // stringers
  const baseY = t1.box.y1 - (0.24 + 0.03 + riser); // the Kit stair's datum under tread 1 (its floor at 0.24 + …)
  const pS = G.sFrame - (G.L / 2) * G.cos; // base-centre s (its lower-front... forward-most corner at the frame face)
  const stairId = `${t1.id.replace(/-stair-tread-.*/, '')}-stair`;
  for (const [i, l] of stringerLat.entries()) {
    const c = at(pS, l);
    parts.push({
      id: `${stairId}-stringer-${i + 1}`, nodes: treads.map((t) => t.id), kind: 'stair', role: 'stringer', def: 'stair-stringer-kit8', stock: '2x12-14ft', cut: true,
      pose: { p: [r4(c[0]), r4(baseY + (G.L / 2) * G.sin), r4(c[1])], yaw: r4(yawUp), roll: theta }, y: baseY, key: [0, i], meta: { lat: l, n: stringerLat.length },
    });
  }
  stairs.push({
    id: stairId, stringers: stringerLat.map((_, i) => `${stairId}-stringer-${i + 1}`), treads: treads.map((t) => [`${t.id}-b1`, `${t.id}-b2`]), tops: treads.map((t) => r4(t.box.y1)),
    foot: [r4(front[0]), r4(front[1])], dir: [r4(dir[0]), r4(dir[1])], width: tw, topY: r4(tn.box.y1), baseY: r4(baseY), going, heading: r4(yawUp),
  });
  // tread boards: two per Kit tread, centred on it, tops at the Kit tread top; the top tread's back board notched
  for (const [i, t] of treads.entries()) {
    const sc = sOf(xz(t));
    // front 2x10, back 2x8, the pair centred on the Kit tread
    for (const [k, ds] of [-TREAD_PAIR / 2 + TREAD_BOARD_W / 2, TREAD_PAIR / 2 - TREAD_BACK_W / 2].entries()) {
      const c = at(sc + ds, lat0);
      const d = k === 0 ? 'stair-tread-board-kit' : i === treads.length - 1 ? 'stair-tread-board-kit-8n' : 'stair-tread-board-kit-8';
      parts.push({
        id: `${t.id}-b${k + 1}`, nodes: [t.id], kind: 'stair', role: 'tread-board', def: d, stock: k === 0 ? '2x10-16ft' : '2x8-16ft', cut: true,
        pose: { p: [r4(c[0]), r4(t.box.y1 - BOARD_T), r4(c[1])], yaw: r4(alongYaw) }, y: r4(t.box.y1), key: [1, i, k], meta: { tread: i + 1, board: k + 1 },
      });
    }
    ref(t, `a 2x10 + a 2x8 (0.419 m) centred on the Kit tread (0.448 m); tops at the Kit tread top`);
  }
  // risers: 2x12 on edge at the Kit riser, where the Kit riser is a full riser
  for (const r of st.filter((n) => n.kitDef === 'stair riser')) {
    if (Math.abs(r.box.size[1] - riser) > 0.02) { un(r, `Kit riser is ${r.box.size[1].toFixed(3)} m tall (a full riser is ${riser.toFixed(4)} m): a sliver with no lumber rule`); continue; }
    if (!RISERS) { un(r, `a riser stands in the slot between two treads (${r.box.y0.toFixed(2)}–${r.box.y1.toFixed(2)} m up): the set_part crews bring a board in only from the front, through the tread below — a lengthwise insertion from the stair's side is not modelled`); continue; }
    // on edge ON the tread below (its top = the Kit riser's top − rise + 0.03, the Kit tread's half thickness)
    const y0 = r4(r.box.y1 - riser + 0.03);
    parts.push({
      id: r.id, nodes: [r.id], kind: 'stair', role: 'riser', def: 'stair-riser-kit', stock: '2x10-16ft', cut: true,
      pose: { p: [r4(r.box.c[0]), y0, r4(r.box.c[2])], yaw: r4(alongYaw) }, y: y0, key: [2, sOf(xz(r))], meta: {},
    });
    ref(r, 'a 2x10 on edge standing on the tread below, under the tread above (the Kit riser is 0.2775 m, drawn through the treads)');
  }
  // posts: 2x4 stood up, bolted to the tread ends, just outboard of them (the Kit draws them through the tread ends)
  const post = def('stair-post-kit').size;
  for (const p of st.filter((n) => n.kitDef === 'stair rail post')) {
    const lat = dot2(xz(p), along), side = lat < lat0 ? -1 : 1;
    const inFrame = frames.find((f) => obbOverlap({ c: xz(p), half: [post[1] / 2, post[2] / 2], yaw: yawUp }, plan(f), -0.01));
    if (inFrame) { un(p, `the Kit draws this post inside end frame ${inFrame.id} (its column is the post there)`); continue; }
    const ll = lat0 + side * (tw / 2 + post[2] / 2);
    const s = sOf(xz(p));
    // stood up (roll π/2) its 3.5 in side runs from the pose origin back along −dir: origin half of it up-stair
    const c = at(s + post[1] / 2, ll);
    parts.push({
      id: p.id, nodes: [p.id], kind: 'stair', role: 'post', def: 'stair-post-kit', stock: '2x4-8ft', cut: true,
      pose: { p: [r4(c[0]), r4(p.box.y0 + post[0] / 2), r4(c[1])], yaw: r4(yawUp), roll: Math.PI / 2 }, y: r4(p.box.y0), key: [3, s], meta: { side, s: r4(s) },
    });
    ref(p, `${(post[2] / 2).toFixed(4)} m outboard: bolted to the tread ends (the Kit draws the post through them)`);
  }
  // handrails: 2x4 on edge along the Kit rail line, bearing on the post tops
  const rl = def('stair-handrail-kit').size;
  for (const r of st.filter((n) => n.kitDef === 'stair rail')) {
    const lat = dot2(xz(r), along), side = lat < lat0 ? -1 : 1;
    const ll = lat0 + side * (tw / 2 + post[2] / 2);
    const mid = at(sOf(xz(r)), ll);
    // bottom-face centre on the rod line through the post tops; the rod runs through the Kit box centre
    parts.push({
      id: r.id, nodes: [r.id], kind: 'stair', role: 'handrail', def: 'stair-handrail-kit', stock: '2x4-16ft', cut: true,
      pose: { p: [r4(mid[0]), r4(r.box.c[1]), r4(mid[1])], yaw: r4(yawUp), roll: theta }, y: r4(r.box.c[1]), key: [4, side], meta: { side, length: r4(rl[0]) },
    });
    ref(r, `bears on the post tops: centre ${(rl[1] / 2).toFixed(4)} m above the Kit rod line, ${(post[2] / 2).toFixed(4)} m outboard`);
  }
  for (const n of st.filter((x) => !['stair tread', 'stair riser', 'stair rail post', 'stair rail'].includes(x.kitDef))) un(n, `"${n.kitDef}" has no stair material rule`);
}

function solarParts(nodes: AsmNode[], decks: AsmNode[], beams: AsmNode[], byId: Map<string, AsmNode>, g: AssemblyGraph, parts: PartB[], kit: KitRef[], unplaced: UnplacedB[]) {
  const sol = nodes.filter((n) => n.feature === 'solar');
  if (!sol.length) return;
  const panels = sol.filter((n) => /solar panel/.test(n.kitDef));
  const cells = sol.filter((n) => /photovoltaic/.test(n.kitDef));
  const un = (n: AsmNode, reason: string) => unplaced.push({ node: n.id, kind: 'feature:solar', reason });
  const defs = Object.values(CATALOG).filter((d) => d.category === 'solar' && d.id.startsWith('solar-panel-'));
  type P = { n: AsmNode; d: string; tilt: number; u: Vec2; axis: Vec2; high: 1 | -1; deckTop: number; deck: OBB2 };
  const ok: P[] = [];
  const cellOf = new Map<string, AsmNode>();
  for (const n of panels) {
    const [bx, by, bz] = n.box.size;
    let hit: { d: string; t: number } | null = null;
    for (const d of defs) {
      const [L, Th, W] = d.size;
      if (Math.abs(W - bz) > 0.01) continue;
      // solve L sin t + T cos t = by for t in [0, 60°] (bisection; monotone there)
      let a = 0, b = Math.PI / 3;
      const f = (t: number) => L * dsin(t) + Th * dcos(t) - by;
      if (f(a) > 0.01 || f(b) < -0.01) continue;
      for (let k = 0; k < 60; k++) { const m = (a + b) / 2; if (f(m) > 0) b = m; else a = m; }
      const t = (a + b) / 2;
      if (Math.abs(L * dcos(t) + Th * dsin(t) - bx) > 0.01) continue;
      hit = { d: d.id, t };
      break;
    }
    if (!hit) { un(n, `no catalog panel of the Kit module's size (${bx.toFixed(3)} × ${by.toFixed(3)} × ${bz.toFixed(3)} m box)`); continue; }
    // the deck under it (the roof deck): the highest deck strip level of the assembly under its centre
    const under = decks.filter((d) => d.box.y1 <= n.box.y0 + 0.1 && obbOverlap({ c: xz(n), half: [0.05, 0.05], yaw: 0 }, plan(d)));
    if (!under.length) { un(n, 'no deck under it for its rails'); continue; }
    const topY = Math.max(...under.map((d) => d.box.y1));
    const roof = decks.filter((d) => Math.abs(d.box.y1 - topY) < 0.01);
    const bs = g.edges.filter((e) => roof.some((r) => r.id === e.from)).map((e) => byId.get(e.to)!).filter((b) => b?.kind === 'beam');
    if (!bs.length) { un(n, 'its deck has no beams'); continue; }
    const deckTop = Math.max(...bs.map(beamTop)) + PLY_T;
    // the roof deck's plan extent along the panel's tilted axis
    const u = axisU(n.box.yaw), axis = axisV(n.box.yaw);
    const ext = roof.flatMap((d) => [-1, 1].flatMap((sx) => [-1, 1].map((sz) => { const w = rot2([sx * d.box.size[0] / 2, sz * d.box.size[2] / 2], d.box.yaw); return dot2([d.box.c[0] + w[0], d.box.c[2] + w[1]], u); })));
    const deck: OBB2 = { c: [0, 0], half: [Math.min(...ext), Math.max(...ext)], yaw: 0 }; // (min, max) along u
    // high edge: the Kit's cell overlay sits on the top face, offset along the face normal (which leans away from the high edge)
    const c = cells.filter((x) => hyp(x.box.c[0] - n.box.c[0], x.box.c[2] - n.box.c[2]) < 0.1).sort((a, b) => hyp(a.box.c[0] - n.box.c[0], a.box.c[2] - n.box.c[2]) - hyp(b.box.c[0] - n.box.c[0], b.box.c[2] - n.box.c[2]))[0];
    if (!c) { un(n, 'no cell overlay to tell which edge is high'); continue; }
    cellOf.set(n.id, c);
    const lean = dot2([c.box.c[0] - n.box.c[0], c.box.c[2] - n.box.c[2]], u);
    ok.push({ n, d: hit.d, tilt: hit.t, u, axis, high: lean < 0 ? 1 : -1, deckTop, deck });
  }
  for (const c of cells) if (![...cellOf.values()].includes(c)) un(c, 'cell overlay of a panel that is not placed');
  // one rail pair per panel (∥ the tilt axis, under its low and high sides), shifted along the row to clear the frame
  // columns that stand above the roof deck at every frame line (the 16 ft frames top out 5 cm above a deck on the top beams)
  const railL = def('panel-rail').size[0];
  const railH = def('panel-rail').size[1];
  const frames = nodes.filter((n) => n.kind === 'upright');
  let ri = 0;
  const sorted = [...ok].sort((a, b) => dot2(xz(a.n), a.u) - dot2(xz(b.n), b.u) || dot2(xz(a.n), a.axis) - dot2(xz(b.n), b.axis));
  for (const q of sorted) {
    const [L, Th, Wd] = def(q.d).size;
    const cu = dot2(xz(q.n), q.u);
    const half = (L * dcos(q.tilt)) / 2;
    const lo = Math.max(q.deck.half[0] + 0.03, cu - half + 0.12), hi = Math.min(q.deck.half[1] - 0.03, cu + half - 0.12);
    if (hi - lo < 0.6) { un(q.n, `its rails would not fit on the deck under it (${(hi - lo).toFixed(2)} m between them)`); continue; }
    const cv = dot2(xz(q.n), q.axis);
    // frame planes across the axis whose columns stand under the rails' lines
    const planes = frames.filter((f) => Math.abs(dot2(axisU(f.box.yaw), q.u)) > 0.98 && [lo, hi].some((lu) => Math.abs(dot2(xz(f), q.u) - lu) <= f.box.size[0] / 2 + 0.02)).map((f) => ({ v: dot2(xz(f), q.axis), t: f.box.size[2] / 2 + 0.01 }));
    let shift: number | null = null;
    for (let k = 0; k <= 100; k++) for (const sgn of k ? [1, -1] : [1]) {
      if (shift !== null) break;
      const sh = sgn * k * 0.01;
      const r0 = cv + sh - railL / 2, r1 = cv + sh + railL / 2;
      const overlap = Math.min(r1, cv + Wd / 2) - Math.max(r0, cv - Wd / 2);
      if (overlap < 0.3) continue;
      if (planes.some((pl) => r1 > pl.v - pl.t && r0 < pl.v + pl.t)) continue;
      shift = sh;
    }
    if (shift === null) { un(q.n, `a 2.1 m rail under it would cross a frame line whose columns stand above the roof deck`); continue; }
    const railIds: string[] = [];
    for (const lu of [lo, hi]) {
      const id = `${q.n.assembly}-panel-rail-${String(++ri).padStart(2, '0')}`;
      railIds.push(id);
      const c: Vec2 = [q.u[0] * lu + q.axis[0] * (cv + shift), q.u[1] * lu + q.axis[1] * (cv + shift)];
      parts.push({
        id, nodes: [q.n.id], kind: 'solar', role: 'panel-rail', def: 'panel-rail', stock: 'panel-rail', cut: false,
        pose: { p: [r4(c[0]), r4(q.deckTop), r4(c[1])], yaw: r4(datan2(q.axis[1], q.axis[0])) }, y: r4(q.deckTop), key: [ri], meta: { u: r4(lu), shift: r4(shift) },
      });
    }
    {
      {
        const yr = q.deckTop + railH;
        // flat on the rails with local x toward the high edge, then rolled +tilt about the rails (solar.ts tiltedPose):
        // box centre = pose origin + rotated (0, T/2, 0) → origin x = Kit centre + (T/2) sin t toward the high side
        const yaw = datan2(q.u[1] * q.high, q.u[0] * q.high);
        const cu2 = dot2(xz(q.n), q.u) + q.high * (Th / 2) * dsin(q.tilt);
        const cv2 = dot2(xz(q.n), q.axis);
        const c: Vec2 = [q.u[0] * cu2 + q.axis[0] * cv2, q.u[1] * cu2 + q.axis[1] * cv2];
        parts.push({
          id: q.n.id, nodes: [q.n.id, cellOf.get(q.n.id)!.id], kind: 'solar', role: 'panel', def: q.d, stock: q.d, cut: false,
          pose: { p: [r4(c[0]), r4(yr + (L / 2) * dsin(q.tilt)), r4(c[1])], yaw: r4(yaw), roll: r4(q.tilt) }, y: r4(yr), key: [cv2], meta: { rails: railIds.join(','), tilt: r4(q.tilt * 180 / Math.PI), flatX: r4(c[0]), flatZ: r4(c[1]), flatY: r4(yr) },
        });
        const kc = q.n.box.c[1], ec = yr + (L / 2) * dsin(q.tilt) + (Th / 2) * dcos(q.tilt);
        kit.push({ node: q.n.id, kind: 'solar', feature: q.n.kitDef, c: q.n.box.c, yaw: q.n.box.yaw, size: q.n.box.size, offset: `on panel rails on the roof deck: centre ${(ec - kc).toFixed(3)} m above the Kit's (the Kit draws the module's low edge into its deck, with no rails)` });
        const cn = cellOf.get(q.n.id)!;
        kit.push({ node: cn.id, kind: 'solar', feature: cn.kitDef, c: cn.box.c, yaw: cn.box.yaw, size: cn.box.size, offset: `part of panel ${q.n.id}` });
      }
    }
  }
}
