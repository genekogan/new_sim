import {Builder,rng,type Col} from './kit.ts';
/** Furniture vocabulary. Every piece is drawn in a local frame: origin on the floor at the piece's
 * footprint centre, front (the side one uses it from) facing local +Z. Sizes are metres. */
export const C={oak:'#9a6b43',walnut:'#5e3d27',pine:'#c49a63',ash:'#d8c3a0',paint:'#e9e4d8',iron:'#3b3d40',brass:'#b8913f',linen:'#ece3cf',
 sage:'#8ea47f',teal:'#3f7f86',rust:'#b0573a',ochre:'#d19c3c',plum:'#7a4a6a',navy:'#34476b',rose:'#c98b86',cream:'#f2ead8',
 terracotta:'#b8653e',leaf:'#4f8a3c',leaf2:'#6aa152',hay:'#d8bc6a',bread:'#c98a45',crust:'#9c5f2a',slate:'#46505a',chalk:'#2f4a3c',white:'#f4f2ec',black:'#222222',
 lampWarm:'#ffd99a',lampHot:'#fff1cf',screen:'#9fd3e6'} as const;
const BOOKS=['#8b2f2f','#2f5d8b','#3d7a4a','#c79a3a','#6b3f7a','#b5562d','#2b2b2b','#d8cdb0','#4a6f7a','#9b4d64'];
export type B=Builder;
// ---------------------------------------------------------------- tables & seats
export function table(b:B,w:number,d:number,h=.76,top:Col=C.oak,leg:Col=C.walnut){b.box(0,h-.04,0,w,.04,d,top);for(const sx of[-1,1])for(const sz of[-1,1])b.box(sx*(w/2-.06),0,sz*(d/2-.06),.06,h-.04,.06,leg);}
export function roundTable(b:B,r:number,h=.76,top:Col=C.oak,leg:Col=C.walnut){b.cyl(0,h-.04,0,r,r,.04,top,'furn',14);b.cyl(0,0,0,.05,.05,h-.04,leg,'furn',6);b.cyl(0,0,0,r*.45,r*.5,.04,leg,'furn',10);}
export function chair(b:B,col:Col=C.oak,seat:Col|null=null){b.box(0,.43,0,.44,.04,.42,col);if(seat)b.box(0,.47,0,.4,.04,.38,seat,'cloth');for(const sx of[-1,1])for(const sz of[-1,1])b.box(sx*.19,0,sz*.18,.04,.43,.04,col);b.box(0,.47,-.19,.44,.45,.04,col);}
export function stool(b:B,h=.66,col:Col=C.oak,seat:Col=C.walnut){b.cyl(0,h-.04,0,.17,.17,.04,seat,'furn',10);for(const [x,z] of[[.1,.1],[-.1,.1],[.1,-.1],[-.1,-.1]])b.box(x,0,z,.035,h-.04,.035,col);b.box(0,h*.35,0,.22,.02,.22,col);}
export function bench(b:B,w:number,col:Col=C.oak){b.box(0,.42,0,w,.05,.34,col);for(const sx of[-1,1])b.box(sx*(w/2-.1),0,0,.06,.42,.3,col);}
export function armchair(b:B,fab:Col=C.sage,wood:Col=C.walnut){b.box(0,.12,0,.78,.3,.74,fab,'cloth');b.box(0,.42,.05,.6,.1,.6,fab,'cloth');b.box(0,.42,-.3,.78,.5,.16,fab,'cloth');for(const sx of[-1,1])b.box(sx*.33,.42,0,.13,.22,.74,fab,'cloth');for(const sx of[-1,1])for(const sz of[-1,1])b.box(sx*.33,0,sz*.31,.05,.12,.05,wood);}
export function sofa(b:B,w:number,fab:Col=C.navy,wood:Col=C.walnut){b.box(0,.12,0,w,.3,.85,fab,'cloth');b.box(0,.42,.06,w-.3,.12,.66,fab,'cloth');b.box(0,.42,-.34,w,.46,.18,fab,'cloth');for(const sx of[-1,1])b.box(sx*(w/2-.08),.42,0,.16,.22,.85,fab,'cloth');for(const sx of[-1,1])for(const sz of[-1,1])b.box(sx*(w/2-.08),0,sz*.36,.05,.12,.05,wood);
 const r=rng(w*100|0);for(const sx of[-1,1])b.box(sx*(w/2-.42),.56,-.18,.38,.32,.12,[C.ochre,C.rose,C.cream,C.teal][r()*4|0],'cloth');}
