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

type ImmutableShape =
  | { kind: 'object'; keys: string[]; values: unknown[]; tilde: boolean }
  | { kind: 'array'; values: unknown[] };
type Captured = { refs: number } & (ImmutableShape
  | { kind: 'set'; values: unknown[] }
  | { kind: 'map'; entries: [unknown, unknown][] }
);

// Only prepareImmutableSnapshotData can admit nodes. A matching version/hash, a frozen
// root, or a caller's assertion of immutability never grants this shortcut.
const immutableShapes = new WeakMap<object, ImmutableShape>();
declare const graphCaptureBrand: unique symbol;
/** Opaque, process-local captured graph. Counts make cold/warm capture measurable;
 * source identities and the captured child arrays are never exposed to callers. */
export type GraphCapture = { readonly [graphCaptureBrand]: true; readonly nodes: number; readonly cachedNodes: number };
const captures = new WeakMap<GraphCapture, { root: unknown; captured: Map<object, Captured> }>();

type ErrorPath = (key?: string) => string;
function rejectSymbolKeys(v: object, path: ErrorPath): void {
  for (const key of Object.getOwnPropertySymbols(v))
    if (Object.getOwnPropertyDescriptor(v, key)!.enumerable)
      throw new CodecError(path(), 'an object with an enumerable symbol key');
}

/** Read descriptors, never values through accessors (including diagnostic getters such as constructor/name). */
function dataValue(v: object, key: string, path: ErrorPath): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(v, key);
  if (!descriptor) throw new CodecError(path(key), 'an array hole');
  if (!('value' in descriptor)) throw new CodecError(path(key), 'an accessor property');
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
  return finishGraph(captureGraph(root, rootPath, skipMapValues));
}

/** Capture one synchronous graph boundary. finishGraph never rereads live source
 * properties or iterators, so callers may mutate the source after this returns. */
export function captureGraph(root: unknown, rootPath = '$', skipMapValues: ReadonlySet<object> = new Set()): GraphCapture {
  return capture(root, rootPath, skipMapValues, false);
}

function capture(root: unknown, rootPath: string, skipMapValues: ReadonlySet<object>, admission: boolean): GraphCapture {
  // Pass 1 validates and captures each object's children once, and counts references.
  // Pass 2 reads only these captured values: no getters, source iterators or second source traversal.
  const captured = new Map<object, Captured>();
  let cachedNodes = 0;
  // Successful captures need no diagnostic strings. Reuse these stacks rather than
  // constructing a full path twice per property (descriptor validation and traversal).
  type PathKind = 'property' | 'map key' | 'map value' | 'set';
  const pathKeys: (string | number)[] = [], pathKinds: PathKind[] = [];
  const path: ErrorPath = (key) => {
    let out = rootPath;
    for (let i = 0; i < pathKeys.length; i++)
      out += pathKinds[i] === 'property' ? `.${pathKeys[i]}` : `.<${pathKinds[i]} ${pathKeys[i]}>`;
    return key === undefined ? out : `${out}.${key}`;
  };
  const visit = (v: unknown, key?: string | number, kind: PathKind = 'property'): void => {
    const type = typeof v;
    if (v === null || type === 'number' || type === 'string' || type === 'boolean' || type === 'undefined') return;
    const known = typeof v === 'object' ? captured.get(v) : undefined;
    if (known) { known.refs++; return; }
    const immutable = typeof v === 'object' ? immutableShapes.get(v) : undefined;
    if (immutable) {
      captured.set(v as object, { ...immutable, refs: 1 });
      cachedNodes++;
      // Admission only checks/freezes new nodes; an admitted node already proves
      // its entire immutable closure. Actual capture MUST count all its edges.
      if (admission) return;
      // Its entire enumerable closure was validated and frozen at admission.
      // Still traverse every edge for THIS graph's aliases, counts and ID order.
      // No diagnostic paths are needed: descendants cannot become unsupported.
      for (const value of immutable.values) visit(value);
      return;
    }
    // Keep one recursive frame per graph edge, as before lazy paths. Primitive
    // leaves and already-captured aliases do not need path bookkeeping at all.
    if (key !== undefined) { pathKeys.push(key); pathKinds.push(kind); }
    if (typeof v !== 'object' || v === null) throw new CodecError(path(), `a ${type}`);
    rejectSymbolKeys(v, path);
    if (Array.isArray(v)) {
      const values: unknown[] = [], length = v.length;
      for (const key of Object.keys(v)) {
        const index = Number(key);
        if (!Number.isInteger(index) || index < 0 || index >= length || String(index) !== key)
          throw new CodecError(path(key), 'an extra array property');
      }
      for (let i = 0; i < length; i++) values.push(dataValue(v, String(i), path));
      captured.set(v, { kind: 'array', refs: 1, values });
      for (let i = 0; i < values.length; i++) visit(values[i], i);
    } else if (v instanceof Map) {
      const extra = Object.keys(v)[0];
      if (extra !== undefined) throw new CodecError(path(extra), 'an extra Map property');
      const entries: [unknown, unknown][] = [];
      // Native iteration bypasses user-defined iterators and never coerces object keys for a path.
      for (const [key, value] of Map.prototype.entries.call(v))
        if (!(typeof value === 'object' && value !== null && skipMapValues.has(value))) entries.push([key, value]);
      captured.set(v, { kind: 'map', refs: 1, entries });
      for (let i = 0; i < entries.length; i++) {
        visit(entries[i][0], i, 'map key');
        visit(entries[i][1], i, 'map value');
      }
    } else if (v instanceof Set) {
      const extra = Object.keys(v)[0];
      if (extra !== undefined) throw new CodecError(path(extra), 'an extra Set property');
      const values: unknown[] = [...Set.prototype.values.call(v)];
      captured.set(v, { kind: 'set', refs: 1, values });
      for (let i = 0; i < values.length; i++) visit(values[i], i, 'set');
    } else {
      if (!isPlain(v)) throw new CodecError(path(), 'an instance with an unsupported prototype');
      // Keep Object.keys' ordering and one parallel value array; a tuple for every
      // property would allocate another temporary object for each edge in the graph.
      const keys = Object.keys(v), values: unknown[] = new Array(keys.length);
      let tilde = false;
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        values[i] = dataValue(v, key, path);
        tilde ||= key.startsWith('~');
      }
      captured.set(v, { kind: 'object', refs: 1, keys, values, tilde });
      for (let i = 0; i < keys.length; i++) visit(values[i], keys[i]);
    }
    if (key !== undefined) { pathKeys.pop(); pathKinds.pop(); }
  };
  visit(root);
  const handle = Object.freeze({ nodes: captured.size, cachedNodes }) as GraphCapture;
  captures.set(handle, { root, captured });
  return handle;
}

