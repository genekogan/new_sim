import { CameraWorld } from '../engine/camera/geom.ts';
import { candidates } from '../engine/camera/solve.ts';
import { evaluateShot } from '../engine/camera/shots.ts';
import type { ShotSpec, SubjectPose } from '../engine/camera/shots.ts';
import type { Observation, Shot, Intention, Policy } from './types.ts';
import {renderVisibility,renderClear,renderProgram,renderForeground,distance,type RenderProbe} from './types.ts';
import type { Candidate } from '../engine/camera/solve.ts';
import { safePose, sceneWorld } from './physical.ts';
import { frontality, foreground } from './composition.ts';
export function feasibleShots(
  o: Observation,
  previous?: Shot,
  policy: Policy = 'clear',
  visibility?:RenderProbe,
  /** Also require the camera-side sightline per candidate (costlier; used
   * when no ordinary shot survives it, e.g. inside a single-sided shell). */
  strict = false,
): Shot[] {
  return drain(feasibleShotSteps(o, previous, policy, visibility, strict));
}
/** Run a step generator to completion. */
export function drain<T>(steps: Generator<void, T, void>): T {
  for (;;) { const r = steps.next(); if (r.done) return r.value; }
}
/** feasibleShots() as resumable work: yields after each shot spec (and each
 * indoor alternate), so a live caller may spread one decision over display
 * frames. Same order, same probes, same result as running it at once. */
