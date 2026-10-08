import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { WorldCameraMode } from './WorldBroadcast.ts';
import { editableEvent } from './WorldNavigation.ts';
import { cameraGround } from './WorldCameraGround.ts';

/** VF2 (Gene): one "your camera", RTS / Google-Earth style, on top of the orbit controls.
 *
 * Mouse (OrbitControls, configured in createWorldOrbitControls): drag orbits around the pivot, right-drag or two
 * fingers pan along the ground, scroll zooms toward the point under the cursor. This module adds:
 * - keys: WASD/arrows pan the pivot across the ground (radius and angle kept), Q/E rotate around it,
 *   R/F or PageUp/PageDown raise/lower the view, Shift speeds everything up; holding the right mouse button
 *   while pressing WASD flies along the view instead (editor style);
 * - the pivot rule: after keys, zoom or a drag, the pivot is re-anchored to the drawn ground under the screen
 *   centre, so orbiting is always around what you look at;
 * - double-click flies to the Soul/object/ground under the pointer and makes it the pivot;
 * - a subtle pivot marker while you move.
 * Any key movement takes over from Broadcast or Follow (`takeOver`). Presentation only. */
export type RtsOptions = {
  controls: () => OrbitControls;
  mode: () => WorldCameraMode;
  /** Switch to "your camera" (Broadcast/Follow off). */
  takeOver: () => void;
  scene: () => THREE.Object3D;
  /** Pickable roots for double-click (bodies, scenery); first visible hit wins. */
  pickRoots: () => readonly THREE.Object3D[];
  /** Whether the user is in "your camera" with this module in charge (not Free, not Advanced). */
  enabled?: () => boolean;
  /** Subject centre and enclosing world-space radius, never a requested camera distance. */
  focusAt?:(x:number,y:number)=>{center:THREE.Vector3;radius:number}|null;
};
const PAN_KEYS: Record<string, [number, number]> = { KeyW: [1, 0], ArrowUp: [1, 0], KeyS: [-1, 0], ArrowDown: [-1, 0], KeyA: [0, -1], ArrowLeft: [0, -1], KeyD: [0, 1], ArrowRight: [0, 1] };
const OTHER_KEYS = new Set(['KeyQ', 'KeyE', 'KeyR', 'KeyF', 'PageUp', 'PageDown', 'ShiftLeft', 'ShiftRight']);
const FLY_SECONDS = .8, MARKER_SECONDS = .9, REANCHOR_IDLE = .25;

/** Where the view ray from `camera` through the screen centre meets the drawn ground (or y = 0). */
export function centreGround(camera: THREE.Camera, scene: THREE.Object3D | null, maxDistance = 600): THREE.Vector3 | null {
  const origin = camera.getWorldPosition(new THREE.Vector3()), dir = camera.getWorldDirection(new THREE.Vector3());
  if (dir.y > -.02) return null; // looking at the horizon: no ground under the centre
  const height = (x: number, z: number) => (scene ? cameraGround.heightAt(scene, x, z) : null) ?? 0;
  let prev = 0, step = 1.5;
  for (let t = step; t <= maxDistance; t += step) {
    const p = origin.clone().addScaledVector(dir, t);
    if (p.y <= height(p.x, p.z)) {
      let lo = prev, hi = t; // refine
      for (let i = 0; i < 8; i++) { const m = (lo + hi) / 2, q = origin.clone().addScaledVector(dir, m); if (q.y <= height(q.x, q.z)) hi = m; else lo = m; }
      const hit = origin.clone().addScaledVector(dir, hi); hit.y = height(hit.x, hit.z); return hit;
    }
    prev = t; step = Math.min(12, step * 1.15);
  }
  return null;
}

