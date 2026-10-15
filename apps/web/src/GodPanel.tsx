// The god panel on an entity world (spec <eden4>/29 WP6): sign in, claim,
// the authored welcome (rendered, with copy buttons), first steps ticked live,
// pairing approvals, undo/redo and the recent edits (undo a whole group), flags
// (click to fly there), and the god's previews drawn as ghosts. Compact (380 px)
// and collapsible. Owner-only controls; visitors see the world and its name.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiPath, worldKey } from './world-path.ts';
import { Markdown } from './god-ui/markdown.tsx';
import * as G from './god-ui/god-api.ts';
import { describeEdit, steps, type Step } from './god-ui/checklist.ts';
import { flyTo } from './god-ui/camera.ts';
import { previewGhost, type GhostSummary } from './WorldPreviewGhost.ts';
import { useSession } from './auth-session.ts';
import { ApprovalCard, JoinPanel } from './god-ui/JoinPanel.tsx';
import { approvalFromHash, landingHash } from './god-ui/join-api.ts';
import './god-ui/god-panel.css';

type Tab = 'start' | 'edits' | 'flags' | 'previews' | 'souls';
const query = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
const shotMode = query.get('shot') === '1';
const PAIRED_KEY = `sim.godPaired:${worldKey}`;
const OPEN_KEY = 'sim.godPanel.open';
const ago = (t: number) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };

