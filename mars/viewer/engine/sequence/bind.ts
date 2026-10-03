// Template → BoundPlan. Binding substitutes parameters with an explicit,
// eval-free syntax, validates the step graph (unique ids, known references,
// acyclic), checks bindings against the baseline world, and parses every
// step's params with the verb's zod schema from the runtime registry.
import type { ActionDef, Diagnostic } from '../actions/types.ts';
import { hashOf } from '../core/hash.ts';
import type { WorldHistory } from '../history/store.ts';
import type { WorldState } from '../world/types.ts';
import { SEQUENCE_VERBS } from './runner.ts';
import { PLAN_SCHEMA, templateSchema, type BoundPlan, type BoundStep, type ParamKind, type SequenceTemplate, type StepSpec } from './types.ts';

export class PlanError extends Error {
  code: string;
  diagnostics: Diagnostic[];
  constructor(code: string, diagnostics: Diagnostic[]) {
    super(`${code}: ${diagnostics.map((d) => d.message).join('; ')}`);
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

/** "$name", "$name[0]", "$name.x", "$name[1][0]" — whole-string references only. */
const REF = /^\$([A-Za-z_]\w*)((?:\[\d+\]|\.[A-Za-z_]\w*)*)$/;
const ACCESSOR = /\[(\d+)\]|\.([A-Za-z_]\w*)/g;

/** Resolve template references inside a JSON value. Throws a Diagnostic-shaped error on unknown refs. */
export function substitute(value: unknown, bindings: Record<string, unknown>, where: string): unknown {
  if (typeof value === 'string') {
    if (value.startsWith('$$')) return value.slice(1);
    if (!value.startsWith('$')) return value;
    const m = REF.exec(value);
    if (!m) throw diag('plan.bad-reference', `${where}: "${value}" is not a valid parameter reference (use $name, $name[0] or $name.field; $$ for a literal $)`);
    if (!Object.prototype.hasOwnProperty.call(bindings, m[1])) throw diag('plan.unbound-reference', `${where}: "${value}" refers to unbound parameter "${m[1]}"`);
    let cur: unknown = bindings[m[1]];
    for (const a of m[2].matchAll(ACCESSOR)) {
      const key: string | number = a[1] !== undefined ? Number(a[1]) : a[2];
      const ok =
        typeof key === 'number'
          ? Array.isArray(cur) && key < cur.length
          : cur !== null && typeof cur === 'object' && !Array.isArray(cur) && Object.prototype.hasOwnProperty.call(cur, key);
      if (!ok) throw diag('plan.bad-reference', `${where}: "${value}" — ${typeof key === 'number' ? `index ${key}` : `field "${key}"`} does not exist in the binding`);
      cur = (cur as Record<string | number, unknown>)[key];
    }
    return structuredClone(cur);
  }
  if (Array.isArray(value)) return value.map((v, i) => substitute(v, bindings, `${where}[${i}]`));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value)) out[k] = substitute((value as Record<string, unknown>)[k], bindings, `${where}.${k}`);
    return out;
  }
  return value;
}

/** Structural problems with a template's step graph (empty = valid). */
/** Inline references inside free text: "$name", "$name[0]", "$name.x", … anywhere in the string; "$$" is a literal "$". */
const INLINE_REF = /\$\$|\$([A-Za-z_]\w*)((?:\[\d+\]|\.[A-Za-z_]\w*)*)/g;

/**
 * A step label with its template references filled in from the plan's bindings, e.g. "$crew[2] climbs below" →
 * "m3 climbs below" (W39). Labels are display text: `bindTemplate` keeps `BoundStep.label` as the template wrote it
 * (a filled label would change `planHash`, and with it every recorded take's `planHash` / id), so readers that show a
 * label (the take recorder's step timeline) fill it here. Unlike `substitute` the reference may sit anywhere in the text;
 * a ".word" that is no field of the value ends the reference (so "$crew[2].done" is "m3.done"), while a reference to an
 * unbound name or a missing index is left as written. A bound list is joined with ", "; an object is written as JSON.
 */
