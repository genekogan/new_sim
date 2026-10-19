import * as THREE from 'three';
/** Small generated, tiling, mipmapped surface patterns (no image assets, no downloads).
 * patternsA RGBA = running-bond brick | Flemish-bond brick | ashlar stone | clapboard siding
 * patternsB RGBA = clay roof tile | slate/shingle | limewash mottle | decorative tile band
 * Each channel stores face tone (0.3..1) with joints/grooves near 0.1. 512² each, ~1.4 MB with mips.
 * The mural is one original abstract Eden landscape, 1024×512 sRGB, ~2.8 MB with mips. */
const N=512;
const hash=(x:number,y:number,s=0)=>{let h=(Math.imul(x|0,374761393)+Math.imul(y|0,668265263)+Math.imul(s|0,1442695041))|0;h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296;};
const smooth=(e0:number,e1:number,x:number)=>{const t=Math.min(1,Math.max(0,(x-e0)/(e1-e0)));return t*t*(3-2*t);};
function vnoise(x:number,y:number,period:number,seed:number){const xi=Math.floor(x),yi=Math.floor(y),fx=x-xi,fy=y-yi,u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);const h=(a:number,b:number)=>hash(((a%period)+period)%period,((b%period)+period)%period,seed);
 return (h(xi,yi)*(1-u)+h(xi+1,yi)*u)*(1-v)+(h(xi,yi+1)*(1-u)+h(xi+1,yi+1)*u)*v;}
/** Tileable fbm over the 512 tile with `cells` base cells. */
const fbm=(px:number,py:number,cells:number,seed:number)=>{let a=0,amp=.55,c=cells;for(let o=0;o<3;o++){a+=amp*vnoise(px/N*c,py/N*c,c,seed+o);amp*=.5;c*=2;}return a/.9625;};
const byte=(v:number)=>Math.max(0,Math.min(255,Math.round(v*255)));
/** Brick: courses of `rows`, `cols` stretchers per course; flemish alternates headers. Joint ≈ 10% of course. */
function brick(x:number,y:number,rows:number,cols:number,flemish:boolean,seed:number){
 const ch=N/rows,row=Math.floor(y/ch),fy=(y%ch)/ch;let unit=N/cols,offset=row%2?unit/2:0;
 if(flemish){unit=N/(cols*1.5);offset=row%2?unit*.75:0;}
 const xx=(x+offset)%N;let idx=Math.floor(xx/unit),fx=(xx%unit)/unit;
 if(flemish){const pair=unit*1.5,k=Math.floor(xx/pair),f=(xx%pair)/pair;idx=k*2+(f<2/3?0:1);fx=f<2/3?f*1.5:(f-2/3)*3;}
 const jx=Math.min(fx,1-fx)*unit,jy=Math.min(fy,1-fy)*ch,joint=Math.min(jx,jy);
 const face=.5+.35*hash(idx,row,seed)+.15*(fbm(x,y,16,seed+7)-.5)*2;
 const header=flemish&&idx%2===1?.88:1;
 return joint<1.6?.1+.04*hash(x,y,seed):Math.min(1,Math.max(.3,face*header-(joint<3?.08:0)));
}
function ashlar(x:number,y:number){const rows=6,ch=N/rows,row=Math.floor(y/ch);const widths=[1.4,1,1.7,1.2,.9,1.6];const off=hash(row,0,3)*N;
 let xx=(x+off)%N,acc=0,i=0;const total=widths.reduce((a,b)=>a+b,0);const scale=N/total;while(i<widths.length&&acc+widths[(i+row)%widths.length]*scale<=xx){acc+=widths[(i+row)%widths.length]*scale;i++;}
 const w=widths[(i+row)%widths.length]*scale,fx=(xx-acc)/w,fy=(y%ch)/ch,joint=Math.min(Math.min(fx,1-fx)*w,Math.min(fy,1-fy)*ch);
 const face=.55+.3*hash(i,row,11)+.25*(fbm(x,y,8,21)-.5)+.1*(fbm(x,y,64,23)-.5);
 return joint<2.2?.12:Math.min(1,Math.max(.3,face-(joint<5?.1*(1-joint/5):0)));}
function clapboard(x:number,y:number){const boards=12,bh=N/boards,fy=(y%bh)/bh,b=Math.floor(y/bh);
 const grain=fbm(x*.25,y*4,32,40+b)*.12;return fy<.08?.12:Math.min(1,.55+.4*fy+grain+.06*hash(b,0,5));}
function claytile(x:number,y:number){const rows=10,rh=N/rows,row=Math.floor(y/rh),fy=(y%rh)/rh,cols=12,cw=N/cols,xx=(x+(row%2?cw/2:0))%N,c=Math.floor(xx/cw),fx=(xx%cw)/cw;
 const arch=1-Math.pow(Math.abs(fx-.5)*2,2);const lip=fy>.82+.12*(1-arch);return lip?.14:Math.min(1,.45+.45*fy+.25*arch*.5+.15*hash(c,row,9));}
