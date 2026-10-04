// MCP (Streamable HTTP, stateless): the same soul tools as the REST agent API.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { GOALS, intentRequestV2Schema } from '@sim/protocol';
import type { SoulRow } from './db.ts';
import { ApiError, type Souls } from './souls.ts';
import { checkAcceptanceGuard,type AcceptanceGuard } from './world.ts';
import { intentTransportError,intentLookupError,type IntentControlV2 } from './intent-control.ts';
import type { IntentRequestScope } from './intent-requests.ts';

const text = (v: unknown, isError = false) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }], isError });

// SDK1.31 advertises a union root as an empty object. Give discovery the actual
// object fields derived from the authoritative union, then delegate conditional
// validation to that same contract before the SDK and inside the shared service.
// This object is an adapter for discovery, never a second request grammar.
const upsert=intentRequestV2Schema.options[0].shape;
const intentToolInput=z.strictObject({contract:upsert.contract,requestId:upsert.requestId,op:z.enum(['upsert','withdraw']),
  words:upsert.words.optional(),strict:upsert.strict.removeDefault().optional(),importance:upsert.importance.removeDefault().optional(),edit:upsert.edit});
const intentLookupInput=z.strictObject({requestId:upsert.requestId});

function serverFor(souls: Souls, soul: SoulRow,guard?:AcceptanceGuard,candidate?:{service:IntentControlV2;scope:IntentRequestScope}) {
  const s = new McpServer({ name: 'sim', version: '0.1.0' });
  const reply=async(run:()=>unknown)=>{
    try{
      if(guard)checkAcceptanceGuard(guard);
      const result=await run();if(guard)checkAcceptanceGuard(guard);return text(result);
    }catch(error){if(error instanceof ApiError)return text({ok:false,code:error.code,message:error.message,...error.extra},true);throw error;}
  };
  s.registerTool('world_query', { description: 'The world: regions, places, every Soul and what it is doing. Free and instant.', inputSchema: {}, annotations: { readOnlyHint: true } }, async () => reply(()=>souls.worldSummary()));
  s.registerTool('soul_perceive', { description: `What your Soul (${soul.name}) perceives right now: surroundings, energy, mood, nearby souls and places, and what it could do. Start here.`, inputSchema: {}, annotations: { readOnlyHint: true } }, async () => reply(()=>souls.perceive(soul)));
  s.registerTool('soul_wait', { description: 'Block until something happens to your Soul (an activity ends, a new one starts, an intent lands) or the timeout passes. Use instead of polling.', inputSchema: { seconds: z.number().int().min(1).max(55).optional() }, annotations: { readOnlyHint: true } }, async ({ seconds }) => reply(()=>souls.wait(soul,seconds??30)));
  s.registerTool('soul_command', { description: 'Say what you want your Soul to do in plain words. The world compiles the wish into a plan of cards, minting any card it needs, and returns the plan it understood. The simplest way to steer.', inputSchema: { text: z.string().min(1).max(280) } }, async ({ text: t }) => reply(()=>souls.command(soul,t,'mcp',guard)));
  s.registerTool('soul_mandate',{description:'Read your Soul’s private owner rules, understanding, triggers and done/blocked reports.',inputSchema:{},annotations:{readOnlyHint:true}},async()=>reply(()=>({rules:souls.rules(soul)})));
  s.registerTool('soul_steer',{description:'Add or edit one owner mandate rule. One alignment explains its effect. Triggers wake thought; only an explicit NOW instruction runs directly.',inputSchema:{words:z.string().min(1).max(2000),strict:z.boolean().optional(),id:z.string().optional()}},async input=>reply(()=>souls.steer(soul,input,'mcp',guard)));
  s.registerTool('soul_remove_rule',{description:'Remove an owner rule. The Soul continues its day with its character, needs and journal.',inputSchema:{id:z.string()}},async({id})=>reply(()=>souls.removeRule(soul,id,guard)));
  s.registerTool('soul_deck', { description: 'The cards your Soul holds, which can be played now and on what, its manners, and its agenda. Read /cards.md for how cards work.', inputSchema: {}, annotations: { readOnlyHint: true } }, async () => reply(()=>souls.deck(soul)));
  s.registerTool('soul_propose_cards', { description: 'Propose new cards for your Soul’s deck (see /cards.md for the format). Each is validated; valid ones are minted and dealt to your Soul.', inputSchema: { cards: z.array(z.any()).min(1).max(4), links: z.record(z.string(), z.object({ summary: z.string(), control: z.boolean().optional() })).optional().describe('new link kinds the cards use'), kinds: z.record(z.string(), z.object({ summary: z.string() })).optional().describe('new kinds of thing the cards make') } }, async (input) => reply(()=>souls.proposeCards(soul,input,guard)));
  s.registerTool('soul_status', { description: `Status of your Soul (${soul.name}): position, activity, mood, intent, what is nearby, and what it could do now.`, inputSchema: {}, annotations: { readOnlyHint: true } }, async () => reply(()=>souls.status(soul)));
  s.registerTool('soul_log', { description: 'Recent history of your Soul.', inputSchema: { limit: z.number().int().min(1).max(100).optional() }, annotations: { readOnlyHint: true } }, async ({ limit }) => reply(()=>souls.soulLog(soul,limit??30)));
  s.registerTool('soul_set_intent', {
    description: 'Set the standing intent of your Soul. Returns once the world has accepted it at the next tick. The Soul pursues it on its own until you replace it.',
    inputSchema: {
      goal: z.enum(GOALS).optional().describe('a simple goal; or give an agenda instead'),
      target: z.string().max(80).nullable().optional().describe('thing id or name from world_query / soul_perceive'),
      agenda: z.array(z.object({ card: z.string(), target: z.string().nullable().optional(), of: z.string().nullable().optional() })).max(8).optional().describe('ordered cards to favour (from soul_deck), each optionally on a `target`, or `of` someone for a thing that may not exist yet: {card:"join", of:"Rob"} means whatever gathering is Rob’s'),
      note: z.string().max(160).optional().describe('colour for the Soul’s mind; context, not a command'),
    },
  }, async (input) => reply(async()=>{const r=await souls.setIntent(soul,input,'mcp',guard);return {ok:true,accepted_at_tick:r.event.tick,intent:r.intent,text:r.text,status:souls.status(soul)};}));
  if(candidate) {
    const {service,scope}=candidate;
    const intentReply=async(run:()=>unknown,lookup=false)=>{
      try {if(guard)checkAcceptanceGuard(guard);const result=await run();if(guard)checkAcceptanceGuard(guard);return text(result);}
      catch(error){const safe=lookup?intentLookupError(error):intentTransportError(error);return text({ok:false,code:safe.code,message:safe.message,...safe.extra},true);}
    };
    s.registerTool('soul_intent_v2',{
      description:'soul-intent/2: submit one retained direction with a durable requestId, or edit/withdraw an exact purpose version. Upsert requires words; withdrawal requires edit and forbids words/strict/importance. Returns a received, understood, refused or withdrawn receipt. Understanding is not physical completion. Retry only this same request identity; no legacy fallback.',
      inputSchema:intentToolInput,annotations:{readOnlyHint:false,idempotentHint:true,destructiveHint:false},
    },async input=>intentReply(()=>service.submit(scope,input)));
    s.registerTool('soul_intent_request_v2',{
      description:'Read the receipt for this scoped credential generation and requestId. Received may still be awaiting interpretation; no repeated mutation or completion is inferred. Unknown/inaccessible requests are not-found.',
      inputSchema:intentLookupInput,annotations:{readOnlyHint:true,idempotentHint:true},
    },async({requestId})=>intentReply(()=>service.lookup(scope,requestId),true));
  }
  return s;
}

