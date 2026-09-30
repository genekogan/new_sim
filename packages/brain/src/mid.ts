// Tier 2, the mid-brain. Code enumerates feasible activities (params already
// bound); Jev picks one by id. Jev never emits coordinates, ids or text.
import type { ActivityOption } from '@sim/engine-contract';
import { nextFloat, seedRng } from '@sim/engine-contract';
import { JEV_MODEL, sample, type ChoiceA, type JevRequest, type JevResponse, type NoulA, type ScoreA } from './jev.ts';

export const MOODS = ['content', 'curious', 'restless', 'lonely', 'tired', 'joyful', 'shy'] as const;
export const REEVAL_LEVELS = [
  'in a few seconds: things around are changing fast or the current activity just ended',
  'in about a minute: something mildly interesting is going on',
  'in several minutes: the situation is stable and the soul is settled',
];
/** Score level → seconds until the next scheduled evaluation. */
export const REEVAL_SECONDS = [8, 45, 180];

export type MidContext = {
  world: { time: string; weather: string; happening: string };
  soul: { name: string; about: string; intent: string; energy: string; mood: string; doing: string; recent: string[] };
  nearby: { who: string; what: string; distance: string; doing: string }[];
  nudge: string | null; // a narrator beat that applies to this soul, if any
  options: ActivityOption[];
  running: boolean; // an activity is still in progress
  trigger: string;
};

export function buildMidRequest(c: MidContext): JevRequest {
  const criteria: Record<string, { what: string; not_for?: string }> = {};
  for (const o of c.options) criteria[o.id] = { what: o.label, ...(o.notFor ? { not_for: o.notFor } : {}) };
  if (c.running) criteria['continue'] = { what: `Keep doing the current activity (${c.soul.doing})`, not_for: 'when the intent has just changed or the activity no longer serves it' };
  const state: Record<string, unknown> = {
    world: c.world,
    soul: { name: c.soul.name, about: c.soul.about, intent: c.soul.intent, energy: c.soul.energy, mood: c.soul.mood, doing_now: c.soul.doing, recently: c.soul.recent },
    nearby: c.nearby,
  };
  if (c.nudge) state.storyteller_suggests = c.nudge;
  return {
    model: JEV_MODEL,
    state,
    questions: {
      next: {
        type: 'choice',
        instructions: `Given ${c.soul.name}'s intent, personality, energy and what is nearby, what should ${c.soul.name} do next? The intent from the owner matters most; personality shapes how it is pursued.`,
        criteria,
      },
      reeval: { type: 'score', instructions: `How soon should ${c.soul.name} reconsider what to do?`, criteria: REEVAL_LEVELS },
      mood: { type: 'choice', instructions: `How does ${c.soul.name} feel right now?`, criteria: Object.fromEntries(MOODS.map((m) => [m, null])) },
      wants_company: { type: 'noul', instructions: `Does ${c.soul.name} want company right now?` },
    },
  };
}

export type MidDecision = {
  option: string;          // an ActivityOption id, or 'continue'
  chosenByModel: string;   // argmax before sampling
  probabilities: Record<string, number>;
  confidence: number;
  mood: string;
  reevalSeconds: number;
  wantsCompany: number;
  seed: string;
};

/** Turn Jev's answers into a decision. Sampling uses its own seeded RNG, never the world's. */
export function interpretMid(res: JevResponse, c: MidContext, seed: string): MidDecision {
  const next = res.answers.next as ChoiceA;
  const valid = new Set([...c.options.map((o) => o.id), ...(c.running ? ['continue'] : [])]);
  const probs: Record<string, number> = {};
  for (const [k, v] of Object.entries(next.probabilities)) if (valid.has(k)) probs[k] = v;
  const rng = seedRng(seed);
  let option = Object.keys(probs).length ? sample(probs, nextFloat(rng)) : (c.options[0]?.id ?? 'continue');
  // An explicit owner intent should not be diluted by sampling when the model is confident.
  if (next.confidence >= 0.75 && valid.has(next.choice)) option = next.choice;
  const reeval = res.answers.reeval as ScoreA | undefined;
  const level = Math.max(0, Math.min(REEVAL_SECONDS.length - 1, Math.round(reeval?.score ?? 1)));
  return {
    option, chosenByModel: next.choice, probabilities: probs, confidence: next.confidence,
    mood: (res.answers.mood as ChoiceA | undefined)?.choice ?? c.soul.mood,
    reevalSeconds: REEVAL_SECONDS[level],
    wantsCompany: (res.answers.wants_company as NoulA | undefined)?.noul ?? 0.5,
    seed,
  };
}

/** Deterministic default policy: used when the budget is exhausted or Jev fails. */
export function fallbackMid(c: MidContext, seed: string): MidDecision {
  const rng = seedRng(seed);
  const pick = c.running ? 'continue' : (c.options[Math.floor(nextFloat(rng) * c.options.length)]?.id ?? 'wander');
  return { option: pick, chosenByModel: pick, probabilities: { [pick]: 1 }, confidence: 0, mood: c.soul.mood, reevalSeconds: 60, wantsCompany: 0.5, seed };
}

/** Fingerprint of what the model would see; unchanged + still running ⇒ skip the call. */
export const fingerprint = (c: MidContext) => JSON.stringify([c.soul.intent, c.soul.energy, c.soul.doing, c.nearby, c.nudge, c.options.map((o) => o.id), c.world.happening]);
