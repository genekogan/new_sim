// Engine humans → animated rigs. Renderers only read world state (guide):
// after every fixed tick we snapshot pose + derive clip state; frames
// interpolate between the last two ticks, so visuals are a deterministic
// function of sim history (not of frame rate).
//
// Only Idle/Walk clips exist, so everything else is a procedural pose layer on top of the clip
// (after mixer.update, every frame; the clip values are restored first, so nothing accumulates).
// Docs: docs/engineering/POSES.md. Layers, in order:
// - legs / pelvis (one of):
//   · sit (sit / sit-down / stand-up, and eat / serve with baseActivity sit): body lowered onto the
//     seat, thighs forward, feet on the ground; a `legs-crossed` variant for about half the people
//     (hash of the id);
//   · stairs: on an engine stairs link the Walk clip's legs are replaced by a tread-by-tread gait
//     (stair-gait.ts): foot IK plants each foot on a tread top, the pelvis follows the feet;
//   · posture (posture.ts): crouch / squat, hip bend, heel raise — solved per tick from where the
//     hands must go (engine hand points or grip slot points) and the activity, blended over 0.4 s;
// - arms: two-bone IK to the engine's published hand points (`human.hands`), else to the grip slot
//   of the gripped part, else hands on thighs (seated) / held out to the fire (warm). Reach honesty:
//   full contact within 1.02 arm lengths (reach clamped at 0.97, carriers 0.88 — elbows bent),
//   fading to none by 1.25; beyond that the arm hangs as the clip has it. No stretching.
// - Walk clip only while the person actually moves over the ground (engine `human.speed` when
//   published, else the position delta), blended out within 0.2 s.
// All of it is a pure function of (world history, entity id): no randomness.
import * as THREE from 'three';
import type { Entity, Pose, WorldState } from '../../engine/world/types.ts';
import type { Vec3 } from '../../engine/core/math.ts';
import type { Link } from '../../engine/spatial/types.ts';
import { CATALOG } from '../../engine/world/catalog.ts';
import { toWorld } from '../../engine/carry/formation.ts';
import { entityCorners } from '../../engine/spatial/service.ts';
import { handPoint, STATION_SLOT } from '../../engine/construction/liftcrew.ts';
import { LIFT_HAND } from '../../engine/construction/raise.ts';
import { DT } from '../../engine/runtime/runtime.ts';
import { createRig, type Rig, type Template } from './people.ts';
import { disposeSkeletons } from '../../lib/three-resources.ts';
import { seatHeight } from './fixtures.ts';
import { BODY_MODEL, UP, ankleLocal, armLen, armTo, armsOf, clamp01, contact, curlHand, legTo, legsOf, palm, place, setWorldQuat, smooth, spineOf, swing, turn, type Arm, type Leg, type Spine } from './rig.ts';
import { BEND_SHARE, KNEE_Y, KNEEL_SIDE, NEUTRAL, approach, kneelDrop, shoulderAt, solvePosture, styleFor, type Dims, type Posture, type Target } from './posture.ts';
import { flightOf, gaitAt, stairFootTarget, type Flight, type Gait } from './stair-gait.ts';
import { frameCtx, framePose, stanceFacing, type FrameCtx, type FramePose } from './frame-gait.ts';
import { GIRDLE, LIP, PRONE_ACTS, engineTurn, lipAlong, RISE_STEP, approachProne, lerpProne, proneFrame, riseOf, solveProne, type ProneState } from './prone.ts';
import { sleepGoal, sleepHands, sleepHeadPitch } from './sleep.ts';
import { PRONE_ACTIVITY } from '../../engine/construction/handup.ts';

type Hands = { left?: Vec3; right?: Vec3 };
type Snap = { p: [number, number, number]; yaw: number; walkW: number; walkT: number; idleT: number; sitW: number; warmW: number; pose: Posture; hands: Hands; pr: ProneState | null };
type View = {
  rig: Rig;
  prev: Snap;
  cur: Snap;
  speed: number;
  activity: string;
  sleepPose?: NonNullable<Entity['human']>['sleepPose'];
  readingGaze?: { prev: number; cur: number };
  /** Ticks since `activity` began (the prone rise clock, prone.ts riseOf, when the engine publishes no phaseK). */
  age: number;
  /** The engine's prone body turn / phaseK at the latest tick (diagnostics; undefined: not published). */
  proneEng?: { turn?: number; k?: number };
  /** The activity an overlay (eat / serve) is layered on (engine human.baseActivity). */
  base: string;
  grip?: string;
  /** Grip slot on that part (engine/construction: lift-far, foot-l/r, hold-N, lift-end/edge/corner-*, lift-station, handup-*). */
  gripSlot?: string;
  /** Rack-structure link stood on (engine human.on; readout). */
  on?: string;
  /** Pose on the rack structure (frame-gait.ts): climbing a frame, standing on its bracing, walking a beam. */
  frame?: FrameCtx | null;
  arms: Arm[];
  legs: Leg[];
  spine?: Spine;
  dims?: Dims;
  /** Per leg: ankle in the shin's frame, rest foot rotation relative to the holder, lateral offset (m, + = right). */
  ankle: THREE.Vector3[];
  footRest: THREE.Quaternion[];
  footLat: number[];
  /** Skinned vertices of each foot / hand (by the side the leg / arm has: +1 left): the prone layer keeps them on the deck. */
  surf: { foot: Map<number, VertexRefs>; hand: Map<number, VertexRefs> };
  /** Sitting-surface height of the occupied seat (m). */
  seat: number;
  /** Nearest campfire (centre x, z and ring radius) for `warm`. */
  fire?: [number, number, number];
  /** Per-person variation in [0, 1), from the id. */
  vary: number;
  /** Seated variant: one leg crossed over the other (deterministic per id). */
  cross: boolean;
  /** Bones the pose layers touch, with their clip-local transforms from the last mixer apply. */
  saved: { o: THREE.Object3D; p: THREE.Vector3; q: THREE.Quaternion }[];
  /** Diagnostics: per arm, shoulder→grip point distance / arm length at the last frame (null = no point). */
  reachRatio: (number | null)[];
  diag?: Diag;
  layered: boolean;
  gaze?: { prev: number; cur: number };
};
/** Per-frame readout of the pose layers (lab hook `bones()`, e2e). */
export type Diag = {
  gait: { flight: string; u: number; weight: number; feet: { planted: boolean; k: number; top: number }[] } | null;
  /** Foot bones (ankles) and their soles (ankle − rest ankle height), left first. */
  feet: [number, number, number][];
  soles: number[];
  hipY: number;
  /** Head bone (rendered). */
  head: [number, number, number] | null;
  pose: Posture;
  arms: { side: 'left' | 'right'; shoulder: number[]; palm: number[]; len: number; target: number[] | null; source: Source; contact: number; err: number | null; ratio: number | null }[];
  /** Rack-structure layer (frame-gait.ts): kind, ladder rung coordinate, exit progress, blend weight, the planned soles. */
  frame: { kind: string; u: number; exit: number; weight: number; feet: { p: number[]; planted: boolean }[] | null } | null;
  /** Prone layer (prone.ts): rise coordinate, torso pitch and body turn (rad), rendered yaw, layer weight; what the
   *  engine published at the latest tick (its body turn angleDelta(pose.yaw, proneYaw), phaseK; null: not published). */
  prone: (ProneState & { engTurn: number | null; phaseK: number | null }) | null;
};
/** Where an arm's target came from: engine hand points, a grip slot, or private frame/balance/ground-sleep contacts. */
type Source = 'hands' | 'grip' | 'frame' | 'sleep' | null;
/**
 * One person in a random-access frame (take replay / scrubbing). `walk` is the Walk clip weight
 * (0–1) and `walkDist` the metres walked along the track so far, so the Walk phase is a pure
 * function of take time: clip seconds = metres / clip ground speed (feet speed-matched).
 */
export type SampledHuman = {
  id: string;
  p: [number, number, number];
  yaw: number;
  walk: number;
  walkDist: number;
  activity?: string;
  grip?: string;
  gripSlot?: string;
  /** Engine hand points (take field `hands`): arms, posture and held items follow them as in the lab. */
  hands?: Hands;
  /** Activity an eat / serve overlay is layered on (take field `baseActivity`; 'sit' = seated). */
  baseActivity?: string;
  /** Rack-structure link the person stands on (take field `on`: `beam:…` / `climb:…`); readout only. */
  on?: string;
  /** Prone receiver (engine W32; take fields once the recorder carries them): lying heading (world yaw) and 0–1 progress
   *  within the engine phase — the prone layer's body turn and exact rise mid-phase (else each phase's end pose). */
  proneYaw?: number;
  phaseK?: number;
  sleepPose?: NonNullable<Entity['human']>['sleepPose'];
};
export type { Hands };
/** A gripped part's pose over the last two ticks (hand points follow the interpolated part). */
type Part = { def: string; prev: Pose; cur: Pose };
/** Nearest point of a gripped entity to a world point (components.ts nearestPoint). */
export type Reach = (entity: string, from: THREE.Vector3, out: THREE.Vector3) => boolean;

