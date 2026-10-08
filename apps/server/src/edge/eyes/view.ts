// Eyes (M3): server state → the Soul's eye pose, gaze and visible set (sight.ts), for one Soul at the current tick.
// Plans read the native world and the current Core-A gaze; an explicit gaze request is logged by the route through the independent attention channel.
import {CATALOG} from '../../../../../mars/viewer/engine/world/catalog.ts';
import type {WorldState as NativeWorld} from '../../../../../mars/viewer/engine/world/types.ts';
import {EdgeError, type EdgeSoul} from '../contract.ts';
import {stateOf, type EdgeLedger} from '../ledger/ledger.ts';
import {centroid} from '../ledger/places.ts';
import {buildOccluders, computeSight, lightOf, wrap, compassOf, doingOf, type EyePose, type Occluders, type Sight, type SightBody, type SightFixture, type V2} from './sight.ts';

export type ViewMode = 'eyes' | 'map';
export type ViewRequest = {gaze?: string; fov?: number; w: number; h: number; mode: ViewMode};
export type ViewPlan = {sight: Sight; tick: number; me: SightBody; request: ViewRequest;
  /** What the render worker draws: camera, who is shown, who is hidden (everyone else). */
  render: {mode: ViewMode; w: number; h: number; pose: EyePose; self: string; show: string[]; span?: number}};

const SMALL = new Set(['bowl', 'spoon', 'pot', 'cup', 'plate', 'fork', 'knife', 'mug']);
const DEF_NAME: Record<string, string> = {campfire: 'campfire', 'camp-chair': 'camp chair'};
const MAP_SPAN = 12, PITCH = -0.14;   // eyes rest a little below the horizon (≈ 8°)
/** A readable name for a native fixture: authored labels without their north/south/number suffixes, else the catalogue's. */
export function fixtureName(e: {id: string; def: string; label?: string}): string {
  if (DEF_NAME[e.def]) return DEF_NAME[e.def];
  const authored = e.label && e.label !== e.id && !/^[a-z0-9]+(-[a-z0-9]+)+$/.test(e.label) ? e.label : (CATALOG as Record<string, {label?: string}>)[e.def]?.label ?? e.def.replace(/-/g, ' ');
  return plainName(authored);
}
/** "Fire Bench North" → "Fire bench"; "Reading table, east (south side)" → "Reading table"; "Post box 6" → "Post box". */
export function plainName(label: string): string {
  const words = label.replace(/ in the .*$/, '').replace(/\s*\(.*\)\s*$/, '').replace(/,.*$/, '').trim().split(/\s+/);
  while (words.length > 1 && /^(north|south|east|west|left|right|\d+[a-z]?)$/i.test(words.at(-1)!)) words.pop();
  return words.map((w, i) => i === 0 ? w : w.toLowerCase()).join(' ');
}

/** Per-ledger caches: occluders and fixture enclosures depend on place data and fixed geometry only. */
const occCache = new WeakMap<EdgeLedger, Occluders>();
const encCache = new WeakMap<EdgeLedger, Map<string, string | null>>();
function occludersOf(ledger: EdgeLedger): Occluders {
  let o = occCache.get(ledger); if (!o) {o = buildOccluders(ledger.places.byId.values(), ledger.spots); occCache.set(ledger, o);} return o;
}
function enclosureAt(ledger: EdgeLedger, x: number, z: number, level = 0): string | null {
  let m = encCache.get(ledger); if (!m) {m = new Map(); encCache.set(ledger, m);}
  const key = `${Math.round(x * 10)},${Math.round(z * 10)},${level}`; if (m.has(key)) return m.get(key)!;
  const v = ledger.places.containing(x, z, level).find(p => p.enclosed)?.id ?? null; if (m.size > 20000) m.clear(); m.set(key, v); return v;
}

function eyePose(body: {pose: {p: number[]; yaw: number}; human?: {activity?: unknown; shore?: {datumY?: number}}}, state: string, yaw: number, hfovDeg: number, w: number, h: number): EyePose {
  const [x, y, z] = body.pose.p, act = String(body.human?.activity ?? '');
  const datum = body.human?.shore?.datumY;
  const eyeY = (state === 'swimming' || act === 'swim' || act === 'tread') && Number.isFinite(datum) ? datum! + 0.25
    : state === 'seated' ? y + 1.15 : state === 'lying' || state === 'sleeping' ? y + 0.35 : y + 1.62;
  const hfov = hfovDeg * Math.PI / 180, vfov = 2 * Math.atan(Math.tan(hfov / 2) * h / w);
  return {p: [x, Math.round(eyeY * 1000) / 1000, z], yaw, pitch: PITCH, hfov, vfov};
}

/** Resolve `gaze`: forward | left | right | behind | <soulId> | <entity/spot/place id>. Targets must be perceivable
 *  (another Soul: same enclosure within 60 m; a thing: same enclosure within 60 m; a place: any, map knowledge). */
