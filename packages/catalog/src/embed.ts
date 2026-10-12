// Embedding retrieval (Gene, Q3: "go straight to embedding retrieval so agents never need the whole catalogue in
// context"). A god asks `find <intent>` and gets the top k items with why; it never loads the manifest.
//
// The embedder is pluggable (`Embedder`). P0 ships `lsa-1`, which needs no model download and no paid API and runs
// in-process on any box (eden2 has no GPU and no Ollama): a TF-IDF space over the item's words (title, synonyms,
// category label and taxonomy words, affordance verbs, first sentence, description) plus character trigrams (plurals,
// misspellings), reduced by a truncated SVD (latent semantic analysis) to 128 dimensions and stored int8. It learns
// "bread ~ bakery ~ loaf" from the catalogue's own text. Query time: fold the query in (q · V), cosine against the
// item vectors, fused with BM25 by reciprocal rank. Built in the registry build, never per request.
// The production upgrade (a sentence model, e.g. all-MiniLM-L6-v2 int8 via transformers.js, 384-d) slots in behind the
// same interface once Gene approves adding the dependency and its ~23 MB download (docs/god/CATALOG-P0.md §3).
import { vocab } from '@sim/world-compiler';

const STOP = new Set('a an the and or with of to in on at by for from near next some my our its this that it is are be can you your has have into onto one two three four five six used use place put make add want need there here very also so as which who what where when'.split(' '));
const singular = (w: string) => (w.length > 4 && w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.length > 4 && /(ches|shes|xes|ses)$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const stem = (w: string) => { let s = singular(w); if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3); else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2); return s; };
export const tokens = (s: string) => s.toLowerCase().replace(/licen[cs]e:.*$/s, '').split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w)).map(stem);

export type Doc = { id: string; title: string; synonyms: string[]; category: string; affords: string[]; first: string; description: string; line?: string };
type Vec = Map<string, number>;

/** Weighted bag of features for an item (or a query: everything in `title`). */
export function features(d: Pick<Doc, 'title'> & Partial<Doc>, trigramWeight = 0.35): Vec {
  const v: Vec = new Map();
  const add = (text: string, w: number) => { for (const t of tokens(text)) { v.set('w:' + t, (v.get('w:' + t) ?? 0) + w); const g = `^${t}$`; for (let i = 0; i + 3 <= g.length; i++) { const k = 'c:' + g.slice(i, i + 3); v.set(k, (v.get(k) ?? 0) + w * trigramWeight); } } };
  add(d.title, 3);
  for (const s of d.synonyms ?? []) add(s, 2);
  if (d.category) { const node = vocab.CATEGORIES.get(d.category); add(d.category.replace(/[.-]/g, ' '), 1.5); if (node) { add(node.label, 1.5); for (const s of node.syn ?? []) add(s, 1); } }
  for (const a of d.affords ?? []) add(a, 1.2);
  if (d.first) add(d.first, 1);
  if (d.description && d.description !== d.first) add(d.description, 0.5);
  return v;
}

export type Index = {
  model: 'lsa-1'; dim: number; trigram: number; ids: string[]; lines: string[];
  feats: string[]; idf: Float64Array; V: Float32Array;     // feats × dim: query fold-in
  docs: Int8Array; scale: Float32Array;                   // ids × dim, int8 per row (row scale)
  bm25: { rows: Map<number, number>[]; avg: number; df: Float64Array; lengths: Float64Array; postings: Map<number, { r: number; tf: number }[]> };
  bytes: number; ms: number;
};

/** Truncated SVD of the n×m sparse TF-IDF matrix A (rows L2-normalised) by subspace iteration on A·Aᵀ, then
 *  Rayleigh–Ritz (Jacobi) on the small projected matrix. Returns U (n×k, row-major) and σ. */
