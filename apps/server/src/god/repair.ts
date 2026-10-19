// G2 (tranche 2026-10-19): one round trip per place/move.
//
// The CLI's solver turns relations into ordered candidate poses; it used to dry-run them one request at a time and
// repair on refusal (next candidate, the server's suggestion, a nudge, a free name), then commit. Over a 107 ms link
// that was a round trip per try plus the commit. Here the CLI sends the candidate ops it would have tried, in order,
// with the commit, and the server walks them with exactly the CLI's rules (tools/god-skill/cli.mjs commitItems, single
// item), using the same dryrun the CLI called, then commits the first that passes. The answer says which op it
// committed and the repair notes, word for word as the CLI wrote them, so the CLI's output does not change.
import type { GodMode } from './god.ts';
import { libraryHash } from './mirror.ts';

export type RepairIn = {
  /** The ops the CLI would try, in its order (candidate 0 first; each with the name the CLI would give it). */
  candidates: Record<string, unknown>[];
  /** Per candidate: the `world/<name>` keys the CLI had handed out by then (its uniqueName `taken`). */
  taken: string[][];
  kind: 'place' | 'move';
  /** The build/group fields the CLI's own dryrun requests carried. */
  dry: Record<string, unknown>;
  /** The edit seq the candidates were solved against: a different seq answers `stale` and changes nothing. */
  ifSeq: number;
  /** The library hash (mirror.ts) the CLI solved with (its cached bakes): a different one is stale too. */
  ifLib?: string;
};
type Failure = { op: number; code: string; detail?: string; suggest?: { p?: unknown } };
type Op = Record<string, unknown> & { name?: string; mode?: string; in?: unknown; _suggested?: boolean };

export function parseRepair(raw: unknown): RepairIn | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const c = r.candidates, t = r.taken;
  if (!Array.isArray(c) || !c.length || c.length > 64 || !c.every((x) => x && typeof x === 'object' && !Array.isArray(x))) return null;
  if (!Array.isArray(t) || t.length !== c.length || !t.every((x) => Array.isArray(x) && x.length <= 256 && x.every((k) => typeof k === 'string'))) return null;
  if (r.kind !== 'place' && r.kind !== 'move') return null;
  if (typeof r.ifSeq !== 'number' || !r.dry || typeof r.dry !== 'object' || Array.isArray(r.dry)) return null;
  return { candidates: c as Record<string, unknown>[], taken: t as string[][], kind: r.kind, dry: r.dry as Record<string, unknown>, ifSeq: r.ifSeq, ...(typeof r.ifLib === 'string' ? { ifLib: r.ifLib } : {}) };
}

/** The CLI's uniqueName under the world root (its name.taken repair always looks there). */
function uniqueName(god: GodMode, stem: string, taken: Set<string>) {
  const has = (n: string) => taken.has(`world/${n}`) || god.model.names.has(`world/${n}`);
  if (!has(stem)) return stem;
  for (let k = 2; k < 9999; k++) if (!has(`${stem}-${k}`)) return `${stem}-${k}`;
  return `${stem}-${Date.now() % 1e5}`;
}

/** Walk the candidates as the CLI did, then commit. `batch`: the act body without `repair`/`mirror` (ops replaced). */
export function actWithRepair(god: GodMode, batch: Record<string, unknown>, rep: RepairIn, note?: string) {
  if (rep.ifSeq !== god.model.editSeq || (rep.ifLib !== undefined && rep.ifLib !== libraryHash(god))) return { accepted: false as const, failures: [], repair: { stage: 'stale' as const, seq: god.model.editSeq } };
  const cands = rep.candidates as Op[];
  let choice = 0, op: Op = cands[0], r: ReturnType<GodMode['dryrun']> | undefined;
  const fixes: string[] = [];
  for (let attempt = 0; attempt < 12; attempt++) {
    r = god.dryrun({ ...rep.dry, ops: [op] });
    if (r.accepted) break;
    const f = r.failures[0] as Failure;
    if (f.op !== 0) break;
    if (f.code === 'overlap.solid') {
      if (choice + 1 < cands.length) { choice++; op = cands[choice]; fixes.push(`blocked (${f.detail}) → next candidate`); continue; }
      if (f.suggest?.p && !op._suggested && !op.in) { op = { ...op, p: f.suggest.p, _suggested: true }; fixes.push(`blocked (${f.detail}) → the server's suggestion ${JSON.stringify(f.suggest.p)}`); continue; }
      if (op.mode !== 'nudge') { op = { ...op, mode: 'nudge' }; fixes.push(`blocked (${f.detail}) → nudge`); continue; }
    }
    if (f.code === 'name.taken' && rep.kind === 'place') { op = { ...op, name: uniqueName(god, String(op.name), new Set([...rep.taken[choice], `world/${op.name}`])) }; continue; }
    break;
  }
  const { _suggested, ...final } = op; void _suggested;
  const repair = { choice, fixes, op: final };
  if (!r!.accepted) return { accepted: false as const, failures: r!.failures, repair: { ...repair, stage: 'dryrun' as const } };
  const res = god.act({ ...batch, ops: [final] }, note);
  const out = { ...res, repair: { ...repair, stage: 'act' as const } };
  // a transport retry of the same request gets the receipt back, repair notes included
  if (res.accepted && typeof batch.clientRef === 'string') god.store.amendReceipt(batch.clientRef, out as never);
  return out;
}
