// Humanoid@2 lab (not part of the app shell): /src/humanoid/lab.html?mode=grid&n=24&seed=7
//   grid     n composed looks from appearanceFromSeed(seed·1000 + i), with their profile icons
//   presets  today's GLB templates (left) and the composed presets (right), casual / punk / woman
//   parity   one body, fixed pose and camera: &preset=casual|punk|woman&src=legacy|kit (screenshot diff)
//   picker   the Soul-facing look picker (LookPicker) with live preview and icon
//   sizes    head size / height / build variants of one preset before a 1.75 m mark (&preset=…, &walk=1)
// window.__lab reports readiness and budgets (draw calls, triangles, textures, programs, kit bytes, keys).
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createRig, loadTemplates, type Rig, type Template} from '../../../../mars/viewer/app/engine-view/people.ts';
import {ThreeResources} from '../../../../mars/viewer/lib/three-resources.ts';
import {applyHumanFinish} from '../../../../mars/viewer/app/engine-view/content/details/human-presets/finish.ts';
import {WorldSoulAvatars, soulAvatars} from '../SoulAvatars.ts';
import {HumanoidKit} from './compose.ts';
import {appearanceFromSeed, describeLook, lookKey, PRESETS, resolveLook, type Look} from './look.ts';
import {socialLook} from './legacy.ts';
import {HumanActorAppearance} from '../../../../mars/viewer/app/engine-view/human-appearance.ts';
import {SOCIAL_PUBLIC_ASSIGNMENTS} from '../../../../mars/viewer/app/engine-view/content/details/human-presets/presets.mjs';
type SocialRow = {actorId: string; stableSoulKey: string; template: string; presetId: string};
const SOCIAL = SOCIAL_PUBLIC_ASSIGNMENTS as unknown as SocialRow[];
/** Today's look of an audited social Soul: its template GLB with the provenance-gated palette adapter. */
async function todaySocial(row: SocialRow, legacy: Template[], x: number, z: number) {
  const r = place(legacy.find(t => t.name === row.template)!, x, z, 0.3, 0.4);
  const ap = new HumanActorAppearance(r.model, r.appearance, row.stableSoulKey); await ap.ready;
  if (ap.snapshot().state !== 'attached') throw Error(`${row.actorId}: social palette not attached (${ap.snapshot().state})`);
  return r;
}
async function legacyTemplates(appearances = false) {
  const t = await loadTemplates(new AbortController().signal, new ThreeResources(), {appearances});
  for (const l of t) applyHumanFinish(l.name, l.gltf.scene);
  return t;
}

const q = new URLSearchParams(location.search), mode = q.get('mode') ?? 'grid';
const W = Number(q.get('w') ?? 1600), H = Number(q.get('h') ?? 1000);
const renderer = new THREE.WebGLRenderer({antialias: true, preserveDrawingBuffer: true});
renderer.setPixelRatio(1); renderer.setSize(W, H); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('view')!.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color('#dcd6c8');
scene.add(new THREE.HemisphereLight(0xfff4e0, 0x6b5a45, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.4); sun.position.set(4, 9, 7); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, {left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 30}); scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({color: '#c8bfa8', roughness: 1}));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 100);
const kit = new HumanoidKit(new GLTFLoader());
const rigs: Rig[] = [];
const lab: Record<string, unknown> = {ready: false, mode};
(window as unknown as {__lab: unknown}).__lab = lab;

