// def1to2: the pure, deterministic def/1 → def/2 upgrader (CATALOG-PROGRAM (a) "Migration from def/1").
//
// - Worlds are never rewritten: they keep their def/1 records pinned by hash, and the compiler keeps its def/1 reader.
// - The upgrader fills what def/2 requires and def/1 left open (numeric ranges, defaults, docs, groups) from the
//   conventions, then the generator's own params, then a size/angle heuristic; it records every filled field in
//   `filled`, so nothing is silently invented.
// - It recovers `actuators` from the expanded state + action pairs only when re-expanding reproduces the original
//   exactly (so `def2to1` is lossless whenever nothing was filled).
// - It moves the words (description, category, synonyms) out of the def into the item's `text` (Gene's Q7).
// - `def2to1` is the engine view: what a def/2 places as today (def/1 + text), until the engine reads def/2 itself (P1).
import { GENERATORS, type FieldInput } from '@sim/generators';
import { vocab, defSchema as def1Schema, hashOf, type DefInput, type StoredDef } from '@sim/world-compiler';
import { def2Schema, ACTUATOR_KINDS, type Def2, type Param2 } from './schema.ts';

type Def1 = ReturnType<typeof def1Schema.parse>;
export type Def1Text = { description: string; category?: string; synonyms?: string[] };
export type Upgrade = {
  def2: Def2;
  /** The words, moved out of the hash. `category` is the explicit one or the inferred one (`categoryInferred`). */
  text: { title: string; first: string; description: string; category: string; synonyms: string[]; categoryInferred: boolean };
  /** Exactly the def/1 words, for a lossless down-conversion of an unfilled def (and for proofs). */
  def1Text: Def1Text;
  /** Fields the upgrader had to invent ("params.w.min", "params.w.doc", …). Empty = lossless. */
  filled: string[];
  actuators: string[];
};

const SIZE = /^(w|h|d|width|height|depth|length|len|radius|r|span|size|thickness|diameter|rise|run|reach)$/i;
const ANGLE = /^(yaw|angle|tilt|rot|rotation|lean|pitch|heading)$/i;
const human = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').toLowerCase();
const r3 = (x: number) => Math.round(x * 1000) / 1000;

function groupOf(k: string, f: { type: string }): Param2['group'] {
  for (const [g, names] of Object.entries(vocab.CONVENTION_GROUPS)) if ((names as string[]).includes(k)) return g as Param2['group'];
  if (k === 'variant') return 'variant';
  if (f.type === 'color') return 'paint';
  if (f.type === 'enum' || f.type === 'bool') return 'option';
  if ((f.type === 'number' || f.type === 'int') && SIZE.test(k)) return 'size';
  return 'own';
}

function upgradeParam(k: string, f0: FieldInput, gen: string | undefined, filled: string[]): Param2 {
  const f = { ...(f0 as Record<string, unknown>) } as Record<string, unknown> & { type: string };
  const conv = (vocab.CONVENTIONS as Record<string, Record<string, unknown>>)[k];
  const gp = gen ? (GENERATORS[gen]?.params?.[k] as Record<string, unknown> | undefined) : undefined;
  const fill = (key: string, v: unknown) => { if (f[key] === undefined && v !== undefined) { f[key] = v; filled.push(`params.${k}.${key}`); } };
  for (const src of [conv, gp]) if (src && src.type === f.type) { fill('min', src.min); fill('max', src.max); fill('default', src.default); fill('doc', src.doc); if (src.values && !f.values) fill('values', src.values); }
  if (f.type === 'number' || f.type === 'int') {
    const isInt = f.type === 'int';
    const d0 = typeof f.default === 'number' ? f.default : typeof f.min === 'number' && typeof f.max === 'number' ? (f.min + f.max) / 2 : typeof f.min === 'number' ? f.min : typeof f.max === 'number' ? f.max : SIZE.test(k) ? 1 : 0;
    const d = isInt ? Math.round(d0) : d0;
    let lo: number, hi: number;
    if (ANGLE.test(k)) { lo = -180; hi = 180; }
    else if (SIZE.test(k) || d > 0) { lo = d > 0 ? r3(d * 0.25) : 0; hi = d > 0 ? r3(d * 4) : 10; }
    else if (d < 0) { lo = r3(d * 4); hi = 0; }
    else { lo = 0; hi = 1; }
    if (isInt) { lo = Math.floor(lo); hi = Math.ceil(hi); }
    fill('default', d); fill('min', Math.min(lo, d)); fill('max', Math.max(hi, d));
    if (f.unit === undefined) f.unit = SIZE.test(k) ? 'm' : ANGLE.test(k) ? 'deg' : '';
  }
  if (f.type === 'enum') fill('default', (f.values as string[] | undefined)?.[0]);
  if (f.type === 'bool') fill('default', false);
  fill('doc', human(k));
  f.group = groupOf(k, f);
  return f as unknown as Param2;
}

