// kit/2: a prop or creature as a list of rounded primitives (data, not code). Owner: L1.
// Spec <eden4>/33 §2 row 1, §3.1 (rounded low-poly), §3.2 (roles for creature gaits).
// Def: { make: { kind: 'gen', gen: 'kit/2', args: { shapes: [...], slots?: [...], box?: [w,h,d] } } }
// Physics: union bounds; colliders from shapes marked `collide` (default: boxes/cylinders ≥ 0.3 m tall).
import { z } from 'zod';
import { materialEnum, num, slotSchema, v2, v3 } from './fields.ts';
import type { Baked, Generator, LocalOBB, Vec3 } from './types.ts';
import { CREATION_LIMITS } from './creation-limits.ts';
// K2 hook: authored programs share one expansion path with the viewer.
import { expandKitProgram, withKitPrograms } from './kit-program.ts';
import { kitFootprint, kitFootprintSchema } from './kit-footprint.ts'; // XP5 hook

export const KIT_PRIMITIVES = ['box', 'rbox', 'cyl', 'cone', 'capsule', 'sphere', 'wedge', 'arch', 'ring', 'torus', 'lathe', 'extrude', 'sweep', 'loft'] as const;
export const KIT_ROLES = ['body', 'head', 'neck', 'tail', 'ear.l', 'ear.r', 'eye.l', 'eye.r', 'wing.l', 'wing.r', 'leg.fl', 'leg.fr', 'leg.bl', 'leg.br', 'leg.l', 'leg.r', 'arm.l', 'arm.r', 'fin', 'beak', 'snout', 'blade', 'wheel', 'door', 'lid', 'flame', 'light', 'fill', 'screen'] as const;

const shape = z.object({
  kind: z.enum(KIT_PRIMITIVES),
  /** Centre of the primitive in the def frame (metres). */
  at: v3,
  /** Box-like sizes (box, rbox, wedge, arch: [w, h, d]). */
  size: v3.optional(),
  /** Radius (cyl, cone, capsule, sphere, ring, torus) and height (cyl, cone, capsule). r2 = top radius for cyl, tube radius for torus/ring. */
  r: num.positive().optional(), h: num.positive().optional(), r2: num.nonnegative().optional(),
  /** Non-uniform scale after construction (squash a sphere into an ellipsoid, etc.). */
  scale: v3.optional(),
  yaw: num.optional(), pitch: num.optional(), roll: num.optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  material: materialEnum.optional(),
  /** Palette key: the instance's `params[<key>]` colour overrides `color` (e.g. "fur", "roof"). */
  tint: z.string().max(32).optional(),
  /** Bevel radius for rbox / wedge edges (metres); default from the kit's `round`. */
  round: num.nonnegative().optional(),
  /** Segments around (smoothness). Default 10; keep ≤ 16. */
  segments: z.number().int().min(3).max(32).optional(),
  /** lathe: profile [[radius, y], …]; extrude: polygon [[x, z], …] + h; sweep: path [[x, y, z], …] + r. */
  profile: z.array(v2).min(2).max(64).optional(),
  polygon: z.array(v2).min(3).max(64).optional(),
  /** v2 extrude: interior outlines in polygon's x,z plane; v2 loft: upper outline at y=h. */
  holes: z.array(z.array(v2).min(3).max(64)).min(1).max(16).optional(),
  top: z.array(v2).min(3).max(64).optional(),
  path: z.array(v3).min(2).max(64).optional(),
  /** v2: lathe/sphere/cyl/cone angular sweep; arch/ring sweep angle in radians (default π for arch, 2π for ring/torus). */
  arc: num.positive().optional(),
  /** Collide with bodies and other solids. */
  collide: z.boolean().optional(),
  /** Animation role (creatures, wheels, doors…). Parts with a role are kept separate so the viewer can move them. */
  role: z.enum(KIT_ROLES).optional(),
  /** Pivot for the role's rotation, in the def frame (hip for a leg, neck base for a head). Default: top of the part. */
  pivot: v3.optional(),
  /** Emissive glow (lamps, windows at night): 0..1. */
  glow: num.min(0).max(1).optional(),
  /** VOCAB-MECH: include this shape only when the condition holds on the instance params (variants, condition, options):
   *  "variant=tall", "variant=tall|wide", "condition!=new", "awning", "!awning", "floors>1". A leading `@` reads entity
   *  state instead ("@open", "@sign=closed"): drawn by the viewer only, never a collider. */
  when: z.string().max(80).optional(),
}).passthrough();
export type KitShape = z.infer<typeof shape>;

