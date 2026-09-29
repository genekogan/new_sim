// LM-014: control.ts registers and dispatches every tool through one transport registry.
// These classifications make the LM-202 boundary explicit: engine_* operations own engine
// worlds/plans/takes; live viewer controls retain their existing separate presentation model.
// Engine equivalents describe the analogous engine capability, not an ID/state translation.
// All viewer failures (including schema errors) use the same legacyRefusal envelope.

export type LegacyScope = 'engine-equivalent' | 'viewer-only';
/** `engine`: engine tool names (`engine_<op>`) and registry / sequence verbs (`verb:<name>`) that do this job on engine state. */
export type LegacyRoute = { scope: LegacyScope; engine: string[]; reason: string };

const VIEWER = 'acts on the live shared viewer (what spectators see now), which the engine does not model';

export const LEGACY_TOOLS: Record<string, LegacyRoute> = {
  get_state: { scope: 'engine-equivalent', engine: ['engine_query_world', 'engine_list'], reason: 'engine world state: engine_query_world (entities, regions, previews); runs and takes: engine_list' },
  get_capabilities: { scope: 'engine-equivalent', engine: ['engine_list_verbs'], reason: 'every engine verb with its JSON Schema, the template schema and the sequence built-ins' },
  move_person: { scope: 'engine-equivalent', engine: ['engine_bind_plan', 'engine_execute', 'verb:walk_to'], reason: 'a walk_to step in a bound plan, rehearsed and executed' },
  move_group: { scope: 'engine-equivalent', engine: ['engine_bind_plan', 'engine_execute', 'verb:walk_to', 'verb:gather'], reason: 'one walk_to step per person (or gather into a place region) in one plan' },
  set_person_activity: { scope: 'engine-equivalent', engine: ['verb:converse', 'verb:ambient_wander', 'verb:stand', 'verb:face'], reason: 'talk → converse, wander → ambient_wander, idle → stand; wave has no engine verb (a viewer gesture)' },
  start_activity: { scope: 'engine-equivalent', engine: ['verb:gather', 'verb:campfire_circle', 'verb:converse'], reason: 'gathering → gather, campfire → campfire_circle, talk → converse' },
  set_euc_riders: { scope: 'engine-equivalent', engine: ['verb:mount', 'verb:ride_loop', 'verb:dismount'], reason: 'engine vehicles are ridden by named people through mount / ride_loop / dismount steps' },
  command_euc_riders: { scope: 'engine-equivalent', engine: ['verb:ride_to', 'verb:ride_loop', 'verb:dismount'], reason: 'circle → ride_loop, return → ride_to, dismount → dismount' },
  set_camera: { scope: 'viewer-only', engine: ['engine_attach_camera_track'], reason: `${VIEWER}; a camera of a recorded take is engine_attach_camera_track (fixed shot)` },
  set_camera_trajectory: { scope: 'viewer-only', engine: ['engine_attach_camera_track', 'engine_direct_camera'], reason: `${VIEWER}; for a take: an orbit shot or a directed orbit` },
  set_camera_path: { scope: 'viewer-only', engine: ['engine_attach_camera_track'], reason: `${VIEWER}; for a take: a path shot` },
  stop_camera: { scope: 'viewer-only', engine: [], reason: `${VIEWER} (the follow camera)` },
  set_environment: { scope: 'viewer-only', engine: [], reason: `${VIEWER}: the viewer's day clock; an engine world's env.datetime is fixed per state and is visual only (spec §19)` },
  set_weather: { scope: 'viewer-only', engine: [], reason: `${VIEWER}: weather is visual; engine env weather is not physical (spec §19)` },
  set_fire: { scope: 'viewer-only', engine: [], reason: `${VIEWER}: the campfire effect; the engine campfire is a fixture people gather at` },
  set_paused: { scope: 'viewer-only', engine: [], reason: `${VIEWER}: engine runs are offline and deterministic; pausing a run is engine_execute pauseAt / engine_resume` },
  set_simulation_speed: { scope: 'viewer-only', engine: [], reason: `${VIEWER}: engine runs have no wall-clock rate (replay speed is a viewer setting)` },
  set_screens: { scope: 'viewer-only', engine: [], reason: `${VIEWER}: projector / gallery monitor content` },
  apply_scene: { scope: 'viewer-only', engine: ['engine_bind_plan'], reason: `${VIEWER}: a batch of legacy commands; the engine batch is a plan (steps with after / when / at)` },
  reset_simulation: { scope: 'viewer-only', engine: ['engine_fork', 'engine_delete_workspace'], reason: `${VIEWER}; engine state is never reset: fork a canonical workspace, delete forks you no longer need` },
};

/** Description prefix every legacy tool carries, so an agent sees which path it is on. */
export function legacyDescription(name: string, description: string): string {
  const r = LEGACY_TOOLS[name];
  if (!r) return description;
  const eq = r.engine.length ? ` Engine path: ${r.engine.join(', ')}.` : '';
  return `[legacy viewer control${r.scope === 'viewer-only' ? ', viewer-only' : ''}] ${description}${eq}`;
}

/** The one refusal envelope of a failed legacy command (the engine tools' shape, plus `legacy` and the engine path). */
export function legacyRefusal(name: string, e: unknown): { ok: false; code: string; message: string; legacy: true; tool: string; engine: string[] } {
  const message = e instanceof Error ? e.message : typeof e === 'string' ? e : 'Command failed';
  return { ok: false, code: 'legacy.command-failed', message: `${name}: ${message}`, legacy: true, tool: name, engine: LEGACY_TOOLS[name]?.engine ?? [] };
}
