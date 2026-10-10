// The homepage when the page is served by the world launcher
// (tools/world-launcher): the worlds on this computer, and a New world dialog
// that names a world, picks its template, starts it and opens it.
import { useEffect, useRef, useState } from 'react';
import './launcher-home.css';

export type LauncherTemplate = { id: string; name: string; description: string; batches: number; ops?: number };
export type LauncherWorldCard = { slug: string; name: string; basePath: string; url: string; template: string; templateName: string; createdAt: number; god: boolean; entities: number | null; seq: number | null; status: string; restarts: number };
export type LauncherList = { contract: 'local-worlds/1'; launcher: string; worlds: LauncherWorldCard[]; templates: LauncherTemplate[] };

const ago = (t: number) => { const s = Math.max(0, (Date.now() - t) / 1000); if (s < 90) return 'just now'; if (s < 3600) return `${Math.round(s / 60)} minutes ago`; if (s < 86400 * 2) { const h = Math.round(s / 3600); return `${h} hour${h === 1 ? '' : 's'} ago`; } return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
const STATUS: Record<string, string> = { running: 'awake', starting: 'waking…', restarting: 'restarting…', stopped: 'asleep', failed: 'could not start' };

export function LauncherHome({ initial }: { initial: LauncherList }) {
  const [list, setList] = useState(initial);
  const [dialog, setDialog] = useState(() => new URLSearchParams(location.search).has('new'));
  useEffect(() => {
    const t = setInterval(() => { void fetch('/__sim/worlds.json').then((r) => (r.ok ? r.json() : null)).then((d) => { if (d?.launcher) setList(d); }).catch(() => {}); }, 6000);
    return () => clearInterval(t);
  }, []);
  return (
    <main className="world-list lh">
      <div className="lh-top">
        <div>
          <h1>Sim</h1>
          <p>Worlds on this computer. Each one is built by its god's agent and keeps running while you are away.</p>
        </div>
        <button className="lh-new" data-new-world="1" onClick={() => setDialog(true)}>New world</button>
      </div>
      {list.worlds.length === 0 && (
        <div className="lh-empty">
          <p>No worlds yet.</p>
          <p className="dim">Make one: give it a name, pick where it starts, then claim it and pair your agent. About a minute.</p>
          <button className="lh-new" onClick={() => setDialog(true)}>New world</button>
        </div>
      )}
      <div className="world-cards lh-cards">
        {list.worlds.map((w) => (
          <a key={w.slug} href={w.url} data-world={w.slug} className="lh-card">
            <h2>{w.name}</h2>
            <p className="lh-meta">{w.templateName} · {w.entities ?? '–'} things</p>
            <p className="lh-god">{w.god ? <span className="lh-claimed">god: claimed</span> : <span className="lh-unclaimed">god: unclaimed — sign in to claim it</span>}</p>
            <p className="lh-foot dim"><span className={`lh-dot lh-${w.status}`} />{STATUS[w.status] ?? w.status} · made {ago(w.createdAt)}<span className="lh-path">{w.basePath}</span></p>
          </a>
        ))}
      </div>
      {dialog && <NewWorldDialog templates={list.templates} onClose={() => { setDialog(false); const q = new URLSearchParams(location.search); if (q.has('new')) history.replaceState(null, '', '/'); }} />}
    </main>
  );
}

function NewWorldDialog({ templates, onClose }: { templates: LauncherTemplate[]; onClose: () => void }) {
  const [name, setName] = useState('');
  const [template, setTemplate] = useState(templates.find((t) => t.id === 'hello-hamlet')?.id ?? templates[0]?.id ?? 'empty');
  const [state, setState] = useState<{ phase: 'edit' | 'creating' | 'error'; message?: string; started?: number }>({ phase: 'edit' });
  const [now, setNow] = useState(Date.now());
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { if (state.phase !== 'creating') return; const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, [state.phase]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && state.phase !== 'creating') onClose(); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [state.phase, onClose]);
  const slugPreview = name.trim().toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28);
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { input.current?.focus(); return; }
    setState({ phase: 'creating', started: Date.now() });
    try {
      const r = await fetch('/__sim/worlds', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name.trim(), template, creator: localStorage.getItem('sim.dev') ?? undefined }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.url) throw new Error(d.message ?? `the launcher answered ${r.status}`);
      location.href = d.url;
    } catch (err) { setState({ phase: 'error', message: String((err as Error).message) }); }
  };
  const secs = state.started ? Math.round((now - state.started) / 1000) : 0;
  return (
    <div className="lh-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && state.phase !== 'creating') onClose(); }}>
      <form className="lh-dialog" role="dialog" aria-modal="true" aria-labelledby="lh-dialog-title" data-new-world-dialog="1" onSubmit={create}>
        <h2 id="lh-dialog-title">A new world</h2>
        <label className="lh-label" htmlFor="lh-name">Name</label>
        <input id="lh-name" ref={input} data-world-name="1" value={name} maxLength={60} placeholder="e.g. Willow Hollow" onChange={(e) => setName(e.target.value)} disabled={state.phase === 'creating'} autoComplete="off" />
        <p className="lh-slug dim">{slugPreview ? <>It will live at <code>/w/{/^[a-z]/.test(slugPreview) ? slugPreview : 'world-' + slugPreview}</code></> : <>&nbsp;</>}</p>
        <fieldset className="lh-templates" disabled={state.phase === 'creating'}>
          <legend className="lh-label">Starts as</legend>
          {templates.map((t) => (
            <label key={t.id} className={'lh-template' + (template === t.id ? ' on' : '')} data-template={t.id}>
              <input type="radio" name="template" value={t.id} checked={template === t.id} onChange={() => setTemplate(t.id)} />
              <span><b>{t.name}</b><span className="lh-desc">{t.description || (t.batches ? `${t.batches} building steps` : '')}</span></span>
            </label>
          ))}
        </fieldset>
        <p className="lh-after dim">Next: the world opens with a short guide. Sign in, claim it, and pair your agent with the commands it shows; the agent builds from there.</p>
        {state.phase === 'error' && <p className="bad" data-create-error="1">Could not create the world: {state.message}</p>}
        <div className="lh-actions">
          <button type="button" className="lh-cancel" onClick={onClose} disabled={state.phase === 'creating'}>Cancel</button>
          <button type="submit" className="lh-create" data-create="1" disabled={state.phase === 'creating' || !name.trim()}>{state.phase === 'creating' ? `Starting the world… ${secs}s` : 'Create world'}</button>
        </div>
        {state.phase === 'creating' && <p className="lh-wait dim">A world takes 10–30 seconds to start the first time{template !== 'empty' ? ' (the template is being built through the same validated edits your agent will use)' : ''}.</p>}
      </form>
    </div>
  );
}