/** A rig standing at (x, z), turned toward the camera by `turn` radians, frozen at Idle time t. */
function place(t: Template, x: number, z: number, turn: number, idle: number) {
  const r = createRig(t); r.holder.position.set(x, 0, z); r.holder.rotation.y = -Math.PI / 2 + turn;
  r.idle.time = idle; r.mixer.update(0); scene.add(r.holder); rigs.push(r); return r;
}
function stats() {
  renderer.info.autoReset = true; renderer.render(scene, camera);
  const shadowed = renderer.info.render.calls; sun.castShadow = false; renderer.render(scene, camera); const calls = renderer.info.render.calls, tris = renderer.info.render.triangles; sun.castShadow = true; renderer.render(scene, camera);
  let draws = 0; const geos = new Set<THREE.BufferGeometry>(), mats = new Set<THREE.Material>();
  const skeletons = new Set<THREE.Skeleton>(); let materialTextures = 0;
  for (const r of rigs) r.holder.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { draws++; geos.add(m.geometry); mats.add(m.material as THREE.Material); const sk = (o as THREE.SkinnedMesh).skeleton; if (sk) skeletons.add(sk); } });
  for (const m of mats) for (const v of Object.values(m)) if ((v as THREE.Texture | null)?.isTexture) materialTextures++;
  return {bodies: rigs.length, callsNoShadow: calls, callsWithShadow: shadowed, sceneCalls: 1, meshDraws: draws, triangles: tris, materialTextures, gpuTextures: renderer.info.memory.textures, boneTextures: skeletons.size, programs: renderer.info.programs?.length ?? null,
    geometries: geos.size, materials: mats.size, kitBytes: kit.bytes, kitFiles: kit.files};
}
const icons = document.getElementById('icons')!;
async function portraits(entries: {id: string; rig: Rig; label: string}[]) {
  const avatars = new WorldSoulAvatars(renderer);
  entries.forEach((e, i) => avatars.capture(e.id, e.id, e.rig.holder, false, (i + 1) * 1000));
  for (const e of entries) { const fig = document.createElement('figure'), img = document.createElement('img'); img.src = soulAvatars.images.get(e.id) ?? ''; img.alt = e.label; img.title = e.label;
    const cap = document.createElement('figcaption'); cap.textContent = e.id.replace(/^body-/, ''); fig.append(img, cap); icons.append(fig); }
  renderer.setRenderTarget(null); renderer.setSize(W, H);
  return entries.filter(e => soulAvatars.images.has(e.id)).length;
}

