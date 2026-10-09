// DLG2: recent dialogue for a newly joined viewer. Spectators already receive every channel live
// (doc 26 §10: say lines with who heard them, conversation turns); this replays the last lines from the
// durable comms tables so a viewer's dialogue dock opens with history, also across server restarts.
// Same shapes as the live `speech` / `conversation.turn` spectator messages, marked `replay: true`;
// a replayed turn also carries the conversation's current `members` and `state`.
import type {CommsCore, SpectatorEdgeMessage} from './core.ts';

/** Dialogue messages (say lines + conversation turns together) a joining viewer receives, newest kept. */
export const DIALOGUE_REPLAY_LIMIT = 120;

type SpeechRow = {id: string; soul_id: string; tick: number; at: number; channel: string; text: string; heard_by: string};
type TurnRow = {conversation_id: string; seq: number; soul_id: string; tick: number; at: number; text: string};
type Ref = {soulId: string; name: string};

export function dialogueReplay(core: CommsCore, limit = DIALOGUE_REPLAY_LIMIT): SpectatorEdgeMessage[] {
  if (!(limit > 0)) return [];
  const {db, worldId} = core, ref = (soulId: string): Ref => ({soulId, name: core.nameOf(soulId)});
  const speech = db.prepare('SELECT id, soul_id, tick, at, channel, text, heard_by FROM edge_comms_speech WHERE world_id = ? ORDER BY at DESC, id DESC LIMIT ?').all(worldId, limit) as SpeechRow[];
  const turns = db.prepare('SELECT conversation_id, seq, soul_id, tick, at, text FROM edge_comms_turns WHERE world_id = ? ORDER BY at DESC, seq DESC LIMIT ?').all(worldId, limit) as TurnRow[];
  const conversations = new Map<string, {state: string; members: Ref[]}>();
  const body = db.prepare('SELECT body FROM edge_comms_conversations WHERE world_id = ? AND id = ?');
  for (const id of new Set(turns.map(t => t.conversation_id))) {
    try {
      const row = body.get(worldId, id) as {body: string} | undefined, b = row ? JSON.parse(row.body) as {state?: string; members?: Ref[]} : null;
      conversations.set(id, {state: String(b?.state ?? 'closed'), members: (b?.members ?? []).map(m => ({soulId:m.soulId,name:b?.state==='open'?core.nameOf(m.soulId):m.name,...(b?.state==='open'?core.nameMetadata?.(m.soulId):{})}))});
    } catch { conversations.set(id, {state: 'closed', members: []}); }
  }
  const json = <T>(s: string, fallback: T): T => { try { return JSON.parse(s) as T; } catch { return fallback; } };
  const turnRef=(r:TurnRow)=>{const old=db.prepare('SELECT name FROM edge_comms_turn_names_v1 WHERE world_id=? AND conversation_id=? AND seq=?').get(worldId,r.conversation_id,r.seq) as {name:string}|undefined;const current=core.nameOf(r.soul_id);return old&&old.name!==current?{...ref(r.soul_id),name:old.name,currentName:current,nameSource:'at-turn'}:ref(r.soul_id);};
  const out: SpectatorEdgeMessage[] = [
    ...speech.reverse().map(r => ({type: 'edge' as const, kind: 'speech', tick: r.tick, at: r.at, id: r.id, from: ref(r.soul_id), channel: json(r.channel, null), text: r.text, heardBy: json<string[]>(r.heard_by, []), untrusted: true, replay: true})),
    ...turns.reverse().map(r => ({type: 'edge' as const, kind: 'conversation.turn', tick: r.tick, at: r.at, conversation: r.conversation_id, turn: {seq: r.seq, tick: r.tick, at: r.at, from: turnRef(r), text: r.text}, ...conversations.get(r.conversation_id), untrusted: true, replay: true})),
  ];
  return out.sort((a, b) => a.at - b.at || a.tick - b.tick).slice(-limit);  // stable: each kind stays in its own order
}
