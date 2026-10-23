/** Explore place shots render the live world offscreen on the main thread. 3.74 ran them back to back (setTimeout 0) right
 * while the visitor typed and clicked in Explore, and on live /w/eden/ the cold first context starved the page for seconds
 * (rolled back). Every shot step now waits its turn here: never within QUIET ms of the visitor's last pointer/key/wheel
 * input, at least GAP ms after the previous step ended, and only once the browser reports idle time. */
export interface PacerClock{now():number;wait(ms:number):Promise<void>;idle():Promise<void>;}
export const SHOT_INPUT_QUIET_MS=800,SHOT_STEP_GAP_MS=120;
export class ShotPacer{
 private lastInput=-Infinity;private lastStep=-Infinity;private readonly clock:PacerClock;private readonly quiet:number;private readonly gap:number;
 constructor(clock:PacerClock=browserClock(),quiet=SHOT_INPUT_QUIET_MS,gap=SHOT_STEP_GAP_MS){this.clock=clock;this.quiet=quiet;this.gap=gap;}
 /** The visitor did something: no shot step for the next `quiet` ms. */
 input(){this.lastInput=this.clock.now();}
 /** Resolves when one step may run now (false when `alive` turned false while waiting); call `done()` after the step. */
 async turn(alive:()=>boolean=()=>true):Promise<boolean>{
  for(;;){
   if(!alive())return false;
   const now=this.clock.now(),wait=Math.max(this.lastInput+this.quiet-now,this.lastStep+this.gap-now);
   if(wait>0){await this.clock.wait(wait);continue;}
   await this.clock.idle();
   if(!alive())return false;
   if(this.clock.now()-this.lastInput<this.quiet)continue;  // input arrived while waiting for idle
   return true;
  }
 }
 done(){this.lastStep=this.clock.now();}
 /** Listen for the visitor's input on `target` (capture, passive); returns the remover. */
 listen(target:Pick<EventTarget,'addEventListener'|'removeEventListener'>){
  const on=()=>this.input(),kinds=['pointerdown','pointermove','keydown','wheel','touchstart'],options={capture:true,passive:true};
  for(const kind of kinds)target.addEventListener(kind,on,options);
  return ()=>{for(const kind of kinds)target.removeEventListener(kind,on,options);};
 }
}
export function browserClock():PacerClock{
 return{now:()=>performance.now(),wait:ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  idle:()=>new Promise<void>(resolve=>{const ric=(globalThis as {requestIdleCallback?:(cb:()=>void,o?:{timeout:number})=>number}).requestIdleCallback;if(ric)ric(()=>resolve(),{timeout:1000});else setTimeout(resolve,50);})};
}