function svd(rows: [Int32Array, Float64Array][], m: number, k: number, iters = 24, seed = 7) {
  const n = rows.length, p = Math.min(n, k + 12);
  let s = seed; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; };
  let Q: Float64Array = new Float64Array(n * p).map(rnd);
  const orth = (M: Float64Array): Float64Array => { for (let j = 0; j < p; j++) { for (let i = 0; i < j; i++) { let d = 0; for (let r = 0; r < n; r++) d += M[r * p + i] * M[r * p + j]; for (let r = 0; r < n; r++) M[r * p + j] -= d * M[r * p + i]; } let nn = 0; for (let r = 0; r < n; r++) nn += M[r * p + j] ** 2; nn = Math.sqrt(nn) || 1; for (let r = 0; r < n; r++) M[r * p + j] /= nn; } return M; };
  const G = (M: Float64Array): Float64Array => {   // A (Aᵀ M)
    const T = new Float64Array(m * p);
    rows.forEach(([ix, vx], r) => { for (let t = 0; t < ix.length; t++) { const f = ix[t], v = vx[t]; for (let j = 0; j < p; j++) T[f * p + j] += v * M[r * p + j]; } });
    const Y = new Float64Array(n * p);
    rows.forEach(([ix, vx], r) => { for (let t = 0; t < ix.length; t++) { const f = ix[t], v = vx[t]; for (let j = 0; j < p; j++) Y[r * p + j] += v * T[f * p + j]; } });
    return Y;
  };
  Q = orth(Q);
  for (let it = 0; it < iters; it++) Q = orth(G(Q));
  const GQ = G(Q), B = new Float64Array(p * p);
  for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) { let d = 0; for (let r = 0; r < n; r++) d += Q[r * p + i] * GQ[r * p + j]; B[i * p + j] = d; }
  const { values, vectors } = jacobi(B, p);
  const order = [...values.keys()].sort((a, b) => values[b] - values[a]).slice(0, k);
  const U = new Float64Array(n * k), sigma = new Float64Array(k);
  order.forEach((e, c) => { sigma[c] = Math.sqrt(Math.max(values[e], 1e-12)); for (let r = 0; r < n; r++) { let d = 0; for (let j = 0; j < p; j++) d += Q[r * p + j] * vectors[j * p + e]; U[r * k + c] = d; } });
  return { U, sigma };
}
function jacobi(A0: Float64Array, n: number) {
  const A = Float64Array.from(A0), V = new Float64Array(n * n); for (let i = 0; i < n; i++) V[i * n + i] = 1;
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i * n + j] ** 2;
    if (off < 1e-18) break;
    for (let pI = 0; pI < n; pI++) for (let q = pI + 1; q < n; q++) {
      const apq = A[pI * n + q]; if (Math.abs(apq) < 1e-15) continue;
      const theta = (A[q * n + q] - A[pI * n + pI]) / (2 * apq), t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const akp = A[k * n + pI], akq = A[k * n + q]; A[k * n + pI] = c * akp - s * akq; A[k * n + q] = s * akp + c * akq; }
      for (let k = 0; k < n; k++) { const apk = A[pI * n + k], aqk = A[q * n + k]; A[pI * n + k] = c * apk - s * aqk; A[q * n + k] = s * apk + c * aqk; }
      for (let k = 0; k < n; k++) { const vkp = V[k * n + pI], vkq = V[k * n + q]; V[k * n + pI] = c * vkp - s * vkq; V[k * n + q] = s * vkp + c * vkq; }
    }
  }
  return { values: Array.from({ length: n }, (_, i) => A[i * n + i]), vectors: V };
}

export function buildIndex(docs: Doc[], opts: { dim?: number; trigram?: number } = {}): Index {
  const t0 = performance.now(), dim = Math.max(0, Math.min(opts.dim ?? Number(process.env.LSA_DIM ?? 128), docs.length - 1)), trigram = opts.trigram ?? Number(process.env.LSA_TRIGRAM ?? 0.1);
  const bags = docs.map((d) => features(d, trigram));
  const featIx = new Map<string, number>();
  for (const b of bags) for (const f of b.keys()) if (!featIx.has(f)) featIx.set(f, featIx.size);
  const m = featIx.size, n = docs.length, df = new Float64Array(m);
  for (const b of bags) for (const f of b.keys()) df[featIx.get(f)!]++;
  const idf = df.map((x) => Math.log(1 + n / x));
  const rows: [Int32Array, Float64Array][] = bags.map((b) => {
    const ix = new Int32Array(b.size), vx = new Float64Array(b.size); let i = 0, nn = 0;
    for (const [f, tf] of b) { const j = featIx.get(f)!; ix[i] = j; vx[i] = (1 + Math.log(tf + 1)) * idf[j]; nn += vx[i] ** 2; i++; }
    nn = Math.sqrt(nn) || 1; for (let t = 0; t < vx.length; t++) vx[t] /= nn; return [ix, vx];
  });
  const { U, sigma } = dim > 0 ? svd(rows, m, dim) : { U: new Float64Array(0), sigma: new Float64Array(0) };
  // V = Aᵀ U Σ⁻¹ (features × dim) for query fold-in; docs = U Σ, int8 per row
  const V = new Float32Array(m * dim);
  rows.forEach(([ix, vx], r) => { for (let t = 0; t < ix.length; t++) for (let c = 0; c < dim; c++) V[ix[t] * dim + c] += (vx[t] * U[r * dim + c]) / sigma[c]; });
  const docsQ = new Int8Array(n * dim), scale = new Float32Array(n);
  for (let r = 0; r < n; r++) { let mx = 0; for (let c = 0; c < dim; c++) mx = Math.max(mx, Math.abs(U[r * dim + c] * sigma[c])); scale[r] = mx / 127 || 1; for (let c = 0; c < dim; c++) docsQ[r * dim + c] = Math.round((U[r * dim + c] * sigma[c]) / scale[r]); }
  // BM25 over the word features only (the lexical half of the fusion)
  const wdf = new Float64Array(m); const brow = bags.map((b) => { const r = new Map<number, number>(); for (const [f, tf] of b) if (f.startsWith('w:')) { const j = featIx.get(f)!; r.set(j, tf); } for (const j of r.keys()) wdf[j]++; return r; });
  const avg = brow.reduce((a, r) => a + [...r.values()].reduce((x, y) => x + y, 0), 0) / n;
  const lengths = Float64Array.from(brow, (row) => [...row.values()].reduce((a, b) => a + b, 0)), postings = new Map<number, { r: number; tf: number }[]>();
  brow.forEach((row, r) => { for (const [j, tf] of row) { const hits = postings.get(j) ?? []; hits.push({ r, tf }); postings.set(j, hits); } });
  const idx: Index = { model: 'lsa-1', dim, trigram, ids: docs.map((d) => d.id), lines: docs.map((d) => d.line ?? d.id), feats: [...featIx.keys()], idf, V, docs: docsQ, scale, bm25: { rows: brow, avg, df: wdf, lengths, postings }, bytes: 0, ms: 0 };
  idx.bytes = V.byteLength + docsQ.byteLength + scale.byteLength + idf.byteLength + idx.feats.reduce((a, f) => a + f.length + 1, 0);
  idx.ms = Math.round(performance.now() - t0);
  return idx;
}

