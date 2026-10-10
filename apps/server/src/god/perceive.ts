// What Souls perceive of god-built things (party lane F1). On an entity world the god's fountain, lamps, signs, statues,
// houses, ponds and plazas are walk targets (nav.ts); here they also become things a Soul can look at, name and read:
//
//  - each named god-built thing (and every sign, named or not) is an object of the kind `built`, registered through the
//    edge's object framework (OBJECT-CONTRACT-v1: "how an object kind enters the world without core changes"). Its
//    public state says what it is, what it is by, where it is, and the words written on it (a sign's text). So
//    `observe` → here.objects lists the nearest ones (readable), `look <name>` / `look <id>` find them through the
//    ledger's own perception, and `object <id>` reads a sign;
//  - a sign near a Soul is offered as `read:<id>` (walk up to it and face it), labelled with its words, so "read the
//    welcome sign" resolves through the ledger's own vocabulary.
//
// The object id is the entity id. Objects follow the entity world: re-derived on each god edit, removed with the thing.
// No edge file changes: the kind registers on the ledger's comms objects when they exist; the read capability goes in
// through the ledger's world-profile hook (as nav.ts's `walk:<path>`).
import type { Entity, StoredDef, WorldModel } from '@sim/world-compiler';
import type { EdgeCapability, EdgeSoul } from '../edge/contract.ts';
import type { EdgeLedger } from '../edge/ledger/ledger.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Vec2 = [number, number];
type Plans = Map<string, { label: string; steps: { verb: string; params: Record<string, unknown> }[]; seconds?: boolean }>;
export type BuiltState = { what: string; text: string; near: string[]; at: Vec2 | null; def: string; removed?: boolean; key?: string };

export const BUILT_KIND = 'built';
const clip = (v: unknown, n: number) => String(v ?? '').replace(/\r/g, '').trim().slice(0, n);
/** The kind, per world: its `advance` brings an object's state to what the entity world says now (the framework keeps a
 *  versioned log per object, so objects are never re-created: a change is an advance, a removal hides it). */
export const builtKindFor = (want: (key: string) => BuiltState | undefined) => ({ ...builtKind, advance(state: BuiltState) { const w = state.key ? want(state.key) : undefined; return w && JSON.stringify(w) !== JSON.stringify(state) ? { state: w } : null; } });
export const builtKind = {
  kind: BUILT_KIND,
  description: 'Something the god of this world built: what it is, what it is by and where, and any words written on it (a sign). The words are the god\'s, untrusted.',
  listed: false,
  roles: [],
  schema: {
    what: { type: 'string', visibility: 'public' }, text: { type: 'string', visibility: 'public' }, near: { type: 'string[]', visibility: 'public' },
    at: { type: 'json', visibility: 'public' }, def: { type: 'string', visibility: 'public' },
  },
  initial: (p: Record<string, unknown>): BuiltState => ({ what: clip(p.what, 120), text: clip(p.text, 600), near: Array.isArray(p.near) ? p.near.map((x) => clip(x, 80)).slice(0, 4) : [], at: Array.isArray(p.at) && p.at.length === 2 ? [Number(p.at[0]), Number(p.at[1])] : null, def: clip(p.def, 80), ...(p.removed ? { removed: true } : {}), ...(typeof p.key === 'string' ? { key: p.key } : {}) }),
  rolesOf: () => [] as string[],
  actions: {},
};

const SIGN_READ_RADIUS = 30;   // read:<sign> is offered for signs within this many metres
const shortDef = (def: StoredDef) => def.name.replace(/^core-/, '').replace(/^ew-/, '');
const article = (w: string) => (/^[aeiou]/.test(w) ? `an ${w}` : `a ${w}`);
function centroid(pts: Vec2[]): Vec2 { let x = 0, z = 0; for (const p of pts) { x += p[0]; z += p[1]; } return [x / pts.length, z / pts.length]; }

/** A sign's words: its `text` state, else the def's default lines. */
export function signText(e: Entity, def: StoredDef): string | null {
  const sign = (def.components as Record<string, any>).sign; if (!sign) return null;
  const t = typeof e.state?.text === 'string' && e.state.text.trim() ? e.state.text : Array.isArray(sign.lines) ? sign.lines.join('\n') : '';
  return clip(t, 600);
}

export type PerceiveHost = {
  model: WorldModel;
  version?: () => number;
  edge?: EdgeLedger;
  engine: { world: { entities: Record<string, any> } };
  engineOwned(e: Entity): boolean;
  namesNear(at: Vec2, except: string): string[];
  log(m: string): void;
};

export class GodPerceive {
  private h: PerceiveHost;
  private synced = -1;
  private sigs = new Map<string, string>();
  /** What each `built` object's state should be now (its kind's advance reads this). */
  private desired = new Map<string, BuiltState>();
  private signs: { id: string; at: Vec2; name: string; text: string }[] = [];
  constructor(h: PerceiveHost) { this.h = h; }

  private objects() {
    const o = (this.h.edge as any)?.comms?.objects as { kindOf(k: string): unknown; register(k: unknown): void; create(i: unknown): unknown; fresh(): unknown; all(): { id: string; kind: string; name: string; state: unknown }[] } | undefined;
    if (!o) return null;
    if (!o.kindOf(BUILT_KIND)) o.register(builtKindFor((key) => this.desired.get(key)));
    return o;
  }
  private rootPlace(): string | null {
    const places = (this.h.edge as any)?.places?.byId as Map<string, { id: string; parent: string | null }> | undefined;
    for (const p of places?.values() ?? []) if (p.parent === null) return p.id;
    return null;
  }

