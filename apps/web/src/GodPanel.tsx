// The god panel on an entity world: sign in, claim the world, read the authored
// welcome (skill + CLI + pairing steps), approve your agent's pairing request,
// drop flags. Self-contained; dev identities today, Privy owners via the Game
// lane's token hook later.
import { useEffect, useState } from 'react';
import { apiPath } from './world-path.ts';

type Status = { worldId: string; name: string; hasOwner: boolean; you: 'god' | 'owner' | 'claimant' | 'visitor' | 'anonymous'; pending: { code: string; agent: string; expiresIn: number }[]; entities: number; seq: number; base: string };

const devName = () => (typeof localStorage === 'undefined' ? null : localStorage.getItem('sim.dev'));
const authHeaders = (): Record<string, string> => { const n = devName(); return n ? { authorization: `Bearer dev:${n}` } : {}; };

export function GodPanel({ flagMode, onFlagMode }: { flagMode: boolean; onFlagMode: (v: boolean) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState<boolean>(true);
  const [welcome, setWelcome] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const hashCode = location.hash.startsWith('#godpair/') ? decodeURIComponent(location.hash.slice('#godpair/'.length)) : null;

  const refresh = async () => {
    try { const r = await fetch(apiPath('/v1/god/status'), { headers: authHeaders() }); if (r.ok) setStatus(await r.json()); } catch { /* offline */ }
  };
  useEffect(() => { void refresh(); const t = setInterval(() => void refresh(), 4000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!status || (status.you !== 'owner' && status.you !== 'god')) { setWelcome(null); return; }
    fetch(apiPath('/v1/god/welcome'), { headers: authHeaders() }).then((r) => (r.ok ? r.text() : null)).then(setWelcome).catch(() => setWelcome(null));
  }, [status?.you]);

  const signIn = () => {
    const n = window.prompt('A local name for you on this server (use the same name when you return):', devName() ?? '');
    if (!n) return; localStorage.setItem('sim.dev', n.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 36)); location.reload();
  };
  const claim = async () => {
    setBusy('claim'); setNote(null);
    try { const r = await fetch(apiPath('/v1/god/mint'), { method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ label: 'browser' }) }); const d = await r.json(); if (!r.ok) throw new Error(d.message ?? r.status); sessionStorage.setItem('sim.godToken', d.token); await refresh(); }
    catch (e) { setNote(`Could not claim: ${String((e as Error).message)}`); } finally { setBusy(null); }
  };
  const approve = async (code: string) => {
    setBusy(code); setNote(null);
    try { const r = await fetch(apiPath('/v1/god/pair/approve'), { method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ code }) }); const d = await r.json(); if (!r.ok) throw new Error(d.message ?? r.status); setNote(`Approved ${code}. Your agent now holds god mode here.`); if (hashCode === code) history.replaceState(null, '', location.pathname + location.search); await refresh(); }
    catch (e) { setNote(`Could not approve ${code}: ${String((e as Error).message)}`); } finally { setBusy(null); }
  };

  if (!status) return null;
  const me = devName();
  const card: React.CSSProperties = { position: 'absolute', right: 12, top: 64, zIndex: 6, width: open ? 380 : 'auto', maxHeight: 'calc(100% - 140px)', overflow: 'auto', background: 'rgba(255,255,255,.92)', color: '#1a1a1a', borderRadius: 14, boxShadow: '0 6px 24px rgba(0,0,0,.18)', padding: open ? '14px 16px' : '8px 12px', fontSize: 13, lineHeight: 1.45 };
  const btn: React.CSSProperties = { padding: '6px 10px', borderRadius: 999, border: '1px solid rgba(0,0,0,.2)', background: '#fff', cursor: 'pointer', fontSize: 13 };
  const primary: React.CSSProperties = { ...btn, background: '#1a1a1a', color: '#fff', border: '1px solid #1a1a1a' };
  if (!open) return <button data-god-panel-toggle="1" style={{ ...card, cursor: 'pointer' }} onClick={() => setOpen(true)}>✦ {status.you === 'owner' || status.you === 'god' ? 'God mode' : status.hasOwner ? 'This world has a god' : 'Claim this world'}</button>;
  return (
    <div data-god-panel="1" style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b style={{ fontSize: 15 }}>✦ {status.name}</b>
        <span style={{ color: '#666' }}>{status.entities} things · edit {status.seq}</span>
        <span style={{ marginLeft: 'auto' }} />
        <button style={btn} onClick={() => setOpen(false)} title="hide">×</button>
      </div>
      {status.you === 'anonymous' && (
        <p>{status.hasOwner ? 'This world already has a god. Watch, or sign in if it is yours.' : 'This world has no god yet. Sign in to claim it; your agent will build it.'}<br /><button style={primary} onClick={signIn}>Sign in</button></p>
      )}
      {status.you === 'claimant' && (
        <p>Signed in as <b>{me}</b>. Nobody owns this world yet.<br /><button style={primary} disabled={busy === 'claim'} onClick={claim}>Become its god</button></p>
      )}
      {status.you === 'visitor' && <p>Signed in as <b>{me}</b>. Another account owns this world; you can watch. <button style={btn} onClick={signIn}>Switch name</button></p>}
      {(status.you === 'owner' || status.you === 'god') && (
        <>
          {hashCode && !status.pending.some((p) => p.code === hashCode) && <p style={{ color: '#a33' }}>Pairing request <code>{hashCode}</code> is not pending (expired, or already approved).</p>}
          {status.pending.length > 0 && (
            <div style={{ background: '#fff6d6', border: '1px solid #e8c547', borderRadius: 10, padding: '8px 10px', margin: '8px 0' }}>
              <b>Pairing requests</b>
              {status.pending.map((p) => <div key={p.code} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}><span><code>{p.code}</code> · {p.agent} <span style={{ color: '#777' }}>({Math.round(p.expiresIn / 60)} min left)</span></span><span style={{ marginLeft: 'auto' }} /><button data-approve={p.code} style={primary} disabled={busy === p.code} onClick={() => approve(p.code)}>Approve</button></div>)}
            </div>
          )}
          {status.pending.length === 0 && <p style={{ color: '#555' }}>No pairing request waiting. When your agent runs <code>node eden-god.mjs pair</code>, its code appears here to approve.</p>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '6px 0 10px' }}>
            <button data-flag-button="1" aria-pressed={flagMode} style={{ ...btn, background: flagMode ? '#e8c547' : '#fff' }} onClick={() => onFlagMode(!flagMode)} title="Drop a labelled flag: a reference point your agent can build around (or Alt+click the ground)">⚑ {flagMode ? 'click the ground…' : 'drop a flag'}</button>
            <a style={{ ...btn, textDecoration: 'none', color: '#1a1a1a' }} href={apiPath('/god/SKILL.md')} target="_blank" rel="noreferrer">SKILL.md</a>
            <a style={{ ...btn, textDecoration: 'none', color: '#1a1a1a' }} href={apiPath('/god/eden-god.mjs')} download>eden-god.mjs</a>
            <a style={{ ...btn, textDecoration: 'none', color: '#1a1a1a' }} href={apiPath('/v1/god/welcome')} target="_blank" rel="noreferrer">welcome.md</a>
          </div>
          {welcome && <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, background: '#f4f4f2', borderRadius: 10, padding: 10, margin: 0 }}>{welcome}</pre>}
        </>
      )}
      {note && <p style={{ marginTop: 8, color: note.startsWith('Could not') ? '#a33' : '#2a6' }}>{note}</p>}
    </div>
  );
}
