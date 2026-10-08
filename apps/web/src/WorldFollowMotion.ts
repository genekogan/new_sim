export type FollowPoint=readonly[number,number,number];
export type FollowResponse={positionSeconds:number;aimSeconds:number};
export const DEFAULT_FOLLOW_RESPONSE:Readonly<FollowResponse>=Object.freeze({positionSeconds:1.1,aimSeconds:.45});  // VF4: calmer than .7/.25
const valid=(p:FollowPoint)=>p.length===3&&p.every(v=>Number.isFinite(v)&&Math.abs(v)<=1e6);
const sub=(a:FollowPoint,b:FollowPoint):[number,number,number]=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
/** Exact exponential response to a linearly sampled goal over this frame.
 * Separate anchors avoid translating the camera with every aim adjustment. */
function damp(value:FollowPoint,previous:FollowPoint,next:FollowPoint,dt:number,tau:number):[number,number,number]{
 if(dt===0)return [...value];
 const weight=-Math.expm1(-dt/tau),ramp=1-tau*weight/dt;
 return value.map((v,i)=>v+(previous[i]-v)*weight+(next[i]-previous[i])*ramp) as [number,number,number];
}
export class WorldFollowMotion{
 private position:[number,number,number]|null=null;
 private aim:[number,number,number]|null=null;
 private previousPosition:FollowPoint|null=null;
 private previousAim:FollowPoint|null=null;
 private response:FollowResponse;
 constructor(response:FollowResponse=DEFAULT_FOLLOW_RESPONSE){
  if(![response.positionSeconds,response.aimSeconds].every(v=>Number.isFinite(v)&&v>=.05&&v<=5))throw Error('Follow response must be between .05 and 5 seconds');
  this.response={...response};
 }
 reset(position?:FollowPoint,aim:FollowPoint|undefined=position){
  if(position&&aim&&valid(position)&&valid(aim)){
   this.position=[...position];this.aim=[...aim];this.previousPosition=[...position];this.previousAim=[...aim];
  }else this.position=this.aim=this.previousPosition=this.previousAim=null;
 }
 sample(positionGoal:FollowPoint,aimGoal:FollowPoint,seconds:number){
  if(!valid(positionGoal)||!valid(aimGoal)||!Number.isFinite(seconds)||seconds<0)return null;
  if(!this.position||!this.aim)this.reset(positionGoal,aimGoal);
  const oldPosition=this.position!,oldAim=this.aim!,dt=Math.min(.1,seconds);
  if(dt>0){
   this.position=damp(oldPosition,this.previousPosition!,positionGoal,dt,this.response.positionSeconds);
   this.aim=damp(oldAim,this.previousAim!,aimGoal,dt,this.response.aimSeconds);
   this.previousPosition=[...positionGoal];this.previousAim=[...aimGoal];
  }
  const translation=sub(this.position!,oldPosition),aimTranslation=sub(this.aim!,oldAim);
  return {position:[...this.position!] as [number,number,number],aim:[...this.aim!] as [number,number,number],translation,offsetTranslation:sub(translation,aimTranslation)};
 }
}