export function* feasibleShotSteps(
  o: Observation,
  previous?: Shot,
  policy: Policy = 'clear',
  visibility?:RenderProbe,
  strict = false,
  /** Only this shot id (recovery of one framing); undefined = every shot. */
  only?: string,
  /** Subjects a moment ahead (recovery while they move): framings that will
   * lose them are graded down, so a recovery cut is not followed by another. */
  ahead?: Record<string, SubjectPose>,
): Generator<void, Shot[], void> {
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
  if (only !== undefined) specs.splice(0, specs.length, ...specs.filter((s) => s.id === only));
  // Enclosed focus (rendered walls on most sides): a shot taken from outside
  // its sampled room is moved in along the same sightline (see below).
  const roomId = focus && o.subjects[focus] ? focus : present[0];
  const room = roomId ? roomOf(o, roomId, visibility) : undefined;
  if (roomId) yield;
  const world = sceneWorld(o),
    chosen: (Shot | undefined)[] = [],
    enclosed: { index: number; run: () => Shot | undefined }[] = [];
  for (const [index, s] of specs.entries()) {
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
    // Render visibility is a read-only probe of this synchronous observation.
    // Reuse the exact candidate result for grading; never cache across frames.
    const visible = new Map<(typeof options)[number], number>();
    const visibilityOf = (c: (typeof options)[number]) => {
      if (!visible.has(c)) visible.set(c, renderVisibility(visibility,c.pose,s.ids,o.subjects));
      return visible.get(c)!;
    };
    const safe: typeof options = [];
    for (const c of options)
      if (c.valid && safePose(o, c.pose) && c.read.score >= 0.6) {
        const visible = visibilityOf(c) >= 0.85;
        yield;
        if (visible) safe.push(c);
      }
    const score = (c: (typeof safe)[number]) =>
      c.read.score -
      2*(1-visibilityOf(c))-
      0.18 * c.deviation -
      0.9 * foreground(world, c.pose, o.aspect, s.ids) +
      (policy === 'continuous' ||
      s.intention === 'establishing' ||
      s.intention === 'context'
        ? 0
        : 0.3 * frontality(c.pose, o.subjects[s.ids[0]])) -
      (ahead ? AHEAD_WEIGHT * (1 - renderVisibility(visibility, c.pose, s.ids, ahead)) : 0);
    const grades = new Map(safe.map((c) => [c, score(c)]));
    const grade = (c: (typeof safe)[number]) => grades.get(c)!;
    safe.sort((a, b) => grade(b) - grade(a));
    // Rendered clearance is probed lazily, best first: a camera inside or
    // against a wall is never a program pose. (The costlier camera-side
    // sightline is checked by the director for the shot it actually takes.)
    const clearance = new Map<Candidate, boolean>();
    const clear = (c: Candidate) => {
      if (!clearance.has(c)) clearance.set(c, strict ? renderProgram(visibility, c.pose, s.ids, o.subjects) : renderClear(visibility, c.pose.position));
      return clearance.get(c)!;
    };
    const shot = (c: Candidate): Shot => ({
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
    // Rendered foreground (a near wall or jamb filling the frame) is probed
    // lazily for the best clear framing only; a crowded one is compared with
    // the next clear alternates on grade less its foreground.
    const crowd = new Map<Candidate, number>();
    const crowded = (c: Candidate) => {
      if (!crowd.has(c)) crowd.set(c, renderForeground(visibility, c.pose, o.aspect));
      return crowd.get(c)!;
    };
    const framed = (c: Candidate) => (grades.get(c) ?? score(c)) - FOREGROUND_WEIGHT * crowded(c);
    const pick = (list: Candidate[]) => {
      let c = list.find(clear);
      const held =
        previous?.id === s.id
          ? list.find((c) => c.key === previous.variant && clear(c))
          : undefined;
      // A held framing stays on grade alone (no variant churn, no extra cut).
      if (held && c && grade(c) - grade(held) < 0.15) return held;
      if (c && visibility?.foreground && crowded(c) > FOREGROUND_OK) {
        const first: Candidate = c;
        let tries = 0;
        for (const d of list) {
          if (d === first || !clear(d)) continue;
          if (framed(d) > framed(c)) c = d;
          if (++tries >= FOREGROUND_TRIES) break;
        }
      }
      return c;
    };
    let c = pick(safe);
    if (room && s.ids[0] === roomId && (room.roofed || (s.intention !== 'establishing' && s.intention !== 'context')) &&
      c && !roomInside(room, c.pose.position[0], c.pose.position[2])) {
      // Enclosed focus framed from outside (through a doorway, window or
      // struts): move in along the same sightline to just inside the sampled
      // room. Under open sky, wide establishing/context shots may still look
      // in from above. No view at all is the enclosed pass below.
      const inside = inRoom(world, o, c, s.ids, room);
      if (inside && inside.valid && safePose(o, inside.pose) && inside.read.score >= 0.6 &&
        visibilityOf(inside) >= 0.85 && clear(inside)) c = inside;
    }
    chosen[index] = c && shot(c);
    yield;
    if (c || !visibility?.reach) continue;
    // Enclosed subject: every ordinary viewpoint is behind rendered walls.
    // Bring each blocked sightline inside to just before its first surface.
    enclosed.push({
      index,
      run: () => {
        const inside = options
          .map((c) => pulled(world, o, c, s.ids, visibility))
          .filter((c): c is Candidate => !!c && c.valid && safePose(o, c.pose) &&
            c.read.score >= 0.6 && visibilityOf(c) >= 0.85);
        for (const c of inside) grades.set(c, score(c));
        inside.sort((a, b) => grade(b) - grade(a) || a.key.localeCompare(b.key));
        const c = pick(inside);
        return c && shot(c);
      },
    });
  }
  // Indoor alternates cost extra rays: the held shot, then the focus, first.
  const focusOf = (i: number) => specs[i].ids.includes(focus ?? '') ? 0 : 1;
  enclosed.sort((a, b) =>
    (specs[a.index].id === previous?.id ? 0 : 1) - (specs[b.index].id === previous?.id ? 0 : 1) ||
    focusOf(a.index) - focusOf(b.index) || a.index - b.index);
  for (const e of enclosed.slice(0, ENCLOSED_SPECS)) { chosen[e.index] = e.run(); yield; }
  return chosen.filter((s): s is Shot => !!s);
}

/** Room sampling around the focus torso: walls within ROOM_FAR on at least
 * ROOM_WALLS of eight sides make it enclosed; inside means ROOM_MARGIN short
 * of the nearer neighbouring wall sample. */
const ROOM_FAR = 12, ROOM_WALLS = 6, ROOM_MARGIN = 0.6;
type Room = { c: [number, number, number]; reach: readonly number[]; roofed: boolean };
/** A rendered ceiling within this height above the torso makes a room roofed. */
const ROOF = 6;
function roomOf(o: Observation, id: string, probe?: RenderProbe): Room | undefined {
  const s = o.subjects[id];
  if (!s || !probe?.around) return;
  const c: [number, number, number] = [s.p[0], s.p[1] + (s.height ?? 1.75) * 0.6, s.p[2]];
  const reach = probe.around(c, ROOM_FAR, ROOM_WALLS);
  return reach && reach.slice(0, 8).filter((r) => r < ROOM_FAR).length >= ROOM_WALLS ? { c, reach, roofed: reach[8] < ROOF } : undefined;
}
function roomInside(room: Room, x: number, z: number) {
  const dx = x - room.c[0], dz = z - room.c[2];
  const a = ((Math.atan2(dz, dx) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const k = Math.floor(a / (Math.PI / 4)) % 8;
  return Math.hypot(dx, dz) <= Math.min(room.reach[k], room.reach[(k + 1) % 8]) - ROOM_MARGIN;
}
/** Same sightline, moved in from outside the sampled room to just inside it. */
function inRoom(world: CameraWorld, o: Observation, c: Candidate, ids: string[], room: Room): Candidate | undefined {
  const target = c.pose.target, from = c.pose.position, length = distance(target, from);
  if (roomInside(room, from[0], from[2]) || !roomInside(room, target[0], target[2])) return;
  let lo = 0, hi = 1;
  for (let i = 0; i < 12; i++) {
    const u = (lo + hi) / 2;
    if (roomInside(room, target[0] + (from[0] - target[0]) * u, target[2] + (from[2] - target[2]) * u)) lo = u; else hi = u;
  }
  if (lo * length < PULL_MIN) return;
  const position = target.map((v, i) => v + (from[i] - v) * lo) as typeof target;
  const fov = Math.min(PULL_FOV, (2 * Math.atan(Math.tan((c.pose.fov * Math.PI) / 360) / lo) * 180) / Math.PI);
  const inside = candidates(world, { position, target, fov }, o.subjects, ids, { aspect: o.aspect, variants: [], maxPush: 0 })[0];
  return inside && { ...inside, key: `room:${c.key}`, deviation: c.deviation };
}
/** A best framing whose rendered foreground exceeds this is compared with up
 * to FOREGROUND_TRIES clear alternates, each graded down by WEIGHT x fill. */
const FOREGROUND_OK = 0.25, FOREGROUND_TRIES = 3, FOREGROUND_WEIGHT = 1.2;
/** Grade lost for a framing that will not see its moving subject shortly. */
const AHEAD_WEIGHT = 1;
/** At most this many shot specs per decision search indoor alternates. */
const ENCLOSED_SPECS = 3;
/** Pull a blocked candidate along its own subject sightline to just inside
 * the first rendered surface, widening the lens to keep the framing. */
const PULL_MARGIN = 0.5, PULL_MIN = 1.3, PULL_FOV = 72;
function pulled(world: CameraWorld, o: Observation, c: Candidate, ids: string[], probe: RenderProbe): Candidate | undefined {
  const target = c.pose.target, from = c.pose.position, length = distance(target, from);
  const reach = probe.reach?.(target, from) ?? Infinity;
  if (!(reach < length) || reach - PULL_MARGIN < PULL_MIN) return;
  const u = (reach - PULL_MARGIN) / length;
  const position = target.map((v, i) => v + (from[i] - v) * u) as typeof target;
  const fov = Math.min(PULL_FOV, (2 * Math.atan(Math.tan((c.pose.fov * Math.PI) / 360) / u) * 180) / Math.PI);
  const inside = candidates(world, { position, target, fov }, o.subjects, ids, { aspect: o.aspect, variants: [], maxPush: 0 })[0];
  return inside && { ...inside, key: `in:${c.key}`, deviation: c.deviation };
}

/** Resample only the chosen shot/variant at this displayed frame. Editorial
 * choice, alternate ranking and hold clocks remain with feasibleShots/update. */
export function trackSelectedShot(o:Observation,held:Shot,visibility?:RenderProbe):Shot|undefined {
  if(!held.subjects.every(id=>o.subjects[id]))return;
  const spec:ShotSpec=held.spec.kind==='frameGroup'?{
    ...held.spec,aspect:o.aspect,
    azimuth:held.intention==='establishing'||held.intention==='context'?.75:
      o.subjects[held.subjects[0]].yaw+(held.subjects.length===1?.35:1.05),
  }:held.spec;
  const desired=evaluateShot(spec,()=>o.subjects,o.time);
  const inside=held.variant.startsWith('in:'),roomy=held.variant.startsWith('room:'),
    key=inside?held.variant.slice(3):roomy?held.variant.slice(5):held.variant,world=sceneWorld(o);
  let candidate:Candidate|undefined=candidates(world,desired,o.subjects,held.subjects,
    {aspect:o.aspect,variants:[key],maxPush:0}).find(c=>c.key===key);
  if(inside&&candidate)candidate=visibility?.reach?pulled(world,o,candidate,held.subjects,visibility):undefined;
  if(roomy&&candidate){
    // Still enclosed: keep the in-room sightline; an ordinary pose that is
    // already inside stays as is. Leaving the room returns to selection.
    const room=roomOf(o,held.subjects[0],visibility);
    candidate=room?inRoom(world,o,candidate,held.subjects,room)??(roomInside(room,candidate.pose.position[0],candidate.pose.position[2])?candidate:undefined):undefined;
  }
  if(!candidate?.valid||!safePose(o,candidate.pose)||candidate.read.score<.6||
    renderVisibility(visibility,candidate.pose,held.subjects,o.subjects)<.85||!renderProgram(visibility,candidate.pose,held.subjects,o.subjects))return;
  return {...held,spec,pose:candidate.pose,quality:candidate.read.score,reasons:candidate.read.reasons};
}
