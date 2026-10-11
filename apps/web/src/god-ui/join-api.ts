// "Join this world as a Soul" (lane P2), exactly as on the live worlds: the person's agent asks for the Soul with the
// Soul CLI (`create-soul`, or `pair-soul` to reconnect one) and prints an approval link (#approve/<id>); the signed-in
// person approves it on this page; the agent's `approval wait` connects. Only existing endpoints: /v1/me, the public
// /v1/world/souls, and main's account approvals (/v1/account/approvals/:id[/approve|/cancel]). Who is signed in comes
// from auth-session.ts, the one place.
import { apiPath, worldPath } from '../world-path.ts';
import { userAuthHeaders } from '../auth-session.ts';

export type MySoul = { id: string; name: string; entityId: string; hasToken: boolean };
export type SoulHere = { id: string; entityId: string; name: string; since: number; active: boolean; p?: [number, number, number] };
export type Approval = { id: string; worldId: string; agentLabel: string; name: string; description: string; mode: 'create' | 'repair'; status: 'pending' | 'creating' | 'ready' | 'refused' | 'cancelled' | 'expired'; soulId: string | null; expiresAt: number };

/** The signed-in person's Souls in this world; null when nobody is signed in (or the world refuses them). */
export async function mySouls(): Promise<MySoul[] | null> {
  const headers = await userAuthHeaders(); if (!headers.authorization) return null;
  try { const r = await fetch(apiPath('/v1/me'), { headers, cache: 'no-store' }); if (!r.ok) return null; const d = await r.json() as { souls?: MySoul[] }; return d.souls ?? []; } catch { return null; }
}
/** Everyone who lives here (public). */
export async function soulsHere(): Promise<SoulHere[]> {
  try { const r = await fetch(apiPath('/v1/world/souls'), { cache: 'no-store' }); return r.ok ? ((await r.json()) as { souls: SoulHere[] }).souls : []; } catch { return []; }
}

/** The URL fragment the page was opened with, read when this module loads: the page shell rewrites the fragment to its
 *  own tab once it renders, so `#join` and `#approve/<id>` must be caught before that. */
export const landingHash = typeof location === 'undefined' ? '' : location.hash;
/** `#approve/ap_…` — the link the Soul CLI prints for its human (main's format). */
export const approvalFromHash = (hash: string) => /^#approve\/(ap_[a-f0-9]{32})$/.exec(hash)?.[1] ?? null;
const valid = (a: Approval | undefined, id: string): a is Approval => !!a && a.id === id && ['create', 'repair'].includes(a.mode) && ['pending', 'creating', 'ready', 'refused', 'cancelled', 'expired'].includes(a.status) && typeof a.name === 'string' && typeof a.agentLabel === 'string' && (a.soulId === null || /^s_[A-Za-z0-9_-]+$/.test(a.soulId));
/** Read (or act on) one approval as the signed-in person. */
export async function approval(id: string, action?: 'approve' | 'cancel'): Promise<Approval> {
  const headers = await userAuthHeaders(); if (!headers.authorization) throw new Error('Sign in first.');
  const r = await fetch(apiPath(`/v1/account/approvals/${id}${action ? '/' + action : ''}`), { method: action ? 'POST' : 'GET', headers: { ...headers, ...(action ? { 'content-type': 'application/json' } : {}) }, ...(action ? { body: '{}' } : {}), cache: 'no-store' });
  const d = await r.json().catch(() => ({})) as { approval?: Approval; message?: string };
  if (!r.ok || !valid(d.approval, id)) throw new Error(r.status === 403 ? 'This approval belongs to another account.' : d.message ?? 'This approval is unavailable. Sign in with the intended account and check again.');
  return d.approval;
}

/** The absolute URL of this world (what agents fetch), from the server's own base when known. */
export const worldUrl = (base?: string) => base || `${location.origin}${worldPath}`;
/** The one thing the person pastes to their agent: make my Soul here. */
export const joinPrompt = (base: string, worldName: string, name?: string) =>
  `Read ${base}/SKILL.md and follow its Soul mode section: make my Soul${name ? ` "${name}"` : ''} in the Eden world "${worldName}". If it gives an approval link, show it to me and I'll approve it.`;
/** …or reconnect a Soul I already have here (a new agent folder). */
export const reconnectPrompt = (base: string, worldName: string, soul: { id: string; name: string }) =>
  `Read ${base}/SKILL.md and follow its Soul mode section: reconnect my Soul "${soul.name}" (${soul.id}) in the Eden world "${worldName}". Show me the approval link and I'll approve it.`;
/** The link a god shares so friends land on the Join section. */
export const joinLink = (base?: string) => `${worldUrl(base)}/#join`;
