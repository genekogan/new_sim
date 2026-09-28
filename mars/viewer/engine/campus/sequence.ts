// Skeleton-stage construction sequence for one rack building of a canonical year (owner feedback
// 2026-09-28 §7, phase A). HYPOTHETICAL: the order below is a plausible Mars-style build derived from
// the assembly graph and the engine's rules, not a documented historical sequence.
//
// Input: the year's assembly graph (assembly.ts), its bill of materials and pile yard (bom.ts).
// Output: a SequenceTemplate (bindable by sequence/bind.ts, runnable by SequenceRunner / rehearse, the
// build-bay-v3 pattern), the scenario entities (piles as bundles, the cutting station, the crew),
// the canonical targets for the comparison, and `unplaced[]` — every node of the building the
// generator did not sequence, with the reason (never faked).
//
// Layout. Frames stand in frame LINES (same coordinate along the frames' normal n) and ROWS (same
// coordinate along their across axis); a beam joins frame (k, r) to (k + 1, r) on one column at one
// seat. Frames are raised line by line: line 0 lies outward (−n) before its raise, every later line
// lies toward +n, over the bays not built yet, so nothing standing is in the way.
// Order (per bay k–k+1, row by row — the skeleton grows in tranches from one end):
//   1. frame (k+1, r) [and (0, r) for the first bay]: off its stack onto the take-out spot, carried
//      to where it lies, raised by two, taken over by a holder standing behind it (the unbuilt side),
//      the raise crew lets go;
//   2. the two low beams (seat ≤ 1.2 m): off the beam stack, carried to the line-0 end of their stage axis
//      (0.457 m outside the seat line: the aisle centre between rows, or outside the rack), walked in and hung
//      by the two who carried them (every beam is staged and walked in that way);
//   3. the two middle beams: two installers climb the frames' bracing (≤ 1 m on held frames), the two
//      carriers hand each beam up to them;
//   4. the new frame (and the first one) released: beam-stable (two levels on both columns);
//   5. the two top beams: installers climb higher on the now-stable frames, the two former holders
//      climb below them as a relay, the carriers hand each beam up, relay → installers hook it.
// Rules respected by construction and re-checked by every verb at run time: only what exists is usable
// (stances on standing frames, held frames only to 1 m), support (stability v1.1), reach (hands ≤ 2.06 m
// from the floor / stance, relay when the gap is too big), crew sizes (catalog carry / raise crews),
// material availability (one piece per take, the take-out spot cleared by its carry before the next).
// No cutting is needed for the skeleton (frames and beams are used as stocked); cuts belong to phase B.
import { datan2, obbOverlap, rot2, type Vec2 } from '../core/math.ts';
import type { Entity, Provenance } from '../world/types.ts';
import { def } from '../world/catalog.ts';
import { human } from '../world/factory.ts';
import { SEQUENCE_SCHEMA, type SequenceTemplate, type StepSpec } from '../sequence/types.ts';
import { layTargetForStanding } from '../construction/lying.ts';
import { bundleEntity } from '../construction/bundle.ts';
import { GIVE_MAX, GROUND_HANG_MAX, LOAD_OUT, rungs, STANCE_DOWN, STANCE_SEP, STANCE_UP } from '../construction/stance.ts';
import type { AsmNode, AssemblyGraph } from './assembly.ts';
import { billOfMaterials, billOfMaterialsB, morePiles, placePiles, stockPiles, type Bom, type Yard } from './bom.ts';
import { phaseBParts, type PartB, type PartsB } from './parts-b.ts';
import { phaseB, type Section } from './sequence-b.ts';
import { bundleContents } from '../construction/bundle.ts';
import type { CampusObstacle, CampusScene } from './types.ts';

