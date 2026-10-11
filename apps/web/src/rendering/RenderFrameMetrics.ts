/** Bounded callback/work observations, not presented frames or GPU time. */
export const MAX_RENDER_METRIC_SAMPLES=4096;
const valid=(n:number)=>Number.isFinite(n)&&n>=0;
function summary(values:number[]){if(!values.length)return null;values.sort((a,b)=>a-b);const at=(q:number)=>values[Math.max(0,Math.ceil(values.length*q)-1)];return {samples:values.length,mean:values.reduce((a,b)=>a+b,0)/values.length,p50:at(.5),p95:at(.95),p99:at(.99),max:values.at(-1)!};}
export class RenderFrameMetrics{
 private rows:{interval:number|null;frameCpu:number;submission:number|null}[]=[];
 private first:number|null=null;private last:number|null=null;private callbacks=0;private intervals=0;private over50=0;private over100=0;private cursor=0;
 reset(){this.rows=[];this.first=this.last=null;this.callbacks=this.intervals=this.over50=this.over100=this.cursor=0;}
 sample(at:number,frameCpu:number,submission:number|null){
  if(!valid(at)||!valid(frameCpu)||submission!==null&&!valid(submission))return;
  if(this.last!==null&&at<this.last)this.reset();
  const interval=this.last===null?null:at-this.last;this.first??=at;this.last=at;this.callbacks++;
  if(interval!==null){this.intervals++;if(interval>50)this.over50++;if(interval>100)this.over100++;}
  const row={interval,frameCpu,submission};if(this.rows.length<MAX_RENDER_METRIC_SAMPLES)this.rows.push(row);else{this.rows[this.cursor]=row;this.cursor=(this.cursor+1)%MAX_RENDER_METRIC_SAMPLES;}
 }
 snapshot(){const duration=this.first===null||this.last===null?0:this.last-this.first;return{contract:'render-callback-metrics/1',callbacks:this.callbacks,durationMs:duration,callbackRatePerSecond:duration>0?this.intervals*1000/duration:null,retainedCallbacks:this.rows.length,droppedCallbacks:Math.max(0,this.callbacks-this.rows.length),intervalMs:summary(this.rows.flatMap(r=>r.interval===null?[]:[r.interval])),frameCpuMs:summary(this.rows.map(r=>r.frameCpu)),submissionCpuMs:summary(this.rows.flatMap(r=>r.submission===null?[]:[r.submission])),stalls:{scope:'all callbacks since reset',over50ms:this.over50,over100ms:this.over100},quantilesScope:'retained callbacks; nearest rank',presentedFPS:null};}
}
