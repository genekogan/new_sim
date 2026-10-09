import {requestSoulConversations} from './dialogue-speaking.ts';
import {SoulChoices} from './SoulChoices.tsx';
import {PublicSoulActivity} from './PublicSoulActivity.tsx';
import {AvailableActions} from './AvailableActions.tsx';
import { useEffect, useRef, useState } from 'react';
import type { AuthCtx } from './Shell.tsx';
import type { Api, Sim } from './useSim.ts';
import { steerReceipt, type SteerReceipt } from './steer-receipt.ts';
import {IntentDirection} from './IntentDirection.tsx';
import {intentAdapter,type IntentAdapter} from './intent-adapter.ts';
import {IntentHistory} from './IntentHistory.tsx';
import {approvedMe} from './auth-projection.ts';
import {PublicSoulLink} from './PublicSoulLink.tsx';
import {AgentConnection} from './AgentConnection.tsx';
import {agentConnectionProjection} from './connection-response.ts';
import {worldPath} from './world-path.ts';
import {AUTH_UI} from './auth-ui.ts';
import {PublicSoulRecord} from './PublicSoulRecord.tsx';
import {SoulCard} from './SoulCard.tsx';
import {doingText} from './place-names.ts';

type Dashboard = { agent?:unknown; control?:unknown; status: { doing?: string; needs?: Record<string, number>; journal?: string; energy?:unknown; available_now?:unknown } };
type HistoryRow = { seq: number; tick: number; kind: string; text: string };

