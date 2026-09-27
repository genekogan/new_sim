import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { createEnvironment } from '../studio/environment';
import { attachWalking } from '../studio/walking';
import { keepCameraAboveGround } from '../studio/camera-ground';
import { createBrahman2020Scene, type SiteFeature } from './scene';
import './style.css';

const EVIDENCE = [
  { image: '/2020/evidence/site-march4.webp', title: 'March 4 • site-wide aerial', source: 'media/drone/2020/drone_raw/DJI_0079.JPG', description: 'Overall relationships among the decks, container, Forest site, sphere, camp, and boundary.' },
  { image: '/2020/evidence/portal-depth-march9.webp', title: 'March 9 • Portal from above', source: 'media/drone/2020/drone_raw/DJI_0094.MP4 · 193s', description: 'Three bays across and two bays deep. This rainy-day view includes temporary blue tarps omitted from the model.' },
  { image: '/2020/evidence/side-stairs-march17.webp', title: 'March 17 • side-bay stair tiers', source: 'media/drone/2020/drone_edits/flythrough_03.17_2.mp4 · 9s', description: 'The two outer bays rise in broad steps toward the rear; the central passage stays open.' },
  { image: '/2020/evidence/portal-screens-2020.webp', title: '2020 • Portal display content', source: 'media/highlights/Brahman 2020/Brahman Documentation/Mars Portal/IMG_6831.HEIC', description: 'Three photographed rows show landscapes, color tests, and generative imagery, sampled on the modeled screens.' },
  { image: '/2020/evidence/climbing-wall-2020.webp', title: '2020 • climbing wall close-up', source: 'media/history/resident_blog_2020/assets/img/bbd/5-5.jpg', description: 'Plywood climbing panels are attached flush to the Portal’s exterior rack frame.' },
  { image: '/2020/evidence/rv-ring-march9.webp', title: 'March 9 • separate RV camp', source: 'media/drone/2020/drone_raw/DJI_0094.MP4 · 375s', description: 'Trailers and RVs form a small, loose ring outside the public campus tire boundary.' },
  { image: '/2020/evidence/forest-march9.webp', title: 'March 9 • Forest rack grid', source: 'media/drone/2020/drone_raw/DJI_0094.MP4', description: 'Open black upright frames with red horizontal beams, built as a separate installation.' },
  { image: '/2020/evidence/portal-march17.webp', title: 'March 17 • Portal and canopy', source: 'media/drone/2020/drone_edits/flythrough_03.17_2.mp4', description: 'Screen-lined racks, magenta mural on the solar container, and white tarp workshop.' },
  { image: '/2020/evidence/front-alignment-march17.webp', title: 'March 17 • frontage alignment', source: 'media/drone/2020/drone_edits/flythrough_03.17_2.mp4 · 7s', description: 'Portal frontage, container mural end, and the low sloping awning appear in one view.' },
  { image: '/2020/evidence/forest-march30.webp', title: 'March 30 • Forest lighting', source: 'media/drone/2020/drone_raw/DJI_0104.MP4', description: 'Night footage confirms installed horizontal lights late in the season.' },
];
const FEATURES = ['portal', 'container', 'canopy', 'forest', 'geodesic', 'mcda', 'trees', 'tent'];
const LABELS: Record<string, string> = {
  portal: 'Portal / climbing decks', container: 'Solar mural container', canopy: 'Canopy workshop',
  forest: 'The Forest', geodesic: 'Geodesic sphere', mcda: 'MCDA', trees: 'Desert trees', tent: 'Camp tent',
};
type ViewerApi = {
  focus: (id: string) => void;
  overview: () => void;
  walk: () => void;
  orbit: () => void;
  scope: (value: string) => void;
  mode: (value: string) => void;
  cut: (value: string) => void;
  surface: (value: string) => void;
  frame: () => void;
  reset: () => void;
  exportGlb: () => Promise<void>;
};
export default function Brahman2020() {
  const mount = useRef<HTMLDivElement>(null);
  const api = useRef<ViewerApi | null>(null);
  const [selected, setSelected] = useState('portal');
  const [walking, setWalking] = useState(false);
  const [scope, setScope] = useState('assembly');
  const [mode, setMode] = useState('inspect');
  const [cut, setCut] = useState('complete');
  const [surface, setSurface] = useState('source');
  const [evidence, setEvidence] = useState(0);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    const node = mount.current;
    if (!node) return;
    const previousTitle = document.title;
    document.title = 'Brahman 2020 · Mars campus model';
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 850);
    camera.position.set(40, 27, 52);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    node.appendChild(renderer.domElement);
    const environment = createEnvironment(scene, renderer);
    environment.update(16, 0, false);
    const model = createBrahman2020Scene();
    scene.add(model.root);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(4, 0.8, -8);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = 1.5;
    controls.maxDistance = 210;
    controls.update();
    const transform = new TransformControls(camera, renderer.domElement);
    transform.setTranslationSnap(0.01);
    transform.setRotationSnap(THREE.MathUtils.degToRad(1));
    scene.add(transform.getHelper());
    let dragging = false, selection: THREE.Object3D | null = null;
    let selectScope = 'assembly', editMode = 'inspect', cutMode = 'complete', surfaceMode = 'source';
    const outline = new THREE.BoxHelper(model.root, 0xe4e69c);
    outline.visible = false;
    scene.add(outline);
    const original = new Map<THREE.Object3D, { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }>();
    const originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    const genericMaterials = new Map<THREE.Material, THREE.Material>();
    model.root.traverse(object => {
      original.set(object, { position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone() });
      if (object instanceof THREE.Mesh) originalMaterials.set(object, object.material);
    });
    const choose = (object: THREE.Object3D | null) => {
      selection = object;
      transform.detach();
      outline.visible = !!object;
      if (object) {
        outline.setFromObject(object);
        if (editMode !== 'inspect') transform.attach(object);
        let parent: THREE.Object3D | null = object;
        while (parent && !parent.userData.id) parent = parent.parent;
        if (parent?.userData.id) setSelected(parent.userData.id);
      }
    };
    transform.addEventListener('dragging-changed', event => { dragging = !!event.value; controls.enabled = !dragging; });
    transform.addEventListener('objectChange', () => { if (selection) outline.setFromObject(selection); });
    const isInPortal = (object: THREE.Object3D) => {
      let parent: THREE.Object3D | null = object;
      while (parent && parent !== model.root) { if (parent.userData.id === 'portal') return true; parent = parent.parent; }
      return false;
    };
    const display = () => {
      model.root.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const name = object.name.toLowerCase();
        object.visible = cutMode === 'complete' ||
          (cutMode === 'inside' ? !(isInPortal(object) && (name.includes('ceiling') || name.includes('rooftop'))) :
            /rack|beam|upright|post|string|ridge|frame|diagonal|crossbar|trunk|branch|solar panel frame/.test(name));
        const saved = originalMaterials.get(object);
        if (!saved) return;
        if (surfaceMode === 'source' || name === 'portal tv screen') { object.material = saved; return; }
        const convert = (material: THREE.Material) => {
          let generic = genericMaterials.get(material);
          if (!generic) {
            generic = material.clone();
            if ('map' in generic) (generic as THREE.MeshStandardMaterial).map = null;
            genericMaterials.set(material, generic);
          }
          return generic;
        };
        object.material = Array.isArray(saved) ? saved.map(convert) : convert(saved);
      });
      if (selection && !selection.visible) { transform.detach(); outline.visible = false; }
    };
    const size = () => {
      const w = Math.max(1, node.clientWidth), h = Math.max(1, node.clientHeight);
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(size); observer.observe(node); size();
    const orbitPosition = new THREE.Vector3(), orbitTarget = new THREE.Vector3();
    let restoreOrbit = false;
    const walker = attachWalking(camera, renderer.domElement, () => [model.root],
      (active) => { setWalking(active); controls.enabled = !active; },
      () => { controls.enabled = false; transform.detach(); outline.visible = false; },
      () => { controls.enabled = true; if (restoreOrbit) { camera.position.copy(orbitPosition); controls.target.copy(orbitTarget); controls.update(); restoreOrbit = false; } if (selection) { outline.visible = true; if (editMode !== 'inspect') transform.attach(selection); } });
    const center = new THREE.Vector3();
    const focus = (id: string) => {
      const feature = model.features.find((f) => f.id === id);
      if (!feature) return;
      walker.stop();
      feature.object.getWorldPosition(center);
      if (id === 'site') center.set(4, 0, -7);
      controls.target.copy(center).add(new THREE.Vector3(0, 1.8, 0));
      camera.position.copy(controls.target).add(new THREE.Vector3(12, 9, 15));
      controls.update(); choose(feature.object); setSelected(id);
    };
    const overview = () => {
      walker.stop(); controls.target.set(4, 0.8, -8);
      camera.position.set(40, 27, 52); controls.update(); choose(null); setSelected('');
    };
    const frameSelection = () => {
      walker.stop();
      const target = selection || model.features.find(f => f.id === 'portal')?.object || model.root;
      const bounds = new THREE.Box3().setFromObject(target);
      if (bounds.isEmpty()) return;
      const center = bounds.getCenter(new THREE.Vector3());
      const radius = Math.max(3, bounds.getSize(new THREE.Vector3()).length() * 0.58);
      controls.target.copy(center); camera.position.copy(center).add(new THREE.Vector3(radius, radius * 0.63, radius)); controls.update();
    };
    const walk = () => {
      if (walker.active) return;
      orbitPosition.copy(camera.position); orbitTarget.copy(controls.target); restoreOrbit = true;
      const target = new THREE.Vector3();
      (selection || model.features.find(f => f.id === 'portal')?.object)?.getWorldPosition(target);
      camera.position.set(target.x, 1.7, target.z + 10);
      camera.lookAt(target.x, 1.6, target.z);
      walker.start();
    };
    const exportGlb = async () => {
      const exporter = new GLTFExporter();
      const data = await exporter.parseAsync(model.root, { binary: true, onlyVisible: true });
      if (!(data instanceof ArrayBuffer)) throw new Error('GLB export failed');
      const url = URL.createObjectURL(new Blob([data], { type: 'model/gltf-binary' }));
      const a = document.createElement('a'); a.href = url; a.download = 'brahman-mars-2020-late-march.glb'; a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 15000);
    };
    api.current = { focus, overview, walk, orbit: () => walker.stop(), exportGlb,
      scope: value => { selectScope = value; },
      mode: value => { walker.stop(); editMode = value; transform.detach(); if (value !== 'inspect' && selection) { transform.setMode(value === 'rotate' ? 'rotate' : 'translate'); transform.attach(selection); } },
      cut: value => { walker.stop(); cutMode = value; display(); },
      surface: value => { surfaceMode = value; display(); },
      frame: frameSelection,
      reset: () => { for (const [object, pose] of original) { object.position.copy(pose.position); object.quaternion.copy(pose.quaternion); object.scale.copy(pose.scale); } if (selection) outline.setFromObject(selection); },
    };
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const onClick = (ev: MouseEvent) => {
      if (walker.active) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(model.root, true)[0];
      if (!hit || dragging) return;
      let object: THREE.Object3D | null = hit.object;
      if (selectScope === 'component') { choose(object); return; }
      while (object && object !== model.root) {
        if (object.userData.id && object.userData.id !== 'site') { choose(object); return; }
        object = object.parent;
      }
    };
    renderer.domElement.addEventListener('click', onClick);
    let lastFrame = performance.now();
    let frame = 0;
    const render = () => {
      frame = requestAnimationFrame(render);
      const now = performance.now();
      const dt = Math.min((now - lastFrame) / 1000, 0.05);
      lastFrame = now;
      walker.update(dt);
      if (!walker.active) controls.update();
      keepCameraAboveGround(camera, walker.active ? undefined : controls.target);
      renderer.render(scene, camera);
    };
    render();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener('click', onClick);
      walker.dispose(); controls.dispose(); model.dispose(); environment.dispose();
      transform.dispose(); outline.geometry.dispose(); outline.material.dispose();
      for (const material of genericMaterials.values()) material.dispose();
      renderer.dispose(); renderer.domElement.remove(); api.current = null;
      document.title = previousTitle;
    };
  }, []);
  const selectedFeature = (id: string): SiteFeature | undefined => {
    // Labels and provenance are intentionally stable UI data; runtime group is scene-owned.
    const data: Record<string, [string, SiteFeature['confidence'], string]> = {
      portal: ['Portal / climbing decks', 'high', 'March 9 and 17 aerials; Portal interior photos'],
      container: ['Solar mural container', 'high', 'March 4 and 17 aerials'],
      canopy: ['White tarp workshop', 'medium', 'March 4 and 17 aerials'],
      forest: ['The Forest', 'high', 'March 9 and 30 drone footage'],
      geodesic: ['Geodesic sphere', 'high', 'March 4 aerial'],
      mcda: ['MCDA plywood shack', 'low', 'Ground photos and March 18 dusk footage; approximate position beside the Forest'],
      trees: ['desert tree row', 'medium', 'March 19–20 ground photographs; exact parcel position uncertain'],
      tent: ['Conical camp tent', 'medium', 'March 4 aerial'],
    };
    if (!data[id]) return undefined;
    return { id, title: data[id][0], confidence: data[id][1], source: data[id][2], object: null as unknown as THREE.Object3D };
  };
  const feature = selectedFeature(selected);
  const doExport = async () => {
    setExporting(true); setError('');
    try { await api.current?.exportGlb(); } catch (e) { setError((e as Error).message); } finally { setExporting(false); }
  };
  return <main className="brahman">
    <header className="brahman-header">
      <a className="brahman-logo" href="/studio/2020">M<span>20</span></a>
      <div className="brahman-title"><strong>Brahman campus</strong><small>Late March 2020 · evidence reconstruction</small></div>
      <nav className="brahman-years" aria-label="Campus year"><a className="current" href="/studio/2020">2020</a><a href="/studio">2026 ↗</a></nav>
      <button className="brahman-export" onClick={doExport} disabled={exporting}>{exporting ? 'Exporting…' : 'Download 3D model'}</button>
    </header>
    <div className="brahman-body">
      <aside className="brahman-sidebar">
        <div className="brahman-eyebrow">THE SECOND CAMPUS SCENE</div>
        <h1>Before Chiba.</h1>
        <p>The fullest documented state before the April teardown. This model combines late-March installation detail with the clearest March 4–17 aerial geometry.</p>
        <div className="brahman-actions"><button onClick={() => api.current?.overview()}>Whole site</button></div>
        <h2>Places and installations</h2>
        <div className="brahman-feature-list">{FEATURES.map(id => <button key={id} className={selected === id ? 'selected' : ''} onClick={() => api.current?.focus(id)}>{LABELS[id]}<span>↗</span></button>)}</div>
        {feature && <div className="brahman-feature-detail"><strong>{feature.title}</strong><span className={'confidence ' + feature.confidence}>{feature.confidence} confidence</span><p>{feature.source}</p></div>}
        <div className="brahman-limits"><strong>Precision note</strong><p>The main structure shapes and relative positions follow the aerials. Exact survey coordinates, interiors, and some installation locations remain unverified. MCDA’s placement is especially provisional.</p></div>
      </aside>
      <section className="brahman-stage">
        <div className="brahman-viewport" ref={mount} aria-label="3D model of Brahman campus in late March 2020" />
        <div className="brahman-stage-top">
          <label>View <select value={cut} onChange={e => { setCut(e.target.value); api.current?.cut(e.target.value); }}><option value="complete">Complete building</option><option value="inside">Interior cutaway</option><option value="frame">Rack & timber frame</option></select></label>
          <label>Finish <select value={surface} onChange={e => { setSurface(e.target.value); api.current?.surface(e.target.value); }}><option value="source">Photo + CAD finishes</option><option value="generic">Generic materials</option></select></label>
        </div>
        <div className="brahman-stage-toolbar">
          <button className={walking ? 'active' : ''} aria-pressed={walking} onClick={() => walking ? api.current?.orbit() : api.current?.walk()}>{walking ? 'Exit walk' : 'Walk · WASD'}</button>
          <label>Select <select value={scope} onChange={e => { setScope(e.target.value); api.current?.scope(e.target.value); }}><option value="assembly">Building</option><option value="component">Part</option></select></label>
          {(['inspect', 'translate', 'rotate'] as const).map(value => <button key={value} className={mode === value ? 'active' : ''} onClick={() => { setMode(value); api.current?.mode(value); }}>{value === 'translate' ? 'Move' : value === 'rotate' ? 'Rotate' : 'Inspect'}</button>)}
          <button onClick={() => api.current?.frame()}>Frame selection</button>
          <button onClick={() => api.current?.reset()}>Reset layout</button>
        </div>
        <div className="brahman-hud">{walking ? 'WASD move · Arrows turn / look · Space jump · Shift sprint · Esc exit' : 'Drag orbit · Wheel zoom · Click a structure'}</div>
        <div className="brahman-source"><button onClick={() => setEvidence((evidence + EVIDENCE.length - 1) % EVIDENCE.length)} aria-label="Previous evidence">‹</button><img src={EVIDENCE[evidence].image} alt={EVIDENCE[evidence].title}/><div><b>{EVIDENCE[evidence].title}</b><span>{EVIDENCE[evidence].description}</span><small>{EVIDENCE[evidence].source}</small></div><button onClick={() => setEvidence((evidence + 1) % EVIDENCE.length)} aria-label="Next evidence">›</button></div>
        {error && <div className="brahman-error" role="alert">{error}</div>}
      </section>
    </div>
  </main>;
}