const BLEND = DT / 0.2; // Walk↔Idle crossfade: a stopped walker is standing within 0.2 s (§3)
const POSE_BLEND = DT / 0.4; // sit / warm / postures in and out over 0.4 s
const WALK_EPS = 0.08; // m/s: Walk plays iff ground speed ≥ this (engine locomotion/walk.ts WALK_MIN, MOVEMENT.md §3)
const SEAT_DEFAULT = 0.45; // m, when the seat fixture is unknown (take replay)
const SEAT_MATCH = 0.8; // m, body point to nearest seat point (covers the sit-down / stand-up approach line)
const SEATED = new Set(['sit', 'sit-down', 'stand-up']);
const OVERLAYS = new Set(['eat', 'serve']);
const PELVIS = 0.09; // m from the hip joints down to the sitting surface (thigh/buttock thickness)
const PALM_LIFT = 0.02; // m: palm centre above a surface the hand lies flat on (half a hand's thickness)
const WARM_REACH = 1.2; // m from the fire's edge within which people hold their hands out
const HEEL = 0.06; // m: trailing heel lifted at the end of a stair stance (toe-off)
const BEAM_WALK_W = 0.5; // Walk clip weight on a beam (short steps: half the leg swing, the rest Idle)
const BEAM_CADENCE = 1.8; // Walk clip rate multiplier on a beam (half-length steps at the same ground speed)
const lerpAngle = (a: number, b: number, t: number) => a + (((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * t;

function hashId(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/** Stable template choice per actor id. */
function templateFor(id: string, ts: Template[]) {
  return ts[hashId(id) % ts.length];
}

type Fixtures = { seats: [number, number, number][]; fires: [number, number, number][] };

/** Seat points (x, z, sitting height) and campfires (x, z, ring radius) from the world's fixtures. */
function fixturesOf(world: WorldState): Fixtures {
  const out: Fixtures = { seats: [], fires: [] };
  for (const e of Object.values(world.entities)) {
    if (e.kind !== 'fixture') continue;
    const d = CATALOG[e.def];
    if (e.def === 'campfire') out.fires.push([e.pose.p[0], e.pose.p[2], (d?.size[0] ?? 1) / 2]);
    const h = seatHeight(e.def);
    if (h === undefined) continue;
    const c = Math.cos(e.pose.yaw), s = Math.sin(e.pose.yaw);
    for (const sl of d?.slots ?? [])
      if (sl.kind === 'seat') out.seats.push([e.pose.p[0] + sl.local[0] * c - sl.local[1] * s, e.pose.p[2] + sl.local[0] * s + sl.local[1] * c, e.pose.p[1] + h]);
  }
  return out;
}

function nearest(list: [number, number, number][], x: number, z: number) {
  let best: [number, number, number] | undefined, bd = Infinity;
  for (const f of list) {
    const d = Math.hypot(f[0] - x, f[1] - z);
    if (d < bd) [best, bd] = [f, d];
  }
  return { f: best, d: bd };
}

/** Base activity: what the body does under an eat / serve overlay. */
const baseOf = (act: string, base?: string) => (OVERLAYS.has(act) ? (base ?? 'idle') : act);
const handList = (h: Hands): Vec3[] => [h.left, h.right].filter((q): q is Vec3 => !!q);
const copyHands = (h?: Hands): Hands => ({ ...(h?.left ? { left: [...h.left] as Vec3 } : {}), ...(h?.right ? { right: [...h.right] as Vec3 } : {}) });

export class HumanViews {
  readonly group = new THREE.Group();
  private views = new Map<string, View>();
  private templates: Template[] = [];
  private parts = new Map<string, Part>();
  private flights: Flight[] = [];
  private readingActors = new Set<string>();
  private climbs: { id: string; path: [number, number, number][] }[] = [];

  constructor() {
    this.group.name = 'engine humans';
  }

  setTemplates(ts: Template[]) {
    this.templates = ts;
  }

  /** Stair flights people may be on (the Spatial scene's usable stairs links; call when they change). */
  setStairs(links: Link[]) {
    this.flights = links.map(flightOf).filter((f): f is Flight => !!f);
    this.climbs = links.filter((l) => l.kind === 'climb').map((l) => ({ id: l.id, path: l.path as [number, number, number][] }));
  }

  /** Lab activity attention; a bounded head turn, never rotates a claimed seated body. Call once per tick. */
  setAttention(targets: Record<string, [number, number]>) {
    for (const [id, v] of this.views) {
      const q = targets[id];
      const want = q && v.cur.walkW < 0.1 ? Math.max(-0.65, Math.min(0.65, (Math.atan2(q[1] - v.cur.p[2], q[0] - v.cur.p[0]) - v.cur.yaw + Math.PI * 3) % (Math.PI * 2) - Math.PI)) : 0;
      const prior = v.gaze?.cur ?? 0;
      v.gaze = { prev: prior, cur: prior + Math.max(-0.1, Math.min(0.1, want - prior)) };
    }
  }
  attention() { return [...this.views].map(([id, v]) => ({ id, turn: v.gaze?.cur ?? 0 })); }

  /** The flights in use (tests: tread tops). */
  stairs() {
    return this.flights.map((f) => ({ id: f.id, o: f.o, dir: f.dir, going: f.going, width: f.width, yBottom: f.yBottom, yTop: f.yTop, treads: f.treads.map((t) => ({ ...t })) }));
  }

  clear() {
    for (const v of this.views.values()) {
      v.rig.mixer.stopAllAction();
      v.rig.mixer.uncacheRoot(v.rig.model);
      disposeSkeletons(v.rig.model);
    }
    this.views.clear();
    this.group.clear();
  }

  /** Create/destroy rigs to match the world and take a first snapshot. */
  reset(world: WorldState) {
    this.clear();
    this.onTick(world);
  }

  private make(id: string, s: Snap, activity: string): View {
    const rig = createRig(templateFor(id, this.templates));
    rig.holder.name = id;
    this.group.add(rig.holder);
    const arms = armsOf(rig), legs = legsOf(rig), spine = spineOf(rig);
    const touched = [...arms.flatMap((a) => [a.upper, a.lower, a.shoulder, a.hand, ...a.fingers, ...a.thumb]), ...legs.flatMap((l) => [l.upper, l.lower, l.foot]), spine?.body, spine?.hips, spine?.abdomen, spine?.torso, spine?.head];
    const saved = touched.filter((o): o is THREE.Object3D => !!o).map((o) => ({ o, p: o.position.clone(), q: o.quaternion.clone() }));
    const h = hashId(id);
    const v: View = { rig, prev: s, cur: { ...s }, speed: 0, activity, age: 0, base: activity, arms, legs, spine, seat: SEAT_DEFAULT, vary: (h % 1000) / 1000, cross: ((Math.imul(h, 2654435761) >>> 15) & 1) === 1, saved, layered: false, reachRatio: [], ankle: [], footRest: [], footLat: [], surf: { foot: new Map(), hand: new Map() } };
    measure(v);
    this.views.set(id, v);
    return v;
  }

  /** Call after every engine tick. Pure function of (previous snapshot, world). */
  onTick(world: WorldState) {
    if (!this.templates.length) return;
    this.readingActors = new Set(Object.values(world.entities).filter(e =>
      e.equipment?.kind === 'reading' && e.equipment.config.status === 'active' && e.equipment.config.phase === 'reading'
    ).map(e => String(e.equipment!.config.user)));
    let fx: Fixtures | undefined;
    for (const e of Object.values(world.entities)) {
      if (e.kind !== 'human' || !e.human || e.body?.family==='floater') continue;
      const act = e.human.activity;
      const base = baseOf(act, e.human.baseActivity);
      let v = this.views.get(e.id);
      if (!v) {
        const s: Snap = { p: [...e.pose.p], yaw: e.pose.yaw, walkW: 0, walkT: 0, idleT: (e.id.length * 0.37) % 1, sitW: base === 'sit' ? 1 : 0, warmW: act === 'warm' ? 1 : 0, pose: NEUTRAL, hands: copyHands(e.human.hands), pr: null };
        v = this.make(e.id, s, act);
        v.base = base;
        v.grip = e.human.grip?.entity;
        v.gripSlot = e.human.grip?.slot;
        v.cur.pose = v.prev.pose = this.postureGoal(v, e, world, false);
        continue;
      }
      const priorReading = v.readingGaze?.cur ?? 0;
      const wantedReading = this.readingActors.has(e.id) ? .35 : 0;
      v.readingGaze = {prev:priorReading,cur:priorReading+Math.max(-.04,Math.min(.04,wantedReading-priorReading))};
      const c = v.cur;
      // Ground speed: the engine's (walk_to publishes human.speed, W4) or the position delta.
      const inst = Math.hypot(e.pose.p[0] - c.p[0], e.pose.p[2] - c.p[2]) / DT;
      const ground = e.human.speed ?? inst;
      v.speed += (ground - v.speed) * 0.6;
      v.age = act === v.activity ? v.age + 1 : 0;
      v.activity = act;
      v.sleepPose = e.human?.sleepPose;
      v.base = base;
      v.grip = e.human.grip?.entity;
      v.gripSlot = e.human.grip?.slot;
      v.on = e.human.on;
      v.frame = frameCtx(e.human.on, act, (id) => world.entities[id], this.climbs);
      // Honest clip mapping: Walk only while the body actually moves over the ground (walk, stairs,
      // carry on the move, a crew gathering), speed-matched; a walker pushed to a stop (engine 'wait',
      // speed 0) or anyone standing plays Idle within 0.2 s, with the pose layers of render() on top.
      // sit-down / stand-up (0.6 s, engine/social) slide the body point between the seat's approach
      // point and the seat: that is the sit pose blending in/out, not walking.
      const seated = SEATED.has(base);
      const walking = !seated && ground >= WALK_EPS;
      if (seated || act === 'warm') {
        fx ??= fixturesOf(world);
        if (seated) {
          const n = nearest(fx.seats, e.pose.p[0], e.pose.p[2]);
          v.seat = n.f && n.d <= SEAT_MATCH ? n.f[2] - e.pose.p[1] : SEAT_DEFAULT;
        } else v.fire = nearest(fx.fires, e.pose.p[0], e.pose.p[2]).f;
      }
      const sitting = (base === 'sit' || base === 'sit-down') && !walking;
      const walkW = clamp01(c.walkW + (walking ? BLEND : -BLEND));
      // on a beam: short steps — the stride at half the Walk weight is about half the clip's, so the cadence doubles
      const rate = walking ? Math.max(0.35, v.speed / v.rig.template.walkSpeed) * (act === 'beam-walk' ? BEAM_CADENCE : 1) : 1;
      const dur = v.rig.walk.getClip().duration;
      v.prev = c;
      v.cur = {
        p: [...e.pose.p],
        yaw: e.pose.yaw,
        walkW,
        walkT: walkW > 0 ? (c.walkT + DT * rate) % dur : 0,
        idleT: (c.idleT + DT) % v.rig.idle.getClip().duration,
        sitW: clamp01(c.sitW + (sitting ? POSE_BLEND : -POSE_BLEND)),
        warmW: clamp01(c.warmW + (act === 'warm' && !walking ? POSE_BLEND : -POSE_BLEND)),
        // lying / getting up (prone.ts): the posture waits kneeling, so stand_with_load blends out of a kneel
        pose: PRONE_ACTS.has(act) && v.dims ? { drop: kneelDrop(v.dims), bend: 0, rise: 0, kneel: 1 } : approach(c.pose, this.postureGoal(v, e, world, walking), POSE_BLEND),
        hands: copyHands(e.human.hands),
        pr: this.proneGoal(v, e, world, c.pr, false),
      };
    }
    for (const [id, v] of this.views)
      if (!world.entities[id]) {
        v.rig.mixer.stopAllAction();
        v.rig.mixer.uncacheRoot(v.rig.model);
        disposeSkeletons(v.rig.model);
        this.group.remove(v.rig.holder);
        this.views.delete(id);
      }
    this.trackParts((id) => world.entities[id]);
  }

  /**
   * Where the body should be (posture.ts) for this tick's hand targets: the engine's published hand
   * points, else each arm's grip slot point on the gripped part (from a standing shoulder estimate).
   * Seated people and people without targets stand neutral.
   */
  private postureGoal(v: View, e: Entity, world: WorldState, walking: boolean): Posture {
    const d = v.dims;
    if (!d || SEATED.has(v.base) || v.frame?.kind === 'ladder') return NEUTRAL;
    // on a stance with a load the body turns on the rod toward it (frame-gait.ts): solve in that frame
    const turned = v.frame?.kind === 'stance' ? stanceFacing(v.frame, [e.pose.p[0], e.pose.p[2]], handList(e.human?.hands ?? {})) : null;
    const yaw = turned ?? e.pose.yaw, c = Math.cos(yaw), s = Math.sin(yaw), o = e.pose.p;
    const toBody = (x: number, y: number, z: number, side: number): Target => {
      const rx = x - o[0], rz = z - o[2], lat = -rx * s + rz * c;
      return { f: rx * c + rz * s, lat: side < 0 ? Math.min(lat, -0.01) : Math.max(lat, 0.01), up: y - o[1] };
    };
    const ts: Target[] = [];
    const hands = e.human?.hands;
    if (hands && (hands.left || hands.right)) {
      if (hands.left) ts.push(toBody(hands.left[0], hands.left[1], hands.left[2], -1));
      if (hands.right) ts.push(toBody(hands.right[0], hands.right[1], hands.right[2], 1));
    } else if (v.grip && v.gripSlot !== STATION_SLOT) {
      const part = world.entities[v.grip];
      if (part) {
        for (const side of [-1, 1]) {
          const sh = new THREE.Vector3(o[0] + c * (d.sh.f) - s * side * d.shHalf, o[1] + d.pivotH + d.sh.up, o[2] + s * d.sh.f + c * side * d.shHalf);
          const out = new THREE.Vector3();
          const r = slotPoint(part, v.gripSlot ?? '', sh, o[1], out);
          if (r === false) continue;
          if (r === undefined && !boxNearest(part, sh, out)) continue;
          ts.push(toBody(out.x, out.y, out.z, side));
        }
      }
    }
    const pz = solvePosture(d, ts, styleFor(v.activity, walking));
    // on a frame's bracing: crouch / bend on the rod, never kneel or rise onto the toes
    return v.frame?.kind === 'stance' ? { ...pz, kneel: 0, rise: 0 } : pz;
  }

  /**
   * Prone layer (prone.ts) for this tick: in a prone activity the rise coordinate from the engine's `phaseK` (exact),
   * else its phase clock (`v.age`; a take frame without phaseK has no clock, `settled`: the phase's end pose), the body
   * turn from the engine's lying heading (`proneYaw`; else searched), and the torso pitch that brings the shoulders
   * within reach of the engine's hand points; after it the last pose, fading out over 0.4 s while the posture layer
   * takes over (humans.ts pose blends the bones).
   */
  private proneGoal(v: View, e: Entity, world: WorldState, cur: ProneState | null, settled: boolean): ProneState | null {
    const d = v.dims, act = v.activity;
    if (!d) return null;
    if (e.human?.sleepPose) {
      v.proneEng = undefined;
      return sleepGoal(e.human.sleepPose, e.pose.yaw);
    }
    if (PRONE_ACTS.has(act)) {
      const k = e.human?.phaseK, turn = engineTurn(e.pose.yaw, e.human?.proneYaw);
      v.proneEng = { turn, k };
      const clock = riseOf(act, settled ? 1e6 : v.age, k), prev = settled ? null : cur;
      // getting up the body follows the engine's rise (smooth(phaseK); the fallback clock without it) but may wait for
      // the load it holds, never ahead of the engine and never back down (this rig's arms are not the engine's cylinder)
      const rising = act === PRONE_ACTIVITY.pushUp || act === PRONE_ACTIVITY.kneelUp;
      const rLo = rising && prev ? Math.min(prev.r, clock) : clock, rHi = rising && prev ? Math.min(clock, prev.r + RISE_STEP) : clock;
      const c = Math.cos(e.pose.yaw), s = Math.sin(e.pose.yaw), o = e.pose.p;
      const ts = handList(e.human?.hands ?? {}).map((q): Target => {
        const rx = q[0] - o[0], rz = q[2] - o[2];
        return { f: rx * c + rz * s, lat: -rx * s + rz * c, up: q[1] - o[1] };
      });
      // a turned body must still lie on the deck: installed sheets whose top is the level they lie on
      const decks = Object.values(world.entities).filter((q) => q.phase === 'installed' && q.def.startsWith('plywood') && Math.abs(q.pose.p[1] + (CATALOG[q.def]?.size[1] ?? 0) - o[1]) < 0.03 && !q.pose.roll && !q.pose.pitch);
      const onDeck = (f: number, lat: number) => {
        const x = o[0] + f * c - lat * s, z = o[2] + f * s + lat * c;
        return decks.some((q) => {
          const sz = CATALOG[q.def].size, dx = x - q.pose.p[0], dz = z - q.pose.p[2], qc = Math.cos(q.pose.yaw), qs = Math.sin(q.pose.yaw);
          return Math.abs(dx * qc + dz * qs) <= sz[0] / 2 + 1e-6 && Math.abs(-dx * qs + dz * qc) <= sz[2] / 2 + 1e-6;
        });
      };
      const g = solveProne(d, ts, rLo, rHi, onDeck, prev ?? undefined, turn);
      const next = approachProne(prev, { r: g.r, bend: g.bend, turn: g.turn, yaw: 0, w: 1, slide: g.slide }, POSE_BLEND, turn !== undefined);
      return { ...next, yaw: e.pose.yaw + next.turn };
    }
    v.proneEng = undefined;
    return cur && cur.w > 0 ? { ...cur, w: Math.max(0, cur.w - POSE_BLEND) } : null;
  }

  /** Keep the last two poses of every gripped part (and forget parts nobody grips). */
  private trackParts(get: (id: string) => Entity | undefined) {
    const held = new Set<string>();
    for (const v of this.views.values()) if (v.grip) held.add(v.grip);
    for (const id of this.parts.keys()) if (!held.has(id)) this.parts.delete(id);
    for (const id of held) {
      const e = get(id);
      if (!e) continue;
      const pose: Pose = { p: [...e.pose.p], yaw: e.pose.yaw, pitch: e.pose.pitch ?? 0, roll: e.pose.roll ?? 0 };
      const was = this.parts.get(id);
      this.parts.set(id, { def: e.def, prev: was?.def === e.def ? was.cur : pose, cur: pose });
    }
  }

  /**
   * Random-access pose for take replay: set every rig straight from a sampled frame (no tick
   * history, so scrubbing backwards or jumping gives the same picture as playing through; sit is
   * therefore fully in or out, at the default seat height — takes carry no fixtures; postures are
   * solved for the frame without the 0.4 s blend).
   * Rigs for ids missing from `frame` are removed. Follow with `render(1, reach)`.
   */
  setFrame(frame: SampledHuman[], t: number, parts: Record<string, Entity> = {}) {
    if (!this.templates.length) return;
    const seen = new Set<string>();
    const world = { entities: parts } as unknown as WorldState;
    for (const f of frame) {
      seen.add(f.id);
      const act = f.activity ?? 'idle';
      const base = baseOf(act, f.baseActivity);
      let v = this.views.get(f.id);
      if (!v) v = this.make(f.id, { p: [...f.p], yaw: f.yaw, walkW: 0, walkT: 0, idleT: 0, sitW: 0, warmW: 0, pose: NEUTRAL, hands: {}, pr: null }, act);
      const walkDur = v.rig.walk.getClip().duration, idleDur = v.rig.idle.getClip().duration;
      v.activity = act;
      v.sleepPose = f.sleepPose;
      v.base = base;
      v.grip = f.grip;
      v.gripSlot = f.gripSlot;
      v.on = f.on;
      v.frame = frameCtx(f.on, act, (id) => parts[id], this.climbs);
      v.seat = SEAT_DEFAULT;
      const walk = SEATED.has(base) ? 0 : f.walk;
      const e = { id: f.id, def: 'human', kind: 'human', pose: { p: f.p, yaw: f.yaw }, human: { activity: act, level: 0, hands: f.hands, proneYaw: f.proneYaw, phaseK: f.phaseK, sleepPose: f.sleepPose } } as unknown as Entity;
      const snap: Snap = {
        p: [...f.p],
        yaw: f.yaw,
        walkW: walk,
        walkT: (f.walkDist / v.rig.template.walkSpeed) % walkDur,
        idleT: (t + (f.id.length * 0.37) % 1) % idleDur,
        sitW: base === 'sit' ? 1 : SEATED.has(base) ? 0.5 : 0, // sit-down / stand-up: halfway (no timing here)
        warmW: 0, // no fire position in a take frame
        pose: this.postureGoal(v, e, world, walk > 0.5),
        hands: copyHands(f.hands),
        pr: null,
      };
      v.age = 0;
      snap.pr = this.proneGoal(v, e, world, null, true);
      v.prev = v.cur = snap;
    }
    for (const [id, v] of this.views)
      if (!seen.has(id)) {
        v.rig.mixer.stopAllAction();
        v.rig.mixer.uncacheRoot(v.rig.model);
        disposeSkeletons(v.rig.model);
        this.group.remove(v.rig.holder);
        this.views.delete(id);
      }
    this.parts.clear(); // random access: no tick history, so prev = cur
    this.trackParts((id) => parts[id]);
  }

  /**
   * Apply interpolated pose/animation. alpha ∈ [0,1] = fraction of the next tick elapsed.
   * `reach`: nearest point of a gripped part (components.ts) for grips without a known slot.
   */
  render(alpha: number, reach?: Reach) {
    for (const v of this.views.values()) this.pose(v, alpha, reach);
  }

  private pose(v: View, alpha: number, reach?: Reach) {
    const a = v.prev, b = v.cur, h = v.rig.holder;
    h.position.set(a.p[0] + (b.p[0] - a.p[0]) * alpha, a.p[1] + (b.p[1] - a.p[1]) * alpha, a.p[2] + (b.p[2] - a.p[2]) * alpha);
    let yaw = lerpAngle(a.yaw, b.yaw, alpha);
    const engineYaw = yaw;
    // prone receiver (prone.ts): the lying / rising body may be turned about S toward the hands
    const pr = lerpProne(a.pr, b.pr, alpha);
    const proneW = pr && v.dims && v.spine && v.legs.length >= 2 ? pr.w : 0;
    if (proneW > 0) yaw = lerpAngle(yaw, pr!.yaw, proneW);
    // rack structure: a climber faces the frame (the engine keeps the stance / link heading), a person on the bracing faces it
    const fp = v.frame ? framePose(v.frame, [h.position.x, h.position.y, h.position.z], yaw, handList(lerpHands(a.hands, b.hands, alpha))) : null;
    const fw = fp?.weight ?? 0;
    if (fp?.facing != null && fw > 0) yaw = lerpAngle(yaw, fp.facing, fw);
    h.rotation.y = -yaw;
    const w = (a.walkW + (b.walkW - a.walkW) * alpha) * (fp?.kind === 'beam' ? BEAM_WALK_W : 1);
    const { walk, idle, mixer } = v.rig;
    const wt = b.walkT >= a.walkT ? a.walkT + (b.walkT - a.walkT) * alpha : b.walkT;
    walk.time = wt;
    idle.time = b.idleT;
    walk.setEffectiveWeight(w);
    idle.setEffectiveWeight(1 - w);
    // The mixer only writes a bone when its clip value changed since the last apply, so undo last
    // frame's pose layers first (back to that clip value) or they would accumulate while paused.
    if (v.layered) for (const s of v.saved) { s.o.position.copy(s.p); s.o.quaternion.copy(s.q); }
    v.layered = false;
    v.diag = undefined;
    mixer.update(0);
    const sitW = a.sitW + (b.sitW - a.sitW) * alpha, warmW = a.warmW + (b.warmW - a.warmW) * alpha;
    const pz: Posture = { drop: lerp(a.pose.drop, b.pose.drop, alpha), bend: lerp(a.pose.bend, b.pose.bend, alpha), rise: lerp(a.pose.rise, b.pose.rise, alpha), kneel: lerp(a.pose.kneel, b.pose.kneel, alpha) };
    const posed = pz.drop > 1e-4 || pz.bend > 1e-4 || pz.rise > 1e-4 || pz.kneel > 1e-4;
    const hands = lerpHands(a.hands, b.hands, alpha);
    const hasHands = !!(hands.left || hands.right);
    const part = v.grip ? this.parts.get(v.grip) : undefined;
    const gripping = !hasHands && !!((reach || part) && v.grip && v.arms.length);
    const gait = sitW > 0 ? null : this.gaitOf(h.position);
    const gaze = v.gaze ? v.gaze.prev + (v.gaze.cur - v.gaze.prev) * alpha : 0;
    if (!(Math.abs(gaze) > 1e-5 || sitW > 0 || warmW > 0 || gripping || hasHands || posed || gait || fp || proneW > 0)) return;
    for (const s of v.saved) { s.p.copy(s.o.position); s.q.copy(s.o.quaternion); }
    v.layered = true;
    h.updateMatrixWorld(true);
    _fwd.set(Math.cos(yaw), 0, Math.sin(yaw)); // engine yaw 0 faces +x; holder.rotation.y = -yaw
    _right.set(-Math.sin(yaw), 0, Math.cos(yaw));
    // legs / pelvis (lying / rising: the prone body, blended into the other layers over 0.4 s as it fades out)
    let keep: { p: THREE.Vector3; q: THREE.Quaternion }[] | null = null;
    if (proneW > 0) {
      proneBody(v, pr!);
      if (proneW < 1) {
        keep = v.saved.map((s) => ({ p: s.o.position.clone(), q: s.o.quaternion.clone() }));
        for (const s of v.saved) { s.o.position.copy(s.p); s.o.quaternion.copy(s.q); }
        h.updateMatrixWorld(true);
      }
    }
    if (proneW < 1) {
      if (sitW > 0) sitPose(v, sitW, h.position.y);
      else if (gait) stairLegs(v, gait.g, gait.f, h);
      else if (fp?.feet && fw > 0) frameLegs(v, fp, pz, fw);
      else if (posed) postureLegs(v, pz);
      if (sitW <= 0 && pz.bend > 1e-4 && v.spine) bendTorso(v.spine, pz.bend);
    }
    if (keep) {
      v.saved.forEach((s, k) => (s.o.position.lerp(keep![k].p, proneW), s.o.quaternion.slerp(keep![k].q, proneW)));
      h.updateMatrixWorld(true);
      // blending a pointed foot into a planted / tucked one swings the toes down: keep the feet on the deck
      v.legs.forEach((l, i) => {
        const dip = h.position.y + 0.003 - lowestY(v.surf.foot.get(l.side));
        if (dip <= 0) return;
        const ankle = l.foot.getWorldPosition(V()), knee = l.lower.getWorldPosition(V()), hip = l.upper.getWorldPosition(V());
        legTo(l, v.ankle[i], ankle.setY(ankle.y + dip), knee.sub(hip.add(ankle).multiplyScalar(0.5)), 0.999, l.foot.getWorldQuaternion(new THREE.Quaternion()));
      });
    }
    // arms
    const targets: (THREE.Vector3 | null)[] = v.arms.map(() => null);
    let source: Source = null;
    if (hasHands) {
      source = 'hands';
      v.arms.forEach((arm, i) => {
        const q = armSide(v, i) === 'left' ? hands.left : hands.right;
        if (q) targets[i] = new THREE.Vector3(q[0], q[1], q[2]);
      });
      // A hand on the engine's mouth landmark (items/body.ts: 0.15 m ahead of the body axis at 1.58 m,
      // −0.45 seated) would cover the rig's face (its lips are ~7 cm further back and 3 cm lower): the
      // palm stops below and in front of the mouth and the spoon reaches the lips (components.ts).
      if (v.activity === 'eat') {
        const mouth = _tmp.copy(h.position).addScaledVector(_fwd, 0.15);
        mouth.y += 1.58 - (SEATED.has(v.base) ? 0.45 : 0);
        for (const t of targets) {
          if (!t) continue;
          const k = clamp01(1 - t.distanceTo(mouth) / 0.12);
          if (k > 0) t.addScaledVector(_fwd, 0.05 * k).addScaledVector(UP, -0.07 * k);
        }
      }
      // a prone receiver's hand flat on the deck (engine point on the deck top, behind the lip): the palm centre a
      // hand's half-thickness above it, so the hand lies on the deck rather than in it
      // (how flat: 1 on the deck up to 3 cm before the lip, 0 just past it / 0.25 m up — the hand turning as it comes down, and once over the edge)
      const flat = targets.map((t) => {
        if (!t || proneW <= 0) return 0;
        const f = (t.x - h.position.x) * Math.cos(engineYaw) + (t.z - h.position.z) * Math.sin(engineYaw);
        const w = clamp01((LIP + 0.02 - f) / 0.05) * clamp01(1 - (t.y - h.position.y) / 0.25);
        if (w > 0) t.y = Math.max(t.y, h.position.y + PALM_LIFT * w);
        return w * proneW;
      });
      // prone: elbows up beside the chest for a hand on the deck, forward and out (off the edge) reaching over it
      const pa: ProneArms | undefined = proneW > 0 ? { girdle: GIRDLE * proneW, pole: (arm, t) => {
        const out = V().copy(_right).multiplyScalar(-arm.side * 0.5);
        const f = (t.x - h.position.x) * Math.cos(engineYaw) + (t.z - h.position.z) * Math.sin(engineYaw);
        return f < LIP ? out.add(UP) : out.add(_fwd).addScaledVector(UP, -0.2);
      } } : undefined;
      const k = reachTo(v, targets, pz.rise > 0, BODY_MODEL.maxExtension, undefined, pa);
      v.arms.forEach((arm, i) => {
        if (!targets[i] && sitW > 0) handOnThigh(v, i, sitW);
      });
      if (sitW <= 0) dangle(v, proneW > 0 ? Math.max(pz.bend * (1 - proneW), pr!.bend * proneW) : pz.bend, k);
      v.arms.forEach((arm, i) => flat[i] > 0 && k[i] > 0 && flatHand(v, arm, targets[i]!, h.position.y, flat[i] * k[i], pa!.pole(arm, targets[i]!)));
      closeHands(v, k.map((c, i) => c * (1 - flat[i])));
    } else if (v.sleepPose && pr && v.dims && proneW > 0) {
      // Free contact expression is private to the current rig, never authoritative hands/grips.
      source = 'sleep';
      const local = sleepHands(v.dims, pr);
      v.arms.forEach((arm, i) => {
        const q = local[armSide(v, i) === 'left' ? 0 : 1];
        targets[i] = V().copy(h.position).addScaledVector(_fwd, q.f).addScaledVector(_right, q.lat).addScaledVector(UP, q.up);
      });
      const pa: ProneArms = { girdle: GIRDLE * proneW, pole: (arm) => V().copy(_right).multiplyScalar(-arm.side * 0.5).add(UP) };
      const k = reachTo(v, targets, false, BODY_MODEL.maxExtension, undefined, pa);
      v.arms.forEach((arm, i) => {
        if (targets[i] && k[i] > 0) flatHand(v, arm, targets[i]!, h.position.y, proneW * k[i], pa.pole(arm, targets[i]!));
      });
      closeHands(v, k.map(() => 0));
    } else if (gripping) {
      source = 'grip';
      const grip = v.grip!, slot = v.gripSlot ?? '', floor = h.position.y;
      const q = part && lerpPose(part.prev, part.cur, alpha);
      const find = (from: THREE.Vector3, out: THREE.Vector3) => {
        const r = part ? slotPoint({ def: part.def, pose: q! } as Entity, slot, from, floor, out) : undefined;
        return r ?? (reach ? reach(grip, from, out) : false);
      };
      v.arms.forEach((arm, i) => {
        arm.upper.getWorldPosition(_s);
        const t = V();
        if (find(_s, t)) targets[i] = t;
      });
      const k = reachTo(v, targets, pz.rise > 0, v.activity === 'carry' ? 0.88 : BODY_MODEL.maxExtension, find);
      if (sitW <= 0) dangle(v, pz.bend, k);
      closeHands(v, k);
    } else if (sitW > 0) v.arms.forEach((_, i) => handOnThigh(v, i, sitW));
    else if (fp && fw > 0 && (fp.hands[0] || fp.hands[1])) {
      // free hands on the frame (climbing: the ladder cycle's holds; on the bracing: column + brace) or held
      // out for balance on a beam — renderer-chosen, within reach by construction, reach-honest all the same
      source = 'frame';
      v.arms.forEach((_, i) => {
        const q = fp.hands[armSide(v, i) === 'left' ? 0 : 1];
        if (q) targets[i] = new THREE.Vector3(q[0], q[1], q[2]);
      });
      const k = reachTo(v, targets, false).map((c) => c * fw);
      if (fp.kind !== 'beam') closeHands(v, k);
    } else dangle(v, pz.bend, []);
    if (warmW > 0 && v.fire && !gripping && !hasHands) warmHands(v, warmW, h.position);
    if (v.sleepPose && pr && v.spine?.head) {
      turn(v.spine.head, _right, sleepHeadPitch(pr));
      h.updateMatrixWorld(true);
    }
    // A bounded book gaze uses the existing rig adapter only; seat/body authority is unchanged.
    if (v.spine?.head && v.readingGaze && sitW > .9) {
      const head=v.spine.head;
      const axis=_right.clone().applyQuaternion(head.parent!.getWorldQuaternion(new THREE.Quaternion()).invert());
      head.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis,-(v.readingGaze.prev+(v.readingGaze.cur-v.readingGaze.prev)*alpha)));
    }
    if (v.spine?.head && Math.abs(gaze) > 1e-5) {
      const head = v.spine.head;
      const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(head.parent!.getWorldQuaternion(new THREE.Quaternion()).invert());
      head.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, -gaze));
      h.updateMatrixWorld(true);
    }
    v.diag = diagOf(v, gait?.g ?? null, gait?.f.id ?? '', pz, targets, source, fp, proneW > 0 ? pr : null);
  }

  private gaitOf(p: THREE.Vector3): { g: Gait; f: Flight } | null {
    for (const f of this.flights) {
      const g = gaitAt(f, p.x, p.z, p.y);
      if (g && g.weight > 0) return { g, f };
    }
    return null;
  }

  /** Rendered palm centre of a person's hand after the last render (items in hand attach here). */
  palmOf(id: string, hand: 'left' | 'right', out: THREE.Vector3): boolean {
    const v = this.views.get(id);
    if (!v) return false;
    const i = v.arms.findIndex((_, k) => armSide(v, k) === hand);
    if (i < 0) return false;
    palm(v.arms[i], out);
    return true;
  }

  /** Rendered yaw (engine convention) and mouth point (≈ lips) of a person after the last render. */
  headOf(id: string, out: THREE.Vector3): number | null {
    const v = this.views.get(id);
    if (!v?.spine?.head) return null;
    v.spine.head.getWorldPosition(out);
    const yaw = -v.rig.holder.rotation.y;
    out.x += Math.cos(yaw) * 0.09;
    out.z += Math.sin(yaw) * 0.09;
    out.y += 0.02;
    return yaw;
  }

  /** Per-person pose readout of the last render (lab hook `bones()`). */
  bones(id?: string) {
    const out: Record<string, Diag & { activity: string; base: string; ankleH: number; armLen: number; walkW: number; template: string; body: Record<string, number>; armFit: { k: number; before: number }[]; on: string | null; goal: Posture; dims: Dims | null }> = {};
    for (const [k, v] of this.views) {
      if (id && k !== id) continue;
      if (!v.diag) {
        v.rig.holder.updateMatrixWorld(true);
        v.diag = diagOf(v, null, '', NEUTRAL, v.arms.map(() => null), null, null);
      }
      const d = v.dims, r4 = (x: number) => +x.toFixed(4);
      // standing rig measurements (Idle, t = 0): the body model's numbers as this rig has them
      const body = d ? { shoulderH: r4(d.pivotH + d.sh.up), armLen: r4(d.armLen), hipH: r4(d.hipH), thigh: r4(d.thigh), shin: r4(d.shin), kneelHip: r4(d.hipH - kneelDrop(d)), shoulderHalf: r4(d.shHalf) } : ({} as Record<string, number>);
      out[k] = { ...v.diag, activity: v.activity, base: v.base, ankleH: r4(d?.ankleH ?? 0), armLen: r4(d?.armLen ?? 0), walkW: +v.cur.walkW.toFixed(3), template: v.rig.template.name, body, armFit: v.rig.template.arms, on: v.on ?? null, goal: v.cur.pose, dims: d ?? null };
    }
    return out;
  }

  /** Rendered body surface after the last render: every `stride`-th skinned vertex (world) with its body part (e2e). */
  meshPoints(id: string, stride = 3) {
    const v = this.views.get(id);
    const out: { p: [number, number, number]; part: BodyPart }[] = [];
    if (v) skinnedPoints(v.rig, stride, (q, part) => out.push({ p: [+q.x.toFixed(4), +q.y.toFixed(4), +q.z.toFixed(4)], part }));
    return out;
  }

  /** Interpolated world positions (for labels/discs) keyed by actor id. */
  positions() {
    return new Map([...this.views].map(([id, v]) => [id, v.rig.holder.position]));
  }

  info() {
    return [...this.views].map(([id, v]) => ({ id, template: v.rig.template.name, clipSpeed: +v.rig.template.walkSpeed.toFixed(3), forward: v.rig.template.forward, speed: +v.speed.toFixed(3), walkWeight: +v.cur.walkW.toFixed(2), activity: v.activity, base: v.base, grip: v.grip ?? null, gripSlot: v.gripSlot ?? null, reach: v.grip || v.cur.hands.left || v.cur.hands.right ? v.reachRatio : null, armLen: v.arms[0] ? +armLen(v.arms[0]).toFixed(3) : null, arms: v.arms.length, sit: +v.cur.sitW.toFixed(2), seat: v.cur.sitW > 0 ? +v.seat.toFixed(2) : null, crossed: v.cross, pose: { drop: +v.cur.pose.drop.toFixed(3), bend: +v.cur.pose.bend.toFixed(3), rise: +v.cur.pose.rise.toFixed(3), kneel: +v.cur.pose.kneel.toFixed(3) } }));
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function lerpHands(a: Hands, b: Hands, t: number): Hands {
  const one = (p?: Vec3, q?: Vec3): Vec3 | undefined => (q ? (p ? [lerp(p[0], q[0], t), lerp(p[1], q[1], t), lerp(p[2], q[2], t)] : q) : undefined);
  return { left: one(a.left, b.left), right: one(a.right, b.right) };
}

const V = () => new THREE.Vector3();
const _s = V(), _fwd = V(), _right = V(), _ax = V(), _hip = V(), _knee = V(), _tmp = V(), _c = V();
const _goals: THREE.Vector3[] = [V(), V()];
const _qh = new THREE.Quaternion(), _qf = new THREE.Quaternion(), _qt = new THREE.Quaternion();

/** 'left' / 'right' for arm i, from where its shoulder sits (measured, not from bone names). */
function armSide(v: View, i: number): 'left' | 'right' {
  return v.arms[i].side > 0 ? 'left' : 'right';
}

/**
 * Rig measurements in the person's frame from the Idle clip at t = 0, holder at the origin facing
 * +x (right = +z): hip / pivot / ankle heights, leg and arm lengths, shoulder position, ankle in the
 * shin frame, rest foot rotation. Arms / legs are re-labelled left / right from where they are.
 */
function measure(v: View) {
  const { rig, legs, arms, spine } = v;
  if (legs.length < 2 || !arms.length || !spine) return;
  const h = rig.holder;
  const p0 = h.position.clone(), r0 = h.rotation.y;
  h.position.set(0, 0, 0);
  h.rotation.y = 0;
  rig.walk.setEffectiveWeight(0);
  rig.idle.setEffectiveWeight(1);
  rig.idle.time = 0;
  rig.mixer.update(0);
  h.updateMatrixWorld(true);
  const w = (o: THREE.Object3D) => o.getWorldPosition(V());
  const hips = legs.map((l) => w(l.upper)), knees = legs.map((l) => w(l.lower)), feet = legs.map((l) => w(l.foot));
  for (const [i, l] of legs.entries()) l.side = feet[i].z > 0 ? -1 : 1; // + = left (right is +z here)
  for (const a of arms) a.side = w(a.upper).z > 0 ? -1 : 1;
  const hipH = (hips[0].y + hips[1].y) / 2;
  const ankleH = (feet[0].y + feet[1].y) / 2;
  const thigh = (hips[0].distanceTo(knees[0]) + hips[1].distanceTo(knees[1])) / 2, shin = (knees[0].distanceTo(feet[0]) + knees[1].distanceTo(feet[1])) / 2;
  const legLen = thigh + shin;
  const pivot = w(spine.hips ?? spine.body);
  const sh = arms.map((a) => w(a.upper));
  const shMid = sh.reduce((s, q) => s.add(q), V()).multiplyScalar(1 / sh.length);
  const joints = [pivot, w(spine.abdomen), w(spine.torso), shMid];
  const hipMid = hips[0].clone().add(hips[1]).multiplyScalar(0.5);
  const front = frontDepths(rig, hipMid.x, shMid.x, shMid.y, feet[legs[0].side > 0 ? 0 : 1], legs.flatMap((_, i) => [[hips[i], knees[i]], [knees[i], feet[i]]] as [THREE.Vector3, THREE.Vector3][]));
  v.dims = {
    hipH,
    pivotH: pivot.y,
    ankleH,
    legLen,
    thigh,
    shin,
    sh: { f: shMid.x - pivot.x, up: shMid.y - pivot.y },
    chain: joints.slice(1).map((q, i) => ({ f: q.x - joints[i].x, up: q.y - joints[i].y })),
    shHalf: sh.length > 1 ? Math.abs(sh[0].z - sh[1].z) / 2 : 0.19,
    armLen: armLen(arms[0]),
    pivotF: pivot.x - hipMid.x,
    pivotUp: pivot.y - hipH,
    lieHip: front.body,
    chestDepth: front.chest,
    foot: front.foot,
  };
  v.ankle = legs.map((l) => ankleLocal(l));
  v.footRest = legs.map((l) => l.foot.getWorldQuaternion(new THREE.Quaternion()));
  v.footLat = feet.map((f) => f.z);
  v.surf = surfaceRefs(rig);
  h.position.copy(p0);
  h.rotation.y = r0;
  h.updateMatrixWorld(true);
}

/** Body part of a skinned vertex, by the bone that weighs most on it (rig bone names, rig.ts). */
export type BodyPart = 'torso' | 'head' | 'arm' | 'hand' | 'leg' | 'foot';
function partOf(bone: string): BodyPart {
  if (/^(Wrist|Thumb|Index|Middle|Ring|Pinky)/.test(bone)) return 'hand';
  if (/^(Shoulder|UpperArm|LowerArm)/.test(bone)) return 'arm';
  if (/^(Neck|Head)/.test(bone)) return 'head';
  if (/^(UpperLeg|LowerLeg)/.test(bone)) return 'leg';
  if (/^(Foot|Toe)/.test(bone)) return 'foot';
  return 'torso';
}

/** Skinned vertices of a rig in world space (every `stride`-th), each with its body part. */
function skinnedPoints(rig: Rig, stride: number, out: (p: THREE.Vector3, part: BodyPart) => void) {
  rig.holder.updateMatrixWorld(true);
  const p = V(), idx = new THREE.Vector4(), wt = new THREE.Vector4();
  rig.model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !m.geometry.attributes.skinIndex) return;
    const pos = m.geometry.attributes.position, si = m.geometry.attributes.skinIndex as THREE.BufferAttribute, sw = m.geometry.attributes.skinWeight as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i += stride) {
      m.getVertexPosition(i, p).applyMatrix4(m.matrixWorld);
      idx.fromBufferAttribute(si, i);
      wt.fromBufferAttribute(sw, i);
      let k = 0;
      for (let j = 1; j < 4; j++) if (wt.getComponent(j) > wt.getComponent(k)) k = j;
      out(p, partOf(m.skeleton.bones[idx.getComponent(k)]?.name ?? ''));
    }
  });
}

