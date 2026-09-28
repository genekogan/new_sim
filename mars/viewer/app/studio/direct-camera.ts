// Camera direction in the studio (docs/engineering/STUDIO_REPLAY.md, CAMERA_DIRECT.md). The public takes are files,
// not takes stored in a simulation room, so the studio runs the pure-TS compiler itself (`directCamera`: direct.ts
// + synth.ts + correct.ts) with the same inputs as the `engine_direct_camera` op and the recorder:
// - scene: the take's static camera scene — the 2026 campus cropped ±40 m around the take's site (the recorder's
//   crop), or for a year-build fork the year scene without the building (`yearBuildScene`, checked against the
//   take's `base.staticHash`) — plus the take's installed parts as collision-only prisms;
// - world = take.finalState (names, regions, light), sampler = takeSampler(take), facts = takeFacts(take).
// Lazy-imported: none of this is in the studio's main chunk.
import { hashOf } from '../../engine/core/hash.ts';
import { cropScene, sceneFromFile, CAMPUS_2026_URL } from '../../engine/campus/load.ts';
import { loadCampus2026 } from '../../engine/campus/world.ts';
import { campusYearUrl, loadCampusYear, sceneFromYearFile, type CampusYearFile } from '../../engine/campus/history.ts';
import { assemblyGraph } from '../../engine/campus/assembly.ts';
import { buildingFootprint } from '../../engine/campus/bom.ts';
import { yearBuildScene } from '../../engine/campus/sequence.ts';
import { takeFacts } from '../../engine/camera/direct.ts';
import { directCamera, type DirectResult } from '../../engine/camera/synth.ts';
import { DEFAULT_CAMERA_POLICY, type CameraPolicy } from '../../engine/camera/geom.ts';
import { takeSampler } from '../../engine/camera/take-sampler.ts';
import { toCameraTrack, trackData } from '../../engine/camera/track.ts';
import { entityFootprint } from '../../engine/spatial/service.ts';
import { takeDuration } from '../../engine/take/replay.ts';
import type { CampusSceneFile } from '../../engine/campus/types.ts';
import type { Obstacle, SpatialScene } from '../../engine/spatial/types.ts';
import type { Take } from '../../engine/take/types.ts';
import type { WorldState } from '../../engine/world/types.ts';
import type { ActiveTrack, TakeReplayFile } from '../engine-view/take-replay.ts';

/** Parts never occlude in the planner (they come per tick from the sampler); the finished build may not be crossed. */
export const DIRECT_POLICY: CameraPolicy = { ...DEFAULT_CAMERA_POLICY, component: { collide: true, occlude: false } };
const BUILD = /^mars-(\d{4}):build:(.+)$/;

const files = new Map<string, Promise<unknown>>();
/** The year's campus scene file (`/engine/campus-<year>.json`), fetched once per page. */
export function yearFile(year: number): Promise<CampusYearFile & { groundY: number }> {
  const url = year === 2026 ? CAMPUS_2026_URL : campusYearUrl(year);
  let p = files.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return r.json();
    });
    files.set(url, p);
  }
  return p as Promise<CampusYearFile & { groundY: number }>;
}

/** Year and building of a year-build fork (`base.campus` = `mars-<year>:build:<assembly>`), else null. */
export function buildOf(take: Take): { year: number; assembly: string } | null {
  const m = BUILD.exec(take.finalState.base.campus);
  return m ? { year: Number(m[1]), assembly: m[2] } : null;
}

export type TakeCameraScene = { scene: SpatialScene; source: string; baseHash: string; sceneHash: string; matchesBase: boolean | null };

