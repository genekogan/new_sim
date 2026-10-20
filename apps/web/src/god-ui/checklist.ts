// First steps for a new god, ticked from what the world says (pure; tested).
import type { EditRow, Op, Status } from './god-api.ts';

export const isFlagDef = (def: string) => /^core[-/]flag@/.test(def);

export type Step = { id: 'signin' | 'claim' | 'pair' | 'flag' | 'build' | 'look'; label: string; done: boolean; hint: string };
export type Evidence = {
  status: Status | null; signedIn: boolean;
  /** edits as the god's journal lists them (any order) */
  edits: EditRow[] | null;
  flags: number;
  /** pairings this browser approved (remembered per world) */
  approvedHere: boolean;
  /** the launcher saw a non-browser client use a god token / a `god look` page load */
  agentSeen: boolean; looks: number;
};

// genesis batches are grouped 'genesis' (their notes are not always kept); 'core kit' rows come from a release
const isGenesis = (e: EditRow) => e.grp === 'genesis' || /^(genesis|core kit)\b/.test(e.note ?? '') || e.by === 'core';
const isFlagOp = (o: Op) => o.op === 'place' && typeof o.def === 'string' && isFlagDef(o.def);
/** A build is any accepted edit after genesis that changes things (not only flags, sky or constitution). */
export const isBuild = (e: EditRow) => e.kind === 'edit' && !isGenesis(e) && e.ops.some((o) => !isFlagOp(o) && o.op !== 'world' && o.op !== 'answer');

export function steps(ev: Evidence): Step[] {
  const you = ev.status?.you ?? 'anonymous';
  const owner = you === 'owner' || you === 'god';
  const agents = (ev.status?.agents ?? 0) > 0 || ev.approvedHere || ev.agentSeen;
  const built = !!ev.edits?.some(isBuild);
  // a flag of your own: the template's flags do not count (fallback: any flag, when the journal is unknown)
  const flagged = ev.edits ? ev.edits.some((e) => e.kind === 'edit' && !isGenesis(e) && !e.undone && e.ops.some(isFlagOp)) : ev.flags > 0;
  return [
    { id: 'signin', label: 'Sign in', done: ev.signedIn, hint: 'So this world knows you when you come back.' },
    { id: 'claim', label: 'Claim the world', done: owner, hint: 'Whoever claims an unowned world first becomes its god.' },
    { id: 'pair', label: 'Connect your agent', done: agents, hint: 'Open God (right of Explore), paste its line to your agent, then press Approve when its code appears there.' },
    { id: 'flag', label: 'Drop a flag', done: flagged, hint: 'A named spot your agent can build around: ⚑ Drop a flag, then click the ground.' },
    { id: 'build', label: 'First build', done: built, hint: 'Ask your agent for something: “a cottage by the pond”.' },
    { id: 'look', label: 'First look', done: ev.looks > 0, hint: 'Ask your agent to take a look at what it built.' },
  ];
}

/** One line for an edit in the panel: “#12 place cottage, bench · group village”. */
export function describeEdit(e: EditRow): string {
  if (e.kind !== 'edit') return e.note ?? `${e.kind} of ${e.undo_of ?? '?'}`;
  const counts = new Map<string, number>();
  for (const o of e.ops) counts.set(o.op, (counts.get(o.op) ?? 0) + 1);
  const names = e.ops.map((o) => o.name ?? o.id).filter((x): x is string => typeof x === 'string').slice(0, 3);
  const what = [...counts].map(([op, n]) => (n > 1 ? `${op} ×${n}` : op)).join(', ');
  return e.note ? e.note : `${what}${names.length ? ' ' + names.join(', ') : ''}`;
}
