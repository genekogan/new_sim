// Experiment B: Rapier (compat + deterministic-compat) as a query/validation substrate.
// Scene: engine/scenes/proving-ground.ts (same as bespoke) + campus.glb Chiba subset.
// Run: node exp-b-rapier.mjs
import { provingGround, DECK_Y } from '../../engine/scenes/proving-ground.ts';
import { sceneToMesh } from './lib/scene-to-mesh.mjs';
import { loadCampus } from './lib/campus.mjs';
import { now, time, bench, r2, r3, save } from './lib/util.mjs';

const out = {};
for (const pkg of ['@dimforge/rapier3d-compat', '@dimforge/rapier3d-deterministic-compat']) {
  const t0 = now();
  const RAPIER = (await import(pkg)).default;
  await RAPIER.init();
  const res = { initMs: r2(now() - t0), version: RAPIER.version?.() };
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const mesh = sceneToMesh(provingGround());
  let [col, ms] = time(() => world.createCollider(RAPIER.ColliderDesc.trimesh(mesh.positions, mesh.indices)));
  res.provingTrimeshMs = r2(ms);
  world.step();
  const I = { w: 1, x: 0, y: 0, z: 0 };
  const yawQ = (a) => ({ w: Math.cos(a / 2), x: 0, y: Math.sin(a / 2), z: 0 });
  // 5.8 x 0.1 x 0.1 beam carried at 1.0 m, long axis along X, swept +X into the test wall (x=-15, z in [-19,-11])
  const beam = new RAPIER.Cuboid(2.9, 0.05, 0.05);
  const hitWall = world.castShape({ x: -22, y: 1, z: -15 }, I, { x: 10, y: 0, z: 0 }, beam, 0, 1, true);
  // same beam swept along z=-22 (clear of the wall)
  const clear = world.castShape({ x: -22, y: 1, z: -22 }, I, { x: 10, y: 0, z: 0 }, beam, 0, 1, true);
  // rotated 90deg (long axis along Z) swept through the 1.0 m passage gap at x=15 -> must hit
  const gapLong = world.castShape({ x: 15, y: 1, z: -20 }, I, { x: 0, y: 0, z: 10 }, beam, 0, 1, true);
  const gapRot = world.castShape({ x: 15, y: 1, z: -20 }, yawQ(Math.PI / 2), { x: 0, y: 0, z: 10 }, beam, 0, 1, true);
  res.castShape = {
    beamIntoWall: hitWall ? { toi: r3(hitWall.time_of_impact), collider: hitWall.collider.handle } : null,
    beamClear: clear ? r3(clear.time_of_impact) : null,
    beamAcrossGap_sideways: gapLong ? r3(gapLong.time_of_impact) : null,
    beamThroughGap_endOn: gapRot ? r3(gapRot.time_of_impact) : null,
    usPerCast: r2(bench(() => world.castShape({ x: -22, y: 1, z: -15 }, I, { x: 10, y: 0, z: 0 }, beam, 0, 1, true), 5000) * 1000),
  };
  // OBB footprint intersection (load 5.8 x 0.4, 1.0..1.2 m) at a yaw overlapping the U back wall
  const foot = new RAPIER.Cuboid(2.9, 0.1, 0.2);
  let n = 0;
  world.intersectionsWithShape({ x: -15, y: 1.1, z: 15 }, yawQ(0.3), foot, () => { n++; return true; });
  let m = 0;
  world.intersectionsWithShape({ x: 0, y: 1.1, z: 0 }, yawQ(0.3), foot, () => { m++; return true; });
  res.intersections = { overlappingUWall: n, openGround: m, usPerQuery: r2(bench(() => world.intersectionsWithShape({ x: -15, y: 1.1, z: 15 }, yawQ(0.3), foot, () => true), 5000) * 1000) };
  // KinematicCharacterController on stairs (rise 0.1875, tread 0.25)
  const kcc = (startX, dir, z = 10, vy = 0) => {
    const cc = world.createCharacterController(0.02);
    cc.enableAutostep(0.25, 0.1, false);
    cc.enableSnapToGround(0.3);
    cc.setMaxSlopeClimbAngle(50 * Math.PI / 180);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(startX, 0.9 + 0.03, z));
    const cap = world.createCollider(RAPIER.ColliderDesc.capsule(0.62, 0.28), body);
    world.step();
    let maxY = 0, steps = 0;
    const t = now();
    for (let i = 0; i < 300; i++) {
      cc.computeColliderMovement(cap, { x: dir * 0.045, y: vy, z: 0 }); // NOTE: any downward y here disables autostep (see RESULTS)
      const mv = cc.computedMovement(), p = body.translation();
      const np = { x: p.x + mv.x, y: p.y + mv.y, z: p.z + mv.z };
      body.setNextKinematicTranslation(np);
      world.step();
      maxY = Math.max(maxY, np.y - 0.9);
      steps++;
    }
    const p = body.translation();
    const r = { endX: r2(p.x), feetY: r2(p.y - 0.9 - 0.03), usPerMove: r2(((now() - t) / steps) * 1000) };
    world.removeCollider(cap, false); world.removeRigidBody(body); world.removeCharacterController(cc);
    return r;
  };
  res.kcc = { stairsA_up: kcc(0.5, 1), stairsA_up_withGravityInDesired: kcc(0.5, 1, 10, -0.05), stairsB_broken_up: kcc(19.5, -1), note: `deck top y=${DECK_Y}; A ascends +x from x=2, B ascends -x from x=18 with treads 6-9 missing` };
  // Campus Chiba trimesh
  const geo = await loadCampus({ subset: 'chiba' });
  const cw = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  [col, ms] = time(() => cw.createCollider(RAPIER.ColliderDesc.trimesh(geo.positions, geo.indices)));
  const t1 = now(); cw.step(); const stepMs = now() - t1;
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const casts = Array.from({ length: 2000 }, () => [{ x: -25 + rnd() * 55, y: 1.1, z: -30 + rnd() * 45 }, yawQ(rnd() * 6.28), { x: (rnd() - 0.5) * 10, y: 0, z: (rnd() - 0.5) * 10 }]);
  let hits = 0;
  const tc = now();
  for (const [p, q, vel] of casts) if (cw.castShape(p, q, vel, beam, 0, 1, true)) hits++;
  const castUs = ((now() - tc) / casts.length) * 1000;
  res.campusChiba = { tris: geo.tris, trimeshBuildMs: r2(ms), firstStepMs: r2(stepMs), castShapeBeam5mUs: r2(castUs), hitRate: r2(hits / casts.length) };
  // determinism: snapshot bytes after identical builds
  const snap1 = world.takeSnapshot();
  res.snapshotBytes = snap1.length;
  out[pkg] = res;
  console.log(pkg, JSON.stringify(res));
}
save('exp-b-rapier.json', out);
