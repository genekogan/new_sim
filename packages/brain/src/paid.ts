/** A durable host admission gate. The provider clients never choose a budget. */
export type PaidGate = (boundUsd: number, model: string) => { settle(actualUsd: number): void };
export class PaidHttpError extends Error {
  status: number; retryAfter: number;
  constructor(message: string, status: number, retryAfter: number) { super(message); this.status = status; this.retryAfter = retryAfter; }
}

export function costBound(provider: 'jev' | 'anthropic', request: unknown): number {
  const r = request as { model: string; max_tokens?: number };
  // UTF-8 bytes conservatively bound input tokens; extra bytes cover provider framing.
  const bytes = new TextEncoder().encode(JSON.stringify(request)).length + 8192;
  if (provider === 'jev') {
    if (r.model !== 'jev-1.13.0') throw new Error('unpriced Jev model');
    return bytes * 0.042 / 1e6;
  }
  if (!/^claude-haiku-4-5(?:-20251001)?$/.test(r.model)) throw new Error('unpriced Anthropic model');
  return bytes * 1.25 / 1e6 + (r.max_tokens ?? 0) * 5 / 1e6;
}

/** Reserve before the request; retain the bound after an uncertain transport failure. */
export async function paidJson(provider: 'jev' | 'anthropic', request: any, init: RequestInit, gate?: PaidGate): Promise<any> {
  const permit = gate?.(costBound(provider, request), request.model);
  const response = await fetch(provider === 'jev' ? 'https://api.typesafe.ai/v1/systemone' : 'https://api.anthropic.com/v1/messages', { ...init, body: JSON.stringify(request) });
  if (!response.ok) {
    if ([400, 401, 403, 404, 429, 529].includes(response.status)) permit?.settle(0);
    throw new PaidHttpError(`${provider} ${response.status}: ${(await response.text()).slice(0, 200)}`, response.status, Number(response.headers.get('retry-after')) || 0);
  }
  const body = await response.json() as any, u = body.usage;
  const valid=(x:unknown)=>typeof x==='number'&&Number.isFinite(x)&&Number.isInteger(x)&&x>=0;
  if(!u||!valid(u.input_tokens)||(provider==='anthropic'&&!valid(u.output_tokens))||!valid(u.cache_creation_input_tokens??0)||!valid(u.cache_read_input_tokens??0))throw new Error(`${provider} response has no valid usage receipt; reservation retained`);
  const cost = provider === 'jev' ? (u.input_tokens ?? 0) * 0.042 / 1e6 :
    ((u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1 + (u.output_tokens ?? 0) * 5) / 1e6;
  permit?.settle(cost);
  return body;
}
