/** Bounded asynchronous render timer. Excludes DOM/compositor; disjoint queries refuse. */
export type GpuTimerExtension={TIME_ELAPSED_EXT:number;GPU_DISJOINT_EXT:number};
export type GpuTimerContext=Pick<WebGL2RenderingContext,'getExtension'|'getParameter'|'getQuery'|'createQuery'|'beginQuery'|'endQuery'|'getQueryParameter'|'deleteQuery'|'isContextLost'|'CURRENT_QUERY'|'QUERY_RESULT_AVAILABLE'|'QUERY_RESULT'>;
export class WebGLGpuTimer{
 private gl:GpuTimerContext;private ext:GpuTimerExtension|null;private pending:WebGLQuery[]=[];private active:WebGLQuery|null=null;private closed=false;private frames=0;private values:number[]=[];private discarded=0;
 readonly maximumPending=3;
 constructor(gl:GpuTimerContext,enabled:boolean){this.gl=gl;this.ext=enabled?gl.getExtension('EXT_disjoint_timer_query_webgl2') as GpuTimerExtension|null:null;}
 begin(){if(this.closed||!this.ext||this.gl.isContextLost())return;this.poll();if(this.frames++%8!==0||this.pending.length>=this.maximumPending||this.active||this.gl.getQuery(this.ext.TIME_ELAPSED_EXT,this.gl.CURRENT_QUERY))return;const query=this.gl.createQuery();if(!query)return;this.active=query;this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT,query);}
 end(){if(!this.active||!this.ext)return;const query=this.active;this.active=null;if(!this.gl.isContextLost())this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);this.pending.push(query);}
 private poll(){if(!this.ext)return;if(this.gl.getParameter(this.ext.GPU_DISJOINT_EXT)){this.discarded+=this.pending.length;for(const query of this.pending)this.gl.deleteQuery(query);this.pending=[];return;}this.pending=this.pending.filter(query=>{if(!this.gl.getQueryParameter(query,this.gl.QUERY_RESULT_AVAILABLE))return true;const ns:unknown=this.gl.getQueryParameter(query,this.gl.QUERY_RESULT);if(typeof ns==='number'&&Number.isFinite(ns)&&ns>=0){this.values.push(ns/1e6);if(this.values.length>512)this.values.shift();}else this.discarded++;this.gl.deleteQuery(query);return false;});}
 snapshot(){const values=[...this.values].sort((a,b)=>a-b);return{status:this.gl.isContextLost()?'context-lost':this.ext?'available-sampled':'unavailable-or-disabled',sampleEveryRenderedCallbacks:8,retainedSamples:values.length,pending:this.pending.length,discarded:this.discarded,renderGpuMs:values.length?{p50:values[Math.ceil(values.length*.5)-1],p95:values[Math.ceil(values.length*.95)-1],max:values.at(-1)!}:null,scope:'renderer render only; not display/compositor or whole GPU'};}
 reset(){this.end();for(const query of this.pending)this.gl.deleteQuery(query);this.pending=[];this.values=[];this.discarded=0;this.frames=0;}
 dispose(){if(this.closed)return;this.closed=true;this.reset();}
}
