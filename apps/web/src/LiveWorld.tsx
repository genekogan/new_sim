import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TakePeople } from '../../../mars/viewer/app/engine-view/take-replay.ts';
import { loadTemplates } from '../../../mars/viewer/app/engine-view/people.ts';
import { ThreeResources } from '../../../mars/viewer/lib/three-resources.ts';
import type { Take } from '../../../mars/viewer/engine/take/types.ts';
import type { Sim } from './useSim.ts';
import { apiPath } from './world-path.ts';

type Chunk = { fromTick: number; toTick: number; take: Take };
export function LiveWorld({ sim, selected, onSelect }: { sim: Sim; selected: string | null; onSelect(id: string | null): void }) {
  const mount = useRef<HTMLDivElement>(null), context = useRef({ sim, selected, onSelect, follow: false });
  const [follow, setFollow] = useState(false), [status, setStatus] = useState('Connecting to the world…');
  context.current = { sim, selected, onSelect, follow };
  useEffect(() => {
    if (!mount.current) return;
    const host = mount.current, abort = new AbortController(), resources = new ThreeResources();
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#a6bed0');
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.domElement.setAttribute('aria-label', 'Live 3D world'); host.appendChild(renderer.domElement);
    const camera = new THREE.PerspectiveCamera(48, 1, .1, 500);
    camera.position.set(-17, 18, 16);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(-18, 0, -8); controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x496340, 2.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(20, 35, 15); scene.add(sun);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(130, 130), new THREE.MeshStandardMaterial({ color: '#b8a381', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -.02; scene.add(resources.object(ground));
    const resize = new ResizeObserver(() => { const w = host.clientWidth, h = host.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); }); resize.observe(host);
    let chunks: Chunk[] = [], people: TakePeople | null = null, applied: Chunk | null = null, after = -1, receivedAt = 0, serverTick = 0, frame = 0, templates: Awaited<ReturnType<typeof loadTemplates>> = [];
    void loadTemplates(abort.signal, resources).then(t => { templates = t; people?.setTemplates(t); }).catch(e => { if (!abort.signal.aborted) setStatus(`People models: ${e.message}`); });
    const poll = async () => {
      try {
        const res = await fetch(apiPath(`/v1/take?after=${after}`), { signal: abort.signal });
        if (!res.ok) throw Error(`World stream ${res.status}`);
        const data = await res.json() as { serverTick: number; chunks: Chunk[] };
        if (data.serverTick < after) { chunks = []; after = -1; }
        for (const chunk of data.chunks) if (!chunks.some(c => c.toTick === chunk.toTick)) chunks.push(chunk);
        chunks = chunks.slice(-12); after = chunks.at(-1)?.toTick ?? -1;
        serverTick = data.serverTick; receivedAt = performance.now();
        if (chunks.length) setStatus('Live · recorded on the server · about one second behind');
      } catch (e) { if (!abort.signal.aborted) setStatus(`Reconnecting: ${String(e)}`); }
    };
    void poll(); const timer = setInterval(() => void poll(), 1000);
    const animate = () => {
      if (abort.signal.aborted) return;
      frame = requestAnimationFrame(animate);
      const rate = context.current.sim.conn.heartbeat?.clockRate ?? 1;
      const paused = context.current.sim.conn.heartbeat?.paused;
      const tick = serverTick - 20 + (paused ? 0 : Math.min(1000, performance.now() - receivedAt) / 50 * rate);
      const chunk = chunks.find(c => c.fromTick <= tick && c.toTick >= tick) ?? chunks.at(-1);
      if (chunk) {
        if (!people) {
          people = new TakePeople(chunk.take); people.setTemplates(templates); scene.add(people.group);
          const actors = Object.values(chunk.take.finalState.entities).filter(e => e.kind === 'human');
          if (actors.length) {
            const center = new THREE.Vector3(); actors.forEach(e => center.add(new THREE.Vector3(...e.pose.p))); center.divideScalar(actors.length);
            controls.target.copy(center); camera.position.copy(center).add(new THREE.Vector3(9, 8, 11));
          }
        }
        if (chunk !== applied) { people.setTake(chunk.take); applied = chunk; }
        const time = Math.max(0, Math.min(chunk.take.ticks, tick - chunk.fromTick)) * chunk.take.dt;
        const sampled = people.show(time, tick / 20);
        const soul = context.current.sim.conn.replica.souls.get(context.current.selected ?? '');
        const entity = soul && sampled.entities[soul.entityId];
        if (context.current.follow && entity) {
          const target = new THREE.Vector3(...entity.p); target.y += 1;
          const offset = camera.position.clone().sub(controls.target);
          controls.target.lerp(target, .1); camera.position.copy(controls.target).add(offset);
        }
      }
      controls.update(); renderer.render(scene, camera);
    };
    const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
    const select = (event: PointerEvent) => {
      if (!people) return;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      ray.setFromCamera(mouse, camera);
      for (const hit of ray.intersectObjects(people.group.children, true)) {
        let object: THREE.Object3D | null = hit.object;
        while (object) {
          const soul = [...context.current.sim.conn.replica.souls.values()].find(s => s.entityId === object!.name);
          if (soul) { context.current.onSelect(soul.id); return; } object = object.parent;
        }
      }
    };
    renderer.domElement.addEventListener('pointerup', select); animate();
    return () => { abort.abort(); clearInterval(timer); cancelAnimationFrame(frame); resize.disconnect(); controls.dispose(); people?.dispose(); resources.dispose(); renderer.dispose(); renderer.domElement.remove(); };
  }, []);
  return <section className="wide"><div className="row"><h2>World</h2><span className="dim">{status}</span><button disabled={!selected} className={follow ? 'on' : ''} onClick={() => setFollow(!follow)}>follow selected Soul</button></div><div ref={mount} style={{height:540,width:'100%',touchAction:'none'}} /><p className="dim">Drag to orbit, scroll to move closer, click a Soul to select.</p></section>;
}
