// D3 (playtest 2026-10-25, ROOT-CAUSES §C D3): only the agent turned a receipt into its owner's result, and it rarely did
// in time (29 of 75 card messages had a result before the cutoff). An act may now name the owner message it serves
// (`for`, the CLI's `act --for <id>`, by default the newest message it acknowledged); when that act's receipt ends the
// world writes the message's result line itself from the receipt, unless the agent already wrote one. The agent's own
// `result` still replaces the world's line. Links are kept in memory (a restart drops them: the agent can still result).
// D3c (laptop trio-r1 rook-003: "have a little rest, then come back to the balloon" closed Done by a wave): a link the
// CLI made by default (`implicit`, the agent did not choose it) closes the message only with an act of its last step
// (messageSteps); any other act's end posts a progress line ("now: …; not resting yet") and leaves the card open, and the
// act's answer says `open` so the CLI's default serves the next act too. An explicit `for` closes as before.
import type {EdgeReceipt, EdgeSoul} from './contract.ts';
import {messageSteps} from './ledger/vocabulary.ts';

export type OwnerLoopInbox = {
  hasMessage(s: {scope: string; owner: string}, id: string): boolean;
  serverResult(s: {scope: string; owner: string}, id: string, text: string, outcome: 'done' | 'failed'): boolean;
  messageText?(s: {scope: string; owner: string}, id: string): string | null;
  serverProgress?(s: {scope: string; owner: string}, id: string, text: string): boolean;
};
/** `steps`: the message's steps when the link is implicit and its words name some (else the act closes it, as before). */
type Link = {scope: {scope: string; owner: string}; message: string; steps?: string[][]};
const verbOf = (r: EdgeReceipt) => r.capability.split(':')[0];
/** What the owner still waits for, said plainly ("not resting yet"); `there` for any way of getting somewhere. */
function pending(step: string[]) {
  const v = step[0];
  return v === 'rest' || v === 'nap' || v === 'lie' ? 'resting' : v === 'sit' ? 'sitting' : step.includes('walk') ? 'there' : v === 'ride' ? 'aboard' : `${v} done`;
}
const MAX_LINKS = 2000;

/** The one line the owner's card shows when the linked act ends: the receipt's outcome summary, else its phase. */
export function resultLine(r: EdgeReceipt & {outcome?: {summary?: string}; done?: string}): {text: string; outcome: 'done' | 'failed'} | null {
  if (r.phase !== 'completed' && r.phase !== 'failed') return null;   // replaced: the act that replaced it closes the message
  const text = r.done ?? r.outcome?.summary ?? (r.phase === 'completed' ? `${r.capability} done.` : `${r.capability} failed${r.reason ? `: ${r.reason}` : '.'}`);
  return {text, outcome: r.phase === 'completed' ? 'done' : 'failed'};
}

export class OwnerLoop {
  private links = new Map<string, Link>();
  private reached = new Map<string, number>();   // message → steps already served by an implicit link's act
  private inbox: OwnerLoopInbox;
  private read: (soulId: string, receiptId: string) => (EdgeReceipt & {outcome?: {summary?: string}; done?: string}) | null;
  constructor(inbox: OwnerLoopInbox, read: OwnerLoop['read'], onReceipt: (l: (r: EdgeReceipt) => void) => void) {
    this.inbox = inbox; this.read = read;
    onReceipt(r => this.ended(r));
  }
  /** Validate `for` before the act: a message id in this Soul's box, else a refusal reason. */
  check(soul: EdgeSoul, message: unknown): string | null {
    if (typeof message !== 'string' || !message.trim()) return '`for` must be an owner message id from listen';
    return this.inbox.hasMessage(this.scope(soul), message) ? null : `no owner message ${message} for this Soul (it may be too old)`;
  }
  /** Link an accepted act's receipt to its owner message; a receipt already terminal closes the message now. Implicit
   *  (the CLI's default): true when this act cannot close the message (not its last step), so the card stays open. */
  link(soul: EdgeSoul, receipt: EdgeReceipt, message: string, implicit = false): {open: boolean} {
    const scope = this.scope(soul), text = implicit ? this.inbox.messageText?.(scope, message) : null;
    const steps = text ? messageSteps(text) : [];
    const l: Link = {scope, message, ...(steps.length ? {steps} : {})};
    this.links.set(receipt.id, l);
    if (this.links.size > MAX_LINKS) this.links.delete(this.links.keys().next().value!);
    const open = !!l.steps && !l.steps.at(-1)!.includes(verbOf(receipt));
    if (receipt.phase !== 'waiting' && receipt.phase !== 'started') this.ended(receipt);
    return {open};
  }
  private ended(r: EdgeReceipt) {
    const l = this.links.get(r.id); if (!l || ['waiting', 'started', 'accepted'].includes(r.phase)) return;
    this.links.delete(r.id);
    const line = resultLine(this.read(r.soulId, r.id) ?? r); if (!line) return;
    if (!l.steps || l.steps.at(-1)!.includes(verbOf(r))) { this.reached.delete(l.message); this.inbox.serverResult(l.scope, l.message, line.text, line.outcome); return; }
    // not the last step: the owner sees what happened and what is still to come; the message stays open
    const at = l.steps.findIndex((st, i) => i >= (this.reached.get(l.message) ?? 0) && st.includes(verbOf(r)));
    const reached = Math.max(this.reached.get(l.message) ?? 0, at >= 0 && line.outcome === 'done' ? at + 1 : 0);
    this.reached.set(l.message, reached); if (this.reached.size > MAX_LINKS) this.reached.delete(this.reached.keys().next().value!);
    this.inbox.serverProgress?.(l.scope, l.message, `now: ${line.text.replace(/[.\s]+$/, '')}; not ${pending(l.steps[Math.min(reached, l.steps.length - 1)])} yet`);
  }
  private scope(soul: EdgeSoul) {return {scope: `soul:${soul.soulId}`, owner: soul.owner};}
}
