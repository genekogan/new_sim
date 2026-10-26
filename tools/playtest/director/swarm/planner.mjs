// The agent above the seats: decomposes the cast brief into per-seat directions an owner would write on each Soul's
// card. One `claude -p` call (no tools) at the start when cast.orchestrator.planner names a model; deterministic
// templates otherwise, and for any direction the model leaves out or gets wrong. Nudges stay templated.
import { join } from 'node:path';
import { writeJson } from '../../lib/jsonl.mjs';
import { callModel } from '../../lib/claude-p.mjs';
import { economyOf } from './cast.mjs';

const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] ?? 'th'}`;
const nameOf = (cast, id) => cast.seats.find((s) => s.id === id)?.soulName ?? id;

/** Template directions for one seat: {gather, prepare, go}. */
export function templateDirections(cast, seatId) {
  const s = cast.seats.find((x) => x.id === seatId);
  const k = cast.order.indexOf(seatId), n = cast.order.length;
  const prev = k > 0 ? nameOf(cast, cast.order[k - 1]) : null;
  const others = cast.order.filter((x) => x !== seatId).map((x) => nameOf(cast, x)).join(', ');
  const topic = s.topic ? ` about ${s.topic}` : '';
  return {
    gather: `${cast.brief} ${s.soulName}: ${s.character} The others are ${others}. Walk ${s.soulName} to ${cast.room.label} now and wait there with everyone. ${s.soulName} speaks ${ordinal(k + 1)} of ${n}${prev ? `, right after ${prev}` : ', first'}. Do not give the talk until I write "your turn".`,
    prepare: `${s.soulName} is next${prev ? `, right after ${prev}` : ''}. Get the talk ready now (2 to 4 sentences${topic}, in character) but do not say it yet; stay in ${cast.room.label} and listen.`,
    go: `Your turn: ${s.soulName} gives the talk now, out loud to the room with say, 2 to 4 sentences${topic}, in character. Then stop and listen to the others.`,
  };
}

/** Nudges and repairs (templated: they must be quick and predictable). */
export const NUDGE = {
  gather: (cast, s) => `${s.soulName} should be in ${cast.room.label} by now and the others are waiting. Walk there now, please.`,
  left: (cast, s) => `${s.soulName} has left ${cast.room.label}. Go back there now and wait for your turn.`,
  speak: (cast, s) => `It is ${s.soulName}'s turn now: say the talk out loud in ${cast.room.label} (say), 2 to 4 sentences, then stop.`,
  onboard: (base, s) => `Is my Soul ${s.soulName} ready yet? Finish setting it up from ${base}/instructions.md, keep listening for my messages, and tell me when it is ready.`,
  redirect: (s, text) => `Change of plan for ${s.soulName}: ${text}`,
  goOverride: (cast, s, text) => `Your turn: ${s.soulName} gives the talk now, out loud to the room with say, 2 to 4 sentences, in character: ${text} Then stop and listen.`,
};

/** Wrap a direction with the seat's token-economy guidance. */
export const withEconomy = (cast, level, text) => `${text} ${economyOf(cast, level).guidance}`.trim();

export function plannerPrompt(cast) {
  const seats = cast.order.map((id, i) => { const s = cast.seats.find((x) => x.id === id); return `${i + 1}. id "${id}", Soul "${s.soulName}": ${s.character}${s.topic ? ` Topic: ${s.topic}.` : ''}`; }).join('\n');
  return `You direct a scene in a shared virtual world. Each Soul below is played by its own AI agent, which only sees the short messages its owner writes on the Soul's card. You write those messages. The agents cannot see each other's messages; they only hear what the Souls say aloud in the world.

Brief: ${cast.brief}
Room: ${cast.room.label}
Presentation order:
${seats}

For each Soul write three card messages in plain owner language (no technical words, no commands, under 90 words each):
- "gather": who the Soul is (its character, in a sentence), the shared plan, walk to ${cast.room.label} now and wait, its place in the order and who it follows, and not to start until the owner writes "your turn".
- "prepare": it is next (after whom); get the talk ready in character but do not say it yet.
- "go": its turn now; give the talk aloud to the room (2 to 4 sentences, in character, on its topic), then stop and listen.

Answer with one JSON object only: {"seats": {"<id>": {"gather": "…", "prepare": "…", "go": "…"}, …}}`;
}

const okText = (t) => typeof t === 'string' && t.trim().length >= 20 && t.length <= 900;

/** plan({cast, runDir, call?}) → {source: 'model'|'template'|'mixed', seats: {id: {gather, prepare, go}}, model?, usage?} */
export async function plan({ cast, runDir = null, call = callModel, log = () => {} }) {
  const tmpl = Object.fromEntries(cast.order.map((id) => [id, templateDirections(cast, id)]));
  const model = cast.orchestrator?.planner ?? null;
  let out = { source: 'template', seats: tmpl };
  if (model) {
    let r = null;
    try { r = await call({ model, prompt: plannerPrompt(cast), effort: cast.orchestrator?.plannerEffort ?? null, maxWallSec: 240, tools: '' }); }
    catch (e) { log(`planner failed: ${e?.message ?? e}`); }
    const got = r?.json?.seats ?? null;
    let used = 0;
    const seats = Object.fromEntries(cast.order.map((id) => {
      const g = got?.[id] ?? {};
      const d = {}; for (const k of ['gather', 'prepare', 'go']) { if (okText(g[k])) { d[k] = g[k].trim(); used += 1; } else d[k] = tmpl[id][k]; }
      return [id, d];
    }));
    out = { source: used === 0 ? 'template' : used === cast.order.length * 3 ? 'model' : 'mixed', seats, model, usage: r?.usage ?? null, costUsd: r?.costUsd ?? null, wallMs: r?.wallMs ?? null, exit: r?.exit ?? null };
  }
  if (runDir) writeJson(join(runDir, 'director', 'plan.json'), out);
  return out;
}
