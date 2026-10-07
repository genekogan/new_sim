// activities/1 (team/CONTRACTS/proposals/ACTIVITIES-v1.md): generic, native body activities offered as capabilities.
// sit:here, sit-ground:here, lie:here, nap:here, read:here, read:<place>, <activity>:<spot>. Each plan is ordinary
// body steps (walk_to, sit, stand, mars:pose_v1) performed as one logged decision with a normal receipt. No model calls.
import type {Program} from '@sim/engine-contract';
import type {EdgeCapability} from '../contract.ts';
import type {Interior, Ring, Solid} from './nav.ts';

type V2 = [number, number];
export type Spot = {id: string; place?: string; activity: string; base: 'sit' | 'idle' | 'lie'; at: V2; faceTo?: V2; seatHeight?: number; prop?: string; label?: string};
export type Shelf = {id: string; place?: string; at: V2; faceTo?: V2};
export type SpotsData = {contract: 'activity-spots/1'; spots: Spot[]; shelves: Shelf[]; interiors: Interior[]; solids: Solid[]; rings: Ring[]};
export type Plan = {label: string; steps: Program['steps']; seconds?: boolean};

/** Activities a spot may offer, with their default prop and seconds. */
export const SPOT_ACTIVITIES: Record<string, {prop?: string; seconds: number; label: string}> = {
  read: {prop: 'book', seconds: 180, label: 'Read a book'}, write: {prop: 'pen', seconds: 120, label: 'Write'},
  'play-piano': {seconds: 120, label: 'Play the piano'}, 'play-music': {seconds: 120, label: 'Play music'}, paint: {prop: 'brush', seconds: 180, label: 'Paint at the easel'},
  eat: {prop: 'plate', seconds: 120, label: 'Eat something'}, drink: {prop: 'cup', seconds: 90, label: 'Have a drink'}, cook: {prop: 'tool', seconds: 150, label: 'Cook'},
  'play-game': {prop: 'cards', seconds: 180, label: 'Play a game'}, craft: {prop: 'tool', seconds: 180, label: 'Make something by hand'}, 'post-letter': {prop: 'letter', seconds: 4, label: 'Post a letter'},
  lie: {seconds: 120, label: 'Lie down'}, nap: {seconds: 300, label: 'Take a nap'},
};
const REF = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const pt = (v: unknown): v is V2 => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite);

/** Validate an activity-spots/1 file; bad entries are dropped and reported (never faked). */
export function loadSpots(raw: unknown): {data: SpotsData; refused: string[]} {
  const d = (raw ?? {}) as Partial<SpotsData>, refused: string[] = [], ids = new Set<string>();
  const ok = (id: unknown) => typeof id === 'string' && REF.test(id) && !ids.has(id) && !!ids.add(id);
  const spots = (d.spots ?? []).filter(s => {const good = ok(s?.id) && pt(s.at) && s.activity in SPOT_ACTIVITIES && ['sit', 'idle', 'lie'].includes(s.base) && (s.faceTo === undefined || pt(s.faceTo)); if (!good) refused.push('spot ' + String(s?.id)); return good;});
  const shelves = (d.shelves ?? []).filter(s => {const good = ok(s?.id) && pt(s.at); if (!good) refused.push('shelf ' + String(s?.id)); return good;});
  const interiors = (d.interiors ?? []).filter(i => {const good = typeof i?.place === 'string' && Array.isArray(i.doors) && i.doors.length > 0 && i.doors.every(x => Array.isArray(x) && x.length === 4 && x.every(Number.isFinite)); if (!good) refused.push('interior ' + String(i?.place)); return good;});
  const solids = (d.solids ?? []).filter(s => {const good = ok(s?.id) && pt(s.c) && pt(s.half) && Number.isFinite(s.yaw); if (!good) refused.push('solid ' + String(s?.id)); return good;});
  const rings = (d.rings ?? []).filter(g => {const good = ok(g?.id) && pt(g.c) && Number.isFinite(g.r) && g.r > 0.3 && g.r < 50 && (g.gaps === undefined || (Array.isArray(g.gaps) && g.gaps.every(Number.isFinite))); if (!good) refused.push('ring ' + String(g?.id)); return good;});
  if (raw !== undefined && d.contract !== 'activity-spots/1') return {data: {contract: 'activity-spots/1', spots: [], shelves: [], interiors: [], solids: [], rings: []}, refused: ['contract must be activity-spots/1']};
  return {data: {contract: 'activity-spots/1', spots, shelves, interiors, solids, rings}, refused};
}