export function pew(b:B,w:number,col:Col=C.walnut){b.box(0,.42,0,w,.05,.4,col);b.box(0,.47,-.18,w,.48,.04,col);for(const sx of[-1,1])b.box(sx*(w/2-.03),0,0,.06,.95,.44,col);b.box(0,.82,.12,w-.1,.03,.12,col);}
// ---------------------------------------------------------------- storage
/** Bookshelf against a wall (back at local z=-d/2), stocked with coloured books on every shelf. */
export function bookshelf(b:B,w:number,h=2.1,d=.32,col:Col=C.walnut,seed=1,fill=.9){const r=rng(seed),n=Math.max(2,Math.round((h-.1)/.38));
 b.box(0,0,0,w,.08,d,col);b.box(0,h-.04,0,w,.04,d,col);for(const sx of[-1,1])b.box(sx*(w/2-.015),0,0,.03,h,d,col);b.box(0,0,-d/2+.01,w,h,.02,col);
 for(let i=1;i<n;i++)b.box(0,.08+i*(h-.12)/n-.02,0,w-.04,.025,d-.02,col);
 for(let i=0;i<n;i++){const y=.08+i*(h-.12)/n+.005,sh=(h-.12)/n-.03;let x=-w/2+.04;while(x<w/2-.06){const bw=.025+r()*.035,bh=sh*(.62+r()*.3);if(r()<fill)b.box(x+bw/2,y,(r()-.5)*.03,bw,bh,d*.75,BOOKS[r()*BOOKS.length|0]);x+=bw+(r()<.06?.12:.002);}}}
/** Open shelving with jars/crates/loaves etc.: `item(i,j,x,y)` draws contents on shelf j. */
export function shelving(b:B,w:number,h:number,d:number,shelves:number,col:Col,item:(x:number,y:number,j:number)=>void,step=.22){b.box(0,0,0,w,.04,d,col);for(const sx of[-1,1])b.box(sx*(w/2-.02),0,0,.04,h,d,col);
 for(let j=0;j<shelves;j++){const y=.04+j*(h-.04)/shelves+(j?0:.2);b.box(0,y,0,w-.04,.03,d,col);for(let x=-w/2+.12;x<w/2-.1;x+=step)item(x,y+.03,j);}b.box(0,h-.03,0,w,.03,d,col);}
