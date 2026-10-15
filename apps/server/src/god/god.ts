// God mode: the world owner's edge agent edits the world through the compiler
// (spec <eden4>/28 §6–§7). This service owns the entity model for one
// world process, persists commits, hands out god tokens by the same pairing
// pattern Souls use, keeps undo/redo, routes prayers, and publishes diffs to
// viewers (hub) and to gods (SSE).
import { randomBytes } from 'node:crypto';
import { TILE_M, tileOf } from '@sim/ground';
import { WorldModel, creationInputFailure, definitionRefs, coreLibrary, libraryRef, applyBatch, plan, batchSchema, hashOf, type Batch, type Diff, type Entity, type Failure, type Op, type Result, type StoredDef, type UsesHook, type PlanOptions } from '@sim/world-compiler';
import { hashToken } from '../auth.ts';
import type { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { WorldStore, GOD_EDIT_OUTCOME_BYTES, type EditRow, type PrayerRow } from './store.ts';
import { AssetStore, defaultAssetDir } from './assets.ts';
import { deferredOp } from './layers.ts';
import { RegistryCatalog } from '@sim/catalog';
import { registryCatalog } from './registry-catalog.ts';
import { submissionSchema, type Expectations } from './submission.ts';
import { GodBuilds, buildFieldSchema, type BuildBody, type BuildField, type BuildCaller, type BuildNotice, type BuildEcho, type Identity, type SiteDelta, type WorldBuildMessage } from './builds.ts';
import { Parts } from './parts.ts';
import { buildReceipt } from './build-integrity.ts';
export type { WorldBuildMessage } from './builds.ts';
const previewBatchSchema = batchSchema.extend({ build: buildFieldSchema.optional() });

const PAIR_TTL = 15 * 60_000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const humanCode = () => { const b = randomBytes(8); let s = ''; for (let i = 0; i < 8; i++) s += ALPHABET[b[i] % ALPHABET.length]; return `${s.slice(0, 4)}-${s.slice(4)}`; };
const normCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2');
export const newGodToken = (worldId: string) => `god_${worldId}_${randomBytes(24).toString('base64url')}`;

type Pairing = { code: string; poll: string; agent: string; expires: number; token?: string };
type Preview = { at: number; baseEditSeq: number; expect: Expectations; subtrees: Record<string, string[]>; affected: string[]; diff: Diff; ops: Batch; build?: BuildField; failures?: Failure[] };
export type WorldDiffMessage = { type: 'edge'; kind: 'world-diff'; seq: number; tick: number; at: number; now: number; builds?: SiteDelta[]; diff: Diff; by: 'god' | 'undo' | 'redo' | 'engine'; ground?: ReturnType<WorldModel['ground']>; /** every def the upserts reference (viewers only hold defs in use) */ defs: ReturnType<typeof publicDef>[] };
/** Called for every committed batch, in order, synchronously, before viewers hear of it (Stage B: the engine patches its Spatial here). */
export type CommitListener = (c: { seq: number; diff: Diff; kind: 'edit' | 'undo' | 'redo'; by: string; group?: string }) => void;
export type GodEvent = { id: number; event: 'diff' | 'prayer' | 'soul' | 'build'; data: unknown };

export type GodOptions = {
  worldId: string;
  /** Who may approve god pairing when the world has no owner yet (DEV_AUTH 'dev:admin' in local runs). */
  ownerId: string | null;
  tick: () => number;
  /** Viewer broadcast (the hub). */
  emit: (m: WorldDiffMessage | WorldBuildMessage) => void;
  now?: () => number;
  buildPauseMs?: number;
  buildClosureMs?: number;
  constants?: Partial<WorldModel['constants']>;
  seed?: string;
  /** A genesis/1 template applied once when the world is first created (worlds/templates/*.json). */
  genesis?: Genesis;
  /** Content-addressed asset files (default $ASSET_DIR or <DATA_DIR>/../assets), shared by every world on the box. */
  assetDir?: string;
  /** The shared def library (default: the process's core library; null = none, for tests of a bare world). */
  library?: import('@sim/world-compiler').DefLibrary | null;
};

/** genesis/1: constants, state and ordered batches that build a world from nothing (spec 29 §4.5). */
export type Genesis = { schema: 'genesis/1'; name?: string; description?: string; constants?: Partial<WorldModel['constants']>; state?: Record<string, unknown>; batches: { note?: string; group?: string; ops: unknown[] }[] };

export class GodMode {
  readonly store: WorldStore;
  readonly assets: AssetStore;
  readonly builds: GodBuilds;
  readonly parts: Parts;
  private caller: BuildCaller = {};
  private buildListeners: ((e: BuildNotice) => void)[] = [];
  onBuild(fn: (e: BuildNotice) => void): () => void { this.buildListeners.push(fn); return () => { this.buildListeners = this.buildListeners.filter(f => f !== fn); }; }
  as<T>(caller: BuildCaller, fn: () => T): T { const previous = this.caller; this.caller = caller; try { return fn(); } finally { this.caller = previous; } }
  now(): number { return (this.opts.now ?? Date.now)(); }
  model: WorldModel;
  catalog: RegistryCatalog | null;
  owner: string | null;
  private pairings = new Map<string, Pairing>();
  private commitListeners: CommitListener[] = [];
  /** Name of the genesis template this world was created from (null = empty plain). */
  template: string | null = null;
  private previews = new Map<string, Preview>();
  /** Subscribe to committed batches (ordered, synchronous). Returns an unsubscribe. */
  /** Body-aware edits (installed by the engine bridge): who uses an entity, and the warnings for bodies an
   *  accepted edit buries (the engine lifts them clear). Null in worlds without the engine. */
  bodies: { uses: UsesHook; lifted?: (ids: string[], after?: WorldModel) => string[]; refuse?: PlanOptions['refuse'] } | null = null;
  /** Bridge admission/decoration must run before the accepted receipt is persisted, and never on replay. */
  actGuard: ((batch: unknown) => Result | null) | null = null;
  finalizeAct: ((result: Result, after: WorldModel) => Result) | null = null;
  onCommit(fn: CommitListener): () => void { this.commitListeners.push(fn); return () => { this.commitListeners = this.commitListeners.filter((f) => f !== fn); }; }
  private subscribers = new Set<(e: GodEvent) => void>();
  private ring: GodEvent[] = [];
  private eventSeq = 0;

  readonly db: Db; readonly opts: GodOptions;
  // Existing diff-only embedders remain source compatible; new consumers can explicitly accept both feeds.
  constructor(db: Db, opts: Omit<GodOptions, 'emit'> & { emit: (m: WorldDiffMessage) => void });
  constructor(db: Db, opts: GodOptions);
  constructor(db: Db, opts: GodOptions | (Omit<GodOptions, 'emit'> & { emit: (m: WorldDiffMessage) => void })) {
    this.db = db; this.opts = opts as GodOptions;
    this.store = new WorldStore(db, opts.worldId);
    this.assets = new AssetStore({ dir: opts.assetDir ?? defaultAssetDir(), db, worldId: opts.worldId });
    // CATRUN (engine fix i): the core kit is one shared, content-addressed library per process, referenced by version
    // (libraryRef), never copied into a world. A world stores only the defs it uses, adopted (pinned by hash) the first
    // time something is placed from them; its own stored hashes always win, so old worlds resolve exactly as before and
    // new core types appear in every world at zero cost.
    const meta = this.store.meta(), owner = meta ? meta.owner : opts.ownerId;
    const library = opts.library === undefined ? registryCatalog(owner) ?? coreLibrary() : opts.library;
    this.catalog = library instanceof RegistryCatalog ? library : null;
    const loaded = this.store.load(this.assets.lookup, library);
    if (loaded) { this.model = loaded.model; this.owner = loaded.owner; }
    else {
      this.model = new WorldModel({ constants: { ground: 'land', extent: 1000, ...opts.constants, ...opts.genesis?.constants } as never, seed: opts.seed ?? `${opts.worldId}:genesis`, assets: this.assets.lookup });
      this.model.library = library;
      this.owner = opts.ownerId;
      this.store.init(this.model, this.owner);
    }
    this.builds = new GodBuilds(this.store, { model: () => this.model, now: () => this.now(), pauseMs: opts.buildPauseMs, closureMs: opts.buildClosureMs,
      emit: m => { try { this.opts.emit(m); } catch { /* viewers are best effort */ } },
      receipt: (id, body) => this.checkBuild(id, body)?.receipt,
      notice: e => { this.push('build', e); for (const fn of this.buildListeners) { try { fn(e); } catch { /* listeners must not turn a committed edit into a refusal */ } } },
    });
    this.parts = new Parts(this.store, { model: () => this.model, now: () => this.now() });
    this.onBuild(e => { if (e.kind === 'done') this.parts.onDone(e.id); });
    this.parts.backfill();
    if (!loaded && opts.genesis) this.applyGenesis(opts.genesis);
  }

  // ---------- authority ----------

  /** The owner is the first approving user when the world has none yet; afterwards only that user (or an admin). */
  canApprove(user: { id: string; role: string }): boolean { return user.role === 'admin' || !this.owner || this.owner === user.id; }
  claim(user: { id: string }) {
    if (!this.owner) {
      this.owner = user.id; this.store.setOwner(this.model, this.owner);
      if (this.opts.library === undefined && this.catalog) {
        this.catalog = registryCatalog(this.owner); this.model.library = this.catalog;
      }
    }
  }
  godIdentity(token: string | undefined): Identity | null { if (!token?.startsWith('god_')) return null; const hash = hashToken(token); return this.store.hasToken(hash) ? { hash, label: this.store.tokenLabel(hash) ?? 'an agent' } : null; }
  godFromToken(token: string | undefined): boolean { return this.godIdentity(token) !== null; }

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
    this.builds.sweep();
    const inputFailure = creationInputFailure(batch); if (inputFailure) return { accepted: false as const, failures: [inputFailure] };
    const parsed = previewBatchSchema.safeParse(batch); if (!parsed.success) return { accepted: false as const, failures: parsed.error.issues.map(i => ({ op: -1, code: 'schema', field: i.path.join('.'), detail: i.message })) };
    const off = deferredOp(parsed.data); if (off) return { accepted: false as const, failures: [off] };
    const admission = this.builds.admit(parsed.data.build ?? this.caller.build, parsed.data, this.caller.identity); if (admission.failures) return { accepted: false as const, failures: admission.failures };
    const p = plan(this.model, { ...parsed.data, group: admission.group }, 'god', this.opts.tick(), { uses: this.bodies?.uses, refuse: (after, diff, ops) => { const refused = this.bodies?.refuse?.(after, diff, ops); if (refused) return refused; const check = this.builds.check(admission, this.model, after, diff, ops); return 'failure' in check ? check.failure : null; } });
    return p.ok ? { accepted: true as const, ids: p.ids, warnings: p.warnings, diff: summarize(p.diff) } : { accepted: false as const, failures: p.failures };
  }
  act(batch: unknown, note?: string): Result {
    const result = this.commitBatch(batch, note);
    if (!result.accepted) {
      const input = batch as { build?: BuildField; preview?: string } | null;
      this.builds.recordRefusal(input?.build ?? (input?.preview ? this.getPreview(input.preview)?.build : this.caller.build), result.failures);
    }
    return result;
  }
  /** Only server-owned genesis import can request trusted library adoption; request JSON cannot enable it. */
  private commitBatch(batch: unknown, note?: string, trusted = false): Result {
    this.builds.sweep();
    const inputFailure = creationInputFailure(batch); if (inputFailure) return { accepted: false, failures: [inputFailure] };
    const parsed = submissionSchema.safeParse(batch);
    if (!parsed.success) return { accepted: false, failures: parsed.error.issues.map((i) => ({ op: typeof i.path[1] === 'number' ? i.path[1] : -1, code: 'schema', field: i.path.join('.'), detail: i.message, fix: 'Use the operation shape in GET /v1/god/schema.' })) };
    const input = parsed.data;
    // This canonical envelope survives preview expiry/restart. payloadHash below additionally binds the sealed ops.
    const requestHash = hashOf({ batch: input, note: note ?? input.note ?? null });
    if (input.clientRef !== undefined) { const saved = this.store.retry(input.clientRef, requestHash); if (saved) return saved; }
    let normalized: Batch;
    let preview: Preview | null = null;
    if (input.preview !== undefined) {
      preview = this.getPreview(input.preview);
      if (!preview) return { accepted: false, failures: [{ op: -1, code: 'revision.stale', field: 'preview', detail: `Preview ${input.preview} expired or is unknown.`, fix: 'Create a new preview and commit its id.' }] };
      if (preview.failures) return { accepted: false, failures: structuredClone(preview.failures) };
      if ((input.ops && hashOf(input.ops) !== hashOf(preview.ops.ops)) || (input.group !== undefined && input.group !== preview.ops.group) || (input.note !== undefined && input.note !== preview.ops.note) || (input.build !== undefined && hashOf(input.build) !== hashOf(preview.build ?? null))) return { accepted: false, failures: [{ op: -1, code: 'schema', field: 'preview', detail: 'The submitted operations or batch metadata differ from the sealed preview.', fix: 'Commit with {preview, clientRef}, or create a new preview for the changed batch.' }] };
      normalized = { ...preview.ops, clientRef: input.clientRef };
    } else normalized = batchSchema.parse(input);
    const field = preview ? preview.build : input.build ?? this.caller.build;
    const stale = [...this.stale(preview?.expect ?? {}), ...this.staleSubtrees(preview), ...this.stale(input.expect ?? {})];
    if (stale.length) return { accepted: false, failures: [...new Map(stale.map(f => [f.entity, f])).values()] };
    for (const [i, op] of normalized.ops.entries()) if (op.op === 'answer' && !this.store.prayer(op.prayer)) return { accepted: false, failures: [{ op: i, code: 'params.invalid', field: 'prayer', detail: `Unknown prayer ${op.prayer}.`, fix: 'Use an id from GET /v1/god/prayers.' }] };
    const admission = this.builds.admit(field, normalized, this.caller.identity); if (admission.failures) return { accepted: false, failures: admission.failures };
    normalized.group = admission.group;
    const journalNote = note ?? normalized.note;
    const payloadHash = hashOf({ batch: normalized, build: field ?? null, expect: input.expect, preview: input.preview, note: journalNote ?? null });
    const guard = this.actGuard?.(normalized); if (guard) return guard;
    const off = deferredOp(normalized); if (off) return { accepted: false, failures: [off] } as Result;
    const tick = this.opts.tick();
    // Keep public state untouched until SQL succeeds. No SQL write lock is held while planning or baking.
    const next = this.model.fork();
    const lifted: string[] = [];
    let made: string[] = [];
    const r = applyBatch(next, normalized, 'god', tick, { trusted, uses: this.bodies?.uses, refuse: (after, diff, ops) => {
      const refused = this.bodies?.refuse?.(after, diff, ops); if (refused) return refused;
      const check = this.builds.check(admission, this.model, after, diff, ops); if ('failure' in check) return check.failure; made = check.made;
      // Warning geometry uses the same typed bake boundary as admission, before any live/SQL mutation.
      if (this.bodies?.lifted) lifted.push(...this.bodies.lifted(diff.upserts.map(e => e.id), after));
      return null;
    } });
    if (preview && r.result.accepted) {
      const affected = new Set(preview.affected);
      const added = [...new Set([...r.diff!.upserts.map(e => e.id), ...r.diff!.removes])].filter(id => this.model.entities.has(id) && !affected.has(id));
      if (added.length) return { accepted: false, failures: added.map(id => ({ op: -1, code: 'revision.stale', entity: id, field: 'preview.affected', detail: `${this.model.pathOf(id)} would now be changed by this batch but was absent from the preview.`, measured: { id, v: this.model.entities.get(id)!.v }, fix: 'Create a new preview including the newly affected entities.' })) };
    }
    if (r.result.accepted) r.result.warnings.push(...lifted);
    const result = this.finalizeAct?.(r.result, next) ?? r.result;
    if (!result.accepted) return result;
    const at = this.now(), roots = this.builds.rootsDelta(this.model, next, r.diff!, 'edit', field);
    const updates = this.builds.writes(admission, roots, result.seq, at, this.caller.identity, undefined, false, made, journalNote);
    if (updates.failures) return { accepted: false, failures: updates.failures };
    for (const w of updates.writes) if (w.status === 'done' && w.next.done) {
      const pending: EditRow = { seq: result.seq, by: 'god', at, note: journalNote ?? null, grp: normalized.group ?? null, ops: normalized.ops, inverse: r.inverse!, kind: 'edit', undone: 0, undo_of: null };
      const targets = [pending, ...this.store.groupEditsUnder(w.id, false, 2_147_483_647)], undo = this.preflightUndo(targets, next, false);
      w.next.done.receipt = buildReceipt(next.fork(), { ...this.builds.body(w.id)!, ...w.next }, targets, undo.ok ? { ok: true, baseline: undo.model } : undo, at); w.receipt = w.next.done.receipt;
      const durable = structuredClone(w.next); delete durable.done!.receipt; w.body = JSON.stringify(durable);
    }
    result.warnings.push(...admission.warnings, ...roots.warnings, ...updates.warnings);
    result.warnings.push(...this.parts.warnings(normalized.ops));
    if (updates.echo) (result as typeof result & { build: BuildEcho }).build = updates.echo;
    // SQL fills in the real revision. Reserve its widest safe integer representation before admission.
    const bytes = Buffer.byteLength(JSON.stringify(result), 'utf8') + (updates.echo ? String(Number.MAX_SAFE_INTEGER).length - 1 : 0);
    if (normalized.clientRef !== undefined && bytes > GOD_EDIT_OUTCOME_BYTES) return { accepted: false, failures: [{ op: -1, code: 'request.budget', field: 'result', detail: `Accepted result would require ${bytes} bytes; receipt limit is ${GOD_EDIT_OUTCOME_BYTES}.`, measured: bytes, limit: GOD_EDIT_OUTCOME_BYTES, fix: 'Submit a smaller batch using a fresh clientRef.' }] };
    const { ops, group, clientRef } = normalized;
    const concurrent = this.store.commit(next, this.owner, r.diff!, { seq: result.seq, by: 'god', at, note: journalNote, group, ops, inverse: r.inverse!, kind: 'edit', builds: updates.writes, origins: this.parts.origins(ops, next, this.caller.identity) }, clientRef === undefined ? undefined : { clientRef, requestHash, payloadHash, result });
    if (concurrent) return concurrent;
    if (updates.echo) updates.echo.rev = updates.writes.find(w => w.echo)!.rev!;
    Object.assign(this.model, next); // preserve bridge/nav references and WeakMap keys
    const deltas = this.builds.accepted(updates.writes);
    this.notify(result.seq, r.diff!, 'edit', group);
    this.publish(result.seq, tick, r.diff!, 'god', deltas);
    this.builds.announceCommitted(updates.writes);
    for (const a of r.diff!.answers) { const row = this.store.prayer(a.prayer); if (row) this.push('prayer', row); }
    return result;
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
    this.builds.sweep();
    const field = this.caller.build;
    // Undo keeps the journal's original group. Only a supplied build needs admission; ordinary undo remains legal.
    const admission = this.builds.admit(field, {}, this.caller.identity);
    if (admission.failures) return { accepted: false, failures: admission.failures };
    const tick = this.opts.tick();
    const next = this.model.fork();
    let made: string[] = [];
    const r = applyBatch(next, { ops: target.inverse }, 'god', tick, { trusted: true, uses: this.bodies?.uses, refuse: (after, diff, ops) => {
      const refused = this.bodies?.refuse?.(after, diff, ops); if (refused) return refused;
      const check = this.builds.check(admission, this.model, after, diff, ops, true); if ('failure' in check) return check.failure; made = check.made; return null;
    } });
    if (!r.result.accepted) return { ...r.result, failures: r.result.failures.map((f) => ({ ...f, code: f.code.endsWith('.by-body') || f.code.startsWith('build.') ? f.code : 'undo.conflict' })) };
    const at = this.now(), roots = this.builds.rootsDelta(this.model, next, r.diff!, kind, field), updates = this.builds.writes(admission, roots, r.result.seq, at, this.caller.identity, target.grp ?? undefined, true, made);
    if (updates.failures) return { accepted: false, failures: updates.failures };
    r.result.warnings.push(...roots.warnings, ...updates.warnings);
    if (updates.echo) (r.result as typeof r.result & { build: BuildEcho }).build = updates.echo;
    const refused = this.store.commit(next, this.owner, r.diff!, { seq: r.result.seq, by: 'god', at, note: `${kind} of ${target.seq}`, group: target.grp ?? undefined, ops: target.inverse, inverse: r.inverse!, kind, undoOf: target.seq, builds: updates.writes });
    if (refused) return refused;
    Object.assign(this.model, next);
    if (updates.echo) updates.echo.rev = updates.writes.find(w => w.echo)!.rev!;
    const deltas = this.builds.accepted(updates.writes);
    this.notify(r.result.seq, r.diff!, kind, target.grp ?? undefined);
    this.publish(r.result.seq, tick, r.diff!, kind, deltas);
    this.builds.announceCommitted(updates.writes);
    return { ...r.result, reverted: target.seq };
  }

  /** A trusted edit the engine made (a Soul moved a thing, a body was born or retired): journaled by 'engine',
   *  never the god's to undo (and it does not clear the redo stack), published to viewers, not sent to onCommit. */
  engineAct(ops: Op[], note: string): Result {
    const tick = this.opts.tick();
    const next = this.model.fork();
    const r = applyBatch(next, { ops }, 'engine', tick, { trusted: true });
    if (!r.result.accepted) return r.result;
    const roots = this.builds.rootsDelta(this.model, next, r.diff!, 'engine'), updates = this.builds.writes({ warnings: [] }, roots, r.result.seq, this.now());
    if (updates.failures) return { accepted: false, failures: updates.failures };
    const refused = this.store.commit(next, this.owner, r.diff!, { seq: r.result.seq, by: 'engine', at: this.now(), note, ops, inverse: [], kind: 'engine', builds: updates.writes });
    if (refused) return refused;
    Object.assign(this.model, next);
    const deltas = this.builds.accepted(updates.writes);
    this.publish(r.result.seq, tick, r.diff!, 'engine', deltas);
    this.builds.announceCommitted(updates.writes);
    return r.result;
  }

  /** Shared inverse-chain preflight for atomic undo and checked build receipts. No live writes or events. */
  preflightUndo(targets: EditRow[], source = this.model, withCaller = true, releaseClaims?: string) {
    let model = source.fork(), rev = this.store.buildsRev();
    const builds = this.builds.fork(() => model, releaseClaims), entries = [];
    const field = withCaller ? this.caller.build : undefined, tick = this.opts.tick(), at = this.now();
    for (const target of targets) {
      const admission = builds.admit(field, {}, this.caller.identity);
      if (admission.failures) return { ok: false as const, failed: target.seq, failures: admission.failures };
      const next = model.fork(); let made: string[] = [];
      const r = applyBatch(next, { ops: target.inverse }, 'god', tick, { trusted: true, uses: this.bodies?.uses, refuse: (after, diff, ops) => {
        const refused = this.bodies?.refuse?.(after, diff, ops); if (refused) return refused;
        const check = builds.check(admission, model, after, diff, ops, true);
        if ('failure' in check) return check.failure; made = check.made; return null;
      } });
      if (!r.result.accepted) return { ok: false as const, failed: target.seq, failures: r.result.failures.map(f => ({ ...f, code: f.code.endsWith('.by-body') || f.code.startsWith('build.') ? f.code : 'undo.conflict' })) };
      const roots = builds.rootsDelta(model, next, r.diff!, 'undo', field);
      const updates = builds.writes(admission, roots, r.result.seq, at, this.caller.identity, target.grp ?? undefined, true, made);
      if (updates.failures) return { ok: false as const, failed: target.seq, failures: updates.failures };
      // Mirror SQL's global revision sequence so each later planned row expects the preceding write.
      for (const w of updates.writes) w.rev = ++rev;
      r.result.warnings.push(...roots.warnings, ...updates.warnings);
      entries.push({ model: next, diff: r.diff!, edit: { seq: r.result.seq, by: 'god', at, note: `undo of ${target.seq}`, group: target.grp ?? undefined, ops: target.inverse, inverse: r.inverse!, kind: 'undo' as const, undoOf: target.seq, builds: updates.writes }, updates, tick });
      model = next; builds.accepted(updates.writes);
    }
    return { ok: true as const, entries, model };
  }
  checkBuild(id: string, override?: BuildBody) {
    const status = this.builds.status(id), saved = this.builds.body(id), body = saved && override ? { ...saved, ...override } : saved; if (!status || !body) return null;
    const targets = this.store.groupEditsUnder(id, false, 2_147_483_647), undo = this.preflightUndo(targets, this.model, false, override && !override.claims.some(c => c.status === 'held') ? id : undefined);
    const receipt = buildReceipt(this.model.fork(), body, targets, undo.ok ? { ok: true, baseline: undo.model } : undo, this.now());
    return { ...status, receipt };
  }
  private undoTargets(targets: EditRow[], emptyOK: boolean, releaseClaims?: string) {
    const notReverted = targets.map(e => e.seq), preflight = this.preflightUndo(targets, this.model, true, releaseClaims);
    if (!preflight.ok) return { accepted: false, reverted: [] as number[], notReverted, failed: preflight.failed, failures: preflight.failures };
    if (!targets.length && !emptyOK) return { accepted: false, reverted: [], notReverted, failures: [{ op: -1, code: 'undo.conflict', detail: 'no edits in group' }] };
    const refusal = this.store.commitSequence(this.owner, preflight.entries);
    if (refusal) return { accepted: false, reverted: [] as number[], notReverted, ...(!refusal.accepted ? { failures: refusal.failures } : {}) };
    // Make the complete result visible before invoking observers; an observer cannot expose a half-reverted world.
    const frames = preflight.entries.map(entry => ({ entry, deltas: this.builds.accepted(entry.updates.writes) }));
    if (preflight.entries.length) Object.assign(this.model, preflight.model);
    const warnings: string[] = [];
    for (const { entry, deltas } of frames) {
      try { this.notify(entry.edit.seq, entry.diff, 'undo', entry.edit.group); } catch (error) { warnings.push(`Undo committed; observer failed: ${String(error).slice(0, 200)}`); }
      this.publish(entry.edit.seq, entry.tick, entry.diff, 'undo', deltas, entry.model);
      this.builds.announceCommitted(entry.updates.writes);
    }
    const echoed = [...preflight.entries].reverse().find(e => e.updates.echo), echo = echoed?.updates.echo;
    if (echo) echo.rev = echoed!.updates.writes.find(w => w.echo)!.rev!;
    return { accepted: true, reverted: notReverted, notReverted: [] as number[], ...(echo ? { build: echo } : {}), ...(warnings.length ? { warnings } : {}) };
  }
  undoGroup(group: string) {
    // A build owns its lead group and every claim/subgroup, including after finish.
    return this.store.build(group) ? this.undoGroupUnder(group) : this.undoTargets(this.store.groupEdits(group), false);
  }
  /** No 200/500-entry truncation, and no prefix collision with a neighbouring build/chapter. */
  undoGroupUnder(group: string, force = false) { return this.undoTargets(this.store.groupEditsUnder(group, false, 2_147_483_647), true, force ? group : undefined); }
  /** Dry-run a batch and keep its would-be diff for a ghost preview (?preview=<id>), 10 minutes. */
  preview(batch: unknown) {
    this.builds.sweep();
    const inputFailure = creationInputFailure(batch); if (inputFailure) return { id: null, accepted: false as const, failures: [inputFailure] };
    const parsed = previewBatchSchema.safeParse(batch);
    if (!parsed.success) return { id: null, accepted: false as const, failures: [{ op: -1, code: 'schema', field: parsed.error.issues[0]?.path.join('.'), detail: parsed.error.issues.map(i => i.message).join('; '), fix: 'Use a valid edit batch from GET /v1/god/schema.' }] };
    const off = deferredOp(parsed.data); if (off) return { id: null, accepted: false as const, failures: [off] };
    const build = parsed.data.build ?? this.caller.build, admission = this.builds.admit(build, parsed.data, this.caller.identity);
    if (admission.failures) return { id: null, accepted: false as const, failures: admission.failures };
    const p = plan(this.model, { ...parsed.data, group: admission.group }, 'god', this.opts.tick(), { uses: this.bodies?.uses, refuse: (after, diff, ops) => { const refused = this.bodies?.refuse?.(after, diff, ops); if (refused) return refused; const check = this.builds.check(admission, this.model, after, diff, ops); return 'failure' in check ? check.failure : null; } });
    const id = 'pv_' + randomBytes(6).toString('hex');
    for (const [k, v] of this.previews) if (Date.now() - v.at > 600_000) this.previews.delete(k);
    while (this.previews.size >= 100) this.previews.delete(this.previews.keys().next().value!);
    const baseEditSeq = this.model.editSeq;
    const diff: Diff = p.ok ? p.diff : { upserts: [], removes: [], defs: [], tiles: [], answers: [] };
    const { expect, subtrees } = this.captureRevisions(parsed.data, diff);
    const affected = [...new Set([...diff.upserts.map(e => e.id), ...diff.removes])].filter(id => this.model.entities.has(id));
    this.previews.set(id, { at: Date.now(), baseEditSeq, expect, subtrees, affected, diff, ops: batchSchema.parse(parsed.data), build: structuredClone(build), ...(!p.ok ? { failures: p.failures } : {}) });
    if (!p.ok) return { id, accepted: false as const, failures: p.failures };
    return { id, accepted: true as const, baseEditSeq, expect, subtrees, summary: summarize(p.diff), url: `?preview=${id}` };
  }
  getPreview(id: string) { const v = this.previews.get(id); if (!v || Date.now() - v.at > 600_000) return null; return v; }
  /** Revision guards check only referenced/touched entities, never the world's global edit sequence. */
  private stale(expect: Expectations): Failure[] {
    return Object.entries(expect).flatMap(([ref, expected]) => {
      const current = this.model.get(ref);
      return current?.id === expected.id && current.v === expected.v ? [] : [{ op: -1, code: 'revision.stale', entity: expected.id, field: `expect.${ref}`, detail: `${ref} changed: expected ${expected.id} v${expected.v}; now ${current ? `${current.id} v${current.v}` : 'missing'}.`, measured: current ? { id: current.id, v: current.v } : null, limit: expected, fix: 'Read the current entity and create a fresh preview.' }];
    });
  }
  private staleSubtrees(preview: Preview | null): Failure[] {
    return Object.entries(preview?.subtrees ?? {}).flatMap(([id, expected]) => {
      const current = this.model.entities.has(id) ? this.model.subtree(id).sort() : [];
      if (hashOf(current) === hashOf(expected)) return [];
      const before = new Set(expected), after = new Set(current);
      return [{ op: -1, code: 'revision.stale', entity: id, field: `preview.subtrees.${id}`, detail: `${this.model.pathOf(id) || id}: subtree membership changed since preview.`, measured: { added: current.filter(x => !before.has(x)), removed: expected.filter(x => !after.has(x)) }, fix: 'Create a fresh preview that includes the current subtree.' }];
    });
  }
  private captureRevisions(batch: Batch, diff: Diff): { expect: Expectations; subtrees: Record<string, string[]> } {
    const expect: Expectations = {}, subtrees: Record<string, string[]> = {};
    const add = (ref: string | undefined) => {
      if (!ref || ref === 'world' || ref.startsWith('$')) return;
      const e = this.model.get(ref); if (!e) return;
      expect[ref] = { id: e.id, v: e.v };
      for (const id of this.model.ancestors(e.id)) { const parent = this.model.entities.get(id)!; expect[id] = { id, v: parent.v }; }
    };
    const constraints = (e: Pick<Entity, 'constraints'>) => { for (const c of e.constraints ?? []) if ('ref' in c) add(c.ref); };
    for (const op of batch.ops) {
      if ('id' in op) {
        add(op.id);
        const e = this.model.get(op.id); if (e) {
          constraints(e);
          if (op.op === 'clone' || op.op === 'remove' || op.op === 'move' || (op.op === 'set' && op.params)) {
            subtrees[e.id] = this.model.subtree(e.id).sort();
            for (const id of subtrees[e.id]) { add(id); constraints(this.model.entities.get(id)!); }
          }
        }
      }
      if ('in' in op) add(op.in?.parent);
      if ('constraints' in op) constraints(op);
      if (op.op === 'relate') for (const ref of [op.a, op.b]) if (ref.startsWith('thing:')) add(ref.slice(6));
      if (op.op === 'place' || op.op === 'set') {
        const e = op.op === 'set' ? this.model.get(op.id) : undefined;
        const def = this.model.resolvedDef(op.op === 'place' ? op.def : e?.def ?? '');
        for (const kind of ['params', 'state'] as const) for (const [key, value] of Object.entries(op[kind] ?? {})) if (def?.[kind][key]?.type === 'ref' && typeof value === 'string') add(value);
      }
    }
    for (const e of diff.upserts) if (this.model.entities.has(e.id)) { add(e.id); constraints(e); }
    for (const id of diff.removes) add(id);
    return { expect, subtrees };
  }
  /** The god's recent previews, newest first (the panel lists them to show as ghosts). */
  listPreviews() { const now = Date.now(); return [...this.previews].filter(([, v]) => now - v.at <= 600_000).sort((a, b) => b[1].at - a[1].at).slice(0, 20).map(([id, v]) => ({ id, at: v.at, accepted: !v.failures, summary: v.failures ? null : summarize(v.diff) })); }
  private notify(seq: number, diff: Diff, kind: 'edit' | 'undo' | 'redo', group?: string) {
    for (const fn of this.commitListeners) fn({ seq, diff, kind, by: 'god', group });
  }
  private publish(seq: number, tick: number, diff: Diff, by: WorldDiffMessage['by'], builds: SiteDelta[] = [], source = this.model) {
    const referenced = new Map<string, StoredDef>();
    for (const e of diff.upserts) for (let ref: string | undefined = e.def; ref; ref = referenced.get(ref)?.extends) { const d = source.def(ref); if (!d || referenced.has(ref)) break; referenced.set(ref, d); }
    const now = this.now();
    const m: WorldDiffMessage = { type: 'edge', kind: 'world-diff', seq, tick, at: now, now, diff, by, defs: [...referenced.values()].map(publicDef), ...(builds.length ? { builds } : {}), ...(diff.tiles.length || diff.constants ? { ground: source.ground() } : {}) };
    try { this.opts.emit(m); } catch { /* viewers are best-effort */ }
    this.push('diff', m);
  }

  /** Apply a template's batches through the compiler (each atomic, journaled like a god edit). Throws on the first refusal. */
  applyGenesis(g: Genesis) {
    if (g.schema !== 'genesis/1') throw new Error('genesis: schema must be genesis/1');
    if (g.state) { const r = this.act({ ops: [{ op: 'world', state: g.state }], group: 'genesis' }, 'genesis: state'); if (!r.accepted) throw new Error(`genesis state refused: ${JSON.stringify(r.failures)}`); }
    for (const [i, b] of g.batches.entries()) {
      const r = this.commitBatch({ ops: b.ops, group: b.group ?? 'genesis' }, `genesis ${i + 1}/${g.batches.length}${b.note ? ': ' + b.note : ''}`, true);
      if (!r.accepted) throw new Error(`genesis batch ${i + 1} (${b.note ?? ''}) refused: ${JSON.stringify(r.failures).slice(0, 600)}`);
    }
    this.template = g.name ?? 'custom';
  }

  // ---------- reads ----------

  /** What a viewer (or anyone) may read: constants, state, every entity, the defs in use, the ground recipe. */
  publicSnapshot() {
    const builds = this.builds.publicList();
    const s = this.model.snapshot();
    const used = new Set<string>(), pending = s.entities.flatMap(e => [e.def, ...definitionRefs(e.params)]);
    while (pending.length) {
      const d = this.model.def(pending.pop()!); if (!d || used.has(d.hash)) continue; used.add(d.hash);
      pending.push(...definitionRefs({extends:d.extends,make:d.make,contents:d.contents,params:d.params,components:d.components}));
    }
    const defs = s.defs.filter(d => used.has(d.hash));
    // byte size of every GLB these defs load (from the asset index), so a viewer's loading bar knows the total up front
    const assetBytes: Record<string, number> = {};
    for (const d of defs) for (const sha of JSON.stringify(d.make ?? null).match(/[0-9a-f]{64}/g) ?? []) { const m = this.assets.info(sha); if (m?.ext === 'glb' && m.bytes > 0) assetBytes[sha] = m.bytes; }
    // LAYERS: wallets are private (the god's GET /v1/god/layers and each Soul's /v1/world/layers/me have them)
    const state = s.state.layers ? { ...s.state, layers: { ...s.state.layers, wallets: {} } } : s.state;
    return { contract: 'world/1', worldId: this.opts.worldId, seq: s.editSeq, counter: s.seq, seed: s.seed, tick: this.opts.tick(), constants: s.constants, state, ground: s.ground, defs: defs.map(publicDef), entities: s.entities, assetBytes, builds: builds.builds, buildsRev: builds.rev, now: builds.now };
  }
  /** Demand logging is outside the catalogue registry. Keep only a bounded set of misses in this world's DB. */
  recordFindMiss(query: string) {
    this.db.db.exec('CREATE TABLE IF NOT EXISTS god_find_misses_v1 (world_id TEXT NOT NULL, at INTEGER NOT NULL, query TEXT NOT NULL, PRIMARY KEY(world_id, at, query)) WITHOUT ROWID');
    this.db.db.prepare('INSERT OR IGNORE INTO god_find_misses_v1 VALUES (?,?,?)').run(this.opts.worldId, Date.now(), query.slice(0, 400));
    this.db.db.prepare('DELETE FROM god_find_misses_v1 WHERE world_id=? AND (at,query) NOT IN (SELECT at,query FROM god_find_misses_v1 WHERE world_id=? ORDER BY at DESC,query LIMIT 1000)').run(this.opts.worldId, this.opts.worldId);
  }
  /** God sees the same plus the whole library, prayers waiting, tokens and the edit journal head. */
  godSnapshot() {
    const pub = this.publicSnapshot();
    return { ...pub, library: this.model.allDefs().map(publicDef), libraryRef: this.model.library ? libraryRef(this.model.library) : null,
      ...(this.catalog ? { exportBlockedHashes: pub.defs.filter((d) => !this.catalog!.canExport(d.hash)).map((d) => d.hash) } : {}),
      owner: this.owner, prayers: this.store.prayers({ unanswered: true, limit: 50 }), undoable: this.store.undoable()?.seq ?? null, redoable: this.store.redoable()?.seq ?? null, tokens: this.store.tokens().length };
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
    this.builds.sweep();
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
