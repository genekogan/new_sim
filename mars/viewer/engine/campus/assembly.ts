// Assembly graph of a canonical campus year (owner feedback 2026-09-28 §7, phase A).
//
// From a year scene (engine/campus/history.ts `sceneFromYearFile`: one or more obstacle prisms per Kit
// component, labelled `<definition name> · <assembly name>`) derive what the reconstruction is built
// from and how the parts depend on each other:
//   * `upright` nodes — a Kit rack frame is drawn as two `rack upright` posts, one `upright crossbar`
//     between them at 0.25 m and diagonal `upright bracing` rods. A crossbar whose two ends sit on two
//     posts (≤ 3 cm) is one catalog upright frame (`upright-<ft>ft-kit`, catalog-stock.ts) when the
//     post height and spacing match a catalog frame (height ±2 cm, depth ±1 cm).
//   * `beam` nodes — a `… beam` box of catalog length (±2 cm) whose two ends sit on posts of two
//     classified frames (≤ 5 cm), running along both frames' normals: it `connects-to` each frame at a
//     column (l / r in the frame's yaw) and a seat height that must be a seat of that frame's def.
//   * `feature` nodes — everything the Kit carries that phase A does not build yet (deck sheets, walls,
//     stair parts, solar, railings, fixtures, vehicles, …), opaque, with a feature class; deck sheets
//     `rests-on` the beams under them.
// Relations are edges `from → to` meaning "from needs to": frame rests-on ground, beam connects-to frame
// (both ends), deck sheet rests-on beam. Anything that matched no rule, or matched one only partly (a post
// with no partner, a beam whose ends miss the posts, a seat that is not a catalog seat) is reported in
// `unclassified` with the reason — never forced into a node.
// Pure and deterministic: nodes and edges are sorted by id.
import { datan2, FT, rot2, wrapAngle, type Vec2 } from '../core/math.ts';
import { CATALOG, def } from '../world/catalog.ts';
import { kitUprightId } from '../world/catalog-stock.ts';
import type { CampusObstacle, CampusScene } from './types.ts';

export const ASSEMBLY_GRAPH_VERSION = 'mars-assembly-graph/1';

export type FeatureClass = 'structural-member' | 'deck-sheet' | 'wall' | 'stair-part' | 'solar' | 'roof' | 'railing' | 'door' | 'window' | 'fixture' | 'vehicle' | 'context';
export type NodeKind = 'upright' | 'beam' | 'feature';

/** A merged component box in world coordinates: centre (x, y, z), yaw of the local x axis, full size (x, y, z). */
export type CompBox = { c: [number, number, number]; yaw: number; size: [number, number, number]; y0: number; y1: number };

export type AsmNode = {
  id: string;
  kind: NodeKind;
  /** Catalog def (uprights, beams). */
  def?: string;
  feature?: FeatureClass;
  assembly: string;
  /** Kit component ids this node is made of (a frame = 2 posts + crossbar + bracing). */
  components: string[];
  /** Kit definition name (the label's first part). */
  kitDef: string;
  /** Canonical placement: box centre, yaw (mod π for symmetric parts), size. */
  box: CompBox;
  /** Uprights: base height (post bottom) and the across axis; beams: seat height above the frames' base. */
  base?: number;
  seat?: number;
};

export type Relation = 'rests-on' | 'connects-to' | 'supported-by';
export type AsmEdge = { from: string; to: string; rel: Relation; socket?: string };
export type Unclassified = { component: string; assembly: string; kitDef: string; reason: string };

export type AssemblyGraph = {
  version: typeof ASSEMBLY_GRAPH_VERSION;
  year: number;
  /** contentHash of the scene the graph came from (== the protected checkpoint's base.staticHash). */
  sceneHash: string;
  nodes: AsmNode[];
  edges: AsmEdge[];
  unclassified: Unclassified[];
};

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const dist = (a: Vec2, b: Vec2) => { const dx = a[0] - b[0], dz = a[1] - b[1]; return Math.sqrt(dx * dx + dz * dz); };
/** Yaw folded to [0, π): symmetric parts (frames, beams, sheets) have no front/back. */
export const foldYaw = (y: number) => { let a = wrapAngle(y); if (a < 0) a += Math.PI; if (a >= Math.PI - 1e-9) a -= Math.PI; return a; };

/** Kit definition name of an obstacle (label = `<def> · <assembly name>`). */
export const kitDefOf = (o: CampusObstacle) => (o.label ?? '').split(' · ')[0];