export function resolveGaze(ledger: EdgeLedger, soul: EdgeSoul, me: SightBody, gaze: string | undefined): {mode: string; yaw: number; target?: string; aim?: [number, number, number]} {
  const g = (gaze ?? 'forward').trim();
  if (g === '' || g === 'forward' || g === 'ahead') return {mode: 'forward', yaw: me.yaw};
  if (g === 'left') return {mode: 'left', yaw: wrap(me.yaw - Math.PI / 2)};
  if (g === 'right') return {mode: 'right', yaw: wrap(me.yaw + Math.PI / 2)};
  if (g === 'behind' || g === 'back') return {mode: 'behind', yaw: wrap(me.yaw + Math.PI)};
  if (!/^[A-Za-z0-9][A-Za-z0-9._:#-]{0,120}$/.test(g)) throw new EdgeError(400, 'invalid', 'gaze must be forward, left, right, behind, a Soul id or a thing id');
  const at = (p: V2, name: string, y = 0.9) => ({mode: 'target', yaw: Math.atan2(p[1] - me.p[2], p[0] - me.p[0]), target: name, aim: [p[0], y, p[1]] as [number, number, number]});
  const near = ledger.perceivedBodies(soul.soulId, 60).find(o => o.soulId === g || o.entityId === g);
  if (near) {const b = (ledger.host.engine.world as NativeWorld).entities[near.entityId]; if (b) return at([b.pose.p[0], b.pose.p[2]], near.name, b.pose.p[1] + 1.3);}
  if (ledger.host.minds.get(g)) throw new EdgeError(404, 'gaze.not-visible', 'That Soul is not near you (or is inside somewhere else), so you cannot turn to look at it.');
  const e = (ledger.host.engine.world as NativeWorld).entities[g];
  if (e && e.kind !== 'human') {
    const d = Math.hypot(e.pose.p[0] - me.p[0], e.pose.p[2] - me.p[2]);
    if (d <= 60 && enclosureAt(ledger, e.pose.p[0], e.pose.p[2]) === me.enclosure) return at([e.pose.p[0], e.pose.p[2]], fixtureName(e as never), e.pose.p[1] + 0.4);
  }
  const spot = ledger.spots.spots.find(s => s.id === g);
  if (spot && Math.hypot(spot.at[0] - me.p[0], spot.at[1] - me.p[2]) <= 60 && enclosureAt(ledger, spot.at[0], spot.at[1]) === me.enclosure) return at(spot.at, spot.label ?? spot.id);
  const place = ledger.places.byId.get(g);
  if (place && !place.carrier && place.parent !== null) return at(centroid(place.polygon), place.name, 2);
  throw new EdgeError(404, 'gaze.unknown', 'Nothing by that id is near enough to look at. Use left, right, behind, a nearby Soul id or a place id from the map.');
}

/** Everything the view route needs for one Soul, now. */
export function planView(ledger: EdgeLedger, soul: EdgeSoul, request: ViewRequest): ViewPlan {
  const host = ledger.host, world = host.engine.world as NativeWorld & {env?: {datetime?: string; weather?: Record<string, number>}};
  const m = host.minds.get(soul.soulId), body = m ? world.entities[m.entityId] : undefined;
  if (!m || !body) throw new EdgeError(404, 'not-found', 'this Soul has no body in the world');
  if (ledger.faded.has(soul.soulId)) throw new EdgeError(409, 'soul.faded', 'This Soul has faded out; act again to come back, then look.');
  const bodyOf = (soulId: string, entityId: string, name: string): SightBody | null => {
    const b = world.entities[entityId]; if (!b) return null;
    return {soulId, entityId, name, p: [b.pose.p[0], b.pose.p[1], b.pose.p[2]], yaw: b.pose.yaw, level: Number(b.human?.level ?? 0), enclosure: ledger.enclosureOf(soulId), state: stateOf(host, entityId), activity: String(b.human?.activity ?? 'idle')};
  };
  const me = bodyOf(soul.soulId, m.entityId, m.name)!;
  const current = body.human?.gaze;
  const attention = request.gaze === undefined && current && (current.until === undefined || current.until > world.tick) ? current : null;
  const point = attention?.target ? world.entities[attention.target]?.pose.p : null;
  const at = point ? [point[0], point[2]] : attention?.at;
  const activeYaw = at ? Math.atan2(at[1] - me.p[2], at[0] - me.p[0]) : me.yaw;
  const angle = wrap(activeYaw - me.yaw);
  const direction = Math.abs(angle) > Math.PI * 3/4 ? 'behind' : Math.abs(angle) < Math.PI/4 ? 'forward' : angle < 0 ? 'left' : 'right';
  const gaze = request.mode === 'map' ? {mode:'forward',yaw:me.yaw} : attention && at
    ? {mode:attention.target ? 'target' : direction,yaw:activeYaw, ...(attention.target ? {target:world.entities[attention.target]?.label ?? attention.target} : {}), aim:[at[0], point ? point[1] + 1.3 : me.p[1] + 1.5, at[1]] as [number,number,number]}
    : resolveGaze(ledger, soul, me, request.gaze);
  const hfovDeg = request.mode === 'map' ? 360 : Math.max(50, Math.min(120, Number.isFinite(request.fov) ? request.fov! : 90));
  const pose = eyePose(body as never, me.state, gaze.yaw, Math.min(hfovDeg, 179), request.w, request.h);
  if (request.mode === 'map') pose.hfov = Math.PI * 2;
  // looking at something: tilt the eyes toward it (a fire at your feet, a face across the table), within a natural range
  const aim = (gaze as {aim?: [number, number, number]}).aim;
  if (aim) pose.pitch = Math.round(Math.max(-0.6, Math.min(0.2, Math.atan2(aim[1] - pose.p[1], Math.max(0.5, Math.hypot(aim[0] - pose.p[0], aim[2] - pose.p[2])))) - 0.05) * 1000) / 1000;
  const others: SightBody[] = [];
  for (const o of host.minds.values()) {
    if (o.soulId === soul.soulId || ledger.faded.has(o.soulId)) continue;
    const b = bodyOf(o.soulId, o.entityId, o.name); if (b) others.push(b);
  }
  const fixtures: SightFixture[] = [];
  for (const e of Object.values(world.entities)) {
    if (e.kind === 'human' || SMALL.has(e.def) || (e.kind !== 'fixture' && e.kind !== 'vehicle')) continue;
    fixtures.push({id: e.id, name: fixtureName(e as never), p: [e.pose.p[0], e.pose.p[1], e.pose.p[2]], enclosure: enclosureAt(ledger, e.pose.p[0], e.pose.p[2])});
  }
  const spots: SightFixture[] = ledger.spots.spots.filter(s => s.label).map(s => ({id: s.id, name: plainName(s.label!), p: [s.at[0], 0, s.at[1]], enclosure: enclosureAt(ledger, s.at[0], s.at[1])}));
  const path = ledger.placePathOf(soul.soulId).filter(p => p.kind !== 'occupier'), enc = me.enclosure ? ledger.places.byId.get(me.enclosure) : undefined;
  const containing = new Set(ledger.places.containing(me.p[0], me.p[2], me.level).map(p => p.id));
  const light = lightOf(world.env?.datetime ?? null, world.env?.weather, me.enclosure !== null);
  const sight = computeSight({me, pose, gaze: {mode: gaze.mode, yaw: gaze.yaw, ...(gaze.target ? {target: gaze.target} : {})}, light, place: path[0]?.name ?? null, enclosureName: enc?.name ?? null, others, fixtures, spots,
    places: [...ledger.places.byId.values()], containing, occluders: occludersOf(ledger)});
  if (request.mode === 'map') sight.alt = mapCaption(sight, me);
  return {sight, tick: host.engine.world.tick, me, request,
    render: {mode: request.mode, w: request.w, h: request.h, pose, self: me.entityId, show: sight.souls.map(s => s.entityId), ...(request.mode === 'map' ? {span: MAP_SPAN} : {})}};
}

/** Overhead (map) caption: north up, compass directions from the Soul. Only Souls it could see around it are drawn. */
function mapCaption(s: Sight, me: SightBody): string {
  const dir = (bearingFromGaze: number) => compassOf(wrap(bearingFromGaze + s.gaze.yaw)).compass;
  const span = MAP_SPAN * 2, who = s.souls.filter(o => o.distance <= MAP_SPAN * 1.42);
  const things = s.things.filter(t => t.distance <= MAP_SPAN * 1.42).slice(0, 6);
  const where = s.where.inside ? `inside ${s.where.enclosure ?? 'a building'} (the roof hides the room from above)` : s.where.place ? `at ${s.where.place}` : 'outdoors';
  return `Overhead view ${span} m across, north up, centred on ${me.name} ${where}, who faces ${s.heading.compass} (${s.light.clock ? s.light.clock + ', ' : ''}${s.light.label}). ` +
    (who.length ? `Around: ${who.map(o => `${o.name} ${o.distance < 10 ? o.distance : Math.round(o.distance)} m ${dir(o.bearing)}, ${doingOf(o.state, o.activity)}`).join('; ')}. ` : 'Nobody else is near. ') +
    (things.length ? `Things: ${things.map(t => `${t.count && t.count > 1 ? `${t.count} × ${t.name.toLowerCase()}` : t.name} ${t.distance < 10 ? t.distance : Math.round(t.distance)} m ${dir(t.bearing)}`).join('; ')}. ` : '') +
    'Only Souls this Soul could see from where it stands are drawn; people inside buildings or behind walls are not.';
}
