// XP2: bounded, data-only kit authoring. This is the only expansion implementation.
import { z } from 'zod';
import { CREATION_LIMITS as L } from './creation-limits.ts';
import { kitArgs, plainKitArgs, type KitArgs, type KitShape } from './kit.ts';
import type { Vec3 } from './types.ts';

type Numeric<T> = T extends number ? number | string : T extends object ? { [K in keyof T]: Numeric<T[K]> } : T;
// K1's passthrough schema has an unknown-field index signature; keep the named fields typed.
type Fields<T> = { [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K] };
type Delta = Record<string, unknown>;
export type KitProgramShape = Omit<Numeric<Fields<KitShape>>, 'kind' | 'at'> & {
  kind: KitShape['kind'] | 'arch.pointed'; at?: Numeric<Vec3>;
  repeat?: { n: number | string; step: Numeric<Vec3> | Delta | Delta[] };
  radial?: { n: number | string; r: number | string; face?: 'out' | 'in' | 'none'; start?: number | string; arc?: number | string };
  mirror?: boolean | 'x' | 'y' | 'z' | ('x' | 'y' | 'z')[];
  from?: Numeric<Vec3>; to?: Numeric<Vec3>;
  outline?: 'lancet'; outlineAxis?: 'xy' | 'yx';
};
export type KitProgramArgs = Omit<KitArgs, 'shapes'> & { shapes: KitProgramShape[] };

/** A typed refusal; the compiler preserves the Zod path as make.args.<field>. */
export class KitProgramError extends z.ZodError {
  readonly field: string;
  readonly fix: string;
  constructor(path: (string | number)[], message: string, fix: string) {
    super([{ code: 'custom', path, message: `${message}. ${fix}` }]);
    this.field = ['make.args', ...path].join('.'); this.fix = fix;
  }
}
const refuse = (path: (string | number)[], message: string, fix: string): never => { throw new KitProgramError(path, message, fix); };

/** Tiny recursive-descent arithmetic: no calls, property access, JS evaluation or ambient bindings. */
export function kitNumber(value: string, params: Record<string, unknown>, path: (string | number)[] = []): number {
  const bad = (message: string): never => refuse(path, message, 'Use finite numbers, declared numeric $params, + - * / and parentheses');
  if (value.length > 256) return bad('Expression exceeds 256 characters');
  const tokens: string[] = [];
  const names = Object.keys(params).filter(k => /^[A-Za-z][A-Za-z0-9_-]*$/.test(k)).sort((a, b) => b.length - a.length);
  let rest = value.trim();
  while (rest) {
    const name = rest[0] === '$' ? names.find(k => rest.startsWith('$' + k) && !/[A-Za-z0-9_]/.test(rest[k.length + 1] ?? '')) : undefined;
    const token = name ? '$' + name : rest.match(/^(?:\$[A-Za-z][A-Za-z0-9_]*|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[()+*/-]|\S)/)?.[0];
    if (!token) return bad('Invalid expression');
    tokens.push(token); rest = rest.slice(token.length).trimStart();
  }
  let i = 0, depth = 0;
  const finite = (n: number) => Number.isFinite(n) && Math.abs(n) <= L.numericMagnitude ? n : bad('Expression result is outside the finite numeric envelope');
  const atom = (): number => {
    if (++depth > 24) return bad('Expression nesting exceeds 24');
    const t = tokens[i++]; let n: number;
    if (t === '+' || t === '-') n = (t === '-' ? -1 : 1) * atom();
    else if (t === '(') { n = sum(); if (tokens[i++] !== ')') return bad('Expected closing parenthesis'); }
    else if (t?.startsWith('$')) {
      const name = t.slice(1);
      if (!Object.hasOwn(params, name) || typeof params[name] !== 'number') return bad(`$${name} requires a declared numeric parameter with a value/default`);
      n = params[name] as number;
    } else if (t && /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(t)) n = Number(t);
    else return bad(`Unexpected expression token ${t ?? 'end'}`);
    depth--; return finite(n);
  };
  const product = (): number => {
    let n = atom();
    while (tokens[i] === '*' || tokens[i] === '/') { const op = tokens[i++], b = atom(); n = finite(op === '*' ? n * b : n / b); }
    return n;
  };
  const sum = (): number => {
    let n = product();
    while (tokens[i] === '+' || tokens[i] === '-') { const op = tokens[i++], b = product(); n = finite(op === '+' ? n + b : n - b); }
    return n;
  };
  const n = sum(); if (i !== tokens.length) return bad(`Unexpected expression token ${tokens[i]}`); return n;
}

