// A single forced tool call to an Anthropic model: the only way larger models
// are used here. Returns the tool input plus usage and cost.
export type ToolDef = { name: string; description: string; input_schema: Record<string, unknown> };
export type LlmResult<T> = { out: T; ms: number; inputTokens: number; outputTokens: number; cachedTokens: number; costUsd: number; request: unknown; raw: unknown };

// USD per token. Haiku 4.5: input 1/M, output 5/M, cache write 1.25/M, cache read 0.10/M.
const PRICES: Record<string, { in: number; out: number; cw: number; cr: number }> = { default: { in: 1 / 1e6, out: 5 / 1e6, cw: 1.25 / 1e6, cr: 0.1 / 1e6 } };

export async function callTool<T>(o: { apiKey: string; model: string; system: string; cacheSystem?: boolean; messages: { role: 'user' | 'assistant'; content: string }[]; tool: ToolDef; maxTokens: number; timeoutMs?: number }): Promise<LlmResult<T>> {
  const request = {
    model: o.model, max_tokens: o.maxTokens,
    system: [{ type: 'text', text: o.system, ...(o.cacheSystem ? { cache_control: { type: 'ephemeral' } } : {}) }],
    tools: [o.tool], tool_choice: { type: 'tool', name: o.tool.name },
    messages: o.messages,
  };
  const t0 = performance.now();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': o.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(request), signal: AbortSignal.timeout(o.timeoutMs ?? 40000),
  });
  const ms = performance.now() - t0;
  if (!res.ok) throw new Error(`${o.model} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as any;
  const tool = (body.content as any[]).find((c) => c.type === 'tool_use');
  if (!tool) throw new Error(`${o.model} returned no tool call`);
  const u = body.usage ?? {}, p = PRICES[o.model] ?? PRICES.default;
  const cached = u.cache_read_input_tokens ?? 0, written = u.cache_creation_input_tokens ?? 0;
  return {
    out: tool.input as T, ms, inputTokens: (u.input_tokens ?? 0) + cached + written, outputTokens: u.output_tokens ?? 0, cachedTokens: cached,
    costUsd: (u.input_tokens ?? 0) * p.in + (u.output_tokens ?? 0) * p.out + written * p.cw + cached * p.cr,
    request, raw: { content: body.content, usage: u, stop_reason: body.stop_reason },
  };
}
