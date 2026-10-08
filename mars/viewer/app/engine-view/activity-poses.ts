import * as THREE from 'three';
import {gameContact,type RecordedGame} from './recorded-games.ts';
// Body activities (ACTIVITIES-v1, Core `mars:pose_v1`) as a cosmetic, random-access renderer layer: hand goals
// relative to each shoulder, whole-body layouts (sitting on the ground, lying on the back), procedural cycles for
// exercise/dance ids, and small hand props. Pure function of (activity, base, prop, seconds, id): canonical
// roots, contacts, seats and hands stay the engine's; engine hand points / grips always win over this layer.

/** Overlay ids drawn on top of their base posture (sit / idle / sit-ground). */
export const ACTIVITY_OVERLAYS: ReadonlySet<string> = new Set(['read', 'browse', 'write', 'play-piano', 'play-music', 'paint', 'eat', 'drink', 'cook', 'play-game', 'craft', 'post-letter', 'wave', 'use-computer', 'sing', 'listen', 'bow', 'clap', 'nod', 'shake-head', 'cheer', 'point', 'pick-up', 'put-down', 'hug', 'handshake', 'high-five', 'give', 'take']);
/** Whole-body ids: the body point stays put and the viewer lays the body out from it along pose.yaw. */
export const LYING: ReadonlySet<string> = new Set(['lie', 'nap', 'situps', 'bench-press']);
export const FACE_DOWN: ReadonlySet<string> = new Set(['pushups']);
/** Standing procedural cycles (Core may publish these ids; unknown ids simply stand). */
export const CYCLES: ReadonlySet<string> = new Set(['dance', 'jumping-jacks', 'jump', 'stretch', 'yoga', 'pull-ups', 'dips', 'lift-weights', 'play-volleyball', 'play-frisbee', 'play-petanque']);
/** Seat height used for sitting on the ground (pelvis on the grass). */
export const GROUND_SEAT = 0.04;
export const PROPS = ['book', 'brush', 'pen', 'letter', 'cup', 'plate', 'tool', 'cards', 'flower', 'food', 'frisbee', 'boule', 'dumbbell'] as const;
export type PropKind = (typeof PROPS)[number];
const DEFAULT_PROP: Record<string, PropKind> = { read: 'book', browse: 'book', write: 'pen', paint: 'brush', eat: 'plate', drink: 'cup', cook: 'tool', 'play-game': 'cards', craft: 'tool', 'post-letter': 'letter' };

/** The posture an activity sits on, given the engine's baseActivity. */
export function activityBase(activity: string, base?: string): string {
  if (activity === 'sit-ground') return 'sit-ground';
  if (ACTIVITY_OVERLAYS.has(activity)) return base ?? 'idle';
  return activity;
}
/** The prop in the hands: the engine's `human.prop` when it names a known prop, else the activity's default. */
export function propFor(activity: string, prop?: string): PropKind | null {
  if (prop && (PROPS as readonly string[]).includes(prop)) return prop as PropKind;
  return DEFAULT_PROP[activity] ?? null;
}
/** Extra inputs of a frame: seconds since the activity began (one-shot gestures; undefined = cycle on take time) and
 *  the distance to the partner of a paired gesture (body points; undefined = the contract gap). */
export type FrameOpts = { since?: number; gap?: number;instrument?:string;game?:RecordedGame;gameTick?:number;gameDt?:number;actorId?:string };
const GAP: Record<string, number> = { hug: 0.52, handshake: 0.85, 'high-five': 0.75, give: 0.9, take: 0.9 };
/** Shoulder height and half width the hand goals below are written for (BODY_MODEL: shoulders at 1.34 m). */
const SH = 1.34, HALF = 0.19;

