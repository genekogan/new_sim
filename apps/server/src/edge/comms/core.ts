// Shared runtime for the Comms lane: persistence, stream, clock and Soul lookups.
import {randomBytes} from 'node:crypto';
import type {EdgeDeps, EdgeSoul} from '../contract.ts';
import {EdgeError} from '../contract.ts';
import type {Sql} from './store.ts';
import type {EventStreams} from './stream.ts';

/** Spectator-visible edge message (EDGE-CONTRACT-v1 §7); World renders bubbles. */
export type SpectatorEdgeMessage = {type: 'edge'; kind: string; tick: number; at: number} & Record<string, unknown>;

export type CommsCore = {
  deps: EdgeDeps;
  db: Sql;
  worldId: string;
  streams: EventStreams;
  now(): number;
  tick(): number;
  nameOf(soulId: string): string;
  nameMetadata?(soulId:string):{nameAmbiguous?:true};
  liveSoulIds(): string[];
  isLive(soulId: string): boolean;
  /** Faded out (C9 `gone`): absent from the world until its agent acts again. */
  isFaded?(soulId: string): boolean;
  /** Publish to spectators (no-op until a listener is attached). */
  spectate(msg: Omit<SpectatorEdgeMessage, 'type' | 'at'>): void;
};

export const newId = (prefix: string) => `${prefix}_${randomBytes(9).toString('base64url')}`;

/** Validates untrusted text from a Soul: string, trimmed, 1..max chars. */
export function textParam(raw: unknown, max = 500, field = 'text'): string {
  if (typeof raw !== 'string') throw new EdgeError(400, 'invalid', `${field} must be a string`);
  const text = raw.trim();
  if (!text) throw new EdgeError(400, 'invalid', `${field} must not be empty`);
  if ([...text].length > max) throw new EdgeError(400, 'invalid', `${field} must be at most ${max} characters`);
  return text;
}

export const soulRef = (s: EdgeSoul | {soulId: string; name: string}) => ({soulId: s.soulId, name: s.name});
