import { CameraWorld } from '../engine/camera/geom.ts';
import { candidates } from '../engine/camera/solve.ts';
import { evaluateShot } from '../engine/camera/shots.ts';
import type { ShotSpec } from '../engine/camera/shots.ts';
import type { Observation, Shot, Intention } from './types.ts';
import { safePose } from './physical.ts';
export function feasibleShots(o: Observation, previous?: Shot): Shot[] {
  const present = o.activity.members.filter((id) => o.subjects[id]);
  const focus = o.activity.focus ?? o.activity.speaker;
  const specs: {
    id: string;
    intention: Intention;
    ids: string[];
    spec: ShotSpec;
  }[] = [];
  const add = (
    id: string,
    intention: Intention,
    ids: string[],
    padding = 1.15,
    elevation = 0.12,
  ) => {
    if (!ids.length) return;
    specs.push({
      id,
      intention,
      ids,
      spec: {
        kind: 'frameGroup',
        subjects: ids,
        azimuth:
          ids.length === 1 && o.subjects[ids[0]]?.height === 1.4 ? -0.75 : 0.75,
        elevation,
        padding,
        fov: 45,
        aspect: o.aspect,
      },
    });
  };
  add('group', 'establishing', present, 1.2, 0.25);
  if (focus && o.subjects[focus]) {
    add(
      `${o.activity.phase === 'question' ? 'questioner' : 'speaker'}:${focus}`,
      o.activity.phase === 'question' ? 'questioner' : 'speaker',
      [focus],
      1.25,
    );
    if (o.activity.display)
      add(
        `display:${focus}`,
        'speaker-display',
        [focus, o.activity.display],
        1.18,
      );
    const partner =
      present.find((id) => id !== focus && id === o.activity.presenter) ??
      present.find((id) => id !== focus && id === o.activity.speaker) ??
      present.find((id) => id !== focus);
    if (partner)
      add(`pair:${focus}:${partner}`, 'two-person', [focus, partner], 1.25);
  }
  for (const id of present) add(`follow:${id}`, 'follow', [id], 1.4, 0.15);
  for (const id of o.activity.departing.filter((id) => o.subjects[id]))
    add(`follow:${id}`, 'follow', [id], 1.45, 0.15);
  add('context', 'context', present, 1.65, 0.55);
  if (
    previous &&
    !specs.some((s) => s.id === previous.id) &&
    previous.subjects.every(
      (id) =>
        o.subjects[id] &&
        (o.activity.members.includes(id) ||
          id === o.activity.display ||
          previous.intention === 'follow'),
    )
  )
    specs.push({
      id: previous.id,
      intention: previous.intention,
      ids: previous.subjects,
      spec:
        previous.spec.kind === 'frameGroup'
          ? { ...previous.spec, aspect: o.aspect }
          : previous.spec,
    });
  const world = new CameraWorld(o.scene),
    shots: Shot[] = [];
  for (const s of specs) {
    const desired = evaluateShot(s.spec, () => o.subjects, o.time);
    const options = candidates(world, desired, o.subjects, s.ids, {
      aspect: o.aspect,
      variants: ['az+30', 'az-30', 'el+15', 'wide1.3'],
      maxPush: 0,
    });
    const safe = options.filter(
      (c) => c.valid && safePose(o, c.pose) && c.read.score >= 0.6,
    );
    safe.sort(
      (a, b) =>
        b.read.score - 0.18 * b.deviation - (a.read.score - 0.18 * a.deviation),
    );
    let c = safe[0];
    const held =
      previous?.id === s.id
        ? safe.find((c) => c.key === previous.variant)
        : undefined;
    if (
      held &&
      c &&
      c.read.score -
        0.18 * c.deviation -
        (held.read.score - 0.18 * held.deviation) <
        0.3
    )
      c = held;
    if (c)
      shots.push({
        variant: c.key,
        spec: s.spec,
        id: s.id,
        intention: s.intention,
        subjects: s.ids,
        pose: c.pose,
        quality: c.read.score,
        valid: true,
        reasons: c.read.reasons,
        side: 1,
      });
  }
  return shots;
}