/** Skinned vertices of a mesh (indices). */
type VertexRefs = { mesh: THREE.SkinnedMesh; idx: number[] }[];

/** Foot and hand vertices of a rig, per side (+1 = the person's left: z < 0 with the holder at the origin facing +x). */
function surfaceRefs(rig: Rig) {
  const out = { foot: new Map<number, VertexRefs>(), hand: new Map<number, VertexRefs>() };
  const p = V(), idx = new THREE.Vector4(), wt = new THREE.Vector4();
  rig.holder.updateMatrixWorld(true);
  rig.model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !m.geometry.attributes.skinIndex) return;
    const pos = m.geometry.attributes.position, si = m.geometry.attributes.skinIndex as THREE.BufferAttribute, sw = m.geometry.attributes.skinWeight as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      idx.fromBufferAttribute(si, i);
      wt.fromBufferAttribute(sw, i);
      let k = 0;
      for (let j = 1; j < 4; j++) if (wt.getComponent(j) > wt.getComponent(k)) k = j;
      const part = partOf(m.skeleton.bones[idx.getComponent(k)]?.name ?? '');
      if (part !== 'foot' && part !== 'hand') continue;
      m.getVertexPosition(i, p).applyMatrix4(m.matrixWorld);
      const side = p.z < 0 ? 1 : -1, map = out[part];
      const refs = map.get(side) ?? [];
      let r = refs.find((q) => q.mesh === m);
      if (!r) refs.push((r = { mesh: m, idx: [] }));
      r.idx.push(i);
      map.set(side, refs);
    }
  });
  return out;
}

