import { Vector3, type PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { WorldCameraMode } from './WorldBroadcast.ts';
export type ManualNavigation = 'orbit' | 'free';
/** Metres for forward/right/up; radians for yaw (+ turns right) and pitch (+ tilts up). */
export type CameraMove = { forward?: number; right?: number; up?: number; yaw?: number; pitch?: number };
export type NavigationContext = { mode: WorldCameraMode; navigation: ManualNavigation; lifecycle: string };
// Shared controls in either manual camera: horizontal walking, independent head rotation and elevation.
export const manualCameraKeys = new Set(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','KeyR','KeyF','PageUp','PageDown','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','ShiftLeft','ShiftRight','AltLeft','AltRight']);
export function manualCameraStep(keys:ReadonlySet<string>,seconds:number):CameraMove {
  const held=(code:string)=>Number(keys.has(code)),dt=Number.isFinite(seconds)?Math.min(.1,Math.max(0,seconds)):0;
  const precision=held('AltLeft')||held('AltRight'),boost=held('ShiftLeft')||held('ShiftRight');
  const speed=3*(precision?.2:boost?3:1),angular=precision?.35:1;
  const forward=held('KeyW')-held('KeyS'),right=held('KeyD')-held('KeyA');
  const up=Number(!!(held('KeyE')||held('KeyR')||held('PageUp')))-Number(!!(held('KeyQ')||held('KeyF')||held('PageDown')));
  const n=Math.hypot(forward,right,up)||1;
  return {forward:forward/n*speed*dt,right:right/n*speed*dt,up:up/n*speed*dt,
    yaw:(held('ArrowRight')-held('ArrowLeft'))*1.2*angular*dt,pitch:(held('ArrowUp')-held('ArrowDown'))*.9*angular*dt};
}
/** Turn the view at its current eye position, keeping a level horizon and a finite orbit target. */
export function rotateWorldView(camera:PerspectiveCamera,target:Vector3,yawDelta:number,pitchDelta:number){
  if(!yawDelta&&!pitchDelta)return;
  const distance=Math.min(320,Math.max(2,camera.position.distanceTo(target))),direction=camera.getWorldDirection(new Vector3());
  const yaw=Math.atan2(direction.x,-direction.z)+yawDelta;
  const pitch=Math.max(-Math.PI*.47,Math.min(Math.PI*.47,Math.asin(Math.max(-1,Math.min(1,direction.y)))+pitchDelta));
  direction.set(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch));
  target.copy(camera.position).addScaledVector(direction,distance);camera.up.set(0,1,0);camera.lookAt(target);
}
export function editableEvent(event: KeyboardEvent): boolean {
  if(event.isComposing || event.keyCode===229) return true;
  return event.composedPath().some(target => {
    const element=target as HTMLElement;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName??'') || element.isContentEditable || element.getAttribute?.('role')==='textbox';
  });
}

/** Recreate through the public API to discard latent drag/damping state.
 * Preserve the current camera pose and pivot across input release. */
export function createWorldOrbitControls(camera: PerspectiveCamera,canvas: HTMLCanvasElement,target: Vector3 | undefined,context:NavigationContext): OrbitControls {
  const position=camera.position.clone(),rotation=camera.quaternion.clone();
  const controls=new OrbitControls(camera,canvas);
  controls.enableDamping=true;controls.maxPolarAngle=context.mode==='follow'?Math.PI*.48:Math.PI*.99;controls.minDistance=2;controls.maxDistance=320;
  controls.enabled=!(context.mode==='manual'&&context.navigation==='free');controls.enablePan=context.mode!=='follow';
  // VF2 (Gene): your camera pans along the ground and zooms toward the point under the cursor; Follow keeps its Soul centred.
  controls.mouseButtons.RIGHT=null; // RMB is owned by look-in-place, never OrbitControls pan.
  controls.screenSpacePanning=false;controls.zoomToCursor=context.mode==='manual';
  // Follow keeps left-drag orbit and 2.4–40m zoom; RMB deliberately takes over to look in place.
  if(context.mode==='follow'){controls.minDistance=2.4;controls.maxDistance=40;}
  if(target){controls.target.copy(target);camera.position.copy(position);camera.quaternion.copy(rotation);}
  return controls;
}

/** Presentation-only scene navigation. No document movement keys/pointer lock,
 * actor references, simulation time, reservations or engine mutations. */
