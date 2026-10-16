// activities/1 (team/CONTRACTS/proposals/ACTIVITIES-v1.md): generic, native body activities offered as capabilities.
// sit:here, sit-ground:here, lie:here, nap:here, read:here, read:<place>, <activity>:<spot>. Each plan is ordinary
// body steps (walk_to, sit, stand, mars:pose_v1) performed as one logged decision with a normal receipt. No model calls.
import type {Program} from '@sim/engine-contract';
import type {EdgeCapability} from '../contract.ts';
import type {Interior, Platform, Ring, Solid} from './nav.ts';
import {POSE_INSTRUMENTS} from '../../../../../mars/viewer/engine/social/pose.ts';
import {validInteriorShellBounds} from './nav.ts';

type V2 = [number, number];
export type Spot = {id: string; place?: string; activity: string; base: 'sit' | 'idle' | 'lie'; at: V2; faceTo?: V2; seatHeight?: number; prop?: string; label?: string;
  /** CN5: the instrument at a play-music spot (drums, guitar, violin…); the raised deck it stands on (platforms[] id);
   *  further activities offered at the same spot (a desk with a computer: `also: ['use-computer']`). */
  instrument?: string; platform?: string; also?: string[];
  /** todo (leisure): a spot done together (a see-saw's two ends): the shared group, how many others it needs, how long it
   *  waits for them and what happens alone (fail: "nobody came" is the honest verdict). */
  together?: {group: string; need: number; wait: number; alone: 'fail' | 'start'};
  /** R5: another spot that must be in use first (a listener's seat needs someone telling the story). */
  requires?: string};
export type Shelf = {id: string; place?: string; at: V2; faceTo?: V2};
/** todo (leisure): a bicycle dock: `bikes` bicycles stand in it; a ride takes one and brings it back. */
export type Dock = {id: string; place?: string; at: V2; faceTo?: V2; bikes: number; label?: string};
export type SpotsData = {contract: 'activity-spots/1'; spots: Spot[]; shelves: Shelf[]; interiors: Interior[]; solids: Solid[]; rings: Ring[]; platforms: Platform[]; docks?: Dock[]};
export type Plan = {label: string; steps: Program['steps']; seconds?: boolean};

