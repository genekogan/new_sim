// Cast files (tools/playtest/scenarios/casts/*.json): a world, N seats with characters, a shared brief, a presentation
// order and a success condition checkable from world truth. See STATUS-SWARM.md for the schema.
import { readFileSync } from 'node:fs';

export const ECONOMY = {
  // How much a seat may spend per direction: wake-turn cap (Seat.rails.maxTurnsPerRequest), turn wall, and the words
  // the direction carries so the agent knows to be brief.
  lean: { maxTurnsPerDirection: 2, maxTurnWallSec: 150, guidance: 'Keep it cheap: do just this with one or two commands, no exploring, then wait for my next message.' },
  normal: { maxTurnsPerDirection: 4, maxTurnWallSec: 240, guidance: 'Do just this, then wait for my next message.' },
  rich: { maxTurnsPerDirection: 6, maxTurnWallSec: 300, guidance: 'Take the time you need to do this well, then wait for my next message.' },
};

export const TIMING = { truthPollSec: 5, gatherMaxSec: 900, nudgeAfterSec: 150, maxNudges: 3, quietSec: 25, speakTimeoutSec: 240, maxSpeakNudges: 1, prepareAhead: true, presentWaitSec: 120 };
export const SUCCESS = { allPresent: true, minChars: 40, inOrder: true, eachOnce: true };

export function loadCast(file) { return normalizeCast(JSON.parse(readFileSync(file, 'utf8'))); }

/** Validate and fill defaults. Throws with every problem listed. */
export function normalizeCast(raw) {
  const errs = [];
  const c = { version: 1, seed: 1, durationSec: 2400, ...raw };
  if (c.kind !== 'cast') errs.push('kind must be "cast"');
  if (!c.name || !/^[a-z0-9-]+$/.test(c.name)) errs.push('name: lowercase letters, digits and -');
  if (!c.world || !['dev', 'url'].includes(c.world.kind)) errs.push('world.kind must be "dev" or "url"');
  if (c.world?.kind === 'dev' && !c.world.genesis) errs.push('world.genesis required for a dev world');
  if (typeof c.brief !== 'string' || !c.brief.trim()) errs.push('brief required');
  if (!c.room?.label || !Array.isArray(c.room?.match) || !c.room.match.length) errs.push('room.label and room.match[] required');
  if (!Array.isArray(c.seats) || !c.seats.length) errs.push('seats[] required');
  const ids = new Set();
  for (const [i, s] of (c.seats ?? []).entries()) {
    if (!s.id || !/^[a-z][a-z0-9-]*$/.test(s.id)) errs.push(`seats[${i}].id: lowercase word`);
    if (ids.has(s.id)) errs.push(`seats[${i}].id duplicate ${s.id}`);
    ids.add(s.id);
    if (!s.soulName) errs.push(`seats[${i}].soulName required`);
    if (!s.character) errs.push(`seats[${i}].character required`);
  }
  c.economy = { ...ECONOMY, ...(c.economy ?? {}) };
  for (const s of c.seats ?? []) if (s.economy && !c.economy[s.economy]) errs.push(`seat ${s.id}: unknown economy ${s.economy}`);
  c.order = c.order ?? (c.seats ?? []).map((s) => s.id);
  for (const id of c.order) if (!ids.has(id)) errs.push(`order: unknown seat ${id}`);
  if (new Set(c.order).size !== c.order.length) errs.push('order: a seat appears twice');
  c.timing = { ...TIMING, ...(c.timing ?? {}) };
  c.success = { ...SUCCESS, ...(c.success ?? {}) };
  c.orchestrator = { planner: null, plannerEffort: 'medium', ...(c.orchestrator ?? {}) };
  c.observer = { sampleSec: 15, cameras: ['follow', 'wide'], viewport: [1024, 640], dpr: 1, ...(c.observer ?? {}) };
  c.rails = { onboardWallSec: 600, onboardTimeoutSec: 540, onboardConcurrency: 4, quotaStopPct: 90, maxTurnsPerRequest: 6, maxTurnWallSec: 240, ...(c.rails ?? {}) };
  c.console = { script: [], ...(c.console ?? {}) };
  c.seats = (c.seats ?? []).map((s) => ({ adapter: 'claude-headless', model: 'haiku', effort: 'low', economy: 'lean', ...s }));
  if (errs.length) throw new Error(`cast ${c.name ?? '?'}: ${errs.join('; ')}`);
  return c;
}

export const economyOf = (cast, level) => cast.economy[level] ?? cast.economy.normal ?? ECONOMY.normal;

/** The run folder's scenario.json: the same shape `run` writes, so review/story/metrics read a direct session as any run.
 *  Review and developer are off by default (a session is a story first; `playtest.mjs review <run>` refers it later). */
export function castToScenario(cast) {
  return {
    name: cast.name, version: cast.version, seed: cast.seed, kind: 'direct',
    world: cast.world, durationSec: cast.durationSec,
    seats: cast.seats.map((s) => ({ id: s.id, adapter: s.adapter, model: s.model, effort: s.effort, soulName: s.soulName, persona: null, economy: s.economy, startOffsetSec: 0 })),
    god: null,
    director: { mode: 'swarm', brief: cast.brief, order: cast.order, room: cast.room },
    observer: cast.observer,
    review: { reviewer: false, developer: false, reviewerModel: 'opus', developerModel: 'opus', rubric: 'accept3', ...(cast.review ?? {}) },
    rails: cast.rails,
  };
}
