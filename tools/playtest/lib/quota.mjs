import { run } from './proc.mjs';
import { existsSync } from 'node:fs';
export const USAGE_PY = process.env.PLAYTEST_USAGE_PY ?? null; // a plan-usage tool printing --json limits; unset skips the check
/** Claude plan usage via $PLAYTEST_USAGE_PY --json (never the raw endpoint). Returns {ok, fiveH, week, fable, raw}.
 *  Where usage.py is absent (a cloud box) the check is skipped: {ok:false, skipped:true, note}, which quotaAllows lets through. */
export async function quota({ usagePy = USAGE_PY } = {}) {
  if (!usagePy || !existsSync(usagePy)) return { ok: false, skipped: true, fiveH: null, week: null, fable: null, note: usagePy ? `quota check skipped: ${usagePy} not present on this machine` : 'quota check skipped: PLAYTEST_USAGE_PY not set' };
  const r = await run('python3', [usagePy, '--json', '--no-ctx'], { maxWallMs: 30000 });
  try { const j = JSON.parse(r.stdout); const by = Object.fromEntries((j.limits ?? []).map((l) => [l.label, l.percent])); return { ok: true, fiveH: by['5h'] ?? null, week: by.week ?? null, fable: by.fable ?? null, raw: j }; }
  catch { return { ok: false, fiveH: null, week: null, fable: null, raw: r.stdout.slice(0, 300) + r.stderr.slice(0, 300) }; }
}
export function quotaAllows(q, { stopPct = 85 } = {}) { if (!q.ok) return { allowed: true, note: q.note ?? 'quota unknown' }; const worst = Math.max(q.fiveH ?? 0, q.week ?? 0); return { allowed: worst < stopPct, note: `5h ${q.fiveH}% week ${q.week}% fable ${q.fable}%` }; }
