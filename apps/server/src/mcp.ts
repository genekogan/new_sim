// MCP (Streamable HTTP, stateless): the same soul tools as the REST agent API.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { GOALS } from '@sim/protocol';
import type { SoulRow } from './db.ts';
import { ApiError, type Souls } from './souls.ts';

const text = (v: unknown, isError = false) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }], isError });

function serverFor(souls: Souls, soul: SoulRow) {
  const s = new McpServer({ name: 'sim', version: '0.1.0' });
  s.registerTool('world_query', { description: 'The world: regions, places, every Soul and what it is doing. Free and instant.', inputSchema: {}, annotations: { readOnlyHint: true } }, async () => text(souls.worldSummary()));
  s.registerTool('soul_perceive', { description: `What your Soul (${soul.name}) perceives right now: surroundings, energy, mood, nearby souls and places, and what it could do. Start here.`, inputSchema: {}, annotations: { readOnlyHint: true } }, async () => { try { return text(souls.perceive(soul)); } catch (e) { if (e instanceof ApiError) return text({ ok: false, code: e.code, message: e.message }, true); throw e; } });
  s.registerTool('soul_wait', { description: 'Block until something happens to your Soul (an activity ends, a new one starts, an intent lands) or the timeout passes. Use instead of polling.', inputSchema: { seconds: z.number().int().min(1).max(55).optional() }, annotations: { readOnlyHint: true } }, async ({ seconds }) => { try { return text(await souls.wait(soul, seconds ?? 30)); } catch (e) { if (e instanceof ApiError) return text({ ok: false, code: e.code, message: e.message, ...e.extra }, true); throw e; } });
  s.registerTool('soul_command', { description: 'Fallback: give a plain-language command and let the world’s small translator turn it into an intent. Prefer soul_set_intent.', inputSchema: { text: z.string().min(1).max(280) } }, async ({ text: t }) => { try { return text(await souls.command(soul, t, 'mcp')); } catch (e) { if (e instanceof ApiError) return text({ ok: false, code: e.code, message: e.message, ...e.extra }, true); throw e; } });
  s.registerTool('soul_status', { description: `Status of your Soul (${soul.name}): position, activity, mood, intent, what is nearby, and what it could do now.`, inputSchema: {}, annotations: { readOnlyHint: true } }, async () => text(souls.status(soul)));
  s.registerTool('soul_log', { description: 'Recent history of your Soul.', inputSchema: { limit: z.number().int().min(1).max(100).optional() }, annotations: { readOnlyHint: true } }, async ({ limit }) => text(souls.soulLog(soul, limit ?? 30)));
  s.registerTool('soul_set_intent', {
    description: 'Set the standing intent of your Soul. Returns once the world has accepted it at the next tick. The Soul pursues it on its own until you replace it.',
    inputSchema: { goal: z.enum(GOALS), target: z.string().max(80).nullable().optional().describe('entity id, region id, or a name from world_query'), note: z.string().max(160).optional().describe('colour for the Soul’s mind; context, not a command') },
  }, async (input) => {
    try { const r = await souls.setIntent(soul, input, 'mcp'); return text({ ok: true, accepted_at_tick: r.event.tick, intent: r.intent, text: r.text, status: souls.status(soul) }); }
    catch (e) { if (e instanceof ApiError) return text({ ok: false, code: e.code, message: e.message, ...e.extra }, true); throw e; }
  });
  return s;
}

export async function handleMcp(req: IncomingMessage, res: ServerResponse, souls: Souls) {
  // bearer header, or /mcp/<token> for connector apps that only accept a URL
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? req.url?.match(/^\/mcp\/(sim_[A-Za-z0-9_-]+)/)?.[1];
  const soul = souls.soulFromToken(token);
  if (!soul) { res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Bearer' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'missing or invalid soul token' }, id: null })); return; }
  if (req.method !== 'POST') { res.writeHead(405, { 'content-type': 'application/json', allow: 'POST' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'method not allowed (stateless server: POST only)' }, id: null })); return; }
  const chunks: Buffer[] = []; let size = 0;
  for await (const c of req) { size += (c as Buffer).length; if (size > 64 * 1024) { res.writeHead(413).end(); return; } chunks.push(c as Buffer); }
  let body: unknown; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { res.writeHead(400).end(); return; }
  const server = serverFor(souls, soul);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { void transport.close(); void server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
