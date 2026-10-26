import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { WorldNavigation, createWorldOrbitControls, type NavigationContext } from '../src/WorldNavigation.ts';
import { WorldRtsCamera } from '../src/WorldRtsCamera.ts';

class Surface extends EventTarget {
  tagName='CANVAS'; isContentEditable=false; tabIndex=-1;
  captures=new Set<number>();
  style: Record<string,string>={}; clientHeight=600; clientWidth=800;
  getRootNode(){return this.ownerDocument;}
  getBoundingClientRect(){return {left:0,top:0,width:800,height:600};}
  ownerDocument: any;
  getAttribute(){return null;}
  focus(){this.ownerDocument.activeElement=this;this.dispatchEvent(new Event('focus'));}
  blur(){this.ownerDocument.activeElement=null;this.dispatchEvent(new Event('blur'));}
  setPointerCapture(id:number){this.captures.add(id);}
  hasPointerCapture(id:number){return this.captures.has(id);}
  releasePointerCapture(id:number){this.captures.delete(id);}
}
function fixture(){
  const window=new EventTarget(),doc=Object.assign(new EventTarget(),{activeElement:null as unknown,hidden:false,defaultView:window});
  const canvas=new Surface();canvas.ownerDocument=doc;
  const camera=new PerspectiveCamera(45,1,.1,600);camera.position.set(0,3,10);
  const target=new Vector3(0,1,0);camera.lookAt(target);
  const context:NavigationContext={mode:'manual',navigation:'free',lifecycle:'eden:epoch1:soul1:present:live'};
  let released=0;const ownership:boolean[]=[];
  const nav=new WorldNavigation(canvas as never,camera,()=>target,()=>context,()=>{released++;},owned=>ownership.push(owned));
  nav.sync();
  const event=(type:string,fields:Record<string,unknown>={},path?:unknown[])=>{
    const e=new Event(type,{cancelable:true});Object.assign(e,{code:'',key:'',pointerId:1,pointerType:'mouse',button:0,clientX:0,clientY:0,deltaY:0,deltaMode:0,...fields});
    if(path)Object.defineProperty(e,'composedPath',{value:()=>path});canvas.dispatchEvent(e);return e;
  };
  return {nav,camera,target,context,canvas,window,doc,event,ownership,released:()=>released};
}
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('WASD and Q/E move an explicitly focused scene at frame-independent speed; no keys outside scene ownership',()=>{
  const distance=(fps:number)=>{
    const f=fixture();try{
      const noFocus=f.event('keydown',{code:'KeyW'});assert.equal(noFocus.defaultPrevented,false);f.nav.update(1/fps);close(f.camera.position.z,10);
      f.canvas.focus();assert.equal(f.event('keydown',{code:'KeyW'}).defaultPrevented,true);
      for(let i=0;i<fps;i++)f.nav.update(1/fps);
      close(f.camera.position.z,7);close(f.target.z,-3);
      f.event('keyup',{code:'KeyW'});f.event('keydown',{code:'KeyE'});f.nav.update(.1);close(f.camera.position.y,3.3);
      return f.camera.position.z;
    }finally{f.nav.dispose();}
  };
  close(distance(30),distance(120));
});

test('editing, composition, modifier shortcuts and outside document keys remain untouched',()=>{
  const f=fixture();try{
    f.canvas.focus();
    for(const path of [[{tagName:'INPUT'}],[{tagName:'TEXTAREA'}],[{tagName:'SELECT'}],[{isContentEditable:true}],[{getAttribute:(key:string)=>key==='role'?'textbox':null}]]){
      assert.equal(f.event('keydown',{code:'KeyW'},path).defaultPrevented,false);
    }
    assert.equal(f.event('keydown',{code:'KeyW',isComposing:true}).defaultPrevented,false);
    assert.equal(f.event('keydown',{code:'KeyW',ctrlKey:true}).defaultPrevented,false);
    const outside=new Event('keydown',{cancelable:true});Object.assign(outside,{code:'KeyW'});f.doc.dispatchEvent(outside);assert.equal(outside.defaultPrevented,false);
    f.nav.update(.1);close(f.camera.position.z,10);
    f.event('keydown',{code:'KeyW'});f.event('compositionstart');f.nav.update(.1);close(f.camera.position.z,10);assert.equal(f.nav.inputOwned,false);
    f.event('compositionend');assert.equal(f.event('keydown',{code:'KeyW'}).defaultPrevented,false,'composition end never silently reacquires input');
  }finally{f.nav.dispose();}
});