export function bindLabel(label: string, bindings: Record<string, unknown>): string {
  return label.replace(INLINE_REF, (whole: string, name: string | undefined, chain: string) => {
    if (whole === '$$') return '$';
    if (!name || !Object.prototype.hasOwnProperty.call(bindings, name)) return whole;
    let cur: unknown = bindings[name];
    let used = `$${name}`;
    for (const a of chain.matchAll(ACCESSOR)) {
      const key: string | number = a[1] !== undefined ? Number(a[1]) : a[2];
      const ok =
        typeof key === 'number'
          ? Array.isArray(cur) && key < cur.length
          : cur !== null && typeof cur === 'object' && !Array.isArray(cur) && Object.prototype.hasOwnProperty.call(cur, key);
      if (!ok) {
        if (typeof key === 'number') return whole; // a bad index: the reference is wrong, show it as written
        break; // a ".word" that is no field ends the reference (sentence text after it)
      }
      cur = (cur as Record<string | number, unknown>)[key];
      used += a[0];
    }
    const text = typeof cur === 'string' ? cur : Array.isArray(cur) ? cur.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(', ') : typeof cur === 'number' || typeof cur === 'boolean' ? String(cur) : JSON.stringify(cur);
    return text + whole.slice(used.length);
  });
}

export function validateGraph(steps: StepSpec[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  const ids = new Set<string>();
  for (const s of steps) {
    if (ids.has(s.id)) out.push(d('sequence.duplicate-step', `step id "${s.id}" is used more than once`, [s.id]));
    ids.add(s.id);
  }
  const deps = new Map<string, string[]>();
  for (const s of steps) {
    const ds = [...(s.after ?? []), ...(s.when ? [s.when.step] : [])];
    for (const x of ds) {
      if (!ids.has(x)) out.push(d('sequence.unknown-step', `step "${s.id}" depends on unknown step "${x}"`, [s.id, x]));
      if (x === s.id) out.push(d('sequence.cycle', `step "${s.id}" depends on itself`, [s.id]));
    }
    deps.set(s.id, ds.filter((x) => ids.has(x) && x !== s.id));
  }
  // cycle detection (iterative DFS, declaration order → deterministic message)
  const state = new Map<string, 0 | 1 | 2>();
  for (const s of steps) {
    if (state.get(s.id)) continue;
    const stack: { id: string; i: number }[] = [{ id: s.id, i: 0 }];
    const path: string[] = [s.id];
    state.set(s.id, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const ds = deps.get(top.id) ?? [];
      if (top.i >= ds.length) {
        state.set(top.id, 2);
        stack.pop();
        path.pop();
        continue;
      }
      const n = ds[top.i++];
      const st = state.get(n) ?? 0;
      if (st === 1) {
        const cyc = [...path.slice(path.indexOf(n)), n];
        out.push(d('sequence.cycle', `dependency cycle: ${cyc.join(' → ')}`, cyc));
        return out;
      }
      if (st === 0) {
        state.set(n, 1);
        stack.push({ id: n, i: 0 });
        path.push(n);
      }
    }
  }
  return out;
}

function checkBinding(name: string, kind: ParamKind, v: unknown, world: WorldState): Diagnostic[] {
  const ent = (id: unknown, human: boolean): Diagnostic[] => {
    if (typeof id !== 'string') return [d('plan.bad-binding', `parameter "${name}" expects an entity id string, got ${JSON.stringify(id)}`)];
    const e = world.entities[id];
    if (!e) return [d('plan.unknown-entity', `parameter "${name}": no entity "${id}" in the baseline state`, [id])];
    if (human && (e.kind !== 'human' || !e.human)) return [d('plan.not-an-actor', `parameter "${name}": "${id}" is a ${e.kind}, not a person`, [id])];
    return [];
  };
  switch (kind) {
    case 'actor':
      return ent(v, true);
    case 'entity':
      return ent(v, false);
    case 'actors':
    case 'entities':
      if (!Array.isArray(v)) return [d('plan.bad-binding', `parameter "${name}" expects a list of ids`)];
      return v.flatMap((x) => ent(x, kind === 'actors'));
    case 'number':
      return typeof v === 'number' && Number.isFinite(v) ? [] : [d('plan.bad-binding', `parameter "${name}" expects a number`)];
    case 'string':
      return typeof v === 'string' ? [] : [d('plan.bad-binding', `parameter "${name}" expects a string`)];
    case 'point':
      return Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && Number.isFinite(x))
        ? []
        : [d('plan.bad-binding', `parameter "${name}" expects a point [x, z]`)];
    default:
      return [];
  }
}

