// Soul operations shared by the web API, the agent API and MCP.
import { randomBytes } from 'node:crypto';
import { createSoulSchema, describeIntent, intentSchema, type BirthPayload, type IntentPayload, type LogEvent, type WireIntent } from '@sim/protocol';
import { hashToken, newId, newSoulToken, RateLimit } from './auth.ts';
import type { Brain } from './brain.ts';
import { tickerText } from './brain.ts';
import type { Config } from './config.ts';
import type { Db, SoulRow, UserRow } from './db.ts';
import { WORLD_ID, energyWord, type WorldHost } from './world.ts';

export class ApiError extends Error {
  status: number; code: string; extra?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) { super(message); this.status = status; this.code = code; this.extra = extra; }
}

type Pairing =
  | { kind: 'owner'; code: string; soulId: string; expires: number }                                     // owner made a code; the agent exchanges it
  | { kind: 'agent'; code: string; poll: string; agent: string; expires: number; token?: string; soulId?: string }; // agent asked; the owner approves
const PAIR_TTL = 15 * 60_000;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
const humanCode = () => { const b = randomBytes(8); let s = ''; for (let i = 0; i < 8; i++) s += ALPHABET[b[i] % ALPHABET.length]; return `${s.slice(0, 4)}-${s.slice(4)}`; };
const normCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2');

export class Souls {
  limits = new RateLimit();
  private pairings = new Map<string, Pairing>();
  private waiters = new Map<string, Set<(reason: string) => void>>();
  private lastTouch = new Map<string, number>();
  host: WorldHost; db: Db; brain: Brain; cfg: Config;
  constructor(host: WorldHost, db: Db, brain: Brain, cfg: Config) {
    this.host = host; this.db = db; this.brain = brain; this.cfg = cfg;
    host.listeners.push({
      onApplied: (e) => { const id = (e.payload as { soulId?: string })?.soulId; if (id) this.wake(id, e.kind === 'decision' ? `started: ${(e.payload as { label: string }).label}` : e.kind === 'intent' ? 'a new intent was accepted' : e.kind); },
      onRuntimeEvent: (ev) => {
        if (ev.type !== 'action' || ev.verb !== 'do_activity' || (ev.status !== 'completed' && ev.status !== 'failed')) return;
        const actor = (host.engine.runtime.records.get(ev.id)?.params as { actor?: string } | undefined)?.actor;
        const m = actor ? host.mindByEntity.get(actor) : undefined;
        const label = (host.engine.runtime.records.get(ev.id)?.params as { label?: string } | undefined)?.label ?? 'the activity';
        if (m) this.wake(m.soulId, ev.status === 'completed' ? `finished: ${label}` : `could not complete: ${label} (${ev.code ?? 'failed'})`);
      },
    });
    setInterval(() => { const now = Date.now(); for (const [k, p] of this.pairings) if (p.expires < now) this.pairings.delete(k); }, 60_000).unref();
  }

  // ------------------------------------------------------------ access
  invited(u: UserRow): boolean { return !this.cfg.inviteRequired || u.role === 'admin' || !!u.invited_by; }
  requireInvited(u: UserRow) { if (!this.invited(u)) throw new ApiError(403, 'invite-required', 'an invite code is needed during the alpha'); }
  redeemInvite(u: UserRow, code: string) {
    if (this.invited(u)) return;
    const lim = this.limits.allow(`invite:${u.id}`, 10, 3600_000); if (!lim.ok) throw new ApiError(429, 'rate-limited', 'too many attempts', { retry_after: lim.retryAfter });
    if (!this.db.useInvite(code.trim())) throw new ApiError(404, 'invite-invalid', 'that invite code is not valid or is used up');
    this.db.setInvited(u.id, code.trim());
  }

  // ------------------------------------------------------------ lifecycle
  async create(owner: string, input: unknown, native = false): Promise<SoulRow> {
    const p = createSoulSchema.safeParse(input);
    if (!p.success) throw new ApiError(400, 'invalid', p.error.issues.map((i) => i.message).join('; '));
    if (!native && this.db.soulsOf(owner).length >= this.cfg.maxSoulsPerUser) throw new ApiError(409, 'too-many', `at most ${this.cfg.maxSoulsPerUser} souls per account`);
    if (this.db.soulByName(WORLD_ID, p.data.name)) throw new ApiError(409, 'name-taken', `a soul named ${p.data.name} already exists`);
    const id = newId('s'); const entityId = `h_${id.slice(2)}`;
    this.db.createSoul({ id, worldId: WORLD_ID, owner, entityId, name: p.data.name, description: p.data.description, native });
    await this.host.enqueue('birth', native ? 'world' : `soul:${id}`, { soulId: id, entityId, name: p.data.name, description: p.data.description, owner } satisfies BirthPayload);
    return this.db.soul(id)!;
  }
  async retire(soul: SoulRow) {
    this.db.retireSoul(soul.id);
    await this.host.enqueue('retire', `soul:${soul.id}`, { soulId: soul.id, entityId: soul.entity_id });
  }

