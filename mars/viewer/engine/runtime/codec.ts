import { selectPhysicsTextForCapture } from '../core/hash.ts';
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
type Captured = { refs: number; hashFlags?: number } & (ImmutableShape
  | { kind: 'set'; values: unknown[] }
  | { kind: 'map'; entries: [unknown, unknown][] }
);

// Only prepareImmutableSnapshotData can admit nodes. A matching version/hash, a frozen
// root, or a caller's assertion of immutability never grants this shortcut.
const immutableShapes = new WeakMap<object, ImmutableShape>();
const hashableImmutableShapes = new WeakSet<object>();
const physicsFreeImmutableShapes = new WeakSet<object>();
declare const graphCaptureBrand: unique symbol;
/** Opaque, process-local captured graph. Counts make cold/warm capture measurable;
 * source identities and the captured child arrays are never exposed to callers. */
export type GraphCapture = { readonly [graphCaptureBrand]: true; readonly nodes: number; readonly cachedNodes: number };
type CapturedGraph = { root: unknown; captured: Map<object, Captured>; frozenFrontier?: object[];
  nativeFields?: ReadonlyMap<object, readonly Readonly<Record<string, string>>[]>; eagerNativeHash?: boolean; hashable?: ReadonlySet<object> };
const captures = new WeakMap<GraphCapture, CapturedGraph>();

const nativeSelectorKeys = ['version', 'hash', 'levels', 'byEntity', 'assets'];
function hasHiddenNativeSelector(source: object): boolean {
  return nativeSelectorKeys.some(key => {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    return !!descriptor && !descriptor.enumerable;
  });
}
// Checkpoint-only advisory summaries: hidden selector (1), possible native
// selection (2), raw nonfinite value (4), unresolved ownership back-edge (8).
// Never reject or select/cache native text while codec validation is in flight.
function ownHashFlags(source: object, shape: Captured | ImmutableShape): number {
  if (shape.kind !== 'array' && hasHiddenNativeSelector(source)) return 1;
  return shape.kind === 'object' && shape.values[shape.keys.indexOf('version')] === 'entity-physics/1'
    && typeof shape.values[shape.keys.indexOf('hash')] === 'string'
    && (shape.values[shape.keys.indexOf('hash')] as string).length === 64 ? 2 : 0;
}
function frozenHashFlags(root: object): number {
  // This reads only admitted immutable shapes, without expanding graph ownership
  // or reference counts. A fresh memo prevents partial cyclic descendant proofs
  // from being reused as complete proofs for another frontier root.
  if (hashableImmutableShapes.has(root) && physicsFreeImmutableShapes.has(root)) return 0;
  const memo = new Map<object, number>();
  const visit = (value: unknown): number => {
    if (typeof value === 'number' && !Number.isFinite(value)) return 4;
    if (value === null || typeof value !== 'object') return 0;
    if (hashableImmutableShapes.has(value) && physicsFreeImmutableShapes.has(value)) return 0;
    const prior = memo.get(value);
    if (prior !== undefined) return prior < 0 ? 8 : prior;
    memo.set(value, -1);
    const shape = immutableShapes.get(value)!;
    let flags = ownHashFlags(value, shape);
    for (const child of shape.values) flags |= visit(child);
    memo.set(value, flags); return flags;
  };
  return visit(root);
}
/** Exceptional hidden metadata can run legacy getters and mutate the world.
 * The runtime must preserve its eager native hash position for these captures. */
export function checkpointNeedsEagerNativeHash(handle: GraphCapture): boolean {
  const state = captures.get(handle);
  if (!state) throw new TypeError('not a captured snapshot graph');
  return !!state.eagerNativeHash;
}

function assertHashableValue(value: unknown, shapeOf: (value: object) => Captured | ImmutableShape | undefined,
  trusted: (value: object) => boolean, remember: (value: object, physicsFree: boolean) => void,
  done = new Map<object, boolean>(), active = new Set<object>()): boolean {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`non-finite number in hashed state: ${value}`);
  if (value === null || typeof value !== 'object') return true;
  if (trusted(value)) return physicsFreeImmutableShapes.has(value);
  if (done.has(value)) return done.get(value)!;
  if (active.has(value)) throw new RangeError('cyclic value in canonical hash');
  const shape = shapeOf(value);
  if (!shape) throw new Error('captured hashability value has no owned shape');
  active.add(value);
  const version = Object.getOwnPropertyDescriptor(value, 'version'), hash = Object.getOwnPropertyDescriptor(value, 'hash');
  let physicsFree = shape.kind === 'array' || (!hasHiddenNativeSelector(value) && !(version && (!('value' in version) || version.value === 'entity-physics/1')
    && hash && (!('value' in hash) || (typeof hash.value === 'string' && hash.value.length === 64))));
  // Hashes ignore native Map/Set entries; the lossless codec still captures them.
  if (shape.kind === 'array' || shape.kind === 'object')
    for (const child of shape.values) physicsFree = assertHashableValue(child, shapeOf, trusted, remember, done, active) && physicsFree;
  active.delete(value); done.set(value, physicsFree); remember(value, physicsFree); return physicsFree;
}