export const YEAR_BUILD_VERSION = 'mars-year-build/phase-a-1';
export const YEAR_BUILD_B_VERSION = 'mars-year-build/phase-b-1';
const HYPO: Provenance = { origin: 'design-edit', confidence: 'hypothetical', note: 'year build phase A (skeleton) — hypothetical piles, crew and order, not historical' };
const AISLE_END = 1.5; // m beyond frame line 0 where an aisle beam's near end lies before it is walked in
const HOOK_MAX = 1.8; // m: installers hook a beam at most this far above their feet (margin under the 2.06 m reach, body/model.ts)
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];

export type Unplaced = { node: string; kind: string; reason: string };
export type Target = { node: string; def: string; kind: 'upright' | 'beam'; c: [number, number, number]; yaw: number };
export type YearBuildPlan = {
  version: typeof YEAR_BUILD_VERSION | typeof YEAR_BUILD_B_VERSION;
  year: number;
  assembly: string;
  template: SequenceTemplate;
  bindings: { crew: string[] };
  entities: Entity[];
  targets: Target[];
  sequenced: { node: string; kind: string; steps: string[] }[];
  unplaced: Unplaced[];
  bom: Bom;
  yard: Yard;
  groundY: number;
  /** Phase B (W13): the part map (material rules) and how many template steps are phase A's. */
  partsB?: PartsB;
  phaseAStepCount?: number;
  doneB?: string[];
  sectionStarts?: { section: string; at: number }[];
};

/**
 * The scene a year build runs on: the year scene cropped to `radius` m around the building, the
 * building's own obstacles removed (it is what gets built), the ground at the Kit datum y = 0 (the Kit
 * stands every piece on y = 0; the published year scenes draw the studio ground at −0.16 — see
 * YEAR_BUILD.md / PROGRESS "Questions for Gene").
 */
export function yearBuildScene(base: CampusScene, assembly: string, centre: Vec2, radius = 35): CampusScene {
  const bounds: [number, number, number, number] = [
    Math.max(base.bounds[0], centre[0] - radius), Math.max(base.bounds[1], centre[1] - radius),
    Math.min(base.bounds[2], centre[0] + radius), Math.min(base.bounds[3], centre[1] + radius),
  ];
  const box = { c: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] as Vec2, half: [(bounds[2] - bounds[0]) / 2, (bounds[3] - bounds[1]) / 2] as Vec2, yaw: 0 };
  const inBox = (o: CampusObstacle) => Math.abs(o.obb.c[0] - box.c[0]) <= box.half[0] + Math.max(...o.obb.half) && Math.abs(o.obb.c[1] - box.c[1]) <= box.half[1] + Math.max(...o.obb.half);
  const obstacles = base.obstacles.filter((o) => o.assembly !== assembly && inBox(o));
  const ground = { ...base.surfaces.find((s) => s.id === 'ground')!, y: 0, obb: box, label: `open ground (Kit datum y = 0) around ${assembly}` };
  return {
    ...base,
    bounds,
    levels: [{ id: 0, y: 0, label: 'ground (Kit datum)' }],
    surfaces: [ground],
    obstacles,
    regions: base.regions.filter((r) => r.id !== assembly),
    meta: { ...base.meta, groundY: 0, notes: [...base.meta.notes, `year build: ${assembly} removed (it is being built); ground at the Kit datum y = 0`] },
  };
}

type Frame = { node: AsmNode; k: number; r: number; c: Vec2 };