// Preserve the primitive schema as the authority; expressions widen only its numeric leaves.
function expressions(schema: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodNumber) return z.union([schema, z.string().min(1).max(256)]);
  if (schema instanceof z.ZodOptional) return expressions(schema.unwrap() as z.ZodType).optional();
  if (schema instanceof z.ZodDefault) return expressions(schema.unwrap() as z.ZodType).default(schema.def.defaultValue);
  if (schema instanceof z.ZodArray) return z.array(expressions(schema.element as z.ZodType)).min(0).max(64);
  if (schema instanceof z.ZodTuple) return z.tuple(schema.def.items.map(s => expressions(s as z.ZodType)) as [z.ZodType, ...z.ZodType[]]);
  if (schema instanceof z.ZodObject) return z.object(Object.fromEntries(Object.entries(schema.shape).map(([k, v]) => [k, expressions(v as z.ZodType)])));
  return schema;
}
/** Only kit.ts calls this hook; the primitive schema remains the numeric validation authority. */
export function withKitPrograms(plain: z.ZodObject): z.ZodType<KitProgramArgs> {
  const fields = (plain.shape.shapes as z.ZodArray<z.ZodObject>).element.shape;
  const number = z.union([z.number().finite(), z.string().min(1).max(256)]);
  const vector = z.tuple([number, number, number]);
  const delta = z.record(z.string(), z.unknown());
  const shape = z.object({
    // XP8 hook: faces are plain data (no $params), kept as authored so their own field checks still run.
    ...Object.fromEntries(Object.entries(fields).map(([k, s]) => [k, k === 'faces' ? s as z.ZodType : expressions(s as z.ZodType)])),
    kind: z.union([fields.kind as z.ZodType, z.literal('arch.pointed')]), at: vector.optional(),
    repeat: z.object({ n: number, step: z.union([vector, delta, z.array(delta).min(1).max(L.kitExpandedShapes - 1)]) }).strict().optional(),
    radial: z.object({ n: number, r: number, face: z.enum(['out', 'in', 'none']).default('out'), start: number.optional(), arc: number.optional() }).strict().optional(),
    mirror: z.union([z.boolean(), z.enum(['x', 'y', 'z']), z.array(z.enum(['x', 'y', 'z'])).min(1).max(3)]).optional(),
    from: vector.optional(), to: vector.optional(), outline: z.literal('lancet').optional(), outlineAxis: z.enum(['xy', 'yx']).optional(),
  }).passthrough();
  return z.object({ ...plain.shape, shapes: z.array(shape).min(1).max(L.kitShapes) }).superRefine((args, ctx) => {
    // Preserve K1's eager field/fix refusals for ordinary kits. Program geometry is
    // validated by this same numeric schema after expansion, with resolved params.
    const isExpression = (value: unknown): boolean => typeof value === 'string' || Array.isArray(value) && value.some(isExpression);
    if (args.shapes.some(s => s.kind === 'arch.pointed' || ['repeat', 'radial', 'mirror', 'from', 'to', 'outline', 'outlineAxis'].some(k => s[k] !== undefined) || [...numeric].some(k => isExpression(s[k])))) return;
    const parsed = plain.safeParse(args);
    if (!parsed.success) for (const issue of parsed.error.issues) ctx.addIssue({ ...issue });
  }) as unknown as z.ZodType<KitProgramArgs>;
}

