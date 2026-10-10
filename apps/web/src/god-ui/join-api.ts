// "Join this world as a Soul" (lane P2): the signed-in person makes a Soul here and pairs their own agent with it.
// The server flow is the existing owner one: POST /v1/souls → POST /v1/souls/:id/pair (a one-use code) → the agent
// exchanges the code at POST /v1/agent/pair (SKILL.md, Soul mode). Identity comes from god-api's authHeaders(), the one
// place the page says who is signed in.
import { apiPath, worldKey } from '../world-path.ts';
import { authHeaders } from './god-api.ts';

export type MySoul = { id: string; name: string; entityId: string; hasToken: boolean; tokenCreatedAt?: number | null };
export type SoulHere = { id: string; entityId: string; name: string; since: number; active: boolean; p?: [number, number, number] };
export type PairCode = { code: string; expiresAt: number };

async function json<T>(r: Response): Promise<T> {
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((d as { message?: string }).message ?? `HTTP ${r.status}`) as Error & { code?: string; status?: number }; e.code = (d as { code?: string }).code; e.status = r.status; throw e; }
  return d as T;
}
const post = (path: string, body: unknown) => fetch(apiPath(path), { method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** The signed-in person's Souls in this world; null when nobody is signed in (or the world refuses them). */
export async function mySouls(): Promise<MySoul[] | null> {
  if (!authHeaders().authorization) return null;
  try { const r = await fetch(apiPath('/v1/me'), { headers: authHeaders() }); if (!r.ok) return null; const d = await r.json() as { souls?: MySoul[] }; return d.souls ?? []; } catch { return null; }
}
/** Everyone who lives here (public). */
export async function soulsHere(): Promise<SoulHere[]> {
  try { const r = await fetch(apiPath('/v1/world/souls')); return r.ok ? ((await r.json()) as { souls: SoulHere[] }).souls : []; } catch { return []; }
}
export async function createSoul(name: string, description?: string): Promise<MySoul> {
  const d = await json<{ soul: MySoul }>(await post('/v1/souls', { name, ...(description ? { description } : {}) }));
  return d.soul;
}
/** A one-use code for the person's agent. A Soul is pairable once its body has arrived: retry briefly after birth. */
export async function pairCode(soulId: string, { tries = 30 } = {}): Promise<PairCode> {
  for (let i = 0; ; i++) {
    try { const d = await json<{ code: string; expires_in: number }>(await post(`/v1/souls/${encodeURIComponent(soulId)}/pair`, {})); return { code: d.code, expiresAt: Date.now() + d.expires_in * 1000 }; }
    catch (e) { if ((e as { code?: string }).code !== 'not-in-world' || i >= tries) throw e; await new Promise((r) => setTimeout(r, 500)); }
  }
}

/** The absolute URL of this world (what agents fetch), from the server's own base when known. */
export const worldUrl = (base?: string) => base || `${location.origin}/w/${worldKey}`;
/** The one thing the person pastes to their agent. */
export const joinPrompt = (base: string, worldName: string, soulName: string, code: string) =>
  `Read ${base}/SKILL.md and follow its Soul mode section: pair with my Soul "${soulName}" in the Eden world "${worldName}". Pairing code: ${code}`;
/** The link a god shares so friends land on the Join section. */
export const joinLink = (base?: string) => `${worldUrl(base)}/#join`;
