// Build records are server metadata, never entity state. Planning is pure; only committed writes replace the cache.
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { hashOf, obbOverlap, type Batch, type Diff, type Failure, type WorldModel, type OBB, type Op } from '@sim/world-compiler';
import { type BuildRow, type BuildWrite, type EditRow, WorldStore } from './store.ts';

export const BUILD_LIMITS = { open: 8, roots: 256, closed: 200, claims: 8, retainedClaims: 32, made: 64, startPerMinute: 6, editsPerMinute: 120, bodyBytes: 65_536, transitionBytes: 256 } as const;
export const buildCodes = ['build.unknown', 'build.closed', 'build.exists', 'build.limit', 'build.site', 'build.group', 'build.lease', 'build.leased', 'build.claim', 'build.claimed', 'build.claim-unknown', 'build.claims-open', 'build.undo-incomplete'] as const;
const fixes: Record<typeof buildCodes[number], string> = {
  'build.unknown': '`build` lists open builds; use `build start <id>`.',
  'build.closed': 'Start a new build with a new id.',
  'build.exists': 'Pick a new id (church-2), or use `build resume <id>`.',
  'build.limit': 'Finish or abandon an open build (`build abandon <id>` for a long-paused one).',
  'build.site': 'Move or shrink the site or mass.',
  'build.group': 'Drop group, or carry the build.',
  'build.lease': 'Use `build resume <id>` to see who leads now.',
  'build.leased': 'Wait, ask the lead, or use `build resume <id> --take` if it has stopped.',
  'build.claim': 'Edit only under the claim root or inside its region, or ask the lead.',
  'build.claimed': 'Release the claim or wait until its holder goes quiet.',
  'build.claim-unknown': 'Use `build resume <id>` to see the claims.',
  'build.claims-open': 'Release live claims, or use --force.',
  'build.undo-incomplete': 'The build stays open; see notReverted.',
};
export const buildFailure = (code: typeof buildCodes[number], detail: string, field = 'build', extra: Partial<Failure> = {}): Failure => ({ op: -1, code, detail, field, fix: fixes[code], ...extra });
/** Leave room for lazy pause/closure markers on all author-controlled writes. */
export function buildBodyFailure(body: string, reserve = true): Failure | undefined {
  const measured = Buffer.byteLength(body), limit = BUILD_LIMITS.bodyBytes - (reserve ? BUILD_LIMITS.transitionBytes : 0);
  if (measured > limit) return buildFailure('build.limit', `Build body requires ${measured} bytes; limit is ${limit}.`, 'build', { measured, limit, fix: 'Shorten the note, summary or step labels, or finish this build and start a new one.' });
}
const fail = (code: typeof buildCodes[number], detail: string, field?: string, extra?: Partial<Failure>) => ({ ok: false as const, failures: [buildFailure(code, detail, field, extra)] });
const schemaFailure = (error: z.ZodError) => ({ ok: false as const, failures: error.issues.map(i => ({ op: -1, code: 'schema', field: i.path.join('.'), detail: i.message, fix: 'Use the build shapes in GET /v1/god/schema.' })) });
const pair = z.tuple([z.number().finite(), z.number().finite()]);
const idSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);
const labelSchema = z.string().min(1).max(60);
export const buildFieldSchema = z.object({ id: idSchema, lease: z.string().regex(/^l_[0-9a-f]{8}$/).optional(), claim: z.string().regex(/^c_[0-9a-f]{8}$/).optional(), step: z.number().int().min(0).max(999).optional(), label: z.string().max(60).optional(), done: z.boolean().optional() }).strict().refine(f => (f.lease !== undefined) !== (f.claim !== undefined), 'Supply exactly one of lease and claim.');
const siteSchema = z.object({ at: pair, size: z.tuple([z.number().min(1).max(200), z.number().min(1).max(200)]), yaw: z.number().finite().default(0) }).strict();
export const massSchema = z.object({ name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,18}$/).optional(), at: pair, size: z.tuple([z.number().positive().max(200), z.number().positive().max(200)]), h: z.number().min(.5).max(120), yaw: z.number().finite().optional(), roof: z.enum(['flat', 'gable', 'pyramid']).optional() }).strict();
export const buildStartSchema = z.object({ id: idSchema, title: z.string().min(1).max(80), steps: z.array(labelSchema).min(1).max(24), site: siteSchema, massing: z.array(massSchema).max(8).default([]), brief: z.string().max(4000).optional(), root: z.string().min(1).max(300).optional() }).strict();
export const buildActionSchemas = {
  pause: z.object({ lease: z.string().regex(/^l_[0-9a-f]{8}$/).optional(), note: z.string().max(4000).optional() }).strict(),
  resume: z.object({ lease: z.string().regex(/^l_[0-9a-f]{8}$/).optional(), take: z.boolean().optional() }).strict(),
  done: z.object({ summary: z.string().max(4000).optional(), force: z.boolean().optional() }).strict(),
  abandon: z.object({ undo: z.boolean().optional(), force: z.boolean().optional() }).strict(),
  claim: z.object({ part: z.string().regex(/^[a-z0-9][a-z0-9-]{0,18}$/), root: z.string().min(1).max(300).optional(), region: siteSchema.optional(), take: z.string().regex(/^c_[0-9a-f]{8}$/).optional() }).strict().refine(c => !!(c.root || c.region || c.take), 'Supply a root, region, or stale claim to take.'),
  release: z.object({ done: z.boolean().optional() }).strict(),
};
export type BuildField = z.infer<typeof buildFieldSchema>;
export type Mass = z.infer<typeof massSchema>;
export type Site = z.infer<typeof siteSchema>;
export type Identity = { hash: string; label: string };
export type BuildCaller = { identity?: Identity; build?: BuildField };
export type Claim = { id: string; part: string; root?: string; region?: Site; made: string[]; step: { n: number; label: string }; status: 'held' | 'released' | 'done' | 'taken'; lastAt: number; holder: { label: string; hash8: string }; user: { hash8: string; tokenHash: string }; takenBy?: { claim: string; label: string; at: number } };
export type BuildBody = {
  id: string; title: string; plan: { steps: string[]; brief?: string }; site: Site; massing: Mass[]; roots: string[];
  lead: { lease: string; label: string; hash8: string; tokenHash: string; since: number };
  step: { n: number; label: string; at: number; seq: number | null };
  steps: { n: number; label: string; claim?: string; batches: number; firstSeq: number; lastSeq: number; at: number }[];
  claims: Claim[]; agents: { label: string; hash8: string; at: number }[]; pauses: number;
  firstEditAt?: number; lastEditAt?: number; paused?: { from: number; seenAt: number; explicit?: boolean; note?: string };
  closureLiftedAt?: number; done?: { at: number; summary?: string; byLabel: string };
  abandoned?: { at: number; undo?: { reverted: number[]; notReverted: number[] } }; startHash: string;
};
type Row = Omit<BuildRow, 'body'> & { body: BuildBody };
export type PublicSite = { id: string; title: string; status: BuildRow['status']; rev: number; lastAt: number; pauseAfterMs: number; closed: boolean; step: { n: number; label: string; of: number }; site: Site; massing: Mass[]; roots: string[]; claims: { part: string; status: Claim['status'] | 'stale' }[] };
export type SiteDelta = Pick<PublicSite, 'id' | 'rev' | 'status' | 'lastAt'> & { closed?: boolean; step?: PublicSite['step']; claim?: PublicSite['claims'][number]; rootsAdded?: string[]; rootsRemoved?: string[] };
export type BuildEcho = { id: string; status: BuildRow['status']; rev: number; group?: string; step: { n: number; label: string }; claim?: string };
export type BuildEventKind = 'started' | 'step' | 'alive' | 'paused' | 'resumed' | 'claimed' | 'released' | 'taken' | 'done' | 'abandoned' | 'closure-lifted';
export type WorldBuildMessage = { type: 'edge'; kind: 'world-build'; rev: number; now: number; event: Exclude<BuildEventKind, 'step'>; site?: PublicSite; delta?: SiteDelta };
export type BuildNotice = { kind: BuildEventKind; id: string; rev: number; now: number; delta: SiteDelta; view?: GodBuildView };
export type GodBuildView = Omit<BuildBody, 'lead' | 'roots' | 'claims' | 'massing'> & {
  status: BuildRow['status']; rev: number; createdAt: number; lastAt: number; pauseAfterMs: number; now: number; closed: boolean;
  lead: { label: string; hash8: string; since: number; live: boolean }; roots: { id: string; path: string }[];
  claims: (Omit<Claim, 'user' | 'status'> & { status: Claim['status'] | 'stale'; rootPath?: string })[];
  current: (BuildBody['steps'][number] & { recent: { seq: number; note: string | null; at: number }[] }) | null;
  next: { n: number; label: string } | null; massing: (Mass & { parts: number })[];
};
type RootChange = { added: string[]; removed: string[] };
export type RootsDelta = { changes: Map<string, RootChange>; warnings: string[] };
type PlannedWrite = BuildWrite & { kind: BuildEventKind; before: Row; next: BuildBody; roots: RootChange; claim?: PublicSite['claims'][number] };
type Admission = { field?: BuildField; row?: Row; mine?: LiveClaim; group?: string; warnings: string[]; failures?: Failure[] };
const lease = () => 'l_' + randomBytes(4).toString('hex');
const claimId = () => 'c_' + randomBytes(4).toString('hex');
const decode = (r: BuildRow): Row => ({ ...r, body: JSON.parse(r.body) });
const open = (r: Pick<Row, 'status'>) => r.status === 'active' || r.status === 'paused';
export const effective = (r: Pick<Row, 'status' | 'last_at'>, now: number, pauseMs: number): BuildRow['status'] => r.status === 'active' && now - r.last_at > pauseMs ? 'paused' : r.status;
/** Same yaw convention as model.worldPose (local +x rotates toward -z). */
export function siteLocal(site: Site, p: [number, number]): [number, number] { const x = p[0] - site.at[0], z = p[1] - site.at[1], c = Math.cos(site.yaw), s = Math.sin(site.yaw); return [x * c - z * s, x * s + z * c]; }
export function siteWorld(site: Site, p: [number, number]): [number, number] { const c = Math.cos(site.yaw), s = Math.sin(site.yaw); return [site.at[0] + p[0] * c + p[1] * s, site.at[1] - p[0] * s + p[1] * c]; }
export function inSite(site: Site, p: [number, number], margin = 0): boolean { const [x, z] = siteLocal(site, p); return Math.abs(x) <= site.size[0] / 2 + margin && Math.abs(z) <= site.size[1] / 2 + margin; }
const box = (site: Site): OBB => ({ c: site.at, half: [site.size[0] / 2, site.size[1] / 2], yaw: site.yaw, y0: -1e6, y1: 1e6 });
const meets = (m: WorldModel, id: string, site: Site): boolean => { const fs = m.footprintsOf(id); if (fs.length) return fs.some(f => obbOverlap(f, box(site))); const p = m.worldPose(m.entities.get(id)!); return inSite(site, [p.x, p.z]); };
type Scope = { roots: Set<string>; region?: Site };
export type LiveClaim = Claim & { scope: Scope };
const scoped = (c: Claim): LiveClaim => ({ ...c, scope: { roots: new Set([...(c.root ? [c.root] : []), ...c.made]), ...(c.region ? { region: c.region } : {}) } });
const inScope = (m: WorldModel, id: string, roots: ReadonlySet<string>): boolean => {
  for (let e = m.entities.get(id); e; e = m.entities.get(e.in.parent)) if (roots.has(e.id)) return true;
  return false;
};
const newTops = (before: WorldModel, after: WorldModel, diff: Diff) => diff.upserts.filter(e => !before.entities.has(e.id) && (e.in.parent === 'world' || before.entities.has(e.in.parent)) && !after.resolvedDef(e.def)?.components.body).map(e => e.id);
/** A region owns only fully contained new tops, including every rotated footprint corner. */
function insideRect(m: WorldModel, id: string, region: Site): boolean {
  const fs = m.footprintsOf(id);
  if (!fs.length) { const p = m.worldPose(m.entities.get(id)!); return inSite(region, [p.x, p.z]); }
  return fs.every(f => [-1, 1].every(x => [-1, 1].every(z => inSite(region, siteWorld({ at: f.c, size: [f.half[0] * 2, f.half[1] * 2], yaw: f.yaw }, [x * f.half[0], z * f.half[1]])))));
}

