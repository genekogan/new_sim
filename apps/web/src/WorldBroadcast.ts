import * as THREE from 'three';
import {WorldRenderedVisibility} from './WorldRenderedVisibility.ts';
import { Director } from '../../../mars/viewer/cinematography/director.ts';
import type { Observation } from '../../../mars/viewer/cinematography/types.ts';
import type { SampledEntity } from '../../../mars/viewer/engine/take/replay.ts';
import type { Entity } from '../../../mars/viewer/engine/world/types.ts';
import type { SpatialScene } from '../../../mars/viewer/engine/spatial/types.ts';
import { floaterBody } from '../../../mars/viewer/engine/bodies/index.ts';
import type { CameraPose, SubjectPose } from '../../../mars/viewer/engine/camera/shots.ts';
import { WorldDirector, type DirectorChoice, type Landmark } from './WorldDirector.ts';
import { WORLD_PLACE_VIEWS, REGION_PLACE_VIEWS } from './WorldPlaces.ts';
import { WorldTour, type TourView } from './WorldTour.ts';
import { speakingNow } from './dialogue-speaking.ts';

export type WorldCameraMode = 'broadcast' | 'manual' | 'follow';
/** Rendered rays a frame may spend on a pending shot decision (beyond the
 * held shot's own tracking); one search step may finish past it. */
const DECISION_RAYS = 100;

/** VF1: Broadcast's opening and "nothing is happening" views: authored establishing views of Eden's town
 * (water-dominated views such as the lake and pier are left out). The first is the opening shot. */
const EDEN_LANDMARKS: readonly Landmark[] = (['commons', 'homes', 'market', 'bandstand', 'library', 'courtyard', 'farm', 'amphitheatre', 'domequarter', 'rooftops', 'kiosks', 'teahouse'] as const)
  .map(id => ({ id, label: WORLD_PLACE_VIEWS[id].label, p: WORLD_PLACE_VIEWS[id].p, target: WORLD_PLACE_VIEWS[id].target }));
/** VF5: the idle tour's views: Eden's town places (not the interior previews) and every Regions district. */
const TOUR_VIEWS: readonly TourView[] = [
  ...Object.entries(WORLD_PLACE_VIEWS).filter(([id]) => !['libraryroom', 'homecourtyard', 'roofseating', 'presentation', 'classroom'].includes(id)).map(([id, v]) => ({ id, label: v.label, p: v.p, target: v.target })),
  ...Object.entries(REGION_PLACE_VIEWS).map(([id, v]) => ({ id, label: v.label, p: v.p, target: v.target })),
];
/** A subject drawn smaller than this fraction of the frame height is "lost in the scenery". */
const MIN_SUBJECT_FRACTION = .045;
const EMPTY_SECONDS = 1.5;
const projector = new THREE.PerspectiveCamera(), projected = new THREE.Vector3();
/** How much of the frame height a standing body at `p` fills from `pose` (0 when behind or outside the frame). */
export function subjectFraction(pose: CameraPose, aspect: number, p: readonly number[], height: number): number {
  projector.fov = pose.fov; projector.aspect = aspect; projector.near = .1; projector.far = 2000; projector.updateProjectionMatrix();
  projector.position.fromArray(pose.position as number[]); projector.lookAt(pose.target[0], pose.target[1], pose.target[2]); projector.updateMatrixWorld();
  const feet = projected.set(p[0], p[1], p[2]).project(projector).clone(), head = projected.set(p[0], p[1] + height, p[2]).project(projector);
  if (feet.z > 1 || head.z > 1 || Math.abs(head.x) > 1 || Math.abs(feet.x) > 1 || Math.min(head.y, feet.y) > 1 || Math.max(head.y, feet.y) < -1) return 0;
  return Math.abs(head.y - feet.y) / 2;
}

/** A presentation-only camera over the same public take frame the viewer draws.
 * Recorded activities nominate shots; selection/private intention never does.
 * It uses the existing safety/readability director, rather than a second mover. */
