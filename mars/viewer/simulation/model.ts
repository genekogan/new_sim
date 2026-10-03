import * as THREE from 'three';
import { definitions } from './commands';
import {
  CampusPaths,
  GROUND,
  campfireClearing,
} from '../app/studio/ambience-math';
import defaultCatalog from './catalog.json';
import historicalCatalogs from './history-catalogs.json';
import {
  clearWeather,
  screenIds,
  cameraPose,
  riderPose,
  perimeter,
  eucDistance,
  motionPose,
  simTime,
  hourAt,
  type SimState,
  type Vec3,
  type Motion,
} from './shared';
type Catalog = {people:{id:string;position:number[];roaming:boolean;yaw?:number}[];obstacles:number[][][];bounds:number[][]};
export function createSimulationModel(catalog: Catalog, year = 2026) {
// Immutable geometry is shared; every room's mutable state lives in its Durable Object.
const obstacles = catalog.obstacles.map(
  ([a, b]) => new THREE.Box3(new THREE.Vector3(...a), new THREE.Vector3(...b)),
);
const firePosition = campfireClearing(
  new CampusPaths(obstacles),
)?.toArray() as Vec3 | undefined;
if (firePosition)
  obstacles.push(
    new THREE.Box3().setFromCenterAndSize(
      new THREE.Vector3(...firePosition),
      new THREE.Vector3(2, 4, 2),
    ),
  );
const nav = new CampusPaths(obstacles);
const riderPath = perimeter(catalog.bounds);
const riderNav = new CampusPaths(obstacles, 220);
const riderDocks = Array.from(
  { length: 6 },
  (_, i) =>
    riderNav
      .point(riderNav.nearest(new THREE.Vector3(-12 + i * 2, GROUND, 28)))
      .toArray() as Vec3,
);
function routed(from: Vec3, to: Vec3): Vec3[] {
  const a = new THREE.Vector3(...from),
    b = new THREE.Vector3(...to);
  if (riderNav.clearLine(a, b)) return [from, to];
  const start = riderNav.nearest(a, 2),
    end = riderNav.nearest(b, 2),
    ids = riderNav.pathTo(start, end);
  if (
    !ids.length ||
    !riderNav.clearLine(a, riderNav.point(start)) ||
    !riderNav.clearLine(riderNav.point(end), b)
  )
    throw Error('No clear EUC route to destination');
  // Reduce route payload and turns without cutting through obstacles.
  const raw = [a, ...ids.map((id) => riderNav.point(id)), b],
    result = [a];
  let i = 0;
  while (i < raw.length - 1) {
    let j = Math.min(raw.length - 1, i + 24);
    while (j > i + 1 && !riderNav.clearLine(raw[i], raw[j])) j--;
    result.push(raw[j]);
    i = j;
  }
  return result.map((p) => p.toArray() as Vec3);
}
function pathSeconds(path: Vec3[], speed: number) {
  return (
    path
      .slice(1)
      .reduce(
        (n, p, i) => n + Math.hypot(...p.map((v, k) => v - path[i][k])),
        0,
      ) / speed
  );
}
function normalizeState(s: SimState, now: number): SimState {
  if (!s.clock) s.clock = { real: now, virtual: s.pausedAt ?? now, rate: 1 };
  s.weather ??= { ...clearWeather };
  s.riders ??= {};
  s.screens ??= Object.fromEntries(
    screenIds.map((id) => [
      id,
      { enabled: false, program: 'art', brightness: 1, title: 'Mars College' },
    ]),
  );
  return s;
}
const entities = catalog.people.map((p) => ({
  id: p.id,
  position: p.position as Vec3,
  canWalk: p.roaming,
}));
function wander(
  position: Vec3,
  index: number,
  now: number,
  stagger = false,
): Motion {
  const start = nav.nearest(new THREE.Vector3(...position)),
    ids = nav.route(start, 31 + index * 171),
    path = ids.map((id) => nav.point(id).toArray() as Vec3);
  const loop =
    path.length > 1 ? [...path, ...path.slice(0, -1).reverse()] : [position];
  return {
    path: stagger ? loop : [position, ...loop, position],
    started: now - (stagger ? index * 1600 : 0),
    speed: 0.85,
    loop: true,
    yaw: 0,
    activity: 'wander',
  };
}
function initialState(now: number): SimState {
  return normalizeState(
    {
      revision: 0,
      epoch: now,
      motionEpoch: now,
      pausedAt: null,
      people: Object.fromEntries(
        catalog.people.map((p, i) => [
          p.id,
          p.roaming
            ? wander(p.position as Vec3, i, now, true)
            : {
                path: [p.position as Vec3],
                started: now,
                speed: 0.85,
                loop: false,
                yaw: p.yaw ?? 0,
                activity: 'idle',
              },
        ]),
      ),
      environment: { hour: 16, cycle: false },
      fire: 'auto',
      euc: { count: year === 2020 ? 2 : 3, speed: 3, enabled: true, distance: 0, at: now },
      camera: null,
      activity: null,
    },
    now,
  );
}
function move(
  s: SimState,
  id: string,
  target: Vec3,
  now: number,
  activity: Motion['activity'] = 'idle',
) {
  const p = s.people[id];
  if (!p) throw Error('Unknown person ID. Call get_state for the entity list.');
  if (!entities.find((e) => e.id === id)?.canWalk)
    throw Error(
      'This indoor person has no ground-level route. Wave/talk/idle are supported; stair and interior navigation are not yet mapped.',
    );
  if (Math.abs(target[1] - GROUND) > 0.1)
    throw Error('Walking destinations must use ground y=-0.16.');
  const pose = motionPose(p, simTime(s, now)),
    start = nav.nearest(new THREE.Vector3(...pose.position), 2),
    end = nav.nearest(new THREE.Vector3(...target), 1.5),
    ids = nav.pathTo(start, end);
  if (
    !ids.length ||
    !nav.clearLine(new THREE.Vector3(...pose.position), nav.point(start)) ||
    !nav.clearLine(nav.point(end), new THREE.Vector3(...target))
  )
    throw Error(
      'Destination is blocked, outside the mapped walking area (-60…60 m), or unreachable.',
    );
  const path = [
    pose.position,
    ...ids.map((n) => nav.point(n).toArray() as Vec3),
    target,
  ];
  s.people[id] = {
    ...p,
    path,
    loop: false,
    started: simTime(s, now),
    activity,
    yaw: pose.yaw,
  };
}
function command(s: SimState, name: string, args: unknown, now: number) {
  s = normalizeState(structuredClone(s), now); // Failed multi-person commands never partially mutate their caller.
  const time = simTime(s, now);
  if (name === 'apply_scene') {
    const a = definitions.apply_scene.schema.parse(args),
      revision = s.revision;
    for (const item of a.commands) {
      if (
        item.name === 'apply_scene' ||
        item.name === 'reset_simulation' ||
        !Object.hasOwn(definitions, item.name)
      )
        throw Error('Invalid batch command');
      s = command(s, item.name, item.args, now);
    }
    s.revision = revision + 1;
    if (s.camera) s.camera.revision = s.revision;
    return s;
  } else if (name === 'move_group') {
    const a = definitions.move_group.schema.parse(args),
      ids =
        a.people === 'all'
          ? entities.filter((p) => p.canWalk).map((p) => p.id)
          : a.people;
    if (new Set(ids).size !== ids.length)
      throw Error('Person IDs must be unique');
    ids.forEach((id, i) =>
      move(
        s,
        id,
        [
          a.x + ((i % 3) - Math.min(2, ids.length - 1) / 2) * a.spacing,
          GROUND,
          a.z + Math.floor(i / 3) * a.spacing,
        ],
        now,
        'gather',
      ),
    );
    s.activity = { name: 'gathering', people: ids, target: [a.x, GROUND, a.z] };
  } else if (name === 'set_weather') {
    const a = definitions.set_weather.schema.parse(args),
      presets = {
        clear: { ...clearWeather, clouds: 0.15 },
        cloudy: { ...clearWeather, clouds: 0.9 },
        rainy: { ...clearWeather, clouds: 1, rain: 0.8, wind: 0.45 },
        windy: { ...clearWeather, wind: 1, dust: 0.2 },
        dusty: { ...clearWeather, wind: 0.8, dust: 0.85, clouds: 0.25 },
      };
    s.weather = { ...(a.preset ? presets[a.preset] : s.weather!) };
    for (const key of ['clouds', 'rain', 'wind', 'dust'] as const)
      if (a[key] !== undefined) s.weather[key] = a[key];
    if (a.wind_direction !== undefined)
      s.weather.windDirection = a.wind_direction;
  } else if (name === 'set_simulation_speed') {
    s.clock = {
      real: now,
      virtual: time,
      rate: definitions.set_simulation_speed.schema.parse(args).rate,
    };
  } else if (name === 'set_screens') {
    const { screens, ...a } = definitions.set_screens.schema.parse(args);
    for (const id of screens === 'all' ? screenIds : screens)
      s.screens![id] = { ...s.screens![id], ...a };
  } else if (name === 'command_euc_riders') {
    const a = definitions.command_euc_riders.schema.parse(args),
      ids =
        a.riders === 'all'
          ? Array.from({ length: s.euc.count }, (_, i) => `euc-${i + 1}`)
          : a.riders;
    if (!s.euc.enabled || !ids.length)
      throw Error('Enable riders with set_euc_riders first');
    if (new Set(ids).size !== ids.length)
      throw Error('Rider IDs must be unique');
    for (const id of ids) {
      const i = Number(id.slice(4)) - 1;
      if (i >= s.euc.count) throw Error('Selected rider is not enabled');
      const pose = riderPose(s, now, riderPath, i);
      const motion = {
        path: [pose.position],
        started: time,
        speed: s.euc.speed,
        loop: false,
        yaw: pose.yaw,
        activity: 'idle' as const,
      };
      if (a.action === 'return')
        motion.path = routed(pose.position, riderDocks[i]);
      let approach;
      if (a.action === 'circle') {
        let closest = 0;
        for (let k = 1; k < riderPath.length - 1; k++)
          if (
            Math.hypot(
              pose.position[0] - riderPath[k][0],
              pose.position[2] - riderPath[k][2],
            ) <
            Math.hypot(
              pose.position[0] - riderPath[closest][0],
              pose.position[2] - riderPath[closest][2],
            )
          )
            closest = k;
        approach = {
          ...motion,
          path: routed(pose.position, riderPath[closest]),
        };
        motion.path = [
          ...riderPath.slice(closest, -1),
          ...riderPath.slice(0, closest + 1),
        ];
        motion.loop = true;
        motion.started = time + pathSeconds(approach.path, motion.speed) * 1000;
      }
      s.riders![id] = {
        motion,
        approach,
        action: a.action,
        dismount:
          (a.action === 'stop' && pose.dismounted) ||
          a.action === 'dismount' ||
          (a.action === 'return' && a.dismount_on_arrival),
      };
    }
  } else if (name === 'set_camera_trajectory' || name === 'set_camera_path') {
    let points: { position: Vec3; target: Vec3 }[],
      duration: number,
      loop: boolean;
    if (name === 'set_camera_trajectory') {
      const a = definitions.set_camera_trajectory.schema.parse(args);
      duration = a.duration;
      loop = a.loop;
      const segments = Math.abs(a.turns) * 96;
      points = Array.from({ length: segments + 1 }, (_, i) => {
        const t = i / segments,
          blend = loop ? (1 - Math.cos(t * Math.PI * 2)) / 2 : t,
          angle = t * a.turns * Math.PI * 2;
        const r = a.radius + ((a.end_radius ?? a.radius) - a.radius) * blend,
          y = a.height + ((a.end_height ?? a.height) - a.height) * blend;
        const position: Vec3 = [
          a.target[0] + Math.cos(angle) * r,
          y,
          a.target[2] + Math.sin(angle) * r,
        ];
        if (position.some((v, k) => Math.abs(v) > (k === 1 ? 200 : 300)))
          throw Error('Trajectory exceeds camera bounds');
        return { position, target: a.target };
      });
    } else {
      const a = definitions.set_camera_path.schema.parse(args);
      points = a.points;
      duration = a.duration;
      loop = a.loop;
      if (loop) points = [...points, points[0]];
    }
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (Math.hypot(...p.position.map((v, k) => v - p.target[k])) < 0.1)
        throw Error('Camera and target must differ');
      if (i) {
        const q = points[i - 1],
          d = q.position.map((v, k) => v - q.target[k]),
          v = p.position.map((n, k) => n - p.target[k] - d[k]),
          den = v.reduce((n, k) => n + k * k, 0),
          t = den
            ? Math.max(
                0,
                Math.min(1, -d.reduce((n, k, j) => n + k * v[j], 0) / den),
              )
            : 0;
        if (Math.hypot(...d.map((n, k) => n + t * v[k])) < 0.1)
          throw Error('Camera path crosses its look-at target');
      }
    }
    s.camera = {
      ...points[0],
      revision: s.revision + 1,
      route: { points, started: time, duration, loop },
    };
  } else if (name === 'stop_camera') {
    const pose = cameraPose(s, now);
    if (pose)
      s.camera = {
        position: pose.position,
        target: pose.target,
        revision: s.revision + 1,
      };
  } else if (name === 'move_person') {
    const a = definitions.move_person.schema.parse(args);
    move(s, a.person_id, [a.x, GROUND, a.z], now);
  } else if (name === 'set_person_activity') {
    const a = definitions.set_person_activity.schema.parse(args);
    const p = s.people[a.person_id];
    if (!p) throw Error('Unknown person ID');
    const pose = motionPose(p, time);
    if (a.activity === 'wander') {
      if (!entities.find((e) => e.id === a.person_id)?.canWalk)
        throw Error('Only outdoor people can wander');
      s.people[a.person_id] = wander(
        pose.position,
        entities.findIndex((e) => e.id === a.person_id),
        time,
      );
    } else
      s.people[a.person_id] = {
        ...p,
        path: [pose.position],
        started: time,
        loop: false,
        activity: a.activity,
        yaw: pose.yaw,
      };
  } else if (name === 'set_environment') {
    const a = definitions.set_environment.schema.parse(args);
    s.environment = {
      hour: a.hour ?? hourAt(s, now),
      cycle: a.cycle ?? s.environment.cycle,
      daySeconds: a.day_seconds ?? s.environment.daySeconds ?? 480,
    };
    s.epoch = time;
  } else if (name === 'set_fire')
    s.fire = definitions.set_fire.schema.parse(args).mode;
  else if (name === 'set_euc_riders') {
    const next = definitions.set_euc_riders.schema.parse(args);
    if (next.speed !== undefined)
      for (const m of Object.values(s.riders!))
        for (const motion of [m.motion, ...(m.approach ? [m.approach] : [])]) {
          motion.started =
            time - ((time - motion.started) * motion.speed) / next.speed;
          motion.speed = next.speed;
        }
    s.euc = {
      ...s.euc,
      ...definitions.set_euc_riders.schema.parse(args),
      distance: eucDistance(s, now),
      at: time,
    };
  } else if (name === 'set_camera') {
    const a = definitions.set_camera.schema.parse(args);
    if (
      Math.hypot(...a.position.map((v: number, i: number) => v - a.target[i])) <
      0.1
    )
      throw Error('Camera and look-at target must differ');
    s.camera = {
      position: a.position,
      target: a.target,
      revision: s.revision + 1,
    };
  } else if (name === 'start_activity') {
    const a = definitions.start_activity.schema.parse(args);
    if (new Set(a.people).size !== a.people.length)
      throw Error('Person IDs must be unique');
    const target: Vec3 =
      a.name === 'campfire' && firePosition ? firePosition : [a.x, GROUND, a.z];
    // Validate every route on the cloned state before committing the command.
    a.people.forEach((id: string, i: number) => {
      const angle = (i / a.people.length) * Math.PI * 2;
      move(
        s,
        id,
        [
          target[0] + Math.cos(angle) * 3.5,
          GROUND,
          target[2] + Math.sin(angle) * 3.5,
        ],
        now,
        a.name === 'talk' ? 'talk' : 'gather',
      );
    });
    s.activity = { name: a.name, people: a.people, target };
    if (a.name === 'campfire') s.fire = 'on';
  } else if (name === 'set_paused') {
    const a = definitions.set_paused.schema.parse(args);
    s.clock = { real: now, virtual: time, rate: s.clock!.rate };
    s.pausedAt = a.paused ? time : null;
  } else if (name === 'reset_simulation') {
    const revision = s.revision;
    Object.assign(s, initialState(now));
    s.revision = revision;
  } else throw Error('Unknown command');
  if (
    (name === 'move_person' || name === 'set_person_activity') &&
    s.activity
  ) {
    const { person_id } = definitions.set_person_activity.schema
      .pick({ person_id: true })
      .parse(args);
    s.activity.people = s.activity.people.filter((id) => id !== person_id);
    if (!s.activity.people.length) s.activity = null;
  }
  s.revision++;
  return s;
}

return {firePosition,riderPath,riderDocks,entities,normalizeState,initialState,move,command,catalog,year};
}
const models = new Map<number,ReturnType<typeof createSimulationModel>>();
export function modelForYear(year=2026) {
 if(!Number.isInteger(year)||year<2020||year>2026)throw Error('Invalid campus year');
 let model=models.get(year);
 if(!model){model=createSimulationModel(year===2026?defaultCatalog:(historicalCatalogs as Record<string,Catalog>)[String(year)],year);models.set(year,model);}
 return model;
}
export const {firePosition,riderPath,riderDocks,entities,normalizeState,initialState,move,command}=modelForYear();