/** Lowest point (world y) of these vertices as rendered now (bone world matrices up to date). */
function lowestY(refs: VertexRefs | undefined) {
  let low = Infinity;
  for (const r of refs ?? []) for (const i of r.idx) low = Math.min(low, r.mesh.getVertexPosition(i, _vp).applyMatrix4(r.mesh.matrixWorld).y);
  return low;
}
const _vp = new THREE.Vector3();

/**
 * Front depths of the body in the Idle pose (holder at the origin facing +x): `body` = how far the front of the
 * torso is ahead of the hip joints, or a leg's surface (above the shoes) from its bones, whichever is more (lying on
 * the stomach with the pelvis pitched 90° and the legs straight, the hip joints are this high above the floor);
 * `chest` = how far the front of the chest (torso vertices within 0.25 m below the shoulders) is ahead of the shoulder
 * joints (lying flat, the shoulder joints this high); `foot` = a sample of the foot's surface about its ankle.
 */
function frontDepths(rig: Rig, hipX: number, shX: number, shY: number, ankle: THREE.Vector3, legBones: [THREE.Vector3, THREE.Vector3][]) {
  const seg = new THREE.Line3(), q = V();
  let body = 0, chest = 0;
  const foot: [number, number][] = [];
  skinnedPoints(rig, 1, (p, part) => {
    if (part === 'foot' && p.z * ankle.z > 0) foot.push([+(p.x - ankle.x).toFixed(4), +(p.y - ankle.y).toFixed(4)]);
    if (part === 'torso') body = Math.max(body, p.x - hipX);
    // a leg lies straight: its front is its radius about the bone (the Idle clip stands with a knee forward)
    if (part === 'leg' && p.y > 0.2) body = Math.max(body, Math.min(...legBones.map(([a, b]) => seg.set(a, b).closestPointToPoint(p, true, q).distanceTo(p))));
    if (part === 'torso' && p.y < shY + 0.02 && p.y > shY - 0.25) chest = Math.max(chest, p.x - shX);
  });
  return { body: body + 0.005, chest, foot: foot.filter((_, i) => i % 3 === 0) };
}

