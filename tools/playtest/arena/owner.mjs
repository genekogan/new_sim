// The Director's hands on a Soul's web card: the owner inbox route the card uses, as the seat's dev owner identity.
// DESIGN §4.1. Identities are dev user ids (agent-<hex>), never tokens.
export const ownerAuth = (identity) => ({ authorization: `Bearer dev:${String(identity).replace(/^dev:/, '')}` });

/** Pure request builders (tested on fixtures). */
export function sendCardRequest({ base, soulId, identity, text }) {
  if (!soulId) throw new Error('sendCard: soulId required');
  if (typeof text !== 'string' || !text.trim()) throw new Error('sendCard: text required');
  return { url: `${base}/v1/edge/owner/${encodeURIComponent(soulId)}/inbox`, init: { method: 'POST', headers: { ...ownerAuth(identity), 'content-type': 'application/json' }, body: JSON.stringify({ text }) } };
}
export function cardViewRequest({ base, soulId, identity }) {
  return { url: `${base}/v1/edge/owner/${encodeURIComponent(soulId)}/inbox`, init: { method: 'GET', headers: ownerAuth(identity) } };
}
export function publicSoulRequest({ base, soulId }) {
  return { url: `${base}/v1/edge/public/souls/${encodeURIComponent(soulId)}`, init: { method: 'GET' } };
}
export function ownerSoulRequest({ base, soulId, identity }) {
  return { url: `${base}/v1/souls/${encodeURIComponent(soulId)}`, init: { method: 'GET', headers: ownerAuth(identity) } };
}

async function call({ url, init }) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  let body = null; try { body = await r.json(); } catch { /* not json */ }
  if (!r.ok) { const e = new Error(`${init.method} ${new URL(url).pathname} → ${r.status} ${body?.code ?? body?.error?.code ?? ''}`); e.status = r.status; e.body = body; throw e; }
  return body;
}

/** Pull the message the send just stored out of the returned inbox view. */
export function sentMessage(res, text) {
  const inbox = res?.inbox ?? res;
  const latest = inbox?.latest ?? null;
  const pick = latest && (latest.text === text || !text) ? latest : (inbox?.messages ?? inbox?.queue ?? []).findLast?.((m) => m.text === text) ?? latest;
  return { messageId: pick?.id ?? null, sentAt: pick?.sentAt ?? null, state: pick?.state ?? null, inbox };
}

/** sendCard({base, soulId, identity, text}) → {messageId, sentAt, state, inbox} */
export async function sendCard(opts) { return sentMessage(await call(sendCardRequest(opts)), opts.text); }
/** cardView → the owner inbox view ({latest:{id,text,state,sentAt,ack?,result?...}, queued, presence, ...}) */
export async function cardView(opts) { return (await call(cardViewRequest(opts)))?.inbox ?? null; }
/** publicSoul → /v1/edge/public/souls/<id> (public truth: self.state, activity, placePath, receipts, fade) */
export async function publicSoul(opts) { return call(publicSoulRequest(opts)); }
/** ownerSoul → /v1/souls/<id> as the owner (position, doing, needs) */
export async function ownerSoul(opts) { return call(ownerSoulRequest(opts)); }

/** Compact card summary: {messageId, state, ackText, resultText, outcome, presence, queued, sentAt, ackAt, resultAt}. */
export function cardSummary(view) {
  const m = view?.latest ?? null;
  return { messageId: m?.id ?? null, text: m?.text ?? null, state: m?.state ?? null, ackText: m?.reply ?? null, resultText: m?.result ?? null, outcome: m?.outcome ?? null,
    sentAt: m?.sentAt ?? null, ackAt: m?.acknowledgedAt ?? null, resultAt: m?.resultAt ?? null, presence: view?.presence ?? null, queued: view?.queued ?? null, connected: view?.connected ?? null };
}
