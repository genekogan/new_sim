// Graph codec for resumable runtime snapshots (spec §22). Encodes an object graph to plain JSON
// while preserving what JSON.stringify loses and a mid-action runtime depends on:
//   - aliasing: an object reached twice (a child ActionRecord held by its parent's exec and by
//     rt.records; a walk exec held by the live map and by services.walkExecs) decodes to ONE object;
//   - Map / Set (traffic holds, owners), undefined, NaN / ±Infinity / -0.
// Anything else — functions (closures), class instances, typed arrays, symbols, bigints — cannot be
// resumed faithfully, so encode() throws a CodecError naming the path instead of silently dropping it.
// Inputs are inert simulation data: own enumerable data properties, dense arrays and native Map/Set
// entries. Accessors, enumerable symbol keys and extra enumerable collection properties are refused.
// Non-enumerable object metadata and prototypes are not part of the persisted graph. As with the
// runtime itself, proxies and modified global built-ins are outside this data contract.
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

type Captured = { refs: number } & (
  | { kind: 'object'; entries: [string, unknown][]; tilde: boolean }
  | { kind: 'array'; values: unknown[] }
  | { kind: 'set'; values: unknown[] }
  | { kind: 'map'; entries: [unknown, unknown][] }
);

function rejectSymbolKeys(v: object, path: string): void {
  for (const key of Object.getOwnPropertySymbols(v))
    if (Object.getOwnPropertyDescriptor(v, key)!.enumerable)
      throw new CodecError(path, 'an object with an enumerable symbol key');
}

/** Read descriptors, never values through accessors (including diagnostic getters such as constructor/name). */
function dataValue(v: object, key: string, path: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(v, key);
  if (!descriptor) throw new CodecError(path, 'an array hole');
  if (!('value' in descriptor)) throw new CodecError(path, 'an accessor property');
  return descriptor.value;
}

function putOwn(out: Record<string, unknown>, key: string, value: unknown): void {
  // Assignment would invoke Object.prototype.__proto__, losing a legitimate data key.
  if (key === '__proto__') Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
  else out[key] = value;
}

/** Successful encoding returns an owned JSON tree: dense arrays, plain objects and
 * finite JSON primitives. Special values and graph edges use the existing tags;
 * no source object/getter/iterator survives in the result. `skipMapValues` omits
 * whole Map entries whose value is in the set (dropped actions). */
export function encode(root: unknown, rootPath = '$', skipMapValues: ReadonlySet<object> = new Set()): unknown {
  // Pass 1 validates and captures each object's children once, and counts references.
  // Pass 2 reads only these captured values: no getters, source iterators or second source traversal.
  const captured = new Map<object, Captured>();
  const visit = (v: unknown, path: string) => {
    const type = typeof v;
    if (type === 'function' || type === 'symbol' || type === 'bigint') throw new CodecError(path, `a ${type}`);
    if (typeof v !== 'object' || v === null) return;
    const known = captured.get(v);
    if (known) { known.refs++; return; }
    rejectSymbolKeys(v, path);
    if (Array.isArray(v)) {
      const values: unknown[] = [], length = v.length;
      for (const key of Object.keys(v)) {
        const index = Number(key);
        if (!Number.isInteger(index) || index < 0 || index >= length || String(index) !== key)
          throw new CodecError(`${path}.${key}`, 'an extra array property');
      }
      for (let i = 0; i < length; i++) values.push(dataValue(v, String(i), `${path}.${i}`));
      captured.set(v, { kind: 'array', refs: 1, values });
      for (let i = 0; i < values.length; i++) visit(values[i], `${path}.${i}`);
    } else if (v instanceof Map) {
      const extra = Object.keys(v)[0];
      if (extra !== undefined) throw new CodecError(`${path}.${extra}`, 'an extra Map property');
      const entries: [unknown, unknown][] = [];
      // Native iteration bypasses user-defined iterators and never coerces object keys for a path.
      for (const [key, value] of Map.prototype.entries.call(v))
        if (!(typeof value === 'object' && value !== null && skipMapValues.has(value))) entries.push([key, value]);
      captured.set(v, { kind: 'map', refs: 1, entries });
      for (let i = 0; i < entries.length; i++) {
        visit(entries[i][0], `${path}.<map key ${i}>`);
        visit(entries[i][1], `${path}.<map value ${i}>`);
      }
    } else if (v instanceof Set) {
      const extra = Object.keys(v)[0];
      if (extra !== undefined) throw new CodecError(`${path}.${extra}`, 'an extra Set property');
      const values: unknown[] = [...Set.prototype.values.call(v)];
      captured.set(v, { kind: 'set', refs: 1, values });
      for (let i = 0; i < values.length; i++) visit(values[i], `${path}.<set ${i}>`);
    } else {
      if (!isPlain(v)) throw new CodecError(path, 'an instance with an unsupported prototype');
      const entries: [string, unknown][] = [];
      let tilde = false;
      for (const key of Object.keys(v)) {
        entries.push([key, dataValue(v, key, `${path}.${key}`)]);
        tilde ||= key.startsWith('~');
      }
      captured.set(v, { kind: 'object', refs: 1, entries, tilde });
      for (const [key, value] of entries) visit(value, `${path}.${key}`);
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
    const node = captured.get(v)!;
    const shared = node.refs > 1;
    let myId = -1;
    if (shared) ids.set(v, (myId = next++));
    let body: unknown;
    if (node.kind === 'array') body = node.values.map(emit);
    else if (node.kind === 'set') body = { '~set': node.values.map(emit) };
    else if (node.kind === 'map') body = { '~map': node.entries.map(([key, value]) => [emit(key), emit(value)]) };
    else if (node.tilde) body = { '~o': node.entries.map(([key, value]) => [key, emit(value)]) };
    else {
      const o: Record<string, unknown> = {};
      for (const [key, value] of node.entries) putOwn(o, key, emit(value));
      body = o;
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
    for (const [k, x] of entries) putOwn(out, k, dec(x));
    return out;
  };
  return dec(data);
}
