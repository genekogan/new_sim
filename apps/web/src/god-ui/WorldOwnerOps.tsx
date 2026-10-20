// The owner's world housekeeping. G5 (Gene 2026-10-20b): "Forsake world", the danger zone that takes the God Mode modal over
// (GodModal OwnerGod, section 'forsake'), with explicit confirmations. Backed by the launcher
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
class Unavailable extends Error { constructor() { super('This world is not run by the Sim launcher, so it cannot be handed on or archived from here.'); } }
async function call<T>(sub: string, body?: unknown): Promise<T> {
  const r = await fetch(at(sub), { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(await userAuthHeaders()) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  // A world the Sim launcher does not run answers these paths with the page itself (HTML), not JSON: say so plainly
  // instead of reading an empty object as "no offers" and crashing on it.
  if (!/json/.test(r.headers.get('content-type') ?? '')) throw new Unavailable();
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.message ?? d.code ?? `HTTP ${r.status}`);
  return d as T;
}
const asState = (d: Partial<{ enabled: boolean; cobuilders: Cobuilder[]; offers: Offer[] }>) =>
  ({ enabled: !!d.enabled, cobuilders: Array.isArray(d.cobuilders) ? d.cobuilders : [], offers: Array.isArray(d.offers) ? d.offers : [] });
const short = (a: string) => a.replace(/^dev:/, '');

export function ForsakeWorld({ name }: { name: string }) {
  const [state, setState] = useState<{ enabled?: boolean; cobuilders: Cobuilder[]; offers: Offer[] } | null>(null);
  const [link, setLink] = useState<{ kind: 'cobuild' | 'transfer'; url: string } | null>(null);
  const [handing, setHanding] = useState(false);   // the hand-on confirmation is showing
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const load = useCallback(async () => {
    try { setState(asState(await call('cobuilders'))); }
    catch (e) { if (e instanceof Unavailable) setUnavailable(true); setNote({ text: (e as Error).message, bad: !(e instanceof Unavailable) }); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setNote(null);
    try { await fn(); } catch (e) { setNote({ text: (e as Error).message, bad: true }); } finally { setBusy(null); }
  };
  const invite = (kind: 'cobuild' | 'transfer') => run(kind, async () => {
    const d = await call<{ url: string }>(kind === 'cobuild' ? 'cobuilders/invite' : 'transfer', {});
    setLink({ kind, url: d.url }); setHanding(false); await load();
  });
  const cancel = () => run('cancel', async () => { await call('offers/cancel', {}); setLink(null); await load(); setNote({ text: 'Open links cancelled. Nobody can accept them now.' }); });
  const remove = (account: string) => run(account, async () => { const d = await call<{ tokensRevoked: number }>('cobuilders/remove', { account }); await load(); setNote({ text: `${short(account)} removed; ${d.tokensRevoked} agent token${d.tokensRevoked === 1 ? '' : 's'} revoked.` }); });
  const archive = () => run('archive', async () => { await call('archive', { confirm }); location.assign(`${BASE}/`); });
  const pending = state?.offers.length ?? 0;
  const cobuild = !!state?.enabled, oldCobuilders = state?.cobuilders.length ?? 0;

  return (
    <div className="gm-forsake" data-owner-ops="1">
      <p className="gm-forsake-lead">Both of these take <b>{name}</b> out of your hands. Your agent stops being its god.</p>
      <section className="gm-danger" data-ops="transfer">
        <h3>Hand it on</h3>
        <p>Make a one-use link (valid 7 days). Whoever opens it and accepts becomes this world's god, and your agent loses access.</p>
        {link?.kind === 'transfer'
          ? <div className="gm-danger-link" data-ops-link="transfer"><span>Send this only to them:</span><div className="gm-danger-row"><code>{link.url}</code><CopyButton text={link.url} /></div></div>
          : handing
            ? <div className="gm-danger-confirm" role="group" aria-label="Confirm the handoff link">
              <p>Create the link? Anyone who has it can take this world until you cancel it.</p>
              <div className="gm-danger-row">
                <button type="button" className="gm-danger-btn" data-ops-transfer-confirm="1" disabled={!!busy} onClick={() => void invite('transfer')}>{busy === 'transfer' ? 'Creating…' : 'Yes, create the link'}</button>
                <button type="button" className="gm-quiet" onClick={() => setHanding(false)}>Cancel</button>
              </div>
            </div>
            : <button type="button" className="gm-danger-ghost" data-ops-transfer="1" disabled={!!busy || unavailable} onClick={() => setHanding(true)}>Create a handoff link…</button>}
        {pending > 0 && <div className="gm-danger-row gm-danger-pending"><span>{pending === 1 ? '1 open link' : `${pending} open links`}</span><button type="button" className="gm-quiet" data-ops-cancel="1" disabled={!!busy} onClick={() => void cancel()}>Cancel {pending === 1 ? 'it' : 'them'}</button></div>}
      </section>
      <section className="gm-danger" data-ops="archive">
        <h3>Archive</h3>
        <p>Stops the world and takes it off the list. Nothing is deleted; the site admin can restore it.</p>
        <label className="gm-danger-label" htmlFor="gm-archive-confirm">Type <code>{worldKey}</code> to confirm</label>
        <div className="gm-danger-row">
          <input id="gm-archive-confirm" data-ops-confirm="1" value={confirm} autoComplete="off" spellCheck={false} onChange={(e) => setConfirm(e.target.value.trim())} placeholder={worldKey} />
          <button type="button" className="gm-danger-btn" data-ops-archive="1" disabled={confirm !== worldKey || !!busy || unavailable} onClick={() => void archive()}>{busy === 'archive' ? 'Archiving…' : 'Archive world'}</button>
        </div>
      </section>
      {(cobuild || oldCobuilders > 0) && <section className="gm-danger gm-danger-soft" data-ops="cobuilders">
        <div className="gm-danger-row"><h3>Co-builders</h3>{cobuild && <button type="button" className="gm-quiet" data-ops-invite="1" disabled={!!busy} onClick={() => void invite('cobuild')}>Invite</button>}</div>
        {state && (state.cobuilders.length
          ? state.cobuilders.map((c) => <div key={c.account} className="gm-danger-row"><span>{short(c.account)}</span><button type="button" className="gm-quiet" data-ops-remove={c.account} disabled={!!busy} onClick={() => void remove(c.account)}>Remove</button></div>)
          : <p>None yet. Each co-builder pairs their own agent; you can remove them any time.</p>)}
        {link?.kind === 'cobuild' && <div className="gm-danger-link" data-ops-link="cobuild"><span>Co-builder invitation (one use, 7 days). Send it only to them:</span><div className="gm-danger-row"><code>{link.url}</code><CopyButton text={link.url} /></div></div>}
      </section>}
      {note && <p className={'gm-danger-note' + (note.bad ? ' bad' : '')} role="status">{note.text}</p>}
    </div>
  );
}
