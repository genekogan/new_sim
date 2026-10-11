import type * as THREE from 'three';
/** Local diagnostics only. Delegates the original renderer-instance method and
 * measures counter deltas; never changes caster flags or shadow scheduling. */
export class RenderShadowMeter{
 private renderer:THREE.WebGLRenderer;private original:THREE.WebGLRenderer['shadowMap']['render'];private wrapped:THREE.WebGLRenderer['shadowMap']['render'];private calls=0;private triangles=0;private cpu=0;private invocations=0;private lastCalls=0;private lastTriangles=0;
 constructor(renderer:THREE.WebGLRenderer){this.renderer=renderer;const map=renderer.shadowMap,original=this.original=map.render,owner=this;
  this.wrapped=function(...args){const beforeCalls=renderer.info.render.calls,beforeTriangles=renderer.info.render.triangles,start=performance.now();try{return original.apply(this,args);}finally{owner.lastCalls=Math.max(0,renderer.info.render.calls-beforeCalls);owner.lastTriangles=Math.max(0,renderer.info.render.triangles-beforeTriangles);owner.calls+=owner.lastCalls;owner.triangles+=owner.lastTriangles;owner.cpu+=performance.now()-start;owner.invocations++;}};map.render=this.wrapped;
 }
 reset(){this.calls=this.triangles=this.cpu=this.invocations=this.lastCalls=this.lastTriangles=0;}
 snapshot(){return {callsInCallback:this.calls,trianglesInCallback:this.triangles,cpuMsInCallback:this.cpu,invocationsInCallback:this.invocations,callsLastRender:this.lastCalls,trianglesLastRender:this.lastTriangles};}
 dispose(){if(this.renderer.shadowMap.render===this.wrapped)this.renderer.shadowMap.render=this.original;}
}