export function cabinet(b:B,w:number,h:number,d:number,col:Col=C.paint,knob:Col=C.brass){b.box(0,0,0,w,h,d,col);const n=Math.max(1,Math.round(w/.5));for(let i=0;i<n;i++){const x=-w/2+(i+.5)*w/n;b.box(x,.06,d/2,w/n-.03,h-.12,.015,col);b.box(x+(i%2?-1:1)*(w/n/2-.07),h*.6,d/2+.01,.02,.1,.02,knob);}}
export function wardrobe(b:B,w=1.1,col:Col=C.oak){b.box(0,0,0,w,2,.58,col);b.box(-w/4,.05,.29,w/2-.02,1.9,.012,col);b.box(w/4,.05,.29,w/2-.02,1.9,.012,col);b.box(-.04,1,.3,.02,.18,.02,C.brass);b.box(.04,1,.3,.02,.18,.02,C.brass);b.box(0,2,0,w+.06,.05,.62,C.walnut);}
export function crate(b:B,s=.5,col:Col=C.pine){b.box(0,0,0,s,s*.8,s,col);b.box(0,s*.35,s/2,s,.06,.01,C.oak);}
export function barrel(b:B,r=.32,h=.85,col:Col=C.oak){b.cyl(0,0,0,r*.88,r*.88,h,col,'furn',10);b.cyl(0,h*.25,0,r,r*.92,h*.25,col,'furn',10);b.cyl(0,h*.5,0,r*.92,r,h*.25,col,'furn',10);for(const y of[.08,.92])b.cyl(0,y*h-.02,0,r*.9,r*.9,.04,C.iron,'furn',10);}
export function sack(b:B,col:Col='#cdb48a'){b.ball(0,.3,0,.24,.3,.2,col,'cloth');b.cyl(0,.55,0,.06,.1,.1,col,'cloth',6);}
// ---------------------------------------------------------------- beds & bath
export function bed(b:B,w:number,l=2,blanket:Col=C.teal,frame:Col=C.oak){b.box(0,0,0,w,.3,l,frame);b.box(0,.3,0,w-.06,.18,l-.06,C.white,'cloth');b.box(0,.48,.2,w-.02,.04,l*.7,blanket,'cloth');b.box(0,.3,-l/2+.03,w,.7,.06,frame);
 const n=w>1.2?2:1;for(let i=0;i<n;i++)b.box((i-(n-1)/2)*(w/n),.48,-l/2+.3,w/n-.12,.12,.36,C.cream,'cloth');}
export function bathtub(b:B){b.box(0,.1,0,.75,.5,1.6,C.white);b.box(0,.58,0,.6,.02,1.45,'#cfe3ea');for(const sx of[-1,1])for(const sz of[-1,1])b.box(sx*.3,0,sz*.7,.08,.1,.08,C.brass);b.box(0,.6,-.72,.08,.18,.06,C.brass);}
export function washbasin(b:B){b.box(0,0,0,.55,.82,.42,C.paint);b.box(0,.82,0,.5,.06,.38,C.white);b.box(0,.88,-.16,.04,.16,.04,C.brass);b.box(0,1.1,-.2,.45,.6,.02,'#bcd0d8','glass');}
// ---------------------------------------------------------------- dressing
export function rug(b:B,w:number,d:number,base:Col,border:Col,stripe:Col|null=null){b.box(0,0,0,w,.012,d,border,'cloth');b.box(0,.012,0,w-.16,.004,d-.16,base,'cloth');if(stripe)for(const z of[-d/4,0,d/4])b.box(0,.016,z,w-.34,.003,.06,stripe,'cloth');}
export function roundRug(b:B,r:number,base:Col,border:Col){b.cyl(0,0,0,r,r,.012,border,'cloth',16);b.cyl(0,.012,0,r-.09,r-.09,.004,base,'cloth',16);}
export function plant(b:B,size=1,pot:Col=C.terracotta,leaf:Col=C.leaf){b.cyl(0,0,0,.17*size,.13*size,.32*size,pot,'furn',8);b.cyl(0,.3*size,0,.15*size,.15*size,.02,'#4a3324','furn',8);
 b.ball(0,.62*size,0,.3*size,.36*size,.3*size,leaf);b.ball(.12*size,.82*size,.06*size,.2*size,.24*size,.2*size,C.leaf2);}
