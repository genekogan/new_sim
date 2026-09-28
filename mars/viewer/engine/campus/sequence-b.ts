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

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const BEAM_HALF = 0.0254, PLY_T = 0.01905;
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
  /** Is the ground beside the house on its −u side taken near local v (a neighbour's stair)? The givers then hold the pieces by their sides. */
  narrowMinusU: (v: number) => boolean;
  /** Crew positions at the start of phase B when run from a snapshot (sections only). */
};
export type PhaseBResult = { sequenced: { node: string; kind: string; steps: string[] }[]; unplaced: UnplacedB[]; done: string[]; sectionStarts: { section: Section; at: number }[] };

export function phaseB(ctx: PhaseBCtx): PhaseBResult {
  const { step, C, parts } = ctx;
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
  const done: string[] = [];
  const sectionStarts: PhaseBResult['sectionStarts'] = [];
  const begin = (sec: Section) => sectionStarts.push({ section: sec, at: ctx.count() });
  const seqd = new Map<string, string[]>();
  const mark = (p: PartB, ...ids: string[]) => { for (const n of p.nodes) { const a = seqd.get(n) ?? []; a.push(...ids); seqd.set(n, a); } done.push(p.id); };
  const unplaced: UnplacedB[] = [];
  const P = (role: string) => parts.parts.filter((p) => p.role === role);
  const yawW = (localYaw: number) => localYaw + ctx.Y; // a local-frame heading → world yaw
  // ---------------------------------------------------------------- material flow
  const st = ctx.yard.station!;
  const stU = rot2([1, 0], st.yaw), stV = rot2([0, 1], st.yaw);
  // in-feed spot: behind the operator (the bench's −z side), the stock parallel to the bench
  const inFeed = (d: string) => { const w = def(d).category === 'plywood' ? def(d).size[2] : Math.max(def(d).size[2], 0.1); const o = 0.5 + 0.45 + 0.35 + 0.3 + w / 2; return { x: r3(st.x - stV[0] * o), z: r3(st.z - stV[1] * o), yaw: r3(st.yaw) }; };
  let stationFree: string[] = []; // steps that clear the out-feed of the last cut
  let inFeedFree: string[] = [];
  /** Where an offcut is laid beside the scrap pile before it is stacked (clear of the pile by 0.1 m). */
  const scrapSpot = (d: string) => { const sc = ctx.scrap!; const o = rot2([0, def('scrap-pile').size[2] / 2 + 0.1 + def(d).size[2] / 2], sc.yaw); return { x: r3(sc.x + o[0]), z: r3(sc.z + o[1]), yaw: r3(sc.yaw) }; };
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
  const sideOf = (p: PartB) => ((p.meta.piece as number) <= (p.meta.of as number) / 2 ? -1 : 1); // −u side first piece(s), +u the rest
  const uc = (p: PartB) => Lc([p.pose.p[0], p.pose.p[2]])[0];
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
        const lw = W(Rc + side * (narrow ? 0.3 : 0.6), vc(p)); // set down a little further out than where it goes up (room for the carry formation)
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
          givers: G.map(C), receivers: [C(recv)], receiverAt: [{ x: qa[0], z: qa[1], level: 0 }], give: r3(p.y + 0.05), push: true, fasten: [f2nd],
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
  const climbDown = (k: number, seat: number, who: number[], uAt: number[]) => {
    for (const [i, m] of who.entries()) {
      const col = [uMin, uMin + depth, uMax - depth, uMax].sort((a, b) => Math.abs(a - uAt[i]) - Math.abs(b - uAt[i]))[0];
      const c = climbAt(k, col, seat);
      if (!c) continue;
      const vOn = k === 0 ? lineV(0) + 1.2 : lineV(k) - 1.2;
      const q = W(col, vOn);
      const d = W(Math.min(Math.max(col, uMin + 0.44), uMax - 0.44), vOn);
      step('walk_to', { actor: C(m), x: d[0], z: d[1], level: levelId(seat + def('beam-12ft').size[1] / 2 + PLY_T) }, [m], [], `${C(m)} walks to the end of the deck`);
      step('step_onto_beam', { actor: C(m), beam: c.beam, x: q[0], z: q[1] }, [m], []);
      step('climb_frame', { actor: C(m), link: c.link, dir: 'down' }, [m], [], `${C(m)} climbs down the end frame`);
    }
  };
  /** Up onto a deck: climb frame line k onto its bay's walkway at `seat`, step off onto the deck at (u, v). */
  const upOnto = (k: number, seat: number, m: number, u: number, v: number) => {
    const c = climbAt(k, u, seat);
    if (!c) return false;
    step('climb_frame', { actor: C(m), link: c.link, dir: 'up' }, [m], [], `${C(m)} climbs the end frame to the ${seat.toFixed(2)} m deck`);
    const q = W(Math.min(Math.max(u, uMin + 0.44), uMax - 0.44), v);
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
    if (!climbUp(seat, up, uWalk.slice(0, up.length), vWalk(first))) { for (const p of decks.filter((x) => x.meta.level === lv)) skip(p, `no climbable end frame onto the ${seat.toFixed(2)} m beams`); return; }
    const uNow = new Map(up.map((m, i) => [m, uWalk[i]]));
    const later: PartB[] = []; // first-strip pieces nobody up there could fasten from the beams: fastened from the deck
    let onDeck = false;
    for (const s of strips) {
      const vPlus = s + 0.6096;
      for (const p of order(piecesOf(lv, s))) {
        const side = sideOf(p);
        const L = lenOf(p);
        const edge = side < 0 ? uMin - BEAM_HALF : uMax + BEAM_HALF;
        const Rc = side < 0 ? edge - 0.08 - L / 2 : edge + 0.08 + L / 2;
        const narrow = side < 0 && ctx.narrowMinusU(vc(p));
        const lw = W(Rc + side * (narrow ? 0.3 : 0.6), vc(p));
        const outV = W(side, 0);
        let recv: number, recvAt: { x: number; z: number; level: number } | undefined, fz: number | null, fzAt: { x: number; z: number; level: number } | undefined;
        const pre: string[] = [];
        if (!onDeck) {
          recv = side < 0 ? up[0] : up[1];
          fz = up.length > 3 ? (side < 0 ? up[2] : up[3]) : side < 0 && up.length > 2 ? up[2] : null;
          const uR = side < 0 ? uMin : (p.meta.piece === (p.meta.of as number) || L < 1.2 ? uMax : uMax - 0.09);
          if (Math.abs((uNow.get(recv) ?? uR) - uR) > 0.005) { const q = W(uR, vWalk(first)); pre.push(step('beam_walk', { actor: C(recv), x: q[0], z: q[1] }, [recv], [])); uNow.set(recv, uR); }
        } else {
          // kneeling on the strip laid before it (on its stair side)
          recv = side < 0 ? up[0] : up[1];
          fz = side < 0 ? up[1] : up[0];
          const uR = side < 0 ? uMin + 0.44 : uMax - 0.44;
          const q = W(uR, vPlus + 0.35);
          recvAt = { x: q[0], z: q[1], level: deckLv };
          const uF = Math.min(Math.max(uc(p), uMin + 0.44), uMax - 0.44) + (Math.abs(uc(p) - uR) < 0.62 ? (side < 0 ? 0.62 : -0.62) : 0);
          const q2 = W(uF, vPlus + 0.35);
          fzAt = { x: q2[0], z: q2[1], level: deckLv };
        }
        const f = fetch(p, { x: lw[0], z: lw[1], yaw: r3(yawW(0)) }, G);
        if (!f) continue;
        let relayAt: { x: number; z: number; level: number }[] | undefined;
        if (cfg.relay !== null) { const q = W(side < 0 ? uMin + 0.31 : uMax - 0.31, vc(p)); relayAt = [{ x: q[0], z: q[1], level: levelId(cfg.relayY!) }]; }
        const pu = step('pass_up', {
          part: p.id, to: { x: p.pose.p[0], z: p.pose.p[2], yaw: p.pose.yaw, height: r3(yTop) }, edge: r3(side < 0 ? -edge : edge), out: { x: outV[0], z: outV[1] },
          givers: G.map(C), ...(cfg.relay !== null ? { relay: [C(cfg.relay)], relayAt } : {}), receivers: [C(recv)], ...(recvAt ? { receiverAt: [recvAt], follow: true } : {}),
          ...(fz !== null ? { fasten: [{ actor: C(fz), ...(fzAt ? { at: fzAt } : {}) }] } : {}),
        }, [...G, recv, ...(fz !== null ? [fz] : []), ...(cfg.relay !== null ? [cfg.relay] : [])], [f, ...pre], `pass ${p.id} up${cfg.relay !== null ? ' through the relay' : ''} to ${yTop.toFixed(2)} m${fz !== null ? '; fastened' : ''}`);
        mark(p, pu);
        if (fz === null) later.push(p);
      }
      if (!onDeck) {
        // off the beams onto the strip just laid; fasten what was left staged
        for (const m of up) { const u0 = uNow.get(m)!; const q = W(Math.min(Math.max(u0, uMin + 0.44), uMax - 0.44), first - 0.6096 + 0.35); step('beam_walk', { actor: C(m), x: q[0], z: q[1] }, [m], [], `${C(m)} steps off the beam onto the new deck`); }
        onDeck = true;
        for (const p of later) {
          const a = W(Math.min(Math.max(uc(p) - 0.35, uMin + 0.44), uMax - 0.44), s - 0.6096 - 0.35), b = W(Math.min(Math.max(uc(p) + 0.35, uMin + 0.44), uMax - 0.44), s - 0.6096 - 0.35);
          // (the next strip is not laid yet: they kneel at the new strip's −v edge… on the strip itself)
          const a2 = W(Math.min(Math.max(uc(p) - 0.35, uMin + 0.44), uMax - 0.44), s - 0.2), b2 = W(Math.min(Math.max(uc(p) + 0.35, uMin + 0.44), uMax - 0.44), s - 0.2);
          void a; void b;
          const w1 = step('walk_to', { actor: C(up[0]), x: a2[0], z: a2[1], level: deckLv }, [up[0]], []);
          const w2 = step('walk_to', { actor: C(up[1]), x: b2[0], z: b2[1], level: deckLv }, [up[1]], []);
          const inst = step('install_plywood', { crew: [C(up[0]), C(up[1])], sheet: p.id, x: p.pose.p[0], z: p.pose.p[2], yaw: p.pose.yaw, height: r3(yTop) }, [up[0], up[1]], [w1, w2], `fasten ${p.id}`);
          mark(p, inst);
        }
      }
    }
    return { seat, deckLv };
  };
  if (secs.has('D1') && levels.length > 1) {
    begin('D1');
    upperDeck({ lv: levels[1], relay: null, up: [2, 3, 4, 5] });
    climbDown(KE, seatOf(levels[1]), [2, 3, 4, 5], uWalk);
  }
  const relayY = levels.length > 1 ? piecesOf(levels[1], stripsOf(levels[1])[0])[0].y + PLY_T : 0;
  if (secs.has('D2') && levels.length > 2) {
    begin('D2');
    // the relay kneels on the first-floor deck (up the end frame and off its beam); the roof crew climbs to the roof beams
    const s1 = seatOf(levels[1]);
    upOnto(KE, s1, 2, uMin + depth, lineV(KE) - 1.0);
    upperDeck({ lv: levels[2], relay: 2, relayY, up: [3, 4, 5] });
    climbDown(KE, seatOf(levels[2]), [3, 4, 5], [uMin, uMax, uMax - depth]);
    climbDown(KE, s1, [2], [uMin + depth]);
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
    // stringers: lying along the stair at their lateral position, lifted and walked up against the end frame
    for (const [i, p] of stringers.entries()) {
      const lat = latOf(p.pose.p[0], p.pose.p[2]);
      const nextFree = i < stringers.length - 1 ? 0.37 : 0.37; // stand on the side of the stringer still open (the next one is not in yet)
      const L = lenOf(p);
      const g1: [number, number, number] = [-1.2, def(p.def).size[1], 0], g2: [number, number, number] = [-0.2, def(p.def).size[1], 0];
      const a = localToWorld(p.pose, g1), b = localToWorld(p.pose, g2);
      const off = rot2([0, 1], 0); void off;
      const sc = sOf(p.pose.p[0], p.pose.p[2]);
      const lie = S(sc - 1.6, lat);
      const f = fetch(p, { x: lie[0], z: lie[1], yaw: r3(yawDir) }, G);
      if (!f) continue;
      const at = (q: number[]) => { const o = [q[0] + axis[0] * nextFree, q[2] + axis[1] * nextFree]; return { x: r3(o[0]), z: r3(o[1]) }; };
      const s1 = step('install_stringer', { part: p.id, to: pose(p), lift: [{ actor: C(G[0]), grip: g1, at: at(a) }, { actor: C(G[1]), grip: g2, at: at(b) }], from: { x: r3(dir[0] * -0.3), y: 0.05, z: r3(dir[1] * -0.3) }, fasten: G.map(C) }, G, [f], `set stringer ${i + 1} against the end frame`);
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
    const standOn = (who: number, k: number) => {
      // climb the installed treads 1…k to stand on tread k's centre
      const up = ur.v;
      if (up && up.tread === k) return [] as string[];
      const out: string[] = [];
      if (up) out.push(step('leave_stair', { actor: C(up.who), boards: sd.treads.slice(0, up.tread).flat(), to: { x: S(-0.9, lat0 - halfW - 0.6)[0], z: S(-0.9, lat0 - halfW - 0.6)[1] } }, [up.who], []));
      const c = S(sOfTread(k), lat0);
      out.push(step('climb_stair', { actor: C(who), boards: sd.treads.slice(0, k).flat(), to: { x: c[0], z: c[1] } }, [who], [], `${C(who)} climbs the treads to stand on tread ${k}`));
      ur.v = { who, tread: k };
      return out;
    };
    function sOfTread(k: number) { const b = byTread.get(k)!; return b.reduce((a, x) => a + sOf(x.pose.p[0], x.pose.p[2]), 0) / b.length; }
    const helper = 2; // the builder standing on the treads (from the first-floor deck crew, who came down... or the ground)
    for (let k = 1; k <= n; k++) {
      // the riser under tread k stands on tread k−1: set it before tread k
      for (const r of risers.filter((x) => Math.abs(x.y - top[k - 2]) < 0.02 && k >= 2)) placeLow(r, true);
      for (const b of (byTread.get(k) ?? []).sort((a, c) => (a.meta.board as number) - (c.meta.board as number))) placeLow(b, false);
    }
    function placeLow(p: PartB, isRiser: boolean) {
      const sc = sOf(p.pose.p[0], p.pose.p[2]);
      const L = lenOf(p);
      const bottom = p.pose.p[1];
      const g1: [number, number, number] = [-(L / 2) + 0.05, 0, 0], g2: [number, number, number] = [L / 2 - 0.05, 0, 0];
      const e1 = S(sc, lo - 0.35), e2 = S(sc, hi + 0.35);
      const lie = S(-0.9 - (isRiser ? 0.5 : 0), lat0);
      const f = fetch(p, { x: lie[0], z: lie[1], yaw: r3(p.pose.yaw) }, G);
      if (!f) return;
      const lift = Math.min(0.08, reachTop - bottom);
      if (lift >= 0.02) {
        const dz = -(sc - (-0.9 - (isRiser ? 0.5 : 0)));
        const s1 = step('install_stair_part', { part: p.id, to: pose(p), lift: [{ actor: C(G[0]), grip: g1, at: { x: e1[0], z: e1[1] } }, { actor: C(G[1]), grip: g2, at: { x: e2[0], z: e2[1] } }], from: { x: r3(dir[0] * dz), y: r3(lift), z: r3(dir[1] * dz) }, fasten: G.map(C) }, G, [f], `set ${p.id} ${isRiser ? 'on the tread below' : 'on the stringers'}`);
        mark(p, s1);
        return;
      }
      // above the ground crew's reach: they raise it to a builder standing on the highest complete tread below
      const k = Math.max(...[...byTread.entries()].filter(([, bs]) => bs.every((b) => b.pose.p[1] + def(b.def).size[1] < bottom - 0.05)).map(([t]) => t));
      const pre = standOn(helper, k);
      const handoff = r3(Math.max(0.05, bottom - (reachTop - 0.03)));
      const s1 = step('install_stair_part', {
        part: p.id, to: pose(p), lift: [{ actor: C(G[0]), grip: g1, at: { x: e1[0], z: e1[1] } }, { actor: C(G[1]), grip: g2, at: { x: e2[0], z: e2[1] } }],
        take: [{ actor: C(helper), grip: [0, isRiser ? 0.05 : 0, 0] }], handoff, from: { x: r3(dir[0] * -(sc + 0.9)), y: r3(-handoff), z: r3(dir[1] * -(sc + 0.9)) }, fasten: [C(helper)],
      }, [...G, helper], [f, ...pre], `${C(helper)} on tread ${k} takes ${p.id} from the ground crew and sets it`);
      mark(p, s1);
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
      const s1 = step('install_stair_part', { part: p.id, to: pose(p), lift: [{ actor: C(G[0]), grip: [-0.2, 0.044, 0], at: { x: at[0], z: at[1] } }], fasten: [C(G[0])] }, [G[0]], [f], `bolt post ${p.id} to the tread end`);
      mark(p, s1);
    }
    // handrails: two on the ground at its lower half, laid on the post tops from outside
    for (const p of rails) {
      const side = p.meta.side as number;
      const g1: [number, number, number] = [-1.9, 0, 0], g2: [number, number, number] = [-0.6, 0, 0];
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
  const safeV = (v: number, u: number) => {
    // a spot on a deck at local (u, v) clear of the frame planes (0.36 m) and of the deck edges
    const lines = [...new Set(fr.map((f) => r3(Lc(f.c)[1])))];
    const inRow = fr.some((f) => Math.abs(Lc(f.c)[0] - u) < depth / 2 + 0.3);
    let vv = v;
    if (inRow) for (const L of lines) if (Math.abs(vv - L) < 0.4) vv = L + (vv >= L ? 0.4 : -0.4);
    return Math.min(Math.max(vv, lineV(0) + 0.4), lineV(K - 1) - 0.4);
  };
  if (secs.has('W')) {
    begin('W');
    const panels = P('wall-panel');
    const walls = [...new Set(panels.map((p) => p.nodes[0]))].sort();
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
        const wa: Vec2 = [wallAxis[0] - o[0], wallAxis[2] - o[1]];
        const nrm: Vec2 = [-wa[1], wa[0]];
        const outN: Vec2 = dot2(nrm, outD) > 0 ? nrm : [-nrm[0], -nrm[1]];
        const sy = dot2(dY, outN) > 0 ? 1 : -1;
        // lying flat outside the wall, its length along the wall
        const Wd = def(p.def).size[2];
        const lc: Vec2 = [q.p[0] + outN[0] * (0.3 + Wd / 2 + 0.05), q.p[2] + outN[1] * (0.3 + Wd / 2 + 0.05)];
        const f = fetch(p, { x: r3(lc[0]), z: r3(lc[1]), yaw: r3(q.yaw + Math.PI / 2) }, G);
        if (!f) continue;
        const lift = [
          { actor: C(G[0]), grip: [upper ? -0.9 : 0, sy * 0.01, -0.4] as [number, number, number], stand: [-1.35, sy * 0.45, 0] as [number, number, number] },
          { actor: C(G[1]), grip: [upper ? -0.9 : 0, sy * 0.01, 0.4] as [number, number, number], stand: [1.35, sy * 0.45, 0] as [number, number, number] },
        ];
        const from = { x: r3(outN[0] * 0.3), y: 0, z: r3(outN[1] * 0.3) };
        if (line === 'frame' && !upper) {
          const st = step('install_wall', { part: p.id, to: pose(p), lift, from, fasten: G.map(C) }, G, [f], `stand ${p.id} against the end frames and screw it to them`);
          mark(p, st);
          continue;
        }
        // the deck crew: one on the first-floor deck (top line of a ground wall / bottom line of the upper wall), one on the roof deck (upper wall's top line)
        const uIn = Lc([q.p[0], q.p[2]])[0] < (uMin + uMax) / 2 ? uMin + 0.33 : uMax - 0.33;
        const vP = safeV(Lc([q.p[0], q.p[2]])[1], uIn);
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
        const d3 = W(uIn, vP + (vP > Lc([q.p[0], q.p[2]])[1] ? 0.62 : -0.62));
        pre.push(step('walk_to', { actor: C(3), x: d3[0], z: d3[1], level: levelId(l1Top) }, [3], []));
        if (!onDeck.has(4)) { upOnto(0, seatOf(levels[2]), 4, uIn < (uMin + uMax) / 2 ? uMin : uMax, lineV(0) + 1.2); onDeck.set(4, l2Top); }
        const d5 = W(uIn, vP);
        pre.push(step('walk_to', { actor: C(4), x: d5[0], z: d5[1], level: levelId(l2Top) }, [4], []));
        const st = step('install_wall', {
          part: p.id, to: pose(p), lift, from, take: [{ actor: C(2), grip: [-0.55, sy * 0.01, -0.3] }, { actor: C(3), grip: [-0.55, sy * 0.01, 0.3] }], handoff: 0.85, fasten: [C(2), C(4)],
        }, [...G, 2, 3, 4], [f, ...pre], `raise ${p.id} to the deck crew; screwed from the first-floor and roof decks`);
        mark(p, st);
      }
    }
    if (onDeck.has(4)) climbDown(0, seatOf(levels[2]), [4], [uMin]);
  }
  // ---------------------------------------------------------------- P: solar, last (§9)
  if (secs.has('P')) {
    begin('P');
    const rails = P('panel-rail'), panels = P('panel');
    const wallFace = uMax + BEAM_HALF + (P('wall-panel').some((w) => Lc([w.pose.p[0], w.pose.p[2]])[0] > uMax - 0.1) ? PLY_T : 0);
    // the roof crew (4, 5) climbs to the roof deck; the relay (2, 3) kneels on the first-floor deck (up the stair)
    if (levels.length > 2) { upOnto(0, seatOf(levels[2]), 4, uMax, lineV(0) + 1.2); upOnto(0, seatOf(levels[2]), 5, uMax - depth, lineV(0) + 1.2); }
    const l2Lv = levelId(l2Top), l1Lv = levelId(l1Top);
    for (const r of rails) {
      const vr = Lc([r.pose.p[0], r.pose.p[2]])[1];
      const lw = W(wallFace + 0.08 + 0.6, vr);
      const f = fetch(r, { x: lw[0], z: lw[1], yaw: r3(r.pose.yaw) }, [G[0]]);
      if (!f) continue;
      const ra = W(uMax - 0.31, safeV(vr, uMax - 0.31)), rv = W(uMax - 0.44, safeV(vr + 1.05 + 0.33, uMax - 0.44));
      const pu = step('pass_up', {
        part: r.id, to: { x: r.pose.p[0], z: r.pose.p[2], yaw: r.pose.yaw, height: r3(l2Top) }, edge: r3(wallFace), out: { x: W(1, 0)[0], z: W(1, 0)[1] },
        givers: [C(G[0])], relay: [C(2)], relayAt: [{ x: ra[0], z: ra[1], level: l1Lv }], receivers: [C(4)], receiverAt: [{ x: rv[0], z: rv[1], level: l2Lv }], follow: true,
      }, [G[0], 2, 4], [f], `pass rail ${r.id} up through the relay to the roof deck`);
      const under = decks.filter((d) => d.meta.level === levels[levels.length - 1]).sort((a, b) => Math.abs(uc(a) - Lc([r.pose.p[0], r.pose.p[2]])[0]) + Math.abs(vc(a) - vr) - (Math.abs(uc(b) - Lc([r.pose.p[0], r.pose.p[2]])[0]) + Math.abs(vc(b) - vr)))[0];
      const ir = step('install_rail', { actor: C(4), rail: r.id, onto: under.id, at: { x: r.pose.p[0], z: r.pose.p[2], yaw: r.pose.yaw } }, [4], [pu], `fasten rail ${r.id} to the roof deck`);
      mark(r, pu, ir);
    }
    // panels: install_panel's crew stands beyond both ends of the tilt axis, so a panel is mounted only while both
    // neighbours in its row are still off (not tilted): every other panel of a row
    const rows = new Map<string, PartB[]>();
    for (const p of panels) { const k = `${r3(Lc([p.pose.p[0], p.pose.p[2]])[0])}`; rows.set(k, [...(rows.get(k) ?? []), p]); }
    for (const [, row] of [...rows.entries()].sort()) {
      row.sort((a, b) => Lc([a.pose.p[0], a.pose.p[2]])[1] - Lc([b.pose.p[0], b.pose.p[2]])[1]);
      for (const [i, p] of row.entries()) {
        if (i % 2 === 1) {
          for (const n of p.nodes) unplaced.push({ node: n, kind: 'feature:solar', reason: `not mounted: install_panel (solar.ts) stands its crew beyond both ends of the tilt axis, inside the neighbouring panels' places (${(1.0723 / 2 + 0.45).toFixed(2)} m from its centre vs ${(Lc([row[1].pose.p[0], row[1].pose.p[2]])[1] - Lc([row[0].pose.p[0], row[0].pose.p[2]])[1]).toFixed(2)} m panel pitch); with the neighbours tilted there is no station — needs side stations in install_panel` });
          continue;
        }
        const vp = Lc([p.pose.p[0], p.pose.p[2]])[1];
        const flat = { x: p.meta.flatX as number, z: p.meta.flatZ as number };
        const lw = W(wallFace + 0.08 + def(p.def).size[0] / 2 + 0.6, vp);
        const f = fetch(p, { x: lw[0], z: lw[1], yaw: r3(p.pose.yaw) }, G);
        if (!f) continue;
        const rl = [W(uMax - 0.31, safeV(vp - 0.3, uMax - 0.31)), W(uMax - 0.31, safeV(vp + 0.3, uMax - 0.31))];
        if (dot2([rl[0][0] - rl[1][0], rl[0][1] - rl[1][1]], [rl[0][0] - rl[1][0], rl[0][1] - rl[1][1]]) < 0.36) rl[1] = W(uMax - 0.31, safeV(vp + 0.9, uMax - 0.31));
        const rv = [W(uMax - 0.44, safeV(vp - 0.84, uMax - 0.44)), W(uMax - 0.44, safeV(vp + 0.84, uMax - 0.44))];
        const pu = step('pass_up', {
          part: p.id, to: { x: flat.x, z: flat.z, yaw: p.pose.yaw, height: r3(p.meta.flatY as number) }, edge: r3(wallFace), out: { x: W(1, 0)[0], z: W(1, 0)[1] },
          givers: G.map(C), relay: [C(2), C(3)], relayAt: rl.map((q) => ({ x: q[0], z: q[1], level: l1Lv })), receivers: [C(4), C(5)], receiverAt: rv.map((q) => ({ x: q[0], z: q[1], level: l2Lv })), follow: true,
        }, [...G, 2, 3, 4, 5], [f], `pass panel ${p.id} up through the relay onto its rails`);
        const ip = step('install_panel', { crew: [C(4), C(5)], panel: p.id, rails: (p.meta.rails as string).split(','), tilt: p.meta.tilt }, [4, 5], [pu], `tilt panel ${p.id} to ${(p.meta.tilt as number).toFixed(1)}° and fasten it`);
        mark(p, pu, ip);
      }
    }
    if (levels.length > 2) climbDown(0, seatOf(levels[2]), [4, 5], [uMax, uMax - depth]);
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
