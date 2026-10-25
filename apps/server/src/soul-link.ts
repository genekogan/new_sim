// LINK tranche (team/scratch/link/COMMON-LINK.md §2): the one owner-facing state of a Soul's agent link, computed
// server-side so the card, the CLI `status` and Playtest read the same value.
//   pairing       a repair approval for this Soul is pending in this account's window (the card is the request)
//   connected     a valid controller is listening (open listen, or closed within the presence grace)
//   disconnected  anything else, with one reason: SOUL3's revocation reason when no controller is current, else
//                 approved-waiting (the grant is newer than any listen) or stopped-listening, else never
import type {SoulRow} from './db.ts';
import type {Souls} from './souls.ts';
import {SOUL_LISTEN_GRACE_MS, type AgentInbox} from './inbox.ts';

export type LinkState = 'pairing' | 'connected' | 'disconnected';
export type LinkReason = 'listening' | 'pending-approval' | 'approved-waiting' | 'stopped-listening' | 'replaced' | 'revoked' | 'never';
export type SoulLink = {state: LinkState; reason: LinkReason; since: number | null; holder: {label: string | null; since: number | null} | null; approvalId?: string};

/** SOUL3's raw revocation reasons (grants and legacy tombstones) as the owner's reason word. */
export function revocationReason(raw: string | null | undefined): LinkReason | null {
  switch (raw) {
    case 'replaced': case 'legacy-pair-rotation': case 'account-repair': return 'replaced';
    case 'revoked': case 'account-revoke': case 'refused': return 'revoked';
    case 'released': case 'agent-release': return 'stopped-listening';
    default: return null;
  }
}

export function soulLink(souls: Souls, inbox: AgentInbox | undefined, soul: SoulRow, accountId: string | null): SoulLink {
  const store = souls.accounts?.store;
  const legacy = soul.token_hash ? {label: soul.token_label, since: soul.token_created_at, grantedAt: soul.token_created_at} : null;
  const grant = legacy ? undefined : store?.currentController(soul.id);
  const holderRow = legacy ?? (grant ? {label: grant.label, since: grant.issued_at ?? grant.created_at, grantedAt: grant.created_at} : null);
  const holder = holderRow ? {label: holderRow.label ?? null, since: holderRow.since ?? null} : null;
  const pending = accountId ? store?.pendingRepair(soul.id, accountId) : undefined;
  if (pending) return {state: 'pairing', reason: 'pending-approval', since: pending.created_at, holder, approvalId: pending.id};
  const p = inbox?.linkPresence({scope: `soul:${soul.id}`, owner: soul.owner}) ?? {presence: 'away' as const, listenedAt: null, connectedSince: null};
  if (holderRow && p.presence !== 'away') return {state: 'connected', reason: 'listening', since: p.connectedSince, holder};
  if (holderRow) {
    const granted = holderRow.grantedAt ?? 0;
    if (p.listenedAt === null || p.listenedAt < granted) return {state: 'disconnected', reason: 'approved-waiting', since: holderRow.grantedAt ?? null, holder};
    return {state: 'disconnected', reason: 'stopped-listening', since: p.listenedAt + SOUL_LISTEN_GRACE_MS, holder};
  }
  const grantEnd = store?.lastRevocation(soul.id);
  const tomb = souls.db.db.prepare('SELECT revoked_at,reason FROM soul_token_tombstones_v1 WHERE world_id=? AND soul_id=? ORDER BY revoked_at DESC LIMIT 1').get(soul.world_id, soul.id) as {revoked_at: number; reason: string | null} | undefined;
  const ended = grantEnd && (!tomb || grantEnd.revoked_at >= tomb.revoked_at) ? {at: grantEnd.revoked_at, reason: grantEnd.revoked_reason} : tomb ? {at: tomb.revoked_at, reason: tomb.reason} : null;
  const why = revocationReason(ended?.reason);
  if (ended && why) return {state: 'disconnected', reason: why, since: ended.at, holder: null};
  if (p.listenedAt !== null) return {state: 'disconnected', reason: 'stopped-listening', since: p.listenedAt + SOUL_LISTEN_GRACE_MS, holder: null};
  return {state: 'disconnected', reason: 'never', since: null, holder: null};
}
