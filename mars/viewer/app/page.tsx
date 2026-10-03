import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ThreeResources, loadGltf } from '../lib/three-resources';
import {
  Maximize2,
  RotateCcw,
  ScanLine,
  Camera,
  Download,
  Info,
  X,
  Play,
  Pause,
  Mountain,
} from 'lucide-react';
type View = {
  name: string;
  image: string;
  position: number[];
  quaternion: number[];
  fov: number;
  aspect: number;
  heldOut?: boolean;
};
type Model = {
  id: string;
  name: string;
  date: string;
  url: string;
  frames: number;
  triangles: number;
  description: string;
  limitations: string[];
  views: View[];
  target?: number[];
  home?: number[];
  up?: number[];
  residual?: string;
  scale: string;
};
type Api = {
  home: () => void;
  top: () => void;
  mode: (s: string) => void;
  spin: (b: boolean) => void;
  view: (v: View) => void;
  shot: () => void;
};
export default function Home() {
  const mount = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const [models, setModels] = useState<Model[]>([]),
    [selected, setSelected] = useState(''),
    [load, setLoad] = useState('Loading reconstruction index…'),
    [error, setError] = useState('');
  const [mode, setMode] = useState('texture'),
    [spin, setSpin] = useState(false),
    [info, setInfo] = useState(false),
    [compare, setCompare] = useState(false),
    [viewIndex, setViewIndex] = useState(0),
    [film, setFilm] = useState(true);
  const model = models.find((m) => m.id === selected);
  const view = model?.views[viewIndex];
  useEffect(() => {
    const abort = new AbortController();
    fetch('/data/manifest.json', { signal: abort.signal })
      .then((r) => {
        if (!r.ok) throw Error('Reconstruction index unavailable');
        return r.json();
      })
      .then((d) => {
        const index = d as { models: Model[] };
        setModels(index.models);
        if (!index.models.length) throw Error('No reconstructions available');
        setSelected(index.models[0].id);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    if (!model || !mount.current) return;
    let disposed = false,
      locked = false;
    setError('');
    setLoad('Loading textured mesh…');
    setCompare(false);
    setSpin(false);
    setMode('texture');
    setViewIndex(0);
    const host = mount.current;
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: false,
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor('#171c20');
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    host.appendChild(renderer.domElement);
    renderer.domElement.setAttribute(
      'aria-label',
      'Interactive 3D campus reconstruction',
    );
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(48, 1, 0.01, 10000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.autoRotateSpeed = 0.5;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x56616b, 2.8));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(3, 6, 4);
    scene.add(sun);
    let root: THREE.Group | undefined,
      radius = 1;
    const center = new THREE.Vector3();
    const materials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    const resources = new ThreeResources(),
      abort = new AbortController();
    const basicCache = new Map<THREE.Material, THREE.MeshBasicMaterial>();
    const displayModes = new Map<string, THREE.Material>();
    controls.addEventListener('start', () => {
      locked = false;
    });
    const reset = () => {
      locked = false;
      camera.up.fromArray(model.up || [0, 1, 0]);
      camera.fov = 48;
      controls.target.copy(center);
      camera.position.fromArray(
        model.home || [
          center.x + radius * 0.8,
          center.y + radius * 0.65,
          center.z + radius * 0.8,
        ],
      );
      camera.lookAt(center);
      controls.update();
      camera.updateProjectionMatrix();
    };
    void loadGltf(model.url, abort.signal, resources)
      .then((gltf) => {
        if (disposed) return;
        root = gltf.scene;
        scene.add(root);
        root.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(root);
        bounds.getCenter(center);
        radius = bounds.getSize(new THREE.Vector3()).length() * 0.55;
        if (model.target) center.fromArray(model.target);
        camera.near = radius / 10000;
        camera.far = radius * 100;
        controls.minDistance = radius * 0.003;
        controls.maxDistance = radius * 8;
        root.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            const original = Array.isArray(o.material)
              ? o.material
              : [o.material];
            const basic = original.map((m: THREE.MeshStandardMaterial) => {
              if (!basicCache.has(m))
                basicCache.set(
                  m,
                  resources.material(
                    new THREE.MeshBasicMaterial({
                      map: m.map,
                      color: m.color,
                      side: THREE.DoubleSide,
                    }),
                  ) as THREE.MeshBasicMaterial,
                );
              return basicCache.get(m)!;
            });
            o.material = Array.isArray(o.material) ? basic : basic[0];
            materials.set(o, o.material);
          }
        });
        reset();
        setLoad('');
      })
      .catch((e) => {
        if (!disposed) {
          setLoad('');
          setError(`Could not load model: ${e.message}`);
        }
      });
    api.current = {
      home: reset,
      top: () => {
        locked = false;
        camera.up.set(0, 0, -1);
        camera.position
          .copy(center)
          .add(new THREE.Vector3(0, radius * 1.1, 0.0001));
        controls.target.copy(center);
        camera.fov = 48;
        camera.lookAt(center);
        controls.update();
        camera.updateProjectionMatrix();
      },
      spin: (b) => {
        locked = false;
        controls.autoRotate = b;
      },
      mode: (s) => {
        materials.forEach((m, o) => {
          if (s === 'texture') o.material = m;
          else {
            if (!displayModes.has(s))
              displayModes.set(
                s,
                resources.material(
                  new THREE.MeshStandardMaterial({
                    color: s === 'wire' ? '#9ec9dc' : '#b4b8b7',
                    roughness: 1,
                    side: THREE.DoubleSide,
                    wireframe: s === 'wire',
                  }),
                ),
              );
            o.material = displayModes.get(s)!;
          }
        });
      },
      view: (v) => {
        locked = true;
        controls.autoRotate = false;
        camera.up.fromArray(model.up || [0, 1, 0]);
        camera.position.fromArray(v.position);
        camera.quaternion.fromArray(v.quaternion);
        camera.fov = v.fov;
        const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(
          camera.quaternion,
        );
        controls.target
          .copy(camera.position)
          .addScaledVector(direction, camera.position.distanceTo(center));
        camera.updateProjectionMatrix();
      },
      shot: () => {
        renderer.render(scene, camera);
        renderer.domElement.toBlob((blob) => {
          if (!blob) return;
          const url = URL.createObjectURL(blob),
            a = document.createElement('a');
          a.download = `mars-2026-${model.id}.png`;
          a.href = url;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }, 'image/png');
      },
    };
    const resize = new ResizeObserver(() => {
      const w = host.clientWidth,
        h = host.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    resize.observe(host);
    let frame = 0;
    const loop = () => {
      if (disposed) return;
      frame = requestAnimationFrame(loop);
      if (document.hidden) return;
      if (!locked) controls.update();
      renderer.render(scene, camera);
    };
    loop();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      abort.abort();
      resources.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      api.current = null;
    };
  }, [model]);
  function selectView(i: number) {
    setViewIndex(i);
    setCompare(true);
    setSpin(false);
    setMode('texture');
    api.current?.mode('texture');
    if (model?.views[i]) api.current?.view(model.views[i]);
  }
  function showMode(m: string) {
    setMode(m);
    api.current?.mode(m);
  }
  return (
    <main>
      <header>
        <div className="identity">
          <span className="emblem">
            M<span>26</span>
          </span>
          <div>
            <h1>Mars College</h1>
            <p>AERIAL RECONSTRUCTION · 2026</p>
          </div>
        </div>
        <nav aria-label="Reconstruction date">
          {models.map((m) => (
            <button
              className={m.id === selected ? 'selected' : ''}
              key={m.id}
              onClick={() => setSelected(m.id)}
            >
              {m.name}
              <span>{m.date}</span>
            </button>
          ))}
        </nav>
        <div className="header-actions">
          <a
            href="/studio"
            style={{ fontSize: 12, color: '#d3e697', textDecoration: 'none' }}
          >
            Component studio ↗
          </a>
          <button
            className="icon"
            aria-label="Model information"
            onClick={() => setInfo(!info)}
          >
            <Info size={19} />
          </button>
          <button
            className="icon"
            aria-label="Fullscreen"
            onClick={() =>
              (document.fullscreenElement
                ? document.exitFullscreen()
                : document.documentElement.requestFullscreen()
              ).catch((e) => setError(e.message))
            }
          >
            <Maximize2 size={18} />
          </button>
        </div>
      </header>
      <section className={`workspace ${compare ? 'comparing' : ''}`}>
        <div
          className="viewport"
          style={compare ? { aspectRatio: view?.aspect || 16 / 9 } : undefined}
          ref={mount}
        />
        {compare && view && (
          <figure className="reference">
            <img src={`https://sim.mars.college${view.image}`} alt={`Drone reference: ${view.name}`} />
            <figcaption>
              <Camera size={14} />
              {view.heldOut ? 'Held-out photograph' : 'Source photograph'}
              <span>{view.name}</span>
            </figcaption>
          </figure>
        )}
        <div className="view-label">
          {compare
            ? 'RECONSTRUCTED VIEW'
            : mode === 'texture'
              ? 'TEXTURED 3D MESH'
              : mode === 'clay'
                ? 'GEOMETRY WITHOUT TEXTURE'
                : 'MESH WIREFRAME'}
          <span>{model?.date}</span>
        </div>
        {load && (
          <div className="loading">
            <span className="spinner" />
            {load}
          </div>
        )}
        {error && (
          <div role="alert" className="loading error">
            {error}
          </div>
        )}
        <div className="tools">
          <button
            title="Reset view"
            aria-label="Reset view"
            onClick={() => {
              setCompare(false);
              setSpin(false);
              api.current?.spin(false);
              api.current?.home();
            }}
          >
            <RotateCcw size={18} />
          </button>
          <button
            title="Overhead view"
            aria-label="Overhead view"
            onClick={() => {
              setCompare(false);
              api.current?.top();
            }}
          >
            <Mountain size={18} />
          </button>
          <span />
          <button
            className={spin ? 'active' : ''}
            title="Slow orbit"
            aria-label="Toggle slow orbit"
            onClick={() => {
              setSpin(!spin);
              api.current?.spin(!spin);
            }}
          >
            {spin ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button
            title="Save current view"
            aria-label="Save current view"
            onClick={() => api.current?.shot()}
          >
            <Camera size={18} />
          </button>
        </div>
        <div className="render-modes" role="group" aria-label="Surface display">
          {[
            ['texture', 'Texture'],
            ['clay', 'Geometry'],
            ['wire', 'Wireframe'],
          ].map(([m, label]) => (
            <button
              className={mode === m ? 'active' : ''}
              key={m}
              onClick={() => showMode(m)}
            >
              {label}
            </button>
          ))}
        </div>
        {compare && (
          <button
            className="close-compare"
            onClick={() => {
              setCompare(false);
              api.current?.home();
            }}
          >
            <X size={16} /> Close comparison
          </button>
        )}
        <div className="footnote">
          Drag to orbit · Scroll to zoom · Right-drag to pan
        </div>
        {info && model && (
          <aside className="inspector">
            <button
              className="dismiss icon"
              aria-label="Close model information"
              onClick={() => setInfo(false)}
            >
              <X size={18} />
            </button>
            <p className="eyebrow">RECONSTRUCTION RECORD</p>
            <h2>{model.name}</h2>
            <p>{model.description}</p>
            <dl>
              <div>
                <dt>Input photographs</dt>
                <dd>{model.frames}</dd>
              </div>
              <div>
                <dt>Mesh triangles</dt>
                <dd>{model.triangles.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Scale</dt>
                <dd>{model.scale}</dd>
              </div>
              {model.residual && (
                <div>
                  <dt>Image consistency</dt>
                  <dd>{model.residual}</dd>
                </div>
              )}
            </dl>
            <h3>Observed limitations</h3>
            <ul>
              {model.limitations.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            <a className="download" href={model.url} download>
              <Download size={16} /> Download mesh (.glb)
            </a>
            <a href={`https://sim.mars.college/data/${model.id}.blend`} download>
              Download Blender project (.blend)
            </a>
            <a href="https://sim.mars.college/data/report.html" target="_blank" rel="noreferrer">
              Read methodology and validation ↗
            </a>
          </aside>
        )}
      </section>
      <section className={`filmstrip ${film ? '' : 'collapsed'}`}>
        <div className="strip-title">
          <button onClick={() => setFilm(!film)}>
            <ScanLine size={16} />
            <span>Compare with drone photographs</span>
            <span className="count">{model?.views.length || 0}</span>
          </button>
          <span className="hint">
            Select a photograph to return to its camera position
          </span>
        </div>
        {film && (
          <div className="frames">
            {model?.views.map((v, i) => (
              <button
                className={compare && i === viewIndex ? 'chosen' : ''}
                key={v.name}
                onClick={() => selectView(i)}
              >
                <img src={`https://sim.mars.college${v.image}`} alt={v.name} />
                <span>{v.name}</span>
                {v.heldOut && <em>CHECK VIEW</em>}
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
