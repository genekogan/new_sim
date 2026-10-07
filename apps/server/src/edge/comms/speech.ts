// `say` — public speech routed by Channel (EDGE-CONTRACT-v1 §6).
// Inside an enclosed place: everyone in that same enclosure, nobody outside.
// Outdoors: everyone the speaker can perceive within the earshot radius.
// The Role `addresses` relation is not routed yet (C3 ships roles as data only).
import type {EdgeSoul} from '../contract.ts';
import {newId, soulRef, textParam, type CommsCore} from './core.ts';

export const EARSHOT_RADIUS = 12;
export type Channel = {kind: 'enclosure'; placeId: string} | {kind: 'earshot'; placeId: string | null; radius: number};

export function say(core: CommsCore, soul: EdgeSoul, input: {text?: unknown}) {
  const text = textParam(input.text, 500);
  const {ledger} = core.deps;
  const enclosure = ledger.enclosureOf(soul.soulId);
  let channel: Channel, hearers: string[];
  if (enclosure) {
    channel = {kind: 'enclosure', placeId: enclosure};
    hearers = core.liveSoulIds().filter(id => id !== soul.soulId && safeEnclosure(core, id) === enclosure);
  } else {
    channel = {kind: 'earshot', placeId: ledger.placePathOf(soul.soulId)[0]?.id ?? null, radius: EARSHOT_RADIUS};
    hearers = [...new Set(ledger.perceivedBodies(soul.soulId, EARSHOT_RADIUS).map(b => b.soulId))].filter(id => id !== soul.soulId && core.isLive(id));
  }
  const id = newId('sp'), tick = core.tick(), at = core.now();
  core.db.prepare('INSERT INTO edge_comms_speech (world_id, id, soul_id, tick, at, channel, text, heard_by) VALUES (?,?,?,?,?,?,?,?)')
    .run(core.worldId, id, soul.soulId, tick, at, JSON.stringify(channel), text, JSON.stringify(hearers));
  for (const h of hearers) core.streams.deliver(h, 'speech', tick, {saidId: id, from: soulRef(soul), channel, text, untrusted: true});
  core.spectate({kind: 'speech', tick, id, from: soulRef(soul), channel, text, heardBy: hearers, untrusted: true});
  return {said: {id, tick, channel, heardBy: hearers.length}};
}

function safeEnclosure(core: CommsCore, soulId: string): string | null {
  try { return core.deps.ledger.enclosureOf(soulId); } catch { return null; }
}

/** Speech log, newest last (for steward digests and audits). */
export function speechLog(core: CommsCore, sinceAt: number, limit = 500) {
  return (core.db.prepare('SELECT id, soul_id, tick, at, channel, text, heard_by FROM edge_comms_speech WHERE world_id = ? AND at >= ? ORDER BY at, id LIMIT ?').all(core.worldId, sinceAt, limit) as {id: string; soul_id: string; tick: number; at: number; channel: string; text: string; heard_by: string}[])
    .map(r => ({id: r.id, soulId: r.soul_id, tick: r.tick, at: r.at, channel: JSON.parse(r.channel) as Channel, text: r.text, heardBy: JSON.parse(r.heard_by) as string[]}));
}