/** Inverse of upgradeParam for the engine: def/2 extras (group, unit, step) dropped; filled ranges kept (they narrow
 *  only new placements). */
function downgradeParam(p: Param2): FieldInput {
  const { group: _g, unit: _u, step: _s, ...rest } = p as Param2 & { unit?: string; step?: number };
  return rest as FieldInput;
}

const sameJson = (a: unknown, b: unknown) => hashOf(a) === hashOf(b);
const ACTION = (a: unknown) => def1Schema.shape.actions.parse([a])[0];

/** Recover actuators: [kind, {default,label}] whose expansion reproduces the original state field and actions exactly,
 *  with the actuator actions first and in declared order (how vocab.actuators() writes them). */
function recoverActuators(d: Def1) {
  const decls: [string, { default?: boolean | number; label?: string }][] = [];
  let rest = [...d.actions]; const state = { ...d.state };
  for (const kind of ACTUATOR_KINDS) {
    const a = vocab.ACTUATORS[kind]; const field = state[a.field]; if (!field) continue;
    const first = rest[0]; if (!first) break;
    const probe = a.build({ default: (field as { default?: boolean | number }).default, label: 'X' });
    const verb = probe.actions![0].label.replace(/ X$/, '');
    if (!first.label.startsWith(verb + ' ')) break;
    const label = first.label.slice(verb.length + 1);
    const o = { ...((field as { default?: unknown }).default !== undefined ? { default: (field as { default: boolean | number }).default } : {}), ...(label !== 'it' ? { label } : {}) };
    const b = a.build(o);
    const want = (b.actions ?? []).map(ACTION);
    if (!sameJson(def1Schema.shape.state.parse(b.state)[a.field], field) || !sameJson(rest.slice(0, want.length), want)) break;
    decls.push([kind, o]); rest = rest.slice(want.length); delete state[a.field];
  }
  return { decls, actions: rest, state };
}

function physicsOf(d: Def1): Def2['physics'] {
  const kinds = new Set(d.slots.map((s) => s.kind));
  const enterable = kinds.has('room') || kinds.has('door') || !!(d.components as Record<string, unknown>).place || (d.make.kind === 'gen' && /^building/.test(d.make.gen)) || (d.make.kind === 'mesh' && !!(d.make as { footprint?: string }).footprint);
  const collide = d.layer === 'decor' || d.make.kind === 'none' ? 'none' : enterable ? 'walls' : d.make.kind === 'mesh' ? (d.make.collide === 'mesh' ? 'mesh' : d.make.collide === 'hull' ? 'hull' : d.make.collide === 'none' ? 'none' : 'box') : 'box';
  return { collide, blocksNav: d.layer === 'solid' && collide !== 'none', walkableTop: kinds.has('floor') || kinds.has('roof') || !!(d.components as Record<string, unknown>).floor };
}