/** Pure: scope is read from both worlds; speculative made ids never enter the cached claim. */
export function claimCheck(before: WorldModel, after: WorldModel, diff: Diff, ops: Op[], mine: LiveClaim | undefined, others: readonly LiveClaim[]): { failure: Failure } | { made: string[] } {
  if (!mine && !others.length) return { made: [] };
  const tops = new Set(newTops(before, after, diff)), made: string[] = [], myRoots = mine ? new Set(mine.scope.roots) : undefined;
  if (mine?.scope.region) for (const id of tops) if (!inScope(after, id, myRoots!) && insideRect(after, id, mine.scope.region)) { myRoots!.add(id); if (!mine.made.includes(id)) made.push(id); }
  const touched: ['up' | 'rm', string][] = [...diff.upserts.map(e => ['up', e.id] as ['up', string]), ...diff.removes.map(id => ['rm', id] as ['rm', string])];
  for (const [kind, id] of touched) {
    const existed = before.entities.has(id), path = () => (kind === 'up' ? after : before).pathOf(id) || id;
    const touches = (roots: Set<string>) => existed && inScope(before, id, roots) || kind === 'up' && inScope(after, id, roots);
    const other = others.find(c => touches(c.scope.roots) || tops.has(id) && c.scope.region && meets(after, id, c.scope.region));
    const opOf = () => ops.findIndex(o => 'id' in o && (before.get(o.id as string)?.id === id || after.get(o.id as string)?.id === id));
    if (other) return { failure: buildFailure('build.claimed', `${path()} is inside claim ${other.id} (${other.part}), held by another agent.`, 'id', { op: opOf(), entity: id, limit: { claim: other.id, part: other.part, root: other.root, region: other.region } }) };
    if (mine && ((!existed || inScope(before, id, myRoots!)) && (kind === 'rm' || inScope(after, id, myRoots!))) === false) return { failure: buildFailure('build.claim', `${path()} is outside claim ${mine.id} (${mine.part})${existed && kind === 'up' ? ' before or after this edit' : ''}.`, kind === 'up' && after.entities.get(id)?.in.parent === 'world' ? 'p' : 'in.parent', { op: opOf(), entity: id, limit: { claim: mine.id, root: mine.root, region: mine.region } }) };
  }
  if (mine && mine.made.length + made.length > BUILD_LIMITS.made) return { failure: buildFailure('build.limit', `claim ${mine.part} would hold ${mine.made.length + made.length} parts (max ${BUILD_LIMITS.made}).`, 'claim.made', { fix: 'Group parts under one container.' }) };
  if (mine && (diff.world || diff.tiles.length || diff.constants || diff.layers)) return { failure: buildFailure('build.claim', 'World, terrain and constants edits belong to the build lead.', 'op', { fix: 'Ask the lead to make this edit.' }) };
  return { made };
}