/** Hash-domain proof without canonical wrappers or per-edge tuples. The done
 * set applies only to complete raw closures, never to a projected subset. */
function rawHashProof(state: CapturedGraph, mode: 'native' | 'contract' = 'native'): (value: unknown) => void {
  const done = new Set<object>(), active = new Set<object>();
  const visit = (value: unknown): void => {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(mode === 'native' ? `non-finite number in hashed state: ${value}` : 'stableStringify: non-finite number');
    if (value === null || typeof value !== 'object' || done.has(value) || state.hashable?.has(value)) return;
    const captured = state.captured.get(value), immutable = immutableShapes.get(value);
    if (captured?.hashFlags !== undefined && !(captured.hashFlags & 13)) return;
    if (hashableImmutableShapes.has(value) && (!captured ||
      (captured.kind !== 'map' && captured.kind !== 'set' && captured.values === immutable?.values))) return;
    if (active.has(value)) throw new RangeError('cyclic value in canonical hash');
    const shape = captured ?? immutable;
    if (!shape) throw new Error('captured hashability value has no owned shape');
    active.add(value);
    if (shape.kind === 'array' || shape.kind === 'object') for (const child of shape.values) visit(child);
    active.delete(value); done.add(value);
  };
  return visit;
}

/** Preserve eager hash-domain rejection before a deferred checkpoint is published.
 * Walk captured children only; privately proven frozen closures need no repeat scan. */
