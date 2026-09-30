// Wire protocol shared by server and clients: log events, WebSocket messages,
// REST payloads. Everything that crosses a process boundary is defined here.
import { z } from 'zod';
import type { ChangeEvent, Entity, Environment, PathCommit, PoseSample, Region } from '@sim/engine-contract';
import { hashOf, samplePath } from '@sim/engine-contract';

export const PROTO = 1;

// ---------------------------------------------------------------- intents
export const GOALS = ['wander', 'go', 'follow', 'attend', 'gather', 'converse', 'rest', 'perform'] as const;
export const intentSchema = z.strictObject({
  goal: z.enum(GOALS),
  target: z.string().max(80).nullable().optional(),
  note: z.string().max(160).optional(), // sanitized flavour, shown to the mid-brain as context only
});
export type WireIntent = z.infer<typeof intentSchema>;
export const describeIntent = (i: WireIntent | null, nameOf: (id: string) => string = (x) => x): string => {
  if (!i) return 'no particular intent; live your life';
  const t = i.target ? nameOf(i.target) : null;
  const base = {
    wander: 'wander around', go: `go to ${t ?? 'somewhere'}`, follow: `follow ${t ?? 'someone'}`, attend: `attend ${t ?? 'whatever is happening'}`,
    gather: `gather with others at ${t ?? 'a meeting place'}`, converse: `talk with ${t ?? 'someone'}`, rest: `rest${t ? ` at ${t}` : ''}`, perform: 'perform for others',
  }[i.goal];
  return i.note ? `${base} (${i.note})` : base;
};

// ---------------------------------------------------------------- log events
export type EventKind = 'birth' | 'intent' | 'decision' | 'scene' | 'rules' | 'admin' | 'retire';
export type LogEvent = { seq: number; tick: number; kind: EventKind; author: string; payload: any; at: number };

export type BirthPayload = { soulId: string; entityId: string; name: string; description: string; owner: string };
export type IntentPayload = { soulId: string; intent: WireIntent; source: 'web' | 'api' | 'mcp' | 'system' };
export type DecisionPayload = {
  soulId: string; entityId: string; option: string; label: string;
  steps: { verb: string; params: Record<string, unknown> }[];
  mood?: string; reevalTicks: number; fallback: boolean; call?: number; trigger: string;
};
export type ScenePayload = { region: string; narrative: number; beat: Beat };
export type Beat = { at_min: number; kind: 'scene' | 'group' | 'soul'; directive: string; targets: string[]; flavor: string };

// ---------------------------------------------------------------- public views
export type PublicSoul = {
  id: string; entityId: string; name: string; description: string; owner: string; // owner is an opaque short id
  intent: WireIntent | null; intentText: string; mood: string; energy: string; doing: string; native: boolean;
};
export type BrainCall = {
  id: number; tick: number; at: number; tier: 'mid' | 'translate' | 'director' | 'narrator' | 'shot';
  subject: string; model: string; request: unknown; response: unknown; applied: unknown;
  ms: number; inputTokens: number; outputTokens: number; cachedTokens: number; costUsd: number; mode: 'live' | 'fake'; error?: string;
};
export type CameraLine = { tick: number; shot: unknown; text: string; heldSec: number };
export type TickerLine = { tick: number; text: string };
export type NarrativeView = { id: number; region: string; tick: number; summary: string; beats: (Beat & { fired: boolean; fireTick: number })[]; nextRunTick: number };

// ---------------------------------------------------------------- websocket
export type ClientMsg =
  | { t: 'hello'; proto: number; token?: string; since?: number }
  | { t: 'resync'; reason: string }
  | { t: 'ping'; n: number };

export type Snapshot = {
  tick: number; seq: number; viewHash: string;
  entities: Record<string, Entity>; regions: Record<string, Region>; env: Environment;
  paths: PathCommit[]; souls: PublicSoul[];
};
export type Batch = {
  seq: number; fromTick: number; toTick: number;
  paths: PathCommit[]; changes: ChangeEvent[]; souls: PublicSoul[]; removedSouls: string[];
  log: LogEvent[];
};
export type Heartbeat = { tick: number; seq: number; viewHash: string; keyframes: Record<string, PoseSample>; clients: number; clockRate: number; paused: boolean };

export type ServerMsg =
  | { t: 'welcome'; proto: number; worldId: string; rulesVersion: string; schema: string; dt: number; clockRate: number; serverTick: number; you: Me | null; serverTime: number }
  | ({ t: 'snapshot'; reason: string } & Snapshot)
  | ({ t: 'batch' } & Batch)
  | ({ t: 'heartbeat' } & Heartbeat)
  | { t: 'log'; events: LogEvent[] }
  | { t: 'brain'; calls: BrainCall[] }
  | { t: 'camera'; line: CameraLine }
  | { t: 'ticker'; lines: TickerLine[] }
  | { t: 'narrative'; view: NarrativeView }
  | { t: 'stats'; stats: ServerStats }
  | { t: 'pong'; n: number; serverTime: number }
  | { t: 'error'; code: string; message: string };

export type Me = { userId: string; short: string; email: string | null; wallet: string | null; role: 'user' | 'admin'; souls: string[] };
export type ServerStats = {
  tick: number; tickMsAvg: number; tickMsMax: number; clients: number; entities: number; souls: number; liveActions: number;
  seq: number; logEvents: number; lastSnapshotTick: number; dbBytes: number; uptimeSec: number;
  brain: { mode: string; callsToday: number; costToday: number; budget: number; inflight: number; jevMsAvg: number };
};

// ---------------------------------------------------------------- view hash (the gradual-sync check)
/** Hash of what every client should agree on at a tick: each human's activity, seat and position. */
export function viewHashOf(rows: [string, string, string | null, number, number][]): string {
  return hashOf(rows.slice().sort((a, b) => (a[0] < b[0] ? -1 : 1))).slice(0, 16);
}
export function viewRow(e: Entity, pose: PoseSample): [string, string, string | null, number, number] {
  return [e.id, e.human?.activity ?? '', e.human?.on ?? null, pose[1], pose[3]];
}
export { samplePath };

// ---------------------------------------------------------------- REST
export const createSoulSchema = z.strictObject({
  name: z.string().trim().min(2).max(32).regex(/^[\p{L}\p{N} _'-]+$/u, 'letters, numbers, spaces, apostrophes and hyphens only'),
  description: z.string().trim().min(3).max(200),
});
export const commandSchema = z.strictObject({ text: z.string().trim().min(1).max(280) });
export const setIntentSchema = z.strictObject({ intent: intentSchema });
export const adminSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('pause') }),
  z.strictObject({ action: z.literal('resume') }),
  z.strictObject({ action: z.literal('clock_rate'), rate: z.number().min(0.1).max(20) }),
  z.strictObject({ action: z.literal('narrate'), region: z.string() }),
  z.strictObject({ action: z.literal('brain_mode'), mode: z.enum(['live', 'fake']) }),
  z.strictObject({ action: z.literal('snapshot') }),
  z.strictObject({ action: z.literal('budget'), usdPerDay: z.number().min(0).max(100) }),
]);
export type AdminAction = z.infer<typeof adminSchema>;