const numeric = new Set(['at', 'size', 'r', 'r2', 'h', 'scale', 'yaw', 'pitch', 'roll', 'round', 'segments', 'profile', 'polygon', 'holes', 'top', 'path', 'arc', 'pivot', 'glow', 'from', 'to']);
function numbers(value: unknown, params: Record<string, unknown>, path: (string | number)[]): unknown {
  if (typeof value === 'string') return kitNumber(value, params, path);
  if (Array.isArray(value)) return value.map((v, i) => numbers(v, params, [...path, i]));
  return value;
}
const vec = (s: Delta, key: string, fallback: Vec3 = [0, 0, 0]) => (s[key] ?? fallback) as Vec3;
function shifted(s: Delta, step: Vec3): Delta {
  const out = { ...s, at: vec(s, 'at').map((v, i) => v + step[i]) };
  return s.pivot ? { ...out, pivot: vec(s, 'pivot').map((v, i) => v + step[i]) } : out;
}
function reflected(s: Delta, axis: 'x' | 'y' | 'z'): Delta {
  const k = { x: 0, y: 1, z: 2 }[axis], out: Delta = { ...s };
  for (const key of ['at', 'pivot']) if (s[key]) out[key] = vec(s, key).map((v, i) => i === k ? -v : v);
  // R' = S R S; reflect the geometry too (essential for asymmetrical polygons, paths and wedges).
  const sc = vec(s, 'scale', [1, 1, 1]); out.scale = sc.map((v, i) => i === k ? -v : v);
  for (const key of axis === 'x' ? ['yaw', 'roll'] : axis === 'y' ? ['pitch', 'roll'] : ['yaw', 'pitch']) if (s[key] !== undefined) out[key] = -(s[key] as number);
  if (axis === 'x' && typeof s.role === 'string') out.role = s.role.replace(/\.(l|r)$/, (_, v) => v === 'l' ? '.r' : '.l').replace(/^(leg\.[fb])([lr])$/, (_, p, v) => p + (v === 'l' ? 'r' : 'l'));
  return out;
}
function deltaStep(s: Delta, delta: Delta, params: Record<string, unknown>, path: (string | number)[]): Delta {
  const out = { ...s };
  const add = (a: unknown, b: unknown, p: (string | number)[]): unknown => {
    if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.map((v, i) => add(v, b[i], [...p, i]));
    if (typeof a === 'number' && (typeof b === 'number' || typeof b === 'string')) return a + (numbers(b, params, p) as number);
    return refuse(p, 'Step deltas require matching numeric fields', 'Use a vector step or numeric deltas with matching array lengths');
  };
  for (const [key, value] of Object.entries(delta)) {
    if (key === 'from' || key === 'to') refuse([...path, key], 'Endpoint expansion precedes repeat steps', 'Use at/size/h deltas on the resolved primitive');
    if (numeric.has(key)) out[key] = add(s[key] ?? (key === 'at' ? [0, 0, 0] : 0), value, [...path, key]);
    else if (['color', 'material', 'collide', 'tint'].includes(key)) out[key] = value;
    else refuse([...path, key], `Unsupported repeat step field ${key}`, 'Use numeric shape deltas or color/material/collide/tint overrides');
  }
  // A positional delta carries the pivot unless it has its own delta.
  if (delta.at && s.pivot && !delta.pivot) out.pivot = add(s.pivot, delta.at, [...path, 'pivot']);
  return out;
}

