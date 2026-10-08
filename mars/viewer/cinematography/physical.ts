import { CameraWorld } from '../engine/camera/geom.ts';
import {
  placement,
  sweepCrossing,
  readability,
} from '../engine/camera/quality.ts';
import type { CameraPose } from '../engine/camera/shots.ts';
import type { Observation } from './types.ts';
import {renderVisibility,renderProgram,type RenderProbe} from './types.ts';
import { distance } from './types.ts';
// Camera point + .3m envelope: inflate prisms for entire continuous sweep.
// Actors conservatively boxed at their current causal poses, never modified.
// A decision asks for the same derived worlds hundreds of times (every
// candidate's safePose). Inside withObservationWorlds(o, run) they are built
// once for o; the caller promises not to mutate o during run. Outside a scope
// (or for another observation) every call builds fresh, as before.
let scope: { o: Observation; plain?: CameraWorld; safety?: CameraWorld } | undefined;
export function withObservationWorlds<T>(o: Observation, run: () => T): T {
  if (scope?.o === o) return run();
  const previous = scope;
  scope = { o };
  try { return run(); } finally { scope = previous; }
}
/** CameraWorld over the observation's native scene. */
export function sceneWorld(o: Observation): CameraWorld {
  if (scope?.o !== o) return new CameraWorld(o.scene);
  return (scope.plain ??= new CameraWorld(o.scene));
}
export function safetyWorld(o: Observation): CameraWorld {
  if (scope?.o !== o) return buildSafetyWorld(o);
  return (scope.safety ??= buildSafetyWorld(o));
}
function buildSafetyWorld(o: Observation): CameraWorld {
  const obstacles = [
    ...o.scene.obstacles,
    ...Object.entries(o.subjects)
      .filter(([, s]) => s.kind === 'human')
      .map(([id, s]) => ({
        id: `body:${id}`,
        kind: 'solid' as const,
        obb: {
          c: [s.p[0], s.p[2]] as [number, number],
          half: [0.32, 0.32] as [number, number],
          yaw: 0,
        },
        y0: s.p[1],
        y1: s.p[1] + Math.max(1.75, s.height ?? 1.75),
      })),
  ];
  return new CameraWorld({
    ...o.scene,
    obstacles: obstacles.map((q) => ({
      ...q,
      obb: { ...q.obb, half: [q.obb.half[0] + 0.3, q.obb.half[1] + 0.3] },
      y0: q.y0 - 0.3,
      y1: q.y1 + 0.3,
    })),
  });
}
export function poseValid(p: CameraPose): boolean {
  return (
    [...p.position, ...p.target, p.fov].every(Number.isFinite) &&
    p.fov >= 20 &&
    p.fov <= 80 &&
    distance(p.position, p.target) > 0.1
  );
}
export function safePose(o: Observation, p: CameraPose): boolean {
  return poseValid(p) && placement(safetyWorld(o), p.position, 0).valid;
}
export function execute(
  o: Observation,
  previous: CameraPose | undefined,
  desired: CameraPose,
  editorialCut: boolean,
  dt: number,
  subjects: string[],
  visibility?:RenderProbe,
): { pose?: CameraPose; cut: boolean; reason: string } {
  const world = safetyWorld(o);
  if (!poseValid(desired) || !placement(world, desired.position, 0).valid || renderVisibility(visibility,desired,subjects,o.subjects)<.85)
    return {
      cut: false,
      reason: 'camera.placement-invalid: no safe program pose',
    };
  if (!previous || editorialCut)
    return {
      pose: desired,
      cut: !!previous,
      reason: 'editorial cut between valid viewpoints',
    };
  if (!safePose(o, previous))
    return {
      pose: desired,
      cut: true,
      reason: 'camera.recovery-cut: previous placement became unsafe',
    };
  const length = distance(previous.position, desired.position);
  const u = Math.min(1, (Math.max(0, dt) * 1.5) / Math.max(length, 0.001));
  const blend = (a: number[], b: number[], weight = u) =>
    a.map((v, i) => v + (b[i] - v) * weight) as [number, number, number];
  const position = blend(previous.position, desired.position);
  // Limit the actual viewing ray, not a Cartesian target-point blend. Unequal
  // look distances otherwise amplify a nominal one-degree pan into a jump.
  const oldRay=previous.target.map((v,i)=>v-previous.position[i]);
  let goalRay=desired.target.map((v,i)=>v-position[i]);
  const oldLength=Math.hypot(...oldRay);
  if(Math.hypot(...goalRay)<.1)goalRay=desired.target.map((v,i)=>v-desired.position[i]);
  const goalLength=Math.hypot(...goalRay),a=oldRay.map(v=>v/oldLength),b=goalRay.map(v=>v/goalLength);
  const dot=Math.max(-1,Math.min(1,a.reduce((sum,v,i)=>sum+v*b[i],0))),angle=Math.acos(dot);
  const response=-Math.expm1(-2*Math.max(0,dt));
  const pan=Math.min(1,response,Math.max(0,dt)*Math.PI/3/Math.max(angle,1e-12));
  const cross=(x:number[],y:number[])=>[x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0]];
  let axis=cross(a,b),axisLength=Math.hypot(...axis);
  if(axisLength<1e-8){axis=cross(a,Math.abs(a[1])<.9?[0,1,0]:[1,0,0]);axisLength=Math.hypot(...axis);}
  axis=axis.map(v=>v/axisLength);
  const theta=angle*pan,c=Math.cos(theta),sin=Math.sin(theta),side=cross(axis,a),axial=axis.reduce((sum,v,i)=>sum+v*a[i],0);
  const direction=a.map((v,i)=>v*c+side[i]*sin+axis[i]*axial*(1-c));
  const lookLength=oldLength+(goalLength-oldLength)*response;
  const fovDelta = Math.max(-dt*5,Math.min(dt*5,desired.fov-previous.fov));
  const stationary=previous.fov===desired.fov&&previous.position.every((v,i)=>v===desired.position[i])&&previous.target.every((v,i)=>v===desired.target[i]);
  // Identical rays must retain their exact target: normalization/acos can invent
  // a tiny pan. The ordinary safety and visibility checks below still apply.
  const pose:CameraPose = stationary ? {position:[...previous.position],target:[...previous.target],fov:previous.fov} : {
    position,
    target:dt<=0?[...previous.target]:position.map((v,i)=>v+direction[i]*lookLength) as [number,number,number],
    fov:previous.fov+fovDelta,
  };
  if (sweepCrossing(world, previous.position, pose.position))
    return {
      pose: desired,
      cut: true,
      reason:
        'camera.sweep-cut: continuous transition crosses clearance envelope',
    };
  const read = readability(
    sceneWorld(o),
    pose,
    o.subjects,
    subjects,
    { aspect: o.aspect, minSize: 0.08 },
  ).score;
  if (!placement(world, pose.position, 0).valid || read < 0.55 || renderVisibility(visibility,pose,subjects,o.subjects)<.85 ||
    // A blend between two clear poses may graze a rendered wall or face a shell: cut instead.
    !renderProgram(visibility,pose,subjects,o.subjects))
    return {
      pose: desired,
      cut: true,
      reason: 'camera.visibility-recovery-cut: blend is unreadable',
    };
  return { pose, cut: false, reason: 'bounded smooth tracking' };
}
