// `subscribe` — push a Soul's stream to a webhook (EDGE-CONTRACT-v1 §5). The body is
// exactly a `wait` response; `X-Eden-Signature` is the lowercase hex HMAC-SHA256 of the
// raw body under the subscriber's secret. The subscription keeps its own cursor and
// advances it only on a 2xx response; failures back off up to five minutes.
// Only https URLs to public-looking hosts are accepted (no loopback/private literals), and a redirect is a failed
// delivery (SEC2: following one would let a public URL bounce the POST to a loopback or metadata address).
import {createHmac} from 'node:crypto';
import type {EdgeSoul} from '../contract.ts';
import {EDGE_CONTRACT, EdgeError} from '../contract.ts';
import type {CommsCore} from './core.ts';
import {cursorOf} from './stream.ts';

export type Fetch = (url: string, init: {method: string; headers: Record<string, string>; body: string; redirect?: 'manual'; signal?: AbortSignal}) => Promise<{ok: boolean; status: number}>;
type Sub = {soul_id: string; url: string; secret: string; cursor: number; failures: number};

const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\..*|10\..*|192\.168\..*|169\.254\..*|172\.(1[6-9]|2[0-9]|3[01])\..*|\[.*\]|::1?)$/i;

export function signature(secret: string, body: string) { return createHmac('sha256', secret).update(body).digest('hex'); }

export function validateSubscription(input: {url?: unknown; secret?: unknown}) {
  if (typeof input.url !== 'string' || input.url.length > 500) throw new EdgeError(400, 'invalid', 'url must be an https URL');
  let u: URL;
  try { u = new URL(input.url); } catch { throw new EdgeError(400, 'invalid', 'url must be an https URL'); }
  if (u.protocol !== 'https:' || u.username || u.password || PRIVATE_HOST.test(u.hostname)) throw new EdgeError(400, 'invalid', 'url must be an https URL on a public host');
  if (typeof input.secret !== 'string' || input.secret.length < 16 || input.secret.length > 200) throw new EdgeError(400, 'invalid', 'secret must be 16..200 characters');
  return {url: u.toString(), secret: input.secret};
}

export class Webhooks {
  private busy = new Set<string>();
  private retryAt = new Map<string, number>();
  private timers = new Set<NodeJS.Timeout>();
  private core: CommsCore; private fetcher: Fetch | undefined;
  constructor(core: CommsCore, fetcher: Fetch | undefined) {
    this.core = core; this.fetcher = fetcher;
    core.streams.onEvent(soulId => { void this.push(soulId); });
  }
  subscribe(soul: EdgeSoul, input: {url?: unknown; secret?: unknown}) {
    const {url, secret} = validateSubscription(input);
    const cursor = this.core.streams.head(soul.soulId);
    this.core.db.prepare('INSERT INTO edge_comms_subscriptions (world_id, soul_id, url, secret, cursor, created_at, failures) VALUES (?,?,?,?,?,?,0) ON CONFLICT (world_id, soul_id) DO UPDATE SET url = excluded.url, secret = excluded.secret, cursor = excluded.cursor, failures = 0')
      .run(this.core.worldId, soul.soulId, url, secret, cursor, this.core.now());
    this.retryAt.delete(soul.soulId);
    return {subscription: {url, cursor: cursorOf(cursor)}};
  }
  unsubscribe(soul: EdgeSoul) {
    const r = this.core.db.prepare('DELETE FROM edge_comms_subscriptions WHERE world_id = ? AND soul_id = ?').run(this.core.worldId, soul.soulId);
    return {unsubscribed: Number(r.changes) > 0};
  }
  private sub(soulId: string) {
    return this.core.db.prepare('SELECT soul_id, url, secret, cursor, failures FROM edge_comms_subscriptions WHERE world_id = ? AND soul_id = ?').get(this.core.worldId, soulId) as Sub | undefined;
  }
  /** Deliver everything after the subscription's cursor; one in flight per Soul. */
  async push(soulId: string): Promise<void> {
    if (!this.fetcher || this.busy.has(soulId)) return;
    if ((this.retryAt.get(soulId) ?? 0) > Date.now()) return;
    let s = this.sub(soulId);
    if (!s) return;
    this.busy.add(soulId);
    try {
      for (let rounds = 0; s && rounds < 20; rounds++) {
        const page = this.core.streams.read(soulId, s.cursor, 50);
        if (!page.gap && !page.events.length) break;
        const body = JSON.stringify({contract: EDGE_CONTRACT, ...page});
        let ok = false;
        try {
          const res = await this.fetcher(s.url, {method: 'POST', headers: {'content-type': 'application/json', 'x-eden-signature': signature(s.secret, body), 'x-eden-contract': EDGE_CONTRACT}, body, redirect: 'manual', signal: AbortSignal.timeout(5000)});
          ok = res.ok;
        } catch { ok = false; }
        const next = Number(page.cursor.slice(2));
        if (ok) {
          this.core.db.prepare('UPDATE edge_comms_subscriptions SET cursor = ?, failures = 0 WHERE world_id = ? AND soul_id = ? AND url = ?').run(next, this.core.worldId, soulId, s.url);
          this.retryAt.delete(soulId);
        } else {
          const failures = s.failures + 1;
          this.core.db.prepare('UPDATE edge_comms_subscriptions SET failures = ? WHERE world_id = ? AND soul_id = ?').run(failures, this.core.worldId, soulId);
          const delay = Math.min(300_000, 1000 * 2 ** Math.min(failures, 9));
          this.retryAt.set(soulId, Date.now() + delay);
          const t = setTimeout(() => { this.timers.delete(t); void this.push(soulId); }, delay); t.unref?.(); this.timers.add(t);
          break;
        }
        s = this.sub(soulId);
      }
    } finally { this.busy.delete(soulId); }
  }
  close() { for (const t of this.timers) clearTimeout(t); this.timers.clear(); }
}
