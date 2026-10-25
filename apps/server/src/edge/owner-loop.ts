// D3 (playtest 2026-10-25, ROOT-CAUSES §C D3): only the agent turned a receipt into its owner's result, and it rarely did
// in time (29 of 75 card messages had a result before the cutoff). An act may now name the owner message it serves
// (`for`, the CLI's `act --for <id>`, by default the newest message it acknowledged); when that act's receipt ends the
// world writes the message's result line itself from the receipt, unless the agent already wrote one. The agent's own
// `result` still replaces the world's line. Links are kept in memory (a restart drops them: the agent can still result).
import type {EdgeReceipt, EdgeSoul} from './contract.ts';

export type OwnerLoopInbox = {
  hasMessage(s: {scope: string; owner: string}, id: string): boolean;
  serverResult(s: {scope: string; owner: string}, id: string, text: string, outcome: 'done' | 'failed'): boolean;
};
type Link = {scope: {scope: string; owner: string}; message: string};
const MAX_LINKS = 2000;

/** The one line the owner's card shows when the linked act ends: the receipt's outcome summary, else its phase. */
export function resultLine(r: EdgeReceipt & {outcome?: {summary?: string}; done?: string}): {text: string; outcome: 'done' | 'failed'} | null {
  if (r.phase !== 'completed' && r.phase !== 'failed') return null;   // replaced: the act that replaced it closes the message
  const text = r.done ?? r.outcome?.summary ?? (r.phase === 'completed' ? `${r.capability} done.` : `${r.capability} failed${r.reason ? `: ${r.reason}` : '.'}`);
  return {text, outcome: r.phase === 'completed' ? 'done' : 'failed'};
}

export class OwnerLoop {
  private links = new Map<string, Link>();
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
  /** Link an accepted act's receipt to its owner message; a receipt already terminal closes the message now. */
  link(soul: EdgeSoul, receipt: EdgeReceipt, message: string) {
    this.links.set(receipt.id, {scope: this.scope(soul), message});
    if (this.links.size > MAX_LINKS) this.links.delete(this.links.keys().next().value!);
    if (receipt.phase !== 'waiting' && receipt.phase !== 'started' && receipt.phase !== 'accepted') this.ended(receipt);
  }
  private ended(r: EdgeReceipt) {
    const l = this.links.get(r.id); if (!l || ['waiting', 'started', 'accepted'].includes(r.phase)) return;
    this.links.delete(r.id);
    const line = resultLine(this.read(r.soulId, r.id) ?? r); if (line) this.inbox.serverResult(l.scope, l.message, line.text, line.outcome);
  }
  private scope(soul: EdgeSoul) {return {scope: `soul:${soul.soulId}`, owner: soul.owner};}
}