/** One hand goal relative to that arm's shoulder: [forward, outward (+ away from the body midline), up] metres. */
export type HandGoal = readonly [number, number, number];
export type ActivityFrame = {
  /** [left, right]; null = that arm is left to the base posture (dangling / hand on thigh). */
  hands: [HandGoal | null, HandGoal | null] | null;
  /** Feet apart (metres each side) and pelvis lift (metres, a hop) for standing cycles. */
  feetOut: number; hop: number;
  /** Torso lean (rad, + forward) and side lean (rad, + to the right). */
  lean: number; side: number;
  /** Whole-body layout: 'back' = lying face up, 'front' = face down (plank); `raise` lifts the upper body (rad). */
  lying: null | { face: 'back' | 'front'; raise: number };
  /** Head pitch (rad, + down: looking at a book or the keys). */
  look: number;
};
const S = (x: number) => x * x * (3 - 2 * x);
const tri = (x: number) => 1 - Math.abs(((x % 2) + 2) % 2 - 1); // 0..1..0 over 2
/** Stable per-person phase in [0,1). */
export function idPhase(id: string): number { let h = 2166136261; for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619); return ((h >>> 0) % 10007) / 10007; }

export function activityFrame(activity: string, base: string, seconds: number, id: string, opts: FrameOpts = {}): ActivityFrame | null {
  const ph = idPhase(id), t = seconds + ph * 7, seated = base === 'sit' || base === 'sit-ground';
  const gap = Math.max(0.3, Math.min(1.6, opts.gap ?? GAP[activity] ?? 0.9)), mid = gap / 2;
  const since = opts.since ?? ((seconds + ph * 7) % 5), env = (a: number, b: number) => S(Math.min(1, since / a)) * (1 - S(Math.max(0, since - b) / 0.5));
  const f: ActivityFrame = { hands: null, feetOut: 0, hop: 0, lean: 0, side: 0, lying: null, look: 0 };
  const down = seated ? -0.36 : -0.34;
  if(opts.game&&['play-frisbee','play-petanque','play-volleyball'].includes(activity)){
    const g=opts.game,tick=opts.gameTick??0,dt=opts.gameDt??.05;
    f.feetOut=.12;
    if(g.waiting||g.throwTick===undefined||g.landTick===undefined)return f;
    if(opts.actorId===g.from){
      const windup=g.kind==='petanque' ? 1.6 : g.kind==='frisbee' ? .7 : .4;
      const k=S(Math.max(0,Math.min(1,1+(tick-g.throwTick)*dt/windup)));
      const after=Math.max(0,Math.min(1,(tick-g.throwTick)*dt/.6));
      const {forward,height}=gameContact(g.kind);
      f.hands=[null,[.12+(forward-.12)*k,-HALF,height-SH-.1*(1-k)]];f.lean=g.kind==='petanque' ? .12*(1-after) : 0;
      if(g.kind==='volleyball')f.hands=[[forward,-HALF,height-SH],[forward,-HALF,height-SH]];
      if(after>=1)f.hands=null;
    }else if(opts.actorId===g.to){
      const anticipation=1-Math.max(0,Math.min(1,(g.landTick-tick)*dt/1.4));
      const {forward,height}=gameContact(g.kind);
      f.hands=[[.12+(forward-.12)*anticipation,-HALF,height-SH],[.12+(forward-.12)*anticipation,-HALF,height-SH]];
    }
    return f;
  }
  switch (activity) {
    case 'read': { const turn = Math.max(0, Math.sin(t * 0.21) - 0.96) * 6; // now and then a page turns
      f.hands = [[0.33, -0.13, down + 0.04], [0.33 + 0.04 * turn, -0.13 + 0.1 * turn, down + 0.04 + 0.03 * turn]]; f.look = 0.38; f.lean = seated ? 0.06 : 0.03; return f; }
    case 'browse': { const k = S(tri(t * 0.45));
      f.hands = [null, [0.42 + 0.06 * k, 0.04, -0.02 - 0.2 * k]]; f.look = 0.1; return f; }
    case 'write': { const s = Math.sin(t * 7) * 0.02, r = tri(t * 0.25) * 0.08;
      f.hands = [[0.36, -0.16, -0.44], [0.4 + s, -0.05 + r, -0.42]]; f.lean = 0.16; f.look = 0.45; return f; }
    case 'play-piano': { const a = Math.sin(t * 5.3) * 0.035, b = Math.sin(t * 4.1 + 1) * 0.035;
      f.hands = [[0.42, -0.02 + a, -0.36 + Math.max(0, Math.sin(t * 9)) * 0.03], [0.42, -0.02 + b, -0.36 + Math.max(0, Math.sin(t * 8 + 2)) * 0.03]]; f.lean = 0.1; f.look = 0.3; return f; }
    case 'play-music': { const s = Math.sin(t * 6) * 0.06;
      if(opts.instrument==='drums'){f.hands=[[.38,.05,-.26+Math.max(0,Math.sin(t*7))*.22],[.38,.05,-.26+Math.max(0,Math.sin(t*7+Math.PI))*.22]];f.look=.18;}
      else if(opts.instrument==='keyboard'||opts.instrument==='piano')return activityFrame('play-piano',base,seconds,id,opts);
      else if(['violin','viola'].includes(opts.instrument??'')){f.hands=[[.24,.1,.12],[.25,.2+s*2,-.05]];f.look=.14;}
      else if(opts.instrument==='cello'){f.hands=[[.3,-.02,-.14],[.38,.12+s*2,-.4]];f.look=.2;}
      else if(opts.instrument==='flute'){f.hands=[[.18,-.08,.15],[.15,.26,.13]];f.look=.03;}
      else {f.hands=[[.3,-.02,-.18],[.22,-.16,-.36+s]];f.look=.2;}return f; }
    case 'paint': { const k = tri(t * 0.7), s = Math.sin(t * 3.1) * 0.06;
      f.hands = [[0.22, 0.06, -0.42], [0.5, 0.06 + s, -0.08 + 0.12 * k]]; f.look = 0.05; return f; }
    case 'eat': { const k = S(Math.max(0, Math.sin(t * 0.9)));
      f.hands = [[0.3, -0.1, down - 0.08], [0.32 - 0.14 * k, -0.08 - 0.08 * k, down - 0.04 + 0.48 * k]]; f.look = 0.3 * (1 - k); return f; }
    case 'drink': { const k = S(Math.max(0, Math.sin(t * 0.6) * 1.3 - 0.3));
      f.hands = [null, [0.3 - 0.13 * k, -0.06 - 0.1 * k, down + 0.06 + 0.42 * k]]; f.look = -0.15 * k; return f; }
    case 'cook': { const a = t * 2.4;
      f.hands = [[0.42, -0.06, -0.4], [0.44 + Math.cos(a) * 0.06, -0.02 + Math.sin(a) * 0.06, -0.36]]; f.lean = 0.12; f.look = 0.4; return f; }
    case 'play-game': { const k = Math.max(0, Math.sin(t * 0.5) - 0.8) * 5;
      f.hands = [[0.3, -0.1, down + 0.02], [0.3 + 0.12 * k, -0.08, down + 0.02 - 0.06 * k]]; f.look = 0.35; return f; }
    case 'craft': { const s = Math.abs(Math.sin(t * 3)) * 0.08;
      f.hands = [[0.44, -0.08, -0.44], [0.46, 0.02, -0.36 + s]]; f.lean = 0.18; f.look = 0.45; return f; }
    case 'post-letter': { const k = S(tri(t * 0.5));
      f.hands = [null, [0.32 + 0.2 * k, 0.02, -0.25 + 0.05 * k]]; f.look = 0.1; return f; }
    case 'use-computer': { const ty = Math.sin(t * 11) * 0.012, mouse = S(Math.max(0, Math.sin(t * 0.37) - 0.55) * 2.2);
      f.hands = [[0.4, -0.12, -0.42 + ty], [0.4 - 0.02 * mouse, -0.1 + 0.2 * mouse, -0.42 - ty]]; f.lean = 0.07; f.look = 0.12; return f; }
    case 'sing': { const g = Math.sin(t * 0.8), sway = Math.sin(t * 1.6);
      f.hands = [[0.22 + 0.06 * g, 0.18 + 0.08 * g, -0.12 + 0.18 * Math.max(0, g)], [0.2, -0.16, 0.2]]; f.side = 0.04 * sway; f.look = -0.12; return f; }
    case 'listen': { const nod = Math.max(0, Math.sin(t * 0.5) - 0.9) * 4;
      f.hands = [[0.24, -0.1, down + 0.02], [0.26, -0.08, down + 0.02]]; f.look = 0.05 + 0.15 * nod; return f; }
    // together/1 paired gestures: the meeting points are on the line between the two bodies (mid = half the gap)
    case 'handshake': { const pump = Math.sin(since * 9) * 0.035 * S(Math.min(1, since / 0.6)), k = env(0.6, 2.9);
      f.hands = [null, [0.06 + (mid - 0.06) * k, 0.02 - (HALF + 0.02) * k, -0.62 + (1.0 - SH + 0.62) * k + pump]]; f.lean = 0.05 * k; f.look = 0.12; return f; }
    case 'high-five': { const k = since < 0.83 ? S(since / 0.83) : 1 - S((since - 0.9) / 0.9);
      f.hands = [null, [0.06 + (mid - 0.1 - 0.06) * k, 0.08 - (HALF + 0.03) * k, -0.55 + (1.95 - SH + 0.55) * k]]; f.look = -0.25 * k; return f; }
    case 'hug': { const k = env(0.9, 4.4), sway = Math.sin(since * 1.6) * 0.05 * k;
      // both arms around the other's upper back: one over the shoulder, one under the arm; a little forward lean and sway
      // the hands reach past the partner's flanks to the middle of their back (gap + a torso's depth ahead)
      f.hands = [[0.08 + (mid * 2 + 0.02 - 0.08) * k, 0.1 - (HALF + 0.02) * k, -0.55 + (-0.1 + 0.55) * k], [0.08 + (mid * 2 - 0.04 - 0.08) * k, 0.1 - (HALF + 0.05) * k, -0.55 + (-0.36 + 0.55) * k]];
      f.lean = 0.1 * k; f.side = sway; f.look = -0.05; return f; }
    case 'give': case 'take': { const k = env(0.7, 2.0), right = activity === 'give' ? 0.06 : -0.06;
      f.hands = [null, [0.1 + (mid - 0.1) * k, 0.04 - (HALF + right) * k, -0.6 + (1.05 - SH + 0.6) * k]]; f.look = 0.3 * k; return f; }
    case 'clap': { const c = Math.abs(Math.sin(t * Math.PI * 2.2)), k = S(Math.min(1, since / 0.4));
      f.hands = [[0.32 * k + 0.02, (-HALF + 0.02 + 0.07 * c) * k + 0.08 * (1 - k), -0.18 * k - 0.5 * (1 - k)], [0.32 * k + 0.02, (-HALF + 0.02 + 0.07 * c) * k + 0.08 * (1 - k), -0.2 * k - 0.5 * (1 - k)]];
      f.look = 0.05; return f; }
    case 'bow': { const k = Math.sin(Math.PI * Math.min(1, since / 2.5));
      f.lean = 0.55 * S(k); f.look = 0.2 * k; f.hands = [[0.05, 0.02, -0.6], [0.05, 0.02, -0.6]]; return f; }
    case 'point': { const k = env(0.5, 2.6);
      f.hands = [null, [0.06 + 0.52 * k, 0.06 + 0.06 * k, -0.6 + 0.62 * k]]; f.look = -0.05 * k; return f; }
    case 'cheer': { const k = env(0.4, 2.6), s = Math.sin(t * 6) * 0.06 * k;
      f.hands = [[0.08, 0.1 + 0.12 * k, -0.6 + 1.2 * k + s], [0.08, 0.1 + 0.12 * k, -0.6 + 1.2 * k - s]]; f.hop = 0.04 * Math.abs(Math.sin(t * 6)) * k; return f; }
    case 'pick-up': case 'put-down': { const k = Math.sin(Math.PI * Math.min(1, since / 1.5));
      f.lean = 0.9 * S(k); f.hands = [null, [0.25 + 0.25 * k, 0.04, -0.6 - 0.55 * k]]; f.look = 0.5 * k; return f; }
    case 'wave': { const s = Math.sin(t * 7) * 0.12;
      f.hands = [null, [0.12, 0.28 + s, 0.42]]; return f; }
    // together/1 gestures (ACTIVITIES-v1 §6a): Core faces the body to the partner/target; the arms do the rest
    case 'nod': f.hands = null; f.look = 0.28 * Math.max(0, Math.sin(t * 6)); return f;
    case 'shake-head': f.hands = null; f.side = 0.05 * Math.sin(t * 9); f.look = 0.05; return f;
    case 'lie': f.lying = { face: 'back', raise: 0 }; f.hands = [[0.42, 0.1, -0.3], [0.42, 0.1, -0.3]]; return f;
    case 'nap': f.lying = { face: 'back', raise: 0 }; f.hands = [[0.3, -0.12, 0.06], [0.34, -0.08, 0.06]]; return f;
    case 'situps': { const k = S(tri(t * 0.55)); f.lying = { face: 'back', raise: 1.1 * k }; f.hands = [[0.1, -0.12, 0.15], [0.1, -0.12, 0.15]]; return f; }
    case 'bench-press': { const k = S(tri(t * 0.45)); f.lying = { face: 'back', raise: 0 }; f.hands = [[0.22 + 0.38 * k, 0.16, -0.02], [0.22 + 0.38 * k, 0.16, -0.02]]; return f; }
    case 'pull-ups': { const k = S(tri(t * 0.4)); f.hands = [[0.06, 0.16, 0.66 - 0.42 * k], [0.06, 0.16, 0.66 - 0.42 * k]]; f.hop = 0.12 + 0.42 * k; f.look = -0.15; return f; }
    case 'dips': { const k = S(tri(t * 0.5)); f.hands = [[0.0, 0.14, -0.32 - 0.14 * (1 - k)], [0.0, 0.14, -0.32 - 0.14 * (1 - k)]]; f.hop = 0.18 + 0.14 * k; f.lean = 0.12; return f; }
    case 'lift-weights': { const a = S(tri(t * 0.5)), b = S(tri(t * 0.5 + 1)); f.hands = [[0.18 + 0.12 * a, -0.04, -0.5 + 0.38 * a], [0.18 + 0.12 * b, -0.04, -0.5 + 0.38 * b]]; f.feetOut = 0.1; return f; }
    case 'play-volleyball': { const k = S(Math.max(0, Math.sin(t * 0.9) - 0.4) * 1.6), j = Math.max(0, Math.sin(t * 0.45) - 0.85) * 6;
      f.hands = j > 0 ? [[0.2, 0.18, 0.5 + 0.1 * j], [0.2, 0.18, 0.5 + 0.1 * j]] : [[0.32, -0.12, -0.42 + 0.12 * k], [0.32, -0.12, -0.42 + 0.12 * k]]; f.hop = 0.3 * j * j / 4; f.lean = 0.18 * (1 - j); f.feetOut = 0.16; return f; }
    case 'play-frisbee': { const k = tri(t * 0.35), throwing = S(Math.max(0, k * 2 - 1)); f.hands = [[0.14, 0.12, -0.38], [0.34 * throwing, -0.18 + 0.62 * throwing, -0.18 + 0.12 * throwing]]; f.side = -0.12 * throwing; f.feetOut = 0.12; return f; }
    case 'play-petanque': { const k = S(Math.max(0, Math.sin(t * 0.5))); f.hands = [[0.1, 0.08, -0.44], [0.12 + 0.32 * k, 0.02, -0.5 + 0.22 * k]]; f.lean = 0.12 + 0.2 * k; f.feetOut = 0.12; return f; }
    case 'pushups': { const k = S(tri(t * 0.6)); f.lying = { face: 'front', raise: 0.08 + 0.32 * k }; f.hands = [[0.05, 0.08, -0.6], [0.05, 0.08, -0.6]]; return f; }
    case 'jumping-jacks': { const k = S(tri(t * 1.15)), up = Math.abs(Math.sin(t * Math.PI * 1.15));
      f.hands = [[0.02, 0.18 + 0.32 * Math.sin(k * Math.PI * 0.5), -0.55 + 1.15 * k], [0.02, 0.18 + 0.32 * Math.sin(k * Math.PI * 0.5), -0.55 + 1.15 * k]];
      f.feetOut = 0.06 + 0.26 * k; f.hop = 0.1 * up; return f; }
    case 'jump': { const up = Math.max(0, Math.sin(t * Math.PI * 0.9));
      f.hands = [[0.15, 0.2, -0.2 + 0.7 * up], [0.15, 0.2, -0.2 + 0.7 * up]]; f.hop = 0.32 * up * up; return f; }
    case 'stretch': { const k = S(tri(t * 0.2)) * 2 - 1;
      f.hands = [[0.02, 0.05, 0.62], [0.02, 0.05, 0.62]]; f.side = 0.28 * k; return f; }
    case 'yoga': { const k = S(Math.min(1, tri(t * 0.12) * 1.6));
      f.hands = [[0.12, -0.12, -0.3 + 0.9 * k], [0.12, -0.12, -0.3 + 0.9 * k]]; f.feetOut = 0.18 * (1 - k) + 0.02; return f; }
    case 'dance': { const b = Math.sin(t * Math.PI * 2 * 0.95), c = Math.cos(t * Math.PI * 0.95), style = Math.floor(ph * 3);
      const hi = style === 0 ? 0.35 : style === 1 ? 0.05 : 0.2;
      f.hands = [[0.2, 0.2 + 0.1 * c, hi * 0.6 + 0.25 * b], [0.2, 0.2 - 0.1 * c, hi * 0.6 - 0.25 * b]];
      f.hop = 0.035 * Math.abs(b); f.side = 0.12 * c; f.feetOut = 0.12; return f; }
    default: return null;
  }
}