/** Current G owner projection; candidate control is selected only from the strict current Core DTO. */
type FocusProps = {
  sim: Sim; api: Api; auth: AuthCtx; selected: string | null;
  select(id: string | null): void; manage(): void; active?:boolean;
  /** VF2: Follow lives on the Soul card. */
  camera?:{following:boolean;follow():void;stop():void};
  pin?:{pinned:boolean;toggle():void};
};
export function SoulFocus(props: FocusProps) {
  // Replace private drafts/results immediately when identity or access changes,
  // even before the connection delivers a new Me projection.
  const identity = props.auth.debug.privyUserId ?? props.auth.label ?? props.sim.me?.userId ?? 'public';
  const own = !!props.selected && !!approvedMe(props.auth,props.sim.me)?.souls.includes(props.selected);
  const authorityKey=JSON.stringify([props.sim.privateAuthorityGeneration??0,props.sim.conn.welcome?.worldId,props.sim.conn.welcome?.epoch,props.selected,props.auth.authed,identity,props.sim.me?.userId,own]);
  return <FocusCard key={authorityKey} authorityKey={authorityKey} {...props} />;
}
function FocusCard({ sim, api, auth, selected, select, manage,authorityKey,active=false,camera,pin }: FocusProps&{authorityKey:string}) {
  const souls = [...sim.conn.replica.souls.values()];
  const soul = selected ? sim.conn.replica.souls.get(selected) : null;
  const own = !!soul && !!approvedMe(auth,sim.me)?.souls.includes(soul.id);
  const [adapter,setAdapter]=useState<IntentAdapter>({kind:'loading'});
  const candidateSeen=useRef(false);
  const privateHistorySeen=useRef(false);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyState, setHistoryState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [error, setError] = useState('');
  const [connectionMessage,setConnectionMessage]=useState('');
  const [historyUpdate,setHistoryUpdate]=useState(0);
  const reload=useRef<(()=>void)|null>(null);
  const [text, setText] = useState('');
  const [receipt, setReceipt] = useState<SteerReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const alive = useRef(true);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (title.current?.offsetParent) title.current.focus(); }, [selected]);
  useEffect(() => {
    setDashboard(null);setConnectionMessage('');setAdapter({kind:'loading'}); setHistory([]); setHistoryState('loading'); setError('');
    if (!own || !selected) return;
    let live = true, latest = 0;
    const load = async () => {
      const request = ++latest;
      try{
      const [a, b] = await Promise.all([api<Dashboard>(`/v1/souls/${selected}`), api<{ events: HistoryRow[] }>(`/v1/souls/${selected}/timeline?limit=12`)]);
      if (!live || request !== latest) return;
      const next=intentAdapter(a.status,a.data,{worldId:sim.conn.welcome?.worldId??'',soulId:selected,ownerId:sim.me?.userId??''},candidateSeen.current);
      if(a.data&&typeof a.data==='object'&&Object.hasOwn(a.data,'control'))candidateSeen.current=true;
      // A transient read failure (network/5xx) keeps the current owner's open direction,
      // lookup and failure diagnostics mounted. Auth/foreign/malformed answers still retire them.
      const transient=a.status===0||a.status>=500;
      setAdapter(prev=>next.kind==='unavailable'&&transient&&prev.kind==='candidate'?prev:next);
      if(next.kind==='candidate'&&next.control.intentHistoryContract==='private-intent-history/1')privateHistorySeen.current=true;
      if (a.status === 200 && a.data?.status) { setDashboard(a.data); setError(''); }
      else { setDashboard(null); setConnectionMessage('');setHistory([]); setError('Your Soul’s live details are unavailable. Try again shortly.'); }
      const rows = b.data?.events;
      const valid = Array.isArray(rows) && rows.every((row) => row &&
        Number.isSafeInteger(row.seq) && row.seq >= 0 && Number.isSafeInteger(row.tick) && row.tick >= 0 &&
        typeof row.kind === 'string' && typeof row.text === 'string');
      if (a.status === 200 && a.data?.status && b.status === 200 && valid) {
        setHistory(rows!); setHistoryState('ready');
      } else { setHistory([]); setHistoryState('unavailable'); }
      }catch{if(live&&request===latest){setAdapter(prev=>prev.kind==='candidate'?prev:{kind:'unavailable'});setDashboard(null);setConnectionMessage('');setHistory([]);setHistoryState('unavailable');setError('Your Soul’s live details are unavailable. Try again shortly.');}}
    };
    reload.current=()=>void load();void load(); const timer = setInterval(load, 3000);
    return () => { live = false; reload.current=null;clearInterval(timer); };
  }, [api, own, selected,sim.conn.welcome?.worldId,sim.me?.userId]);

  useEffect(()=>{if(adapter.kind!=='legacy'){setText('');setReceipt(null);}},[adapter.kind]);

  const send = async () => {
    if (adapter.kind!=='legacy' || !own || !soul || !dashboard || !text.trim() || sending.current) return;
    const words = text.trim();
    sending.current = true; setBusy(true); setReceipt(null);
    const endpoint = dashboard.status.needs ? 'mandate' : 'command';
    try {
      const result = await api(`/v1/souls/${soul.id}/${endpoint}`, endpoint === 'mandate' ? { words } : { text: words });
      if (!alive.current) return;
      const received = steerReceipt(result.status, result.data, endpoint);
      setReceipt(received);
      // Keep the draft on refusal/uncertainty. Never resend automatically.
      if (received.kind === 'accepted') setText((current) => current.trim() === words ? '' : current);
    } finally { sending.current = false; if (alive.current) setBusy(false); }
  };

  if (!soul) return <>
    <p className="eyebrow">A world that keeps living</p>
    <h1>Meet its Souls.</h1>
    {selected&&<p role="status">{sim.conn.welcome?'The linked Soul isn’t in this world’s current view. Choose someone below.':'Looking for the linked Soul as the world arrives…'}</p>}
    <p>Each inhabitant has a character and a life of its own. Pick someone to see what they’re doing.{AUTH_UI?' Give your own Soul direction when you’re ready.':' Each is run by its owner’s AI agent; yours can join too.'}</p>
    <PlayingHelp own={false} />
    <SoulChoices souls={souls} ownedIds={approvedMe(auth,sim.me)?.souls??[]} select={select}/>
    {!souls.length && <p className="dim">{sim.conn.welcome?(AUTH_UI?'No Souls live here yet. Sign in to bring the first one.':'No Souls live here yet. Choose New Soul to bring one.'):'Waiting for the world to connect…'}</p>}
    {AUTH_UI&&<button className="primary" disabled={!auth.ready} onClick={auth.authed ? manage : auth.login}>{auth.authed ? (approvedMe(auth,sim.me)?.souls.length ? 'Soul and account tools' : 'Bring your first Soul') : 'Sign in to meet your Soul'}</button>}
  </>;

  const entity = sim.conn.replica.entities[soul.entityId];
  const rawEnergy=own?dashboard?.status.energy:soul.energy;
  const energy=typeof rawEnergy==='string'&&['energetic','fine','tired','exhausted'].includes(rawEnergy)?rawEnergy:null;
  // UI2: anyone else's Soul (the default viewer) is a compact card; the owner's tools below need sign-in (AUTH_UI).
  if(!own&&!AUTH_UI)return <SoulCard api={api} soul={soul} doing={doingText(soul.doing,entity?.human?.activity,soul.id,id=>sim.kernel?.things[id]?.name??sim.conn.replica.entities[id]?.label)} energy={energy==='fine'?null:energy} plays={sim.plays} talk={sim.talk} camera={camera} pin={pin}/>;
  return <>
    <div className="focus-heading"><button className="back-button" onClick={() => select(null)}>← All Souls</button><span className="eyebrow">{own ? 'Your Soul · live status' : 'In this world'}</span></div>
    <p className="soul-actions"><button onClick={()=>requestSoulConversations(soul.id)}>Conversations</button>{pin&&<button aria-pressed={pin.pinned} aria-label={pin.pinned?'Pinned to your Souls; unpin this Soul':'Pin this Soul to your Souls'} title={pin.pinned?'Unpin from your Souls':'Pin to your Souls'} onClick={pin.toggle}>{pin.pinned?'Pinned':'This is mine'}</button>}</p>
    <h1 ref={title} tabIndex={-1}>{soul.name}</h1>
    {camera&&<p><button className={camera.following?'soul-follow on':'soul-follow'} aria-pressed={camera.following} onClick={camera.following?camera.stop:camera.follow}>{camera.following?'Following':'Follow'}</button></p>}
    <p><span className="dim">Doing </span><b>{(doingText(own && dashboard?.status.doing ? dashboard.status.doing : soul.doing,entity?.human?.activity,soul.id,id=>sim.kernel?.things[id]?.name??sim.conn.replica.entities[id]?.label)||'Waiting for a live update')}</b></p>
    {energy&&<p className="small"><span className="dim">Energy </span><b>{energy}</b></p>}
    {!own&&<><PublicSoulLink id={soul.id}/><details className="soul-character"><summary>Character</summary><p>{soul.description}</p></details><PlayingHelp own={false}/></>}
    {own ? <>
      {error && <p role="status" className="warn">{error}</p>}
      {adapter.kind==='candidate'?<IntentDirection api={api} worldId={adapter.control.worldId} soulId={soul.id} soulName={soul.name} ownerId={adapter.control.ownerId} principalId={adapter.control.accountOwnerId} authorityKey={authorityKey} active={own} suggestions={dashboard?.status.available_now} diagnosticContext={{backendBuild:sim.conn.welcome?.build,body:{activity:sim.conn.replica.entities[soul.entityId]?.human?.activity,actionId:sim.conn.replica.entities[soul.entityId]?.human?.task,seatedOn:sim.conn.replica.entities[soul.entityId]?.human?.on,tick:sim.conn.replica.tick}}} humanGoalsEnabled={adapter.control.humanGoalContract==='human-capabilities/1'||adapter.control.humanGoalContract==='human-capabilities/2'} humanGoalContract={adapter.control.humanGoalContract} entityId={soul.entityId} onUnderstood={()=>setHistoryUpdate(n=>n+1)}/>:adapter.kind==='unavailable'?<p role="status" className="warn">Direction controls are unavailable. We’ll check your current access again shortly. Keep any previous request reference; unavailable controls do not send a new direction.</p>:<>
      <form onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <label htmlFor="soul-direction">Give {soul.name} direction</label>
        <textarea id="soul-direction" placeholder="What would you like them to do?" rows={3} maxLength={dashboard?.status.needs ? 2000 : 280} value={text} onChange={(event) => setText(event.target.value)} />
        <button className="primary" disabled={busy || adapter.kind!=='legacy' || !dashboard || !text.trim()}>{busy ? 'Listening…' : 'Send direction'}</button>
      </form>
      <p className="small dim">Directions affect the live world, even while you watch a recording. Your Soul chooses how to carry them out.</p>
      <div aria-live="polite">{receipt && <div className="human-receipt">
        <b>{receipt.title}</b><p>{receipt.detail}</p>
        {receipt.kind === 'accepted' && <p className="small dim">Saved as direction. Completion has not been confirmed.</p>}
      </div>}</div>
      </>}
      {adapter.kind==='legacy'&&<AvailableActions soulId={soul.id} options={dashboard?.status.available_now}/>}
      <PlayingHelp own candidate={adapter.kind==='candidate'} />
      <PublicSoulLink id={soul.id}/>
      <details className="soul-character"><summary>Character</summary><p>{soul.description}</p></details>
      {dashboard?.status.journal && <details><summary>Latest journal</summary><p>{dashboard.status.journal}</p></details>}
      {adapter.kind==='candidate'&&adapter.control.intentHistoryContract==='private-intent-history/1'?<IntentHistory api={api} worldId={adapter.control.worldId} soulId={soul.id} ownerId={adapter.control.ownerId} authorityKey={authorityKey} updateSignal={historyUpdate} active={active} entityId={soul.entityId}/>:privateHistorySeen.current?<p role="status">Direction history is unavailable. Current access will be checked again shortly.</p>:<section aria-label="Soul history">
      <h2>Recent history</h2>
      <p className="small dim">Latest 12 available events, newest first. This is a recent window, not a complete history or a summary since your last visit.</p>
      {history.length ? <ol className="human-history">{history.slice().reverse().map((row) => <li key={row.seq}><p>{row.kind === 'mandate' && row.text === 'mandate' ? 'Direction update' : row.text}</p><details><summary>Event details</summary><span className="small dim">{row.kind} · event {row.seq} · tick {row.tick}</span></details></li>)}</ol> : <p role="status" className="dim">{historyState === 'loading' ? 'Loading recent history…' : historyState === 'unavailable' ? 'Recent history could not be loaded. We’ll check again shortly.' : 'No events in this recent window.'}</p>}
      </section>}
      <details className="focus-agent"><summary>Connect an assistant</summary>
        {agentConnectionProjection(dashboard?.agent)?<AgentConnection api={api} soulId={soul.id} name={soul.name} base={location.origin+worldPath} connection={agentConnectionProjection(dashboard?.agent)} refresh={()=>reload.current?.()} notice={{message:connectionMessage,setMessage:setConnectionMessage}}/>:<p role="status">Assistant connection details are unavailable. We’ll check your current access again shortly.</p>}
      </details>
      <button onClick={manage}>More Soul tools</button>
    </> : <>
      <p className="dim">{AUTH_UI?'You can watch this Soul. Its owner gives it direction.':'You can watch this Soul. Its owner’s AI agent gives it direction.'}</p>
      <PublicSoulRecord api={api} soulId={soul.id}/>
      <PublicSoulActivity soulId={soul.id} plays={sim.plays} talk={sim.talk}/>
      {AUTH_UI&&!auth.authed && <button className="primary" disabled={!auth.ready} onClick={auth.login}>Sign in</button>}
    </>}
  </>;
}

function PlayingHelp({ own,candidate=false }: { own: boolean;candidate?:boolean }) {
  return <details className="playing-help">
    <summary>How to play</summary>
    <p>Choose a Soul whose character interests you. Read their character and watch what they’re doing.</p>
    {own ? <>
      <p>Type one small direction and choose Send direction, then watch what your Soul chooses to do. An accepted direction is saved; it is not a completed action.</p>
      {candidate?<p>If a response is unconfirmed, choose Check this direction. This reads the saved request without sending it again. Keep its reference in Request details; on a later visit, use Check a previous direction.</p>:<p>If a response is unconfirmed, check recent history before sending again. History may be unavailable or cover only a recent window.</p>}
    </> : <p>{AUTH_UI?'Select a Soul, then choose Follow to keep it in view. Choose Your Soul to find your own Soul or account tools. You can watch anyone; only its owner gives it direction. Signing in alone does not assign a Soul.':'Click a Soul’s name plate, then choose Follow on its card to keep it in view. Each Soul is run by its owner’s AI agent; choose New Soul to add yours.'}</p>}
    <p>Directions affect the live world. Close this panel (×) for more room; click a name plate to open it again.</p>
  </details>;
}