export function assertCapturedHashable(handle: GraphCapture, path: readonly string[]): void {
  prepareHashable(handle, path, false);
}
function prepareHashable(handle: GraphCapture, path: readonly string[], pinNativePhysics: boolean): void {
  const state = captures.get(handle);
  if (!state) throw new TypeError('not a captured snapshot graph');
  const shapeOf = (source: object) => state.captured.get(source) ?? immutableShapes.get(source);
  let value = state.root;
  for (const key of path) {
    const shape = value !== null && typeof value === 'object' ? shapeOf(value) : undefined;
    if (!shape || shape.kind !== 'object') throw new TypeError('captured hash path is not an object');
    value = shape.values[shape.keys.indexOf(key)];
  }
  const trusted = (source: object) => {
    const captured = state.captured.get(source), immutable = immutableShapes.get(source);
    // A mutable node admitted after capture must retain its original captured values.
    return hashableImmutableShapes.has(source) && (!pinNativePhysics || physicsFreeImmutableShapes.has(source))
      && (!captured || (captured.kind !== 'map' && captured.kind !== 'set' && captured.values === immutable?.values));
  };
  if (!pinNativePhysics) { rawHashProof(state)(value); return; }
  // Inspect descriptors only, before any legacy selector/cache operation. A
  // hidden selector value may itself be a getter or an uncaptured object graph;
  // the existing eager serializer owns all such exceptional semantics.
  // Bit 1 requires the compatibility fallback; bit 2 means cache selection
  // can occur below; bit 4 marks a raw nonfinite/cyclic closure. Inspection never
  // throws a hash-domain error ahead of earlier legacy cache-selection effects.
  const selectorFlags = new Map<object, number>(), hashable = new Set<object>();
  const inspect = (value: unknown): number => {
    if (typeof value === 'number' && !Number.isFinite(value)) return 4;
    if (value === null || typeof value !== 'object' || trusted(value)) return 0;
    const prior = selectorFlags.get(value);
    if (prior !== undefined) return prior < 0 ? 6 : prior;
    selectorFlags.set(value, -1);
    const shape = shapeOf(value);
    if (!shape) throw new Error('captured hashability value has no owned shape');
    if (shape.kind !== 'array' && hasHiddenNativeSelector(value)) { selectorFlags.set(value, 1); return 1; }
    let flags = shape.kind === 'object' && shape.values[shape.keys.indexOf('version')] === 'entity-physics/1'
      && typeof shape.values[shape.keys.indexOf('hash')] === 'string'
      && (shape.values[shape.keys.indexOf('hash')] as string).length === 64 ? 2 : 0;
    if (shape.kind === 'array' || shape.kind === 'object') for (const child of shape.values) {
      flags |= inspect(child); if (flags & 1) break;
    }
    selectorFlags.set(value, flags);
    if (!(flags & 5)) hashable.add(value);
    return flags;
  };
  const fusedFlags = value !== null && typeof value === 'object' ? state.captured.get(value)?.hashFlags
    : typeof value === 'number' && !Number.isFinite(value) ? 4 : 0;
  // An ownership back-edge can precede a later hidden-selector sibling. Its
  // incomplete summary must never certify the selected root: retain the exact
  // descriptor inspection above for that case (and non-checkpoint captures).
  const useFused = fusedFlags !== undefined && !(fusedFlags & 8);
  if ((useFused ? fusedFlags : inspect(value)) & 1) { state.eagerNativeHash = true; return; }
  if (!useFused) state.hashable = hashable;
  const nativeFields = new Map<object, Readonly<Record<string, string>>[]>();
  const active = new Set<object>();
  const visit = (value: unknown): boolean => {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`non-finite number in hashed state: ${value}`);
    if (value === null || typeof value !== 'object') return true;
    if (trusted(value)) return true;
    if ((useFused ? state.captured.get(value)?.hashFlags : selectorFlags.get(value)) === 0) return true;
    if (active.has(value)) throw new RangeError('cyclic value in canonical hash');
    const shape = shapeOf(value);
    if (!shape) throw new Error('captured hashability value has no owned shape');
    active.add(value);
    // Selection is a synchronous legacy operation. Its cache effects follow the
    // exact lexical DFS, including repeated aliases separated by cache eviction.
    // Only strings survive this boundary; every completion owns its own cursor.
    const selected = shape.kind === 'array' ? undefined : selectPhysicsTextForCapture(value as Record<string, unknown>);
    if (selected) {
      const occurrences = nativeFields.get(value) ?? [];
      occurrences.push(selected); nativeFields.set(value, occurrences);
    }
    let free = !selected;
    if (shape.kind === 'array') {
      for (const child of shape.values) free = visit(child) && free;
    } else if (shape.kind === 'object') {
      const order = shape.keys.map((key, index) => ({ key, index })).filter(({ index }) => shape.values[index] !== undefined)
        .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
      for (const { key, index } of order)
        if (!selected || !Object.hasOwn(selected, key)) free = visit(shape.values[index]) && free;
    }
    active.delete(value);
    return free;
  };
  visit(value);
  state.nativeFields = nativeFields;
}

declare const canonicalNodeBrand: unique symbol;
/** Opaque owned value for canonical hashing/projection. No live identity or child array escapes. */
export type CanonicalNode = { readonly [canonicalNodeBrand]: true };
export type CanonicalValue = null | undefined | number | string | boolean | CanonicalNode;
type CanonicalShape = { kind: 'array' | 'object'; keys: readonly string[]; value(index: number): CanonicalValue;
  nativeFields?: readonly Readonly<Record<string, string>>[]; captureState?: CapturedGraph; source?: object };
const canonicalNodes = new WeakMap<CanonicalNode, CanonicalShape>();
function canonicalNode(shape: CanonicalShape): CanonicalNode {
  const node = Object.freeze({}) as CanonicalNode;
  canonicalNodes.set(node, shape); return node;
}
export function canonicalKind(value: CanonicalValue): 'array' | 'object' | 'primitive' {
  return value !== null && typeof value === 'object' ? canonicalNodes.get(value)!.kind : 'primitive';
}
export function* canonicalEntries(value: CanonicalValue): Generator<[string, CanonicalValue], void, void> {
  if (value === null || typeof value !== 'object') throw new TypeError('canonical value is not a container');
  const shape = canonicalNodes.get(value);
  if (!shape) throw new TypeError('not an owned canonical value');
  for (let i = 0; i < shape.keys.length; i++) yield [shape.keys[i], shape.value(i)];
}
export function canonicalGet(value: CanonicalValue, key: string): CanonicalValue {
  for (const [k, child] of canonicalEntries(value)) if (k === key) return child;
  return undefined;
}
/** Synthetic projection containers own their entry lists; children remain opaque owned values. */
export function canonicalObject(entries: Iterable<readonly [string, CanonicalValue]>): CanonicalNode {
  const list = [...entries].map(([key, value]) => [key, value] as const);
  return canonicalNode({ kind: 'object', keys: list.map(([key]) => key), value: i => list[i][1] });
}
export function canonicalArray(values: Iterable<CanonicalValue>): CanonicalNode {
  const list = [...values];
  return canonicalNode({ kind: 'array', keys: list.map((_, i) => String(i)), value: i => list[i] });
}
/** Hash-domain proof for a synthetic captured projection (not its native cached-text view). */
export function assertCanonicalHashable(root: CanonicalValue): void {
  const done = new Set<CanonicalNode>(), active = new Set<CanonicalNode>();
  const visit = (value: CanonicalValue): void => {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('stableStringify: non-finite number');
    if (value === null || typeof value !== 'object' || done.has(value)) return;
    if (active.has(value)) throw new RangeError('cyclic value in canonical hash');
    active.add(value);
    for (const [, child] of canonicalEntries(value)) visit(child);
    active.delete(value); done.add(value);
  };
  visit(root);
}
/** A projection replaces its intermediate containers. Only its selected raw
 * leaves need hash-domain proof; an omitted subset must never certify its source
 * object's whole closure. This plan contains no callbacks or live references. */
