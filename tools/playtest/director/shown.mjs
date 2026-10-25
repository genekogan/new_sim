// Compose what a persona is shown at one glance, deterministically, as plain text (no ids, no internals).
export const LIMITS = { legible: 1500, chat: 2500, card: 800, requests: 1500, item: 300 };

/** Cut s to n chars; keep the head (default) or the tail, marking the cut. */
export function clip(s, n, { tail = false } = {}) {
  s = s == null ? '' : String(s);
  if (s.length <= n) return s;
  const mark = tail ? '…(earlier part cut) ' : ' …(rest cut)';
  const keep = Math.max(0, n - mark.length);
  return tail ? mark + s.slice(s.length - keep) : s.slice(0, keep) + mark;
}

export function fmtElapsed(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

const str = (v) => (v == null ? '' : typeof v === 'string' ? v : typeof v === 'object' ? (v.text ?? v.label ?? v.name ?? '') : String(v));
const list = (a) => (Array.isArray(a) ? a.map(str).map((x) => clip(x.trim(), LIMITS.item)).filter(Boolean) : []);

/** Legible page text: the observer's {card, bubbles, signs, toasts, roster, raw} or a string. */
export function legibleText(legible) {
  if (legible == null) return '';
  if (typeof legible === 'string') return clip(legible.trim(), LIMITS.legible);
  const out = [];
  const c = legible.card;
  if (c && typeof c === 'object') {
    const bits = [c.name && `name: ${c.name}`, c.presence && `status: ${c.presence}`, c.ack && `heard: ${c.ack}`, c.result && `result: ${c.result}`].filter(Boolean);
    if (bits.length) out.push(`On the Soul card: ${bits.join(' · ')}`);
  }
  const sec = [['Speech', legible.bubbles], ['Signs and place names', legible.signs], ['Notices', legible.toasts], ['People listed', legible.roster]];
  for (const [label, arr] of sec) { const l = list(arr); if (l.length) out.push(`${label}: ${l.map((x) => `"${x}"`).join(', ')}`); }
  if (!out.length && legible.raw) out.push(String(legible.raw).trim());
  return clip(out.join('\n'), LIMITS.legible);
}

/** The card as the owner sees it: latest note, its state, ack line, result line, presence. Never ids. */
export function cardText(cardView) {
  if (cardView == null) return '';
  if (typeof cardView === 'string') return clip(cardView.trim(), LIMITS.card);
  const v = cardView;
  const latest = v.latest ?? v.message ?? null;
  const lines = [];
  if (latest) {
    const text = str(latest.text ?? latest.body);
    if (text) lines.push(`Your latest note: "${clip(text, LIMITS.item)}"${latest.state ? ` (${latest.state})` : ''}`);
    const ack = str(latest.ack ?? latest.ackText ?? v.ack ?? v.ackText);
    const res = str(latest.result ?? latest.resultText ?? v.result ?? v.resultText);
    if (ack) lines.push(`Heard line: ${clip(ack, LIMITS.item)}`);
    if (res) lines.push(`Result line: ${clip(res, LIMITS.item)}`);
  } else {
    const ack = str(v.ack ?? v.ackText); const res = str(v.result ?? v.resultText);
    if (ack) lines.push(`Heard line: ${clip(ack, LIMITS.item)}`);
    if (res) lines.push(`Result line: ${clip(res, LIMITS.item)}`);
  }
  const presence = str(v.presence);
  if (presence) lines.push(`Your Soul: ${presence}`);
  const q = Array.isArray(v.queued) ? v.queued.length : Number(v.queued) || 0;
  if (q) lines.push(`Notes still waiting: ${q}`);
  return clip(lines.join('\n'), LIMITS.card);
}

/** What the persona already asked, with timing: [{atSec, channel, text}]. Newest kept when cut. */
export function requestsText(reqs) {
  if (!Array.isArray(reqs) || !reqs.length) return '';
  const lines = reqs.map((r) => `- at ${fmtElapsed(r.atSec)} in the ${r.channel === 'chat' ? 'chat' : 'card'}: "${clip(str(r.text), LIMITS.item)}"`);
  return clip(lines.join('\n'), LIMITS.requests, { tail: true });
}

/** shown = {elapsedSec, screenshotPath, legible, cardView, chatRendered, lastRequests} → the glance text. */
export function composeShown(shown = {}) {
  const parts = [`[Glance at ${fmtElapsed(shown.elapsedSec)} since you started]`];
  parts.push(shown.screenshotPath
    ? `Your screen: ${shown.screenshotPath}\n(open that picture with your Read tool and look at it; it is what you see right now)`
    : 'Your screen: (you could not see the screen this time)');
  parts.push(`What you can read on the page:\n${legibleText(shown.legible) || '(nothing readable)'}`);
  parts.push(`The card:\n${cardText(shown.cardView) || '(empty)'}`);
  const chat = clip(String(shown.chatRendered ?? '').trim(), LIMITS.chat, { tail: true });
  parts.push(`New in the chat window since your last glance:\n${chat || '(nothing new)'}`);
  parts.push(`What you have asked so far:\n${requestsText(shown.lastRequests) || '(nothing yet)'}`);
  parts.push('Answer with the JSON object only.');
  return parts.join('\n\n');
}
