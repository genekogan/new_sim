import { apiPath, worldPath } from './world-path.ts';
import { useEffect, useMemo, useState } from 'react';
import type { LogEvent } from '@sim/protocol';
import { describeIntent } from '@sim/protocol';
import { makeApi, useSim, type Sim } from './useSim.ts';
import { BrainPanel, BroadcastPanel, NarrativePanel } from './BrainPanels.tsx';
import { AdminPanel } from './AdminPanel.tsx';
import { SoulHome } from './SoulHome.tsx';
import { ArchPanel } from './Arch.tsx';
import { LiveWorld } from './LiveWorld.tsx';
import { SpendPanel } from './Spend.tsx';
import { BacklogPanel, HeardPanel, LibraryPanel, NotebookPanel, SentencesPanel, ThingsPanel, VocabularyPanel } from './Grammar.tsx';

export type AuthCtx = {
  ready: boolean; authed: boolean; label: string | null;
  login(): void; logout(): Promise<void> | void; getToken(): Promise<string | null>;
  debug: { privyUserId: string | null; wallet: unknown; linked: unknown[] };
};
type Cfg = { privyAppId: string; publicUrl: string; worldId: string; authReady: boolean; devAuth: boolean; inviteRequired?: boolean; build?: string };
const TABS = ['watch', 'my soul', 'grammar', 'notebook', 'world', 'brain', 'story', 'sync', 'spend', 'admin', 'architecture', 'everything'] as const;
const ADMIN_TABS = new Set<string>(['spend', 'admin']);
const hashTab = (): { tab: Tab; pair: string | null } => { let h = ''; try { h = decodeURIComponent(location.hash.slice(1)); } catch { /* a mangled link: fall back to the first tab */ } if (h.startsWith('pair/')) return /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/.test(h.slice(5)) ? { tab: 'my soul', pair: h.slice(5) } : { tab: 'my soul', pair: null }; return { tab: (TABS as readonly string[]).includes(h) ? (h as Tab) : 'watch', pair: null }; };
type Tab = (typeof TABS)[number];

