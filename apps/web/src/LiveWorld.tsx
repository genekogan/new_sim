import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { TakePeople } from '../../../mars/viewer/app/engine-view/take-replay.ts';
import { loadTemplates } from '../../../mars/viewer/app/engine-view/people.ts';
import { FloaterView, KinScenery } from '../../../mars/viewer/app/engine-view/floaters.ts';
import { floaterBodiesOfTake, floaterBody } from '../../../mars/viewer/engine/bodies/index.ts';
import { ThreeResources } from '../../../mars/viewer/lib/three-resources.ts';
import type { Take } from '../../../mars/viewer/engine/take/types.ts';
import type { SampledEntity } from '../../../mars/viewer/engine/take/replay.ts';
import type { Entity } from '../../../mars/viewer/engine/world/types.ts';
import type { PlayView, PublicSoul } from '@sim/protocol';
import type { Sim } from './useSim.ts';
import { apiPath } from './world-path.ts';
import {
  agoText, chunkAt, clockText, Daylight, mergeWindow, MAX_PAST_CHUNKS, parseSceneInfo, placeOf, plainWords, rewindWindow, shiftIso, validChunks, WorldGeometry,
  type Chunk, type LiveTakes,
} from './WorldGeometry.ts';

// The shared live view: the world's recorded motion, streamed over the socket as short chunks and
// replayed a moment behind the server, over the camp's real ground, walls and doors. No engine runs here.

/** useSim's `takes` (the socket stream of recorded chunks); read loosely until every world sends it. */
const takesOf = (sim: Sim) => (sim as Sim & { takes?: LiveTakes | null }).takes ?? null;
const dtOf = (sim: Sim) => sim.conn.welcome?.dt ?? 0.05;
/** Server ticks per real second right now (0 while the world is paused). */
const tpsOf = (sim: Sim) => (sim.conn.heartbeat?.paused ? 0 : (sim.conn.heartbeat?.clockRate ?? sim.conn.welcome?.clockRate ?? 1)) / dtOf(sim);
/** Best estimate of the server's tick now, from the last chunk message. */
function serverNow(sim: Sim): number | null {
  const t = takesOf(sim);
  if (!t || typeof t.serverTick !== 'number') return null;
  return t.serverTick + Math.min(2, Math.max(0, (performance.now() - t.receivedAt) / 1000)) * tpsOf(sim);
}
/** Live playback sits this many ticks behind the server, so the next chunk has arrived before it is needed. */
const LIVE_DELAY = 30;
const HOUR_SECONDS = 3600;

type Past = { tick: number; playing: boolean; chunks: Chunk[]; extending: boolean; retryAt: number; ended: boolean };
/** What is on screen, for the panels (written by the frame loop, read on React renders). */
type Shown = { tick: number; datetime: string | null; take: Take | null; entities: Record<string, SampledEntity> };
type Label = { obj: CSS2DObject; name: HTMLElement; line: HTMLElement; card: HTMLElement; text: string };

async function fetchChunks(from: number, to: number, limit: number, signal: AbortSignal): Promise<Chunk[]> {
  let out: Chunk[] = [], cursor = from;
  for (let page = 0; page < 4 && out.length < limit; page++) {
    const res = await fetch(apiPath(`/v1/takes?from=${Math.floor(cursor)}&to=${Math.ceil(to)}&limit=${Math.min(MAX_PAST_CHUNKS, limit - out.length)}`), { signal });
    if (!res.ok) throw Error(`the server answered ${res.status}`);
    const body = (await res.json()) as { chunks?: unknown; next?: unknown };
    out = validChunks([...out, ...validChunks(body.chunks)]).slice(0, limit);
    const next = typeof body.next === 'number' ? body.next : null;
    if (next === null || next <= cursor || (out.at(-1)?.toTick ?? -Infinity) >= to) break;
    cursor = next;
  }
  return out;
}

