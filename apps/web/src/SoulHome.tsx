// The signed-in home: invite → create a Soul → steer it here or from your own
// agent → watch its dashboard. One column of cards, in the order a newcomer needs them.
import { useEffect, useState } from 'react';
import { GOALS, type BrainCall } from '@sim/protocol';
import type { AuthCtx } from './Shell.tsx';
import type { Api, Sim } from './useSim.ts';
import { Call } from './BrainPanels.tsx';

type MySoul = { id: string; name: string; description: string; entityId: string; hasToken: boolean; tokenLabel: string | null; tokenCreatedAt: number | null; tokenLastUsed: number | null };
type Dash = { status: any; agent: { attached: boolean; label: string | null; since: number | null; last_used: number | null }; spend: { calls: number; cost: number }; created_at: number };
type TL = { seq: number; tick: number; at: number; kind: string; text: string; why: string | null; mood: string | null; fallback: boolean; call: number | null };
const ago = (ms: number | null) => { if (!ms) return 'never'; const s = Math.max(0, (Date.now() - ms) / 1000); return s < 60 ? `${Math.round(s)} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };

export function SoulHome({ sim, auth, api, selected, onSelect, pairCode, clearPair, base }: { sim: Sim; auth: AuthCtx; api: Api; selected: string | null; onSelect(id: string | null): void; pairCode: string | null; clearPair(): void; base: string }) {
  const [souls, setSouls] = useState<MySoul[] | null>(null);
  const [me, setMe] = useState<any>(null);
  const [maxSouls, setMaxSouls] = useState(5);
  const [creating, setCreating] = useState(false);
  const refresh = async () => { const r = await api('/v1/me'); if (r.status === 200) { setSouls(r.data.souls); setMe(r.data.me); setMaxSouls(r.data.maxSouls); } };
  useEffect(() => { if (auth.authed) void refresh(); else { setSouls(null); setMe(null); } }, [auth.authed]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = souls?.find((s) => s.id === selected) ?? null;
  useEffect(() => { if (souls?.length && !mine) onSelect(souls[0].id); }, [souls]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!auth.authed) return (
    <section className="wide">
      <h2>Your Soul</h2>
      <p>Right now you are a spectator. Sign in to create a <b>Soul</b>: an inhabitant of this world that is yours. It lives here all the time, makes its own small decisions, and takes direction from you, either from this page or from your own AI assistant.</p>
      <button className="primary" onClick={auth.login} disabled={!auth.ready}>sign in</button>
    </section>
  );
  if (!souls || !me) return <section className="wide"><h2>Your Soul</h2><p className="dim">loading…</p></section>;

  return (
    <>
      {pairCode && <PairApprove api={api} code={pairCode} souls={souls} done={() => { clearPair(); void refresh(); }} />}
      {!me.invited ? <Invite api={api} done={refresh} />
        : souls.length === 0 || creating ? <Create api={api} first={souls.length === 0} cancel={souls.length ? () => setCreating(false) : undefined} done={async (id) => { setCreating(false); await refresh(); onSelect(id); }} />
        : mine ? <>
          <section className="wide">
            <div className="row" style={{ margin: 0 }}>
              <h2 style={{ margin: 0 }}>Your Souls</h2>
              {souls.map((s) => <button key={s.id} className={s.id === mine.id ? 'primary' : ''} onClick={() => onSelect(s.id)}>{s.name}</button>)}
              {souls.length < maxSouls && <button onClick={() => setCreating(true)}>+ new Soul</button>}
              <span className="dim" style={{ marginLeft: 'auto' }}>{me.email}</span>
            </div>
          </section>
          <Dashboard key={mine.id} sim={sim} api={api} soul={mine} isAdmin={me.role === 'admin'} base={base} refresh={refresh} onGone={() => { onSelect(null); void refresh(); }} />
          <section><h2>Account</h2>
            <div className="kv"><span>signed in as</span><span>{me.email ?? auth.label}</span><span>role</span><span>{me.role}</span><span>public owner id</span><span>{me.short}</span></div>
            <details style={{ marginTop: 6 }}><summary className="dim">sign-in details (the wallet is created for later and unused for now)</summary>
              <pre className="json">{JSON.stringify({ userId: auth.debug.privyUserId ?? me.userId, embeddedWallet: auth.debug.wallet ?? null, walletSeenByServer: me.wallet ?? null, linkedAccounts: auth.debug.linked }, null, 2)}</pre></details>
          </section>
        </> : null}
    </>
  );
}

function Invite({ api, done }: { api: Api; done(): void }) {
  const [code, setCode] = useState(''); const [msg, setMsg] = useState('');
  return (
    <section className="wide">
      <h2>Step 1 of 3 — invite code</h2>
      <p>Sim is in a small alpha. Enter the invite code you were given to create a Soul. You can keep watching without one.</p>
      <div className="row"><input placeholder="invite code" value={code} onChange={(e) => setCode(e.target.value)} style={{ maxWidth: 260 }} />
        <button className="primary" disabled={code.trim().length < 3} onClick={async () => { const r = await api('/v1/invite', { code }); if (r.status === 200) done(); else setMsg(r.data.message ?? 'failed'); }}>continue</button><span className="warn">{msg}</span></div>
    </section>
  );
}

function Create({ api, first, done, cancel }: { api: Api; first: boolean; done(id: string): void; cancel?: () => void }) {
  const [name, setName] = useState(''); const [desc, setDesc] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  return (
    <section className="wide">
      <h2>{first ? 'Step 2 of 3 — create your Soul' : 'Create another Soul'}</h2>
      <p>A Soul is an inhabitant of the world that belongs to you. Give it a name and one line about who it is. That line is its personality: its own mind reads it every time it decides what to do, so “a shy gardener who loves fire and music” behaves differently from “a loud fisherman with endless stories”.</p>
      <ol style={{ margin: '6px 0 10px 18px', padding: 0 }}>
        <li>It arrives at the gate on the south edge and starts living straight away.</li>
        <li>It keeps living when you close this page. You do not control it; you give it direction.</li>
        <li>Everyone can see its name and description, so keep them friendly.</li>
      </ol>
      <div className="row"><input placeholder="name (2–32 characters)" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} /></div>
      <div className="row"><input placeholder="who are they? one line, up to 200 characters" value={desc} maxLength={200} onChange={(e) => setDesc(e.target.value)} /></div>
      <div className="row">
        <button className="primary" disabled={busy || name.trim().length < 2 || desc.trim().length < 3} onClick={async () => { setBusy(true); setMsg(''); const r = await api('/v1/souls', { name, description: desc }); setBusy(false); if (r.status === 200) done(r.data.soul.id); else setMsg(r.data.message ?? 'failed'); }}>bring them to life</button>
        {cancel && <button onClick={cancel}>cancel</button>}<span className="warn">{msg}</span></div>
    </section>
  );
}

function PairApprove({ api, code, souls, done }: { api: Api; code: string; souls: MySoul[]; done(): void }) {
  const [info, setInfo] = useState<any>(null); const [err, setErr] = useState(''); const [soulId, setSoulId] = useState(souls[0]?.id ?? ''); const [ok, setOk] = useState(false);
  useEffect(() => { void api(`/v1/pair/${code}`).then((r) => (r.status === 200 ? setInfo(r.data) : setErr(r.data.message ?? 'invalid'))); }, [code]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!soulId && souls[0]) setSoulId(souls[0].id); }, [souls]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="wide" style={{ borderColor: 'var(--accent)' }}>
      <h2>An agent is asking to steer one of your Souls</h2>
      {err ? <p className="warn">{err} <button onClick={done}>dismiss</button></p> : !info ? <p className="dim">checking…</p> : ok ? <p className="ok">Approved. Your agent can carry on. <button onClick={done}>close</button></p> : souls.length === 0 ? <p>Create a Soul first (below), then come back to this link.</p> : <>
        <p><b>{info.agent}</b> wants permission to look through and steer a Soul (code {info.code}). Only approve if you just asked your own assistant to do this.</p>
        <div className="row"><span>Soul:</span><select value={soulId} onChange={(e) => setSoulId(e.target.value)}>{souls.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <button className="primary" onClick={async () => { const r = await api('/v1/pair/approve', { code, soulId }); if (r.status === 200) setOk(true); else setErr(r.data.message ?? 'failed'); }}>approve</button><button onClick={done}>not now</button></div>
        <p className="dim">This replaces any agent already attached to that Soul. You can revoke it at any time.</p></>}
    </section>
  );
}

function Dashboard({ sim, api, soul, isAdmin, base, refresh, onGone }: { sim: Sim; api: Api; soul: MySoul; isAdmin: boolean; base: string; refresh(): void; onGone(): void }) {
  const [d, setD] = useState<Dash | null>(null); const [tl, setTl] = useState<TL[]>([]);
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [replies, setReplies] = useState<{ text: string; reply: string; ok: boolean }[]>([]);
  const [goal, setGoal] = useState<string>('wander'); const [target, setTarget] = useState(''); const [note, setNote] = useState('');
  const [pair, setPair] = useState<{ prompt: string; code: string } | null>(null); const [copied, setCopied] = useState(false); const [pairAt, setPairAt] = useState(0);
  const [shot, setShot] = useState<any>(null); const [openCall, setOpenCall] = useState<BrainCall | null>(null);
  useEffect(() => {
    let live = true;
    const load = async () => { const [a, b] = await Promise.all([api(`/v1/souls/${soul.id}`), api(`/v1/souls/${soul.id}/timeline?limit=60`)]); if (!live) return; if (a.status === 200) setD(a.data); if (b.status === 200) setTl(b.data.events); };
    void load(); const t = setInterval(load, 3000); return () => { live = false; clearInterval(t); };
  }, [soul.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = d?.status;
  // once an agent attaches, the code has been used: stop showing it
  useEffect(() => { if (d?.agent.attached && d.agent.since && pair && d.agent.since > pairAt) setPair(null); }, [d?.agent.since]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async () => {
    if (!text.trim()) return; const t = text; setText(''); setBusy(true);
    const r = await api(`/v1/souls/${soul.id}/command`, { text: t }); setBusy(false);
    const reply = r.status !== 200 ? (r.data.message ?? 'failed') : r.data.ok ? `understood: ${r.data.text}` : `not understood: ${r.data.reason}`;
    setReplies((h) => [...h, { text: t, reply, ok: r.status === 200 && r.data.ok }].slice(-6));
  };
  const setIntent = async () => {
    const r = await api(`/v1/souls/${soul.id}/intent`, { intent: { goal, target: target || null, ...(note.trim() ? { note: note.trim() } : {}) } });
    setReplies((h) => [...h, { text: `${goal} ${target}`.trim(), reply: r.status === 200 ? `set: ${r.data.text}` : r.data.message, ok: r.status === 200 }].slice(-6));
  };
  const rep = sim.conn.replica;
  const targets = [...Object.values(rep.entities).filter((e) => e.id !== soul.entityId && e.id !== 'gate').map((e) => ({ id: e.id, label: e.label ?? e.id })), ...Object.values(rep.regions).map((x) => ({ id: x.id, label: x.label }))];
  const calls = sim.brain.filter((c) => c.soulId === soul.id).slice(-8).reverse();
  return (
    <>
      <section>
        <h2>{soul.name} — right now</h2>
        <p className="dim" style={{ marginTop: 0 }}>{soul.description}</p>
        {!s ? <p className="dim">loading…</p> : !s.in_world ? <p className="dim">arriving at the gate…</p> : <div className="kv">
          <span>doing</span><span><b>{s.doing}</b> <span className="dim">({s.activity})</span></span>
          <span>where</span><span>{s.position.region === 'center' ? 'the center' : 'the outer ring'} <span className="dim">({s.position.x.toFixed(0)}, {s.position.z.toFixed(0)})</span></span>
          <span>mood · energy</span><span>{s.mood} · {s.energy}</span>
          <span>your direction</span><span>{s.intent ? s.intent_text : <span className="dim">none yet: living by its own nature</span>}</span>
          {s.storyteller_suggests && <><span>storyteller</span><span className="dim">{s.storyteller_suggests}</span></>}
          <span>reconsiders in</span><span>{s.next_think_in_s} s <span className="dim">(or sooner, when what it is doing ends)</span></span>
          <span>around it</span><span>{s.nearby.slice(0, 6).map((n: any) => `${n.who} (${n.distance}, ${n.doing})`).join(' · ') || 'nothing close'}</span>
          <span>happening</span><span>{s.happening}</span>
        </div>}
      </section>

      <section>
        <h2>Step 3 — give {soul.name} direction</h2>
        <div className="row"><input placeholder={`tell ${soul.name} what to do, in plain words`} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void send(); }} maxLength={280} /><button className="primary" disabled={busy || !text.trim()} onClick={() => void send()}>send</button></div>
        <details><summary className="dim">or pick exactly</summary>
          <div className="row"><select value={goal} onChange={(e) => setGoal(e.target.value)}>{GOALS.map((g) => <option key={g}>{g}</option>)}</select>
            <select value={target} onChange={(e) => setTarget(e.target.value)}><option value="">(no target)</option>{targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
          <div className="row"><input placeholder="optional note: how, why, in what spirit (only you and the Soul see it)" value={note} maxLength={160} onChange={(e) => setNote(e.target.value)} /><button onClick={() => void setIntent()}>set</button></div>
        </details>
        {replies.slice().reverse().map((h, i) => <div key={i}><span className="dim">you:</span> {h.text} <span className={h.ok ? 'ok' : 'warn'}>→ {h.reply}</span></div>)}
        <p className="note">Direction is not remote control. {soul.name} takes it as a standing intent and works out how to follow it, moment to moment, until you give a new one.</p>
      </section>

      <section className="wide">
        <h2>Or let your own AI assistant steer {soul.name}</h2>
        {d?.agent.attached
          ? <p><span className="ok">●</span> <b>{d.agent.label ?? 'An agent'}</b> is attached · paired {ago(d.agent.since)} · last active {ago(d.agent.last_used)} <button onClick={async () => { await api(`/v1/souls/${soul.id}/revoke`, {}); setPair(null); refresh(); }}>disconnect it</button></p>
          : <p className="dim">No agent attached.</p>}
        <p>Paste this one line into Claude, ChatGPT, Codex or any agent that can make web requests:</p>
        {pair ? <>
          <pre className="json" style={{ fontSize: 13 }}>{pair.prompt}</pre>
          <div className="row"><button className="primary" onClick={() => { void navigator.clipboard.writeText(pair.prompt); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? 'copied' : 'copy'}</button><span className="dim">The code works once and expires in 15 minutes. Pairing replaces any agent already attached.</span></div>
        </> : <div className="row"><button className="primary" onClick={async () => { const r = await api(`/v1/souls/${soul.id}/pair`, {}); if (r.status === 200) { setPair(r.data); setPairAt(Date.now()); } }}>{d?.agent.attached ? 'make a new one-line prompt (replaces the attached agent)' : 'show my one-line prompt'}</button></div>}
        <p className="note">What happens: your assistant reads <a href="/skill.md" target="_blank" rel="noreferrer">{base.replace(/^https?:\/\//, '')}/skill.md</a>, trades the code for a key that works for this one Soul, and saves the instructions as a small skill. From then on you can just tell it things like “have {soul.name} go find someone to talk to” or “what has {soul.name} been up to?”. It sees what {soul.name} perceives, and it sets the same kind of direction you set above.</p>
      </section>

      <section className="wide">
        <h2>{soul.name}’s story so far</h2>
        <div className="scroll" style={{ maxHeight: 360 }}><table><tbody>
          {tl.slice().reverse().map((e) => (
            <tr key={e.seq} className={e.call ? 'click' : ''} onClick={async () => { if (!e.call) return; const c = sim.brain.find((x) => x.id === e.call) ?? (await api(`/v1/brain?limit=200&soul=${soul.id}`)).data.calls?.find((x: BrainCall) => x.id === e.call); setOpenCall(c ?? null); }}>
              <td className="dim">{ago(e.at)}</td>
              <td><span className={`tag ${e.kind === 'decision' ? 'mid' : e.kind === 'scene' ? 'narrator' : e.kind === 'intent' ? 'translate' : ''}`}>{e.kind === 'decision' ? 'chose' : e.kind === 'intent' ? 'direction' : e.kind === 'scene' ? 'suggested' : e.kind}</span></td>
              <td className="wrap">{e.text}{e.why && <span className="dim"> · {e.why}</span>}{e.mood && <span className="dim"> · feeling {e.mood}</span>}{e.fallback && <span className="warn"> · default choice (thinking budget spent)</span>}</td>
            </tr>))}
          {tl.length === 0 && <tr><td className="dim">nothing yet</td></tr>}
        </tbody></table></div>
        {openCall && <><p className="dim">How that choice was made <button onClick={() => setOpenCall(null)}>close</button></p><Call c={openCall} open api={api} /></>}
        <p className="dim">Click a “chose” row to see exactly what {soul.name}’s mind was shown and how it decided.</p>
      </section>

      <section>
        <h2>{soul.name}’s mind — recent thinking</h2>
        {calls.length ? calls.map((c) => <Call key={c.id} c={c} api={api} />) : <p className="dim">No thoughts recorded in this session yet.</p>}
        <p className="dim">{d ? `${d.spend.calls} model calls in the last day${isAdmin ? ` · $${d.spend.cost.toFixed(4)}` : ''}` : ''}</p>
      </section>

      <section>
        <h2>More</h2>
        <div className="row"><button onClick={async () => { const r = await api(`/v1/souls/${soul.id}/shot`, {}); setShot(r.data.shot ?? r.data); }}>ask for the most cinematic camera shot of {soul.name}</button></div>
        {shot && <pre className="json">{JSON.stringify(shot, null, 2)}</pre>}
        <div className="row"><button onClick={async () => { if (confirm(`Retire ${soul.name}? They leave the world for good.`)) { await api(`/v1/souls/${soul.id}`, undefined, 'DELETE'); onGone(); } }}>retire {soul.name}</button></div>
      </section>
    </>
  );
}
