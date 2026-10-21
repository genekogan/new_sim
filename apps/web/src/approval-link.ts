/** `#approve/ap_…` — the link the Soul CLI prints for its human. No imports: node tests and the page shell both read it. */
export const approvalFromHash = (hash: string) => /^#approve\/(ap_[a-f0-9]{32})$/.exec(hash)?.[1] ?? null;

const MODES = ['create', 'repair'], STATUSES = ['pending', 'creating', 'ready', 'refused', 'cancelled', 'expired'];
/** A world's answer about one approval is that request (`id`), well formed, and ready only together with its Soul. With
 *  `worldId` it must also be this world's request: a shared account registry answers any world's id, and the older
 *  worlds' view refused another world's request (lane LAP 2026-10-21 keeps that), so a link from one world opened on
 *  another can neither be approved there nor make its camera follow a Soul that does not live there. */
export function validApproval(value: unknown, id: string, worldId?: string): boolean {
  const a = value as { id?: unknown; worldId?: unknown; mode?: unknown; status?: unknown; name?: unknown; agentLabel?: unknown; soulId?: unknown } | null;
  if (!a || typeof a !== 'object' || a.id !== id || !MODES.includes(a.mode as string) || !STATUSES.includes(a.status as string)) return false;
  if (typeof a.name !== 'string' || typeof a.agentLabel !== 'string') return false;
  if (!(a.soulId === null || (typeof a.soulId === 'string' && /^s_[A-Za-z0-9_-]+$/.test(a.soulId)))) return false;
  if (a.status === 'ready' && a.soulId === null) return false;
  return worldId === undefined || a.worldId === worldId;
}
