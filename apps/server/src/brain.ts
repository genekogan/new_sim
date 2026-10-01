// The three-tier brain, server side. Schedules calls, records every request
// and response for the debug shell, and turns answers into logged events.
import type { Entity } from '@sim/engine-contract';
import {
  JEV_MODEL, JevClient, buildDirectorRequest, buildMidRequest, buildShotRequest, buildTranslateRequest, callNarrator, buildNarratorRequest, fallbackMid, fingerprint,
  haikuTranslate, interpretDirector, interpretMid, interpretTranslate, sanitize,
  buildAttuneRequest, interpretAttune, callTool, cardGrammar, cleanLines, compileUser, plainLine, talkUser, COMPILER_PREAMBLE, COMPILE_TOOL, TALK_SYSTEM, TALK_TOOL,
  type CompileOut, type SpokenLine, type TalkInput,
  type DirectorContext, type MidContext, type RegionDigest, type ShotCandidate, type Target, type Translation, type ChoiceA,
} from '@sim/brain';
import { GOALS, describeIntent, publicIntent, type Beat, type BrainCall, type CameraLine, type DecisionPayload, type LogEvent, type NarrativeView, type ScenePayload, type TalkLine, type TickerLine, type WireIntent } from '@sim/protocol';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { WORLD_ID, energyWord, hash32, type Mind, type WorldHost } from './world.ts';
import { Governor, SHARES, tierOf, type Tier } from './governor.ts';
import { awaiting, belongsTo, candidatesFor, optionsFor, situationOf, type CardOption } from './deck.ts';
import { cardHash, validateCard, type Card, type LinkKind, type MintedCard } from '@sim/kernel';

const TPS = 20;
const MAX_INFLIGHT = 8;
const DIRECTOR_EVERY = TPS * 6;
const SHOT_COMMIT_TICKS = TPS * 10;
const NARRATE_EVERY = TPS * 60 * 5;

export type BrainSink = { onCall(c: BrainCall): void; onCamera(l: CameraLine): void; onTicker(l: TickerLine[]): void; onNarrative(v: NarrativeView): void; onTalk?(l: TalkLine[]): void; clients(): number };
export type MintVerdict = { name: string; ok: boolean; problems?: string[]; hash?: string };
type NarratorState = { nextRun: Record<string, number>; lastSummary: Record<string, string | null> };

export class Brain {
  jev: JevClient;
  mode: 'live' | 'fake';
  gov: Governor;
  /** The hard cap counts spend in the rolling 24 h, but only since the current budget took effect. */
  capSince = Date.now();
  get budget() { return this.gov.budget; }
  set budget(b: number) { this.gov.setBudget(b); this.capSince = Date.now(); this.spentToday = 0; }
  inflight = new Set<string>();
  /** The latest rendered words from one Soul to another (colour for the listener's mind). */
  private lastWords = new Map<string, string>();
  private nextTalkId = 1;
  private lastServed = new Map<string, number>(); // soulId → tick of the last paid model call
  spentToday = 0; callsToday = 0; jevMsAvg = 0;
  camera: CameraLine | null = null;
  private shotId = ''; private shotSinceTick = 0;
  ticker: TickerLine[] = [];
  narratives = new Map<string, NarrativeView>();       // latest per region
  private pendingBeats: { fireTick: number; region: string; narrative: number; beat: Beat; index: number }[] = [];
  private narrating = new Set<string>();
  private directing = false;
  private tickerCandidates: { id: string; text: string; tick: number }[] = [];
  host: WorldHost; db: Db; cfg: Config; sink: BrainSink;

  constructor(host: WorldHost, db: Db, cfg: Config, sink: BrainSink) {
    this.host = host; this.db = db; this.cfg = cfg; this.sink = sink;
    this.mode = cfg.brainMode; this.gov = new Governor(cfg.budgetUsdPerDay);
    db.backfillSpend();
    this.jev = new JevClient(cfg.typesafeKey, this.mode);
    const t = db.brainToday(this.capSince); this.spentToday = t.cost; this.callsToday = t.calls; this.jevMsAvg = t.jevMs;
    host.listeners.push({ afterTick: (tick) => this.afterTick(tick), onApplied: (e) => this.onApplied(e), onPlay: (v) => { for (const c of v.changes) if (c.op === 'say' && host.kernel.things[c.to]?.kind === 'soul') void this.speak(c.from, c.to, c.act, typeof c.about === 'string' ? c.about : undefined, c.manner); } });
    setInterval(() => { const t = this.db.brainToday(this.capSince); this.spentToday = t.cost; this.callsToday = t.calls; this.db.pruneBrainCalls(); }, 60_000).unref();
  }

  setMode(m: 'live' | 'fake') { this.mode = m; this.jev.mode = this.cfg.typesafeKey ? m : 'fake'; }
  get overBudget() { return this.spentToday >= this.budget; }
  private get narratorState(): NarratorState {
    const x = this.host.extra as { narrator?: NarratorState };
    if (!x.narrator) x.narrator = { nextRun: { center: this.host.engine.world.tick + TPS * 40, ring: this.host.engine.world.tick + TPS * 190 }, lastSummary: {} };
    return x.narrator;
  }

  private record(c: Omit<BrainCall, 'id' | 'at'>): number {
    const full = { ...c, at: Date.now() };
    // long system prompts are stored once and referenced by hash
    const sys = (full.request as any)?.system?.[0];
    if (sys?.text && sys.text.length > 2000) full.request = { ...(full.request as object), system: [{ ...sys, text: this.db.internPrompt(sys.text) }] };
    const id = this.db.saveBrainCall(WORLD_ID, full);
    this.spentToday += c.costUsd; this.callsToday++;
    if (c.mode === 'live') this.gov.charge(tierOf(c.tier), c.costUsd);
    if (c.tier === 'mid' && c.mode === 'live') this.jevMsAvg = this.jevMsAvg ? this.jevMsAvg * 0.9 + c.ms * 0.1 : c.ms;
    this.sink.onCall({ ...full, id });
    return id;
  }