type Point2 = [number, number];
const cross = (a: Point2, b: Point2, c: Point2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const area = (p: Point2[]) => p.reduce((s, a, i) => s + a[0] * p[(i + 1) % p.length][1] - a[1] * p[(i + 1) % p.length][0], 0) / 2;
function onSegment(p: Point2, a: Point2, b: Point2): boolean {
  return Math.abs(cross(a, b, p)) < 1e-8 && p[0] >= Math.min(a[0], b[0]) - 1e-8 && p[0] <= Math.max(a[0], b[0]) + 1e-8 && p[1] >= Math.min(a[1], b[1]) - 1e-8 && p[1] <= Math.max(a[1], b[1]) + 1e-8;
}
function intersects(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  return onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b) || (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0);
}
function inside(p: Point2, poly: Point2[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (onSegment(p, a, b)) return false;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}
function outlineProblem(p: Point2[]): string | undefined {
  if (Math.abs(area(p)) < 1e-8) return 'outline has zero area';
  for (let i = 0; i < p.length; i++) {
    const next = (i + 1) % p.length;
    if (Math.hypot(p[i][0] - p[next][0], p[i][1] - p[next][1]) < 1e-8) return 'outline has a repeated adjacent vertex';
    const prev = p[(i + p.length - 1) % p.length];
    if (onSegment(p[next], prev, p[i]) || onSegment(prev, p[i], p[next])) return 'outline doubles back along an edge';
    for (let j = i + 1; j < p.length; j++) if (j !== next && (j + 1) % p.length !== i && intersects(p[i], p[next], p[j], p[(j + 1) % p.length])) return 'outline intersects itself';
  }
}
const outlinesCross = (a: Point2[], b: Point2[]) => a.some((p, i) => b.some((q, j) => intersects(p, a[(i + 1) % a.length], q, b[(j + 1) % b.length])));

/** An upper bound on rendered triangles, including caps, holes, bevels and path subdivisions. */
export function kitShapeTriangles(sh: KitShape, round: number, v = 1): number {
  const seg = sh.segments ?? 10, r = sh.round ?? (v === 2 && sh.kind === 'rbox' ? Math.max(round, 0.06) : round);
  // K2's pointed ribbon is a polygonal extrusion in either viewer contract.
  if (sh.kind === 'arch' && sh.polygon) return sh.polygon.length * 4 - 4;
  if (v === 1) return sh.kind === 'box' ? (r > 0.005 ? 44 : 12) : sh.kind === 'rbox' ? ((sh.segments ?? 0) >= 2 ? 300 : 44) : sh.kind === 'wedge' ? 30 : sh.kind === 'sphere' ? seg * seg : sh.kind === 'capsule' ? seg * (seg + 4) : sh.kind === 'torus' || sh.kind === 'ring' ? seg * seg * 2 : sh.kind === 'lathe' ? seg * 2 * (sh.profile?.length ?? 2) : sh.kind === 'sweep' ? seg * 2 * (sh.path?.length ?? 2) : sh.kind === 'extrude' ? (sh.polygon?.length ?? 3) * 4 : seg * 4;
  switch (sh.kind) {
    case 'box': return r > 0.005 ? 44 : 12;
    case 'rbox': return r <= 0.005 ? 12 : sh.segments ? 12 * (2 * seg + 1) ** 2 : 44;
    case 'wedge': return 30;
    case 'sphere': return 2 * seg * (Math.max(4, Math.round(seg * 0.6)) - 1);
    case 'capsule': return 16 * Math.max(6, Math.min(seg, 10));
    case 'cyl': return seg * 4;
    case 'cone': return seg * 2;
    case 'arch': return seg * 16 + 32;
    case 'ring': case 'torus': return seg * 12;
    case 'lathe': return 2 * seg * ((sh.profile?.length ?? 2) - 1);
    case 'extrude': { const n = (sh.polygon?.length ?? 3) + (sh.holes ?? []).reduce((a, p) => a + p.length, 0); return (r > 0.005 ? 8 : 4) * n + 4 * (sh.holes?.length ?? 0); }
    case 'loft': return (sh.polygon?.length ?? 3) * 4;
    case 'sweep': { const steps = Math.max(4, (sh.path?.length ?? 2) * 4); return sh.profile ? 2 * steps * sh.profile.length + 2 * (sh.profile.length - 2) : 2 * steps * Math.max(5, Math.min(seg, 8)); }
  }
}

function validateKit(args: { v: 1 | 2; shapes: KitShape[]; round: number }, ctx: z.RefinementCtx) {
  const issue = (i: number, field: string, message: string, fix: string) => ctx.addIssue({ code: 'custom', path: ['shapes', i, field], message: `${field}: ${message}; fix: ${fix}` });
  for (const [i, sh] of args.shapes.entries()) {
    // Never silently accept v2 content with the legacy renderer. Existing v1 fields remain grandfathered.
    if (args.v === 1) {
      for (const f of ['holes', 'top'] as const) if (sh[f] !== undefined) issue(i, f, 'requires kit contract 2', 'set make.args.v to 2 and serve the matching viewer bundle');
      if (sh.kind === 'loft' || (sh.kind === 'sweep' && sh.profile)) issue(i, sh.kind === 'loft' ? 'kind' : 'profile', 'requires kit contract 2', 'set make.args.v to 2 and serve the matching viewer bundle');
      continue;
    }
    const known = new Set(['kind', 'at', 'size', 'r', 'h', 'r2', 'scale', 'yaw', 'pitch', 'roll', 'color', 'material', 'tint', 'round', 'segments', 'profile', 'polygon', 'path', 'holes', 'top', 'arc', 'collide', 'role', 'pivot', 'glow', 'when']);
    for (const f of Object.keys(sh)) if (!known.has(f)) issue(i, f, 'is not a kit field', `remove ${f}`);
    const fields: Record<KitShape['kind'], string[]> = {
      box: ['size', 'round'], rbox: ['size', 'round', 'segments'], wedge: ['size', 'round'],
      cyl: ['r', 'r2', 'h', 'segments', 'arc'], cone: ['r', 'h', 'segments', 'arc'], capsule: ['r', 'h', 'segments'],
      sphere: ['r', 'segments', 'arc'], ring: ['r', 'r2', 'segments', 'arc'], torus: ['r', 'r2', 'segments', 'arc'],
      arch: sh.polygon ? ['size', 'polygon'] : ['size', 'segments', 'arc'], lathe: ['profile', 'segments', 'arc'], extrude: ['polygon', 'holes', 'h', 'round'],
      loft: ['polygon', 'top', 'h'], sweep: ['path', ...(sh.profile ? ['profile'] : ['r', 'segments'])],
    };
    for (const field of ['size', 'r', 'r2', 'h', 'round', 'segments', 'profile', 'polygon', 'holes', 'top', 'path', 'arc'] as const) if (sh[field] !== undefined && !fields[sh.kind].includes(field)) issue(i, field, `has no effect on ${sh.kind}`, `remove ${field} or choose a primitive that uses it`);
    if (sh.pivot && !sh.role) issue(i, 'pivot', 'needs an animation role', 'add role or remove pivot');
    if (sh.kind === 'rbox' && sh.segments !== undefined && (sh.round ?? Math.max(args.round, 0.06)) <= 0.005) issue(i, 'segments', 'has no effect on a sharp box', 'remove segments or use round > 0.005');
    if (sh.pivot && sh.role && args.shapes.some((other, j) => j < i && other.role === sh.role && other.pivot && other.pivot.some((v, k) => v !== sh.pivot![k]))) issue(i, 'pivot', 'conflicts with another pivot for this role', 'use one shared pivot for all shapes of a role');
    if (sh.tint === '') issue(i, 'tint', 'palette key is empty', 'name a palette key or remove tint');
    if (sh.when !== undefined && !sh.when.split('&').every(t => /^!?\s*@?[A-Za-z][\w-]*(?:\s*(?:!=|=|>=|<=|>|<)\s*[^&\s].*)?$/.test(t.trim()))) issue(i, 'when', 'condition is not understood', 'use key, !key, @key, key=value or a numeric comparison; join terms with &');
    if ((sh.kind === 'ring' || sh.kind === 'torus') && sh.r2 === 0) issue(i, 'r2', 'tube radius must be positive', 'use a positive tube radius');
    if (sh.size?.some(n => n <= 0)) issue(i, 'size', 'dimensions must be positive', 'use positive dimensions');
    if (sh.scale?.some(n => n === 0)) issue(i, 'scale', 'components must be nonzero', 'use nonzero scale components; negative components reflect the primitive');
    if (sh.arc && sh.arc > (sh.kind === 'arch' ? Math.PI : Math.PI * 2)) issue(i, 'arc', 'exceeds one sweep', `use radians in (0, ${sh.kind === 'arch' ? 'π' : '2π'}]`);
    if ((sh.kind === 'capsule' && sh.segments && (sh.segments < 6 || sh.segments > 10)) || (sh.kind === 'sweep' && !sh.profile && sh.segments && (sh.segments < 5 || sh.segments > 8))) issue(i, 'segments', 'would be clamped by this primitive', `use ${sh.kind === 'capsule' ? '6–10' : '5–8'} segments`);
    if (sh.kind === 'lathe' && sh.profile?.some(p => p[0] < 0)) issue(i, 'profile', 'lathe radius cannot be negative', 'use nonnegative profile radii');
    if (sh.kind === 'sweep' && sh.path?.some((p, j, a) => j > 0 && Math.hypot(...p.map((n, k) => n - a[j - 1][k])) < 1e-8)) issue(i, 'path', 'adjacent points coincide', 'remove repeated path points');
    if (sh.kind === 'sweep' && sh.profile && sh.profile.length < 3) issue(i, 'profile', 'a swept outline needs at least three points', 'supply a closed outline without a repeated endpoint');
    for (const field of ['polygon', 'top', ...(sh.kind === 'sweep' ? ['profile'] as const : [])] as const) {
      const p = sh[field]; if (!p) continue;
      const problem = outlineProblem(p); if (problem) issue(i, field, problem, 'use a simple nonzero-area outline without repeating the first point');
    }
    if (sh.kind === 'loft') {
      if (!sh.polygon || !sh.top) issue(i, 'polygon', 'loft needs both polygon and top', 'supply two matching outlines in x,z at y=0 and y=h');
      else if (sh.polygon.length !== sh.top.length || Math.sign(area(sh.polygon)) !== Math.sign(area(sh.top))) issue(i, 'top', 'loft outlines need matching vertex counts and winding', 'pair corresponding vertices in the same winding order');
      else { for (const t of [0.25, 0.5, 0.75]) { const p = sh.polygon.map((p, j) => [p[0] * (1 - t) + sh.top![j][0] * t, p[1] * (1 - t) + sh.top![j][1] * t] as Point2); if (outlineProblem(p)) { issue(i, 'top', 'loft twists through an invalid intermediate outline', 'align corresponding vertices without crossing'); break; } } }
    }
    for (const [j, hole] of (sh.holes ?? []).entries()) {
      const problem = outlineProblem(hole);
      if (problem) issue(i, 'holes', `hole ${j}: ${problem}`, 'use a simple nonzero-area interior outline');
      const outer = sh.polygon ?? [[0, 0], [1, 0], [0, 1]];
      if (!hole.every(p => inside(p, outer)) || outlinesCross(hole, outer)) issue(i, 'holes', `hole ${j} is outside or touches the outline`, 'put every hole strictly inside polygon');
      for (const other of (sh.holes ?? []).slice(0, j)) if (outlinesCross(hole, other) || inside(hole[0], other) || inside(other[0], hole)) issue(i, 'holes', `hole ${j} overlaps another hole`, 'use disjoint, nonnested interior outlines');
    }
  }
  if (args.v === 2) {
    const tris = args.shapes.reduce((n, sh) => n + kitShapeTriangles(sh, args.round, 2), 0);
    if (tris > CREATION_LIMITS.defTris) ctx.addIssue({ code: 'custom', path: ['shapes'], message: `shapes: triangle estimate ${tris} exceeds ${CREATION_LIMITS.defTris}; fix: reduce shapes, segments, path points or outline vertices` });
  }
}

export const plainKitArgs = z.object({
  /** Contract 1 (default) retains the shipped look. Contract 2 opts into arc, glow levels, finishes and outlines. */
  v: z.union([z.literal(1), z.literal(2)]).default(1),
  shapes: z.array(shape).min(1).max(CREATION_LIMITS.kitExpandedShapes),
  footprint: kitFootprintSchema.optional(), // XP5: authored metadata survives program expansion.
  slots: z.array(slotSchema).max(64).optional(),
  /** Override the computed bounds (rarely needed). */
  box: v3.optional(),
  /** Default bevel for rbox/wedge (metres). The Eden look: rounded, never voxel. */
  round: num.nonnegative().default(0.04),
  /** Creature gait the viewer animates from roles: quadruped-walk, biped-waddle, bird-fly, fish-swim, none. */
  gait: z.enum(['none', 'quadruped-walk', 'biped-waddle', 'bird-fly', 'fish-swim', 'hover']).default('none'),
}).superRefine(validateKit);
export type KitArgs = z.infer<typeof plainKitArgs>;
// Authored programs retain their instructions until bake/mesh resolve instance params.
export const kitArgs = withKitPrograms(plainKitArgs);

// Admission follows the viewer bundled with the server; baking retained definitions is independent
// so a rollback can still inspect its data. Offline compilers/studios use this source's renderer.
let viewerContract = 2;
export function setKitViewerContract(manifest: unknown): number {
  const v = (manifest as { 'kit/2'?: unknown } | null)?.['kit/2'];
  viewerContract = v === 2 ? 2 : 1;
  return viewerContract;
}
const admissionArgs = kitArgs.superRefine((args, ctx) => {
  if (args.v > viewerContract) ctx.addIssue({ code: 'custom', path: ['v'], message: `v: served viewer supports kit contract ${viewerContract}; fix: build and serve the matching viewer before defining contract ${args.v} content` });
});

/** Axis-aligned extent of a shape in its own frame (before yaw/pitch/roll), half sizes. */
function halfOf(sh: KitShape): Vec3 {
  // K2: a reflected primitive has signed scale, but bounds use positive half extents.
  const sc = (sh.scale ?? [1, 1, 1]).map(Math.abs);
  let hx = 0.5, hy = 0.5, hz = 0.5;
  switch (sh.kind) {
    case 'box': case 'rbox': case 'wedge': case 'arch': { const [w, h, d] = sh.size ?? [1, 1, 1]; hx = w / 2; hy = h / 2; hz = d / 2; break; }
    case 'cyl': case 'cone': case 'capsule': { const r = Math.max(sh.r ?? 0.5, sh.r2 ?? 0); hx = hz = r; hy = (sh.h ?? 1) / 2 + (sh.kind === 'capsule' ? r : 0); break; }
    case 'sphere': { const r = sh.r ?? 0.5; hx = hy = hz = r; break; }
    case 'ring': case 'torus': { const r = (sh.r ?? 0.5) + (sh.r2 ?? 0.1); hx = hy = r; hz = sh.r2 ?? 0.1; break; }
    case 'lathe': { const pr = sh.profile ?? [[0.5, 0], [0.5, 1]]; const rmax = Math.max(...pr.map((p) => p[0])); const ys = pr.map((p) => p[1]); hx = hz = rmax; hy = (Math.max(...ys) - Math.min(...ys)) / 2; break; }
    case 'extrude': { const poly = sh.polygon ?? [[0, 0], [1, 0], [0, 1]]; const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]); hx = (Math.max(...xs) - Math.min(...xs)) / 2; hz = (Math.max(...zs) - Math.min(...zs)) / 2; hy = (sh.h ?? 0.2) / 2; break; }
    case 'sweep': { const pts = sh.path ?? [[0, 0, 0], [1, 0, 0]]; const r = sh.r ?? 0.05; const ax = pts.map((p) => p[0]), ay = pts.map((p) => p[1]), az = pts.map((p) => p[2]); hx = (Math.max(...ax) - Math.min(...ax)) / 2 + r; hy = (Math.max(...ay) - Math.min(...ay)) / 2 + r; hz = (Math.max(...az) - Math.min(...az)) / 2 + r; break; }
  }
  return [hx * sc[0], hy * sc[1], hz * sc[2]];
}
/** Centre offset for shapes whose geometry is not centred on `at` (lathe/extrude/sweep are authored in absolute coordinates relative to `at`). */
function centreOf(sh: KitShape): Vec3 {
  // K2: reflection scales the geometry's local centre as well as its extents.
  // Preserve existing positive-scale kit bakes; only newly reflected geometry takes this path.
  if (sh.scale?.some(v => v < 0)) {
    const c = centreOf({ ...sh, scale: undefined }), p = sh.pitch ?? 0, y = sh.yaw ?? 0, r = sh.roll ?? 0;
    let [x, u, z] = c.map((v, i) => (v - sh.at[i]) * sh.scale![i]);
    [x, u] = [x * Math.cos(r) - u * Math.sin(r), x * Math.sin(r) + u * Math.cos(r)];
    [u, z] = [u * Math.cos(p) - z * Math.sin(p), u * Math.sin(p) + z * Math.cos(p)];
    return [sh.at[0] + x * Math.cos(y) + z * Math.sin(y), sh.at[1] + u, sh.at[2] - x * Math.sin(y) + z * Math.cos(y)];
  }
  if (sh.kind === 'lathe') { const ys = (sh.profile ?? [[0.5, 0], [0.5, 1]]).map((p) => p[1]); return [sh.at[0], sh.at[1] + (Math.max(...ys) + Math.min(...ys)) / 2, sh.at[2]]; }
  if (sh.kind === 'extrude') { const poly = sh.polygon ?? [[0, 0]]; const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]); return [sh.at[0] + (Math.max(...xs) + Math.min(...xs)) / 2, sh.at[1] + (sh.h ?? 0.2) / 2, sh.at[2] + (Math.max(...zs) + Math.min(...zs)) / 2]; }
  if (sh.kind === 'sweep') { const pts = sh.path ?? [[0, 0, 0]]; const m = (k: number) => (Math.max(...pts.map((p) => p[k])) + Math.min(...pts.map((p) => p[k]))) / 2; return [sh.at[0] + m(0), sh.at[1] + m(1), sh.at[2] + m(2)]; }
  return sh.at;
}
/** v2 bounds include bevels and the Catmull–Rom control hull (the curve may overshoot its path vertices).
 * Colliders intentionally fill holes/lofts/profile sweeps with conservative boxes. */