export type CanonicalHashProjection =
  | { fields: readonly (readonly [string, CanonicalHashProjection?])[] }
  | { values: CanonicalHashProjection; skip?: readonly string[] }
  | { omit: readonly string[] };
export function assertCanonicalProjectionHashable(root: CanonicalValue, projection: CanonicalHashProjection): void {
  const origin = root !== null && typeof root === 'object' ? canonicalNodes.get(root) : undefined;
  if (!origin?.captureState || !origin.source) throw new TypeError('projection proof requires an owned captured root');
  const state = origin.captureState, prove = rawHashProof(state, 'contract');
  const selected = (value: unknown, plan: CanonicalHashProjection): void => {
    if (value === null || typeof value !== 'object') throw new TypeError('canonical value is not a container');
    const shape = state.captured.get(value) ?? immutableShapes.get(value);
    if (!shape) throw new Error('captured projection value has no owned shape');
    const values = shape.kind === 'object' || shape.kind === 'array' ? shape.values : [];
    if ('fields' in plan) {
      for (const [key, childPlan] of plan.fields) {
        const index = shape.kind === 'object' ? shape.keys.indexOf(key) : shape.kind === 'array' && /^(0|[1-9][0-9]*)$/.test(key) ? Number(key) : -1;
        const child = values[index];
        if (childPlan) selected(child, childPlan); else prove(child);
      }
    } else for (let i = 0; i < values.length; i++) {
      const key = shape.kind === 'object' ? shape.keys[i] : String(i);
      if ('values' in plan) { if (!plan.skip?.includes(key)) selected(values[i], plan.values); }
      else if (!plan.omit.includes(key)) prove(values[i]);
    }
  };
  selected(origin.source, projection);
}

/** Read only the captured tables, including the privately admitted frozen closure.
 * A later admission cannot replace an originally mutable captured node. */
export function capturedCanonicalRoot(handle: GraphCapture): CanonicalValue {
  const state = captures.get(handle);
  if (!state) throw new TypeError('not a captured snapshot graph');
  const memo = new Map<object, CanonicalNode>();
  const wrap = (value: unknown): CanonicalValue => {
    if (value === null || typeof value !== 'object') return value as CanonicalValue;
    const prior = memo.get(value); if (prior) return prior;
    const shape = state.captured.get(value) ?? immutableShapes.get(value);
    if (!shape) throw new Error('captured canonical value has no owned shape');
    // Legacy canonical hashes see Map/Set as empty ordinary objects, independently
    // of the graph codec's lossless Map/Set encoding.
    const keys = shape.kind === 'object' ? shape.keys : shape.kind === 'array' ? shape.values.map((_, i) => String(i)) : [];
    const node = canonicalNode({ kind: shape.kind === 'array' ? 'array' : 'object', keys, nativeFields: state.nativeFields?.get(value), captureState: state, source: value,
      value: i => wrap(shape.kind === 'object' || shape.kind === 'array' ? shape.values[i] : undefined) });
    memo.set(value, node); return node;
  };
  return wrap(state.root);
}

/** Canonical JSON token writer over owned shapes. Native hashes sort keys directly;
 * contract hashes emulate sortValue's ordinary-object assignment followed by JSON:
 * integer keys enumerate numerically and __proto__ never becomes an own property.
 * Reference aliases repeat their value; an ancestor cycle is not hashable. */
