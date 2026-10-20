// G4 (Gene 2026-10-20): the God modal, as large as Explore. For the world's god: their agent (a command box and the
// ticket log of every command, newest first, each pending -> in progress -> done or failed, with the agent's reply and,
// once done, a link that flies the camera to what it built), plus every god control so far (start steps, edits, flags,
// previews, Souls, the Constitution, weather and the world itself) in one place. For everyone else: the Constitution and
// how to become a god. GodPanel (in the world view) owns the data and renders this.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { closeGod, presenceWord, sendCommand, showSection, ticketStatus, useGod, withdrawCommand, type Section, type Ticket } from './god-store.ts';
import { flyTo } from './camera.ts';
import './god-modal.css';

const BOLT = <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M11.5 2 4.5 11.2h4.6L8 18l7.5-9.6h-4.7z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>;
const GO = <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" strokeWidth="1.4"/><circle cx="8" cy="8" r="1.6" fill="currentColor"/><path d="M8 .8v2.6M8 12.6v2.6M.8 8h2.6M12.6 8h2.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>;

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
  return <dialog ref={dialog} className={'frosted-modal god-modal' + (wide ? ' god-modal-owner' : '')} aria-modal="true" aria-label={label} data-god-modal="1" data-god-bolt-panel="1"
    onCancel={(e) => { e.preventDefault(); closeGod(); }}>{children}</dialog>;
}

function Head({ world, meta, right }: { world: string; meta?: ReactNode; right?: ReactNode }) {
  return <header className="gm-head">
    <span className="gm-mark" aria-hidden="true">{BOLT}</span>
    <div className="gm-titles"><h2>God</h2><p title={world}>{world}{meta ? <span className="gm-meta"> · {meta}</span> : null}</p></div>
    {right}
    <button type="button" className="gm-x" aria-label="Close God" onClick={closeGod}>×</button>
  </header>;
}

export type NavItem = { id: Section; label: string; count?: string | number | null; alert?: boolean };

/** The owner's God: header with the agent pill, a section list, and the section's body. */
export function OwnerGod({ world, meta, nav, banner, children, prompt, paired }: { world: string; meta?: ReactNode; nav: NavItem[]; banner?: ReactNode; children: (s: Section) => ReactNode; prompt: string; paired: boolean }) {
  const { section, inbox } = useGod();
  const shown = nav.some((n) => n.id === section) ? section : 'agent';
  const connected = !!inbox?.connected;
  const pill = paired && inbox ? <span className={'gm-pill ' + (connected ? 'on' : 'off')} data-agent-pill={connected ? 'connected' : 'away'} data-presence={inbox.presence ?? ''} role="status">
    <i aria-hidden="true" />{presenceWord(inbox.presence, connected)}
  </span> : null;
  return <Frame label="God" wide>
    <Head world={world} meta={meta} right={pill} />
    {banner}
    <div className="gm-body" data-god-panel="1">
      <nav className="gm-nav" aria-label="God sections" role="tablist">
        {nav.map((n) => <button key={n.id} type="button" role="tab" data-tab={n.id} aria-selected={shown === n.id} className={shown === n.id ? 'on' : ''} onClick={() => showSection(n.id)}>
          <span>{n.label}</span>{n.count !== undefined && n.count !== null && n.count !== '' ? <span className={'gm-count' + (n.alert ? ' alert' : '')}>{n.count}</span> : null}
        </button>)}
      </nav>
      <div className="gm-pane" role="tabpanel" data-section={shown}>
        {shown === 'agent' ? <GodConsole prompt={prompt} paired={paired} /> : null}
        {children(shown)}
      </div>
    </div>
  </Frame>;
}

/** Everyone who is not this world's god: the Constitution and how to become a god. No owner controls. */
export function VisitorGod({ world, become, children }: { world: string; become: ReactNode; children: ReactNode }) {
  return <Frame label="God">
    <Head world={world} />
    <div className="gm-visitor" data-god-visitor="1">
      <section className="gm-become" data-become-god="1">{become}</section>
      <section className="gm-const"><h3>Constitution</h3>{children}</section>
    </div>
  </Frame>;
}

/** The agent section: a command box and the ticket log, newest first. */
function GodConsole({ prompt, paired }: { prompt: string; paired: boolean }) {
  const { inbox, inboxError, open } = useGod();
  const [text, setText] = useState(''), [sending, setSending] = useState(false), [error, setError] = useState('');
  const [copied, setCopied] = useState(false), [now, setNow] = useState(Date.now());
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (open) box.current?.focus(); }, [open]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, []);
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(t); }, [copied]);
  const send = async () => {
    const t = text.trim(); if (sending || !t) return;
    setSending(true); setError('');
    try { await sendCommand(t); setText(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'That did not reach the world. Try again.'); }
    finally { setSending(false); box.current?.focus(); }
  };
  const log = inbox?.log ?? [];
  const waiting = inbox?.queued ?? 0, connected = !!inbox?.connected;
  const copy = async () => { try { await navigator.clipboard.writeText(prompt); setCopied(true); } catch { setError('Copy is unavailable here. Select the line below and copy it.'); } };
  return <div className="gm-console" data-god-console="1" data-agent-message="god">
    <form className="gm-compose" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <textarea ref={box} rows={2} aria-label="Command for your agent" placeholder={paired ? 'Tell your agent what to build or change…' : 'Write a command now; it waits until your agent connects…'}
        value={text} maxLength={1000} disabled={sending} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
      <button type="submit" className="gm-send" disabled={sending || !text.trim()}>{sending ? 'Sending…' : 'Send'}</button>
    </form>
    <p className="gm-under">
      {waiting > 0 ? <b data-queued={waiting}>{waiting === 1 ? '1 command' : `${waiting} commands`} {connected ? 'in the queue' : 'waiting for your agent'}</b>
        : <span>{connected ? 'Your agent takes commands one at a time, in order.' : 'Commands wait here, in order, until your agent is back.'}</span>}
      {paired && !connected && inbox && <button type="button" className="gm-textbtn" onClick={() => void copy()} title={prompt}>{copied ? 'Copied' : 'Copy the line that restarts it'}</button>}
    </p>
    {error && <p className="gm-error" role="alert">{error}</p>}
    {error.startsWith('Copy is unavailable') && <input className="gm-prompt" aria-label="Agent start line" value={prompt} readOnly onFocus={(e) => e.target.select()} />}
    {inboxError && !inbox && <p className="gm-error">Your agent's commands could not be loaded. Retrying…</p>}
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
