/** Test-only work meter (lane Z3). Performance tests assert budgets on the work a block does instead of on wall-clock
 *  milliseconds, so they give the same answer on a laptop and on a loaded shared CPU. While `meter(fn)` runs it counts:
 *  - sql / rows: node:sqlite statements executed and the rows they returned or changed;
 *  - reads / writes: Map and Set get/has and set/add/delete calls;
 *  - steps: Map and Set iteration steps (for..of, spread, values()/keys()/entries(), forEach);
 *  - scans: elements visited by the Array iteration methods (forEach, map, filter, find, some, every, reduce, sort, ...).
 *  Native copies (`new Map(other)`) and plain `for..of` over arrays are not counted. The block must be synchronous:
 *  everything else the process does while it runs would be counted too. Never imported by product code. */
import { DatabaseSync, StatementSync } from 'node:sqlite';

export type Work = { sql: number; rows: number; reads: number; writes: number; steps: number; scans: number; total: number };
const zero = (): Work => ({ sql: 0, rows: 0, reads: 0, writes: 0, steps: 0, scans: 0, total: 0 });
const c = zero();
let depth = 0, restore: (() => void) | null = null;

const iterProto = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
function counted<T>(it: Iterator<T>): Iterator<T> {
  const w = Object.create(iterProto);
  w.next = () => { const r = it.next(); if (!r.done) c.steps++; return r; };
  w.return = (v?: unknown) => ({ done: true, value: v });
  return w;
}
type Patch = [object, PropertyKey, (orig: any) => any];
const ARRAY = ['forEach', 'map', 'filter', 'find', 'findIndex', 'findLast', 'findLastIndex', 'some', 'every', 'reduce', 'reduceRight', 'flatMap', 'includes', 'indexOf', 'lastIndexOf', 'sort', 'toSorted'] as const;
const patches: Patch[] = [
  ...[Map.prototype, Set.prototype].flatMap(p => [
    ...(['get', 'has'] as const).filter(k => k in p).map((k): Patch => [p, k, o => function (this: any, ...a: any[]) { c.reads++; return o.apply(this, a); }]),
    ...(['set', 'add', 'delete'] as const).filter(k => k in p).map((k): Patch => [p, k, o => function (this: any, ...a: any[]) { c.writes++; return o.apply(this, a); }]),
    ...(['keys', 'values', 'entries', Symbol.iterator] as const).map((k): Patch => [p, k, o => function (this: any) { return counted(o.call(this)); }]),
    [p, 'forEach', o => function (this: any, ...a: any[]) { c.steps += this.size; return o.apply(this, a); }] as Patch,
  ]),
  ...ARRAY.map((k): Patch => [Array.prototype, k, o => function (this: any, ...a: any[]) { c.scans += this.length >>> 0; return o.apply(this, a); }]),
  ...(['run', 'get', 'all'] as const).map((k): Patch => [StatementSync.prototype, k, o => function (this: any, ...a: any[]) {
    c.sql++; const r = o.apply(this, a);
    c.rows += k === 'all' ? r.length : k === 'get' ? (r === undefined ? 0 : 1) : Number(r.changes);
    return r;
  }]),
  [StatementSync.prototype, 'iterate', o => function (this: any, ...a: any[]) {
    c.sql++; const it = o.apply(this, a), w = Object.create(iterProto);
    w.next = () => { const r = it.next(); if (!r.done) c.rows++; return r; }; w.return = (v?: unknown) => { it.return?.(); return { done: true, value: v }; };
    return w;
  }],
  [DatabaseSync.prototype, 'exec', o => function (this: any, ...a: any[]) { c.sql++; return o.apply(this, a); }],
];
function install() {
  const saved = patches.map(([obj, key, wrap]) => { const orig = (obj as any)[key]; Object.defineProperty(obj, key, { value: wrap(orig), writable: true, configurable: true }); return [obj, key, orig] as const; });
  return () => { for (const [obj, key, orig] of saved.reverse()) Object.defineProperty(obj, key, { value: orig, writable: true, configurable: true }); };
}

/** Run `fn` synchronously and return its result together with the work it did. */
export function meter<T>(fn: () => T): { value: T; work: Work } {
  const before = { ...c };
  if (depth++ === 0) restore = install();
  let value: T;
  try { value = fn(); if (value instanceof Promise) throw new Error('meter: the block must be synchronous'); }
  finally { if (--depth === 0) { restore!(); restore = null; } }
  const work = zero();
  for (const k of ['sql', 'rows', 'reads', 'writes', 'steps', 'scans'] as const) work[k] = c[k] - before[k];
  work.total = work.sql + work.rows + work.reads + work.writes + work.steps + work.scans;
  return { value, work };
}
/** The work `fn` does, without its result. */
export const work = (fn: () => unknown): Work => meter(fn).work;
