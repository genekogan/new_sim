// Engine Lab view: three.js renderer + orbit camera over a LabSim. The rAF
// loop feeds real elapsed time into the sim accumulator (sim time decoupled
// from fps) and renders interpolated state.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { ThreeResources } from '../../lib/three-resources';
import type { Spatial } from '../../engine/spatial/service.ts';
import { traffic } from '../../engine/locomotion/walk.ts';
import { classroomSessionId } from '../../engine/scenarios/classroom.ts';
import { readGatheringContinuation } from '../../engine/activities/gathering-continuation.ts';
import { readClassroom, readSharedFoodBreak } from '../../engine/activities/index.ts';
import { labCameraDiagnostic } from './camera-observation.ts';
import type { Runtime } from '../../engine/runtime/runtime.ts';
import { LabSim } from './sim.ts';
import { StaticScene } from './scene.ts';
import { HumanViews } from '../engine-view/humans.ts';
import { ComponentViews } from '../engine-view/components.ts';
import { FixtureViews } from '../engine-view/fixtures.ts';
import { loadTemplates, type Template } from '../engine-view/people.ts';
import { GridOverlays } from './overlay-grids.ts';
import { AgentOverlays } from './overlay-agents.ts';
import { buildLinks, buildObstacles, buildRoutes, buildViolations } from './overlay-debug.ts';
import { buildSlots } from './overlay-slots.ts';
import { buildPrisms, yearBackdrop, type Backdrop } from './year-walkabout-view.ts';

export const OVERLAYS = ['grid', 'routes', 'traffic', 'agents', 'obstacles', 'prisms', 'links', 'labels', 'violations', 'slots'] as const;
export type OverlayName = (typeof OVERLAYS)[number];

