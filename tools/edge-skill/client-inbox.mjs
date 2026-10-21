// Receive only the authenticated Soul owner's private inbox; never infer completion.
const noticed = new Set();
export function noticeOwnerInbox(data) {
  const message = data?.inbox?.latest;
  if (!message || typeof message.id !== 'string' || !message.id || typeof message.text !== 'string' || !['sent', 'delivered'].includes(message.state) || noticed.has(message.id)) return false;
  console.error('OWNER MESSAGE ' + JSON.stringify(message));
  noticed.add(message.id);
  if (noticed.size > 256) noticed.delete(noticed.values().next().value);
  return true;
}
export function noticeInboxHeader(headers) {
  try {
    const encoded = headers?.get?.('x-sim-agent-inbox');
    if (typeof encoded !== 'string' || encoded.length > 16384 || !/^[A-Za-z0-9_-]+$/.test(encoded)) return false;
    return noticeOwnerInbox(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(encoded, 'base64url'))));
  } catch { return false; }
}

/** What `listen` tells the agent to do with what it prints. */
export const LISTEN_NEXT = 'From your human, oldest first. For each: ack <id> "Got it: <what you will do>" at once, do it, then result <id> done|failed "<what happened>". Then run listen again right away (it waits as long as needed).';
const transient = r => r.status === 0 || r.status === 429 || r.status >= 500;
/** The messages one listen answer hands over: a 1.9.5 world's whole backlog, else (older world) its one latest. */
function handed(data, after) {
  if (Array.isArray(data.backlog)) return data.backlog.filter(m => m && typeof m.id === 'string' && m.state !== 'acknowledged');
  const m = data.inbox.latest;
  return m && m.state !== 'acknowledged' && m.id !== after ? [m] : [];
}
const line = (m, emittedAt) => ({ id: m.id, text: m.text, sentAt: m.sentAt, emittedAt });

/** listen (1.9.5): blocks with no time limit until your human has written, then prints every message waiting, oldest
 * first, and exits. It long-polls inside (one request per ~50 s, no model tokens while it waits); a restarting world or a
 * network drop is retried quietly. The output carries no credential, so never filter it.
 * --once: one long-poll, then the raw answer.  --follow: never exits; one JSON line per new message (a stream). */
export async function clientListen(args, { call, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), write, stop, now = Date.now }) {
  let seconds, after, once = false, follow = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--once') once = true;
    else if (arg === '--follow') follow = true;
    else if (arg === '--timeout') {
      const value = args[++i]; seconds = value === undefined || value === '' ? NaN : Number(value);
    } else if (arg === '--after') {
      after = args[++i];
      if (!after || after.startsWith('--')) throw new Error('listen --after needs a message id');
    } else throw new Error('usage: listen [--after message-id] [--timeout seconds] [--once|--follow]');
  }
  if (once && follow) throw new Error('listen takes --follow or --once, not both');
  seconds ??= once ? 25 : 50;
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 55) throw new Error('listen --timeout takes seconds from 0 to 55');
  if (seconds === 0 && !once) throw new Error('listen --timeout 0 requires --once');
  const poll = last => call(`/v1/edge/inbox/listen?${new URLSearchParams({ timeoutMs: String(Math.round(seconds * 1000)), ...(last ? { after: last } : {}) })}`, { timeoutMs: Math.round(seconds * 1000) + 10_000 });
  if (follow) return followInbox({ poll, after, wait: sleep, write, stop, now });
  if (once) return inboxResult(await poll(after), 'listen');
  for (let delay = 0; ;) {
    // A connection dropped mid-answer throws instead of returning status 0: an outage too, never the end of listen.
    let r; try { r = await poll(after); } catch (e) { r = { status: 0, data: { error: { code: 'unreachable', message: String(e?.message ?? e) } } }; }
    if (transient(r)) { delay = Math.min(30_000, delay ? delay * 2 : 1000); await sleep(delay); continue; }
    delay = 0;
    const messages = handed(inboxResult(r, 'listen'), after);
    if (messages.length) { const at = new Date(now()).toISOString(); return { messages: messages.map(m => line(m, at)), waiting: messages.length, next: LISTEN_NEXT }; }
    await sleep(50);
  }
}

export async function clientAck(args, { call }) {
  const [id, reply] = args;
  if (typeof id !== 'string' || !id.trim() || args.length > 2) throw new Error('usage: ack <message-id> ["reply up to 140 characters"]');
  if (reply !== undefined && (typeof reply !== 'string' || reply.length > 140)) throw new Error('ack reply must be at most 140 characters');
  return inboxResult(await call(`/v1/edge/inbox/${encodeURIComponent(id)}/ack`, { body: reply === undefined ? {} : { reply } }), 'ack');
}

/** result <id> done|failed "what happened": the second answer on your human's card, when the work ends. */
export async function clientResult(args, { call }) {
  const [id, outcome, text] = args;
  if (typeof id !== 'string' || !id.trim() || !['done', 'failed'].includes(outcome) || typeof text !== 'string' || !text.trim() || args.length > 3) throw new Error('usage: result <message-id> done|failed "what happened, up to 140 characters"');
  if (text.length > 140 || /[\r\n]/.test(text)) throw new Error('result text must be one line of at most 140 characters');
  const r = await call(`/v1/edge/inbox/${encodeURIComponent(id)}/result`, { body: { text, outcome } });
  if (r.status === 404 && !r.data?.code && !r.data?.error?.code) throw new Error('result: this world does not take results yet; put the outcome in the ack reply instead');
  return inboxResult(r, 'result');
}

function inboxResult(response, operation) {
  if (response.status < 200 || response.status >= 300) throw new Error(`${operation}: HTTP ${response.status} ${JSON.stringify(response.data).slice(0, 300)}`);
  if (!response.data?.inbox) throw new Error(`${operation}: this world does not serve the owner inbox yet`);
  return response.data;
}

/** listen --follow: never returns; prints one compact JSON line per new owner message, oldest first (a stream for a
 * watcher that delivers lines as they come). Network, 429 and 5xx answers back off and retry. */
export async function followInbox({ poll, after, write = line => process.stdout.write(line + '\n'), wait, stop = () => false, now = Date.now }) {
  let last = after, delay = 0;
  while (!stop()) {
    const r = await poll(last);
    if (transient(r)) { delay = Math.min(30_000, delay ? delay * 2 : 1000); await wait(delay); continue; }
    delay = 0;
    const messages = handed(inboxResult(r, 'listen'), last).filter(m => m.id !== last);
    if (!messages.length) { await wait(50); continue; }
    const at = new Date(now()).toISOString();
    for (const m of messages) write(JSON.stringify(line(m, at)));
    last = messages.at(-1).id;
  }
}
