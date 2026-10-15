/** Distance-locked fallback for humanoids whose GLB has only Idle/Walk.
 * Cosmetic targets only: the native controller owns the body root. */
export function runningGaitAt(distance:number,speed:number) {
  const sprint=Math.max(0,Math.min(1,(speed-2.5)/1.5)),stride=1.3+sprint*.5;
  const phase=Math.max(0,distance)/stride*Math.PI*2;
  const legs=([0,Math.PI] as const).map(offset=>{
    const p=phase+offset;
    return {forward:Math.cos(p)*(.25+.1*sprint),up:Math.max(0,Math.sin(p))*(.16+.09*sprint)};
  });
  const hands=([Math.PI,0] as const).map(offset=>({forward:.18+Math.cos(phase+offset)*.17,up:-.19+Math.sin(phase+offset)*.06}));
  return {legs,hands,lean:.1+.08*sprint,bob:.025*Math.abs(Math.sin(phase))};
}