function slate(x:number,y:number){const rows=14,rh=N/rows,row=Math.floor(y/rh),fy=(y%rh)/rh,cols=16,cw=N/cols,xx=(x+(row%2?cw/2:0)+hash(row,1,2)*cw*.3)%N,c=Math.floor(xx/cw),fx=(xx%cw)/cw;
 const gap=Math.min(fx,1-fx)*cw<1.2||fy>.9;return gap?.12:Math.min(1,.45+.35*hash(c,row,13)+.2*fy+.1*(fbm(x,y,32,31)-.5));}
function tileband(x:number,y:number){const s=N/8,cx=(x%s)/s-.5,cy=(y%s)/s-.5,i=Math.floor(x/s),j=Math.floor(y/s);
 const d=Math.abs(cx)+Math.abs(cy),grout=Math.min(.5-Math.abs(cx),.5-Math.abs(cy))*s<1.5;return grout?.1:d<.32?(.95):((i+j)%2?.6:.4);}
let kit:{patternsA:THREE.DataTexture;patternsB:THREE.DataTexture;patternsC:THREE.DataTexture;mural:THREE.DataTexture;bytes:number}|null=null;
/** patternsC RGBA = grass blades | tuft/clover clumps | gravel speckle | ripple height (all tileable). */
function bladeField(){const blades=new Float32Array(N*N);let seed=12345;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let k=0;k<9000;k++){const x0=rnd()*N,y0=rnd()*N,ang=-Math.PI/2+(rnd()-.5)*1.4,len=5+rnd()*12,val=.4+rnd()*.6;for(let t=0;t<len;t++){const x=Math.round(x0+Math.cos(ang)*t),y=Math.round(y0+Math.sin(ang)*t),i=(((y%N)+N)%N)*N+(((x%N)+N)%N);blades[i]=Math.max(blades[i],val*(.55+.45*t/len));}}
 return blades;}
function groundRow(d:Uint8Array,y:number,blades:Float32Array){for(let x=0;x<N;x++){const i=y*N+x,o=i*4;const base=.35+.2*fbm(x,y,32,90);d[o]=byte(Math.max(base,blades[i]));
  const clump=fbm(x,y,6,91)+.25*fbm(x,y,24,92);d[o+1]=byte(smooth(.62,.8,clump));
  const cell=24,cx=Math.floor(x/cell),cy=Math.floor(y/cell);let near=1;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const px=(cx+dx)*cell+hash(cx+dx,cy+dy,93)*cell,py=(cy+dy)*cell+hash(cx+dx,cy+dy,94)*cell;near=Math.min(near,Math.hypot(x-px,y-py)/cell);}
  d[o+2]=byte(Math.min(1,.25+.75*smooth(.05,.45,near))*(.85+.15*hash(x,y,95)));
  d[o+3]=byte(fbm(x,y,8,96)*.6+fbm(x,y,16,97)*.4);}}
function dataTexture(data:Uint8Array,w:number,h:number,srgb:boolean){const t=new THREE.DataTexture(data,w,h,THREE.RGBAFormat);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.anisotropy=4;if(srgb)t.colorSpace=THREE.SRGBColorSpace;t.needsUpdate=true;return t;}
/** Original abstract Eden mural: sun over layered hills, a river, round trees and a band of tile motifs. */
function muralRow(d:Uint8Array,W:number,H:number,y:number){const mix=(a:number[],b:number[],t:number)=>a.map((v,i)=>v+(b[i]-v)*t);
 const sky1=[.96,.78,.52],sky2=[.55,.74,.82],sun=[.98,.86,.42],hills=[[.42,.6,.36],[.3,.5,.34],[.2,.38,.3]],river=[.25,.52,.66],trunk=[.36,.24,.16],crowns=[[.25,.48,.28],[.4,.58,.3],[.72,.42,.28]],border=[.62,.28,.22],motif=[.95,.84,.6];
 for(let x=0;x<W;x++){const u=x/W,v=1-y/H;let c=mix(sky1,sky2,smooth(.45,1,v));
  const sd=Math.hypot((u-.72)*2,(v-.74)),ray=Math.sin(Math.atan2(v-.74,(u-.72)*2)*14)*.5+.5;if(sd<.12)c=sun;else if(sd<.26&&ray>.6)c=mix(c,sun,.35*(1-sd/.26));
  for(let k=0;k<3;k++){const hy=.58-k*.12+.06*Math.sin(u*6.3*(1+k*.4)+k*1.7)+.03*Math.sin(u*17+k);if(v<hy){c=hills[k];const stripe=Math.sin((u*40+v*12*(k+1)))*.5+.5;c=mix(c,c.map(z=>z*1.15),stripe>.8?.5:0);}}
  const rc=.5+.22*Math.sin(v*9+1.2)+.1*(v-.2);const rw=.03+.12*(.32-v);if(v<.32&&Math.abs(u-rc)<rw)c=mix(river,[.85,.92,.95],Math.sin(v*90+u*20)>.85?.6:0);
  for(let t=0;t<7;t++){const tx=.08+t*.135+.03*Math.sin(t*2.1),ty=.3+.12*Math.sin(t*1.3),r=.045+.015*(t%3);if(Math.abs(u-tx)<.006&&v<ty&&v>ty-.14)c=trunk;const dd=Math.hypot((u-tx)*2,(v-ty));if(dd<r)c=mix(crowns[t%3],[1,1,1],dd/r>.7?.08:0);}
  for(let b=0;b<5;b++){const bx=.2+b*.09,by=.86-.02*b,dx=u-bx,dy=v-by;if(Math.abs(dy-Math.abs(dx)*.5)<.004&&Math.abs(dx)<.025)c=[.2,.2,.22];}
  if(v<.08||v>.94||u<.02||u>.98){c=border;const m=Math.abs(((u*W/32)%1)-.5)+Math.abs(((v*H/32)%1)-.5);if(m<.28)c=motif;}
  const grain=.94+.08*hash(x>>1,y>>1,77);const i=(y*W+x)*4;d[i]=byte(c[0]*grain);d[i+1]=byte(c[1]*grain);d[i+2]=byte(c[2]*grain);d[i+3]=255;}
}
/** Textures are usable immediately (flat mid-tone placeholders, uploaded once) and then filled in row slices by
 * stepSurfaceKit() over later frames, so no single frame pays the ~0.5 s of generation. Each texture is
 * re-uploaded once when complete. */