export function Shell({ cfg, auth }: { cfg: Cfg; auth: AuthCtx }) {
  const sim = useSim(auth.getToken, auth.authed);
  const api = useMemo(() => makeApi(auth.getToken), [auth.authed]); // eslint-disable-line react-hooks/exhaustive-deps
  const [tab, setTab] = useState<Tab>(() => hashTab().tab);
  const [pairCode, setPairCode] = useState<string | null>(() => hashTab().pair);
  const [selected, setSelected] = useState<string | null>(null); // soul id
  useEffect(() => { if (!pairCode) location.hash = tab; }, [tab, pairCode]);
  useEffect(() => { const f = () => { const h = hashTab(); setTab(h.tab); if (h.pair) setPairCode(h.pair); }; addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  const isAdmin = sim.me?.role === 'admin';
  const show = (...t: Tab[]) => tab === 'everything' || t.includes(tab);
  const r = sim.conn.replica, st = sim.conn.stats;
  const mine = new Set(sim.me?.souls ?? []);
  return (
    <>
      <header>
        <a href="/" className="world-home">SIM</a><a href="/l/mars">lab</a>
        <span className="dim">{cfg.worldId}</span>
        <span>tick <b>{Math.floor(sim.conn.displayTick())}</b></span>
        <span>{r.env?.datetime.replace('T', ' ') ?? ''}</span>
        <span className={st.state === 'open' ? 'ok' : 'bad'}>● {st.state}</span>
        <span className={st.lastCheck === 'ok' ? 'ok' : st.lastCheck === 'mismatch' ? 'bad' : 'dim'}>sync {st.lastCheck}</span>
        <span className="dim">{sim.stats ? `${sim.stats.clients} connected · ${sim.stats.souls} souls` : ''}</span>
        <span style={{ marginLeft: 'auto' }}>
          {!auth.ready ? <span className="dim">…</span> : auth.authed
            ? <>{auth.label} {sim.me?.role === 'admin' && <span className="tag acc">admin</span>}<button onClick={() => void auth.logout()}>sign out</button></>
            : <button className="primary" onClick={auth.login}>sign in</button>}
        </span>
      </header>
      <nav>{TABS.filter((t) => isAdmin || !ADMIN_TABS.has(t)).map((t) => <button key={t} className={t === tab ? 'on' : ''} onClick={() => { setPairCode(null); setTab(t); }}>{t}{t === 'world' ? ' ·debug' : ''}</button>)}</nav>
      <main>
        <div className="grid">
          {tab === 'watch' && <Intro authed={auth.authed} login={auth.login} go={() => setTab('my soul')} souls={r.souls.size} />}
          {show('watch', 'world') && <LiveWorld sim={sim} selected={selected} onSelect={setSelected} />}
          {show('watch', 'world') && <WorldPanel sim={sim} mine={mine} selected={selected} onSelect={setSelected} />}
          {show('watch', 'world', 'story') && <BroadcastPanel sim={sim} />}
          {tab === 'watch' && <HeardPanel sim={sim} />}
          {tab === 'watch' && <Happenings sim={sim} />}
          {show('grammar') && <SentencesPanel sim={sim} />}
          {show('grammar') && <VocabularyPanel sim={sim} />}
          {show('grammar') && <BacklogPanel sim={sim} />}
          {show('grammar') && <ThingsPanel sim={sim} />}
          {show('grammar') && <LibraryPanel sim={sim} />}
          {show('notebook') && <NotebookPanel sim={sim} />}
          {show('my soul') && <SoulHome sim={sim} auth={auth} api={api} selected={selected} onSelect={setSelected} pairCode={pairCode} clearPair={() => setPairCode(null)} base={cfg.publicUrl} />}
          {show('spend') && isAdmin && <SpendPanel api={api} authed={auth.authed} isAdmin />}
          {show('brain') && <BrainPanel sim={sim} authed={auth.authed} selected={selected} api={api} isAdmin={isAdmin} />}
          {show('story') && <NarrativePanel sim={sim} />}
          {show('sync') && <SyncPanel sim={sim} />}
          {show('world', 'sync') && <LogPanel log={sim.log} sim={sim} />}
          {show('admin') && isAdmin && <AdminPanel sim={sim} api={api} />}
          {tab === 'architecture' && <ArchPanel sim={sim} cfg={cfg} />}
        </div>
      </main>
    </>
  );
}

// ------------------------------------------------------------------ arrival
function Intro({ authed, login, go, souls }: { authed: boolean; login(): void; go(): void; souls: number }) {
  return (
    <section className="wide">
      <h2>You are watching Sim, live</h2>
      <p style={{ maxWidth: 820 }}>This world keeps living when you close the page. {souls} <b>Souls</b> live in it right now. Each has a name, a personality and a mind of its own; some belong to people, who give them direction now and then. Everyone who opens this page sees the same world at the same moment.</p>
      <div className="row">{authed ? <button className="primary" onClick={go}>go to my Soul</button> : <button className="primary" onClick={login}>sign in to create a Soul</button>}<span className="dim">Watching is free and needs no account.</span></div>
    </section>
  );
}
function Happenings({ sim }: { sim: Sim }) {
  const rows = sim.log.filter((e) => e.kind !== 'rules' && e.kind !== 'admin' && e.kind !== 'decision' && e.kind !== 'deck').slice(-14).reverse();
  return (
    <section>
      <h2>Just now</h2>
      {rows.map((e) => <div key={e.seq}>{eventPlain(e, sim)}</div>)}
      {rows.length === 0 && <span className="dim">quiet</span>}
    </section>
  );
}
function eventPlain(e: LogEvent, sim: Sim): string {
  const p = e.payload ?? {}; const name = (id: string) => sim.conn.replica.souls.get(id)?.name ?? 'someone';
  if (e.kind === 'birth') return `${p.name} arrived.`;
  if (e.kind === 'play') return `${name(p.soulId)} ${p.card}${p.target ? ` → ${sim.kernel?.things[p.target]?.name ?? 'something'}` : ''}.`;
  if (e.kind === 'mint') return `A new card was made: “${p.card?.name}”.`;
  if (e.kind === 'deck') return `${name(p.soulId)}’s deck changed.`;
  if (e.kind === 'decision') return `${name(p.soulId)} decided to ${String(p.label).charAt(0).toLowerCase()}${String(p.label).slice(1)}.`;
  if (e.kind === 'intent') return `${name(p.soulId)} was given new direction by their owner.`;
  if (e.kind === 'scene') return `Storyteller, ${p.region}: ${p.beat.flavor}.`;
  if (e.kind === 'retire') return 'A Soul left the world.';
  return e.kind;
}

// ------------------------------------------------------------------ world
const COLS = 64, ROWS = 28;
function WorldPanel({ sim, mine, selected, onSelect }: { sim: Sim; mine: Set<string>; selected: string | null; onSelect(id: string | null): void }) {
  const r = sim.conn.replica, tick = sim.conn.displayTick();
  const souls = [...r.souls.values()].sort((a, b) => a.name.localeCompare(b.name));
  // fit the map to whatever this world contains (the toy plane is 100 m; a Mars scene is wherever its fixtures and people are)
  const pts = Object.values(r.entities).map((e) => [e.pose.p[0], e.pose.p[2]] as const);
  const toy = !!r.entities['gate'];
  const x0 = toy ? -50 : Math.min(...pts.map((p) => p[0]), 0) - 4, x1 = toy ? 50 : Math.max(...pts.map((p) => p[0]), 1) + 4, z0 = toy ? -50 : Math.min(...pts.map((p) => p[1]), 0) - 4, z1 = toy ? 50 : Math.max(...pts.map((p) => p[1]), 1) + 4;
  const cell = (x: number, z: number) => [Math.max(0, Math.min(COLS - 1, Math.round(((x - x0) / (x1 - x0)) * (COLS - 1)))), Math.max(0, Math.min(ROWS - 1, Math.round(((z - z0) / (z1 - z0)) * (ROWS - 1))))] as const;
  const grid: { ch: string; cls: string }[][] = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => ({ ch: '·', cls: 'dim' })));
  const glyph: Record<string, string> = { campfire: '*', bench: '=', 'bench-6ft': '=', 'camp-chair': 'h', 'table-6ft': 'T', kiosk: 'K', gate: 'G' };
  for (const e of Object.values(r.entities)) if (e.kind === 'fixture') { const [c, w] = cell(e.pose.p[0], e.pose.p[2]); grid[w][c] = { ch: glyph[e.def] ?? '?', cls: 'warn' }; }
  const pos = new Map<string, [number, number]>();
  for (const s of souls) {
    if (!r.entities[s.entityId]) continue;
    const p = r.poseAt(s.entityId, tick); const x = p[1] / 1000, z = p[3] / 1000; pos.set(s.id, [x, z]);
    const [c, w] = cell(x, z); grid[w][c] = { ch: s.name[0].toUpperCase(), cls: s.id === selected ? 'sel acc' : mine.has(s.id) ? 'acc' : '' };
  }
  const whereOf = (soulId: string) => { const k = sim.kernel; const at = k?.things[soulId]?.at; return at ? (k!.things[at]?.name ?? at) : ''; };
  return (
    <section className="wide">
      <h2>World — canonical state as this client sees it (positions computed locally from path decisions)</h2>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <pre className="map">{grid.map((row, i) => <div key={i}>{row.map((c, j) => <span key={j} className={c.cls}>{c.ch}</span>)}</div>)}</pre>
        <div className="scrollx" style={{ flex: 1, minWidth: 620 }}>
          <table>
            <thead><tr><th>soul</th><th>owner</th><th>activity</th><th>x, z</th><th>at</th><th>mood</th><th>energy</th><th>doing</th><th>intent</th></tr></thead>
            <tbody>
              {souls.map((s) => { const e = r.entities[s.entityId], p = pos.get(s.id); return (
                <tr key={s.id} className={`click ${s.id === selected ? 'sel' : ''}`} onClick={() => onSelect(s.id === selected ? null : s.id)} title={s.description}>
                  <td className={mine.has(s.id) ? 'acc' : ''}><b>{s.name}</b></td><td className="dim">{s.native ? 'world' : s.owner}</td>
                  <td>{e?.human?.activity ?? '—'}{e?.human?.on ? <span className="dim"> @{e.human.on}</span> : null}</td>
                  <td>{p ? `${p[0].toFixed(1)}, ${p[1].toFixed(1)}` : '—'}</td><td className="dim">{whereOf(s.id)}</td>
                  <td>{s.mood}</td><td>{s.energy}</td><td className="wrap">{s.doing}</td><td className="wrap dim">{s.intentText}</td>
                </tr>); })}
            </tbody>
          </table>
          <p className="dim">* campfire &nbsp; = bench &nbsp; K kiosk &nbsp; G gate &nbsp;·&nbsp; letters are souls (yours highlighted). Click a row to select a soul; the brain panel then filters to it.</p>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ sync
function SyncPanel({ sim }: { sim: Sim }) {
  const c = sim.conn, st = c.stats, s = sim.stats, hb = c.heartbeat, r = c.replica;
  return (
    <section>
      <h2>Sync — this client vs the server</h2>
      <div className="kv">
        <span>socket</span><span className={st.state === 'open' ? 'ok' : 'bad'}>{st.state} · rtt {st.rttMs} ms · reconnects {st.reconnects}</span>
        <span>replica</span><span>batch seq {r.seq} · data through tick {r.tick} · display tick {c.displayTick().toFixed(0)}</span>
        <span>heartbeat</span><span>{hb ? `tick ${hb.tick} · seq ${hb.seq} · ${st.heartbeats} received` : '—'}</span>
        <span>server view hash</span><span>{st.lastHash || '—'}</span>
        <span>my view hash</span><span className={st.lastCheck === 'ok' ? 'ok' : st.lastCheck === 'mismatch' ? 'bad' : 'dim'}>{st.myHash || '—'} ({st.lastCheck})</span>
        <span>snapshots / resyncs</span><span>{st.snapshots} / {st.resyncs}</span>
        <span>inbound</span><span>{(sim.bytesPerSec / 1024).toFixed(2)} KB/s · {st.msgsIn} messages · {(st.bytesIn / 1024).toFixed(0)} KB total</span>
        <span>keyframes</span><span>{hb ? Object.keys(hb.keyframes).length : 0} authoritative poses in the last heartbeat{hb ? `, max drift ${maxDrift(sim)} mm` : ''}</span>
        <span>clock</span><span>rate ×{hb?.clockRate ?? c.welcome?.clockRate ?? 1}{hb?.paused ? ' · PAUSED' : ''} · dt {c.welcome?.dt}s · rules {c.welcome?.rulesVersion}</span>
      </div>
      {s && <>
        <h2 style={{ marginTop: 12 }}>Server</h2>
        <div className="kv">
          <span>tick</span><span>{s.tick} · step {s.tickMsAvg.toFixed(3)} ms avg, {s.tickMsMax.toFixed(2)} ms max (budget 50 ms)</span>
          <span>world</span><span>{s.entities} entities · {s.souls} souls · {s.liveActions} live actions</span>
          <span>clients</span><span>{s.clients}</span>
          <span>log</span><span>{s.seq} events · last snapshot at tick {s.lastSnapshotTick} ({Math.round((s.tick - s.lastSnapshotTick) / 20)} s ago) · capture {s.snapshotMs.capture.toFixed(1)} ms in-tick, write {s.snapshotMs.persist.toFixed(1)} ms deferred</span>
          <span>build</span><span>{s.build}</span>
          <span>database</span><span>{(s.dbBytes / 1024).toFixed(0)} KB</span>
          <span>uptime</span><span>{fmtDur(s.uptimeSec)}</span>
        </div>
      </>}
      <div className="row"><button onClick={() => c.resync('manual')}>force resync</button><button onClick={() => c.dropForTest()}>drop socket (test reconnect)</button></div>
    </section>
  );
}
function maxDrift(sim: Sim): number {
  const hb = sim.conn.heartbeat, r = sim.conn.replica; if (!hb) return 0;
  let m = 0;
  for (const [id, k] of Object.entries(hb.keyframes)) { if (!r.entities[id]) continue; const p = r.poseAt(id, k[0]); m = Math.max(m, Math.abs(p[1] - k[1]), Math.abs(p[3] - k[3])); }
  return m;
}
export const fmtDur = (s: number) => (s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);

// ------------------------------------------------------------------ log
export function eventText(e: LogEvent, sim: Sim): string {
  const p = e.payload ?? {}; const r = sim.conn.replica;
  const name = (soulId: string) => r.souls.get(soulId)?.name ?? soulId;
  const label = (id: string) => r.entities[id]?.label ?? r.regions[id]?.label ?? id;
  switch (e.kind) {
    case 'birth': return `${p.name} is born — "${p.description}"`;
    case 'intent': return `${name(p.soulId)} ← intent via ${p.source}: ${describeIntent(p.intent, label)}`; // the owner's note is never in the public log
    case 'decision': return `${name(p.soulId)} → ${p.label} [${p.option}] (${p.trigger}${p.fallback ? ', fallback' : ''}; mood ${p.mood}; rethink in ${Math.round(p.reevalTicks / 20)} s)`;
    case 'scene': return `narrator/${p.region}: ${p.beat.kind} ${p.beat.directive} ${p.beat.targets.join(', ')} — ${p.beat.flavor}`;
    case 'retire': return `${p.soulId} retired`;
    default: return JSON.stringify(p);
  }
}
function LogPanel({ log, sim }: { log: LogEvent[]; sim: Sim }) {
  const [kind, setKind] = useState('all');
  const rows = log.filter((e) => kind === 'all' || e.kind === kind).slice(-80).reverse();
  return (
    <section className="wide">
      <h2>Event log — the canonical record (append-only; the world is the fold of this)</h2>
      <div className="row">{['all', 'birth', 'intent', 'decision', 'scene', 'rules', 'admin', 'retire'].map((k) => <button key={k} className={k === kind ? 'primary' : ''} onClick={() => setKind(k)}>{k}</button>)}
        <a href={apiPath('/v1/log?limit=1000')} target="_blank" rel="noreferrer">raw json</a></div>
      <div className="scroll"><table><tbody>
        {rows.map((e) => <tr key={e.seq}><td className="dim">#{e.seq}</td><td className="dim">t{e.tick}</td><td><span className={`tag ${e.kind === 'decision' ? 'mid' : e.kind === 'scene' ? 'narrator' : e.kind === 'intent' ? 'translate' : ''}`}>{e.kind}</span></td><td className="dim">{e.author}</td><td className="wrap">{eventText(e, sim)}</td></tr>)}
      </tbody></table></div>
    </section>
  );
}