/** Activities a spot may offer, with their default prop and seconds. */
/** `pose`: the body pose an activity is done in, when it is not its own name (a book club reads, a yoga class does yoga). */
export const SPOT_ACTIVITIES: Record<string, {prop?: string; seconds: number; label: string; pose?: string}> = {
  read: {prop: 'book', seconds: 180, label: 'Read a book'}, write: {prop: 'pen', seconds: 120, label: 'Write'},
  'play-piano': {seconds: 120, label: 'Play the piano'}, 'play-music': {seconds: 120, label: 'Play music'}, paint: {prop: 'brush', seconds: 180, label: 'Paint at the easel'},
  eat: {prop: 'plate', seconds: 120, label: 'Eat something'}, drink: {prop: 'cup', seconds: 90, label: 'Have a drink'}, cook: {prop: 'tool', seconds: 150, label: 'Cook'},
  'play-game': {prop: 'cards', seconds: 180, label: 'Play a game'}, craft: {prop: 'tool', seconds: 180, label: 'Make something by hand'}, 'post-letter': {prop: 'letter', seconds: 4, label: 'Post a letter'},
  lie: {seconds: 120, label: 'Lie down'}, nap: {seconds: 300, label: 'Take a nap'},
  // CN5: computers at desks, the stages and the audience, the outdoor gym, park games
  'use-computer': {seconds: 300, label: 'Use the computer'}, sing: {seconds: 120, label: 'Sing at the microphone'}, listen: {seconds: 300, label: 'Sit in the audience and listen'},
  'lift-weights': {prop: 'dumbbell', seconds: 60, label: 'Lift weights (dumbbell curls)'}, 'bench-press': {seconds: 60, label: 'Do a bench press'}, 'pull-ups': {seconds: 30, label: 'Do pull-ups'},
  dips: {seconds: 30, label: 'Do dips on the bars'}, situps: {seconds: 30, label: 'Do sit-ups'}, pushups: {seconds: 30, label: 'Do push-ups'}, yoga: {seconds: 120, label: 'Do yoga'},
  // leisure: nature activities at World's bank, pond and bed spots
  fish: {prop: 'rod', seconds: 180, label: 'Fish from the bank'}, feed: {prop: 'bread', seconds: 90, label: 'Feed the koi'}, garden: {prop: 'tool', seconds: 150, label: 'Tend the garden beds'},
  // leisure: the playground, the hammocks and the picnic blanket (World's scenery), and lying back to watch the night sky
  swing: {seconds: 120, label: 'Swing on a swing'}, seesaw: {seconds: 120, label: 'Ride the see-saw (with someone on the other end)'},
  hammock: {seconds: 300, label: 'Rest in a hammock'}, picnic: {prop: 'food', seconds: 300, label: 'Have a picnic on the blanket'},
  // R5 group life: done together at shared places (see Spot.together); the verdict says when nobody came
  'tell-story': {seconds: 240, label: 'Tell a story to the circle'}, 'hear-story': {pose: 'listen', seconds: 240, label: 'Listen to the storyteller'},
  'book-club': {pose: 'read', prop: 'book', seconds: 600, label: 'Book club: read and talk it over together'},
  'cook-together': {pose: 'cook', prop: 'spoon', seconds: 300, label: 'Cook together at a preparation table'},
  'social-dance': {pose: 'dance', seconds: 180, label: 'Dance on the bandstand'}, 'yoga-class': {pose: 'yoga', seconds: 600, label: 'Join the yoga class'},
  'play-frisbee': {seconds: 300, label: 'Throw a frisbee'}, 'play-petanque': {seconds: 600, label: 'Play pétanque'}, 'play-volleyball': {seconds: 300, label: 'Play beach volleyball'},
};
/** CN5 choreographed games at spots: 2–6 players; the world keeps the turns (social/pose.ts GAMES). */
export const GAME_ACTIVITIES: Record<string, 'frisbee' | 'petanque' | 'volleyball'> = {'play-frisbee': 'frisbee', 'play-petanque': 'petanque', 'play-volleyball': 'volleyball'};
export const GAME_MAX_PLAYERS = 6;
/** Postures done lying on a spot's furniture or mat (the rest of a `lie` spot is lying down or a nap). */
const LYING_SPOT = new Set(['lie', 'nap', 'situps', 'pushups', 'bench-press', 'yoga', 'hammock']);
const INSTRUMENTS = new Set<string>(POSE_INSTRUMENTS);
const REF = /^[a-z0-9][a-z0-9._-]{0,99}$/;
/** Clear ground a body needs to stand or sit at a spot (m): the walk planner's body radius. */
const STAND_CLEAR = 0.28;
/** Spots within this distance are offered (CN5: 200 m, so the piano is still offered from the pond and the shore). */
export const SPOT_REACH = 200;
const pt = (v: unknown): v is V2 => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite);

const validTogether = (t: Spot['together']) => !!t && typeof t.group === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(t.group) && Number.isInteger(t.need) && t.need >= 1 && t.need <= 8
  && Number.isFinite(t.wait) && t.wait >= 0 && t.wait <= 180 && (t.alone === 'fail' || t.alone === 'start');
