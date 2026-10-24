import {useCallback, useEffect, useRef, useState} from 'react';
import type {Api} from './useSim.ts';
import {apiPath} from './world-path.ts';
import {windowCode} from './god-ui/join-api.ts';
import {awaySince,reportAgentPresence} from './agent-presence.ts';
import './AgentMessageBox.css';

export type AgentInbox = {
  connected: boolean;
  lastSeenAt: number | null;
  latest: {id: string; text: string; state: 'sent' | 'delivered' | 'acknowledged'; sentAt?: number; reply?: string | null; result?: string | null; outcome?: 'done' | 'failed' | 'withdrawn'} | null;
  /** Messages waiting for the agent (the shown one included), and whether a listener is waiting right now. */
  queued?: number;
  presence?: 'listening' | 'working' | 'recent' | 'away';
};
/** A message still unread after this long says so, with its age. */
export const NOT_PICKED_UP_MS = 10_000;
const ago = (ms: number) => ms < 60_000 ? `${Math.max(0, Math.round(ms / 1000))} s` : ms < 3_600_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 3_600_000)} h`;
/** MSG: what the owner can rely on: a listener waiting now, an agent seen recently (handling messages), or away. */
export function presenceLine(inbox: AgentInbox, now: number) {
  const p = inbox.presence ?? (inbox.connected ? 'recent' : 'away');
  if (p === 'listening') return {away: false, text: 'Your agent is listening now'};
  if (p === 'away') return {away: true, text: 'Your agent is away — messages will wait'};
  return {away: false, text: `Your agent was seen recently${inbox.lastSeenAt ? ` (${ago(now - inbox.lastSeenAt)} ago)` : ''}`};
}
export function receiptState(latest: NonNullable<AgentInbox['latest']>, queued: number, now: number) {
  const age = latest.sentAt === undefined ? 0 : now - latest.sentAt;
  const base = latest.state === 'sent' ? age > NOT_PICKED_UP_MS ? `Not picked up yet (${ago(age)})` : 'Sent'
    : latest.state === 'delivered' ? 'Picked up' : latest.outcome === 'failed' ? 'Could not do it' : latest.result ? 'Done' : 'Acknowledged';
  return queued > 1 ? `${base} · ${queued} waiting` : base;
}
type Transport = (text?: string) => Promise<AgentInbox>;

/** A single private note and receipt, deliberately without a conversation history. */
export function AgentMessageBox({request, prompt, kind}: {request: Transport; prompt: string; kind: 'god' | 'soul'}) {
  const [inbox, setInbox] = useState<AgentInbox | null>(null);
  const [text, setText] = useState(''), [sending, setSending] = useState(false), [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const mounted = useRef(false), revision = useRef(0);
  useEffect(() => {
    mounted.current = true;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      const at = revision.current;
      try {const result = await request(); if (!stopped && at === revision.current) setInbox(result);}
      catch {if (!stopped && at === revision.current) setInbox(null);}
      if (!stopped) timer = setTimeout(() => void refresh(), 2000);
    };
    void refresh();
    return () => {stopped = true; mounted.current = false; clearTimeout(timer);};
  }, [request]);
  useEffect(() => {if (!copied) return; const t = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(t);}, [copied]);
  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending || !text.trim()) return;
    setSending(true); setError(''); revision.current++;
    try {const result = await request(text.trim()); if (mounted.current) {setInbox(result); setText('');}}
    catch (e) {if (mounted.current) setError(e instanceof Error ? e.message : 'Message could not be sent. Try again.');}
    finally {revision.current++; if (mounted.current) setSending(false);}
  };
  return <AgentMessageBoxView kind={kind} inbox={inbox} prompt={prompt} text={text} sending={sending} error={error} copied={copied}
    onText={setText} onSend={send} onCopy={async () => {
      try {await navigator.clipboard.writeText(prompt); if (mounted.current) setCopied(true);}
      catch {if (mounted.current) setError('Copy unavailable. Select the start prompt to copy it.');}
    }}/>;
}

export function AgentMessageBoxView({kind, inbox, prompt, text, sending = false, error = '', copied = false, now = Date.now(), onText, onSend, onCopy}: {
  kind: 'god' | 'soul'; inbox: AgentInbox | null; prompt: string; text: string; sending?: boolean; error?: string; copied?: boolean; now?: number;
  onText(text: string): void; onSend(event: React.FormEvent): void; onCopy(): void;
}) {
  const latest = inbox?.latest, presence = inbox ? presenceLine(inbox, now) : null;
  // AWAY-UI: a Soul whose agent is away shows when it left and the start prompt, and no message box until it is back
  const soulAway = kind === 'soul' && !!presence?.away;
  // the owner's newest message; `queued` counts what still waits (the agent works oldest first)
  const state = latest ? receiptState(latest, inbox?.queued ?? 0, now) : '';
  const answers = latest ? [latest.reply, latest.result].filter((x): x is string => !!x) : [];
  const receipt = latest ? [state, latest.text, ...answers].join(' · ') : '';
  return <div className="agent-message" data-agent-message={kind}>
    <div className="agent-message-presence" data-agent-presence={inbox?.presence ?? (inbox ? inbox.connected ? 'recent' : 'away' : 'unknown')}>
      <span>{soulAway ? `${awaySince(inbox?.lastSeenAt ?? null, now)} · copy the start prompt into your agent to bring it back` : presence ? presence.text : 'Agent status unavailable'}</span>
      {presence?.away && <button type="button" onClick={onCopy} title={prompt}>{copied ? 'Copied' : 'Copy start prompt'}</button>}
    </div>
    {!soulAway && <form className="agent-message-form" onSubmit={onSend}>
      <input aria-label="Message your agent" placeholder="Message your agent…" value={text} onChange={e => onText(e.target.value)} maxLength={1000} disabled={sending} autoComplete="off"/>
      <button type="submit" disabled={sending || !text.trim()}>{sending ? 'Sending…' : 'Send'}</button>
    </form>}
    {latest && <p className="agent-message-receipt" role="status" title={receipt} data-message-state={latest.state}>
      <span className="agent-message-state">{state}</span><span aria-hidden="true"> · </span><span className="agent-message-text">{latest.text}</span>
      {answers.map((a, i) => <span key={i} className="agent-message-answer"><span aria-hidden="true"> · </span><span className="agent-message-reply">{a}</span></span>)}
    </p>}
    {error && <p className="agent-message-error" role="alert">{error}</p>}
    {error.startsWith('Copy unavailable') && <input className="agent-message-prompt" aria-label="Agent start prompt" value={prompt} readOnly onFocus={e => e.target.select()}/>}
  </div>;
}

/** Lane PAIR-INWINDOW (Gene's review 2026-10-22 #1): the card's start prompt names the exact pair-soul command with this
 * window's code, like the New Soul prompt, so a fresh folder's request comes up in this window instead of only a link. */
export function soulStartPrompt(base: string, soulId: string, name: string | undefined, code: string | null) {
  const pair = `node eden.mjs pair ${JSON.stringify(soulId)}${code ? ` --for ${code}` : ''}`;
  // PROMPT-SHORT (Gene 2026-10-23 #16): two lines; the listen mechanics live in the skill (lane LISTEN-LEAK)
  return `Read ${base}/skill.md and resume my existing Soul ${name ? `${JSON.stringify(name)} (ID ${JSON.stringify(soulId)})` : JSON.stringify(soulId)} in this folder. Do not create another Soul.\n`
    + `If this folder is not paired with it yet, run ${pair}${code ? ' (the request comes up in my open Sim window)' : ' (I approve it in my open Sim window or at the approval link)'}; then start listening as the skill says.`;
}
let codeOnce: Promise<string | null> | null = null;
export function SoulAgentMessageBox({api, soulId, name}: {api: Api; soulId: string; name?: string}) {
  const request = useCallback<Transport>(async text => {
    let r;
    try {r = await api(`/v1/edge/owner/${encodeURIComponent(soulId)}/inbox`, text === undefined ? undefined : {text});}
    catch (e) {if (text === undefined) reportAgentPresence(soulId, null); throw e;}
    if (r.status !== 200 || !r.data?.inbox) {
      if (text === undefined) reportAgentPresence(soulId, null);
      throw new Error(r.data?.message ?? r.data?.error?.message ?? 'Message could not be sent. Try again.');
    }
    reportAgentPresence(soulId, r.data.inbox);
    return r.data.inbox;
  }, [api, soulId]);
  // one window-code request per page (the server reuses a code while it has over an hour left); a failure is retried next mount
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    codeOnce ??= windowCode().then(c => { if (!c) codeOnce = null; return c; }, () => (codeOnce = null));
    void codeOnce.then(c => { if (live && c) setCode(c); });
    return () => { live = false; };
  }, []);
  const base = location.origin + apiPath('');
  return <AgentMessageBox key={soulId} kind="soul" request={request} prompt={soulStartPrompt(base, soulId, name, code)}/>;
}