/** Bend the upper body forward by `bend` rad at the hips (60 %), abdomen (20 %) and torso (20 %). */
function bendTorso(sp: Spine, bend: number) {
  _ax.crossVectors(UP, _fwd).normalize(); // rotating up about up×fwd tips it forward
  const [a, b, c] = BEND_SHARE;
  if (sp.hips) turn(sp.hips, _ax, bend * a);
  turn(sp.abdomen, _ax, bend * (sp.hips ? b - a : b));
  turn(sp.torso, _ax, bend * (c - b));
}

/**
 * Posture legs: pelvis down by `drop` (and back to balance a standing hip bend, up by `rise`), feet stay
 * planted (leg IK, knees forward). Kneeling (`kneel` → 1): one knee on the floor straight under its hip
 * joint (the pelvis is at kneelDrop), that shin back along the floor with the toes tucked; the other
 * foot planted out to its side (KNEEL_SIDE) with that knee up — so a person kneeling on a beam keeps
 * both on the beam line. Which knee goes down is fixed per person (id hash).
 */
function postureLegs(v: View, pz: Posture) {
  const d = v.dims;
  if (!d || !v.spine || v.legs.length < 2) return;
  const feet = v.legs.map((l, i) => l.foot.getWorldPosition(_goals[i]).clone());
  const floor = v.rig.holder.position.y;
  // heel raise: ankles up by `rise` (toes stay down)
  const back = shoulderAt(d, pz).back;
  v.spine.body.getWorldPosition(_c);
  _c.addScaledVector(_fwd, -back);
  _c.y += pz.rise - pz.drop;
  place(v.spine.body, _c.clone());
  const pole = _tmp.copy(_fwd).addScaledVector(UP, 0.2).clone();
  const kn = smooth(pz.kneel), down = v.vary < 0.5 ? -1 : 1; // side of the kneeling leg (+1 = left)
  const centre = v.rig.holder.position;
  v.legs.forEach((l, i) => {
    const goal = feet[i];
    goal.y += pz.rise;
    let kp = pole.clone().addScaledVector(_right, -l.side * 0.25); // knees a little apart in a squat
    let q = pz.rise > 0 ? footPitch(v, i, -Math.asin(Math.min(0.9, pz.rise / 0.13))) : undefined;
    if (kn > 0) {
      l.upper.getWorldPosition(_hip);
      if (l.side === down) {
        // knee on the floor under the hip joint, a little forward; shin back along the floor, toes tucked
        const kf = 0.05, kneeY = _hip.y - Math.sqrt(Math.max(0, d.thigh * d.thigh - kf * kf));
        const ankleY = floor + 0.11, dy = kneeY - ankleY;
        const run = Math.sqrt(Math.max(0, d.shin * d.shin - dy * dy));
        const ankle = V().copy(_hip).addScaledVector(_fwd, kf - run);
        ankle.y = ankleY;
        goal.lerp(ankle, kn);
        kp = kp.lerp(V().copy(_fwd).addScaledVector(UP, -0.3), kn);
        q = footPitch(v, i, -1.1 * kn);
      } else {
        // up-knee: foot planted out to its side, a little forward; the knee points forward and out
        const spot = V().copy(centre).addScaledVector(_right, -l.side * KNEEL_SIDE).addScaledVector(_fwd, 0.12);
        spot.y = floor + d.ankleH;
        goal.lerp(spot, kn);
        kp = kp.lerp(V().copy(_fwd).addScaledVector(UP, 0.4).addScaledVector(_right, -l.side * 0.6), kn);
      }
    }
    legTo(l, v.ankle[i], goal, kp, 0.999, q);
  });
}

