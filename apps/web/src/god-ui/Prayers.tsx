// G5 (Gene 2026-10-20b): prayers are like notifications. Above the God Mode log, the prayers still waiting for an answer,
// each with Answer; nothing at all when none are waiting. The same calls the god's agent makes (`prayers`, `answer`).
import { useCallback, useEffect, useState } from 'react';
import * as V from './governance-api.ts';
import { ago } from './GodModal.tsx';

export function PrayersWaiting() {
  const [prayers, setPrayers] = useState<V.Prayer[] | null>(null);
  const [answering, setAnswering] = useState<string | null>(null);
  const [text, setText] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const load = useCallback(() => V.prayers().then(setPrayers).catch(() => {}), []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 10_000); return () => clearInterval(t); }, [load]);
  const waiting = (prayers ?? []).filter((p) => p.answer === null);
  if (!waiting.length) return null;
  const send = async (p: V.Prayer) => {
    if (!text.trim() || busy) return;
    setBusy(true); setError('');
    try { await V.answer(p.id, text.trim()); setAnswering(null); setText(''); await load(); }
    catch (e) { setError((e as Error).message || 'The answer did not reach the world. Try again.'); }
    finally { setBusy(false); }
  };
  return <section className="gm-prayers" data-prayers={waiting.length} aria-label="Prayers waiting for an answer">
    <h3 className="gm-h">{waiting.length === 1 ? '1 prayer' : `${waiting.length} prayers`} waiting</h3>
    <ul>
      {waiting.map((p) => <li key={p.id} data-prayer={p.id}>
        <p className="gm-pray-text"><b>{p.soul_name}</b> {p.text}</p>
        {answering === p.id
          ? <form className="gm-answer" onSubmit={(e) => { e.preventDefault(); void send(p); }}>
            <input autoFocus value={text} maxLength={2000} placeholder={`Your answer to ${p.soul_name}`} aria-label={`Your answer to ${p.soul_name}`} data-answer-text={p.id} onChange={(e) => setText(e.target.value)} />
            <button type="submit" className="gm-small gm-small-primary" disabled={!text.trim() || busy} data-answer-send={p.id}>{busy ? 'Sending…' : 'Answer'}</button>
            <button type="button" className="gm-textbtn" onClick={() => { setAnswering(null); setText(''); }}>Cancel</button>
          </form>
          : <div className="gm-pray-meta"><span>{ago(p.at)}</span><button type="button" className="gm-textbtn" data-answer={p.id} onClick={() => { setAnswering(p.id); setText(''); setError(''); }}>Answer</button></div>}
      </li>)}
    </ul>
    {error && <p className="gm-error" role="alert">{error}</p>}
  </section>;
}
