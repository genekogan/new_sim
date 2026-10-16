// GOVERN (lane C17): the world page's view of a god world's governance (server: apps/server/src/god/governance.ts).
// Public reads for everyone; the owner's decisions go through this world's god token (god-api.ts).
import { apiPath, worldKey } from '../world-path.ts';
import { god } from './god-api.ts';

export type Amendment = {
  id: string; title: string; text: string; replacesWholeText?: boolean; full?: string; fullChars?: number;
  by: { name: string }; at: number; status: 'open' | 'accepted' | 'declined' | 'withdrawn';
  support: number; supporters: string[]; activeSupport: number; baseVersion: number; stale: boolean;
  decided?: { at: number | null; by: string | null; reason: string | null; version: number | null };
};
export type HistoryRow = { version: number; at: number; by: 'god' | 'residents'; note: string | null; amendment: string | null };
export type Governance = {
  contract: 'governance/1';
  constitution: { version: number; text: string; at: number | null; chars: number };
  history: HistoryRow[]; amendments: Amendment[];
  prayers: { total: number; answered: number; waiting: number };
  residentsDecide: boolean; residents: number; needed: number;
};
export type Prayer = { id: string; soul_name: string; text: string; at: number; answer: string | null; answered_at: number | null };

export async function governance(): Promise<Governance | null> {
  try { const r = await fetch(apiPath('/v1/world/governance'), { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch { return null; }
}
export async function versionText(n: number): Promise<string | null> {
  try { const r = await fetch(apiPath(`/v1/world/constitution/versions/${n}`)); return r.ok ? ((await r.json()) as { text: string }).text : null; } catch { return null; }
}
export const decide = (id: string, decision: 'accept' | 'decline', reason?: string) => god<{ ok: true; version?: number; amendment: Amendment }>(`/v1/god/amendments/${encodeURIComponent(id)}/decide`, { method: 'POST', body: JSON.stringify({ decision, ...(reason ? { reason } : {}) }) });
export const setResidentsDecide = (on: boolean) => god<{ ok: true; residentsDecide: boolean }>('/v1/god/governance', { method: 'POST', body: JSON.stringify({ residentsDecide: on }) });
export const prayers = async () => (await god<{ prayers: Prayer[] }>('/v1/god/prayers?all=1')).prayers;
export const answer = (prayer: string, text: string) => god<{ ok: true }>('/v1/god/answer', { method: 'POST', body: JSON.stringify({ prayer, text }) });

// ---- "changed since your last visit" for a visitor: the version this browser last opened, per world
const SEEN_KEY = `sim.constitutionSeen:${worldKey}`;
export function seenVersion(): number | null { try { const v = localStorage.getItem(SEEN_KEY); return v === null ? null : Number(v) || 0; } catch { return null; } }
export function markSeen(version: number) { try { if ((seenVersion() ?? -1) < version) localStorage.setItem(SEEN_KEY, String(version)); } catch { /* storage disabled */ } }

export { lineDiff, changedOnly, type DiffLine } from './line-diff.ts';