export class LabView {
  attentionTargets: Record<string, [number, number]> = {};
  readonly sim = new LabSim();
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
  readonly scene = new THREE.Scene();
  private css = new CSS2DRenderer();
  private orbit: OrbitControls;
  readonly humans = new HumanViews();
  readonly components = new ComponentViews();
  readonly fixtures = new FixtureViews();
  private hemi = new THREE.HemisphereLight('#dfefff', '#8a7355', 1.3);
  private sun = new THREE.DirectionalLight('#fff4e0', 2.4);
  private slotTick = -1;
  private grids = new GridOverlays();
  private agents = new AgentOverlays();
  private groups: Record<OverlayName, THREE.Group>;
  private statics?: Backdrop;
  private resources = new ThreeResources();
  private abort = new AbortController();
  private raf = 0;
  private last = 0;
  private epoch = -1;
  private violationCount = -1;
  private routeTick = -1;
  private stairEpoch = -1;
  private reach = (id: string, from: THREE.Vector3, out: THREE.Vector3) => this.components.nearestPoint(id, from, out);
  overlays = new Set<OverlayName>();
  /** The loaded people templates (the hook's take-replay check poses its own rigs from them). */
  templates: Template[] = [];
  frames = 0;
  loaded = false;
  error = '';
  onFrame: () => void = () => {};

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.host.appendChild(this.renderer.domElement);
    this.host.appendChild(this.css.domElement);
    this.css.domElement.className = 'lab-css';
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.maxPolarAngle = Math.PI * 0.495;
    this.scene.background = new THREE.Color('#bcd3e4');
    this.scene.fog = new THREE.Fog('#bcd3e4', 70, 160);
    this.scene.add(this.hemi);
    const sun = this.sun;
    sun.position.set(-20, 35, 15);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -35, right: 35, top: 35, bottom: -35, far: 100 });
    this.scene.add(sun, this.humans.group, this.components.group, this.fixtures.group);
    const mk = (n: string) => Object.assign(new THREE.Group(), { name: `overlay:${n}` });
    this.groups = { grid: this.grids.heat, traffic: this.grids.traffic, agents: this.agents.discs, labels: this.agents.labels, routes: mk('routes'), obstacles: mk('obstacles'), prisms: mk('prisms'), links: mk('links'), violations: mk('violations'), slots: mk('slots') };
    for (const g of Object.values(this.groups)) this.scene.add(g);
    this.sim.onReset = (rt) => this.reset(rt);
    this.sim.onTick = (rt) => {
      this.humans.onTick(rt.world);
      this.activityAttention(rt);
      this.components.onTick(rt.world);
      this.fixtures.onTick(rt.world);
    };
    loadTemplates(this.abort.signal, this.resources)
      .then((ts) => {
        this.templates = ts;
        this.humans.setTemplates(ts);
        this.humans.reset(this.sim.rt.world);
        this.loaded = true;
      })
      .catch((e) => {
        if (!this.abort.signal.aborted) this.error = `Animated people could not load: ${e.message}`;
      });
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  private reset(rt: LabSim['rt']) {
    this.attentionTargets = {};
    this.statics?.dispose();
    if (this.statics) this.scene.remove(this.statics.group);
    this.statics = yearBackdrop(rt, (m) => (this.error = m)) ?? new StaticScene(rt.services.spatial.base, this.sim.scenario.name === 'design-studio' ? { ground: '#d7d7d0', wall: '#f0eee5' } : undefined);
    this.scene.add(this.statics.group);
    const fog = this.scene.fog as THREE.Fog;
    [fog.near, fog.far] = this.statics.fog ?? [70, 160];
    this.humans.reset(rt.world);
    this.components.reset(rt.world);
    this.fixtures.reset(rt.world);
    this.lighting(!!this.sim.scenario.evening);
    this.slotTick = -1;
    this.agents.clear();
    this.epoch = -1;
    this.violationCount = -1;
    this.stairEpoch = -1;
    this.preset('oblique');
  }

  /** Day (default) or dusk: a low warm sun, dim blue sky, lit campfires. */
  private lighting(evening: boolean) {
    const sky = evening ? '#56607e' : '#bcd3e4';
    (this.scene.background as THREE.Color).set(sky);
    this.scene.fog!.color.set(sky);
    this.hemi.color.set(evening ? '#8d9cc4' : '#dfefff');
    this.hemi.groundColor.set(evening ? '#5a4632' : '#8a7355');
    this.hemi.intensity = evening ? 1.05 : 1.3;
    this.sun.color.set(evening ? '#ffab6e' : '#fff4e0');
    this.sun.intensity = evening ? 1.6 : 2.4;
    this.sun.position.set(-20, evening ? 18 : 35, 15);
    this.fixtures.setDusk(evening);
  }

  /** Framing presets from the scenario focus: straight-down diagnostic or oblique; or one of the scenario's named `views`. */
  preset(kind: string) {
    const v = this.sim.scenario.views?.[kind];
    if (v) {
      const pose = v();
      if (!pose) return;
      this.setFov(pose.fov);
      this.look(pose.position, pose.target);
      return;
    }
    if (kind !== 'top' && kind !== 'oblique') throw Error(`unknown view "${kind}" (have top, oblique${Object.keys(this.sim.scenario.views ?? {}).map((k) => `, ${k}`).join('')})`);
    this.setFov(45);
    const [x, z, r, az = 50] = this.sim.scenario.focus;
    const a = (az * Math.PI) / 180;
    if (kind === 'top') this.look([x, r * 2.6, z + 0.01], [x, 0, z]);
    else this.look([x + Math.cos(a) * r * 1.4, r * 0.9, z + Math.sin(a) * r * 1.4], [x, 0.8, z]);
  }

  /** Static geometry finished loading (year backdrops: Kit photos / 2026 GLB). */
  get staticsReady() {
    return this.statics?.ready?.() ?? true;
  }

  /** Camera readout (tests): position, orbit target, vertical fov. */
  cameraPose() {
    return { position: this.camera.position.toArray(), target: this.orbit.target.toArray(), fov: this.camera.fov };
  }

  private setFov(fov: number) {
    if (this.camera.fov === fov) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  look(pos: number[], target: number[], fov?: number) {
    const diagnostic = labCameraDiagnostic(pos, target, fov);
    if (diagnostic) return { ok: false as const, diagnostic };
    if (fov !== undefined) this.setFov(fov);
    this.camera.position.set(pos[0], pos[1], pos[2]);
    this.orbit.target.set(target[0], target[1], target[2]);
    this.orbit.update();
    return { ok: true as const };
  }

  setOverlay(name: OverlayName, on: boolean) {
    if (!OVERLAYS.includes(name)) throw Error(`unknown overlay "${name}" (have ${OVERLAYS.join(', ')})`);
    if (on) this.overlays.add(name);
    else this.overlays.delete(name);
    this.epoch = -1;
    this.slotTick = -1;
  }

  private resize() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.css.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private syncOverlays() {
    const rt = this.sim.rt, sp = rt.services.spatial as Spatial, on = this.overlays;
    sp.sync(rt.world);
    for (const n of OVERLAYS) this.groups[n].visible = on.has(n);
    const held = new Set(traffic(rt).keys());
    if (on.has('grid') || on.has('traffic')) this.grids.sync(sp, held);
    if (on.has('routes') && (this.routeTick !== rt.tick || this.epoch !== sp.epoch)) {
      this.routeTick = rt.tick;
      buildRoutes(this.groups.routes, rt);
    }
    if (this.epoch !== sp.epoch) {
      this.epoch = sp.epoch;
      if (on.has('obstacles')) buildObstacles(this.groups.obstacles, sp);
      if (on.has('prisms')) buildPrisms(this.groups.prisms, sp);
      if (on.has('links')) buildLinks(this.groups.links, sp);
    }
    if (on.has('slots') && this.slotTick !== rt.tick) {
      this.slotTick = rt.tick;
      buildSlots(this.groups.slots, rt);
    }
    if (on.has('violations') && rt.violations.length !== this.violationCount) {
      this.violationCount = rt.violations.length;
      buildViolations(this.groups.violations, rt.violations);
    }
    const now = new Set(rt.violations.filter((v) => v.tick === rt.tick).flatMap((v) => v.subjects ?? []));
    this.agents.update(rt, this.humans.positions(), now, on.has('agents'), on.has('labels'));
  }

  /** People's stair flights follow the Spatial scene's usable stairs links (construction adds them). */
  private syncStairs() {
    const sp = this.sim.rt.services.spatial as Spatial;
    sp.sync(this.sim.rt.world);
    if (sp.epoch === this.stairEpoch) return;
    this.stairEpoch = sp.epoch;
    this.humans.setStairs(sp.scene.links);
  }

  private activityAttention(rt: Runtime) {
    const id = classroomSessionId(rt), state = id ? readClassroom(rt, id) : undefined;
    const targets: Record<string, [number, number]> = {};
    if (state?.attentionTarget && ['presenting', 'question'].includes(state.phase))
      for (const person of state.participants)
        if (person.state === 'participating' && person.actor !== state.attentionTarget.actor) targets[person.actor] = state.attentionTarget.point;
    for (const group of state?.groups ?? [])
      if (group.status === 'talking' && group.attentionTarget)
        for (const actor of group.members)
          if (actor !== group.floorHolder) targets[actor] = group.attentionTarget.point;
    for (const action of rt.records.values()) {
      if (action.verb !== 'shared_food_break' || !rt.isActive(action.id)) continue;
      const food = readSharedFoodBreak(rt, action.id);
      if (!food?.attentionTarget || !food.group) continue;
      const point: [number, number] = [food.attentionTarget.position[0], food.attentionTarget.position[2]];
      for (const person of food.participants)
        if (person.actor !== food.floorHolder && rt.holder(`actor:${person.actor}`).includes(food.group)) targets[person.actor] = point;
    }
    for (const action of rt.records.values()) {
      if (action.verb !== 'gathering_continuation' || !rt.isActive(action.id)) continue;
      const continuation = readGatheringContinuation(rt, action.id);
      if (!continuation?.attentionTarget || !continuation.child || continuation.bindings.binding.kind !== 'discussion') continue;
      for (const actor of continuation.bindings.binding.actors)
        if (actor !== continuation.floorHolder && rt.holder(`actor:${actor}`).includes(continuation.child))
          targets[actor] = continuation.attentionTarget.point;
    }
    this.attentionTargets = targets;
    this.humans.setAttention(targets);
  }

  /** Pose everyone for the current tick without drawing (test hook `bones()`): same as a paused frame. */
  poseNow() {
    this.syncStairs();
    this.components.render(1);
    this.fixtures.render(this.sim.rt.time, 1);
    this.humans.render(1, this.reach);
    this.components.attachHeld(this.humans);
    return this.humans;
  }

  /** Render one frame; `dt` real seconds since the previous frame (0 = no sim advance). */
  frame(dt: number) {
    const alpha = this.sim.advance(dt);
    this.syncStairs();
    this.components.render(alpha);
    this.fixtures.render(this.sim.rt.time, alpha);
    this.humans.render(alpha, this.reach);
    this.components.attachHeld(this.humans);
    this.syncOverlays();
    this.renderer.render(this.scene, this.camera);
    this.css.render(this.scene, this.camera);
    this.frames++;
    this.onFrame();
  }

  start() {
    const loop = (t: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = this.last ? (t - this.last) / 1000 : 0;
      this.last = t;
      if (!document.hidden) this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  info() {
    const r = this.renderer.info;
    return { calls: r.render.calls, triangles: r.render.triangles, geometries: r.memory.geometries, textures: r.memory.textures, frames: this.frames, humans: this.humans.info() };
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.abort.abort();
    this.humans.clear();
    this.agents.clear();
    this.statics?.dispose();
    this.components.dispose();
    this.fixtures.dispose();
    this.resources.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.css.domElement.remove();
  }
}
