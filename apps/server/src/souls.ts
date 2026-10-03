// Soul operations shared by the web API, the agent API and MCP.
import { randomBytes } from 'node:crypto';
import { createSoulSchema, describeIntent, intentSchema, proposeCardsSchema, type AgendaStep, type BirthPayload, type DeckPayload, type IntentPayload, type LogEvent, type WireIntent } from '@sim/protocol';
import { deckView } from './deck.ts';
import { hashToken, newId, newSoulToken, RateLimit } from './auth.ts';
import type { Brain } from './brain.ts';
import { tickerText } from './brain.ts';
import type { Config } from './config.ts';
import type { Db, SoulRow, UserRow } from './db.ts';
import { energyWord, type WorldHost } from './world.ts';

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
      onProgram: (ev, m) => {
        if (ev.kind === 'completed') this.wake(m.soulId, `finished: ${m.doing}`);
        else if (ev.kind === 'failed') this.wake(m.soulId, `could not complete: ${m.doing} (${ev.code ?? 'failed'})`);
      },
    });
    this.carryOverDirections();
    setInterval(() => { const now = Date.now(); for (const [k, p] of this.pairings) if (p.expires < now) this.pairings.delete(k); }, 60_000).unref();
  }

  // ------------------------------------------------------------ access
  invited(u: UserRow): boolean { return !this.cfg.inviteRequired || u.role === 'admin' || !!u.invited_by; }
  requireInvited(u: UserRow) { if (!this.invited(u)) throw new ApiError(403, 'invite-required', 'an invite code is needed during the alpha'); }
  redeemInvite(u: UserRow, code: string) {
    if (this.invited(this.db.user(u.id) ?? u)) return;
    const lim = this.limits.allow(`invite:${u.id}`, 10, 3600_000); if (!lim.ok) throw new ApiError(429, 'rate-limited', 'too many attempts', { retry_after: lim.retryAfter });
    if (!this.db.useInvite(code.trim())) throw new ApiError(404, 'invite-invalid', 'that invite code is not valid or is used up');
    this.db.setInvited(u.id, code.trim());
  }

  // ------------------------------------------------------------ lifecycle
  async create(owner: string, input: unknown, native = false): Promise<SoulRow> {
    const p = createSoulSchema.safeParse(input);
    if (!p.success) throw new ApiError(400, 'invalid', p.error.issues.map((i) => i.message).join('; '));
    if (!native && this.db.soulsOf(owner).length >= this.cfg.maxSoulsPerUser) throw new ApiError(409, 'too-many', `at most ${this.cfg.maxSoulsPerUser} souls per account`);
    if (this.db.soulByName(this.host.worldId, p.data.name)) throw new ApiError(409, 'name-taken', `a soul named ${p.data.name} already exists`);
    const id = newId('s'); const entityId = `h_${id.slice(2)}`;
    this.db.createSoul({ id, worldId: this.host.worldId, owner, entityId, name: p.data.name, description: p.data.description, native });
    await this.host.enqueue('birth', native ? 'world' : `soul:${id}`, { soulId: id, entityId, name: p.data.name, description: p.data.description, owner } satisfies BirthPayload);
    return this.db.soul(id)!;
  }
  async retire(soul: SoulRow) {
    this.db.retireSoul(soul.id);
    await this.host.enqueue('retire', `soul:${soul.id}`, { soulId: soul.id, entityId: soul.entity_id });
  }

  // ------------------------------------------------------------ steering
  /** Find a kernel thing by id, by a body's entity id, or by name ("the kiosk", "kiosk", "Oda"). */
  resolveThing(ref: string): string | null {
    const k = this.host.kernel; if (k.things[ref]) return ref;
    const low = ref.toLowerCase().replace(/^the /, '');
    const hit = Object.values(k.things).find((t) => t.traits.body === ref || t.traits.entity === ref) ?? Object.values(k.things).find((t) => t.name.toLowerCase().replace(/^the /, '') === low);
    return hit?.id ?? null;
  }

  /** Souls directed before plans existed (a goal and a target, no agenda) keep their direction: the goal becomes a plan of base cards. */
  carryOverDirections(): number {
    let n = 0;
    for (const m of this.host.minds.values()) {
      if (m.agenda.length || !m.intent?.goal) continue;
      const target = m.intent.target ? this.resolveThing(m.intent.target) : null;
      if (m.intent.target && !target) continue;                                  // what it pointed at is gone
      m.agenda = this.agendaFromGoal(m.intent.goal, target); m.agendaPos = 0; n++;
    }
    return n;
  }

  /** A legacy goal as a one- or two-step agenda of base cards. Deterministic. */
  private agendaFromGoal(goal: NonNullable<WireIntent['goal']>, target: string | null): AgendaStep[] {
    const kind = target ? this.host.kernel.things[target]?.kind : null;
    switch (goal) {
      case 'wander': return [{ card: 'wander', target: null }];
      case 'go': return kind === 'gathering' ? [{ card: 'join', target }] : kind === 'soul' ? [{ card: 'talk with', target }] : [{ card: 'go to', target }];
      case 'follow': case 'converse': return kind === 'soul' || !target ? [{ card: 'talk with', target }] : [{ card: 'go to', target }];
      case 'attend': return kind === 'place' ? [{ card: 'go to', target }] : [{ card: 'join', target: kind === 'gathering' ? target : null }];
      case 'gather': return kind === 'gathering' ? [{ card: 'join', target }] : [{ card: 'host a gathering', target: kind === 'place' ? target : null }];
      case 'rest': return kind === 'place' ? [{ card: 'go to', target }, { card: 'rest', target: null }] : [{ card: 'rest', target: null }];
      case 'perform': return [{ card: 'perform', target: null }];
    }
  }

  /** Set the standing intent. Resolves once the tick has accepted it (blocking mutation). */
  async setIntent(soul: SoulRow, input: unknown, source: IntentPayload['source']): Promise<{ event: LogEvent; intent: WireIntent; text: string }> {
    const lim = this.limits.allow(`intent:${soul.owner}`, 20, 60_000);
    if (!lim.ok) throw new ApiError(429, 'rate-limited', 'too many intents; slow down', { retry_after: lim.retryAfter });
    const p = intentSchema.safeParse(input);
    if (!p.success) throw new ApiError(400, 'invalid-intent', p.error.issues.map((i) => `${i.path.join('.') || 'intent'}: ${i.message}`).join('; '));
    const k = this.host.kernel; const intent: WireIntent = { ...p.data };
    const need = (ref: string) => { const id = this.resolveThing(ref); if (!id) throw new ApiError(400, 'unknown-target', `no such target: ${ref}. Look at the world or perceive endpoints for valid names and ids.`); return id; };
    if (intent.target) intent.target = need(intent.target);
    if (intent.agenda) {
      intent.agenda = intent.agenda.map((a) => {
        if (!k.vocab.cards[a.card]) throw new ApiError(400, 'unknown-card', `no such card: "${a.card}". See your deck, or propose the card first.`);
        return { card: a.card, target: a.target ? need(a.target) : null, ...(a.of ? { of: need(a.of) } : {}) };
      });
      // cards on the agenda that the Soul does not hold yet are dealt to it
      const deal = [...new Set(intent.agenda.map((a) => a.card))].filter((c) => !k.decks[soul.id]?.cards.includes(c));
      if (deal.length) await this.host.enqueue('deck', `soul:${soul.id}`, { soulId: soul.id, add: deal, why: 'on the agenda' } satisfies DeckPayload);
    } else intent.agenda = this.agendaFromGoal(intent.goal!, intent.target ?? null);
    const event = await this.host.enqueue('intent', `soul:${soul.id}`, { soulId: soul.id, intent, source } satisfies IntentPayload);
    return { event, intent, text: describeIntent(intent, (id) => this.host.nameOf(id)) };
  }

  /** A wish in plain words. The compiler turns it into an agenda (minting cards if needed); without a compiler, the small translator picks a goal. */
  async command(soul: SoulRow, text: string, source: IntentPayload['source'] = 'web') {
    const lim = this.limits.allow(`cmd:${soul.owner}`, 20, 60_000);
    if (!lim.ok) throw new ApiError(429, 'rate-limited', 'too many commands; slow down', { retry_after: lim.retryAfter });
    const mind = this.host.minds.get(soul.id);
    if (!mind) throw new ApiError(409, 'not-in-world', 'this soul is not in the world yet');
    // The compiler is the expensive tier and its budget is shared, so each owner gets a fair hourly share of it;
    // past that, the small translator still understands plain goals.
    const fair = this.limits.allow(`compile:${soul.owner}`, 12, 3600_000).ok;
    const c = fair ? await this.brain.compile(mind, text) : null;
    if (c) {
      if (!c.ok) return { ok: false as const, reason: c.reason, via: 'compiler' };
      const r = await this.setIntent(soul, { agenda: c.agenda, text: text.slice(0, 280) }, source);
      return { ok: true as const, intent: r.intent, text: r.text, tick: r.event.tick, seq: r.event.seq, via: 'compiler', confidence: 1, minted: c.minted.filter((v) => v.ok).map((v) => v.name) };
    }
    const tr = await this.brain.translate(mind, text);
    if (!tr.ok) return { ok: false as const, reason: tr.reason, via: tr.via };
    const r = await this.setIntent(soul, tr.intent, source);
    return { ok: true as const, intent: r.intent, text: r.text, tick: r.event.tick, seq: r.event.seq, via: tr.via, confidence: tr.confidence, minted: [] as string[] };
  }

  /** An owner's agent proposes cards for its Soul's deck. Validated like any other card; no model involved. */
  async proposeCards(soul: SoulRow, input: unknown) {
    const lim = this.limits.allow(`cards:${soul.owner}`, 12, 3600_000);
    if (!lim.ok) throw new ApiError(429, 'rate-limited', 'too many card proposals this hour', { retry_after: lim.retryAfter });
    const p = proposeCardsSchema.safeParse(input);
    if (!p.success) throw new ApiError(400, 'invalid', 'body must be { cards: [card, …], links?: {name: {summary, control?}}, kinds?: {name: {summary}} }; see /cards.md');
    const mind = this.host.minds.get(soul.id); if (!mind) throw new ApiError(409, 'not-in-world', 'this soul is not in the world yet');
    const verdicts = await this.brain.mint(mind, p.data.cards, p.data.links, p.data.kinds, 'agent');
    return { ok: verdicts.every((v) => v.ok), cards: verdicts };
  }

  deck(soul: SoulRow) {
    const m = this.host.minds.get(soul.id); if (!m) throw new ApiError(409, 'not-in-world', 'this soul is not in the world yet');
    return deckView(this.host, m);
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
      situation: c.situation ?? [],
      said_to_you: c.heard ?? [],
      agenda: m.agenda.map((a, i) => ({ card: a.card, target: a.target ?? null, ...(a.of ? { of: a.of } : {}), done: i < m.agendaPos })),
      could_do_now: c.options.map((o) => ({ id: o.id, card: o.card, target: o.cardTarget, what: o.label, good_when: o.goodWhen, not_for: o.notFor, ...(o.servesIntent ? { serves_current_intent: true } : {}) })),
    };
  }

  status(soul: SoulRow) {
    const m = this.host.minds.get(soul.id); const e = this.host.engine;
    if (!m || !e.world.entities[m.entityId]) return { id: soul.id, name: soul.name, description: soul.description, in_world: false };
    const ent = e.world.entities[m.entityId]; const s = e.describeSurroundings(m.entityId);
    const nameOf = (id: string) => this.host.nameOf(id);
    return {
      id: soul.id, name: soul.name, description: soul.description, in_world: true, tick: e.world.tick, time: e.world.env.datetime,
      position: { x: ent.pose.p[0], z: ent.pose.p[2], region: s.region }, activity: ent.human!.activity, doing: e.programOf(m.entityId) ? m.doing : 'standing around',
      mood: m.mood, energy: energyWord(m.energy), wants_company: m.wantsCompany,
      ...(m.life ? { needs: m.life.needs, journal: m.life.journal, reflected_day: m.life.reflectedDay, customs: this.host.living?.customs } : {}),
      intent: m.intent, intent_text: describeIntent(m.intent, nameOf), agenda: m.agenda.map((a, i) => ({ card: a.card, target: a.target ? this.host.nameOf(a.target) : null, done: i < m.agendaPos })), recent: m.recent, nearby: s.nearby, happening: s.happening,
      storyteller_suggests: m.nudge?.text ?? null,
      next_think_in_s: Math.max(0, Math.round((m.nextEvalTick - e.world.tick) / 20)),
      available_now: this.brain.midContext(m, 'status').options.map((o) => ({ id: o.id, label: o.label })),
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
    const label = (id: string) => this.host.nameOf(id);
    // things that have since vanished keep the name they had when they were played on
    const past = new Map<string, string>(); for (const pl of this.host.recentPlays) if (pl.target && pl.targetName) past.set(pl.target, pl.targetName);
    const own = this.db.soulEvents(this.host.worldId, soul.id, limit);
    const since = own[0]?.seq ?? 0;
    const beats = this.db.recentKind(this.host.worldId, 'scene', 300).filter((e) => e.seq >= since && Array.isArray(e.payload?.beat?.targets) && e.payload.beat.kind !== 'scene' && e.payload.beat.targets.includes(soul.name));
    return [...own, ...beats].sort((a, b) => a.seq - b.seq).slice(-limit).map((e) => {
      const p = e.payload;
      const text = e.kind === 'birth' ? 'arrived in the world'
        : e.kind === 'intent' ? `intent set via ${p.source === 'web' ? 'this page' : p.source === 'system' ? 'the world' : `your agent (${p.source})`}: ${describeIntent(p.intent, label)}`
        : e.kind === 'decision' ? `set out to ${lower(p.label)}${p.manner ? `, ${p.manner}` : ''}`
        : e.kind === 'play' ? `${p.card}${p.target ? ` → ${past.get(p.target) ?? label(p.target)}` : ''}${p.manner ? `, ${p.manner}` : ''}`
        : e.kind === 'deck' ? `deck changed: ${[...(p.add ?? []).map((c: string) => `+${c}`), ...(p.remove ?? []).map((c: string) => `−${c}`), ...(p.manners ? [`manners: ${p.manners.join(', ')}`] : [])].join(' ')} (${p.why})`
        : e.kind === 'scene' ? `the storyteller suggested: ${p.beat.directive} — ${p.beat.flavor}`
        : e.kind === 'retire' ? 'left the world' : e.kind;
      const why = e.kind === 'decision' ? ({ 'new-intent': 'because you gave a new intent', 'activity-ended': 'after finishing the last thing', 'activity-failed': 'after the last thing did not work out', 'narrator-beat': 'after a storyteller suggestion', 'plan-advanced': 'the plan moved on', 'spoken-to': 'someone spoke to it', birth: 'first choice after arriving', timer: 'on reflection' } as Record<string, string>)[p.trigger] ?? p.trigger : null;
      return { seq: e.seq, tick: e.tick, at: e.at, kind: e.kind, text, why, mood: e.kind === 'decision' ? p.mood : null, fallback: e.kind === 'decision' ? !!p.fallback : false, call: e.kind === 'decision' ? p.call ?? null : null };
    });
  }

  worldSummary() {
    const e = this.host.engine, w = e.world;
    return {
      world: this.host.worldId, tick: w.tick, time: w.env.datetime, rules_version: e.rulesVersion, size_m: 100,
      goals: ['wander', 'go', 'follow', 'attend', 'gather', 'converse', 'rest', 'perform'],
      regions: Object.values(w.regions).map((r) => ({ id: r.id, label: r.label })),
      places: Object.values(w.entities).filter((x) => x.kind === 'fixture').map((x) => ({ id: x.id, label: x.label, x: x.pose.p[0], z: x.pose.p[2] })),
      gatherings: Object.values(this.host.kernel.things).filter((t) => t.kind === 'gathering').map((t) => ({ id: t.id, name: t.name, at: t.at ? this.host.nameOf(t.at) : null, states: t.states, host: Object.values(this.host.kernel.links).filter((l) => l.kind === 'hosts' && l.to === t.id).map((l) => this.host.nameOf(l.from))[0] ?? null, taking_part: Object.values(this.host.kernel.links).filter((l) => l.kind === 'attends' && l.to === t.id).length })),
      souls: [...this.host.minds.values()].map((m) => { const p = this.host.publicSoul(m); const ent = w.entities[m.entityId]; return { id: m.entityId, name: p.name, about: p.description, doing: p.doing, mood: p.mood, region: ent ? e.regionAt(ent.pose.p) : null }; }),
    };
  }

  soulLog(soul: SoulRow, limit = 30) {
    return this.db.soulEvents(this.host.worldId, soul.id, limit).map((e) => ({ seq: e.seq, tick: e.tick, kind: e.kind, text: tickerText(e, this.host) }));
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
