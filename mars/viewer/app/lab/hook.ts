import { readTidyTable } from '../../engine/activities/table-cleanup.ts';
import { readCreativeAfternoon } from '../../engine/scenarios/creative-afternoon.ts';
import { readArtSharing } from '../../engine/activities/art-sharing.ts';
import { readDrawing } from '../../engine/objects/drawing.ts';
import { latestGroupWarmup } from '../../engine/activities/group-warmup.ts';
import { latestOpenJam } from '../../engine/activities/open-jam.ts';
import { readLivingDay } from '../../engine/scenarios/living-day.ts';
import { cameraEntities, cameraActivityReadout } from './activity-observation-hooks.ts';
import { GARDEN_PLANTS } from '../../engine/scenarios/garden-care.ts';
import { readGarden } from '../../engine/objects/garden.ts';
import { sleepReadout } from './sleep.ts';
import { preparationReadout } from './preparation.ts';
import { readFixtureMove } from '../../engine/carry/fixture.ts';
import { musicStation, readComputerMusic } from '../../engine/activities/computer-music.ts';
import { musicSoundState } from './music-sound.ts';
import { readBook } from '../../engine/objects/reading.ts';
import { readChess } from '../../engine/objects/chess.ts';
import { CATALOG } from '../../engine/world/catalog.ts';
import { readWorkstation } from '../../engine/objects/workstation.ts';
import { LabCameraGeometryCache } from './camera-observation.ts';
// window.__marsEngine: test/automation hook for the Engine Lab (e2e/lab.spec.ts).
import * as THREE from 'three';
import type { LabView, OverlayName } from './lab-view.ts';
import { classroomSessionId, classroomParams } from '../../engine/scenarios/classroom.ts';
import { readClassroom, readSharedFoodBreak } from '../../engine/activities/index.ts';
import { readGatheringContinuation } from '../../engine/activities/gathering-continuation.ts';
import { readPurposefulRoutine } from '../../engine/activities/purposeful-routine.ts';
import { displayReadout } from '../../engine/objects/classroom.ts';
import { SELECTABLE_SCENARIOS, SCENARIOS } from './scenarios.ts';
import { activityExample } from './activity-example.ts';
import { classroomRoomCount } from './room-layout.ts';
import { sequenceRows } from './sequence-hud.tsx';
import { entityCorners } from '../../engine/spatial/service.ts';
import { slotStates } from './overlay-slots.ts';
import { scriptOf } from './campfire-evening.ts';
import { BODY_MODEL } from '../engine-view/rig.ts';
import { BODY_MODEL as ENGINE_BODY_MODEL } from '../../engine/body/model.ts';
import { TakePeople } from '../engine-view/take-replay.ts';
import { TakeRecorder } from '../../engine/take/recorder.ts';
import type { ChangeEvent, Take } from '../../engine/take/types.ts';
import { blockedLog, yearBuildOf } from './year-build.ts';
import { compareToCanonical, yearBuildSupportDiagnostic } from '../../engine/scenarios/year-build.ts';
import { Highlights, type HighlightOpts } from './highlight.ts';
import type { WorldState } from '../../engine/world/types.ts';

export type EngineHook = ReturnType<typeof installHook>;