/** Merge all prisms of one component into one box in the frame of its largest prism. */
export function mergeBox(prisms: CampusObstacle[]): CompBox {
  const big = [...prisms].sort((a, b) => b.obb.half[0] * b.obb.half[1] - a.obb.half[0] * a.obb.half[1] || (a.id < b.id ? -1 : 1))[0];
  const yaw = big.obb.yaw;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const o = big.obb.c;
  for (const p of prisms) {
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const w = rot2([sx * p.obb.half[0], sz * p.obb.half[1]], p.obb.yaw);
      const l = rot2([p.obb.c[0] + w[0] - o[0], p.obb.c[1] + w[1] - o[1]], -yaw);
      x0 = Math.min(x0, l[0]); x1 = Math.max(x1, l[0]); z0 = Math.min(z0, l[1]); z1 = Math.max(z1, l[1]);
    }
    y0 = Math.min(y0, p.y0); y1 = Math.max(y1, p.y1);
  }
  const cl = rot2([(x0 + x1) / 2, (z0 + z1) / 2], yaw);
  let size: [number, number, number] = [x1 - x0, y1 - y0, z1 - z0];
  let yy = yaw;
  // local x = the long horizontal axis
  if (size[2] > size[0]) { size = [size[2], size[1], size[0]]; yy = yaw + Math.PI / 2; }
  return { c: [r4(o[0] + cl[0]), r4((y0 + y1) / 2), r4(o[1] + cl[1])], yaw: foldYaw(yy), size: size.map(r4) as [number, number, number], y0: r4(y0), y1: r4(y1) };
}

function featureOf(kitDef: string, kind: CampusObstacle['kind']): FeatureClass | null {
  const d = kitDef.toLowerCase();
  if (kind === 'vehicle' || /^(yellow (school )?bus body|bus hood|camper van body|popup camper chassis|canvas camper sides)$/.test(d)) return 'vehicle';
  // Named historical vehicle cosmetics remain opaque context, not building stock.
  if (/^(car (road wheel|side glazing|headlight|front bumper)|bus (front bumper|passenger entry|road wheel|front windscreen|radiator grille|black rub rail|headlight|headlamp|front grille|side mirror)|trailer (rear bumper|entry surround))$/.test(d)) return 'vehicle';
  if (/solar|photovoltaic/.test(d)) return 'solar';
  // Timber joists are neither plywood sheets nor validated rack beams.
  if (/\bjoist\b/.test(d)) return 'structural-member';
  if (/deck sheet|rooftop deck|plywood floor|side deck|climbing sheet|deck$/.test(d)) return 'deck-sheet';
  if (/\bstair\b/.test(d)) return 'stair-part';
  if (/door/.test(d)) return 'door';
  if (/window|glaz|glass|translucent/.test(d)) return 'window';
  // Source-photographed opaque cladding; no catalog stock or fastening recipe inferred.
  if (d === 'cahuilla photographed contour panel') return 'wall';
  if (/wall|panel cap|scrim|screen|mural|letters|sign/.test(d)) return 'wall';
  if (/roof|aluminet|tarp|canopy|^shade post$|awning/.test(d)) return 'roof';
  if (/rail/.test(d)) return 'railing';
  if (/curtain/.test(d)) return 'wall';
  if (/ceiling/.test(d)) return 'roof';
  if (/floor|platform/.test(d)) return 'deck-sheet';
  if (/shipping container|^silver shelter shell$/.test(d)) return 'context';
  if (/table|\btap\b|tap spout|shelf|crate|jar|pot|cup|sink|fridge|freezer|counter|bin|bench|chair/.test(d)) return 'fixture';
  if (kind === 'fixture' || kind === 'glass') return 'fixture';
  return null;
}

/** Catalog frame for a post height and column spacing (null → no match). */
function frameDef(h: number, depth: number): { id: string; ft: number } | { why: string } {
  const ft = Math.round(h / FT);
  const id = kitUprightId(ft);
  if (!CATALOG[id]) return { why: `post height ${h.toFixed(3)} m (${ft} ft) has no catalog upright` };
  const d = def(id);
  if (Math.abs(d.size[1] - h) > 0.02) return { why: `post height ${h.toFixed(3)} m is not ${ft} ft (${d.size[1].toFixed(3)} m)` };
  if (Math.abs(d.size[0] - depth) > 0.01) return { why: `column spacing ${depth.toFixed(3)} m ≠ the ${ft} ft frame depth ${d.size[0].toFixed(3)} m` };
  return { id, ft };
}

const BEAM_DEFS = Object.values(CATALOG).filter((d) => d.category === 'rack-beam').sort((a, b) => a.size[0] - b.size[0]);

