// TypeSafe System One (Jev) client. Text in, typed judgments out.
// https://docs.typesafe.ai/api.md — POST /v1/systemone { model, state, questions }.
export type ChoiceQ = { type: 'choice'; instructions: string; criteria: Record<string, { what: string; not_for?: string; examples?: string[] } | null> };
export type NoulQ = { type: 'noul'; instructions: string };
export type ScoreQ = { type: 'score'; instructions: string; criteria: string[] };
export type Question = ChoiceQ | NoulQ | ScoreQ;
export type JevRequest = { model: string; state: unknown; questions: Record<string, Question> };

export type ChoiceA = { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> };
export type NoulA = { type: 'noul'; noul: number };
export type ScoreA = { type: 'score'; score: number; confidence: number; legend?: Record<string, string>; probabilities: Record<string, number> };
export type Answer = ChoiceA | NoulA | ScoreA;
export type JevResponse = { model: string; answers: Record<string, Answer>; usage: { input_tokens: number; output_tokens: number } };

export const JEV_USD_PER_INPUT_TOKEN = 0.042 / 1e6;
export const JEV_MODEL = 'jev-latest';

export type JevResult = { response: JevResponse; ms: number; costUsd: number; mode: 'live' | 'fake' };

export class JevClient {
  apiKey: string | undefined;
  mode: 'live' | 'fake';
  constructor(apiKey: string | undefined, mode: 'live' | 'fake') { this.apiKey = apiKey; this.mode = apiKey ? mode : 'fake'; }

  async ask(req: JevRequest, timeoutMs = 6000): Promise<JevResult> {
    if (this.mode === 'fake' || !this.apiKey) return fakeJev(req);
    const t0 = performance.now();
    const res = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ms = performance.now() - t0;
    if (!res.ok) throw new Error(`jev ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const response = (await res.json()) as JevResponse;
    for (const a of Object.values(response.answers)) if (a.type !== 'noul') a.probabilities = normalize(a.probabilities);
    return { response, ms, costUsd: response.usage.input_tokens * JEV_USD_PER_INPUT_TOKEN, mode: 'live' };
  }
}

/** Large replies sometimes return cent-rounded probabilities summing to 0.99/1.01; normalize in code. */
export function normalize(p: Record<string, number>): Record<string, number> {
  const sum = Object.values(p).reduce((a, b) => a + b, 0) || 1;
  const out: Record<string, number> = {};
  for (const k of Object.keys(p)) out[k] = p[k] / sum;
  return out;
}

/** Fake Jev: same shapes, deterministic heuristics. First option wins with 0.6, the rest share 0.4. */
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
      const pick = (text + id.length) % keys.length;
      keys.forEach((k, i) => (probabilities[k] = i === pick ? 0.6 : 0.4 / Math.max(1, keys.length - 1)));
      answers[id] = { type: 'choice', choice: keys[pick], confidence: 0.5, probabilities: normalize(probabilities) };
    }
  }
  const input_tokens = Math.round(JSON.stringify(req).length / 4);
  return { response: { model: 'fake-jev', answers, usage: { input_tokens, output_tokens: 0 } }, ms: 1, costUsd: 0, mode: 'fake' };
}

/** Sample from a distribution with temperature and a probability floor (Pokemon harness pattern). u in [0,1). */
export function sample(p: Record<string, number>, u: number, temperature = 1.4, floor = 0.03): string {
  const keys = Object.keys(p).sort();
  const w = keys.map((k) => Math.pow(Math.max(p[k], floor), 1 / temperature));
  const sum = w.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let i = 0; i < keys.length; i++) { acc += w[i] / sum; if (u < acc) return keys[i]; }
  return keys[keys.length - 1];
}