function localBounds(sh: KitShape, round: number): { c: Vec3; h: Vec3 } {
  const raw = { ...sh, ...(sh.kind === 'arch' && !sh.size ? { size: [2, 2, 0.3] as Vec3 } : {}), ...(sh.kind === 'extrude' && !sh.polygon ? { polygon: [[0, 0], [1, 0], [0, 1]] as Point2[] } : {}), at: [0, 0, 0] as Vec3, scale: [1, 1, 1] as Vec3 };
  let c = centreOf(raw), h = halfOf(raw);
  if (sh.kind === 'extrude') { const r = (sh.round ?? round) > 0.005 ? Math.min(sh.round ?? round, 0.03) : 0; h = h.map(n => n + r) as Vec3; }
  if (sh.kind === 'wedge') { const r = (sh.round ?? round) > 0.005 ? Math.min(sh.round ?? round, 0.03) : 0; h = h.map(n => n + r) as Vec3; }
  if (sh.kind === 'loft') {
    const pts = [...(sh.polygon ?? [[0, 0], [1, 0], [0, 1]]), ...(sh.top ?? [[0, 0], [1, 0], [0, 1]])];
    const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
    c = [(Math.max(...xs) + Math.min(...xs)) / 2, (sh.h ?? 1) / 2, (Math.max(...zs) + Math.min(...zs)) / 2];
    h = [(Math.max(...xs) - Math.min(...xs)) / 2, (sh.h ?? 1) / 2, (Math.max(...zs) - Math.min(...zs)) / 2];
  }
  if (sh.kind === 'sweep') {
    const pts = sh.path ?? [[0, 0, 0], [1, 0, 0]], hull: Vec3[] = [...pts];
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i], p2 = pts[i + 1];
      const p0 = pts[i - 1] ?? p1.map((v, k) => 2 * v - p2[k]) as Vec3;
      const p3 = pts[i + 2] ?? p2.map((v, k) => 2 * v - p1[k]) as Vec3;
      let dt0 = Math.sqrt(Math.hypot(...p1.map((v, k) => v - p0[k]))), dt1 = Math.sqrt(Math.hypot(...p2.map((v, k) => v - p1[k]))), dt2 = Math.sqrt(Math.hypot(...p3.map((v, k) => v - p2[k])));
      if (dt1 < 1e-4) dt1 = 1; if (dt0 < 1e-4) dt0 = dt1; if (dt2 < 1e-4) dt2 = dt1;
      hull.push(p1.map((v, k) => v + dt1 / 3 * ((v - p0[k]) / dt0 - (p2[k] - p0[k]) / (dt0 + dt1) + (p2[k] - v) / dt1)) as Vec3);
      hull.push(p2.map((v, k) => v - dt1 / 3 * ((v - p1[k]) / dt1 - (p3[k] - p1[k]) / (dt1 + dt2) + (p3[k] - v) / dt2)) as Vec3);
    }
    const radius = sh.profile ? Math.max(...sh.profile.map(p => Math.hypot(...p))) : sh.r ?? 0.05;
    const lo = [0, 1, 2].map(k => Math.min(...hull.map(p => p[k])) - radius), hi = [0, 1, 2].map(k => Math.max(...hull.map(p => p[k])) + radius);
    c = lo.map((v, k) => (v + hi[k]) / 2) as Vec3; h = lo.map((v, k) => (hi[k] - v) / 2) as Vec3;
  }
  const scale = sh.scale ?? [1, 1, 1];
  return { c: c.map((v, k) => v * scale[k]) as Vec3, h: h.map((v, k) => v * Math.abs(scale[k])) as Vec3 };
}
function rotateLocal([x, y, z]: Vec3, sh: KitShape): Vec3 {
  const roll = sh.roll ?? 0, pitch = sh.pitch ?? 0, yaw = sh.yaw ?? 0;
  [x, y] = [x * Math.cos(roll) - y * Math.sin(roll), x * Math.sin(roll) + y * Math.cos(roll)];
  [y, z] = [y * Math.cos(pitch) - z * Math.sin(pitch), y * Math.sin(pitch) + z * Math.cos(pitch)];
  return [x * Math.cos(yaw) + z * Math.sin(yaw), y, -x * Math.sin(yaw) + z * Math.cos(yaw)];
}
/** World-frame AABB half extents of a yawed/pitched/rolled box (conservative). */
function rotatedHalf(h: Vec3, yaw = 0, pitch = 0, roll = 0): Vec3 {
  const cy = Math.abs(Math.cos(yaw)), sy = Math.abs(Math.sin(yaw)), cp = Math.abs(Math.cos(pitch)), sp = Math.abs(Math.sin(pitch)), cr = Math.abs(Math.cos(roll)), sr = Math.abs(Math.sin(roll));
  // roll (z) then pitch (x) then yaw (y), on absolute values: conservative bound
  let [x, y, z] = h;
  [x, y] = [x * cr + y * sr, x * sr + y * cr];
  [y, z] = [y * cp + z * sp, y * sp + z * cp];
  [x, z] = [x * cy + z * sy, x * sy + z * cy];
  return [x, y, z];
}

