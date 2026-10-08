// Cosmetic water poses over recorded native support; no root or contact displacement.
import type {ShoreContactV1} from '../../../../packages/engine-contract/src/shore.ts';
import {idPhase} from '../../engine/bodies/pose.ts';
export type WaterMotion={kind:'surface-swim'|'upright-swim'|'tread';phase:number;bodyPitch:number;hipUp:number;hands:[[number,number,number],[number,number,number]];feet:[[number,number,number],[number,number,number]];floating:boolean};
/** All offsets are forward/right/up metres, take time only. Bed-supported swimming
 * keeps the existing feet; buoyant phases get gentle alternating kicks. No depth
 * threshold reclassification, native horizontal locomotion, buoyancy or water physics. */
export function waterMotionAt(id:string,activity:string,seconds:number,contact:ShoreContactV1|undefined):WaterMotion|null {
 if(!contact||!Number.isFinite(seconds)||(activity!=='swim'&&activity!=='tread'))return null;
 const phase=seconds*Math.PI*2*(activity==='swim'?.75:.58)+idPhase(id,81)*Math.PI*2;
 const wave=Math.sin(phase),cos=Math.cos(phase),swimming=activity==='swim',floating=contact.mode==='buoyant';
 const surface=swimming&&floating;
 // Keep the surface paddle forward of the shoulders: deeply folded targets
 // make the existing minimum-swing arm solver change twist abruptly.
 const hands:[number,number,number][]=[-1,1].map(sign=>surface?[.74+.12*cos,sign*(.29+.09*wave),contact.submergedHeightMetres-.09+.04*Math.sin(phase+.5)]:[.14+(swimming?.085:.045)*cos,sign*(.21+.035*wave),1.06+.045*Math.sin(phase+.5)]);
 const feet:[number,number,number][]=[-1,1].map(sign=>floating?[sign*(surface?.012:.055)*wave,sign*.012*cos,(surface?0:.065)+(surface?.018:.025)*Math.sin(phase+sign*Math.PI/2)]:[0,0,0]);
 return {kind:surface?'surface-swim':swimming?'upright-swim':'tread',phase,bodyPitch:surface?Math.PI*.39:0,hipUp:surface?contact.submergedHeightMetres-.15:0,hands:hands as WaterMotion['hands'],feet:feet as WaterMotion['feet'],floating};
}