type Job={tex:THREE.DataTexture;rows:number;next:number;row:(y:number)=>void;prepare?:()=>void};
let jobs:Job[]=[];
function flat(len:number,v:number[]){const d=new Uint8Array(len);for(let i=0;i<len;i+=4){d[i]=v[0];d[i+1]=v[1];d[i+2]=v[2];d[i+3]=v[3];}return d;}
export function surfaceKit(){
 if(kit)return kit;
 const W=1024,H=512,a=flat(N*N*4,[166,166,166,170]),b=flat(N*N*4,[150,150,128,110]),c=flat(N*N*4,[118,64,190,128]),m=flat(W*H*4,[150,160,120,255]);
 kit={patternsA:dataTexture(a,N,N,false),patternsB:dataTexture(b,N,N,false),patternsC:dataTexture(c,N,N,false),mural:dataTexture(m,W,H,true),bytes:Math.round((N*N*4*3+W*H*4)*4/3)};
 kit.mural.wrapS=kit.mural.wrapT=THREE.ClampToEdgeWrapping;
 // W2b: the ground/turf patterns fill whole screens (lawns, meadow); 4x anisotropic fetches cost ~1 ms a frame at dpr 2
 // and change nothing visible, since their detail fades to the mean tone by 26-40 m anyway.
 kit.patternsC.anisotropy=1;
 let blades:Float32Array|null=null;
 jobs=[
  {tex:kit.patternsC,rows:N,next:0,prepare:()=>{blades=bladeField();},row:y=>groundRow(c,y,blades!)},
  {tex:kit.patternsA,rows:N,next:0,row:y=>{for(let x=0;x<N;x++){const i=(y*N+x)*4;a[i]=byte(brick(x,y,32,8,false,1));a[i+1]=byte(brick(x,y,32,8,true,2));a[i+2]=byte(ashlar(x,y));a[i+3]=byte(clapboard(x,y));}}},
  {tex:kit.patternsB,rows:N,next:0,row:y=>{for(let x=0;x<N;x++){const i=(y*N+x)*4;b[i]=byte(claytile(x,y));b[i+1]=byte(slate(x,y));b[i+2]=byte(fbm(x,y,4,61)*.7+fbm(x,y,32,62)*.3);b[i+3]=byte(tileband(x,y));}}},
  {tex:kit.mural,rows:H,next:0,row:y=>muralRow(m,W,H,y)},
 ];
 return kit;
}
/** Generate pattern rows for at most `budgetMs`; returns true once every texture is complete. */
export function stepSurfaceKit(budgetMs=3){
 if(!kit)return true;const start=performance.now();
 while(jobs.length){const job=jobs[0];if(job.prepare){job.prepare();job.prepare=undefined;}
  while(job.next<job.rows){job.row(job.next++);if(performance.now()-start>budgetMs)return false;}
  job.tex.needsUpdate=true;jobs.shift();}
 return true;
}
export function disposeSurfaceKit(){if(!kit)return;kit.patternsA.dispose();kit.patternsB.dispose();kit.patternsC.dispose();kit.mural.dispose();kit=null;}
