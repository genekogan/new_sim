// Shared per-tick check of hand-up hand points (handup / handup-rules / solar tests; not a test file itself).
// - at the grip: hands == handupHands(part, pose, holder, slot) (a renderer rebuilds them from the take);
// - on the way (crouch, reach_down): on the segment from the rest hands (hanging at the hips) to the grip;
// - `hands.teleport`: a published hand point moves ≤ HAND_STEP_MAX per tick, from the previous tick's point
//   or, when none was published, from the hanging rest hand (owner feedback §6: no snapping to the part).
import assert from 'node:assert/strict';
import type { Runtime } from '../runtime/runtime.ts';
import type { Vec3 } from '../core/math.ts';
import { restHands } from '../body/model.ts';
import { handsOf, handupHands } from '../construction/handup.ts';

/** m per tick (5 m/s): a smoothstep approach over 0.6 s peaks at 1.5 × distance / 12 ticks (≤ 0.23 m for 1.8 m). */
export const HAND_STEP_MAX = 0.25;
export const APPROACH_PHASES: ReadonlySet<string> = new Set(['crouch', 'reach_down']);

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.sqrt(dot(a, a));

export class HandupHandsCheck {
  prev = new Map<string, [Vec3, Vec3]>();
  worstStep = 0;
  approachTicks = 0;

  /** Call after every rt.step(). */
  check(rt: Runtime) {
    for (const h of Object.values(rt.world.entities)) {
      if (!h.human) continue;
      const hs = handsOf(h);
      const slot = h.human.grip?.slot;
      if (hs && slot?.startsWith('handup-')) {
        const part = rt.world.entities[h.human.grip!.entity];
        const grip = handupHands(part, part.pose, h, slot)!;
        if (APPROACH_PHASES.has(h.human.activity)) {
          this.approachTicks++;
          const rest = restHands(h);
          for (let i = 0; i < 2; i++) {
            const seg = sub(grip[i], rest[i]), off = sub(hs[i], rest[i]);
            const L2 = dot(seg, seg);
            const t = L2 > 0 ? dot(off, seg) / L2 : 0;
            const perp = sub(off, [seg[0] * t, seg[1] * t, seg[2] * t]);
            assert.ok(t >= -1e-9 && t <= 1 + 1e-9 && len(perp) <= 1e-6, `${h.id} (${h.human.activity}) hand ${i} is not on its way from the hips to ${slot} at tick ${rt.tick}`);
          }
        } else assert.deepEqual(hs, grip, `${h.id} hands not reproducible from ${slot} at tick ${rt.tick}`);
        const from = this.prev.get(h.id) ?? restHands(h);
        const d = Math.max(len(sub(hs[0], from[0])), len(sub(hs[1], from[1])));
        this.worstStep = Math.max(this.worstStep, d);
        assert.ok(d <= HAND_STEP_MAX + 1e-9, `hands.teleport: ${h.id} (${h.human.activity}, ${slot}) hands jumped ${d.toFixed(3)} m in one tick at tick ${rt.tick} (max ${HAND_STEP_MAX} m)`);
      }
      if (hs) this.prev.set(h.id, hs);
      else this.prev.delete(h.id);
    }
  }
}
