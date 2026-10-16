import {useCallback, useEffect, useRef, useState} from 'react';
import type {Api} from './useSim.ts';
import {apiPath} from './world-path.ts';
import {useSession, userAuthHeaders} from './auth-session.ts';
import './AgentMessageBox.css';

export type AgentInbox = {
  connected: boolean;
  lastSeenAt: number | null;
  latest: {id: string; text: string; state: 'sent' | 'delivered' | 'acknowledged'; reply?: string | null} | null;
};
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

export function AgentMessageBoxView({kind, inbox, prompt, text, sending = false, error = '', copied = false, onText, onSend, onCopy}: {
  kind: 'god' | 'soul'; inbox: AgentInbox | null; prompt: string; text: string; sending?: boolean; error?: string; copied?: boolean;
  onText(text: string): void; onSend(event: React.FormEvent): void; onCopy(): void;
}) {
  const latest = inbox?.latest;
  const state = latest?.state === 'sent' ? 'Sent · waiting' : latest?.state === 'delivered' ? 'Delivered' : 'Acknowledged';
  const receipt = latest ? `${state} · ${latest.text}${latest.reply ? ` · ${latest.reply}` : ''}` : '';
  return <div className="agent-message" data-agent-message={kind}>
    <div className="agent-message-presence">
      <span>{inbox ? inbox.connected ? 'Your agent is connected' : 'Not running — this will wait' : 'Agent status unavailable'}</span>
      {inbox && !inbox.connected && <button type="button" onClick={onCopy} title={prompt}>{copied ? 'Copied' : 'Copy start prompt'}</button>}
    </div>
    <form className="agent-message-form" onSubmit={onSend}>
      <input aria-label="Message your agent" placeholder="Message your agent…" value={text} onChange={e => onText(e.target.value)} maxLength={1000} disabled={sending} autoComplete="off"/>
      <button type="submit" disabled={sending || !text.trim()}>{sending ? 'Sending…' : 'Send'}</button>
    </form>
    {latest && <p className="agent-message-receipt" role="status" title={receipt} data-message-state={latest.state}>
      <span className="agent-message-state">{state}</span><span aria-hidden="true"> · </span><span className="agent-message-text">{latest.text}</span>
      {latest.reply && <><span aria-hidden="true"> · </span><span className="agent-message-reply">{latest.reply}</span></>}
    </p>}
    {error && <p className="agent-message-error" role="alert">{error}</p>}
    {error.startsWith('Copy unavailable') && <input className="agent-message-prompt" aria-label="Agent start prompt" value={prompt} readOnly onFocus={e => e.target.select()}/>}
  </div>;
}

async function godInbox(text?: string): Promise<AgentInbox> {
  const r = await fetch(apiPath('/v1/god/inbox'), {method: text === undefined ? 'GET' : 'POST', headers: {...await userAuthHeaders(), 'content-type': 'application/json'}, cache: 'no-store', ...(text === undefined ? {} : {body: JSON.stringify({text})})});
  const d = await r.json();
  if (!r.ok || !d.inbox) throw new Error(d.message ?? d.error?.message ?? 'Message could not be sent. Try again.');
  return d.inbox;
}

export function GodAgentMessageBox() {
  const session = useSession();
  if (!session.authed) return null;
  const base = location.origin + apiPath('');
  return <AgentMessageBox key={JSON.stringify([session.mode, session.authed, session.label])} kind="god" request={godInbox}
    prompt={`Read ${base}/SKILL.md and resume God mode for this world. Run node eden-god.mjs listen in the background and acknowledge each owner message with ack.`}/>;
}

export function SoulAgentMessageBox({api, soulId}: {api: Api; soulId: string}) {
  const request = useCallback<Transport>(async text => {
    const r = await api(`/v1/edge/owner/${encodeURIComponent(soulId)}/inbox`, text === undefined ? undefined : {text});
    if (r.status !== 200 || !r.data?.inbox) throw new Error(r.data?.message ?? r.data?.error?.message ?? 'Message could not be sent. Try again.');
    return r.data.inbox;
  }, [api, soulId]);
  const base = location.origin + apiPath('');
  return <AgentMessageBox key={soulId} kind="soul" request={request}
    prompt={`Read ${base}/SKILL.md and resume the existing Soul ${JSON.stringify(soulId)}. Run node eden-agent.mjs listen in the background and acknowledge each owner message with ack. Do not create another Soul.`}/>;
}
