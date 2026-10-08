import type { Vec3 } from '../engine/core/math.ts';
import type { SpatialScene } from '../engine/spatial/types.ts';
import type {
  CameraPose,
  SubjectPose,
  ShotSpec,
} from '../engine/camera/shots.ts';
export type Policy = 'clear' | 'restrained' | 'continuous';
export type Intention =
  | 'establishing'
  | 'speaker'
  | 'speaker-display'
  | 'questioner'
  | 'two-person'
  | 'follow'
  | 'context';
export type Observation = {
  schema: 'mars-camera-observation/1';
  session: string;
  tick: number;
  time: number;
  aspect: number;
  semanticVersion: number;
  geometryVersion: number;
  eventCursor: number;
  subjects: Record<string, SubjectPose>;
  activity: {
    phase: string;
    speaker?: string;
    presenter?: string;
    focus?: string;
    members: string[];
    display?: string;
    departing: string[];
  };
  scene: SpatialScene;
};
export type Shot = {
  variant: string;
  spec: ShotSpec;
  id: string;
  intention: Intention;
  subjects: string[];
  pose: CameraPose;
  quality: number;
  valid: boolean;
  reasons: string[];
  side: number;
};
export type OperatorIntent = {
  subject?: string;
  shot?: Intention;
  policy?: Policy;
  pose?: CameraPose;
  movement?: 'still' | 'follow';
  expires: number;
};
export type Decision = {
  time: number;
  tick: number;
  session: string;
  semanticVersion: number;
  epoch: number;
  shot: string;
  source: 'local' | 'external' | 'operator' | 'replay';
  reason: string;
  cut: boolean;
  pose: CameraPose;
};
export type Request = {
  session: string;
  version: number;
  epoch: number;
  time: number;
  policy: Policy;
  current?: string;
  heldSeconds: number;
  canCut: boolean;
  recent: string[];
  operator?: OperatorIntent;
  activity: Observation['activity'];
  candidates: Pick<
    Shot,
    'id' | 'intention' | 'subjects' | 'quality' | 'reasons'
  >[];
};
export type Reply = {
  choice: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  costUSD: number;
};
export interface DirectorProvider {
  choose(request: Request, signal: AbortSignal): Promise<Reply>;
}
export const distance = (a: Vec3, b: Vec3) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Optional local render-only composition probe; never part of wire observation. */
export type RenderVisibility=(pose:CameraPose,ids:readonly string[],subjects:Record<string,SubjectPose>)=>number;
/** Optional rendered-geometry queries for enclosed (indoor) framing. Both are
 * read-only, synchronous and must be deterministic for unchanged geometry.
 * clear: no opaque rendered surface, facing either way, within radius of p
 * along the three axes (camera inside a wall solid or wedged against one fails).
 * reach: distance from a toward b to the first opaque rendered surface on the
 * segment (either facing), or Infinity when a→b is unobstructed. */
/** seen: the visibility rule cast from the camera, i.e. as faces are drawn.
 * It catches single-sided shells; costlier, so only the chosen pose is asked. */
/** around: reach in eight horizontal directions (azimuth k*45deg from +x
 * toward +z), then a ninth straight up, each capped at far; undefined when
 * fewer than `walls` horizontal reaches end before far. Memoisable. */
/** foreground: fraction of a sparse frustum grid (subject centre excluded)
 * whose rays meet an opaque rendered wall-like surface before 0.6 of the
 * subject distance, i.e. how much of the frame a near wall/jamb would fill. */
export type RenderProbe=RenderVisibility&{clear?:(p:Vec3,radius:number)=>boolean;reach?:(a:Vec3,b:Vec3)=>number;seen?:RenderVisibility;around?:(p:Vec3,far:number,walls?:number)=>readonly number[]|undefined;foreground?:(pose:CameraPose,aspect:number)=>number};
/** Rendered clearance kept around a program camera (near plane is 0.1 m). */
export const RENDER_CLEARANCE=.4;
export const renderClear=(probe:RenderProbe|undefined,p:Vec3)=>!probe?.clear||probe.clear(p,RENDER_CLEARANCE);
/** Final program check: rendered clearance and the subject seen from the camera. */
export const renderProgram=(probe:RenderProbe|undefined,pose:CameraPose,ids:readonly string[],subjects:Record<string,SubjectPose>)=>{
  if(!renderClear(probe,pose.position))return false;if(!probe?.seen)return true;const value=probe.seen(pose,ids,subjects);return Number.isFinite(value)&&value>=.85;};
export const renderForeground=(probe:RenderProbe|undefined,pose:CameraPose,aspect:number)=>{const value=probe?.foreground?.(pose,aspect)??0;return Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;};
export const renderVisibility=(probe:RenderVisibility|undefined,pose:CameraPose,ids:readonly string[],subjects:Record<string,SubjectPose>)=>{const value=probe?.(pose,ids,subjects)??1;return Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;};
