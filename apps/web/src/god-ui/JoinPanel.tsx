// "Join this world as a Soul" and "Souls here" (lane P2), shown inside the god panel: to visitors as a section,
// to the god as the Souls tab (with the link to share). Signed in → name a Soul → it is born here → "Pair my agent"
// gives a one-use code and the one line to paste to the agent (SKILL.md, Soul mode).
import { useCallback, useEffect, useRef, useState } from 'react';
import { CopyButton } from './markdown.tsx';
import { flyTo } from './camera.ts';
import * as J from './join-api.ts';
import { apiPath } from '../world-path.ts';
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

export function JoinPanel({ signedIn, worldName, base, owner }: { signedIn: boolean; worldName: string; base: string; owner: boolean }) {
  const [here, setHere] = useState<J.SoulHere[]>([]);
  const [mine, setMine] = useState<J.MySoul[] | null>(null);
  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [code, setCode] = useState<(J.PairCode & { soul: string }) | null>(null);
  const [, tick] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => { const [h, m] = await Promise.all([J.soulsHere(), signedIn ? J.mySouls() : Promise.resolve(null)]); setHere(h); setMine(m); }, [signedIn]);
  useEffect(() => { void refresh(); const t = setInterval(() => void refresh(), 5000); return () => clearInterval(t); }, [refresh]);
  useEffect(() => { if (!code) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [code]);
  useEffect(() => { if (location.hash === '#join') ref.current?.scrollIntoView({ block: 'nearest' }); }, []);

  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); setErr(null); try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); } };
  const create = () => run('create', async () => { const s = await J.createSoul(name.trim(), about.trim() || undefined); setName(''); setAbout(''); await refresh(); const c = await J.pairCode(s.id); setCode({ ...c, soul: s.name }); await refresh(); });
  const pair = (s: J.MySoul) => run('pair:' + s.id, async () => { const c = await J.pairCode(s.id); setCode({ ...c, soul: s.name }); });

  const mineIds = new Set((mine ?? []).map((s) => s.id));
  const left = code ? Math.max(0, Math.round((code.expiresAt - Date.now()) / 1000)) : 0;
  const prompt = code ? J.joinPrompt(base, worldName, code.soul, code.code) : '';
  const nameOk = /^[\p{L}\p{N} _'-]{2,32}$/u.test(name.trim());

  return (
    <div className="jp" data-join="1" ref={ref} id="join">
      {owner
        ? <p className="gp-dim jp-intro">Friends join as Souls: bodies in this world that their own agents move. Share this link; anyone signed in can join.</p>
        : <><b className="jp-title">Join this world as a Soul</b><p className="gp-dim jp-intro">A Soul is your body here. Your own agent (Claude Code, Codex…) moves it: it walks, sits, picks things up, and prays to the god. It's free: your agent does the thinking.</p></>}
      {owner && <div className="jp-share"><code data-join-link="1">{J.joinLink(base)}</code><CopyButton text={J.joinLink(base)} label="copy link" /></div>}

      {!signedIn && !owner && <p className="gp-dim" data-join-signin="1">Sign in (above) to make your Soul.</p>}

      {signedIn && mine && mine.length > 0 && (
        <div className="jp-mine" data-my-souls={mine.length}>
          {mine.map((s) => (
            <div key={s.id} className="gp-row" data-my-soul={s.name}>
              <span>Your Soul <b>{s.name}</b> {s.hasToken ? <span className="jp-ok">agent paired</span> : <span className="gp-dim">no agent yet</span>}</span>
              <button className="gp-btn gp-small" data-pair-soul={s.name} disabled={busy === 'pair:' + s.id} onClick={() => pair(s)} title={s.hasToken ? 'A new code; using it disconnects the agent paired now' : 'A one-use code for your agent'}>{busy === 'pair:' + s.id ? '…' : s.hasToken ? 'New code' : 'Pair my agent'}</button>
            </div>
          ))}
        </div>
      )}

      {code && left > 0 && (
        <div className="jp-code" data-pair-code={code.code}>
          <p>Paste this to your agent (the code works once, for {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} more):</p>
          <div className="gp-code"><div className="gp-code-bar"><span>to your agent</span><CopyButton text={prompt} /></div><pre><code data-join-prompt="1">{prompt}</code></pre></div>
          <p className="gp-dim">Your agent reads <a href={apiPath('/SKILL.md')} target="_blank" rel="noreferrer">SKILL.md</a>, installs the Soul CLI and pairs. Your Soul shows <i>agent paired</i> here when it's done.</p>
        </div>
      )}
      {code && left === 0 && <p className="gp-dim">That code expired. Ask for a new one.</p>}

      {signedIn && mine && mine.length === 0 && (
        <form className="jp-form" data-join-form="1" onSubmit={(e) => { e.preventDefault(); if (nameOk) void create(); }}>
          <label>Your Soul's name<input data-soul-name="1" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ana" autoComplete="off" /></label>
          <label>Who they are <span className="gp-dim">(optional)</span><input data-soul-about="1" value={about} maxLength={200} onChange={(e) => setAbout(e.target.value)} placeholder="a hill walker who likes high windows" autoComplete="off" /></label>
          <button className="gp-btn gp-primary" data-create-soul="1" type="submit" disabled={!nameOk || busy === 'create'}>{busy === 'create' ? 'Making your Soul…' : 'Create my Soul'}</button>
        </form>
      )}
      {err && <p className="gp-bad">{err}</p>}

      <b className="jp-sub">Souls here <span className="gp-count">{here.length}</span></b>
      <SoulsHere souls={here} mine={mineIds} />
    </div>
  );
}
