// Lane LOOKS: in god-built (new) worlds every newly born Soul, god-created or joined, gets a varied default look
// from the humanoid kit (core/humanoid@2), seeded by its entity id, logged as an ordinary body-assignment-v1 event
// (so replay, snapshots and every viewer see the same body). Old worlds never install this: their Souls keep
// today's three classic looks. Souls born before this ran keep theirs too; nothing is rewritten.
import type {WorldHost} from '../world.ts';
import {appearanceFromSeed,lookBody,seedOf} from '../../../web/src/humanoid/look.ts';

/** The default look of a body born in a new world: deterministic per entity id, varied across the kit. */
export const birthLook = (entityId: string) => lookBody(appearanceFromSeed(seedOf(entityId)));

export function installBirthLooks(host: WorldHost, edge?: {invalidateBodies?(): void}) {
  const pending = new Map<string, {entityId: string; tries: number; inFlight: boolean}>();
  const engine = host.engine as unknown as {world: {entities: Record<string, {body?: unknown}>}; bodyAssignmentProblemV1?(id: string, body: unknown): string | null};
  const assign = (soulId: string, p: {entityId: string; tries: number; inFlight: boolean}) => {
    const body = birthLook(p.entityId);
    const guard = (): true => {
      const ent = engine.world.entities[p.entityId];
      if (!ent || ent.body !== undefined) throw new Error('birth-look.not-needed');
      if (host.quietBarrier || !engine.bodyAssignmentProblemV1 || engine.bodyAssignmentProblemV1(p.entityId, body)) throw new Error('birth-look.not-ready');
      return true;
    };
    const giveUp = (e: unknown) => { if ((e as Error)?.message === 'birth-look.not-needed' || ++p.tries > 600) pending.delete(soulId); };
    try { guard(); } catch (e) { giveUp(e); return; }
    p.inFlight = true;
    host.enqueueChecked('body-assignment-v1', 'world:body', {contract: 'body-assignment/1', worldId: host.worldId, soulId, entityId: p.entityId, body}, guard, () => true)
      .then(() => { pending.delete(soulId); edge?.invalidateBodies?.(); }, giveUp)
      .finally(() => { p.inFlight = false; });
  };
  host.listeners.push({
    onApplied(e) { if (e.kind === 'birth') { const p = e.payload as {soulId: string; entityId: string}; pending.set(p.soulId, {entityId: p.entityId, tries: 0, inFlight: false}); } },
    afterTick() { for (const [soulId, p] of pending) if (!p.inFlight) assign(soulId, p); },
  });
}