export class WorldBroadcast {
  private rendered=new WorldRenderedVisibility();
  // Rendered occluders also bound indoor framing: clearance around the camera
  // and the reach of a blocked sightline (see feasibleShots' enclosed pass).
  private director = new Director('clear',Object.assign((pose:CameraPose,ids:readonly string[],subjects:Record<string,SubjectPose>)=>this.rendered.score(pose,ids,subjects),
    {clear:(p:readonly number[],radius:number)=>this.rendered.clear(p,radius),
     seen:(pose:CameraPose,ids:readonly string[],subjects:Record<string,SubjectPose>)=>this.rendered.seen(pose,ids,subjects),
     around:(p:readonly number[],far:number,walls?:number)=>this.rendered.around(p,far,walls),reach:(a:readonly number[],b:readonly number[])=>this.rendered.reach(a,b),
     foreground:(pose:CameraPose,aspect:number)=>this.rendered.foreground(pose,aspect)}));
  private lastTick = -Infinity;
  private lastDecisionWall = -Infinity;
  private signature = '';
  private semanticVersion = 0;
  private picker = new WorldDirector();
  private tour = new WorldTour(TOUR_VIEWS);
  private choice: DirectorChoice | null = null;
  private lastPick = -Infinity;
  private emptySince: number | null = null;
  /** Set by the viewer: Soul → entity (for who is speaking) and whether Eden's town views apply. */
  hints?: () => { soulEntity(soulId: string): string | null; eden: boolean; daylight?: number | null };

  reset() {
    this.director.reset('live-world');this.rendered.reset();
    this.lastTick = this.lastDecisionWall = -Infinity;
    this.signature = '';
    this.semanticVersion = 0;
    this.picker.reset(); this.tour.reset(); this.choice = null; this.lastPick = -Infinity; this.emptySince = null;
  }

