import { useEffect, useState } from 'react';
import { GOALS } from '@sim/protocol';
import type { AuthCtx } from './Shell.tsx';
import type { Api, Sim } from './useSim.ts';

type MySoul = { id: string; name: string; description: string; entityId: string; hasToken: boolean; tokenCreatedAt: number | null };

export function MePanel({ sim, auth, api, selected, onSelect }: { sim: Sim; auth: AuthCtx; api: Api; selected: string | null; onSelect(id: string | null): void }) {
  const [souls, setSouls] = useState<MySoul[]>([]);
  const [meInfo, setMeInfo] = useState<any>(null);
  const [name, setName] = useState(''); const [desc, setDesc] = useState('');
  const [msg, setMsg] = useState('');
  const [text, setText] = useState('');
  const [history, setHistory] = useState<{ text: string; reply: string; ok: boolean }[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const [claim, setClaim] = useState<{ prompt: string; url: string } | null>(null);
  const [shot, setShot] = useState<any>(null);
  const [goal, setGoal] = useState<string>('wander'); const [target, setTarget] = useState('');

  const refresh = async () => { const r = await api('/v1/me'); if (r.status === 200) { setSouls(r.data.souls); setMeInfo(r.data.me); } };
  useEffect(() => { if (auth.authed) void refresh(); else { setSouls([]); setMeInfo(null); } }, [auth.authed]); // eslint-disable-line react-hooks/exhaustive-deps
  const mineSel = souls.find((s) => s.id === selected) ?? null;
  useEffect(() => { if (!mineSel && souls.length && (!selected || !sim.conn.replica.souls.has(selected))) onSelect(souls[0].id); }, [souls]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setStatus(null); setClaim(null); setShot(null);
    if (!mineSel) return;
    const load = async () => { const r = await api(`/v1/souls/${mineSel.id}`); if (r.status === 200) setStatus(r.data); };
    void load(); const t = setInterval(load, 3000); return () => clearInterval(t);
  }, [mineSel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!auth.authed) return (
    <section>
      <h2>Me</h2>
      <p>You are watching as an anonymous viewer: the same canonical world, the broadcast camera and the public log.</p>
      <p>Sign in to create a Soul, give it commands, and see how its mind works.</p>
      <button className="primary" onClick={auth.login} disabled={!auth.ready}>sign in</button>
    </section>
  );

  const create = async () => {
    setBusy(true); setMsg('');
    const r = await api('/v1/souls', { name, description: desc });
    setBusy(false);
    if (r.status === 200) { setName(''); setDesc(''); await refresh(); onSelect(r.data.soul.id); setMsg(`${r.data.soul.name} was born at the gate.`); } else setMsg(r.data.message ?? 'failed');
  };
  const send = async () => {
    if (!mineSel || !text.trim()) return;
    const t = text; setText(''); setBusy(true);
    const r = await api(`/v1/souls/${mineSel.id}/command`, { text: t });
    setBusy(false);
    const reply = r.status !== 200 ? (r.data.message ?? 'failed') : r.data.ok ? `understood (${r.data.via}, ${(r.data.confidence * 100).toFixed(0)}%): ${r.data.text} — accepted at tick ${r.data.tick}` : `not understood (${r.data.via}): ${r.data.reason}`;
    setHistory((h) => [...h, { text: t, reply, ok: r.status === 200 && r.data.ok }].slice(-12));
  };
  const setIntent = async () => {
    if (!mineSel) return;
    const r = await api(`/v1/souls/${mineSel.id}/intent`, { intent: { goal, target: target || null } });
    setHistory((h) => [...h, { text: `[structured] ${goal} ${target}`, reply: r.status === 200 ? `${r.data.text} — accepted at tick ${r.data.tick}` : r.data.message, ok: r.status === 200 }].slice(-12));
  };
  const r = sim.conn.replica;
  const targets = [...Object.values(r.entities).filter((e) => e.id !== mineSel?.entityId).map((e) => ({ id: e.id, label: e.label ?? e.id })), ...Object.values(r.regions).map((x) => ({ id: x.id, label: x.label }))];

  return (
    <section className="wide">
      <h2>Me — account, my Souls, steering</h2>
      <div className="grid" style={{ marginTop: 0 }}>
        <div>
          <div className="kv">
            <span>signed in as</span><span>{meInfo?.email ?? auth.label}</span>
            <span>role</span><span>{meInfo?.role ?? '…'}</span>
            <span>public owner id</span><span>{meInfo?.short}</span>
          </div>
          <details style={{ marginTop: 6 }}><summary className="dim">auth debug (Privy; wallet is unused for now)</summary>
            <pre className="json">{JSON.stringify({ privyUserId: auth.debug.privyUserId ?? meInfo?.userId, embeddedWallet: auth.debug.wallet ?? null, walletSeenByServer: meInfo?.wallet ?? null, linkedAccounts: auth.debug.linked }, null, 2)}</pre>
          </details>
          <h2 style={{ marginTop: 12 }}>My Souls</h2>
          {souls.length === 0 && <p className="dim">You have no Souls yet.</p>}
          <table><tbody>{souls.map((s) => <tr key={s.id} className={`click ${s.id === selected ? 'sel' : ''}`} onClick={() => onSelect(s.id)}><td className="acc"><b>{s.name}</b></td><td className="wrap dim">{s.description}</td><td>{s.hasToken ? <span className="tag">agent attached</span> : null}</td></tr>)}</tbody></table>
          <h2 style={{ marginTop: 12 }}>Create a Soul</h2>
          <div className="row"><input placeholder="name (2–32 characters)" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} /></div>
          <div className="row"><input placeholder="who are they? one line (up to 200 characters)" value={desc} maxLength={200} onChange={(e) => setDesc(e.target.value)} /></div>
          <div className="row"><button className="primary" disabled={busy || name.trim().length < 2 || desc.trim().length < 3} onClick={() => void create()}>create</button><span className="dim">{msg}</span></div>
        </div>
        <div>
          {!mineSel ? <p className="dim">Select one of your Souls to steer it.</p> : <>
            <h2>Steering {mineSel.name}</h2>
            {status?.in_world ? <div className="kv">
              <span>now</span><span>{status.activity} — {status.doing}</span>
              <span>where</span><span>{status.position.x.toFixed(1)}, {status.position.z.toFixed(1)} ({status.position.region})</span>
              <span>mood</span><span>{status.mood}</span>
              <span>standing intent</span><span>{status.intent_text}</span>
              <span>recently</span><span>{status.recent.join(' · ')}</span>
              <span>could do now</span><span className="dim">{status.available_now.map((o: any) => o.id).join(', ')}</span>
            </div> : <p className="dim">arriving…</p>}
            <div className="row"><input placeholder={`tell ${mineSel.name} what to do, in plain words`} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void send(); }} maxLength={280} /><button className="primary" disabled={busy || !text.trim()} onClick={() => void send()}>send</button></div>
            <div className="row"><span className="dim">or structured:</span>
              <select value={goal} onChange={(e) => setGoal(e.target.value)}>{GOALS.map((g) => <option key={g}>{g}</option>)}</select>
              <select value={target} onChange={(e) => setTarget(e.target.value)}><option value="">(no target)</option>{targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
              <button onClick={() => void setIntent()}>set intent</button></div>
            <div className="scroll" style={{ maxHeight: 170 }}>{history.slice().reverse().map((h, i) => <div key={i}><span className="dim">you:</span> {h.text}<br /><span className={h.ok ? 'ok' : 'warn'}>↳ {h.reply}</span></div>)}</div>
            <p className="note">Your text goes to Jev with the list of nearby things; Jev picks a goal and a target from closed lists. Only that structured intent enters the log. Then the Soul’s mid-brain re-thinks at once. Open the Brain panel to see both calls.</p>
            <h2 style={{ marginTop: 12 }}>Let your own agent steer</h2>
            <div className="row">
              <button onClick={async () => { const r = await api(`/v1/souls/${mineSel.id}/claim`, {}); if (r.status === 200) setClaim(r.data); }}>make a one-time prompt for my agent</button>
              {mineSel.hasToken && <button onClick={async () => { await api(`/v1/souls/${mineSel.id}/revoke`, {}); await refresh(); }}>revoke agent token</button>}
              <a href="/v1/skill.md" target="_blank" rel="noreferrer">skill.md</a>
            </div>
            {claim && <><pre className="json">{claim.prompt}</pre><div className="row"><button onClick={() => void navigator.clipboard.writeText(claim.prompt)}>copy</button><span className="dim">Paste into Claude, ChatGPT or Codex. The link works once and expires in 15 minutes.</span></div></>}
            <h2 style={{ marginTop: 12 }}>Camera</h2>
            <div className="row"><button onClick={async () => { const r = await api(`/v1/souls/${mineSel.id}/shot`, {}); setShot(r.data.shot ?? r.data); }}>ask Jev for the most cinematic shot of {mineSel.name}</button></div>
            {shot && <pre className="json">{JSON.stringify(shot, null, 2)}</pre>}
            <div className="row" style={{ marginTop: 12 }}><button onClick={async () => { if (confirm(`Retire ${mineSel.name}? This removes them from the world.`)) { await api(`/v1/souls/${mineSel.id}`, undefined, 'DELETE'); onSelect(null); await refresh(); } }}>retire this Soul</button></div>
          </>}
        </div>
      </div>
    </section>
  );
}

