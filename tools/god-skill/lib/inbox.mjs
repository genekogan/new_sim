// The owner's private one-line inbox. Listening receives; only ack acknowledges.
import { call, ok, sleep } from './state.mjs';

export async function listen(flags = {}) {
  const seconds = flags.timeout === undefined ? 25 : Number(flags.timeout);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 55 || flags.timeout === true) throw new Error('listen --timeout takes seconds from 0 to 55');
  if (flags.after !== undefined && (typeof flags.after !== 'string' || !flags.after)) throw new Error('listen --after needs a message id');
  if (seconds === 0 && !flags.once) throw new Error('listen --timeout 0 requires --once');
  if (flags.follow && flags.once) throw new Error('listen takes --follow or --once, not both');
  if (flags.follow) return followInbox({ poll: after => call(`/v1/god/inbox/listen?${new URLSearchParams({ timeoutMs: String(Math.round(seconds * 1000)), ...(after ? { after } : {}) })}`, { timeoutMs: Math.round(seconds * 1000) + 10_000 }), after: flags.after });
  const query = new URLSearchParams({ timeoutMs: String(Math.round(seconds * 1000)), ...(flags.after ? { after: flags.after } : {}) });
  for (;;) {
    const data = ok(await call(`/v1/god/inbox/listen?${query}`, { timeoutMs: Math.round(seconds * 1000) + 10_000 }), 'listen');
    if (!data?.inbox) throw new Error('listen: this world does not serve the owner inbox yet');
    const message = data.inbox.latest;
    if (flags.once || (message && message.state !== 'acknowledged' && message.id !== flags.after)) return data;
    await sleep(50); // Avoid a tight loop if an older server returns immediately.
  }
}

export async function ack(id, reply) {
  if (typeof id !== 'string' || !id.trim()) throw new Error('usage: ack <message-id> ["reply up to 140 characters"]');
  if (reply !== undefined && (typeof reply !== 'string' || reply.length > 140)) throw new Error('ack reply must be at most 140 characters');
  return ok(await call(`/v1/god/inbox/${encodeURIComponent(id)}/ack`, { body: reply === undefined ? {} : { reply } }), 'ack');
}

/** listen --follow: never returns; prints one compact JSON line per new owner message
 * (a background Monitor's event stream). Network, 429 and 5xx answers back off and retry. */
export async function followInbox({ poll, after, write = line => process.stdout.write(line + '\n'), wait = sleep, stop = () => false }) {
  let last = after, delay = 0;
  while (!stop()) {
    const r = await poll(last);
    if (r.status === 0 || r.status === 429 || r.status >= 500) { delay = Math.min(30_000, delay ? delay * 2 : 1000); await wait(delay); continue; }
    delay = 0;
    if (r.status < 200 || r.status >= 300) throw new Error(`listen: HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`);
    if (!r.data?.inbox) throw new Error('listen: this world does not serve the owner inbox yet');
    const m = r.data.inbox.latest;
    if (m && m.state !== 'acknowledged' && m.id !== last) { write(JSON.stringify({ id: m.id, text: m.text, sentAt: m.sentAt })); last = m.id; }
    else await wait(50);
  }
}