/** Generate the skeleton-stage plan for one building of a year. */
/** `bays`: build only the first N bays (frame lines 0…N) — a tranche; the rest is reported as outside it. */
export function yearBuildPlan(g: AssemblyGraph, scene: CampusScene, assembly: string, opts: { crew?: string[]; bays?: number; phaseB?: { sections?: readonly Section[]; only?: (p: PartB) => boolean } } = {}): YearBuildPlan {
  const crew = opts.crew ?? ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];
  if (crew.length !== 6) throw new Error('yearBuildPlan: phase A uses a crew of six');
  const nodes = g.nodes.filter((n) => n.assembly === assembly);
  const frameNodes = nodes.filter((n) => n.kind === 'upright');
  if (!frameNodes.length) throw new Error(`yearBuildPlan: ${assembly} has no classified frames`);
  const unplaced: Unplaced[] = [];
  // phase B (W13): the material rules decide the stock, and the yard gets a scrap pile by the station
  // (the phase-A yard is placed first, exactly as without phase B; the extra bundles go in after it)
  const partsB0 = opts.phaseB ? phaseBParts(g, assembly, { flip: (strip) => noRoomMinusU(strip, scene) }) : undefined;
  // a phase-B tranche (`only`): the other parts are reported as outside it
  const partsB = partsB0 && opts.phaseB?.only ? { ...partsB0, parts: partsB0.parts.filter(opts.phaseB.only) } : partsB0;
  const bomA = billOfMaterials(g, [assembly]);
  const bom = partsB ? billOfMaterialsB(g, [assembly], partsB) : bomA;
  const piles = stockPiles(bomA);
  const yard = placePiles(piles, nodes, scene.obstacles, 0, partsB ? { extra: [{ id: 'scrap-pile', def: 'scrap-pile' }], more: morePiles(bom, piles), phaseB: true } : {});
  for (const r of yard.refused) unplaced.push({ node: r.id, kind: 'pile', reason: r.reason });
  // ---- grid of frame lines × rows
  const Y = frameNodes[0].box.yaw;
  const across = rot2([1, 0], Y), n = rot2([0, 1], Y);
  const q = (x: number, step: number) => Math.round(x / step);
  const lineOf = new Map<number, number>(), rowOf = new Map<number, number>();
  const pos = frameNodes.map((f) => ({ f, s: dot([f.box.c[0], f.box.c[2]], n), t: dot([f.box.c[0], f.box.c[2]], across) }));
  for (const p of pos) { lineOf.set(q(p.s, 0.2), 0); rowOf.set(q(p.t, 0.2), 0); }
  [...lineOf.keys()].sort((a, b) => a - b).forEach((k, i) => lineOf.set(k, i));
  [...rowOf.keys()].sort((a, b) => a - b).forEach((k, i) => rowOf.set(k, i));
  const K = lineOf.size, R = rowOf.size;
  const frames: Frame[] = pos.map((p) => ({ node: p.f, k: lineOf.get(q(p.s, 0.2))!, r: rowOf.get(q(p.t, 0.2))!, c: [p.f.box.c[0], p.f.box.c[2]] }));
  const grid = new Map(frames.map((f) => [`${f.k},${f.r}`, f]));
  const frameById = new Map(frames.map((f) => [f.node.id, f]));
  // beams by bay (k, r), column side (canonical l / r of frame (k, r)), seat
  type Bm = { node: AsmNode; k: number; r: number; col: 'l' | 'r'; seat: number };
  const beams: Bm[] = [];
  for (const b of nodes.filter((x) => x.kind === 'beam')) {
    const es = g.edges.filter((e) => e.from === b.id && e.rel === 'connects-to');
    const fs = es.map((e) => frameById.get(e.to)!);
    if (fs.length !== 2 || fs.some((f) => !f) || fs[0].r !== fs[1].r || Math.abs(fs[0].k - fs[1].k) !== 1) {
      unplaced.push({ node: b.id, kind: 'beam', reason: 'does not join two adjacent frame lines of one row' });
      continue;
    }
    const lo = fs[0].k < fs[1].k ? 0 : 1;
    const col = es[lo].socket!.startsWith('coll') ? 'l' : 'r';
    beams.push({ node: b, k: fs[lo].k, r: fs[0].r, col, seat: b.seat! });
  }
  // engine yaw of each frame after its raise: lying heading φ − π/2 (line 0 lies toward −n, later lines toward +n)
  const phiOf = (k: number) => datan2(k === 0 ? -n[1] : n[1], k === 0 ? -n[0] : n[0]);
  const yawOf = (k: number) => phiOf(k) - Math.PI / 2;
  /** Engine column (of frame line k) for a canonical column of that frame. */
  const engCol = (k: number, col: 'l' | 'r'): 'l' | 'r' => {
    const cv = rot2([col === 'l' ? -1 : 1, 0], Y);
    return dot(rot2([1, 0], yawOf(k)), cv) < 0 ? 'l' : 'r';
  };
  const faceToward = (from: Frame, to: Frame): 'f' | 'b' => (dot([to.c[0] - from.c[0], to.c[1] - from.c[1]], rot2([0, 1], yawOf(from.k))) > 0 ? 'f' : 'b');
  const U = frameNodes[0].def!;
  const RUNGS = rungs(U);
  // ---- stances per seat: installers (and relay)
  const stanceFor = (seat: number) => {
    const fi = RUNGS.find((f) => seat - f <= HOOK_MAX + 1e-9 && seat - f >= 0.4);
    if (fi === undefined) return { why: `no bracing node within ${HOOK_MAX} m below the seat at ${seat.toFixed(3)} m` } as const;
    if (fi - STANCE_DOWN <= GIVE_MAX - 0.05) return { fi, fr: null } as const;
    const fr = [...RUNGS].reverse().find((f) => fi - f >= STANCE_SEP - 1e-9 && fi - STANCE_DOWN + 0.05 <= f + STANCE_UP - 0.05 && f - STANCE_DOWN <= GIVE_MAX - 0.05);
    if (fr === undefined) return { why: `installers at ${fi} m need a relay but no bracing node gives one` } as const;
    return { fi, fr } as const;
  };
  // ---- steps
  const S: StepSpec[] = [];
  const last = new Map<string, string>();
  const seq: YearBuildPlan['sequenced'] = [];
  let n_ = 0;
  const C = (i: number) => `$crew[${i}]`;
  const step = (verb: string, params: Record<string, unknown>, actors: number[], deps: string[], label?: string): string => {
    const id = `s${String(++n_).padStart(4, '0')}-${verb.replace(/_/g, '-')}`;
    const after = [...new Set([...actors.map((a) => last.get(C(a))).filter((x): x is string => !!x), ...deps])].sort();
    S.push({ id, verb, params, ...(after.length ? { after } : {}), ...(label ? { label } : {}) });
    for (const a of actors) last.set(C(a), id);
    return id;
  };
  const G = [0, 1], I = [3, 4], HOLD = [2, 5];
  // pile bookkeeping: pieces left per pile, the carry that clears each pile's take-out spot
  const left = new Map(yard.piles.map((p) => [p.id, p.count]));
  const spotClear = new Map<string, string>();
  const take = (piece: string, defId: string): { pile: string; step: string } | null => {
    const p = yard.piles.find((x) => x.piece === defId && (left.get(x.id) ?? 0) > 0);
    if (!p) return null;
    left.set(p.id, left.get(p.id)! - 1);
    const s = step('take_from_bundle', { crew: G.map(C), bundle: p.id, piece, to: p.out }, G, spotClear.has(p.id) ? [spotClear.get(p.id)!] : [], `${piece} off ${p.id}`);
    return { pile: p.id, step: s };
  };
  const side = sideOfYard(yard, frames, across);
  /** Where people wait near bay k (beside the rack on the yard side, clear of staged beams). */
  const waitAt = (k: number, i: number): { x: number; z: number } => {
    const outer = frames.reduce((m, f) => Math.max(m, side * dot(f.c, across)), -Infinity) + def(U).size[0] / 2;
    const s0 = (lineCoord(frames, k) + lineCoord(frames, Math.min(k + 1, K - 1))) / 2;
    const p = [0, 0].map((_, j) => across[j] * side * (outer + 2.0) + n[j] * (s0 + (i - 2.5) * 1.1));
    return { x: r3(p[0]), z: r3(p[1]) };
  };
  const done = new Map<string, string[]>();
  const mark = (node: string, kind: string, ...ids: string[]) => { const d = done.get(node) ?? []; d.push(...ids); done.set(node, d); };
  const raised = new Map<string, string>(); // frame node → its hold step
  const raise = (f: Frame, holder: number): string | null => {
    const t = take(f.node.id, U);
    if (!t) { unplaced.push({ node: f.node.id, kind: 'upright', reason: `no ${U} left in the piles` }); return null; }
    const phi = phiOf(f.k);
    const lay = layTargetForStanding(U, f.c, phi);
    const c = step('carry', { crew: G.map(C), item: f.node.id, to: { x: r3(lay.x), z: r3(lay.z), yaw: lay.yaw } }, G, [t.step], `carry frame ${f.node.id} to lie at line ${f.k}, row ${f.r}`);
    spotClear.set(t.pile, c);
    const rz = step('raise_upright', { crew: G.map(C), item: f.node.id, stand_at: { x: f.c[0], z: f.c[1] } }, G, [], `raise frame (${f.k}, ${f.r})`);
    const back = rot2([0, 1], yawOf(f.k)); // engine normal = the lying heading: behind = the unbuilt side
    const at = { x: r3(f.c[0] + back[0] * 0.6), z: r3(f.c[1] + back[1] * 0.6) };
    const h = step('hold_frame', { actor: C(holder), item: f.node.id, at }, [holder], [rz], `${C(holder)} holds frame (${f.k}, ${f.r}) from behind`);
    const lg = step('let_go', { actor: C(G[0]), item: f.node.id }, [G[0]], [h]);
    step('let_go', { actor: C(G[1]), item: f.node.id }, [G[1]], [lg]); // one at a time (the frame's reservation)
    raised.set(f.node.id, h);
    mark(f.node.id, 'upright', t.step, c, rz, h);
    return h;
  };
  const stage = (b: Bm): { stage: string } | null => {
    const t = take(b.node.id, b.node.def!);
    if (!t) { unplaced.push({ node: b.node.id, kind: 'beam', reason: `no ${b.node.def} left in the piles` }); return null; }
    // on the stage axis LOAD_OUT outside the seat line of its column (outward = away from the row's centre), at the
    // rack's line-0 end beyond frame line 0: the carry crew straddles a beam (one carrier each side), and
    // beside a bay one of them would stand on the seat line (on the installed low beam, or in the 0.91 m
    // aisle between rows); hang_beam's lifters walk it in along the axis
    const cv = rot2([b.col === 'l' ? -1 : 1, 0], Y);
    const mid: Vec2 = [(b.node.box.c[0]), (b.node.box.c[2])];
    const back = dot(mid, n) - (lineCoord(frames, 0) - (def(b.node.def!).size[0] / 2 + AISLE_END));
    const x = r3(mid[0] + cv[0] * LOAD_OUT - n[0] * back), z = r3(mid[1] + cv[1] * LOAD_OUT - n[1] * back);
    const c = step('carry', { crew: G.map(C), item: b.node.id, to: { x, z, yaw: r3(b.node.box.yaw) } }, G, [t.step], `carry beam ${b.node.id} to the line-0 end of its stage axis`);
    spotClear.set(t.pile, c);
    mark(b.node.id, 'beam', t.step, c);
    return { stage: c };
  };
  const hang = (b: Bm, fa: Frame, fb: Frame): boolean => {
    const st = b.seat <= GROUND_HANG_MAX ? null : stanceFor(b.seat);
    if (st && 'why' in st) { unplaced.push({ node: b.node.id, kind: 'beam', reason: st.why! }); return false; }
    const colA = engCol(fa.k, b.col);
    const params: Record<string, unknown> = { beam: b.node.id, a: fa.node.id, b: fb.node.id, column: colA, height: r3(b.seat) };
    const deps = [raised.get(fa.node.id)!, raised.get(fb.node.id)!].filter(Boolean);
    if (!st) {
      const s = stage(b);
      if (!s) return false;
      const h = step('hang_beam', { ...params, installers: G.map(C) }, G, [...deps, s.stage], `hang ${b.node.id} at ${b.seat.toFixed(2)} m from the ground`);
      mark(b.node.id, 'beam', h);
      return true;
    }
    const cBcanon = b.col; // same physical line at frame b
    const fA = faceToward(fa, fb), fB = faceToward(fb, fa);
    const climbs: string[] = [];
    climbs.push(step('climb_stance', { actor: C(I[0]), upright: fa.node.id, column: colA, face: fA, feet: st.fi }, [I[0]], deps, `${C(I[0])} climbs frame (${fa.k}, ${fa.r}) to ${st.fi} m`));
    climbs.push(step('climb_stance', { actor: C(I[1]), upright: fb.node.id, column: engCol(fb.k, cBcanon), face: fB, feet: st.fi }, [I[1]], deps, `${C(I[1])} climbs frame (${fb.k}, ${fb.r}) to ${st.fi} m`));
    if (st.fr !== null) {
      climbs.push(step('climb_stance', { actor: C(HOLD[0]), upright: fa.node.id, column: colA, face: fA, feet: st.fr }, [HOLD[0]], [climbs[0]], `relay ${C(HOLD[0])} climbs below`));
      climbs.push(step('climb_stance', { actor: C(HOLD[1]), upright: fb.node.id, column: engCol(fb.k, cBcanon), face: fB, feet: st.fr }, [HOLD[1]], [climbs[1]], `relay ${C(HOLD[1])} climbs below`));
    }
    const s = stage(b);
    if (!s) return false;
    const actors = [...I, ...G, ...(st.fr !== null ? HOLD : [])];
    const h = step('hang_beam', { ...params, installers: I.map(C), givers: G.map(C), ...(st.fr !== null ? { relay: HOLD.map(C) } : {}) }, actors, [...deps, s.stage, ...climbs],
      `${b.node.id} handed up${st.fr !== null ? ' through the relay' : ''} and hooked at ${b.seat.toFixed(2)} m`);
    // the givers step out of the aisle before anyone climbs down into it (then fetch the next beam from there)
    const out = G.map((a) => step('walk_to', { actor: C(a), ...waitAt(fa.k, a), level: 0 }, [a], [h], `${C(a)} steps out of the aisle`));
    const down = st.fr !== null ? [HOLD[0], HOLD[1], I[0], I[1]] : [I[0], I[1]];
    for (const a of down) step('leave_stance', { actor: C(a), to: waitAt(fa.k, a) }, [a], [h, ...out]);
    mark(b.node.id, 'beam', ...climbs, h);
    return true;
  };
  const bays = Math.min(K - 1, opts.bays ?? K - 1);
  for (let k = 0; k < bays; k++) {
    for (let r = 0; r < R; r++) {
      const fa = grid.get(`${k},${r}`), fb = grid.get(`${k + 1},${r}`);
      if (!fa || !fb) continue;
      if (k === 0 && !raised.has(fa.node.id) && !raise(fa, HOLD[0])) continue;
      if (!raise(fb, HOLD[1])) continue;
      const bay = beams.filter((b) => b.k === k && b.r === r).sort((x, y) => x.seat - y.seat || (x.col < y.col ? -1 : 1));
      const levels = [...new Set(bay.map((b) => b.seat.toFixed(3)))].sort((x, y) => Number(x) - Number(y));
      const need = Math.min(levels.length, def(U).size[1] > 9.5 * 0.3048 ? 2 : 1);
      // the levels that make the new frame stable (lowest `need`), then release, then the rest
      for (const lv of levels.slice(0, need)) for (const b of bay.filter((x) => x.seat.toFixed(3) === lv)) hang(b, fa, fb);
      const rel: string[] = [];
      for (const f of k === 0 ? [fa, fb] : [fb]) {
        const deps = S.filter((s) => s.verb === 'hang_beam' && (s.params.a === f.node.id || s.params.b === f.node.id)).map((s) => s.id);
        const holder = k === 0 && f === fa ? HOLD[0] : HOLD[1];
        rel.push(step('release_support', { item: f.node.id }, [holder], deps, `release frame (${f.k}, ${f.r}): beam-stable`));
        mark(f.node.id, 'upright', rel[rel.length - 1]);
      }
      for (const a of HOLD) step('walk_to', { actor: C(a), ...waitAt(k, a), level: 0 }, [a], rel);
      for (const lv of levels.slice(need)) for (const b of bay.filter((x) => x.seat.toFixed(3) === lv)) hang(b, fa, fb);
    }
  }
  // ---- phase B: decks, stair, walls, solar (sequence-b.ts)
  const phaseAStepCount = S.length;
  let resB: ReturnType<typeof phaseB> | undefined;
  if (partsB && opts.phaseB) {
    const scrap = yard.extra?.find((x) => x.id === 'scrap-pile');
    resB = phaseB({
      assembly, parts: partsB, step, C, yard, scrap: scrap ? { id: scrap.id, x: scrap.x, z: scrap.z, yaw: scrap.yaw } : null, left, spotClear,
      frames: frames.map((f) => ({ id: f.node.id, k: f.k, r: f.r, c: f.c, def: f.node.def! })), beams: beams.map((b) => ({ id: b.node.id, k: b.k, r: b.r, col: b.col, seat: b.seat })),
      engCol, Y, sections: opts.phaseB.sections, count: () => S.length,
      narrowMinusU: (v) => { const nd = partsB.kit.find((k) => k.kind === 'deck' && Math.abs(dot([k.c[0], k.c[2]], rot2([0, 1], Y)) - v) < 0.3); return !!nd && noRoomMinusU(nodes.find((x) => x.id === nd.node)!, scene); },
    });
    for (const x of resB.sequenced) done.set(x.node, x.steps);
    for (const u of [...partsB.unplaced, ...resB.unplaced]) if (!unplaced.some((v) => v.node === u.node)) unplaced.push(u);
  }
  // ---- everything not sequenced
  const seqIds = new Set(done.keys());
  const outside = (k: number) => (k > bays ? `outside the requested tranche (bays 0–${bays - 1}, frame lines 0–${bays})` : null);
  for (const f of frames) if (!seqIds.has(f.node.id) && !unplaced.some((u) => u.node === f.node.id)) unplaced.push({ node: f.node.id, kind: 'upright', reason: outside(f.k) ?? 'no bay joins it to a neighbouring frame line' });
  for (const b of beams) if (!seqIds.has(b.node.id) && !unplaced.some((u) => u.node === b.node.id)) unplaced.push({ node: b.node.id, kind: 'beam', reason: outside(b.k + 1) ?? 'not reached by the generator' });
  for (const nd of nodes) {
    if (seqIds.has(nd.id) || unplaced.some((u) => u.node === nd.id)) continue;
    if (nd.kind === 'feature' && partsB && partsB0!.parts.some((p) => p.nodes.includes(nd.id)) && opts.phaseB?.only) unplaced.push({ node: nd.id, kind: `feature:${nd.feature}`, reason: 'outside the requested phase-B tranche' });
    else if (nd.kind === 'feature' && partsB) unplaced.push({ node: nd.id, kind: `feature:${nd.feature}`, reason: bom.unresolved.find((u) => u.feature === nd.feature)?.reason ?? `no phase B rule sequences this ${nd.feature}` });
    else if (nd.kind === 'feature') unplaced.push({ node: nd.id, kind: `feature:${nd.feature}`, reason: nd.feature === 'stair-part' ? 'phase A: Kit stairs have no stringers and no catalog flight of their width (4.45 m, 8 treads, 2.22 m rise); stair verbs for them are phase B' : `phase A builds the skeleton only; ${nd.feature} is phase B` });
    else unplaced.push({ node: nd.id, kind: nd.kind, reason: 'not reached by the generator' });
  }
  for (const [id, ids] of done) { const nd = nodes.find((x) => x.id === id)!; seq.push({ node: id, kind: nd.kind === 'feature' ? `feature:${nd.feature}` : nd.kind, steps: ids }); }
  seq.sort((a, b) => (a.node < b.node ? -1 : 1));
  unplaced.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.node < b.node ? -1 : 1));
  const targets: Target[] = seq.filter((s) => s.kind === 'upright' || s.kind === 'beam').map((s) => {
    const nd = nodes.find((x) => x.id === s.node)!;
    return { node: nd.id, def: nd.def!, kind: nd.kind as 'upright' | 'beam', c: nd.box.c, yaw: nd.box.yaw };
  });
  // ---- scenario entities: piles, cutting station, crew at their first waiting spots
  const entities: Entity[] = [];
  for (const p of yard.piles) entities.push(bundleEntity(p.id, p.def, p.x, p.z, p.yaw, p.count, 0, HYPO));
  if (yard.station) entities.push({ id: 'cutting-station', def: 'cutting-station', kind: 'fixture', label: 'cutting station', pose: { p: [yard.station.x, 0, yard.station.z], yaw: yard.station.yaw }, provenance: HYPO });
  for (const x of yard.extra ?? []) entities.push({ id: x.id, def: x.def, kind: 'fixture', label: def(x.def).label, pose: { p: [x.x, 0, x.z], yaw: x.yaw }, provenance: HYPO, contents: bundleContents(x.def, 0) });
  crew.forEach((id, i) => { const w = waitAt(0, i); entities.push(human(id, w.x, w.z, { provenance: HYPO, label: `builder ${i + 1}` })); });
  const template: SequenceTemplate = {
    schema: SEQUENCE_SCHEMA,
    id: `year-build-${g.year}-${assembly}-${partsB ? 'phase-ab' : 'skeleton'}${bays < K - 1 ? `-bays${bays}` : ''}`,
    label: `Mars ${g.year} ${assembly}: ${partsB ? 'skeleton, floors, stair, walls and solar' : 'skeleton stage'} from the piles (hypothetical order; phase ${partsB ? 'A+B' : 'A'})`,
    params: { crew: { kind: 'actors', description: 'six builders: 0–1 carry / give, 2 and 5 hold / relay, 3–4 install on the bracing' } },
    steps: S,
  };
  return { version: partsB ? YEAR_BUILD_B_VERSION : YEAR_BUILD_VERSION, year: g.year, assembly, template, bindings: { crew }, entities, targets, sequenced: seq, unplaced, bom, yard, groundY: 0, ...(partsB ? { partsB, phaseAStepCount, doneB: resB?.done ?? [], sectionStarts: resB?.sectionStarts ?? [] } : {}) };
}

