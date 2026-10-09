/** Exact world-space authored wall/guard prisms. Yaw uses the native XZ OBB
 * convention: x'=cos*x-sin*z, z'=sin*x+cos*z. No floor/access grant. */
export type AuthoredBoundaryBox={id:string;buildingId:string;kind:'wall'|'guard';c:[number,number,number];half:[number,number,number];yaw:number;collision?:'solid'|'decorative'};
export function validAuthoredBoundary(b:AuthoredBoundaryBox){return !!b&&typeof b.id==='string'&&b.id.length>0&&b.id.length<=200&&typeof b.buildingId==='string'&&b.buildingId.length>0&&b.buildingId.length<=150&&['wall','guard'].includes(b.kind)&&Array.isArray(b.c)&&b.c.length===3&&b.c.every(v=>Number.isFinite(v)&&Math.abs(v)<=10000)&&Array.isArray(b.half)&&b.half.length===3&&b.half.every(v=>Number.isFinite(v)&&v>0&&v<=1000)&&Number.isFinite(b.yaw);}
/** Same finite swept prism for a camera eye or a body centre. The asymmetric Y
 * extent lets callers describe an eye with feet below it. Starts inside may
 * leave through their nearest face; they cannot cross the opposite boundary. */
export function authoredBoundarySweepFraction(boxes:readonly AuthoredBoundaryBox[],from:readonly number[],to:readonly number[],radius:number,below=0,above=0){
 if(from.length!==3||to.length!==3||![...from,...to,radius,below,above].every(Number.isFinite)||radius<0||below<0||above<0)return 0;let fraction=1;
 for(const b of boxes){if(!validAuthoredBoundary(b)||b.collision==='decorative')continue;const cs=Math.cos(b.yaw),sn=Math.sin(b.yaw);
  const local=(p:readonly number[])=>{const x=p[0]-b.c[0],z=p[2]-b.c[2];return[x*cs+z*sn,p[1]-b.c[1],-x*sn+z*cs];},a=local(from),z=local(to);
  const lo=[-b.half[0]-radius,-b.half[1]-above,-b.half[2]-radius],hi=[b.half[0]+radius,b.half[1]+below,b.half[2]+radius];
  let enter=0,leave=1,hit=true;const inside=a.every((v,i)=>v>lo[i]&&v<hi[i]);
  if(inside){let nearest=Infinity,axis=0,sign=0;for(let i=0;i<3;i++)for(const direction of[-1,1]){const distance=direction<0?a[i]-lo[i]:hi[i]-a[i];if(distance<nearest){nearest=distance;axis=i;sign=direction;}}
   // Inspect the first exit of the entire movement ray, not merely the sign
   // of one component: a tiny drift toward +X cannot permit a -Z escape.
   let firstExit=Infinity,exitAxis=-1,exitSign=0;for(let i=0;i<3;i++){const d=z[i]-a[i];if(Math.abs(d)<1e-12)continue;const direction=d>0?1:-1,t=((direction>0?hi[i]:lo[i])-a[i])/d;if(t<firstExit){firstExit=t;exitAxis=i;exitSign=direction;}}
   if(exitAxis===axis&&exitSign===sign)continue;fraction=0;continue;
  }
  for(let i=0;i<3;i++){const d=z[i]-a[i];if(Math.abs(d)<1e-12){if(a[i]<=lo[i]+1e-10||a[i]>=hi[i]-1e-10){hit=false;break;}continue;}const p=(lo[i]-a[i])/d,q=(hi[i]-a[i])/d;enter=Math.max(enter,Math.min(p,q));leave=Math.min(leave,Math.max(p,q));if(enter>=leave){hit=false;break;}}
  if(hit&&enter>=0&&enter<=1)fraction=Math.min(fraction,Math.max(0,enter-1e-7));
 }return fraction;
}
