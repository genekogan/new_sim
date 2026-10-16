// GOVERN (lane C17): the world's constitution on the world page, for everyone. A small chip ("§ Constitution · v3",
// "changed since your last visit"); open, it shows the text (markdown), what changed since this browser last opened it,
// the residents' amendments with their support and the god's decisions, and how many prayers were answered. The owner
// (the world's god in this browser) also decides amendments, answers prayers and sets the residents-decide switch —
// the same calls the god's agent makes (`amendments`, `decide`, `answer`).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Markdown } from './markdown.tsx';
import * as G from './god-api.ts';
import * as V from './governance-api.ts';
import './constitution.css';

const shotMode = typeof location !== 'undefined' && new URLSearchParams(location.search).get('shot') === '1';
const ago = (t: number | null) => { if (!t) return ''; const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
/** Supporters other than the proposer (who always supports their own). */
const others = (a: V.Amendment) => a.supporters.filter((n) => n !== a.by.name);
const STATUS_WORD: Record<V.Amendment['status'], string> = { open: 'open', accepted: 'accepted', declined: 'declined', withdrawn: 'withdrawn' };

export function ConstitutionCard() {
  const [g, setG] = useState<V.Governance | null>(null);
  const [status, setStatus] = useState<G.Status | null>(null);
  const [open, setOpen] = useState(false);
  // the version this browser had opened before this page load ("changed since your last visit"); null = first visit
  const [seen, setSeen] = useState<number | null>(() => V.seenVersion());
  const [before, setBefore] = useState<{ version: number; text: string } | null>(null);
  const [showChange, setShowChange] = useState(true);
  const [prayers, setPrayers] = useState<V.Prayer[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [answering, setAnswering] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState('');
  const owner = status?.you === 'owner' || status?.you === 'god';

  const refresh = useCallback(async () => {
    const [gv, st] = await Promise.all([V.governance(), G.getStatus()]);
    if (gv) setG(gv); if (st) setStatus(st);
  }, []);
  useEffect(() => { void refresh(); const t = setInterval(() => void refresh(), 10_000); return () => clearInterval(t); }, [refresh]);
  const version = g?.constitution.version ?? 0;
  const changed = seen !== null && version > seen;
  // opening the card is reading it: remember the version (the badge clears when the card closes)
  useEffect(() => { if (open && version > 0) V.markSeen(version); }, [open, version]);
  useEffect(() => {
    if (!open || !changed || seen === null || before?.version === seen) return;
    if (seen === 0) { setBefore({ version: 0, text: '' }); return; }
    void V.versionText(seen).then((text) => { if (text !== null) setBefore({ version: seen, text }); });
  }, [open, changed, seen, before]);
  useEffect(() => { if (!open || !owner) return; const go = () => void V.prayers().then(setPrayers).catch(() => setPrayers(null)); go(); const t = setInterval(go, 10_000); return () => clearInterval(t); }, [open, owner]);

  const diff = useMemo(() => (before && g ? V.changedOnly(V.lineDiff(before.text, g.constitution.text)) : null), [before, g]);
  if (shotMode || !g) return null;
  const openAmendments = g.amendments.filter((a) => a.status === 'open');
  const decided = g.amendments.filter((a) => a.status !== 'open');
  if (!owner && version === 0 && !g.amendments.length) return null;

  const close = () => { setOpen(false); setSeen(V.seenVersion()); setBefore(null); setDeclining(null); setAnswering(null); };
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key); setNote(null);
    try { await fn(); setNote({ text: ok }); await refresh(); if (owner) setPrayers(await V.prayers().catch(() => null)); }
    catch (e) { setNote({ text: String((e as Error).message), bad: true }); }
    finally { setBusy(null); }
  };
  const accept = (a: V.Amendment) => run('a:' + a.id, () => V.decide(a.id, 'accept'), `Accepted “${a.title}”: the constitution has a new version.`);
  const decline = (a: V.Amendment) => run('d:' + a.id, async () => { await V.decide(a.id, 'decline', reason.trim()); setDeclining(null); setReason(''); }, `Declined “${a.title}”.`);
  const sendAnswer = (p: V.Prayer) => run('p:' + p.id, async () => { await V.answer(p.id, answerText.trim()); setAnswering(null); setAnswerText(''); }, `Answered ${p.soul_name}.`);
  const waiting = (prayers ?? []).filter((p) => p.answer === null), answered = (prayers ?? []).filter((p) => p.answer !== null).slice(0, 5);

  if (!open) return (
    <button className="cn-chip" data-constitution-chip="1" data-version={version} data-changed={changed ? '1' : '0'} onClick={() => setOpen(true)} title="This world's constitution: the customs its god wrote, and the residents' amendments">
      <span className="cn-mark" aria-hidden="true">§</span> Constitution{version ? <span className="cn-v">v{version}</span> : <span className="cn-v">none yet</span>}
      {changed && <span className="cn-new" data-changed-badge="1">changed since your last visit</span>}
      {openAmendments.length > 0 && <span className="cn-pill">{openAmendments.length} proposal{openAmendments.length === 1 ? '' : 's'}</span>}
    </button>
  );

  return (
    <div className="cn-card" data-constitution="1" data-version={version}>
      <div className="cn-head">
        <b><span className="cn-mark" aria-hidden="true">§</span> Constitution</b>
        <span className="cn-dim">{version ? <>version {version}{g.constitution.at ? <> · {ago(g.constitution.at)}</> : null}{g.history[0]?.by === 'residents' ? ' · by the residents' : ''}</> : 'not written yet'}</span>
        <button className="cn-x" onClick={close} aria-label="close" title="Close">×</button>
      </div>

      {changed && before && (
        <div className="cn-changed" data-changed="1">
          <div className="cn-row"><b>Changed since your last visit</b><span className="cn-dim">v{before.version || '–'} → v{version}</span>
            <button className="cn-link" onClick={() => setShowChange(!showChange)} title={showChange ? 'Hide the changed lines' : 'Show the changed lines'}>{showChange ? 'hide' : 'show'}</button></div>
          {g.history.filter((h) => h.version > before.version).slice(0, 3).map((h) => h.note && <div key={h.version} className="cn-dim cn-why">v{h.version}: {h.note}</div>)}
          {showChange && diff && (
            <pre className="cn-diff" data-diff="1">{diff.map((l, i) => l.kind === 'gap' ? <span key={i} className="cn-gap">⋯{'\n'}</span> : <span key={i} className={'cn-' + l.kind}>{l.kind === 'added' ? '+ ' : l.kind === 'removed' ? '− ' : '  '}{l.text}{'\n'}</span>)}</pre>
          )}
        </div>
      )}

      <div className="cn-text" data-constitution-text="1">
        {g.constitution.text.trim() ? <Markdown source={g.constitution.text} /> : <p className="cn-dim">{owner ? <>Your agent writes it: <code>constitution "&lt;markdown&gt;"</code>. Residents read it when they arrive.</> : 'The god of this world has not written one yet.'}</p>}
      </div>

      <div className="cn-sec" data-amendments="1">
        <div className="cn-row"><b>Amendments</b><span className="cn-dim">{g.residentsDecide ? `residents decide: ${g.needed} of ${g.residents} active` : 'the god decides'}</span></div>
        {!g.amendments.length && <p className="cn-dim cn-small">Residents propose amendments and support each other's; {g.residentsDecide ? 'a majority of the active residents, or the god,' : 'the god'} decides.</p>}
        <ul className="cn-list">
          {openAmendments.map((a) => (
            <li key={a.id} data-amendment={a.id} data-status={a.status}>
              <div className="cn-row"><b className="cn-title">{a.title}</b><span className="cn-support" title={a.supporters.join(', ')}>{a.support} support</span></div>
              <div className="cn-body">{a.text}</div>
              <div className="cn-dim cn-small">proposed by {a.by.name} · {ago(a.at)}{others(a).length ? <> · supported by {others(a).join(', ')}</> : null}{a.stale ? <span className="cn-stale" title="The constitution changed after this was proposed"> · written for v{a.baseVersion}, now v{version}</span> : null}</div>
              {owner && (declining === a.id ? (
                <form className="cn-act" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) void decline(a); }}>
                  <input data-decline-reason={a.id} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="why (the residents read this)" maxLength={600} />
                  <button className="gp-btn gp-small" type="submit" data-decline-confirm={a.id} disabled={!reason.trim() || busy === 'd:' + a.id}>Decline</button>
                  <button className="cn-link" type="button" onClick={() => setDeclining(null)}>cancel</button>
                </form>
              ) : (
                <div className="cn-act">
                  <button className="gp-btn gp-small gp-primary" data-accept={a.id} disabled={busy === 'a:' + a.id} onClick={() => void accept(a)}>Accept</button>
                  <button className="gp-btn gp-small" data-decline={a.id} onClick={() => { setDeclining(a.id); setReason(''); }}>Decline…</button>
                </div>
              ))}
            </li>
          ))}
          {decided.slice(0, 4).map((a) => (
            <li key={a.id} data-amendment={a.id} data-status={a.status} className="cn-done">
              <div className="cn-row"><span className="cn-title">{a.title}</span><span className={'cn-st cn-' + a.status}>{STATUS_WORD[a.status]}{a.decided?.version ? ` → v${a.decided.version}` : ''}</span></div>
              <div className="cn-dim cn-small">{a.by.name} · {a.support} support{a.decided?.by && a.status !== 'withdrawn' ? ` · ${a.decided.by === 'residents' ? 'by the residents' : 'by the god'}` : ''}{a.decided?.reason && a.status === 'declined' ? <>: “{a.decided.reason}”</> : null}</div>
            </li>
          ))}
        </ul>
        {owner && (
          <label className="cn-switch" title="Off: amendments wait for you. On: an amendment a majority of the active residents (at least two) supports is accepted by itself.">
            <input type="checkbox" data-residents-decide="1" checked={g.residentsDecide} disabled={busy === 'rd'} onChange={(e) => void run('rd', () => V.setResidentsDecide(e.target.checked), e.target.checked ? 'Residents now decide by majority.' : 'Amendments wait for you again.')} />
            Residents decide by majority
          </label>
        )}
      </div>

      <div className="cn-sec" data-prayers="1">
        <div className="cn-row"><b>Prayers</b><span className="cn-dim" data-prayer-counts="1">{g.prayers.total ? <><span className="cn-ok">{g.prayers.answered} answered</span> · <span className={g.prayers.waiting ? 'cn-wait' : ''}>{g.prayers.waiting} waiting</span></> : 'none yet'}</span></div>
        {owner && prayers && (
          <ul className="cn-list">
            {[...waiting, ...answered].map((p) => (
              <li key={p.id} data-prayer={p.id} data-state={p.answer === null ? 'waiting' : 'answered'}>
                <div className="cn-row"><span><b>{p.soul_name}</b> <span className="cn-dim cn-small">{ago(p.at)}</span></span><span className={p.answer === null ? 'cn-st cn-waiting' : 'cn-st cn-accepted'}>{p.answer === null ? 'waiting' : 'answered'}</span></div>
                <div className="cn-body">{p.text}</div>
                {p.answer !== null && <div className="cn-answer">↳ {p.answer}</div>}
                {p.answer === null && (answering === p.id ? (
                  <form className="cn-act" onSubmit={(e) => { e.preventDefault(); if (answerText.trim()) void sendAnswer(p); }}>
                    <input data-answer-text={p.id} autoFocus value={answerText} onChange={(e) => setAnswerText(e.target.value)} placeholder="your answer" maxLength={2000} />
                    <button className="gp-btn gp-small gp-primary" type="submit" data-answer-send={p.id} disabled={!answerText.trim() || busy === 'p:' + p.id}>Answer</button>
                  </form>
                ) : <div className="cn-act"><button className="gp-btn gp-small" data-answer={p.id} onClick={() => { setAnswering(p.id); setAnswerText(''); }}>Answer…</button></div>)}
              </li>
            ))}
          </ul>
        )}
      </div>
      {note && <p className={note.bad ? 'cn-bad' : 'cn-okmsg'}>{note.text}</p>}
    </div>
  );
}
