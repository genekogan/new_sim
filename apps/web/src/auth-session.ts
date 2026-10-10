// The page's signed-in person, for code that is not under <Shell>'s props (the god
// panel inside the world view, the launcher homepage). main.tsx publishes whatever
// sign-in this server uses — Clerk in production, a local name under dev auth —
// and everything that acts as the person asks here for a bearer token.
//
// For the Join lane: `signedInUser()` and `makeSoul()` are the two calls a "Join
// this world as a Soul" flow needs; both act as the signed-in Clerk user.
import { useSyncExternalStore } from 'react';
import { apiPath } from './world-path.ts';

export type SessionMode = 'clerk' | 'dev' | 'privy' | 'none';
export type Session = {
  mode: SessionMode;
  /** The provider has loaded (a Clerk session may still be resolving). */
  ready: boolean;
  /** Signed in and, under Clerk, bound to this server's account (`acct_…`). */
  authed: boolean;
  /** What to show for "signed in as" (an email, a name). */
  label: string | null;
  /** Clerk on a non-canonical origin: sign in over there. */
  signInUrl?: string;
  getToken: () => Promise<string | null>;
  login: () => void;
  logout: () => void | Promise<void>;
};

const NONE: Session = { mode: 'none', ready: true, authed: false, label: null, getToken: async () => null, login: () => {}, logout: () => {} };
let current: Session = { ...NONE, ready: false };
const subs = new Set<() => void>();
const subscribe = (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn); }; };

/** main.tsx / Shell: publish the page's sign-in. Re-renders subscribers only when what they show changes. */
export function publishSession(next: Session) {
  const changed = next.mode !== current.mode || next.ready !== current.ready || next.authed !== current.authed || next.label !== current.label || next.signInUrl !== current.signInUrl;
  // functions are always refreshed (a Clerk getToken closes over the latest session) without a re-render
  current = changed ? { ...next } : Object.assign(current, { getToken: next.getToken, login: next.login, logout: next.logout });
  if (changed) for (const fn of subs) fn();
}
export const session = () => current;
export function useSession(): Session { return useSyncExternalStore(subscribe, session, session); }

/** `{ authorization: 'Bearer …' }` as the signed-in person, or `{}` when nobody is. */
export async function userAuthHeaders(): Promise<Record<string, string>> {
  const token = await current.getToken().catch(() => null);
  return token ? { authorization: `Bearer ${token}` } : {};
}

/** The signed-in person as this world sees them (`/v1/me`), or null. */
export async function signedInUser(): Promise<{ userId: string; short: string; souls: string[] } | null> {
  const headers = await userAuthHeaders(); if (!headers.authorization) return null;
  const r = await fetch(apiPath('/v1/me'), { headers, cache: 'no-store' }).catch(() => null);
  if (!r?.ok) return null;
  const d = await r.json() as { me?: { userId: string; short: string; souls: string[] } };
  return d.me ?? null;
}

/** Create a Soul in this world owned by the signed-in person (POST /v1/souls). Throws with the server's message. */
export async function makeSoul(input: { name: string; description?: string }): Promise<{ id: string; name: string; entityId?: string }> {
  const headers = await userAuthHeaders(); if (!headers.authorization) throw new Error('Sign in first.');
  const r = await fetch(apiPath('/v1/souls'), { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(input) });
  const d = await r.json().catch(() => ({})) as { soul?: { id: string; name: string; entityId?: string }; message?: string };
  if (!r.ok || !d.soul) throw new Error(d.message ?? `HTTP ${r.status}`);
  return d.soul;
}
