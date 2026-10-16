// GOVERN (lane C17, 2026-10-16): a god world's governance — its constitution, versioned, and the residents' voice.
// Spec <eden4>/28 §6: the constitution is markdown in world state, written by the god (the world creator's own
// coding agent) and public; Souls pray, and the god interprets under it. This module adds, on our side of that:
//
//   - versions: every change of `state.constitution` (a god edit, an undo, an accepted amendment) is a numbered version
//     with who made it and why; visitors and residents see "changed since your last visit" (residents server-side,
//     visitors in their browser);
//   - amendments: a resident proposes one (a clause to add, or a whole new text); other residents support it; the god
//     sees the proposals with their support and decides — accept (a new version) or decline with a reason;
//   - residents-decide: an optional per-world switch (off by default; only the god turns it on): an amendment that a
//     majority of the active residents supports (and at least two) is accepted by the residents themselves;
//   - prayers: a visible answered/waiting state (public counts, the Soul's own list, an event when the god answers).
//
// Nothing here acts unasked: the server never decides for the god; with residents-decide off an amendment waits for
// the god. Events go only to those concerned (the proposer and supporters of a decided amendment, the Soul whose prayer
// was answered), never a broadcast that would wake every Soul. No economy (Gene: off).
import { randomBytes } from 'node:crypto';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { ApiError } from '../souls.ts';
import type { GodMode } from './god.ts';

export type Resident = { id: string; name: string };
export type VersionRow = { version: number; text: string; at: number; by: 'god' | 'residents'; note: string | null; amendment: string | null };
export type AmendmentStatus = 'open' | 'accepted' | 'declined' | 'withdrawn';
type AmendmentRow = { id: string; soul_id: string; soul_name: string; title: string; text: string; full: string | null; base_version: number; at: number; status: AmendmentStatus; decided_at: number | null; decided_by: string | null; reason: string | null; version: number | null };
type SupportRow = { amendment_id: string; soul_id: string; soul_name: string; at: number };

export type GovernanceOptions = {
  /** The world's active residents (Souls living here now, not faded). Default: none known (tests, a world without bodies). */
  residents?: () => Resident[];
  /** Deliver an event to one Soul's stream (best effort). */
  deliver?: (soulId: string, kind: string, body: Record<string, unknown>) => void;
  now?: () => number;
};

export const MAX_CLAUSE = 1500, MAX_TITLE = 80, MAX_TEXT = 20000;
const OPEN_PER_SOUL = 3, PROPOSALS_PER_DAY = 5, MIN_RESIDENT_SUPPORT = 2;
const clip = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().slice(0, n);
const titleOf = (text: string) => { const w = clip(text, 400).split(' '); const t = w.slice(0, 8).join(' '); return (w.length > 8 ? t + '…' : t).slice(0, MAX_TITLE); };

const registry = new WeakMap<GodMode, Governance>();
/** The one Governance of a god world (made on first use; main.ts installs residents and events into it). */
export function governanceOf(god: GodMode, o?: GovernanceOptions): Governance {
  let g = registry.get(god);
  if (!g) { g = new Governance(god, o); registry.set(god, g); }
  else if (o) g.configure(o);
  return g;
}

export class Governance {
  readonly god: GodMode;
  private o: GovernanceOptions;
  private pendingMeta: { by: VersionRow['by']; note: string; amendment: string } | null = null;
  private booting = true;