export function tallPlant(b:B,pot:Col=C.terracotta){b.cyl(0,0,0,.2,.16,.38,pot,'furn',8);b.cyl(0,.38,0,.025,.025,.9,'#5b4a32','furn',5);for(let i=0;i<5;i++){const a=i*1.26;b.tilt(Math.cos(a)*.18,1.05+i*.12,Math.sin(a)*.18,.16,.02,.55,.5*Math.sin(a),-.5*Math.cos(a),C.leaf,'furn',-a);}b.ball(0,1.35,0,.22,.3,.22,C.leaf2);}
export function floorLamp(b:B,shade:Col=C.lampWarm){b.cyl(0,0,0,.16,.18,.03,C.iron,'furn',10);b.cyl(0,.03,0,.015,.015,1.45,C.iron,'furn',5);b.cyl(0,1.4,0,.13,.21,.28,shade,'glow',10);}
export function tableLamp(b:B,shade:Col=C.lampWarm){b.cyl(0,0,0,.06,.07,.03,C.brass,'furn',8);b.cyl(0,.03,0,.012,.012,.26,C.brass,'furn',5);b.cyl(0,.24,0,.07,.11,.15,shade,'glow',10);}
/** Pendant hanging from a ceiling at height `ceil` above this frame's floor. */
export function pendant(b:B,ceil:number,drop=.9,shade:Col=C.lampWarm,r=.2){b.cyl(0,ceil-drop+.18,0,.006,.006,drop-.18,C.black,'furn',4);b.cyl(0,ceil-drop,0,r*.35,r,.2,C.iron,'furn',12);b.cyl(0,ceil-drop-.005,0,r*.9,r*.9,.012,shade,'glow',12);b.ball(0,ceil-drop+.02,0,.06,.06,.06,C.lampHot,'glow');}
export function candle(b:B,h=.2){b.cyl(0,0,0,.025,.025,h,C.cream,'furn',6);b.cone(0,h,0,.012,.045,C.lampHot,'glow',5);}
/** Framed picture hung on a wall whose face is at local z=0 facing +Z (centre height y). */
export function picture(b:B,w:number,h:number,y:number,seed=1,frame:Col=C.walnut){const r=rng(seed);b.box(0,y-h/2,.015,w,h,.03,frame);const pal=[['#d9c49a','#7aa0b8','#5c7f4a'],['#e2b07a','#b5562d','#3b5a7a'],['#cfd8c4','#8ea47f','#7a4a6a'],['#f0d9a8','#c98b86','#34476b']][r()*4|0];
 b.box(0,y-h/2+.05,.032,w-.1,h-.1,.004,pal[0]);b.box(0,y-h/2+.05,.036,w-.1,(h-.1)*(.3+r()*.25),.004,pal[1]);b.ball((r()-.5)*w*.4,y+(r()-.3)*h*.2,.04,w*.13,w*.13,.004,pal[2]);}
export function clock(b:B,y:number){b.box(0,y-.2,.02,.4,.4,.04,C.walnut);b.box(0,y-.17,.045,.34,.34,.006,C.cream);b.box(0,y-.02,.05,.02,.15,.004,C.black);b.box(.05,y-.02,.05,.1,.02,.004,C.black);}
export function chalkboard(b:B,w:number,h:number,y:number){b.box(0,y-h/2,.02,w+.08,h+.08,.03,C.oak);b.box(0,y-h/2+.04,.04,w,h,.006,C.chalk);for(let i=0;i<4;i++)b.box(-w*.3+i*.08,y+h*.3-i*.14,.046,w*(.5-i*.08),.025,.002,C.white);b.box(0,y-h/2-.06,.08,w,.03,.08,C.oak);}
export function mirror(b:B,w:number,h:number,y:number){b.box(0,y-h/2,.015,w+.08,h+.08,.03,C.brass);b.box(0,y-h/2+.04,.032,w,h,.004,'#cfe0e8','glass');}
export function curtainWindow(b:B,w:number,h:number,y:number,col:Col=C.rose){for(const sx of[-1,1])b.box(sx*(w/2+.12),y-h,.06,.3,h+.1,.06,col,'cloth');b.box(0,y+.08,.06,w+.7,.04,.04,C.brass);}
// ---------------------------------------------------------------- work & craft
export function desk(b:B,w=1.3,d=.65,col:Col=C.oak){table(b,w,d,.75,col,col);b.box(w/2-.25,.15,0,.42,.55,d-.06,col);}
export function workbench(b:B,w=2.2,d=.8,seed=3){const r=rng(seed);b.box(0,.86,0,w,.08,d,C.pine);for(const sx of[-1,1])for(const sz of[-1,1])b.box(sx*(w/2-.08),0,sz*(d/2-.08),.1,.86,.1,C.oak);b.box(0,.18,0,w-.2,.03,d-.2,C.oak);
 b.box(-w/2+.2,.94,d/2-.12,.18,.12,.2,C.iron);b.box(-w/2+.2,1.06,d/2-.12,.04,.04,.3,C.iron);// vice
 b.box(0,.94,0,.35,.05,.12,C.ash);b.box(.35,.94,.1,.28,.02,.06,C.slate);b.box(.6,.94,-.15,.06,.12,.06,C.rust);
 for(let i=0;i<5;i++)b.box(-w*.25+i*.18*r(),.94,-.2+r()*.3,.1+r()*.2,.02,.03,[C.iron,C.oak,C.rust][r()*3|0]);
 for(let i=0;i<4;i++)b.box((r()-.5)*w*.6,.12,(r()-.5)*.4,.25,.1,.2,[C.ash,C.pine,C.oak][r()*3|0]);}