/** Foot pitch (rad about the right axis, − = toes down): pointed, the top of the foot on the deck — lying, and kneeling up from it. */
const LIE_FOOT = -2.6;
/** Ankle height that puts the lowest point of the foot, pitched by `pitch`, on the floor (the measured foot surface). */
function ankleFor(d: Dims, pitch: number) {
  const s = Math.sin(pitch), c = Math.cos(pitch);
  let low = 0;
  for (const [f, up] of d.foot) low = Math.min(low, f * s + up * c);
  return 0.003 - low;
}

/**
 * Prone body (prone.ts; the holder is at S, yawed to the prone yaw): pelvis pitched forward by the frame's pitch with
 * the hip joints on their point (lying on the deck / over the knees / standing), the spine bent to the torso pitch
 * (lying: the tip all at the Torso joint, just past the lip), legs by IK — knees on the deck, shins back along it,
 * feet pointed lying → toes tucked kneeling, then the clip's feet standing — along r.
 */
function proneBody(v: View, pr: ProneState) {
  const d = v.dims!, sp = v.spine!, h = v.rig.holder, floor = h.position.y;
  const fr = proneFrame(d, pr.r, pr.bend, lipAlong(d, pr.turn), pr.slide);
  const clipFeet = v.legs.map((l) => l.foot.getWorldPosition(V()));
  _ax.crossVectors(UP, _fwd).normalize(); // turning about up×fwd tips the body forward
  if (fr.pitch) turn(sp.body, _ax, fr.pitch);
  const hipMid = v.legs.reduce((s, l) => s.add(l.upper.getWorldPosition(_hip)), V()).multiplyScalar(1 / v.legs.length);
  const goal = h.position.clone().addScaledVector(_fwd, fr.hip.f);
  goal.y = floor + fr.hip.up;
  place(sp.body, sp.body.getWorldPosition(_c).add(goal).sub(hipMid));
  const b = pr.bend - fr.pitch, [s0, s1, s2] = fr.share;
  if (sp.hips) turn(sp.hips, _ax, b * s0);
  turn(sp.abdomen, _ax, b * (sp.hips ? s1 - s0 : s1));
  turn(sp.torso, _ax, b * (s2 - s1));
  // legs: from lying to kneeling each knee rests on the deck (KNEE_Y) a thigh from its hip joint, the shin back along
  // the deck to an ankle as high as the pointed foot needs (its measured surface on the deck: the instep, lying and
  // kneeling); standing up (r > 2) the kneeling legs blend into the clip's, the foot turning up as it leaves the deck
  const pitch = LIE_FOOT;
  const ankleY = ankleFor(d, pitch), run = Math.sqrt(Math.max(0, d.shin * d.shin - (ankleY - KNEE_Y) ** 2));
  v.legs.forEach((l, i) => {
    const H = l.upper.getWorldPosition(V());
    const K = H.clone().addScaledVector(_fwd, -Math.sqrt(Math.max(0, d.thigh * d.thigh - (H.y - floor - KNEE_Y) ** 2)));
    K.y = floor + KNEE_Y;
    let ankle = K.clone().addScaledVector(_fwd, -run).setY(floor + ankleY);
    let pole = K.clone().sub(H.clone().add(ankle).multiplyScalar(0.5)).addScaledVector(UP, -0.05);
    let q = pitch;
    if (pr.r > 2) {
      const k = smooth(pr.r - 2);
      ankle = ankle.lerp(clipFeet[i], k);
      pole = pole.normalize().lerp(V().copy(_fwd).addScaledVector(UP, 0.2), k);
      q = LIE_FOOT * (1 - k);
      ankle.y = Math.max(ankle.y, floor + ankleFor(d, q));
    }
    const fq = footPitch(v, i, q);
    legTo(l, v.ankle[i], ankle, pole, 0.999, fq);
    // the foot as rendered: lift the ankle by whatever of it dips below the deck (its surface, measured)
    const dip = floor + 0.003 - lowestY(v.surf.foot.get(l.side));
    if (dip > 0) legTo(l, v.ankle[i], ankle.setY(ankle.y + dip), pole, 0.999, fq);
  });
}

/**
 * A hand lying flat on the deck (by `w`): the wrist turned palm down, fingers forward and a little out (the rig's own
 * palm and finger-curl axes), the palm centre back on the point (the arm IK again after the wrist turns), then lifted
 * by whatever of the hand as rendered still dips below the deck.
 */
