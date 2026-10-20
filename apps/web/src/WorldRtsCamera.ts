import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { WorldCameraMode } from './WorldBroadcast.ts';
import { editableEvent,manualCameraKeys,manualCameraStep,rotateWorldView,MANUAL_FAR_LIMIT } from './WorldNavigation.ts';
import { cameraGround, CAMERA_GROUND_MARGIN } from './WorldCameraGround.ts';

/** One manual camera: default drag orbits, RMB looks in place, WASD moves horizontally (faster the higher the eye),
 * arrows rotate the head, Q/E (or F/R) lower/raise, Shift boosts and Alt gives precision. C1: the wheel zooms
 * toward/away from the point under the cursor without turning the view (stopping at the ground, never re-tilting),
 * out to the edge of the map; a click on open ground turns the view to make that point the pivot; Home/H shows
 * everything.
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
  /** C1: the world's ground rectangle [x0, z0, x1, z1] (far zoom limit, pivot bounds); null when unknown. */
  extent?: () => readonly [number, number, number, number] | null;
  /** C1: Home or H: back to the overview ("see everything"). */
  home?: () => void;
};
const FLY_SECONDS = .8, MARKER_SECONDS = .9, REANCHOR_IDLE = .25;
/** C1 zoom. One wheel notch (100 px) moves the eye ZOOM_PER_PIXEL*100 ≈ 12% of the way toward (or away from) the point
 * under the cursor, eased over ~ZOOM_EASE s; a trackpad pinch (ctrl+wheel) counts 10x per pixel like OrbitControls. With
 * ZOOM_TO_CURSOR false the wheel zooms along the view axis toward the pivot instead. */
export const ZOOM_PER_PIXEL = .0012, ZOOM_EASE = .08, ZOOM_TO_CURSOR = true;
/** C1: the nearest the eye comes to its pivot; the farthest is the map's half-size × FAR_PER_RADIUS (320 m at least, MANUAL_FAR_LIMIT at most). */
export const NEAR_LIMIT = 2, FAR_PER_RADIUS = 2.5;
/** C1: a click waits out the double-click window before it turns the view to its point (a double-click only flies). */
export const CLICK_PIVOT_DELAY_MS = 300, TURN_SECONDS = .45;
/** C1: metres the eye must be above the ground to move at the base WASD speed; higher multiplies it (up to 40x). */
const SPEED_HEIGHT = 8, SPEED_MAX = 40;

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

/** Old Eden's terrain (±900 m; the far plane is set for it in LiveWorld). */
export const EDEN_TERRAIN_EXTENT = [-900, -900, 900, 900] as const;
/** C1: a wheel over HTML laid on the world (name tags, speech) zooms as it would over the canvas: re-dispatched there,
 * where your camera (or Follow's OrbitControls) reads it. Before, a Soul's tag drifting under the cursor ate every notch. */
export function forwardWheel(from: HTMLElement, canvas: HTMLElement): void {
  from.addEventListener('wheel', (e: WheelEvent) => {
    if (e.target === canvas) return;
    e.preventDefault(); e.stopPropagation();
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ, deltaMode: e.deltaMode,
      clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY,
      ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey, bubbles: true, cancelable: true }));
  }, { passive: false });
}

