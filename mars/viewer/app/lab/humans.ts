// Engine humans → animated rigs. Renderers only read world state (guide):
// after every fixed tick we snapshot pose + derive clip state; frames
// interpolate between the last two ticks, so visuals are a deterministic
// function of sim history (not of frame rate).
import * as THREE from 'three';
import type { WorldState } from '../../engine/world/types.ts';
import { DT } from '../../engine/runtime/runtime.ts';
import { createRig, type Rig, type Template } from './people.ts';

type Snap = { p: [number, number, number]; yaw: number; walkW: number; walkT: number; idleT: number };
type View = { rig: Rig; prev: Snap; cur: Snap; speed: number; activity: string };

const BLEND = DT / 0.3; // Walk↔Idle crossfade 0.3 s, as in the studio
const lerpAngle = (a: number, b: number, t: number) => a + (((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * t;

/** Stable template choice per actor id. */
function templateFor(id: string, ts: Template[]) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return ts[h % ts.length];
}

export class HumanViews {
  readonly group = new THREE.Group();
  private views = new Map<string, View>();
  private templates: Template[] = [];

  constructor() {
    this.group.name = 'engine humans';
  }

  setTemplates(ts: Template[]) {
    this.templates = ts;
  }

  clear() {
    for (const v of this.views.values()) {
      v.rig.mixer.stopAllAction();
      v.rig.mixer.uncacheRoot(v.rig.model);
    }
    this.views.clear();
    this.group.clear();
  }

  /** Create/destroy rigs to match the world and take a first snapshot. */
  reset(world: WorldState) {
    this.clear();
    this.onTick(world);
  }

  /** Call after every engine tick. Pure function of (previous snapshot, world). */
  onTick(world: WorldState) {
    if (!this.templates.length) return;
    for (const e of Object.values(world.entities)) {
      if (e.kind !== 'human' || !e.human) continue;
      let v = this.views.get(e.id);
      if (!v) {
        const rig = createRig(templateFor(e.id, this.templates));
        rig.holder.name = e.id;
        this.group.add(rig.holder);
        const s: Snap = { p: [...e.pose.p], yaw: e.pose.yaw, walkW: 0, walkT: 0, idleT: (e.id.length * 0.37) % 1 };
        v = { rig, prev: s, cur: { ...s }, speed: 0, activity: e.human.activity };
        this.views.set(e.id, v);
        continue;
      }
      const c = v.cur;
      // Horizontal ground speed → walk clip rate (feet speed-matched); smoothed against tick noise.
      const inst = Math.hypot(e.pose.p[0] - c.p[0], e.pose.p[2] - c.p[2]) / DT;
      v.speed += (inst - v.speed) * 0.5;
      const act = e.human.activity;
      v.activity = act;
      const walking = act === 'walk' || act.startsWith('climb') || (act === 'carry' && v.speed > 0.05);
      const walkW = Math.max(0, Math.min(1, c.walkW + (walking ? BLEND : -BLEND)));
      const rate = walking ? Math.max(0.35, v.speed / v.rig.template.walkSpeed) : 1;
      const dur = v.rig.walk.getClip().duration;
      v.prev = c;
      v.cur = {
        p: [...e.pose.p],
        yaw: e.pose.yaw,
        walkW,
        walkT: walkW > 0 ? (c.walkT + DT * rate) % dur : 0,
        idleT: (c.idleT + DT) % v.rig.idle.getClip().duration,
      };
    }
    for (const [id, v] of this.views)
      if (!world.entities[id]) {
        this.group.remove(v.rig.holder);
        this.views.delete(id);
      }
  }

  /** Apply interpolated pose/animation. alpha ∈ [0,1] = fraction of the next tick elapsed. */
  render(alpha: number) {
    for (const v of this.views.values()) {
      const a = v.prev, b = v.cur, h = v.rig.holder;
      h.position.set(a.p[0] + (b.p[0] - a.p[0]) * alpha, a.p[1] + (b.p[1] - a.p[1]) * alpha, a.p[2] + (b.p[2] - a.p[2]) * alpha);
      h.rotation.y = -lerpAngle(a.yaw, b.yaw, alpha);
      const w = a.walkW + (b.walkW - a.walkW) * alpha;
      const { walk, idle, mixer } = v.rig;
      const wt = b.walkT >= a.walkT ? a.walkT + (b.walkT - a.walkT) * alpha : b.walkT;
      walk.time = wt;
      idle.time = b.idleT;
      walk.setEffectiveWeight(w);
      idle.setEffectiveWeight(1 - w);
      mixer.update(0);
    }
  }

  /** Interpolated world positions (for labels/discs) keyed by actor id. */
  positions() {
    return new Map([...this.views].map(([id, v]) => [id, v.rig.holder.position]));
  }

  info() {
    return [...this.views].map(([id, v]) => ({ id, template: v.rig.template.name, speed: +v.speed.toFixed(3), walkWeight: +v.cur.walkW.toFixed(2), activity: v.activity }));
  }
}
