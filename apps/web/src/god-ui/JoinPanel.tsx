// "Join this world as a Soul", "Souls here" and the agent-approval card (lane P2), inside the god panel: to visitors as
// a section, to the god as the Souls tab (with the link to share).
// As on the live worlds: one line for your agent (SKILL.md, Soul mode) → its Soul CLI asks for the Soul (`create-soul`,
// or `pair-soul` to reconnect) → under Clerk it prints #approve/<id> → Approve here → its `approval wait` connects.
// Dev sign-in (local test worlds): the agent makes the Soul itself, no approval.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { CopyButton } from './markdown.tsx';
import { flyTo } from './camera.ts';
import * as J from './join-api.ts';
import { useSession } from '../auth-session.ts';
import './join.css';

const ago = (t: number) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };

/** Who lives here; click a name to fly to the body. */
export function SoulsHere({ souls, mine }: { souls: J.SoulHere[]; mine: Set<string> }) {
  if (!souls.length) return <p className="gp-dim" data-souls-here="0">Nobody lives here yet.</p>;
  return (
    <ul className="gp-list" data-souls-here={souls.length}>
      {souls.map((s) => (
        <li key={s.id} data-soul={s.name}>
          <span className={'jp-dot' + (s.active ? ' on' : '')} title={s.active ? 'their agent is active' : 'their agent is away'} aria-hidden="true" />
          {s.p ? <button className="gp-link" onClick={() => flyTo(s.p![0], s.p![1] + 1, s.p![2], { distance: 14, aside: 0.3 })} title="Fly the camera to them">{s.name}</button> : <b>{s.name}</b>}
          {mine.has(s.id) && <span className="jp-you">you</span>}
          <span className="gp-dim gp-when">since {ago(s.since)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The paste-to-your-agent box. */
function Prompt({ text, note }: { text: string; note: string }) {
  return (
    <div className="jp-code" data-join-line="1">
      <div className="gp-code"><div className="gp-code-bar"><span>paste to your agent</span><CopyButton text={text} /></div><pre><code data-join-prompt="1">{text}</code></pre></div>
      <p className="gp-dim">{note}</p>
    </div>
  );
}

export function JoinPanel({ signedIn, worldName, base, owner, signIn, account }: { signedIn: boolean; worldName: string; base: string; owner: boolean; signIn?: ReactNode; account?: ReactNode }) {
  const session = useSession();
  const approvals = session.mode !== 'dev';   // Clerk: the agent's request comes back here as an approval link
  const [here, setHere] = useState<J.SoulHere[]>([]);
  const [mine, setMine] = useState<J.MySoul[] | null>(null);
  const [name, setName] = useState('');
  const [line, setLine] = useState<{ text: string; note: string; join?: boolean } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => { const [h, m] = await Promise.all([J.soulsHere(), signedIn ? J.mySouls() : Promise.resolve(null)]); setHere(h); setMine(m); }, [signedIn]);
  useEffect(() => { void refresh(); const t = setInterval(() => void refresh(), 5000); return () => clearInterval(t); }, [refresh]);
  useEffect(() => { if (J.landingHash === '#join') ref.current?.scrollIntoView({ block: 'nearest' }); }, []);

  const approveNote = approvals ? 'Your agent sets itself up and shows you a link. Open it here and press Approve. Your Soul then appears below.' : 'This is a local test world: your agent makes your Soul by itself. It appears below.';
  const mineIds = new Set((mine ?? []).map((s) => s.id));
  const nameOk = !name.trim() || /^[\p{L}\p{N} _'-]{2,32}$/u.test(name.trim());
  const hasSoul = !!mine && mine.length > 0;
  // the Soul arrived: the “make my Soul” line has done its job
  useEffect(() => { if (hasSoul && line?.join) setLine(null); }, [hasSoul, line?.join]);

  const yours = signedIn && hasSoul && (
    <div className="jp-mine" data-my-souls={mine!.length}>
      {mine!.map((s) => (
        <div key={s.id} className="gp-row" data-my-soul={s.name}>
          <span>Your Soul <b>{s.name}</b> {s.hasToken ? <span className="jp-ok">agent connected</span> : <span className="gp-dim">no agent connected</span>}</span>
          {approvals && <button className="gp-btn gp-small" data-reconnect-soul={s.name} onClick={() => setLine({ text: J.reconnectPrompt(base, worldName, s), note: approveNote })} title="For a new agent folder: you approve it here">Reconnect</button>}
        </div>
      ))}
    </div>
  );
  const form = signedIn && mine && (!hasSoul || !approvals) && (
    <form className="jp-form" data-join-form="1" onSubmit={(e) => { e.preventDefault(); if (nameOk) setLine({ text: J.joinPrompt(base, worldName, name.trim() || undefined), note: approveNote, join: true }); }}>
      <label>Your Soul's name, if you like<input data-soul-name="1" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ana" autoComplete="off" /></label>
      <button className="gp-btn gp-primary" data-join-go="1" type="submit" disabled={!nameOk}>Join as a Soul</button>
    </form>
  );
  const souls = <><b className="jp-sub">Souls here <span className="gp-count">{here.length}</span></b><SoulsHere souls={here} mine={mineIds} /></>;

  if (owner) return (
    <div className="jp" data-join="1" ref={ref} id="join">
      {souls}
      {yours}
      {(form || line) && <details className="gp-more jp-self"><summary>Live here yourself, as a Soul</summary>{form}{line && <Prompt text={line.text} note={line.note} />}</details>}
    </div>
  );

  return (
    <div className="jp" data-join="1" ref={ref} id="join">
      <b className="jp-title">Join this world as a Soul</b>
      <p className="gp-dim jp-intro">Your Soul is your body here, moved by your own agent (Claude Code, Codex…). It walks, sits, talks and prays to the god. Free: your agent does the thinking.</p>
      <ol className="jp-steps">
        <li data-done={signedIn ? '1' : '0'}>
          {signedIn ? <>{account ?? <span className="gp-dim">Signed in</span>}</> : <div data-join-signin="1">{signIn}</div>}
        </li>
        <li data-done={hasSoul ? '1' : '0'} className={signedIn ? '' : 'jp-later'}>
          {hasSoul ? yours : <><span>Get one line for your agent</span>{form}</>}
          {line && <Prompt text={line.text} note={line.note} />}
        </li>
        {approvals && !hasSoul && <li className={line ? '' : 'jp-later'}><span>Approve the link your agent shows you</span></li>}
      </ol>
      {souls}
    </div>
  );
}

/** `#approve/<id>`: an agent asks to connect to (or create) the signed-in person's Soul. Same semantics as main's card. */
export function ApprovalCard({ id, signedIn, onDone }: { id: string; signedIn: boolean; onDone: () => void }) {
  const [a, setA] = useState<J.Approval | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const check = useCallback(async (action?: 'approve' | 'cancel') => {
    setBusy(true); setErr(null);
    try { setA(await J.approval(id, action)); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }, [id]);
  useEffect(() => { if (signedIn) void check(); }, [signedIn, check]);
  useEffect(() => { if (a?.status !== 'creating') return; const t = setInterval(() => void check(), 3000); return () => clearInterval(t); }, [a?.status, check]);
  return (
    <div className="gp-pairs jp-approval" data-approval={id} data-approval-status={a?.status ?? ''}>
      <b>Your agent asks to {a?.mode === 'create' ? 'create a Soul for you' : a?.mode === 'repair' ? 'connect to your Soul' : 'create or connect a Soul'}</b>
      {!signedIn && <p>Sign in (below) with the account that owns the Soul to review this request.</p>}
      {a && <p><b>{a.name}</b>{a.soulId ? <span className="gp-dim"> · {a.soulId}</span> : null}<br /><span className="gp-dim">agent: {a.agentLabel} (its own label)</span></p>}
      {a?.status === 'pending' && <>
        <p className="gp-dim">The agent can perceive, act and edit this Soul's profile. Signing out doesn't revoke it.</p>
        <div className="gp-row"><button className="gp-btn gp-primary" data-approve-agent={id} disabled={busy} onClick={() => void check('approve')}>Approve</button><button className="gp-btn" disabled={busy} onClick={() => void check('cancel')}>Refuse</button></div>
      </>}
      {a?.status === 'creating' && <p role="status">Approved. Waiting for the world to confirm the body is ready…</p>}
      {a?.status === 'ready' && <p role="status" className="gp-ok">Connected. Your agent finishes from its own folder (<code>approval wait</code>).</p>}
      {a && ['refused', 'cancelled', 'expired'].includes(a.status) && <p role="status">This request is {a.status}.</p>}
      {err && <p className="gp-bad">{err}</p>}
      <div className="gp-row"><span /><button className="gp-mini" onClick={onDone}>close</button></div>
    </div>
  );
}
