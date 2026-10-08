/** VF1: Broadcast's "what to look at" — a small, cheap director above the shot solver.
 *
 * WorldBroadcast used to frame whichever Soul ranked first by activity (then by id), so every Soul that started
 * walking took the camera, and an empty lake or sky was a valid shot. This module decides *what* is worth
 * watching and *for how long*; the existing shot solver (mars Director) still decides *how* to frame it.
 *
 * - Interest, highest first: a conversation (two-shot), a presentation, a balloon ride, a Soul doing something
 *   (reading, dancing, painting, eating…), a group, company on a bench, a swimmer, a walker.
 * - When nothing scores above "walking", or on arrival, it holds an establishing landmark of the town, chosen
 *   where people are, with a slow drift.
 * - A choice is held at least `MIN_HOLD` seconds (conversations longer), is only interrupted by something much
 *   more interesting, and is retired after `MAX_HOLD` so the camera tours what is happening.
 * - A subject the solver can only frame small (lost in water/sky/terrain) is dropped for a while.
 * Pure logic over plain data, so it is unit-tested without a renderer. */

export type DirectorBody = { id: string; p: readonly number[]; activity?: string };
export type Landmark = { id: string; label: string; p: readonly [number, number, number]; target: readonly [number, number, number] };
export type DirectorInput = {
  bodies: readonly DirectorBody[];
  /** entity id → conversation thread and when it last spoke (seconds, same clock as `now`). */
  speaking: ReadonlyMap<string, { thread: string; at: number }>;
  now: number;
  /** Establishing views available in this world (empty: never a landmark). */
  landmarks: readonly Landmark[];
};
export type SubjectChoice = { kind: 'subjects'; key: string; label: string; score: number; focus: string; members: string[]; phase: string; twoShot: boolean };
export type LandmarkChoice = { kind: 'landmark'; key: string; label: string; score: number; landmark: Landmark; since: number };
export type DirectorChoice = SubjectChoice | LandmarkChoice;

export const MIN_HOLD = 8, CONVERSATION_MIN_HOLD = 12, MAX_HOLD = 24, CONVERSATION_MAX_HOLD = 36, LANDMARK_HOLD = 14, OPENING = 7;
/** Below this, nothing is happening: show the town. */
export const LANDMARK_SCORE = 2.5;
const IN_WATER_Y = -.8, NEAR = 3.2, GROUP = 6, CONVERSATION_RECENT = 40, BAN_SECONDS = 40, COOLDOWN = 30;

const WORKING = /dance|paint|garden|plant|eat|read|write|cook|drink|play|craft|yoga|stretch|jump|pushup|situp|browse|piano|game|wave|post-letter|work/;
const RESTING = /^(sit|warm|sit-ground|rest)$/;
export function activityScore(activity = ''): { score: number; label: string } {
  const a = activity.replace(/^mars:/, '');
  if (/present|talk-floor/.test(a)) return { score: 9, label: 'presenting' };
  if (/ride|balloon/.test(a)) return { score: 8, label: 'riding' };
  if (WORKING.test(a)) return { score: 6, label: 'busy' };
  if (/convers|talk|listen/.test(a)) return { score: 5, label: 'talking' };
  if (RESTING.test(a)) return { score: 2.5, label: 'resting' }; // with company it becomes 4; alone, see candidates()
  if (/swim|tread/.test(a)) return { score: .8, label: 'swimming' };
  if (/sleep|lie|nap/.test(a)) return { score: .3, label: 'sleeping' }; // asleep on a mat at night is not a show
  if (/walk|run|stroll/.test(a)) return { score: 1.5, label: 'walking' };
  return { score: 0.5, label: 'idle' };
}
const flat = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[2] - b[2]);