export function GodPanel({ flagMode, onFlagMode }: { flagMode: boolean; onFlagMode: (v: boolean) => void }) {
  const [status, setStatus] = useState<G.Status | null>(null);
  // #join (the link a god shares): open the panel on the Join section / the Souls tab
  const joinHash = landingHash === '#join';
  // #approve/<id> (the link the Soul CLI prints for its human): the approval card, panel open
  const [approvalId, setApprovalId] = useState(() => approvalFromHash(landingHash));
  const [open, setOpen] = useState<boolean>(() => joinHash || !!approvalId || localStorage.getItem(OPEN_KEY) !== '0');
  const [tab, setTab] = useState<Tab>(joinHash ? 'souls' : 'start');
  const [welcome, setWelcome] = useState<string | null>(null);
  const [edits, setEdits] = useState<G.EditRow[] | null>(null);
  const [flags, setFlags] = useState<G.FlagRef[]>([]);
  const [previews, setPreviews] = useState<G.PreviewRow[]>([]);
  const [launcher, setLauncher] = useState<Awaited<ReturnType<typeof G.launcherWorld>>>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [ghost, setGhost] = useState<GhostSummary | null>(null);
  const approvedHere = localStorage.getItem(PAIRED_KEY) === '1';   // GODUI: the bolt panel (GodBolt) approves now
  const owner = status?.you === 'owner' || status?.you === 'god';
  const seq = status?.seq;
  // who is signed in on this page (Clerk in production, a local name in dev): auth-session.ts
  const session = useSession();
  const [naming, setNaming] = useState(false);
  const [devName, setDevName] = useState('');
  const wasAuthed = useRef(false);
  useEffect(() => { if (wasAuthed.current && !session.authed) G.forgetToken(); wasAuthed.current = session.authed; }, [session.authed]);

  const refresh = useCallback(async () => { const s = await G.getStatus(); if (s) setStatus(s); }, []);
  useEffect(() => G.watchStatus(setStatus), []);
  useEffect(() => { void refresh(); }, [refresh, session.authed, session.label]);
  useEffect(() => { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); }, [open]);
  useEffect(() => { if (!owner) { setWelcome(null); return; } void G.getWelcome().then(setWelcome); }, [owner]);
  // journal, flags: whenever the world's edit counter moves
  useEffect(() => { if (seq === undefined) return; void G.flags().then(setFlags).catch(() => {}); if (owner) void G.edits(30).then(setEdits).catch(() => setEdits(null)); }, [seq, owner]);
  // what the launcher saw (looks, an agent's calls) and the god's previews: a slower poll
  useEffect(() => {
    const go = () => { void G.launcherWorld().then(setLauncher); if (owner) void G.previews().then(setPreviews); };
    go(); const t = setInterval(go, 8000); return () => clearInterval(t);
  }, [owner]);

  // ?preview=<id>: draw it as soon as the world's scene exists, then fly there
  const showPreview = useCallback(async (id: string, fly = true) => {
    let g = previewGhost(apiPath);
    for (let i = 0; !g && i < 100; i++) { await new Promise((r) => setTimeout(r, 300)); g = previewGhost(apiPath); }
    if (!g) { setNote({ text: 'The world view is not ready for a preview.', bad: true }); return; }
    const s = await g.show(id); previewGhost(apiPath); setGhost(s);
    if (fly && s.ok && s.bounds) { const [x0, z0, x1, z1] = s.bounds; const span = Math.max(20, x1 - x0, z1 - z0); flyTo((x0 + x1) / 2, 0, (z0 + z1) / 2, { distance: span * 1.6, aside: 0.3 }); }
  }, []);
  const hideGhost = () => { previewGhost(apiPath)?.clear(); setGhost(null); const q = new URLSearchParams(location.search); if (q.has('preview')) { q.delete('preview'); history.replaceState(null, '', `${location.pathname}${q.size ? '?' + q : ''}${location.hash}`); } };
  useEffect(() => { const id = query.get('preview'); if (id) void showPreview(id); }, [showPreview]);

  const run = async (key: string, fn: () => Promise<unknown>, ok?: (r: unknown) => string | null) => {
    setBusy(key); setNote(null);
    try { const r = await fn(); const t = ok?.(r); if (t) setNote({ text: t }); await refresh(); }
    catch (e) { setNote({ text: String((e as Error).message), bad: true }); }
    finally { setBusy(null); }
  };
  // Sign in as the page does: Clerk's own sign-in in production; locally, a name typed here (no window.prompt:
  // embedded browsers drop it).
  const signIn = () => {
    if (session.signInUrl) { location.assign(session.signInUrl); return; }
    if (session.mode === 'dev') { setDevName(localStorage.getItem('sim.dev') ?? ''); setNaming(true); return; }
    if (session.mode === 'none') { setNote({ text: 'Sign-in is not configured on this server.', bad: true }); return; }
    session.login();
  };
  const devSignIn = (e: React.FormEvent) => {
    e.preventDefault();
    const n = devName.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36);
    if (!n) return; localStorage.setItem('sim.dev', n); G.forgetToken(); location.reload();
  };
  const signInForm = naming && (
    <form className="gp-row" data-signin-form="1" onSubmit={devSignIn}>
      <input data-signin-name="1" autoFocus value={devName} onChange={(e) => setDevName(e.target.value)} placeholder="a local name, e.g. gene" maxLength={36} aria-label="local name" />
      <button className="gp-btn gp-primary" data-signin-go="1" type="submit">Sign in</button>
    </form>
  );
  const signInButton = session.mode === 'clerk' && !session.ready ? <p className="gp-dim">Signing in…</p>
    : session.mode === 'clerk' && session.label && !session.authed ? <p className="gp-dim">Signed in as <b>{session.label}</b>; connecting your account to this world…</p>
    : !naming && <button className="gp-btn gp-primary" data-signin="1" onClick={signIn}>Sign in</button>;
  const who = (session.label ?? 'you').replace(/^dev:/, '');
  const claim = () => run('claim', G.claim, () => 'This world is yours.');
  const undoRedo = (which: 'undo' | 'redo') => run(which, () => (which === 'undo' ? G.undo() : G.redo()), (r) => { const x = r as G.UndoResult; return x.accepted ? `${which === 'undo' ? 'Undid' : 'Redid'} edit ${x.reverted}.` : (x.failures?.[0]?.detail ?? `nothing to ${which}`); });
  const undoGroup = (group: string) => run('g:' + group, () => G.undoGroup(group), (r) => { const x = r as G.UndoResult; return x.accepted ? `Undid group “${group}” (${Array.isArray(x.reverted) ? x.reverted.length : 1} edits).` : (x.failures?.[0]?.detail ?? 'nothing undone'); });

  const signedIn = session.authed && !!status && status.you !== 'anonymous';
  const checklist: Step[] = useMemo(() => steps({ status, signedIn, edits, flags: flags.length, approvedHere, agentSeen: !!launcher?.seen.agentSeenAt, looks: launcher?.seen.looks ?? 0 }), [status, signedIn, edits, flags.length, approvedHere, launcher]);
  const done = checklist.filter((s) => s.done).length;
  const paired = !!checklist.find((s) => s.id === 'pair')?.done;
  const recent = useMemo(() => (edits ?? []).slice().sort((a, b) => b.seq - a.seq).slice(0, 8), [edits]);
  const canUndo = (edits ?? []).some((e) => !e.undone && e.kind !== 'undo' && e.ops.length > 0);
  // one "undo group" per group, on its newest row that undo would still revert
  const groupRow = useMemo(() => { const m = new Map<string, number>(); for (const e of (edits ?? []).slice().sort((a, b) => b.seq - a.seq)) if (e.grp && !e.undone && e.kind !== 'undo' && !m.has(e.grp)) m.set(e.grp, e.seq); return m; }, [edits]);
  const firstTab = useRef(false);
  useEffect(() => { if (!firstTab.current && owner && edits && done === checklist.length) { firstTab.current = true; if (!joinHash) setTab('edits'); } }, [owner, edits, done, checklist.length, joinHash]);

  if (shotMode) return null;
  const ghostBar = ghost && (
    <div className="gp-ghostbar" data-preview-banner={ghost.id} data-preview-ok={ghost.ok ? '1' : '0'}>
      <b>Preview</b> <code>{ghost.id}</code>
      {ghost.ok
        ? <><span className="gp-add">+{ghost.added} new</span><span className="gp-chg">{ghost.changed} changed</span><span className="gp-rem">{ghost.removed ? '−' : ''}{ghost.removed} removed</span>{ghost.tiles ? <span>{ghost.tiles} ground tile{ghost.tiles === 1 ? '' : 's'}</span> : null}<i>not built yet</i></>
        : <span className="gp-ghostmsg">{ghost.message}{ghost.failures?.[0] ? <> <code>{ghost.failures[0].code}</code> {ghost.failures[0].detail}</> : null}</span>}
      {ghost.ok && ghost.bounds && <button className="gp-btn" onClick={() => { const [x0, z0, x1, z1] = ghost.bounds!; flyTo((x0 + x1) / 2, 0, (z0 + z1) / 2, { distance: Math.max(20, x1 - x0, z1 - z0) * 1.6, aside: open ? 0.3 : 0 }); }}>fly there</button>}
      <button className="gp-btn" onClick={hideGhost}>hide</button>
    </div>
  );
  if (!status) return ghostBar || null;
  const name = launcher?.world.name ?? status.name;
  const isNew = query.has('new');

  // A visitor on a world that has a god sees no card, as on the old worlds (e8): the header's New Soul is the way to
  // join. Only the approval link their agent printed (#approve/<id>) opens one, to approve it.
  if (status.hasOwner && !owner) return <>{ghostBar}{approvalId && (
    <div data-god-panel="1" className="gp-card">
      <ApprovalCard id={approvalId} signedIn={signedIn} onDone={() => setApprovalId(null)} />
      {!signedIn && <div className="gp-block">{signInButton}{signInForm}</div>}
    </div>
  )}</>;
  if (!open) return <>{ghostBar}<button data-god-panel-toggle="1" className="gp-card gp-collapsed" onClick={() => setOpen(true)}>✦ {owner ? <>God mode · {done}/{checklist.length}{status.pending.length ? <span className="gp-badge">{status.pending.length}</span> : null}</> : 'Claim this world'}</button></>;
  return (
    <>
      {ghostBar}
      <div data-god-panel="1" className="gp-card">
        <div className="gp-head">
          <b className="gp-title" title={status.worldId}>✦ {name}</b>
          <span className="gp-dim">{status.entities} things · edit {status.seq}</span>
          <button className="gp-icon" onClick={() => setOpen(false)} title="Collapse the panel" aria-label="collapse">–</button>
        </div>
        {launcher?.world.templateName && <div className="gp-dim gp-sub">from <i>{launcher.world.templateName}</i>{launcher.world.createdAt ? <> · made {ago(launcher.world.createdAt)}</> : null}</div>}

        {approvalId && <ApprovalCard id={approvalId} signedIn={signedIn} onDone={() => setApprovalId(null)} />}
        {!status.hasOwner && !owner && (
          <div className="gp-block gp-next">
            {isNew && status.you !== 'claimant' && <p className="gp-hello">Your new world is ready. Whoever claims it first becomes its god, so sign in and claim it now.</p>}
            {status.you === 'claimant'
              ? <><p>Signed in as <b>{who}</b>. Nobody owns this world yet: claim it, and your agent builds it.</p>
                <button className="gp-btn gp-primary" data-claim="1" disabled={busy === 'claim'} onClick={claim}>{busy === 'claim' ? 'Claiming…' : 'Become its god'}</button></>
              : <>{!isNew && <p>This world has no god yet. Sign in to claim it; your agent will build it.</p>}{signInButton}{signInForm}</>}
          </div>
        )}
        {owner && (
          <>
            {paired && <div className="gp-tools">
              <button className="gp-btn" data-undo="1" disabled={!canUndo || busy === 'undo'} onClick={() => undoRedo('undo')} title="Undo the newest edit">↶ Undo</button>
              <button className="gp-btn" data-redo="1" disabled={busy === 'redo'} onClick={() => undoRedo('redo')} title="Redo the newest undone edit">↷ Redo</button>
              <button className={'gp-btn' + (flagMode ? ' gp-armed' : '')} data-flag-button="1" aria-pressed={flagMode} onClick={() => onFlagMode(!flagMode)} title="Drop a labelled flag: a reference point your agent can build around (or Alt+click the ground)">⚑ {flagMode ? 'click the ground…' : 'Drop a flag'}</button>
            </div>}
            <div className="gp-tabs" role="tablist">
              {(['start', 'edits', 'flags', 'previews', 'souls'] as Tab[]).map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} data-tab={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                  {t === 'start' ? <>Start <span className="gp-count">{done}/{checklist.length}</span></> : t === 'edits' ? <>Edits</> : t === 'flags' ? <>Flags <span className="gp-count">{flags.length}</span></> : t === 'souls' ? <>Souls</> : <>Previews{previews.length ? <span className="gp-count">{previews.length}</span> : null}</>}
                </button>
              ))}
            </div>

            {tab === 'start' && (
              <div className="gp-pane">
                <ol className="gp-steps" data-checklist="1">
                  {checklist.map((s) => <li key={s.id} data-step={s.id} data-done={s.done ? '1' : '0'} className={s.done ? 'done' : ''}><span className="gp-tick" aria-hidden="true">{s.done ? '✓' : ''}</span><span><b>{s.label}</b>{!s.done && <span className="gp-hint">{s.hint}</span>}</span></li>)}
                </ol>
                <details className="gp-more"><summary>More about god mode</summary>{welcome ? <Markdown source={welcome} skipFirstHeading /> : <p className="gp-dim">Loading…</p>}</details>
                <div className="gp-files">
                  <a className="gp-btn" href={apiPath('/SKILL.md')} target="_blank" rel="noreferrer" title="This world's one skill: God mode and Soul mode">SKILL.md</a>
                  <a className="gp-btn" href={apiPath('/god/eden-god.mjs')} download>eden-god.mjs</a>
                </div>
              </div>
            )}

            {tab === 'souls' && <div className="gp-pane" data-souls-tab="1"><JoinPanel signedIn={signedIn} worldName={name} base={status.base} /></div>}

            {tab === 'edits' && (
              <div className="gp-pane" data-edits="1">
                {!recent.length && <p className="gp-dim">No edits yet. Everything your agent changes appears here, newest first, and can be undone.</p>}
                <ul className="gp-list">
                  {recent.map((e) => (
                    <li key={e.seq} data-edit={e.seq} className={'gp-edit' + (e.undone ? ' undone' : '')}>
                      <span className="gp-seq">#{e.seq}</span>
                      <span className="gp-what" title={e.ops.map((o) => o.op + (o.name ? ' ' + o.name : '')).join(', ')}>{describeEdit(e)}</span>
                      <span className="gp-meta">
                        {e.grp && <span className="gp-group" title={`group ${e.grp}`}>{e.grp}</span>}
                        {e.kind === 'edit' && <span className="gp-dim">{e.ops.length} op{e.ops.length === 1 ? '' : 's'}</span>}
                        {e.undone ? <span className="gp-dim">undone</span> : null}
                        <span className="gp-dim">{ago(e.at)}</span>
                        {e.grp && e.grp !== 'genesis' && groupRow.get(e.grp) === e.seq && <button className="gp-mini" data-undo-group={e.grp} disabled={busy === 'g:' + e.grp} onClick={() => undoGroup(e.grp!)} title={`Undo every edit in group ${e.grp}`}>undo group</button>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {tab === 'flags' && (
              <div className="gp-pane" data-flags="1">
                {!flags.length && <p className="gp-dim">No flags yet. Drop one and your agent can say <code>place cottage --at flag:camp</code>.</p>}
                <ul className="gp-list">
                  {flags.map((f) => (
                    <li key={f.id}>
                      <button className="gp-link" data-fly={f.name} onClick={() => flyTo(f.p[0], f.p[1], f.p[2], { distance: 35, aside: 0.3 })} title="Fly the camera here">⚑ {f.label}</button>
                      <code className="gp-dim">flag:{f.name}</code>
                      <span className="gp-dim gp-when">{Math.round(f.p[0])}, {Math.round(f.p[2])}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {tab === 'previews' && (
              <div className="gp-pane" data-previews="1">
                {!previews.length && <p className="gp-dim">When your agent runs <code>preview</code> (a dry run), its proposal appears here; show it as a ghost before it is built.</p>}
                <ul className="gp-list">
                  {previews.map((p) => (
                    <li key={p.id}>
                      <code>{p.id}</code>
                      <span className="gp-what">{p.accepted ? summaryText(p.summary) : <span className="gp-bad">would be refused</span>}</span>
                      <span className="gp-dim gp-when">{ago(p.at)}</span>
                      {p.accepted && <button className="gp-btn gp-small" data-show-preview={p.id} onClick={() => void showPreview(p.id)}>{ghost?.id === p.id ? 'shown' : 'show'}</button>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        {note && <p className={note.bad ? 'gp-bad' : 'gp-ok'}>{note.text}</p>}
      </div>
    </>
  );
}

function summaryText(s: Record<string, unknown> | null) {
  if (!s) return '';
  const n = (k: string) => (typeof s[k] === 'number' ? (s[k] as number) : 0);
  const parts = [n('upserts') && `${n('upserts')} things`, n('removes') && `−${n('removes')}`, n('tiles') && `${n('tiles')} tiles`].filter(Boolean);
  return parts.join(' · ') || 'no change';
}