/** Pegboard tool wall on a wall face at local z=0. */
export function toolWall(b:B,w:number,y0=1.1,h=1,seed=5){const r=rng(seed);b.box(0,y0,.01,w,h,.02,C.ash);for(let x=-w/2+.15;x<w/2-.1;x+=.16+r()*.08){const kind=r()*4|0,hh=.2+r()*.35,y=y0+h*.15+r()*h*.3;
 if(kind===0){b.box(x,y,.05,.03,hh,.03,C.oak);b.box(x,y+hh,.05,.12,.05,.04,C.iron);}else if(kind===1){b.box(x,y,.05,.025,hh,.025,C.oak);b.box(x,y+hh-.02,.05,.06,.12,.02,C.iron);}else if(kind===2){b.box(x,y+.1,.05,.16,.16,.03,C.rust);}else b.box(x,y,.05,.04,hh*.8,.02,C.iron);}}
export function easel(b:B,canvas:Col=C.cream,paint=1){b.tilt(-.25,.85,.05,.04,1.75,.04,-.12,.14,C.pine);b.tilt(.25,.85,.05,.04,1.75,.04,-.12,-.14,C.pine);b.tilt(0,.8,-.32,.04,1.65,.04,.35,0,C.pine);b.box(0,.82,.12,.7,.04,.08,C.pine);
 const r=rng(paint*17);b.tilt(0,1.22,.1,.66,.8,.02,-.12,0,canvas);const pal=[C.teal,C.ochre,C.rust,C.plum,C.sage,C.navy];for(let i=0;i<4;i++)b.tilt((r()-.5)*.4,1.1+r()*.4,.115+i*.002,.2+r()*.2,.1+r()*.2,.004,-.12,0,pal[r()*6|0]);}
