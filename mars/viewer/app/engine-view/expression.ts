// Cosmetic, random-access motion. Canonical roots, hands and contacts remain inputs.
import { idPhase } from '../../engine/bodies/pose.ts';
import type { DepictionBeat } from './station-depiction.ts';
export type ExpressionHands = { left?: readonly number[]; right?: readonly number[] };
export type Expression = {
  kind: 'speaking' | 'planted-dance'; style: number; wave: number | null;
  drop: number; side: number; hipTwist: number; torsoYaw: number; lean: number; elbowLift: number;
  freeHands: [[number,number,number],[number,number,number]] | null; // forward, right, up
};
const clamp = (v:number,lo:number,hi:number) => Math.max(lo,Math.min(hi,v));
/** Existing grounded_dance palms differ by 0.30 * controller wave metres.
 * This follows the recorded controller gesture, including its blend; it does not
 * infer tempo, restart a clock, or implement the future G-003 Score beat cue. */
export function recordedDanceWave(hands:ExpressionHands):number|null {
  const left=hands.left?.[1],right=hands.right?.[1];
  return typeof left==='number'&&typeof right==='number'&&Number.isFinite(left)&&Number.isFinite(right)
    ? clamp((left-right)/.30,-1,1) : null;
}
export function expressionAt(id:string,activity:string,seconds:number,hands:ExpressionHands={},stationBeat:DepictionBeat|null=null):Expression|null {
  if(!Number.isFinite(seconds))return null;
  const style=Math.floor(idPhase(id,73)*0x100000000)%4,amount=.65+.35*idPhase(id,74),mirror=style%2?1:-1;
  if(activity==='dance'){
    const recorded=recordedDanceWave(hands);if(recorded===null)return null;
    // Only an already admitted planted dance gets shared-beat cosmetic motion.
    // Recorded palms remain the rig's authoritative hand targets.
    const wave=stationBeat&&Number.isFinite(stationBeat.beat)&&stationBeat.beat>=0&&stationBeat.beat<128
      ? Math.sin(Math.PI*stationBeat.beat):recorded;
    return {kind:'planted-dance',style,wave,
      drop:amount*(.018+.035*wave*wave),side:mirror*.025*wave,
      hipTwist:mirror*(.035+.012*style)*wave,
      torsoYaw:-mirror*(.04+.012*style)*wave,lean:.018*wave,
      elbowLift:(.16+.045*style)*(1-wave*wave),freeHands:null};
  }
  // Stationary speakers/presenters share this first layer. No guessed presenter
  // role or private speech content; constrained hands suppress speaking below.
  if(activity!=='talk'||hands.left||hands.right)return null;
  const phrase=seconds/2.8+idPhase(id,75)*6,index=Math.floor(phrase),u=phrase-index;
  // Rest between phrases; each target returns smoothly to the same neutral pose.
  const pulse=u<.82?Math.sin(Math.PI*u/.82)**2:0;
  const shape=((index+style)%4+4)%4;
  const hand=(left:boolean):[number,number,number]=>{
    const sign=left?-1:1,active=shape===2||shape===3||(shape===0?left:!left),k=active?pulse:0;
    return [.12+k*(shape===3?.26:.17),sign*(.19+k*(shape===2?.12:.05)),.98+k*(shape===3?.22:.34)];
  };
  return {kind:'speaking',style,wave:null,drop:0,side:0,hipTwist:0,
    torsoYaw:.09*Math.sin(seconds*.55+idPhase(id,76)*Math.PI*2),lean:.02*pulse,
    elbowLift:0,freeHands:[hand(true),hand(false)]};
}
