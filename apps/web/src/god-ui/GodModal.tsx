// G4 (Gene 2026-10-20): the God modal, as large as Explore. G5 (Gene 2026-10-20b): "God Mode", one view, no tabs. For the
// world's god: how to connect their agent (only while it is not connected), the command box with undo/redo and the
// weather beside it, prayers waiting for an answer (only when there are any), and the ticket log of every command, newest
// first (pending -> in progress -> done or failed, the agent's reply, and once done a link that flies the camera to what
// it built). At the bottom "Forsake world" takes the modal over: hand the world on, or archive it. Nobody else
// opens it (U3: only the god has the God button). GodPanel (in the world view) owns the data and renders this.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { closeGod, presenceWord, sendCommand, showSection, ticketStatus, useGod, withdrawCommand, type Ticket } from './god-store.ts';
import { flyTo } from './camera.ts';
import { copyText } from '../clipboard.ts';
import './god-modal.css';

const BOLT = <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M11.5 2 4.5 11.2h4.6L8 18l7.5-9.6h-4.7z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>;
const GO = <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" strokeWidth="1.4"/><circle cx="8" cy="8" r="1.6" fill="currentColor"/><path d="M8 .8v2.6M8 12.6v2.6M.8 8h2.6M12.6 8h2.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>;
const BACK = <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const OUT = <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 3.5H3.5v9h9v-3M9 2.5h4.5V7M13.5 2.5 7.5 8.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>;

