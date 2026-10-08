import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { WorldCameraMode } from './WorldBroadcast.ts';
import { editableEvent,manualCameraKeys,manualCameraStep,rotateWorldView } from './WorldNavigation.ts';
import { cameraGround } from './WorldCameraGround.ts';

/** One manual camera: default drag orbits, RMB looks in place, WASD moves horizontally,
 * arrows rotate the head, Q/E (or F/R) lower/raise, Shift boosts and Alt gives precision.
 * Deliberate movement takes over from Follow/Broadcast at the same eye and gaze.
 * Orbit gestures in Follow keep the tracked Soul centred. Presentation only. */
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
  private rightPointer:number|null=null;
  private lookPoint:{x:number;y:number}|null=null;
  private manualInput=false;
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
    // while following breaks out. Ordinary buttons also allow head controls immediately after Follow.
    // Arrows/PageUp/PageDown keep scrolling a focused panel; interactive widgets retain their keys below.
    const panelFocus = () => { const a = doc.activeElement; return !!a && a !== canvas && a !== doc.body && a.tagName !== 'BUTTON'; };
    const ours = (e: KeyboardEvent) => !editableEvent(e) && !e.ctrlKey && !e.metaKey && !doc.querySelector('[aria-modal="true"]')
      && (doc.activeElement === canvas || doc.activeElement === doc.body || doc.activeElement === null
        || (!doc.activeElement.closest('[role=dialog],[role=radiogroup],[role=listbox],[role=menu],[role=slider]') && (!panelFocus() || /^Key[WASDQERF]$|^(Shift|Alt)/.test(e.code))));
    if (win) {
      listen(win, 'keydown', (e: KeyboardEvent) => {
        if(e.key==='Escape'&&!editableEvent(e)){this.clearInput();return;}
        if (!ours(e) || !manualCameraKeys.has(e.code) || this.enabledNow() === false) return;
        e.preventDefault(); this.keys.add(e.code);this.flight=null;
      });
      listen(win, 'keyup', (e: KeyboardEvent) => { this.keys.delete(e.code); });
      listen(win, 'blur', () => this.clearInput());
    }
    listen(canvas,'blur',()=>this.clearInput());
    listen(doc,'visibilitychange',()=>{if(doc.hidden)this.clearInput();});
    listen(canvas,'pointerdown',(e:PointerEvent)=>{
      this.flight=null;if(e.button!==2||this.enabledNow()===false)return;
      this.rightHeld=true;this.rightPointer=e.pointerId;this.lookPoint={x:e.clientX,y:e.clientY};
      canvas.focus({preventScroll:true});canvas.setPointerCapture?.(e.pointerId);
      e.preventDefault();e.stopImmediatePropagation();
    },{capture:true});
    listen(canvas,'pointermove',(e:PointerEvent)=>{
      if(!this.rightHeld||!this.lookPoint||this.enabledNow()===false)return;
      const dx=e.clientX-this.lookPoint.x,dy=e.clientY-this.lookPoint.y;this.lookPoint={x:e.clientX,y:e.clientY};
      if(dx||dy){const c=this.startManualInput();rotateWorldView(this.camera,c.target,dx*.004,-dy*.004);this.markerAge=0;}
      e.preventDefault();e.stopImmediatePropagation();
    },{capture:true});
    const endLook=(e:PointerEvent)=>{if(e.pointerId===this.rightPointer){this.releaseLook();this.manualInput=false;}};
    listen(doc,'pointerup',endLook);listen(canvas,'pointercancel',endLook);
    listen(canvas,'lostpointercapture',endLook);
    listen(canvas, 'contextmenu', (e: Event) => e.preventDefault());
    listen(canvas, 'wheel', () => { this.markerAge = 0; this.idle = 0; this.moved = true; }, { passive: true });
    listen(canvas, 'dblclick', (e: MouseEvent) => this.flyToPointer(e));
  }
  private releaseLook(){
    const id=this.rightPointer;this.rightHeld=false;this.rightPointer=null;this.lookPoint=null;
    if(id!==null&&this.canvas.hasPointerCapture?.(id))this.canvas.releasePointerCapture(id);
  }
  private clearInput(){this.keys.clear();this.releaseLook();this.manualInput=false;this.flight=null;}
  /** Discard an old orbit gesture/damping once, before direct eye-relative controls. */
  private startManualInput(){
    if(!this.manualInput){this.o.takeOver();this.manualInput=true;this.dragging=false;this.moved=false;this.flight=null;}
    return this.bind();
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
    const mode=this.o.mode();let c=this.bind(),target=c.target;
    let changed = false;
    if (this.flight) {
      const f = this.flight; f.t = Math.min(1, f.t + dt / FLY_SECONDS); const k = f.t * f.t * (3 - 2 * f.t);
      target.lerpVectors(f.fromT, f.toT, k); this.camera.position.lerpVectors(f.fromP, f.toP, k); this.camera.lookAt(target);
      this.markerAge = 0; changed = true;
      if (f.t >= 1) this.flight = null;
    }
    const movement=manualCameraStep(this.keys,dt);
    if(Object.values(movement).some(Boolean)&&this.enabledNow()!==false){
      c=this.startManualInput();target=c.target;const pivot=target;
      const forward=this.camera.getWorldDirection(new THREE.Vector3());forward.y=0;
      if(forward.lengthSq()<1e-8)forward.set(0,0,-1);else forward.normalize();
      const right=new THREE.Vector3().crossVectors(forward,new THREE.Vector3(0,1,0));
      const delta=forward.multiplyScalar(movement.forward??0).addScaledVector(right,movement.right??0);delta.y=movement.up??0;
      this.camera.position.add(delta);pivot.add(delta);
      rotateWorldView(this.camera,pivot,movement.yaw??0,movement.pitch??0);
      this.markerAge=0;this.idle=0;this.moved=false;changed=true;
    }else{this.idle+=dt;if(!this.rightHeld)this.manualInput=false;}
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
  release(){this.clearInput();this.flight=null;}
  dispose() {
    this.clearInput();
    for (const [t, name, cb, opt] of this.listeners) t.removeEventListener(name, cb, opt);
    this.listeners = [];
    this.boundControls?.removeEventListener('start', this.onStart); this.boundControls?.removeEventListener('end', this.onEnd); this.boundControls?.removeEventListener('change', this.onChange);
    this.marker.removeFromParent(); this.ring.geometry.dispose(); this.dot.geometry.dispose(); this.material.dispose();
  }
}
