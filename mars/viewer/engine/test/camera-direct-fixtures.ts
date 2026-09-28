// Shared fixtures for camera-direct / camera-synth tests (OWNER_FEEDBACK_2026-09-28 §11): the recorded flagship
// take on Mars 2026, the 2026 campus around Chiba, the 2024 campus around the kitchen, and a synthetic room.
// Memoised per process; everything is read-only.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { cropScene, sceneFromFile } from '../campus/load.ts';
import { readCampus2026File } from '../campus/node.ts';
import { loadCampus2026 } from '../campus/world.ts';
import { loadCampusYear } from '../campus/history.ts';
import { loadCampusFile } from '../campus/history-node.ts';
import { entityFootprint } from '../spatial/service.ts';
import { DEFAULT_CAMERA_POLICY, type CameraPolicy } from '../camera/geom.ts';
import { takeSampler } from '../camera/take-sampler.ts';
import { takeFacts } from '../camera/direct.ts';
import { takeDuration } from '../take/replay.ts';
import { emptyWorld, FIXTURE } from '../world/factory.ts';
import { sunTimes } from '../env/sun.ts';
import type { DirectInput } from '../camera/synth.ts';
import type { Obstacle, SpatialScene } from '../spatial/types.ts';
import type { Take } from '../take/types.ts';
import type { WorldState } from '../world/types.ts';

const TAKE_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/engine/takes/flagship-campus-2026.json');

let flag: { take: Take; site: { origin: [number, number] }; input: DirectInput } | undefined;
/** The committed flagship take (public/engine/takes) with the recorder's camera scene: ±40 m campus crop + the finished bay as collision-only prisms. */
export function flagship() {
  if (flag) return flag;
  const f = JSON.parse(readFileSync(TAKE_FILE, 'utf8')) as { take: Take; site: { origin: [number, number] } };
  const take = f.take;
  const o = f.site.origin;
  const local = cropScene(sceneFromFile(readCampus2026File()), [o[0] - 40, o[1] - 40, o[0] + 40, o[1] + 40]);
  const build: Obstacle[] = Object.values(take.finalState.entities)
    .filter((e) => e.kind === 'component' && e.phase === 'installed')
    .map((e) => ({ id: `take:${e.id}`, kind: 'component', label: `hypothetical ${e.def} ${e.id}`, ...entityFootprint(e) }));
  const scene = { ...local, obstacles: [...local.obstacles, ...build] };
  const policy: CameraPolicy = { ...DEFAULT_CAMERA_POLICY, component: { collide: true, occlude: false } };
  flag = { take, site: f.site, input: { scene, world: take.finalState, sampler: takeSampler(take), facts: takeFacts(take), duration: takeDuration(take), policy } };
  return flag;
}

/** Local time `minutes` before sunset on the given date (HH:MM, Bombay Beach). */
export function beforeSunset(date: string, minutes: number): string {
  const st = sunTimes(`${date}T12:00`).sunsetLocal!;
  const m = Number(st.slice(11, 13)) * 60 + Number(st.slice(14, 16)) - minutes;
  return `${date}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

let c26: { scene: SpatialScene; world: WorldState } | undefined;
/** The whole Mars 2026 campus, no people; env.datetime as loaded (16:00). Clone the world before changing it. */
export function campus2026() {
  if (c26) return c26;
  const { base, world } = loadCampus2026(readCampus2026File(), { flagshipInventory: false });
  c26 = { scene: base, world };
  return c26;
}

let y24: { scene: SpatialScene; world: WorldState } | undefined;
/** Mars 2024 around the communal kitchen (the 2026 scene has no kitchen region or sink fixture). */
export function campus2024() {
  if (y24) return y24;
  const { base, world } = loadCampusYear(2024, loadCampusFile(2024));
  y24 = { scene: cropScene(base, [-30, 15, 35, 70]), world };
  return y24;
}

export const withTime = (world: WorldState, datetime: string): WorldState => ({ ...world, env: { ...world.env, datetime } });

/**
 * Synthetic 6×6 m room (walls 0.1 m thick, 2.5 m high) at the origin inside a 20×20 m yard.
 * door: a 1.6 m opening (lintel from 2.1 m) in the south (+z) wall; roof: a slab over the room at 2.5–2.6 m.
 */
export function roomScene(opts: { door: boolean; roof: boolean }): { scene: SpatialScene; world: WorldState } {
  const wall = (id: string, cx: number, cz: number, hx: number, hz: number, y0 = 0, y1 = 2.5): Obstacle => ({ id, kind: 'wall', label: id, obb: { c: [cx, cz], half: [hx, hz], yaw: 0 }, y0, y1 });
  const obstacles: Obstacle[] = [wall('north wall', 0, -3, 3.05, 0.05), wall('east wall', 3, 0, 0.05, 3.05), wall('west wall', -3, 0, 0.05, 3.05)];
  if (opts.door) obstacles.push(wall('south wall west of the door', -1.9, 3, 1.15, 0.05), wall('south wall east of the door', 1.9, 3, 1.15, 0.05), wall('door lintel', 0, 3, 0.8, 0.05, 2.1, 2.5));
  else obstacles.push(wall('south wall', 0, 3, 3.05, 0.05));
  if (opts.roof) obstacles.push({ id: 'roof', kind: 'solid', label: 'roof', obb: { c: [0, 0], half: [3.1, 3.1], yaw: 0 }, y0: 2.5, y1: 2.6 });
  const scene: SpatialScene = { bounds: [-10, -10, 10, 10], levels: [{ id: 0, y: 0, label: 'ground' }], surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [10, 10], yaw: 0 } }], obstacles, links: [] };
  const world = emptyWorld('synthetic-room', scene);
  world.regions.room = { id: 'room', label: 'the room', kind: 'place', polygon: [[-2.95, -2.95], [2.95, -2.95], [2.95, 2.95], [-2.95, 2.95]], provenance: FIXTURE };
  return { scene, world };
}
