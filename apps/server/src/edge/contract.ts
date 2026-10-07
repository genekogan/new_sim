// EDGE-CONTRACT-v1 shared surface (team/CONTRACTS/EDGE-CONTRACT-v1.md).
// Owned by Core-Ledger; Core-Comms reads it and proposes changes via INBOX-core.
import type {Context} from 'hono';
import type {WorldHost} from '../world.ts';
import type {Db} from '../db.ts';
import type {Souls} from '../souls.ts';

export const EDGE_CONTRACT = 'eden-edge/1' as const;
export type PlaceRef = {id: string; name: string; kind: string};
export type EdgeSoul = {soulId: string; entityId: string; name: string; owner: string};
export type ReceiptPhase = 'waiting' | 'started' | 'completed' | 'failed' | 'replaced';
export type EdgeReceipt = {id: string; soulId: string; capability: string; phase: ReceiptPhase; acceptedTick: number; startedTick: number | null; endedTick: number | null; code: string | null; reason: string | null; programId: string | null};
export type NearbyBody = {soulId: string; entityId: string; name: string; distance: number; placeId: string; state: string; activity: string};

/** Read-only ledger facts Comms may use to route events and speech. */
export interface EdgeLedgerHooks {
  placePathOf(soulId: string): PlaceRef[];
  /** Innermost enclosed place containing the Soul's body, or null when outdoors. */
  enclosureOf(soulId: string): string | null;
  /** Bodies of other Souls the given Soul can perceive (enclosure rule applied), within `radius` metres. */
  perceivedBodies(soulId: string, radius: number): NearbyBody[];
  /** Receipt phase changes (live and after boot). */
  onReceipt(listener: (r: EdgeReceipt) => void): void;
  /** A Soul's innermost place changed. */
  onPlaceChange(listener: (e: {soulId: string; from: string | null; to: string | null; tick: number}) => void): void;
  /** Opaque capability providers (Comms objects) are merged into capabilities. */
  addCapabilityProvider(p: (soul: EdgeSoul) => EdgeCapability[]): void;
}
export type EdgeCapability = {id: string; verb: string; label: string; available: boolean; target?: {id: string; kind: string}; blocked?: {code: string; reason: string}; params?: Record<string, unknown>; object?: string; action?: string};
export type EdgeDeps = {host: WorldHost; db: Db; souls: Souls; build?: string; soul(c: Context): EdgeSoul; ledger: EdgeLedgerHooks};
export class EdgeError extends Error {readonly status: number; readonly code: string; constructor(status: number, code: string, message: string) {super(message); this.status = status; this.code = code;}}
export const edgeBody = <T extends object>(body: T) => ({contract: EDGE_CONTRACT, ...body});