/** Every committed diff, including undo/redo. The input rows and bodies are never mutated. */
export function rootsDelta(before: WorldModel, after: WorldModel, diff: Diff, kind: 'edit' | 'undo' | 'redo' | 'engine', field: BuildField | undefined, rows: readonly Row[], rootIndex: ReadonlyMap<string, string> = new Map(rows.filter(open).flatMap(r => r.body.roots.map(id => [id, r.id] as const)))): RootsDelta {
  const changes = new Map<string, RootChange>(), warnings: string[] = [], removed = new Set(diff.removes);
  const sites = rows.filter(open).sort((a, b) => a.id.localeCompare(b.id));
  const roots = new Map(sites.map(r => [r.id, new Set(r.body.roots.filter(id => !removed.has(id)))]));
  const addedOwners = new Map<string, string>();
  for (const r of sites) { const gone = r.body.roots.filter(id => removed.has(id)); if (gone.length) changes.set(r.id, { added: [], removed: gone }); }
  if (kind === 'engine') return { changes, warnings };
  // Upserts need not be ordered parent-first (notably inverse ops), so process by depth.
  const tops = diff.upserts.filter(e => !before.entities.has(e.id) && (e.in.parent === 'world' || before.entities.has(e.in.parent)) && !after.resolvedDef(e.def)?.components.body).sort((a, b) => after.ancestors(a.id).size - after.ancestors(b.id).size);
  for (const e of tops) {
    const ancestors = after.ancestors(e.id);
    if ([...ancestors].some(id => addedOwners.has(id) || !removed.has(id) && rootIndex.has(id))) continue;
    const candidates = [...sites.filter(r => r.id === field?.id), ...sites.filter(r => r.id !== field?.id)];
    const owner = candidates.find(r => meets(after, e.id, r.body.site));
    if (!owner) { if (field) warnings.push(`${after.pathOf(e.id)} is outside site ${field.id}: not part of the build (residents can use it)`); continue; }
    const ids = roots.get(owner.id)!;
    if (ids.size >= BUILD_LIMITS.roots) { warnings.push(`${owner.id}: group the parts under one container (\`place … --in church\`); root limit ${BUILD_LIMITS.roots}`); continue; }
    ids.add(e.id); addedOwners.set(e.id, owner.id); const change = changes.get(owner.id) ?? { added: [], removed: [] }; change.added.push(e.id); changes.set(owner.id, change);
  }
  if (field) { const r = sites.find(r => r.id === field.id); if (r) for (const e of diff.upserts) if (rootIndex.get(e.id) === r.id && !meets(after, e.id, r.body.site)) warnings.push(`${after.pathOf(e.id)} moved outside site ${r.id}: still part of the build`); }
  if (!field) {
    const touched = new Set<string>([...diff.removes, ...diff.upserts.map(e => e.id)]), builds = new Set<string>();
    for (const id of [...touched]) { for (const a of before.ancestors(id)) touched.add(a); for (const a of after.ancestors(id)) touched.add(a); }
    for (const id of touched) { const owner = rootIndex.get(id); if (owner) builds.add(owner); }
    for (const id of [...builds].sort()) warnings.push(`edited ${id} (under construction) outside its build; progress not recorded`);
  }
  return { changes, warnings };
}