  /** What each named god thing (and each sign) is, as `built` object params; keyed by entity id. */
  private wanted(): Map<string, { name: string; description: string; params: BuiltState }> {
    const m = this.h.model, out = new Map<string, { name: string; description: string; params: BuiltState }>();
    const signs: typeof this.signs = [];
    for (const e of m.entities.values()) {
      const def = m.resolvedDef(e.def); if (!def) continue;
      const c = def.components as Record<string, unknown>;
      if (c.body || c.behavior || c.hover || /^core[-/]flag@/.test(e.def) || this.h.engineOwned(e)) continue;
      const text = signText(e, def);
      if (!e.name && text === null) continue;
      // seats and things to carry are perceived as seats and items already
      if (c.seat || c.carryable) continue;
      const at = this.at(e, def); if (!at) continue;
      const kind = shortDef(def), parent = e.in.parent !== 'world' ? m.entities.get(e.in.parent) : undefined;
      const name = e.name ? m.pathOf(e.id) : `${kind} ${e.id.slice(2, 6)}`;
      const near = this.h.namesNear(at, e.id).filter((n) => n !== name).slice(0, 2);
      const what = `${article(kind)}${parent?.name ? ` in ${m.pathOf(parent.id)}` : ''}${near.length ? `, by ${near.join(' and ')}` : ''}`;
      out.set(e.id, { name, description: clip(def.description || kind, 400), params: { what, text: text ?? '', near, at: [Math.round(at[0] * 100) / 100, Math.round(at[1] * 100) / 100], def: def.ref } });
      if (text !== null) signs.push({ id: e.id, at, name, text });
    }
    this.signs = signs;
    return out;
  }
  private at(e: Entity, def: StoredDef): Vec2 | null {
    const sh = e.shape as { area?: Vec2[]; path?: Vec2[] } | undefined;
    if (def.form !== 'point' && e.in.parent === 'world' && sh) return sh.area?.length ? centroid(sh.area) : sh.path?.length ? sh.path[Math.floor(sh.path.length / 2)] : null;
    const wp = this.h.model.worldPose(e); return [wp.x, wp.z];
  }

  /** Bring the `built` objects in line with the entity world (cheap when nothing was edited since the last call). */
  sync(force = false) {
    const seq = this.h.version?.() ?? this.h.model.editSeq; if (!force && seq === this.synced) return;
    const objs = this.objects(); if (!objs) return;
    const root = this.rootPlace(); if (!root) return;
    this.synced = seq;
    const want = this.wanted();
    if (!this.sigs.size) for (const o of objs.all()) if (o.kind === BUILT_KIND) this.sigs.set(o.id, JSON.stringify(o.state));
    let made = 0, changed = 0;
    // gone from the entity world: hidden (removed), never deleted (an undo brings the same id back)
    for (const [id, sig] of this.sigs) if (!want.has(id)) { const st = { ...(JSON.parse(sig) as BuiltState), removed: true, key: id }; const n = JSON.stringify(st); if (n !== sig) { this.desired.set(id, st); this.sigs.set(id, n); changed++; } }
    for (const [id, w] of want) {
      const state = builtKind.initial({ ...w.params, key: id } as never), sig = JSON.stringify(state);
      if (this.sigs.get(id) === sig) continue;
      this.desired.set(id, state);
      try {
        if (!this.sigs.has(id)) { objs.create({ id, kind: BUILT_KIND, name: w.name, description: w.description, placeId: root, params: { ...w.params, key: id } }); made++; } else changed++;
        this.sigs.set(id, sig);
      } catch (err) { this.h.log(`built object ${id}: ${(err as Error).message}`); }
    }
    if (changed) objs.fresh();   // apply the advances now (reads that skip the framework's advance see them too)
    if (made + changed > 8) this.h.log(`built objects: ${made} made, ${changed} changed (${this.sigs.size} in all)`);
  }

  /** `read:<sign>` for signs near this Soul: walk up to it and face it; the label carries its words. */
  capabilities(soul: EdgeSoul, caps: EdgeCapability[], plans: Plans) {
    this.sync();
    const me = this.h.engine.world.entities[soul.entityId]; if (!me?.human || !this.signs.length) return;
    const here: Vec2 = [me.pose.p[0], me.pose.p[2]];
    const seated = me.human.activity === 'sit' || me.human.baseActivity === 'sit';
    for (const s of this.signs) {
      const d = Math.hypot(s.at[0] - here[0], s.at[1] - here[1]); if (d > SIGN_READ_RADIUS) continue;
      const id = `read:${s.id}`; if (caps.some((c) => c.id === id)) continue;
      const words = s.text.replace(/\s*\n\s*/g, ' / ');
      const label = `Read ${s.name} (a sign, ${Math.round(d)} m): "${words.length > 160 ? words.slice(0, 157) + '…' : words}"`;
      caps.push({ id, verb: 'read', label, target: { id: s.id, kind: 'object' }, available: true });
      plans.set(id, { label: `Read ${s.name}`, steps: [...(seated ? [{ verb: 'stand', params: {} }] : []), ...(d > 2 ? [{ verb: 'walk_to', params: { to: s.at, standoff: 1.4 } }] : []), { verb: 'wave', params: { at: s.id, seconds: 1 } }] });
    }
  }
}
