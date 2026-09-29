import { opSchemas } from '../engine/api/schemas.ts';
import { checkInputBounds, type EngineController, type OpResult } from '../engine/api/controller.ts';
import { isPauseSnapshot } from '../engine/api/pause.ts';

// Conservative admission for synchronous DO runs. These are product limits,
// not a claim that a step/entity count predicts CPU time. Large chapter runs
// require measured acceptance before raising these limits or segmented hosting.
export const ROOM_MAX_STEPS = 96;
export const ROOM_MAX_ENTITIES = 128;

export function workloadRefusal(ctl: EngineController, op: string, input: unknown): OpResult | undefined {
  if (!['bind_plan', 'rehearse', 'execute', 'resume'].includes(op) || checkInputBounds(input)) return;
  let steps = 0;
  let refs: string[] = [];
  if (op === 'bind_plan') {
    const q = opSchemas.bind_plan.safeParse(input);
    if (!q.success) return;
    steps = q.data.template.steps.length;
    refs = [q.data.workspace];
  } else if (op === 'rehearse' || op === 'execute') {
    const q = opSchemas[op].safeParse(input);
    if (!q.success) return;
    const stored = ctl.plan(q.data.plan_id);
    if (!stored) return;
    steps = stored.plan.steps.length;
    refs = [stored.plan.baselineCheckpoint, q.data.workspace ?? stored.workspace];
  } else if (op === 'resume') {
    const q = opSchemas.resume.safeParse(input);
    if (!q.success || !ctl.history.workspaces.has(q.data.workspace)) return;
    const { snapshot } = ctl.history.read(q.data.workspace, { resume: true });
    if (!isPauseSnapshot(snapshot)) return;
    steps = snapshot.pause.runner.steps.length + (q.data.commands?.length ?? 0);
    refs = [q.data.workspace];
  } else return;
  const entities = refs.reduce((max, ref) => {
    if (!ctl.history.workspaces.has(ref) && !ctl.history.checkpoints.has(ref)) return max;
    return Math.max(max, Object.keys(ctl.history.read(ref).entities).length);
  }, 0);
  if (steps <= ROOM_MAX_STEPS && entities <= ROOM_MAX_ENTITIES) return;
  return {
    ok: false, code: 'room.workload-limit',
    message: `${op} for ${refs.join(', ')} has ${steps} steps and up to ${entities} entities; synchronous rooms admit at most ${ROOM_MAX_STEPS} steps and ${ROOM_MAX_ENTITIES} entities. This chapter was not simulated or persisted. Rehearse it in the local studio or split it into smaller chapters; larger room workloads need measured CPU acceptance.`,
    details: { steps, entities, maxSteps: ROOM_MAX_STEPS, maxEntities: ROOM_MAX_ENTITIES, subjects: refs },
  };
}
