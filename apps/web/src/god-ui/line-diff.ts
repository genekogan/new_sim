// GOVERN (lane C17): what changed in the constitution since a visitor's last visit, line by line. Pure (node --test).
export type DiffLine = { kind: 'same' | 'added' | 'removed'; text: string };
/** A line diff (LCS) of two texts. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split('\n'), b = after.split('\n'), n = a.length, m = b.length;
  if (n * m > 400_000) return [...a.map((text) => ({ kind: 'removed' as const, text })), ...b.map((text) => ({ kind: 'added' as const, text }))];
  const L: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ kind: 'same', text: a[i] }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push({ kind: 'removed', text: a[i++] });
    else out.push({ kind: 'added', text: b[j++] });
  }
  while (i < n) out.push({ kind: 'removed', text: a[i++] });
  while (j < m) out.push({ kind: 'added', text: b[j++] });
  return out;
}
/** Only the changed lines, with the nearest non-blank unchanged line on each side as context; the rest collapses. */
export function changedOnly(d: DiffLine[]): (DiffLine | { kind: 'gap' })[] {
  const keep = d.map((x) => x.kind !== 'same');
  const context = (i: number, step: number) => { for (let k = i + step; k >= 0 && k < d.length && d[k].kind === 'same'; k += step) if (d[k].text.trim()) { keep[k] = true; return; } };
  d.forEach((x, i) => { if (x.kind !== 'same') { context(i, -1); context(i, 1); } });
  if (!keep.some(Boolean)) return [];
  const out: (DiffLine | { kind: 'gap' })[] = [];
  d.forEach((x, i) => {
    if (keep[i]) { if (x.kind !== 'same' || x.text.trim()) out.push(x); }
    else if (x.text.trim() && out[out.length - 1]?.kind !== 'gap') out.push({ kind: 'gap' });
  });
  while (out.length && out[out.length - 1].kind === 'gap') out.pop();
  return out;
}