export function def1to2(input: DefInput | StoredDef): Upgrade {
  const d: Def1 = def1Schema.parse(stripStored(input));
  const filled: string[] = [];
  const gen = d.make.kind === 'gen' ? d.make.gen : undefined;
  const params: Record<string, Param2> = {};
  for (const [k, f] of Object.entries(d.params)) params[k] = upgradeParam(k, f as FieldInput, gen, filled);
  const act = recoverActuators(d);
  const def2 = def2Schema.parse({
    schema: 'def/2', name: d.name, version: d.version, ...(d.extends ? { extends: d.extends } : {}), tags: d.tags,
    form: d.form, make: d.make, params, state: act.state, slots: d.slots, actuators: act.decls, actions: act.actions,
    components: d.components, size: d.size, anchor: d.anchor, layer: d.layer, physics: physicsOf(d),
    ...(d.tilt ? { tilt: d.tilt } : {}), overlaps: d.overlaps, ...(d.contents ? { contents: d.contents } : {}),
    ...(d.layers ? { layersInert: { INERT: true, ...d.layers } } : {}),
    ...(d.material ? { material: d.material } : {}), ...(d.palette ? { palette: d.palette } : {}),
  });
  const category = vocab.categoryOf(d as never);
  const first = (d.description.split(/(?<=[.;!?])\s/)[0] ?? '').slice(0, 160);
  const title = d.name.replace(/^core-/, '').replace(/^(lm|mars)-/, '').replace(/[-_.]+/g, ' ').slice(0, 60);
  return {
    def2, filled, actuators: act.decls.map(([k]) => k),
    text: { title, first, description: d.description, category, synonyms: d.synonyms ?? [], categoryInferred: !d.category },
    def1Text: { description: d.description, ...(d.category ? { category: d.category } : {}), ...(d.synonyms ? { synonyms: d.synonyms } : {}) },
  };
}

/** The engine view of a def/2 (+ its words): a def/1 input the current compiler places. Lossless for an unfilled upgrade. */
export function def2to1(d2: Def2, text: Def1Text, opts: { omit?: string[] } = {}): DefInput {
  const d = def2Schema.parse(d2);
  // `omit` = an upgrade's `filled` list: drop what the upgrader invented, giving back the exact def/1 (proofs, replays)
  const omit = new Set(opts.omit ?? []);
  const down = (k: string, p: Param2) => { const f = downgradeParam(p) as Record<string, unknown>; for (const key of Object.keys(f)) if (omit.has(`params.${k}.${key}`)) delete f[key]; return f as FieldInput; };
  const state: Record<string, FieldInput> = {}; const actions: NonNullable<DefInput['actions']> = [];
  for (const [kind, o] of d.actuators) { const b = vocab.ACTUATORS[kind].build(o); Object.assign(state, b.state); actions.push(...(b.actions ?? [])); }
  Object.assign(state, d.state); actions.push(...(d.actions as never[]));
  const { INERT: _i, ...layers } = d.layersInert ?? { INERT: true };
  return def1Schema.parse({
    schema: 'def/1', name: d.name, version: d.version, ...(d.extends ? { extends: d.extends } : {}), description: text.description, tags: d.tags,
    ...(text.category ? { category: text.category } : {}), ...(text.synonyms ? { synonyms: text.synonyms } : {}),
    form: d.form, make: d.make, params: Object.fromEntries(Object.entries(d.params).map(([k, p]) => [k, down(k, p)])), state, slots: d.slots,
    components: d.components, actions, anchor: d.anchor, ...(d.material ? { material: d.material } : {}), ...(d.palette ? { palette: d.palette } : {}),
    ...(d.tilt ? { tilt: d.tilt } : {}), layer: d.layer, size: d.size, overlaps: d.overlaps, ...(d.contents ? { contents: d.contents } : {}),
    ...(d.layersInert ? { layers } : {}),
  }) as DefInput;
}

/** A def/2's content hash: its rev (what the item and, from P1, worlds pin). Text is not in it. */
export const def2Hash = (d2: Def2) => hashOf(def2Schema.parse(d2));
/** The def/1 hash exactly as WorldModel.defineDef computes it (budget excluded). */
export function def1Hash(input: DefInput | StoredDef): string { const { budget: _b, ...h } = def1Schema.parse(stripStored(input)); return hashOf(h); }

function stripStored(d: DefInput | StoredDef): DefInput {
  const { hash: _h, ref: _r, by: _b, born: _n, ...rest } = d as StoredDef;
  return rest as DefInput;
}