export type ActivityWorld = {
  me: V2; seated: boolean;
  /** Clear standing ground at a point (m), 0 inside solids / off ground. */
  clearance(x: number, z: number): number;
  /** Nearest open spot with at least `min` m clearance within `rings`×0.5 m. */
  open(at: V2, min: number, rings: number): V2 | null;
  /** Someone else stands within 0.7 m of the point, or another Soul's open act targets this spot id. */
  taken(at: V2, spotId?: string): boolean;
  /** Admitted interiors (spots in a closed building are not offered). */
  enterable(place: string | undefined): boolean;
  /** Nearest free native seat within `radius` m: its sit capability id and plan. */
  seat(radius: number): {cap: EdgeCapability; plan: Plan; distance: number} | null;
  placeName(id: string | undefined): string | null;
  /** Place ids containing a spot's place (for read:<place> on the building as well as the room). */
  ancestors(id: string): string[];
};

const d2 = (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const pose = (activity: string, seconds: number, extra: Record<string, unknown> = {}) => ({verb: 'mars:pose_v1', params: {activity, seconds, ...extra}});
const walk = (to: V2) => ({verb: 'walk_to', params: {to: [to[0], to[1]]}});
const standFirst = (w: ActivityWorld): Program['steps'] => w.seated ? [{verb: 'stand', params: {}}] : [];
const secondsParam = (def: number, max = 1800) => ({seconds: {type: 'integer', min: 5, max, default: def}});
export const ACTIVITY_SECONDS_MAX = 1800;

/** The activity capabilities and plans for one Soul right now. */
export function activityCapabilities(data: SpotsData, w: ActivityWorld): {caps: EdgeCapability[]; plans: Map<string, Plan>} {
  const caps: EdgeCapability[] = [], plans = new Map<string, Plan>();
  const add = (cap: EdgeCapability, plan: Plan) => {caps.push(cap); plans.set(cap.id, plan);};
  const live = data.spots.filter(s => w.enterable(s.place));
  const spotSteps = (s: Spot, seconds?: number): Program['steps'] => {
    const def = SPOT_ACTIVITIES[s.activity], act = s.base === 'lie' ? (s.activity === 'nap' ? 'nap' : 'lie') : s.activity;
    return [...standFirst(w), walk(s.at), pose(act, seconds ?? def.seconds, {...((s.prop ?? def.prop) && s.base !== 'lie' ? {prop: s.prop ?? def.prop} : {}), ...(s.base === 'sit' ? {base: 'sit', ...(s.seatHeight ? {seatHeight: s.seatHeight} : {})} : {}), ...(s.faceTo ? {face: s.faceTo} : {})})];
  };
  const shelfNear = (at: V2) => data.shelves.filter(s => w.enterable(s.place) && d2(s.at, at) <= 15).sort((a, b) => d2(a.at, at) - d2(b.at, at) || a.id.localeCompare(b.id))[0];
  /** Reading at a spot: take a book from the nearest shelf, read, put it back. */
  const readAt = (s: Spot): Program['steps'] => {
    const shelf = shelfNear(s.at), browse = (sec: number) => shelf ? [walk(shelf.at), pose('browse', sec, {prop: 'book', ...(shelf.faceTo ? {face: shelf.faceTo} : {})})] : [];
    return [...standFirst(w), ...browse(4), ...spotSteps(s).filter(x => x.verb !== 'stand'), ...browse(3)];
  };
  // ---- sitting and lying, anywhere
  const seat = w.seat(30), groundHere = w.clearance(w.me[0], w.me[1]), sitGround = (sec: number): Program['steps'] => {
    const spot = groundHere >= 0.45 ? null : w.open(w.me, 0.45, 20);
    return [...standFirst(w), ...(spot ? [walk(spot)] : []), pose('sit-ground', sec)];
  };
  add({id: 'sit-ground:here', verb: 'sit-ground', label: 'Sit down on the ground here', available: true, params: secondsParam(120)}, {label: 'Sit on the ground', steps: sitGround(120), seconds: true});
  if (seat) add({id: 'sit:here', verb: 'sit', label: `Sit down on the nearest free seat (${seat.cap.label}, ${Math.round(seat.distance)} m)`, available: true, target: seat.cap.target, params: secondsParam(60)}, {label: 'Sit down', steps: seat.plan.steps, seconds: true});
  else add({id: 'sit:here', verb: 'sit', label: 'Sit down (no free seat within 30 m: on the ground here)', available: true, params: secondsParam(120)}, {label: 'Sit on the ground', steps: sitGround(120), seconds: true});
  for (const [act, sec] of [['lie', 120], ['nap', 300]] as const) {
    const beds = live.filter(s => s.base === 'lie' && s.activity === act && !w.taken(s.at, s.id) && d2(s.at, w.me) <= 12).sort((a, b) => d2(a.at, w.me) - d2(b.at, w.me));
    const spot = groundHere >= 0.95 ? null : w.open(w.me, 0.95, 30), canHere = groundHere >= 0.95 || !!spot;
    const plan: Plan = beds[0] ? {label: SPOT_ACTIVITIES[act].label, steps: spotSteps(beds[0], sec), seconds: true} : {label: SPOT_ACTIVITIES[act].label, steps: [...standFirst(w), ...(spot ? [walk(spot)] : []), pose(act, sec)], seconds: true};
    add({id: `${act}:here`, verb: act, label: act === 'lie' ? (beds[0] ? `Lie down (${beds[0].label ?? beds[0].id})` : 'Lie down on the grass here') : (beds[0] ? `Take a nap (${beds[0].label ?? beds[0].id})` : 'Take a nap on the grass here'), available: !!beds[0] || canHere,
      ...(beds[0] || canHere ? {} : {blocked: {code: 'pose.no-room', reason: 'No open ground within 15 m to lie on; walk to a lawn or garden first.'}}), params: secondsParam(sec)}, plan);
  }
  // ---- moving on the spot (P1): standing or on the ground, wherever there is room
  for (const [act, label, sec, lying] of [['dance', 'Dance here', 60, false], ['jump', 'Jump on the spot', 5, false], ['stretch', 'Stretch', 30, false], ['jumping-jacks', 'Do jumping jacks', 30, false],
    ['yoga', 'Do yoga on the ground', 120, true], ['pushups', 'Do push-ups', 30, true], ['situps', 'Do sit-ups', 30, true]] as const) {
    const need = lying ? 0.95 : 0.45, spot = groundHere >= need ? null : w.open(w.me, need, 30), can = groundHere >= need || !!spot;
    add({id: `${act}:here`, verb: act, label, available: can, ...(can ? {} : {blocked: {code: 'pose.no-room', reason: 'No open ground within 15 m; walk to a lawn or garden first.'}}), params: secondsParam(sec, 600)},
      {label, steps: [...standFirst(w), ...(spot ? [walk(spot)] : []), pose(act, sec)], seconds: true});
  }
  // ---- reading: a reading spot (with a shelf) nearby, else a free seat, else standing with the book you carry
  const readers = live.filter(s => s.activity === 'read' && !w.taken(s.at, s.id)).sort((a, b) => d2(a.at, w.me) - d2(b.at, w.me) || a.id.localeCompare(b.id));
  const near = readers.find(s => d2(s.at, w.me) <= 40);
  if (near) add({id: 'read:here', verb: 'read', label: `Read a book (${near.label ?? near.id}, ${Math.round(d2(near.at, w.me))} m; takes a book from the shelf and puts it back)`, available: true, target: {id: near.id, kind: 'spot'}, params: secondsParam(180)}, {label: 'Read a book', steps: readAt(near), seconds: true});
  else if (seat) add({id: 'read:here', verb: 'read', label: `Read a book on the nearest free seat (${seat.cap.label})`, available: true, params: secondsParam(180)}, {label: 'Read a book', steps: [...seat.plan.steps.filter(s => s.verb !== 'rest'), pose('read', 180, {prop: 'book'})], seconds: true});
  else add({id: 'read:here', verb: 'read', label: 'Read the book you carry, standing here', available: true, params: secondsParam(180)}, {label: 'Read a book', steps: [...standFirst(w), pose('read', 180, {prop: 'book'})], seconds: true});
  // read:<place>: every place that has reading spots (the room and its building), nearest free spot in it
  const byPlace = new Map<string, Spot[]>();
  for (const s of readers) for (const p of s.place ? [s.place, ...w.ancestors(s.place)] : []) byPlace.set(p, [...(byPlace.get(p) ?? []), s]);
  for (const [place, list] of [...byPlace].sort((a, b) => a[0].localeCompare(b[0]))) {
    const s = list[0], name = w.placeName(place) ?? place;
    if (d2(s.at, w.me) > 200) continue;
    add({id: 'read:' + place, verb: 'read', label: `Read a book in ${name}`, available: true, target: {id: place, kind: 'place'}, params: secondsParam(180)}, {label: `Read a book in ${name}`, steps: readAt(s), seconds: true});
  }
  // ---- every other free spot within reach: play-piano:<spot>, paint:<spot>…
  for (const s of live) {
    if (s.base === 'lie' || w.taken(s.at, s.id) || d2(s.at, w.me) > 120) continue;
    const def = SPOT_ACTIVITIES[s.activity], id = `${s.activity}:${s.id}`; if (plans.has(id)) continue;
    add({id, verb: s.activity, label: `${def.label}${s.label ? ` (${s.label})` : ''}`, available: true, target: {id: s.id, kind: 'spot'}, params: secondsParam(def.seconds)}, {label: def.label, steps: s.activity === 'read' ? readAt(s) : spotSteps(s), seconds: true});
  }
  return {caps, plans};
}