/** Every candidate worth a shot this moment, best first. */
export function candidates(input: DirectorInput): SubjectChoice[] {
  const bodies = input.bodies.filter(b => b.p.every(Number.isFinite));
  const byId = new Map(bodies.map(b => [b.id, b]));
  const out: SubjectChoice[] = [], inConversation = new Set<string>();
  // Conversations: Souls on the same thread who spoke recently and are still near one another.
  const threads = new Map<string, { ids: string[]; last: number }>();
  for (const [id, s] of input.speaking) {
    if (!byId.has(id) || input.now - s.at > CONVERSATION_RECENT) continue;
    const t = threads.get(s.thread) ?? { ids: [], last: -Infinity };
    t.ids.push(id); t.last = Math.max(t.last, s.at); threads.set(s.thread, t);
  }
  for (const [thread, t] of threads) {
    const ids = t.ids.sort();
    const anchor = byId.get(ids[0])!;
    const members = ids.filter(id => flat(byId.get(id)!.p, anchor.p) < 12).slice(0, 4);
    const recent = input.now - t.last < 10 ? 2 : 0;
    members.forEach(id => inConversation.add(id));
    out.push({ kind: 'subjects', key: 'conversation:' + thread, label: members.length > 1 ? 'conversation' : 'speaking', score: (members.length > 1 ? 10 : 7) + recent,
      focus: members[0], members, phase: 'conversing', twoShot: members.length > 1 });
  }
  // Native talk/listen circles (no edge feed): one candidate whose focus follows whoever is talking.
  for (const b of bodies) {
    if (inConversation.has(b.id) || !/talk|listen|convers/.test(b.activity ?? '') || /talk-floor/.test(b.activity ?? '')) continue;
    const circle = bodies.filter(o => !inConversation.has(o.id) && /talk|listen|convers/.test(o.activity ?? '') && flat(o.p, b.p) < NEAR).map(o => o.id).sort().slice(0, 4);
    if (circle.length < 2) continue;
    circle.forEach(id => inConversation.add(id));
    const speaker = circle.find(id => /^talk$|convers/.test(byId.get(id)!.activity ?? '')) ?? circle[0];
    out.push({ kind: 'subjects', key: 'talk:' + circle[0], label: 'conversation', score: 9, focus: speaker, members: circle, phase: 'conversing', twoShot: false });
  }
  for (const b of bodies) {
    if (inConversation.has(b.id)) continue;
    const near = bodies.filter(o => o.id !== b.id && flat(o.p, b.p) < NEAR);
    // A group counts when at least two of its members are doing something (not a row of sleepers or standers).
    const crowd = bodies.filter(o => flat(o.p, b.p) < GROUP), active = crowd.filter(o => activityScore(o.activity).score >= 2.5).length;
    let { score, label } = activityScore(b.activity);
    if (label === 'resting') { if (near.some(o => activityScore(o.activity).score >= 2.5)) { score = 4; label = 'company'; } else score = 2; } // alone on a bench: the tour is better
    const riding = b.p[1] > 4.5 && label !== 'swimming';
    if (riding) { score = Math.max(score, 8); label = 'riding'; }
    // A body below the ground line is in the water (pond, lake): from Broadcast distance the shot is all water,
    // whatever it is doing there. Never worth a shot of its own.
    if (label === 'swimming' || b.p[1] < IN_WATER_Y) { score = .8; label = 'swimming'; }
    if (label !== 'swimming' && label !== 'sleeping' && crowd.length >= 3 && active >= 2 && score < 4 + .5 * (crowd.length - 3)) {
      score = Math.min(6, 4 + .5 * (crowd.length - 3)); label = 'group';
    }
    const members = [b.id, ...near.map(o => o.id).sort()].slice(0, label === 'group' ? 6 : 3);
    if (label === 'group') for (const o of crowd) if (!members.includes(o.id) && members.length < 6) members.push(o.id);
    const phase = label === 'walking' ? 'walking' : label === 'presenting' ? 'presenting' : score >= 4 ? 'working' : 'idle';
    out.push({ kind: 'subjects', key: (label === 'group' ? 'group:' : 'soul:') + b.id, label, score, focus: b.id, members, phase, twoShot: false });
  }
  // One group per cluster: keep the best-scoring anchor of each overlapping group.
  const seen = new Set<string>();
  return out.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key)).filter(c => {
    if (!c.key.startsWith('group:')) return true;
    if (c.members.some(id => seen.has(id))) return false;
    c.members.forEach(id => seen.add(id)); return true;
  });
}

/** The landmark with the most people around it (ties: the one shown least recently). */
export function bestLandmark(input: DirectorInput, recent: readonly string[]): Landmark | null {
  if (!input.landmarks.length) return null;
  const crowd = (l: Landmark) => input.bodies.filter(b => Math.hypot(b.p[0] - l.target[0], b.p[2] - l.target[2]) < 30).length;
  const age = (l: Landmark) => { const i = recent.lastIndexOf(l.id); return i < 0 ? -1 : recent.length - i; };
  return [...input.landmarks].sort((a, b) => (crowd(b) - crowd(a)) || (age(a) - age(b)) || a.id.localeCompare(b.id))
    .find(l => recent.at(-1) !== l.id) ?? input.landmarks[0];
}

export class WorldDirector {
  current: DirectorChoice | null = null;
  since = -Infinity;
  private started: number | null = null;
  private banned = new Map<string, number>();
  private cooling = new Map<string, number>();
  private recentLandmarks: string[] = [];
  private landmarkRun = 0;
  reset() { this.current = null; this.since = -Infinity; this.started = null; this.banned.clear(); this.cooling.clear(); this.recentLandmarks = []; this.landmarkRun = 0; }
  /** The solver could only frame this choice small or not at all: leave it alone for a while. */
  reject(key: string, now: number) { this.banned.set(key, now + BAN_SECONDS); if (this.current?.key === key) this.since = -Infinity; }

