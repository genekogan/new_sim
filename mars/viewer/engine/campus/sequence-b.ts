// Year build phase B (owner feedback 2026-09-28 §7, §9; W13): after the skeleton, the floors, the stair, the walls and
// the solar array of one rack house, in the Mars order — HYPOTHETICAL (order, piles, crew and every choreography
// choice are a plausible Mars-style build derived from the Kit and the engine's rules, not documented history).
//
// Sections (each a run of steps appended to the phase-A template; people keep their per-actor order):
//   D0  ground-floor deck (0.22 m beams): each strip's pieces off the 4x8 bundles, cut (and notched) at the station,
//       offcuts stacked on the scrap pile, carried to beside the house and laid from the ground (install_plywood);
//   D1  first-floor deck (2.48 m): the first strip over the far frame line is received by four people who climbed the
//       end frames onto the beams; every later strip by people kneeling on the strip laid before it (pass_up from
//       two givers outside the edge, one receiver, install_plywood fastens it with a second person);
//   S   the Kit stair (2x12 stringers bolted to the end frame, 2x10 tread boards bottom to top, risers, posts,
//       handrails): the top treads are set by a builder standing on the treads below (climb_stair) — the stair's
//       walking link is usable only once every stringer and tread is in and the landing deck exists;
//   D2  roof deck (4.757 m): a relay kneeling at the first-floor deck edge takes each piece from the ground givers
//       and raises it to the receivers up top (on the roof beams for the first strip, then on the roof deck);
//   W   plywood walls: ground panels stood by two on the ground, screwed to the low beam from the ground and to the
//       2.48 m beam from the first-floor deck; the end wall to the frames; the upper wall raised to a take crew on
//       the first-floor deck and screwed from both decks;
//   P   solar, last (§9): rails and panels passed up through the relay onto the roof deck, rails fastened, panels
//       tilted and fastened (install_panel) where its crew can stand at both ends of the tilt axis;
//   END everyone down: the deck crews by the stair, the roof crew along the roof beams to the far frame.
// Every rule is re-checked by the verbs at run time; what the generator cannot do is returned in `unplaced` with
// the reason (e.g. panels whose neighbours leave install_panel no station).
import { datan2, dot2, rot2, type Vec2 } from '../core/math.ts';
import { def } from '../world/catalog.ts';
import { cutPlan } from '../construction/cut.ts';
import { localToWorld } from '../construction/setpart.ts';
import type { PartB, PartsB, UnplacedB } from './parts-b.ts';
import type { Yard } from './bom.ts';
import { defaultSortOrder } from '../core/order.ts';

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const BEAM_HALF = 0.0254, PLY_T = 0.01905, SHEET_HALF = 0.6096;
export const SECTIONS = ['D0', 'D1', 'D2', 'S', 'W', 'P', 'END'] as const;
export type Section = (typeof SECTIONS)[number];

export type PhaseBCtx = {
  assembly: string;
  parts: PartsB;
  step: (verb: string, params: Record<string, unknown>, actors: number[], deps: string[], label?: string) => string;
  C: (i: number) => string;
  yard: Yard;
  scrap: { id: string; x: number; z: number; yaw: number } | null;
  left: Map<string, number>;
  spotClear: Map<string, string>;
  frames: { id: string; k: number; r: number; c: Vec2; def: string }[];
  beams: { id: string; k: number; r: number; col: 'l' | 'r'; seat: number }[];
  engCol: (k: number, col: 'l' | 'r') => 'l' | 'r';
  Y: number;
  sections?: readonly Section[];
  /** Template steps so far (to record where each section starts). */
  count: () => number;
  /** Every crew member's last step so far (the section barrier). */
  lastSteps: () => string[];
  /** Is the ground beside the house on its −u side taken near local v (a neighbour's stair)? The givers then hold the pieces by their sides. */
  narrowMinusU: (v: number) => boolean;
  /** The same beyond the +u end (W38): a strip's middle piece then goes in from the −u side, when that side is open. */
  narrowPlusU?: (v: number) => boolean;
  /** W38: is this ground plot clear of the build scene's obstacles (0.05–1.3 m tall)? */
  groundFree?: (o: { c: Vec2; half: Vec2; yaw: number }, minTop?: number) => boolean;
  /** Crew positions at the start of phase B when run from a snapshot (sections only). */
};
export type PhaseBResult = { sequenced: { node: string; kind: string; steps: string[] }[]; unplaced: UnplacedB[]; done: string[]; sectionStarts: { section: Section; at: number }[] };