function flatHand(v: View, arm: Arm, t: THREE.Vector3, floor: number, w: number, pole: THREE.Vector3) {
  if (!arm.curlAxis) return;
  const fl = V().copy(arm.palmLocal).normalize(), nl = V().crossVectors(arm.curlAxis, fl).normalize(), bl = V().crossVectors(fl, nl);
  const F = V().copy(_fwd).addScaledVector(_right, -arm.side * 0.35).normalize(), N = V().set(0, -1, 0), B = V().crossVectors(F, N);
  const flatQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(F, N, B).multiply(new THREE.Matrix4().makeBasis(fl, nl, bl).transpose()));
  const lay = () => setWorldQuat(arm.hand, arm.hand.getWorldQuaternion(new THREE.Quaternion()).slerp(flatQ, w));
  for (let it = 0; it < 2; it++) {
    lay();
    armTo(arm, t, 1, BODY_MODEL.maxExtension, v.rig.holder, pole);
  }
  lay();
  const dip = floor + 0.002 - lowestY(v.surf.hand.get(arm.side));
  if (dip > 0) {
    armTo(arm, t.setY(t.y + dip), 1, BODY_MODEL.maxExtension, v.rig.holder, pole);
    lay();
  }
}

/** Closed hand on every arm that holds something (contact from 0.3, fully closed by 0.8). */
function closeHands(v: View, contacts: number[]) {
  v.arms.forEach((arm, i) => curlHand(arm, smooth(((contacts[i] ?? 0) - 0.3) / 0.5)));
}

/** World foot rotation = rest (relative to the holder) pitched by `pitch` rad about the person's right axis (− = toes down). */
function footPitch(v: View, i: number, pitch: number) {
  v.rig.holder.getWorldQuaternion(_qh);
  _qf.copy(_qh).multiply(v.footRest[i]);
  if (pitch) _qf.premultiply(_qt.setFromAxisAngle(_right, pitch));
  return _qf.clone();
}

/**
 * Stairs: plant each foot on its tread (stair-gait.ts), lower the pelvis just enough that no leg has
 * to over-extend (it rises riser by riser with the body point), knees forward, feet flat except the
 * trailing heel lifting before toe-off. Blended with the clip's legs by the gait weight at the ends.
 */
function stairLegs(v: View, g: Gait, f: Flight, holder: THREE.Object3D) {
  const d = v.dims;
  if (!d || !v.spine || v.legs.length < 2) return;
  const w = g.weight;
  const goals: THREE.Vector3[] = [];
  const pitches: number[] = [];
  v.legs.forEach((l, i) => {
    const { foot, point: [x, z], facing } = stairFootTarget(f, g, l.side > 0 ? 'left' : 'right', v.footLat[i], -holder.rotation.y);
    const clip = l.foot.getWorldPosition(V());
    // toe-off: the trailing heel comes up over the last half-step of the stance, in the travel direction
    let heel = 0;
    if (foot.planted) {
      const behind = (g.u - foot.k) * facing; // how far the body has passed this foot (spots)
      heel = HEEL * smooth((behind - (facing > 0 ? 0 : 0.2)) / 0.5);
    }
    pitches.push(heel > 0 ? -Math.asin(Math.min(0.9, heel / 0.13)) : 0);
    goals.push(clip.lerp(new THREE.Vector3(x, foot.y + d.ankleH + heel, z), w));
  });
  // pelvis: as the clip has it, lowered until both legs reach their feet at 0.97 of their length
  const hipY = (v.legs[0].upper.getWorldPosition(_hip).y + v.legs[1].upper.getWorldPosition(_knee).y) / 2;
  let target = hipY;
  v.legs.forEach((l, i) => {
    l.upper.getWorldPosition(_hip);
    const dh = Math.hypot(goals[i].x - _hip.x, goals[i].z - _hip.z);
    const reach = 0.97 * d.legLen;
    target = Math.min(target, goals[i].y + Math.sqrt(Math.max(0, reach * reach - dh * dh)));
  });
  v.spine.body.getWorldPosition(_c);
  _c.y += (target - hipY) * w;
  place(v.spine.body, _c.clone());
  const pole = _tmp.copy(_fwd).addScaledVector(UP, 0.1).clone();
  v.legs.forEach((l, i) => legTo(l, v.ankle[i], goals[i], pole, 0.999, w > 0.5 ? footPitch(v, i, pitches[i]) : undefined));
}

/**
 * Rack structure (frame-gait.ts): each foot to its sole point (a rung of the ladder cycle, or the bracing
 * node of a stance), the pelvis over the body point, lowered by the posture's drop (a crouch on the rod)
 * and further until both legs reach their feet at 0.97 of their length; knees forward and up.
 * `w` blends it with the clip's legs (the first 0.2 m of a climb).
 */
function frameLegs(v: View, fp: FramePose, pz: Posture, w: number) {
  const d = v.dims;
  if (!d || !v.spine || v.legs.length < 2 || !fp.feet) return;
  const goals = v.legs.map((l) => {
    const f = fp.feet![l.side > 0 ? 0 : 1];
    return l.foot.getWorldPosition(V()).lerp(new THREE.Vector3(f.p[0], f.p[1] + d.ankleH, f.p[2]), w);
  });
  const hipY = (v.legs[0].upper.getWorldPosition(_hip).y + v.legs[1].upper.getWorldPosition(_knee).y) / 2;
  let target = hipY - pz.drop;
  v.legs.forEach((l, i) => {
    l.upper.getWorldPosition(_hip);
    const dh = Math.hypot(goals[i].x - _hip.x, goals[i].z - _hip.z);
    const reach = 0.97 * d.legLen;
    target = Math.min(target, goals[i].y + Math.sqrt(Math.max(0, reach * reach - dh * dh)));
  });
  v.spine.body.getWorldPosition(_c);
  _c.y += (target - hipY) * w;
  place(v.spine.body, _c.clone());
  const pole = _tmp.copy(_fwd).addScaledVector(UP, 0.35).clone();
  v.legs.forEach((l, i) => legTo(l, v.ankle[i], goals[i], pole.clone().addScaledVector(_right, -l.side * 0.15), 0.999));
}

/**
 * Seated: lower the body so the hip joints sit PELVIS above the seat, then leg IK — thighs forward,
 * feet on the ground under the knees (the Foot bones are moved to the shin ends). Weight blends the
 * whole thing in/out (a crouch-down on the way). `cross`: one leg crossed over the other knee.
 */
function sitPose(v: View, w: number, ground: number) {
  if (!v.spine || v.legs.length < 2) return;
  const legs = v.legs;
  // leg geometry from the clip pose, before anything moves
  const ends = legs.map((l, i) => l.foot.getWorldPosition(_goals[i]).clone());
  const lens = legs.map((l) => {
    l.upper.getWorldPosition(_hip);
    l.lower.getWorldPosition(_knee);
    return _hip.distanceTo(_knee);
  });
  const hipY = legs.reduce((s, l) => s + l.upper.getWorldPosition(_hip).y, 0) / legs.length;
  const drop = Math.max(0, hipY - (ground + v.seat + PELVIS)) * w;
  v.spine.body.getWorldPosition(_c);
  _c.y -= drop;
  place(v.spine.body, _c.clone());
  const pole = _tmp.copy(_fwd).addScaledVector(UP, 0.3).clone(); // knees forward
  // crossing leg (right when `cross`): its ankle rests beside the other shin, knee over the other knee
  const crossW = v.cross ? smooth((w - 0.6) / 0.4) : 0;
  const order = [...legs.keys()].sort((i, j) => legs[j].side - legs[i].side); // left (the support leg) first
  for (const i of order) {
    const l = legs[i];
    const foot0 = ends[i];
    l.upper.getWorldPosition(_hip);
    // sitting target: under the knee of a horizontal thigh, at the clip's ankle height
    const sitGoal = V().copy(_hip).addScaledVector(_fwd, lens[i] * 0.95);
    sitGoal.y = foot0.y;
    const goal = foot0.clone().lerp(sitGoal, w);
    let kp = pole;
    if (crossW > 0 && l.side < 0) {
      // over the support knee: ankle beside the support shin, a little up and across
      const sup = legs.find((m) => m.side > 0)!;
      const sk = sup.lower.getWorldPosition(V());
      const cross = sk.clone().addScaledVector(UP, -0.18).addScaledVector(_fwd, 0.12).addScaledVector(_right, -0.06);
      goal.lerp(cross, crossW);
      kp = pole.clone().addScaledVector(UP, 1.2 * crossW).addScaledVector(_right, -0.6 * crossW);
    }
    legTo(l, v.ankle[i], goal, kp, 0.995);
  }
}

/** Seated hand resting on its thigh (arm i). */
function handOnThigh(v: View, i: number, w: number) {
  const leg = v.legs.find((l) => l.side === v.arms[i].side) ?? v.legs[i];
  if (!leg) return;
  leg.upper.getWorldPosition(_hip);
  leg.lower.getWorldPosition(_knee);
  const goal = _hip.clone().lerp(_knee, 0.6).addScaledVector(UP, 0.1);
  armTo(v.arms[i], goal, w * 0.9, 0.97, v.rig.holder);
}

/**
 * Arms onto their targets (world points; null = that arm free), reach-honest: contact weight by
 * shoulder distance (full within 1.02 arm lengths, none beyond 1.25); a small shoulder shrug toward
 * the target height (up to 5 cm when reaching overhead). `refind` recomputes a grip point from the
 * shrugged shoulder (nearest-point grips).
 */
type ProneArms = { girdle: number; pole: (arm: Arm, t: THREE.Vector3) => THREE.Vector3 };
function reachTo(v: View, targets: (THREE.Vector3 | null)[], overhead: boolean, maxExt: number = BODY_MODEL.maxExtension, refind?: (from: THREE.Vector3, out: THREE.Vector3) => boolean, prone?: ProneArms) {
  v.reachRatio = v.arms.map(() => null);
  const contacts = v.arms.map(() => 0);
  v.arms.forEach((arm, i) => {
    const t = targets[i];
    if (!t) return;
    const len = armLen(arm);
    arm.upper.getWorldPosition(_s);
    let k = contact(_s.distanceTo(t), len);
    v.reachRatio[i] = +(_s.distanceTo(t) / len).toFixed(2);
    if (k <= 0) return;
    if (arm.shoulder) {
      // shrug: up to BODY_MODEL.shrug when the hand goes ≥ 0.5 m above the shoulder (or heels are up), 2.5 cm down
      // (weighted by the contact the shrugged shoulder would have: the shrug is what brings the top of the reach in)
      const up = t.y - _s.y;
      const full = up >= 0 ? BODY_MODEL.shrug * (overhead ? 1 : clamp01(up / 0.5)) : -0.025 * clamp01(-up / 0.4);
      const dy = full * contact(_tmp.copy(_s).addScaledVector(UP, full).distanceTo(t), len);
      // turn the clavicle until the shoulder joint has risen by dy (a swing toward a raised point only
      // gets part of the way: the joint moves on a circle about the clavicle's root)
      const y0 = _s.y + dy;
      for (let it = 0; it < 6 && Math.abs(y0 - _s.y) > 0.001; it++) {
        swing(arm.shoulder, _s.clone(), _s.clone().addScaledVector(UP, 1.5 * (y0 - _s.y)), 1);
        arm.upper.getWorldPosition(_s);
      }
      // the circle tops out after ~3 cm: the rest is the shoulder girdle elevating (the clavicle root moves up)
      if (Math.abs(y0 - _s.y) > 0.001) {
        place(arm.shoulder, arm.shoulder.getWorldPosition(V()).addScaledVector(UP, y0 - _s.y));
        arm.upper.getWorldPosition(_s);
      }
      arm.upper.getWorldPosition(_s);
      // lying prone: the shoulder girdle reaches toward the hand (protraction), only as far as the arm falls short
      if (prone) {
        const short = Math.min(prone.girdle, _s.distanceTo(t) - maxExt * len);
        if (short > 0) {
          place(arm.shoulder, arm.shoulder.getWorldPosition(V()).addScaledVector(_tmp.subVectors(t, _s).normalize(), short));
          arm.upper.getWorldPosition(_s);
        }
      }
      if (refind) refind(_s, t);
      k = contact(_s.distanceTo(t), len);
    }
    contacts[i] = k;
    armTo(arm, t, k, maxExt, v.rig.holder, prone?.pole(arm, t));
  });
  return contacts;
}