/** Build the assembly graph of a year scene (all assemblies, or only `assemblies`). */
export function assemblyGraph(year: number, scene: CampusScene, opts: { assemblies?: string[] } = {}): AssemblyGraph {
  const only = opts.assemblies ? new Set(opts.assemblies) : null;
  // group prisms by component
  const byComp = new Map<string, CampusObstacle[]>();
  for (const o of scene.obstacles) {
    if (only && !only.has(o.assembly)) continue;
    const a = byComp.get(o.component);
    if (a) a.push(o); else byComp.set(o.component, [o]);
  }
  const comps = [...byComp.keys()].sort();
  const info = new Map(comps.map((c) => {
    const ps = byComp.get(c)!;
    return [c, { id: c, prisms: ps, assembly: ps[0].assembly, kitDef: kitDefOf(ps[0]), kind: ps[0].kind, box: mergeBox(ps) }];
  }));
  const nodes: AsmNode[] = [];
  const edges: AsmEdge[] = [];
  const unclassified: Unclassified[] = [];
  const claimed = new Set<string>();
  const un = (c: string, reason: string) => { const i = info.get(c)!; unclassified.push({ component: c, assembly: i.assembly, kitDef: i.kitDef, reason }); claimed.add(c); };
  // Historic stairs are opaque features until a dedicated stair assembly recipe
  // validates them. Their support beams/posts must not be mistaken for bay frames.
  const stairFeature = (c: string) => featureOf(info.get(c)!.kitDef, info.get(c)!.kind) === 'stair-part';
  const isPost = (k: string) => /^rack upright$|upright$/.test(k) && !/crossbar|bracing|diagonal/.test(k);
  // ---- frames: crossbar + two posts at its ends ----
  const posts = comps.filter((c) => !stairFeature(c) && isPost(info.get(c)!.kitDef));
  const postXZ = new Map(posts.map((p) => [p, [info.get(p)!.box.c[0], info.get(p)!.box.c[2]] as Vec2]));
  type Frame = { node: AsmNode; posts: [string, string]; across: Vec2; normal: Vec2; centre: Vec2 };
  const frames: Frame[] = [];
  const postFrame = new Map<string, Frame>();
  for (const cb of comps.filter((c) => /crossbar/.test(info.get(c)!.kitDef) && !stairFeature(c))) {
    const b = info.get(cb)!.box;
    const ax = rot2([1, 0], b.yaw);
    const e0: Vec2 = [b.c[0] - ax[0] * b.size[0] / 2, b.c[2] - ax[1] * b.size[0] / 2];
    const e1: Vec2 = [b.c[0] + ax[0] * b.size[0] / 2, b.c[2] + ax[1] * b.size[0] / 2];
    const near = (e: Vec2) => posts.filter((p) => info.get(p)!.assembly === info.get(cb)!.assembly && !postFrame.has(p) && dist(postXZ.get(p)!, e) <= 0.03 + 0.04).sort((a, bb) => dist(postXZ.get(a)!, e) - dist(postXZ.get(bb)!, e) || (a < bb ? -1 : 1))[0];
    const p0 = near(e0), p1 = near(e1);
    if (!p0 || !p1 || p0 === p1) { un(cb, `crossbar ends do not both sit on free posts (${p0 ?? 'none'} / ${p1 ?? 'none'})`); continue; }
    const q0 = postXZ.get(p0)!, q1 = postXZ.get(p1)!;
    const b0 = info.get(p0)!.box, b1 = info.get(p1)!.box;
    const h = Math.min(b0.size[1], b1.size[1]);
    if (Math.abs(b0.y0 - b1.y0) > 0.01 || Math.abs(b0.size[1] - b1.size[1]) > 0.02) { un(cb, `posts ${p0} / ${p1} differ in base or height`); continue; }
    const depth = dist(q0, q1);
    const fd = frameDef(h, depth);
    if ('why' in fd) { un(cb, fd.why); continue; }
    // canonical yaw: across axis p0→p1 folded to [0, π); column l = −x side in that yaw
    const yaw = foldYaw(datan2(q1[1] - q0[1], q1[0] - q0[0]));
    const across = rot2([1, 0], yaw);
    const centre: Vec2 = [r4((q0[0] + q1[0]) / 2), r4((q0[1] + q1[1]) / 2)];
    const id = cb.replace(/upright-crossbar/, 'frame');
    const node: AsmNode = {
      id, kind: 'upright', def: fd.id, assembly: info.get(cb)!.assembly, components: [p0, p1, cb].sort(), kitDef: 'rack upright frame',
      box: { c: [centre[0], r4(b0.y0 + h / 2), centre[1]], yaw, size: [r4(depth), r4(h), def(fd.id).size[2]], y0: b0.y0, y1: r4(b0.y0 + h) }, base: b0.y0,
    };
    const f: Frame = { node, posts: [p0, p1].sort() as [string, string], across, normal: rot2([0, 1], yaw), centre };
    frames.push(f);
    postFrame.set(p0, f); postFrame.set(p1, f);
    claimed.add(p0); claimed.add(p1); claimed.add(cb);
    nodes.push(node);
    edges.push({ from: id, to: 'ground', rel: 'rests-on' });
  }
  // bracing rods between a frame's posts belong to it
  for (const c of comps.filter((c) => /bracing|diagonal/.test(info.get(c)!.kitDef) && !stairFeature(c) && !claimed.has(c))) {
    const b = info.get(c)!.box;
    const f = frames.find((f) => f.node.assembly === info.get(c)!.assembly && Math.abs(rot2([b.c[0] - f.centre[0], b.c[2] - f.centre[1]], -f.node.box.yaw)[1]) < 0.05 &&
      Math.abs(rot2([b.c[0] - f.centre[0], b.c[2] - f.centre[1]], -f.node.box.yaw)[0]) <= f.node.box.size[0] / 2 + 0.02 && b.y1 <= f.node.box.y1 + 0.05);
    if (!f) { un(c, 'bracing rod not inside any classified frame'); continue; }
    f.node.components.push(c);
    claimed.add(c);
  }
  for (const f of frames) f.node.components.sort();
  for (const p of posts) if (!claimed.has(p)) un(p, 'post with no crossbar partner (not a two-column catalog frame)');
  // ---- beams: ends on posts of two frames ----
  for (const c of comps.filter((c) => /beam/.test(info.get(c)!.kitDef) && !stairFeature(c) && !claimed.has(c))) {
    const i = info.get(c)!, b = i.box;
    const bd = BEAM_DEFS.find((d) => Math.abs(d.size[0] - b.size[0]) <= 0.02);
    if (!bd) { un(c, `beam length ${b.size[0].toFixed(3)} m matches no catalog beam (${BEAM_DEFS.map((d) => d.id).join(', ')})`); continue; }
    const ax = rot2([1, 0], b.yaw);
    const ends: Vec2[] = [[b.c[0] - ax[0] * bd.size[0] / 2, b.c[2] - ax[1] * bd.size[0] / 2], [b.c[0] + ax[0] * bd.size[0] / 2, b.c[2] + ax[1] * bd.size[0] / 2]];
    const hits = ends.map((e) => posts.filter((p) => postFrame.has(p) && postFrame.get(p)!.node.assembly === i.assembly && dist(postXZ.get(p)!, e) <= 0.05).sort((a, bb) => dist(postXZ.get(a)!, e) - dist(postXZ.get(bb)!, e) || (a < bb ? -1 : 1))[0]);
    if (!hits[0] || !hits[1]) { un(c, `beam end${!hits[0] && !hits[1] ? 's' : ''} not on a frame post (${hits.map((h) => h ?? 'none').join(' / ')})`); continue; }
    const fa = postFrame.get(hits[0])!, fb = postFrame.get(hits[1])!;
    if (fa === fb) { un(c, `both ends on frame ${fa.node.id} (a cross beam, not a bay beam)`); continue; }
    // beam must run along both frames' normals
    const along = Math.abs(ax[0] * fa.across[0] + ax[1] * fa.across[1]);
    if (along > 0.03) { un(c, `beam is not perpendicular to frame ${fa.node.id}`); continue; }
    const seat = r4(b.c[1] - fa.node.base!);
    const bad = [fa, fb].find((f) => !(def(f.node.def!).sockets ?? []).some((s) => s.kind === 'beam-seat' && Math.abs(s.local[1] - seat) < 0.005));
    if (bad) { un(c, `seat ${seat.toFixed(3)} m is not a beam seat of ${bad.node.def} (frame ${bad.node.id})`); continue; }
    const col = (f: Frame, p: string) => {
      const v = postXZ.get(p)!;
      return (v[0] - f.centre[0]) * f.across[0] + (v[1] - f.centre[1]) * f.across[1] < 0 ? 'l' : 'r';
    };
    const node: AsmNode = { id: c, kind: 'beam', def: bd.id, assembly: i.assembly, components: [c], kitDef: i.kitDef, box: { ...b, size: [bd.size[0], b.size[1], b.size[2]] }, seat };
    nodes.push(node);
    claimed.add(c);
    for (const [f, p] of [[fa, hits[0]], [fb, hits[1]]] as const) edges.push({ from: c, to: f.node.id, rel: 'connects-to', socket: `col${col(f, p)}@${seat.toFixed(3)}` });
  }
  // ---- features ----
  const beamNodes = nodes.filter((n) => n.kind === 'beam');
  for (const c of comps) {
    if (claimed.has(c)) continue;
    const i = info.get(c)!;
    const fc = featureOf(i.kitDef, i.kind);
    if (!fc) { un(c, `no classification rule for "${i.kitDef}" (${i.kind})`); continue; }
    const node: AsmNode = { id: c, kind: 'feature', feature: fc, assembly: i.assembly, components: [c], kitDef: i.kitDef, box: i.box };
    nodes.push(node);
    if (fc === 'deck-sheet') {
      // the Kit draws deck sheets at beam height (a 2022 sheet's underside is 11 cm below its beams' top):
      // a sheet within 0.15 m of a beam's top over it is `supported-by` that beam; phase B resolves joists
      for (const b of beamNodes.filter((b) => b.assembly === i.assembly && Math.abs(b.box.y1 - i.box.y0) <= 0.15 && overlapXZ(b.box, i.box)))
        edges.push({ from: c, to: b.id, rel: Math.abs(b.box.y1 - i.box.y0) <= 0.01 ? 'rests-on' : 'supported-by' });
    } else if (i.box.y0 <= (scene.meta.groundY + 0.25)) edges.push({ from: c, to: 'ground', rel: 'rests-on' });
  }
  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  edges.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
  unclassified.sort((a, b) => (a.component < b.component ? -1 : 1));
  return { version: ASSEMBLY_GRAPH_VERSION, year, sceneHash: scene.meta.contentHash, nodes, edges, unclassified };
}

