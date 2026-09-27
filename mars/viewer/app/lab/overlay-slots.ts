// Interaction-slot overlay (engine/social/slots.ts): every seat / fire-circle / audience slot as a
// ring with a heading tick. Green = free, amber = claimed (someone is on the way), red-orange
// filled = claimed and occupied by its claimant. Reads engine state only.
import * as THREE from 'three';
import type { Runtime } from '../../engine/runtime/runtime.ts';
import { allSlots, occupantOf } from '../../engine/social/slots.ts';
import { clearGroup } from './overlay-debug.ts';

export const SLOT_COLORS = { free: '#3dff7a', claimed: '#ffc233', occupied: '#ff6a2a' } as const;

export function slotStates(rt: Runtime) {
  return allSlots(rt).map((s) => {
    const who = occupantOf(rt.world, s);
    const holder = s.claimedBy ? rt.records.get(s.claimedBy) : undefined;
    const claimant = holder ? (holder.params as { actor?: string }).actor : undefined;
    const state: keyof typeof SLOT_COLORS = !s.claimedBy ? 'free' : who && who === claimant ? 'occupied' : 'claimed';
    return { id: s.id, kind: s.kind, p: s.p, yaw: s.yaw, level: s.level, claimedBy: s.claimedBy ?? null, claimant: claimant ?? null, occupant: who ?? null, state };
  });
}

export function buildSlots(group: THREE.Group, rt: Runtime) {
  clearGroup(group);
  const levels = (rt.services.spatial as { base: { levels: { id: number; y: number }[] } }).base.levels;
  for (const s of slotStates(rt)) {
    const y = (levels.find((l) => l.id === s.level)?.y ?? 0) + 0.05;
    const color = SLOT_COLORS[s.state];
    const geo = s.state === 'occupied' ? new THREE.CircleGeometry(0.3, 24) : new THREE.RingGeometry(0.22, 0.3, 24);
    const m = new THREE.Mesh(geo.rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: s.state === 'occupied' ? 0.55 : 0.95 }));
    m.position.set(s.p[0], y, s.p[1]);
    m.renderOrder = 4;
    const tip = new THREE.Vector3(s.p[0] + Math.cos(s.yaw) * 0.55, y, s.p[1] + Math.sin(s.yaw) * 0.55);
    const tick = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(s.p[0], y, s.p[1]), tip]), new THREE.LineBasicMaterial({ color, depthTest: false }));
    tick.renderOrder = 4;
    group.add(m, tick);
  }
}
