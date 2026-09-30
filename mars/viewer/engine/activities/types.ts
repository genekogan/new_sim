import type { Diagnostic } from '../actions/types.ts';
import type { Vec2 } from '../core/math.ts';
import type { Runtime } from '../runtime/runtime.ts';

/** Small derived activity vocabulary, deliberately not an activity language. */
export interface ActivityDefinition {
  id: string;
  roles: {
    name: string;
    minimum: number;
    maximum: number;
    eligibility: string[];
  }[];
  requiredCapabilities: string[];
  optionalCapabilities: string[];
  phases: string[];
  outcomes: string[];
}
export const CLASSROOM_DEFINITION: ActivityDefinition = {
  id: 'classroom',
  roles: [
    {
      name: 'host',
      minimum: 1,
      maximum: 1,
      eligibility: ['human', 'ground', 'free-hands', 'unclaimed'],
    },
    {
      name: 'presenter',
      minimum: 1,
      maximum: 6,
      eligibility: ['human', 'ground', 'free-hands', 'unclaimed'],
    },
    {
      name: 'audience',
      minimum: 1,
      maximum: 12,
      eligibility: ['human', 'ground', 'free-hands', 'unclaimed'],
    },
  ],
  requiredCapabilities: [
    'fixture-seats',
    'ground-presenter-station',
    'reachable-departures',
    'display-unless-explicit-discussion',
  ],
  optionalCapabilities: ['conversation-points', 'visible-attention'],
  phases: [
    'arriving',
    'releasing',
    'presenting',
    'question',
    'rotating',
    'conversation-release',
    'conversing',
    'departing',
    'cleanup',
    'ended',
  ],
  outcomes: [
    'completed',
    'cancelled-after-safe-stop',
    'failed-after-safe-stop',
    'participant-excluded',
  ],
};
export type ClassroomPhase =
  | 'arriving'
  | 'releasing'
  | 'presenting'
  | 'question'
  | 'rotating'
  | 'conversation-release'
  | 'conversing'
  | 'departing'
  | 'cleanup'
  | 'ended';
export type ClassroomIntent =
  | { kind: 'question'; actor: string }
  | { kind: 'depart'; actor: string }
  | { kind: 'join'; actor: string; departure?: Vec2 }
  | { kind: 'advance' }
  | { kind: 'cancel' };
export interface ClassroomParams {
  host: string;
  presenters: string[];
  audience: string[];
  seats: string[];
  presenterStation: string;
  departure: Record<string, Vec2>;
  conversationPoints?: Vec2[];
  displayId?: string;
  requireDisplay?: boolean;
  arrivalStaggerSeconds?: number;
  talkSeconds?: number;
  questionSeconds?: number;
  conversationSeconds?: number;
  maxPhaseSeconds?: number;
}
export interface ClassroomControlParams {
  session: string;
  intent: ClassroomIntent;
}
export interface ClassroomAttention {
  actor: string;
  point: Vec2;
}
export interface ClassroomReadout {
  session: string;
  phase: ClassroomPhase;
  floorHolder?: string;
  attentionTarget?: ClassroomAttention;
  waitingReason?: string;
  participants: {
    actor: string;
    role: 'host' | 'presenter' | 'audience';
    seat: string;
    state: 'participating' | 'excluded';
    reason?: string;
    /** A newly admitted member is on an ordinary sit child route until occupied. */
    arrival?: 'joining' | 'seated';
  }[];
  controls: ClassroomIntent['kind'][];
  queuedQuestions: string[];
  joining: string[];
  diagnostic?: Diagnostic;
}
/** Adapter operates presentation state only; authoritative movement stays in registered actions. */
export interface ClassroomDisplay {
  supports(rt: Runtime, displayId: string): Diagnostic | null;
  focus(
    rt: Runtime,
    state: {
      session: string;
      displayId: string;
      phase: ClassroomPhase;
      floorHolder?: string;
      attentionTarget?: ClassroomAttention;
    },
  ): Diagnostic | null;
  clear(rt: Runtime, session: string, displayId: string): Diagnostic | null;
}
