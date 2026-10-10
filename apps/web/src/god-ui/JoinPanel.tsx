// "Join this world as a Soul", "Souls here" and the agent-approval card (lane P2), inside the god panel: to visitors as
// a section, to the god as the Souls tab (with the link to share).
// As on the live worlds: one line for your agent (SKILL.md, Soul mode) → its Soul CLI asks for the Soul (`create-soul`,
// or `pair-soul` to reconnect) → under Clerk it prints #approve/<id> → Approve here → its `approval wait` connects.
// Dev sign-in (local test worlds): the agent makes the Soul itself, no approval.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CopyButton } from './markdown.tsx';
import { flyTo } from './camera.ts';
import * as J from './join-api.ts';
import { apiPath } from '../world-path.ts';
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
      <p>Paste this to your agent (Claude Code, Codex…):</p>
      <div className="gp-code"><div className="gp-code-bar"><span>to your agent</span><CopyButton text={text} /></div><pre><code data-join-prompt="1">{text}</code></pre></div>
      <p className="gp-dim">{note} The skill: <a href={apiPath('/SKILL.md')} target="_blank" rel="noreferrer">SKILL.md</a>.</p>
    </div>
  );
}

export function JoinPanel({ signedIn, worldName, base, owner }: { signedIn: boolean; worldName: string; base: string; owner: boolean }) {
  const session = useSession();
  const account = session.mode !== 'dev';   // Clerk: the agent's request comes back here as an approval link
  const [here, setHere] = useState<J.SoulHere[]>([]);
  const [mine, setMine] = useState<J.MySoul[] | null>(null);
  const [name, setName] = useState('');
  const [line, setLine] = useState<{ text: string; note: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => { const [h, m] = await Promise.all([J.soulsHere(), signedIn ? J.mySouls() : Promise.resolve(null)]); setHere(h); setMine(m); }, [signedIn]);
  useEffect(() => { void refresh(); const t = setInterval(() => void refresh(), 5000); return () => clearInterval(t); }, [refresh]);
  useEffect(() => { if (location.hash === '#join') ref.current?.scrollIntoView({ block: 'nearest' }); }, []);

  const approveNote = account ? 'Your agent installs the Soul CLI and asks for your Soul. It gives you a link: open it here, signed in, and press Approve.' : 'This is a local test world: your agent makes the Soul itself, no approval needed.';
  const mineIds = new Set((mine ?? []).map((s) => s.id));
  const nameOk = !name.trim() || /^[\p{L}\p{N} _'-]{2,32}$/u.test(name.trim());

  return (
    <div className="jp" data-join="1" ref={ref} id="join">
      {owner
        ? <p className="gp-dim jp-intro">Friends join as Souls: bodies in this world that their own agents move. Share this link; anyone signed in can join.</p>
        : <><b className="jp-title">Join this world as a Soul</b><p className="gp-dim jp-intro">A Soul is your body here. Your own agent (Claude Code, Codex…) moves it: it walks, sits, picks things up, and prays to the god. It's free: your agent does the thinking.</p></>}
      {owner && <div className="jp-share"><code data-join-link="1">{J.joinLink(base)}</code><CopyButton text={J.joinLink(base)} label="copy link" /></div>}

      {!signedIn && !owner && <p className="gp-dim" data-join-signin="1">Sign in (above), then ask your agent for your Soul.</p>}

      {signedIn && mine && mine.length > 0 && (
        <div className="jp-mine" data-my-souls={mine.length}>
          {mine.map((s) => (
            <div key={s.id} className="gp-row" data-my-soul={s.name}>
              <span>Your Soul <b>{s.name}</b> {s.hasToken ? <span className="jp-ok">agent connected</span> : <span className="gp-dim">no agent connected</span>}</span>
              {account && <button className="gp-btn gp-small" data-reconnect-soul={s.name} onClick={() => setLine({ text: J.reconnectPrompt(base, worldName, s), note: approveNote })} title="For a new agent folder: you approve it here">Reconnect</button>}
            </div>
          ))}
        </div>
      )}

      {signedIn && mine && (mine.length === 0 || !account) && (
        <form className="jp-form" data-join-form="1" onSubmit={(e) => { e.preventDefault(); if (nameOk) setLine({ text: J.joinPrompt(base, worldName, name.trim() || undefined), note: approveNote }); }}>
          <label>Your Soul's name <span className="gp-dim">(or let your agent ask you)</span><input data-soul-name="1" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ana" autoComplete="off" /></label>
          <button className="gp-btn gp-primary" data-join-go="1" type="submit" disabled={!nameOk}>Get the line for my agent</button>
        </form>
      )}

      {line && <Prompt text={line.text} note={line.note} />}

      <b className="jp-sub">Souls here <span className="gp-count">{here.length}</span></b>
      <SoulsHere souls={here} mine={mineIds} />
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
      <b>Your agent asks to {a?.mode === 'create' ? 'make and move a Soul' : 'move your Soul'}</b>
      {!signedIn && <p>Sign in (above) with the account that owns the Soul to review this request.</p>}
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
