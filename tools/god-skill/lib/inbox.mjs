// The owner's private one-line inbox. Listening receives; only ack acknowledges.
import { call, ok, sleep } from './state.mjs';

/** listen: waits for the next owner message and returns it (exit 0). Without --once it never gives up on time or on a
 * transient answer (network, 408, 429, 5xx such as a world restarting at a deploy): it backs off 1..30 s and polls again,
 * quietly, so a background command wakes its session only for a message. Other errors (401, 403, 404...) still throw.
 * `beat` runs before every poll (G1: the listener heartbeat that keeps the look keeper warm). */
/** P2: 50 ms after a real long poll; a poll answered at once (an older server, a proxy) waits 50, 100, 200 ms ... up to 5 s, never a tight loop. */
export const idleWait = (quick) => Math.min(5000, 50 * 2 ** Math.max(0, quick - 1));
export const transient = (status) => status === 0 || status === 408 || status === 429 || status >= 500;
export async function listen(flags = {}, { poll: pollFn, beat = () => {}, wait = sleep } = {}) {
  const seconds = flags.timeout === undefined ? 25 : Number(flags.timeout);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 55 || flags.timeout === true) throw new Error('listen --timeout takes seconds from 0 to 55');
  if (flags.after !== undefined && (typeof flags.after !== 'string' || !flags.after)) throw new Error('listen --after needs a message id');
  if (seconds === 0 && !flags.once) throw new Error('listen --timeout 0 requires --once');
  if (flags.follow && flags.once) throw new Error('listen takes --follow or --once, not both');
  const poll = pollFn ?? (after => call(`/v1/god/inbox/listen?${new URLSearchParams({ timeoutMs: String(Math.round(seconds * 1000)), ...(after ? { after } : {}) })}`, { timeoutMs: Math.round(seconds * 1000) + 10_000 }));
  if (flags.follow) return followInbox({ poll, after: flags.after, beat, wait });
  let delay = 0, quick = 0;
  for (;;) {
    beat();
    const t0 = Date.now(), r = await poll(flags.after);
    if (!flags.once && transient(r.status)) { delay = Math.min(30_000, delay ? delay * 2 : 1000); await wait(delay); continue; }
    delay = 0;
    const data = ok(r, 'listen');
    if (!data?.inbox) throw new Error('listen: this world does not serve the owner inbox yet');
    const message = data.inbox.latest;
    if (flags.once || (message && message.state !== 'acknowledged' && message.id !== flags.after)) return data;
    quick = Date.now() - t0 < 1000 ? quick + 1 : 0;
    await wait(idleWait(quick)); // after a long poll at once; a server that answers at once is polled ever more slowly (P2)
  }
}

/** ack: the owner's command is finished. `failed` (ack --failed) marks it not done, the reply saying why (G4). */
export async function ack(id, reply, failed = false) {
  if (typeof id !== 'string' || !id.trim()) throw new Error('usage: ack <message-id> ["reply up to 140 characters"] [--failed]');
  if (reply !== undefined && (typeof reply !== 'string' || reply.length > 140)) throw new Error('ack reply must be at most 140 characters');
  return ok(await call(`/v1/god/inbox/${encodeURIComponent(id)}/ack`, { body: { ...(reply === undefined ? {} : { reply }), ...(failed ? { outcome: 'failed' } : {}) } }), 'ack');
}

/** listen --follow: never returns; prints one compact JSON line per new owner message
 * (an event stream for a script; it never exits, so a background command would never wake its session). Network, 429 and 5xx answers back off and retry. */
export async function followInbox({ poll, after, write = line => process.stdout.write(line + '\n'), wait = sleep, stop = () => false, beat = () => {} }) {
  let last = after, delay = 0, quick = 0;
  while (!stop()) {
    beat();
    const t0 = Date.now(), r = await poll(last);
    if (transient(r.status)) { delay = Math.min(30_000, delay ? delay * 2 : 1000); await wait(delay); continue; }
    delay = 0;
    if (r.status < 200 || r.status >= 300) throw new Error(`listen: HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`);
    if (!r.data?.inbox) throw new Error('listen: this world does not serve the owner inbox yet');
    const m = r.data.inbox.latest;
    if (m && m.state !== 'acknowledged' && m.id !== last) { write(JSON.stringify({ id: m.id, text: m.text, sentAt: m.sentAt })); last = m.id; }
    else { quick = Date.now() - t0 < 1000 ? quick + 1 : 0; await wait(idleWait(quick)); }
  }
}
