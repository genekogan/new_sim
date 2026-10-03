// Graph codec for resumable runtime snapshots (spec §22). Encodes an object graph to plain JSON
// while preserving what JSON.stringify loses and a mid-action runtime depends on:
//   - aliasing: an object reached twice (a child ActionRecord held by its parent's exec and by
//     rt.records; a walk exec held by the live map and by services.walkExecs) decodes to ONE object;
//   - Map / Set (traffic holds, owners), undefined, NaN / ±Infinity / -0.
// Anything else — functions (closures), class instances, typed arrays, symbols, bigints — cannot be
// resumed faithfully, so encode() throws a CodecError naming the path instead of silently dropping it.
// Objects referenced only once encode as themselves, so the world stays readable plain JSON.

export class CodecError extends Error {
  path: string;
  constructor(path: string, what: string) {
    super(`${path} is ${what}, which a resumable snapshot cannot hold`);
    this.path = path;
  }
}

const isPlain = (o: object) => {
  const p = Object.getPrototypeOf(o);
  return p === Object.prototype || p === null;
};

function describe(v: unknown): string | null {
  const t = typeof v;
  if (t === 'function') return `a function (${(v as { name?: string }).name || 'closure'})`;
  if (t === 'symbol' || t === 'bigint') return `a ${t}`;
  if (t !== 'object' || v === null) return null;
  if (Array.isArray(v) || v instanceof Map || v instanceof Set) return null;
  if (!isPlain(v as object)) return `an instance of ${(v as object).constructor?.name ?? 'an unknown class'}`;
  return null;
}

function children(v: object): [string, unknown][] {
  if (Array.isArray(v)) return v.map((x, i) => [String(i), x]);
  if (v instanceof Set) return [...v].map((x, i) => [`<set ${i}>`, x]);
  if (v instanceof Map) {
    const out: [string, unknown][] = [];
    for (const [k, x] of v) out.push([`<key ${String(k)}>`, k], [String(k), x]);
    return out;
  }
  return Object.entries(v);
}

/** `skipMapValues`: Map entries whose value is one of these objects are left out (dropped actions). */
export function encode(root: unknown, rootPath = '$', skipMapValues: ReadonlySet<object> = new Set()): unknown {
  // pass 1: find objects reached more than once (they get an id at their first emission)
  const seen = new Map<object, number>();
  const visit = (v: unknown, path: string) => {
    const bad = describe(v);
    if (bad) throw new CodecError(path, bad);
    if (typeof v !== 'object' || v === null) return;
    const n = seen.get(v) ?? 0;
    seen.set(v, n + 1);
    if (n) return;
    for (const [k, x] of children(v)) {
      if (v instanceof Map && typeof x === 'object' && x !== null && skipMapValues.has(x)) continue;
      visit(x, `${path}.${k}`);
    }
  };
  visit(root, rootPath);
  // pass 2: emit in the same depth-first order decode() walks
  const ids = new Map<object, number>();
  let next = 0;
  const emit = (v: unknown): unknown => {
    if (v === undefined) return { '~u': 1 };
    if (typeof v === 'number') {
      if (Number.isNaN(v)) return { '~n': 'NaN' };
      if (v === Infinity) return { '~n': 'Infinity' };
      if (v === -Infinity) return { '~n': '-Infinity' };
      if (v === 0 && 1 / v < 0) return { '~n': '-0' };
      return v;
    }
    if (typeof v !== 'object' || v === null) return v;
    const id = ids.get(v);
    if (id !== undefined) return { '~r': id };
    const shared = (seen.get(v) ?? 0) > 1;
    let myId = -1;
    if (shared) ids.set(v, (myId = next++));
    let body: unknown;
    if (Array.isArray(v)) body = v.map(emit);
    else if (v instanceof Set) body = { '~set': [...v].map(emit) };
    else if (v instanceof Map) {
      const es: unknown[] = [];
      for (const [k, x] of v) if (!(typeof x === 'object' && x !== null && skipMapValues.has(x))) es.push([emit(k), emit(x)]);
      body = { '~map': es };
    } else {
      const o: Record<string, unknown> = {};
      let tilde = false;
      for (const [k, x] of Object.entries(v)) {
        if (k.startsWith('~')) tilde = true;
        o[k] = emit(x);
      }
      body = tilde ? { '~o': Object.entries(o) } : o;
    }
    return shared ? { '~id': myId, '~v': body } : body;
  };
  return emit(root);
}

export function decode(data: unknown): unknown {
  const byId: unknown[] = [];
  const dec = (d: unknown, register?: (x: unknown) => void): unknown => {
    if (typeof d !== 'object' || d === null) return d;
    if (Array.isArray(d)) {
      const out: unknown[] = [];
      register?.(out);
      for (const x of d) out.push(dec(x));
      return out;
    }
    const o = d as Record<string, unknown>;
    if ('~u' in o) return undefined;
    if ('~n' in o) return o['~n'] === '-0' ? -0 : Number(o['~n']);
    if ('~r' in o) return byId[o['~r'] as number];
    if ('~id' in o) return dec(o['~v'], (x) => (byId[o['~id'] as number] = x));
    if ('~set' in o) {
      const s = new Set<unknown>();
      register?.(s);
      for (const x of o['~set'] as unknown[]) s.add(dec(x));
      return s;
    }
    if ('~map' in o) {
      const m = new Map<unknown, unknown>();
      register?.(m);
      for (const [k, x] of o['~map'] as [unknown, unknown][]) {
        const kk = dec(k);
        m.set(kk, dec(x));
      }
      return m;
    }
    const out: Record<string, unknown> = {};
    register?.(out);
    const entries = '~o' in o ? (o['~o'] as [string, unknown][]) : Object.entries(o);
    for (const [k, x] of entries) out[k] = dec(x);
    return out;
  };
  return dec(data);
}