function pointed(s: Delta, path: (string | number)[]): Delta {
  const [w, h, d] = vec(s, 'size', [2, 3, 0.2]), n = (s.segments ?? 8) as number;
  if (!(w > 0 && h >= Math.sqrt(3) / 2 * w && d > 0 && Number.isInteger(n) && n >= 3 && n <= 30)) return refuse(path, 'Lancet needs positive width/depth, height ≥ sqrt(3)/2 × width and 3…30 segments', 'Increase height or reduce width/segments');
  const spring = h - Math.sqrt(3) / 2 * w;
  const right = Array.from({ length: n + 1 }, (_, i) => { const a = Math.PI / 3 * i / n; return [-w / 2 + w * Math.cos(a), spring + w * Math.sin(a)]; });
  const crown = [...right, ...right.slice(0, -1).reverse().map(([x, y]) => [-x, y])];
  const outer = [[-w / 2, 0], [w / 2, 0], ...crown];
  // These authoring controls have already affected the generated polygon.
  const { segments: _segments, outline: _outline, outlineAxis: _axis, ...resolved } = s;
  if (s.kind === 'arch.pointed') {
    if (n > 14) return refuse([...path, 'segments'], 'Pointed arch outline exceeds 64 vertices', 'Use at most 14 segments per arc');
    const t = w * 0.18, innerW = w - 2 * t, innerH = h - t;
    const inside = pointed({ kind: 'extrude', size: [innerW, innerH, d], segments: n }, path).polygon as number[][];
    // One closed ribbon, legs plus crown, with an open bottom (no filled doorway).
    const polygon = [...outer.slice(1), outer[0], inside[0], ...inside.slice(1).reverse()];
    return { ...resolved, kind: 'arch', size: [w, h, d], polygon };
  }
  const polygon = s.outlineAxis === 'yx' ? outer.map(([x, y]) => [y, x]) : outer;
  const { size: _size, ...out } = resolved;
  return { ...out, kind: 'extrude', polygon, h: s.h ?? d };
}