/** Pure accepted-batch update. Rev is deliberately absent: SQL is its only source. */
export function advance(body: BuildBody, field: BuildField | undefined, made: string[], roots: RootChange, seq: number, at: number, caller?: Identity, pauseMs = 600_000, revert = false): BuildBody {
  const b = structuredClone(body);
  b.roots = [...b.roots.filter(id => !roots.removed.includes(id)), ...roots.added];
  if (!field) return b;
  const claim = field.claim ? b.claims.find(c => c.id === field.claim)! : undefined;
  if (claim) { claim.made = [...new Set([...claim.made, ...made])]; claim.lastAt = at; if (caller) claim.user = { hash8: caller.hash.slice(0, 8), tokenHash: caller.hash }; }
  if (revert) return b;
  const current = claim?.step ?? b.step, n = Math.max(current.n, field.step ?? current.n);
  const label = field.step !== undefined && field.step < current.n ? current.label : field.label ?? (n > current.n ? b.plan.steps[n - 1] ?? `step ${n}` : current.label);
  if (claim) claim.step = { n, label }; else b.step = { n, label, at, seq };
  let s = [...b.steps].reverse().find(s => s.n === n && s.claim === field.claim);
  if (!s) { s = { n, label, ...(claim ? { claim: claim.id } : {}), batches: 0, firstSeq: seq, lastSeq: seq, at }; b.steps.push(s); }
  s.batches++; s.lastSeq = seq; s.at = at; s.label = label;
  b.steps = b.steps.slice(-64); b.firstEditAt ??= at; b.lastEditAt = at;
  delete b.paused; delete b.closureLiftedAt;
  if (caller && !b.agents.some(a => a.hash8 === caller.hash.slice(0, 8))) b.agents = [...b.agents, { label: caller.label, hash8: caller.hash.slice(0, 8), at }].slice(-8);
  if (field.done && claim) claim.status = 'done';
  else if (field.done && !b.claims.some(c => c.status === 'held' && at - c.lastAt <= pauseMs)) b.done = { at, byLabel: caller?.label ?? b.lead.label };
  return b;
}

