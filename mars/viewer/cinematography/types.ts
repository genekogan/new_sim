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
