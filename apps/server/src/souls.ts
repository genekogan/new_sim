// Soul operations shared by the web API, the agent API and MCP.
import { createSoulSchema, describeIntent, intentSchema, type BirthPayload, type IntentPayload, type LogEvent, type WireIntent } from '@sim/protocol';
import { hashToken, newId, newSoulToken, RateLimit } from './auth.ts';
import type { Brain } from './brain.ts';
import type { Config } from './config.ts';
import type { Db, SoulRow } from './db.ts';
import { tickerText } from './brain.ts';
import { WORLD_ID, type WorldHost } from './world.ts';

export class ApiError extends Error {
  status: number; code: string; extra?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) { super(message); this.status = status; this.code = code; this.extra = extra; }
}

export class Souls {
  limits = new RateLimit();
  private claims = new Map<string, { soulId: string; expires: number }>();
  host: WorldHost; db: Db; brain: Brain; cfg: Config;
  constructor(host: WorldHost, db: Db, brain: Brain, cfg: Config) { this.host = host; this.db = db; this.brain = brain; this.cfg = cfg; }

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

  /** Set the standing intent. Resolves once the tick has accepted it (blocking mutation, SpaceMolt pattern). */
  async setIntent(soul: SoulRow, input: unknown, source: IntentPayload['source']): Promise<{ event: LogEvent; intent: WireIntent; text: string }> {
    const lim = this.limits.allow(`intent:${soul.id}`, 20, 60_000);
    if (!lim.ok) throw new ApiError(429, 'rate-limited', 'too many intents; slow down', { retry_after: lim.retryAfter });
    const p = intentSchema.safeParse(input);
    if (!p.success) throw new ApiError(400, 'invalid-intent', p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    const w = this.host.engine.world;
    const intent = p.data;
    if (intent.target) {
      // accept an entity id, a region id, or a soul/fixture name
      const t = intent.target;
      const byName = Object.values(w.entities).find((e) => (e.label ?? '').toLowerCase() === t.toLowerCase());
      if (!w.entities[t] && !w.regions[t]) { if (byName) intent.target = byName.id; else throw new ApiError(400, 'unknown-target', `no such target: ${t}. Use world_query to list entities and regions.`); }
    }
    const event = await this.host.enqueue('intent', `soul:${soul.id}`, { soulId: soul.id, intent, source } satisfies IntentPayload);
    return { event, intent, text: describeIntent(intent, (id) => w.entities[id]?.label ?? w.regions[id]?.label ?? id) };
  }

  /** Web console: free text → Jev → closed intent → same path as setIntent. */
  async command(soul: SoulRow, text: string) {
    const lim = this.limits.allow(`cmd:${soul.id}`, 20, 60_000);
    if (!lim.ok) throw new ApiError(429, 'rate-limited', 'too many commands; slow down', { retry_after: lim.retryAfter });
    const mind = this.host.minds.get(soul.id);
    if (!mind) throw new ApiError(409, 'not-in-world', 'this soul is not in the world yet');
    const tr = await this.brain.translate(mind, text);
    if (!tr.ok) return { ok: false as const, reason: tr.reason, via: tr.via };
    const r = await this.setIntent(soul, tr.intent, 'web');
    return { ok: true as const, intent: r.intent, text: r.text, tick: r.event.tick, seq: r.event.seq, via: tr.via, confidence: tr.confidence };
  }

  status(soul: SoulRow) {
    const m = this.host.minds.get(soul.id); const e = this.host.engine;
    if (!m || !e.world.entities[m.entityId]) return { id: soul.id, name: soul.name, in_world: false };
    const ent = e.world.entities[m.entityId]; const s = e.describeSurroundings(m.entityId);
    return {
      id: soul.id, name: soul.name, description: soul.description, in_world: true, tick: e.world.tick, time: e.world.env.datetime,
      position: { x: ent.pose.p[0], z: ent.pose.p[2], region: s.region }, activity: ent.human!.activity, doing: m.doing, mood: m.mood,
      intent: m.intent, intent_text: this.host.publicSoul(m).intentText, recent: m.recent, nearby: s.nearby, happening: s.happening,
      available_now: e.enumerateActivities(m.entityId, m.intent).map((o) => ({ id: o.id, label: o.label })),
    };
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
    return this.db.tailEvents(WORLD_ID, 2000).filter((e) => e.payload?.soulId === soul.id).slice(-limit).map((e) => ({ seq: e.seq, tick: e.tick, kind: e.kind, text: tickerText(e, this.host) }));
  }

  // ---- agent tokens
  mintClaim(soul: SoulRow, base: string = this.cfg.publicUrl) {
    const code = newId('claim') + newId('').slice(1);
    this.claims.set(code, { soulId: soul.id, expires: Date.now() + 15 * 60_000 });
    const url = `${base}/claim/${code}`;
    const prompt = `You can steer my Soul "${soul.name}" in Sim, a shared simulated world. Fetch this one-time link with a plain HTTP GET (for example: curl -s ${url}) to receive an API token and instructions, then read ${base}/v1/skill.md and follow it. The link works once and expires in 15 minutes.`;
    return { url, prompt, expires_in: 900 };
  }
  redeemClaim(code: string) {
    const c = this.claims.get(code);
    if (!c || c.expires < Date.now()) throw new ApiError(404, 'claim-invalid', 'this claim link is invalid, already used, or expired');
    this.claims.delete(code);
    const soul = this.db.soul(c.soulId);
    if (!soul || soul.retired_at) throw new ApiError(404, 'claim-invalid', 'soul not found');
    const token = newSoulToken(soul.id);
    this.db.setSoulToken(soul.id, hashToken(token));
    return { soul, token };
  }
  soulFromToken(token: string | undefined): SoulRow | null {
    if (!token?.startsWith('sim_')) return null;
    return this.db.soulByTokenHash(hashToken(token)) ?? null;
  }
}
