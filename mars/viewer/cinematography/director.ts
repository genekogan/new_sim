import type {
  Observation,
  Policy,
  Shot,
  OperatorIntent,
  Decision,
  Reply,
  Request,
} from './types.ts';
import { feasibleShots } from './shots.ts';
import { execute } from './physical.ts';
import type { CameraPose } from '../engine/camera/shots.ts';
export const POLICY = {
  clear: { hold: 4, threshold: 0.65 },
  restrained: { hold: 9, threshold: 1.1 },
};
export function rankShot(
  s: Shot,
  o: Observation,
  policy: Policy,
  recent: string[],
): number {
  let score = s.quality * 2;
  const focus = o.activity.focus ?? o.activity.speaker;
  const floorActive =
    o.activity.phase === 'presenting' || o.activity.phase === 'question';
  if (policy === 'clear') {
    if (s.intention === 'questioner' && s.subjects[0] === focus && floorActive)
      score += 4;
    else if (
      s.intention === 'speaker-display' &&
      s.subjects[0] === focus &&
      floorActive
    )
      score += 3;
    else if (
      s.intention === 'speaker' &&
      s.subjects[0] === focus &&
      floorActive
    )
      score += 2.5;
    else if (s.intention === 'establishing') score += 1;
  } else {
    if (
      s.intention === 'two-person' &&
      s.subjects.includes(focus ?? '') &&
      floorActive
    )
      score += 4;
    else if (s.intention === 'establishing') score += 2.6;
    else if (s.intention === 'speaker-display') score += 1.7;
  }
  if (
    o.activity.phase === 'arriving' ||
    o.activity.phase === 'departing' ||
    o.activity.phase === 'conversing'
  ) {
    if (s.intention === 'establishing') score += 3;
  }
  if (focus && s.subjects.includes(focus)) score += 0.5;
  if (recent.slice(-2).includes(s.id)) score -= 0.25;
  return score;
}
export class Director {
  policy: Policy;
  session = '';
  epoch = 0;
  current?: Shot;
  pose?: CameraPose;
  since = 0;
  lastTime = 0;
  operator?: OperatorIntent;
  recent: string[] = [];
  decisions: Decision[] = [];
  diagnostics: string[] = [];
  selectedId?: string;
  shots: Shot[] = [];
  observation?: Observation;
  external?: { reply: Reply; request: Request };
  note(message: string) {
    if (this.diagnostics.at(-1) !== message) this.diagnostics.push(message);
    if (this.diagnostics.length > 128) this.diagnostics.shift();
  }
  constructor(policy: Policy = 'clear') {
    this.policy = policy;
  }
  reset(session: string) {
    this.session = session;
    this.epoch++;
    this.current = undefined;
    this.selectedId = undefined;
    this.pose = undefined;
    this.since = 0;
    this.lastTime = 0;
    this.operator = undefined;
    this.recent = [];
    this.decisions = [];
    this.diagnostics = [];
    this.external = undefined;
  }
  takeover(intent: OperatorIntent) {
    this.operator = structuredClone(intent);
    this.epoch++;
    this.external = undefined;
  }
  release() {
    this.operator = undefined;
    this.epoch++;
    this.external = undefined;
    this.since = -Infinity;
  }
  request(): Request | undefined {
    const o = this.observation;
    if (!o || this.operator || this.shots.length === 0) return;
    return {
      session: this.session,
      version: o.semanticVersion,
      epoch: this.epoch,
      time: o.time,
      policy: this.policy,
      current: this.current?.id,
      heldSeconds: o.time - this.since,
      canCut: o.time - this.since >= POLICY[this.policy].hold,
      recent: [...this.recent],
      activity: structuredClone(o.activity),
      candidates: this.shots
        .slice(0, 12)
        .map(({ id, intention, subjects, quality, reasons }) => ({
          id,
          intention,
          subjects: [...subjects],
          quality,
          reasons: [...reasons],
        })),
    };
  }
  accept(reply: Reply, request: Request) {
    this.external = { reply, request };
  }
  update(o: Observation): {
    pose?: CameraPose;
    cut: boolean;
    shot?: string;
    reason: string;
  } {
    if (this.session !== o.session || o.time < this.lastTime)
      this.reset(o.session);
    this.observation = o;
    if (!Number.isFinite(o.aspect) || o.aspect < 0.25 || o.aspect > 4) {
      this.shots = [];
      this.external = undefined;
      const reason =
        'camera.aspect-unsupported: render aspect must be between 0.25 and 4';
      this.note(reason);
      return { cut: false, reason };
    }
    const dt = Math.min(0.1, Math.max(0, o.time - this.lastTime));
    this.lastTime = o.time;
    if (this.operator && o.time >= this.operator.expires) this.release();
    const policy = this.operator?.policy ?? this.policy;
    const shots = feasibleShots(o, this.current);
    this.shots = shots;
    let list = shots;
    if (this.operator?.subject)
      list = list.filter((s) => s.subjects.includes(this.operator!.subject!));
    if (this.operator?.shot)
      list = list.filter((s) => s.intention === this.operator!.shot);
    const rank = (s: Shot) =>
      rankShot(s, o, policy, this.recent) +
      (this.operator?.subject && s.subjects[0] === this.operator.subject
        ? 4
        : 0) +
      (this.operator?.subject && s.subjects.length === 1 ? 2 : 0);
    let best = [...list].sort(
      (a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id),
    )[0];
    if (!best && this.operator && !this.operator.pose) {
      this.note(
        'camera.operator-unavailable: requested framing has no feasible candidate',
      );
    }
    if (!best) best = shots.find((s) => s.id === 'context') ?? shots[0];
    const current = shots.find((s) => s.id === this.current?.id);
    const held = o.time - this.since,
      constraints = POLICY[policy];
    let reason = 'local semantic coverage';
    let source: Decision['source'] = this.operator ? 'operator' : 'local';
    if (
      current &&
      current.valid &&
      !this.operator &&
      (held < constraints.hold ||
        !best ||
        rankShot(best, o, policy, this.recent) -
          rankShot(current, o, policy, this.recent) <
          constraints.threshold)
    )
      best = current;
    if (this.external) {
      const { reply, request } = this.external;
      this.external = undefined;
      if (
        request.session !== o.session ||
        request.epoch !== this.epoch ||
        request.version !== o.semanticVersion ||
        this.operator
      )
        this.note('camera.external-stale: obsolete decision discarded');
      else {
        const pick =
          reply.choice === 'HOLD'
            ? current
            : shots.find((s) => s.id === reply.choice);
        if (!pick)
          this.note('camera.external-invalid: candidate no longer feasible');
        else if (
          !current ||
          held >= constraints.hold ||
          pick.id === current.id
        ) {
          best = pick;
          source = 'external';
          reason = `accepted ${reply.model} choice`;
        }
      }
    }
    const desired =
      this.operator?.pose ??
      (this.operator?.movement === 'still' && this.pose
        ? this.pose
        : best?.pose);
    if (!desired)
      return {
        cut: false,
        reason: 'camera.no-feasible-view: retain view with explicit limitation',
      };
    const selectedId = this.operator?.pose ? 'manual-pose' : best?.id;
    const changed = selectedId !== this.selectedId;
    const outcome = execute(
      o,
      this.pose,
      desired,
      changed,
      dt,
      this.operator?.pose ? [] : (best?.subjects ?? []),
    );
    if (!outcome.pose) {
      this.note(outcome.reason);
      return outcome;
    }
    if (changed || outcome.cut || source === 'external') {
      this.decisions.push({
        time: o.time,
        tick: o.tick,
        session: o.session,
        semanticVersion: o.semanticVersion,
        epoch: this.epoch,
        shot: selectedId ?? 'context',
        source,
        reason: `${reason}; ${outcome.reason}`,
        cut: outcome.cut,
        pose: structuredClone(outcome.pose),
      });
      if (changed || outcome.cut) this.since = o.time;
      if (changed) {
        this.recent.push(selectedId ?? 'context');
        this.recent = this.recent.slice(-8);
      }
    }
    if (this.decisions.length > 2048) this.decisions.shift();
    this.current = best;
    this.selectedId = selectedId;
    this.pose = outcome.pose;
    return { ...outcome, shot: selectedId };
  }
}