/** Engine boxes support yaw plus a vertical interval, so slice a tilted primitive along its
 *  greatest vertical span. Keep every slice: merging them recreates the original empty-space box. */
function tiltedColliders(sh: KitShape, c: Vec3, h: Vec3): LocalOBB[] {
  const yaw = sh.yaw ?? 0, pitch = sh.pitch ?? 0, roll = sh.roll ?? 0;
  const rotate = ([x, y, z]: Vec3): Vec3 => {
    [x, y] = [x * Math.cos(roll) - y * Math.sin(roll), x * Math.sin(roll) + y * Math.cos(roll)];
    [y, z] = [y * Math.cos(pitch) - z * Math.sin(pitch), y * Math.sin(pitch) + z * Math.cos(pitch)];
    return [x * Math.cos(yaw) + z * Math.sin(yaw), y, -x * Math.sin(yaw) + z * Math.cos(yaw)];
  };
  const rises = h.map((v, i) => { const axis: Vec3 = [0, 0, 0]; axis[i] = v; return 2 * Math.abs(rotate(axis)[1]); });
  const axis = rises.indexOf(Math.max(...rises));
  const n = Math.min(CREATION_LIMITS.kitColliderSlices, Math.max(1, Math.ceil(rises[axis] / CREATION_LIMITS.kitColliderSliceRiseM)));
  const half: Vec3 = [...h]; half[axis] /= n;
  const rh = rotatedHalf(half, 0, pitch, roll);
  return Array.from({ length: n }, (_, i) => {
    const offset: Vec3 = [0, 0, 0]; offset[axis] = -h[axis] + half[axis] * (2 * i + 1);
    const p = rotate(offset);
    return { c: [c[0] + p[0], c[2] + p[2]], half: [rh[0], rh[2]], yaw, y0: c[1] + p[1] - rh[1], y1: c[1] + p[1] + rh[1] };
  });
}

