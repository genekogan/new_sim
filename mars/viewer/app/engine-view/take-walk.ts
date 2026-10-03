// Walked distance along a recorded take track (three-free: shared by TakePeople and the chapter-set worker). The Walk
// clip's phase is a pure function of the metres walked (humans.ts: clip seconds = metres / clip ground speed), so a
// chapter set carries each walker's total from one chapter into the next (STUDIO_REPLAY.md "Chapter sets: playback").
import { POS_Q, type PoseSample, type Take } from '../../engine/take/types.ts';

/** Cumulative horizontal metres at each sample of a pose track (x = s[1], z = s[3], integer mm). */
export function walkCum(s: PoseSample[]): number[] {
  const cum = [0];
  for (let i = 1; i < s.length; i++) cum.push(cum[i - 1] + Math.hypot(s[i][1] - s[i - 1][1], s[i][3] - s[i - 1][3]) / POS_Q);
  return cum;
}

/** Metres each person of the take walks over the whole take (the last value of walkCum), by id; 0-length tracks omitted. */
export function walkTotals(take: Take): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, s] of Object.entries(take.tracks)) {
    if ((take.finalState.entities[id] ?? take.entities0?.[id])?.kind !== 'human' || !s.length) continue;
    out[id] = walkCum(s)[s.length - 1];
  }
  return out;
}