export function installHook(view: LabView, notify: () => void) {
  const sim = view.sim;
  const cameraGeometry = new LabCameraGeometryCache();
  // Synthetic measurement poses persist between probe calls, but never enter
  // authoritative execution. Any real tick or reset starts a fresh probe snapshot.
  let probeWorld: WorldState | null = null;
  let probeRuntime: typeof sim.rt | null = null;
  let probeTick = -1;
  const marks = new Highlights(); // question captures: outlines + labels by id (highlight.ts)
  view.scene.add(marks.group);
  // take-replay check (recordTake / humanFields / replayTake)
  let rec: TakeRecorder | null = null, take: Take | null = null, replay: TakePeople | null = null;
  const dropReplay = () => {
    replay?.dispose();
    replay = null;
    view.humans.group.visible = true;
  };
  const state = () => {
    const rt = sim.rt;
    return {
      scenario: sim.scenario.name,
      tick: rt.tick,
      time: +rt.time.toFixed(3),
      done: sim.done(),
      paused: sim.paused,
      speed: sim.speed,
      humans: Object.values(rt.world.entities)
        .filter((e) => e.kind === 'human')
        .map((e) => ({ id: e.id, p: e.pose.p.map((x) => +x.toFixed(4)), yaw: +e.pose.yaw.toFixed(4), level: e.human!.level, activity: e.human!.activity, task: e.human!.task ?? null })),
      checks: sim.checks(),
      stats: sim.stats(),
    };
  };
  const hook = {
    tableCleanup: () => { const r = [...sim.rt.records.values()].filter(r => r.verb === 'tidy_table').at(-1); return r ? readTidyTable(sim.rt, r.id) ?? null : null; },
    creativeAfternoon: () => readCreativeAfternoon(sim.rt) ?? null,
    artSharing: () => { const r = [...sim.rt.records.values()].filter(r => r.verb === 'art_sharing').at(-1); return r ? readArtSharing(sim.rt, r.id) ?? null : null; },
    livingDay: () => readLivingDay(sim.rt),
    garden: () => ({ plants: GARDEN_PLANTS.map(id => readGarden(sim.rt, id)), water: structuredClone(sim.rt.world.entities['water-bowl']), active: structuredClone([...sim.rt.records.values()].find(r => r.verb === 'garden_care' && sim.rt.isActive(r.id)) ?? null), claims: Object.fromEntries([...Object.keys(sim.rt.world.entities).flatMap(id => [`actor:${id}`, `entity:${id}`, `hand:${id}:right`, `hand:${id}:left`, `holds:${id}`]), 'surface:water-table#r0c2'].map(key => [key, sim.rt.holder(key)])) }),
    get ready() {
      return view.loaded && view.frames >= 3;
    },
    get frames() {
      return view.frames;
    },
    get scenarioEpoch() { return sim.scenarioEpoch; },
    /** Frozen clone cached by world identity and navigation geometry epoch. */
    cameraEntities: () => cameraEntities(sim.rt),
    cameraActivityReadout: () => cameraActivityReadout(sim.rt),
    cameraGeometry: () => cameraGeometry.read(sim.rt, sim.scenarioEpoch),
    get error() {
      return view.error;
    },
    scenarios: () => SELECTABLE_SCENARIOS.map((s) => ({ name: s.name, title: s.title, continuous: !!s.continuous })),
    /** Load a scenario (fresh world). Pass { paused: false } to let it play in real time.
     *  Scenarios with async data (year walkabouts) return a Promise of the state. */
    runScenario(name: string, opts: { paused?: boolean; speed?: number } = {}) {
      const go = () => {
        dropReplay();
        marks.clear();
        rec = null;
        take = null;
        sim.paused = opts.paused ?? true;
        sim.speed = opts.speed ?? sim.speed;
        sim.load(name);
        notify();
        return state();
      };
      const s = SCENARIOS.find((x) => x.name === name);
      return s?.prepare ? s.prepare().then(go) : go();
    },
    /** Static geometry finished loading (year walkabouts: studio Kit scene photos / 2026 GLB). */
    get backdropReady() {
      return view.staticsReady;
    },
    /** The scenario's panel HUD lines (year walkabouts: file size, fetch/parse/build ms). */
    scenarioHud: () => sim.scenario.hud?.(sim.rt) ?? [],
    /** Fast-forward n fixed ticks synchronously (stops at the scenario's tick budget). */
    step(n = 1) {
      sim.stepN(n);
      notify();
      return state();
    },
    /** Step until done or maxTicks; returns final state. */
    runToEnd(maxTicks = 20 * 600) {
      for (let i = 0; i < maxTicks && !sim.done(); i++) sim.step();
      notify();
      return state();
    },
    /** Sequence presets: per-step status/phase/blocked diagnostics, plus the blocked/failed/violation log. */
    sequence: () => ({ steps: sequenceRows(sim), diagnostics: sim.diagnostics.slice() }),
    /** Fast-forward until every named sequence step has `status` (default completed), or done / maxTicks. */
    runUntilSteps(ids: string[], status = 'completed', maxTicks = 20 * 600) {
      const ok = () => {
        const rows = sequenceRows(sim);
        return !!rows && ids.every((id) => rows.find((r) => r.id === id)?.status === status);
      };
      for (let i = 0; i < maxTicks && !ok() && !sim.done(); i++) sim.step();
      notify();
      return { ...state(), reached: ok() };
    },
    /** Components with engine pose, phase, support and world-space box corners (engine entityCorners). */
    components: () =>
      Object.values(sim.rt.world.entities)
        .filter((e) => e.kind === 'component')
        .map((e) => ({ id: e.id, def: e.def, phase: e.phase, support: e.support?.kind, pose: JSON.parse(JSON.stringify(e.pose)), corners: entityCorners(e), rendered: view.components.bounds(e.id) })),
    /** Detached physical/rendered fixture state and latest transport readout. */
    fixtures: () => {
      const rendered = new Map(view.fixtures.poses().map((v) => [v.id, v]));
      return Object.values(sim.rt.world.entities).filter((e) => e.kind === 'fixture').map((e) => ({ id: e.id, def: e.def, phase: e.phase, support: e.support?.kind, pose: structuredClone(e.pose), rendered: rendered.get(e.id) }));
    },
    fixtureMove: () => { const id = [...sim.rt.records.values()].filter((r) => r.verb === 'move_fixture').at(-1)?.id; return id ? readFixtureMove(sim.rt, id) : undefined; },
    drawing: () => structuredClone(readDrawing(sim.rt, 'sketch-pad')),
    warmup: () => latestGroupWarmup(sim.rt) ?? null,
    openJam: () => latestOpenJam(sim.rt) ?? null,
    musicAudio: () => structuredClone(musicSoundState()),
    music: () => structuredClone({station:musicStation(sim.rt,'music-computer'),sessions:[...sim.rt.records.values()].filter(r=>r.verb==='computer_music').map(r=>readComputerMusic(sim.rt,r.id))}),
    reading: () => structuredClone(readBook(sim.rt, 'book')),
    chess: () => structuredClone(readChess(sim.rt, 'board')),
    sleep: () => structuredClone(sleepReadout(sim.rt)),
    preparation: () => structuredClone(preparationReadout(sim.rt)),
    chessTokens: () => Object.values(sim.rt.world.entities).filter(e => CATALOG[e.def]?.capabilities?.gameToken?.game === 'chess').map(e => ({ id: e.id, def: e.def, pose: structuredClone(e.pose), support: structuredClone(e.support) })),
    workstation: () => {
      const work = activityExample(sim.scenario.name)?.workBreak.work ?? { actor: 'worker', station: 'workstation', seat: 'work-chair#seat' };
      return { state: readWorkstation(sim.rt, work.station), claims: Object.fromEntries([`workstation:${work.station}`, `actor:${work.actor}`, `slot:${work.seat}`].map(key => [key, sim.rt.holder(key)])) };
    },
    activityExample: () => structuredClone(activityExample(sim.scenario.name)),
    workstationAppearances: () => view.fixtures.workstationAppearanceStates(),
    classroomAttention: () => view.humans.attention(),
    /** Detached activity readouts; an observer cannot mutate coordination or food. */
    sharedFood: () => structuredClone([...sim.rt.records.values()].filter(r => r.verb === 'shared_food_break').map(r => readSharedFoodBreak(sim.rt, r.id))),
    activityAttention: () => view.humans.attention(),
    activityAttentionTargets: () => structuredClone(view.attentionTargets),
    classroom: () => { const id = classroomSessionId(sim.rt); return { session: id ? readClassroom(sim.rt, id) : undefined, display: displayReadout(sim.rt, activityExample(sim.scenario.name)?.session.displayId ?? 'screen') }; },
    purposefulRoutine: (action?: string) => {
      const id = action ?? [...sim.rt.records.values()].findLast(r => r.verb === 'purposeful_routine')?.id;
      const state = id ? readPurposefulRoutine(sim.rt, id) : undefined;
      return state ? structuredClone(state) : undefined;
    },
    gatheringContinuations: () => structuredClone([...sim.rt.records.values()].filter(r => r.verb === 'gathering_continuation').map(r => readGatheringContinuation(sim.rt, r.id))),
    startClassroom: () => { const r = sim.rt.submit('classroom_session', activityExample(sim.scenario.name)?.session ?? classroomParams(classroomRoomCount(sim.scenario.name) ?? 4)); notify(); return { id: r.id, status: r.status, diagnostic: r.diagnostic }; },
    stateHash: () => sim.rt.stateHash(),
    /** Bundles / stacks as drawn: pieces left (contents.count) and the top of the drawn stack (m). */
    stacks: () => view.fixtures.stacks(),
    /** Paint overlays as drawn: per band the engine coverage and the drawn width fraction. */
    paints: () => view.components.paints(),
    /**
     * Year-build presets: plan steps (id, verb, the params that locate them), piles, the comparison with the
     * canonical checkpoint, unplaced counts by reason, setup timings, the blocked / refusal log. null otherwise.
     */
    yearBuild() {
      const info = yearBuildOf(sim.rt);
      if (!info) return null;
      const b = info.setup.build;
      const cmp = compareToCanonical(sim.rt.world, b);
      const reasons: Record<string, number> = {};
      for (const u of b.unplaced) reasons[u.reason.split(':')[0]] = (reasons[u.reason.split(':')[0]] ?? 0) + 1;
      return {
        bays: info.bays ?? null,
        admission: yearBuildSupportDiagnostic(b),
        setupMs: +info.setupMs.toFixed(0),
        fetchMs: +info.fetchMs.toFixed(0),
        centre: info.centre,
        steps: info.setup.plan.steps.map((st) => {
          const q = st.params as Record<string, unknown>;
          return { id: st.id, verb: st.verb, beam: q.beam ?? null, item: q.item ?? q.upright ?? null, height: typeof q.height === 'number' ? q.height : null, relay: Array.isArray(q.relay) && q.relay.length > 0 };
        }),
        piles: Object.values(sim.rt.world.entities)
          .filter((e) => e.kind === 'fixture')
          .map((e) => ({ id: e.id, def: e.def, p: e.pose.p, yaw: e.pose.yaw, count: (e.contents as { count?: number } | undefined)?.count ?? null })),
        compare: { n: cmp.length, ok: cmp.filter((c) => c.ok).length, maxMm: +(cmp.reduce((m, c) => Math.max(m, Number.isFinite(c.dist) ? c.dist : 0), 0) * 1000).toFixed(2) },
        unplaced: reasons,
        blocked: blockedLog(sim.rt),
      };
    },
    /** Interaction slots (seats, fire places): claim holder, claimant, occupant, free/claimed/occupied. */
    slots: () => slotStates(sim.rt).map((q) => ({ ...q, p: [+q.p[0].toFixed(4), +q.p[1].toFixed(4)], yaw: +q.yaw.toFixed(4) })),
    /** Social presets: the fired script events (record ids/status/diagnostic) and the scripted diagnostics. */
    social: () => {
      const s = scriptOf(sim.rt);
      if (!s) return null;
      return {
        fired: s.fired.map((f) => ({ id: f.id, label: f.label, tick: f.tick, cancelled: f.cancelled ?? null, recs: f.recs.map((r) => ({ id: r.id, verb: r.verb, status: r.status, phase: r.phase ?? null, code: r.diagnostic?.code ?? null, message: r.diagnostic?.message ?? null })) })),
        notes: s.notes.slice(),
      };
    },
    pause(on = true) {
      sim.paused = on;
      notify();
    },
    setSpeed(x: number) {
      sim.speed = x;
      notify();
    },
    state,
    violations: () => sim.rt.violations.map((v) => ({ ...v })),
    records: () => [...sim.rt.records.values()].map((r) => JSON.parse(JSON.stringify(r))),
    /** Cancel through the runtime's normal safety/deferred-stop contract (no pose mutation). */
    cancelAction(id: string) {
      const result = sim.rt.cancel(id);
      notify();
      return JSON.parse(JSON.stringify(result));
    },
    log: () => sim.log.slice(),
    setOverlay(name: OverlayName, on: boolean) {
      view.setOverlay(name, on);
      notify();
    },
    overlays: () => [...view.overlays],
    camera(pos: number[], target: number[], fov?: number) {
      return view.look(pos, target, fov);
    },
    /** Framing presets for a scenario: top-down diagnostic and oblique, or a named scenario view ('Oblique yard'). */
    cameraPreset(kind: string) {
      view.preset(kind);
    },
    cameraPose: () => view.cameraPose(),
    info: () => view.info(),
    perf: () => sim.stats(),
    /** Pose readout per person for the current tick (feet / soles, stair gait, posture, arms vs targets): docs/engineering/POSES.md. */
    bones: (id?: string) => view.poseNow().bones(id),
    /** Rendered body surface of one person (skinned vertices, every `stride`-th, with body part): body-vs-deck checks. */
    meshPoints: (id: string, stride = 3) => (view.poseNow(), view.humans.meshPoints(id, stride)),
    /** Held items (support in-hand): holder, hand, rendered item origin and the holder's rendered palm (after `bones()`). */
    heldItems: () =>
      Object.values(sim.rt.world.entities)
        .filter((e) => e.support?.kind === 'in-hand')
        .map((e) => {
          const s = e.support as { by: string; hand: 'left' | 'right' };
          const palm = new THREE.Vector3();
          const ok = view.humans.palmOf(s.by, s.hand, palm);
          return { id: e.id, def: e.def, by: s.by, hand: s.hand, rendered: view.components.positionOf(e.id), engine: e.pose.p, palm: ok ? palm.toArray() : null, fraction: e.contents?.fraction ?? null };
        }),
    /**
     * Body-model probe (preset `body` only): set a person's activity and hand points directly — renderer
     * state the engine never produced — in a detached renderer snapshot. Let pose layers settle for
     * `ticks` renderer ticks and return bones. Ordinary Step/Play/reset restores authoritative poses;
     * synthetic requests never change world state, action ownership, replay or invariants.
     */
    probe(id: string, spec: { activity?: string; hands?: { left?: [number, number, number]; right?: [number, number, number] } | null }, ticks = 24) {
      if (sim.scenario.name !== 'body') throw new Error('probe() is for the lab preset `body`');
      if (probeRuntime !== sim.rt || probeTick !== sim.rt.tick || !probeWorld) {
        probeWorld = structuredClone(sim.rt.world);
        probeRuntime = sim.rt;
        probeTick = sim.rt.tick;
      }
      const e = probeWorld.entities[id];
      if (!e?.human) return null;
      if (spec.activity) e.human.activity = spec.activity;
      if (spec.hands === null) delete e.human.hands;
      else if (spec.hands) e.human.hands = structuredClone(spec.hands);
      for (let i = 0; i < ticks; i++) view.humans.onTick(probeWorld);
      return view.poseNow().bones(id)[id] ?? null;
    },
    /**
     * Take-replay check (POSES.md "Take replay"): start recording the running lab world with the engine's
     * TakeRecorder (the studio's take format). Returns the recorder's start tick (take tick 0).
     */
    recordTake() {
      dropReplay();
      take = null;
      rec = new TakeRecorder(sim.rt, { rulesVersion: 'lab-replay-check' });
      return rec.startTick;
    },
    /**
     * Per person, the HumanState fields the take recorder does not record yet (engine W10 will add them):
     * hands, baseActivity, on. Specs build a FIXTURE from these (change events added to the lab-recorded
     * take) — not real recorder output.
     */
    humanFields: () =>
      Object.fromEntries(
        Object.values(sim.rt.world.entities)
          .filter((e) => e.kind === 'human')
          .map((e) => [e.id, { hands: e.human!.hands ? structuredClone(e.human!.hands) : null, baseActivity: e.human!.baseActivity ?? null, on: e.human!.on ?? null }]), // copies: the engine may update hands in place
      ),
    /**
     * Finish the recording (first call), add the spec's `extra` change events (the fixture fields), and pose
     * the take at time t through TakePeople — the studio replay's people/components path — with the lab
     * scene's base SpatialScene (its stairs links). `show` swaps the live people for the replayed ones on
     * screen. Returns the replay's bones() and its held items (rendered origin vs rendered palm).
     */
    replayTake(extra: ChangeEvent[], t: number, show = false) {
      if (!take) {
        if (!rec) throw new Error('replayTake() before recordTake()');
        take = rec.finish();
        rec = null;
        const all = [...take.changes, ...extra].map((c, i) => [c, i] as const);
        all.sort((a, b) => a[0][0] - b[0][0] || a[1] - b[1]); // by tick, stable
        take.changes = all.map(([c]) => c);
      }
      if (!replay) {
        replay = new TakePeople(take, { scene: sim.rt.services.spatial.base });
        replay.setTemplates(view.templates);
        view.scene.add(replay.group);
      }
      const frame = replay.show(t);
      replay.group.visible = show;
      view.humans.group.visible = !show;
      const held = Object.entries(frame.entities)
        .filter(([, e]) => (e.state.support as { kind?: string } | undefined)?.kind === 'in-hand')
        .map(([id, e]) => {
          const s = e.state.support as { by: string; hand: 'left' | 'right' };
          const palm = new THREE.Vector3();
          const ok = replay!.palmOf(s.by, s.hand, palm);
          return { id, by: s.by, hand: s.hand, rendered: replay!.positionOf(id), palm: ok ? palm.toArray() : null };
        });
      return { tick: frame.tick, bones: replay.bones(), held, flights: replay.flights().map((f) => f.id) };
    },
    /** Back to the live people (drops the replay rigs). */
    endReplay: () => dropReplay(),
    /** The body model: the renderer's copy (app/engine-view/rig.ts) and the engine's (engine/body/model.ts). */
    bodyModel: () => JSON.parse(JSON.stringify({ renderer: BODY_MODEL, engine: ENGINE_BODY_MODEL })),
    /**
     * Question captures (docs/engineering/questions/): outline entities / scene obstacles / region footprints by id
     * (`x` exact, `x*` prefix) on top of everything and label each with a word + arrow. Adds to earlier highlights;
     * `runScenario` and `clearHighlights()` drop them. Returns the ids found / missing and the union box; throws if none match.
     */
    highlight: (ids: string | string[], label?: string, opts?: HighlightOpts) => marks.add(sim.rt, Array.isArray(ids) ? ids : [ids], label, opts),
    clearHighlights: () => marks.clear(),
    /** Stair flights the renderer uses (tread centres along the axis and tread-top heights). */
    stairs: () => view.humans.stairs(),
  };
  (window as { __marsEngine?: unknown }).__marsEngine = hook;
  return hook;
}

export function removeHook() {
  delete (window as { __marsEngine?: unknown }).__marsEngine;
}