/** The latest card each Soul played at or before `tick`. */
function cardsAt(plays: readonly PlayView[], tick: number): Map<string, PlayView> {
  const out = new Map<string, PlayView>();
  for (const p of plays) if (p.ok && p.tick <= tick && (out.get(p.soulId)?.tick ?? -1) <= p.tick) out.set(p.soulId, p);
  return out;
}
const cardText = (p: PlayView | undefined) => (p ? `“${p.card}”${p.targetName ? ` → ${p.targetName}` : ''}` : '');
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function LiveWorld({ sim, selected, onSelect }: { sim: Sim; selected: string | null; onSelect(id: string | null): void }) {
  const mount = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(false);
  const [thing, setThing] = useState<string | null>(null);
  const [mode, setMode] = useState<'live' | 'past'>('live');
  const [draft, setDraft] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const context = useRef({ sim, selected, onSelect, follow, thing, setThing });
  context.current = { sim, selected, onSelect, follow, thing, setThing };
  const past = useRef<Past | null>(null);
  const shown = useRef<Shown>({ tick: 0, datetime: null, take: null, entities: {} });
  const seeking = useRef<AbortController | null>(null);
  const controlsApi = useRef<{ overview(): void } | null>(null);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // a Soul picked elsewhere (the table, my Soul) replaces a picked thing
  useEffect(() => { if (selected) setThing(null); }, [selected]);

  useEffect(() => {
    if (!mount.current) return;
    const host = mount.current, abort = new AbortController(), resources = new ThreeResources();
    const problem = (text: string) => setProblems((p) => (p.includes(text) ? p : [...p, text]));
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch {
      problem('This browser could not start 3D graphics, so the world view is unavailable here.');
      return () => abort.abort();
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.setAttribute('aria-label', 'Live 3D view of the world');
    renderer.domElement.style.display = 'block';
    host.appendChild(renderer.domElement);
    const onContextLost = (e: Event) => { e.preventDefault(); problem('The 3D view lost its graphics context; it will come back when the browser restores it.'); };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    const labels2d = new CSS2DRenderer();
    Object.assign(labels2d.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' });
    host.appendChild(labels2d.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 600);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.minDistance = 2;
    controls.maxDistance = 180;
    const light = new Daylight(scene);
    let geometry = new WorldGeometry(null);
    scene.add(geometry.group);
    let framed = false;
    const overview = (b: readonly [number, number, number, number]) => {
      const [x0, z0, x1, z1] = b, span = Math.max(10, x1 - x0, z1 - z0);
      controls.target.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
      camera.position.set(controls.target.x + span * 0.1, span * 0.6, controls.target.z + span * 0.75);
      controls.update();
      framed = true;
    };
    overview(geometry.bounds);
    framed = false; // the placeholder ground does not count: frame again once the real layout (or the people) arrive
    controlsApi.current = { overview: () => overview(geometry.bounds) };
    const resize = new ResizeObserver(() => {
      const w = host.clientWidth, h = host.clientHeight;
      renderer.setSize(w, h, false); labels2d.setSize(w, h);
      camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
    });
    resize.observe(host);

    // models: one loader (Draco for the character scans) shared by buildings, floaters and kin
    const draco = new DRACOLoader().setDecoderPath('/mars-assets/draco/');
    const loader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
    const floaters = new FloaterView(scene, { baseUrl: '/world-assets/littlemartians/characters/', loader });
    const kin = new KinScenery(scene, { baseUrl: '/world-assets/littlemartians/characters/', loader });
    let templatesFailed = false, templates: Awaited<ReturnType<typeof loadTemplates>> = [];
    void loadTemplates(abort.signal, resources).then((t) => { templates = t; people?.setTemplates(t); }).catch(() => {
      if (abort.signal.aborted) return;
      templatesFailed = true;
      problem('The people models could not be loaded, so people are shown as simple figures.');
    });

    // the static layout: once, retried with backoff while the server is unreachable
    let dayTicks: number | null = null;
    let base: ReturnType<typeof parseSceneInfo>['scene'] = null, sceneSettled = false, people: TakePeople | null = null;
    const loadScene = async () => {
      for (let attempt = 0; !abort.signal.aborted; attempt++) {
        try {
          const res = await fetch(apiPath('/v1/scene'), { signal: abort.signal });
          if (!res.ok) throw Error(String(res.status));
          const info = parseSceneInfo(await res.json());
          if (abort.signal.aborted) return;
          base = info.scene; dayTicks = info.clock?.dayTicks ?? null;
          geometry.dispose();
          geometry = new WorldGeometry(base,info.ground);
          scene.add(geometry.group);
          light.fit(geometry.bounds);
          if (base) overview(geometry.bounds); // else the first recorded moment frames the view
          if (sceneSettled && people) { people.dispose(); people = null; applied = null; } // rebuilt with the layout's stairs
          sceneSettled = true;
          kin.place(info.kin);
          if (info.buildings.length) void geometry.addBuildings(info.buildings, loader).then((failed) => {
            if (failed.length && !abort.signal.aborted) problem(`Some buildings could not be shown (${failed.join(', ')}); their plain walls are drawn instead.`);
          });
          return;
        } catch {
          if (abort.signal.aborted) return;
          sceneSettled = true; // draw people on plain ground meanwhile
          if (attempt === 1) problem('The layout of the world could not be loaded yet; still trying.');
          await new Promise((r) => setTimeout(r, Math.min(30_000, 2000 * 2 ** attempt)));
        }
      }
    };
    void loadScene().then(() => setProblems((p) => p.filter((x) => !x.startsWith('The layout of the world'))));

    // selection marker and stand-in figures (used only if the people models fail)
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.64, 40), new THREE.MeshBasicMaterial({ color: 0xffd34d, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
    ring.rotation.x = -Math.PI / 2; ring.visible = false; scene.add(ring);
    const standInGeometry = new THREE.CapsuleGeometry(0.22, 1.2, 4, 12), standInMaterial = new THREE.MeshStandardMaterial({ color: 0x5d7f9e, roughness: 0.7 });
    const standIns = new THREE.Group(); scene.add(standIns);
    const labels = new Map<string, Label>();
    const labelFor = (soul: PublicSoul): Label => {
      let l = labels.get(soul.id);
      if (l) return l;
      const el = document.createElement('div');
      el.style.cssText = 'font:11px/1.25 system-ui,sans-serif;color:#fff;background:rgba(18,20,18,.66);padding:2px 7px 3px;border-radius:5px;text-align:center;white-space:nowrap;pointer-events:auto;cursor:pointer;max-width:260px';
      const name = document.createElement('b'), line = document.createElement('div'), card = document.createElement('div');
      line.style.cssText = 'opacity:.85'; card.style.cssText = 'opacity:.7;font-style:italic';
      el.append(name, line, card);
      el.addEventListener('click', () => { context.current.setThing(null); context.current.onSelect(soul.id); });
      const obj = new CSS2DObject(el);
      obj.center.set(0.5, 1);
      scene.add(obj);
      l = { obj, name, line, card, text: '' };
      labels.set(soul.id, l);
      return l;
    };

    let liveArr: unknown = null, liveKey = '', live: Chunk[] = [], liveTick: number | null = null;
    const spot = new THREE.Vector3();
    let applied: Chunk | null = null, records: Record<string, Entity> = {}, frame = 0, last = performance.now(), labelAt = 0, brokenTake: string | null = null;
    const liveChunks = () => {
      const t = takesOf(context.current.sim);
      const arr = t?.chunks ?? null, key = `${arr?.length ?? 0}:${(arr?.at(-1) as { toTick?: number } | undefined)?.toTick ?? ''}`;
      if (arr !== liveArr || key !== liveKey) { liveArr = arr; liveKey = key; live = validChunks(arr).filter((c) => c.fromTick <= (t?.serverTick ?? Infinity)); } // a restarted server starts its ticks again
      return live;
    };
    const goLive = () => { past.current = null; liveTick = null; setMode('live'); setNote(null); };

    const animate = () => {
      if (abort.signal.aborted) return;
      frame = requestAnimationFrame(animate);
      const now = performance.now(), step = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = context.current.sim, dt = dtOf(s), liveList = liveChunks();
      let chunks: Chunk[], tick: number;
      const p = past.current;
      if (p) {
        const end = p.chunks.at(-1)!;
        if (p.playing) p.tick = Math.min(end.toTick, p.tick + step / dt); // replays run at the world's normal speed
        if (liveList.length && p.tick >= liveList[0].fromTick + 20) { goLive(); return; } // caught up with the present
        if (p.playing && !p.extending && !p.ended && now > p.retryAt && p.tick > end.toTick - 20 / dt) {
          p.extending = true;
          void fetchChunks(end.toTick, end.toTick + 60 / dt, 60, abort.signal).then((got) => {
            if (past.current !== p) return;
            const before = p.chunks.at(-1)!.toTick;
            p.chunks = mergeWindow(p.chunks, got, p.tick);
            if (p.chunks.at(-1)!.toTick <= before) p.ended = true;
          }).catch(() => { p.retryAt = performance.now() + 5000; }).finally(() => { p.extending = false; });
        }
        if (p.ended && p.tick >= end.toTick && p.playing) {
          const at = serverNow(s);
          if (at !== null && at - end.toTick < 120 / dt) { goLive(); return; } // only the last moments are missing: they are live
          p.playing = false;
          setNote('This is the end of what was recorded here. Go back to live to continue.');
        }
        chunks = p.chunks; tick = p.tick;
      } else {
        chunks = liveList;
        const target = (serverNow(s) ?? chunks.at(-1)?.toTick ?? 0) - LIVE_DELAY;
        if (liveTick === null || Math.abs(target - liveTick) > 80) liveTick = target;
        else liveTick += step * tpsOf(s) + (target - liveTick) * Math.min(1, step * 1.5); // run at the clock rate, drift gently toward the server
        if (chunks.length) liveTick = Math.max(chunks[0].fromTick, Math.min(chunks.at(-1)!.toTick, liveTick));
        tick = liveTick;
      }

      const pick = sceneSettled ? chunkAt(chunks, tick) : null;
      if (pick) {
        const chunk = pick.chunk, take = chunk.take;
        try {
          if (!people) {
            people = new TakePeople(take, { scene: base ?? undefined });
            people.setTemplates(templates);
            scene.add(people.group);
          }
          if (chunk !== applied) {
            people.setTake(take);
            floaters.sync(floaterBodiesOfTake(take));
            records = { ...(take.entities0 as Record<string, Entity> | undefined), ...take.finalState.entities };
            applied = chunk;
            if (!framed) { // no layout: frame whatever the world has in it
              const box = new THREE.Box3();
              for (const e of Object.values(take.finalState.entities)) box.expandByPoint(new THREE.Vector3(...e.pose.p));
              if (!box.isEmpty()) overview([box.min.x - 4, box.min.z - 4, box.max.x + 4, box.max.z + 4]);
            }
          }
          const local = Math.max(0, Math.min(take.ticks, tick - take.startTick));
          const sampled = people.show(local * take.dt, tick * dt);
          floaters.update(sampled.entities, take.startTick + sampled.tick, take.dt); // absolute tick: the bob is replay-stable
          kin.update(tick, dt);
          // stand-ins if the people models never arrived
          if (templatesFailed) {
            const seen = new Set<string>();
            for (const [id, e] of Object.entries(sampled.entities)) {
              const rec = records[id];
              if (rec?.kind !== 'human' || rec.body?.family === 'floater') continue;
              seen.add(id);
              let m = standIns.getObjectByName(id) as THREE.Mesh | undefined;
              if (!m) { m = new THREE.Mesh(standInGeometry, standInMaterial); m.name = id; m.castShadow = true; standIns.add(m); }
              m.position.set(e.p[0], e.p[1] + 0.82, e.p[2]);
            }
            for (const m of [...standIns.children]) if (!seen.has(m.name)) standIns.remove(m);
          }
          // world clock at the moment shown (the sim's clock, moved back by how far behind it we are)
          const clock = take.finalState.env?.datetime ?? null;
          const ref = take.startTick + take.ticks;
          const datetime = clock ? shiftIso(clock, (tick - ref) * (dayTicks ? 86400 / dayTicks : dt)) : null;
          light.update(datetime);
          shown.current = { tick, datetime, take, entities: sampled.entities };
          brokenTake = null;
        } catch (e) {
          if (brokenTake !== take.id) { brokenTake = take.id; console.warn('live view: a recorded moment could not be drawn', e); }
        }
      }

      // names over Souls, the selection ring, follow
      const { selected: soulId, thing: thingId, follow: following } = context.current;
      const souls = [...s.conn.replica.souls.values()], at = shown.current;
      const refresh = now - labelAt > 250;
      if (refresh) labelAt = now;
      const cards = refresh ? cardsAt(s.plays, at.tick) : null;
      const alive = new Set<string>();
      let focus: THREE.Vector3 | null = null;
      for (const soul of souls) {
        const pos = at.entities[soul.entityId]?.p, rec = records[soul.entityId];
        if (!pos) continue;
        alive.add(soul.id);
        const lift = rec?.body?.family === 'floater' ? (() => { const b = floaterBody(rec.body); return b.hoverHeight + b.radius + 0.15; })() : 2.05;
        const l = labelFor(soul);
        l.obj.position.set(pos[0], pos[1] + lift, pos[2]);
        l.obj.visible = true;
        if (cards) {
          const activity = at.entities[soul.entityId]?.activity;
          const doing = past.current ? plainWords(activity) : soul.doing || plainWords(activity);
          const card = cardText(cards.get(soul.id));
          const text = `${soul.name}|${doing}|${card}|${soul.id === soulId}`;
          if (text !== l.text) {
            l.text = text; l.name.textContent = soul.name; l.line.textContent = clip(doing, 48); l.card.textContent = clip(card, 48);
            l.line.style.display = doing && soul.id===soulId ? '' : 'none'; l.card.style.display = card && soul.id===soulId ? '' : 'none';
            (l.obj.element as HTMLElement).style.outline = soul.id === soulId ? '2px solid #ffd34d' : 'none';
          }
        }
        if (soul.id === soulId) focus = spot.set(pos[0], pos[1], pos[2]);
      }
      for (const [id, l] of labels) if (!alive.has(id)) { l.obj.visible = false; if (!s.conn.replica.souls.has(id)) { scene.remove(l.obj); l.obj.element.remove(); labels.delete(id); } }
      if (!focus && thingId) {
        const q = thingId.startsWith('kin:') ? kin.view.object(thingId)?.position.toArray() : at.entities[thingId]?.p;
        if (q) focus = spot.set(q[0], q[1], q[2]);
      }
      ring.visible = !!focus;
      if (focus) {
        ring.position.set(focus.x, (thingId?.startsWith('kin:') ? 0 : focus.y) + 0.03, focus.z);
        if (following) {
          const target = new THREE.Vector3(focus.x, (thingId?.startsWith('kin:') ? 0 : focus.y) + 1, focus.z);
          const offset = camera.position.clone().sub(controls.target);
          controls.target.lerp(target, 0.1); camera.position.copy(controls.target).add(offset);
        }
      }
      controls.update();
      renderer.render(scene, camera);
      labels2d.render(scene, camera);
    };

    // click (not drag) to select a Soul, a thing, or a kin
    const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down = null; return; }
      down = null;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(mouse, camera);
      const targets = [floaters.root, kin.view.root, standIns, ...(people ? [people.group] : [])];
      for (const hit of ray.intersectObjects(targets, true)) {
        let o: THREE.Object3D | null = hit.object, id: string | null = null;
        while (o && !id) { id = typeof o.userData.entity === 'string' ? o.userData.entity : o.name && records[o.name] ? o.name : null; o = o.parent; }
        if (!id) continue;
        const soul = [...context.current.sim.conn.replica.souls.values()].find((x) => x.entityId === id);
        if (soul) { context.current.setThing(null); context.current.onSelect(soul.id); }
        else { context.current.onSelect(null); context.current.setThing(id); }
        return;
      }
      context.current.setThing(null); // empty ground: let go of a thing (a Soul stays selected)
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    animate();

    return () => {
      abort.abort();
      cancelAnimationFrame(frame);
      resize.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      controls.dispose();
      controlsApi.current = null;
      for (const l of labels.values()) { scene.remove(l.obj); l.obj.element.remove(); }
      labels.clear();
      people?.dispose();
      floaters.dispose();
      kin.dispose();
      draco.dispose();
      geometry.dispose();
      light.dispose();
      ring.geometry.dispose(); (ring.material as THREE.Material).dispose();
      standInGeometry.dispose(); standInMaterial.dispose();
      resources.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      labels2d.domElement.remove();
    };
  }, []);

  // stop any rewind fetch when the view goes away
  useEffect(() => () => { seeking.current?.abort(); if (commitTimer.current) clearTimeout(commitTimer.current); }, []);

  // ------------------------------------------------------------------ rewind
  const dt = dtOf(sim), now = serverNow(sim), hour = HOUR_SECONDS / dt;
  const p = past.current;
  const shownTick = p ? p.tick : (now ?? 0);
  const lo = Math.max(0, Math.floor((now ?? 0) - hour)), hi = Math.max(lo + 1, Math.floor(now ?? 0));
  const goLive = () => { seeking.current?.abort(); seeking.current = null; setLoading(false); past.current = null; setDraft(null); setNote(null); setMode('live'); };
  const seek = async (wanted: number) => {
    const s = context.current.sim, at = serverNow(s), dts = dtOf(s);
    if (at === null) { setDraft(null); return; }
    const live = validChunks(takesOf(s)?.chunks);
    if (wanted >= at - 3 / dts || (live.length && wanted >= live[0].fromTick)) { goLive(); return; }
    const tick = Math.floor(Math.max(at - HOUR_SECONDS / dts, wanted, 0));
    const cur = past.current;
    if (cur && cur.chunks[0].fromTick <= tick && tick <= cur.chunks.at(-1)!.toTick) { cur.tick = tick; setDraft(null); setNote(null); return; }
    seeking.current?.abort();
    const ctl = new AbortController();
    seeking.current = ctl;
    setLoading(true); setNote(null);
    try {
      const { from, to } = rewindWindow(tick, 1 / dts);
      const got = await fetchChunks(from, to, MAX_PAST_CHUNKS, ctl.signal);
      if (ctl.signal.aborted) return;
      if (!got.length) { setNote('Nothing was recorded at that moment. Try a later time.'); return; }
      past.current = { tick: Math.max(got[0].fromTick, Math.min(got.at(-1)!.toTick, tick)), playing: cur?.playing ?? true, chunks: got, extending: false, retryAt: 0, ended: false };
      setMode('past');
      if (got[0].fromTick > tick + 5 / dts) setNote('The recording starts later than that, so this is the earliest moment kept.');
    } catch {
      if (!ctl.signal.aborted) setNote('That moment could not be loaded. Check the connection and try again.');
    } finally {
      if (seeking.current === ctl) { seeking.current = null; setLoading(false); setDraft(null); }
    }
  };
  const commit = (v: number) => { if (commitTimer.current) clearTimeout(commitTimer.current); commitTimer.current = null; void seek(v); };
  const onSlide = (v: number) => {
    setDraft(v);
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => commit(v), 600); // keyboard and slow drags; a release commits at once
  };
  const togglePlay = () => { if (past.current) { past.current.playing = !past.current.playing; setNote(null); setMode('past'); } };

  // ------------------------------------------------------------------ what is shown
  const s = shown.current, r = sim.conn.replica, state = sim.conn.stats.state;
  const takes = takesOf(sim);
  const status = state !== 'open' ? 'Reconnecting to the world…' : !takes ? 'Waiting for the world…' : null;
  const when = clockText(s.datetime);
  const ago = p && now !== null ? agoText((now - p.tick) * dt) : '';
  const soul = selected ? r.souls.get(selected) : undefined;
  const cards = cardsAt(sim.plays, s.tick);
  return (
    <section className="wide">
      <div className="row">
        <h2 style={{ margin: 0 }}>World</h2>
        {mode === 'live' && !status ? <span className="ok"><b>● Live</b></span> : null}
        {mode === 'past' ? <span className="warn"><b>⏪ Replaying {ago}</b></span> : null}
        {status ? <span className="dim">{status}</span> : null}
        {when ? <span className="dim">world time {when}</span> : null}
        <span style={{ marginLeft: 'auto' }} />
        <button onClick={() => controlsApi.current?.overview()}>see everything</button>
        <button disabled={!selected && !thing} className={follow ? 'on primary' : ''} onClick={() => setFollow(!follow)}>{follow ? 'following' : 'follow selected'}</button>
      </div>
      <div style={{ position: 'relative', height: 540, width: '100%', overflow: 'hidden', borderRadius: 4 }}>
        <div ref={mount} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />
        {(soul || thing) && <InfoPanel sim={sim} soul={soul ?? null} thing={thing} shown={s} card={soul ? cardText(cards.get(soul.id)) : ''} past={!!p} close={() => { setThing(null); if (soul) onSelect(null); }} />}
      </div>
      <div className="row">
        <span className={mode === 'live' ? 'ok' : 'warn'} style={{ minWidth: 96 }}>{mode === 'live' ? 'Live now' : `Earlier · ${ago}`}</span>
        <input type="range" aria-label="Look back over the last hour" min={lo} max={hi} step={1} disabled={now === null}
          value={Math.max(lo, Math.min(hi, draft ?? shownTick))}
          onChange={(e) => onSlide(Number(e.target.value))}
          onPointerUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
          onKeyUp={(e) => { if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' || e.key.startsWith('Page')) commit(Number((e.target as HTMLInputElement).value)); }} />
        <button disabled={now === null || loading} onClick={() => commit((draft ?? shownTick) - 60 / dt)}>back 1 min</button>
        {p ? <button onClick={togglePlay}>{p.playing ? 'pause' : 'play'}</button> : null}
        {p || loading ? <button className="primary" onClick={goLive}>back to live</button> : null}
      </div>
      {loading ? <p className="dim">Loading that moment…</p> : null}
      {draft !== null && !loading && now !== null ? <p className="dim">Release to watch from {agoText((now - draft) * dt)}.</p> : null}
      {note ? <p className="warn">{note}</p> : null}
      {problems.map((x) => <p key={x} className="warn">{x}</p>)}
      <p className="dim">Drag to look around, scroll to zoom, click a person or an object to see what it is. The slider looks back over the last hour; “back to live” returns to now.</p>
    </section>
  );
}

const panelStyle: React.CSSProperties = { position: 'absolute', top: 10, left: 10, zIndex: 2, maxWidth: 300, background: 'var(--panel)', color: 'var(--fg)', border: '1px solid var(--line)', borderRadius: 6, padding: '8px 10px', boxShadow: '0 2px 10px rgba(0,0,0,.18)' };

/** A small card about the selected Soul or thing, from what is on screen and the world's public state. */
function InfoPanel({ sim, soul, thing, shown, card, past, close }: { sim: Sim; soul: PublicSoul | null; thing: string | null; shown: Shown; card: string; past: boolean; close(): void }) {
  const head = (title: string) => <div className="row" style={{ margin: 0 }}><b style={{ flex: 1 }}>{title}</b><button aria-label="close" onClick={close}>×</button></div>;
  const regions = shown.take?.finalState.regions;
  if (soul) {
    const e = shown.entities[soul.entityId], where = e ? placeOf(e.p, regions) : null;
    const doing = past ? plainWords(e?.activity) : soul.doing || plainWords(e?.activity);
    return (
      <div style={panelStyle}>
        {head(soul.name)}
        <div className="dim">{soul.description}</div>
        {doing ? <div>{doing}</div> : null}
        {card ? <div className="dim">last card {card}</div> : null}
        {where ? <div className="dim">in {where}</div> : null}
        {!e ? <div className="dim">not in view at this moment</div> : null}
      </div>
    );
  }
  if (!thing) return null;
  if (thing.startsWith('kin:')) {
    return <div style={panelStyle}>{head(plainWords(thing.split(':')[2]) || 'kin')}<div className="dim">A kin floating by. Part of the scenery, not a Soul.</div></div>;
  }
  const take = shown.take, rec = take?.finalState.entities[thing] ?? (take?.entities0?.[thing] as Entity | undefined), e = shown.entities[thing];
  const k = sim.kernel?.things[thing];
  const name = k?.name ?? rec?.label ?? plainWords(rec?.def ?? thing);
  const kind = rec ? (rec.kind === 'human' ? 'a person' : plainWords(rec.def)) : '';
  const where = placeOf(e?.p ?? rec?.pose.p ?? [0, 0, 0], regions);
  const st = (e?.state ?? {}) as { contents?: Entity['contents'] | null };
  const contents = st.contents ?? rec?.contents;
  const phase = e?.phase ?? rec?.phase;
  return (
    <div style={panelStyle}>
      {head(name)}
      {kind && kind !== name.toLowerCase() ? <div className="dim">{kind}</div> : null}
      {where ? <div className="dim">in {where}</div> : null}
      {contents ? <div>{contents.fraction > 0 ? `${plainWords(contents.food)}, ${Math.round(contents.fraction * 100)}% full` : 'empty'}</div> : null}
      {phase ? <div>{plainWords(String(phase))}</div> : null}
      {k ? Object.entries(k.states).slice(0, 6).map(([key, v]) => <div key={key}><span className="dim">{plainWords(key)}</span> {typeof v === 'object' ? JSON.stringify(v) : String(v)}</div>) : null}
      {!rec && !e ? <div className="dim">Not here at this moment.</div> : null}
    </div>
  );
}