/** C1: how far the eye may zoom out from its pivot for a world whose ground spans `extent`. */
export function farLimit(extent: readonly [number, number, number, number] | null | undefined): number {
  const r = extent ? Math.max(extent[2] - extent[0], extent[3] - extent[1]) / 2 : 0;
  return Math.min(MANUAL_FAR_LIMIT, Math.max(320, Number.isFinite(r) ? r * FAR_PER_RADIUS : 0));
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
  private flight: { fromT: THREE.Vector3; toT: THREE.Vector3; fromP: THREE.Vector3; toP: THREE.Vector3; t: number; seconds?: number } | null = null;
  /** C1 zoom still to apply (natural log of the eye-pivot distance factor; + is out) and the point it scales about. */
  private zoomLog = 0;
  private zoomAt: { x: number; y: number } | null = null;
  private zoomAnchor: THREE.Vector3 | null = null;
  private pendingClick: ReturnType<typeof setTimeout> | null = null;
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
        if((e.code==='Home'||e.code==='KeyH')&&!e.altKey&&!e.shiftKey&&this.o.home&&ours(e)&&this.enabledNow()!==false&&this.o.mode()!=='follow'){
          e.preventDefault();this.clearInput();this.o.home();return;}
        if (!ours(e) || !manualCameraKeys.has(e.code) || this.enabledNow() === false) return;
        e.preventDefault(); this.keys.add(e.code);this.flight=null;this.stopZoom();this.cancelClick();
      });
      listen(win, 'keyup', (e: KeyboardEvent) => { this.keys.delete(e.code); });
      listen(win, 'blur', () => this.clearInput());
    }
    listen(canvas,'blur',()=>this.clearInput());
    listen(doc,'visibilitychange',()=>{if(doc.hidden)this.clearInput();});
    listen(canvas,'pointerdown',(e:PointerEvent)=>{
      this.flight=null;this.stopZoom();this.cancelClick();if(e.button!==2||this.enabledNow()===false)return;
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
    // C1: your camera's wheel (and Broadcast's, which it takes over). Capture: runs before OrbitControls' own dolly, which
    // turned the view at shallow angles (zoomToCursor re-aims below 20°) and stopped at 320 m. Follow keeps OrbitControls'
    // 2.4–40 m zoom; Free camera keeps WorldNavigation's; touch pinch stays OrbitControls'.
    listen(canvas, 'wheel', (e: WheelEvent) => {
      this.cancelClick();
      const mode = this.o.mode();
      if (this.enabledNow() === false || mode === 'follow') return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (mode !== 'manual') this.o.takeOver();
      this.flight = null;
      const px = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1) * (e.ctrlKey ? 10 : 1);
      if (!Number.isFinite(px) || !px) return;
      if (!this.zoomAt || Math.hypot(e.clientX - this.zoomAt.x, e.clientY - this.zoomAt.y) > 3) { this.zoomAt = { x: e.clientX, y: e.clientY }; this.zoomAnchor = null; }
      this.zoomLog = Math.max(-3, Math.min(3, this.zoomLog + Math.max(-.35, Math.min(.35, px * ZOOM_PER_PIXEL))));
      this.markerAge = 0; this.idle = 0; this.moved = true;
    }, { capture: true, passive: false });
    listen(canvas, 'dblclick', (e: MouseEvent) => { this.cancelClick(); this.flyToPointer(e); });
  }
  private releaseLook(){
    const id=this.rightPointer;this.rightHeld=false;this.rightPointer=null;this.lookPoint=null;
    if(id!==null&&this.canvas.hasPointerCapture?.(id))this.canvas.releasePointerCapture(id);
  }
  private clearInput(){this.keys.clear();this.releaseLook();this.manualInput=false;this.flight=null;this.stopZoom();this.cancelClick();}
  private stopZoom(){this.zoomLog=0;this.zoomAnchor=null;this.zoomAt=null;}
  private cancelClick(){if(this.pendingClick!==null){clearTimeout(this.pendingClick);this.pendingClick=null;}}
  /** C1: the far zoom limit for this world. */
  farLimit(){return farLimit(this.o.extent?.());}
  private pointerRay(x:number,y:number){
    const rect=this.canvas.getBoundingClientRect(),ray=new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((x-rect.left)/rect.width)*2-1,-((y-rect.top)/rect.height)*2+1),this.camera);return ray;
  }
  /** The first visible pickable surface under the pointer, else the drawn ground, else y = 0 (within the far limit). */
  private pickPoint(x:number,y:number):THREE.Vector3|null{
    this.camera.updateMatrixWorld();const ray=this.pointerRay(x,y),far=Math.max(600,this.farLimit()*1.5);
    const shown = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false; return true; };
    for (const hit of ray.intersectObjects(this.o.pickRoots() as THREE.Object3D[], true)) if ((hit.object as THREE.Mesh).isMesh && shown(hit.object) && hit.distance > .5) return hit.point.clone();
    const scene=this.o.scene(),ground=scene?cameraGround.along(scene,ray.ray.origin,ray.ray.direction,far):null;if(ground)return ground;
    const g = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    return g && ray.ray.origin.distanceTo(g) < far ? g : null;
  }
  /** C1: a plain click on open ground (LiveWorld calls this when nothing is selected by it): after the double-click
   * window, that point becomes the pivot. The eye stays where it is; the view turns to the point (orbit controls
   * always look at their pivot). Mouse and pen only: a phone's tap is unchanged. */
  clickPivot(e:{clientX:number;clientY:number;pointerType?:string}){
    this.cancelClick();
    if(e.pointerType==='touch'||this.enabledNow()===false||this.o.mode()!=='manual')return;
    const {clientX:x,clientY:y}=e;
    this.pendingClick=setTimeout(()=>{
      this.pendingClick=null;if(this.enabledNow()===false||this.o.mode()!=='manual'||this.dragging||this.rightHeld||this.keys.size)return;
      const point=this.pickPoint(x,y);if(!point||point.distanceTo(this.camera.position)<1)return;
      const c=this.bind(),eye=this.camera.position.clone();
      this.flight={fromT:c.target.clone(),toT:point,fromP:eye,toP:eye.clone(),t:0,seconds:TURN_SECONDS};this.markerAge=0;this.moved=false;
    },CLICK_PIVOT_DELAY_MS);
  }
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
    const point = this.pickPoint(e.clientX, e.clientY);
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
      const f = this.flight; f.t = Math.min(1, f.t + dt / (f.seconds ?? FLY_SECONDS)); const k = f.t * f.t * (3 - 2 * f.t);
      target.lerpVectors(f.fromT, f.toT, k); this.camera.position.lerpVectors(f.fromP, f.toP, k); this.camera.lookAt(target);
      this.markerAge = 0; changed = true;
      if (f.t >= 1) this.flight = null;
    }
    if(this.zoomLog&&mode==='manual'&&this.enabledNow()!==false&&!this.flight)changed=this.stepZoom(dt,c)||changed;
    const movement=manualCameraStep(this.keys,dt,this.keys.size?this.speedScale():1);
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
    if(mode==='manual'&&this.enabledNow()!==false&&!this.flight)changed=this.keepPivotInBounds(target)||changed;
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
    (globalThis as { __simCamera?: unknown }).__simCamera = { p: this.camera.position.toArray().map(v => +v.toFixed(2)), pivot: target.toArray().map(v => +v.toFixed(2)), marker: this.marker.visible, far: this.farLimit() };
    return changed;
  }
  /** WASD speed factor: the eye's height above the ground under it over SPEED_HEIGHT, 1–SPEED_MAX. */
  private speedScale(){
    const p=this.camera.position,scene=this.o.scene(),ground=(scene?cameraGround.heightAt(scene,p.x,p.z):null)??0;
    return Math.max(1,Math.min(SPEED_MAX,(p.y-ground)/SPEED_HEIGHT));
  }
  /** One frame of the eased wheel zoom: scale eye and pivot about the anchor (the view does not turn). Stops at the
   * near/far limits and where the eye would come within the ground margin, rather than lifting and re-aiming it. */
  private stepZoom(dt:number,c:OrbitControls):boolean{
    let take=Math.abs(this.zoomLog)<1e-3?this.zoomLog:this.zoomLog*(1-Math.exp(-dt/ZOOM_EASE));
    if(!take||!Number.isFinite(take))return false;
    const eye=this.camera.position,target=c.target,d=eye.distanceTo(target);
    if(d<1e-6){this.stopZoom();return false;}
    const anchor=this.zoomAnchorPoint(target);
    const far=this.farLimit();
    if(take>0&&d*Math.exp(take)>far){take=Math.max(0,Math.log(far/d));this.zoomLog=take;}
    if(take<0&&d*Math.exp(take)<NEAR_LIMIT){take=Math.min(0,Math.log(NEAR_LIMIT/d));this.zoomLog=take;}
    const scene=this.o.scene(),ahead=this.camera.getWorldDirection(new THREE.Vector3());ahead.y=0;
    if(ahead.lengthSq()>1e-8)ahead.normalize();
    const at=(k:number)=>anchor.clone().addScaledVector(eye.clone().sub(anchor),Math.exp(k));
    const clear=(q:THREE.Vector3)=>{
      if(!scene)return true;const g0=cameraGround.heightAt(scene,q.x,q.z),g1=cameraGround.heightAt(scene,q.x+ahead.x*1.5,q.z+ahead.z*1.5);
      const g=g0===null?g1:g1===null?g0:Math.max(g0,g1);return g===null||q.y>=g+CAMERA_GROUND_MARGIN+.05;};
    let next=at(take);
    if(next.y<eye.y&&!clear(next)){
      let lo=0,hi=1;for(let i=0;i<10;i++){const m=(lo+hi)/2;if(clear(at(take*m)))lo=m;else hi=m;}
      take*=lo;next=at(take);this.zoomLog=take;
    }
    this.zoomLog-=take;if(Math.abs(this.zoomLog)<1e-4)this.stopZoom();
    if(!take)return false;
    target.sub(anchor).multiplyScalar(Math.exp(take)).add(anchor);eye.copy(next);this.camera.updateMatrixWorld();
    this.markerAge=0;this.idle=0;this.moved=true;return true;
  }
  /** The zoom's fixed point: the ground under the cursor (ZOOM_TO_CURSOR), else the pivot along the view axis;
   * over the sky, the point on the cursor ray as far out as the pivot. */
  private zoomAnchorPoint(target:THREE.Vector3):THREE.Vector3{
    if(this.zoomAnchor)return this.zoomAnchor;
    const eye=this.camera.position,d=eye.distanceTo(target);let p:THREE.Vector3|null=null;
    if(ZOOM_TO_CURSOR&&this.zoomAt&&typeof this.canvas.getBoundingClientRect==='function'){
      this.camera.updateMatrixWorld();const ray=this.pointerRay(this.zoomAt.x,this.zoomAt.y).ray;
      const scene=this.o.scene();p=scene?cameraGround.along(scene,ray.origin,ray.direction,Math.max(600,d*3)):null;
      if(!p){const g=ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),0),new THREE.Vector3());if(g&&g.distanceTo(eye)<Math.max(600,d*3))p=g;}
      p??=ray.origin.clone().addScaledVector(ray.direction,d);
    }
    return this.zoomAnchor=p??target.clone();
  }
  /** Pan/WASD/zoom keep the pivot over the map (its ground rectangle plus a margin); the eye moves with it. */
  private keepPivotInBounds(target:THREE.Vector3):boolean{
    const e=this.o.extent?.();if(!e||!e.every(Number.isFinite))return false;
    const m=Math.max(60,.25*Math.max(e[2]-e[0],e[3]-e[1]));
    const x=Math.max(e[0]-m,Math.min(e[2]+m,target.x)),z=Math.max(e[1]-m,Math.min(e[3]+m,target.z));
    if(x===target.x&&z===target.z)return false;
    this.camera.position.x+=x-target.x;this.camera.position.z+=z-target.z;target.x=x;target.z=z;return true;
  }
  /** Pivot := drawn ground under the screen centre; the camera does not move. */
  reanchor(): boolean {
    const c = this.bind(); this.camera.updateMatrixWorld();
    const p = centreGround(this.camera, this.o.scene(), Math.max(600, this.camera.position.distanceTo(c.target) * 1.5));
    if (!p || p.distanceTo(this.camera.position) < 1) return false;
    c.target.copy(p); return true;
  }
  release(){this.clearInput();this.flight=null;}
  dispose() {
    this.clearInput();this.cancelClick();
    for (const [t, name, cb, opt] of this.listeners) t.removeEventListener(name, cb, opt);
    this.listeners = [];
    this.boundControls?.removeEventListener('start', this.onStart); this.boundControls?.removeEventListener('end', this.onEnd); this.boundControls?.removeEventListener('change', this.onChange);
    this.marker.removeFromParent(); this.ring.geometry.dispose(); this.dot.geometry.dispose(); this.material.dispose();
  }
}
