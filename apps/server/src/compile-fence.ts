// Opt-in request fence for the candidate compiler path. Not a transport policy:
// its caller supplies a CURRENT authority check from the authenticated route.
import type { Db, SoulRow } from './db.ts';
import type { AcceptanceGuard, Mind, WorldHost } from './world.ts';

export class StaleCompilation extends Error {
  constructor() { super('Request became stale; earlier accepted effects may remain'); this.name = 'StaleCompilation'; }
}

/** Capture identity and will, not a physical pose: ordinary tick motion must not
 * invalidate slow thinking. The authority callback must synchronously return
 * true only while the current principal still has access, including current
 * owner/admin policy or the exact agent credential. Never accept a client flag.
 * Guard checks are live admission only; they do not change accepted log facts. */
export function captureCompilationFence(host: WorldHost, db: Db, mind: Mind,
  currentAuthority: (soul: SoulRow) => boolean): AcceptanceGuard {
  const initial = db.soul(mind.soulId);
  const worldId = host.worldId, soulId = mind.soulId, entityId = mind.entityId;
  const owner = initial?.owner, version = mind.intentVersion;
  const check: AcceptanceGuard = () => {
    const row = db.soul(soulId);
    if (!initial || !row || row.retired_at !== null || row.world_id !== worldId
      || row.entity_id !== entityId || row.owner !== owner || mind.owner !== owner
      || host.minds.get(soulId) !== mind || mind.soulId !== soulId || mind.entityId !== entityId
      || mind.intentVersion !== version || !host.engine.world.entities[entityId]
      || host.kernel.things[soulId]?.kind !== 'soul' || host.kernel.things[soulId]?.traits.body !== entityId
      || currentAuthority(row) !== true) throw new StaleCompilation();
    return true;
  };
  check();
  return check;
}