export const ago = (t: number, now = Date.now()) => { const s = Math.max(0, Math.round((now - t) / 1000)); return s < 45 ? 'just now' : s < 3600 ? `${Math.max(1, Math.round(s / 60))} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };

/** The native dialog both views share: Escape, a click outside and × close it; the world below stays visible. */
function Frame({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const node = dialog.current; if (!node) return;
    const opener = document.activeElement as HTMLElement | null;
    if (!node.open) node.showModal();
    const outside = (e: PointerEvent) => { if (e.target !== node) return; const b = node.getBoundingClientRect(); if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) closeGod(); };
    node.addEventListener('pointerdown', outside);
    return () => { node.removeEventListener('pointerdown', outside); if (node.open) node.close(); opener?.focus?.(); };
  }, []);
  return <dialog ref={dialog} className={'frosted-modal god-modal' + (wide ? ' god-modal-owner' : '')} aria-modal="true" aria-label={label} data-god-modal="1"
    onCancel={(e) => { e.preventDefault(); closeGod(); }}>{children}</dialog>;
}

function Head({ title = 'God Mode', right, back }: { title?: string; right?: ReactNode; back?: () => void }) {
  return <header className={'gm-head' + (back ? ' gm-head-danger' : '')}>
    {back
      ? <button type="button" className="gm-back" data-forsake-back="1" aria-label="Back to God Mode" title="Back to God Mode" onClick={back}>{BACK}</button>
      : <span className="gm-mark" aria-hidden="true">{BOLT}</span>}
    <div className="gm-titles"><h2>{title}</h2></div>
    {right}
    <button type="button" className="gm-x" aria-label="Close God Mode" onClick={closeGod}>×</button>
  </header>;
}

/** The owner's God Mode: one view, or the Forsake danger zone over it. */
export function OwnerGod({ banner, connectUrl, tools, prayers, more, forsake, paired }: { banner?: ReactNode; connectUrl: string | null; tools: ReactNode; prayers?: ReactNode; more?: ReactNode; forsake: ReactNode | null; paired: boolean }) {
  const { section, inbox } = useGod();
  const connected = !!inbox?.connected;
  if (section === 'forsake' && forsake) return <Frame label="Forsake world" wide>
    <Head title="Forsake world" back={() => showSection('agent')} />
    <div className="gm-scroll gm-forsake-pane" data-section="forsake">{forsake}</div>
  </Frame>;
  const pill = paired && inbox ? <span className={'gm-pill ' + (connected ? 'on' : 'off')} data-agent-pill={connected ? 'connected' : 'away'} data-presence={inbox.presence ?? ''} role="status">
    <i aria-hidden="true" />{presenceWord(inbox.presence, connected)}
  </span> : null;
  return <Frame label="God Mode" wide>
    <Head right={pill} />
    <div className="gm-scroll" data-god-panel="1" data-section="agent">
      {banner}
      {connectUrl && <Connect url={connectUrl} />}
      <GodConsole paired={paired} tools={tools} prayers={prayers} />
      {more}
      {forsake && <footer className="gm-foot"><button type="button" className="gm-forsake-open" data-forsake-open="1" onClick={() => showSection('forsake')}>Forsake world</button></footer>}
    </div>
  </Frame>;
}

/** Until the agent is connected: the one line to give it, and the skill it names. */
function Connect({ url }: { url: string }) {
  const line = `Read ${url} and follow its God mode section to control this world.`;
  const [copied, setCopied] = useState(false), [manual, setManual] = useState(false);
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(t); }, [copied]);
  const copy = async () => { if (await copyText(line)) setCopied(true); else setManual(true); };
  return <section className="gm-connect" data-connect="1" aria-labelledby="gm-connect-h">
    <h3 id="gm-connect-h"><i className="gm-connect-dot" aria-hidden="true" />Connect your agent to God mode</h3>
    <div className="gm-connect-line">
      <p data-connect-line={line}>Read <a href={url} target="_blank" rel="noreferrer" data-skill-link="1">{url}<span className="gm-out">{OUT}</span></a> and follow its God mode section to control this world.</p>
      <button type="button" className="gm-copy" data-connect-copy="1" onClick={() => void copy()} aria-label="Copy the line for your agent">{copied ? 'Copied' : 'Copy'}</button>
    </div>
    {manual && <input className="gm-prompt" aria-label="Line for your agent" value={line} readOnly autoFocus onFocus={(e) => e.target.select()} />}
  </section>;
}

/** The command box (undo/redo and weather under it), prayers waiting, and the ticket log, newest first. */
function GodConsole({ paired, tools, prayers }: { paired: boolean; tools: ReactNode; prayers?: ReactNode }) {
  const { inbox, inboxError, open } = useGod();
  const [text, setText] = useState(''), [sending, setSending] = useState(false), [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const box = useRef<HTMLTextAreaElement>(null);
  // phones: no focus on open, so the keyboard does not cover the sheet
  useEffect(() => { if (open && !(typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)) box.current?.focus(); }, [open]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, []);
  const send = async () => {
    const t = text.trim(); if (sending || !t) return;
    setSending(true); setError('');
    try { await sendCommand(t); setText(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'That did not reach the world. Try again.'); }
    finally { setSending(false); box.current?.focus(); }
  };
  const log = inbox?.log ?? [];
  const waiting = inbox?.queued ?? 0, connected = !!inbox?.connected;
  return <div className="gm-console" data-god-console="1" data-agent-message="god">
    <form className="gm-compose" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <textarea ref={box} rows={2} aria-label="Command for your agent" placeholder={paired ? 'Tell your agent what to build or change…' : 'Write a command; it waits for your agent…'}
        value={text} maxLength={1000} disabled={sending} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
      <button type="submit" className="gm-send" disabled={sending || !text.trim()}>{sending ? 'Sending…' : 'Send'}</button>
    </form>
    <p className="gm-under">
      {waiting > 0 ? <b data-queued={waiting}>{waiting === 1 ? '1 command' : `${waiting} commands`} {connected ? 'in the queue' : 'waiting for your agent'}</b>
        : <span>{connected ? 'Your agent takes commands one at a time, in order.' : paired ? 'Commands wait here, in order, until your agent is back.' : 'Commands wait here, in order, until your agent connects.'}</span>}
    </p>
    {error && <p className="gm-error" role="alert">{error}</p>}
    {inboxError && !inbox && <p className="gm-error">Your agent's commands could not be loaded. Retrying…</p>}
    <div className="gm-tools" data-god-tools="1">{tools}</div>
    {prayers}
    {inbox && !log.length && <p className="gm-empty">Nothing sent yet. Each command you send shows here with what happened to it.</p>}
    {log.length > 0 && <ol className="gm-log" data-god-log="1" aria-label="Commands, newest first">{log.map((t) => <TicketRow key={t.id} t={t} now={now} />)}</ol>}
  </div>;
}

function TicketRow({ t, now }: { t: Ticket; now: number }) {
  const s = ticketStatus(t), [busy, setBusy] = useState(false);
  const go = t.focus ? () => { const f = t.focus!; closeGod(); flyTo(f.x, f.y, f.z, { distance: Math.max(18, f.span * 1.6) }); } : null;
  const when = t.acknowledgedAt ?? t.deliveredAt ?? t.sentAt;
  const open = s.key === 'pending' || s.key === 'progress';
  return <li className={'gm-ticket ' + s.key + (go ? ' linked' : '')} data-ticket={t.id} data-status={s.key}
    onClick={go ? (e) => { if ((e.target as HTMLElement).closest('button')) return; go(); } : undefined}>
    <span className="gm-glyph" aria-hidden="true" />
    <div className="gm-tbody">
      <p className="gm-cmd">{t.text}</p>
      {t.reply && <p className="gm-reply">{t.reply}</p>}
      <div className="gm-tmeta">
        <span className="gm-status">{s.word}</span><span className="gm-when" title={new Date(when).toLocaleString()}>{ago(when, now)}</span>
        {go && <button type="button" className="gm-go" data-ticket-go={t.id} onClick={go} title="Fly the camera to it">{GO}<span>{t.focus!.label ? `Go to ${t.focus!.label}` : 'Go there'}{t.focus!.count > 1 ? ` +${t.focus!.count - 1}` : ''}</span></button>}
        {open && <button type="button" className="gm-textbtn gm-withdraw" data-withdraw={t.id} disabled={busy} onClick={async () => { setBusy(true); try { await withdrawCommand(t.id); } catch { /* the next poll shows the truth */ } finally { setBusy(false); } }}>Withdraw</button>}
      </div>
    </div>
  </li>;
}