for(const reason of ['Escape','blur','window blur','hidden','mode','world','selection loss'] as const){
  test(`${reason} clears held keys and pointer capture without a jump or retained navigation`,()=>{
    const f=fixture();try{
      f.canvas.focus();f.event('keydown',{code:'KeyW'});f.event('pointerdown',{button:2,pointerId:7});assert.equal(f.canvas.hasPointerCapture(7),true);
      if(reason==='Escape')f.event('keydown',{key:'Escape'});
      if(reason==='blur')f.canvas.blur();
      if(reason==='window blur')f.window.dispatchEvent(new Event('blur'));
      if(reason==='hidden'){f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));}
      if(reason==='mode')f.context.mode='broadcast';
      if(reason==='world')f.context.lifecycle='mars:epoch2:soul1:present:live';
      if(reason==='selection loss')f.context.lifecycle='eden:epoch1:soul1:absent:live';
      f.nav.update(.1);close(f.camera.position.z,10);assert.equal(f.nav.inputOwned,false);assert.equal(f.canvas.captures.size,0);
      f.context.mode='manual';f.nav.sync();f.canvas.focus();f.nav.update(.1);close(f.camera.position.z,10,'released keys never resume after focus');
    }finally{f.nav.dispose();}
  });
}

test('free look keeps a stable horizon and translates target; touch pan and bounded moves do not acquire keys',()=>{
  const f=fixture();try{
    const start=f.camera.position.toArray();
    f.event('pointerdown',{button:2,pointerId:1});f.event('pointermove',{pointerId:1,clientX:40,clientY:-20});
    assert.deepEqual(f.camera.position.toArray(),start);assert.ok(f.target.x!==0);assert.deepEqual(f.camera.up.toArray(),[0,1,0]);
    f.event('pointerup',{pointerId:1});f.nav.release();
    const offset=f.camera.position.clone().sub(f.target),rotation=f.camera.quaternion.toArray();
    assert.equal(f.nav.move({forward:100,right:NaN,up:Infinity}),true);assert.equal(f.nav.inputOwned,false);
    close(f.camera.position.clone().sub(f.target).distanceTo(offset),0);assert.deepEqual(f.camera.quaternion.toArray(),rotation);
    f.event('pointerdown',{pointerType:'touch',pointerId:1});f.event('pointerdown',{pointerType:'touch',pointerId:2});
    const before=f.camera.position.clone();f.event('pointermove',{pointerType:'touch',pointerId:2,clientX:10,clientY:10});
    assert.ok(f.camera.position.distanceTo(before)>0);close(f.camera.position.clone().sub(f.target).distanceTo(offset),0);
  }finally{f.nav.dispose();}
  const stopped=f.camera.position.toArray();f.canvas.focus();f.event('keydown',{code:'KeyW'});f.nav.update(.1);assert.deepEqual(f.camera.position.toArray(),stopped,'disposed listeners cannot move the camera');
});

test('Follow is immune to free movement, while optional touch moves and wheel require Manual free',()=>{
  const f=fixture();try{
    f.context.mode='follow';f.nav.sync();f.canvas.focus();const before=f.camera.position.toArray();
    assert.equal(f.event('keydown',{code:'KeyW'}).defaultPrevented,false);assert.equal(f.nav.move({forward:1}),false);
    assert.equal(f.event('wheel',{deltaY:100}).defaultPrevented,false);assert.deepEqual(f.camera.position.toArray(),before);
    f.context.mode='manual';f.context.navigation='orbit';f.nav.sync();f.canvas.focus();assert.equal(f.nav.move({up:1}),false);
    f.context.navigation='free';f.nav.sync();f.canvas.focus();assert.equal(f.event('wheel',{deltaY:-100}).defaultPrevented,true);assert.ok(f.camera.position.z<10);
    const after=f.camera.position.toArray();assert.equal(f.event('wheel',{deltaY:100,ctrlKey:true}).defaultPrevented,false);assert.deepEqual(f.camera.position.toArray(),after);
  }finally{f.nav.dispose();}
});


