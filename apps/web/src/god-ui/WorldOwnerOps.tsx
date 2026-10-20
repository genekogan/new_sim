// The owner's world housekeeping, the God modal's "Weather & world" section (GodPanel), backed by the launcher
// (tools/world-launcher/handoff.mjs, worldops.mjs; docs/god/WORLD-OWNER-API.md): offer the world to someone, archive it.
// Co-builders (invite/remove) show only when the site turns them on (`enabled`); Gene 2026-10-16: one god per world, so
// they are off by default and the rows stay hidden (an old co-builder still shows, so the owner can remove them). Nothing here deletes a world: archiving moves it aside, and the site admin can restore it.
import { useCallback, useEffect, useState } from 'react';
import { BASE } from '../base-path.ts';
import { worldKey } from '../world-path.ts';
import { userAuthHeaders } from '../auth-session.ts';
import { CopyButton } from './markdown.tsx';

type Cobuilder = { account: string; at: number };
type Offer = { kind: 'cobuild' | 'transfer'; to?: string; expires: number };
const at = (sub: string) => `${BASE}/__sim/worlds/${worldKey}/${sub}`;
async function call<T>(sub: string, body?: unknown): Promise<T> {
  const r = await fetch(at(sub), { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(await userAuthHeaders()) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.message ?? d.code ?? `HTTP ${r.status}`);
  return d as T;
}
const short = (a: string) => a.replace(/^dev:/, '');

export function WorldOwnerOps() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ enabled?: boolean; cobuilders: Cobuilder[]; offers: Offer[] } | null>(null);
  const [link, setLink] = useState<{ kind: 'cobuild' | 'transfer'; url: string } | null>(null);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const load = useCallback(async () => { try { setState(await call('cobuilders')); } catch (e) { setNote({ text: (e as Error).message, bad: true }); } }, []);
  useEffect(() => { if (open) void load(); }, [open, load]);
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setNote(null);
    try { await fn(); } catch (e) { setNote({ text: (e as Error).message, bad: true }); } finally { setBusy(null); }
  };
  const invite = (kind: 'cobuild' | 'transfer') => run(kind, async () => {
    const d = await call<{ url: string }>(kind === 'cobuild' ? 'cobuilders/invite' : 'transfer', {});
    setLink({ kind, url: d.url }); await load();
  });
  const cancel = () => run('cancel', async () => { await call('offers/cancel', {}); setLink(null); await load(); setNote({ text: 'Open invitations cancelled.' }); });
  const remove = (account: string) => run(account, async () => { const d = await call<{ tokensRevoked: number }>('cobuilders/remove', { account }); await load(); setNote({ text: `${short(account)} removed; ${d.tokensRevoked} agent token${d.tokensRevoked === 1 ? '' : 's'} revoked.` }); });
  const archive = () => run('archive', async () => { await call('archive', { confirm }); location.assign(`${BASE}/`); });
  const pending = state?.offers.length ?? 0;
  const cobuild = !!state?.enabled, oldCobuilders = state?.cobuilders.length ?? 0;

  return (
    <details className="gp-owner-ops" data-owner-ops="1" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>This world: {cobuild ? 'co-builders, ' : ''}hand on, archive{pending ? <span className="gp-count">{pending}</span> : null}</summary>
      {(cobuild || oldCobuilders > 0) && <div className="gp-ops-block" data-ops="cobuilders">
        <div className="gp-row"><b>Co-builders</b>{cobuild && <button className="gp-btn" data-ops-invite="1" disabled={!!busy} onClick={() => void invite('cobuild')}>Invite</button>}</div>
        {state && (state.cobuilders.length
          ? state.cobuilders.map((c) => <div key={c.account} className="gp-row"><span>{short(c.account)}</span><button className="gp-mini" data-ops-remove={c.account} disabled={!!busy} onClick={() => void remove(c.account)}>remove</button></div>)
          : <p className="gp-dim">None yet. Each co-builder pairs their own agent; you can remove them any time.</p>)}
      </div>}
      <div className="gp-ops-block" data-ops="transfer">
        <div className="gp-row"><b>Hand it on</b><button className="gp-btn" data-ops-transfer="1" disabled={!!busy} onClick={() => void invite('transfer')}>Offer</button></div>
        <p className="gp-dim">Whoever opens the link and accepts becomes its god, and your agents lose access.</p>
      </div>
      {link && <div className="gp-ops-link" data-ops-link={link.kind}>
        <span className="gp-dim">{link.kind === 'cobuild' ? 'Co-builder invitation' : 'Handoff offer'} (one use, 7 days). Send it only to them:</span>
        <div className="gp-row"><code>{link.url}</code><CopyButton text={link.url} /></div>
      </div>}
      {pending > 0 && <div className="gp-row"><span className="gp-dim">{pending} open invitation{pending === 1 ? '' : 's'}</span><button className="gp-mini" data-ops-cancel="1" disabled={!!busy} onClick={() => void cancel()}>cancel all</button></div>}
      <div className="gp-ops-block" data-ops="archive">
        <b>Archive</b>
        <p className="gp-dim">Stops it and takes it off the list. Nothing is deleted; the site admin can restore it. Type <code>{worldKey}</code> to confirm.</p>
        <div className="gp-row"><input aria-label="Type the world's address to confirm" data-ops-confirm="1" value={confirm} onChange={(e) => setConfirm(e.target.value.trim())} placeholder={worldKey} /><button className="gp-btn gp-danger" data-ops-archive="1" disabled={confirm !== worldKey || !!busy} onClick={() => void archive()}>{busy === 'archive' ? 'Archiving…' : 'Archive'}</button></div>
      </div>
      {note && <p className={note.bad ? 'gp-bad' : 'gp-ok'}>{note.text}</p>}
    </details>
  );
}
