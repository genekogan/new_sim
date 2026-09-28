// The take's refusal / blocked-wait log (STUDIO_REPLAY.md "Refusal / blocked log"). No three.js: the chapter-set
// worker (app/studio/chapter-set.worker.ts) builds the log of every chapter off the main thread with it.
import type { Take, TakeEvent } from '../../engine/take/types.ts';

export type TakeStep = { id: string; verb: string; label?: string; start: number | null; end: number | null; status?: string };
/** A take-log line for the diagnostics readout (failures, blocked waits, violations). `n`: repeated waits merged into
 *  the line (mars-take/4 events), counted in the totals. */
export type LogLine = { t: number; kind: 'violation' | 'failed' | 'blocked'; text: string; n?: number };

/** Take time as the log's clock with tenths: 0:31.5, 97:42.9 (merged waits end mid-second). */
const clockTenths = (s: number) => {
  const d = Math.round(s * 10);
  return `${Math.floor(d / 600)}:${String(Math.floor((d % 600) / 10)).padStart(2, '0')}.${d % 10}`;
};

/** A repeated wait folds into the line before it when it starts within this many seconds of that line's end. */
const REFOLD_S = 5;

/**
 * The take's diagnostics as log lines: violations, failed actions (refusals) and blocked waits. A step reads as its
 * label; an unlabelled step or a sub-action (`a484`, a crew member's make-way walk) as `verb id`. Waits that
 * mars-take/4 merged (`n`, `until`) and waits of the same action with the same code and message that start again within
 * REFOLD_S s of the previous one's end (a resume between them kept them apart in the take) share one line
 * "(×n over d s, until m:ss.s)"; `n` counts every wait, so the totals equal the take's blocked-wait count.
 */
export function takeLog(take: Take, steps: TakeStep[]): LogLine[] {
  const label = new Map(steps.map((s) => [`step:${s.id}`, s.label]));
  const who = (e: { id: string; verb: string }) => {
    const id = e.id.replace(/^step:/, '');
    return label.get(e.id) ?? (id.includes(e.verb.replace(/_/g, '-')) ? id : `${e.verb} ${id}`); // s0539-leave-stance names its verb
  };
  type Wait = LogLine & { key: string; end: number; head: string };
  const out: (LogLine | Wait)[] = [];
  const open = new Map<string, Wait>();
  for (const e of take.events as TakeEvent[]) {
    const t = e.t * take.dt;
    if (e.type === 'violation') out.push({ t, kind: 'violation', text: `${e.code}: ${e.message}` });
    if (e.type !== 'action') continue;
    if (e.status === 'failed') out.push({ t, kind: 'failed', text: `${who(e)} failed${e.code ? ` (${e.code})` : ''}${e.message ? `: ${e.message}` : ''}` });
    if (e.status !== 'blocked') continue;
    const key = `${e.id}|${e.code}|${e.message}`, n = e.n ?? 1, end = (e.until ?? e.t) * take.dt;
    const prev = open.get(key);
    if (prev && t - prev.end <= REFOLD_S) {
      prev.n = (prev.n ?? 1) + n;
      prev.end = Math.max(prev.end, end);
      continue;
    }
    const w: Wait = { t, kind: 'blocked', text: '', n, key, end, head: `${who(e)} waiting: ${e.code ?? 'blocked'}${e.message ? ` — ${e.message}` : ''}` };
    open.set(key, w);
    out.push(w);
  }
  return out.map((l) => {
    if (!('key' in l)) return l;
    const n = l.n ?? 1;
    return { t: l.t, kind: l.kind, text: n > 1 ? `${l.head} (×${n} over ${(l.end - l.t).toFixed(1)} s, until ${clockTenths(l.end)})` : l.head, ...(n > 1 ? { n } : {}) };
  });
}