/** The static camera scene of a take (see the header), plus whether it hashes to the take's recorded base. */
export async function takeCameraScene(file: TakeReplayFile): Promise<TakeCameraScene> {
  const take = file.take;
  const build = buildOf(take);
  let scene: SpatialScene, source: string, matchesBase: boolean | null = null;
  if (build) {
    const base = sceneFromYearFile(build.year, await yearFile(build.year));
    const g = assemblyGraph(build.year, base);
    const fp = buildingFootprint(g.nodes.filter((n) => n.assembly === build.assembly));
    scene = yearBuildScene(base, build.assembly, fp.c, 35);
    matchesBase = hashOf(scene) === take.finalState.base.staticHash;
    source = `mars-${build.year} without ${build.assembly} (35 m around it, ground at the Kit datum)`;
  } else if (take.finalState.base.campus === 'mars-2026') {
    const o = file.site?.origin ?? [0, 0];
    scene = cropScene(sceneFromFile((await yearFile(2026)) as unknown as CampusSceneFile), [o[0] - 40, o[1] - 40, o[0] + 40, o[1] + 40]);
    source = `mars-2026 cropped ±40 m around the site (${o.join(', ')})`;
  } else {
    const year = Number(/^mars-(\d{4})/.exec(take.finalState.base.campus)?.[1] ?? NaN);
    scene = sceneFromYearFile(year, await yearFile(year));
    source = `mars-${year}`;
  }
  const solids: Obstacle[] = Object.values(take.finalState.entities)
    .filter((e) => e.kind === 'component' && e.phase === 'installed')
    .map((e) => ({ id: `take:${e.id}`, kind: 'component', label: `hypothetical ${e.def} ${e.id}`, ...entityFootprint(e) }));
  return { scene: { ...scene, obstacles: [...scene.obstacles, ...solids] }, source, baseHash: take.finalState.base.staticHash, sceneHash: hashOf(scene), matchesBase };
}

export type Directed = {
  result: DirectResult;
  /** Present when the compile succeeded: a track the replay can drive the engine camera with (take coordinates). */
  track?: ActiveTrack;
  ms: number;
  scene: string;
};

const trackOf = (result: DirectResult, takeId: string, key: unknown, hz: number): ActiveTrack | undefined => {
  if (!result.ok) return undefined;
  const id = `dir-${hashOf({ take: takeId, directions: key, hz }).slice(0, 12)}`; // as the engine_direct_camera op names it
  const t = toCameraTrack(id, takeId, result.plan, 'directed');
  return { id, kind: 'directed', data: trackData(t) };
};

const sceneCache = new WeakMap<Take, Promise<TakeCameraScene>>();
/** Directions against an open take (as `engine_direct_camera { take_id, directions, correct }`). */
export async function directForTake(file: TakeReplayFile, directions: unknown[], opts: { correct?: boolean; hz?: number; datetime?: string } = {}): Promise<Directed> {
  let sc = sceneCache.get(file.take);
  if (!sc) sceneCache.set(file.take, (sc = takeCameraScene(file)));
  const { scene, source } = await sc;
  const take = file.take, hz = opts.hz ?? 10;
  const world: WorldState = opts.datetime ? { ...take.finalState, env: { ...take.finalState.env, datetime: opts.datetime } } : take.finalState;
  const t0 = performance.now();
  const result = directCamera(directions, { scene, world, sampler: takeSampler(take), facts: takeFacts(take), duration: takeDuration(take), hz, policy: DIRECT_POLICY, ...(opts.correct === false ? { correct: false } : {}) });
  return { result, track: trackOf(result, take.id, { directions, correct: opts.correct, datetime: opts.datetime }, hz), ms: Math.round(performance.now() - t0), scene: source };
}

/**
 * Directions against the year's canonical campus with nobody in it (the fixtures' `campus2026()` / `campus2024()`):
 * the Chiba sunset pan and the 2024 kitchen move have no take. `crop` = [x0, z0, x1, z1]; `duration` = the clock.
 */
export async function directOnYear(year: number, directions: unknown[], opts: { datetime?: string; crop?: [number, number, number, number]; duration?: number; correct?: boolean; hz?: number } = {}): Promise<Directed> {
  const f = await yearFile(year);
  const { base, world } = year === 2026 ? loadCampus2026(f as unknown as CampusSceneFile, { flagshipInventory: false }) : loadCampusYear(year, f);
  const scene = opts.crop ? cropScene(base, opts.crop) : base;
  const w: WorldState = opts.datetime ? { ...world, env: { ...world.env, datetime: opts.datetime } } : world;
  const hz = opts.hz ?? 10, duration = opts.duration ?? 120;
  const t0 = performance.now();
  const result = directCamera(directions, { scene, world: w, sampler: () => ({}), duration, hz, ...(opts.correct === false ? { correct: false } : {}) });
  return { result, track: trackOf(result, `mars-${year}`, { directions, opts }, hz), ms: Math.round(performance.now() - t0), scene: `mars-${year}${opts.crop ? ` cropped to [${opts.crop.join(', ')}]` : ''}, no people` };
}
