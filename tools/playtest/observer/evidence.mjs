// observer/evidence.mjs — one evidence pack per owner request (DESIGN §4.2): what the world, the card and the camera
// showed from the moment the owner sent a message until the cutoff. Writes <runDir>/evidence/<requestId>.json.
// Bodies over 256 KB (raw route bodies kept on samples, or a legible innerText) go to evidence/raw/<sha>.json.gz;
// the pack keeps a projection in their place: {omitted:true, raw:'raw/<sha>.json.gz', sha, bytes, projection}, and
// lists every spilled path in `omitted`.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { now } from '../lib/clock.mjs';
import { sha256 } from '../lib/hash.mjs';

export const MAX_INLINE = 256 * 1024;
const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const bodyKey = (s) => s ? JSON.stringify([s.place, s.posture, s.activity, s.pos ? [Math.round(s.pos.x * 10), Math.round(s.pos.z * 10)] : null]) : null;

/** Small, readable stand-in for a big body: its keys, scalars, and array lengths. */
export function projectBody(v, depth = 0) {
  if (v == null || typeof v !== 'object') return typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '…' : v;
  if (Array.isArray(v)) return { _array: v.length, first: depth < 1 && v.length ? projectBody(v[0], depth + 1) : undefined };
  if (depth >= 2) return { _keys: Object.keys(v).length };
  return Object.fromEntries(Object.entries(v).slice(0, 40).map(([k, x]) => [k, projectBody(x, depth + 1)]));
}

/** Spill one value if its JSON is over the limit. → replacement value (the original when small). */
export function spill(value, { runDir, limit = MAX_INLINE, path, omitted }) {
  const json = JSON.stringify(value);
  if (json == null || json.length <= limit) return value;
  const sha = sha256(json), rel = `raw/${sha}.json.gz`, file = join(runDir, 'evidence', rel);
  mkdirSync(join(runDir, 'evidence', 'raw'), { recursive: true });
  if (!existsSync(file)) writeFileSync(file, gzipSync(json));
  omitted.push(path);
  return { omitted: true, raw: rel, sha, bytes: json.length, projection: projectBody(value) };
}

/** openRequest({runDir, seat, soulId, requestId, text, channel, sentAt, budgetSec?}) → RequestEvidence
 *  sentAt: epoch ms or ISO. requestId: the inbox message id (msg_…) when the channel is the card. */
export function openRequest({ runDir, seat, soulId = null, requestId, text, channel = 'card', sentAt = Date.now(), budgetSec = null, limit = MAX_INLINE }) {
  const sentMs = typeof sentAt === 'number' ? sentAt : Date.parse(sentAt);
  const ev = { requestId, seat, soulId, text, channel, sentAt: iso(sentMs), budgetSec, queuedSec: null, budgetStartAt: null, ackAt: null, ackText: null, resultAt: null, resultText: null,
    resultState: null, cutoffAt: null, cutoffReason: null, samples: [], receipts: [], shots: [], chatTurns: [], legible: [],
    firstBodyChangeAt: null, firstBodyChangeMono: null, serverErrors: 0, cost: {}, cardSeen: { ackAt: null, resultAt: null } };
  const seenReceipts = new Map();
  let baseKey = null, closed = false;
  const mine = (latest) => latest && (latest.id === requestId || (!String(requestId).startsWith('msg_') && latest.text === text));
  const api = {
    evidence: ev,
    /** sample({snap?, legible?, shot?}) — on each sampler tick and on card changes. Any part may be missing. */
    sample({ snap = null, legible = null, shot = null } = {}) {
      if (closed) return;
      if (snap) {
        ev.samples.push(snap);
        const latest = snap.inbox?.latest;
        if (mine(latest)) {
          if (latest.reply && !ev.ackText) { ev.ackText = latest.reply; ev.ackAt = iso(latest.acknowledgedAt) ?? snap.t; }
          if (latest.result && !ev.resultText) { ev.resultText = latest.result; ev.resultAt = iso(latest.resultAt) ?? snap.t; }
          if (latest.outcome) ev.resultState = latest.outcome;
        }
        for (const r of snap.receipts ?? []) if (!seenReceipts.has(r.id) || seenReceipts.get(r.id).phase !== r.phase) seenReceipts.set(r.id, r);
        const k = bodyKey(snap);
        if (baseKey == null) baseKey = k; else if (!ev.firstBodyChangeAt && k !== baseKey) { ev.firstBodyChangeAt = snap.t; ev.firstBodyChangeMono = snap.mono; }
      }
      if (legible) {
        const c = now(), row = { t: c.t, mono: c.mono, ...legible };
        ev.legible.push(row);
        if (legible.card?.ack && !ev.cardSeen.ackAt) ev.cardSeen.ackAt = c.t;
        if (legible.card?.result && !ev.cardSeen.resultAt) ev.cardSeen.resultAt = c.t;
      }
      if (shot) ev.shots.push(typeof shot === 'string' ? shot : shot.path);
    },
    addChatTurn(id) { if (id != null && !ev.chatTurns.includes(id)) ev.chatTurns.push(id); },
    /** A chat message waits for the seat's running turn (Claude Code queues typed input to the next turn boundary):
     *  queuedSec = sentAt → start of the turn that carried it; the request budget runs from budgetStartAt. */
    setQueue({ queuedSec = null, budgetStartAt = null } = {}) { ev.queuedSec = queuedSec; ev.budgetStartAt = budgetStartAt; },
    addServerErrors(n) { ev.serverErrors += n | 0; },
    setCost(cost) { ev.cost = { ...ev.cost, ...cost }; },
    /** close({cutoffReason, cutoffAt?}) → the written pack (with `file`). */
    close({ cutoffReason = 'closed', cutoffAt = null } = {}) {
      closed = true;
      ev.cutoffAt = cutoffAt ?? now().t; ev.cutoffReason = cutoffReason;
      ev.receipts = [...seenReceipts.values()];
      const omitted = [];
      const out = { ...ev, omitted };
      out.samples = ev.samples.map((s, i) => {
        if (!s.raw) return spill(s, { runDir, limit, path: `samples[${i}]`, omitted });
        const raw = Object.fromEntries(Object.entries(s.raw).map(([k, v]) => [k, spill(v, { runDir, limit, path: `samples[${i}].raw.${k}`, omitted })]));
        return { ...s, raw };
      });
      out.legible = ev.legible.map((l, i) => {
        const raw = spill(l.raw, { runDir, limit, path: `legible[${i}].raw`, omitted });
        return spill({ ...l, raw }, { runDir, limit, path: `legible[${i}]`, omitted });
      });
      const file = join(runDir, 'evidence', `${requestId}.json`);
      mkdirSync(join(runDir, 'evidence'), { recursive: true });
      writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
      return { ...out, file };
    },
  };
  return api;
}