test('actual OrbitControls release discards a held drag and damping while preserving pose and pivot',()=>{
  const f=fixture();f.nav.dispose();f.context.navigation='orbit';
  let controls=createWorldOrbitControls(f.camera,f.canvas as never,f.target,f.context);
  let disposed=false;
  const nav=new WorldNavigation(f.canvas as never,f.camera,()=>controls.target,()=>f.context,()=>{
    if(disposed)return;
    const target=controls.target.clone();controls.dispose();
    controls=createWorldOrbitControls(f.camera,f.canvas as never,target,f.context);
  });
  const docPointer=(x:number)=>{
    const e=new Event('pointermove',{cancelable:true});Object.assign(e,{pointerId:8,pointerType:'mouse',clientX:x,clientY:100,button:0});f.doc.dispatchEvent(e);
  };
  try{
    nav.sync();f.event('pointerdown',{pointerId:8,clientX:100,clientY:100});docPointer(150);
    const position=f.camera.position.toArray(),rotation=f.camera.quaternion.toArray(),target=controls.target.toArray();
    assert.notDeepEqual(position,[0,3,10],'real orbit drag changes camera');
    nav.release();assert.equal(f.canvas.captures.size,0);assert.equal(nav.inputOwned,false);
    assert.deepEqual(f.camera.position.toArray(),position);assert.deepEqual(f.camera.quaternion.toArray(),rotation);assert.deepEqual(controls.target.toArray(),target);
    docPointer(300);for(let i=0;i<20;i++)controls.update();
    close(f.camera.position.distanceTo(new Vector3().fromArray(position)),0);close(controls.target.distanceTo(new Vector3().fromArray(target)),0);
    f.context.mode='follow';nav.sync();assert.equal(controls.enablePan,false);assert.equal(controls.enabled,true);
    f.context.mode='manual';f.context.navigation='free';nav.sync();assert.equal(controls.enabled,false);
    f.canvas.focus();f.event('keydown',{code:'KeyW'});nav.update(.1);assert.ok(f.camera.position.distanceTo(new Vector3().fromArray(position))>.2);
  }finally{disposed=true;nav.dispose();controls.dispose();}
});


for(const ending of ['pointerup','pointercancel','lostpointercapture'] as const){
 test(`first Broadcast orbit drag continues through takeover and resets on ${ending}`,()=>{
  const f=fixture();f.nav.dispose();f.context.mode='broadcast';f.context.navigation='orbit';
  let controls=createWorldOrbitControls(f.camera,f.canvas as never,f.target,f.context),releases=0;
  const nav=new WorldNavigation(f.canvas as never,f.camera,()=>controls.target,()=>f.context,()=>{
    releases++;const target=controls.target.clone();controls.dispose();controls=createWorldOrbitControls(f.camera,f.canvas as never,target,f.context);
  });
  const move=(x:number)=>{const e=new Event('pointermove',{cancelable:true});Object.assign(e,{pointerId:8,pointerType:'mouse',clientX:x,clientY:100,button:0});f.doc.dispatchEvent(e);};
  try{
   nav.sync();f.event('pointerdown',{pointerId:8,clientX:100,clientY:100});move(110);
   const first=f.camera.position.clone();assert.equal(f.canvas.hasPointerCapture(8),true);
   f.context.mode='manual';assert.equal(nav.sync(),true,'handover is acknowledged even while release is deferred');
   nav.update(.016);assert.equal(releases,0);assert.equal(nav.inputOwned,true);assert.equal(f.canvas.hasPointerCapture(8),true);
   move(250);assert.ok(f.camera.position.distanceTo(first)>.1,'the same held drag must keep orbiting after its first movement');
   const stopped=f.camera.position.clone();if(ending==='lostpointercapture')f.canvas.releasePointerCapture(8);f.event(ending,{pointerId:8});assert.equal(releases,1);assert.equal(nav.inputOwned,false);
   assert.equal(f.canvas.hasPointerCapture(8),false);assert.equal(controls.zoomToCursor,true,'deferred recreation installs Manual settings');
   move(350);for(let i=0;i<20;i++)controls.update();close(f.camera.position.distanceTo(stopped),0);
  }finally{nav.dispose();controls.dispose();}
 });
}

