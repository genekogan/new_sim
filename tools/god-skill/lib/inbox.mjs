// The owner's private one-line inbox. Listening receives; only ack acknowledges.
import { call, ok, sleep } from './state.mjs';

export async function listen(flags = {}) {
  const seconds = flags.timeout === undefined ? 25 : Number(flags.timeout);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 55 || flags.timeout === true) throw new Error('listen --timeout takes seconds from 0 to 55');
  if (flags.after !== undefined && (typeof flags.after !== 'string' || !flags.after)) throw new Error('listen --after needs a message id');
  if (seconds === 0 && !flags.once) throw new Error('listen --timeout 0 requires --once');
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