  // ------------------------------------------------------------ steering
  /** Set the standing intent. Resolves once the tick has accepted it (blocking mutation). */
  async setIntent(soul: SoulRow, input: unknown, source: IntentPayload['source']): Promise<{ event: LogEvent; intent: WireIntent; text: string }> {
    const lim = this.limits.allow(`intent:${soul.id}`, 20, 60_000);
    if (!lim.ok) throw new ApiError(429, 'rate-limited', 'too many intents; slow down', { retry_after: lim.retryAfter });
    const p = intentSchema.safeParse(input);
    if (!p.success) throw new ApiError(400, 'invalid-intent', p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    const w = this.host.engine.world;
    const intent = p.data;
    if (intent.target) {
      // accept an entity id, a region id, or a soul/place name
      const t = intent.target, low = t.toLowerCase();
      if (!w.entities[t] && !w.regions[t]) {
        const byName = Object.values(w.entities).find((e) => (e.label ?? '').toLowerCase() === low) ?? Object.values(w.entities).find((e) => (e.label ?? '').toLowerCase().replace(/^the /, '') === low.replace(/^the /, ''));
        const region = Object.values(w.regions).find((r) => r.label.toLowerCase() === low);
        if (byName) intent.target = byName.id; else if (region) intent.target = region.id;
        else throw new ApiError(400, 'unknown-target', `no such target: ${t}. Look at the world or perceive endpoints for valid names and ids.`);
      }
    }
    const event = await this.host.enqueue('intent', `soul:${soul.id}`, { soulId: soul.id, intent, source } satisfies IntentPayload);
    return { event, intent, text: describeIntent(intent, (id) => w.entities[id]?.label ?? w.regions[id]?.label ?? id) };
  }

  /** Free text → closed intent via the server's small translator, then the same path as setIntent. */
  async command(soul: SoulRow, text: string, source: IntentPayload['source'] = 'web') {
    const lim = this.limits.allow(`cmd:${soul.id}`, 20, 60_000);
    if (!lim.ok) throw new ApiError(429, 'rate-limited', 'too many commands; slow down', { retry_after: lim.retryAfter });
    const mind = this.host.minds.get(soul.id);
    if (!mind) throw new ApiError(409, 'not-in-world', 'this soul is not in the world yet');
    const tr = await this.brain.translate(mind, text);
    if (!tr.ok) return { ok: false as const, reason: tr.reason, via: tr.via };
    const r = await this.setIntent(soul, tr.intent, source);
    return { ok: true as const, intent: r.intent, text: r.text, tick: r.event.tick, seq: r.event.seq, via: tr.via, confidence: tr.confidence };
  }

  // ------------------------------------------------------------ views
  /** What the Soul itself perceives: the same word-bucketed context its own mind is given, plus ids an agent can target. */
  perceive(soul: SoulRow) {
    const m = this.host.minds.get(soul.id), e = this.host.engine;
    if (!m || !e.world.entities[m.entityId]) throw new ApiError(409, 'not-in-world', 'this soul is not in the world');
    const c = this.brain.midContext(m, 'agent'); const s = e.describeSurroundings(m.entityId);
    return {
      tick: e.world.tick, world: c.world,
      soul: { name: c.soul.name, about: c.soul.about, where: c.soul.where, energy: c.soul.energy, mood: m.mood, doing_now: c.soul.doing, recently: c.soul.recent, intent: m.intent, intent_text: c.soul.intent },
      nearby: s.nearby.map((n) => ({ id: n.id, name: n.who, kind: n.what, distance: n.distance, doing: n.doing })),
      storyteller_suggests: c.nudge,
      could_do_now: c.options.map((o) => ({ id: o.id, what: o.label, good_when: o.goodWhen, not_for: o.notFor, ...(o.servesIntent ? { serves_current_intent: true } : {}) })),
    };
  }

  status(soul: SoulRow) {
    const m = this.host.minds.get(soul.id); const e = this.host.engine;
    if (!m || !e.world.entities[m.entityId]) return { id: soul.id, name: soul.name, description: soul.description, in_world: false };
    const ent = e.world.entities[m.entityId]; const s = e.describeSurroundings(m.entityId);
    const nameOf = (id: string) => e.world.entities[id]?.label ?? e.world.regions[id]?.label ?? id;
    return {
      id: soul.id, name: soul.name, description: soul.description, in_world: true, tick: e.world.tick, time: e.world.env.datetime,
      position: { x: ent.pose.p[0], z: ent.pose.p[2], region: s.region }, activity: ent.human!.activity, doing: ent.human!.task ? m.doing : 'standing around',
      mood: m.mood, energy: energyWord(m.energy), wants_company: m.wantsCompany,
      intent: m.intent, intent_text: describeIntent(m.intent, nameOf), recent: m.recent, nearby: s.nearby, happening: s.happening,
      storyteller_suggests: m.nudge?.text ?? null,
      next_think_in_s: Math.max(0, Math.round((m.nextEvalTick - e.world.tick) / 20)),
      available_now: e.enumerateActivities(m.entityId, m.intent).map((o) => ({ id: o.id, label: o.label })),
    };
  }

  /** Everything the owner's dashboard shows for one Soul. */
  dashboard(soul: SoulRow) {
    return {
      status: this.status(soul),
      agent: { attached: !!soul.token_hash, label: soul.token_label, since: soul.token_created_at, last_used: soul.token_last_used },
      spend: this.db.soulSpend(soul.id),
      created_at: soul.created_at,
    };
  }

  /** The Soul's story so far, for its owner: its own events plus storyteller beats that named it. */
  timeline(soul: SoulRow, limit = 80) {
    const w = this.host.engine.world;
    const label = (id: string) => w.entities[id]?.label ?? w.regions[id]?.label ?? id;
    const own = this.db.soulEvents(WORLD_ID, soul.id, limit);
    const since = own[0]?.seq ?? 0;
    const beats = this.db.recentKind(WORLD_ID, 'scene', 300).filter((e) => e.seq >= since && Array.isArray(e.payload?.beat?.targets) && e.payload.beat.kind !== 'scene' && e.payload.beat.targets.includes(soul.name));
    return [...own, ...beats].sort((a, b) => a.seq - b.seq).slice(-limit).map((e) => {
      const p = e.payload;
      const text = e.kind === 'birth' ? 'was born at the gate'
        : e.kind === 'intent' ? `intent set via ${p.source === 'web' ? 'this page' : p.source === 'system' ? 'the world' : `your agent (${p.source})`}: ${describeIntent(p.intent, label)}`
        : e.kind === 'decision' ? `${p.option === 'continue' ? 'kept going' : lower(p.label)}`
        : e.kind === 'scene' ? `the storyteller suggested: ${p.beat.directive} — ${p.beat.flavor}`
        : e.kind === 'retire' ? 'left the world' : e.kind;
      const why = e.kind === 'decision' ? ({ 'new-intent': 'because you gave a new intent', 'activity-ended': 'after finishing the last thing', 'activity-failed': 'after the last thing did not work out', 'narrator-beat': 'after a storyteller suggestion', birth: 'first choice after arriving', timer: 'on reflection' } as Record<string, string>)[p.trigger] ?? p.trigger : null;
      return { seq: e.seq, tick: e.tick, at: e.at, kind: e.kind, text, why, mood: e.kind === 'decision' ? p.mood : null, fallback: e.kind === 'decision' ? !!p.fallback : false, call: e.kind === 'decision' ? p.call ?? null : null };
    });
  }

  worldSummary() {
    const e = this.host.engine, w = e.world;
    return {
      world: WORLD_ID, tick: w.tick, time: w.env.datetime, rules_version: e.rulesVersion, size_m: 100,
      goals: ['wander', 'go', 'follow', 'attend', 'gather', 'converse', 'rest', 'perform'],
      regions: Object.values(w.regions).map((r) => ({ id: r.id, label: r.label })),
      places: Object.values(w.entities).filter((x) => x.kind === 'fixture').map((x) => ({ id: x.id, label: x.label, x: x.pose.p[0], z: x.pose.p[2] })),
      souls: [...this.host.minds.values()].map((m) => { const p = this.host.publicSoul(m); const ent = w.entities[m.entityId]; return { id: m.entityId, name: p.name, about: p.description, doing: p.doing, mood: p.mood, region: ent ? e.regionAt(ent.pose.p) : null }; }),
    };
  }

  soulLog(soul: SoulRow, limit = 30) {
    return this.db.soulEvents(WORLD_ID, soul.id, limit).map((e) => ({ seq: e.seq, tick: e.tick, kind: e.kind, text: tickerText(e, this.host) }));
  }

  // ------------------------------------------------------------ waiting (long-poll for agents)
  private wake(soulId: string, reason: string) { const s = this.waiters.get(soulId); if (!s) return; this.waiters.delete(soulId); for (const r of s) r(reason); }
  /** Resolve when something happens to the Soul (activity ends, a new one starts, an intent lands) or after `seconds`. */
  async wait(soul: SoulRow, seconds: number): Promise<{ reason: string; status: ReturnType<Souls['status']> }> {
    const secs = Math.max(1, Math.min(55, Math.round(seconds || 30)));
    const set = this.waiters.get(soul.id) ?? new Set(); this.waiters.set(soul.id, set);
    if (set.size >= 4) throw new ApiError(429, 'too-many-waits', 'too many concurrent waits for this soul', { retry_after: 5 });
    const reason = await new Promise<string>((resolve) => {
      const t = setTimeout(() => { set.delete(done); resolve('timeout'); }, secs * 1000);
      const done = (r: string) => { clearTimeout(t); resolve(r); };
      set.add(done);
    });
    return { reason, status: this.status(this.db.soul(soul.id) ?? soul) };
  }

  // ------------------------------------------------------------ pairing an agent
  private mint(soulId: string, label: string | null) { const token = newSoulToken(soulId); this.db.setSoulToken(soulId, hashToken(token), label); return token; }
  /** Owner-initiated: a short code the owner pastes to their agent along with the skill link. */
  pairCode(soul: SoulRow, base: string) {
    for (const [k, p] of this.pairings) if (p.kind === 'owner' && p.soulId === soul.id) this.pairings.delete(k);
    const code = humanCode();
    this.pairings.set(code, { kind: 'owner', code, soulId: soul.id, expires: Date.now() + PAIR_TTL });
    return { code, expires_in: PAIR_TTL / 1000, prompt: `Read ${base}/skill.md and follow it to steer my Soul "${soul.name}" in Sim. Pairing code: ${code}` };
  }
  /** Agent side of the owner-initiated flow: exchange the code for a token. One use. */
  pairExchange(codeRaw: string, agent: string | undefined) {
    const code = normCode(codeRaw); const p = this.pairings.get(code);
    if (!p || p.kind !== 'owner' || p.expires < Date.now()) throw new ApiError(404, 'pair-invalid', 'that pairing code is invalid, already used, or expired; ask your human for a new one');
    this.pairings.delete(code);
    const soul = this.db.soul(p.soulId);
    if (!soul || soul.retired_at) throw new ApiError(404, 'pair-invalid', 'that soul no longer exists');
    return { token: this.mint(soul.id, agent?.slice(0, 60) || 'agent'), soul: { id: soul.id, name: soul.name, description: soul.description } };
  }
  /** Agent-initiated (no code yet): the agent gets a link for its human to approve, then polls. */
  pairStart(agent: string | undefined, base: string) {
    const code = humanCode(), poll = randomBytes(24).toString('base64url');
    this.pairings.set(code, { kind: 'agent', code, poll, agent: agent?.slice(0, 60) || 'an agent', expires: Date.now() + PAIR_TTL });
    return { user_code: code, approve_url: `${base}/#pair/${code}`, poll_token: poll, interval_s: 3, expires_in: PAIR_TTL / 1000, tell_your_human: `Open ${base}/#pair/${code} , sign in, and approve me to steer one of your Souls.` };
  }
  pairInfo(codeRaw: string) {
    const p = this.pairings.get(normCode(codeRaw));
    if (!p || p.kind !== 'agent' || p.expires < Date.now()) throw new ApiError(404, 'pair-invalid', 'that request is invalid or has expired');
    return { code: p.code, agent: p.agent, approved: !!p.token };
  }
  pairApprove(user: UserRow, codeRaw: string, soul: SoulRow) {
    const p = this.pairings.get(normCode(codeRaw));
    if (!p || p.kind !== 'agent' || p.expires < Date.now()) throw new ApiError(404, 'pair-invalid', 'that request is invalid or has expired');
    if (p.token) throw new ApiError(409, 'pair-done', 'already approved');
    p.token = this.mint(soul.id, p.agent); p.soulId = soul.id;
    void user;
  }
  pairPoll(poll: string) {
    const p = [...this.pairings.values()].find((x) => x.kind === 'agent' && x.poll === poll);
    if (!p || p.kind !== 'agent' || p.expires < Date.now()) throw new ApiError(404, 'pair-invalid', 'unknown or expired pairing; start again');
    if (!p.token) return { status: 'pending' as const };
    this.pairings.delete(p.code);
    const soul = this.db.soul(p.soulId!)!;
    return { status: 'approved' as const, token: p.token, soul: { id: soul.id, name: soul.name, description: soul.description } };
  }

  soulFromToken(token: string | undefined): SoulRow | null {
    if (!token?.startsWith('sim_')) return null;
    const soul = this.db.soulByTokenHash(hashToken(token)) ?? null;
    if (soul) { const now = Date.now(); if (now - (this.lastTouch.get(soul.id) ?? 0) > 30_000) { this.lastTouch.set(soul.id, now); this.db.touchSoulToken(soul.id); } }
    return soul;
  }
}
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
