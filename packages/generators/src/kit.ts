// kit/2: a prop or creature as a list of rounded primitives (data, not code). Owner: L1.
// Spec <eden4>/33 §2 row 1, §3.1 (rounded low-poly), §3.2 (roles for creature gaits).
// Def: { make: { kind: 'gen', gen: 'kit/2', args: { shapes: [...], slots?: [...], box?: [w,h,d] } } }
// Physics: union bounds; colliders from shapes marked `collide` (default: boxes/cylinders ≥ 0.3 m tall).
import { z } from 'zod';
import { materialEnum, num, slotSchema, v2, v3 } from './fields.ts';
import type { Baked, Generator, LocalOBB, Vec3 } from './types.ts';

export const KIT_PRIMITIVES = ['box', 'rbox', 'cyl', 'cone', 'capsule', 'sphere', 'wedge', 'arch', 'ring', 'torus', 'lathe', 'extrude', 'sweep'] as const;
export const KIT_ROLES = ['body', 'head', 'neck', 'tail', 'ear.l', 'ear.r', 'eye.l', 'eye.r', 'wing.l', 'wing.r', 'leg.fl', 'leg.fr', 'leg.bl', 'leg.br', 'leg.l', 'leg.r', 'arm.l', 'arm.r', 'fin', 'beak', 'snout', 'blade', 'wheel', 'door', 'lid', 'flame', 'light', 'fill', 'screen', 'boom', 'forks'] as const;  // boom, forks: E2 #4 working parts (components.swing)

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
  path: z.array(v3).min(2).max(64).optional(),
  /** Arch/ring sweep angle in radians (default π for arch, 2π for ring/torus). */
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
});
export type KitShape = z.infer<typeof shape>;

export const kitArgs = z.object({
  shapes: z.array(shape).min(1).max(96),
  slots: z.array(slotSchema).max(64).optional(),
  /** Override the computed bounds (rarely needed). */
  box: v3.optional(),
  /** Default bevel for rbox/wedge (metres). The Eden look: rounded, never voxel. */
  round: num.nonnegative().default(0.04),
  /** Creature gait the viewer animates from roles: quadruped-walk, biped-waddle, bird-fly, fish-swim, none. */
  gait: z.enum(['none', 'quadruped-walk', 'biped-waddle', 'bird-fly', 'fish-swim', 'hover']).default('none'),
});
export type KitArgs = z.infer<typeof kitArgs>;

/** Axis-aligned extent of a shape in its own frame (before yaw/pitch/roll), half sizes. */
function halfOf(sh: KitShape): Vec3 {
  const sc = sh.scale ?? [1, 1, 1];
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
  if (sh.kind === 'lathe') { const ys = (sh.profile ?? [[0.5, 0], [0.5, 1]]).map((p) => p[1]); return [sh.at[0], sh.at[1] + (Math.max(...ys) + Math.min(...ys)) / 2, sh.at[2]]; }
  if (sh.kind === 'extrude') { const poly = sh.polygon ?? [[0, 0]]; const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]); return [sh.at[0] + (Math.max(...xs) + Math.min(...xs)) / 2, sh.at[1] + (sh.h ?? 0.2) / 2, sh.at[2] + (Math.max(...zs) + Math.min(...zs)) / 2]; }
  if (sh.kind === 'sweep') { const pts = sh.path ?? [[0, 0, 0]]; const m = (k: number) => (Math.max(...pts.map((p) => p[k])) + Math.min(...pts.map((p) => p[k]))) / 2; return [sh.at[0] + m(0), sh.at[1] + m(1), sh.at[2] + m(2)]; }
  return sh.at;
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

export function kitPhysics(args: KitArgs, params: Record<string, unknown> = {}): Baked {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  const colliders: LocalOBB[] = [];
  let tris = 0;
  for (const sh of args.shapes) {
    if (!kitWhen(sh.when, params)) continue;
    const c = centreOf(sh), h = halfOf(sh), rh = rotatedHalf(h, sh.yaw, sh.pitch, sh.roll);
    x0 = Math.min(x0, c[0] - rh[0]); x1 = Math.max(x1, c[0] + rh[0]);
    y0 = Math.min(y0, c[1] - rh[1]); y1 = Math.max(y1, c[1] + rh[1]);
    z0 = Math.min(z0, c[2] - rh[2]); z1 = Math.max(z1, c[2] + rh[2]);
    const seg = sh.segments ?? 10;
    const r = sh.round ?? args.round;
    tris += sh.kind === 'box' ? (r > 0.005 ? 44 : 12) : sh.kind === 'rbox' ? ((sh.segments ?? 0) >= 2 ? 300 : 44) : sh.kind === 'wedge' ? 30 : sh.kind === 'sphere' ? seg * seg : sh.kind === 'capsule' ? seg * (seg + 4) : sh.kind === 'torus' || sh.kind === 'ring' ? seg * seg * 2 : sh.kind === 'lathe' ? seg * 2 * (sh.profile?.length ?? 2) : sh.kind === 'sweep' ? seg * 2 * (sh.path?.length ?? 2) : sh.kind === 'extrude' ? (sh.polygon?.length ?? 3) * 4 : seg * 4;
    const tall = 2 * h[1] >= 0.3;
    const collide = !sh.when?.includes('@') && (sh.collide ?? ((sh.kind === 'box' || sh.kind === 'rbox' || sh.kind === 'cyl' || sh.kind === 'extrude') && tall && !sh.role));
    if (collide) colliders.push({ c: [c[0], c[2]], half: [rh[0], rh[2]], yaw: 0, y0: c[1] - rh[1], y1: c[1] + rh[1] });
  }
  if (!Number.isFinite(x0)) { x0 = y0 = z0 = -0.5; x1 = y1 = z1 = 0.5; }
  const box: Vec3 = args.box ?? [Math.max(0.01, x1 - x0), Math.max(0.01, y1 - Math.min(0, y0)), Math.max(0.01, z1 - z0)];
  // merge colliders into one when there are many small ones (keeps the spatial index lean)
  const merged = colliders.length > 12 ? [{ c: [(x0 + x1) / 2, (z0 + z1) / 2] as [number, number], half: [(x1 - x0) / 2, (z1 - z0) / 2] as [number, number], yaw: 0, y0: Math.max(0, y0), y1 }] : colliders;
  return { box, colliders: merged, slots: args.slots ?? [], tris };
}

export const kitGen: Generator = {
  id: 'kit/2', form: 'point', owner: 'L1',
  doc: 'A prop or creature built from rounded primitives (box, rbox, cyl, cone, capsule, sphere, wedge, arch, ring, torus, lathe, extrude, sweep). Shapes live in make.args; instance params may recolour tints.',
  params: {},
  args: kitArgs,
  physics({ args, params }) { return kitPhysics(kitArgs.parse(args), params); },
};