export type Hit = { id: string; line: string; score: number; why: string[] };
/** Lexical serving needs no SVD, model download or per-query model call. */
export const buildLexicalIndex = (docs: Doc[]): Index => buildIndex(docs, { dim: 0, trigram: 0 });
const featIndexCache = new WeakMap<Index, Map<string, number>>();
const fIx = (idx: Index) => { let m = featIndexCache.get(idx); if (!m) { m = new Map(idx.feats.map((f, i) => [f, i])); featIndexCache.set(idx, m); } return m; };

/** Cosine of the folded-in query against every item vector. */
export function semantic(idx: Index, q: string): { i: number; s: number }[] {
  const fi = fIx(idx), qv = new Float64Array(idx.dim);
  let any = false;
  for (const [f, tf] of features({ title: q }, idx.trigram)) { const j = fi.get(f); if (j === undefined) continue; any = true; const w = (1 + Math.log(tf + 1)) * idx.idf[j]; for (let c = 0; c < idx.dim; c++) qv[c] += w * idx.V[j * idx.dim + c]; }
  if (!any) return [];
  const qn = Math.hypot(...qv) || 1;
  const out: { i: number; s: number }[] = [];
  for (let r = 0; r < idx.ids.length; r++) { let d = 0, nn = 0; for (let c = 0; c < idx.dim; c++) { const x = idx.docs[r * idx.dim + c]; d += x * qv[c]; nn += x * x; } out.push({ i: r, s: d / (Math.sqrt(nn) * qn || 1) }); }
  return out.sort((a, b) => b.s - a.s);
}
/** BM25 (k1 1.2, b 0.75) over word features. */
export function lexical(idx: Index, q: string): { i: number; s: number; why: string[] }[] {
  const fi = fIx(idx), n = idx.ids.length, qs = [...new Set(tokens(q))];
  const scores = new Map<number, { i: number; s: number; why: string[] }>();
  for (const t of qs) {
    const j = fi.get('w:' + t); if (j === undefined) continue;
    const idf = Math.log(1 + (n - idx.bm25.df[j] + 0.5) / (idx.bm25.df[j] + 0.5));
    for (const { r, tf } of idx.bm25.postings.get(j) ?? []) {
      const hit = scores.get(r) ?? { i: r, s: 0, why: [] };
      hit.s += idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * idx.bm25.lengths[r] / idx.bm25.avg));
      hit.why.push(t); scores.set(r, hit);
    }
  }
  return [...scores.values()].sort((a, b) => b.s - a.s || a.i - b.i);
}
/** Lexical, semantic, or both fused by reciprocal rank (k = 60; lexical weighted 1, semantic 1). */
export function search(idx: Index, q: string, opts: { k?: number; mode?: 'lexical' | 'semantic' | 'fused' | string } = {}): Hit[] {
  const k = opts.k ?? 10, mode = opts.mode ?? 'fused';
  const lex = mode === 'semantic' ? [] : lexical(idx, q), sem = mode === 'lexical' ? [] : semantic(idx, q).slice(0, 200);
  const score = new Map<number, { s: number; why: string[] }>();
  const add = (i: number, s: number, why: string[]) => { const e = score.get(i) ?? { s: 0, why: [] }; e.s += s; e.why.push(...why); score.set(i, e); };
  lex.slice(0, 200).forEach((h, rank) => add(h.i, 1 / (60 + rank), h.why.map((w) => `word:${w}`)));
  sem.forEach((h, rank) => add(h.i, 1 / (60 + rank), rank < 10 ? [`sem:${h.s.toFixed(2)}`] : []));
  return [...score].sort((a, b) => b[1].s - a[1].s).slice(0, k).map(([i, e]) => ({ id: idx.ids[i], line: idx.lines[i], score: e.s * 60, why: e.why }));
}

