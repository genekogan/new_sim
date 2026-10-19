// Harvest fix kitlenient: kit/2 definitions are corrected, not refused, where the correction is certain and harmless.
// Each correction is reported (field, what was done); anything else is left for validateKit to refuse as before.
import { KIT_GEOMETRY_FIELDS, KIT_SHAPE_FIELDS, kitPrimitiveFields } from './kit.ts';

export type KitCorrection = { field: string; done: string };
type Shape = Record<string, unknown>;

/** Authoring keys a program shape carries before expansion (kit-program.ts). */
const PROGRAM_KEYS = new Set(['repeat', 'radial', 'mirror', 'from', 'to', 'outline', 'outlineAxis']);
/** The segments range of the shape schema, and the narrower ranges contract 2 would clamp in the renderer. */
const SEGMENTS = { min: 3, max: 32 } as const;
const V2_SEGMENTS: Record<string, [number, number]> = { capsule: [6, 10], sweep: [5, 8] };
const fmt = (v: unknown) => JSON.stringify(v);

/** Returns corrected args (a copy; input untouched) and the corrections made. Never throws on odd input. */
export function correctKitArgs(input: unknown): { args: unknown; corrections: KitCorrection[] } {
  const corrections: KitCorrection[] = [];
  if (!input || typeof input !== 'object' || !Array.isArray((input as { shapes?: unknown }).shapes)) return { args: input, corrections };
  const args = { ...(input as Record<string, unknown>) }, v = args.v === 2 ? 2 : 1;
  args.shapes = (args.shapes as unknown[]).map((raw, i) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
    const sh: Shape = { ...(raw as Shape) }, at = `shapes.${i}`;
    const note = (field: string, done: string) => corrections.push({ field: `${at}.${field}`, done });
    // A plain number means uniform scale (an expression string too: each axis takes the same expression).
    if (typeof sh.scale === 'number' || typeof sh.scale === 'string') { const s = sh.scale; sh.scale = [s, s, s]; note('scale', `${fmt(s)} → ${fmt(sh.scale)} (uniform)`); }
    // Lancet outlines resolve to another primitive and use segments for their own outline; leave them to the validator.
    const resolvesElsewhere = sh.kind === 'arch.pointed' || sh.outline !== undefined;
    if (typeof sh.segments === 'number' && Number.isFinite(sh.segments) && !resolvesElsewhere) {
      const [lo, hi] = (v === 2 && !(sh.kind === 'sweep' && sh.profile) ? V2_SEGMENTS[String(sh.kind)] : undefined) ?? [SEGMENTS.min, SEGMENTS.max];
      const n = Math.min(hi, Math.max(lo, Math.round(sh.segments)));
      if (n !== sh.segments) { note('segments', `${sh.segments} → ${n} (${sh.kind} takes ${lo}–${hi})`); sh.segments = n; }
    }
    if (v === 2 && !resolvesElsewhere) {
      for (const f of Object.keys(sh)) if (!KIT_SHAPE_FIELDS.has(f) && !PROGRAM_KEYS.has(f)) { delete sh[f]; note(f, 'removed (not a kit field)'); }
      const used = kitPrimitiveFields(sh as { kind: string });
      for (const f of KIT_GEOMETRY_FIELDS) if (sh[f] !== undefined && !used.includes(f)) { delete sh[f]; note(f, `removed (no effect on ${sh.kind})`); }
      // An rbox with no bevel draws as a sharp box, so its segments do nothing.
      const round = typeof sh.round === 'number' ? sh.round : Math.max(typeof args.round === 'number' ? args.round : 0.04, 0.06);
      if (sh.kind === 'rbox' && sh.segments !== undefined && round <= 0.005) { delete sh.segments; note('segments', 'removed (no effect on a sharp rbox)'); }
    }
    return sh;
  });
  return { args: corrections.length ? args : input, corrections };
}

/** Does a kit carry program instructions (expanded on the server)? */
export const isKitProgram = (shapes: unknown[]) => shapes.some(s => !!s && typeof s === 'object' && ((s as Shape).kind === 'arch.pointed' || [...PROGRAM_KEYS].some(k => (s as Shape)[k] !== undefined) || JSON.stringify(s).includes('$')));