/** VOCAB-MECH: does a shape's `when` hold? `params` = instance params (defaults filled); `state` = entity state (viewer only;
 *  undefined in physics, where a state condition counts as "maybe": the shape bounds the box but never collides). */
export function kitWhen(when: string | undefined, params: Record<string, unknown> = {}, state?: Record<string, unknown>): boolean {
  if (!when) return true;
  return when.split('&').every((term) => {
    let t = term.trim(); const neg = t.startsWith('!'); if (neg) t = t.slice(1).trim();
    const fromState = t.startsWith('@'); if (fromState) t = t.slice(1); if (fromState && !state) return true;
    const src = fromState ? state! : params;
    const m = /^([A-Za-z][\w-]*)\s*(!=|=|>=|<=|>|<)?\s*(.*)$/.exec(t); if (!m) return true;
    const v = src[m[1]], op = m[2], rhs = m[3];
    let ok: boolean;
    if (!op) ok = !!v && v !== 'none';
    else if (op === '=' || op === '!=') { const hit = rhs.split('|').some((x) => String(v) === x.trim()); ok = op === '=' ? hit : !hit; }
    else { const a = Number(v), b = Number(rhs); ok = op === '>' ? a > b : op === '<' ? a < b : op === '>=' ? a >= b : a <= b; }
    return neg ? !ok : ok;
  });
}