  sample(frame: Record<string, SampledEntity>, records: Record<string, Entity>, scene: SpatialScene | null,
    tick: number, dt: number, aspect: number, wallSeconds: number, movementDt: number,renderRoots:readonly THREE.Object3D[]=[] ) {
    if (!scene || !Number.isFinite(tick) || !Number.isFinite(dt) || dt <= 0) return null;
    if (tick < this.lastTick) this.reset(); // seek/epoch, never blend old and new scenes
    const people = Object.keys(frame).filter(id => records[id]?.kind === 'human').sort();
    if (!people.length) { // nobody here at all: the town tour (Eden), else nothing to direct
      const hints = this.hints?.();this.lastTick = tick;
      return hints?.eden ? this.tourShot(wallSeconds, hints.daylight ?? null, null, renderRoots) : null;
    }
    // VF1: WorldDirector decides what is worth watching and for how long (4x a second; cheap, no rays).
    if (wallSeconds - this.lastPick >= .25 || !this.choice) {
      this.lastPick = wallSeconds;
      const hints = this.hints?.(), speaking = new Map<string, { thread: string; at: number }>();
      if (hints) for (const [soulId, sp] of speakingNow) { const id = hints.soulEntity(soulId); if (id && frame[id]) speaking.set(id, { thread: sp.thread, at: sp.since / 1000 }); }
      const before = this.choice?.key;
      this.choice = this.picker.choose({ bodies: people.map(id => ({ id, p: frame[id].p, activity: frame[id].activity })), speaking, now: wallSeconds, landmarks: hints?.eden ? EDEN_LANDMARKS : [] });
      if (this.choice?.key !== before) { this.emptySince = null; if (this.choice?.kind === 'landmark' || before?.startsWith('landmark:')) this.director.reset('live-world'); }
    }
    const choice = this.choice;
    if (!choice) return null;
    if (choice.kind === 'landmark') { // nothing interesting: the cinematic town tour (now and then where the people are)
      this.lastTick = tick;
      const prefer = TOUR_VIEWS.find(v => v.id === choice.landmark.id) ?? null;
      return this.tourShot(wallSeconds, this.hints?.()?.daylight ?? null, prefer, renderRoots);
    }
    const { focus, phase } = choice, members = choice.members.filter(id => frame[id]);
    // Conversations prefer the two-shot; everything else uses the readable "clear" program.
    this.director.policy = choice.twoShot ? 'restrained' : 'clear';
    const signature = JSON.stringify([phase, focus, members, aspect]);
    const changed = signature !== this.signature;
    if (changed) { this.semanticVersion++; this.signature = signature; }
    const subjects: Observation['subjects'] = {};
    for (const id of people) {
      const e = frame[id], body = records[id].body;
      if (body?.family === 'floater') {
        const b = floaterBody(body), y = e.p[1] + b.hoverHeight;
        subjects[id] = { p: [...e.p], yaw: e.yaw, height: b.hoverHeight + b.radius * 2,
          points: [[e.p[0], y, e.p[2]], [e.p[0], y + b.radius, e.p[2]]] };
      } else {
        const height = e.activity === 'sit' ? 1.35 : 1.75;
        subjects[id] = { p: [...e.p], yaw: e.yaw, height, kind: 'human',
          points: [[e.p[0], e.p[1] + height * .6, e.p[2]], [e.p[0], e.p[1] + height - .1, e.p[2]]],
          // Frame soles/hair and gesture width; face/torso remain the visibility probes.
          framingPoints: [[e.p[0], e.p[1]-.06, e.p[2]], [e.p[0], e.p[1]+height+.1, e.p[2]],
            [e.p[0]-.35, e.p[1]+height*.5, e.p[2]], [e.p[0]+.35, e.p[1]+height*.5, e.p[2]]] };
      }
    }
    const observation: Observation = {
      schema: 'mars-camera-observation/1', session: 'live-world', tick, time: tick * dt, aspect,
      semanticVersion: this.semanticVersion, geometryVersion: 0, eventCursor: this.semanticVersion,
      subjects, scene, activity: { phase, focus, members, departing: [],
        ...(phase === 'presenting' ? { speaker: focus, presenter: focus } : {}) },
    };
    // A decision is due 10x a second (or at once on a new activity). Its
    // candidate search is spread over display frames (DECISION_RAYS of
    // rendered rays per frame) while the held shot keeps tracking; the
    // choice is re-validated on the frame it is applied (Director.advance).
    const decide = changed || wallSeconds - this.lastDecisionWall >= .1;
    if(decide&&(changed||!this.director.searching))this.rendered.prepare(renderRoots);
    const budget=this.rendered.work+DECISION_RAYS;
    const result = this.rendered.evaluate(()=>this.director.advance(observation, movementDt, decide, changed, ()=>this.rendered.work<budget));
    if (decide) this.lastDecisionWall = wallSeconds;
    this.lastTick = tick;
    // A framing in which the subject is only a speck (a swimmer far out on the lake, a Soul behind a hill) is
    // not a shot: after a moment the director looks elsewhere.
    if (result?.pose && subjects[focus]) {
      const small = subjectFraction(result.pose, aspect, subjects[focus].p, subjects[focus].height ?? 1.75) < MIN_SUBJECT_FRACTION;
      if (!small) this.emptySince = null;
      else if ((this.emptySince ??= wallSeconds) <= wallSeconds - EMPTY_SECONDS) { this.picker.reject(choice.key, wallSeconds); this.lastPick = -Infinity; this.emptySince = null; }
    }
    return result ? { ...result, shot: `${choice.label}:${result.shot ?? ''}` } : result;
  }
  /** A tour pose; a new move is checked once against the drawn scenery (clear path, target in sight). */
  private tourShot(wallSeconds: number, daylight: number | null, prefer: TourView | null, renderRoots: readonly THREE.Object3D[]) {
    let prepared = false;
    const ready = () => { if (!prepared) { this.rendered.prepare(renderRoots); prepared = true; } };
    const pose = this.tour.pose(wallSeconds, { daylight, prefer,
      clear: p => { ready(); return this.rendered.evaluate(() => this.rendered.clear(p, .8)); },
      sight: (a, b) => { ready(); const length = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); return this.rendered.evaluate(() => this.rendered.reach(a, b)) >= Math.min(length * .6, 25); },
      open: p => { ready(); return this.rendered.evaluate(() => this.rendered.reach(p, [p[0], p[1] + 40, p[2]])) >= 39; } });
    return { pose: { position: pose.position, target: pose.target, fov: pose.fov }, shot: 'tour:' + pose.id };
  }
}

/** Same one-second camera response on 30/60/120Hz displays. */
export const followWeight = (seconds: number) => 1 - Math.exp(-6 * Math.max(0, Math.min(.1, seconds)));