async function grid() {
  const n = Number(q.get('n') ?? 24), seed = Number(q.get('seed') ?? 7), cols = Math.ceil(Math.sqrt(n * W / H * 0.55)), rows = Math.ceil(n / cols);
  const looks: Look[] = Array.from({length: n}, (_, i) => appearanceFromSeed(seed * 1000 + i));
  const t0 = performance.now(); const templates = await Promise.all(looks.map(l => kit.template(l))); const composeMs = performance.now() - t0;
  const dx = 1.05, dz = 1.5, entries: {id: string; rig: Rig; label: string}[] = [];
  templates.forEach((t, i) => { const c = i % cols, r = Math.floor(i / cols);
    entries.push({id: `body-${i}`, rig: place(t, (c - (cols - 1) / 2) * dx + (r % 2) * 0.25, -r * dz, 0.32 - c * 0.04, (i * 0.137) % 1.6), label: describeLook(looks[i])}); });
  camera.position.set(0, 3.2 + rows * 0.55, 5.4 + rows * 0.2); camera.lookAt(0, 0.6, -(rows - 1) * dz / 2 - 0.4);
  Object.assign(lab, {looks, keys: looks.map(lookKey), distinctKeys: new Set(looks.map(lookKey)).size, composeMs: Math.round(composeMs), ...stats()});
  lab.icons = await portraits(entries);
  renderer.render(scene, camera);
}
async function presets() {
  const legacy = await loadTemplates(new AbortController().signal, new ThreeResources());
  for (const t of legacy) applyHumanFinish(t.name, t.gltf.scene);
  const entries: {id: string; rig: Rig; label: string}[] = [];
  for (const [i, p] of PRESETS.entries()) {
    entries.push({id: `today-${p}`, rig: place(legacy.find(t => t.name === p)!, (i - 1) * 2.4 - 0.5, 0, 0.25, 0.4), label: `today ${p}`});
    entries.push({id: `kit-${p}`, rig: place(await kit.template({preset: p}), (i - 1) * 2.4 + 0.5, 0, 0.25, 0.4), label: `humanoid@2 preset ${p}`});
  }
  camera.position.set(0, 1.6, 7.4); camera.lookAt(0, 0.95, 0);
  Object.assign(lab, stats()); lab.icons = await portraits(entries); renderer.render(scene, camera);
}
/** Rows of looks for close inspection: &set=props|parts|frames (a base look varied one key at a time). */
async function showcase() {
  const set = q.get('set') ?? 'props', head = q.get('zoom') === 'head', base: Partial<Look> = {...appearanceFromSeed(Number(q.get('seed') ?? 5)), hat: 'none', glasses: 'none', bag: 'none', pattern: 'plain'};
  const rows: Partial<Look>[][] = set === 'props'
    ? [[{hat: 'cap'}, {hat: 'beanie'}, {hat: 'sunhat'}, {glasses: 'round'}, {glasses: 'square'}, {glasses: 'shades'}], [{bag: 'backpack'}, {bag: 'satchel'}, {pattern: 'stripes'}, {pattern: 'checks'}, {pattern: 'knit'}, {hair: 'mohawk', hat: 'cap'}]]
    : set === 'parts'
      ? (['masc', 'fem'] as const).map(frame => (['short', 'mohawk', 'bob', 'bald'] as const).flatMap((hair): Partial<Look>[] => [{frame, hair, face: hair === 'bob' ? 'soft' : hair === 'mohawk' ? 'pierced' : 'open'}]).concat([{frame, top: 'jacket', bottom: 'slacks'}, {frame, top: 'tank', bottom: 'ripped'}]))
      : (['masc', 'fem'] as const).map(frame => (['shirt', 'jacket', 'tank'] as const).flatMap((top): Partial<Look>[] => [{frame, top, bottom: top === 'tank' ? 'slacks' : top === 'jacket' ? 'ripped' : 'jeans', shoes: top === 'tank' ? 'flats' : top === 'jacket' ? 'boots' : 'sneakers', top2: '#e8e4dc', bottom1: top === 'tank' ? '#9e6238' : '#333f47'}]).concat([{frame, headSize: 0.9}, {frame, headSize: 1.1}, {frame, face: 'soft', hair: 'bob', top: 'tank', bottom: 'slacks'}]));
  const entries: {id: string; rig: Rig; label: string}[] = [];
  for (const [r, row] of rows.entries()) for (const [c, edit] of row.entries()) {
    const look = {...base, ...edit}, n = rows.flat().length, i = rows.slice(0, r).flat().length + c, gap = head ? 0.62 : 0.9;
    entries.push({id: `${set}-${r}-${c}`, rig: place(await kit.template(look), (i - (n - 1) / 2) * gap, 0, 0.35, 0.4), label: describeLook(resolveLookSafe(look))});
  }
  const n = rows.flat().length, span = n * (head ? 0.62 : 0.9);
  if (head) { camera.fov = 20; camera.position.set(0, 1.62, span * 1.45 + 0.6); camera.lookAt(0, 1.55, 0); }
  else { camera.position.set(0, 1.3, span * 1.05 + 1.2); camera.lookAt(0, 0.9, 0); }
  camera.updateProjectionMatrix();
  Object.assign(lab, stats()); lab.icons = await portraits(entries);
  if (head || q.get('zoom') === 'full') lab.headshots = headshots(entries, Number(q.get('size') ?? 300), head);
  renderer.render(scene, camera);
}
/** Close head-and-shoulders shots of each rig (others hidden), as images in #icons. */
function headshots(entries: {id: string; rig: Rig; label: string}[], size: number, head = true) {
  const sw = size, sh = head ? size : Math.round(size * 1.7);
  icons.innerHTML = ''; icons.style.display = 'grid'; icons.style.gridTemplateColumns = `repeat(${Math.min(entries.length, Number(q.get('cols') ?? 6))}, ${sw}px)`;
  renderer.setSize(sw, sh); const cam = new THREE.PerspectiveCamera(head ? 24 : 26, sw / sh, 0.05, 20), all = rigs.map(r => r.holder.visible);
  for (const e of entries) {
    rigs.forEach(r => { r.holder.visible = r === e.rig; });
    const h = e.rig.model.getObjectByName('Head')!.getWorldPosition(new THREE.Vector3()), dir = new THREE.Vector3(Math.sin(0.5), 0.12, Math.cos(0.5));
    if (head) { cam.position.copy(h).addScaledVector(dir, 1.45).add(new THREE.Vector3(0, 0.05, 0)); cam.lookAt(h.x, h.y - 0.02, h.z); }
    else { const c = e.rig.holder.position.clone().add(new THREE.Vector3(0, 0.9, 0)); cam.position.copy(c).addScaledVector(new THREE.Vector3(Math.sin(0.5), 0.08, Math.cos(0.5)), 4.4); cam.lookAt(c); }
    renderer.render(scene, cam);
    const fig = document.createElement('figure'), img = document.createElement('img'); img.src = renderer.domElement.toDataURL('image/png'); img.style.width = sw + 'px'; img.style.height = sh + 'px'; img.style.borderRadius = '0';
    const cap = document.createElement('figcaption'); cap.textContent = e.label; cap.style.width = sw + 'px'; fig.append(img, cap); icons.append(fig);
  }
  rigs.forEach((r, i) => { r.holder.visible = all[i]; }); renderer.setSize(W, H); document.getElementById('view')!.style.display = 'none';
  return entries.length;
}
const resolveLookSafe = (l: Partial<Look>) => { try { return resolveLook(l); } catch { return resolveLook({}); } };
/** The 8 audited social Souls: today (adapter) above, the kit's explicit-colour looks below. */
async function social() {
  const legacy = await legacyTemplates(true), entries: {id: string; rig: Rig; label: string}[] = [];
  for (const [i, row] of SOCIAL.entries()) {
    const x = (i - 3.5) * 0.95;
    entries.push({id: `today-${row.actorId}`, rig: await todaySocial(row, legacy, x, 0), label: `today ${row.presetId}`});
    entries.push({id: `kit-${row.actorId}`, rig: place(await kit.template(socialLook(row.presetId)!), x, 1.6, 0.3, 0.4), label: `kit ${row.presetId}`});
  }
  camera.position.set(0, 2.2, 9.5); camera.lookAt(0, 0.9, 0.6);
  Object.assign(lab, stats()); lab.icons = await portraits(entries); renderer.render(scene, camera);
}
async function parity() {
  const p = (q.get('preset') ?? 'casual') as typeof PRESETS[number], src = q.get('src') ?? 'kit', soc = q.get('social');
  if (soc) { const row = SOCIAL.find(r => r.actorId === soc)!;
    if (src === 'legacy') await todaySocial(row, await legacyTemplates(true), 0, 0); else place(await kit.template(socialLook(row.presetId)!), 0, 0, 0.3, 0.4);
    camera.position.set(0, 1.25, 3.3); camera.lookAt(0, 0.92, 0); Object.assign(lab, stats()); renderer.render(scene, camera); return; }
  let t: Template;
  if (src === 'legacy') { const legacy = await loadTemplates(new AbortController().signal, new ThreeResources()); for (const l of legacy) applyHumanFinish(l.name, l.gltf.scene); t = legacy.find(l => l.name === p)!; }
  else t = await kit.template({preset: p});
  place(t, 0, 0, 0.3, 0.4);
  camera.position.set(0, 1.25, 3.3); camera.lookAt(0, 0.92, 0);
  Object.assign(lab, stats()); renderer.render(scene, camera);
}
/** The size params: today's preset beside heights, builds and head sizes, before a 1.75 m mark (&walk=1: mid-stride). */
async function sizes() {
  const base = (q.get('preset') ?? 'casual') as typeof PRESETS[number], walk = q.get('walk') === '1';
  const row: [string, Partial<Look>][] = [['1.55 m', {height: 1.55}], ['1.65 m', {height: 1.65}], ['today', {}], ['1.85 m', {height: 1.85}], ['1.95 m', {height: 1.95}],
    ['build 0.85', {build: 0.85}], ['build 1.2', {build: 1.2}], ['head 0.85', {headSize: 0.85}], ['head 1.2', {headSize: 1.2}], ['1.95 m, 1.2, head 1.1', {height: 1.95, build: 1.2, headSize: 1.1}]];
  const mark = new THREE.Mesh(new THREE.BoxGeometry(row.length * 0.85 + 0.6, 0.01, 0.01), new THREE.MeshBasicMaterial({color: '#7a6f5a'})); mark.position.set(0, 1.75, -0.5); scene.add(mark);
  const entries: {id: string; rig: Rig; label: string}[] = [], dims: Record<string, unknown>[] = [];
  for (const [i, [label, edit]] of row.entries()) {
    const t = await kit.template({preset: base, ...edit}), r = place(t, (i - (row.length - 1) / 2) * 0.85, 0, 0.3, 0.4);
    if (walk) { r.idle.setEffectiveWeight(0); r.walk.setEffectiveWeight(1); r.walk.time = 0.3; r.mixer.update(0); }
    r.holder.updateMatrixWorld(true);
    const top = new THREE.Box3().setFromObject(r.holder).max.y, sh = r.model.getObjectByName('UpperArmL')!.getWorldPosition(new THREE.Vector3()).y;
    dims.push({label, crown: +top.toFixed(3), shoulder: +sh.toFixed(3), bodyScale: t.bodyScale ?? 1, clipWalkSpeed: +t.walkSpeed.toFixed(3)});
    entries.push({id: `size-${i}`, rig: r, label});
  }
  camera.position.set(0, 1.25, 9.6); camera.lookAt(0, 1.0, 0);
  Object.assign(lab, stats(), {dims}); lab.icons = await portraits(entries); renderer.render(scene, camera);
}
async function picker() {
  const {mountLookPicker} = await import('./LookPicker.tsx');
  document.body.classList.add('picker'); renderer.domElement.style.display = 'none';
  const initial = q.get('look') ? JSON.parse(q.get('look')!) : appearanceFromSeed(Number(q.get('seed') ?? 11));
  await new Promise<void>(done => mountLookPicker(document.getElementById('picker')!, {kit, initial, onState: (s: Record<string, unknown>) => { Object.assign(lab, s); done(); }}));
}
try { await ({grid, presets, parity, picker, showcase, social, sizes} as Record<string, () => Promise<void>>)[mode](); lab.ready = true; }
catch (e) { lab.error = e instanceof Error ? e.message : String(e); console.error(e); }