export function phaseB(ctx: PhaseBCtx): PhaseBResult {
  const { C, parts } = ctx;
  // section barriers (the Mars order): each crew member's first step of a section waits for everyone's last step of the
  // sections before it — otherwise a crew member free early starts, e.g., climbing onto a deck not laid yet
  let gate: string[] = [];
  const seen = new Set<number>();
  const step = (verb: string, params: Record<string, unknown>, actors: number[], deps: string[], label?: string): string => {
    const fresh = actors.filter((a) => !seen.has(a));
    for (const a of fresh) seen.add(a);
    return ctx.step(verb, params, actors, fresh.length ? [...new Set([...deps, ...gate])] : deps, label);
  };
  const secs = new Set(ctx.sections ?? SECTIONS);
  const G = [0, 1];
  const U = rot2([1, 0], ctx.Y), V = rot2([0, 1], ctx.Y);
  const W = (u: number, v: number): Vec2 => [r3(U[0] * u + V[0] * v), r3(U[1] * u + V[1] * v)];
  const Lc = (p: Vec2): Vec2 => [dot2(p, U), dot2(p, V)];
  const fr = ctx.frames;
  const depth = def(fr[0].def).size[0], fh = def(fr[0].def).size[2] / 2;
  const uMin = Math.min(...fr.map((f) => Lc(f.c)[0])) - depth / 2, uMax = Math.max(...fr.map((f) => Lc(f.c)[0])) + depth / 2;
  const K = Math.max(...fr.map((f) => f.k)) + 1;
  const lineV = (k: number) => Lc(fr.find((f) => f.k === k)!.c)[1];
  const safeV = (v: number, u: number) => {
    // a spot on a deck at local (u, v) clear of the frame planes (0.36 m) and of the deck edges
    const lines = [...new Set(fr.map((f) => r3(Lc(f.c)[1])))];
    const inRow = fr.some((f) => Math.abs(Lc(f.c)[0] - u) < depth / 2 + 0.3);
    let vv = v;
    if (inRow) for (const L of lines) if (Math.abs(vv - L) < 0.4) vv = L + (vv >= L ? 0.4 : -0.4);
    return Math.min(Math.max(vv, lineV(0) + 0.4), lineV(K - 1) - 0.4);
  };
  const done: string[] = [];
  const sectionStarts: PhaseBResult['sectionStarts'] = [];
  const begin = (sec: Section) => { sectionStarts.push({ section: sec, at: ctx.count() }); gate = ctx.lastSteps(); seen.clear(); };
  const seqd = new Map<string, string[]>();
  // (a panel rail serves two panels: it is not a Kit component and does not make its panels "sequenced")
  const mark = (p: PartB, ...ids: string[]) => { if (p.role !== 'panel-rail') for (const n of p.nodes) { const a = seqd.get(n) ?? []; a.push(...ids); seqd.set(n, a); } if (!done.includes(p.id)) done.push(p.id); };
  const unplaced: UnplacedB[] = [];
  const P = (role: string) => parts.parts.filter((p) => p.role === role);
  const yawW = (localYaw: number) => localYaw + ctx.Y; // a local-frame heading → world yaw
  // ---------------------------------------------------------------- material flow
  const st = ctx.yard.station!;
  const stV = rot2([0, 1], st.yaw);
  // in-feed spot: behind the operator (the bench's −z side), the stock parallel to the bench
  const inFeed = (d: string) => { const w = def(d).category === 'plywood' ? def(d).size[2] : Math.max(def(d).size[2], 0.1); const o = 0.5 + 0.45 + 0.35 + 0.3 + w / 2; return { x: r3(st.x - stV[0] * o), z: r3(st.z - stV[1] * o), yaw: r3(st.yaw) }; };
  let stationFree: string[] = []; // steps that clear the out-feed of the last cut
  let inFeedFree: string[] = [];
  /** Where an offcut is laid beside the scrap pile before it is stacked (clear of the pile by 0.1 m). */
  const scrapSpot = (d: string) => { const sc = ctx.scrap!; const gap = def(d).category === 'timber' ? 0.45 : 0.1; const o = rot2([0, def('scrap-pile').size[2] / 2 + gap + def(d).size[2] / 2], sc.yaw); return { x: r3(sc.x + o[0]), z: r3(sc.z + o[1]), yaw: r3(sc.yaw) }; };
  let scrapFree: string[] = [];
  const take = (piece: string, stockDef: string, crew: number[]): { step: string; pile: string } | null => {
    const p = ctx.yard.piles.find((x) => x.piece === stockDef && (ctx.left.get(x.id) ?? 0) > 0);
    if (!p) return null;
    ctx.left.set(p.id, ctx.left.get(p.id)! - 1);
    const s = step('take_from_bundle', { crew: crew.map(C), bundle: p.id, piece, to: p.out }, crew, ctx.spotClear.has(p.id) ? [ctx.spotClear.get(p.id)!] : [], `${piece} off ${p.id}`);
    return { step: s, pile: p.id };
  };
  /**
   * Bring part `p` to lie at `to` (world, lying pose heading `yaw`): off its bundle, cut at the station (offcut on the scrap
   * pile), carried there. Returns the step that sets it down there, or null (no stock left: reported).
   */
  const fetch = (p: PartB, to: { x: number; z: number; yaw: number }, crew: number[], deps: string[] = []): string | null => {
    const carryCrew = def(p.stock).handling!.carryCrew;
    const tc = crew.slice(0, Math.max(carryCrew[0], Math.min(crew.length, carryCrew[1])));
    // a small cut piece (≤ 12 kg) is carried from the station by one person
    const pc = def(p.def).massKg <= 12 && def(p.def).handling!.carryCrew[0] <= 1 ? tc.slice(0, 1) : tc;
    if (!p.cut) {
      const t = take(p.id, p.stock, tc);
      if (!t) { unplaced.push({ node: p.nodes[0], kind: `feature:${p.kind}`, reason: `no ${p.stock} left in the piles for ${p.id}` }); return null; }
      const c = step('carry', { crew: tc.map(C), item: p.id, to }, tc, [t.step, ...deps], `carry ${p.id} to where it goes`);
      ctx.spotClear.set(t.pile, c);
      mark(p, t.step, c);
      return c;
    }
    const stock = `${p.id}-stock`;
    const t = take(stock, p.stock, tc);
    if (!t) { unplaced.push({ node: p.nodes[0], kind: `feature:${p.kind}`, reason: `no ${p.stock} left in the piles for ${p.id}` }); return null; }
    const c1 = step('carry', { crew: tc.map(C), item: stock, to: inFeed(p.stock) }, tc, [t.step, ...inFeedFree], `carry ${stock} to the cutting station`);
    ctx.spotClear.set(t.pile, c1);
    const plan = cutPlan(p.stock, [p.def]);
    if (!plan.ok) throw new Error(`phaseB: ${p.id}: ${plan.message}`);
    const offId = plan.offcut ? `${p.id}-off` : undefined;
    const cut = step('cut', { actor: C(tc[0]), station: 'cutting-station', stock, cuts: [{ piece: p.id, def: p.def }], ...(offId ? { offcut: offId } : {}) }, [tc[0]], [c1, ...stationFree], `cut ${p.stock} → ${p.def}${offId ? ` + offcut` : ''}`);
    inFeedFree = [cut];
    const clear: string[] = [];
    if (offId && ctx.scrap) {
      const a = tc[tc.length - 1];
      const oc = step('carry', { crew: [C(a)], item: offId, to: scrapSpot(plan.offcut!.id) }, [a], [cut, ...scrapFree], `carry offcut ${offId} to the scrap pile`);
      const so = step('stack_offcut', { actor: C(a), piece: offId, pile: ctx.scrap!.id }, [a], [oc], `stack ${offId} on the scrap pile`);
      scrapFree = [so];
      clear.push(oc);
    }
    // the piece leaves the out-feed after the offcut (they would stand in each other's way there)
    const c2 = step('carry', { crew: pc.map(C), item: p.id, to }, pc, [cut, ...clear, ...deps], `carry ${p.id} from the station to where it goes`);
    clear.push(c2);
    stationFree = clear;
    mark(p, t.step, c1, cut, c2);
    return c2;
  };
  // ---------------------------------------------------------------- deck geometry (local frame)
  const decks = P('deck-piece');
  const levels = [...new Set(decks.map((p) => p.meta.level as number))].sort((a, b) => a - b);
  const stripsOf = (lv: number) => [...new Set(decks.filter((p) => p.meta.level === lv).map((p) => p.meta.strip as number))].sort((a, b) => a - b);
  const piecesOf = (lv: number, s: number) => decks.filter((p) => p.meta.level === lv && p.meta.strip === s).sort((a, b) => (a.meta.piece as number) - (b.meta.piece as number));
  const lenOf = (p: PartB) => def(p.def).size[0];
  // −u side first piece(s), +u the rest; W38 (PROVISIONAL): where the ground beyond the strip's +u end is taken (a neighbour's
  // stair) and its −u end is open, the middle piece(s) go in from the −u side too (only the outer +u piece from +u)
  const sideOf = (p: PartB) => {
    const s0 = (p.meta.piece as number) <= (p.meta.of as number) / 2 ? -1 : 1;
    return s0 > 0 && (p.meta.piece as number) < (p.meta.of as number) && ctx.narrowPlusU?.(vc(p)) && !ctx.narrowMinusU(vc(p)) ? -1 : s0;
  };
  const uc = (p: PartB) => Lc([p.pose.p[0], p.pose.p[2]])[0];
  // W38 (PROVISIONAL): over a narrow +u side a piece one person can handle (≤ 12 kg, the carry rule above) has ONE giver,
  // standing at its outer end on the strip's centre line (two would stand beside a neighbour's stair: chiba / west-house);
  // a heavier one is held by its sides
  const oneGiver = (p: PartB) => def(p.def).massKg <= 12;
  const narrowGivers = (p: PartB, narrowP: boolean) => (narrowP && oneGiver(p) ? [C(G[0])] : G.map(C));
  const vc = (p: PartB) => Lc([p.pose.p[0], p.pose.p[2]])[1];
  const levelId = (y: number) => Math.round(y / 0.5);
  // the order within a strip: the middle piece before the outer piece on its side (it is fed over that side's area)
  const order = (ps: PartB[]) => [...ps].sort((a, b) => sideOf(a) - sideOf(b) || (sideOf(a) < 0 ? uc(b) - uc(a) : uc(a) - uc(b)));
  // ---------------------------------------------------------------- D0: ground-floor deck from the ground
  const skip = (p: PartB, why: string) => unplaced.push({ node: p.nodes[0], kind: `feature:${p.kind}`, reason: why });
  if (secs.has('D0') && levels.length) {
    begin('D0');
    // two in the aisles on the open side take each piece the givers push in over the edge beam, and fasten it
    const lv = levels[0];
    const aisles = (() => { const us = [...new Set(fr.map((f) => r3(Lc(f.c)[0])))].sort((a, b) => a - b); const out: number[] = []; for (let i = 1; i < us.length; i++) out.push(r3((us[i - 1] + us[i]) / 2)); return out; })();
    const aisleNear = (u: number) => [...aisles].sort((a, b) => Math.abs(a - u) - Math.abs(b - u))[0];
    const [a0, a1] = [2, 3];
    for (const s of stripsOf(lv)) {
      const vA = s + 0.6096 + 0.35;
      for (const p of order(piecesOf(lv, s))) {
        const side = sideOf(p);
        const L = lenOf(p);
        const edge = side < 0 ? uMin - BEAM_HALF : uMax + BEAM_HALF;
        const Rc = side < 0 ? edge - 0.08 - L / 2 : edge + 0.08 + L / 2;
        const narrow = side < 0 && ctx.narrowMinusU(vc(p));
        // W38: going in from a +u side whose ground is narrow (a neighbour's stair), the givers hold it by its sides, set down closer
        const narrowP = side > 0 && !!ctx.narrowPlusU?.(vc(p));
        const lw = W(Rc + side * (narrow || narrowP ? 0.3 : 0.6), vc(p)); // set down a little further out than where it goes up (room for the carry formation)
        // receiver: in the aisle within reach both of where the givers can push it to (up to the edge) and of its place
        const fin: [number, number] = [uc(p) - L / 2, uc(p) + L / 2];
        const pushed: [number, number] = side < 0 ? [uMin, uMin + L] : [uMax - L, uMax];
        const gap = (a: number, r: [number, number]) => Math.max(0, r[0] - a, a - r[1]);
        const ra = [...aisles].sort((a, b) => Math.max(gap(a, fin), gap(a, pushed)) - Math.max(gap(b, fin), gap(b, pushed)) || a - b)[0];
        const recv = ra === aisles[0] ? a0 : a1;
        void aisleNear;
        const qa = W(ra, vA);
        // second fastener: the other aisle person when their aisle is within reach of it, else a giver (they end at its outer end)
        const oa = ra === aisles[0] ? aisles[1] : aisles[0];
        const f2nd = oa !== undefined && gap(oa, fin) <= 0.7 ? { actor: C(recv === a0 ? a1 : a0), at: { x: W(oa, vA)[0], z: W(oa, vA)[1], level: 0 } } : { actor: C(G[0]) };
        const f = fetch(p, { x: lw[0], z: lw[1], yaw: r3(yawW(0)) }, G);
        if (!f) continue;
        const who2 = f2nd.actor === C(G[0]) ? [] : [recv === a0 ? a1 : a0];
        const pu = step('pass_up', {
          part: p.id, to: { x: p.pose.p[0], z: p.pose.p[2], yaw: p.pose.yaw, height: r3(p.y) }, edge: r3(side < 0 ? -edge : edge), out: { x: W(side, 0)[0], z: W(side, 0)[1] },
          givers: narrowGivers(p, narrowP), receivers: [C(recv)], receiverAt: [{ x: qa[0], z: qa[1], level: 0 }], give: r3(p.y + 0.05), push: true, fasten: [f2nd], ...(narrowP && !oneGiver(p) ? { side: true } : {}),
        }, [...G, recv, ...who2], [f], `push ${p.id} in over the edge beam; ${C(recv)} takes it in the aisle; screwed down`);
        mark(p, pu);
      }
    }
    // out of the aisles
    for (const [i, who] of [a0, a1].entries()) { const q = W(uMax + 2.0, lineV(K - 1) + 1.5 + i * 0.8); step('walk_to', { actor: C(who), x: q[0], z: q[1], level: 0 }, [who], []); }
  }
  // ---------------------------------------------------------------- climbs (local helpers)
  const colU = (f: { c: Vec2 }, col: 'l' | 'r') => Lc(f.c)[0] + (col === 'l' ? -depth / 2 : depth / 2);
  /** Climb link and walkway beam onto the bay next to frame line k (0 or K−1) at the column over local u, seat. */
  const climbAt = (k: number, u: number, seat: number) => {
    const f = fr.filter((x) => x.k === k).find((x) => Math.abs(colU(x, 'l') - u) < 0.05 || Math.abs(colU(x, 'r') - u) < 0.05);
    if (!f) return null;
    const col: 'l' | 'r' = Math.abs(colU(f, 'l') - u) < 0.05 ? 'l' : 'r';
    const bay = k === 0 ? 0 : k - 1;
    const b = ctx.beams.find((x) => x.k === bay && x.r === f.r && x.col === col && Math.abs(x.seat - seat) < 0.01);
    if (!b) return null;
    return { link: `climb:${f.id}:${ctx.engCol(k, col)}@${seat.toFixed(2)}`, beam: b.id, u };
  };
  /** Beam seat of a deck level: the seat whose beam top (seat + half a beam) is the pieces' rest height. */
  const seatOf = (lv: number) => { const y = piecesOf(lv, stripsOf(lv)[0])[0].y - def('beam-12ft').size[1] / 2; const b = [...ctx.beams].sort((a, c) => Math.abs(a.seat - y) - Math.abs(c.seat - y))[0]; return b.seat; };
  const beamTopOf = (p: PartB) => p.y; // engine rest height of its level
  // ---------------------------------------------------------------- D1 / D2: upper decks by pass_up
  // Both start at the stair end (the last frame line, K−1): its end frames are climbable until the stair is built there.
  const KE = K - 1;
  type Up = { lv: number; relay: number | null; relayY?: number; up: number[] };
  const uWalk = [uMin, uMax - 0.09, uMin + depth, uMax - depth];
  const vWalk = (first: number) => first - 0.6096 - 0.3; // on the stair-end bay's walkways, beyond the first strip
  const climbUp = (seat: number, who: number[], uAt: number[], vAt: number) => {
    for (const [i, m] of who.entries()) {
      const col = [uMin, uMin + depth, uMax - depth, uMax].sort((a, b) => Math.abs(a - uAt[i]) - Math.abs(b - uAt[i]))[0];
      const c = climbAt(KE, col, seat);
      if (!c) return false;
      const a = step('climb_frame', { actor: C(m), link: c.link, dir: 'up' }, [m], [], `${C(m)} climbs the end frame onto the ${seat.toFixed(2)} m beams`);
      const q = W(uAt[i], vAt);
      step('beam_walk', { actor: C(m), x: q[0], z: q[1] }, [m], [a]);
    }
    return true;
  };
  /** Down: from a deck onto a walkway of the frame line `k` bay, along it to the end frame, down its bracing. */
  const climbDown = (k: number, seat: number, who: number[], uAt: number[], after: string[] = [], vIn = 1.2) => {
    for (const [i, m] of who.entries()) {
      const col = [uMin, uMin + depth, uMax - depth, uMax].sort((a, b) => Math.abs(a - uAt[i]) - Math.abs(b - uAt[i]))[0];
      const c = climbAt(k, col, seat);
      if (!c) continue;
      const vOn = k === 0 ? lineV(0) + vIn : lineV(k) - vIn;
      const q = W(col, vOn);
      const d = W(Math.min(Math.max(col, uMin + 0.44), uMax - 0.44), vOn);
      step('walk_to', { actor: C(m), x: d[0], z: d[1], level: levelId(seat + def('beam-12ft').size[1] / 2 + PLY_T) }, [m], after, `${C(m)} walks to the end of the deck`);
      step('step_onto_beam', { actor: C(m), beam: c.beam, x: q[0], z: q[1] }, [m], []);
      step('climb_frame', { actor: C(m), link: c.link, dir: 'down' }, [m], [], `${C(m)} climbs down the end frame`);
    }
  };
  /** Up onto a deck: climb frame line k onto its bay's walkway at `seat`, step off onto the deck at (u, v). */
  const upOnto = (k: number, seat: number, m: number, u: number, v: number, after: string[] = []) => {
    const c = climbAt(k, u, seat);
    if (!c) return false;
    step('climb_frame', { actor: C(m), link: c.link, dir: 'up' }, [m], after, `${C(m)} climbs the end frame to the ${seat.toFixed(2)} m deck`);
    // step off 0.45 m into the deck, toward the middle of the house (never onto the beam line itself)
    const q = W(u + (u < (uMin + uMax) / 2 ? 0.45 : -0.45), v);
    step('beam_walk', { actor: C(m), x: q[0], z: q[1] }, [m], [], `${C(m)} steps onto the deck`);
    return true;
  };
  const upperDeck = (cfg: Up) => {
    const { lv } = cfg;
    const strips = [...stripsOf(lv)].reverse(); // from the stair end
    const seat = seatOf(lv);
    const yTop = beamTopOf(piecesOf(lv, strips[0])[0]);
    const deckLv = levelId(yTop + PLY_T);
    const up = cfg.up;
    const first = strips[0];
    const all: string[] = [];
    if (!climbUp(seat, up, uWalk.slice(0, up.length), vWalk(first))) { for (const p of decks.filter((x) => x.meta.level === lv)) skip(p, `no climbable end frame onto the ${seat.toFixed(2)} m beams`); return { seat, deckLv, last: [] as string[], down: [] as number[] }; }
    const laid = new Map<number, [number, number][]>(); // strip → laid u-intervals (people kneel only on laid sheets)
    const ivOf = (st: number, u: number) => (laid.get(st) ?? []).find(([x, y]) => u >= x + 0.34 - 1e-9 && u <= y - 0.34 + 1e-9);
    /** The u nearest `want` on the laid part of strip `st` (0.3 m in from its sheets' ends), ≥ `away` from `not`, optionally within interval `iv`. */
    const standU = (st: number, want: number, not?: number, iv?: [number, number], away = 0.62) => {
      const cands: number[] = [];
      // 0.34 m in from a deck's edge: walk_to routes a 0.34 m disc to its destination
      for (const [x, y] of iv ? [iv] : laid.get(st) ?? []) { for (let u = x + 0.36; u <= y - 0.36 + 1e-9; u += 0.05) cands.push(r3(u)); if (y - x >= 0.72) cands.push(r3(y - 0.36)); }
      return cands.filter((u) => not === undefined || Math.abs(u - not) >= away).sort((m, n) => Math.abs(m - want) - Math.abs(n - want) || m - n)[0] as number | undefined;
    };
    const pending: { p: PartB; st: number; step: string }[] = []; // placed, still to be fastened (no second person could reach it yet)
    // where the deck crew stands; until a second strip is complete, the first strip's laid pieces are separate islands
    const posOf = new Map<number, { st: number; u: number; v: number }>();
    let joined = false;
    const island = (m: number): [number, number] | 'all' | null => {
      const q = posOf.get(m);
      if (!q) return null;
      if (joined) return 'all';
      return ivOf(q.st, q.u) ?? null;
    };
    const canStand = (m: number, st: number, u: number) => { const is = island(m); if (is === null) return false; if (is === 'all') return true; return st === first && u >= is[0] + 0.34 - 1e-9 && u <= is[1] - 0.34 + 1e-9; };
    const addLaid = (p: PartB) => {
      const st = p.meta.strip as number, L = lenOf(p);
      laid.set(st, [...(laid.get(st) ?? []), [uc(p) - L / 2, uc(p) + L / 2] as [number, number]].sort((x, y) => x[0] - y[0]).reduce<[number, number][]>((acc, iv) => { const l = acc[acc.length - 1]; if (l && iv[0] <= l[1] + 1e-6) l[1] = Math.max(l[1], iv[1]); else acc.push([iv[0], iv[1]]); return acc; }, []));
    };
    /** Pass one piece up; receivers on the walkways (`from` null: fastener given) or kneeling on laid strip `from`. */
    const one = (p: PartB, from: number | null, walkFz?: number | null) => {
      const side = sideOf(p);
      const L = lenOf(p);
      const edge = side < 0 ? uMin - BEAM_HALF : uMax + BEAM_HALF;
      const Rc = side < 0 ? edge - 0.08 - L / 2 : edge + 0.08 + L / 2;
      const narrow = side < 0 && ctx.narrowMinusU(vc(p));
      const narrowP = side > 0 && !!ctx.narrowPlusU?.(vc(p)); // W38: as in D0
      const lw = W(Rc + side * (narrow || narrowP ? 0.3 : 0.6), vc(p));
      const outV = W(side, 0);
      let recv = side < 0 ? up[0] : up[1];
      let recvAt: { x: number; z: number; level: number; kneel?: { x: number; z: number } } | undefined, fz: number | null = null, fzAt: { x: number; z: number; level: number } | undefined;
      let follow = false;
      const pre: string[] = [];
      if (from === null) fz = walkFz ?? null;
      else {
        const vK = from > vc(p) ? from - 0.6096 + 0.305 : from + 0.6096 - 0.305; // kneeling 0.305 m in from the laid strip's edge toward the piece
        const uR = standU(from, side < 0 ? uMin + 0.36 : uMax - 0.36)!; // right at the deck edge it comes over (a deck is 2 cm above the beams)
        // the receiver: the deck worker nearer the station (their walks never cross)
        const deckCrew = up.filter((m) => posOf.has(m) && canStand(m, from, uR));
        recv = [...deckCrew].sort((a, b) => Math.abs(posOf.get(a)!.u - uR) - Math.abs(posOf.get(b)!.u - uR) || a - b)[0] ?? recv;
        const q = W(uR, vK);
        // at the house's edge they shuffle forward to kneel 0.29 m from the deck edge (walk_to stops 0.36 m in)
        const atEdge = Math.abs(uR - (side < 0 ? uMin + 0.36 : uMax - 0.36)) < 0.01;
        const kq = W(side < 0 ? uMin + 0.29 : uMax - 0.29, vK);
        recvAt = { x: q[0], z: q[1], level: deckLv, ...(atEdge ? { kneel: { x: kq[0], z: kq[1] } } : {}) } as typeof recvAt;
        follow = Math.max(0, side > 0 ? uR - (uc(p) + L / 2) : (uc(p) - L / 2) - uR) > 0.8; // out of reach at its place from there: walk alongside
        // where the receiver ends: walking alongside, they move with it from the transfer (outside the edge) to its place
        const slide = side > 0 ? edge + 0.08 - (uc(p) - L / 2) : (uc(p) + L / 2) - (edge + 0.08 * -1);
        const uStart = atEdge ? (side < 0 ? uMin + 0.29 : uMax - 0.29) : uR;
        const uEnd = follow ? uStart - side * slide : uStart;
        posOf.set(recv, { st: from, u: uEnd, v: vK });
        // the second fastener: someone else who can stand within reach of the piece, clear of the receiver's whole path
        const want = Math.min(Math.max(uc(p), uMin + 0.44), uMax - 0.44);
        const lo = Math.min(uR, uStart, uEnd) - 0.64, hi = Math.max(uR, uStart, uEnd) + 0.64; // (walk-to spot, kneel spot, follow path)
        for (const m of up.filter((x) => x !== recv)) {
          const is = island(m);
          const cands: number[] = [];
          for (const [x, y] of is === 'all' || is === null ? laid.get(from) ?? [] : [is]) { for (let u = x + 0.36; u <= y - 0.36 + 1e-9; u += 0.05) cands.push(r3(u)); if (y - x >= 0.72) cands.push(r3(y - 0.36)); }
          const uF = cands.filter((u) => u < lo || u > hi).sort((a, b) => Math.abs(a - want) - Math.abs(b - want) || a - b)[0];
          if (is === null || uF === undefined || Math.max(0, uc(p) - L / 2 - uF, uF - uc(p) - L / 2) > 0.6) continue;
          fz = m;
          const q2 = W(uF, vK);
          fzAt = { x: q2[0], z: q2[1], level: deckLv };
          posOf.set(m, { st: from, u: uF, v: vK });
          break;
        }
        // anyone else up here near the receiver's path steps back from the kneel line: to the strip beyond when it is
        // laid, else to the far side of this strip at an aisle (a frame line bounds it elsewhere)
        for (const m of up.filter((x) => x !== recv && x !== fz && posOf.has(x))) {
          const q0 = posOf.get(m)!;
          if (Math.abs(q0.v - vK) >= 0.58 || q0.u < lo || q0.u > hi) continue;
          const away = from > vc(p) ? 1 : -1; // from the piece, across `from`
          const beyond = strips.find((x) => Math.abs(x - (from + away * 1.2192)) < 0.05 && (laid.get(x) ?? []).length);
          let uP = q0.u, vP: number;
          if (beyond !== undefined) vP = vK + away * 0.8;
          else {
            vP = from + away * (0.6096 - 0.345);
            const aisles2 = (() => { const us = [...new Set(fr.map((f) => r3(Lc(f.c)[0])))].sort((a, b) => a - b); const o: number[] = []; for (let i = 1; i < us.length; i++) o.push(r3((us[i - 1] + us[i]) / 2)); return o; })();
            uP = [...aisles2].sort((a, b) => Math.abs(a - q0.u) - Math.abs(b - q0.u))[0];
          }
          const qq = W(uP, vP);
          pre.push(step('walk_to', { actor: C(m), x: qq[0], z: qq[1], level: deckLv }, [m], [], `${C(m)} steps back for ${p.id}`));
          posOf.set(m, { st: from, u: uP, v: vP });
        }
      }
      const f = fetch(p, { x: lw[0], z: lw[1], yaw: r3(yawW(0)) }, G);
      if (!f) return;
      let relayAt: { x: number; z: number; level: number }[] | undefined;
      if (cfg.relay !== null) { const uq = side < 0 ? uMin + 0.31 : uMax - 0.31; const q = W(uq, safeV(vc(p), uq)); relayAt = [{ x: q[0], z: q[1], level: levelId(cfg.relayY!) }]; }
      const pu = step('pass_up', {
        part: p.id, to: { x: p.pose.p[0], z: p.pose.p[2], yaw: p.pose.yaw, height: r3(yTop) }, edge: r3(side < 0 ? -edge : edge), out: { x: outV[0], z: outV[1] },
        givers: narrowGivers(p, narrowP), ...(cfg.relay !== null ? { relay: [C(cfg.relay)], relayAt } : {}), receivers: [C(recv)], ...(recvAt ? { receiverAt: [recvAt], ...(follow ? { follow: true } : {}) } : {}),
        // screwed down where it lies: by the receiver and a second person, or by the receiver alone when nobody else reaches it
        fasten: fz !== null ? [{ actor: C(fz), ...(fzAt ? { at: fzAt } : {}) }] : [], ...(narrowP && !oneGiver(p) ? { side: true } : {}),
      }, [...G, recv, ...(fz !== null ? [fz] : []), ...(cfg.relay !== null ? [cfg.relay] : [])], [f, ...pre], `pass ${p.id} up${cfg.relay !== null ? ' through the relay' : ''} to ${yTop.toFixed(2)} m; screwed down${fz !== null ? '' : ' by the receiver alone'}`);
      mark(p, pu);
      all.push(pu);
      addLaid(p); // only fastened (installed) sheets are a floor to kneel on
    };
    /** Fasten the pending pieces now reachable: two deck people kneeling on laid sheets next to each (same or any strip). */
    const fastenPending = (standOn: number[]) => {
      for (const it of Array.from(pending)) {
        const p = it.p, L = lenOf(p);
        let spot: { st: number; a: number; b: number } | null = null;
        for (const st of standOn) {
          if (!(laid.get(st) ?? []).length) continue;
          const want = Math.min(Math.max(uc(p), uMin + 0.44), uMax - 0.44);
          const a = standU(st, want); if (a === undefined) continue;
          const b = standU(st, want, a, ivOf(st, a)); if (b === undefined) continue;
          if (Math.max(0, uc(p) - L / 2 - a, a - uc(p) - L / 2) <= 0.6 && Math.max(0, uc(p) - L / 2 - b, b - uc(p) - L / 2) <= 0.6) { spot = { st, a, b }; break; }
        }
        if (!spot) continue;
        const v = spot.st === (p.meta.strip as number) ? vc(p) + (vc(p) < first ? 0.25 : -0.25) : spot.st > vc(p) ? spot.st - 0.6096 + 0.35 : spot.st + 0.6096 - 0.35;
        const qa = W(spot.a, v), qb = W(spot.b, v);
        const [ma, mb] = up.filter((m) => posOf.has(m));
        if (mb === undefined) continue;
        const w1 = step('walk_to', { actor: C(ma), x: qa[0], z: qa[1], level: deckLv }, [ma], [it.step]);
        const w2 = step('walk_to', { actor: C(mb), x: qb[0], z: qb[1], level: deckLv }, [mb], [it.step]);
        posOf.set(ma, { st: spot.st, u: spot.a, v }); posOf.set(mb, { st: spot.st, u: spot.b, v });
        const inst = step('install_plywood', { crew: [C(ma), C(mb)], sheet: p.id, x: p.pose.p[0], z: p.pose.p[2], yaw: p.pose.yaw, height: r3(yTop) }, [ma, mb], [w1, w2], `fasten ${p.id}`);
        mark(p, inst);
        all.push(inst);
        pending.splice(pending.indexOf(it), 1);
        addLaid(p);
      }
    };
    // first strip: its end pieces from the walkways (its middle piece is out of every walkway's reach: after the next strip)
    const ps0 = order(piecesOf(lv, first));
    const mid0 = ps0.filter((p) => (p.meta.piece as number) !== 1 && (p.meta.piece as number) !== (p.meta.of as number));
    for (const p of ps0.filter((x) => !mid0.includes(x))) one(p, null, up.length > 3 ? (sideOf(p) < 0 ? up[2] : up[3]) : sideOf(p) < 0 && up.length > 2 ? up[2] : null);
    // off the beams onto the sheets just laid, as many as fit (0.6 m apart); the rest climb back down
    const taken: number[] = [];
    const stayed: number[] = [];
    for (const [i, m] of up.entries()) {
      const u0 = uWalk[i];
      const cands: number[] = [];
      for (const [x, y] of laid.get(first) ?? []) for (let u = x + 0.3; u <= y - 0.3 + 1e-9; u += 0.05) cands.push(r3(u));
      const u1 = cands.filter((u) => Math.abs(u - u0) <= 0.95 && Math.abs(u - u0) >= 0.2 && taken.every((t) => Math.abs(t - u) >= 0.62)).sort((x, y) => Math.abs(x - u0 - (u0 < (uMin + uMax) / 2 ? 0.4 : -0.4)) - Math.abs(y - u0 - (u0 < (uMin + uMax) / 2 ? 0.4 : -0.4)) || x - y)[0];
      // only the two deck workers stay up (receiver + fastener); an idle third would stand where they need to go
      if (u1 === undefined || i >= 2) {
        const c = climbAt(KE, [uMin, uMin + depth, uMax - depth, uMax].sort((x, y) => Math.abs(x - u0) - Math.abs(y - u0))[0], seat);
        if (c) all.push(step('climb_frame', { actor: C(m), link: c.link, dir: 'down' }, [m], [], `${C(m)} climbs back down (no room on the new sheets)`));
        continue;
      }
      taken.push(u1);
      stayed.push(m);
      posOf.set(m, { st: first, u: u1, v: first - 0.6096 + 0.35 });
      const q = W(u1, first - 0.6096 + 0.35);
      all.push(step('beam_walk', { actor: C(m), x: q[0], z: q[1] }, [m], [], `${C(m)} steps off the beam onto the new deck`));
    }
    for (const [i, st] of strips.entries()) {
      if (i === 0) continue;
      for (const p of order(piecesOf(lv, st))) one(p, strips[i - 1]);
      joined = true; // a complete strip joins the first strip's pieces
      // fasten what could not be fastened as it came up (only installed sheets can be stood on)
      fastenPending([st, strips[i - 1]]);
      if (i === 1) {
        // the first strip's middle piece, received from the strip just laid
        for (const p of mid0) one(p, st);
        fastenPending([first, st]);
      }
    }
    for (const it of pending) skip(it.p, 'placed but nobody could reach it to fasten');
    return { seat, deckLv, last: all.slice(-1), down: stayed };
  };
  // W38 (PROVISIONAL): the D1 / D2 crews go up the stair-end frames (line K−1) and move along the beam walkways of that
  // bay; a level whose strips do not reach the stair-end bay (kitchen 2022: a 3-strip roof deck over bay 0, 7 m away) is
  // not reachable that way — every piece of it is reported unplaced (starting a level from the other end is not modelled)
  const reachable = (lv: number) => Math.max(...stripsOf(lv)) + SHEET_HALF >= lineV(K - 2) - 1e-6;
  const unreachable = (lv: number) => { for (const p of decks.filter((x) => x.meta.level === lv)) unplaced.push({ node: p.nodes[0], kind: 'feature:deck-sheet', reason: `this deck level's strips cover only frame lines up to v ${r3(Math.max(...stripsOf(lv)) + SHEET_HALF)} m, short of the stair-end bay (from ${r3(lineV(K - 2))} m): the upper-deck crews climb only the stair-end frames and walk one beam's walkway, so nobody reaches it (a level laid from the other end is not modelled)` }); };
  if (secs.has('D1') && levels.length > 1 && !reachable(levels[1])) unreachable(levels[1]);
  if (secs.has('D2') && levels.length > 2 && !reachable(levels[2])) unreachable(levels[2]);
  if (secs.has('D1') && levels.length > 1 && reachable(levels[1])) {
    begin('D1');
    const r = upperDeck({ lv: levels[1], relay: null, up: [2, 3, 4, 5] });
    if (r) climbDown(KE, r.seat, r.down, r.down.map((m) => uWalk[[2, 3, 4, 5].indexOf(m)]), r.last);
  }
  const relayY = levels.length > 1 ? piecesOf(levels[1], stripsOf(levels[1])[0])[0].y + PLY_T : 0;
  if (secs.has('D2') && levels.length > 2 && reachable(levels[2]) && reachable(levels[1])) {
    begin('D2');
    // the relay kneels on the first-floor deck (up the end frame and off its beam); the roof crew climbs to the roof beams
    const s1 = seatOf(levels[1]);
    upOnto(KE, s1, 2, uMax - depth, lineV(KE) - 1.0); // a column none of the roof crew climbs
    const r = upperDeck({ lv: levels[2], relay: 2, relayY, up: [3, 4, 5] });
    if (r) { climbDown(KE, r.seat, r.down, r.down.map((m) => uWalk[[3, 4, 5].indexOf(m)]), r.last); climbDown(KE, s1, [2], [uMax - depth], r.last); }
  }
  // ---------------------------------------------------------------- stair
  if (secs.has('S')) { begin('S'); stairSection(); }
  function stairSection() {
    const sts = parts.stairs;
    if (!sts.length) return;
    const sd = sts[0];
    const along = rot2([0, 1], 0); void along;
    const stringers = P('stringer'), boards = P('tread-board'), risers = P('riser'), posts = P('post'), rails = P('handrail');
    // stair frame: s along dir (up the stair) from the foot, lat across (the tread axis)
    const dir = sd.dir, axis: Vec2 = [-dir[1], dir[0]];
    const lat0 = (boards.length ? dot2([boards[0].pose.p[0], boards[0].pose.p[2]], axis) : 0);
    const S = (s: number, lat: number): Vec2 => [r3(sd.foot[0] + dir[0] * s + axis[0] * (lat - dot2(sd.foot, axis))), r3(sd.foot[1] + dir[1] * s + axis[1] * (lat - dot2(sd.foot, axis)))];
    const sOf = (x: number, z: number) => dot2([x - sd.foot[0], z - sd.foot[1]], dir);
    const latOf = (x: number, z: number) => dot2([x, z], axis);
    const halfW = sd.width / 2;
    const lo = lat0 - halfW, hi = lat0 + halfW;
    const yawDir = datan2(dir[1], dir[0]);
    // everyone not building the stair stands clear of its site (beside the house, off the stair's side)
    for (const [i, m] of [2, 3, 4, 5].entries()) { const q = W(uMax + 2.2, lineV(K - 1) - 1.0 - i * 1.1); step('walk_to', { actor: C(m), x: q[0], z: q[1], level: 0 }, [m], [], `${C(m)} stands clear of the stair site`); }
    // stringers: lying along the stair at their lateral position, lifted and walked up against the end frame
    // from the +lat end: the crews stand on the −lat side, where no stringer is in yet
    // W38 (PROVISIONAL): a stringer that must lie shifted off its line (layBack) is set FIRST, while the ground beside its
    // line is still free for its carry formation (kitchen 2022: stringer 1, shifted clear of west-house's table, could
    // not turn in beside stringer 2 already set); the rest from the +lat end as before
    const layBack = (p: PartB) => {
      const lat = latOf(p.pose.p[0], p.pose.p[2]), L = lenOf(p), sc = sOf(p.pose.p[0], p.pose.p[2]), inward = lat < lat0 ? 1 : -1;
      // the standard spot unless something 0.5–1.3 m tall (a table, a wall) takes its footprint; then the nearest spot clear of
      // everything 0.05–1.3 m tall with 0.25 m at the ends (it is set down end-on), shifted inward ≤ 1 m
      if (ctx.groundFree?.({ c: S(sc - 1.6, lat), half: [L / 2, 0.15], yaw: yawDir }, 0.5) ?? true) return { x: 1.6, dl: 0 };
      // (the carry formation straddles it: 0.95 m each side clear too; it is set first, so the ground inward is still free)
      for (let d = 0; d <= 10; d++) for (let k = 16; k >= 4; k--) {
        const x = k / 10, dl = inward * d / 10;
        if (ctx.groundFree!({ c: S(sc - x, lat + dl), half: [L / 2 + 0.25, 0.95], yaw: yawDir })) return { x, dl };
      }
      return null;
    };
    const byLat = [...stringers].sort((a, b) => latOf(b.pose.p[0], b.pose.p[2]) - latOf(a.pose.p[0], a.pose.p[2]));
    const shifted = (p: PartB) => { const b = layBack(p); return !!b && b.dl !== 0; };
    for (const p of [...byLat.filter(shifted), ...byLat.filter((q) => !shifted(q))]) {
      const lat = latOf(p.pose.p[0], p.pose.p[2]);
      const nextFree0 = -0.37; // the crew's side: where no stringer is in yet (see the order above)
      const L = lenOf(p);
      const g1: [number, number, number] = [-1.2, def(p.def).size[1] / 2, 0], g2: [number, number, number] = [-0.2, def(p.def).size[1] / 2, 0]; // on its centre line
      const a = localToWorld(p.pose, g1), b = localToWorld(p.pose, g2);
      const off = rot2([0, 1], 0); void off;
      const sc = sOf(p.pose.p[0], p.pose.p[2]);
      // along its own line, mostly under the stair site, 1.6 m back (only 1.5 m of ground lies beyond its foot here); W38
      // (PROVISIONAL): less where the ground beyond the foot is taken (kitchen 2022: west-house's table 1.5 m out), down to
      // where its top end would pass its installed top end; none clear → unplaced with the reason
      // and, where even that is taken, shifted up to 0.4 m inward (toward the stair's centre line: ground still free, the
      // stringers go in from the +lat side first) — the lift crew carries it the rest of the way sideways
      const back = layBack(p);
      if (back === null) { unplaced.push({ node: p.nodes[0], kind: 'feature:stair-part', reason: `no clear ground to lay stringer ${p.id} near its line before it is set (the ground beyond the stair foot is taken)` }); continue; }
      const lie = S(sc - back.x, lat + back.dl);
      // a shifted stringer is set first: its crew stands on the inward side (its outer side is what is taken)
      const nextFree = back.dl !== 0 ? Math.sign(back.dl) * -nextFree0 : nextFree0;
      const f = fetch(p, { x: lie[0], z: lie[1], yaw: r3(yawDir) }, G);
      if (!f) continue;
      const at = (q: number[]) => { const o = [q[0] + axis[0] * nextFree, q[2] + axis[1] * nextFree]; return { x: r3(o[0]), z: r3(o[1]) }; };
      const s1 = step('install_stringer', { part: p.id, to: pose(p), lift: [{ actor: C(G[0]), grip: g1, at: at(a) }, { actor: C(G[1]), grip: g2, at: at(b) }], from: { x: r3(dir[0] * -0.3), y: 0.05, z: r3(dir[1] * -0.3) }, fasten: G.map(C) }, G, [f], `set stringer ${p.id.slice(-1)} against the end frame`);
      mark(p, s1);
      void L;
    }
    // tread boards bottom to top (risers on the tread below before the tread above); the top treads from a builder on the treads
    const byTread = new Map<number, PartB[]>();
    for (const b of boards) byTread.set(b.meta.tread as number, [...(byTread.get(b.meta.tread as number) ?? []), b]);
    const n = sd.treads.length;
    const top = sd.tops;
    const reachTop = 2.0; // highest board underside the ground crew can hold at its ends (reach_up envelope, 0.4 m out)
    const ur: { v: { who: number; tread: number } | null } = { v: null };
    const treadStep = new Map<string, string>(); // tread board → the step that installed it
    const standOn = (who: number, k: number) => {
      // climb the installed treads 1…k to stand on tread k's centre
      const up = ur.v;
      if (up && up.tread === k) return [] as string[];
      const out: string[] = [];
      if (up) out.push(step('leave_stair', { actor: C(up.who), boards: sd.treads.slice(0, up.tread).flat(), to: { x: S(-0.9, lat0 - halfW - 0.6)[0], z: S(-0.9, lat0 - halfW - 0.6)[1] } }, [up.who], []));
      const c = S(sOfTread(k), lat0);
      const need = sd.treads.slice(0, k).flat().map((id) => treadStep.get(id)).filter((x): x is string => !!x);
      out.push(step('climb_stair', { actor: C(who), boards: sd.treads.slice(0, k).flat(), to: { x: c[0], z: c[1] } }, [who], need, `${C(who)} climbs the treads to stand on tread ${k}`));
      ur.v = { who, tread: k };
      return out;
    };
    function sOfTread(k: number) { const b = byTread.get(k)!; return b.reduce((a, x) => a + sOf(x.pose.p[0], x.pose.p[2]), 0) / b.length; }
    const helper = 2; // the builder standing on the treads (from the first-floor deck crew, who came down... or the ground)
    for (let k = 1; k <= n; k++) {
      // the riser under tread k stands on tread k−1: set it before tread k
      for (const r of risers.filter((x) => Math.abs(x.y - top[k - 2]) < 0.02 && k >= 2)) placeLow(r, true);
      for (const b of (byTread.get(k) ?? []).sort((a, c) => (c.meta.board as number) - (a.meta.board as number))) placeLow(b, false); // the back board first: the front one slides in from the foot side
    }
    function placeLow(p: PartB, isRiser: boolean) {
      const sc = sOf(p.pose.p[0], p.pose.p[2]);
      const L = lenOf(p);
      const bottom = p.pose.p[1];
      const g1: [number, number, number] = [-(L / 2) + 0.02, def(p.def).size[1] / 2, 0], g2: [number, number, number] = [L / 2 - 0.02, def(p.def).size[1] / 2, 0];
      const e1 = S(sc, lo - 0.45), e2 = S(sc, hi + 0.45); // beyond its ends (clear of the rack's low beams at the end frame)
      const lie = S(-0.9, lat0); // where the tread boards lie too (the kitchen house is 1.5 m beyond the foot)
      const f = fetch(p, { x: lie[0], z: lie[1], yaw: r3(p.pose.yaw) }, G);
      if (!f) return;
      const gripY = bottom + def(p.def).size[1] / 2; // the crew holds it by its centre line
      const lift = Math.min(0.08, reachTop - gripY);
      if (lift >= 0.02) {
        const dz = -(sc - -0.9);
        const s1 = step('install_stair_part', { part: p.id, to: pose(p), lift: [{ actor: C(G[0]), grip: g1, at: { x: e1[0], z: e1[1] } }, { actor: C(G[1]), grip: g2, at: { x: e2[0], z: e2[1] } }], from: { x: r3(dir[0] * dz), y: r3(lift), z: r3(dir[1] * dz) }, fasten: G.map(C) }, G, [f], `set ${p.id} ${isRiser ? 'on the tread below' : 'on the stringers'}`);
        mark(p, s1);
        treadStep.set(p.id, s1);
        return;
      }
      // above the ground crew's reach: they raise it to a builder standing on the highest complete tread below
      const k = Math.max(...[...byTread.entries()].filter(([, bs]) => bs.every((b) => b.pose.p[1] + def(b.def).size[1] < bottom - 0.05)).map(([t]) => t));
      const pre = standOn(helper, k);
      const handoff = r3(Math.max(0.05, gripY - (reachTop - 0.03)));
      const s1 = step('install_stair_part', {
        part: p.id, to: pose(p), lift: [{ actor: C(G[0]), grip: g1, at: { x: e1[0], z: e1[1] } }, { actor: C(G[1]), grip: g2, at: { x: e2[0], z: e2[1] } }],
        take: [{ actor: C(helper), grip: [0, isRiser ? 0.05 : 0, 0] }], handoff, from: { x: r3(dir[0] * -(sc + 0.9)), y: r3(-handoff), z: r3(dir[1] * -(sc + 0.9)) }, fasten: [C(helper)],
      }, [...G, helper], [f, ...pre], `${C(helper)} on tread ${k} takes ${p.id} from the ground crew and sets it`);
      mark(p, s1);
        treadStep.set(p.id, s1);
    }
    const last = ur.v;
    if (last) step('leave_stair', { actor: C(last.who), boards: sd.treads.slice(0, last.tread).flat(), to: { x: S(-0.9, lat0 - halfW - 0.6)[0], z: S(-0.9, lat0 - halfW - 0.6)[1] } }, [last.who], [], `${C(last.who)} climbs down the new treads`);
    // posts: one person, stood up beside the tread ends
    for (const p of posts) {
      const side = (p.meta.side as number);
      const sp = p.meta.s as number;
      const lie = S(-0.6, side < 0 ? lo - 0.9 : hi + 0.9);
      const f = fetch(p, { x: lie[0], z: lie[1], yaw: r3(yawDir) }, [G[0]]);
      if (!f) continue;
      const at = S(sp, side < 0 ? lo - 0.45 : hi + 0.45);
      const s1 = step('install_stair_part', { part: p.id, to: pose(p), lift: [{ actor: C(G[0]), grip: [-0.37, 0.044, 0], at: { x: at[0], z: at[1] } }], fasten: [C(G[0])] }, [G[0]], [f], `bolt post ${p.id} to the tread end`);
      mark(p, s1);
    }
    // handrails: two on the ground at its lower half, laid on the post tops from outside
    for (const p of rails) {
      const side = p.meta.side as number;
      const g1: [number, number, number] = [-2.0, def(p.def).size[1] / 2, 0], g2: [number, number, number] = [-1.0, def(p.def).size[1] / 2, 0]; // its lower half (the upper end is above reach)
      const a = localToWorld(p.pose, g1), b = localToWorld(p.pose, g2);
      const o = (q: number[]) => { const l = latOf(q[0], q[2]) + side * 0.45; const w = S(sOf(q[0], q[2]), l); return { x: w[0], z: w[1] }; };
      const lie = S(1.5, side < 0 ? lo - 1.3 : hi + 1.3);
      const f = fetch(p, { x: lie[0], z: lie[1], yaw: r3(yawDir) }, G);
      if (!f) continue;
      const s1 = step('install_stair_part', { part: p.id, to: pose(p), lift: [{ actor: C(G[0]), grip: g1, at: o(a) }, { actor: C(G[1]), grip: g2, at: o(b) }], from: { x: r3(axis[0] * side * 0.3), y: 0.05, z: r3(axis[1] * side * 0.3) }, fasten: G.map(C) }, G, [f], `lay handrail ${p.id} on the post tops`);
      mark(p, s1);
    }
  }
  // ---------------------------------------------------------------- W: plywood walls (after the decks they are fastened from)
  const l1Top = levels.length > 1 ? piecesOf(levels[1], stripsOf(levels[1])[0])[0].y + PLY_T : 0;
  const l2Top = levels.length > 2 ? piecesOf(levels[2], stripsOf(levels[2])[0])[0].y + PLY_T : 0;
  if (secs.has('W')) {
    begin('W');
    const panels = P('wall-panel');
    // upper walls first: an upper panel is handed up in the plane of the ground wall below it
    const walls = [...new Set(panels.map((p) => p.nodes[0]))].sort((a, b) => { const ya = panels.find((p) => p.nodes[0] === a)!.y, yb = panels.find((p) => p.nodes[0] === b)!.y; return (yb > 1 ? 1 : 0) - (ya > 1 ? 1 : 0) || (a < b ? -1 : 1); });
    const onDeck = new Map<number, number>(); // who is up on which deck (level y)
    for (const wid of walls) {
      const ps = panels.filter((p) => p.nodes[0] === wid).sort((a, b) => (a.meta.panel as number) - (b.meta.panel as number));
      const line = ps[0].meta.line as string;
      const bottom = ps[0].y;
      const upper = bottom > 1.0;
      for (const p of ps) {
        const q = p.pose;
        const nY = localToWorld(q, [0, 1, 0]), o = localToWorld(q, [0, 0, 0]);
        const dY: Vec2 = [nY[0] - o[0], nY[2] - o[2]];
        // outward (away from the house): from the house centre through the panel
        const hc = W((uMin + uMax) / 2, (lineV(0) + lineV(K - 1)) / 2);
        const outD: Vec2 = [q.p[0] - hc[0], q.p[2] - hc[1]];
        const wallAxis = localToWorld(q, [0, 0, 1]);
        const wa: Vec2 = [wallAxis[0] - o[0], wallAxis[2] - o[2]];
        const nrm: Vec2 = [-wa[1], wa[0]];
        const outN: Vec2 = dot2(nrm, outD) > 0 ? nrm : [-nrm[0], -nrm[1]];
        const sy = dot2(dY, outN) > 0 ? 1 : -1;
        // flat on the ground outside the wall (room for its carriers; closer where a neighbour's stair is 1.5 m out)
        const narrowW = Lc([q.p[0], q.p[2]])[0] < uMin + 0.1 && ctx.narrowMinusU(Lc([q.p[0], q.p[2]])[1]);
        // …or, where a neighbour's stair leaves no room beside the wall, beyond the house's far end (walked in upright)
        // (lying with the wall's heading, its length pointing away from the wall: tipping it up is a pure roll)
        const Lp = def(p.def).size[0];
        const lc: Vec2 = narrowW ? W(uMin - 0.3, lineV(0) - 1.9) : [q.p[0] + outN[0] * (0.4 + Lp / 2), q.p[2] + outN[1] * (0.4 + Lp / 2)];
        const f = fetch(p, { x: r3(lc[0]), z: r3(lc[1]), yaw: r3(q.yaw) }, G);
        if (!f) continue;
        const lift = [
          // by its long edges; flat they stand 0.3 m beyond those edges, stood up 0.45 m out from its face
          { actor: C(G[0]), grip: [upper ? -0.9 : 0, sy * 0.01, -0.55] as [number, number, number], stand: [0, sy * 0.45, -0.36] as [number, number, number] },
          { actor: C(G[1]), grip: [upper ? -0.9 : 0, sy * 0.01, 0.55] as [number, number, number], stand: [0, sy * 0.45, 0.36] as [number, number, number] },
        ];
        const from = { x: r3(outN[0] * 0.3), y: upper ? -0.95 : 0, z: r3(outN[1] * 0.3) }; // the upper panel is walked in at its hand-off height
        if (line === 'frame' && !upper) {
          const st = step('install_wall', { part: p.id, to: pose(p), lift, from, fasten: G.map(C) }, G, [f], `stand ${p.id} against the end frames and screw it to them`);
          mark(p, st);
          continue;
        }
        // the deck crew: one on the first-floor deck (top line of a ground wall / bottom line of the upper wall), one on the roof deck (upper wall's top line)
        const uIn = Lc([q.p[0], q.p[2]])[0] < (uMin + uMax) / 2 ? uMin + 0.33 : uMax - 0.33;
        let vP = safeV(Lc([q.p[0], q.p[2]])[1], uIn);
        // the upper wall's three deck workers stand 0.62 m apart along it (never one above another: a walker cannot take a
        // spot someone occupies in plan, whatever the level): first-floor taker, roof fastener, first-floor taker
        const vc0 = Lc([q.p[0], q.p[2]])[1];
        let vs = [vP, vP, vP]; // first-floor taker (−), roof fastener, first-floor taker (+)
        if (upper) {
          const flines = [...new Set(fr.map((f) => r3(Lc(f.c)[1])))];
          const okL1 = (v: number) => v >= lineV(0) + 0.3 && v <= lineV(K - 1) - 0.3 && flines.every((L) => Math.abs(v - L) >= 0.4);
          let best: number[] | null = null, cost = Infinity;
          for (let a = vc0 - 1.2; a <= vc0 + 0.3; a += 0.05) for (let c = vc0 - 0.3; c <= vc0 + 1.2; c += 0.05) {
            if (!okL1(a) || !okL1(c) || c - a < 1.24 - 1e-9 || Math.abs(a - (vc0 - 0.45)) > 0.7 || Math.abs(c - (vc0 + 0.45)) > 0.7) continue;
            const b = (a + c) / 2;
            if (b < lineV(0) + 0.3) continue;
            const k = Math.abs(a - (vc0 - 0.45)) + Math.abs(c - (vc0 + 0.45)) + 0.01 * Math.abs(b - vc0);
            if (k < cost - 1e-9) { cost = k; best = [a, b, c]; }
          }
          if (best) vs = best.map(r3);
        }
        if (upper) vP = vs[0];
        const d1 = W(uIn, vP);
        const pre: string[] = [];
        pre.push(step('walk_to', { actor: C(2), x: d1[0], z: d1[1], level: levelId(l1Top) }, [2], [], `${C(2)} kneels at the deck edge above ${p.id}`));
        onDeck.set(2, l1Top);
        if (!upper) {
          const st = step('install_wall', { part: p.id, to: pose(p), lift, from, fasten: [C(G[0]), C(2)] }, [...G, 2], [f, ...pre], `stand ${p.id} on the beam line; screwed at the bottom from the ground and at the top from the deck`);
          mark(p, st);
          continue;
        }
        // upper wall: raised by the ground crew to two kneeling on the first-floor deck, screwed from both decks
        const d3 = W(uIn, vs[2]);
        pre.push(step('walk_to', { actor: C(3), x: d3[0], z: d3[1], level: levelId(l1Top) }, [3], []));
        if (!onDeck.has(4)) { upOnto(0, seatOf(levels[2]), 4, uIn < (uMin + uMax) / 2 ? uMin : uMax, lineV(0) + 1.2); onDeck.set(4, l2Top); }
        const d5 = W(uIn, vs[1]);
        pre.push(step('walk_to', { actor: C(4), x: d5[0], z: d5[1], level: levelId(l2Top) }, [4], []));
        const st = step('install_wall', {
          part: p.id, to: pose(p), lift, from, take: [{ actor: C(2), grip: [-0.3, sy * 0.01, -0.45] }, { actor: C(3), grip: [-0.3, sy * 0.01, 0.45] }], handoff: 0.95, fasten: [C(2), C(4)],
        }, [...G, 2, 3, 4], [f, ...pre], `raise ${p.id} to the deck crew; screwed from the first-floor and roof decks`);
        mark(p, st);
      }
    }
    if (onDeck.has(4)) {
      climbDown(0, seatOf(levels[2]), [4], [uMin]);
      // off the ground crew's way (they walk the −x panels in along the wall from the far end)
      const q = W(uMax + 2.2, lineV(0) - 1.5);
      step('walk_to', { actor: C(4), x: q[0], z: q[1], level: 0 }, [4], [], `${C(4)} stands clear`);
    }
  }
  // ---------------------------------------------------------------- P: solar, last (§9)
  if (secs.has('P')) {
    begin('P');
    const rails = P('panel-rail'), panels = P('panel');
    const wallFace = uMax + BEAM_HALF + (P('wall-panel').some((w) => Lc([w.pose.p[0], w.pose.p[2]])[0] > uMax - 0.1) ? PLY_T : 0);
    // the roof crew (4, 5) climbs to the roof deck; the relay (2, 3) kneels on the first-floor deck (up the stair)
    let w5: string[] = [];
    if (levels.length > 2) {
      // up the far end frame one after the other (inner column first, then the outer), the second one waits at the far end
      upOnto(0, seatOf(levels[2]), 5, uMax - depth, lineV(0) + 1.2);
      const q5 = W(uMin + 0.6, lineV(K - 1) - 0.6);
      w5 = [step('walk_to', { actor: C(5), x: q5[0], z: q5[1], level: levelId(l2Top) }, [5], [], `${C(5)} waits at the far end of the roof`)];
      upOnto(0, seatOf(levels[2]), 4, uMax, lineV(0) + 1.2, w5);
    }
    const l2Lv = levelId(l2Top), l1Lv = levelId(l1Top);
    const railUp = (r: PartB) => {
      const vr = Lc([r.pose.p[0], r.pose.p[2]])[1];
      const lw = W(wallFace + 0.08 + 0.6, vr);
      const f = fetch(r, { x: lw[0], z: lw[1], yaw: r3(r.pose.yaw) }, [G[0]]);
      if (!f) return;
      const ra = W(uMax - 0.31, safeV(vr, uMax - 0.31)), rv = W(uMax - 0.44, safeV(vr + 1.05 + 0.33, uMax - 0.44));
      const pu = step('pass_up', {
        part: r.id, to: { x: r.pose.p[0], z: r.pose.p[2], yaw: r.pose.yaw, height: r3(l2Top) }, edge: r3(wallFace), out: { x: W(1, 0)[0], z: W(1, 0)[1] },
        givers: [C(G[0])], relay: [C(2)], relayAt: [{ x: ra[0], z: ra[1], level: l1Lv }], receivers: [C(4)], receiverAt: [{ x: rv[0], z: rv[1], level: l2Lv }], follow: true,
      }, [G[0], 2, 4], [f, ...w5], `pass rail ${r.id} up through the relay to the roof deck`);
      const under = decks.filter((d) => d.meta.level === levels[levels.length - 1]).sort((a, b) => Math.abs(uc(a) - Lc([r.pose.p[0], r.pose.p[2]])[0]) + Math.abs(vc(a) - vr) - (Math.abs(uc(b) - Lc([r.pose.p[0], r.pose.p[2]])[0]) + Math.abs(vc(b) - vr)))[0];
      const ir = step('install_rail', { actor: C(4), rail: r.id, onto: under.id, at: { x: r.pose.p[0], z: r.pose.p[2], yaw: r.pose.yaw } }, [4], [pu], `fasten rail ${r.id} to the roof deck`);
      mark(r, pu, ir);
    };
    // panels: install_panel's crew stands beyond both ends of the tilt axis, so a panel is mounted only while both
    // neighbours in its row are still off (not tilted): every other panel of a row
    const rows = new Map<string, PartB[]>();
    for (const p of panels) { const k = `${r3(Lc([p.pose.p[0], p.pose.p[2]])[0])}`; rows.set(k, [...(rows.get(k) ?? []), p]); }
    for (const [, row] of [...rows.entries()].sort(defaultSortOrder)) {
      row.sort((a, b) => Lc([a.pose.p[0], a.pose.p[2]])[1] - Lc([b.pose.p[0], b.pose.p[2]])[1]);
      // mountable: both end stations (half its width + 0.45 m along the rails) on the roof deck, and no mounted neighbour
      const vOf = (p: PartB) => Lc([p.pose.p[0], p.pose.p[2]])[1];
      const reachEnd = def(row[0].def).size[2] / 2 + 0.45;
      const vLo = lineV(0) - 0.0381 + 0.3, vHi = lineV(K - 1) + 0.0381 - 0.3; // (the deck spans frame centre to frame centre)
      const chosen = new Set<number>();
      // (and its rail pair clear of the rails of the panel chosen before it)
      const railSpan = (q: PartB) => { const rs = (q.meta.rails as string).split(',').map((id) => rails.find((r) => r.id === id)!); const v = Lc([rs[0].pose.p[0], rs[0].pose.p[2]])[1]; return [v - 1.05, v + 1.05]; };
      let lastSpan: number[] | null = null;
      const flinesP = [...new Set(fr.map((f) => r3(Lc(f.c)[1])))];
      const overFrame = (q: PartB) => flinesP.some((L) => Math.abs(vOf(q) - L) < def(q.def).size[2] / 2 + fh + 0.01);
      for (let i = 0; i < row.length; i++) {
        if (vOf(row[i]) - reachEnd < vLo || vOf(row[i]) + reachEnd > vHi || chosen.has(i - 1) || overFrame(row[i])) continue;
        const sp = railSpan(row[i]);
        if (lastSpan && sp[0] < lastSpan[1] + 0.02) continue;
        chosen.add(i);
        lastSpan = sp;
      }
      const pitch = row.length > 1 ? vOf(row[1]) - vOf(row[0]) : 0;
      for (const [i, p] of row.entries()) {
        if (!chosen.has(i)) {
          const why = overFrame(p)
            ? `it spans a frame line whose columns stand 5 cm above the roof deck (16 ft frames top out above a deck laid on the top beams; the Kit draws its roof deck above them): flat on its rails it would sit on the column tops`
            : vOf(p) - reachEnd < vLo || vOf(p) + reachEnd > vHi
            ? `install_panel (solar.ts) stands its crew beyond both ends of the tilt axis (${reachEnd.toFixed(2)} m from the centre): one end falls off the roof deck at the end of the row`
            : chosen.has(i - 1) || chosen.has(i + 1)
              ? `install_panel (solar.ts) stands its crew beyond both ends of the tilt axis, inside the neighbouring panels' places (${reachEnd.toFixed(2)} m from its centre vs a ${pitch.toFixed(2)} m pitch): a tilted neighbour leaves no station, so only every other panel of the row is mounted`
              : `its rail pair (shifted clear of the frame columns above the roof deck) would overlap the rails of the panel mounted before it; with install_panel's end stations only every other panel can be mounted anyway`;
          for (const n of p.nodes) unplaced.push({ node: n, kind: 'feature:solar', reason: `not mounted: ${why} — needs side stations in install_panel` });
          continue;
        }
        // its own rail pair first
        for (const rid of (p.meta.rails as string).split(',')) railUp(rails.find((r) => r.id === rid)!);
        const vp = Lc([p.pose.p[0], p.pose.p[2]])[1];
        const flat = { x: p.meta.flatX as number, z: p.meta.flatZ as number };
        const lw = W(wallFace + 0.08 + def(p.def).size[0] / 2 + 0.6, vp);
        const f = fetch(p, { x: lw[0], z: lw[1], yaw: r3(p.pose.yaw) }, G);
        if (!f) continue;
        const uR = uMax - 0.27; // the relay kneels right at the deck edge (the panel goes up outside the wall)
        const rl = [W(uR, safeV(vp - 0.3, uR)), W(uR, safeV(vp + 0.3, uR))];
        if (dot2([rl[0][0] - rl[1][0], rl[0][1] - rl[1][1]], [rl[0][0] - rl[1][0], rl[0][1] - rl[1][1]]) < 0.36) rl[1] = W(uR, safeV(vp + 0.9, uR));
        const rv = [W(uMax - 0.44, safeV(vp - 0.84, uMax - 0.44)), W(uMax - 0.44, safeV(vp + 0.84, uMax - 0.44))];
        const pu = step('pass_up', {
          part: p.id, to: { x: flat.x, z: flat.z, yaw: p.pose.yaw, height: r3(p.meta.flatY as number) }, edge: r3(wallFace), out: { x: W(1, 0)[0], z: W(1, 0)[1] },
          givers: G.map(C), relay: [C(2), C(3)], relayAt: rl.map((q) => ({ x: q[0], z: q[1], level: l1Lv })), receivers: [C(4), C(5)], receiverAt: rv.map((q) => ({ x: q[0], z: q[1], level: l2Lv })), follow: true,
        }, [...G, 2, 3, 4, 5], [f], `pass panel ${p.id} up through the relay onto its rails`);
        const ip = step('install_panel', { crew: [C(4), C(5)], panel: p.id, rails: (p.meta.rails as string).split(','), tilt: p.meta.tilt }, [4, 5], [pu], `tilt panel ${p.id} to ${(p.meta.tilt as number).toFixed(1)}° and fasten it`);
        mark(p, pu, ip);
      }
    }
    if (levels.length > 2) climbDown(0, seatOf(levels[2]), [4, 5], [uMax, uMax - depth], [], 0.55); // (clear of the panels near the end)
  }
  // ---------------------------------------------------------------- END: everyone on the ground, clear of the house
  if (secs.has('END')) {
    begin('END');
    for (const [i, m] of [0, 1, 2, 3, 4, 5].entries()) { const q = W(uMax + 2.2, lineV(0) + 1.0 + i * 1.1); step('walk_to', { actor: C(m), x: q[0], z: q[1], level: 0 }, [m], [], `${C(m)} steps back from the finished house`); }
  }
  void K; void lineV; void fh; void skip;
  const seq: PhaseBResult['sequenced'] = [...seqd.entries()].map(([node, steps]) => ({ node, kind: `feature:${parts.kit.find((k) => k.node === node)?.kind ?? 'part'}`, steps })).sort((a, b) => (a.node < b.node ? -1 : 1));
  return { sequenced: seq, unplaced, done, sectionStarts };
}

const pose = (p: PartB) => ({ x: p.pose.p[0], y: p.pose.p[1], z: p.pose.p[2], yaw: p.pose.yaw, ...(p.pose.roll !== undefined ? { roll: p.pose.roll } : {}), ...(p.pose.pitch !== undefined ? { pitch: p.pose.pitch } : {}) });