export class WorldNavigation {
  private keys=new Set<string>();
  private pointers=new Map<number,{x:number;y:number;type:string;look:boolean}>();
  private owned=false;
  private composing=false;
  private previousLifecycle='';
  private disposed=false;
  private releasing=false;
  private listeners: [EventTarget,string,EventListener,AddEventListenerOptions?][]=[];
  private canvas: HTMLCanvasElement;
  private camera: PerspectiveCamera;
  private target: () => Vector3;
  private context: () => NavigationContext;
  private onRelease: () => void;
  private onOwnership: (owned: boolean) => void;
  constructor(canvas: HTMLCanvasElement, camera: PerspectiveCamera,
    target: () => Vector3, context: () => NavigationContext, onRelease: () => void, onOwnership: (owned: boolean) => void = () => {}) {
    this.canvas=canvas; this.camera=camera; this.target=target; this.context=context; this.onRelease=onRelease; this.onOwnership=onOwnership;
    canvas.tabIndex=0;
    const listen=(surface:EventTarget,name:string,callback:(event:any)=>void,options?:AddEventListenerOptions)=>{
      surface.addEventListener(name,callback,options);this.listeners.push([surface,name,callback,options]);
    };
    listen(canvas,'focus',()=>{if(!this.disposed)this.setOwned(true);});
    listen(canvas,'blur',()=>this.release(false));
    listen(canvas,'compositionstart',()=>{this.composing=true;this.release(false);});
    listen(canvas,'compositionend',()=>{this.composing=false;});
    listen(canvas,'keydown',(event:KeyboardEvent)=>{
      if(this.composing || editableEvent(event))return;
      if(event.key==='Escape'){this.release();return;}
      if(!this.free() || event.ctrlKey || event.metaKey || !manualCameraKeys.has(event.code))return;
      event.preventDefault();this.keys.add(event.code);
    });
    listen(canvas,'keyup',(event:KeyboardEvent)=>{this.keys.delete(event.code);});
    listen(canvas,'pointerdown',(event:PointerEvent)=>{
      canvas.focus({preventScroll:true});this.setOwned(true);
      const free=this.context().mode==='manual'&&this.context().navigation==='free';
      const look=free&&(event.button===2||event.pointerType==='touch');
      this.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY,type:event.pointerType,look});
      if(look){canvas.setPointerCapture(event.pointerId);event.preventDefault();}
    });
    listen(canvas,'pointermove',(event:PointerEvent)=>{
      const p=this.pointers.get(event.pointerId);if(!p)return;
      const dx=event.clientX-p.x,dy=event.clientY-p.y;p.x=event.clientX;p.y=event.clientY;
      if(this.free()&&p.look&&this.pointers.size===1){this.look(dx,dy);event.preventDefault();}
      // Two fingers pan; wheel/trackpad dolly and explicit moveCamera cover zoom.
      else if(this.free()&&p.type==='touch'&&this.pointers.size===2){this.move({right:-dx*.01,up:dy*.01});event.preventDefault();}
    });
    const end=(event:PointerEvent)=>{const pointer=this.pointers.get(event.pointerId);this.pointers.delete(event.pointerId);if(pointer?.look&&canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);};
    listen(canvas,'pointerup',end);listen(canvas,'pointercancel',end);
    listen(canvas,'lostpointercapture',(event:PointerEvent)=>{this.pointers.delete(event.pointerId);});
    listen(canvas,'wheel',(event:WheelEvent)=>{
      if(!this.free()||event.ctrlKey||event.metaKey)return;
      event.preventDefault();this.move({forward:-event.deltaY*(event.deltaMode === 1 ? .12 : event.deltaMode === 2 ? 2 : .006)});
    },{passive:false});
    const window=canvas.ownerDocument.defaultView;
    if(window)listen(window,'blur',()=>this.release());
    listen(canvas.ownerDocument,'visibilitychange',()=>{if(canvas.ownerDocument.hidden)this.release();});
  }
  get inputOwned(){return this.owned;}
  private setOwned(value:boolean){if(this.owned===value)return;this.owned=value;this.onOwnership(value);}
  private free(){const c=this.context();return !this.disposed&&this.owned&&c.mode==='manual'&&c.navigation==='free';}
  sync(preserveFocus=false){const c=this.context(),key=`${c.mode}:${c.navigation}:${c.lifecycle}`,changed=!!this.previousLifecycle&&key!==this.previousLifecycle;if(changed)this.release(!preserveFocus);this.previousLifecycle=key;return changed;}
  release(blur=true){
    if(this.releasing)return;this.releasing=true;
    this.keys.clear();this.setOwned(false);
    for(const id of this.pointers.keys())if(this.canvas.hasPointerCapture(id))this.canvas.releasePointerCapture(id);
    this.pointers.clear();
    this.onRelease();
    if(blur && this.canvas.ownerDocument.activeElement===this.canvas)this.canvas.blur();
    this.releasing=false;
  }
  update(seconds:number){
    this.sync();if(!this.free()||!Number.isFinite(seconds))return;
    this.move(manualCameraStep(this.keys,seconds));
  }
  /** Bounded metre displacement for touch buttons; never acquires keyboard focus. */
  move(delta:CameraMove):boolean {
    const c=this.context();if(this.disposed||c.mode!=='manual'||c.navigation!=='free')return false;
    const bounded=(v:number|undefined)=>Number.isFinite(v)?Math.max(-2,Math.min(2,v!)):0;
    const forward=this.camera.getWorldDirection(new Vector3());forward.y=0;
    if(forward.lengthSq()<1e-8)forward.set(0,0,-1);else forward.normalize();
    const right=new Vector3().crossVectors(forward,new Vector3(0,1,0));
    const displacement=forward.multiplyScalar(bounded(delta.forward)).addScaledVector(right,bounded(delta.right));displacement.y=bounded(delta.up);
    this.camera.position.add(displacement);this.target().add(displacement);
    const turn=(v:number|undefined)=>Number.isFinite(v)?Math.max(-.5,Math.min(.5,v!)):0;
    if(turn(delta.yaw)||turn(delta.pitch))this.rotate(turn(delta.yaw),turn(delta.pitch));
    return true;
  }
  private look(dx:number,dy:number){this.rotate(dx*.004,-dy*.004);}
  /** Turn the view in place: yaw + turns right, pitch + tilts up. */
  private rotate(yawDelta:number,pitchDelta:number){
    rotateWorldView(this.camera,this.target(),yawDelta,pitchDelta);
  }
  dispose(){if(this.disposed)return;this.release();this.disposed=true;for(const [surface,name,callback,options] of this.listeners)surface.removeEventListener(name,callback,options);this.listeners=[];}
}
