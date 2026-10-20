// G4 (Gene 2026-10-20): one God modal under the God button. The button lives in Shell's top bar, the modal in LiveWorld
// (GodPanel owns flags and the entity layer), so a tiny store joins them: whether the modal is open, which section, and
// the owner's agent inbox (presence for the button's dot, the ticket log for the modal), polled every 2 s while the modal
// is open and every 6 s while it is closed. Visitors never poll the inbox.
import { useSyncExternalStore } from 'react';
import { apiPath } from '../world-path.ts';
import { userAuthHeaders } from '../auth-session.ts';

export type Section = 'agent' | 'start' | 'edits' | 'flags' | 'previews' | 'souls' | 'constitution' | 'world';
export type Outcome = 'done' | 'failed' | 'withdrawn';
export type Presence = 'listening' | 'working' | 'recent' | 'away';
export type TicketFocus = { x: number; y: number; z: number; span: number; label?: string; count: number };
export type Ticket = { id: string; text: string; state: 'sent' | 'delivered' | 'acknowledged'; sentAt: number; deliveredAt?: number; acknowledgedAt?: number; reply?: string; outcome?: Outcome; focus?: TicketFocus; touched?: number };
export type GodInbox = { connected: boolean; presence?: Presence; lastSeenAt: number | null; latest: Ticket | null; queued?: number; log?: Ticket[] };

type State = { open: boolean; section: Section; inbox: GodInbox | null; inboxError: boolean };
let state: State = { open: false, section: 'agent', inbox: null, inboxError: false };
const subs = new Set<() => void>();
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; for (const f of [...subs]) f(); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const SERVER: State = { open: false, section: 'agent', inbox: null, inboxError: false };
export function useGod(): State { return useSyncExternalStore(subscribe, () => state, () => SERVER); }
export const godState = () => state;

export function openGod(section?: Section) { set({ open: true, ...(section ? { section } : {}) }); void pollNow(); }
export function closeGod() { set({ open: false }); }
export function toggleGod() { if (state.open) closeGod(); else openGod(); }
export function showSection(section: Section) { set({ section }); }

/** Ticket status words, as the owner reads them. */
export function ticketStatus(t: Ticket): { key: 'pending' | 'progress' | Outcome; word: string } {
  if (t.state === 'acknowledged') return t.outcome === 'failed' ? { key: 'failed', word: 'Failed' } : t.outcome === 'withdrawn' ? { key: 'withdrawn', word: 'Withdrawn' } : { key: 'done', word: 'Done' };
  return t.state === 'delivered' ? { key: 'progress', word: 'In progress' } : { key: 'pending', word: 'Pending' };
}
export const presenceWord = (p: Presence | undefined, connected: boolean) => !connected ? 'Agent not connected' : p === 'listening' ? 'Agent connected · listening' : p === 'working' ? 'Agent connected · working' : 'Agent connected';

async function call(path: string, body?: unknown): Promise<GodInbox> {
  const r = await fetch(apiPath(path), { method: body === undefined ? 'GET' : 'POST', headers: { ...(await userAuthHeaders()), 'content-type': 'application/json' }, cache: 'no-store', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.inbox) throw new Error(d.message ?? d.error?.message ?? (r.status === 429 ? 'Too many commands are waiting. Withdraw some, or let your agent catch up.' : 'That did not reach the world. Try again.'));
  return d.inbox as GodInbox;
}

// --- polling: only while an owner page has asked for it (GodButton mounts it for the owner) ---
let watchers = 0, timer: ReturnType<typeof setTimeout> | undefined, generation = 0, inflight = false;
async function pollNow() {
  if (!watchers || inflight) return;
  inflight = true; const gen = generation; clearTimeout(timer);
  try { const inbox = await call('/v1/god/inbox'); if (gen === generation) set({ inbox, inboxError: false }); }
  catch { if (gen === generation) set({ inboxError: true }); }
  finally { inflight = false; if (watchers) timer = setTimeout(() => void pollNow(), state.open ? 2000 : 6000); }
}
/** Start polling the owner's inbox; the returned function stops this watcher. */
export function watchInbox() {
  watchers++; if (watchers === 1) void pollNow();
  return () => { watchers = Math.max(0, watchers - 1); if (!watchers) { clearTimeout(timer); generation++; set({ inbox: null, inboxError: false }); } };
}
/** Send a command; the answer is the new log. */
export async function sendCommand(text: string) { generation++; const inbox = await call('/v1/god/inbox', { text }); set({ inbox, inboxError: false }); return inbox; }
export async function withdrawCommand(id: string) { generation++; const inbox = await call(`/v1/god/inbox/${encodeURIComponent(id)}/withdraw`, {}); set({ inbox, inboxError: false }); return inbox; }
