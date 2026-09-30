import { CameraWorld } from '../engine/camera/geom.ts';
import { candidates } from '../engine/camera/solve.ts';
import { evaluateShot } from '../engine/camera/shots.ts';
import type { ShotSpec } from '../engine/camera/shots.ts';
import type { Observation, Shot, Intention, Policy } from './types.ts';
import { safePose } from './physical.ts';
import { frontality, foreground } from './composition.ts';
export function feasibleShots(
  o: Observation,
  previous?: Shot,
  policy: Policy = 'clear',
): Shot[] {
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
          intention === 'establishing' || intention === 'context'
            ? 0.75
            : (o.subjects[ids[0]]?.yaw ?? 0) + (ids.length === 1 ? 0.35 : 1.05),
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
      0.45,
    );
    if (o.activity.display)
      add(
        `display:${focus}`,
        'speaker-display',
        [focus, o.activity.display],
        0.55,
      );
    const partner =
      present.find((id) => id !== focus && id === o.activity.presenter) ??
      present.find((id) => id !== focus && id === o.activity.speaker) ??
      present.find((id) => id !== focus);
    if (partner)
      add(`pair:${focus}:${partner}`, 'two-person', [focus, partner], 0.55);
  }
  for (const id of present) add(`follow:${id}`, 'follow', [id], 0.65, 0.15);
  for (const id of o.activity.departing.filter((id) => o.subjects[id]))
    add(`follow:${id}`, 'follow', [id], 0.65, 0.15);
  add('context', 'context', present, 1.65, 0.55);
  if (
    previous &&
    !specs.some((s) => s.id === previous.id) &&
    previous.subjects.every((id) => o.subjects[id])
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
    if (policy === 'continuous' && s.intention === 'follow')
      s.spec = {
        kind: 'follow',
        subject: s.ids[0],
        subjects: s.ids,
        offset: [-3.8, 1.9, 1.4],
        lookHeight: (o.subjects[s.ids[0]].height ?? 1.75) * 0.65,
        damping: 0,
        fov: 45,
      };
    const desired = evaluateShot(s.spec, () => o.subjects, o.time);
    const options = candidates(world, desired, o.subjects, s.ids, {
      aspect: o.aspect,
      variants: ['az+30', 'az-30', 'az+60', 'az-60', 'el+15', 'wide1.3'],
      maxPush: 0,
    });
    const safe = options.filter(
      (c) => c.valid && safePose(o, c.pose) && c.read.score >= 0.6,
    );
    const score = (c: (typeof safe)[number]) =>
      c.read.score -
      0.18 * c.deviation -
      0.9 * foreground(world, c.pose, o.aspect, s.ids) +
      (policy === 'continuous' ||
      s.intention === 'establishing' ||
      s.intention === 'context'
        ? 0
        : 0.3 * frontality(c.pose, o.subjects[s.ids[0]]));
    const grades = new Map(safe.map((c) => [c, score(c)]));
    const grade = (c: (typeof safe)[number]) => grades.get(c)!;
    safe.sort((a, b) => grade(b) - grade(a));
    let c = safe[0];
    const held =
      previous?.id === s.id
        ? safe.find((c) => c.key === previous.variant)
        : undefined;
    if (held && c && grade(c) - grade(held) < 0.15) c = held;
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