// ------------------------------------------------------------------ registry glue (CLI: catalog embed / find)
import type { Registry } from './registry.ts';
export function docsOf(reg: Registry, ch: 'stable' | 'candidate' = 'stable'): Doc[] {
  return reg.current(ch).map((e) => { const it = reg.item(e.id, e.major, e.rev, e.itemHash)!; return { id: `${e.id}@${e.major}`, title: it.text.title, synonyms: it.text.synonyms, category: it.text.category, affords: it.affords, first: it.text.first, description: it.text.description, line: e.line }; });
}
const cache = new Map<string, { seq: number | null; index: Index }>();
export async function buildEmbeddings(reg: Registry, o: { model?: string; run?: string } = {}) {
  if (o.model && o.model !== 'lsa-1') throw new Error(`embedder ${o.model} is not installed (P0 ships lsa-1; see docs/god/CATALOG-P0.md §3)`);
  const idx = buildIndex(docsOf(reg));
  const seq = reg.pointers().stable;
  reg.log({ op: 'embed', run: o.run, model: idx.model, dim: idx.dim, items: idx.ids.length, bytes: idx.bytes, ms: idx.ms, stable: seq });
  cache.set(reg.root, { seq, index: idx });
  return { model: idx.model, dim: idx.dim, items: idx.ids.length, features: idx.feats.length, bytes: idx.bytes, ms: idx.ms, stable: seq };
}
export async function find(reg: Registry, q: string, o: { k?: number; mode?: string } = {}) {
  const seq = reg.pointers().stable, lexicalOnly = o.mode === 'lexical';
  let cached = cache.get(reg.root);
  if (!cached || cached.seq !== seq || (!lexicalOnly && cached.index.dim === 0)) {
    cached = { seq, index: lexicalOnly ? buildLexicalIndex(docsOf(reg)) : buildIndex(docsOf(reg)) };
    cache.set(reg.root, cached);
  }
  return search(cached.index, q, o);
}

// ------------------------------------------------------------------ external sentence vectors (pluggable embedders)
/** An item-vector index from any embedder (e.g. a sentence model run in the build): ids × dim, L2-normalised. */
export type VectorIndex = { model: string; dim: number; ids: string[]; vecs: Float32Array };
export function vectorIndex(model: string, ids: string[], vectors: number[][]): VectorIndex {
  const dim = vectors[0]?.length ?? 0, vecs = new Float32Array(ids.length * dim);
  vectors.forEach((v, r) => { const n = Math.hypot(...v) || 1; for (let c = 0; c < dim; c++) vecs[r * dim + c] = v[c] / n; });
  return { model, dim, ids, vecs };
}
export function nearest(vi: VectorIndex, q: number[], k = 200): { i: number; s: number }[] {
  const n = Math.hypot(...q) || 1, out: { i: number; s: number }[] = [];
  for (let r = 0; r < vi.ids.length; r++) { let d = 0; for (let c = 0; c < vi.dim; c++) d += vi.vecs[r * vi.dim + c] * q[c]; out.push({ i: r, s: d / n }); }
  return out.sort((a, b) => b.s - a.s).slice(0, k);
}
/** Reciprocal-rank fusion of ranked id lists (k = 60), each with a weight. */
export function rrf(lists: { ids: string[]; w?: number }[], k = 10): string[] {
  const s = new Map<string, number>();
  for (const l of lists) l.ids.slice(0, 200).forEach((id, r) => s.set(id, (s.get(id) ?? 0) + (l.w ?? 1) / (60 + r)));
  return [...s].sort((a, b) => b[1] - a[1]).slice(0, k).map(([id]) => id);
}
/** The text a sentence embedder sees for an item (title, words, category label, first sentence). */
export const embedText = (d: Doc) => `${d.title}. ${d.synonyms.join(', ')}. ${vocab.CATEGORIES.get(d.category)?.label ?? d.category}. ${d.first}`;