/** Emit a fresh owned JSON tree with the existing marker/reference order. This
 * may run later or repeatedly; neither source mutation nor output mutation can
 * change a captured graph. The handle is not a worker transport format. */
export function finishGraph(handle: GraphCapture): unknown {
  const state = captures.get(handle);
  if (!state) throw new TypeError('not a captured snapshot graph');
  const { root, captured } = state;
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
    else if (node.tilde) body = { '~o': node.keys.map((key, i) => [key, emit(node.values[i])]) };
    else {
      const o: Record<string, unknown> = {};
      for (let i = 0; i < node.keys.length; i++) putOwn(o, node.keys[i], emit(node.values[i]));
      body = o;
    }
    return shared ? { '~id': myId, '~v': body } : body;
  };
  return emit(root);
}

/** Explicit ownership boundary for static snapshot facts (currently entity
 * physics construction/restore only). Validate the whole enumerable graph before
 * freezing any source node. Object.freeze cannot make Map/Set entries immutable,
 * so those collections are deliberately excluded from this admission path.
 * Returns false without freezing new nodes when admission is unsupported;
 * generic encode continues accepting collections through ordinary capture. */
export function prepareImmutableSnapshotData(root: unknown, rootPath = '$'): boolean {
  if (root !== null && typeof root === 'object' && immutableShapes.has(root)) return true;
  let handle: GraphCapture;
  try { handle = capture(root, rootPath, new Set(), true); }
  catch (error) {
    // Admission is an optimization, not a new construction/restore refusal.
    // Ordinary encoding remains responsible for diagnosing unsupported state.
    if (error instanceof CodecError) return false;
    throw error;
  }
  const { captured } = captures.get(handle)!;
  for (const node of captured.values())
    if (node.kind === 'map' || node.kind === 'set')
      return false;
  for (const [source, node] of captured) {
    if (immutableShapes.has(source)) continue;
    Object.freeze(source);
    if (node.kind === 'array') immutableShapes.set(source, { kind: 'array', values: node.values });
    else if (node.kind === 'object') immutableShapes.set(source, { kind: 'object', keys: node.keys, values: node.values, tilde: node.tilde });
  }
  return true;
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
