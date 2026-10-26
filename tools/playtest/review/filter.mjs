// The Reviewer must describe, never diagnose (spec §2.7). Anything that reads as a cause in the code, a code area or a
// fix is stripped sentence by sentence, and the record is flagged leaked:true with what was removed.
export const FORBIDDEN = [
  { rule: 'path', re: /(?:^|[\s(`'"])(?:\.{0,2}\/)?(?:[\w.-]+\/)+[\w.-]+\.\w{1,5}\b|(?:^|\s)\/(?:[\w.-]+\/)+[\w.-]*/ },
  { rule: 'source-ext', re: /\.(?:tsx?|mjs|cjs|jsx?)\b/i },
  { rule: 'fix', re: /\bfix(?:es|ed|ing)?\b/i },
  { rule: 'should-implement', re: /\bshould (?:implement|add|change|refactor|patch|rewrite)\b|\bimplement(?:ed|ing|ation)?\b/i },
  { rule: 'code', re: /\bcode(?:base|path)?\b/i },
  { rule: 'server-side', re: /\bserver[- ]side\b|\bclient[- ]side\b/i },
  { rule: 'function-name', re: /\b[a-z]+(?:[A-Z][a-z0-9]+)+\b|\b[A-Za-z_]\w*\(\)/ },
];
/** Fields that quote the player or point at evidence: never rewritten. */
export const EXEMPT = new Set(['asked', 'personaWording', 'wordings', 'evidence', 'repro', 'requestIds', 'pointers', 'id', 'inputDepth', 'fidelity', 'class']);

export function scrubText(s) {
  if (typeof s !== 'string') return { value: s, hits: [] };
  const hits = []; const parts = s.split(/(?<=[.!?;])\s+/);
  const kept = parts.filter((p) => { const bad = FORBIDDEN.filter((f) => f.re.test(p)); if (bad.length) hits.push({ rules: bad.map((b) => b.rule), text: p.slice(0, 200) }); return !bad.length; });
  return { value: hits.length ? (kept.join(' ').trim() || '[removed: diagnostic content]') : s, hits };
}

/** Deep-scrub prose fields; returns {value, leaked, hits:[{field, rules, text}]}. */
export function scrub(obj, path = '') {
  const hits = [];
  const walk = (v, p, key) => {
    if (EXEMPT.has(key)) return v;
    if (typeof v === 'string') { const r = scrubText(v); r.hits.forEach((h) => hits.push({ field: p, ...h })); return r.value; }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${p}[${i}]`, key));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, p ? `${p}.${k}` : k, k)]));
    return v;
  };
  const value = walk(obj, path, null);
  return { value, leaked: hits.length > 0, hits };
}