  // ------------------------------------------------------------ spend
  spendReport() {
    const now = Date.now(), H = 3600_000;
    const sum = (rows: { tier: string; calls: number; cost: number }[]) => {
      const byTier: Record<string, { calls: number; cost: number }> = {};
      for (const r of rows) { const t = tierOf(r.tier); byTier[t] = { calls: (byTier[t]?.calls ?? 0) + Number(r.calls), cost: (byTier[t]?.cost ?? 0) + Number(r.cost ?? 0) }; }
      return { total: Object.values(byTier).reduce((a, b) => a + b.cost, 0), calls: Object.values(byTier).reduce((a, b) => a + b.calls, 0), byTier };
    };
    const dayStart = new Date(new Date(now).toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
    const monthStart = new Date(new Date(now).toISOString().slice(0, 7) + '-01T00:00:00Z').getTime();
    const actual = {
      last15m: sum(this.db.spendRecent(now - 15 * 60_000)),
      last1h: sum(this.db.spendRecent(now - H)),
      last24h: sum(this.db.spendSince(now - 23 * H)),
      today: sum(this.db.spendSince(dayStart)),
      last7d: sum(this.db.spendSince(now - 7 * 24 * H)),
      thisMonth: sum(this.db.spendSince(monthStart)),
      allTime: sum(this.db.spendSince(0)),
    };
    // Projections: the recent trend, and what the governor will actually allow (it caps each tier at its share).
    const perDayTrend = actual.last1h.total * 24;
    const perDayGoverned = Math.min(perDayTrend, this.budget);
    const hoursLeftToday = (dayStart + 24 * H - now) / H;
    const daysInMonth = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() + 1, 0)).getUTCDate();
    const daysLeftMonth = (monthStart + daysInMonth * 24 * H - now) / (24 * H);
    const projected = {
      basis: 'rate over the last hour',
      perHour: actual.last1h.total, perDayTrend, perDayGoverned,
      perWeek: perDayGoverned * 7, perMonth: perDayGoverned * 30, perYear: perDayGoverned * 365,
      endOfToday: actual.today.total + (perDayGoverned / 24) * hoursLeftToday,
      endOfMonth: actual.thisMonth.total + perDayGoverned * daysLeftMonth,
      byTierPerDay: Object.fromEntries((Object.keys(SHARES) as Tier[]).map((t) => [t, Math.min((actual.last1h.byTier[t]?.cost ?? 0) * 24, this.gov.perDay(t))])),
    };
    return {
      at: now, budgetPerDay: this.budget, mode: this.mode, hardCapHit: this.overBudget, capSpent: this.spentToday, capSince: this.capSince,
      actual, projected, governor: this.gov.view(),
      hourly: this.db.spendHourly(24).map((r) => ({ ...r, tier: tierOf(r.tier) })),
      byModel: this.db.spendByModel(),
      since: this.db.spendFirstHour() ? this.db.spendFirstHour()! * H : null,
      pricing: { jev: '$0.042 per million input tokens; output free', haiku: '$1 / $5 per million input / output tokens; cache write $1.25, cache read $0.10' },
    };
  }

  // ------------------------------------------------------------ per tick
  private afterTick(tick: number) {
    const w = this.host.engine.world;
    // Tier 2: mid-brain, per Soul, when due. Fair order: owner intents first, then whoever has waited longest,
    // so a fixed iteration order can never let a few Souls take the whole mid-brain share.
    if (this.inflight.size < MAX_INFLIGHT) {
      const due: Mind[] = [];
      for (const m of this.host.minds.values()) if (m.nextEvalTick <= tick && !this.inflight.has(m.soulId) && w.entities[m.entityId]) due.push(m);
      if (due.length) {
        due.sort((a, b) => prio(a.evalTrigger) - prio(b.evalTrigger) || (this.lastServed.get(a.soulId) ?? 0) - (this.lastServed.get(b.soulId) ?? 0) || (a.soulId < b.soulId ? -1 : 1));
        for (const m of due) { if (this.inflight.size >= MAX_INFLIGHT) break; void this.evaluate(m, m.evalTrigger || 'timer'); }
      }
    }
    // expire nudges
    if (tick % TPS === 0) for (const m of this.host.minds.values()) if (m.nudge && m.nudge.untilTick < tick) m.nudge = null;
    // Tier 3 beats firing
    while (this.pendingBeats.length && this.pendingBeats[0].fireTick <= tick) {
      const b = this.pendingBeats.shift()!;
      void this.host.enqueue('scene', `narrator:${b.region}`, { region: b.region, narrative: b.narrative, beat: b.beat } satisfies ScenePayload);
      const v = this.narratives.get(b.region);
      if (v && v.id === b.narrative && v.beats[b.index]) { v.beats[b.index].fired = true; this.db.updateNarrative(v.id, v); this.sink.onNarrative(v); }
    }
    // Tier 3: narrator per region, staggered
    const ns = this.narratorState;
    for (const region of Object.keys(w.regions)) if ((ns.nextRun[region] ?? 0) <= tick && !this.narrating.has(region)) void this.narrate(region, 'schedule');
    // Tier 2b: director + ticker, only while someone is watching
    if (tick % DIRECTOR_EVERY === 0 && !this.directing && this.sink.clients() > 0) void this.direct();
  }

  private onApplied(e: LogEvent) {
    if (e.kind === 'birth') { const m = this.host.minds.get(e.payload.soulId); if (m) void this.attune(m); }
    const line = tickerText(e, this.host);
    if (line) { this.tickerCandidates.push({ id: String(e.seq), text: line, tick: e.tick }); if (this.tickerCandidates.length > 30) this.tickerCandidates.shift(); }
  }

  // ------------------------------------------------------------ tier 2: mid-brain
  midContext(m: Mind, trigger: string): Omit<MidContext, 'options'> & { options: CardOption[] } {
    const eng = this.host.engine, w = eng.world, ent = w.entities[m.entityId], k = this.host.kernel;
    const nameOf = (id: string) => this.host.nameOf(id);
    const s = eng.describeSurroundings(m.entityId);
    const intentText = m.intent ? describeIntent({ ...m.intent, note: undefined, text: undefined } as WireIntent, nameOf) : 'none';
    const sit = situationOf(this.host, m);
    const deck = k.decks[m.soulId];
    return {
      world: { time: timeWord(w.env.datetime), weather: weatherWord(w.env.weather), happening: s.happening },
      soul: {
        name: m.name, about: m.description, intent: intentText, ownerNote: m.intent?.text ?? m.intent?.note ?? null, hasIntent: !!m.intent && m.agendaPos < Math.max(1, m.agenda.length),
        intentIsNew: URGENT.has(trigger), energy: energyWord(m.energy), where: nameOf(k.things[m.soulId]?.at ?? s.region),
        doing: eng.programOf(m.entityId) ? m.doing : 'standing around', recent: m.recent.slice(-3),
      },
      nearby: s.nearby.map((n) => ({ who: n.who, what: n.what, distance: n.distance, doing: n.doing })),
      nudge: m.nudge?.text ?? null,
      situation: sit.situation,
      heard: sit.heard.map((h) => ({ who: h.who, act: h.act, ...(h.about ? { about: h.about } : {}), ...(this.lastWords.get(`${h.from}>${m.soulId}`) ? { words: this.lastWords.get(`${h.from}>${m.soulId}`)! } : {}) })),
      manners: Object.fromEntries((deck?.manners ?? []).map((n) => [n, k.vocab.manners[n]?.summary ?? n])),
      options: optionsFor(this.host, m),
      running: !!eng.programOf(m.entityId),
      trigger,
    };
  }

  private updateEnergy(m: Mind, ent: Entity, tick: number) {
    const dt = (tick - m.lastEnergyTick) / TPS; m.lastEnergyTick = tick;
    const a = ent.human!.activity;
    const rate = a === 'walk' ? -0.25 : a === 'perform' ? -0.4 : a === 'rest' || a === 'sit' ? 0.6 : a === 'gather' ? 0.15 : -0.03; // per second
    m.energy = Math.max(0, Math.min(100, m.energy + rate * dt));
  }

  async evaluate(m: Mind, trigger: string) {
    const host = this.host, tick = host.engine.world.tick;
    const ent = host.engine.world.entities[m.entityId];
    this.updateEnergy(m, ent, tick);
    const ctx = this.midContext(m, trigger);
    if (ctx.options.length === 0) { m.nextEvalTick = tick + TPS * 20; return; }
    // A plan that has been impossible for ten minutes is given up, so a Soul is never stuck waiting for ever.
    if (m.agendaPos < m.agenda.length) {
      if (ctx.options.some((o) => o.servesIntent && o.card !== 'wait')) m.planBlockedSince = undefined;
      else if (m.planBlockedSince === undefined) m.planBlockedSince = tick;
      else if (tick - m.planBlockedSince > TPS * 600) { m.recent = [...m.recent.slice(-3), `gave up on the plan at "${m.agenda[m.agendaPos].card}" (not possible for a long while)`]; m.agendaPos = m.agenda.length; m.planBlockedSince = undefined; host.markDirty(m.soulId); }
    }
    if (m.avoid && m.avoid.untilTick > tick) ctx.options = ctx.options.filter((o) => o.id !== m.avoid!.id); else m.avoid = undefined;
    const noBudgetNow = this.mode !== 'fake' && (this.overBudget || this.gov.waitSeconds('mid') > 0);
    // Tier 1, reflex: what code already knows needs no model.
    //  · Someone asked a question: the only options are to answer it (and if the owner's plan says to agree, agree).
    //  · Options that serve the owner's plan exist: choose only among those (and if there is one, take it).
    //  · This Soul asked something and the other has not answered: stay and wait.
    const answers = ctx.options.filter((o) => o.card === 'say yes' || o.card === 'say no');
    const serving = ctx.options.filter((o) => o.servesIntent && o.card !== 'wait');
    let reflex: CardOption | undefined, why = '';
    if (answers.length) {
      ctx.options = answers; reflex = answers.find((o) => o.card === 'say yes' && o.servesIntent); why = 'someone asked, and the plan says to agree';
      // a question is never left hanging for want of budget: without a model, yes two times in three
      if (!reflex && noBudgetNow) { const yes = hash32(`${m.soulId}:${tick}:answer`) % 3 !== 0; reflex = answers.find((o) => o.card === (yes ? 'say yes' : 'say no')) ?? answers[0]; why = 'someone asked (no model budget just now)'; }
    }
    else if (serving.length) { ctx.options = serving; if (serving.length === 1) { reflex = serving[0]; why = 'the one thing that serves the plan'; } }
    else if (awaiting(host, m.soulId).length) { reflex = ctx.options.find((o) => o.card === 'wait'); why = 'waiting for an answer'; }
    if (reflex) {
      const same = ctx.running && m.pending?.card === reflex.card && m.pending.target === reflex.cardTarget;
      if (same) { m.nextEvalTick = tick + TPS * 10; m.evalTrigger = 'timer'; return; }          // already doing exactly that
      const manners = Object.keys(ctx.manners ?? {}), manner = manners.length ? manners[hash32(`${m.soulId}:${tick}`) % manners.length] : undefined;
      const callId = this.record({ tick, tier: 'mid', subject: m.name, soulId: m.soulId, model: 'reflex', request: { reflex: why, options: ctx.options.map((o) => o.id) }, response: null, applied: { trigger, option: reflex.id, label: reflex.label, card: reflex.card, target: reflex.cardTarget, manner, how: 'reflex', why }, ms: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, mode: 'fake' });
      m.nextEvalTick = tick + TPS * 30; m.lastFingerprint = '';
      void host.enqueue('decision', 'brain:reflex', {
        soulId: m.soulId, entityId: m.entityId, option: reflex.id, label: reflex.label, steps: reflex.steps, mood: m.mood,
        reevalTicks: (reflex.card === 'wait' ? 10 : durationFloor(reflex.durationHint)) * TPS, fallback: false, call: callId, trigger,
        card: reflex.card, target: reflex.cardTarget, ...(manner ? { manner } : {}), approachLen: reflex.approachLen,
      } satisfies DecisionPayload);
      return;
    }
    const fp = fingerprint(ctx);
    if (ctx.running && trigger === 'timer' && fp === m.lastFingerprint) { m.nextEvalTick = tick + TPS * 60; return; } // nothing changed: skip the call
    m.lastFingerprint = fp;
    // Governor: if the mid-brain share is spent for now, a busy soul simply waits; an idle soul takes a free default.
    const budgetOk = !this.overBudget && (this.mode === 'fake' || this.gov.allow('mid'));
    if (!budgetOk && ctx.running && !URGENT.has(trigger)) { m.nextEvalTick = tick + Math.max(20, this.gov.waitSeconds('mid')) * TPS; m.lastFingerprint = ''; return; }
    this.inflight.add(m.soulId);
    const version = m.intentVersion;
    const seed = `${m.soulId}:${tick}`;
    const { request, keys } = buildMidRequest(ctx);
    let decision, response: unknown = null, ms = 0, cost = 0, tokens = 0, mode: 'live' | 'fake' = 'fake', error: string | undefined, usedFallback = false;
    try {
      if (!budgetOk) { decision = fallbackMid(ctx, seed); usedFallback = true; error = this.overBudget ? 'over daily budget: deterministic fallback' : 'mid-brain share spent for now (governor): deterministic fallback'; }
      else {
        this.lastServed.set(m.soulId, tick);
        const r = await this.jev.ask(request);
        response = r.response; ms = r.ms; cost = r.costUsd; tokens = r.response.usage.input_tokens; mode = r.mode;
        decision = interpretMid(r.response, ctx, keys, seed);
      }
    } catch (e) { decision = fallbackMid(ctx, seed); usedFallback = true; error = String((e as Error).message ?? e); }
    this.inflight.delete(m.soulId);
    if (!host.minds.has(m.soulId)) return;
    const now = host.engine.world.tick;
    const stale = m.intentVersion !== version;
    const opt = ctx.options.find((o) => o.id === decision.option);
    const policy = { how: decision.how, pool: decision.pool, topP: decision.topP, keepGoing: decision.keepGoing, sociable: decision.sociable, optionKeys: Object.fromEntries(keys) };
    const applied = stale ? { dropped: 'intent changed during the call; re-evaluating' } : opt
      ? { option: opt.id, label: opt.label, card: opt.card, target: opt.cardTarget, manner: decision.manner, steps: opt.steps, mood: decision.mood, reevalSeconds: decision.reevalSeconds, probabilities: decision.probabilities, ...policy, seed }
      : { option: 'continue', mood: decision.mood, reevalSeconds: decision.reevalSeconds, ...policy };
    const callId = this.record({ tick, tier: 'mid', subject: m.name, soulId: m.soulId, model: mode === 'live' ? JEV_MODEL : 'fake', request, response, applied: { trigger, ...applied }, ms, inputTokens: tokens, outputTokens: 0, cachedTokens: 0, costUsd: cost, mode, error });
    if (stale) { m.nextEvalTick = now + 1; m.evalTrigger = 'new-intent'; return; }
    m.wantsCompany = decision.sociable;
    if (!opt) { m.mood = decision.mood; m.nextEvalTick = now + decision.reevalSeconds * TPS; m.evalTrigger = 'timer'; host.markDirty(m.soulId); return; }
    m.nextEvalTick = now + TPS * 30; // provisional; the decision event sets the real one when applied
    if (m.nudge) m.nudge = null;    // a nudge is offered once
    void host.enqueue('decision', 'brain:mid', {
      soulId: m.soulId, entityId: m.entityId, option: opt.id, label: opt.label, steps: opt.steps, mood: decision.mood,
      reevalTicks: Math.max(decision.reevalSeconds, durationFloor(opt.durationHint)) * TPS, fallback: usedFallback, call: callId, trigger,
      card: opt.card, target: opt.cardTarget, ...(decision.manner ? { manner: decision.manner } : {}), approachLen: opt.approachLen,
    } satisfies DecisionPayload);
  }

  // ------------------------------------------------------------ web console: text → intent
  async translate(m: Mind, text: string): Promise<Translation & { via: string }> {
    const eng = this.host.engine, tick = eng.world.tick;
    const s = eng.describeSurroundings(m.entityId);
    const targets: Target[] = [
      ...s.nearby.map((n) => ({ id: n.id, name: n.who, kind: n.what, distance: n.distance })),
      ...Object.values(eng.world.entities).filter((e) => e.kind === 'fixture' && !s.nearby.some((n) => n.id === e.id)).map((e) => ({ id: e.id, name: e.label ?? e.id, kind: e.def, distance: 'far' })),
      ...Object.values(eng.world.regions).map((r) => ({ id: r.id, name: r.label, kind: 'region', distance: 'n/a' })),
    ].slice(0, 24);
    const { request, targetKeys } = buildTranslateRequest(text, m.name, targets);
    let out: Translation;
    if (this.mode === 'live' && (this.overBudget || !this.gov.allow('user'))) return { ok: false, confidence: 0, reason: 'the brain budget is spent for now; try again in a few minutes', via: 'governor' };
    try {
      const r = await this.jev.ask(request);
      out = interpretTranslate(r.response, text, targetKeys);
      this.record({ tick, tier: 'translate', subject: m.name, soulId: m.soulId, model: r.mode === 'live' ? JEV_MODEL : 'fake', request, response: r.response, applied: out, ms: r.ms, inputTokens: r.response.usage.input_tokens, outputTokens: 0, cachedTokens: 0, costUsd: r.costUsd, mode: r.mode });
      if (out.ok || !this.cfg.anthropicKey || this.mode === 'fake' || this.overBudget || !this.gov.allow('user')) return { ...out, via: 'jev' };
    } catch (e) {
      out = { ok: false, confidence: 0, reason: String((e as Error).message) };
      this.record({ tick, tier: 'translate', subject: m.name, soulId: m.soulId, model: JEV_MODEL, request, response: null, applied: out, ms: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, mode: 'live', error: out.reason });
      if (!this.cfg.anthropicKey) return { ...out, via: 'jev' };
    }
    // second pass: a small LLM with a tool schema
    try {
      const h = await haikuTranslate(this.cfg.anthropicKey!, this.cfg.narratorModel, text, m.name, targets.map((t) => ({ id: t.id, name: t.name })), GOALS);
      const valid = h.out && (GOALS as readonly string[]).includes(h.out.goal) && (h.out.target === null || targets.some((t) => t.id === h.out.target));
      const res: Translation = valid ? { ok: true, confidence: 0.7, intent: { goal: h.out.goal as WireIntent['goal'], target: h.out.target, note: sanitize(text) } } : { ok: false, confidence: 0, reason: 'not understood as something to do' };
      this.record({ tick, tier: 'translate', subject: m.name, soulId: m.soulId, model: this.cfg.narratorModel, request: h.request, response: h.raw, applied: res, ms: h.ms, inputTokens: h.inputTokens, outputTokens: h.outputTokens, cachedTokens: 0, costUsd: h.costUsd, mode: 'live' });
      return { ...res, via: 'haiku' };
    } catch (e) { return { ok: false, confidence: 0, reason: String((e as Error).message), via: 'haiku' }; }
  }

  // ------------------------------------------------------------ vocabulary: minting, compiling, attuning
  private engineVerbs() { return new Set(this.host.engine.describeVerbs().map((v) => v.verb).filter((v) => v !== 'do_activity')); }

  /** Validate proposed cards and mint the valid ones into the vocabulary and this Soul's deck. No model involved. */
  async mint(m: Mind, cards: unknown[], links: Record<string, LinkKind> | undefined, kinds: Record<string, { summary: string }> | undefined, origin: MintedCard['origin']): Promise<MintVerdict[]> {
    const k = this.host.kernel, verbs = this.engineVerbs(), tick = this.host.engine.world.tick;
    const newLinks: Record<string, LinkKind> = {}; for (const [n, d] of Object.entries(links ?? {})) if (!k.vocab.links[n] && /^[a-z][a-z ]{1,39}$/.test(n) && n !== 'said' && n !== 'agreed') newLinks[n] = { summary: String(d.summary).slice(0, 120), ...(d.control ? { control: true } : {}) };
    const newKinds: Record<string, { summary: string }> = {}; for (const [n, d] of Object.entries(kinds ?? {})) if (!k.vocab.kinds[n] && /^[a-z][a-z ]{1,39}$/.test(n)) newKinds[n] = { summary: String(d.summary).slice(0, 120) };
    const verdicts: MintVerdict[] = []; let first = true;
    for (const raw of cards.slice(0, 4)) {
      const v = validateCard(raw, k, verbs); const name = String((raw as { name?: unknown })?.name ?? '?');
      if (!v.ok) { verdicts.push({ name, ok: false, problems: v.problems }); continue; }
      const card: Card = v.card; const hash = cardHash(card);
      if (k.vocab.cards[card.name]) { // the same card already exists: just deal it
        if (!k.decks[m.soulId]?.cards.includes(card.name)) await this.host.enqueue('deck', `soul:${m.soulId}`, { soulId: m.soulId, add: [card.name], why: 'dealt an existing card' });
        verdicts.push({ name: card.name, ok: true, hash }); continue;
      }
      await this.host.enqueue('mint', `soul:${m.soulId}`, { card: { ...card, hash, by: m.soulId, mintedAt: tick, origin }, forSoul: m.soulId, ...(first && Object.keys(newLinks).length ? { links: newLinks } : {}), ...(first && Object.keys(newKinds).length ? { kinds: newKinds } : {}) });
      first = false;
      // the mint has been applied by now: if another Soul's card took the name in the same instant, say so
      const won = k.vocab.cards[card.name]?.hash === hash;
      verdicts.push(won ? { name: card.name, ok: true, hash } : { name: card.name, ok: false, problems: [`a different card named "${card.name}" was minted first; choose another name`] });
    }
    return verdicts;
  }

  /** A wish in plain words → an agenda of cards, minting what the vocabulary lacks. Returns null when no compiler is available. */
  async compile(m: Mind, wish: string): Promise<{ ok: true; agenda: { card: string; target: string | null; of?: string }[]; minted: MintVerdict[] } | { ok: false; reason: string } | null> {
    if (this.mode === 'fake' || !this.cfg.anthropicKey) return null;
    if (this.overBudget || !this.gov.allow('user')) return { ok: false, reason: 'the thinking budget is spent for now; try again in a few minutes' };
    const k = this.host.kernel, tick = this.host.engine.world.tick;
    const verbs = this.host.engine.describeVerbs().filter((v) => v.verb !== 'do_activity');
    const system = COMPILER_PREAMBLE + cardGrammar(verbs);
    const user = compileUser(k, m.soulId, wish, candidatesFor(this.host, m.soulId));
    const messages: { role: 'user' | 'assistant'; content: string }[] = [{ role: 'user', content: user }];
    let cost = 0, ms = 0, inTok = 0, outTok = 0, cached = 0; const attempts: unknown[] = [];
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await callTool<CompileOut>({ apiKey: this.cfg.anthropicKey, model: this.cfg.compilerModel, system, cacheSystem: true, messages, tool: COMPILE_TOOL, maxTokens: 1800 });
        cost += r.costUsd; ms += r.ms; inTok += r.inputTokens; outTok += r.outputTokens; cached += r.cachedTokens;
        const out = r.out;
        if (!out.understood) {
          attempts.push({ out });
          this.record({ tick, tier: 'compile', subject: m.name, soulId: m.soulId, model: this.cfg.compilerModel, request: { system: [{ text: system }], messages }, response: r.raw, applied: { wish, understood: false, reason: out.reason, attempts }, ms, inputTokens: inTok, outputTokens: outTok, cachedTokens: cached, costUsd: cost, mode: 'live' });
          return { ok: false, reason: out.reason || 'not understood as something a Soul could do here' };
        }
        // check everything before minting anything
        const problems: string[] = []; const verbSet = this.engineVerbs();
        const staged = structuredClone(k); for (const [n, d] of Object.entries(out.new_links ?? {})) staged.vocab.links[n] ??= d;
        const owners = Object.values(k.things).filter((x) => x.kind === 'soul' && x.id !== m.soulId && new RegExp(`\\b${x.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(’s|'s)`, 'i').test(wish));
        const validNew = new Map<string, Card>();
        for (const raw of out.new_cards ?? []) { const v = validateCard(raw, staged, verbSet); if (v.ok) validNew.set(v.card.name, v.card); else problems.push(`card "${String((raw as { name?: unknown })?.name)}": ${v.problems.join('; ')}`); }
        if (!Array.isArray(out.agenda) || out.agenda.length === 0) problems.push('the agenda is empty');
        for (const a of out.agenda ?? []) {
          const card = validNew.get(a.card) ?? k.vocab.cards[a.card];
          if (!card) { problems.push(`agenda step uses a card that does not exist: "${a.card}"`); continue; }
          if (a.target !== null && !k.things[a.target]) problems.push(`agenda step "${a.card}" targets "${a.target}", which is not an id in the list of known things. Ids are never invented. If the thing does not exist yet (a party that has not started), set "target" to null and "of" to the id of the Soul or thing it will belong to`);
          else if (a.target && card.target && card.target.kind !== 'any' && k.things[a.target].kind !== card.target.kind) problems.push(`agenda step "${a.card}" needs a ${card.target.kind} but "${a.target}" is a ${k.things[a.target].kind}`);
          if (a.of && !k.things[a.of]) problems.push(`agenda step "${a.card}" has an unknown "of" id "${a.of}"`);
          // "Rob's party" must be Rob's: a wish that names whose thing it is cannot be bound to someone else's.
          const t = a.target ? k.things[a.target] : undefined;
          if (t && t.kind !== 'soul' && t.kind !== 'place' && t.kind !== 'region' && owners.length && !owners.some((o) => belongsTo(this.host, t.id, o.id)) && Object.values(k.links).some((l) => l.to === t.id && k.things[l.from]?.kind === 'soul'))
            problems.push(`agenda step "${a.card}" targets ${t.name} (${t.id}), but the wish says ${owners.map((o) => `${o.name}’s`).join(' or ')} and that thing is not theirs. If ${owners[0].name} has no such thing yet, set "target" to null and "of" to "${owners[0].id}"`);
        }
        attempts.push({ out, problems });
        if (problems.length && attempt === 0) { messages.push({ role: 'assistant', content: `I proposed: ${JSON.stringify(out)}` }, { role: 'user', content: `That cannot run. Problems:\n- ${problems.join('\n- ')}\nFix them and call compile again.` }); continue; }
        if (problems.length) {
          this.record({ tick, tier: 'compile', subject: m.name, soulId: m.soulId, model: this.cfg.compilerModel, request: { system: [{ text: system }], messages }, response: r.raw, applied: { wish, understood: true, rejected: problems, attempts }, ms, inputTokens: inTok, outputTokens: outTok, cachedTokens: cached, costUsd: cost, mode: 'live', error: 'the compiled plan did not validate' });
          return { ok: false, reason: `could not turn that into something the world can run (${problems[0]})` };
        }
        const minted = await this.mint(m, [...validNew.values()], out.new_links, out.new_kinds, 'compiled');
        const deal = [...new Set(out.agenda.map((a) => a.card))].filter((c) => this.host.kernel.vocab.cards[c] && !this.host.kernel.decks[m.soulId]?.cards.includes(c));
        if (deal.length) await this.host.enqueue('deck', `soul:${m.soulId}`, { soulId: m.soulId, add: deal, why: 'needed for the owner’s wish' });
        this.record({ tick, tier: 'compile', subject: m.name, soulId: m.soulId, model: this.cfg.compilerModel, request: { system: [{ text: system }], messages }, response: r.raw, applied: { wish, understood: true, agenda: out.agenda, minted, dealt: deal, attempts }, ms, inputTokens: inTok, outputTokens: outTok, cachedTokens: cached, costUsd: cost, mode: 'live' });
        return { ok: true, agenda: out.agenda.map((a) => ({ card: a.card, target: a.target, ...(a.of ? { of: a.of } : {}) })), minted };
      }
    } catch (e) {
      this.record({ tick, tier: 'compile', subject: m.name, soulId: m.soulId, model: this.cfg.compilerModel, request: { messages }, response: null, applied: { wish, attempts }, ms, inputTokens: inTok, outputTokens: outTok, cachedTokens: cached, costUsd: cost, mode: 'live', error: String((e as Error).message) });
      return { ok: false, reason: 'the compiler failed; try again' };
    }
    return { ok: false, reason: 'the compiler failed; try again' };
  }

  /** Pick the three manners that suit a Soul's description (one cheap Jev call), and record them in its deck. */
  async attune(m: Mind) {
    const k = this.host.kernel, tick = this.host.engine.world.tick;
    if (this.mode === 'fake' || this.overBudget || !this.gov.allow('mid')) return;
    const request = buildAttuneRequest({ name: m.name, about: m.description }, k.vocab.manners);
    try {
      const r = await this.jev.ask(request);
      const manners = interpretAttune(r.response);
      this.record({ tick, tier: 'attune', subject: m.name, soulId: m.soulId, model: r.mode === 'live' ? JEV_MODEL : 'fake', request, response: r.response, applied: { manners }, ms: r.ms, inputTokens: r.response.usage.input_tokens, outputTokens: 0, cachedTokens: 0, costUsd: r.costUsd, mode: r.mode });
      if (this.host.minds.has(m.soulId)) void this.host.enqueue('deck', 'brain:attune', { soulId: m.soulId, manners, why: 'manners attuned to the description' });
    } catch { /* the default manners stay */ }
  }

  // ------------------------------------------------------------ speech: the act is state, the words are rendered here
  async speak(from: string, to: string, act: string, about: string | undefined, manner: string | undefined) {
    const k = this.host.kernel, tick = this.host.engine.world.tick;
    const a = k.things[from], b = k.things[to]; if (!a || !b) return;
    const input: TalkInput = {
      speaker: { name: a.name, about: String(a.traits.about ?? ''), ...(manner ? { manner: `${manner}: ${k.vocab.manners[manner]?.summary ?? ''}` } : {}) },
      listener: { name: b.name, about: String(b.traits.about ?? '') }, act, ...(about ? { about } : {}),
      where: a.at ? this.host.nameOf(a.at) : 'somewhere',
      earlier: this.db.talkBetween(from, to, 4).map((l) => ({ who: l.fromName, text: l.text })),
    };
    let lines: SpokenLine[] = [];
    // Words cost money, so they go first to what people steer and to what matters: a question or an answer, or a Soul with an owner.
    // Small talk between natives is rendered only while someone is watching and the speech budget is more than half full.
    const matters = act === 'ask' || act === 'agree' || act === 'decline' || [from, to].some((id) => { const mm = this.host.minds.get(id); return !!mm && !mm.native; });
    const spare = (() => { const b = this.gov.view().find((x) => x.tier === 'talk')!; return b.level > b.capacity / 2; })();
    const live = this.mode === 'live' && !!this.cfg.anthropicKey && !this.overBudget && (matters || (this.sink.clients() > 0 && spare)) && this.gov.allow('talk');
    if (live) {
      try {
        const r = await callTool<{ lines: SpokenLine[] }>({ apiKey: this.cfg.anthropicKey!, model: this.cfg.talkModel, system: TALK_SYSTEM, messages: [{ role: 'user', content: talkUser(input) }], tool: TALK_TOOL, maxTokens: 300, timeoutMs: 20000 });
        lines = cleanLines(r.out.lines, act);
        this.record({ tick, tier: 'talk', subject: a.name, soulId: from, model: this.cfg.talkModel, request: r.request, response: r.raw, applied: { to: b.name, act, lines }, ms: r.ms, inputTokens: r.inputTokens, outputTokens: r.outputTokens, cachedTokens: r.cachedTokens, costUsd: r.costUsd, mode: 'live' });
      } catch (e) {
        this.record({ tick, tier: 'talk', subject: a.name, soulId: from, model: this.cfg.talkModel, request: input, response: null, applied: null, ms: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, mode: 'live', error: String((e as Error).message) });
      }
    }
    if (!lines.length) lines = plainLine(input);
    const out: TalkLine[] = lines.map((l) => {
      const speaker = l.who === 'speaker';
      const line = { tick, at: Date.now(), from: speaker ? from : to, to: speaker ? to : from, fromName: speaker ? a.name : b.name, toName: speaker ? b.name : a.name, act, ...(manner && speaker ? { manner } : {}), text: l.text, place: a.at };
      return { ...line, id: this.db.saveTalk(WORLD_ID, line) };
    });
    for (const l of out) this.lastWords.set(`${l.from}>${l.to}`, l.text);
    this.sink.onTalk?.(out);
  }

  // ------------------------------------------------------------ tier 2b: director + ticker
  private shotCandidates(): ShotCandidate[] {
    const eng = this.host.engine, w = eng.world;
    const c: ShotCandidate[] = [];
    const humans = Object.values(w.entities).filter((e) => e.kind === 'human');
    const atFire = humans.filter((e) => e.human!.on === 'campfire');
    if (atFire.length >= 2) c.push({ id: 'group:campfire', text: `Frame the ${atFire.length} souls gathered at the campfire`, why: 'A gathering is the liveliest thing to watch', notFor: 'when it has been on screen a long time', spec: { kind: 'frameGroup', subjects: atFire.map((e) => e.id), azimuth: 0.6, elevation: 0.35, padding: 1.4 } });
    const interesting = humans.map((e) => ({ e, m: this.host.mindByEntity.get(e.id) })).filter((x) => x.m).sort((a, b) => score(b.e) - score(a.e) || a.e.id.localeCompare(b.e.id)).slice(0, 5);
    for (const { e, m } of interesting) c.push({ id: `follow:${e.id}`, text: `Follow ${m!.name}, who is ${m!.doing.toLowerCase()}`, why: e.human!.activity === 'walk' ? 'They are on the move' : 'A closer look at one soul', notFor: 'when they are just standing still with nothing going on', spec: { kind: 'follow', subject: e.id, offset: [0, 2.2, -4.5], lookHeight: 1.4 } });
    const talkers = humans.filter((e) => e.human!.activity === 'converse').slice(0, 2);
    if (talkers.length) c.push({ id: `two:${talkers[0].id}`, text: `A two-shot of ${this.host.mindByEntity.get(talkers[0].id)?.name ?? 'a soul'} in conversation`, why: 'Two souls are talking', spec: { kind: 'orbit', subject: talkers[0].id, radius: 4, height: 1.8, period: 40 } });
    c.push({ id: 'wide:center', text: 'A wide establishing shot of the center', why: 'Shows the campfire, the near benches and who is around', notFor: 'when it was the previous shot', spec: { kind: 'establishing', region: { min: [-18, -18], max: [18, 18] }, elevation: 0.7 } });
    c.push({ id: 'wide:world', text: 'A very wide shot of the whole ground', why: 'Shows everyone at once', notFor: 'when something specific deserves attention', spec: { kind: 'establishing', region: { min: [-50, -50], max: [50, 50] }, elevation: 1.0 } });
    return c;
  }

  async direct() {
    const tick = this.host.engine.world.tick;
    if (this.camera && tick - this.shotSinceTick < SHOT_COMMIT_TICKS && this.tickerCandidates.length === 0) return; // commit window: no chatter
    this.directing = true;
    const candidates = this.shotCandidates();
    const events = this.tickerCandidates.splice(0);
    const held = this.camera ? heldWord((tick - this.shotSinceTick) / TPS) : '';
    const ctx: DirectorContext = {
      current: this.camera ? { id: this.shotId, text: this.camera.text, held } : null,
      happening: [...this.host.minds.values()].slice(0, 12).map((m) => `${m.name}: ${m.doing}`),
      candidates: tick - this.shotSinceTick < SHOT_COMMIT_TICKS ? [] : candidates, events,
    };
    try {
      if (ctx.candidates.length === 0 && !ctx.current) ctx.candidates = candidates;
      const request = buildDirectorRequest(ctx);
      const r = this.overBudget || (this.mode === 'live' && !this.gov.allow('director')) ? null : await this.jev.ask(request);
      if (r) {
        const d = interpretDirector(r.response, ctx);
        const lines: TickerLine[] = d.announce.map((e) => ({ tick, text: e.text }));
        if (d.chosen && d.chosen.id !== this.shotId) { this.shotId = d.chosen.id; this.shotSinceTick = tick; this.camera = { tick, shot: d.chosen.spec, text: d.chosen.text, heldSec: 0 }; }
        else if (this.camera) this.camera = { ...this.camera, heldSec: Math.round((tick - this.shotSinceTick) / TPS) };
        this.record({ tick, tier: 'director', subject: 'broadcast', model: r.mode === 'live' ? JEV_MODEL : 'fake', request, response: r.response, applied: { shot: d.hold ? 'hold' : d.chosen?.id, spec: d.chosen?.spec, confidence: (r.response.answers.shot as ChoiceA).confidence, ticker: lines.map((l) => l.text) }, ms: r.ms, inputTokens: r.response.usage.input_tokens, outputTokens: 0, cachedTokens: 0, costUsd: r.costUsd, mode: r.mode });
        if (this.camera) this.sink.onCamera(this.camera);
        if (lines.length) { this.ticker.push(...lines); if (this.ticker.length > 50) this.ticker.splice(0, this.ticker.length - 50); this.sink.onTicker(lines); }
      }
    } catch (e) {
      this.record({ tick, tier: 'director', subject: 'broadcast', model: JEV_MODEL, request: null, response: null, applied: null, ms: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, mode: 'live', error: String((e as Error).message) });
    }
    this.directing = false;
  }

  /** On-demand cinematic shot for one Soul (owner view). */
  async shotFor(m: Mind) {
    const tick = this.host.engine.world.tick, id = m.entityId;
    const near = this.host.engine.describeSurroundings(id).nearby.find((n) => n.what === 'a soul' && (n.distance === 'here' || n.distance === 'close'));
    const cands: ShotCandidate[] = [
      { id: 'over-shoulder', text: 'Close over-the-shoulder follow', why: 'Intimate, shows where they are heading', notFor: 'when they are sitting still', spec: { kind: 'follow', subject: id, offset: [0.6, 1.9, -2.6], lookHeight: 1.5 } },
      { id: 'wide-follow', text: 'Wide follow from behind and above', why: 'Shows the soul in its surroundings', spec: { kind: 'follow', subject: id, offset: [0, 5, -9], lookHeight: 1.2 } },
      { id: 'slow-orbit', text: 'Slow orbit around the soul', why: 'Good for a soul who is resting, sitting or performing', notFor: 'when they are walking fast', spec: { kind: 'orbit', subject: id, radius: 5, height: 2, period: 45 } },
      ...(near ? [{ id: 'two-shot', text: `Two-shot with ${near.who}`, why: 'Someone is right next to them', spec: { kind: 'frameGroup', subjects: [id, near.id], azimuth: 0.8, elevation: 0.25, padding: 1.6 } } as ShotCandidate] : []),
    ];
    const request = buildShotRequest({ name: m.name, doing: m.doing }, cands);
    if (this.mode === 'live' && (this.overBudget || !this.gov.allow('user'))) return { id: 'wide-follow', text: cands[1].text + ' (default: brain budget spent for now)', spec: cands[1].spec };
    const r = await this.jev.ask(request);
    const pick = cands.find((c) => c.id === (r.response.answers.shot as ChoiceA).choice) ?? cands[1];
    this.record({ tick, tier: 'shot', subject: m.name, soulId: m.soulId, model: r.mode === 'live' ? JEV_MODEL : 'fake', request, response: r.response, applied: { shot: pick.id, spec: pick.spec }, ms: r.ms, inputTokens: r.response.usage.input_tokens, outputTokens: 0, cachedTokens: 0, costUsd: r.costUsd, mode: r.mode });
    return { id: pick.id, text: pick.text, spec: pick.spec };
  }

  // ------------------------------------------------------------ tier 3: narrator
  digest(region: string): RegionDigest {
    const eng = this.host.engine, w = eng.world;
    const here = [...this.host.minds.values()].filter((m) => w.entities[m.entityId] && eng.regionAt(w.entities[m.entityId].pose.p) === region);
    const nameOf = (id: string) => w.entities[id]?.label ?? w.regions[id]?.label ?? id;
    const places = Object.values(w.entities).filter((e) => e.kind === 'fixture' && e.id !== 'gate' && eng.regionAt(e.pose.p) === region)
      .map((e) => { const n = Object.values(w.entities).filter((x) => x.human?.on === e.id).length; return { id: e.id, name: e.label ?? e.id, state: n ? `${n} souls here` : 'empty' }; });
    const names = new Set(here.map((m) => m.name));
    const recent = this.db.tailEvents(WORLD_ID, 120).filter((e) => e.kind === 'decision' || e.kind === 'birth' || e.kind === 'intent').map((e) => tickerText(e, this.host)).filter((t): t is string => !!t && [...names].some((n) => t.startsWith(n))).slice(-25);
    const others = Object.keys(w.regions).filter((r) => r !== region).map((r) => { const n = [...this.host.minds.values()].filter((m) => w.entities[m.entityId] && eng.regionAt(w.entities[m.entityId].pose.p) === r).length; return `${w.regions[r].label}: ${n} souls`; });
    return {
      region, label: w.regions[region].label, time: timeWord(w.env.datetime), weather: weatherWord(w.env.weather), places,
      souls: here.slice(0, 20).map((m) => ({ name: m.name, about: m.description, intent: describeIntent(publicIntent(m.intent), nameOf), mood: m.mood, energy: energyWord(m.energy), doing: m.doing, wants_company: m.wantsCompany > 0.6 ? 'yes' : m.wantsCompany < 0.35 ? 'no' : 'maybe' })),
      recent, neighbours: others, previous_summary: this.narratorState.lastSummary[region] ?? null,
    };
  }

  async narrate(region: string, why: string) {
    const tick = this.host.engine.world.tick, ns = this.narratorState;
    ns.nextRun[region] = tick + NARRATE_EVERY + (hash32(`${region}:${tick}`) % (TPS * 60)) - TPS * 30; // ~5 min ± 30 s, so regions drift apart
    const d = this.digest(region);
    if (d.souls.length === 0) return; // nobody here: no call
    if (this.overBudget) return;
    if (this.mode === 'live' && !this.gov.allow('narrator')) {
      // the narrator's share cannot afford a plan yet: try again when it can (plus jitter so regions stay apart)
      ns.nextRun[region] = tick + (Math.max(60, this.gov.waitSeconds('narrator')) + (hash32(`${region}:${tick}:w`) % 120)) * TPS;
      return;
    }
    this.narrating.add(region);
    const request = buildNarratorRequest(d, this.cfg.narratorModel);
    try {
      const r = await callNarrator(this.cfg.anthropicKey, this.mode, d, this.cfg.narratorModel);
      const now = this.host.engine.world.tick;
      const beats = r.plan.beats.map((b) => ({ ...b, fired: false, fireTick: now + Math.round(Math.min(5, Math.max(0, b.at_min)) * 60 * TPS) }));
      const view: Omit<NarrativeView, 'id'> = { region, tick: now, summary: r.plan.summary, beats, nextRunTick: ns.nextRun[region] };
      const id = this.db.saveNarrative(WORLD_ID, region, now, view);
      const full = { ...view, id };
      this.narratives.set(region, full);
      ns.lastSummary[region] = r.plan.summary;
      this.pendingBeats = this.pendingBeats.filter((b) => b.region !== region); // a new plan supersedes the old one's unfired beats
      beats.forEach((b, index) => this.pendingBeats.push({ fireTick: b.fireTick, region, narrative: id, index, beat: { at_min: b.at_min, kind: b.kind, directive: b.directive, targets: b.targets, flavor: b.flavor } }));
      this.pendingBeats.sort((a, b) => a.fireTick - b.fireTick);
      this.record({ tick, tier: 'narrator', subject: region, model: r.mode === 'live' ? this.cfg.narratorModel : 'fake', request, response: r.raw, applied: { why, plan: r.plan }, ms: r.ms, inputTokens: r.inputTokens, outputTokens: r.outputTokens, cachedTokens: r.cachedTokens, costUsd: r.costUsd, mode: r.mode });
      this.sink.onNarrative(full);
    } catch (e) {
      this.record({ tick, tier: 'narrator', subject: region, model: this.cfg.narratorModel, request, response: null, applied: null, ms: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, mode: 'live', error: String((e as Error).message) });
    }
    this.narrating.delete(region);
  }
}

