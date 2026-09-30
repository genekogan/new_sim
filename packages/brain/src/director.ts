// Tier 2b: broadcast camera director + spectator ticker, one Jev request.
// Code enumerates candidate shots (Mars ShotSpec shapes); Jev picks by id.
// Per-event Nouls ride along in the same request (fan-out) to pick ticker lines.
import { JEV_MODEL, type ChoiceA, type JevRequest, type JevResponse, type NoulA } from './jev.ts';

/** Mars viewer/engine/camera/shots.ts ShotSpec subset. */
export type ShotSpec =
  | { kind: 'follow'; subject: string; offset: [number, number, number]; lookHeight?: number }
  | { kind: 'orbit'; subject?: string; center?: [number, number, number]; radius: number; height: number; period: number }
  | { kind: 'frameGroup'; subjects: string[]; azimuth: number; elevation: number; padding?: number }
  | { kind: 'establishing'; region: { min: [number, number]; max: [number, number] }; azimuth?: number; elevation?: number };
export type ShotCandidate = { id: string; text: string; why: string; notFor?: string; spec: ShotSpec };
export type DirectorContext = {
  current: { id: string; text: string; held: string } | null;
  happening: string[];
  candidates: ShotCandidate[];
  events: { id: string; text: string }[]; // candidate ticker lines
};

export function buildDirectorRequest(c: DirectorContext): JevRequest {
  const criteria: Record<string, { what: string; not_for?: string }> = {};
  for (const s of c.candidates) criteria[s.id] = { what: `${s.text}. ${s.why}`, ...(s.notFor ? { not_for: s.notFor } : {}) };
  if (c.current) criteria['hold'] = { what: `Stay on the current shot (${c.current.text})`, not_for: 'when it has been held a long time or something more interesting started elsewhere' };
  const questions: JevRequest['questions'] = {
    shot: { type: 'choice', instructions: 'You are directing a live broadcast of a small world for spectators. Which shot should the camera take now? Prefer where something is happening; avoid cutting too often.', criteria },
  };
  for (const e of c.events.slice(0, 12)) questions[`announce_${e.id}`] = { type: 'noul', instructions: `Is this worth announcing to spectators as a one-line ticker item: "${e.text}"?` };
  return { model: JEV_MODEL, state: { current_shot: c.current ? { shot: c.current.text, held_for: c.current.held } : 'none yet', happening_now: c.happening }, questions };
}

export function interpretDirector(res: JevResponse, c: DirectorContext) {
  const shot = res.answers.shot as ChoiceA;
  const chosen = shot.choice === 'hold' ? null : (c.candidates.find((s) => s.id === shot.choice) ?? null);
  const announce = c.events.filter((e) => ((res.answers[`announce_${e.id}`] as NoulA | undefined)?.noul ?? 0) >= 0.6);
  return { hold: shot.choice === 'hold' || !chosen, chosen, confidence: shot.confidence, announce };
}

/** On-demand cinematic shot for one soul (owner view). */
export function buildShotRequest(soul: { name: string; doing: string }, candidates: ShotCandidate[]): JevRequest {
  const criteria: Record<string, { what: string; not_for?: string }> = {};
  for (const s of candidates) criteria[s.id] = { what: `${s.text}. ${s.why}`, ...(s.notFor ? { not_for: s.notFor } : {}) };
  return { model: JEV_MODEL, state: { soul }, questions: { shot: { type: 'choice', instructions: `Which camera shot is the most cinematic way to show ${soul.name} right now?`, criteria } } };
}
