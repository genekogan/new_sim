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

export async function clientListen(args, { call, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), write, stop }) {
  let seconds = 25, after, once = false, follow = false;
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
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 55) throw new Error('listen --timeout takes seconds from 0 to 55');
  if (seconds === 0 && !once) throw new Error('listen --timeout 0 requires --once');
  if (follow) return followInbox({ poll: last => call(`/v1/edge/inbox/listen?${new URLSearchParams({ timeoutMs: String(Math.round(seconds * 1000)), ...(last ? { after: last } : {}) })}`, { timeoutMs: Math.round(seconds * 1000) + 10_000 }), after, wait: sleep, write, stop });
  const query = new URLSearchParams({ timeoutMs: String(Math.round(seconds * 1000)), ...(after ? { after } : {}) });
  for (;;) {
    const response = await call(`/v1/edge/inbox/listen?${query}`, { timeoutMs: Math.round(seconds * 1000) + 10_000 });
    const data = inboxResult(response, 'listen'), message = data.inbox.latest;
    if (once || (message && message.state !== 'acknowledged' && message.id !== after)) return data;
    await sleep(50);
  }
}

export async function clientAck(args, { call }) {
  const [id, reply] = args;
  if (typeof id !== 'string' || !id.trim() || args.length > 2) throw new Error('usage: ack <message-id> ["reply up to 140 characters"]');
  if (reply !== undefined && (typeof reply !== 'string' || reply.length > 140)) throw new Error('ack reply must be at most 140 characters');
  return inboxResult(await call(`/v1/edge/inbox/${encodeURIComponent(id)}/ack`, { body: reply === undefined ? {} : { reply } }), 'ack');
}

function inboxResult(response, operation) {
  if (response.status < 200 || response.status >= 300) throw new Error(`${operation}: HTTP ${response.status} ${JSON.stringify(response.data).slice(0, 300)}`);
  if (!response.data?.inbox) throw new Error(`${operation}: this world does not serve the owner inbox yet`);
  return response.data;
}

/** listen --follow: never returns; prints one compact JSON line per new owner message
 * (a background Monitor's event stream). Network, 429 and 5xx answers back off and retry. */
export async function followInbox({ poll, after, write = line => process.stdout.write(line + '\n'), wait, stop = () => false }) {
  let last = after, delay = 0;
  while (!stop()) {
    const r = await poll(last);
    if (r.status === 0 || r.status === 429 || r.status >= 500) { delay = Math.min(30_000, delay ? delay * 2 : 1000); await wait(delay); continue; }
    delay = 0;
    const m = inboxResult(r, 'listen').inbox.latest;
    if (m && m.state !== 'acknowledged' && m.id !== last) { write(JSON.stringify({ id: m.id, text: m.text, sentAt: m.sentAt })); last = m.id; }
    else await wait(50);
  }
}