function lineCoord(frames: Frame[], k: number): number {
  const f = frames.find((x) => x.k === k)!;
  const n = rot2([0, 1], f.node.box.yaw);
  return dot(f.c, n);
}

/** Which side (±1 along the frames' across axis) of the building the yard is on (sides only; ends → +1). */
function sideOfYard(yard: Yard, frames: Frame[], across: Vec2): 1 | -1 {
  if (!yard.piles.length) return 1;
  const cx = yard.piles.reduce((s, p) => s + p.x, 0) / yard.piles.length, cz = yard.piles.reduce((s, p) => s + p.z, 0) / yard.piles.length;
  const mid = frames.reduce((s, f) => s + dot(f.c, across), 0) / frames.length;
  return dot([cx, cz], across) >= mid ? 1 : -1;
}

/**
 * Phase B: is the ground beside a deck strip's −u end (its long axis) taken — something 0.22–2.2 m tall within 2.3 m of
 * the house there (a neighbour's stair, a wall)? Then its long pieces go up on the +u side (parts-b.ts flip).
 */
function noRoomMinusU(strip: AsmNode, scene: CampusScene): boolean {
  const u = rot2([1, 0], strip.box.yaw);
  const c: Vec2 = [strip.box.c[0] - u[0] * (strip.box.size[0] / 2 + 1.2), strip.box.c[2] - u[1] * (strip.box.size[0] / 2 + 1.2)];
  const band = { c, half: [1.1, strip.box.size[2] / 2] as Vec2, yaw: strip.box.yaw };
  return scene.obstacles.some((o) => o.y1 > 0.22 && o.y0 < 2.2 && obbOverlap(o.obb, band));
}
