// The god panel on an entity world (spec <eden4>/29 WP6): sign in, claim,
// the authored welcome (rendered, with copy buttons), first steps ticked live,
// pairing approvals, undo/redo and the recent edits (undo a whole group), flags
// (click to fly there), and the god's previews drawn as ghosts.
// G4 (Gene 2026-10-20): for the world's god all of it lives in the one God modal (GodModal.tsx) under the God button,
// with the agent's command log, weather, the world's housekeeping and the Constitution; the floating "God mode x/6"
// card is gone. Everyone else gets the same modal read-only (Constitution, how to become a god). The claim card of a
// godless world, the approval link (#approve/<id>) and the offer links keep their small floating card.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiPath, worldKey } from './world-path.ts';
import { BASE } from './base-path.ts';
import { Markdown } from './god-ui/markdown.tsx';
import * as G from './god-ui/god-api.ts';
import { describeEdit, steps, type Step } from './god-ui/checklist.ts';
import { flyTo } from './god-ui/camera.ts';
import { SMALL_SCREEN } from './HudMore.tsx';
import { previewGhost, takePreviewKey, type GhostSummary } from './WorldPreviewGhost.ts';
import { useSession } from './auth-session.ts';
import { ApprovalCard, JoinPanel } from './god-ui/JoinPanel.tsx';
import { OwnerGod, VisitorGod, ago as since, type NavItem } from './god-ui/GodModal.tsx';
import { closeGod, openGod, useGod, watchInbox } from './god-ui/god-store.ts';
import { ConstitutionBody } from './god-ui/Constitution.tsx';
import { WorldOwnerOps } from './god-ui/WorldOwnerOps.tsx';
import { approvalFromHash, landingHash } from './god-ui/join-api.ts';
import { OfferCard, offerFromHash } from './god-ui/OfferCard.tsx';
import './god-ui/god-panel.css';

const query = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
const shotMode = query.get('shot') === '1';
// Read at module load: Shell rewrites the landing fragment to its tab (#watch) before the scene is ready.
// Taking it also strips it from the URL, so the view key does not stay in browser history.
const landingPreviewKey = typeof location === 'undefined' ? null : takePreviewKey({ location, history });
const PAIRED_KEY = `sim.godPaired:${worldKey}`;
const PHONE = () => typeof matchMedia === 'function' && matchMedia(SMALL_SCREEN).matches;  // P6: landscape phones (coarse pointer) too
// Phones keep their own remembered choice and start compact: the open panel covers most of a small screen.
const openKey = () => 'sim.godPanel.open' + (PHONE() ? '.phone' : '');
const INTRO_KEY = `sim.godIntro:${worldKey}`;   // G4: God opens by itself once, for a new owner whose agent is not connected
type Sim = { controls?: { target: { x: number; z: number } } };
/** Where the camera looks (the orbit target), for a strike near the view's centre. */
const viewCentre = (): [number, number] | null => { const t = (window as unknown as { __simEntity?: Sim }).__simEntity?.controls?.target; return t ? [Math.round(t.x * 10) / 10, Math.round(t.z * 10) / 10] : null; };
const ago = (t: number) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };

