// Authenticated inventory only. Fixes use the ordinary build transitions and their journal/events.
import { holder, lockStatus } from '../../../../tools/god-skill/lib/locks.mjs';
import type { GodBuilds, Identity } from './builds.ts';
import type { VerifyUse } from './verify-use.ts';
export function serverDoctor(builds: GodBuilds, verify: VerifyUse | undefined, caller: Identity, fix = false) {
  const list = builds.list(), locks: Record<string, unknown>[] = [];
  for (const b of list.open) {
    const lead = { kind: 'build-lease', id: b.id, present: !b.paused?.explicit, ...lockStatus(b.lead.holder, b.lastAt, b.pauseAfterMs, list.now), label: b.lead.label, break: `build pause ${b.id}` };
    // Y4b: a co-builder's fix never breaks another account's lead or claim (it still sees them).
    if (fix && lead.present && lead.stale && !builds.foreignTo(caller, b.id)) { const fixed = builds.breakStaleLead(b.id); lead.present = !fixed; Object.assign(lead, { fixed }); }
    locks.push(lead);
    for (const c of b.claims) {
      const row = { kind: 'claim', id: `${b.id}/${c.id}`, present: ['held', 'stale'].includes(c.status), ...lockStatus(c.holder?.process, c.lastAt, b.pauseAfterMs, list.now), label: c.holder?.label, break: `build release ${c.id}` };
      if (fix && row.present && row.stale && !builds.foreignTo(caller, b.id, c.id)) { const r = builds.release(b.id, c.id, {}); row.present = !r.ok; Object.assign(row, { fixed: r.ok }); }
      locks.push(row);
    }
  }
  locks.push(verify?.lockInfo() ?? { kind: 'verify-probe', present: false, stale: false, holder: holder('Sim server') });
  return { schema: 'eden-locks/1', now: list.now, locks };
}