export async function handleMcp(req: IncomingMessage, res: ServerResponse, souls: Souls,intentV2?:IntentControlV2) {
  if(intentV2&&(intentV2.souls!==souls||intentV2.host!==souls.host))throw new Error('MCP intent candidate must belong to selected Souls host');
  if(souls.lifecycle||intentV2)res.setHeader('Cache-Control','no-store');
  // bearer header, or /mcp/<token> for connector apps that only accept a URL
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? req.url?.match(/^\/mcp\/(sim_[A-Za-z0-9_-]+)/)?.[1];
  const soul = souls.soulFromToken(token);
  if (!soul) { res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Bearer' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'missing or invalid soul token' }, id: null })); return; }
  let candidate:{service:IntentControlV2;scope:IntentRequestScope}|undefined;
  if(intentV2) {
    try {candidate={service:intentV2,scope:intentV2.agentScope(token,'mcp')};}
    catch {res.writeHead(401,{'content-type':'application/json','www-authenticate':'Bearer'}).end(JSON.stringify({jsonrpc:'2.0',error:{code:-32001,message:'missing or invalid soul token'},id:null}));return;}
  }
  const legacyGuard=souls.agentControlGuard(soul,token);
  const guard:AcceptanceGuard|undefined=candidate?()=>{if(legacyGuard)checkAcceptanceGuard(legacyGuard);return candidate!.service.guard(candidate!.scope);}:legacyGuard;
  if (req.method !== 'POST') { res.writeHead(405, { 'content-type': 'application/json', allow: 'POST' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'method not allowed (stateless server: POST only)' }, id: null })); return; }
  const chunks: Buffer[] = []; let size = 0;
  for await (const c of req) { size += (c as Buffer).length; if (size > 64 * 1024) { res.writeHead(413).end(); return; } chunks.push(c as Buffer); }
  // Credential authority can disappear while the transport reads a slow body.
  // Recheck before parsing/registering tools, then retain it through each tool.
  try{if(guard)checkAcceptanceGuard(guard);}catch(error){
    if(!(error instanceof ApiError)&&!candidate)throw error;
    res.writeHead(401,{'content-type':'application/json','www-authenticate':'Bearer'}).end(JSON.stringify({jsonrpc:'2.0',error:{code:-32001,message:'missing or invalid soul token'},id:null}));return;
  }
  let body: unknown; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { res.writeHead(400).end(); return; }
  if(candidate&&body&&typeof body==='object'&&!Array.isArray(body)) {
    const rpc=body as {method?:unknown;id?:unknown;params?:{name?:unknown;arguments?:unknown}};
    if(rpc.method==='tools/call'&&['soul_intent_v2','soul_intent_request_v2'].includes(String(rpc.params?.name))) {
      const schema=rpc.params!.name==='soul_intent_v2'?intentRequestV2Schema:intentLookupInput;
      if(!schema.safeParse(rpc.params?.arguments).success) {
        // SDK validation diagnostics can echo arbitrary unknown property names.
        // Keep malformed private arguments/credential-shaped keys out of errors.
        res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',id:rpc.id??null,
          result:text({ok:false,code:'invalid',message:'invalid soul-intent/2 tool arguments'},true)}));return;
      }
    }
  }
  const server = serverFor(souls, soul,guard,candidate);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { void transport.close(); void server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