  choose(input: DirectorInput): DirectorChoice | null {
    const now = input.now;
    // The opening starts when the town views are available (the Eden scenery may arrive a moment after people).
    if (input.landmarks.length) this.started ??= now;
    for (const [k, until] of this.banned) if (until <= now) this.banned.delete(k);
    for (const [k, until] of this.cooling) if (until <= now) this.cooling.delete(k);
    const all = candidates(input).filter(c => !this.banned.has(c.key));
    const cur = this.current, held = now - this.since;
    const curNow = cur?.kind === 'subjects' ? all.find(c => c.key === cur.key) ?? null : null;
    if (cur?.kind === 'subjects' && curNow && held >= (cur.phase === 'conversing' ? CONVERSATION_MAX_HOLD : MAX_HOLD)) {
      this.cooling.set(cur.key, now + COOLDOWN);
      // Variety: a long-held subject gives way to a wide view of the town (where the people are) for a while.
      if (input.landmarks.length) return this.landmark(input, now, false);
    }
    const effective = (c: SubjectChoice) => c.score - (this.cooling.has(c.key) ? 3 : 0);
    const best = [...all].sort((a, b) => effective(b) - effective(a) || a.key.localeCompare(b.key))[0] ?? null;
    // Opening: an establishing view of the town before the first cut, unless something big is on.
    if (input.landmarks.length && this.started !== null && now - this.started < OPENING && (!best || best.score < 9)) return this.landmark(input, now, true);
    if (cur?.kind === 'subjects') {
      if (curNow && !this.cooling.has(cur.key)) {
        const better = best && best.key !== cur.key ? effective(best) - curNow.score : -Infinity;
        const min = cur.phase === 'conversing' ? CONVERSATION_MIN_HOLD : MIN_HOLD;
        if (!(held >= 3 && better >= 4) && !(held >= min && better >= 1)) return this.keep(curNow);
      } else if (!curNow && held < 2) return cur; // briefly lost (a moment between chunks): hold the framing
    }
    if (cur?.kind === 'landmark' && held < LANDMARK_HOLD && !(best && effective(best) >= 6)) return cur;
    // Nothing is happening (walkers and idlers are not a show): the town tour.
    const threshold = !input.landmarks.length ? -Infinity : LANDMARK_SCORE;
    if (!best || effective(best) < threshold) return this.landmark(input, now, false);
    this.landmarkRun = 0;
    return best.key === cur?.key ? this.keep(best) : this.switchTo(best, now);
  }
  private keep(c: SubjectChoice) { const cur = this.current as SubjectChoice; this.current = { ...c, focus: c.twoShot && cur.focus && c.members.includes(cur.focus) ? cur.focus : c.focus }; return this.current; }
  private switchTo(c: DirectorChoice, now: number) { this.current = c; this.since = now; return c; }
  private landmark(input: DirectorInput, now: number, opening: boolean): DirectorChoice | null {
    const cur = this.current;
    if (cur?.kind === 'landmark' && (opening || now - this.since < LANDMARK_HOLD)) return cur;
    const l = opening ? input.landmarks[0] : bestLandmark(input, this.recentLandmarks);
    if (!l) return null;
    this.recentLandmarks = [...this.recentLandmarks, l.id].slice(-6);
    this.landmarkRun = cur?.kind === 'landmark' ? this.landmarkRun + 1 : 1;
    return this.switchTo({ kind: 'landmark', key: 'landmark:' + l.id, label: l.label, score: LANDMARK_SCORE, landmark: l, since: now }, now);
  }
}

/** A landmark pose with a slow drift: a few degrees of orbit and a gentle push-in over the hold. */
export function landmarkPose(l: Landmark, seconds: number): { position: [number, number, number]; target: [number, number, number]; fov: number } {
  const [px, py, pz] = l.p, [tx, ty, tz] = l.target;
  const k = Math.min(1, Math.max(0, seconds / LANDMARK_HOLD));
  const ease = k * k * (3 - 2 * k);
  const angle = (ease - .5) * 0.07, push = 1 - 0.05 * ease;
  const dx = px - tx, dz = pz - tz, c = Math.cos(angle), s = Math.sin(angle);
  return { position: [tx + (dx * c - dz * s) * push, ty + (py - ty) * push, tz + (dx * s + dz * c) * push], target: [tx, ty, tz], fov: 45 };
}
