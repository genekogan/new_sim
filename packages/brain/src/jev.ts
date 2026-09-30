// TypeSafe System One (Jev) client. Text in, typed judgments out.
// https://docs.typesafe.ai/api.md — POST /v1/systemone { model, state, questions }.
// Question formats follow docs.typesafe.ai/primitives/*.md:
//   instructions: string | object | array (objects can carry data next to the question)
//   choice.criteria: { optionName: null | string | {what, good_when, not_for, examples…} }  (field names are free)
//   score.criteria: ordered levels, each a string or {what, examples}
//   noul.criteria: optional { true, false }
export type Instructions = string | Record<string, unknown> | unknown[];
export type ChoiceQ = { type: 'choice'; instructions: Instructions; criteria: Record<string, null | string | Record<string, unknown>> };
export type NoulQ = { type: 'noul'; instructions: Instructions; criteria?: { true: string; false: string } };
export type ScoreQ = { type: 'score'; instructions: Instructions; criteria: (string | { what: string; examples?: string[] })[] };
export type Question = ChoiceQ | NoulQ | ScoreQ;
export type JevRequest = { model: string; state: unknown; questions: Record<string, Question> };

export type ChoiceA = { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> };
export type NoulA = { type: 'noul'; noul: number };
export type ScoreA = { type: 'score'; score: number; confidence: number; legend?: Record<string, unknown>; probabilities: Record<string, number> };
export type Answer = ChoiceA | NoulA | ScoreA;
export type JevResponse = { model: string; answers: Record<string, Answer>; usage: { input_tokens: number; output_tokens: number } };

export const JEV_USD_PER_INPUT_TOKEN = 0.042 / 1e6;
/** Pinned (docs: pin the version when thresholds are tuned against it). */
export const JEV_MODEL = 'jev-1.13.0';

export type JevResult = { response: JevResponse; ms: number; costUsd: number; mode: 'live' | 'fake' };

export class JevClient {
  apiKey: string | undefined;
  mode: 'live' | 'fake';
  constructor(apiKey: string | undefined, mode: 'live' | 'fake') { this.apiKey = apiKey; this.mode = apiKey ? mode : 'fake'; }

  async ask(req: JevRequest, timeoutMs = 6000): Promise<JevResult> {
    if (this.mode === 'fake' || !this.apiKey) return fakeJev(req);
    const t0 = performance.now();
    for (let attempt = 0; ; attempt++) {
      const res = await fetch('https://api.typesafe.ai/v1/systemone', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
        signal: AbortSignal.timeout(timeoutMs),
      });
      // docs: back off on 429 (rate limit) and 529 (overloaded)
      if ((res.status === 429 || res.status === 529) && attempt < 2) {
        const ra = Number(res.headers.get('retry-after'));
        await new Promise((r) => setTimeout(r, Number.isFinite(ra) && ra > 0 ? ra * 1000 : 400 * 2 ** attempt));
        continue;
      }
      if (!res.ok) throw new Error(`jev ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const response = (await res.json()) as JevResponse;
      for (const a of Object.values(response.answers)) if (a.type !== 'noul') a.probabilities = normalize(a.probabilities);
      return { response, ms: performance.now() - t0, costUsd: response.usage.input_tokens * JEV_USD_PER_INPUT_TOKEN, mode: 'live' };
    }
  }
}

/** Large replies sometimes return cent-rounded probabilities summing to 0.99/1.01; normalize in code. */
export function normalize(p: Record<string, number>): Record<string, number> {
  const sum = Object.values(p).reduce((a, b) => a + b, 0) || 1;
  const out: Record<string, number> = {};
  for (const k of Object.keys(p)) out[k] = p[k] / sum;
  return out;
}

/** Fake Jev: same shapes, deterministic heuristics. */
export function fakeJev(req: JevRequest): JevResult {
  const answers: Record<string, Answer> = {};
  const text = JSON.stringify(req.state).length;
  for (const [id, q] of Object.entries(req.questions)) {
    if (q.type === 'noul') answers[id] = { type: 'noul', noul: ((text + id.length) % 10) / 10 };
    else if (q.type === 'score') {
      const n = q.criteria.length; const probabilities: Record<string, number> = {};
      for (let i = 0; i < n; i++) probabilities[String(i)] = i === 1 % n ? 0.6 : 0.4 / Math.max(1, n - 1);
      answers[id] = { type: 'score', score: 1 % n, confidence: 0.5, probabilities: normalize(probabilities) };
    } else {
      const keys = Object.keys(q.criteria); const probabilities: Record<string, number> = {};
      // prefer an option flagged as serving the owner's intent, so fake mode still follows direction
      const flagged = keys.findIndex((k) => (q.criteria[k] as { serves_intent?: boolean } | null)?.serves_intent);
      const pick = flagged >= 0 ? flagged : (text + id.length) % keys.length;
      keys.forEach((k, i) => (probabilities[k] = i === pick ? (flagged >= 0 ? 0.9 : 0.6) : (flagged >= 0 ? 0.1 : 0.4) / Math.max(1, keys.length - 1)));
      answers[id] = { type: 'choice', choice: keys[pick], confidence: 0.5, probabilities: normalize(probabilities) };
    }
  }
  const input_tokens = Math.round(JSON.stringify(req).length / 4);
  return { response: { model: 'fake-jev', answers, usage: { input_tokens, output_tokens: 0 } }, ms: 1, costUsd: 0, mode: 'fake' };
}

/**
 * Pick from a calibrated distribution without undoing the calibration.
 * If the top option is clearly preferred, take it. Otherwise sample (T = 1)
 * only among the plausible options: p ≥ minP, inside the top-p nucleus.
 * Options Jev rated near zero are never picked.
 */
export function pick(p: Record<string, number>, u: number, o: { argmaxAt: number; minP?: number; topP?: number }): { key: string; how: 'argmax' | 'sampled'; pool: string[] } {
  const ranked = Object.entries(p).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  if (!ranked.length) throw new Error('empty distribution');
  if (ranked[0][1] >= o.argmaxAt) return { key: ranked[0][0], how: 'argmax', pool: [ranked[0][0]] };
  const minP = o.minP ?? 0.05, topP = o.topP ?? 0.9;
  const pool: [string, number][] = [];
  let acc = 0;
  for (const [k, v] of ranked) { if (v < minP || acc >= topP) break; pool.push([k, v]); acc += v; }
  if (pool.length <= 1) return { key: ranked[0][0], how: 'argmax', pool: [ranked[0][0]] };
  const sum = pool.reduce((s, [, v]) => s + v, 0);
  let c = 0;
  for (const [k, v] of pool) { c += v / sum; if (u < c) return { key: k, how: 'sampled', pool: pool.map(([x]) => x) }; }
  return { key: pool[pool.length - 1][0], how: 'sampled', pool: pool.map(([x]) => x) };
}

/** Readable, unique option names: the option name is sent to the model, so it should mean something. */
export function optionKeys(labels: { id: string; name: string }[]): Map<string, string> {
  const out = new Map<string, string>(); const used = new Set<string>();
  for (const { id, name } of labels) {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 48) || 'option';
    let k = base, n = 2; while (used.has(k)) k = `${base}_${n++}`;
    used.add(k); out.set(k, id);
  }
  return out;
}