// ---------------------------------------------------------------- helpers
/** Triggers after which the question is "what now?", not "should I keep going?". */
const URGENT = new Set(['new-intent', 'plan-advanced', 'spoken-to']);
const prio = (trigger: string) => ({ 'new-intent': 0, 'spoken-to': 0, 'plan-advanced': 0, 'activity-failed': 1, 'activity-ended': 1, birth: 1, 'narrator-beat': 2 } as Record<string, number>)[trigger] ?? 3;
const durationFloor = (h: string) => (h === 'seconds' ? 8 : h === 'minute' ? 20 : 30);
const score = (e: Entity) => ({ perform: 5, converse: 4, walk: 3, gather: 2, wave: 2 } as Record<string, number>)[e.human!.activity] ?? 0;
const heldWord = (s: number) => (s < 8 ? 'just started' : s < 25 ? 'a little while' : s < 60 ? 'quite a while' : 'a long time');
export function timeWord(datetime: string): string {
  const h = Number(datetime.slice(11, 13));
  return h < 5 ? 'deep night' : h < 8 ? 'early morning' : h < 11 ? 'morning' : h < 14 ? 'midday' : h < 17 ? 'afternoon' : h < 19 ? 'late afternoon' : h < 22 ? 'evening' : 'night';
}
export const weatherWord = (w: { clouds: number; rain: number; wind: number }) => (w.rain > 0.3 ? 'raining' : w.clouds > 0.6 ? 'overcast' : w.wind > 0.6 ? 'windy' : 'clear');
export function tickerText(e: LogEvent, host: WorldHost): string | null {
  const name = (soulId: string) => host.minds.get(soulId)?.name ?? 'a soul';
  switch (e.kind) {
    case 'birth': return `${e.payload.name} arrived at the gate`;
    case 'decision': return `${name(e.payload.soulId)}: ${lowerFirst(e.payload.label)}`;
    case 'intent': return `${name(e.payload.soulId)} has a new intent: ${describeIntent(publicIntent(e.payload.intent), (id) => host.nameOf(id))}`;
    case 'play': return null;
    case 'mint': return `A new card was coined: “${e.payload.card.name}”`;
    case 'scene': return `In ${host.engine.world.regions[e.payload.region]?.label ?? e.payload.region}: ${e.payload.beat.flavor}`;
    case 'retire': return `A soul departed`;
    default: return null;
  }
}
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