function overlapXZ(a: CompBox, b: CompBox): boolean {
  // separating-axis test of two yawed rectangles
  const corners = (x: CompBox): Vec2[] => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => { const w = rot2([sx * x.size[0] / 2, sz * x.size[2] / 2], x.yaw); return [x.c[0] + w[0], x.c[2] + w[1]] as Vec2; });
  const A = corners(a), B = corners(b);
  for (const box of [a, b]) for (const axis of [rot2([1, 0], box.yaw), rot2([0, 1], box.yaw)]) {
    const pa = A.map((p) => p[0] * axis[0] + p[1] * axis[1]), pb = B.map((p) => p[0] * axis[0] + p[1] * axis[1]);
    if (Math.max(...pa) < Math.min(...pb) - 1e-6 || Math.max(...pb) < Math.min(...pa) - 1e-6) return false;
  }
  return true;
}

/** Counts per node kind / feature class, and unclassified per Kit definition. */
export function graphCounts(g: AssemblyGraph) {
  const kinds: Record<string, number> = {};
  for (const n of g.nodes) { const k = n.kind === 'feature' ? `feature:${n.feature}` : n.kind; kinds[k] = (kinds[k] ?? 0) + 1; }
  const un: Record<string, number> = {};
  for (const u of g.unclassified) un[u.kitDef] = (un[u.kitDef] ?? 0) + 1;
  const sort = (r: Record<string, number>) => Object.fromEntries(Object.keys(r).sort().map((k) => [k, r[k]]));
  return { nodes: g.nodes.length, edges: g.edges.length, kinds: sort(kinds), unclassified: g.unclassified.length, unclassifiedByDef: sort(un) };
}

/** Kahn topological order (dependencies first; ties by id). Throws if the graph has a cycle. */
export function topoOrder(g: AssemblyGraph): string[] {
  const ids = new Set(g.nodes.map((n) => n.id));
  const deps = new Map<string, Set<string>>(g.nodes.map((n) => [n.id, new Set<string>()]));
  const users = new Map<string, string[]>(g.nodes.map((n) => [n.id, []]));
  for (const e of g.edges) if (ids.has(e.to)) { deps.get(e.from)!.add(e.to); users.get(e.to)!.push(e.from); }
  const ready = [...ids].filter((i) => deps.get(i)!.size === 0).sort();
  const out: string[] = [];
  while (ready.length) {
    const i = ready.shift()!;
    out.push(i);
    for (const u of users.get(i)!.sort()) { const d = deps.get(u)!; d.delete(i); if (d.size === 0) { ready.push(u); ready.sort(); } }
  }
  if (out.length !== ids.size) throw new Error(`assembly graph ${g.year}: cycle among ${[...ids].filter((i) => !out.includes(i)).slice(0, 5).join(', ')}`);
  return out;
}
