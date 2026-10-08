import {Builder,rng,pick} from './kit.ts';
import {house,lampPost,footprint} from './buildings.ts';
import type {Terrain} from './terrain.ts';
import type {Trees} from './trees.ts';
/** Alpine shoulder north of the campus: a cable car from a valley station by the north road up to a
 * mountain station with a chalet restaurant, and a cluster of wooden chalets on the slope below. */
export const ALPINE_BOUNDS=[-60,-330,40,-176] as const;
const VALLEY={x:-4,z:-196},TOP={x:6,z:-312};
export function alpinePads(t:Terrain){t.pad(VALLEY.x-6,VALLEY.z-5,VALLEY.x+6,VALLEY.z+5,undefined,4);t.pad(TOP.x-10,TOP.z-8,TOP.x+10,TOP.z+8,undefined,6);
 for(const [x,z] of CHALETS)t.pad(x-5,z-4.5,x+5,z+4.5,undefined,4);}
const CHALETS:[number,number][]=[[-40,-236],[-28,-246],[-46,-252],[-20,-232],[-34,-262],[20,-238],[30,-250]];
export function buildAlpine(b:Builder,t:Terrain,trees:Trees){const r=rng(9901),G=(x:number,z:number)=>t.height(x,z);
 const station=(x:number,z:number,w:number,d:number,c:string)=>{const y=G(x,z);b.push(x,y,z,0);footprint(b,w,d,'cable-station');b.box('stone',0,-2,0,w+.3,2.4,d+.3,'#8f877a');b.box('timber',0,.4,0,w,4,d,c);b.box('glass',0,1.6,d/2+.03,w*.7,1.6,.04,'#3b4a52');
  b.box('metal',0,4.4,0,w+1.4,.4,d+1.4,'#5a5f66');b.box('metal',0,4.8,-d/2+.6,2.4,1.2,1,'#3a3a3a');b.pop();return y+5.4;};
 const y0=station(VALLEY.x,VALLEY.z,7,6,'#8a5a36'),y1=station(TOP.x,TOP.z,8,7,'#6e4a30');
 // two cables with pylons and two gondolas
 const pts:[number,number,number][]=[];const N=6;for(let i=0;i<=N;i++){const u=i/N,x=VALLEY.x+(TOP.x-VALLEY.x)*u,z=VALLEY.z+(TOP.z-VALLEY.z)*u;pts.push([x,Math.max(y0+(y1-y0)*u,G(x,z)+10),z]);}
 for(let i=1;i<N;i++){const [x,y,z]=pts[i];b.box('metal',x,G(x,z),z,.6,y-G(x,z)+.4,.6,'#7a8288');b.box('metal',x,y+.3,z,4.2,.3,.4,'#7a8288');}
 for(const off of [-1.8,1.8])for(let i=1;i<pts.length;i++){const [ax,ay,az]=pts[i-1],[bx,by,bz]=pts[i];b.quad('dressing',[ax+off,ay,az],[bx+off,by,bz],[bx+off,by+.08,bz],[ax+off,ay+.08,az],'#2a2a2a');}
 for(const [u,off,c] of [[.35,-1.8,'#c43a2a'],[.7,1.8,'#f0c040']] as [number,number,string][]){const k=u*N,i=Math.floor(k),f=k-i,[ax,ay,az]=pts[i],[bx,by,bz]=pts[i+1],x=ax+(bx-ax)*f+off,y=ay+(by-ay)*f,z=az+(bz-az)*f;
  b.box('metal',x,y-1.4,z,.08,1.4,.08,'#3a3a3a');b.box('metal',x,y-3.4,z,1.8,2,2.2,c);b.box('glass',x,y-2.6,z,1.82,.8,2.0,'#3b4a52');b.box('roof',x,y-1.45,z,1.9,.12,2.3,'#3a3a3a');}
 // chalet restaurant at the top with a sun terrace
 {const y=G(TOP.x+0,TOP.z+10);b.push(TOP.x,y,TOP.z+10,Math.PI);house(b,{w:12,d:8,floors:2,wall:'timber',wallC:'#7a4a2a',roof:'gable',roofH:3.4,roofC:'#4a4440',balcony:true,flowerbox:true,shutters:true,trim:'#f3eee2',plinth:3},r);b.pop();
  for(let i=0;i<4;i++){const x=TOP.x-6+i*4,z=TOP.z+18;b.box('timber',x,G(x,z)+.72,z,1.6,.06,.8,'#8a5a36');b.cyl('metal',x,G(x,z)+.78,z,.03,1.4,4,'#ddd',false);b.cone('cloth',x,G(x,z)+2.1,z,1.2,.4,8,i%2?'#c43a2a':'#f3eee2');}}
 // chalets with deep eaves, balconies, stacked firewood
 CHALETS.forEach(([x,z],i)=>{const rr=rng(9950+i),y=G(x,z);b.push(x,y,z,Math.PI+(rr()-.5)*.3);house(b,{w:8,d:7,floors:2,fh:2.8,wall:'timber',wallC:pick(rr,['#7a4a2a','#8a5a36','#6e4a30']),roof:'gable',roofH:3,roofC:pick(rr,['#4a4440','#3f4448','#5d4a3f']),balcony:true,flowerbox:true,shutters:rr()<.7,trim:pick(rr,['#f3eee2','#2f4f3f','#7a2f2a']),chimney:true,plinth:3},rr);
  for(let k=0;k<6;k++)b.cyl('bark',-4.6,-.1+Math.floor(k/3)*.4,-1+(k%3)*.4,.18,.4,6,'#7a5a3a');b.pop();});
 t.ribbon(b,[[-12,-128],[-12,-160],[-6,-188],[VALLEY.x,VALLEY.z+3]],3,'#a39a86','path',.12,1.5);
 t.ribbon(b,[[VALLEY.x-6,VALLEY.z-4],[-20,-228],[-34,-244],[-40,-258]],2.4,'#b6a582','path',.15,1.5);
 b.push(VALLEY.x+5,G(VALLEY.x+5,VALLEY.z+4),VALLEY.z+4,0);lampPost(b,3.4,'#3a3f42');b.pop();
 for(let i=0;i<40;i++){const x=-60+r()*100,z=-330+r()*150;if(CHALETS.some(([cx,cz])=>Math.hypot(cx-x,cz-z)<9)||Math.abs(x-(VALLEY.x+(TOP.x-VALLEY.x)*((z-VALLEY.z)/(TOP.z-VALLEY.z))))<6||Math.hypot(x-TOP.x,z-TOP.z)<16)continue;
  trees.add(x,G(x,z),z,1.1+r()*.5,'conifer',pick(r,['#3f6a3c','#365e38','#4a7a44']),r()*6);}
}
