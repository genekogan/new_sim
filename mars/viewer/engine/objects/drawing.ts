import type { Diagnostic } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Entity } from '../world/types.ts';
import { rot2, type Vec2, type Vec3 } from '../core/math.ts';
import { surfaceSlot, slotOccupant } from '../items/model.ts';
export const DRAWING_MARK_TICKS = 20;
/** Eight bounded line segments of a hypothetical desert shelter study, pad-local metres. */
export const DRAWING_MARKS: readonly (readonly [Vec2, Vec2])[] = [
  [
    [-0.075, 0.035],
    [0.075, 0.035],
  ],
  [
    [0.075, 0.035],
    [0.075, -0.025],
  ],
  [
    [0.075, -0.025],
    [0, -0.065],
  ],
  [
    [0, -0.065],
    [-0.075, -0.025],
  ],
  [
    [-0.075, -0.025],
    [-0.075, 0.035],
  ],
  [
    [-0.075, 0.035],
    [-0.025, 0.035],
  ],
  [
    [-0.025, 0.035],
    [-0.025, 0],
  ],
  [
    [-0.025, 0],
    [0.025, 0],
  ],
];
export const DRAWING_TOTAL_TICKS = DRAWING_MARKS.length * DRAWING_MARK_TICKS;
export const drawingDiagnostic = (
  code: string,
  message: string,
  subjects: string[],
): Diagnostic => ({ code: `drawing.${code}`, message, subjects });
export const drawingConfig = (e: Entity) =>
  e.equipment?.kind === 'drawing' ? e.equipment.config : {};
export function drawingIssue(rt: Runtime, id: string): Diagnostic | null {
  const e = rt.world.entities[id];
  if (!e) return drawingDiagnostic('missing-pad', `No sketch pad ${id}`, [id]);
  if (e.def !== 'drawing-pad' || e.kind !== 'component')
    return drawingDiagnostic('wrong-pad', `${id} must be a drawing-pad`, [id]);
  if (e.equipment && e.equipment.kind !== 'drawing')
    return drawingDiagnostic(
      'state-kind',
      `${id} has incompatible ${e.equipment.kind} state`,
      [id],
    );
  if (drawingConfig(e).available === false)
    return drawingDiagnostic(
      'unavailable',
      `${id} is unavailable for drawing`,
      [id],
    );
  const s = e.support;
  if (s?.kind !== 'resting-on' || !s.slot)
    return drawingDiagnostic(
      'pad-support',
      `${id} must rest flat in a real table slot`,
      [id],
    );
  const slot = surfaceSlot(rt.world, `${s.on}#${s.slot}`);
  if ('code' in slot) return slot;
  const table = rt.world.entities[s.on];
  if (
    table.def !== 'table-6ft' ||
    table.kind !== 'fixture' ||
    table.support?.kind !== 'ground' ||
    table.pose.p[1] !== 0 ||
    Math.abs(table.pose.pitch ?? 0) > 1e-9 ||
    Math.abs(table.pose.roll ?? 0) > 1e-9 ||
    table.phase === 'carried' ||
    table.phase === 'raising' ||
    Math.abs(e.pose.pitch ?? 0) > 1e-9 ||
    Math.abs(e.pose.roll ?? 0) > 1e-9 ||
    e.pose.p.some((v, i) => Math.abs(v - slot.p[i]) > 1e-9)
  )
    return drawingDiagnostic(
      'invalid-support',
      `${id} requires a flat grounded table-6ft support ${s.on}`,
      [id, s.on],
    );
  const occ = slotOccupant(rt.world, s.on, s.slot);
  const other = Object.values(rt.world.entities).find(
    (q) =>
      q.id !== id &&
      q.support?.kind === 'resting-on' &&
      q.support.on === s.on &&
      q.support.slot === s.slot,
  );
  if (occ?.id !== id || other)
    return drawingDiagnostic(
      'pad-slot-occupied',
      `${other?.id ?? occ?.id} conflicts with ${id} at ${slot.id}`,
      [id, other?.id ?? occ?.id ?? slot.id],
    );
  return null;
}
export function drawingPoint(e: Entity, ticks: number): Vec3 {
  const index = Math.min(
    DRAWING_MARKS.length - 1,
    Math.floor(ticks / DRAWING_MARK_TICKS),
  );
  const [from, to] = DRAWING_MARKS[index];
  const t =
    ticks >= DRAWING_TOTAL_TICKS
      ? 1
      : (ticks % DRAWING_MARK_TICKS) / DRAWING_MARK_TICKS;
  const q = rot2(
    [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t],
    e.pose.yaw,
  );
  return [e.pose.p[0] + q[0], e.pose.p[1] + 0.012 + 0.08, e.pose.p[2] + q[1]];
}
/** Detached actual facts; marks are pad-local metres, renderer transforms with the pad pose. */
export function readDrawing(rt: Runtime, id: string) {
  const e = rt.world.entities[id];
  if (!e || e.def !== 'drawing-pad')
    return drawingDiagnostic('missing-pad', `No drawing-pad ${id}`, [id]);
  const c = drawingConfig(e),
    ticks = typeof c.drawTicks === 'number' ? c.drawTicks : 0;
  return {
    id,
    pad: id,
    pencil: typeof c.pencil === 'string' ? c.pencil : undefined,
    task: typeof c.task === 'string' ? c.task : undefined,
    user: typeof c.user === 'string' ? c.user : undefined,
    action: typeof c.action === 'string' && c.action ? c.action : undefined,
    status:
      c.status === 'active' ||
      c.status === 'unfinished' ||
      c.status === 'completed'
        ? c.status
        : 'idle',
    phase: typeof c.phase === 'string' ? c.phase : '',
    ticks,
    progress: ticks / DRAWING_TOTAL_TICKS,
    completedMarks: DRAWING_MARKS.slice(
      0,
      Math.floor(ticks / DRAWING_MARK_TICKS),
    ).map((mark) => mark.map((p) => [...p])),
    activeMark:
      ticks < DRAWING_TOTAL_TICKS
        ? {
            index: Math.floor(ticks / DRAWING_MARK_TICKS),
            progress: (ticks % DRAWING_MARK_TICKS) / DRAWING_MARK_TICKS,
            points: DRAWING_MARKS[Math.floor(ticks / DRAWING_MARK_TICKS)].map(
              (p) => [...p],
            ),
          }
        : undefined,
    totalMarks: DRAWING_MARKS.length,
  };
}

export type DrawingReadout = Exclude<
  ReturnType<typeof readDrawing>,
  Diagnostic
>;