export function AdminPanel({ sim, api }: { sim: Sim; api: Api }) {
  const [rate, setRate] = useState('1'); const [budget, setBudget] = useState('5'); const [out, setOut] = useState(''); const [clients, setClients] = useState<any>(null);
  const act = async (body: unknown) => { const r = await api('/v1/admin', body); setOut(JSON.stringify(r.data)); };
  return (
    <section>
      <h2>Admin — world dials</h2>
      <div className="row"><button onClick={() => void act({ action: 'pause' })}>pause</button><button onClick={() => void act({ action: 'resume' })}>resume</button><button onClick={() => void act({ action: 'snapshot' })}>snapshot now</button></div>
      <div className="row"><span>clock rate ×</span><input style={{ width: 70, flex: 'none' }} value={rate} onChange={(e) => setRate(e.target.value)} /><button onClick={() => void act({ action: 'clock_rate', rate: Number(rate) })}>set</button><span className="dim">now ×{sim.conn.heartbeat?.clockRate ?? 1}</span></div>
      <div className="row"><span>brain</span><button onClick={() => void act({ action: 'brain_mode', mode: 'live' })}>live</button><button onClick={() => void act({ action: 'brain_mode', mode: 'fake' })}>fake</button><span>budget $/day</span><input style={{ width: 70, flex: 'none' }} value={budget} onChange={(e) => setBudget(e.target.value)} /><button onClick={() => void act({ action: 'budget', usdPerDay: Number(budget) })}>set</button></div>
      <div className="row"><span>narrate now:</span>{Object.keys(sim.conn.replica.regions).map((r) => <button key={r} onClick={() => void act({ action: 'narrate', region: r })}>{r}</button>)}</div>
      <div className="row"><button onClick={async () => setClients((await api('/v1/admin/clients')).data)}>list connected clients</button></div>
      {clients && <pre className="json">{JSON.stringify(clients, null, 2)}</pre>}
      <pre className="dim">{out}</pre>
    </section>
  );
}