export function loom(b:B){for(const sx of[-1,1]){b.box(sx*.7,0,0,.08,1.6,.08,C.oak);b.box(sx*.7,0,0,.08,.08,1,C.oak);}b.box(0,1.5,0,1.48,.08,.08,C.oak);b.box(0,.8,.25,1.48,.06,.1,C.oak);b.box(0,.85,-.05,1.3,.7,.01,C.rust,'cloth');for(let i=0;i<6;i++)b.box(0,.9+i*.1,-.045,1.3,.03,.004,[C.ochre,C.cream,C.teal][i%3],'cloth');b.box(0,.45,.45,1,.06,.3,C.oak);}
export function potteryWheel(b:B){b.box(0,0,0,.6,.5,.6,C.slate);b.cyl(0,.5,0,.18,.18,.05,C.iron,'furn',12);b.cyl(0,.55,0,.1,.13,.16,'#b07850','furn',10);b.box(0,0,.5,.45,.42,.35,C.oak);}
export function anvil(b:B){b.box(0,0,0,.35,.45,.35,C.oak);b.box(0,.45,0,.5,.12,.18,C.iron);b.box(.3,.5,0,.18,.05,.08,C.iron);}
export function sawhorse(b:B){for(const sx of[-1,1]){b.tilt(sx*.45,.33,.12,.05,.7,.05,.2,0,C.pine);b.tilt(sx*.45,.33,-.12,.05,.7,.05,-.2,0,C.pine);}b.box(0,.66,0,1,.08,.08,C.pine);b.box(.1,.74,0,.9,.03,.25,C.ash);}
export function hayBale(b:B,l=1.1){b.box(0,0,0,l,.45,.5,C.hay);for(const x of[-l/4,l/4])b.box(x,.0,0,.03,.455,.51,'#b79a52');}
// ---------------------------------------------------------------- food & café
export function counter(b:B,w:number,d=.65,h=1,top:Col=C.ash,front:Col=C.oak){b.box(0,0,0,w,h-.04,d,front);b.box(0,h-.04,.015,w+.04,.04,d+.03,top);b.box(0,0,d/2,w,.1,.02,C.walnut);}
export function espresso(b:B){b.box(0,0,0,.55,.42,.42,'#b9bcbf');b.box(0,.42,0,.5,.08,.4,C.iron);b.box(-.12,.15,.22,.06,.06,.08,C.iron);b.box(.12,.15,.22,.06,.06,.08,C.iron);for(let i=0;i<4;i++)b.cyl(-.15+i*.1,.5,-.05,.035,.03,.08,C.white,'furn',8);}
export function cakeStand(b:B,col:Col=C.rose){b.cyl(0,0,0,.05,.08,.12,C.white,'furn',8);b.cyl(0,.12,0,.16,.16,.02,C.white,'furn',12);b.cyl(0,.14,0,.12,.12,.1,col,'furn',12);b.cyl(0,.24,0,.12,.12,.02,C.cream,'furn',12);}
export function cup(b:B,col:Col=C.white){b.cyl(0,0,0,.04,.035,.08,col,'furn',8);b.cyl(0,0,0,.07,.07,.008,col,'furn',8);}
export function plate(b:B,food:Col|null=null){b.cyl(0,0,0,.12,.1,.015,C.white,'furn',10);if(food)b.ball(0,.04,0,.06,.03,.05,food);}
export function loaf(b:B,x:number,y:number,z:number,r:()=>number){const k=r();if(k<.4)b.ball(x,y+.06,z,.13,.07,.07,C.bread);else if(k<.7)b.ball(x,y+.07,z,.09,.08,.09,C.crust);else b.cyl(x,y,z,.07,.08,.09,C.bread,'furn',8);}
export function oven(b:B,w=1.6){b.box(0,0,0,w,1.2,1.1,'#a9542f');b.ball(0,1.2,0,w/2,.6,.55,'#a9542f');b.box(0,.45,.55,.6,.4,.04,C.iron);b.box(0,.5,.57,.5,.3,.01,'#ff9a3c','glow');b.cyl(w/2-.25,1.5,-.2,.12,.14,1.2,'#8e4a2c','furn',8);}
export function stove(b:B){b.box(0,0,0,.8,.88,.62,C.paint);b.box(0,.88,0,.8,.04,.62,C.iron);for(const [x,z] of[[-.2,-.15],[.2,-.15],[-.2,.15],[.2,.15]])b.cyl(x,.92,z,.08,.08,.01,C.black,'furn',10);b.box(0,.2,.31,.6,.45,.01,C.iron);b.cyl(.2,.93,.15,.1,.1,.12,C.slate,'furn',10);}
export function fridge(b:B){b.box(0,0,0,.7,1.8,.66,'#e8e6e0');b.box(-.27,.9,.34,.03,.5,.03,C.iron);b.box(0,1.18,.335,.68,.01,.005,'#c8c6c0');}
export function sink(b:B,w=1.2){counter(b,w,.62,.9,C.white,C.paint);b.box(-.15,.86,0,.5,.05,.4,'#b9c7cc');b.box(-.15,.9,-.24,.03,.2,.03,C.brass);}
// ---------------------------------------------------------------- music & games
export function piano(b:B,col:Col=C.black){b.box(0,0,0,1.5,1.25,.6,col);b.box(0,.68,.3,1.42,.08,.28,col);b.box(0,.74,.33,1.36,.02,.18,C.white);for(let i=0;i<20;i++)b.box(-.62+i*.065,.76,.28,.025,.012,.1,C.black);b.box(0,0,.7,.7,.48,.34,col);b.box(0,1.25,-.05,.4,.02,.25,C.cream);}
export function musicStand(b:B){b.cyl(0,0,0,.18,.2,.02,C.iron,'furn',3);b.cyl(0,0,0,.012,.012,1.1,C.iron,'furn',4);b.tilt(0,1.15,0,.48,.32,.01,-.4,0,C.iron);b.tilt(0,1.18,.01,.4,.26,.004,-.4,0,C.white);}
export function drumKit(b:B){b.cyl(0,0,0,.28,.28,.55,C.rust,'furn',12);for(const [x,z,r] of[[-.45,.25,.17],[.45,.25,.17],[0,-.35,.14]])b.cyl(x,.45,z,r,r,.18,C.rust,'furn',12);b.cyl(.6,0,-.3,.01,.01,1.1,C.iron,'furn',4);b.cyl(.6,1.1,-.3,.22,.22,.01,C.brass,'furn',12);stool(b,.5,C.iron,C.black);}
export function guitar(b:B,col:Col=C.oak){b.tilt(0,.35,0,.34,.42,.08,-.15,0,col);b.tilt(0,.75,-.05,.06,.6,.03,-.15,0,C.walnut);}
export function chessTable(b:B){table(b,.7,.7,.72,C.walnut,C.walnut);for(let i=0;i<8;i++)for(let j=0;j<8;j++)if((i+j)%2)b.box(-.245+i*.07,.72,-.245+j*.07,.07,.003,.07,C.cream);
 for(let i=0;i<8;i++)for(const [z,c] of[[-.21,C.white],[-.14,C.white],[.14,C.black],[.21,C.black]] as const)b.cyl(-.245+i*.07,.72,z,.016,.02,.05+(i===3||i===4?.03:0),c,'furn',6);}
