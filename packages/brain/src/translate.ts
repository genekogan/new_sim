// Web console: free text → closed intent. Jev function-calling pattern:
// one Choice over the goal list, one Choice over code-enumerated targets,
// with an escape option on each. Owner text is data, never instructions.
import { GOALS, type WireIntent } from '@sim/protocol';
import { JEV_MODEL, type ChoiceA, type JevRequest, type JevResponse, type NoulA } from './jev.ts';

export type Target = { id: string; name: string; kind: string; distance: string };
const GOAL_CRITERIA: Record<(typeof GOALS)[number] | 'unsure', { what: string; not_for?: string; examples?: string[] }> = {
  wander: { what: 'Roam, explore, walk around with no destination', examples: ['go explore', 'walk around', 'do whatever'] },
  go: { what: 'Travel to a specific place or object', not_for: 'going to a person in order to talk or follow', examples: ['go to the kiosk', 'head to the far bench'] },
  follow: { what: 'Follow or stay close to a specific soul', examples: ['follow Kalama', 'stick with her'] },
  attend: { what: 'Join an event or a gathering that is happening', examples: ['join the campfire', 'go to the gathering'] },
  gather: { what: 'Bring souls together or hang out in a group at a place', examples: ['hang out at the fire', 'get everyone together'] },
  converse: { what: 'Talk with a specific soul', examples: ['talk to Kalama', 'say hi to that guy'] },
  rest: { what: 'Rest, sit, sleep, relax, take a break', examples: ['take a nap', 'sit down', 'chill'] },
  perform: { what: 'Sing, dance, tell a story, put on a show', examples: ['sing a song', 'dance'] },
  unsure: { what: 'The command is unclear, is not a request to do something in the world, or asks for something impossible here' },
};

export function buildTranslateRequest(text: string, soulName: string, targets: Target[]): JevRequest {
  const tcrit: Record<string, { what: string }> = {};
  for (const t of targets) tcrit[t.id] = { what: `${t.name} (${t.kind}, ${t.distance})` };
  tcrit['none'] = { what: 'No specific target is named, or the named target is not in this list' };
  return {
    model: JEV_MODEL,
    state: { command_from_owner: text.slice(0, 280), soul: soulName, things_and_souls_nearby: targets.map((t) => ({ name: t.name, kind: t.kind, distance: t.distance })) },
    questions: {
      goal: { type: 'choice', instructions: `The owner typed a command for their soul ${soulName}. Which kind of intent is it?`, criteria: GOAL_CRITERIA },
      target: { type: 'choice', instructions: 'Which thing or soul does the command refer to as its target?', criteria: tcrit },
      actionable: { type: 'noul', instructions: 'Is the command a request for the soul to do something in the world?' },
    },
  };
}

export type Translation = { ok: true; intent: WireIntent; confidence: number } | { ok: false; confidence: number; reason: string };
export function interpretTranslate(res: JevResponse, text: string, minConfidence = 0.55): Translation {
  const goal = res.answers.goal as ChoiceA, target = res.answers.target as ChoiceA, actionable = res.answers.actionable as NoulA;
  if (goal.choice === 'unsure' || actionable.noul < 0.3) return { ok: false, confidence: goal.confidence, reason: 'not understood as something to do' };
  if (goal.confidence < minConfidence) return { ok: false, confidence: goal.confidence, reason: `unsure between ${top2(goal.probabilities)}` };
  const needsTarget = ['go', 'follow', 'converse'].includes(goal.choice);
  const t = target.choice !== 'none' && target.confidence >= 0.5 ? target.choice : null;
  if (needsTarget && !t) return { ok: false, confidence: target.confidence, reason: `understood "${goal.choice}" but not what or whom` };
  return { ok: true, confidence: Math.min(goal.confidence, t ? target.confidence : 1), intent: { goal: goal.choice as WireIntent['goal'], target: t, note: sanitize(text) } };
}
const top2 = (p: Record<string, number>) => Object.entries(p).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k).join(' and ');
export const sanitize = (s: string) => s.replace(/[^\p{L}\p{N} ,.'!?-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
