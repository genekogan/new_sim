// A controller/admission block can invite reconsideration; it is neither a
// completed purpose nor a new owner instruction. Derived from durable facts.
import type {IntentRevisionV2} from '@sim/protocol';
import type {IntentHistoryV2} from './intent-history.ts';

/** Same backoff as the existing native failed-option cooldown, in world ticks.
 * No retry queue, timetable, model call or private persistence is introduced. */
export const INTENT_RETRY_COOLDOWN_TICKS = 1200;
export function blockedDirectionForRetry(history: IntentHistoryV2, ownerId: string, tick: number): IntentRevisionV2 | undefined {
  const entries = Object.values(history.intents);
  const latestWill = entries.reduce((seq, e) => Math.max(seq, e.statusSeq), 0);
  const entry = entries.find(e => e.statusSeq === latestWill);
  if (!entry || entry.status !== 'active' || entry.revision.source.ownerId !== ownerId) return;
  const revision = entry.revision;
  if (revision.interpretation.trigger.kind !== 'now' || revision.interpretation.agenda.length !== 1) return;
  const last = Object.values(history.attempts)
    .filter(a => a.intent.intentId === revision.intentId && a.intent.version === revision.version)
    .reduce<(typeof history.attempts)[string] | undefined>((latest, a) => !latest || a.seq > latest.seq ? a : latest, undefined);
  if (last?.phase !== 'blocked' || tick - last.tick < INTENT_RETRY_COOLDOWN_TICKS) return;
  return revision;
}
