// In-memory fakes for the Director's collaborators (arena seat/owner, observer camera/evidence, persona) + a virtual
// clock, so the loop runs end to end under node --test with no world, browser or model.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

/** Virtual clock: sleep() registers a timer; time jumps to the earliest timer once the event loop is idle. */
export function fakeClock(startMs = 0) {
  let t = startMs, seq = 0, scheduled = false;
  const q = [];
  const pump = () => {
    scheduled = false;
    if (!q.length) return;
    q.sort((a, b) => a.at - b.at || a.seq - b.seq);
    const x = q.shift();
    if (x.at > t) t = x.at;
    x.resolve();
    if (q.length) schedule();
  };
  const schedule = () => { if (!scheduled) { scheduled = true; setImmediate(pump); } };
  return { now: () => t, sleep: (ms) => new Promise((resolve) => { q.push({ at: t + Math.max(0, ms), seq: seq++, resolve }); schedule(); }) };
}

/** A seat: chat() takes turnMs of virtual time and appends a rendered exchange; turnCount counts turns. */
export function fakeSeat({ id, soulId = `soul-${id}`, identity = `agent-${id}`, clock, turnMs = 5000, reply = (text) => `ok, ${text}`, secret = '' }) {
  const turns = [];
  const calls = [];
  const godCards = [];
  return {
    id, soulId, identity, soulName: `Soul ${id}`, calls, turns, godCards,
    turnCount: () => turns.length,
    async chat(text, { reason, onStart } = {}) {
      calls.push({ text, reason, at: clock.now() });
      onStart?.({ turn: turns.length + 1, reason, startedAt: new Date().toISOString(), startMono: clock.now() });
      await clock.sleep(turnMs);
      const rendered = `> ${text}\n⏺ ${reply(text)} ${secret}`.trim();
      turns.push({ text, rendered, endedAt: clock.now() });
      return { turn: turns.length, finalText: reply(text) };
    },
    renderedChatSince(n) { return { text: turns.slice(n).map((x) => x.rendered).join('\n'), lastTurn: turns.length }; },
    async sendGodCard({ text }) { godCards.push({ text, at: clock.now() }); return { messageId: `g-${godCards.length}` }; },
    async cardView() { const l = godCards.at(-1); return l ? { latest: { id: `g-${godCards.length}`, text: l.text, state: 'queued' } } : {}; },
  };
}

/** The owner's card: ack after ackMs, result after resultMs (null = never). Per-soul inboxes. */
export function fakeOwner({ clock, ackMs = 2000, resultMs = 20000, resultFor = null }) {
  const inbox = new Map();
  const sent = [];
  let n = 0;
  return {
    sent,
    async sendCard({ soulId, identity, text }) {
      const m = { id: `m-${++n}`, soulId, identity, text, sentAt: clock.now() };
      sent.push(m);
      if (!inbox.has(soulId)) inbox.set(soulId, []);
      inbox.get(soulId).push(m);
      return { messageId: m.id, sentAt: m.sentAt };
    },
    async cardView({ soulId }) {
      const list = inbox.get(soulId) ?? [];
      const l = list.at(-1);
      if (!l) return { presence: 'listening', queued: [] };
      const age = clock.now() - l.sentAt;
      const rMs = resultFor ? resultFor(l.text) : resultMs;
      const latest = { id: l.id, text: l.text, state: 'sent' };
      if (age >= ackMs) { latest.state = 'acked'; latest.ack = `on it: ${l.text}`; }
      if (rMs != null && age >= rMs) { latest.state = 'done'; latest.result = `did: ${l.text}`; }
      return { latest, presence: 'listening', queued: [] };
    },
  };
}

/** Observer: per-seat cameras that write a 1x1 PNG and return seat-specific legible text; evidence records. */
export function fakeObserver({ clock, legibleFor = (seat) => ({ card: { name: `Soul ${seat}`, presence: 'listening' }, bubbles: [`hello near ${seat}`] }) }) {
  const opened = [], closed = [], shots = [];
  return {
    opened, closed, shots,
    camera(seat) {
      return {
        async shot(path) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, PNG_1x1); shots.push({ seat, path, at: clock.now() }); return { mono: clock.now() }; },
        async legible() { return legibleFor(seat); },
      };
    },
    evidence: {
      openRequest(args) {
        const rec = { ...args, openedAt: clock.now(), samples: 0 };
        opened.push(rec);
        rec.chatTurns = []; rec.queue = null;
        return { sample() { rec.samples += 1; }, addChatTurn(t) { rec.chatTurns.push(t); }, setQueue(q) { rec.queue = q; }, close({ cutoffReason }) { closed.push({ requestId: args.requestId, cutoffReason, at: clock.now() }); } };
      },
    },
  };
}

/** Persona that returns scripted decisions (array, cycled at its end, or fn(shown, n)) and keeps every shown it got. */
export function fakePersona({ decisions, final = { say: null, waitSec: 0, rating: { fun: 3, alive: 3 }, desires: [], complaints: [], done: true }, meta = { glanceSec: [10, 30] } }) {
  const received = [];
  let n = 0;
  return {
    meta, received,
    async step({ shown }) {
      received.push(shown);
      const d = typeof decisions === 'function' ? decisions(shown, n) : decisions[Math.min(n, decisions.length - 1)];
      n += 1;
      return { say: null, waitSec: 20, thought: '', rating: null, desires: [], complaints: [], quick: false, done: false, ...d };
    },
    async finalRating() { return final; },
  };
}