export function* canonicalTextSteps(root: CanonicalValue, mode: 'native' | 'contract', maxWork = 256): Generator<string | void, void, void> {
  yield* writeCanonicalSteps(root, mode, maxWork, new Set());
}
function* writeCanonicalSteps(root: CanonicalValue, mode: 'native' | 'contract', maxWork: number, ancestors: Set<CanonicalNode>): Generator<string | void, void, void> {
  if (!Number.isSafeInteger(maxWork) || maxWork < 1) throw new RangeError('canonical work limit must be a positive safe integer');
  if (mode === 'contract' && root === undefined) throw new TypeError('undefined has no contract canonical JSON');
  type Entry = [string, CanonicalValue];
  type Frame = { node: CanonicalNode; entries: Entry[]; index: number; array: boolean; nativeFields?: Readonly<Record<string, string>> };
  const occurrences = new Map<CanonicalNode, number>();
  const stack: Frame[] = [];
  let work = 0, pending: CanonicalValue = root, hasPending = true, text = '';
  const integerKey = (key: string): number | undefined => {
    const n = Number(key); return Number.isInteger(n) && n >= 0 && n < 4294967295 && String(n) === key ? n : undefined;
  };
  const compare = (a: Entry, b: Entry) => {
    if (mode === 'contract') {
      const ai = integerKey(a[0]), bi = integerKey(b[0]);
      if (ai !== undefined || bi !== undefined) return ai === undefined ? 1 : bi === undefined ? -1 : ai - bi;
    }
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  };
  while (hasPending || stack.length) {
    if (hasPending) {
      const value = pending; hasPending = false;
      if (value === null || typeof value !== 'object') {
        if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(mode === 'native' ? `non-finite number in hashed state: ${value}` : 'stableStringify: non-finite number');
        text += JSON.stringify(Object.is(value, -0) ? 0 : value) ?? 'null';
      } else {
        if (ancestors.has(value)) throw new RangeError('cyclic value in canonical hash');
        ancestors.add(value);
        const array = canonicalKind(value) === 'array';
        const choices = mode === 'native' ? canonicalNodes.get(value)?.nativeFields : undefined;
        const occurrence = occurrences.get(value) ?? 0;
        const nativeFields = choices?.[occurrence];
        if (choices) {
          if (!nativeFields) throw new Error('captured native occurrence mismatch');
          occurrences.set(value, occurrence + 1);
        }
        let entries: Entry[] = [];
        for (const entry of canonicalEntries(value)) {
          // Contract sortValue traverses even a dropped __proto__ value, so its
          // nonfinite/cycle errors must not be hidden. It is handled below.
          if (array || entry[1] !== undefined) entries.push(entry);
          if (++work >= maxWork) { work = 0; yield; }
        }
        if (!array) {
          // Tiny native sorts have a fixed bound. Larger flat objects use sliced
          // merge sorting, rather than one unbounded builtin sort in a next call.
          if (entries.length <= 64) entries.sort(compare);
          for (let width = 1; entries.length > 64 && width < entries.length; width *= 2) {
            const next: Entry[] = [];
            for (let base = 0; base < entries.length; base += width * 2) {
              let left = base, right = Math.min(base + width, entries.length);
              const mid = right, end = Math.min(base + width * 2, entries.length);
              while (left < mid || right < end) {
                next.push(right >= end || (left < mid && compare(entries[left], entries[right]) <= 0) ? entries[left++] : entries[right++]);
                if (++work >= maxWork) { work = 0; yield; }
              }
            }
            entries = next;
          }
          if (mode === 'contract') {
            const proto = entries.find(([key]) => key === '__proto__');
            if (proto) {
              // Validate the discarded subtree using the same writer. Its output
              // is intentionally discarded, matching ordinary-object assignment.
              if (proto[1] === value) throw new RangeError('cyclic value in canonical hash');
              for (const token of writeCanonicalSteps(proto[1], mode, maxWork, ancestors)) if (token === undefined) yield;
              entries = entries.filter(([key]) => key !== '__proto__');
            }
          }
        }
        text += array ? '[' : '{'; stack.push({ node: value, entries, index: 0, array, nativeFields });
      }
    } else {
      const frame = stack[stack.length - 1];
      if (frame.index === frame.entries.length) {
        text += frame.array ? ']' : '}'; ancestors.delete(frame.node); stack.pop();
      } else {
        const [key, value] = frame.entries[frame.index];
        if (frame.index++) text += ',';
        if (!frame.array) text += JSON.stringify(key) + ':';
        const pinned = frame.nativeFields && Object.hasOwn(frame.nativeFields, key) ? frame.nativeFields[key] : undefined;
        if (pinned !== undefined) {
          if (text) { yield text; text = ''; }
          for (let at = 0; at < pinned.length;) {
            let end = Math.min(at + 65536, pinned.length);
            const last = pinned.charCodeAt(end - 1), next = pinned.charCodeAt(end);
            if (end < pinned.length && last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end--;
            yield pinned.slice(at, end); at = end; yield;
          }
        } else { pending = value; hasPending = true; }
      }
    }
    // Whole JSON tokens preserve UTF-8 semantics across native digest updates.
    if (text.length >= 65536) { yield text; text = ''; }
    if (++work >= maxWork) { work = 0; yield; }
  }
  if (text) yield text;
}

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

/** Own mutable data now, but leave already-admitted immutable closures for
 * completion-local reference counting. The counters describe only nodes visited
 * at this boundary; eager captureGraph retains its complete-graph counters.
 * No source properties are read after return, including inside frozen closures. */
export function captureGraphDeferred(root: unknown, rootPath = '$', skipMapValues: ReadonlySet<object> = new Set()): GraphCapture {
  return capture(root, rootPath, skipMapValues, false, true);
}

/** Native checkpoint-only boundary: capture first, then pin the legacy hash's
 * selected physics strings and reject its unhashable domain before returning.
 * A descriptor-only compatibility predicate may request eager hashing instead.
 * Decide that before any pin/cache effect; the runtime performs the actual eager
 * hash later at its original metadata expression. The predicate is never retained. */
export function captureGraphForCheckpoint(root: unknown, hashPath: readonly string[], rootPath = '$', skipMapValues: ReadonlySet<object> = new Set(), eagerHashRequired?: () => boolean): GraphCapture {
  const handle = capture(root, rootPath, skipMapValues, false, true, true);
  if (eagerHashRequired?.()) captures.get(handle)!.eagerNativeHash = true;
  else prepareHashable(handle, hashPath, true);
  return handle;
}

function capture(root: unknown, rootPath: string, skipMapValues: ReadonlySet<object>, admission: boolean, deferFrozen = false, checkpointProof = false): GraphCapture {
  // Pass 1 validates and captures each object's children once, and counts references.
  // Pass 2 reads only these captured values: no getters, source iterators or second source traversal.
  const captured = new Map<object, Captured>();
  const frozenFrontier: object[] = [];
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
  const visit = (v: unknown, key?: string | number, kind: PathKind = 'property'): number => {
    const type = typeof v;
    if (v === null || type === 'number' || type === 'string' || type === 'boolean' || type === 'undefined')
      return checkpointProof && type === 'number' && !Number.isFinite(v) ? 4 : 0;
    const known = typeof v === 'object' ? captured.get(v) : undefined;
    if (known) { known.refs++; return checkpointProof ? known.hashFlags ?? 8 : 0; }
    const immutable = typeof v === 'object' ? immutableShapes.get(v) : undefined;
    if (immutable) {
      const node: Captured = { ...immutable, refs: 1 };
      captured.set(v as object, node);
      cachedNodes++;
      // Admission already proves the whole closure. Deferred capture records
      // mutable-to-frozen incoming edges now; completion counts frozen edges
      // before assigning any reference IDs. Eager capture counts everything now.
      if (admission) return 0;
      if (deferFrozen) {
        frozenFrontier.push(v as object);
        if (checkpointProof) {
          node.hashFlags = frozenHashFlags(v as object);
        }
        return node.hashFlags ?? 0;
      }
      // Its entire enumerable closure was validated and frozen at admission.
      // Still traverse every edge for THIS graph's aliases, counts and ID order.
      // No diagnostic paths are needed: descendants cannot become unsupported.
      for (const value of immutable.values) visit(value);
      return 0;
    }
    // Keep one recursive frame per graph edge, as before lazy paths. Primitive
    // leaves and already-captured aliases do not need path bookkeeping at all.
    if (key !== undefined) { pathKeys.push(key); pathKinds.push(kind); }
    if (typeof v !== 'object' || v === null) throw new CodecError(path(), `a ${type}`);
    rejectSymbolKeys(v, path);
    let node: Captured, flags = 0;
    if (Array.isArray(v)) {
      const values: unknown[] = [], length = v.length;
      for (const key of Object.keys(v)) {
        const index = Number(key);
        if (!Number.isInteger(index) || index < 0 || index >= length || String(index) !== key)
          throw new CodecError(path(key), 'an extra array property');
      }
      for (let i = 0; i < length; i++) values.push(dataValue(v, String(i), path));
      node = { kind: 'array', refs: 1, values }; captured.set(v, node);
      for (let i = 0; i < values.length; i++) flags |= visit(values[i], i);
    } else if (v instanceof Map) {
      const extra = Object.keys(v)[0];
      if (extra !== undefined) throw new CodecError(path(extra), 'an extra Map property');
      const entries: [unknown, unknown][] = [];
      // Native iteration bypasses user-defined iterators and never coerces object keys for a path.
      for (const [key, value] of Map.prototype.entries.call(v))
        if (!(typeof value === 'object' && value !== null && skipMapValues.has(value))) entries.push([key, value]);
      node = { kind: 'map', refs: 1, entries }; captured.set(v, node);
      if (checkpointProof) flags = ownHashFlags(v, node);
      for (let i = 0; i < entries.length; i++) {
        visit(entries[i][0], i, 'map key');
        visit(entries[i][1], i, 'map value');
      }
    } else if (v instanceof Set) {
      const extra = Object.keys(v)[0];
      if (extra !== undefined) throw new CodecError(path(extra), 'an extra Set property');
      const values: unknown[] = [...Set.prototype.values.call(v)];
      node = { kind: 'set', refs: 1, values }; captured.set(v, node);
      if (checkpointProof) flags = ownHashFlags(v, node);
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
      node = { kind: 'object', refs: 1, keys, values, tilde }; captured.set(v, node);
      if (checkpointProof) flags = ownHashFlags(v, node);
      for (let i = 0; i < keys.length; i++) flags |= visit(values[i], keys[i]);
    }
    if (checkpointProof) {
      node.hashFlags = flags;
    }
    if (key !== undefined) { pathKeys.pop(); pathKinds.pop(); }
    return flags;
  };
  visit(root);
  const handle = Object.freeze({ nodes: captured.size, cachedNodes }) as GraphCapture;
  captures.set(handle, { root, captured, ...(frozenFrontier.length ? { frozenFrontier } : {}) });
  return handle;
}

/** Each completion owns its overlay. Initialize every boundary's incoming count
 * before following frozen edges, then expand each node exactly once. An admitted
 * closure has no mutable descendants, Maps or Sets. Only private cached shapes
 * are read; source identities are keys, never objects to inspect dynamically. */
function* expandFrozenSteps(state: CapturedGraph, maxWork: number): Generator<void, { frozen: ReadonlyMap<object, Captured>; work: number }, void> {
  type FrozenCaptured = { refs: number } & ImmutableShape;
  const frozen = new Map<object, FrozenCaptured>();
  const stack: { node: FrozenCaptured; index: number }[] = [];
  let work = 0;
  for (const source of state.frozenFrontier!) {
    const node = { ...state.captured.get(source)! } as FrozenCaptured;
    frozen.set(source, node); stack.push({ node, index: 0 });
    if (++work === maxWork) { work = 0; yield; }
  }
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.index === frame.node.values.length) stack.pop();
    else {
      const value = frame.node.values[frame.index++];
      if (typeof value === 'object' && value !== null) {
        const known = frozen.get(value);
        if (known) known.refs++;
        else {
          const shape = immutableShapes.get(value);
          if (!shape) throw new Error('admitted snapshot closure has an uncached descendant');
          const node = { ...shape, refs: 1 };
          frozen.set(value, node); stack.push({ node, index: 0 });
        }
      }
    }
    // Carry the partial quantum into emission, so a next() call cannot spend a
    // full budget on the end of expansion and another full budget on emission.
    if (++work === maxWork) { work = 0; yield; }
  }
  return { frozen, work };
}

