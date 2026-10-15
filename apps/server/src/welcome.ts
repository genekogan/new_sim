// Feedback and owner return summaries are projections beside the replay log.
// They never enqueue simulation inputs or ask a model to infer what happened.
import {createHash, randomUUID} from 'node:crypto';
import {closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {Context, Hono} from 'hono';
import {getConnInfo} from '@hono/node-server/conninfo';
import {z} from 'zod';
import type {Auth} from './auth.ts';
import type {Config} from './config.ts';
import type {Db, SoulRow, UserRow} from './db.ts';
import {tx} from './edge/comms/store.ts';
import {oneLine, toEnvelope} from './edge/events/envelope.ts';
import type {StreamEvent} from './edge/comms/stream.ts';
import type {GodMode} from './god/god.ts';
import {ApiError, type Souls} from './souls.ts';
import type {WorldHost} from './world.ts';

export const FEEDBACK_MAX_BYTES = 1024 * 1024;
export const AWAY_SCAN = 300, AWAY_RESIDENTS = 24;
const WINDOW_MS = 60_000, FEEDBACK_PER_WINDOW = 5;
const finite = z.number().finite().min(-1e8).max(1e8);
const vector = z.tuple([finite, finite, finite]);
const ref = z.string().min(1).max(160);
const feedbackSchema = z.object({
  text: z.string().trim().min(1).max(4000), residentId: ref.nullable().optional(), placeId: ref.nullable().optional(), eventId: ref.nullable().optional(),
  tick: z.number().int().nonnegative().nullable().optional(), clientTime: z.iso.datetime().optional(),
  camera: z.object({position: vector, target: vector.optional(), yaw: finite.optional(), pitch: finite.optional(), fov: finite.optional()}).strict().nullable().optional(),
}).strict();
type FeedbackInput = z.infer<typeof feedbackSchema>;
type FeedbackEntry = FeedbackInput & {id: string; worldId: string; build: string; receivedAt: number; serverTick: number; accountId: string | null};
type Cutoff = {at: number; event: number; edit: number; heads: Record<string, number>};
type VisitRow = {at: number; body: string; pending_at: number | null; pending_body: string | null};
export type AwayEvent = {id: string; at: number; tick?: number; kind: string; text: string};
type Deps = {cfg: Config; db: Db; host: WorldHost; auth: Auth; souls: Souls; god?: GodMode};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
/** Only local reverse proxies may supply the client address. The nearest hop
 * wins; a public client's prepended X-Forwarded-For cannot choose its bucket. */
export function feedbackIp(c: Context) {
  let remote: string | undefined;
  try { remote = getConnInfo(c).remote.address; } catch { /* in-process Hono fixtures have no socket */ }
  if (remote && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return remote;
  return c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim() || remote || 'local';
}
const parsed = <T>(schema: z.ZodType<T>, input: unknown): T => {
  const result = schema.safeParse(input);
  if (!result.success) throw new ApiError(400, 'invalid', 'Request format is invalid.');
  return result.data;
};

/** One bounded JSONL file per world. A receipt is returned only after fsync. */
export class FeedbackLog {
  readonly directory: string; readonly file: string; readonly maxBytes: number;
  constructor(directory: string, worldId: string, maxBytes = FEEDBACK_MAX_BYTES) {
    this.directory = directory; this.file = join(directory, `${hash(worldId)}.jsonl`); this.maxBytes = maxBytes;
  }
  append(entry: FeedbackEntry) {
    mkdirSync(this.directory, {recursive: true, mode: 0o700});
    const line = JSON.stringify(entry) + '\n', bytes = Buffer.byteLength(line);
    if (bytes > this.maxBytes) throw new ApiError(413, 'too-large', 'Feedback is too large.');
    if (existsSync(this.file) && statSync(this.file).size + bytes > this.maxBytes) {
      // Retain complete newest lines. Atomic replacement prevents half a trim.
      const lines = readFileSync(this.file, 'utf8').trimEnd().split('\n');
      let retained = '', used = bytes;
      for (let i = lines.length - 1; i >= 0; i--) {
        const previous = lines[i]! + '\n', n = Buffer.byteLength(previous);
        if (used + n > this.maxBytes) break;
        retained = previous + retained; used += n;
      }
      const temporary = this.file + '.next';
      writeFileSync(temporary, retained + line, {mode: 0o600});
      const fd = openSync(temporary, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temporary, this.file);
    } else {
      const fd = openSync(this.file, 'a', 0o600);
      try { writeFileSync(fd, line); fsyncSync(fd); } finally { closeSync(fd); }
    }
    const dir = openSync(this.directory, 'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
  }
  read(limit = 50): FeedbackEntry[] {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, 'utf8').trimEnd().split('\n').filter(Boolean).slice(-limit).map(line => JSON.parse(line) as FeedbackEntry).reverse();
  }
}

export class WelcomeService {
  readonly d: Deps; readonly feedback: FeedbackLog;
  constructor(d: Deps) {
    this.d = d; this.feedback = new FeedbackLog(join(d.cfg.dataDir, 'feedback'), d.host.worldId);
    d.db.db.exec(`
      CREATE TABLE IF NOT EXISTS welcome_visits_v1 (world_id TEXT NOT NULL, account_id TEXT NOT NULL, at INTEGER NOT NULL, body TEXT NOT NULL, pending_at INTEGER, pending_body TEXT, PRIMARY KEY(world_id,account_id)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS welcome_feedback_limits_v1 (world_id TEXT NOT NULL, key_hash TEXT NOT NULL, window INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(world_id,key_hash)) WITHOUT ROWID;
    `);
  }
  private has(table: string) { return !!this.d.db.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table); }
  worldOwner(user: UserRow) { return (this.d.god ? this.d.god.owner : this.d.cfg.ownerId) === user.id; }
  private owned(id: string) { return this.d.souls.ownedRows(id).filter(s => !s.retired_at && s.world_id === this.d.host.worldId); }
  private heads(rows: SoulRow[]) {
    const out: Record<string, number> = Object.create(null);
    if (this.has('edge_comms_heads')) for (const row of rows) {
      out[row.id] = (this.d.db.db.prepare('SELECT head FROM edge_comms_heads WHERE world_id=? AND soul_id=?').get(this.d.host.worldId, row.id) as {head: number} | undefined)?.head ?? 0;
    }
    return out;
  }
  private snapshot(rows: SoulRow[], at: number): Cutoff {
    return {at, event: this.d.db.lastSeq(this.d.host.worldId), edit: this.has('world_edits_v1') ? (this.d.db.db.prepare('SELECT MAX(seq) AS seq FROM world_edits_v1 WHERE world_id=?').get(this.d.host.worldId) as {seq: number | null}).seq ?? 0 : 0, heads: this.heads(rows)};
  }
  private row(id: string) { return this.d.db.db.prepare('SELECT at,body,pending_at,pending_body FROM welcome_visits_v1 WHERE world_id=? AND account_id=?').get(this.d.host.worldId, id) as VisitRow | undefined; }
  submit(input: unknown, user: UserRow | null, ip: string, now = Date.now()) {
    const value = parsed(feedbackSchema, input), keys = [`ip:${ip}`, ...(user ? [`account:${user.id}`] : [])].map(hash), window = Math.floor(now / WINDOW_MS);
    tx(this.d.db.db, () => {
      const read = this.d.db.db.prepare('SELECT window,count FROM welcome_feedback_limits_v1 WHERE world_id=? AND key_hash=?');
      for (const key of keys) {
        const row = read.get(this.d.host.worldId, key) as {window: number; count: number} | undefined;
        if (row?.window === window && row.count >= FEEDBACK_PER_WINDOW) throw new ApiError(429, 'rate-limited', 'Please wait before sending more feedback.', {retry_after: Math.max(1, Math.ceil(((window + 1) * WINDOW_MS - now) / 1000))});
      }
      this.d.db.db.prepare('DELETE FROM welcome_feedback_limits_v1 WHERE window<?').run(window - 1);
      const write = this.d.db.db.prepare('INSERT INTO welcome_feedback_limits_v1(world_id,key_hash,window,count) VALUES(?,?,?,1) ON CONFLICT(world_id,key_hash) DO UPDATE SET window=excluded.window,count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END');
      for (const key of keys) write.run(this.d.host.worldId, key, window);
    });
    const entry: FeedbackEntry = {...value, id: 'fb_' + randomUUID().replaceAll('-', ''), worldId: this.d.host.worldId, build: this.d.cfg.build, receivedAt: now, serverTick: this.d.host.engine.world.tick, accountId: user?.id ?? null};
    this.feedback.append(entry);
    return {ok: true, id: entry.id, receivedAt: now, message: 'We got it.'};
  }
  private resident(row: SoulRow, since: Cutoff, until: Cutoff) {
    const {db, host} = this.d, events: AwayEvent[] = [], places = new Set<string>(), conversations = new Set<string>();
    let incomplete = false;
    const birth = db.db.prepare("SELECT seq,tick,at FROM events WHERE world_id=? AND soul_id=? AND seq>? AND seq<=? AND kind='birth' ORDER BY seq LIMIT 1").get(host.worldId, row.id, since.event, until.event) as {seq: number; tick: number; at: number} | undefined;
    if (birth) events.push({id: `event_${birth.seq}`, at: birth.at, tick: birth.tick, kind: 'birth', text: `${oneLine(row.name, 80)} arrived.`});
    if (this.has('edge_comms_stream')) {
      const start = since.heads[row.id] ?? 0, end = until.heads[row.id] ?? 0;
      const floor = (db.db.prepare('SELECT floor FROM edge_comms_heads WHERE world_id=? AND soul_id=?').get(host.worldId, row.id) as {floor: number} | undefined)?.floor ?? 0;
      incomplete ||= start < floor;
      const rows = db.db.prepare('SELECT seq,tick,at,kind,body FROM edge_comms_stream WHERE world_id=? AND soul_id=? AND seq>? AND seq<=? ORDER BY seq DESC LIMIT ?').all(host.worldId, row.id, start, end, AWAY_SCAN + 1) as {seq: number; tick: number; at: number; kind: string; body: string}[];
      incomplete ||= rows.length > AWAY_SCAN;
      for (const e of rows.slice(0, AWAY_SCAN).reverse()) {
        const body = JSON.parse(e.body) as Record<string, unknown>, raw = {...body, id: `c_${e.seq}`, tick: e.tick, at: e.at, kind: e.kind} as StreamEvent;
        const env = toEnvelope(raw, {soulId: row.id, name: row.name});
        if (e.kind.startsWith('conversation.') && typeof body.conversation === 'string') conversations.add(body.conversation);
        if (e.kind === 'arrive') {
          const path = body.placePath as unknown[] | undefined, first = path?.[0];
          const place = env.where?.place ?? (typeof first === 'string' ? first : first && typeof first === 'object' ? (first as {name?: string; id?: string}).name ?? (first as {id?: string}).id : undefined);
          if (place) places.add(oneLine(place, 80));
        }
        // Own actions, actual conversations and arrivals rank above nearby noise.
        if (['receipt.terminal', 'blocked', 'arrive', 'conversation.turn', 'conversation.closed', 'plan.step.done', 'plan.done', 'ride', 'item.received'].includes(env.kind))
          events.push({id: env.id, at: e.at, tick: e.tick, kind: env.kind, text: oneLine(env.text, 200)});
      }
    } else {
      // Non-edge worlds have a canonical per-Soul event log; retain only public
      // factual event kinds, never mind prompts, plans, credentials or errors.
      const rows = db.db.prepare("SELECT seq,tick,kind,payload,at FROM events WHERE world_id=? AND soul_id=? AND seq>? AND seq<=? AND kind IN ('retire','play','say','talk') ORDER BY seq DESC LIMIT ?").all(host.worldId, row.id, since.event, until.event, AWAY_SCAN + 1) as {seq: number; tick: number; kind: string; payload: string; at: number}[];
      incomplete ||= rows.length > AWAY_SCAN;
      for (const e of rows.slice(0, AWAY_SCAN).reverse()) {
        const p = JSON.parse(e.payload);
        events.push({id: `event_${e.seq}`, at: e.at, tick: e.tick, kind: e.kind, text: oneLine(e.kind === 'birth' ? `${row.name} arrived.` : e.kind === 'retire' ? `${row.name} retired.` : e.kind === 'play' ? `Played ${p.cardName ?? p.card?.name ?? 'a card'}.` : `${row.name} spoke${typeof p.text === 'string' ? ': ' + p.text : '.'}`, 200)});
      }
      incomplete = true; // canonical events do not retain full edge place/conversation history
    }
    incomplete ||= events.length > 5 || places.size > 4;
    return {id: row.id, name: row.name, events: events.slice(-5).reverse(), conversations: conversations.size, places: [...places].slice(-4), incomplete};
  }
  private changes(since: Cutoff, until: Cutoff) {
    const {db, host} = this.d, changes: AwayEvent[] = [];
    let incomplete = false;
    if (this.has('world_edits_v1')) {
      const edits = db.db.prepare('SELECT seq,at,ops,kind FROM world_edits_v1 WHERE world_id=? AND seq>? AND seq<=? ORDER BY seq DESC LIMIT ?').all(host.worldId, since.edit, until.edit, AWAY_SCAN + 1) as {seq: number; at: number; ops: string; kind: string}[];
      incomplete ||= edits.length > AWAY_SCAN;
      for (const edit of edits.slice(0, AWAY_SCAN).reverse()) {
        const ops = JSON.parse(edit.ops) as {op: string; name?: string; def?: string; state?: {weather?: {kind?: string}}}[];
        const builds = ops.filter(op => ['place', 'remove', 'patch', 'move', 'clone', 'restore'].includes(op.op));
        if (builds.length) changes.push({id: `edit_${edit.seq}`, at: edit.at, kind: 'build', text: `${builds.length} world building ${builds.length === 1 ? 'change' : 'changes'} recorded${builds[0]?.name ? ': ' + oneLine(builds[0].name, 80) : ''}${edit.kind === 'undo' ? ' (undo)' : edit.kind === 'redo' ? ' (redo)' : ''}.`});
        const weather = ops.filter(op => op.op === 'world' && op.state?.weather !== undefined).at(-1)?.state?.weather;
        if (weather) changes.push({id: `weather_${edit.seq}`, at: edit.at, kind: 'weather', text: `Weather changed${weather.kind ? ' to ' + oneLine(weather.kind, 40) : ''}.`});
      }
    }
    const births = db.db.prepare("SELECT seq,tick,at,payload FROM events WHERE world_id=? AND seq>? AND seq<=? AND kind='birth' ORDER BY seq DESC LIMIT 25").all(host.worldId, since.event, until.event) as {seq: number; tick: number; at: number; payload: string}[];
    incomplete ||= births.length > 24;
    for (const birth of births.slice(0, 24)) { const p = JSON.parse(birth.payload); changes.push({id: `event_${birth.seq}`, at: birth.at, tick: birth.tick, kind: 'resident', text: `${oneLine(p.name ?? 'A resident', 80)} arrived.`}); }
    return {changes: changes.sort((a, b) => b.at - a.at).slice(0, 8), incomplete: incomplete || changes.length > 8};
  }
  away(user: UserRow, now = Date.now()) {
    const rows = this.owned(user.id), previous = this.row(user.id), firstVisit = !previous || previous.at === 0;
    const through = Math.max(now, (previous?.pending_at ?? previous?.at ?? 0) + 1), until = this.snapshot(rows, through), since = firstVisit ? until : JSON.parse(previous.body) as Cutoff;
    const residents = rows.slice(0, AWAY_RESIDENTS).map(row => this.resident(row, since, until));
    const owned = this.worldOwner(user), world = {owned, ...(owned ? this.changes(since, until) : {changes: [], incomplete: false})};
    this.d.db.db.prepare('INSERT INTO welcome_visits_v1(world_id,account_id,at,body,pending_at,pending_body) VALUES(?,?,0,?,?,?) ON CONFLICT(world_id,account_id) DO UPDATE SET pending_at=excluded.pending_at,pending_body=excluded.pending_body').run(this.d.host.worldId, user.id, JSON.stringify(until), through, JSON.stringify(until));
    return {worldId: this.d.host.worldId, since: firstVisit ? null : since.at, through, firstVisit, residents, world, incomplete: rows.length > AWAY_RESIDENTS || residents.some(r => r.incomplete) || world.incomplete, note: 'Factual retained events only; nearby speech and unrecorded changes may be absent.'};
  }
  visit(user: UserRow, input: unknown, now = Date.now()) {
    const {through} = parsed(z.object({through: z.number().int().positive().optional()}).strict(), input), previous = this.row(user.id);
    if (through !== undefined && previous?.at === through) return {ok: true, visitedAt: through};
    if (through !== undefined && (previous?.pending_at !== through || !previous.pending_body)) throw new ApiError(409, 'cutoff-expired', 'Refresh the return summary before marking it read.');
    const cutoff: Cutoff = through === undefined ? this.snapshot(this.owned(user.id), Math.max(now, (previous?.at ?? 0) + 1)) : JSON.parse(previous!.pending_body!);
    if (previous && previous.at > cutoff.at) return {ok: true, visitedAt: previous.at};
    this.d.db.db.prepare('INSERT INTO welcome_visits_v1(world_id,account_id,at,body) VALUES(?,?,?,?) ON CONFLICT(world_id,account_id) DO UPDATE SET at=excluded.at,body=excluded.body').run(this.d.host.worldId, user.id, cutoff.at, JSON.stringify(cutoff));
    return {ok: true, visitedAt: cutoff.at};
  }
}

export function mountWelcomeRoutes(app: Hono, d: Deps) {
  const service = new WelcomeService(d), bearer = (c: Context) => c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  const user = async (c: Context) => { const u = await d.auth.userFromToken(bearer(c)); if (!u) throw new ApiError(401, 'unauthorized', 'Sign in first.'); return u; };
  const body = async (c: Context) => { try { return await c.req.json(); } catch { throw new ApiError(400, 'bad-json', 'Body must be JSON.'); } };
  for (const path of ['/v1/feedback', '/v1/me/away', '/v1/me/visit']) app.use(path, async (c, next) => {c.header('Cache-Control', 'no-store'); await next();});
  app.post('/v1/feedback', async c => c.json(service.submit(await body(c), await d.auth.userFromToken(bearer(c)), feedbackIp(c)), 201));
  app.get('/v1/feedback', async c => {
    if (!service.worldOwner(await user(c))) throw new ApiError(403, 'forbidden', 'Only this world’s owner can read feedback.');
    const n = Number(c.req.query('limit') ?? 50), limit = Number.isFinite(n) ? Math.max(1, Math.min(100, Math.floor(n))) : 50;
    return c.json({worldId: d.host.worldId, entries: service.feedback.read(limit), retainedOnly: true, maxBytes: FEEDBACK_MAX_BYTES});
  });
  app.get('/v1/me/away', async c => c.json(service.away(await user(c))));
  app.post('/v1/me/visit', async c => c.json(service.visit(await user(c), await body(c))));
  return service;
}
