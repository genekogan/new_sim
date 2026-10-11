// Mesh half of `make: {kind:'mesh'}` defs: the stored GLB by sha, cached and cloned per entity, fitted to
// the def's box (base-centred, uniform scale to size.box height), clips played per frame. Owner: L5.
// Replaces the placeholder box in basic.mesh.ts (this file registers `mesh` after it).
//
// Clips: a def with a moving behaviour (wander/graze/fly/swim/follow) plays `Walk` (Fly/Swim for birds
// and fish) while its entity moves and `Idle` while it stands; anything else with clips plays `Idle`
// (or its only clip). Time is wall-clock seconds so every viewer sees the same phase.
// Motion: a def with a `behavior` component gets L4's creature rig (no role pivots: the GLB's own clips
// move the legs), so motion.ts walks, grazes, flies or swims it like a kit creature.
import * as THREE from 'three';
import { frameHook, instantiate, loadAsset, type ModelInstance } from './gltf-assets.ts';
import { deferLoad, isEager, noteDeferred } from './lazy-assets.ts';
import { registerMesh, type MeshBuilder } from './registry.ts';
import { bindMotionModel, makeRig, type Gait } from './motion.ts';
import { seedOf, type BehaviorKind } from './creatures/behavior.ts';

const MOVING = new Set(['wander', 'graze', 'fly', 'swim', 'follow']);
const hashPhase = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return ((h >>> 0) % 10000) / 1000; };

const meshBuilder: MeshBuilder = {
  gen: 'mesh',
  build(ctx) {
    const make = ctx.def.make as { kind: 'mesh'; asset: string };
    const holder = new THREE.Group(); holder.name = `mesh ${ctx.def.name}`;
    const behavior = ctx.def.components.behavior?.kind;
    const phase = hashPhase(ctx.entity.id);
    let inst: ModelInstance | null = null, gone = false;
    const last = new THREE.Vector3(Number.NaN, 0, 0), now = new THREE.Vector3();
    let stillFor = 0;
    const b = ctx.def.components.behavior;
    if (b) {
      bindMotionModel(ctx.model);
      const gait: Gait = b.kind === 'fly' ? 'bird-fly' : b.kind === 'swim' ? 'fish-swim' : 'none';
      holder.userData.rig = makeRig(holder, { gait, kind: b.kind as BehaviorKind, speed: b.speed ?? 1, radius: b.radius ?? 6, follow: b.ref, seed: ctx.entity.seed ?? seedOf(ctx.entity.id), model: ctx.model, species: ctx.def.name.replace(/^core-|-pack$/g, ''), box: ctx.def.size.box as [number, number, number] });
    }
    holder.add(frameHook(() => {
      if (!inst || !inst.clips.length) return;
      const t = Date.now() / 1000;
      holder.getWorldPosition(now);
      const moved = Number.isFinite(last.x) ? now.distanceToSquared(last) > 1e-6 : false;
      last.copy(now);
      stillFor = moved ? 0 : stillFor + 1;
      const walking = !!behavior && MOVING.has(behavior) && stillFor < 3;   // a few frames of grace across easing jitter
      inst.play(behavior === 'fly' ? 'Fly' : behavior === 'swim' ? 'Swim' : walking ? 'Walk' : 'Idle', t, { phase });
    }));
    // VOCAB-MECH: GLBs outside the eager set load when the thing comes near the camera or in the background (lazy-assets.ts)
    const load = () => { loadAsset(make.asset).then((gltf) => {
      if (gone) return;
      inst = instantiate(gltf, { box: ctx.def.size.box as [number, number, number] });
      // flat things (rugs, boards, plates a few cm thick) would z-fight with gently uneven ground: draw them
      // a hair towards the camera (the materials are shared per asset, so every copy of it gets the same)
      if (ctx.def.size.box[1] <= 0.06) inst.object.traverse((o) => { const mats = (o as THREE.Mesh).material; for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) { m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -4; } });
      holder.add(inst.object);
      if (inst.clips.length) inst.play('Idle', Date.now() / 1000, { phase });
    }).catch(() => {
      if (gone) return;
      // the asset is missing or broken: a soft placeholder of the def's size, so the place is still visible
      const [w, h, d] = ctx.def.size.box;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), ctx.materials.get('paint', '#b0a090')); m.position.y = h / 2; m.name = 'asset missing';
      holder.add(m);
    }); };
    if (isEager(make.asset)) load(); else { holder.add(deferLoad(make.asset, load, frameHook)); noteDeferred(); }
    holder.addEventListener('removed', () => { gone = true; inst?.dispose(); });
    return holder;
  },
};
registerMesh(meshBuilder);
// basic.mesh.ts still registers a placeholder under the same id (removal requested of L1); glob import order is
// not guaranteed, so claim the id again once every mesh module has evaluated.
queueMicrotask(() => registerMesh(meshBuilder));