// ---------------------------------------------------------------- props (shared geometry/materials, one small mesh group per person)
let kit: { box: THREE.BoxGeometry; cyl: THREE.CylinderGeometry; sphere:THREE.SphereGeometry; mats: Record<string, THREE.MeshStandardMaterial> } | null = null;
function getKit() {
  if (kit) return kit;
  const m = (color: string, rough = 0.8) => new THREE.MeshStandardMaterial({ color, roughness: rough });
  kit = { box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(1, 1, 1, 10),sphere:new THREE.SphereGeometry(1,16,12), mats: { page: m('#f4eedc', 0.9), cover: m('#7a2f2a'), cover2: m('#2f4f7c'), wood: m('#8a5a36'), metal: m('#9aa0a6', 0.4), cup: m('#e9e2d0', 0.5), tea: m('#6b3f1f', 0.3), plate: m('#f2efe6', 0.5), food: m('#d9a24a'), paint: m('#c8402f'), card: m('#fbfaf5', 0.6), red: m('#c0392b'), stem: m('#4f7a32'), petal: m('#e86a8e', 0.7), bloom: m('#f2c84b'), frisbee: m('#e9712e', 0.5), frisbee2: m('#f39a5c', 0.5) } };
  return kit;
}
const part = (geo: THREE.BufferGeometry, mat: THREE.Material, sx: number, sy: number, sz: number, x = 0, y = 0, z = 0, rz = 0, ry = 0) => {
  const o = new THREE.Mesh(geo, mat); o.scale.set(sx, sy, sz); o.position.set(x, y, z); o.rotation.set(0, ry, rz); o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; return o;
};
/** A prop in its own frame: x = away from the holder, y = up, z = the holder's right. Origin = where the hands are. */
export function makeProp(kind: PropKind): THREE.Group {
  const k = getKit(), g = new THREE.Group(), M = k.mats;
  g.name = 'activity prop: ' + kind;
  switch (kind) {
    case 'book': { // open book tilted toward the reader, chunky enough to read at Broadcast distance
      const tilt = new THREE.Group(); tilt.rotation.z = -0.85; g.add(tilt); // top edge tipped away: the open pages face the reader's eyes
      for (const s of [-1, 1]) { const leaf = new THREE.Group(); leaf.rotation.y = s * 0.18; leaf.add(part(k.box, M.page, 0.014, 0.29, 0.2, 0, 0, s * 0.102)); leaf.add(part(k.box, M.cover, 0.01, 0.3, 0.208, 0.01, 0, s * 0.106)); tilt.add(leaf); }
      break; }
    case 'cup': g.add(part(k.cyl, M.cup, 0.04, 0.1, 0.04, 0, 0.03, 0)); g.add(part(k.cyl, M.tea, 0.034, 0.005, 0.034, 0, 0.08, 0)); break;
    case 'plate': g.add(part(k.cyl, M.plate, 0.12, 0.015, 0.12, 0.04, -0.02, 0)); g.add(part(k.box, M.food, 0.09, 0.03, 0.07, 0.04, 0.0, 0)); break;
    case 'brush': g.add(part(k.cyl, M.wood, 0.008, 0.26, 0.008, 0.06, 0.06, 0, -0.9)); g.add(part(k.cyl, M.paint, 0.012, 0.04, 0.012, 0.16, 0.13, 0, -0.9)); break;
    case 'pen': g.add(part(k.cyl, M.metal, 0.006, 0.15, 0.006, 0.02, 0.03, 0, -0.6)); break;
    case 'letter': g.add(part(k.box, M.card, 0.005, 0.12, 0.22, 0.06, 0.02, 0)); g.add(part(k.box, M.red, 0.007, 0.02, 0.02, 0.063, 0.02, 0)); break;
    case 'tool': g.add(part(k.cyl, M.wood, 0.014, 0.24, 0.014, 0.05, 0.04, 0, -0.7)); g.add(part(k.box, M.metal, 0.05, 0.05, 0.1, 0.13, 0.12, 0)); break;
    case 'cards': for (let i = -1; i <= 1; i++) g.add(part(k.box, M.card, 0.004, 0.11, 0.075, 0, 0.02, i * 0.03, 0, i * 0.25)); break;
    case 'flower': // a stem with leaves and a bloom of petals, held upright
      g.add(part(k.cyl, M.stem, 0.006, 0.3, 0.006, 0.02, 0.12, 0)); g.add(part(k.box, M.stem, 0.004, 0.03, 0.05, 0.02, 0.08, 0.02, 0, 0.6));
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; g.add(part(k.box, M.petal, 0.03, 0.012, 0.045, 0.02 + Math.cos(a) * 0.022, 0.28, Math.sin(a) * 0.022, 0, -a)); }
      g.add(part(k.cyl, M.bloom, 0.016, 0.02, 0.016, 0.02, 0.285, 0)); break;
    case 'food': // a bread roll on a napkin
      g.add(part(k.box, M.card, 0.004, 0.13, 0.13, 0.03, -0.01, 0)); g.add(part(k.cyl, M.food, 0.05, 0.05, 0.05, 0.05, 0.02, 0)); break;
    case 'frisbee': g.add(part(k.cyl, M.frisbee, 0.12, 0.018, 0.12, 0.09, 0, 0)); g.add(part(k.cyl, M.frisbee2, 0.08, 0.02, 0.08, 0.09, 0.002, 0)); break;
    case 'boule': g.add(part(k.sphere,M.metal,.045,.045,.045)); break;
    case 'dumbbell': g.add(part(k.cyl,M.metal,.015,.22,.015,0,0,0,Math.PI/2));for(const side of [-1,1])g.add(part(k.cyl,M.metal,.06,.045,.06,side*.1,0,0,Math.PI/2));break;
  }
  return g;
}
const _m = new THREE.Matrix4(), _a = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _rgt = new THREE.Vector3();
/** Put a prop at the hands: two-handed props (book, cards) between the palms, a plate in the left, others in the right. */
export function placeProp(obj: THREE.Object3D, kind: PropKind, left: THREE.Vector3 | null, right: THREE.Vector3 | null, fwd: THREE.Vector3) {
  const two = kind === 'book' || kind === 'cards', at = two && left && right ? _a.copy(left).add(right).multiplyScalar(0.5) : kind === 'plate' ? (left ?? right) : (right ?? left);
  if (!at) { obj.visible = false; return; }
  _rgt.crossVectors(fwd, _up).normalize();
  _m.makeBasis(fwd, _up, _rgt).setPosition(at);
  if (two) _m.setPosition(at.x + fwd.x * 0.03, at.y + 0.05, at.z + fwd.z * 0.03);
  obj.matrixAutoUpdate = false; obj.matrix.copy(_m); obj.matrixWorldNeedsUpdate = true; obj.visible = true;
}
