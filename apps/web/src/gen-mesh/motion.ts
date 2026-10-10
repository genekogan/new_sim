// Client-side decorative motion: spin, sway, hover, route, creature gaits and behaviours, all pure
// functions of world time and the entity's seed, so every viewer sees the same thing with no sync.
// Owner: L4. CONTRACT STUB (L1): spin, sway and hover work; `gait` and `behavior` are L4's
// (the walking dog). Called every frame by the entity layer for entities that declare motion.
import type * as THREE from 'three';
import type { Entity, StoredDef } from '@sim/world-compiler';

/** True if this entity needs per-frame motion (the layer only calls `animate` for these). */
export function hasMotion(def: StoredDef): boolean {
  const c = def.components;
  return !!(c.spin || c.sway || c.hover || c.route || c.behavior || (def.make.kind === 'gen' && def.make.gen === 'kit/2' && (def.make.args as { gait?: string } | undefined)?.gait && (def.make.args as { gait?: string }).gait !== 'none'));
}

/** Apply motion at world time `t` (seconds). `base` is the resting local transform the layer computed. */
export function animate(obj: THREE.Object3D, entity: Entity, def: StoredDef, t: number, base: { y: number; yaw: number }) {
  const c = def.components, phase = ((entity.seed ?? hash(entity.id)) % 1000) / 1000 * Math.PI * 2;
  if (c.spin) {
    const ang = (t * (c.spin.rpm / 60)) * Math.PI * 2;
    const target = c.spin.role ? obj.getObjectByName(`role:${c.spin.role}`) : obj;
    if (target) { if (c.spin.axis === 'x') target.rotation.x = ang; else if (c.spin.axis === 'z') target.rotation.z = ang; else target.rotation.y = (target === obj ? base.yaw : 0) + ang; }
  }
  if (c.sway) { obj.rotation.z = Math.sin(t * (Math.PI * 2) / c.sway.period + phase) * c.sway.amount * 0.3; obj.rotation.x = Math.cos(t * (Math.PI * 2) / (c.sway.period * 1.3) + phase) * c.sway.amount * 0.2; }
  if (c.hover) obj.position.y = base.y + c.hover.height + Math.sin(t * (Math.PI * 2) / c.hover.period + phase) * c.hover.bob;
  // gait / behavior / route: L4
}

function hash(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h >>> 0; }
