// Explicit sort orders (lint: typescript/require-array-sort-compare).

/** `Array#sort`'s own order when no comparator is given (ECMAScript SortCompare): compare `String(x)` by UTF-16
 *  code units. Pass it where a sort relied on the default so the order stays bit-identical and the intent is
 *  explicit — e.g. `[key, value]` tuples sort by their joined string, which is not always key order. */
export function defaultSortOrder(a: unknown, b: unknown): number {
  const x = String(a), y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
