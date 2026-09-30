// Small authoritative object seam for the first classroom. A session owns the
// `display:<id>` claim and may update only that display; independent commands use
// the same claim through Runtime.submit.
import { z } from 'zod';
import type { ActionDef, Diagnostic, StepResult } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import { CATALOG } from '../world/catalog.ts';
import type { Entity } from '../world/types.ts';

export type DisplayMode = 'on' | 'off';
export type DisplayReadout = { id: string; available: boolean; mode: DisplayMode; content: string; session?: string; phase?: string; floorHolder?: string; attentionTarget?: { actor?: string; point?: [number, number] } };
export type DisplayFocus = { session: string; displayId: string; content?: string; floorHolder?: string; attentionTarget?: { actor?: string; point?: [number, number] }; phase: string };

const displayOf = (rt: Runtime, id: string): Entity | Diagnostic => {
  const e = rt.world.entities[id];
  if (!e) return { code: 'object.unknown', message: `no display entity "${id}"`, subjects: [id] };
  if (e.kind !== 'fixture' || !CATALOG[e.def]?.capabilities?.display)
    return { code: 'object.no-display', message: `${id} (${e.def}) has no usable display capability`, subjects: [id] };
  return e;
};

/** Capability check used at activity admission; an unavailable unit cannot be used. */
export function displaySupport(rt: Runtime, displayId: string): Diagnostic | null {
  const e = displayOf(rt, displayId);
  if ('code' in e) return e;
  if (e.equipment?.config.available === false)
    return { code: 'display.unavailable', message: `${displayId} is unavailable`, subjects: [displayId] };
  return null;
}

export function displayReadout(rt: Runtime, displayId: string): DisplayReadout | Diagnostic {
  const e = displayOf(rt, displayId);
  if ('code' in e) return e;
  const c = e.equipment?.kind === 'display' ? e.equipment.config : {};
  return {
    id: displayId, available: c.available !== false,
    mode: c.mode === 'on' ? 'on' : 'off', content: typeof c.content === 'string' ? c.content : '',
    ...(typeof c.session === 'string' && c.session ? { session: c.session } : {}),
    ...(typeof c.phase === 'string' && c.phase ? { phase: c.phase } : {}),
    ...(typeof c.floorHolder === 'string' && c.floorHolder ? { floorHolder: c.floorHolder } : {}),
    ...(c.attentionActor || c.attentionHasPoint ? { attentionTarget: {
      ...(typeof c.attentionActor === 'string' && c.attentionActor ? { actor: c.attentionActor } : {}),
      ...(c.attentionHasPoint === true ? { point: [Number(c.attentionX), Number(c.attentionZ)] as [number, number] } : {}),
    } } : {}),
  };
}

function owner(rt: Runtime, displayId: string, session: string): Diagnostic | null {
  const holders = rt.holder(`display:${displayId}`);
  if (holders.length === 1 && holders[0] === session && rt.isActive(session)) return null;
  return { code: 'display.not-owned', message: `${session} cannot change ${displayId}; display:${displayId} is ${holders.length ? `held by ${holders.join(', ')}` : 'unclaimed'}`, subjects: [session, displayId], details: { holder: holders[0] } };
}

const validContent = (e: Entity, content: string): Diagnostic | null => {
  const max = CATALOG[e.def].capabilities!.display!.maxChars;
  return content.length <= max ? null : { code: 'display.content-too-long', message: `${e.id} accepts at most ${max} characters; received ${content.length}`, subjects: [e.id] };
};

/** Called by an active classroom action after its own display claim is granted. */
export function classroomDisplayFocus(rt: Runtime, p: DisplayFocus): Diagnostic | null {
  const d = displaySupport(rt, p.displayId);
  if (d) return d;
  const held = owner(rt, p.displayId, p.session);
  if (held) return held;
  const e = rt.world.entities[p.displayId];
  if (p.content !== undefined) {
    const bad = validContent(e, p.content);
    if (bad) return bad;
  }
  const c = e.equipment?.kind === 'display' ? e.equipment.config : {};
  e.equipment = { kind: 'display', config: {
    ...c, available: true, mode: 'on', content: p.content ?? (typeof c.content === 'string' ? c.content : ''),
    session: p.session, phase: p.phase, floorHolder: p.floorHolder ?? '',
    attentionActor: p.attentionTarget?.actor ?? '',
    attentionHasPoint: p.attentionTarget?.point !== undefined,
    attentionX: p.attentionTarget?.point?.[0] ?? 0,
    attentionZ: p.attentionTarget?.point?.[1] ?? 0,
  } };
  return null;
}

/** Cleanup may only be performed while this session still owns the display. */
export function classroomDisplayClear(rt: Runtime, session: string, displayId: string): Diagnostic | null {
  const e = displayOf(rt, displayId);
  if ('code' in e) return e;
  const held = owner(rt, displayId, session);
  if (held) return held;
  const c = e.equipment?.kind === 'display' ? e.equipment.config : {};
  e.equipment = { kind: 'display', config: { ...c, mode: 'off', session: '', phase: '', floorHolder: '', attentionActor: '', attentionHasPoint: false, attentionX: 0, attentionZ: 0 } };
  return null;
}

type Control = { display: string; mode: DisplayMode; content?: string };
type ControlExec = { id: string; p: Control };

/** Standalone director control; a classroom session's display claim excludes it. */
export const displayControl: ActionDef<Control, null, ControlExec> = {
  verb: 'display_control',
  description: 'Switch a capable classroom display on or off and optionally replace its bounded text content.',
  schema: z.strictObject({ display: z.string().min(1).max(80), mode: z.enum(['on', 'off']), content: z.string().max(160).optional() }),
  reservations: (_w, p) => [{ resource: `display:${p.display}`, mode: 'exclusive' }],
  plan(rt, p) {
    const e = displayOf(rt, p.display);
    if ('code' in e) return { ok: false, diagnostic: e };
    if (p.mode === 'on' && e.equipment?.config.available === false) return { ok: false, diagnostic: displaySupport(rt, p.display)! };
    if (p.content !== undefined) {
      const bad = validContent(e, p.content);
      if (bad) return { ok: false, diagnostic: bad };
    }
    return { ok: true, program: null };
  },
  start: (_rt, p, _prog, id) => ({ id, p }),
  step(rt, ex): StepResult {
    const e = rt.world.entities[ex.p.display];
    if (!e || !CATALOG[e.def]?.capabilities?.display) return { status: 'failed', diagnostic: { code: 'object.no-display', message: `${ex.p.display} no longer has a display capability`, subjects: [ex.p.display] } };
    const c = e.equipment?.kind === 'display' ? e.equipment.config : {};
    e.equipment = { kind: 'display', config: { ...c, mode: ex.p.mode, content: ex.p.content ?? (typeof c.content === 'string' ? c.content : ''), session: '', phase: '', floorHolder: '', attentionActor: '', attentionHasPoint: false } };
    return { status: 'completed', outputs: { display: e.id, mode: ex.p.mode } };
  },
  cancel: () => ({ ok: true }),
};

export const OBJECT_ACTIONS: ActionDef[] = [displayControl];

/** Environment adapter, deliberately a class: snapshot stores state, not service functions. */
export class ClassroomDisplayService {
  supports = displaySupport;
  focus = classroomDisplayFocus;
  clear = classroomDisplayClear;
}