export class GodBuilds {
  private rows = new Map<string, Row>();
  readonly rootIndex = new Map<string, string>();
  readonly pauseMs: number; readonly closureMs: number;
  readonly store: WorldStore;
  private host: { model: () => WorldModel; now: () => number; pauseMs?: number; closureMs?: number; emit: (message: WorldBuildMessage) => void; notice: (event: BuildNotice) => void };
  constructor(store: WorldStore, host: GodBuilds['host']) {
    this.store = store; this.host = host;
    const positive = (v: number | undefined, fallback: number) => v !== undefined && Number.isFinite(v) && v > 0 ? v : fallback;
    this.pauseMs = positive(host.pauseMs ?? (process.env.GOD_BUILD_PAUSE_MS ? Number(process.env.GOD_BUILD_PAUSE_MS) : undefined), 600_000);
    this.closureMs = positive(host.closureMs ?? (process.env.GOD_BUILD_CLOSURE_MS ? Number(process.env.GOD_BUILD_CLOSURE_MS) : undefined), 43_200_000);
    for (const r of store.builds(true)) this.rows.set(r.id, decode(r)); this.index();
  }
  private index() { this.rootIndex.clear(); for (const r of this.rows.values()) for (const id of r.body.roots) this.rootIndex.set(id, r.id); }
  private row(id: string) { return this.rows.get(id) ?? (() => { const r = this.store.build(id); return r ? decode(r) : undefined; })(); }
  private isClosing(r: Row, now: number) { return open(r) && !(effective(r, now, this.pauseMs) === 'paused' && now - r.last_at > this.closureMs); }
  hasClosure(now = this.host.now()): boolean { return [...this.rows.values()].some(r => this.isClosing(r, now)); }
  closing(id: string, model = this.host.model(), now = this.host.now()): { id: string; title: string; step: string } | null {
    for (let e = model.entities.get(id); e; e = model.entities.get(e.in.parent)) { const b = this.rootIndex.get(e.id), r = b && this.rows.get(b); if (r && this.isClosing(r, now)) return { id: r.id, title: r.body.title, step: `step ${r.body.step.n}/${r.body.plan.steps.length}: ${r.body.step.label}` }; }
    return null;
  }
  closingSites(now = this.host.now()): { site: Site; roots: string[]; id: string }[] { return [...this.rows.values()].filter(r => this.isClosing(r, now)).map(r => ({ id: r.id, site: r.body.site, roots: [...r.body.roots] })); }
  private public(r: Row, now: number): PublicSite { const b = r.body; return { id: r.id, title: b.title, status: effective(r, now, this.pauseMs), rev: r.rev, lastAt: r.last_at, pauseAfterMs: this.pauseMs, closed: this.isClosing(r, now), step: { n: b.step.n, label: b.step.label, of: b.plan.steps.length }, site: structuredClone(b.site), massing: structuredClone(b.massing), roots: [...b.roots], claims: b.claims.map(c => ({ part: c.part, status: c.status === 'held' && now - c.lastAt > this.pauseMs ? 'stale' : c.status })) }; }
  private view(r: Row, now: number, recent?: { seq: number; note: string | null; at: number }[]): GodBuildView {
    const b = structuredClone(r.body), { lease: _lease, tokenHash: _tokenHash, ...lead } = b.lead;
    const step = [...b.steps].reverse().find(s => s.n === b.step.n && !s.claim);
    const current = step ? { ...step, recent: recent ?? this.store.buildRecent(r.id, step.firstSeq, step.lastSeq) } : null;
    const model = this.host.model();
    const massing = b.massing.map(m => ({ ...m, parts: 0 })), boxes = massing.map(m => ({ at: m.at, size: m.size, yaw: m.yaw ?? 0 }));
    if (massing.length) for (const root of b.roots) for (const id of model.entities.has(root) ? model.subtree(root) : []) {
      const fs = model.footprintsOf(id), wp = fs.length ? null : model.worldPose(model.entities.get(id)!);
      const p = siteLocal(b.site, fs.length ? [fs.reduce((a, f) => a + f.c[0], 0) / fs.length, fs.reduce((a, f) => a + f.c[1], 0) / fs.length] : [wp!.x, wp!.z]);
      boxes.forEach((ms, i) => { if (inSite(ms, p)) massing[i].parts++; });
    }
    return { ...b, status: effective(r, now, this.pauseMs), rev: r.rev, createdAt: r.created_at, lastAt: r.last_at, now, pauseAfterMs: this.pauseMs, closed: this.isClosing(r, now), lead: { ...lead, live: now - r.last_at <= this.pauseMs }, roots: b.roots.map(id => ({ id, path: model.pathOf(id) })), claims: b.claims.map(({ user: _user, ...c }) => ({ ...c, status: c.status === 'held' && now - c.lastAt > this.pauseMs ? 'stale' : c.status, ...(c.root ? { rootPath: model.pathOf(c.root) } : {}) })), current, next: b.step.n < b.plan.steps.length ? { n: b.step.n + 1, label: b.plan.steps[b.step.n] } : null, massing };
  }
  publicList(now = this.host.now()) { this.sweep(now); return { now, rev: this.store.buildsRev(), builds: [...this.rows.values()].map(r => this.public(r, now)) }; }
  list(now = this.host.now()) { this.sweep(now); return { now, rev: this.store.buildsRev(), open: [...this.rows.values()].map(r => this.view(r, now)), recent: this.store.builds().filter(r => !open(r)).slice(0, 20).map(r => { const b = decode(r); return { id: r.id, title: b.body.title, status: r.status, rev: r.rev, step: b.body.step, lastAt: r.last_at }; }) }; }
  summaries(now = this.host.now()) { this.sweep(now); return [...this.rows.values()].map(r => ({ id: r.id, status: effective(r, now, this.pauseMs), step: structuredClone(r.body.step) })); }
  status(id: string) {
    const now = this.host.now(); this.sweep(now); const r = this.row(id); if (!r) return null;
    const step = [...r.body.steps].reverse().find(s => s.n === r.body.step.n && !s.claim), { journal, recent } = this.store.buildJournal(id, step);
    return { ok: true as const, build: this.view(r, now, recent), journal };
  }
  start(raw: unknown, caller: Identity) {
    const now = this.host.now(); this.sweep(now); const p = buildStartSchema.safeParse(raw); if (!p.success) return schemaFailure(p.error);
    const input = p.data, startHash = hashOf(input), prior = this.row(input.id);
    if (prior) return !open(prior) ? fail('build.closed', input.id) : prior.body.startHash === startHash && prior.body.lead.tokenHash === caller.hash ? { ok: true as const, build: this.view(prior, now), lease: prior.body.lead.lease, replayed: true } : fail('build.exists', `${input.id} already exists.`);
    if (this.store.hasGroupUnder(input.id)) return fail('build.exists', `${input.id} is already a journal group.`);
    if (this.rows.size >= BUILD_LIMITS.open) return fail('build.limit', 'At most 8 builds may be open.');
    const model = this.host.model(), [x0, z0, x1, z1] = model.ground().extent, [x, z] = input.site.at;
    if (x < x0 || x > x1 || z < z0 || z > z1) return fail('build.site', 'Site centre is outside the ground extent.', 'site');
    if ([...this.rows.values()].some(r => obbOverlap(box(input.site), box(r.body.site)))) return fail('build.site', 'Site overlaps another open build.', 'site');
    for (const m of input.massing) for (const a of [-1, 1]) for (const b of [-1, 1]) { const p = siteWorld({ at: m.at, size: m.size, yaw: m.yaw ?? 0 }, [a * m.size[0] / 2, b * m.size[1] / 2]); if (Math.abs(p[0]) > input.site.size[0] / 2 + 1e-7 || Math.abs(p[1]) > input.site.size[1] / 2 + 1e-7) return fail('build.site', 'Massing must be wholly inside the site.', 'massing'); }
    const root = input.root ? model.get(input.root) : undefined;
    if (input.root && !root) return { ok: false as const, failures: [{ op: -1, code: 'entity.unknown', entity: input.root, detail: `Unknown root ${input.root}.`, fix: 'Use an existing entity id or path.' }] };
    if (root && this.rootIndex.has(root.id)) return fail('build.site', 'Root already belongs to an open build.', 'root');
    const body: BuildBody = { id: input.id, title: input.title, plan: { steps: input.steps, ...(input.brief ? { brief: input.brief } : {}) }, site: input.site, massing: input.massing, roots: root ? [root.id] : [], lead: { lease: lease(), label: caller.label, hash8: caller.hash.slice(0, 8), tokenHash: caller.hash, since: now }, step: { n: 1, label: input.steps[0], at: now, seq: null }, steps: [], claims: [], agents: [{ label: caller.label, hash8: caller.hash.slice(0, 8), at: now }], pauses: 0, startHash };
    const encoded = JSON.stringify(body), failure = buildBodyFailure(encoded); if (failure) return { ok: false as const, failures: [failure] };
    const inserted = this.store.insertBuild(input.id, now, encoded); if (!inserted) return fail('build.exists', `${input.id} already exists.`);
    if ('accepted' in inserted) return { ok: false as const, failures: inserted.failures };
    const row = decode(inserted); this.rows.set(row.id, row); this.index(); const build = this.view(row, now); this.announce(row, 'started', { added: row.body.roots, removed: [] }, false, build);
    return { ok: true as const, build, lease: body.lead.lease };
  }
  private save(row: Row, body: BuildBody, status: Row['status'], at: number, kind: BuildEventKind, transition = false) {
    const w: BuildWrite = { id: row.id, expectRev: row.rev, status, lastAt: at, body: JSON.stringify(body) };
    const failure = buildBodyFailure(w.body, !transition); if (failure) return { ok: false as const, failures: [failure] };
    const refused = this.store.saveBuild(w); if (refused && !refused.accepted) return { ok: false as const, failures: refused.failures };
    const next: Row = { ...row, body, status, rev: w.rev!, last_at: at }; this.install(next);
    return { ok: true as const, row: next, kind };
  }
  private savedView(result: ReturnType<GodBuilds['save']>) {
    if (!result.ok) return result;
    const build = this.view(result.row, this.host.now()); this.announce(result.row, result.kind, { added: [], removed: [] }, false, build);
    return { ok: true as const, build };
  }
  private install(row: Row, roots?: RootChange) {
    if (open(row)) {
      this.rows.set(row.id, row);
      if (roots) { for (const id of roots.removed) if (this.rootIndex.get(id) === row.id) this.rootIndex.delete(id); for (const id of roots.added) this.rootIndex.set(id, row.id); }
    } else {
      const previous = this.rows.get(row.id); this.rows.delete(row.id);
      for (const id of previous?.body.roots ?? []) if (this.rootIndex.get(id) === row.id) this.rootIndex.delete(id);
    }
  }
  private delta(row: Row, roots: RootChange, claim?: PublicSite['claims'][number]): SiteDelta {
    const now = this.host.now(), b = row.body;
    return { id: row.id, rev: row.rev, status: effective(row, now, this.pauseMs), lastAt: row.last_at, closed: this.isClosing(row, now), step: { n: b.step.n, label: b.step.label, of: b.plan.steps.length }, ...(claim ? { claim } : {}), ...(roots.added.length ? { rootsAdded: [...roots.added] } : {}), ...(roots.removed.length ? { rootsRemoved: [...roots.removed] } : {}) };
  }
  private announce(row: Row, kind: BuildEventKind, roots: RootChange, inEdit = false, view?: GodBuildView, claim?: PublicSite['claims'][number]) {
    const delta = this.delta(row, roots, claim), full = kind === 'started' || kind === 'resumed';
    if (!inEdit) this.host.emit({ type: 'edge', kind: 'world-build', event: kind as WorldBuildMessage['event'], rev: row.rev, now: this.host.now(), ...(full ? { site: this.public(row, this.host.now()) } : { delta }) });
    this.host.notice({ kind, id: row.id, rev: row.rev, now: this.host.now(), delta, ...(full ? { view: view ?? this.view(row, this.host.now()) } : {}) });
  }
  sweep(now = this.host.now()) {
    for (let row of [...this.rows.values()]) {
      // Legacy rows may not have reserved marker space. One refused transition must not wedge public reads.
      try {
        if (row.status === 'active' && effective(row, now, this.pauseMs) === 'paused') {
          const body = structuredClone(row.body); body.paused = { from: row.last_at + this.pauseMs, seenAt: now };
          const saved = this.save(row, body, 'paused', row.last_at, 'paused', true);
          if (saved.ok) { row = saved.row; this.announce(row, 'paused', { added: [], removed: [] }); }
        }
        if (effective(row, now, this.pauseMs) === 'paused' && now - row.last_at > this.closureMs && row.body.closureLiftedAt === undefined) {
          const body = structuredClone(row.body); body.closureLiftedAt = now;
          const saved = this.save(row, body, row.status, row.last_at, 'closure-lifted', true);
          if (saved.ok) this.announce(saved.row, 'closure-lifted', { added: [], removed: [] });
        }
      } catch { /* A malformed legacy row cannot stop the other sites or public routes. */ }
    }
  }
  touch(hash: string, now = this.host.now()) {
    // No SQL or allocation on the usual authenticated request.
    for (const row of this.rows.values()) {
      const lead = row.body.lead.tokenHash === hash && now - row.last_at > this.pauseMs / 4;
      const needsTouch = (c: Claim) => c.status === 'held' && c.user.tokenHash === hash && now - c.lastAt > this.pauseMs / 4;
      if (!lead && !row.body.claims.some(needsTouch)) continue;
      const body = structuredClone(row.body), paused = effective(row, now, this.pauseMs) === 'paused';
      for (const c of body.claims) if (needsTouch(c)) c.lastAt = now;
      if (paused) body.pauses++; delete body.paused; delete body.closureLiftedAt;
      const saved = this.save(row, body, 'active', now, paused ? 'resumed' : 'alive');
      if (saved.ok) this.announce(saved.row, saved.kind, { added: [], removed: [] });
    }
  }
  pause(id: string, raw: unknown, caller?: Identity) {
    this.sweep(); const p = buildActionSchemas.pause.safeParse(raw); if (!p.success) return schemaFailure(p.error); const row = this.row(id); if (!row) return fail('build.unknown', id);
    if (!open(row)) return fail('build.closed', id);
    if (caller?.hash !== row.body.lead.tokenHash && p.data.lease !== row.body.lead.lease) return fail('build.lease', `${id} is led by ${row.body.lead.label}.`);
    if (row.status === 'paused') return { ok: true as const, build: this.view(row, this.host.now()), replayed: true };
    const body = structuredClone(row.body); body.paused = { from: this.host.now(), seenAt: this.host.now(), explicit: true, ...p.data };
    // Never persist a submitted lease in the pause note.
    delete (body.paused as Record<string, unknown>).lease;
    return this.savedView(this.save(row, body, 'paused', row.last_at, 'paused'));
  }
  resume(id: string, raw: unknown, caller: Identity) {
    const now = this.host.now(); this.sweep(now); const p = buildActionSchemas.resume.safeParse(raw); if (!p.success) return schemaFailure(p.error); const row = this.row(id); if (!row) return fail('build.unknown', id); if (!open(row)) return fail('build.closed', id);
    const replayed = p.data.lease === row.body.lead.lease || caller.hash === row.body.lead.tokenHash;
    if (!replayed && !row.body.paused?.explicit && now - row.last_at <= this.pauseMs && !p.data.take) return fail('build.leased', `${row.body.lead.label} leads ${id}; quietFor=${now - row.last_at}ms, staleIn=${this.pauseMs - (now - row.last_at)}ms.`, 'build', { measured: { label: row.body.lead.label, quietFor: now - row.last_at, staleIn: this.pauseMs - (now - row.last_at) } });
    if (replayed && row.status === 'active' && row.last_at === now) {
      const build = this.view(row, now); return { ok: true as const, build, lease: row.body.lead.lease, current: build.current, next: build.next, massing: build.massing, replayed: true };
    }
    const body = structuredClone(row.body); if (effective(row, now, this.pauseMs) === 'paused') body.pauses++;
    if (!replayed) body.lead = { lease: lease(), label: caller.label, hash8: caller.hash.slice(0, 8), tokenHash: caller.hash, since: now };
    if (!body.agents.some(a => a.hash8 === caller.hash.slice(0, 8))) body.agents = [...body.agents, { label: caller.label, hash8: caller.hash.slice(0, 8), at: now }].slice(-8);
    const resumed = !replayed || effective(row, now, this.pauseMs) === 'paused';
    delete body.paused; delete body.closureLiftedAt; const r = this.savedView(this.save(row, body, 'active', now, resumed ? 'resumed' : 'alive'));
    if (!r.ok) return r; return { ...r, lease: body.lead.lease, current: r.build.current, next: r.build.next, massing: r.build.massing, ...(replayed ? { replayed: true } : {}) };
  }
  claim(id: string, raw: unknown, caller: Identity) {
    const now = this.host.now(); this.sweep(now); const p = buildActionSchemas.claim.safeParse(raw); if (!p.success) return schemaFailure(p.error);
    const row = this.row(id); if (!row) return fail('build.unknown', id); if (!open(row)) return fail('build.closed', id);
    const input = p.data, prior = row.body.claims.find(c => c.part === input.part && c.status === 'held' && c.user.tokenHash === caller.hash);
    // A retry of take may still name the taken id; replay its already-issued replacement.
    if (prior && (!input.take || input.take === prior.id || row.body.claims.find(c => c.id === input.take)?.takenBy?.claim === prior.id)) {
      if (input.take === prior.id && now - prior.lastAt <= this.pauseMs) return fail('build.claim-unknown', `${prior.id} is still live.`);
      if (!input.take || input.take !== prior.id) { const build = this.view(row, now); return { ok: true as const, claim: build.claims.find(c => c.id === prior.id)!, build, replayed: true }; }
    }
    const old = input.take ? row.body.claims.find(c => c.id === input.take) : undefined;
    if (input.take && (!old || old.status !== 'held' || now - old.lastAt <= this.pauseMs || old.part !== input.part)) return fail('build.claim-unknown', `${input.take} is unknown, not stale, or belongs to a different part.`);
    if (row.body.claims.some(c => c.part === input.part && c.status === 'held' && c.id !== old?.id)) return fail('build.claimed', `${input.part} is already held; take its claim after it goes stale.`);
    if (row.body.claims.filter(c => c.status === 'held' && c.id !== old?.id).length >= BUILD_LIMITS.claims) return fail('build.limit', 'At most 8 claims may be held.');
    const model = this.host.model(), root = old ? old.root : input.root ? model.get(input.root)?.id : undefined, region = old ? old.region : input.region;
    if (!old && input.root && (!root || !inScope(model, root, new Set(row.body.roots)))) return { ok: false as const, failures: [{ op: -1, code: 'entity.unknown', entity: input.root, field: 'root', detail: `${input.root} is not an entity inside build ${id}.`, fix: 'Use a root or subtree from this build.' }] };
    const roots = new Set([...(root ? [root] : []), ...(old?.made ?? [])]);
    for (const r of this.rows.values()) for (const c of this.liveClaims(r, now)) {
      if (c.id === old?.id) continue;
      const theirs = scoped(c).scope.roots;
      const overlap = [...roots].some(rid => inScope(model, rid, theirs) || [...theirs].some(tid => inScope(model, tid, new Set([rid]))) || c.region && model.entities.has(rid) && model.subtree(rid).some(eid => meets(model, eid, c.region!)))
        || region && (c.region && obbOverlap(box(region), box(c.region)) || [...theirs].some(tid => model.entities.has(tid) && meets(model, tid, region)));
      if (overlap) return fail('build.claimed', `Claim overlaps ${c.id} (${c.part}).`, 'root', { limit: { claim: c.id, part: c.part } });
    }
    const body = structuredClone(row.body); let cid: string; do { cid = claimId(); } while (body.claims.some(c => c.id === cid));
    if (old) { const taken = body.claims.find(c => c.id === old.id)!; taken.status = 'taken'; taken.takenBy = { claim: cid, label: caller.label, at: now }; }
    while (body.claims.length >= BUILD_LIMITS.retainedClaims) { const i = body.claims.findIndex(c => c.status !== 'held'); body.claims.splice(i, 1); }
    const claim: Claim = { id: cid, part: input.part, ...(root ? { root } : {}), ...(region ? { region: structuredClone(region) } : {}), made: [...(old?.made ?? [])], step: old ? { ...old.step } : { n: 1, label: body.plan.steps[0] }, status: 'held', lastAt: now, holder: { label: caller.label, hash8: caller.hash.slice(0, 8) }, user: { hash8: caller.hash.slice(0, 8), tokenHash: caller.hash } };
    body.claims.push(claim);
    const result = this.save(row, body, row.status, row.last_at, old ? 'taken' : 'claimed'); if (!result.ok) return result;
    const build = this.view(result.row, now); this.announce(result.row, result.kind, { added: [], removed: [] }, false, build, { part: claim.part, status: 'held' });
    return { ok: true as const, claim: build.claims.find(c => c.id === cid)!, build };
  }
  release(id: string, cid: string, raw: unknown) {
    const now = this.host.now(); this.sweep(now); const p = buildActionSchemas.release.safeParse(raw); if (!p.success) return schemaFailure(p.error);
    const row = this.row(id); if (!row) return fail('build.unknown', id);
    const claim = row.body.claims.find(c => c.id === cid); if (!claim || claim.status === 'taken') return fail('build.claim-unknown', `${cid}${claim?.takenBy ? ` was taken by ${claim.takenBy.label} at ${claim.takenBy.at}` : ' is unknown'}.`);
    if (claim.status === 'released' || claim.status === 'done') return { ok: true as const, build: this.view(row, now), replayed: true };
    if (!open(row)) return fail('build.closed', id);
    const body = structuredClone(row.body), next = body.claims.find(c => c.id === cid)!; next.status = p.data.done ? 'done' : 'released';
    const result = this.save(row, body, row.status, row.last_at, 'released'); if (!result.ok) return result;
    const build = this.view(result.row, now); this.announce(result.row, 'released', { added: [], removed: [] }, false, build, { part: next.part, status: next.status });
    return { ok: true as const, build };
  }
  done(id: string, raw: unknown, caller: Identity) {
    const now = this.host.now(); this.sweep(now); const p = buildActionSchemas.done.safeParse(raw); if (!p.success) return schemaFailure(p.error); const row = this.row(id); if (!row) return fail('build.unknown', id);
    if (row.status === 'done') return { ok: true as const, build: this.view(row, now), replayed: true }; if (!open(row)) return fail('build.closed', id);
    if (!p.data.force && this.liveClaims(row, now).length) return fail('build.claims-open', id);
    const body = structuredClone(row.body); if (p.data.force) for (const c of body.claims) if (c.status === 'held') c.status = 'released';
    body.done = { at: now, byLabel: caller.label, ...(p.data.summary ? { summary: p.data.summary } : {}) }; return this.savedView(this.save(row, body, 'done', row.last_at, 'done'));
  }
  abandon(id: string, raw: unknown, undo: () => { accepted: boolean; reverted: number[]; notReverted: number[]; failures?: Failure[] }) {
    const now = this.host.now(); this.sweep(now); const p = buildActionSchemas.abandon.safeParse(raw); if (!p.success) return schemaFailure(p.error); let row = this.row(id); if (!row) return fail('build.unknown', id);
    if (row.status === 'abandoned') return { ok: true as const, build: this.view(row, now), replayed: true }; if (!open(row)) return fail('build.closed', id);
    if (!p.data.force && this.liveClaims(row, now).length) return fail('build.claims-open', id);
    if (p.data.force && row.body.claims.some(c => c.status === 'held')) {
      const body = structuredClone(row.body); for (const c of body.claims) if (c.status === 'held') c.status = 'released';
      const released = this.save(row, body, row.status, row.last_at, 'released'); if (!released.ok) return released;
      row = released.row; this.announce(row, 'released', { added: [], removed: [] });
    }
    const reverted = p.data.undo ? undo() : undefined;
    if (reverted && !reverted.accepted) return { ...fail('build.undo-incomplete', 'Undo stopped before all build edits were reverted.'), reverted: reverted.reverted, notReverted: reverted.notReverted, causes: reverted.failures };
    row = this.row(id)!; const body = structuredClone(row.body); body.abandoned = { at: now, ...(reverted ? { undo: { reverted: reverted.reverted, notReverted: [] } } : {}) }; return this.savedView(this.save(row, body, 'abandoned', row.last_at, 'abandoned'));
  }
  private liveClaims(row: Row, now: number) { return row.body.claims.filter(c => c.status === 'held' && now - c.lastAt <= this.pauseMs); }
  admit(field: BuildField | undefined, batch: Pick<Batch, 'group'>, _caller?: Identity): Admission {
    const warnings: string[] = []; if (!field) { const owned = [...this.rows.values()].find(r => batch.group === r.id || batch.group?.startsWith(r.id + '/')); return { group: batch.group, warnings, ...(owned ? { failures: [buildFailure('build.group', `${batch.group} belongs to open build ${owned.id}.`)] } : {}) }; }
    const row = this.row(field.id); if (!row) return { warnings, failures: [buildFailure('build.unknown', field.id)] }; if (!open(row)) return { warnings, failures: [buildFailure('build.closed', field.id)] };
    if (field.claim) {
      const claim = row.body.claims.find(c => c.id === field.claim);
      if (!claim || claim.status !== 'held') return { warnings, failures: [buildFailure('build.claim-unknown', `${field.claim}${claim?.takenBy ? ` was taken by ${claim.takenBy.label} at ${claim.takenBy.at}` : ' is unknown or released'}.`)] };
      const group = `${row.id}/${claim.part}`; if (batch.group && batch.group !== group) warnings.push(`group ${batch.group} ignored; claim group is ${group}`);
      return { row, field, mine: scoped(claim), group, warnings };
    }
    if (field.lease !== row.body.lead.lease) return { warnings, failures: [buildFailure('build.lease', `${field.id} was resumed by ${row.body.lead.label} at ${row.body.lead.since}.`)] };
    let group = batch.group;
    if (!group || group === row.id) group = row.id;
    else if (!group.startsWith(row.id + '/')) { group = `${row.id}/${group}`.slice(0, 60); warnings.push(`group ${batch.group} mapped to ${group}`); }
    if (row.body.claims.some(c => c.status === 'held' && group === `${row.id}/${c.part}`)) return { warnings, failures: [buildFailure('build.group', `${group} belongs to a held claim.`)] };
    return { row, field, group, warnings };
  }
  check(admission: Admission, before: WorldModel, after: WorldModel, diff: Diff, ops: Op[]) {
    const now = this.host.now(), others: LiveClaim[] = [];
    for (const row of this.rows.values()) for (const c of this.liveClaims(row, now)) if (c.id !== admission.mine?.id) others.push(scoped(c));
    return claimCheck(before, after, diff, ops, admission.mine, others);
  }
  rootsDelta(before: WorldModel, after: WorldModel, diff: Diff, kind: 'edit' | 'undo' | 'redo' | 'engine', field?: BuildField) { return rootsDelta(before, after, diff, kind, field, [...this.rows.values()], this.rootIndex); }
  writes(admission: Admission, roots: RootsDelta, seq: number, at: number, caller?: Identity, group?: string, revert = false, made: string[] = []): { writes: PlannedWrite[]; echo?: BuildEcho; warnings: string[]; failures?: Failure[] } {
    const ids = new Set(roots.changes.keys()); if (admission.row) ids.add(admission.row.id);
    // Undo/redo refresh liveness for the group they actually reverted, without advancing progress.
    if (group) for (const r of this.rows.values()) if (group === r.id || group.startsWith(r.id + '/')) ids.add(r.id);
    const writes: PlannedWrite[] = [], warnings: string[] = []; let echo: BuildEcho | undefined;
    for (const id of [...ids].sort()) {
      const row = this.rows.get(id)!, field = admission.row?.id === id ? admission.field : undefined, change = roots.changes.get(id) ?? { added: [], removed: [] };
      const body = advance(row.body, field, made, change, seq, at, caller, this.pauseMs, revert), wasPaused = effective(row, at, this.pauseMs) === 'paused';
      let status = row.status, kind: BuildEventKind = 'step';
      const groupLead = !!group && (group === id || group.startsWith(id + '/')) && caller?.hash === row.body.lead.tokenHash;
      const refresh = !!field || groupLead;
      const claim = field?.claim ? body.claims.find(c => c.id === field.claim) : undefined;
      if (refresh) { delete body.paused; delete body.closureLiftedAt; status = !revert && body.done ? 'done' : 'active'; if (wasPaused) { body.pauses++; kind = 'resumed'; } if (status === 'done') kind = 'done'; if (!revert && field?.done && !field.claim && !body.done) warnings.push(`${id} stays open: ${this.liveClaims(row, at).length} live claims (${this.liveClaims(row, at).map(c => c.part).join(', ')}); release them or build done --force`); if (claim?.status === 'done') kind = 'released'; }
      const encoded = JSON.stringify(body), failure = buildBodyFailure(encoded); if (failure) return { writes: [], warnings, failures: [failure] };
      const w: PlannedWrite = { id, expectRev: row.rev, status, lastAt: refresh ? at : row.last_at, body: encoded, next: body, before: row, roots: change, kind, ...(field ? { echo: true } : {}), ...(claim ? { claim: { part: claim.part, status: claim.status } } : {}) };
      writes.push(w); if (field) echo = { id, status, rev: 0, group: revert ? group : admission.group!, step: { n: claim?.step.n ?? body.step.n, label: claim?.step.label ?? body.step.label }, ...(claim ? { claim: claim.id } : {}) };
    }
    return { writes, echo, warnings };
  }
  accepted(writes: PlannedWrite[]): SiteDelta[] { return writes.map(w => { const row: Row = { ...w.before, body: w.next, rev: w.rev!, status: w.status, last_at: w.lastAt }; this.install(row, w.roots); return this.delta(row, w.roots, w.claim); }); }
  announceCommitted(writes: PlannedWrite[]) { for (const w of writes) this.announce({ ...w.before, body: w.next, rev: w.rev!, status: w.status, last_at: w.lastAt }, w.kind, w.roots, true, undefined, w.claim); }
}