export function GodPanel({ flagMode, onFlagMode, entitiesAt }: { flagMode: boolean; onFlagMode: (v: boolean) => void; entitiesAt?: (seq: number) => Iterable<G.FlagSource> | null }) {
  const [status, setStatus] = useState<G.Status | null>(null);
  // #join (the link a god shares): open the panel on the Join section / the Souls tab
  const joinHash = landingHash === '#join';
  // #approve/<id> (the link the Soul CLI prints for its human): the approval card, panel open
  const [approvalId, setApprovalId] = useState(() => approvalFromHash(landingHash));
  // #worldoffer/<code>, #cobuildpair/<code> (the launcher's co-builder and handoff links): that card first
  const [offerLink, setOfferLink] = useState(() => offerFromHash(landingHash));
  const [open, setOpen] = useState<boolean>(() => joinHash || !!approvalId || (PHONE() ? localStorage.getItem(openKey()) === '1' : localStorage.getItem(openKey()) !== '0'));
  const god = useGod();
  const hashCode = landingHash.startsWith('#godpair/') ? decodeURIComponent(landingHash.slice('#godpair/'.length)) : null;
  const [welcome, setWelcome] = useState<string | null>(null);
  const [edits, setEdits] = useState<G.EditRow[] | null>(null);
  const [flags, setFlags] = useState<G.FlagRef[]>([]);
  const [previews, setPreviews] = useState<G.PreviewRow[]>([]);
  const [launcher, setLauncher] = useState<Awaited<ReturnType<typeof G.launcherWorld>>>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [ghost, setGhost] = useState<GhostSummary | null>(null);
  const approvedHere = localStorage.getItem(PAIRED_KEY) === '1';   // the God modal's agent section approves pairings
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
  useEffect(() => { localStorage.setItem(openKey(), open ? '1' : '0'); }, [open]);
  useEffect(() => { if (!owner) { setWelcome(null); return; } void G.getWelcome().then(setWelcome); }, [owner]);
  // journal, flags: whenever the world's edit counter moves
  useEffect(() => {
    if (seq === undefined) return;
    if (owner) void G.edits(30).then(setEdits).catch(() => setEdits(null));
    // lane L3h: the entity layer already holds the public snapshot plus its diffs; read the flags there once it has reached
    // this edit (a diff can land just after the status), and download the whole snapshot only when it never does
    let live = true, tries = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      if (!live) return;
      const here = entitiesAt?.(seq);
      if (here) { setFlags(G.flagRefsOf(here)); return; }
      if (entitiesAt && ++tries < 40) { timer = setTimeout(read, 250); return; }
      void G.flags().then((f) => { if (live) setFlags(f); }).catch(() => {});
    };
    read();
    return () => { live = false; clearTimeout(timer); };
  }, [seq, owner, entitiesAt]);
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
    const viewKey = query.get('preview') === id ? landingPreviewKey : null;
    // Never mint here: minting claims an unowned world, and a visitor opening a link must not do that.
    const token = G.storedToken();
    const s = await g.show(id, { token, viewKey }); previewGhost(apiPath); setGhost(s);
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
  const recent = useMemo(() => (edits ?? []).slice().sort((a, b) => b.seq - a.seq).slice(0, 8), [edits]);
  const canUndo = (edits ?? []).some((e) => !e.undone && e.kind !== 'undo' && e.ops.length > 0);
  // one "undo group" per group, on its newest row that undo would still revert
  const groupRow = useMemo(() => { const m = new Map<string, number>(); for (const e of (edits ?? []).slice().sort((a, b) => b.seq - a.seq)) if (e.grp && !e.undone && e.kind !== 'undo' && !m.has(e.grp)) m.set(e.grp, e.seq); return m; }, [edits]);
  // a new owner whose agent is not connected yet: God opens by itself once (the agent section shows the line to paste);
  // #join opens it on Souls
  useEffect(() => {
    if (!owner || !status || shotMode) return;
    if (joinHash) { openGod('souls'); return; }
    if ((status.agents ?? 0) > 0) return;
    try { if (localStorage.getItem(INTRO_KEY) === '1') return; localStorage.setItem(INTRO_KEY, '1'); } catch { return; }
    openGod('agent');
  }, [owner, status?.agents, joinHash]);   // eslint-disable-line react-hooks/exhaustive-deps
  // the owner's agent inbox: the God button watches it; the modal keeps it fresh while open
  useEffect(() => { if (owner && god.open) return watchInbox(); }, [owner, god.open]);

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
  if (offerLink) return <>{ghostBar}<div data-god-panel="1" className="gp-card">
    <OfferCard link={offerLink} signedIn={signedIn} onDone={() => { setOfferLink(null); history.replaceState(null, '', location.pathname + location.search); void refresh(); }} />
    {!signedIn && <div className="gp-block">{signInButton}{signInForm}</div>}
  </div></>;
  if (!status) return ghostBar || null;
  const name = launcher?.world.name ?? status.name;
  const isNew = query.has('new');

  // The claim card of a godless world (anyone not its owner): a small floating card, as before.
  const claimCard = !status.hasOwner && !owner && launcher?.world.claimable !== false && (open
    ? <div data-god-panel="1" className="gp-card">
      <div className="gp-head">
        <b className="gp-title" title={status.worldId}>✦ {name}</b>
        <span className="gp-dim">{status.entities} things</span>
        <button className="gp-icon" onClick={() => setOpen(false)} title="Collapse the panel" aria-label="collapse">–</button>
      </div>
      {launcher?.world.templateName && <div className="gp-dim gp-sub">from <i>{launcher.world.templateName}</i>{launcher.world.createdAt ? <> · made {ago(launcher.world.createdAt)}</> : null}</div>}
      {approvalId && <ApprovalCard id={approvalId} signedIn={signedIn} onDone={() => setApprovalId(null)} />}
      <div className="gp-block gp-next">
        {isNew && status.you !== 'claimant' && <p className="gp-hello">Your new world is ready. Whoever claims it first becomes its god, so sign in and claim it now.</p>}
        {status.you === 'claimant'
          ? <><p>Signed in as <b>{who}</b>. Nobody owns this world yet: claim it, and your agent builds it.</p>
            <button className="gp-btn gp-primary" data-claim="1" disabled={busy === 'claim'} onClick={claim}>{busy === 'claim' ? 'Claiming…' : 'Become its god'}</button></>
          : <>{!isNew && <p>This world has no god yet. Sign in to claim it; your agent will build it.</p>}{signInButton}{signInForm}</>}
      </div>
      {note && <p className={note.bad ? 'gp-bad' : 'gp-ok'}>{note.text}</p>}
    </div>
    : <button data-god-panel-toggle="1" className="gp-card gp-collapsed" onClick={() => setOpen(true)}>✦ Claim this world</button>);

  if (!owner) {
    // Visitors (and a godless world's claimant): only the approval link their agent printed (#approve/<id>) opens a card
    // on a world with a god; the God button opens the read-only God.
    const become = <>
      <h3>Become a god</h3>
      {!status.hasOwner && launcher?.world.claimable !== false
        ? <p>Nobody is this world's god yet. Whoever claims it first becomes its god, and their coding agent builds it.</p>
        : <p>Each world has one god: the person whose coding agent (Claude Code, Codex, Cursor…) builds it. To be one, make a world of your own; you send its agent commands from this window and watch them happen.</p>}
      <div className="gm-actions">
        {!status.hasOwner && launcher?.world.claimable !== false
          ? (status.you === 'claimant' ? <button type="button" className="gm-primary" data-claim="1" disabled={busy === 'claim'} onClick={() => void claim()}>{busy === 'claim' ? 'Claiming…' : 'Become its god'}</button> : <>{signInButton}{signInForm}</>)
          : BASE && <a className="gm-primary" href={`${BASE}/`} data-make-world="1">Make a world</a>}
        <button type="button" className="gm-secondary" data-new-soul-from-god="1" onClick={() => { closeGod(); setTimeout(() => document.querySelector<HTMLElement>('.bring-agent-open')?.click(), 0); }}>New Soul</button>
      </div>
      <p className="gm-fine">Or live here: <b>New Soul</b> brings your agent into {name} as a resident.</p>
    </>;
    return <>{ghostBar}
      {claimCard}
      {status.hasOwner && approvalId && (
        <div data-god-panel="1" className="gp-card">
          <ApprovalCard id={approvalId} signedIn={signedIn} onDone={() => setApprovalId(null)} />
          {!signedIn && <div className="gp-block">{signInButton}{signInForm}</div>}
        </div>
      )}
      {god.open && <VisitorGod world={name} become={become}><ConstitutionBody /></VisitorGod>}
    </>;
  }

  // ---- the world's god: everything in the God modal ----
  const env = (body: unknown) => G.god('/v1/god/env', { method: 'POST', body: JSON.stringify(body) });
  const weather = (kind: 'rain' | 'lightning' | 'haze') => run(kind, async () => {
    if (kind === 'rain') return env({ weather: { kind: 'rain', intensity: 0.8 }, note: 'weather' });
    if (kind === 'haze') return env({ weather: { kind: 'fog', intensity: 0.6 }, note: 'weather' });
    await env({ weather: { kind: 'storm', intensity: 0.8 }, note: 'weather' });
    const at = viewCentre(); await G.god('/v1/god/strike', { method: 'POST', body: JSON.stringify(at ? { at } : {}) });
  }, () => (kind === 'rain' ? 'Rain.' : kind === 'haze' ? 'Haze.' : 'Lightning.'));
  const approve = (code: string) => run(code, async () => {
    await G.approve(code); try { localStorage.setItem(PAIRED_KEY, '1'); } catch { /* storage disabled */ }
    if (hashCode === code) history.replaceState(null, '', location.pathname + location.search);
  }, () => `Approved. Your agent is now this world's god.`);
  const agentsPaired = (status.agents ?? 0) > 0;
  const fly = (x: number, y: number, z: number, distance: number) => { closeGod(); flyTo(x, y, z, { distance }); };
  const nav: NavItem[] = [
    { id: 'agent', label: 'Agent', count: status.pending.length || (god.inbox?.queued ? god.inbox.queued : null), alert: status.pending.length > 0 },
    { id: 'start', label: 'Start', count: done < checklist.length ? `${done}/${checklist.length}` : null },
    { id: 'edits', label: 'Edits', count: status.seq || null },
    { id: 'flags', label: 'Flags', count: flags.length || null },
    { id: 'previews', label: 'Previews', count: previews.length || null },
    { id: 'souls', label: 'Souls' },
    { id: 'constitution', label: 'Constitution' },
    { id: 'world', label: 'Weather & world' },
  ];
  const banner = <>
    {approvalId && <div className="gm-banner"><ApprovalCard id={approvalId} signedIn={signedIn} onDone={() => setApprovalId(null)} /></div>}
    {hashCode && !status.pending.some((p) => p.code === hashCode) && <p className="gm-banner gp-bad">Pairing request <code>{hashCode}</code> is not pending (expired, or already approved).</p>}
    {status.pending.length > 0 && (
      <div className="gm-banner gp-pairs" data-pairing="1">
        <b>Your agent asks to be this world's god</b><span className="gp-dim">Check the code matches what your agent shows, then approve.</span>
        {status.pending.map((p) => (
          <div key={p.code} className="gp-row">
            <span><code className="gp-code-big">{p.code}</code> {p.agent} <span className="gp-dim">({Math.max(1, Math.round(p.expiresIn / 60))} min)</span></span>
            <button data-approve={p.code} className="gp-btn gp-primary" disabled={busy === p.code} onClick={() => approve(p.code)}>Approve</button>
          </div>
        ))}
      </div>
    )}
    {note && <p className={'gm-banner gm-note ' + (note.bad ? 'gp-bad' : 'gp-ok')} role="status">{note.text}</p>}
  </>;
  const prompt = `Read ${location.origin + apiPath('')}/SKILL.md and resume God mode for this world. Run node eden-god.mjs listen in the background and acknowledge each owner message with ack.`;
  const section = (s: string) => {
    if (s === 'agent') return !agentsPaired && <div className="gp-next gm-pair" data-next-step="pair">
      <b>Connect your agent</b><p className="gp-dim">Paste this line to Claude Code, Codex or any coding agent. It sets itself up and shows a code here: press Approve.</p>
      <Markdown source={'```paste-to-your-agent\n' + G.godPrompt(status.base) + '\n```'} />
    </div>;
    if (s === 'start') return <div data-start="1">
      <ol className="gp-steps" data-checklist="1">
        {checklist.map((c) => <li key={c.id} data-step={c.id} data-done={c.done ? '1' : '0'} className={c.done ? 'done' : ''}><span className="gp-tick" aria-hidden="true">{c.done ? '✓' : ''}</span><span><b>{c.label}</b>{!c.done && <span className="gp-hint">{c.hint}</span>}</span></li>)}
      </ol>
      <details className="gp-more"><summary>More about god mode</summary>{welcome ? <Markdown source={welcome} skipFirstHeading /> : <p className="gp-dim">Loading…</p>}</details>
      <div className="gp-files">
        <a className="gp-btn" href={apiPath('/SKILL.md')} target="_blank" rel="noreferrer" title="This world's one skill: God mode and Soul mode">SKILL.md</a>
        <a className="gp-btn" href={apiPath('/god/eden-god.mjs')} download>eden-god.mjs</a>
      </div>
    </div>;
    if (s === 'edits') return <div data-edits="1">
      <div className="gp-tools">
        <button className="gp-btn" data-undo="1" disabled={!canUndo || busy === 'undo'} onClick={() => undoRedo('undo')} title="Undo the newest edit">↶ Undo</button>
        <button className="gp-btn" data-redo="1" disabled={busy === 'redo'} onClick={() => undoRedo('redo')} title="Redo the newest undone edit">↷ Redo</button>
      </div>
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
              <span className="gp-dim">{since(e.at)}</span>
              {e.grp && e.grp !== 'genesis' && groupRow.get(e.grp) === e.seq && <button className="gp-mini" data-undo-group={e.grp} disabled={busy === 'g:' + e.grp} onClick={() => undoGroup(e.grp!)} title={`Undo every edit in group ${e.grp}`}>undo group</button>}
            </span>
          </li>
        ))}
      </ul>
    </div>;
    if (s === 'flags') return <div data-flags="1">
      <div className="gp-tools"><button className={'gp-btn' + (flagMode ? ' gp-armed' : '')} data-flag-button="1" aria-pressed={flagMode} onClick={() => { onFlagMode(!flagMode); if (!flagMode) closeGod(); }} title="Drop a labelled flag: a reference point your agent can build around (or Alt+click the ground)">⚑ {flagMode ? 'click the ground…' : 'Drop a flag'}</button></div>
      {!flags.length && <p className="gp-dim">No flags yet. Drop one and your agent can say <code>place cottage --at flag:camp</code>.</p>}
      <ul className="gp-list">
        {flags.map((f) => (
          <li key={f.id}>
            <button className="gp-link" data-fly={f.name} onClick={() => fly(f.p[0], f.p[1], f.p[2], 35)} title="Fly the camera here">⚑ {f.label}</button>
            <code className="gp-dim">flag:{f.name}</code>
            <span className="gp-dim gp-when">{Math.round(f.p[0])}, {Math.round(f.p[2])}</span>
          </li>
        ))}
      </ul>
    </div>;
    if (s === 'previews') return <div data-previews="1">
      {!previews.length && <p className="gp-dim">When your agent runs <code>preview</code> (a dry run), its proposal appears here; show it as a ghost before it is built.</p>}
      <ul className="gp-list">
        {previews.map((p) => (
          <li key={p.id}>
            <code>{p.id}</code>
            <span className="gp-what">{p.accepted ? summaryText(p.summary) : <span className="gp-bad">would be refused</span>}</span>
            <span className="gp-dim gp-when">{since(p.at)}</span>
            {p.accepted && <button className="gp-btn gp-small" data-show-preview={p.id} onClick={() => { closeGod(); void showPreview(p.id); }}>{ghost?.id === p.id ? 'shown' : 'show'}</button>}
          </li>
        ))}
      </ul>
    </div>;
    if (s === 'souls') return <div data-souls-tab="1"><JoinPanel signedIn={signedIn} worldName={name} base={status.base} /></div>;
    if (s === 'constitution') return <ConstitutionBody />;
    if (s === 'world') return <div data-world-section="1">
      <h3 className="gm-h">Weather</h3>
      <p className="gp-dim">The same as your agent's <code>weather</code> and <code>strike</code>: each press is one edit in the world's history.</p>
      <div className="gm-weather" data-weather="1">
        <button className="gp-btn" data-weather-kind="rain" disabled={!!busy} onClick={() => weather('rain')}>Rain</button>
        <button className="gp-btn" data-weather-kind="lightning" disabled={!!busy} onClick={() => weather('lightning')}>Lightning</button>
        <button className="gp-btn" data-weather-kind="haze" disabled={!!busy} onClick={() => weather('haze')}>Haze</button>
      </div>
      {status.you === 'owner' && <><h3 className="gm-h">This world</h3><WorldOwnerOps /></>}
    </div>;
    return null;
  };
  return <>
    {ghostBar}
    {god.open && <OwnerGod world={name} meta={<>{status.entities === 1 ? '1 thing' : `${status.entities} things`} · edit {status.seq}{launcher?.world.templateName ? <> · from <i>{launcher.world.templateName}</i></> : null}</>}
      nav={nav} banner={banner} prompt={prompt} paired={agentsPaired}>{section}</OwnerGod>}
  </>;
}

function summaryText(s: Record<string, unknown> | null) {
  if (!s) return '';
  const n = (k: string) => (typeof s[k] === 'number' ? (s[k] as number) : 0);
  const parts = [n('upserts') && `${n('upserts')} things`, n('removes') && `−${n('removes')}`, n('tiles') && `${n('tiles')} tiles`].filter(Boolean);
  return parts.join(' · ') || 'no change';
}
