// Actual production HumanViews + kit mesh renderer. Posed geometry fixture only; root supplies native action proof.
import * as THREE from '../../apps/web/node_modules/three/build/three.module.js';
import { loadTemplates } from '../../mars/viewer/app/engine-view/people.ts';
import { ThreeResources } from '../../mars/viewer/lib/three-resources.ts';
import { WorldModel } from '../../packages/world-compiler/src/model.ts';
import { coreLibrary } from '../../packages/world-compiler/src/library.ts';
import { MaterialLib } from '../../apps/web/src/gen-mesh/materials.ts';
import { meshFor } from '../../apps/web/src/gen-mesh/registry.ts';
import '../../apps/web/src/gen-mesh/kit.mesh.ts';
const query = new URLSearchParams(location.search), baseline = query.has('baseline'), computer = query.has('computer'), groundSeat = query.has('ground');
const { HumanViews } = await import(/* @vite-ignore */ '../../mars/viewer/app/engine-view/humans.ts' + (baseline ? '?readingbaseline' : ''));
const scene = new THREE.Scene(); scene.background = new THREE.Color('#ddd6c7');
scene.add(new THREE.HemisphereLight('#fff5de', '#726a5b', 3));
const key = new THREE.DirectionalLight('#fff5e7', 3); key.position.set(3, 7, 4); scene.add(key);
const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, .05, 50);
camera.position.set(computer ? 2.6 : 2.1, computer ? 2 : 1.7, computer ? 3.2 : 2.2); camera.lookAt(0, .65, computer ? .25 : .05);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace; document.body.append(renderer.domElement);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: '#b6a991' })); ground.rotation.x = -Math.PI / 2; scene.add(ground);
const model = new WorldModel({ constants: { ground: 'land' }, seed: 'reading-chair-renderer' }); model.library = coreLibrary();
const materials = new MaterialLib();
const add = (ref: string, p: number[], yaw = 0, params = {}) => {
  const def = model.resolvedDef(ref)!, defaults = Object.fromEntries(Object.entries(def.params).filter(([, value]) => value.default !== undefined).map(([key, value]) => [key, value.default]));
  const entity = { id: 'fixture-' + ref, def: ref, in: { parent: 'world' }, p, r: yaw, state: { on: true }, params: { ...defaults, ...params } };
  const mesh = meshFor(def)!.build({ def, entity: entity as never, params: entity.params, baked: model.bake(def, entity.params, 7), model, materials, args: def.make.kind === 'gen' ? def.make.args ?? {} : {}, tint: (key, fallback) => entity.params[key] ?? def.palette?.[key] ?? fallback })!;
  mesh.position.set(...p as [number, number, number]); mesh.rotation.y = -yaw; scene.add(mesh);
};
if (computer) { add(`core/office-desk@${baseline ? 1 : 2}`, [0, 0, 0]); add('core/office-chair@1', [0, 0, 1], Math.PI); }
else if (!groundSeat) add('core/armchair@1', [0, 0, 0], -Math.PI / 2, { fabric: '#8ea47f' });
const resources = new ThreeResources(), templates = await loadTemplates(new AbortController().signal, resources), rigName = query.get('rig') ?? 'woman';
let id = ''; for (let k = 0; k < 500; k++) { const candidate = `read-${k}`; let hash = 0; for (const ch of candidate) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0; if (templates[hash % templates.length].name === rigName) { id = candidate; break; } }
const views = new HumanViews(false); views.setTemplates(templates); scene.add(views.group);
views.setFrame([{ id, p: computer ? [0, 0, 1] : [0, 0, 0], yaw: computer ? -Math.PI / 2 : 0, walk: 0, walkDist: 0, activityAge: 7.3, activity: computer ? 'use-computer' : 'read', baseActivity: groundSeat ? 'sit-ground' : 'sit', seatHeight: computer ? .49 : groundSeat ? .04 : .47 }], 7.3); views.render(1);
renderer.render(scene, camera);
document.getElementById('label')!.textContent = `${baseline ? 'Baseline' : 'Candidate'} · ${rigName} · ${computer ? 'computer and functional chair' : groundSeat ? 'ground reading' : 'seated reading'} · renderer geometry fixture`;
Object.assign(window, { readingChairFixture: { ready: true, baseline, computer, groundSeat, rigName, renderer, scene, views, model } });