export class WorldRtsCamera {
  readonly marker = new THREE.Group();
  private keys = new Set<string>();
  private rightHeld = false;
  private dragging = false;
  private markerAge = Infinity;
  private idle = Infinity;
  private moved = false;
  private flight: { fromT: THREE.Vector3; toT: THREE.Vector3; fromP: THREE.Vector3; toP: THREE.Vector3; t: number } | null = null;
  private listeners: [EventTarget, string, EventListener, AddEventListenerOptions?][] = [];
  private ring: THREE.Mesh;
  private dot: THREE.Mesh;
  private material = new THREE.MeshBasicMaterial({ color: '#fff3c4', transparent: true, opacity: 0, depthTest: false, side: THREE.DoubleSide });
  private boundControls: OrbitControls | null = null;
  private onStart = () => { this.dragging = true; this.markerAge = 0; };
  private onEnd = () => { this.dragging = false; this.idle = 0; this.moved = true; };
  private onChange = () => { if (this.dragging) this.markerAge = 0; };

  private canvas: HTMLCanvasElement;
  private camera: THREE.PerspectiveCamera;
  private o: RtsOptions;
  constructor(canvas: HTMLCanvasElement, camera: THREE.PerspectiveCamera, o: RtsOptions) {
    this.canvas = canvas; this.camera = camera; this.o = o;
    this.marker.name = 'rts-pivot-marker'; this.marker.renderOrder = 999; this.marker.visible = false;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(.42, .5, 40).rotateX(-Math.PI / 2), this.material);
    this.dot = new THREE.Mesh(new THREE.CircleGeometry(.07, 16).rotateX(-Math.PI / 2), this.material);
    this.marker.add(this.ring, this.dot);
    const doc = canvas.ownerDocument, win = doc.defaultView;
    const listen = (t: EventTarget, name: string, cb: (e: any) => void, opt?: AddEventListenerOptions) => { t.addEventListener(name, cb, opt); this.listeners.push([t, name, cb, opt]); };
    // Keys work when the scene has focus, or when nothing else does (a fresh page: just press W).
    // VF6: also when a panel has focus (the Soul card focuses its name; Follow is a button on it), so pressing W
    // while following breaks out. Letter keys only there: arrows/PageUp/PageDown keep scrolling a focused panel.
    const panelFocus = () => { const a = doc.activeElement; return !!a && a !== canvas && a !== doc.body && !(a.tagName === 'BUTTON' && !a.closest('.human-panel,.dialogue-dock')); };
    const ours = (e: KeyboardEvent) => !editableEvent(e) && !e.altKey && !e.ctrlKey && !e.metaKey && !doc.querySelector('[aria-modal="true"]')
      && (doc.activeElement === canvas || doc.activeElement === doc.body || doc.activeElement === null
        || (!doc.activeElement.closest('[role=dialog],[role=radiogroup],[role=listbox],[role=menu],[role=slider]') && (!panelFocus() || /^Key[WASDQERF]$|^Shift/.test(e.code))));
    if (win) {
      listen(win, 'keydown', (e: KeyboardEvent) => {
        if (!ours(e) || !(e.code in PAN_KEYS || OTHER_KEYS.has(e.code)) || this.enabledNow() === false) return;
        e.preventDefault(); this.keys.add(e.code);
      });
      listen(win, 'keyup', (e: KeyboardEvent) => { this.keys.delete(e.code); });
      listen(win, 'blur', () => { this.keys.clear(); this.rightHeld = false; });
    }
    listen(canvas, 'pointerdown', (e: PointerEvent) => { if (e.button === 2) { this.rightHeld = true; this.crane = { x: e.clientX, y: e.clientY }; } this.flight = null; });
    // VF6: in Follow, right-drag up/down cranes the camera (raises/lowers it, still looking at the Soul).
    listen(canvas, 'pointermove', (e: PointerEvent) => {
      if (!this.crane || !this.rightHeld || !this.following || this.enabledNow() === false) { this.crane = null; return; }
      const dy = e.clientY - this.crane.y; this.crane = { x: e.clientX, y: e.clientY };
      if (dy) this.craneBy(dy);
    });
    listen(doc, 'pointerup', (e: PointerEvent) => { if (e.button === 2) { this.crane = null; if (this.rightHeld && this.flew) { this.flew = false; this.idle = 0; this.moved = true; } this.rightHeld = false; } });
    listen(canvas, 'contextmenu', (e: Event) => e.preventDefault());
    listen(canvas, 'wheel', () => { this.markerAge = 0; this.idle = 0; this.moved = true; }, { passive: true });
    listen(canvas, 'dblclick', (e: MouseEvent) => this.flyToPointer(e));
  }
  private flew = false;
  private crane: { x: number; y: number } | null = null;
  /** Follow: raise (drag down) or lower (drag up) the camera around the Soul by `dy` pixels; keeps the distance. */
  craneBy(dy: number) {
    const c = this.bind(), offset = this.camera.position.clone().sub(c.target), s = new THREE.Spherical().setFromVector3(offset);
    s.phi = Math.max(.12, Math.min(c.maxPolarAngle, s.phi - dy * .006));
    this.camera.position.copy(c.target).add(new THREE.Vector3().setFromSpherical(s)); this.camera.lookAt(c.target);
  }
  private enabledNow() { return this.o.enabled ? this.o.enabled() : true; }
  /** Keep the controls' start/end hooks on the current controls object (it is recreated on input release). */
  private bind() {
    const c = this.o.controls();
    if (c === this.boundControls) return c;
    this.boundControls?.removeEventListener('start', this.onStart); this.boundControls?.removeEventListener('end', this.onEnd); this.boundControls?.removeEventListener('change', this.onChange);
    c.addEventListener('start', this.onStart); c.addEventListener('end', this.onEnd); c.addEventListener('change', this.onChange);
    this.boundControls = c; return c;
  }
  get following() { return this.o.mode() === 'follow'; }

  /** Double-click: fly to what is under the pointer and make it the pivot. */
  flyToPointer(e: MouseEvent) {
    if (this.enabledNow() === false) return;
    const focus=this.o.focusAt?.(e.clientX,e.clientY);if(focus){this.o.takeOver();this.frameSubject(focus.center,focus.radius);return;}
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera);
    const shown = (x: THREE.Object3D) => { for (let p: THREE.Object3D | null = x; p; p = p.parent) if (!p.visible) return false; return true; };
    let point: THREE.Vector3 | null = null;
    for (const hit of ray.intersectObjects(this.o.pickRoots() as THREE.Object3D[], true)) if ((hit.object as THREE.Mesh).isMesh && shown(hit.object) && hit.distance > .5) { point = hit.point.clone(); break; }
    if (!point) { const g = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3()); if (g && ray.ray.origin.distanceTo(g) < 600) point = g; }
    if (!point) return;
    this.o.takeOver();
    this.flyTo(point);
  }
  /** Glide the pivot to `point`, coming in to a comfortable distance (6–16 m) at the same angle. */
  frameSubject(center:THREE.Vector3,boundingRadius:number){
    const vfov=this.camera.fov*Math.PI/180,hfov=2*Math.atan(Math.tan(vfov/2)*this.camera.aspect);
    const half=Math.max(.05,Math.min(vfov,hfov)/2),radius=Number.isFinite(boundingRadius)?Math.max(.1,boundingRadius):1;
    this.flyTo(center,Math.max(6,radius/Math.sin(half)*1.15));
  }
  flyTo(point: THREE.Vector3,cameraDistance?:number) {
    const c = this.bind(), offset = this.camera.position.clone().sub(c.target);
    const distance=cameraDistance!==undefined&&Number.isFinite(cameraDistance)?Math.max(6,cameraDistance):Math.min(16,Math.max(6,offset.length()));
    if(offset.lengthSq()<1e-6)offset.set(1,.7,1);
    offset.setLength(distance);
    this.flight = { fromT: c.target.clone(), toT: point.clone(), fromP: this.camera.position.clone(), toP: point.clone().add(offset), t: 0 };
    this.markerAge = 0;
  }

  /** Per frame, before controls.update(). Returns true when it moved the camera. */
  update(seconds: number): boolean {
    const dt = Number.isFinite(seconds) ? Math.max(0, Math.min(.1, seconds)) : 0;
    const c = this.bind(), mode = this.o.mode(), target = c.target;
    let changed = false;
    if (this.flight) {
      const f = this.flight; f.t = Math.min(1, f.t + dt / FLY_SECONDS); const k = f.t * f.t * (3 - 2 * f.t);
      target.lerpVectors(f.fromT, f.toT, k); this.camera.position.lerpVectors(f.fromP, f.toP, k); this.camera.lookAt(target);
      this.markerAge = 0; changed = true;
      if (f.t >= 1) this.flight = null;
    }
    const held = (code: string) => this.keys.has(code);
    let fwd = 0, side = 0;
    for (const [code, [f, s]] of Object.entries(PAN_KEYS)) if (held(code)) { fwd += f; side += s; }
    const turn = (held('KeyE') ? 1 : 0) - (held('KeyQ') ? 1 : 0);
    const lift = (held('KeyR') || held('PageUp') ? 1 : 0) - (held('KeyF') || held('PageDown') ? 1 : 0);
    if ((fwd || side || turn || lift) && this.enabledNow() !== false) {
      if (mode !== 'manual') this.o.takeOver(); // Broadcast or Follow hands over to your camera
      this.flight = null;
      const boost = held('ShiftLeft') || held('ShiftRight') ? 3 : 1;
      const offset = this.camera.position.clone().sub(target), radius = Math.max(2, offset.length());
      const speed = Math.max(6, radius * .9) * boost * dt;
      if (fwd || side) {
        const n = Math.hypot(fwd, side);
        if (this.rightHeld) { // editor-style fly along the view
          const dir = this.camera.getWorldDirection(new THREE.Vector3()), right = new THREE.Vector3().crossVectors(dir, this.camera.up).normalize();
          const move = dir.multiplyScalar(fwd / n * speed).addScaledVector(right, side / n * speed);
          this.camera.position.add(move); target.add(move); this.flew = true;
        } else {
          const forward = this.camera.getWorldDirection(new THREE.Vector3()); forward.y = 0;
          if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1); else forward.normalize();
          const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
          const move = forward.multiplyScalar(fwd / n * speed).addScaledVector(right, side / n * speed);
          this.camera.position.add(move); target.add(move);
        }
      }
      if (turn || lift) {
        const s = new THREE.Spherical().setFromVector3(offset);
        s.theta -= turn * 1.3 * boost * dt;
        s.phi = Math.max(.12, Math.min(c.maxPolarAngle, s.phi - lift * .9 * boost * dt));
        this.camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(s));
        this.camera.lookAt(target);
      }
      this.markerAge = 0; this.idle = 0; this.moved = !this.rightHeld || !(fwd || side); changed = true;
    } else this.idle += dt;
    // The pivot rule: shortly after any movement, re-anchor the pivot to the ground under the screen centre.
    if (this.moved && !this.dragging && !this.flight && !this.rightHeld && this.idle >= REANCHOR_IDLE && mode === 'manual') {
      this.moved = false; this.reanchor();
    }
    this.markerAge += dt;
    const fade = this.dragging ? 1 : Math.max(0, 1 - this.markerAge / MARKER_SECONDS);
    this.material.opacity = .85 * fade; this.marker.visible = fade > 0 && mode === 'manual';
    if (this.marker.visible) {
      const scale = Math.max(.5, this.camera.position.distanceTo(target) * .035);
      this.marker.position.copy(target).add(new THREE.Vector3(0, .04, 0)); this.marker.scale.setScalar(scale);
    }
    // Diagnostics for proofs/tests (read-only): where the camera and its pivot are.
    (globalThis as { __simCamera?: unknown }).__simCamera = { p: this.camera.position.toArray().map(v => +v.toFixed(2)), pivot: target.toArray().map(v => +v.toFixed(2)), marker: this.marker.visible };
    return changed;
  }
  /** Pivot := drawn ground under the screen centre; the camera does not move. */
  reanchor(): boolean {
    const c = this.bind(); this.camera.updateMatrixWorld();
    const p = centreGround(this.camera, this.o.scene());
    if (!p || p.distanceTo(this.camera.position) < 1) return false;
    c.target.copy(p); return true;
  }
  dispose() {
    for (const [t, name, cb, opt] of this.listeners) t.removeEventListener(name, cb, opt);
    this.listeners = [];
    this.boundControls?.removeEventListener('start', this.onStart); this.boundControls?.removeEventListener('end', this.onEnd); this.boundControls?.removeEventListener('change', this.onChange);
    this.marker.removeFromParent(); this.ring.geometry.dispose(); this.dot.geometry.dispose(); this.material.dispose();
  }
}
