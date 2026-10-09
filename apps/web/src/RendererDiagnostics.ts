import type * as THREE from 'three';
/** Opt-in local diagnostics. CPU submission time is not GPU time or a heap-leak measurement. */
export class RendererDiagnostics{
 private output:HTMLOutputElement|null=null;private started=0;private frames=0;private cpu=0;
 constructor(host:HTMLElement){if(typeof location==='undefined'||!['localhost','127.0.0.1','[::1]'].includes(location.hostname)||new URLSearchParams(location.search).get('renderStats')!=='1')return;this.output=document.createElement('output');this.output.className='renderer-diagnostics';this.output.setAttribute('aria-label','Renderer diagnostics');host.append(this.output);}
 get enabled(){return this.output!==null;}
 sample(renderer:THREE.WebGLRenderer,now:number,cpuMs:number,videos:readonly{playing:boolean;currentTime:number;readyState:number}[]=[]){
  if(!this.output)return;if(document.visibilityState==='hidden'){this.started=0;this.frames=0;this.cpu=0;return;}if(!this.started)this.started=now;this.frames++;this.cpu+=cpuMs;const elapsed=now-this.started;if(elapsed<1000)return;
  const stats={fps:Math.round(this.frames*10000/elapsed)/10,frameIntervalMs:Math.round(elapsed/this.frames*10)/10,cpuSubmissionMs:Math.round(this.cpu/this.frames*10)/10,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,programs:renderer.info.programs?.length??0,videoFrames:videos};
  this.output.value=`${stats.fps} FPS · ${stats.frameIntervalMs}ms frame · ${stats.cpuSubmissionMs}ms CPU\n${stats.calls} draws · ${stats.triangles.toLocaleString()} triangles\n${stats.geometries} geometries · ${stats.textures} textures · ${stats.programs} programs`;this.output.dataset.rendererStats=JSON.stringify(stats);this.started=now;this.frames=0;this.cpu=0;
 }
 dispose(){this.output?.remove();this.output=null;}
}