export function poolTable(b:B){b.box(0,0,0,1.1,.68,2.1,C.walnut);b.box(0,.68,0,1.3,.1,2.3,C.walnut);b.box(0,.78,0,1.1,.01,2.1,'#2e7d4e');const r=rng(9);for(let i=0;i<9;i++)b.ball((r()-.5)*.8,.81,(r()-.5)*1.6,.028,.028,.028,[C.white,C.ochre,C.rust,C.navy,C.plum,C.black][i%6]);b.tilt(.4,.84,.2,.02,.02,1.4,0,0,C.pine,'furn',.3);}
export function pingPong(b:B){table(b,1.52,2.74,.76,'#2d5f8a',C.iron);b.box(0,.76,0,1.6,.15,.02,C.white);b.box(0,.761,0,.02,.002,2.7,C.white);}
// ---------------------------------------------------------------- body & care
export function mat(b:B,col:Col=C.teal,w=.62,l=1.8){b.box(0,0,0,w,.02,l,col,'cloth');}
export function weights(b:B){b.box(0,0,0,1.2,.08,.35,C.iron);for(const sx of[-1,1])b.box(sx*.55,0,0,.06,.8,.3,C.iron);b.box(0,.4,0,1.1,.04,.3,C.iron);for(let i=0;i<5;i++){const x=-.45+i*.22;b.cylX(x,.52,0,.06+i*.01,.18,C.black,'furn',8);}}
export function barre(b:B,w:number){for(const sx of[-1,1])b.box(sx*(w/2-.1),0,.12,.04,1.05,.04,C.iron);b.cylX(0,1.05,.15,.025,w,C.pine,'furn',8);}
export function cot(b:B,blanket:Col=C.cream){b.box(0,0,0,.8,.55,1.95,C.white);b.box(0,.55,0,.78,.12,1.9,C.cream,'cloth');b.box(0,.67,.3,.8,.03,1.2,blanket,'cloth');b.box(0,.67,-.75,.5,.1,.3,C.white,'cloth');}
export function screenFold(b:B,col:Col=C.sage){for(let i=-1;i<=1;i++)b.box(i*.5,0,Math.abs(i)*.12,.48,1.7,.03,col,'cloth',i*.4);}
// ---------------------------------------------------------------- mail & shop
export function pigeonholes(b:B,w:number,h:number,seed=2){const r=rng(seed);b.box(0,0,0,w,h,.35,C.oak);const nx=Math.round(w/.22),ny=Math.round(h/.2);for(let i=0;i<nx;i++)for(let j=0;j<ny;j++){b.box(-w/2+(i+.5)*w/nx,j*h/ny+.02,.176,w/nx-.03,h/ny-.03,.004,C.walnut);if(r()<.45)b.box(-w/2+(i+.5)*w/nx,j*h/ny+.03,.18,w/nx-.07,.05,.01,C.cream);}}
export function parcels(b:B,seed=4){const r=rng(seed);let y=0;for(let i=0;i<4;i++){const s=.25+r()*.25;b.box((r()-.5)*.1,y,(r()-.5)*.1,s,s*.6,s*.8,'#b98d5a');b.box(0,y+s*.6,0,.02,.003,s*.8,C.cream);y+=s*.6;}}
export function globe(b:B){b.cyl(0,0,0,.18,.22,.05,C.walnut,'furn',8);b.cyl(0,.05,0,.025,.025,.7,C.walnut,'furn',5);b.ball(0,.95,0,.24,.24,.24,'#5f8fb5');b.ball(.08,1.02,.12,.12,.1,.1,'#7da05a');}
export function telescope(b:B){for(let i=0;i<3;i++){const a=i*2.09;b.tilt(Math.cos(a)*.2,.55,Math.sin(a)*.2,.03,1.15,.03,Math.sin(a)*.18,-Math.cos(a)*.18,C.oak,'furn',0);}b.tilt(0,1.25,.1,.14,.14,1.2,-.7,0,C.brass);}
/** A row of standing books between x0..x1 on a shelf top at y, spines facing +Z, centred at z. */
export function bookRow(b:B,x0:number,x1:number,y:number,z:number,depth:number,hmax:number,seed=1,gap=.06){const r=rng(seed);let x=x0;while(x<x1-.03){const bw=.025+r()*.035,bh=hmax*(.65+r()*.33);if(x+bw>x1)break;if(r()>gap)b.box(x+bw/2,y,z+(r()-.5)*.02,bw,bh,depth,BOOKS[r()*BOOKS.length|0]);x+=bw+(r()<gap?.1:.002);}}
/** Stock the open shelf unit of an installed `room-furnishing:desk-cabinet` (drawn in that piece's root frame). */
export function stockDeskCabinet(b:B,seed=1){bookRow(b,.27,1.03,.08,.03,.22,.42,seed);bookRow(b,.27,1.03,.65,.03,.22,.42,seed+1,.25);b.box(.5,1.25,.03,.22,.04,.2,C.cream);b.box(.85,1.25,.03,.14,.16,.14,C.terracotta);}
/** Plank floor overlay (thin, see-through layer) over x0..x1 × z0..z1, planks running along X. */
export function floorBoards(b:B,x0:number,z0:number,x1:number,z1:number,a:Col='#b58a5c',c:Col='#a67a4e',plank=.24){let i=0;for(let z=z0;z<z1-1e-6;z+=plank,i++){const d=Math.min(plank,z1-z)-.006;b.box((x0+x1)/2,0,z+d/2+.003,x1-x0,.008,d,i%3===0?c:i%3===1?a:'#ad8256','cloth');}}