export type BindContext = {
  history: WorldHistory;
  /** Workspace id (its current head) or checkpoint id the plan is validated against. */
  baseline: string;
  registry: Map<string, ActionDef>;
};

/** Bind a template to concrete actors/objects and one baseline checkpoint. Throws PlanError listing every problem. */
export function bindTemplate(template: SequenceTemplate, bindings: Record<string, unknown>, ctx: BindContext): BoundPlan {
  const parsed = templateSchema.safeParse(template);
  if (!parsed.success)
    throw new PlanError(
      'plan.invalid-template',
      parsed.error.issues.map((i) => d('sequence.invalid-template', `template ${i.path.join('.')}: ${i.message}`)),
    );
  const t = parsed.data as SequenceTemplate;
  const errors = validateGraph(t.steps);
  const ws = ctx.history.workspaces.get(ctx.baseline);
  const cp = ctx.history.checkpoint(ws ? ws.head : ctx.baseline);
  const world = ctx.history.read(cp.id);
  for (const name of Object.keys(t.params)) {
    if (!Object.prototype.hasOwnProperty.call(bindings, name)) errors.push(d('plan.missing-binding', `template parameter "${name}" is not bound`));
    else errors.push(...checkBinding(name, t.params[name].kind, bindings[name], world));
  }
  for (const name of Object.keys(bindings))
    if (!Object.prototype.hasOwnProperty.call(t.params, name)) errors.push(d('plan.unknown-binding', `binding "${name}" is not a parameter of template ${t.id}`));
  const steps: BoundStep[] = [];
  for (const s of t.steps) {
    const def = ctx.registry.get(s.verb) ?? (Object.hasOwn(SEQUENCE_VERBS, s.verb) ? SEQUENCE_VERBS[s.verb] : undefined);
    if (!def) {
      errors.push(d('action.unknown-verb', `step "${s.id}": no action verb "${s.verb}" in the registry`, [s.id]));
      continue;
    }
    let params: unknown;
    try {
      params = substitute(s.params, bindings, `step "${s.id}" params`);
    } catch (e) {
      errors.push({ ...(e as Diagnostic), subjects: [s.id] });
      continue;
    }
    const r = def.schema.safeParse(params);
    if (!r.success) {
      errors.push(
        d('action.invalid-params', `step "${s.id}" (${s.verb}): ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`, [s.id]),
      );
      continue;
    }
    // the runner's `cancel` names another step of this template (LM-016)
    if (s.verb === 'cancel' && !ctx.registry.has('cancel')) {
      const target = (r.data as { step: string }).step;
      if (target === s.id || !t.steps.some((x) => x.id === target)) {
        errors.push(d('sequence.unknown-step', `step "${s.id}" (cancel): ${target === s.id ? 'cannot cancel itself' : `no step "${target}" in template ${t.id}`}`, [s.id]));
        continue;
      }
    }
    steps.push({ ...s, params: r.data as Record<string, unknown> });
  }
  if (errors.length) throw new PlanError('plan.invalid', errors);
  const body: Omit<BoundPlan, 'planHash'> = {
    schema: PLAN_SCHEMA,
    template: t,
    templateHash: hashOf(t),
    bindings: structuredClone(bindings),
    steps,
    baselineCheckpoint: cp.id,
    baselinePhysicalHash: cp.physicalHash,
    rulesVersion: ctx.history.rulesVersion,
  };
  return { ...body, planHash: planHashOf(body) };
}

export function planHashOf(plan: Omit<BoundPlan, 'planHash'> | BoundPlan): string {
  const { planHash: _h, ...body } = plan as BoundPlan;
  return hashOf(body).slice(0, 24);
}

function d(code: string, message: string, subjects?: string[]): Diagnostic {
  return subjects ? { code, message, subjects } : { code, message };
}
function diag(code: string, message: string): Diagnostic {
  return { code, message };
}
