// Lane W1 (tranche 2026-10-19, round 3): which world/epoch owns LiveWorld's scene. The scene used to start at the
// socket's first welcome; on live (behind Cloudflare) the WebSocket takes ~0.5 s to open, so a warm arrival's world
// build waited ~0.6 s for it although the page already held the world's snapshot (index.html's entry GET). A new world's
// page now starts its scene from the page's own world id at once and adopts the first welcome's epoch when it names the
// same world, so that welcome does not tear the scene down; a later welcome with another epoch (a restarted server)
// rebuilds the scene exactly as before. Old worlds (no bootWorldId) keep waiting for the welcome.

export type SceneOwner = { worldId: string; epoch: string | undefined };
export type WelcomeLike = { worldId: string; epoch?: string } | null | undefined;
/** Per-LiveWorld memory: the world the scene booted for, and the first welcome's epoch once adopted. */
export type SceneOwnerMemory = { boot?: string; adopted?: { epoch: string | undefined } };

/** Booted scenes keep the epoch key 'boot' through their adopted first welcome. Pure apart from `memory`; idempotent. */
export function sceneOwner(welcome: WelcomeLike, bootWorldId: string | undefined, memory: SceneOwnerMemory): SceneOwner | null {
  if (!welcome) {
    if (memory.boot) return { worldId: memory.boot, epoch: 'boot' };
    if (!bootWorldId) return null;
    memory.boot = bootWorldId;
    return { worldId: bootWorldId, epoch: 'boot' };
  }
  if (memory.boot === welcome.worldId) {
    memory.adopted ??= { epoch: welcome.epoch };
    if (memory.adopted.epoch === welcome.epoch) return { worldId: welcome.worldId, epoch: 'boot' };
  }
  return { worldId: welcome.worldId, epoch: welcome.epoch };
}