/** Emit a fresh owned JSON tree with the existing marker/reference order. This
 * may run later or repeatedly; neither source mutation nor output mutation can
 * change a captured graph. The handle is not a worker transport format. */
export function finishGraph(handle: GraphCapture): unknown {
  const state = captures.get(handle);
  if (!state) throw new TypeError('not a captured snapshot graph');
  const { root, captured } = state;
  let frozen: ReadonlyMap<object, Captured> | undefined;
  if (state.frozenFrontier) {
    const expansion = expandFrozenSteps(state, Number.MAX_SAFE_INTEGER);
    let result = expansion.next();
    while (!result.done) result = expansion.next();
    frozen = result.value.frozen;
  }
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
    const node = frozen?.get(v) ?? captured.get(v)!;
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

/** Iterative depth-first emission with bounded work between yields. One work
 * unit handles one child edge (including each Map key/value separately) or
 * retires one frame. Large flat collections therefore yield too. Each iterator
 * owns its output and reference IDs; finishGraph can independently materialize
 * the same capture while an iterator is suspended. */
export function* finishGraphSteps(handle: GraphCapture, maxWork = 256): Generator<void, unknown, void> {
  if (!Number.isSafeInteger(maxWork) || maxWork < 1) throw new RangeError('snapshot emission work limit must be a positive safe integer');
  const state = captures.get(handle);
  if (!state) throw new TypeError('not a captured snapshot graph');
  let frozen: ReadonlyMap<object, Captured> | undefined, work = 0;
  if (state.frozenFrontier) {
    const prepared = yield* expandFrozenSteps(state, maxWork);
    frozen = prepared.frozen; work = prepared.work;
  }
  type Frame = { node: Captured; output: unknown[] | Record<string, unknown>; index: number };
  const stack: Frame[] = [], ids = new Map<object, number>();
  let nextId = 0;
  const emit = (value: unknown): unknown => {
    if (value === undefined) return { '~u': 1 };
    if (typeof value === 'number') {
      if (Number.isNaN(value)) return { '~n': 'NaN' };
      if (value === Infinity) return { '~n': 'Infinity' };
      if (value === -Infinity) return { '~n': '-Infinity' };
      if (Object.is(value, -0)) return { '~n': '-0' };
      return value;
    }
    if (value === null || typeof value !== 'object') return value;
    const id = ids.get(value);
    if (id !== undefined) return { '~r': id };
    const node = frozen?.get(value) ?? state.captured.get(value)!;
    const shared = node.refs > 1, myId = shared ? nextId++ : -1;
    if (shared) ids.set(value, myId);
    const output: unknown[] | Record<string, unknown> = node.kind === 'object' && !node.tilde ? {} : [];
    const body = node.kind === 'set' ? { '~set': output } : node.kind === 'map' ? { '~map': output }
      : node.kind === 'object' && node.tilde ? { '~o': output } : output;
    stack.push({ node, output, index: 0 });
    return shared ? { '~id': myId, '~v': body } : body;
  };
  const result = emit(state.root);
  while (stack.length) {
    const frame = stack[stack.length - 1], { node, output } = frame;
    const length = node.kind === 'map' ? node.entries.length * 2 : node.values.length;
    if (frame.index === length) stack.pop();
    else {
      const i = frame.index++;
      if (node.kind === 'map') {
        const out = output as unknown[][], entry = node.entries[Math.floor(i / 2)];
        if (i % 2 === 0) out.push([emit(entry[0])]);
        else out[out.length - 1].push(emit(entry[1]));
      } else if (node.kind === 'object') {
        if (node.tilde) (output as unknown[]).push([node.keys[i], emit(node.values[i])]);
        else putOwn(output as Record<string, unknown>, node.keys[i], emit(node.values[i]));
      } else (output as unknown[]).push(emit(node.values[i]));
    }
    if (++work === maxWork && stack.length) { work = 0; yield; }
  }
  return result;
}

const KEY_LISTS = new Map<string, string[]>();
function sharedKeys(keys: string[]): string[] {
  const id = JSON.stringify(keys), hit = KEY_LISTS.get(id);
  if (hit) return hit;
  if (KEY_LISTS.size < 4096) KEY_LISTS.set(id, keys);
  return keys;
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
    // L4 #7: an admitted array is its own value list (frozen, dense, data properties only: exactly what capture read),
    // and objects of one key list share it (an obb's c/half/yaw, a surface's id/level/obb/y): these shadows were a second
    // copy of every node of the entity physics (~34 MB on Eden 2026). Both are only ever read.
    if (node.kind === 'array') immutableShapes.set(source, { kind: 'array', values: source as unknown[] });
    else if (node.kind === 'object') immutableShapes.set(source, { kind: 'object', keys: sharedKeys(node.keys), values: node.values, tilde: node.tilde });
  }
  // Admission itself still accepts codec-valid cycles/nonfinite values. Only the
  // proven finite acyclic closures receive the optional hashability shortcut.
  try {
    assertHashableValue(root, source => immutableShapes.get(source), source => hashableImmutableShapes.has(source), (source, physicsFree) => {
      hashableImmutableShapes.add(source); if (physicsFree) physicsFreeImmutableShapes.add(source);
    });
  } catch (error) {
    if (!(error instanceof RangeError) && !(error instanceof Error && error.message.startsWith('non-finite number'))) throw error;
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