/** Validate an activity-spots/1 file; bad entries are dropped and reported (never faked). */
export function loadSpots(raw: unknown): {data: SpotsData; refused: string[]} {
  const d = (raw ?? {}) as Partial<SpotsData>, refused: string[] = [], ids = new Set<string>();
  const ok = (id: unknown) => typeof id === 'string' && REF.test(id) && !ids.has(id) && !!ids.add(id);
  const spots = (d.spots ?? []).filter(s => {const good = ok(s?.id) && pt(s.at) && s.activity in SPOT_ACTIVITIES && ['sit', 'idle', 'lie'].includes(s.base) && (s.faceTo === undefined || pt(s.faceTo))
    && (s.instrument === undefined || INSTRUMENTS.has(s.instrument)) && (s.together === undefined || validTogether(s.together)) && (s.requires === undefined || (typeof s.requires === 'string' && REF.test(s.requires))) && (s.also === undefined || (Array.isArray(s.also) && s.also.every(a => a in SPOT_ACTIVITIES && !(a in GAME_ACTIVITIES)))); if (!good) refused.push('spot ' + String(s?.id)); return good;});
  const shelves = (d.shelves ?? []).filter(s => {const good = ok(s?.id) && pt(s.at); if (!good) refused.push('shelf ' + String(s?.id)); return good;});
  const interiors = (d.interiors ?? []).filter(i => {const good = typeof i?.place === 'string' && Array.isArray(i.doors) && i.doors.length > 0 && i.doors.every(x => Array.isArray(x) && x.length === 4 && x.every(Number.isFinite)) && (i.shell===undefined||validInteriorShellBounds(i.shell)); if (!good) refused.push('interior ' + String(i?.place)); return good;});
  const solids = (d.solids ?? []).filter(s => {const good = ok(s?.id) && pt(s.c) && pt(s.half) && Number.isFinite(s.yaw); if (!good) refused.push('solid ' + String(s?.id)); return good;});
  const rings = (d.rings ?? []).filter(g => {const good = ok(g?.id) && pt(g.c) && Number.isFinite(g.r) && g.r > 0.3 && g.r < 50 && (g.gaps === undefined || (Array.isArray(g.gaps) && g.gaps.every(Number.isFinite))); if (!good) refused.push('ring ' + String(g?.id)); return good;});
  // CN5: walkable raised decks (OBSTACLES-v1 platforms[]): a box {c, half, yaw} or a round deck {c, r}, top height, optional step/ramp
  const platforms = (d.platforms ?? []).filter(q => {const good = ok(q?.id) && pt(q.c) && Number.isFinite(q.top) && q.top > 0 && q.top < 3 && ((pt(q.half) && Number.isFinite(q.yaw ?? 0)) || (Number.isFinite(q.r) && q.r! > 0.3 && q.r! < 50))
    && [q.step, q.ramp].every(a => a === undefined || (pt(a.c) && pt(a.half))); if (!good) refused.push('platform ' + String(q?.id)); return good;});
  const docks = (d.docks ?? []).filter(k => {const good = ok(k?.id) && pt(k.at) && (k.faceTo === undefined || pt(k.faceTo)) && Number.isInteger(k.bikes) && k.bikes >= 1 && k.bikes <= 12; if (!good) refused.push('dock ' + String(k?.id)); return good;});
  if (raw !== undefined && d.contract !== 'activity-spots/1') return {data: {contract: 'activity-spots/1', spots: [], shelves: [], interiors: [], solids: [], rings: [], platforms: []}, refused: ['contract must be activity-spots/1']};
  return {data: {contract: 'activity-spots/1', spots, shelves, interiors, solids, rings, platforms, ...(docks.length ? {docks} : {})}, refused};
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
  /** CN5: how many bodies are playing (or waiting to play) in this game group now. */
  groupSize(group: string): number;
  /** leisure: the world clock now (null/absent: this world keeps no day), for stargazing after dark. */
  clock?: {hour: number; minute: number} | null;
};
/** leisure: the stars are out from 20:00 until 05:00 world time. */
export const STARS_FROM = 20, STARS_UNTIL = 5;

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
  // CN5 (acceptance): a spot World placed inside an obstacle (the picnic seats inside their table's box) is used from the
  // first clear point straight back from what it faces (≤ 0.9 m); one with no clear point near it is not offered
  const standAt = new Map<string, V2 | null>(), clearAt = (s: Spot): V2 | null => {
    if (!standAt.has(s.id)) {
      let at: V2 | null = s.at;
      // only a spot inside an obstacle (no clearance at all) moves; seats and benches close to furniture are as World placed them
      if (!(s.activity in GAME_ACTIVITIES) && w.clearance(s.at[0], s.at[1]) < 0.05 && w.clearance(w.me[0], w.me[1]) > 0) {
        const f = s.faceTo ?? s.at, L = Math.hypot(s.at[0] - f[0], s.at[1] - f[1]), back: V2 = L > 1e-6 ? [(s.at[0] - f[0]) / L, (s.at[1] - f[1]) / L] : [0, 0];
        at = null; for (let t = 0.1; t <= 0.9 + 1e-9 && L > 1e-6; t += 0.1) {const p: V2 = [Math.round((s.at[0] + back[0] * t) * 100) / 100, Math.round((s.at[1] + back[1] * t) * 100) / 100]; if (w.clearance(p[0], p[1]) >= STAND_CLEAR) {at = p; break;}}
      }
      standAt.set(s.id, at);
    }
    return standAt.get(s.id)!;
  };
  const live = data.spots.filter(s => w.enterable(s.place) && !!clearAt(s));
  const spotSteps = (s: Spot, seconds?: number, activity = s.activity): Program['steps'] => {
    const def = SPOT_ACTIVITIES[activity], body = def.pose ?? activity, lying = s.base === 'lie', act = lying && !LYING_SPOT.has(body) ? 'lie' : body, prop = s.prop ?? def.prop;
    return [...standFirst(w), walk(clearAt(s) ?? s.at), pose(act, seconds ?? def.seconds, {...(prop && !lying ? {prop} : {}), ...(s.base === 'sit' ? {base: 'sit', ...(s.seatHeight ? {seatHeight: s.seatHeight, seatTogether: true} : {})} : {}),
      // CN5: lying on furniture (a gym bench) at its top; the instrument played at a music spot
      ...(lying && s.seatHeight ? {seatHeight: s.seatHeight, seatTogether: true} : {}), ...(s.instrument && (act === 'play-music' || act === 'play-piano') ? {instrument: s.instrument} : {}), ...(s.faceTo ? {face: s.faceTo} : {}),
      // leisure: done together (a see-saw): wait for the other end, then the same shared stretch for both
      ...(s.together ? {group: s.together.group, need: s.together.need, waitSeconds: s.together.wait, alone: s.together.alone, seatTogether: true} : {})})];
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
  // ---- leisure: lie back on open grass and watch the stars, after dark only (the verdict says when, never a lie in daylight)
  {
    const spot = groundHere >= 0.95 ? null : w.open(w.me, 0.95, 30), room = groundHere >= 0.95 || !!spot, c = w.clock;
    const dark = !!c && (c.hour >= STARS_FROM || c.hour < STARS_UNTIL), at = c ? `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}` : null;
    const blocked = !c ? {code: 'sky.no-clock', reason: 'This world keeps no day and night, so there are no stars to watch.'}
      : !dark ? {code: 'sky.daylight', reason: `The stars come out from ${STARS_FROM}:00 to 0${STARS_UNTIL}:00 world time; it is ${at} now. Lie down on the grass instead, or ask again after dark.`}
      : !room ? {code: 'pose.no-room', reason: 'No open ground within 15 m to lie on; walk to a lawn first.'} : null;
    add({id: 'stargaze:here', verb: 'stargaze', label: 'Lie back on the grass and watch the stars', available: !blocked, ...(blocked ? {blocked} : {}), params: secondsParam(300)},
      {label: 'Watch the stars', steps: [...standFirst(w), ...(spot ? [walk(spot)] : []), pose('stargaze', 300)], seconds: true});
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
  // ---- every other free spot within reach: play-piano:<spot>, paint:<spot>, use-computer:<spot>, sing:<spot>, listen:<seat>…
  const labelOf = (s: Spot, activity: string) => {const def = SPOT_ACTIVITIES[activity], inst = s.instrument && activity === 'play-music' ? `Play the ${s.instrument}` : def.label; return `${inst}${s.label ? ` (${s.label})` : ''}`;};
  for (const s of live) {
    if (s.base === 'lie' && !LYING_SPOT.has(s.activity)) continue;
    if ((s.base === 'lie' && (s.activity === 'lie' || s.activity === 'nap')) || s.activity in GAME_ACTIVITIES || w.taken(s.at, s.id) || d2(s.at, w.me) > SPOT_REACH) continue;
    for (const activity of [s.activity, ...(s.also ?? [])]) {
      const def = SPOT_ACTIVITIES[activity], id = `${activity}:${s.id}`; if (plans.has(id)) continue;
      // R5: a listener's seat is offered once someone is telling the story (its required spot is in use)
      const needs = s.requires ? data.spots.find(x => x.id === s.requires) : undefined, missing = !!needs && !w.taken(needs.at, needs.id);
      const waiting = s.together ? w.groupSize(s.together.group) : 0, withWho = s.together ? (waiting ? `; ${waiting} waiting on the other end, join them` : (s.together.alone === 'start' ? `; starts after ${s.together.wait} s, others may join` : `; waits up to ${s.together.wait} s for someone to join`)) : '';
      add({id, verb: activity, label: labelOf(s, activity) + withWho, available: !missing, ...(missing ? {blocked: {code: 'together.nobody-leading', reason: `Nobody is at ${needs!.label ?? needs!.id} yet; nothing to join. Start it yourself, or ask again later.`}} : {}), target: {id: s.id, kind: 'spot'}, params: secondsParam(def.seconds)}, {label: def.label, steps: activity === 'read' ? readAt(s) : spotSteps(s, undefined, activity), seconds: true});
    }
  }
  // ---- CN5 choreographed games: each court's free places (its spots, then extra places beside them up to 6 players)
  for (const court of gameCourts(live, w)) {
    const playing = w.groupSize(court.group), full = playing >= GAME_MAX_PLAYERS;
    // a new player goes to the end/side with fewer players (a frisbee pair at the two ends, volleyball across the net)
    const used = (side: number) => court.slots.filter(x => x.side === side && w.taken(x.at, x.id)).length, sides = [...new Set(court.slots.map(x => x.side))], least = Math.min(...sides.map(used));
    for (const slot of court.slots) {
      if (w.taken(slot.at, slot.id) || d2(slot.at, w.me) > SPOT_REACH || used(slot.side) > least) continue;
      const def = SPOT_ACTIVITIES[court.activity], id = `${court.activity}:${slot.id}`; if (plans.has(id)) continue;
      add({id, verb: court.activity, label: `${def.label} (${slot.label}${playing ? `; ${playing} playing, join them` : '; a partner joins by taking another place here'})`, available: !full,
        ...(full ? {blocked: {code: 'game.full', reason: `${GAME_MAX_PLAYERS} are already playing.`}} : {}), target: {id: slot.id, kind: 'spot'}, params: secondsParam(def.seconds)},
      {label: def.label, seconds: true, steps: [...standFirst(w), walk(slot.at), pose(court.activity, def.seconds, {group: court.group, waitSeconds: 120, alone: 'fail', need: 1, ...(slot.faceTo ? {face: slot.faceTo} : {}), game: court.game})]});
    }
  }
  return {caps, plans};
}

export type GameSlot = {id: string; spot: Spot; at: V2; faceTo?: V2; label: string;
  /** frisbee ends / volleyball sides (by facing); pétanque has one side. New players go to the side with fewer. */
  side: number};
export type GameCourt = {activity: string; group: string; game: {kind: 'frisbee' | 'petanque' | 'volleyball'; jack?: V2; net?: [number, number, number, number]}; slots: GameSlot[]};
const r2 = (n: number) => Math.round(n * 100) / 100;
/** CN5: game courts from World's game spots (one court per game and place): the shared group, the jack (pétanque: 7 m out
 *  along the players' facing) or net (volleyball: between the two sides), and up to six places — the spots, then extra places
 *  beside or behind them on clear ground at least a metre from every other place. Deterministic. */
export function gameCourts(spots: Spot[], w: Pick<ActivityWorld, 'clearance'>): GameCourt[] {
  const by = new Map<string, Spot[]>();
  for (const s of spots) if (s.activity in GAME_ACTIVITIES) {const k = s.activity + '|' + (s.place ?? ''); by.set(k, [...(by.get(k) ?? []), s]);}
  const out: GameCourt[] = [];
  for (const [, list] of [...by].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sp = [...list].sort((a, b) => a.id.localeCompare(b.id)), activity = sp[0].activity, kind = GAME_ACTIVITIES[activity];
    const dir = (s: Spot): V2 => {const f = s.faceTo ?? [s.at[0], s.at[1] + 1], d = Math.hypot(f[0] - s.at[0], f[1] - s.at[1]) || 1; return [(f[0] - s.at[0]) / d, (f[1] - s.at[1]) / d];};
    const mean = (ps: V2[]): V2 => [ps.reduce((a, p) => a + p[0], 0) / ps.length, ps.reduce((a, p) => a + p[1], 0) / ps.length];
    let game: GameCourt['game'] = {kind};
    if (kind === 'petanque') {const c = mean(sp.map(s => s.at)), d = mean(sp.map(dir)), n = Math.hypot(...d) || 1; game = {kind, jack: [r2(c[0] + d[0] / n * 7), r2(c[1] + d[1] / n * 7)]};}
    if (kind === 'volleyball') {
      // two sides by facing; the net halfway between them, across the line joining them
      const a = sp.filter(s => {const d = dir(s); return d[0] + d[1] * 1e-3 > 0;}), b = sp.filter(s => !a.includes(s));
      if (a.length && b.length) {const ca = mean(a.map(s => s.at)), cb = mean(b.map(s => s.at)), m: V2 = [(ca[0] + cb[0]) / 2, (ca[1] + cb[1]) / 2], L = Math.hypot(cb[0] - ca[0], cb[1] - ca[1]) || 1, u: V2 = [-(cb[1] - ca[1]) / L, (cb[0] - ca[0]) / L];
        game = {kind, net: [r2(m[0] - u[0] * 5), r2(m[1] - u[1] * 5), r2(m[0] + u[0] * 5), r2(m[1] + u[1] * 5)]};}
    }
    const sideOf = (s: Spot) => {if (kind === 'petanque') return 0; const d = dir(s); return d[0] + d[1] * 1e-3 > 0 ? 0 : 1;};
    // a spot not on clear ground (World's north frisbee end lies inside the pond's rim) moves forward along its facing to the
    // first clear point within 6 m; one with none is left out
    const clearAt = (s: Spot): V2 | null => {const d = dir(s); for (let t = 0; t <= 6; t += 0.25) {const p: V2 = [r2(s.at[0] + d[0] * t), r2(s.at[1] + d[1] * t)]; if (w.clearance(p[0], p[1]) >= 0.35) return p;} return null;};
    const slots: GameSlot[] = sp.flatMap(s => {const at = clearAt(s); return at ? [{id: s.id, spot: s, at, ...(s.faceTo ? {faceTo: s.faceTo} : {}), label: s.label ?? s.id, side: sideOf(s)}] : [];});
    for (let k = 0; slots.length < GAME_MAX_PLAYERS && k < 40; k++) {
      const base = slots.filter(x => !x.id.includes('.p'))[k % Math.max(1, slots.filter(x => !x.id.includes('.p')).length)]; if (!base) break;
      const s = base.spot, d = dir(s), perp: V2 = [-d[1], d[0]], j = Math.floor(k / Math.max(1, slots.filter(x => !x.id.includes('.p')).length));
      // beside it (±1.4 m, ±2.8 m), then a step behind and beside
      const off = [[1.4, 0], [-1.4, 0], [2.8, 0], [-2.8, 0], [0, -1.3], [1.4, -1.3], [-1.4, -1.3]][j]; if (!off) break;
      const at: V2 = [r2(base.at[0] + perp[0] * off[0] + d[0] * off[1]), r2(base.at[1] + perp[1] * off[0] + d[1] * off[1])];
      if (slots.some(o => d2(o.at, at) < 1.0) || w.clearance(at[0], at[1]) < 0.35) continue;
      const faceTo: V2 | undefined = s.faceTo ? [r2(s.faceTo[0] + perp[0] * off[0]), r2(s.faceTo[1] + perp[1] * off[0])] : undefined;
      slots.push({id: `${s.id}.p${slots.length + 1}`, spot: s, at, ...(faceTo ? {faceTo} : {}), label: `${s.label ?? s.id}, beside`, side: sideOf(s)});
    }
    out.push({activity, group: `game-${kind}-${sp[0].id}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80), game, slots});
  }
  return out;
}