export function kitPhysics(input: unknown, params: Record<string, unknown> = {}): Baked {
  const args = expandKitProgram(input, params);
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  const colliders: LocalOBB[] = [];
  let tilted = false;
  let tris = 0;
  for (const sh of args.shapes) {
    if (!kitWhen(sh.when, params)) continue;
    const local = args.v === 2 ? localBounds(sh, args.round) : null;
    const c = local ? rotateLocal(local.c, sh).map((v, k) => v + sh.at[k]) as Vec3 : centreOf(sh), h = local?.h ?? halfOf(sh), rh = rotatedHalf(h, sh.yaw, sh.pitch, sh.roll);
    x0 = Math.min(x0, c[0] - rh[0]); x1 = Math.max(x1, c[0] + rh[0]);
    y0 = Math.min(y0, c[1] - rh[1]); y1 = Math.max(y1, c[1] + rh[1]);
    z0 = Math.min(z0, c[2] - rh[2]); z1 = Math.max(z1, c[2] + rh[2]);
    tris += kitShapeTriangles(sh, args.round, args.v);
    const tall = 2 * h[1] >= 0.3;
    const collide = !sh.when?.includes('@') && (sh.collide ?? ((sh.kind === 'box' || sh.kind === 'rbox' || sh.kind === 'cyl' || sh.kind === 'extrude' || sh.kind === 'loft') && tall && !sh.role));
    if (collide) {
      if (Math.abs(sh.pitch ?? 0) > 1e-8 || Math.abs(sh.roll ?? 0) > 1e-8) { tilted = true; colliders.push(...tiltedColliders(sh, c, h)); }
      else colliders.push({ c: [c[0], c[2]], half: [rh[0], rh[2]], yaw: 0, y0: c[1] - rh[1], y1: c[1] + rh[1] });
    }
  }
  if (!Number.isFinite(x0)) { x0 = y0 = z0 = -0.5; x1 = y1 = z1 = 0.5; }
  const box: Vec3 = args.box ?? [Math.max(0.01, x1 - x0), Math.max(0.01, y1 - Math.min(0, y0)), Math.max(0.01, z1 - z0)];
  // merge colliders into one when there are many small ones (keeps the spatial index lean)
  const merged = !args.footprint && !tilted && colliders.length > CREATION_LIMITS.uprightKitMergeThreshold ? [{ c: [(x0 + x1) / 2, (z0 + z1) / 2] as [number, number], half: [(x1 - x0) / 2, (z1 - z0) / 2] as [number, number], yaw: 0, y0: args.v === 2 ? y0 : Math.max(0, y0), y1 }] : colliders;
  return kitFootprint(args.footprint, { box, colliders: merged, slots: args.slots ?? [], tris }, { min: [x0, 0, z0], max: [x1, y1, z1] }); // XP5 hook
}

export const kitGen: Generator = {
  id: 'kit/2', form: 'point', owner: 'L1',
  doc: 'Rounded primitives including lathe, extrude, loft and sweep. args.v defaults to legacy 1; v:2 enables arcs, four glow levels, metal finish, extrude holes, loft polygon/top at y=0/h, and upright transported sweep profiles. Instance params recolour tints.',
  params: {},
  args: admissionArgs,
  physics({ args, params }) { return kitPhysics(args, params); },
};