/**
 * On a bent body a free arm (no target, or its target out of reach) hangs with gravity — straight
 * down from the shoulder, a little forward — instead of keeping the clip's arm pose, which would
 * point backwards on a torso pitched 80°. Only arms with no contact at all, from ~30° of bend.
 */
function dangle(v: View, bend: number, contacts: number[]) {
  const b = smooth((bend - 0.5) / 0.6); // from ~30° of bend, fully by ~63°
  if (b <= 0) return;
  v.arms.forEach((arm, i) => {
    if ((contacts[i] ?? 0) > 0) return; // touching (even partly): the reach IK owns the arm
    const w = b;
    const len = armLen(arm);
    arm.upper.getWorldPosition(_s);
    const goal = _s.clone().addScaledVector(UP, -0.9 * len).addScaledVector(_fwd, 0.08 * len);
    armTo(arm, goal, w, 0.95, v.rig.holder, _tmp.copy(_fwd).multiplyScalar(-0.3).addScaledVector(UP, -0.2).clone());
  });
}

/** Warming: hands held out, a little down, toward the fire when its edge is within WARM_REACH. */
function warmHands(v: View, w: number, at: THREE.Vector3) {
  const [fx, fz, r] = v.fire!;
  const edge = Math.hypot(fx - at.x, fz - at.z) - r;
  const k = w * clamp01((WARM_REACH - edge) / 0.2);
  if (k <= 0) return;
  const dir = new THREE.Vector3(fx - at.x, 0, fz - at.z).normalize();
  const ext = 0.6 + 0.12 * v.vary; // per-person, seeded by id
  v.arms.forEach((arm) => {
    const len = armLen(arm);
    arm.upper.getWorldPosition(_s);
    const goal = _s.clone().addScaledVector(dir, len * ext).addScaledVector(UP, -len * 0.38);
    armTo(arm, goal, k * 0.85, 0.95, v.rig.holder);
  });
}

function diagOf(v: View, g: Gait | null, flight: string, pz: Posture, targets: (THREE.Vector3 | null)[], source: Source, fp: FramePose | null, pr: ProneState | null = null): Diag {
  const r4 = (x: number) => +x.toFixed(4);
  const a3 = (q: THREE.Vector3) => [r4(q.x), r4(q.y), r4(q.z)] as [number, number, number];
  const ankleH = v.dims?.ankleH ?? 0;
  const feet = v.legs.map((l) => a3(l.foot.getWorldPosition(V())));
  const order = [...v.legs.keys()].sort((i, j) => v.legs[j].side - v.legs[i].side); // left first
  return {
    gait: g ? { flight, u: r4(g.u), weight: r4(g.weight), feet: g.feet.map((f) => ({ planted: f.planted, k: f.k, top: r4(f.top) })) } : null,
    feet: order.map((i) => feet[i]),
    soles: order.map((i) => r4(feet[i][1] - ankleH)),
    hipY: r4(v.legs.length ? v.legs.reduce((s, l) => s + l.upper.getWorldPosition(V()).y, 0) / v.legs.length : 0),
    head: v.spine?.head ? a3(v.spine.head.getWorldPosition(V())) : null,
    pose: { drop: r4(pz.drop), bend: r4(pz.bend), rise: r4(pz.rise), kneel: r4(pz.kneel) },
    prone: pr ? { r: r4(pr.r), bend: r4(pr.bend), turn: r4(pr.turn), yaw: r4(pr.yaw), w: r4(pr.w), slide: r4(pr.slide), engTurn: v.proneEng?.turn !== undefined ? r4(v.proneEng.turn) : null, phaseK: v.proneEng?.k !== undefined ? r4(v.proneEng.k) : null } : null,
    frame: fp ? { kind: fp.kind, u: r4(fp.u), exit: r4(fp.exit), weight: r4(fp.weight), feet: fp.feet?.map((f) => ({ p: f.p.map(r4), planted: f.planted })) ?? null } : null,
    arms: v.arms.map((arm, i) => {
      const sh = arm.upper.getWorldPosition(V()), pm = palm(arm, V()), len = armLen(arm), t = targets[i];
      return { side: armSide(v, i), shoulder: a3(sh), palm: a3(pm), len: r4(len), target: t ? a3(t) : null, source: t ? source : null, contact: t ? r4(contact(sh.distanceTo(t), len)) : 0, err: t ? r4(pm.distanceTo(t)) : null, ratio: t ? r4(sh.distanceTo(t) / len) : null };
    }),
  };
}

const lerpPose = (a: Pose, b: Pose, t: number): Pose => ({
  p: [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t, a.p[2] + (b.p[2] - a.p[2]) * t],
  yaw: lerpAngle(a.yaw, b.yaw, t),
  pitch: lerpAngle(a.pitch ?? 0, b.pitch ?? 0, t),
  roll: lerpAngle(a.roll ?? 0, b.roll ?? 0, t),
});

/**
 * The upright frame's two column lines (base → top): mid-thickness edges at local x = ±size/2 of
 * the part's box (entityCorners order: x, then y, then z).
 */
function columns(e: Entity): [THREE.Vector3, THREE.Vector3][] {
  const c = entityCorners(e).map((k) => new THREE.Vector3(k[0], k[1], k[2]));
  const mid = (i: number, j: number) => c[i].clone().add(c[j]).multiplyScalar(0.5);
  return [0, 4].map((x) => [mid(x, x + 1), mid(x + 2, x + 3)] as [THREE.Vector3, THREE.Vector3]);
}

/** Nearest point of an entity's catalog box (engine pose) to `from`; false when the def is unknown. */
function boxNearest(e: Entity, from: THREE.Vector3, out: THREE.Vector3) {
  const d = CATALOG[e.def];
  if (!d) return false;
  const [sx, sy, sz] = d.size;
  _m.compose(_tmp.set(e.pose.p[0], e.pose.p[1], e.pose.p[2]), _qb.setFromEuler(_eu.set(e.pose.pitch ?? 0, -e.pose.yaw, e.pose.roll ?? 0, 'YXZ')), _one);
  _mi.copy(_m).invert();
  const l = out.copy(from).applyMatrix4(_mi);
  l.set(Math.min(sx / 2, Math.max(-sx / 2, l.x)), Math.min(sy, Math.max(0, l.y)), Math.min(sz / 2, Math.max(-sz / 2, l.z)));
  out.applyMatrix4(_m);
  return true;
}
const _m = new THREE.Matrix4(), _mi = new THREE.Matrix4(), _qb = new THREE.Quaternion(), _eu = new THREE.Euler(), _one = new THREE.Vector3(1, 1, 1);

/**
 * Hand point of an engine grip slot on part `e` (interpolated pose), nearest to `from` (a shoulder):
 * - `lift-far` / `hold-N` (raise_upright, construction/raise.ts): on the nearer column line, the point
 *   nearest the shoulder, kept ≤ LIFT_HAND (1.9 m) above the person's floor, as the engine holds it;
 * - `foot-l` / `foot-r`: the nearer column base (the engine's footers — at ground level: the body
 *   crouches for it, posture.ts);
 * - `lift-end-*` / `lift-edge-*` / `lift-corner-*` (construction/liftcrew.ts `handPoint`): that box
 *   feature at the part's underside;
 * - `lift-station`: false (a station hand, no contact; the arms hang).
 * undefined = not a slot we know (the caller falls back to the part's nearest point).
 */
function slotPoint(e: Entity, slot: string, from: THREE.Vector3, floor: number, out: THREE.Vector3): boolean | undefined {
  if (slot === STATION_SLOT) return false;
  const grips = CATALOG[e.def]?.capabilities?.fixtureCarry?.handling.grips;
  const authored = grips && Object.values(grips).flat().find((g) => g.id === slot);
  if (authored) {
    const span = authored.span ?? [0, 0, 0];
    const end = (sign: number) => new THREE.Vector3(...toWorld(e.pose, [authored.local[0] + sign * span[0], authored.local[1] + sign * span[1], authored.local[2] + sign * span[2]]));
    out.copy(nearestOnSegment(end(-0.5), end(0.5), from, floor + LIFT_HAND));
    return true;
  }
  if (slot.startsWith('lift-') && slot !== 'lift-far') {
    const h = handPoint(e, e.pose, slot);
    if (!h) return undefined;
    out.set(h.p[0], h.p[1], h.p[2]);
    return true;
  }
  const foot = slot === 'foot-l' || slot === 'foot-r';
  if (!(foot || slot === 'lift-far' || /^hold-\d+$/.test(slot))) return undefined;
  if (!CATALOG[e.def]) return undefined;
  let best = Infinity;
  for (const [a, b] of columns(e)) {
    const p = foot ? a.clone() : nearestOnSegment(a, b, from, floor + LIFT_HAND);
    const d = p.distanceTo(from);
    if (d < best) [best, out.x, out.y, out.z] = [d, p.x, p.y, p.z];
  }
  return true;
}

/** Point of segment a→b nearest `q`, then moved down the segment until it is at most `maxY` high. */
function nearestOnSegment(a: THREE.Vector3, b: THREE.Vector3, q: THREE.Vector3, maxY: number) {
  const ab = b.clone().sub(a), L2 = ab.lengthSq();
  let t = L2 > 1e-9 ? clamp01(q.clone().sub(a).dot(ab) / L2) : 0;
  const y = a.y + ab.y * t;
  if (y > maxY && Math.abs(ab.y) > 1e-6) t = clamp01(Math.min(t, (maxY - a.y) / ab.y));
  return a.clone().addScaledVector(ab, t);
}