for(const boundary of ['lifecycle','follow','free','blur'] as const){
 test(`${boundary} still immediately releases an active Broadcast orbit handover`,()=>{
  const f=fixture();try{
   f.context.mode='broadcast';f.context.navigation='orbit';f.nav.sync();f.event('pointerdown',{pointerId:8});
   f.context.mode='manual';f.nav.sync();const before=f.released();assert.equal(f.nav.inputOwned,true);
   if(boundary==='lifecycle')f.context.lifecycle='mars:epoch2:soul1:present:live';
   if(boundary==='follow')f.context.mode='follow';
   if(boundary==='free')f.context.navigation='free';
   if(boundary==='blur')f.canvas.blur();else f.nav.sync();
   assert.equal(f.released(),before+1);assert.equal(f.nav.inputOwned,false);
   f.event('pointerup',{pointerId:8});assert.equal(f.released(),before+1,'cancelled deferred release does not run again');
  }finally{f.nav.dispose();}
 });
}

test('a lifecycle change during Broadcast to Manual never defers release',()=>{
 const f=fixture();try{
  f.context.mode='broadcast';f.context.navigation='orbit';f.nav.sync();f.event('pointerdown');const before=f.released();
  f.context.mode='manual';f.context.lifecycle='mars:epoch2:soul1:present:live';assert.equal(f.nav.sync(),true);
  assert.equal(f.released(),before+1);assert.equal(f.nav.inputOwned,false);
 }finally{f.nav.dispose();}
});

test('actual OrbitControls accepts head tilt and a Follow handover without applying old drag/damping',()=>{
 const f=fixture();f.nav.dispose();Object.assign(f.doc,{querySelector:()=>null});f.context.mode='follow';f.context.navigation='orbit';
 let controls=createWorldOrbitControls(f.camera,f.canvas as never,f.target,f.context);
 const rts=new WorldRtsCamera(f.canvas as never,f.camera,{controls:()=>controls,mode:()=>f.context.mode,
  takeOver:()=>{const target=controls.target.clone();f.context.mode='manual';controls.dispose();controls=createWorldOrbitControls(f.camera,f.canvas as never,target,f.context);},scene:()=>null as never,pickRoots:()=>[]});
 const key=(type:string,code:string)=>{const e=new Event(type,{cancelable:true});Object.assign(e,{code,key:code});f.window.dispatchEvent(e);};
 try{
  f.canvas.focus();const p=f.camera.position.clone(),direction=f.camera.getWorldDirection(new Vector3());
  key('keydown','KeyW');rts.update(.1);controls.update();key('keyup','KeyW');
  const horizontal=direction.clone();horizontal.y=0;horizontal.normalize();
  assert.ok(f.camera.position.distanceTo(p.clone().addScaledVector(horizontal,.3))<1e-8);
  assert.ok(f.camera.getWorldDirection(new Vector3()).distanceTo(direction)<1e-8);assert.equal(controls.mouseButtons.RIGHT,null);
  const eye=f.camera.position.clone();key('keydown','ArrowUp');for(let i=0;i<20;i++){rts.update(.05);controls.update();rts.afterControls();}key('keyup','ArrowUp');
  assert.ok(f.camera.position.distanceTo(eye)<1e-8,'head pitch stays at the eye even after actual OrbitControls update');assert.ok(f.camera.getWorldDirection(new Vector3()).y>.5);
  key('keydown','KeyW');f.canvas.blur();rts.update(.1);assert.ok(f.camera.position.distanceTo(eye)<1e-8,'blur releases global RTS movement');
 }finally{rts.dispose();controls.dispose();}
});
