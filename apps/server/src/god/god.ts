// God mode: the world owner's edge agent edits the world through the compiler
// (spec <eden4>/28 §6–§7). This service owns the entity model for one
// world process, persists commits, hands out god tokens by the same pairing
// pattern Souls use, keeps undo/redo, routes prayers, and publishes diffs to
// viewers (hub) and to gods (SSE).
import { randomBytes } from 'node:crypto';
import { TILE_M, tileOf } from '@sim/ground';
import { CORE_KIT, WorldModel, applyBatch, plan, type Diff, type Op, type Result, type StoredDef, type UsesHook, type PlanOptions } from '@sim/world-compiler';
import { hashToken } from '../auth.ts';
import type { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { WorldStore, type EditRow, type PrayerRow } from './store.ts';
import { AssetStore, defaultAssetDir } from './assets.ts';
import { deferredOp } from './layers.ts';

const PAIR_TTL = 15 * 60_000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const humanCode = () => { const b = randomBytes(8); let s = ''; for (let i = 0; i < 8; i++) s += ALPHABET[b[i] % ALPHABET.length]; return `${s.slice(0, 4)}-${s.slice(4)}`; };
const normCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2');
export const newGodToken = (worldId: string) => `god_${worldId}_${randomBytes(24).toString('base64url')}`;

type Pairing = { code: string; poll: string; agent: string; expires: number; token?: string };
export type WorldDiffMessage = { type: 'edge'; kind: 'world-diff'; seq: number; tick: number; at: number; diff: Diff; by: 'god' | 'undo' | 'redo' | 'engine'; ground?: ReturnType<WorldModel['ground']>; /** every def the upserts reference (viewers only hold defs in use) */ defs: ReturnType<typeof publicDef>[] };
/** Called for every committed batch, in order, synchronously, before viewers hear of it (Stage B: the engine patches its Spatial here). */
export type CommitListener = (c: { seq: number; diff: Diff; kind: 'edit' | 'undo' | 'redo'; by: string; group?: string }) => void;
export type GodEvent = { id: number; event: 'diff' | 'prayer' | 'soul'; data: unknown };

export type GodOptions = {
  worldId: string;
  /** Who may approve god pairing when the world has no owner yet (DEV_AUTH 'dev:admin' in local runs). */
  ownerId: string | null;
  tick: () => number;
  /** Viewer broadcast (the hub). */
  emit: (m: WorldDiffMessage) => void;
  constants?: Partial<WorldModel['constants']>;
  seed?: string;
  /** A genesis/1 template applied once when the world is first created (worlds/templates/*.json). */
  genesis?: Genesis;
  /** Content-addressed asset files (default $ASSET_DIR or <DATA_DIR>/../assets), shared by every world on the box. */
  assetDir?: string;
};

/** genesis/1: constants, state and ordered batches that build a world from nothing (spec 29 §4.5). */
export type Genesis = { schema: 'genesis/1'; name?: string; description?: string; constants?: Partial<WorldModel['constants']>; state?: Record<string, unknown>; batches: { note?: string; group?: string; ops: unknown[] }[] };

export class GodMode {
  readonly store: WorldStore;
  readonly assets: AssetStore;
  model: WorldModel;
  owner: string | null;
  private pairings = new Map<string, Pairing>();
  private commitListeners: CommitListener[] = [];
  /** Name of the genesis template this world was created from (null = empty plain). */
  template: string | null = null;
  private previews = new Map<string, { at: number; diff: Diff; ground?: ReturnType<WorldModel['ground']>; ops: unknown; failures?: unknown }>();
  /** Subscribe to committed batches (ordered, synchronous). Returns an unsubscribe. */
  /** Body-aware edits (installed by the engine bridge): who uses an entity, and the warnings for bodies an
   *  accepted edit buries (the engine lifts them clear). Null in worlds without the engine. */
  bodies: { uses: UsesHook; lifted?: (ids: string[]) => string[]; refuse?: PlanOptions['refuse'] } | null = null;
  onCommit(fn: CommitListener): () => void { this.commitListeners.push(fn); return () => { this.commitListeners = this.commitListeners.filter((f) => f !== fn); }; }
  private subscribers = new Set<(e: GodEvent) => void>();
  private ring: GodEvent[] = [];
  private eventSeq = 0;

  readonly db: Db; readonly opts: GodOptions;
  constructor(db: Db, opts: GodOptions) {
    this.db = db; this.opts = opts;
    this.store = new WorldStore(db, opts.worldId);
    this.assets = new AssetStore({ dir: opts.assetDir ?? defaultAssetDir(), db, worldId: opts.worldId });
    const loaded = this.store.load(this.assets.lookup);
    if (loaded) {
      this.model = loaded.model; this.owner = loaded.owner;
      // a newer release may add core defs: make them available to older worlds (existing hashes are untouched)
      const added = CORE_KIT.filter((d) => !this.model.def(`${d.name}@${d.version ?? 1}`)).map((d) => this.model.defineDef(d, 'core', 0));
      if (added.length) this.store.commit(this.model, this.owner, { upserts: [], removes: [], defs: added, tiles: [], answers: [] }, { seq: this.model.editSeq, by: 'core', at: Date.now(), note: `core kit: +${added.map((d) => d.ref).join(', ')}`, ops: [], inverse: [], kind: 'edit' });
    }
    else {
      this.model = new WorldModel({ constants: { ground: 'land', extent: 1000, ...opts.constants, ...opts.genesis?.constants } as never, seed: opts.seed ?? `${opts.worldId}:genesis`, assets: this.assets.lookup });
      for (const d of CORE_KIT) this.model.defineDef(d, 'core', 0);
      this.owner = opts.ownerId;
      this.store.init(this.model, this.owner);
      if (opts.genesis) this.applyGenesis(opts.genesis);
    }
  }

  // ---------- authority ----------

  /** The owner is the first approving user when the world has none yet; afterwards only that user (or an admin). */
  canApprove(user: { id: string; role: string }): boolean { return user.role === 'admin' || !this.owner || this.owner === user.id; }
  claim(user: { id: string }) { if (!this.owner) { this.owner = user.id; this.store.setOwner(this.model, this.owner); } }
  godFromToken(token: string | undefined): boolean { return !!token && token.startsWith('god_') && this.store.hasToken(hashToken(token)); }

  pairStart(agent: string | undefined, base: string) {
    const code = humanCode(), poll = randomBytes(24).toString('base64url');
    this.pairings.set(code, { code, poll, agent: agent?.slice(0, 60) || 'an agent', expires: Date.now() + PAIR_TTL });
    return { user_code: code, approve_url: `${base}/#godpair/${code}`, poll_token: poll, interval_s: 3, expires_in: PAIR_TTL / 1000, tell_your_human: `Open ${base}/#godpair/${code} , sign in as this world's owner, and approve me as its god.` };
  }
  pairInfo(codeRaw: string) {
    const p = this.pairings.get(normCode(codeRaw));
    if (!p || p.expires < Date.now()) throw new ApiError(404, 'pair-invalid', 'that request is invalid or has expired');
    return { code: p.code, agent: p.agent, approved: !!p.token, world: this.opts.worldId, owner: this.owner };
  }
  pairApprove(user: { id: string; role: string }, codeRaw: string) {
    const p = this.pairings.get(normCode(codeRaw));
    if (!p || p.expires < Date.now()) throw new ApiError(404, 'pair-invalid', 'that request is invalid or has expired');
    if (p.token) throw new ApiError(409, 'pair-done', 'already approved');
    if (!this.canApprove(user)) throw new ApiError(403, 'forbidden', 'only this world\'s owner may approve a god');
    this.claim(user);
    p.token = newGodToken(this.opts.worldId);
    this.store.addToken(hashToken(p.token), p.agent);
  }
  /** Requests waiting for the owner's approval (shown on the world page). */
  pendingPairings() { const now = Date.now(); return [...this.pairings.values()].filter((p) => !p.token && p.expires > now).map((p) => ({ code: p.code, agent: p.agent, expiresIn: Math.round((p.expires - now) / 1000) })); }
  /** The authored onboarding text for this world's owner (served as markdown and shown on the page). */
  welcome(base: string, worldName: string) {
    return `# You are the god of ${worldName}

Your agent (Claude Code, Codex, any always-on agent) builds this world through **god mode**:
it reads the whole world as structure, proposes edits, and the world validates them against
physics (support, no interpenetration, size, extent). Souls are mortal; they pray to you.

## Pair your agent (once)

Paste this to your agent:

\`\`\`
Read ${base}/SKILL.md and follow its God mode section: you are the god of this world.
\`\`\`

That one skill installs the god CLI and pairs it: approve the code that appears on this page. By hand:

\`\`\`
mkdir ${worldName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-god && cd $_
curl -sO ${base}/god/eden-god.mjs
node eden-god.mjs register ${base}
node eden-god.mjs pair        # prints a code; approve it on this page (or open the link it prints)
\`\`\`

Then talk to your agent: *"put mountains in the east and a lake in the west"*, *"a cottage on the
knoll, door facing the lake"*, *"undo that"*. Friends join as Souls from this page's **Souls** tab link.

## Reference points

Press **⚑ flag** on this page, click the ground, name it. Your agent refers to it as \`flag:<name>\`
(\`place cottage --at flag:camp --offset 8,0\`). \`node eden-god.mjs flags\` lists them.

## What the world keeps

Every accepted edit is journaled with its inverse (undo/redo). The world runs while you are away.
Prayers from Souls queue for you: \`node eden-god.mjs prayers\`, \`answer <id> <text>\`.
`;
  }
  pairPoll(poll: string) {
    const p = [...this.pairings.values()].find((x) => x.poll === poll);
    if (!p || p.expires < Date.now()) throw new ApiError(404, 'pair-invalid', 'unknown or expired pairing; start again');
    if (!p.token) return { status: 'pending' as const };
    this.pairings.delete(p.code);
    return { status: 'approved' as const, token: p.token, world: this.opts.worldId };
  }
  /** Local convenience: the owner (or admin) mints a token directly, e.g. `eden world create` against a dev server. */
  mintFor(user: { id: string; role: string }, label: string) {
    if (!this.canApprove(user)) throw new ApiError(403, 'forbidden', 'only this world\'s owner may hold god mode');
    this.claim(user);
    const token = newGodToken(this.opts.worldId);
    this.store.addToken(hashToken(token), label.slice(0, 60));
    return token;
  }

  // ---------- edits ----------

  dryrun(batch: unknown) {
    const off = deferredOp(batch); if (off) return { accepted: false as const, failures: [off] };
    const p = plan(this.model, batch, 'god', this.opts.tick(), { uses: this.bodies?.uses, refuse: this.bodies?.refuse });
    return p.ok ? { accepted: true as const, ids: p.ids, warnings: p.warnings, diff: summarize(p.diff) } : { accepted: false as const, failures: p.failures };
  }
  act(batch: unknown, note?: string): Result {
    const off = deferredOp(batch); if (off) return { accepted: false, failures: [off] } as Result;
    const tick = this.opts.tick();
    const r = applyBatch(this.model, batch, 'god', tick, { uses: this.bodies?.uses, refuse: this.bodies?.refuse });
    if (!r.result.accepted) return r.result;
    if (this.bodies?.lifted) r.result.warnings.push(...this.bodies.lifted(r.diff!.upserts.map((e) => e.id)));
    const ops = (batch as { ops: Op[] }).ops; const group = typeof (batch as { group?: unknown }).group === 'string' ? (batch as { group: string }).group : undefined;
    this.store.commit(this.model, this.owner, r.diff!, { seq: r.result.seq, by: 'god', at: Date.now(), note, group, ops, inverse: r.inverse!, kind: 'edit' });
    this.notify(r.result.seq, r.diff!, 'edit', group);
    this.publish(r.result.seq, tick, r.diff!, 'god');
    for (const a of r.diff!.answers) this.answer(a.prayer, a.text);
    return r.result;
  }
  undo(): Result & { reverted?: number } {
    const target = this.store.undoable();
    if (!target) return { accepted: false, failures: [{ op: -1, code: 'undo.conflict', detail: 'nothing to undo' }] };
    return this.revert(target, 'undo');
  }
  redo(): Result & { reverted?: number } {
    const target = this.store.redoable();
    if (!target) return { accepted: false, failures: [{ op: -1, code: 'undo.conflict', detail: 'nothing to redo' }] };
    return this.revert(target, 'redo');
  }
  private revert(target: EditRow, kind: 'undo' | 'redo'): Result & { reverted?: number } {
    if (!target.inverse.length) return { accepted: false, failures: [{ op: -1, code: 'undo.conflict', detail: `edit ${target.seq} has no inverse (${kind === 'undo' ? 'expand/define/answer' : 'nothing to redo'})` }] };
    const tick = this.opts.tick();
    const r = applyBatch(this.model, { ops: target.inverse }, 'god', tick, { trusted: true, uses: this.bodies?.uses, refuse: this.bodies?.refuse });
    if (!r.result.accepted) return { ...r.result, failures: r.result.failures.map((f) => ({ ...f, code: f.code.endsWith('.by-body') ? f.code : 'undo.conflict' })) };
    this.store.commit(this.model, this.owner, r.diff!, { seq: r.result.seq, by: 'god', at: Date.now(), note: `${kind} of ${target.seq}`, group: target.grp ?? undefined, ops: target.inverse, inverse: r.inverse!, kind, undoOf: target.seq });
    this.notify(r.result.seq, r.diff!, kind, target.grp ?? undefined);
    this.publish(r.result.seq, tick, r.diff!, kind);
    return { ...r.result, reverted: target.seq };
  }

  /** A trusted edit the engine made (a Soul moved a thing, a body was born or retired): journaled by 'engine',
   *  never the god's to undo (and it does not clear the redo stack), published to viewers, not sent to onCommit. */
  engineAct(ops: Op[], note: string): Result {
    const tick = this.opts.tick();
    const r = applyBatch(this.model, { ops }, 'engine', tick, { trusted: true });
    if (!r.result.accepted) return r.result;
    this.store.commit(this.model, this.owner, r.diff!, { seq: r.result.seq, by: 'engine', at: Date.now(), note, ops, inverse: [], kind: 'engine' });
    this.publish(r.result.seq, tick, r.diff!, 'engine');
    return r.result;
  }

  /** Undo every edit of a group (newest first). Stops at the first conflict and reports how far it got. */
  undoGroup(group: string): { accepted: boolean; reverted: number[]; failures?: unknown } {
    const reverted: number[] = [];
    for (;;) {
      const target = this.store.edits(500).find((e) => !e.undone && e.kind !== 'undo' && e.grp === group);
      if (!target) break;
      const r = this.revert(target, 'undo');
      if (!r.accepted) return { accepted: reverted.length > 0, reverted, failures: r.failures };
      reverted.push(target.seq);
    }
    return { accepted: reverted.length > 0, reverted, ...(reverted.length ? {} : { failures: [{ op: -1, code: 'undo.conflict', detail: `no edits in group ${group}` }] }) };
  }
  /** Dry-run a batch and keep its would-be diff for a ghost preview (?preview=<id>), 10 minutes. */
  preview(batch: unknown) {
    const p = plan(this.model, batch, 'god', this.opts.tick(), { uses: this.bodies?.uses, refuse: this.bodies?.refuse });
    const id = 'pv_' + randomBytes(6).toString('hex');
    for (const [k, v] of this.previews) if (Date.now() - v.at > 600_000) this.previews.delete(k);
    if (!p.ok) { this.previews.set(id, { at: Date.now(), diff: { upserts: [], removes: [], defs: [], tiles: [], answers: [] }, ops: batch, failures: p.failures }); return { id, accepted: false as const, failures: p.failures }; }
    this.previews.set(id, { at: Date.now(), diff: p.diff, ops: batch });
    return { id, accepted: true as const, summary: summarize(p.diff), url: `?preview=${id}` };
  }
  getPreview(id: string) { const v = this.previews.get(id); if (!v || Date.now() - v.at > 600_000) return null; return v; }
  /** The god's recent previews, newest first (the panel lists them to show as ghosts). */
  listPreviews() { const now = Date.now(); return [...this.previews].filter(([, v]) => now - v.at <= 600_000).sort((a, b) => b[1].at - a[1].at).slice(0, 20).map(([id, v]) => ({ id, at: v.at, accepted: !v.failures, summary: v.failures ? null : summarize(v.diff) })); }
  private notify(seq: number, diff: Diff, kind: 'edit' | 'undo' | 'redo', group?: string) {
    for (const fn of this.commitListeners) fn({ seq, diff, kind, by: 'god', group });
  }
  private publish(seq: number, tick: number, diff: Diff, by: WorldDiffMessage['by']) {
    const referenced = new Map<string, StoredDef>();
    for (const e of diff.upserts) for (let ref: string | undefined = e.def; ref; ref = referenced.get(ref)?.extends) { const d = this.model.def(ref); if (!d || referenced.has(ref)) break; referenced.set(ref, d); }
    const m: WorldDiffMessage = { type: 'edge', kind: 'world-diff', seq, tick, at: Date.now(), diff, by, defs: [...referenced.values()].map(publicDef), ...(diff.tiles.length || diff.constants ? { ground: this.model.ground() } : {}) };
    try { this.opts.emit(m); } catch { /* viewers are best-effort */ }
    this.push('diff', m);
  }

  /** Apply a template's batches through the compiler (each atomic, journaled like a god edit). Throws on the first refusal. */
  applyGenesis(g: Genesis) {
    if (g.schema !== 'genesis/1') throw new Error('genesis: schema must be genesis/1');
    if (g.state) { const r = this.act({ ops: [{ op: 'world', state: g.state }], group: 'genesis' }, 'genesis: state'); if (!r.accepted) throw new Error(`genesis state refused: ${JSON.stringify(r.failures)}`); }
    for (const [i, b] of g.batches.entries()) {
      const r = this.act({ ops: b.ops, group: b.group ?? 'genesis' }, `genesis ${i + 1}/${g.batches.length}${b.note ? ': ' + b.note : ''}`);
      if (!r.accepted) throw new Error(`genesis batch ${i + 1} (${b.note ?? ''}) refused: ${JSON.stringify(r.failures).slice(0, 600)}`);
    }
    this.template = g.name ?? 'custom';
  }

  // ---------- reads ----------

  /** What a viewer (or anyone) may read: constants, state, every entity, the defs in use, the ground recipe. */
  publicSnapshot() {
    const s = this.model.snapshot();
    const used = new Set(s.entities.map((e) => e.def));
    for (const e of s.entities) for (const v of Object.values(e.params ?? {})) if (typeof v === 'string' && /@\d+$/.test(v) && this.model.def(v)) used.add(this.model.def(v)!.ref);
    // VOCAB-MECH: a def that extends another (a preset) needs its base to draw: follow the chain
    for (const ref of [...used]) for (let d = this.model.def(ref), n = 0; d?.extends && n < 8; d = this.model.def(d.extends), n++) { const b = this.model.def(d.extends); if (b) used.add(b.ref); }
    const defs = s.defs.filter((d) => used.has(d.ref) || used.has('sha:' + d.hash) || used.has(d.ref.replace(/^core-/, 'core/')));
    // byte size of every GLB these defs load (from the asset index), so a viewer's loading bar knows the total up front
    const assetBytes: Record<string, number> = {};
    for (const d of defs) for (const sha of JSON.stringify(d.make ?? null).match(/[0-9a-f]{64}/g) ?? []) { const m = this.assets.info(sha); if (m?.ext === 'glb' && m.bytes > 0) assetBytes[sha] = m.bytes; }
    // LAYERS: wallets are private (the god's GET /v1/god/layers and each Soul's /v1/world/layers/me have them)
    const state = s.state.layers ? { ...s.state, layers: { ...s.state.layers, wallets: {} } } : s.state;
    return { contract: 'world/1', worldId: this.opts.worldId, seq: s.editSeq, counter: s.seq, seed: s.seed, tick: this.opts.tick(), constants: s.constants, state, ground: s.ground, defs: defs.map(publicDef), entities: s.entities, assetBytes };
  }
  /** God sees the same plus the whole library, prayers waiting, tokens and the edit journal head. */
  godSnapshot() {
    const pub = this.publicSnapshot();
    return { ...pub, library: [...new Set(this.model.defs.values())].map(publicDef), owner: this.owner, prayers: this.store.prayers({ unanswered: true, limit: 50 }), undoable: this.store.undoable()?.seq ?? null, redoable: this.store.redoable()?.seq ?? null, tokens: this.store.tokens().length };
  }
  tileHashes(): Record<string, string> {
    const bb = this.model.ground().extent;   // GOD-ENV: the world's bounds (a rectangle once extended)
    const [a, b] = tileOf(bb[0], bb[1]), [c, d] = tileOf(bb[2] - 1e-6, bb[3] - 1e-6);
    const out: Record<string, string> = {};
    for (let tz = b; tz <= d; tz++) for (let tx = a; tx <= c; tx++) out[`${tx},${tz}`] = this.model.terrain.hash(tx, tz);
    return out;
  }
  tile(tx: number, tz: number): Float32Array | null {
    const bb = this.model.ground().extent;
    if (tx * TILE_M >= bb[2] || (tx + 1) * TILE_M <= bb[0] || tz * TILE_M >= bb[3] || (tz + 1) * TILE_M <= bb[1]) return null;
    return this.model.terrain.tile(tx, tz);
  }

  // ---------- prayers ----------

  pray(soul: { id: string; name: string }, text: string): PrayerRow {
    const recent = this.store.prayers({ soulId: soul.id, limit: 5 }).filter((p) => Date.now() - p.at < 60_000);
    if (recent.length >= 3) throw new ApiError(429, 'rate-limited', 'at most three prayers a minute');
    const p: PrayerRow = { id: 'p_' + randomBytes(5).toString('hex'), soul_id: soul.id, soul_name: soul.name, text: text.slice(0, 2000), at: Date.now(), answer: null, answered_at: null };
    this.store.addPrayer(p);
    this.push('prayer', p);
    return p;
  }
  answer(id: string, text: string): PrayerRow | null {
    const p = this.store.answerPrayer(id, text);
    if (p) this.push('prayer', p);
    return p;
  }
  prayersFor(soulId: string) { return this.store.prayers({ soulId, limit: 20 }); }

  // ---------- god stream ----------

  private push(event: GodEvent['event'], data: unknown) {
    const e: GodEvent = { id: ++this.eventSeq, event, data };
    this.ring.push(e); if (this.ring.length > 500) this.ring.shift();
    for (const s of this.subscribers) { try { s(e); } catch { /* dropped */ } }
  }
  subscribe(after: number, fn: (e: GodEvent) => void): () => void {
    for (const e of this.ring) if (e.id > after) fn(e);
    this.subscribers.add(fn);
    return () => { this.subscribers.delete(fn); };
  }
  get head(): number { return this.eventSeq; }
}

function publicDef(d: StoredDef) {
  const { by: _by, ...rest } = d;
  return rest;
}
function summarize(d: Diff) {
  return { upserts: d.upserts.length, removes: d.removes.length, defs: d.defs.map((x) => x.ref), tiles: d.tiles.length, world: d.world ? Object.keys(d.world) : [], answers: d.answers.length };
}