  constructor(god: GodMode, o: GovernanceOptions = {}) {
    this.god = god; this.o = o;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS gov_versions_v1 (world_id TEXT NOT NULL, version INTEGER NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL, by TEXT NOT NULL, note TEXT, amendment TEXT, PRIMARY KEY (world_id, version)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS gov_amendments_v1 (world_id TEXT NOT NULL, id TEXT NOT NULL, soul_id TEXT NOT NULL, soul_name TEXT NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL, full TEXT, base_version INTEGER NOT NULL, at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open', decided_at INTEGER, decided_by TEXT, reason TEXT, version INTEGER, PRIMARY KEY (world_id, id)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS gov_support_v1 (world_id TEXT NOT NULL, amendment_id TEXT NOT NULL, soul_id TEXT NOT NULL, soul_name TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (world_id, amendment_id, soul_id)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS gov_seen_v1 (world_id TEXT NOT NULL, soul_id TEXT NOT NULL, version INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (world_id, soul_id)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS gov_settings_v1 (world_id TEXT PRIMARY KEY, residents_decide INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL) WITHOUT ROWID;
    `);
    // every god edit, undo and redo: a constitution that changed is a new version (engine edits: our own calls sync)
    god.onCommit(() => this.sync());
    // the god's answers reach the Soul that prayed (god.ts pushes 'prayer' on pray and on answer)
    god.subscribe(god.head, (e) => {
      const p = e.event === 'prayer' ? (e.data as { id: string; soul_id: string; text: string; answer: string | null; answered_at: number | null }) : null;
      if (p?.answer) this.deliver(p.soul_id, 'prayer.answered', { prayer: { id: p.id, text: clip(p.text, 200) }, answer: p.answer, text: `The god of this world answered your prayer ("${clip(p.text, 80)}"): ${clip(p.answer, 600)}`, untrusted: true });
    });
    this.sync();   // a constitution set before this module existed (genesis, older worlds) becomes version 1
    this.booting = false;
  }
  configure(o: GovernanceOptions) { this.o = { ...this.o, ...o }; }
  private get db() { return this.god.db.db; }
  private get wid() { return this.god.opts.worldId; }
  private now() { return this.o.now?.() ?? Date.now(); }
  private deliver(soulId: string, kind: string, body: Record<string, unknown>) { try { this.o.deliver?.(soulId, kind, body); } catch { /* events are best effort */ } }
  residents(): Resident[] { try { return this.o.residents?.() ?? []; } catch { return []; } }

  // ---------------------------------------------------------------- versions

  /** Record the world's constitution as a new version when it differs from the newest one. */
  sync(): VersionRow | null {
    const text = String(this.god.model.state.constitution ?? '');
    const last = this.latest();
    if (last ? last.text === text : !text.trim()) return null;
    const meta = this.pendingMeta;
    const row: VersionRow = { version: (last?.version ?? 0) + 1, text, at: this.now(), by: meta?.by ?? 'god', note: meta?.note ?? (this.booting && !last ? 'the constitution as the world began' : text.trim() ? null : 'cleared'), amendment: meta?.amendment ?? null };
    this.db.prepare('INSERT INTO gov_versions_v1 (world_id, version, text, at, by, note, amendment) VALUES (?,?,?,?,?,?,?)').run(this.wid, row.version, row.text, row.at, row.by, row.note, row.amendment);
    return row;
  }
  latest(): VersionRow | null { return (this.db.prepare('SELECT version, text, at, by, note, amendment FROM gov_versions_v1 WHERE world_id=? ORDER BY version DESC LIMIT 1').get(this.wid) as VersionRow | undefined) ?? null; }
  version(n: number): VersionRow | null { return (this.db.prepare('SELECT version, text, at, by, note, amendment FROM gov_versions_v1 WHERE world_id=? AND version=?').get(this.wid, n) as VersionRow | undefined) ?? null; }
  history(limit = 20): Omit<VersionRow, 'text'>[] { return this.db.prepare('SELECT version, at, by, note, amendment FROM gov_versions_v1 WHERE world_id=? ORDER BY version DESC LIMIT ?').all(this.wid, limit) as never; }
  current(): { version: number; text: string; at: number | null } { this.sync(); const l = this.latest(); return { version: l?.version ?? 0, text: l?.text ?? '', at: l?.at ?? null }; }

  /** What this Soul last saw; marks the current version seen. */
  seenBy(soulId: string, mark = true): { lastSeen: number; version: number; changed: boolean; firstTime: boolean } {
    const v = this.current().version;
    const r = this.db.prepare('SELECT version FROM gov_seen_v1 WHERE world_id=? AND soul_id=?').get(this.wid, soulId) as { version: number } | undefined;
    const lastSeen = r?.version ?? 0;
    if (mark && v > lastSeen) this.markSeen(soulId, v);
    return { lastSeen, version: v, changed: !!r && v > lastSeen, firstTime: !r };
  }
  markSeen(soulId: string, version = this.current().version) {
    this.db.prepare('INSERT INTO gov_seen_v1 (world_id, soul_id, version, at) VALUES (?,?,?,?) ON CONFLICT(world_id, soul_id) DO UPDATE SET version=MAX(version, excluded.version), at=excluded.at').run(this.wid, soulId, version, this.now());
  }

  // ---------------------------------------------------------------- settings

  get residentsDecide(): boolean { return !!(this.db.prepare('SELECT residents_decide FROM gov_settings_v1 WHERE world_id=?').get(this.wid) as { residents_decide: number } | undefined)?.residents_decide; }
  setResidentsDecide(on: boolean) {
    this.db.prepare('INSERT INTO gov_settings_v1 (world_id, residents_decide, at) VALUES (?,?,?) ON CONFLICT(world_id) DO UPDATE SET residents_decide=excluded.residents_decide, at=excluded.at').run(this.wid, on ? 1 : 0, this.now());
    if (on) for (const a of this.rows('open')) this.residentsCheck(a.id);
  }
  /** Majority of the active residents, and never fewer than two Souls. */
  quorum(): { residents: number; needed: number } { const n = this.residents().length; return { residents: n, needed: Math.max(MIN_RESIDENT_SUPPORT, Math.floor(n / 2) + 1) }; }

  // ---------------------------------------------------------------- amendments

  private rows(status?: AmendmentStatus | 'all', limit = 50): AmendmentRow[] {
    const all = !status || status === 'all';
    return this.db.prepare(`SELECT id, soul_id, soul_name, title, text, full, base_version, at, status, decided_at, decided_by, reason, version FROM gov_amendments_v1 WHERE world_id=?${all ? '' : ' AND status=?'} ORDER BY at DESC LIMIT ?`).all(...([this.wid, ...(all ? [] : [status]), limit] as never[])) as AmendmentRow[];
  }
  private row(id: string): AmendmentRow | null { return (this.db.prepare('SELECT id, soul_id, soul_name, title, text, full, base_version, at, status, decided_at, decided_by, reason, version FROM gov_amendments_v1 WHERE world_id=? AND id=?').get(this.wid, id) as AmendmentRow | undefined) ?? null; }
  private supporters(id: string): SupportRow[] { return this.db.prepare('SELECT amendment_id, soul_id, soul_name, at FROM gov_support_v1 WHERE world_id=? AND amendment_id=? ORDER BY at').all(this.wid, id) as SupportRow[]; }

  /** A proposal as anyone may read it (the residents need to see what they could support). */
  view(a: AmendmentRow, opts: { soulId?: string; full?: boolean } = {}) {
    const sup = this.supporters(a.id), active = new Set(this.residents().map((r) => r.id)), cur = this.current().version;
    return {
      id: a.id, title: a.title, text: a.text, ...(a.full !== null ? { replacesWholeText: true, ...(opts.full ? { full: a.full } : { fullChars: a.full.length }) } : {}),
      by: { name: a.soul_name, ...(opts.full ? { soulId: a.soul_id } : {}) }, at: a.at, status: a.status,
      support: sup.length, supporters: sup.map((s) => s.soul_name), activeSupport: sup.filter((s) => active.has(s.soul_id)).length,
      baseVersion: a.base_version, stale: a.status === 'open' && a.base_version !== cur,
      ...(a.status !== 'open' ? { decided: { at: a.decided_at, by: a.decided_by, reason: a.reason, version: a.version } } : {}),
      ...(opts.soulId ? { yours: a.soul_id === opts.soulId, supporting: sup.some((s) => s.soul_id === opts.soulId) } : {}),
    };
  }
  amendments(opts: { status?: AmendmentStatus | 'all'; soulId?: string; full?: boolean; limit?: number } = {}) {
    return this.rows(opts.status ?? 'all', opts.limit ?? 50).map((a) => this.view(a, opts));
  }

  propose(soul: Resident, input: { text?: unknown; title?: unknown; full?: unknown }) {
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    const full = typeof input.full === 'string' && input.full.trim() ? input.full.trim() : null;
    if (!text && !full) throw new ApiError(400, 'invalid', 'an amendment needs {"text": "…"} (the clause to add or the change you want) or {"full": "…"} (a whole new constitution)');
    if (text.length > MAX_CLAUSE) throw new ApiError(400, 'invalid', `an amendment's text is at most ${MAX_CLAUSE} characters (say the change; the god writes it in)`);
    if (full && full.length > MAX_TEXT) throw new ApiError(400, 'invalid', `a whole constitution is at most ${MAX_TEXT} characters`);
    const mine = this.db.prepare("SELECT status, at FROM gov_amendments_v1 WHERE world_id=? AND soul_id=? AND (status='open' OR at>?)").all(this.wid, soul.id, this.now() - 86_400_000) as { status: string; at: number }[];
    if (mine.filter((m) => m.status === 'open').length >= OPEN_PER_SOUL) throw new ApiError(429, 'rate-limited', `you already have ${OPEN_PER_SOUL} amendments waiting; withdraw one or wait for the god`);
    if (mine.filter((m) => m.at > this.now() - 86_400_000).length >= PROPOSALS_PER_DAY) throw new ApiError(429, 'rate-limited', `at most ${PROPOSALS_PER_DAY} amendments a day`);
    const title = clip(typeof input.title === 'string' && input.title.trim() ? input.title : titleOf(text || full!), MAX_TITLE);
    const a: AmendmentRow = { id: 'am_' + randomBytes(5).toString('hex'), soul_id: soul.id, soul_name: soul.name, title, text: text || `Replace the constitution with a new text (${full!.length} characters).`, full, base_version: this.current().version, at: this.now(), status: 'open', decided_at: null, decided_by: null, reason: null, version: null };
    this.db.prepare('INSERT INTO gov_amendments_v1 (world_id, id, soul_id, soul_name, title, text, full, base_version, at, status) VALUES (?,?,?,?,?,?,?,?,?,?)').run(this.wid, a.id, a.soul_id, a.soul_name, a.title, a.text, a.full, a.base_version, a.at, 'open');
    this.db.prepare('INSERT OR IGNORE INTO gov_support_v1 (world_id, amendment_id, soul_id, soul_name, at) VALUES (?,?,?,?,?)').run(this.wid, a.id, soul.id, soul.name, a.at);
    this.godEvent({ kind: 'amendment.proposed', amendment: this.view(a, { full: true }) });
    this.residentsCheck(a.id);
    return this.view(this.row(a.id)!, { soulId: soul.id });
  }
  support(soul: Resident, id: string, on = true) {
    const a = this.row(id); if (!a) throw new ApiError(404, 'not-found', 'no such amendment');
    if (a.status !== 'open') throw new ApiError(409, 'amendment.closed', `that amendment was ${a.status}`);
    if (a.soul_id === soul.id && !on) throw new ApiError(409, 'amendment.yours', 'you proposed it; withdraw it instead');
    if (on) this.db.prepare('INSERT OR IGNORE INTO gov_support_v1 (world_id, amendment_id, soul_id, soul_name, at) VALUES (?,?,?,?,?)').run(this.wid, id, soul.id, soul.name, this.now());
    else this.db.prepare('DELETE FROM gov_support_v1 WHERE world_id=? AND amendment_id=? AND soul_id=?').run(this.wid, id, soul.id);
    this.godEvent({ kind: on ? 'amendment.supported' : 'amendment.unsupported', amendment: id, by: soul.name, support: this.supporters(id).length });
    if (on) this.residentsCheck(id);
    return this.view(this.row(id)!, { soulId: soul.id });
  }
  withdraw(soul: Resident, id: string) {
    const a = this.row(id); if (!a) throw new ApiError(404, 'not-found', 'no such amendment');
    if (a.soul_id !== soul.id) throw new ApiError(403, 'forbidden', 'only its proposer may withdraw an amendment');
    if (a.status !== 'open') throw new ApiError(409, 'amendment.closed', `that amendment was ${a.status}`);
    this.db.prepare("UPDATE gov_amendments_v1 SET status='withdrawn', decided_at=?, decided_by=? WHERE world_id=? AND id=?").run(this.now(), soul.name, this.wid, id);
    this.godEvent({ kind: 'amendment.withdrawn', amendment: id });
    return this.view(this.row(id)!, { soulId: soul.id });
  }

  /** The text an accepted amendment makes: the god's own wording, else the proposed whole text, else the clause appended. */
  textAfter(a: AmendmentRow, godText?: string): string {
    if (godText?.trim()) return godText;
    if (a.full) return a.full;
    const cur = this.current().text.trimEnd();
    const n = (this.db.prepare("SELECT COUNT(*) n FROM gov_amendments_v1 WHERE world_id=? AND status='accepted'").get(this.wid) as { n: number }).n + 1;
    return `${cur ? cur + '\n\n' : ''}## Amendment ${n}: ${a.title}\n\n${a.text}\n\n*Proposed by ${a.soul_name}.*`;
  }

  /** The god decides: accept (a new version: its own `text`, else the proposal) or decline with a reason. */
  decide(id: string, input: { decision: 'accept' | 'decline'; reason?: string; text?: string }) {
    const a = this.row(id); if (!a) throw new ApiError(404, 'not-found', 'no such amendment');
    if (a.status !== 'open') throw new ApiError(409, 'amendment.closed', `that amendment was already ${a.status}`);
    if (input.decision === 'decline') {
      const reason = clip(input.reason ?? '', 600);
      if (!reason) throw new ApiError(400, 'invalid', 'declining needs a reason the residents will read');
      this.close(a, 'declined', 'god', reason, null);
      return { ok: true, amendment: this.view(this.row(id)!, { full: true }) };
    }
    const next = this.textAfter(a, input.text);
    if (next.length > MAX_TEXT) throw new ApiError(400, 'constitution.too-long', `the constitution would be ${next.length} characters (at most ${MAX_TEXT}); accept with a shorter "text"`);
    const v = this.apply(a, next, 'god');
    this.close(a, 'accepted', 'god', clip(input.reason ?? '', 600) || null, v.version);
    return { ok: true, version: v.version, amendment: this.view(this.row(id)!, { full: true }) };
  }
  private apply(a: AmendmentRow, text: string, by: VersionRow['by']): VersionRow {
    const note = `${by === 'residents' ? 'the residents accepted' : 'accepted'} amendment “${a.title}” (${a.soul_name})`;
    const ops = [{ op: 'world', state: { constitution: text } }];
    const before = this.current().version;
    if (text === this.current().text) throw new ApiError(409, 'constitution.unchanged', 'the accepted text is the same as the constitution now');
    this.pendingMeta = { by, note, amendment: a.id };
    try {
      const r = by === 'god' ? this.god.act({ ops, group: 'governance' }, note) : this.god.engineAct(ops as never, note);
      if (!r.accepted) throw new ApiError(409, 'constitution.refused', `the world refused the new text: ${JSON.stringify(r.failures).slice(0, 300)}`);
      const v = this.sync() ?? this.latest();
      if (!v || v.version === before) throw new ApiError(409, 'constitution.unchanged', 'the constitution did not change');
      return v;
    } finally { this.pendingMeta = null; }
  }
  private close(a: AmendmentRow, status: 'accepted' | 'declined', by: string, reason: string | null, version: number | null) {
    this.db.prepare('UPDATE gov_amendments_v1 SET status=?, decided_at=?, decided_by=?, reason=?, version=? WHERE world_id=? AND id=?').run(status, this.now(), by, reason, version, this.wid, a.id);
    const who = by === 'residents' ? 'The residents' : 'The god';
    const text = status === 'accepted' ? `${who} accepted the amendment “${a.title}”: the constitution is now version ${version}.` : `The god declined the amendment “${a.title}”: ${reason}`;
    for (const s of this.supporters(a.id)) this.deliver(s.soul_id, `amendment.${status}`, { amendment: { id: a.id, title: a.title, by: a.soul_name }, ...(version ? { version } : {}), ...(reason ? { reason } : {}), text, untrusted: true });
    this.godEvent({ kind: `amendment.${status}`, amendment: a.id, by, ...(version ? { version } : {}) });
  }
  /** Residents-decide (opt-in): a majority of the active residents, at least two, accepts an open amendment. */
  private residentsCheck(id: string) {
    if (!this.residentsDecide) return;
    const a = this.row(id); if (!a || a.status !== 'open') return;
    const active = new Set(this.residents().map((r) => r.id)), { needed } = this.quorum();
    const n = this.supporters(id).filter((s) => active.has(s.soul_id)).length;
    if (n < needed) return;
    const next = this.textAfter(a);
    if (next.length > MAX_TEXT) return;   // too long to apply by itself: it waits for the god
    let v: VersionRow;
    try { v = this.apply(a, next, 'residents'); } catch { return; }   // the world refused it: it waits for the god
    this.close(a, 'accepted', 'residents', `${n} of ${active.size} active residents supported it`, v.version);
  }
  private godEvent(data: Record<string, unknown>) { try { (this.god as unknown as { push(e: string, d: unknown): void }).push('governance', data); } catch { /* the god's stream is best effort */ } }

  // ---------------------------------------------------------------- prayers (answered / waiting)

  prayerCounts(): { total: number; answered: number; waiting: number } {
    const r = this.db.prepare('SELECT COUNT(*) total, COALESCE(SUM(answer IS NOT NULL), 0) answered FROM god_prayers_v1 WHERE world_id=?').get(this.wid) as { total: number; answered: number };
    return { total: r.total, answered: r.answered, waiting: r.total - r.answered };
  }
  prayersOf(soulId: string) { return this.god.prayersFor(soulId).map((p) => ({ id: p.id, text: p.text, at: p.at, state: p.answer === null ? 'waiting' as const : 'answered' as const, ...(p.answer !== null ? { answer: p.answer, answeredAt: p.answered_at } : {}) })); }

  // ---------------------------------------------------------------- views

  publicView() {
    const c = this.current(), q = this.quorum();
    return {
      contract: 'governance/1',
      constitution: { version: c.version, text: c.text, at: c.at, chars: c.text.length },
      history: this.history(10),
      amendments: [...this.amendments({ status: 'open' }), ...this.amendments({ status: 'all', limit: 30 }).filter((a) => a.status !== 'open').slice(0, 10)],
      prayers: this.prayerCounts(),
      residentsDecide: this.residentsDecide, residents: q.residents, needed: q.needed,
    };
  }
  soulView(soul: Resident) {
    const seen = this.seenBy(soul.id), c = this.current();
    const was = seen.changed ? this.version(seen.lastSeen) : null;
    return {
      contract: 'governance/1', version: c.version, lastSeenVersion: seen.lastSeen, changedSinceLastVisit: seen.changed,
      constitution: c.text, ...(was ? { before: was.text } : {}),
      amendments: this.amendments({ status: 'open', soulId: soul.id }),
      decided: this.amendments({ status: 'all', soulId: soul.id, limit: 20 }).filter((a) => a.status !== 'open' && (a.yours || a.supporting)),
      prayers: this.prayersOf(soul.id),
      residentsDecide: this.residentsDecide, ...this.quorum(),
    };
  }
  godView(all = false) {
    const q = this.quorum();
    return { contract: 'governance/1', version: this.current().version, residentsDecide: this.residentsDecide, residents: q.residents, needed: q.needed, amendments: this.amendments({ status: all ? 'all' : 'open', full: true, limit: 100 }), prayers: this.prayerCounts(), history: this.history(20) };
  }
}

// ------------------------------------------------------------------ HTTP

const proposeSchema = z.object({ text: z.string().max(MAX_CLAUSE).optional(), title: z.string().max(200).optional(), full: z.string().max(MAX_TEXT).optional() });
const decideSchema = z.object({ decision: z.enum(['accept', 'decline']), reason: z.string().max(2000).optional(), text: z.string().max(MAX_TEXT).optional() });
const settingsSchema = z.object({ residentsDecide: z.boolean() });

export function mountGovernanceRoutes(app: Hono, d: { god: GodMode; requireGod: (c: Context) => void; soulFromBearer: (c: Context) => Resident | null }) {
  const noStore = { 'cache-control': 'no-store' };
  const gov = () => governanceOf(d.god);
  const body = async (c: Context) => { try { return await c.req.json(); } catch { throw new ApiError(400, 'bad-json', 'body must be JSON'); } };
  const soul = (c: Context) => { const s = d.soulFromBearer(c); if (!s) throw new ApiError(401, 'unauthorized', 'a Soul token is required'); return s; };
  // public: what visitors and residents read
  app.get('/v1/world/governance', (c) => c.json(gov().publicView(), 200, noStore));
  app.get('/v1/world/constitution/versions/:n', (c) => { const v = gov().version(Number(c.req.param('n'))); if (!v) throw new ApiError(404, 'not-found', 'no such version'); return c.json(v, 200, { 'cache-control': 'public, max-age=300' }); });
  // a resident: its view (marks the constitution read), proposals, support
  app.get('/v1/world/governance/me', (c) => c.json(gov().soulView(soul(c)), 200, noStore));
  app.post('/v1/world/amendments', async (c) => { const s = soul(c); const p = proposeSchema.safeParse(await body(c)); if (!p.success) throw new ApiError(400, 'invalid', `body must be { text, title?, full? } (text at most ${MAX_CLAUSE} characters)`); return c.json({ ok: true, amendment: gov().propose(s, p.data) }, 200, noStore); });
  app.post('/v1/world/amendments/:id/support', (c) => c.json({ ok: true, amendment: gov().support(soul(c), c.req.param('id'), true) }, 200, noStore));
  app.delete('/v1/world/amendments/:id/support', (c) => c.json({ ok: true, amendment: gov().support(soul(c), c.req.param('id'), false) }, 200, noStore));
  app.post('/v1/world/amendments/:id/withdraw', (c) => c.json({ ok: true, amendment: gov().withdraw(soul(c), c.req.param('id')) }, 200, noStore));
  // the god (the world creator's agent): proposals with support, decisions, the residents-decide switch
  app.get('/v1/god/amendments', (c) => { d.requireGod(c); return c.json(gov().godView(c.req.query('all') === '1'), 200, noStore); });
  app.post('/v1/god/amendments/:id/decide', async (c) => { d.requireGod(c); const p = decideSchema.safeParse(await body(c)); if (!p.success) throw new ApiError(400, 'invalid', 'body must be { decision: "accept" | "decline", reason?, text? } (decline needs a reason)'); return c.json(gov().decide(c.req.param('id'), p.data), 200, noStore); });
  app.get('/v1/god/governance', (c) => { d.requireGod(c); return c.json(gov().godView(false), 200, noStore); });
  app.post('/v1/god/governance', async (c) => { d.requireGod(c); const p = settingsSchema.safeParse(await body(c)); if (!p.success) throw new ApiError(400, 'invalid', 'body must be { residentsDecide: true | false }'); gov().setResidentsDecide(p.data.residentsDecide); return c.json({ ok: true, ...gov().godView(false) }, 200, noStore); });
}