/** Authored entries → ordinary primitives. Deterministic, bounded and shared by bake and mesh. */
export function expandKitProgram(input: unknown, params: Record<string, unknown> = {}): KitArgs {
  const args = kitArgs.parse(input), shapes: Delta[] = [], sources: number[] = [];
  for (const [index, authored] of args.shapes.entries()) {
    const path = ['shapes', index]; let s: Delta = { ...authored };
    for (const key of numeric) if (s[key] !== undefined) s[key] = numbers(s[key], params, [...path, key]);
    const count = (value: unknown, field: string) => {
      const n = typeof value === 'string' ? kitNumber(value, params, [...path, field, 'n']) : value;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > L.kitExpandedShapes) return refuse([...path, field, 'n'], 'Count must be an integer from 1 to 512', 'Reduce the count to 1…512');
      return n;
    };
    const repeat = authored.repeat, radial = authored.radial;
    const nr = repeat ? count(repeat.n, 'repeat') : 1, na = radial ? count(radial.n, 'radial') : 1;
    const axes = authored.mirror === true ? ['x'] as const : !authored.mirror ? [] : typeof authored.mirror === 'string' ? [authored.mirror] : authored.mirror;
    if (new Set(axes).size !== axes.length) refuse([...path, 'mirror'], 'Duplicate mirror axis', 'List each mirror axis once');
    const total = nr * na * 2 ** axes.length;
    if (shapes.length + total > L.kitExpandedShapes) refuse(path, `Kit expands beyond ${L.kitExpandedShapes} shapes`, 'Reduce repeat/radial counts or mirror axes');
    if (s.from || s.to) {
      if (!s.from || !s.to || !['cyl', 'cone', 'capsule', 'box', 'rbox'].includes(String(s.kind))) refuse([...path, 'from'], 'Endpoints need both from/to and a box/rbox/cyl/cone/capsule', 'Supply two distinct endpoints and a supported kind');
      if (s.at || s.yaw !== undefined || s.pitch !== undefined || s.roll !== undefined || s.scale) refuse([...path, 'from'], 'Endpoints already set position and rotation', 'Remove at/yaw/pitch/roll/scale when using from/to');
      const a = vec(s, 'from'), b = vec(s, 'to'), d = b.map((v, i) => v - a[i]), len = Math.hypot(...d);
      if (len < 1e-6) refuse([...path, 'to'], 'Endpoints coincide', 'Separate from and to');
      s.at = a.map((v, i) => (v + b[i]) / 2);
      s.pitch = Math.acos(Math.max(-1, Math.min(1, d[1] / len))); s.yaw = Math.atan2(-d[0], -d[2]);
      if (s.kind === 'box' || s.kind === 'rbox') { const size = vec(s, 'size', [0.1, 1, 0.1]); s.size = [size[0], len, size[2]]; }
      else { const r = (s.r ?? 0.2) as number; s.h = s.kind === 'capsule' ? len - 2 * r : len; if ((s.h as number) <= 0) refuse([...path, 'to'], 'Capsule endpoints are closer than its diameter', 'Separate endpoints or reduce r'); }
    }
    if (!s.at) refuse([...path, 'at'], 'Shape needs at or from/to', 'Set at:[x,y,z] or both endpoints');
    delete s.from; delete s.to; delete s.repeat; delete s.radial; delete s.mirror;
    if (s.kind === 'arch' && s.outline === 'lancet') s.kind = 'arch.pointed';
    if (s.outline && s.kind !== 'extrude' && s.kind !== 'arch.pointed') refuse([...path, 'outline'], 'Lancet outline needs extrude or arch.pointed', 'Use kind:extrude for a filled panel');
    if (s.kind === 'arch.pointed' || s.outline) s = pointed(s, path);
    else if (s.outlineAxis) refuse([...path, 'outlineAxis'], 'outlineAxis needs outline:lancet', 'Add outline:lancet or remove outlineAxis');
    let row: Delta = s;
    if (repeat && Array.isArray(repeat.step) && typeof repeat.step[0] === 'object' && repeat.step.length !== nr - 1) refuse([...path, 'repeat', 'step'], 'Delta list must contain n−1 steps', 'Provide one delta for each copy after the first');
    for (let i = 0; i < nr; i++) {
      if (i && repeat) {
        const step = repeat.step;
        if (Array.isArray(step) && typeof step[0] !== 'object') row = shifted(row, numbers(step, params, [...path, 'repeat', 'step']) as Vec3);
        else row = deltaStep(row, (Array.isArray(step) ? step[i - 1] : step) as Delta, params, [...path, 'repeat', 'step']);
      }
      for (let j = 0; j < na; j++) {
        let copy = { ...row };
        if (radial) {
          const r = numbers(radial.r, params, [...path, 'radial', 'r']) as number, start = numbers(radial.start ?? 0, params, [...path, 'radial', 'start']) as number;
          const arc = numbers(radial.arc ?? Math.PI * 2, params, [...path, 'radial', 'arc']) as number;
          if (!(r >= 0)) refuse([...path, 'radial', 'r'], 'Radial radius must be nonnegative', 'Use r ≥ 0');
          const angle = start + arc * j / (Math.abs(Math.abs(arc) - Math.PI * 2) < 1e-10 ? na : Math.max(1, na - 1));
          copy = shifted(copy, [r * Math.sin(angle), 0, r * Math.cos(angle)]);
          if (radial.face !== 'none') {
            const turn = angle + (radial.face === 'in' ? Math.PI : 0);
            copy.yaw = (copy.yaw as number ?? 0) + turn;
            if (row.pivot) {
              const p = vec(row, 'pivot').map((v, k) => v - vec(row, 'at')[k]), at = vec(copy, 'at');
              copy.pivot = [at[0] + p[0] * Math.cos(turn) + p[2] * Math.sin(turn), at[1] + p[1], at[2] - p[0] * Math.sin(turn) + p[2] * Math.cos(turn)];
            }
          }
        }
        let copies = [copy]; for (const axis of axes) copies = [...copies, ...copies.map(sh => reflected(sh, axis))];
        shapes.push(...copies); sources.push(...copies.map(() => index));
      }
    }
  }
  const parsed = plainKitArgs.safeParse({ ...args, shapes });
  if (!parsed.success) throw new z.ZodError(parsed.error.issues.map(issue => ({ ...issue, path: issue.path[0] === 'shapes' && typeof issue.path[1] === 'number' ? ['shapes', sources[issue.path[1]], ...issue.path.slice(2)] : issue.path })));
  return parsed.data;
}
