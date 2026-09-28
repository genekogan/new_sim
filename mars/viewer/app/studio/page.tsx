import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import {
  ThreeResources,
  loadGltf,
  disposeSkeletons,
} from '../../lib/three-resources';
import { createRenderBatches } from '../../lib/render-batches';
import { validateLayout, type IdMigration } from '../../lib/layout';
import {
  nestedTransforms,
  applyNestedTransforms,
} from '../../lib/layout-transforms';
import type { Edit } from '../../lib/layout';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import './studio.css';
import { attachWalking } from './walking';
import { createEnvironment } from './environment';
import { keepCameraAboveGround } from './camera-ground';
import { createEucFollowCamera } from './euc-follow-camera';
import { createCampusLife } from './campus-life';
import { SimulationPanel } from './simulation-panel';
import { createTakeHost, type TakeHost } from './take-host';
import { TakePanel } from './take-panel';
import { createWeather } from './weather';
import { DEFAULT_SCENE_DATE } from '../../engine/env/sun';
import { createGallery } from './gallery';
import { add2026Details } from '../history/details-2026';
import { createHistoricalScreens } from '../history/screens';
import { createHistoricalScene, sceneManifest, historyNotes, YEARS } from '../history/scenes';
import {
  hourAt,
  simTime,
  cameraPose,
  type SimSnapshot,
} from '../../simulation/shared';
type Ref = {
  id: string;
  title: string;
  caption: string;
  url: string;
  source_path: string;
};
type Part = {
  id: string;
  assembly_id: string;
  layer: string;
  kind: string;
  definition_id: string;
};
type Manifest = {
  instances: Part[];
  definitions: unknown[];
  assemblies: { id: string; name: string }[];
  limitations: string[];
};
type Selection = {
  id: string;
  name: string;
  kind: string;
  definition: string;
  dimensions: number[];
  scale: number[];
  position: number[];
  rotation: number;
  source: string;
};
type Api = {
  connection: (locked: boolean) => void;
  clearSelection: () => void;
  scale: (axis: number, value: number) => void;
  simulation: (s: SimSnapshot | null) => void;
  followCamera: (v: boolean) => void;
  ride: () => void;
  campfire: () => void;
  atmosphere: (options: {
    living?: boolean;
    cycle?: boolean;
    hour?: number;
    /** Calendar date ("YYYY-MM-DD") for the season-aware sun (spec §19); stays
     * independent of `hour`/`cycle` and of simulation elapsed time. */
    date?: string;
    fire?: string;
  }) => void;
  grid: (visible: boolean) => void;
  walk: () => void;
  orbit: () => void;
  lock: () => Promise<void>;
  select: (id: string) => void;
  focus: (id?: string) => void;
  view: (v: string) => void;
  cut: (v: string) => void;
  surface: (v: string) => void;
  mode: (v: string) => void;
  move: (axis: number, value: number) => void;
  rotate: (value: number) => void;
  duplicate: () => void;
  reset: () => void;
  save: () => void;
  restore: (data: unknown) => Promise<void>;
  export: () => Promise<void>;
  add: (id: string) => Promise<void>;
  scope: (v: string) => void;
  /** Replay-take host (2026 only). */
  take: TakeHost | null;
};
const STOCK = [
  ['upright_frame_8ft_4ft', '8′ × 4′ upright'],
  ['upright_frame_12ft_4ft', '12′ × 4′ upright'],
  ['upright_frame_16ft_3ft', '16′ × 3′ upright'],
  ['upright_frame_19ft_3ft', '19′ × 3′ upright'],
  ['horizontal_beam_12ft', '12′ orange beam'],
  ['plywood_panel_template', 'Plywood blank · adjustable'],
  ['timber_template', 'Timber blank · adjustable'],
  ['acrylic_panel_template', 'Acrylic blank · adjustable'],
  ['electric_unicycle', 'Electric unicycle · EUC'],
  ['person_casual', 'Person · casual'],
  ['person_punk', 'Person · punk'],
  ['person_woman', 'Person · casual woman'],
];
function download(data: Blob, name: string) {
  const url = URL.createObjectURL(data),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function NumericField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const cancelled = useRef(false);
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <input
      id={label.replaceAll(' ', '-')}
      aria-label={label}
      type="number"
      step=".01"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (cancelled.current) {
          cancelled.current = false;
          return;
        }
        const n = Number(draft);
        if (draft.trim() && Number.isFinite(n)) onCommit(n);
        setDraft(String(value));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          cancelled.current = true;
          setDraft(String(value));
          e.currentTarget.blur();
        }
      }}
    />
  );
}
export default function Studio({ year = 2026 }: { year?: number }) {
  const [exportReady, setExportReady] = useState<{
    url: string;
    bytes: number;
  } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [gridVisible, setGridVisible] = useState(false),
    [connected, setConnected] = useState(false);
  const [living, setLiving] = useState(true),
    [cycle, setCycle] = useState(false),
    [hour, setHour] = useState(16),
    [fire, setFire] = useState('auto');
  const [walking, setWalking] = useState(false),
    [mouseLocked, setMouseLocked] = useState(false);
  const mount = useRef<HTMLDivElement>(null),
    api = useRef<Api | null>(null),
    file = useRef<HTMLInputElement>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null),
    [refs, setRefs] = useState<Ref[]>([]),
    [photo, setPhoto] = useState<Ref | null>(null),
    [status, setStatus] = useState('Loading campus components…'),
    [error, setError] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);
  const [selected, setSelected] = useState<Selection | null>(null),
    [panel, setPanel] = useState('assemblies'),
    [query, setQuery] = useState(''),
    [scope, setScope] = useState('assembly'),
    [cut, setCut] = useState('complete'),
    [surface, setSurface] = useState('source'),
    [mode, setMode] = useState('inspect'),
    [edits, setEdits] = useState(0);
  useEffect(() => {
    document.title = `Mars ${year} · Campus studio`;
    const abort = new AbortController();
    fetch(`/history/${year}/references.json`, {signal: abort.signal})
      .then(r => { if (!r.ok) throw Error('Photo references unavailable'); return r.json(); })
      .then(r => setRefs(r as Ref[]))
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [year]);
  useEffect(() => {
    if (!mount.current) return;
    const host = mount.current;
    let disposed = false,
      frame = 0,
      selection: THREE.Object3D | null = null,
      selectScope = 'assembly',
      surfaceMode = 'source',
      cutMode = 'complete',
      editMode = 'inspect',
      roomLocked = false;
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: false,
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
    renderer.setClearColor('#d8d6cc');
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    host.appendChild(renderer.domElement);
    renderer.domElement.setAttribute(
      'aria-label',
      'Editable Mars campus 3D viewport',
    );
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(43, 1, 0.05, 1500);
    camera.position.set(31, 27, 36);
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.set(0, 2, 0);
    orbit.enableDamping = true;
    orbit.maxDistance = 600;
    const environment = createEnvironment(scene, renderer);
    const weather = createWeather(scene);
    let gallery: ReturnType<typeof createGallery> | null = null;
    let contextLost = false;
    const onLost = (event: Event) => {
      event.preventDefault();
      contextLost = true;
      setError(
        'Graphics memory was interrupted. Waiting for the browser to restore the scene…',
      );
    };
    const onRestored = () => {
      contextLost = false;
      environment.invalidate();
      setError('');
    };
    renderer.domElement.addEventListener('webglcontextlost', onLost);
    renderer.domElement.addEventListener('webglcontextrestored', onRestored);
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    let remote: SimSnapshot | null = null,
      receivedAt = 0,
      followRemote = false,
      cameraRevision = -1,
      followRider = false;
    const riderCamera = createEucFollowCamera();
    const riderBackdrop = new THREE.Vector3(0, 2, 8);
    let life: ReturnType<typeof createCampusLife> | null = null,
      lifeEnabled = !reducedMotion,
      cycleEnabled = false,
      sceneHour = 16,
      sceneDate = DEFAULT_SCENE_DATE,
      fireMode = 'auto',
      elapsed = 0,
      lastClock = -1;
    setLiving(lifeEnabled);
    setCycle(cycleEnabled);
    const takeHost = year === 2026 ? createTakeHost(scene, { hideAmbient: (v) => life?.setHidden(v), onError: setError, userFov: camera.fov }) : null;
    orbit.addEventListener('start', () => { const r = takeHost?.replay(); if (r) r.engineCamera = false; }); // grabbing the view hands it to the user
    const transform = new TransformControls(camera, renderer.domElement);
    transform.setTranslationSnap(0.01);
    transform.setRotationSnap(THREE.MathUtils.degToRad(1));
    scene.add(transform.getHelper());
    transform.addEventListener('dragging-changed', (e) => {
      orbit.enabled = !e.value && !walker.active;
    });
    let root: THREE.Group | null = null;
    const additions = new THREE.Group();
    additions.name = 'Proposed additions';
    scene.add(additions);
    const objects = new Map<string, THREE.Object3D>(),
      baseline = new Map<string, Edit>(),
      originalMaterials = new Map<
        THREE.Mesh,
        THREE.Material | THREE.Material[]
      >(),
      genericMaterials = new Map<
        THREE.Mesh,
        THREE.Material | THREE.Material[]
      >();
    let box: THREE.BoxHelper | null = null;
    const walker = attachWalking(
      camera,
      renderer.domElement,
      () => [...(root ? [root] : []), additions],
      (active, locked) => {
        setWalking(active);
        setMouseLocked(locked);
      },
      () => {
        choose(null);
        orbit.enabled = false;
        transform.detach();
      },
      () => {
        orbit.enabled = true;
        orbit.update();
      },
    );
    const resources = new ThreeResources();
    let statusTimer: ReturnType<typeof setTimeout>;
    let preparedExportUrl = '',
      exportBusy = false;
    const statusMessage = (message: string) => {
      clearTimeout(statusTimer);
      setStatus(message);
      statusTimer = setTimeout(() => {
        if (!disposed) setStatus('');
      }, 2000);
    };
    const abort = new AbortController();
    let batches: ReturnType<typeof createRenderBatches> | undefined;
    const templates = new Map<string, Promise<THREE.Object3D>>();
    const genericCache = new Map<THREE.Material, THREE.Material>();
    const idOf = (o: THREE.Object3D) =>
      o.userData.edit_id ||
      o.userData.component_id ||
      (o.userData.assembly_id && !o.userData.layer
        ? o.userData.assembly_id
        : '');
    const snapshot = (o: THREE.Object3D): Edit => ({
      id: idOf(o),
      position: o.position.toArray(),
      quaternion: o.quaternion.toArray(),
      scale: o.scale.toArray(),
      ...(o.userData.added_definition
        ? { added: o.userData.added_definition, children: nestedTransforms(o) }
        : {}),
    });
    function updateSelection() {
      if (!selection) return;
      const bounds = new THREE.Box3().setFromObject(selection),
        d = bounds.getSize(new THREE.Vector3());
      setSelected({
        id: idOf(selection),
        name: selection.name,
        kind: selection.userData.kind || 'assembly',
        definition:
          selection.userData.definition_id || 'Assembly of separate components',
        dimensions: [d.x, d.y, d.z],
        position: selection.position.toArray(),
        scale: selection.scale.toArray(),
        rotation: THREE.MathUtils.radToDeg(selection.rotation.y),
        source:
          selection.userData.kind === 'context_person'
            ? 'Quaternius · CC0 · Generic 1.75 m person; illustrative placement, not inventory'
            : selection.userData.added_definition
              ? 'Reusable stock/template library; nominal dimensions from Gene'
              : selection.userData.evidence ||
                selection.userData.source_mesh ||
                `${year} reconstruction`,
      });
      box?.update();
    }
    function choose(o: THREE.Object3D | null) {
      batches?.setExcluded(o);
      batches?.setActive(true);
      life?.setEditing(!!o || editMode !== 'inspect');
      if (o && walker.active) walker.stop();
      selection = o;
      transform.detach();
      if (box) {
        scene.remove(box);
        box.geometry.dispose();
        (box.material as THREE.Material).dispose();
        box = null;
      }
      if (!o) {
        setSelected(null);
        return;
      }
      box = new THREE.BoxHelper(o, 0xd87836);
      scene.add(box);
      if (editMode !== 'inspect') transform.attach(o);
      updateSelection();
    }
    function focus(o: THREE.Object3D | null) {
      followRider = false;
      walker.stop();
      const bounds = o
        ? new THREE.Box3().setFromObject(o)
        : new THREE.Box3(
            new THREE.Vector3(-19, 0, -22),
            new THREE.Vector3(20, 8, 17),
          );
      const c = bounds.getCenter(new THREE.Vector3()),
        r = Math.max(3, bounds.getSize(new THREE.Vector3()).length() * 0.68);
      orbit.target.copy(c);
      camera.position
        .copy(c)
        .add(new THREE.Vector3(r * 0.72, r * 0.65, r * 0.85));
      camera.near = 0.03;
      camera.updateProjectionMatrix();
      orbit.update();
    }
    const changed = () => {
      if (!selection) batches?.invalidate();
      life?.invalidate();
      environment.invalidate();
      setEdits((n) => n + 1);
      updateSelection();
    };
    transform.addEventListener('objectChange', changed);
    function remember(o: THREE.Object3D) {
      const id = idOf(o);
      if (id) {
        objects.set(id, o);
        baseline.set(id, snapshot(o));
      }
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        originalMaterials.set(o, o.material);
        o.layers.enable(1);
        o.frustumCulled = true;
      }
    }
    function display() {
      life?.setCut(cutMode);
      const update = (o: THREE.Object3D) => {
        const layer = o.userData.layer;
        if (layer)
          o.visible =
            !(
              cutMode === 'inside' &&
              (layer === 'Roofs and upper floors' ||
                layer === 'Walls and screens')
            ) &&
            !(
              cutMode === 'frame' &&
              layer !== 'Rack steel' &&
              layer !== 'Timber, floors and stairs'
            );
        if (o instanceof THREE.Mesh && originalMaterials.has(o)) {
          if (surfaceMode === 'generic' && !genericMaterials.has(o)) {
            const original = originalMaterials.get(o)!;
            const mats = (Array.isArray(original) ? original : [original]).map(
              (m) => {
                if (!genericCache.has(m)) {
                  const a = m as THREE.MeshStandardMaterial;
                  genericCache.set(
                    m,
                    resources.material(
                      new THREE.MeshStandardMaterial({
                        color: a.color || 0xb8b0a0,
                        metalness: a.metalness || 0,
                        roughness: 0.8,
                        side: a.side,
                        transparent: a.transparent,
                        opacity: a.opacity,
                      }),
                    ),
                  );
                }
                return genericCache.get(m)!;
              },
            );
            genericMaterials.set(o, Array.isArray(original) ? mats : mats[0]);
          }
          o.material = (
            surfaceMode === 'generic' ? genericMaterials : originalMaterials
          ).get(o)!;
        }
      };
      root?.traverse(update);
      additions.traverse(update);
      box?.update();
      batches?.invalidate();
      batches?.setExcluded(selection);
      batches?.setActive(true);
      environment.invalidate();
    }
    void (year === 2026
      ? loadGltf('/browser/campus.glb?v=20260922b', abort.signal, resources)
      : Promise.resolve({scene: resources.object(createHistoricalScene(year))}))
      .then((g) => {
        if (disposed) return;
        root = g.scene;
        if (year === 2026) {
          add2026Details(root);
          resources.object(root);

        }
        scene.add(root);
        weather.rebuild(root);
        if (year === 2026) gallery = createGallery(scene, root);
        else gallery = createHistoricalScreens(root);
        setManifest(sceneManifest(root, year));
        root.traverse(remember);
        batches = createRenderBatches(scene, root);
        life = createCampusLife(scene, root, setError, additions, year === 2020 ? 2 : year === 2021 ? 3 : 6);
        life.setEnabled(lifeEnabled);
        display();
        focus(objects.get('chiba') || null);
        setStatus('');
      })
      .catch((e) => {
        if (!disposed) setError(String(e));
      });
    const ray = new THREE.Raycaster(),
      pointer = new THREE.Vector2();
    ray.layers.set(1);
    let down = [0, 0];
    renderer.domElement.addEventListener('pointerdown', (e) => {
      followRider = false;
      down = [e.clientX, e.clientY];
    });
    renderer.domElement.addEventListener('pointerup', (e) => {
      if (
        roomLocked ||
        walker.active ||
        Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4 ||
        transform.dragging ||
        transform.axis
      )
        return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        (-(e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      ray.setFromCamera(pointer, camera);
      const hits = ray
        .intersectObjects([...(root ? [root] : []), additions], true)
        .filter((h) => {
          let p: THREE.Object3D | null = h.object;
          while (p) {
            if (!p.visible) return false;
            p = p.parent;
          }
          return true;
        });
      if (!hits.length) {
        choose(null);
        return;
      }
      let o = hits[0].object;
      while (o.parent && !idOf(o)) o = o.parent;
      if (selectScope === 'assembly' && !o.userData.added_definition) {
        let p: THREE.Object3D | null = o;
        while (p) {
          if (p.userData.assembly_id && !p.userData.layer) {
            o = p;
            break;
          }
          p = p.parent;
        }
      }
      choose(o);
    });
    async function prepareAddition(id: string, custom?: Edit) {
      if (!STOCK.some((s) => s[0] === id) && !id.startsWith('copy:'))
        throw Error('Unknown component definition');
      let o: THREE.Object3D;
      if (id.startsWith('copy:')) {
        const source = objects.get(id.slice(5));
        if (!source) throw Error('Original component not found');
        o = clone(source);
        const sourceNodes: THREE.Object3D[] = [];
        source.traverse((n) => sourceNodes.push(n));
        let index = 0;
        o.traverse((n) => {
          const original = sourceNodes[index++];
          if (n instanceof THREE.Mesh && original instanceof THREE.Mesh)
            n.material = originalMaterials.get(original) || original.material;
        });
      } else {
        if (!templates.has(id)) {
          const promise = loadGltf(
            id === 'electric_unicycle'
              ? '/modular/environment/electric-unicycle.glb'
              : `/modular/${id}.glb`,
            abort.signal,
            resources,
          ).then((g) => g.scene);
          templates.set(id, promise);
          void promise.catch(() => templates.delete(id));
        }
        o = clone(await templates.get(id)!);
        o.name = STOCK.find((s) => s[0] === id)?.[1] || id;
      }
      if (disposed) {
        disposeSkeletons(o);
        throw Error('Viewer closed');
      }
      o.visible = true;
      o.userData = {
        edit_id: custom?.id || `added-${crypto.randomUUID()}`,
        added_definition: id,
        kind: id.startsWith('person_')
          ? 'context_person'
          : 'proposed_component',
        definition_id: id,
      };
      o.traverse((child) => {
        if (child !== o) {
          delete child.userData.component_id;
          delete child.userData.assembly_id;
          delete child.userData.edit_id;
        }
      });
      o.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.layers.enable(0);
          child.layers.enable(1);
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      o.position.set(
        orbit.target.x,
        id.startsWith('person_') || id === 'electric_unicycle' ? -0.16 : 0,
        orbit.target.z,
      );
      if (custom) {
        o.position.fromArray(custom.position);
        o.quaternion.fromArray(custom.quaternion);
        o.scale.fromArray(custom.scale);
        if (custom.children) {
          try {
            applyNestedTransforms(o, custom.children);
          } catch (e) {
            disposeSkeletons(o);
            throw e;
          }
        }
      }
      return o;
    }
    async function add(id: string, custom?: Edit) {
      if (roomLocked)
        throw Error('Leave the simulation room before editing the layout');
      if (additions.children.length >= 300)
        throw Error('At most 300 proposed additions are supported');
      const o = await prepareAddition(id, custom);
      if (roomLocked) {
        disposeSkeletons(o);
        throw Error('Layout editing is disabled in a room');
      }
      walker.stop();
      o.traverse((n) => {
        if (n instanceof THREE.Mesh) originalMaterials.set(n, n.material);
      });
      additions.add(o);
      objects.set(idOf(o), o);
      choose(o);
      display();
      changed();
    }
    api.current = {
      clearSelection: () => choose(null),
      connection: (value) => {
        roomLocked = value;
        if (value) {
          choose(null);
          editMode = 'inspect';
          setMode('inspect');
        }
      },
      scale: (axis, value) => {
        if (
          !roomLocked &&
          selection &&
          Number.isFinite(value) &&
          value >= 0.001 &&
          value <= 1000
        ) {
          selection.scale.setComponent(axis, value);
          changed();
        }
      },
      simulation: (s) => {
        const joining = !remote && !!s;
        remote = s;
        receivedAt = performance.now();
        if (!s) {
          setCycle(cycleEnabled);
          setFire(fireMode);
          life?.setRemote(null);
          return;
        }
        if (joining) {
          choose(null);
          editMode = 'inspect';
          roomLocked = true;
          setMode('inspect');
        }
        life?.setEnabled(lifeEnabled);
        setCycle(s.state.environment.cycle);
        setFire(s.state.fire);
      },
      followCamera: (v) => {
        followRemote = v;
        cameraRevision = -1;
        followRider = false;
      },
      ride: () => {
        const rider = life?.riderPosition();
        if (!rider) return;
        walker.stop();
        choose(null);
        const chiba = objects.get('chiba');
        if (chiba)
          new THREE.Box3().setFromObject(chiba).getCenter(riderBackdrop);
        riderCamera.start(rider, riderBackdrop, camera.position, orbit.target);
        followRider = true;
      },
      campfire: () => {
        followRider = false;
        const point = life?.firePosition();
        if (!point) return;
        walker.stop();
        choose(null);
        orbit.target.copy(point).add(new THREE.Vector3(0, 0.8, 0));
        camera.position.copy(point).add(new THREE.Vector3(8, 4, 9));
        orbit.update();
      },
      atmosphere: (options) => {
        if (options.living !== undefined) {
          lifeEnabled = options.living;
          life?.setEnabled(lifeEnabled);
          environment.invalidate();
        }
        if (options.cycle !== undefined) cycleEnabled = options.cycle;
        if (options.date !== undefined) {
          sceneDate = options.date;
          environment.invalidate();
        }
        if (options.hour !== undefined) {
          sceneHour = options.hour;
          setHour(sceneHour);
        }
        if (options.fire !== undefined) fireMode = options.fire;
      },
      grid: (visible) => {
        environment.grid.visible = visible;
      },
      walk: () => {
        followRider = false;
        if (root) walker.start();
      },
      orbit: () => walker.stop(),
      lock: () => walker.lock(),
      select: (id) => {
        if (!roomLocked) choose(objects.get(id) || null);
      },
      focus: (id) =>
        focus(
          id
            ? objects.get(id) || null
            : selection || objects.get('chiba') || null,
        ),
      view: (v) => {
        followRider = false;
        walker.stop();
        if (v === 'campus') {
          focus(root);
          return;
        }
        if (v === 'top') {
          const c = orbit.target;
          camera.position.set(
            c.x,
            c.y + Math.max(28, camera.position.distanceTo(c)),
            c.z + 0.001,
          );
          camera.lookAt(c);
          orbit.update();
          return;
        }
        focus(objects.get('chiba') || null);
      },
      scope: (v) => {
        selectScope = v;
      },
      take: takeHost,
      cut: (v) => {
        walker.stop();
        cutMode = v;
        display();
      },
      surface: (v) => {
        surfaceMode = v;
        display();
      },
      mode: (v) => {
        walker.stop();
        editMode = v;
        batches?.setExcluded(selection);
        batches?.setActive(true);
        life?.setEditing(!!selection || v !== 'inspect');
        transform.detach();
        if (v !== 'inspect') {
          transform.setMode(v === 'rotate' ? 'rotate' : 'translate');
          if (selection) transform.attach(selection);
        }
      },
      move: (axis, value) => {
        if (!roomLocked && selection && Number.isFinite(value)) {
          selection.position.setComponent(
            axis,
            THREE.MathUtils.clamp(value, axis === 1 ? -1000 : -10000, 10000),
          );
          changed();
        }
      },
      rotate: (value) => {
        if (!roomLocked && selection && Number.isFinite(value)) {
          selection.rotation.y = THREE.MathUtils.degToRad(value);
          changed();
        }
      },
      duplicate: () => {
        if (!selection) return;
        const id = idOf(selection);
        const copy = snapshot(selection);
        copy.id = `added-${crypto.randomUUID()}`;
        copy.position = [
          copy.position[0] + 1,
          copy.position[1],
          copy.position[2] + 1,
        ];
        add(selection.userData.added_definition || `copy:${id}`, copy).catch(
          (e) => setError(e.message),
        );
      },
      add: async (id) => {
        await add(id);
      },
      reset: () => {
        if (roomLocked) return;
        walker.stop();
        choose(null);
        for (const [id, b] of baseline) {
          const o = objects.get(id);
          if (o) {
            o.position.fromArray(b.position);
            o.quaternion.fromArray(b.quaternion);
            o.scale.fromArray(b.scale);
          }
        }
        for (const o of additions.children.slice()) {
          objects.delete(idOf(o));
          additions.remove(o);
          o.traverse((n) => {
            if (n instanceof THREE.Mesh) {
              originalMaterials.delete(n);
              genericMaterials.delete(n);
            }
          });
          disposeSkeletons(o);
        }
        setEdits(0);
        batches?.invalidate();
        life?.invalidate();
        environment.invalidate();
      },
      save: () => {
        const data = {
          schema_version: 1,
          base_model: 'mars-campus-modular-v1',
          year,
          units: 'metres',
          up: 'Y',
          edits: [...objects.values()].map(snapshot),
        };
        download(
          new Blob([JSON.stringify(data, null, 2)], {
            type: 'application/json',
          }),
          `mars-campus-${year}-layout.json`,
        );
        statusMessage('Layout saved');
      },
      restore: async (data) => {
        if (!root || roomLocked)
          throw Error(
            'Wait for the model to load and leave the room before importing',
          );
        // Legacy build-order historical ids are migrated (docs/engineering/HISTORY_IDS.md).
        const migration = (await import('../history/id-migration.json')).default as IdMigration;
        const d = validateLayout(
          data,
          new Set(baseline.keys()),
          new Set(STOCK.map((s) => s[0])),
          year,
          migration,
        );
        // Validate and load every asset before touching the current layout.
        const prepared: THREE.Object3D[] = [];
        try {
          for (const e of d.edits)
            if (e.added) prepared.push(await prepareAddition(e.added, e));
          if (disposed || roomLocked) throw Error('Layout import cancelled');
        } catch (error) {
          prepared.forEach(disposeSkeletons);
          throw error;
        }
        api.current?.reset();
        for (const e of d.edits) {
          if (e.added) continue;
          const o = objects.get(e.id)!;
          o.position.fromArray(e.position);
          o.quaternion.fromArray(e.quaternion).normalize();
          o.scale.fromArray(e.scale);
        }
        for (const o of prepared) {
          o.traverse((n) => {
            if (n instanceof THREE.Mesh) originalMaterials.set(n, n.material);
          });
          additions.add(o);
          objects.set(idOf(o), o);
        }
        batches?.invalidate();
        life?.invalidate();
        environment.invalidate();
        choose(null);
        display();
        setEdits(d.edits.length);
        statusMessage('Layout restored');
      },
      export: async () => {
        if (!root || exportBusy) return;
        exportBusy = true;
        setExporting(true);
        setStatus('Packing editable GLB…');
        try {
          const pack = async () => {
            const copies = [root!, additions].map((source) => {
              const result = clone(source),
                nodes: THREE.Object3D[] = [];
              source.traverse((n) => nodes.push(n));
              let i = 0;
              result.traverse((n) => {
                const original = nodes[i++];
                if (n instanceof THREE.Mesh && original instanceof THREE.Mesh)
                  n.material =
                    originalMaterials.get(original) || original.material;
              });
              return result;
            });
            try {
              return await new GLTFExporter().parseAsync(copies, {
                binary: true,
                onlyVisible: false,
              });
            } finally {
              copies.forEach(disposeSkeletons);
            }
          };
          const exported = life ? await life.withOriginals(pack) : await pack();
          if (disposed) return;
          if (preparedExportUrl) URL.revokeObjectURL(preparedExportUrl);
          const blob = new Blob([exported as ArrayBuffer], {
            type: 'model/gltf-binary',
          });
          preparedExportUrl = URL.createObjectURL(blob);
          setExportReady({ url: preparedExportUrl, bytes: blob.size });
          renderer.domElement.dataset.exportBytes = String(blob.size);
        } finally {
          exportBusy = false;
          if (!disposed) {
            setExporting(false);
            setStatus('');
          }
        }
      },
    };
    const observer = new ResizeObserver(() => {
      renderer.setSize(host.clientWidth, host.clientHeight);
      camera.aspect = host.clientWidth / Math.max(1, host.clientHeight);
      camera.updateProjectionMatrix();
    });
    observer.observe(host);
    let previous = performance.now(),
      budgetStart = previous,
      budgetFrames = 0;
    const loop = () => {
      if (disposed) return;
      frame = requestAnimationFrame(loop);
      const now = performance.now(),
        dt = Math.min((now - previous) / 1000, 0.1);
      previous = now;
      if (document.hidden || contextLost) {
        budgetFrames = 0;
        budgetStart = now;
        return;
      }
      if (!document.hidden) {
        const remoteNow = remote ? remote.now + (now - receivedAt) : 0;
        const paused = remote?.state.pausedAt != null;
        if (lifeEnabled && !paused) elapsed += dt;
        const simulationElapsed = remote
          ? (simTime(remote.state, remoteNow) - remote.state.motionEpoch) / 1000
          : elapsed;
        if (remote) {
          sceneHour = hourAt(remote.state, remoteNow);
          fireMode = remote.state.fire;
          life?.setRemote(remote.state, remoteNow);
          if (
            followRemote &&
            !followRider &&
            remote.state.camera &&
            (remote.state.camera.route ||
              cameraRevision !== remote.state.camera.revision)
          ) {
            const shot = cameraPose(remote.state, remoteNow)!;
            followRider = false;
            walker.stop();
            camera.position.fromArray(shot.position);
            orbit.target.fromArray(shot.target);
            orbit.update();
            cameraRevision = remote.state.camera.revision;
          }
        }
        if (!remote && cycleEnabled) sceneHour = (sceneHour + dt / 20) % 24;
        if (Math.floor(now / 1000) !== lastClock) {
          lastClock = Math.floor(now / 1000);
          setHour(sceneHour);
          renderer.domElement.dataset.cameraMode = followRider
            ? 'euc-epicycle'
            : 'free';
          renderer.domElement.dataset.riderPosition = followRider
            ? (life
                ?.riderPosition()
                ?.toArray()
                .map((n) => n.toFixed(2))
                .join(',') ?? '')
            : '';
          renderer.domElement.dataset.cameraPosition = camera.position
            .toArray()
            .map((n) => n.toFixed(2))
            .join(',');
          renderer.domElement.dataset.additions = String(
            additions.children.length,
          );
          renderer.domElement.dataset.drawCalls = String(
            renderer.info.render.calls,
          );
          renderer.domElement.dataset.geometries = String(
            renderer.info.memory.geometries,
          );
          renderer.domElement.dataset.textures = String(
            renderer.info.memory.textures,
          );
          renderer.domElement.dataset.renderBatches = String(
            batches?.count ?? 0,
          );
          renderer.domElement.dataset.simulationRevision = String(
            remote?.state.revision ?? 'local',
          );
        }
        const night = environment.update(
          sceneHour,
          simulationElapsed,
          lifeEnabled,
          remote?.state.weather,
          sceneDate,
        );
        weather.update(simulationElapsed, camera, remote?.state.weather);
        gallery?.update(remote?.state ?? null, simulationElapsed, cutMode);
        life?.update(
          paused ? 0 : dt * (remote?.state.clock?.rate ?? 1),
          simulationElapsed,
          night,
          fireMode,
        );
      }
      if (followRider) {
        const p = life?.riderPosition();
        if (p) {
          riderCamera.update(
            remote?.state.pausedAt != null ? 0 : dt,
            p,
            riderBackdrop,
            camera.position,
            orbit.target,
          );
          // Do not let residual OrbitControls damping perturb the shot.
          camera.lookAt(orbit.target);
        } else followRider = false;
      }
      takeHost?.update(dt);
      const takeCamera = !walker.active && !followRider && !!takeHost?.drive(camera, orbit.target);
      if (walker.active) walker.update(dt);
      else if (!followRider && !takeCamera) orbit.update();
      keepCameraAboveGround(camera, walker.active ? undefined : orbit.target);
      batches?.setExcluded(selection);
      batches?.setActive(true);
      renderer.render(scene, camera);
      // Test hook for viewer/e2e (see e2e/README.md): scene loaded + frames rendered since.
      if (root) testHook.frames++;
      budgetFrames++;
      if (now - budgetStart > 5000) {
        if (budgetFrames < 150 && renderer.getPixelRatio() > 0.8) {
          renderer.setPixelRatio(Math.max(0.8, renderer.getPixelRatio() - 0.2));
          environment.invalidate();
        }
        renderer.domElement.dataset.pixelRatio = renderer
          .getPixelRatio()
          .toFixed(2);
        budgetFrames = 0;
        budgetStart = now;
      }
    };
    const testHook = {
      year,
      frames: 0,
      get ready() { return testHook.frames >= 3; },
      info: () => ({ ...renderer.info.render, ...renderer.info.memory, pixelRatio: renderer.getPixelRatio() }),
      look: (position: number[], target: number[]) => {
        camera.position.fromArray(position);
        orbit.target.fromArray(target);
        orbit.update();
      },
      // e2e-only: set hour/date/weather without clicking through the UI (see
      // e2e/README.md and the sun/season/weather visual verification pass).
      atmosphere: (options: Parameters<Api['atmosphere']>[0]) =>
        api.current?.atmosphere(options),
      take: () => takeHost?.info() ?? null,
      // Engine camera vs render mesh (docs/engineering/CAMERA_VERIFY.md); lazy, off the main chunk.
      verifyCamera: async (fromT?: number, toT?: number, hz?: number) => {
        const r = takeHost?.replay();
        return r ? (await import('./camera-verify')).verifyCamera(scene, r, { fromT, toT, hz }) : null;
      },
    };
    (window as { __marsStudio?: typeof testHook }).__marsStudio = testHook;
    loop();
    return () => {
      disposed = true;
      delete (window as { __marsStudio?: unknown }).__marsStudio;
      abort.abort();
      clearTimeout(statusTimer);
      if (preparedExportUrl) URL.revokeObjectURL(preparedExportUrl);
      batches?.dispose();
      additions.traverse((o) => {
        if (o instanceof THREE.SkinnedMesh) o.skeleton.dispose();
      });
      resources.dispose();
      cancelAnimationFrame(frame);
      walker.dispose();
      takeHost?.dispose();
      life?.dispose();
      gallery?.dispose();
      weather.dispose();
      environment.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', onLost);
      renderer.domElement.removeEventListener(
        'webglcontextrestored',
        onRestored,
      );
      observer.disconnect();
      transform.dispose();
      orbit.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      api.current = null;
      if (box) {
        box.geometry.dispose();
        (box.material as THREE.Material).dispose();
      }
    };
  }, [year]);
  const parts = (manifest?.instances || [])
    .filter(
      (p) =>
        p.id.includes(query.toLowerCase()) ||
        p.kind.includes(query.toLowerCase()) ||
        p.assembly_id.includes(query.toLowerCase()),
    )
    .slice(0, 100);
  const act = (f: () => void | Promise<void>) =>
    Promise.resolve()
      .then(() => {
        setError('');
        return f();
      })
      .catch((e) => setError(e.message));
  return (
    <main className="studio">
      <header className="studio-header">
        <button
          className="mobile-controls"
          aria-expanded={panelOpen}
          aria-controls="studio-controls"
          onClick={() => setPanelOpen(!panelOpen)}
        >
          {panelOpen ? 'Close controls' : 'Controls'}
        </button>
        <a className="studio-brand" href="/studio">
          <b>
            M<span>{String(year).slice(2)}</span>
          </b>
          <div>
            Mars campus<span>COMPONENT STUDIO</span>
          </div>
        </a>
        <div className="studio-tabs">
          <label className="year-picker">Year <select aria-label="Campus year" value={year} onChange={e => { location.href = Number(e.target.value) === 2026 ? '/studio' : `/studio/${e.target.value}`; }}>{YEARS.map(y => <option key={y} value={y}>{y}{y === 2020 ? ' · Brahman' : ''}</option>)}</select></label>
          <button onClick={() => api.current?.view('chiba')}>{year === 2020 ? 'Portal' : 'Chiba'}</button>
          <button onClick={() => api.current?.view('campus')}>
            Whole campus
          </button>
          <a href="/">Drone reconstruction ↗</a>
        </div>
        <button className="save" onClick={() => api.current?.save()}>
          Save layout{edits > 0 ? ' •' : ''}
        </button>
      </header>
      <div className="studio-body">
        <aside
          id="studio-controls"
          className={`studio-sidebar ${panelOpen ? 'panel-open' : ''}`}
        >
          <div className="studio-kicker">{year} REPLICA · WORKING MODEL</div>
          <h1>Built from parts.</h1>
          <p className="studio-intro">
            {historyNotes[year]}
          </p>{' '}
          <details className="atmosphere-panel" open>
            <summary>
              Campus life{' '}
              <span>
                {String(Math.floor(hour)).padStart(2, '0')}:
                {String(Math.floor((hour % 1) * 60)).padStart(2, '0')}
              </span>
            </summary>
            <fieldset className="room-lock">
              <label className="atmosphere-toggle">
                <input
                  type="checkbox"
                  checked={living}
                  onChange={(e) => {
                    setLiving(e.target.checked);
                    api.current?.atmosphere({ living: e.target.checked });
                  }}
                />
                People & desert breeze
              </label>
              <label className="atmosphere-toggle">
                <input
                  type="checkbox"
                  disabled={connected}
                  checked={cycle}
                  onChange={(e) => {
                    setCycle(e.target.checked);
                    api.current?.atmosphere({ cycle: e.target.checked });
                  }}
                />
                Time passes · day–night cycle
                {connected ? ' (room controls below)' : ''}
              </label>
              <label className="time-control">
                Time of day
                <input
                  aria-label="Time of day"
                  disabled={connected}
                  type="range"
                  min="0"
                  max="23.99"
                  step=".05"
                  value={hour}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    setHour(value);
                    setCycle(false);
                    api.current?.atmosphere({ hour: value, cycle: false });
                  }}
                />
              </label>
              <div className="time-presets">
                {[
                  ['Morning', 9],
                  ['Sunset', 18],
                  ['Night', 22],
                ].map(([label, value]) => (
                  <button
                    disabled={connected}
                    key={label}
                    onClick={() => {
                      setHour(Number(value));
                      setCycle(false);
                      api.current?.atmosphere({
                        hour: Number(value),
                        cycle: false,
                      });
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="fire-control">
                Campfire
                <select
                  disabled={connected}
                  aria-label="Campfire"
                  value={fire}
                  onChange={(e) => {
                    setFire(e.target.value);
                    api.current?.atmosphere({ fire: e.target.value });
                  }}
                >
                  <option value="auto">After dusk</option>
                  <option value="on">Always on</option>
                  <option value="off">Off</option>
                </select>
              </label>
            </fieldset>
            <button className="visit-fire" onClick={() => api.current?.ride()}>
              Ride with an EUC ↗
            </button>
            <button
              className="visit-fire"
              onClick={() => {
                if (connected) {
                  api.current?.campfire();
                  return;
                }
                setLiving(true);
                setFire('on');
                setHour(19);
                setCycle(false);
                api.current?.atmosphere({
                  living: true,
                  fire: 'on',
                  hour: 19,
                  cycle: false,
                });
                api.current?.campfire();
              }}
            >
              Visit campfire ↗
            </button>
            <p>
              Illustrative atmosphere · 8-minute days. People pause while a
              component is selected.
            </p>
          </details>
          <SimulationPanel
            year={year}
            onConnection={(v) => {
              setConnected(v);
              api.current?.connection(v);
            }}
            edited={edits > 0}
            onSnapshot={(s) => {
              api.current?.simulation(s);
            }}
            onFollow={(v) => api.current?.followCamera(v)}
          />
          <div className="panel-tabs">
            {['assemblies', 'parts', 'library'].map((p) => (
              <button
                key={p}
                className={panel === p ? 'active' : ''}
                onClick={() => setPanel(p)}
              >
                {p}
              </button>
            ))}
          </div>
          {panel === 'assemblies' && (
            <div className="assembly-list">
              {manifest?.assemblies.map((a) => (
                <button
                  className={selected?.id === a.id ? 'active' : ''}
                  key={a.id}
                  onClick={() => {
                    if (!connected) api.current?.select(a.id);
                    api.current?.focus(a.id);
                  }}
                >
                  <span>◇</span>
                  {a.name}
                </button>
              ))}
              <p className="small-note">
                Building names outside Chiba are provisional spatial labels.
              </p>
            </div>
          )}
          {panel === 'parts' && (
            <>
              <input
                className="part-search"
                aria-label="Find a component"
                placeholder="Find a component…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="part-list">
                {parts.map((p) => (
                  <button
                    key={p.id}
                    className={selected?.id === p.id ? 'active' : ''}
                    onClick={() => {
                      api.current?.select(p.id);
                      api.current?.focus(p.id);
                    }}
                  >
                    {p.id}
                    <span>{p.assembly_id}</span>
                  </button>
                ))}
              </div>
              <p className="small-note">
                Showing up to 100 matches. Source pieces are not a verified
                materials inventory.
              </p>
            </>
          )}
          {panel === 'library' && (
            <div className="library-list">
              <p>Reusable stock & people</p>
              {STOCK.map(([id, label]) => (
                <button
                  key={id}
                  disabled={connected}
                  onClick={() => act(() => api.current?.add(id))}
                >
                  <span>＋</span>
                  {label}
                </button>
              ))}
              <p className="small-note">
                Rack height, width and beam length use your nominal dimensions.
                Profiles and bracing are illustrative. Sheet and timber blanks
                are adjustable examples.
              </p>
            </div>
          )}
          <div className="studio-downloads">
            <button disabled={connected} onClick={() => file.current?.click()}>
              Open saved layout
            </button>
            <button
              disabled={exporting}
              onClick={() => act(() => api.current?.export())}
            >
              {exporting ? 'Preparing GLB…' : 'Export edited GLB'}
            </button>
            {exportReady && (
              <a href={exportReady.url} download="mars-campus-edited.glb">
                Download prepared GLB ·{' '}
                {(exportReady.bytes / 1048576).toFixed(1)} MB
              </a>
            )}
            {year === 2026 && <><a href="/modular/mars-2026-modular.blend?v=37351cc1b676" download>
              Blender project ↓
            </a>
            <a href="/modular/campus-components.glb" download>
              Original full-texture campus ↓
            </a>
            <p>
              Edited GLB uses browser textures (up to 1024 px). Original
              textures remain in the original campus and Blender files.
            </p></>}
            <a href="/modular/component-library.glb" download>
              Component library ↓
            </a>
            <a
              href="/modular/appearance-credits.html"
              target="_blank"
              rel="noreferrer"
            >
              People, textures & sources ↗
            </a>
            <a href={`/history/README.html#year-${year}`} target="_blank" rel="noreferrer">
              Evidence & accuracy notes ↗
            </a>
          </div>
          <input
            ref={file}
            type="file"
            accept=".json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f && f.size > 20 * 1024 * 1024) {
                setError('Layout file exceeds 20 MB');
                e.target.value = '';
                return;
              }
              if (f)
                void act(async () =>
                  api.current?.restore(JSON.parse(await f.text())),
                );
              e.target.value = '';
            }}
          />
        </aside>
        <section className="studio-stage">
          <div className="studio-viewport" ref={mount} />
          <div className="stage-top">
            <div className="stage-selectors">
              <label>
                View
                <select
                  value={cut}
                  onChange={(e) => {
                    setCut(e.target.value);
                    api.current?.cut(e.target.value);
                  }}
                >
                  <option value="complete">Complete building</option>
                  <option value="inside">Interior cutaway</option>
                  <option value="frame">Rack & timber frame</option>
                </select>
              </label>
              <label>
                Finish
                <select
                  value={surface}
                  onChange={(e) => {
                    setSurface(e.target.value);
                    api.current?.surface(e.target.value);
                  }}
                >
                  <option value="source">Photo + CAD finishes</option>
                  <option value="generic">Generic materials</option>
                </select>
              </label>
            </div>
            <button
              aria-pressed={gridVisible}
              onClick={() => {
                setGridVisible(!gridVisible);
                api.current?.grid(!gridVisible);
              }}
            >
              {gridVisible ? 'Hide grid' : 'Show grid'}
            </button>
            <button onClick={() => api.current?.ride()}>Ride EUC</button>
            <button onClick={() => api.current?.view('top')}>
              Plan view ↑
            </button>
          </div>
          <div className="stage-toolbar">
            <button
              className={walking ? 'active' : ''}
              aria-pressed={walking}
              onClick={() =>
                walking ? api.current?.orbit() : api.current?.walk()
              }
            >
              {walking ? 'Exit walk' : 'Walk · WASD'}
            </button>
            <label>
              Select
              <select
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value);
                  api.current?.scope(e.target.value);
                }}
              >
                <option value="assembly">Building</option>
                <option value="component">Part</option>
              </select>
            </label>
            {[
              ['inspect', 'Inspect'],
              ['translate', 'Move'],
              ['rotate', 'Rotate'],
            ].map(([id, label]) => (
              <button
                key={id}
                className={mode === id ? 'active' : ''}
                disabled={connected && id !== 'inspect'}
                onClick={() => {
                  setMode(id);
                  api.current?.mode(id);
                }}
              >
                {label}
              </button>
            ))}
            <button onClick={() => api.current?.focus()}>
              Frame selection
            </button>
            <button onClick={() => api.current?.reset()}>Reset layout</button>
          </div>
          {walking && (
            <div className="walk-hud">
              <span className="walk-crosshair" aria-hidden="true">
                +
              </span>
              <div className="walk-instructions">
                <b>Walk mode</b>
                <span>
                  WASD move · ← → turn · ↑ ↓ look · Space jump · Shift run · Esc
                  exit
                </span>
                <span>
                  {mouseLocked
                    ? 'Mouse look active · Esc returns to orbit'
                    : 'Drag to look, or lock the mouse'}
                </span>
                {!mouseLocked && (
                  <button onClick={() => api.current?.lock()}>
                    Lock mouse
                  </button>
                )}
              </div>
            </div>
          )}
          {status && (
            <div className="studio-status" role="status">
              {status}
            </div>
          )}
          {error && (
            <div className="studio-error" role="alert">
              {error}
              <button onClick={() => setError('')}>Dismiss</button>
            </div>
          )}
          {year === 2026 && <TakePanel host={() => api.current?.take ?? null} />}
          <div className="stage-bottom">
            <span>
              {walking
                ? 'Eye height 1.70 m · Walking collisions follow the draft model'
                : 'Orbit: drag · Pan: right-drag · Zoom: scroll'}
            </span>
            <span>Metres · Source dimensions unverified</span>
          </div>
          {selected && (
            <aside className="selection-card">
              <div className="studio-kicker">
                SELECTED {selected.kind.replaceAll('_', ' ')}
              </div>
              <h2>{selected.name}</h2>
              <p>{selected.definition}</p>
              <div className="dimensions">
                Bounds{' '}
                {selected.dimensions.map((n) => n.toFixed(2)).join(' × ')} m
              </div>
              <div className="position-fields">
                {['X', 'Height', 'Z'].map((label, i) => (
                  <label key={label}>
                    {label}
                    <NumericField
                      key={`${selected.id}-${label}`}
                      label={`Selected ${label}`}
                      value={Number(selected.position[i].toFixed(3))}
                      onCommit={(n) => api.current?.move(i, n)}
                    />
                  </label>
                ))}
              </div>
              <label className="rotation-field" htmlFor="Selected-rotation">
                Rotation °
                <NumericField
                  key={`${selected.id}-rotation`}
                  label="Selected rotation"
                  value={Number(selected.rotation.toFixed(1))}
                  onCommit={(n) => api.current?.rotate(n)}
                />
              </label>
              <div className="position-fields">
                {['X', 'Y', 'Z'].map((label, i) => (
                  <label key={label} htmlFor={`Scale-${label}`}>
                    Scale {label}
                    <NumericField
                      label={`Scale ${label}`}
                      value={Number(selected.scale[i].toFixed(3))}
                      onCommit={(n) => api.current?.scale(i, n)}
                    />
                  </label>
                ))}
              </div>
              <button onClick={() => api.current?.clearSelection()}>
                Clear selection
              </button>
              <button
                disabled={connected}
                onClick={() => api.current?.duplicate()}
              >
                Duplicate component / assembly
              </button>
              <small>{selected.source}</small>
            </aside>
          )}
        </section>
        {photo && (
          <aside className="studio-photo">
            <button onClick={() => setPhoto(null)}>Close reference ×</button>
            <img src={photo.url} alt={photo.title} />
            <h2>{photo.title}</h2>
            <p>{photo.caption}</p>
            <details>
              <summary>Source provenance</summary>
              <code>{photo.source_path}</code>
            </details>
          </aside>
        )}
      </div>
      <footer className="studio-evidence">
        <div>
          <b>Photo evidence · aerials & rooms</b>
          <span>
            {manifest
              ? `${manifest.instances.filter((p) => p.kind !== 'reference').length.toLocaleString()} editable pieces · ${manifest.definitions.length.toLocaleString()} definitions`
              : 'Preparing component index'}
          </span>
        </div>
        <div className="evidence-frames">
          {refs.map((r) => (
            <button
              key={r.id}
              className={photo?.id === r.id ? 'active' : ''}
              onClick={() => setPhoto(r)}
            >
              <img src={r.url} alt="" />
              <span>{r.title}</span>
            </button>
          ))}
        </div>
      </footer>
    </main>
  );
}
