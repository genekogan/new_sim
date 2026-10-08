import * as THREE from 'three';
/** Low-poly street-prop kit. Each prop kind is ONE merged, vertex-coloured
 * geometry (local origin on the ground, front +Z) drawn as one InstancedMesh
 * with a shared class material, so a kind costs one draw call however many
 * times it is placed. Visual scenery only. */
export type Part={g:THREE.BufferGeometry;c:string;at?:[number,number,number];rot?:[number,number,number];s?:[number,number,number]};
export type Kind={name:string;material:'wood'|'metal'|'stone'|'cloth'|'foliage'|'painted'|'terracotta';parts:()=>Part[];shadow:boolean;clutter:boolean};

const tmp=new THREE.Matrix4(),q=new THREE.Quaternion(),e=new THREE.Euler(),v=new THREE.Vector3(),sc=new THREE.Vector3();
/** Merge parts into one non-indexed geometry with position/normal/color. */
export function mergeParts(parts:Part[]){
 const pos:number[]=[],nor:number[]=[],col:number[]=[],c=new THREE.Color(),n3=new THREE.Matrix3();
 for(const p of parts){
  const g=p.g.index?p.g.toNonIndexed():p.g;
  tmp.compose(v.fromArray(p.at??[0,0,0]),q.setFromEuler(e.set(...(p.rot??[0,0,0]))),sc.fromArray(p.s??[1,1,1]));n3.getNormalMatrix(tmp);
  const P=g.attributes.position,N=g.attributes.normal;c.set(p.c);const a=new THREE.Vector3(),b=new THREE.Vector3();
  for(let i=0;i<P.count;i++){a.fromBufferAttribute(P,i).applyMatrix4(tmp);pos.push(a.x,a.y,a.z);if(N){b.fromBufferAttribute(N,i).applyMatrix3(n3).normalize();nor.push(b.x,b.y,b.z);}col.push(c.r,c.g,c.b);}
  if(g!==p.g)g.dispose();p.g.dispose();
 }
 const out=new THREE.BufferGeometry();out.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));out.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3));out.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
 out.computeBoundingBox();out.computeBoundingSphere();return out;
}
/** Concatenate non-indexed position/normal/color geometries into one. */
export function concatGeometries(list:THREE.BufferGeometry[]){
 const names=['position','normal','color'] as const,out=new THREE.BufferGeometry();
 for(const n of names){const total=list.reduce((a,g)=>a+g.attributes[n].array.length,0),arr=new Float32Array(total);let o=0;for(const g of list){arr.set(g.attributes[n].array as Float32Array,o);o+=g.attributes[n].array.length;}out.setAttribute(n,new THREE.BufferAttribute(arr,3));}
 out.computeBoundingBox();out.computeBoundingSphere();return out;
}
// Primitive helpers (all low segment counts).
export const box=(w:number,h:number,d:number,c:string,x=0,y=0,z=0,rot?:[number,number,number]):Part=>({g:new THREE.BoxGeometry(w,h,d),c,at:[x,y,z],rot});
export const cyl=(rt:number,rb:number,h:number,c:string,x=0,y=0,z=0,seg=8,rot?:[number,number,number]):Part=>({g:new THREE.CylinderGeometry(rt,rb,h,seg,1),c,at:[x,y,z],rot});
export const ball=(r:number,c:string,x=0,y=0,z=0,s?:[number,number,number]):Part=>({g:new THREE.IcosahedronGeometry(r,0),c,at:[x,y,z],s});
export const ring=(r:number,t:number,c:string,x=0,y=0,z=0,rot?:[number,number,number],seg=10):Part=>({g:new THREE.TorusGeometry(r,t,3,seg),c,at:[x,y,z],rot});
export const cone=(r:number,h:number,c:string,x=0,y=0,z=0,seg=6,rot?:[number,number,number]):Part=>({g:new THREE.ConeGeometry(r,h,seg,1),c,at:[x,y,z],rot});

const IRON='#2f3633',WOOD='#9a6b46',DWOOD='#6e4a30',LEAF='#4f7f3a',LEAF2='#5f9142',TERRA='#b5653e';
const BLOOMS=['#d9567a','#f1c84b','#e9eef0','#9a6fd0','#e7844a'];
export const KINDS:Record<string,Kind>={
 bench:{name:'park benches',material:'wood',shadow:false,clutter:false,parts:()=>[
  box(.06,.42,.5,IRON,-.72,.21,0),box(.06,.42,.5,IRON,.72,.21,0),box(.06,.5,.06,IRON,-.72,.62,-.24,[-.18,0,0]),box(.06,.5,.06,IRON,.72,.62,-.24,[-.18,0,0]),
  box(1.6,.04,.13,WOOD,0,.44,.16),box(1.6,.04,.13,WOOD,0,.44,0),box(1.6,.04,.13,WOOD,0,.44,-.16),
  box(1.6,.11,.03,WOOD,0,.62,-.25,[-.18,0,0]),box(1.6,.11,.03,WOOD,0,.79,-.28,[-.18,0,0]),
  box(.07,.04,.42,IRON,-.74,.64,-.02),box(.07,.04,.42,IRON,.74,.64,-.02)]},
 bin:{name:'litter bins',material:'metal',shadow:false,clutter:false,parts:()=>[
  cyl(.24,.21,.78,'#3d5a45',0,.39,0),cyl(.27,.27,.05,'#2b3a30',0,.8,0),cyl(.1,.1,.08,'#2b3a30',0,.86,0),cyl(.245,.245,.04,'#c9b26b',0,.6,0)]},
 mailbox:{name:'post boxes',material:'painted',shadow:true,clutter:false,parts:()=>[
  box(.09,1.0,.09,DWOOD,0,.5,0),box(.24,.2,.44,'#ffffff',0,1.08,0),cyl(.12,.12,.44,'#ffffff',0,1.18,0,8,[Math.PI/2,0,0]),box(.03,.18,.06,'#c43b2e',.13,1.22,-.12)]},
 hydrant:{name:'fire hydrants',material:'metal',shadow:false,clutter:false,parts:()=>[
  cyl(.15,.17,.06,'#8c2a22',0,.03,0),cyl(.11,.12,.5,'#c7372b',0,.3,0),cyl(.13,.13,.05,'#8c2a22',0,.56,0),cone(.11,.12,'#c7372b',0,.64,0,8),cyl(.03,.03,.06,'#d9b54a',0,.72,0,6),
  cyl(.045,.045,.26,'#c7372b',0,.38,0,6,[0,0,Math.PI/2]),cyl(.055,.055,.12,'#c7372b',0,.36,.1,6,[Math.PI/2,0,0])]},
 pot:{name:'terracotta pots with shrubs',material:'terracotta',shadow:false,clutter:false,parts:()=>[
  cyl(.22,.16,.34,TERRA,0,.17,0),cyl(.24,.24,.05,'#a2582f',0,.34,0),ball(.27,LEAF,0,.55,0,[1,.9,1]),ball(.16,LEAF2,.1,.7,.05)]},
 flowerPot:{name:'flowering pots',material:'terracotta',shadow:false,clutter:false,parts:()=>[
  cyl(.18,.13,.3,TERRA,0,.15,0),cyl(.2,.2,.04,'#a2582f',0,.3,0),ball(.2,LEAF2,0,.43,0,[1,.7,1]),
  ...[0,1,2,3,4].map(i=>ball(.07,BLOOMS[i%5],Math.cos(i*1.26)*.13,.53+(i%2)*.04,Math.sin(i*1.26)*.13))]},
 windowBox:{name:'window flower boxes',material:'wood',shadow:false,clutter:false,parts:()=>[
  box(1,.2,.2,'#7d5638',0,0,0),box(1.04,.03,.22,DWOOD,0,.1,0),box(.04,.12,.16,IRON,-.38,-.14,-.03),box(.04,.12,.16,IRON,.38,-.14,-.03),
  ...[-.36,-.18,0,.18,.36].map((x,i)=>ball(.08,BLOOMS[(i*2)%5],x,.17+(i%2)*.03,.02)),ball(.13,LEAF,-.27,.12,0,[1,.6,.8]),ball(.13,LEAF2,.05,.12,0,[1,.6,.8]),ball(.13,LEAF,.3,.12,0,[1,.6,.8])]},
 picket:{name:'picket fence runs',material:'painted',shadow:false,clutter:true,parts:()=>[
  box(2,.06,.03,'#f2efe6',0,.3,0),box(2,.06,.03,'#f2efe6',0,.68,0),
  ...Array.from({length:10},(_,i)=>box(.08,.86,.025,'#f6f3ea',-.9+i*.2,.43,.025)),box(.08,.95,.08,'#e6e1d4',-1,.475,-.01)]},
 gate:{name:'garden gates',material:'painted',shadow:false,clutter:true,parts:()=>[
  box(.1,1.05,.1,'#e6e1d4',0,.525,0),box(.1,1.05,.1,'#e6e1d4',1.1,.525,0),
  // one leaf hinged on the left post, swung half open towards +Z
  {g:new THREE.BoxGeometry(.95,.06,.03),c:'#f2efe6',at:[.05+.475*Math.cos(.7),.32,.475*Math.sin(.7)],rot:[0,-.7,0]},{g:new THREE.BoxGeometry(.95,.06,.03),c:'#f2efe6',at:[.05+.475*Math.cos(.7),.72,.475*Math.sin(.7)],rot:[0,-.7,0]},
  ...[.1,.3,.5,.7,.9].map(t=>({g:new THREE.BoxGeometry(.08,.86,.025),c:'#f6f3ea',at:[.05+t*Math.cos(.7),.45,t*Math.sin(.7)] as [number,number,number],rot:[0,-.7,0] as [number,number,number]}))]},
 doormat:{name:'doormats',material:'cloth',shadow:false,clutter:true,parts:()=>[box(.95,.025,.58,'#8a6a3e',0,.0125,0),box(.7,.027,.36,'#a5824f',0,.0135,0)]},
 signpost:{name:'wayfinding signposts',material:'wood',shadow:true,clutter:false,parts:()=>[
  box(.1,2.5,.1,'#5e4630',0,1.25,0),cone(.09,.14,'#3f3a33',0,2.57,0,4,[0,Math.PI/4,0]),
  box(.72,.17,.035,'#efe2c0',.4,2.18,.06),cone(.12,.14,'#efe2c0',.82,2.18,.06,3,[0,0,-Math.PI/2]),
  box(.035,.17,.68,'#d9e6d0',.06,1.94,.38),cone(.12,.14,'#d9e6d0',.06,1.94,.78,3,[Math.PI/2,0,0]),
  box(.72,.17,.035,'#efd9c9',-.4,1.7,-.06),cone(.12,.14,'#efd9c9',-.82,1.7,-.06,3,[0,0,Math.PI/2])]},
 bikeRack:{name:'bike racks',material:'metal',shadow:false,clutter:true,parts:()=>[
  box(2.2,.04,.12,'#5c625f',0,.02,0),...[-.8,0,.8].flatMap(x=>[box(.05,.72,.05,'#7d8783',x,.38,-.28),box(.05,.72,.05,'#7d8783',x,.38,.28),box(.05,.05,.6,'#7d8783',x,.75,0)])]},
 bike:{name:'parked bicycles',material:'metal',shadow:false,clutter:true,parts:()=>[
  ring(.32,.03,'#262626',0,.33,-.52,[0,Math.PI/2,0]),ring(.32,.03,'#262626',0,.33,.52,[0,Math.PI/2,0]),
  box(.04,.04,.62,'#ffffff',0,.62,.08,[.12,0,0]),box(.04,.5,.04,'#ffffff',0,.5,-.22,[-.25,0,0]),box(.04,.04,.55,'#ffffff',0,.36,-.25,[0,0,0]),box(.04,.5,.04,'#ffffff',0,.5,.4,[.35,0,0]),
  box(.03,.42,.03,'#ffffff',0,.5,-.4,[.7,0,0]),box(.12,.05,.24,'#2b2b2b',0,.82,-.28),box(.5,.03,.03,'#2b2b2b',0,.92,.48),box(.03,.32,.03,'#555555',0,.77,.48)]},
 porchChair:{name:'porch chairs',material:'wood',shadow:false,clutter:false,parts:()=>[
  box(.6,.05,.55,WOOD,0,.4,0),...[[-.26,-.22],[.26,-.22],[-.26,.22],[.26,.22]].map(([x,z])=>box(.05,.4,.05,DWOOD,x,.2,z)),
  box(.6,.5,.04,WOOD,0,.7,-.28,[-.2,0,0]),box(.07,.04,.55,DWOOD,-.31,.62,0),box(.07,.04,.55,DWOOD,.31,.62,0),box(.05,.22,.05,DWOOD,-.31,.5,.22),box(.05,.22,.05,DWOOD,.31,.5,.22)]},
 wheelieBin:{name:'wheelie bins',material:'painted',shadow:false,clutter:false,parts:()=>[
  box(.56,.9,.64,'#ffffff',0,.5,0),box(.6,.05,.7,'#ffffff',0,.97,.02),box(.6,.06,.06,'#3a3a3a',0,.92,-.34),cyl(.09,.09,.05,'#202020',-.25,.09,-.3,8,[0,0,Math.PI/2]),cyl(.09,.09,.05,'#202020',.25,.09,-.3,8,[0,0,Math.PI/2])]},
 noticeBoard:{name:'notice boards',material:'wood',shadow:true,clutter:false,parts:()=>[
  box(.1,1.9,.1,DWOOD,-.7,.95,0),box(.1,1.9,.1,DWOOD,.7,.95,0),box(1.3,.9,.06,'#8b6a48',0,1.35,.03),box(1.2,.8,.02,'#c9a77a',0,1.35,.065),
  box(1.6,.06,.4,'#5a4a3a',0,1.93,.02,[.25,0,0]),
  box(.26,.32,.01,'#f4f1e8',-.35,1.48,.08),box(.22,.18,.01,'#f0d36a',.05,1.55,.08),box(.3,.22,.01,'#e9eef0',.36,1.4,.08),box(.2,.26,.01,'#a9cfe0',-.05,1.2,.08),box(.24,.16,.01,'#f2b8a0',.33,1.12,.08)]},
 bollard:{name:'bollards',material:'stone',shadow:false,clutter:false,parts:()=>[cyl(.11,.13,.75,'#b8b2a5',0,.375,0),cyl(.12,.11,.06,'#9c968a',0,.78,0),cyl(.115,.115,.04,'#4a4f4d',0,.62,0)]},
 banner:{name:'lamp post banners',material:'cloth',shadow:false,clutter:true,parts:()=>[
  box(.42,.02,.02,IRON,.21,2.92,0),box(.42,.02,.02,IRON,.21,2.02,0),box(.38,.88,.012,'#ffffff',.23,2.47,0),box(.38,.08,.014,'#f1e6cf',.23,2.12,0)]},
 planterBox:{name:'raised planters',material:'wood',shadow:false,clutter:false,parts:()=>[
  box(1.4,.5,.6,'#8a6040',0,.25,0),box(1.46,.05,.66,DWOOD,0,.5,0),ball(.3,LEAF,-.4,.62,0,[1,.8,1]),ball(.34,LEAF2,.05,.66,0,[1,.85,1]),ball(.28,LEAF,.45,.6,0,[1,.8,1]),
  ...[-.55,-.2,.2,.5].map((x,i)=>ball(.07,BLOOMS[(i+1)%5],x,.86,.12))]},
 crate:{name:'wooden crates',material:'wood',shadow:false,clutter:false,parts:()=>[
  box(.55,.45,.45,'#a47a4c',0,.225,0),box(.57,.06,.47,'#7f5a36',0,.08,0),box(.57,.06,.47,'#7f5a36',0,.37,0),ball(.1,'#d24a3a',-.12,.47,.05),ball(.1,'#e88a3a',.08,.48,-.06),ball(.1,'#c43b2e',.13,.47,.1)]},
 barrel:{name:'barrels',material:'wood',shadow:false,clutter:false,parts:()=>[
  cyl(.27,.25,.85,'#8c5f3a',0,.425,0,10),cyl(.285,.285,.05,'#3b3a36',0,.2,0,10),cyl(.285,.285,.05,'#3b3a36',0,.65,0,10),cyl(.245,.245,.02,'#6b4a2f',0,.855,0,10)]},
 // WP2: yards, gardens, farm and market clutter, transit furniture --------------------------
 laundryLine:{name:'laundry lines',material:'cloth',shadow:false,clutter:true,parts:()=>[
  box(.07,1.9,.07,'#8a6a4a',-1.8,.95,0),box(.07,1.9,.07,'#8a6a4a',1.8,.95,0),box(.5,.05,.05,'#8a6a4a',-1.8,1.85,0),box(.5,.05,.05,'#8a6a4a',1.8,1.85,0),
  box(3.6,.012,.012,'#d8d4c8',0,1.8,0),
  box(.55,.7,.015,'#e9eef0',-1.2,1.43,0),box(.45,.55,.015,'#c96f4a',-.55,1.51,0),box(.6,.45,.015,'#7fa7c9',.1,1.56,0),box(.3,.5,.015,'#f1c84b',.6,1.53,0),box(.5,.62,.015,'#f4f1e8',1.15,1.48,0),
  box(.12,.04,.04,'#e0d9c8',-1.35,1.79,0),box(.12,.04,.04,'#e0d9c8',-.3,1.79,0),box(.12,.04,.04,'#e0d9c8',.8,1.79,0)]},
 gardenTable:{name:'garden tables with parasols',material:'wood',shadow:true,clutter:false,parts:()=>[
  cyl(.5,.5,.04,'#a47a4c',0,.72,0,10),cyl(.04,.04,.7,'#4a4f4d',0,.36,0,6),cyl(.28,.32,.04,'#4a4f4d',0,.02,0,8),
  cyl(.02,.02,1.6,'#d8d4c8',0,1.52,0,5),cone(1.15,.45,'#e4dccb',0,2.2,0,8),cyl(.03,.03,.08,'#d8d4c8',0,2.45,0,5),
  ...[0,1,2].map(i=>box(.36,.04,.36,'#8a6a4a',Math.cos(i*2.1)*.82,.45,Math.sin(i*2.1)*.82)),...[0,1,2].map(i=>box(.36,.38,.04,'#8a6a4a',Math.cos(i*2.1)*1.0,.62,Math.sin(i*2.1)*1.0,[0,-i*2.1+Math.PI/2,0]))]},
 compost:{name:'compost bins',material:'wood',shadow:false,clutter:false,parts:()=>[
  ...[0,1,2,3].map(i=>box(1.0,.12,.04,'#7d5a3a',0,.12+i*.2,-.48)),...[0,1,2,3].map(i=>box(.04,.12,1.0,'#7d5a3a',-.48,.12+i*.2,0)),...[0,1,2,3].map(i=>box(.04,.12,1.0,'#7d5a3a',.48,.12+i*.2,0)),
  ...[0,1].map(i=>box(1.0,.12,.04,'#7d5a3a',0,.12+i*.2,.48)),box(.92,.5,.92,'#4a3826',0,.25,0),ball(.3,'#6d7a3a',.1,.52,.05,[1,.4,1]),ball(.2,'#8a6a3a',-.2,.5,-.15,[1,.4,1])]},
 wheelbarrow:{name:'wheelbarrows',material:'metal',shadow:false,clutter:false,parts:()=>[
  {g:new THREE.CylinderGeometry(.42,.3,.3,4,1),c:'#4f7d8a',at:[0,.55,.05],rot:[0,Math.PI/4,0],s:[1,1,1.35]},cyl(.18,.18,.07,'#262626',0,.18,.62,8,[0,0,Math.PI/2]),
  box(.04,.04,1.3,'#6b4a2f',-.22,.45,-.1,[.15,0,0]),box(.04,.04,1.3,'#6b4a2f',.22,.45,-.1,[.15,0,0]),box(.04,.3,.04,'#4a4f4d',-.22,.18,-.35),box(.04,.3,.04,'#4a4f4d',.22,.18,-.35),ball(.18,'#5a4632',0,.68,.05,[1.2,.4,1.4])]},
 firewood:{name:'firewood stacks',material:'wood',shadow:false,clutter:false,parts:()=>[
  ...[0,1,2].flatMap(r=>Array.from({length:6-r},(_,i)=>cyl(.09,.09,.6,i%2?'#8c6a48':'#9c7a52',-.5+r*.09+i*.19,.09+r*.165,0,6,[Math.PI/2,0,0]))),
  box(.06,.62,.06,'#5e4630',-.66,.31,0),box(.06,.62,.06,'#5e4630',.66,.31,0),box(1.5,.04,.7,'#4a4f4d',0,.68,0,[.08,0,0])]},
 trough:{name:'water troughs',material:'stone',shadow:false,clutter:false,parts:()=>[
  box(1.6,.5,.12,'#9c968a',0,.25,-.29),box(1.6,.5,.12,'#9c968a',0,.25,.29),box(.12,.5,.7,'#9c968a',-.74,.25,0),box(.12,.5,.7,'#9c968a',.74,.25,0),box(1.5,.06,.6,'#8c867a',0,.03,0),
  box(1.46,.02,.5,'#5d8fa6',0,.42,0)]},
 sack:{name:'grain sacks',material:'cloth',shadow:false,clutter:false,parts:()=>[
  {g:new THREE.IcosahedronGeometry(.3,1),c:'#c9b38a',at:[0,.26,0],s:[1,.95,.75]},cone(.14,.16,'#bfa77c',0,.58,0,6),box(.2,.03,.03,'#7a6a4a',0,.5,0)]},
 chalkboard:{name:'chalkboard A-frames',material:'wood',shadow:false,clutter:false,parts:()=>[
  box(.56,.8,.03,'#2d3330',0,.45,.15,[-.32,0,0]),box(.62,.86,.025,'#7d5a3a',0,.45,.125,[-.32,0,0]),box(.56,.8,.03,'#2d3330',0,.45,-.15,[.32,0,0]),box(.62,.86,.025,'#7d5a3a',0,.45,-.125,[.32,0,0])]},

 toys:{name:'children\'s toys',material:'painted',shadow:false,clutter:true,parts:()=>[
  ball(.12,'#e8473a',0,.12,0),cyl(.11,.08,.16,'#3a8fd9',.45,.08,.15,8),box(.16,.03,.1,'#f1c84b',.45,.17,.24,[.4,0,0]),
  box(.42,.12,.2,'#f1c84b',-.35,.12,.3),box(.16,.12,.18,'#2e9e5a',-.25,.24,.3),cyl(.06,.06,.22,'#262626',-.48,.06,.3,6,[Math.PI/2,0,0]),cyl(.06,.06,.22,'#262626',-.22,.06,.3,6,[Math.PI/2,0,0]),
  ring(.18,.02,'#e86aa8',.1,.02,-.35,[Math.PI/2,0,0])]},
 steppingStone:{name:'stepping stones',material:'stone',shadow:false,clutter:true,parts:()=>[
  {g:new THREE.CylinderGeometry(.27,.29,.04,7),c:'#a8a294',at:[0,.02,0],s:[1,1,.8]},{g:new THREE.CylinderGeometry(.24,.26,.04,7),c:'#9c968a',at:[.08,.02,.62],s:[.9,1,1]},{g:new THREE.CylinderGeometry(.26,.27,.04,7),c:'#b0aa9c',at:[-.05,.02,1.24],s:[1,1,.85]}]},
 gardenBed:{name:'raised garden beds',material:'wood',shadow:false,clutter:false,parts:()=>[
  box(2.0,.3,.08,'#7d5a3a',0,.15,-.56),box(2.0,.3,.08,'#7d5a3a',0,.15,.56),box(.08,.3,1.2,'#7d5a3a',-.96,.15,0),box(.08,.3,1.2,'#7d5a3a',.96,.15,0),box(1.86,.24,1.06,'#4a3826',0,.12,0),
  ...[-.7,-.25,.2,.65].flatMap((x,i)=>[ball(.16,i%2?LEAF2:LEAF,x,.36,-.25,[1,.8,1]),ball(.14,i%2?LEAF:LEAF2,x+.1,.34,.25,[1,.8,1])]),ball(.07,'#d24a3a',-.6,.48,-.22),ball(.07,'#d24a3a',.3,.46,.27),ball(.07,'#f1c84b',-.15,.47,.22)]},
 hedge:{name:'clipped hedges',material:'foliage',shadow:false,clutter:false,parts:()=>[
  box(2,.9,.6,'#3f6e33',0,.45,0),box(1.9,.08,.5,'#4c7f3c',0,.94,0),ball(.3,'#477a38',-.6,.9,.05,[1,.4,1]),ball(.3,'#3f6e33',.5,.9,-.05,[1,.4,1])]},
 lowWall:{name:'dry stone low walls',material:'stone',shadow:false,clutter:false,parts:()=>[
  box(2,.55,.45,'#a39b8c',0,.275,0),box(2.04,.08,.5,'#8f887a',0,.59,0),...[-.7,-.2,.35,.8].map((x,i)=>box(.32,.14,.04,i%2?'#b3ab9b':'#958d7e',x,.18+(i%2)*.18,.235))]},
 leaves:{name:'fallen leaves and litter',material:'foliage',shadow:false,clutter:true,parts:()=>[
  ...[[0,0],[.3,.2],[-.25,.3],[.15,-.3],[-.35,-.15],[.45,-.1],[-.1,.5]].map(([x,z],i)=>({g:new THREE.CircleGeometry(.07,4),c:['#c98b3a','#b5652e','#d9b24a','#8a6a3a'][i%4],at:[x,.012,z] as [number,number,number],rot:[-Math.PI/2,0,i] as [number,number,number],s:[1.4,1,1] as [number,number,number]})),
  box(.09,.005,.06,'#e9e6dc',.6,.01,.35,[0,.4,0])]},
 busStop:{name:'bus stop shelters',material:'metal',shadow:true,clutter:false,parts:()=>[
  box(.08,2.4,.08,'#3c4a4f',-1.4,1.2,-.55),box(.08,2.4,.08,'#3c4a4f',1.4,1.2,-.55),box(.08,2.3,.08,'#3c4a4f',-1.4,1.15,.45),box(.08,2.3,.08,'#3c4a4f',1.4,1.15,.45),
  box(3.1,.08,1.4,'#56656b',0,2.42,-.05,[.06,0,0]),box(2.8,1.6,.03,'#a9c7d0',0,1.25,-.55),box(.03,1.6,.9,'#a9c7d0',-1.4,1.25,-.1),
  box(2.0,.05,.38,'#8a6a4a',0,.47,-.32),box(.06,.45,.06,'#3c4a4f',-.8,.23,-.32),box(.06,.45,.06,'#3c4a4f',.8,.23,-.32),
  box(.06,2.6,.06,'#3c4a4f',1.75,1.3,.5),box(.5,.5,.04,'#e2b552',1.75,2.75,.5),box(.5,.7,.02,'#eef0ea',-.5,1.4,-.53)]},
 phoneBox:{name:'telephone box',material:'painted',shadow:true,clutter:false,parts:()=>[
  box(.92,.1,.92,'#8f2a22',0,.05,0),box(.08,2.3,.08,'#c43b2e',-.42,1.2,-.42),box(.08,2.3,.08,'#c43b2e',.42,1.2,-.42),box(.08,2.3,.08,'#c43b2e',-.42,1.2,.42),box(.08,2.3,.08,'#c43b2e',.42,1.2,.42),
  box(.78,2.0,.03,'#bfd6dc',0,1.15,.43),box(.78,2.0,.03,'#bfd6dc',0,1.15,-.43),box(.03,2.0,.78,'#bfd6dc',-.43,1.15,0),box(.03,2.0,.78,'#bfd6dc',.43,1.15,0),
  ...[.55,1.0,1.45,1.9].map(y=>box(.86,.05,.86,'#c43b2e',0,y,0)),box(.96,.22,.96,'#c43b2e',0,2.45,0),{g:new THREE.CylinderGeometry(.5,.5,.96,8,1,false,0,Math.PI),c:'#b8352a',at:[0,2.56,0],rot:[0,0,Math.PI/2],s:[.25,1,1]},
  box(.6,.12,.02,'#f4f1e8',0,2.42,.49),box(.25,.35,.18,'#2b2b2b',0,1.3,-.33)]},
 plaque:{name:'house name plates',material:'painted',shadow:false,clutter:true,parts:()=>[box(.36,.24,.025,'#3a3a3a',0,0,0),box(.3,.18,.03,'#ffffff',0,0,.002)]},
 hangingSign:{name:'hanging shop signs',material:'wood',shadow:false,clutter:true,parts:()=>[
  box(.04,.04,.75,'#2f3633',0,0,.37),box(.03,.3,.03,'#2f3633',0,-.15,.05,[.9,0,0]),box(.012,.12,.012,'#2f3633',0,-.06,.25),box(.012,.12,.012,'#2f3633',0,-.06,.6),
  box(.04,.38,.52,'#ffffff',0,-.31,.43),box(.046,.3,.42,'#f1e6cf',0,-.31,.43)]},

 // WP3: artists, farm and plaza furniture ---------------------------------------------------
 easel:{name:'painters\' easels',material:'wood',shadow:true,clutter:true,parts:()=>[
  box(.04,1.7,.04,'#8a6a4a',-.3,.83,.12,[-.12,0,.12]),box(.04,1.7,.04,'#8a6a4a',.3,.83,.12,[-.12,0,-.12]),box(.04,1.65,.04,'#8a6a4a',0,.8,-.32,[.28,0,0]),
  box(.7,.04,.08,'#7d5a3a',0,.8,.2),box(.66,.52,.03,'#f4f1e8',0,1.1,.17,[-.12,0,0]),box(.4,.18,.032,'#7fa7c9',-.08,1.2,.172,[-.12,0,0]),box(.22,.14,.032,'#e2b552',.14,1.02,.16,[-.12,0,0]),box(.3,.08,.032,'#5f9142',.0,.96,.155,[-.12,0,0])]},
 scarecrow:{name:'scarecrows',material:'cloth',shadow:true,clutter:true,parts:()=>[
  box(.07,1.8,.07,'#6e4a30',0,.9,0),box(1.1,.06,.06,'#6e4a30',0,1.35,0),box(.5,.6,.22,'#7a5c9e',0,1.25,0),box(.95,.16,.16,'#7a5c9e',0,1.4,0),
  ball(.17,'#e3cf9a',0,1.72,0),cyl(.3,.3,.03,'#c9a24b',0,1.84,0,8),cone(.17,.22,'#c9a24b',0,1.96,0,8),box(.1,.18,.1,'#e8d27a',-.52,1.3,0),box(.1,.18,.1,'#e8d27a',.52,1.3,0),box(.42,.3,.2,'#4f6d8a',0,.85,0)]},
 wateringCan:{name:'watering cans',material:'metal',shadow:false,clutter:true,parts:()=>[
  cyl(.11,.12,.24,'#5c8a6a',0,.12,0,8),box(.03,.03,.3,'#5c8a6a',0,.18,.18,[-.7,0,0]),cyl(.035,.02,.05,'#4a4f4d',0,.3,.3,6,[-.7,0,0]),box(.025,.12,.18,'#4a4f4d',0,.3,-.02,[0,0,0])]},
 picnicTable:{name:'picnic tables',material:'wood',shadow:false,clutter:false,parts:()=>[
  box(1.8,.05,.75,'#a47a4c',0,.74,0),box(1.8,.04,.28,'#a47a4c',0,.44,-.62),box(1.8,.04,.28,'#a47a4c',0,.44,.62),
  ...[-.7,.7].flatMap(x=>[box(.07,.95,.07,'#7f5a36',x,.4,-.3,[.62,0,0]),box(.07,.95,.07,'#7f5a36',x,.4,.3,[-.62,0,0]),box(.07,.06,1.5,'#7f5a36',x,.4,0)])]},
 birdhouse:{name:'birdhouses on posts',material:'wood',shadow:true,clutter:true,parts:()=>[
  box(.07,1.7,.07,'#6e4a30',0,.85,0),box(.26,.3,.24,'#d9c39a',0,1.85,0),{g:new THREE.ConeGeometry(.24,.2,4,1),c:'#b8473a',at:[0,2.1,0],rot:[0,Math.PI/4,0],s:[1,1,1]},cyl(.04,.04,.02,'#2b2b2b',0,1.9,.125,8,[Math.PI/2,0,0]),box(.02,.02,.1,'#6e4a30',0,1.8,.16)]},
 beehive:{name:'beehives',material:'painted',shadow:false,clutter:false,parts:()=>[
  box(.5,.12,.5,'#6e4a30',0,.06,0),box(.46,.26,.42,'#f1e2b0',0,.25,0),box(.46,.22,.42,'#e8d27a',0,.49,0),box(.46,.18,.42,'#f1e2b0',0,.69,0),box(.54,.06,.5,'#8c8577',0,.81,0),box(.12,.02,.02,'#3a3a3a',0,.14,.215)]},
 hayBale:{name:'hay bales',material:'foliage',shadow:false,clutter:false,parts:()=>[
  {g:new THREE.CylinderGeometry(.55,.55,1.0,10,1),c:'#d6b65e',at:[0,.55,0],rot:[0,0,Math.PI/2]},{g:new THREE.CylinderGeometry(.5,.5,1.01,10,1),c:'#c9a84f',at:[0,.55,0],rot:[0,0,Math.PI/2]}]},

 // WP4: farm fencing, garden leisure ---------------------------------------------------------
 railFence:{name:'post-and-rail fences',material:'wood',shadow:false,clutter:true,parts:()=>[
  box(.12,1.1,.12,'#6e5236',-1.2,.55,0),box(2.4,.1,.05,'#8a6a48',0,.85,.06),box(2.4,.1,.05,'#83633f',0,.45,.06,[0,0,.02])]},
 birdBath:{name:'bird baths',material:'stone',shadow:false,clutter:false,parts:()=>[
  cyl(.2,.24,.08,'#a8a294',0,.04,0,8),cyl(.08,.11,.6,'#b0aa9c',0,.38,0,8),cyl(.32,.14,.14,'#b8b2a5',0,.75,0,10),cyl(.27,.27,.02,'#7fa9bd',0,.81,0,10)]},
 picnicBlanket:{name:'picnic blankets',material:'cloth',shadow:false,clutter:true,parts:()=>[
  box(1.5,.02,1.2,'#c94a4a',0,.01,0),...[-.5,0,.5].map(x=>box(.12,.022,1.2,'#f4f1e8',x,.011,0)),...[-.35,.1].map(z=>box(1.5,.023,.1,'#f4f1e8',0,.0115,z)),
  box(.4,.25,.28,'#a47a4c',.45,.14,-.3),box(.42,.03,.3,'#8a6a48',.45,.28,-.3),ball(.07,'#c43b2e',-.3,.06,.2),ball(.07,'#e8b83a',-.18,.06,.28)]},
 swing:{name:'swing sets',material:'painted',shadow:true,clutter:true,parts:()=>[
  ...[-1.3,1.3].flatMap(x=>[box(.08,2.3,.08,'#4f7d8a',x,1.12,-.55,[.24,0,0]),box(.08,2.3,.08,'#4f7d8a',x,1.12,.55,[-.24,0,0])]),cyl(.05,.05,2.7,'#4f7d8a',0,2.22,0,6,[0,0,Math.PI/2]),
  ...[-.5,.5].flatMap(x=>[box(.015,1.7,.015,'#b9b3a6',x-.2,1.35,0),box(.015,1.7,.015,'#b9b3a6',x+.2,1.35,0),box(.5,.04,.2,'#c94a4a',x,.5,0)])]},
 sandbox:{name:'sandboxes',material:'wood',shadow:false,clutter:true,parts:()=>[
  box(1.8,.22,.1,'#a47a4c',0,.11,-.85),box(1.8,.22,.1,'#a47a4c',0,.11,.85),box(.1,.22,1.8,'#a47a4c',-.85,.11,0),box(.1,.22,1.8,'#a47a4c',.85,.11,0),box(1.6,.14,1.6,'#e3d3a2',0,.07,0),
  cyl(.1,.08,.14,'#3a8fd9',.3,.2,.2,8),box(.05,.02,.22,'#e8473a',-.25,.15,-.2,[0,.6,0]),ball(.12,'#e3d3a2',-.3,.14,.3,[1,.6,1])]},
 hammock:{name:'hammock stands',material:'cloth',shadow:false,clutter:true,parts:()=>[
  box(3.2,.08,.1,'#7d5a3a',0,.05,0),box(.1,.06,.7,'#7d5a3a',-1.55,.03,0),box(.1,.06,.7,'#7d5a3a',1.55,.03,0),
  box(.08,1.35,.08,'#7d5a3a',-1.3,.66,0,[0,0,-.35]),box(.08,1.35,.08,'#7d5a3a',1.3,.66,0,[0,0,.35]),
  box(.9,.012,.012,'#d8d4c8',-1.13,1.09,0,[0,0,-.48]),box(.9,.012,.012,'#d8d4c8',1.13,1.09,0,[0,0,.48]),
  box(.7,.02,.62,'#3f8f8c',-.4,.8,0,[0,0,-.22]),box(.7,.02,.62,'#3f8f8c',.4,.8,0,[0,0,.22]),box(.5,.022,.6,'#e2b552',0,.74,0)]},

 // WP5: woodland furniture -------------------------------------------------------------------
 logBench:{name:'log benches',material:'wood',shadow:false,clutter:false,parts:()=>[
  {g:new THREE.CylinderGeometry(.22,.22,1.7,8,1,false,0,Math.PI),c:'#8c6a48',at:[0,.38,0],rot:[0,0,Math.PI/2]},box(1.7,.02,.42,'#b08a5e',0,.385,0),
  cyl(.17,.19,.3,'#6e5236',-.55,.15,0,7),cyl(.17,.19,.3,'#6e5236',.55,.15,0,7)]},
 stump:{name:'tree stumps',material:'wood',shadow:false,clutter:false,parts:()=>[cyl(.26,.32,.42,'#6e5236',0,.21,0,8),cyl(.24,.24,.02,'#c9a77a',0,.43,0,8),cyl(.2,.2,.021,'#a8845a',0,.432,0,8),box(.12,.1,.3,'#6e5236',.28,.05,.1,[0,.5,0])]},
 fallenLog:{name:'fallen logs',material:'wood',shadow:false,clutter:false,parts:()=>[
  cyl(.24,.28,3.0,'#7a5a3c',0,.26,0,8,[0,0,Math.PI/2]),cyl(.2,.2,.02,'#c9a77a',1.51,.26,0,8,[0,0,Math.PI/2]),box(.5,.06,.06,'#7a5a3c',.4,.5,.12,[.3,.6,.5]),ball(.12,'#5f7a3a',-.6,.48,0,[1.6,.5,1.2]),ball(.1,'#6d8a40',.3,.47,-.08,[1.4,.5,1])]},
 mushrooms:{name:'mushroom clusters',material:'foliage',shadow:false,clutter:true,parts:()=>[
  ...[[0,0,.1],[.12,.08,.07],[-.1,.1,.06],[.05,-.14,.08],[-.18,-.06,.05]].flatMap(([x,z,h])=>[cyl(.02,.025,h,'#efe6d2',x,h/2,z,5),{g:new THREE.SphereGeometry(h*.7,6,3,0,Math.PI*2,0,Math.PI/2),c:h>.07?'#c0392b':'#d9b38a',at:[x,h,z] as [number,number,number]}])]},

 // WP6: street-name signs (lettering lives in signs.ts) ------------------------------------
 streetSign:{name:'street name signs',material:'metal',shadow:true,clutter:true,parts:()=>[
  cyl(.04,.045,2.7,'#3c4a4f',0,1.35,0,6),cyl(.06,.07,.08,'#3c4a4f',0,.04,0,6),box(.8,.18,.03,'#2f5d48',.44,2.5,0),box(.03,.18,.8,'#2f5d48',0,2.3,.44),
  box(.82,.02,.035,'#e6e1d4',.44,2.6,0),box(.82,.02,.035,'#e6e1d4',.44,2.4,0),box(.035,.02,.82,'#e6e1d4',0,2.4,.44),box(.035,.02,.82,'#e6e1d4',0,2.2,.44)]},


 // WP7: domestic touches -------------------------------------------------------------------
 gnome:{name:'garden gnomes',material:'painted',shadow:false,clutter:true,parts:()=>[
  cyl(.09,.11,.18,'#3a6fb0',0,.09,0,7),cyl(.08,.09,.12,'#c43b2e',0,.24,0,7),ball(.07,'#f0c9a0',0,.35,.01),{g:new THREE.ConeGeometry(.08,.2,7,1),c:'#c43b2e',at:[0,.48,0]},
  {g:new THREE.ConeGeometry(.06,.12,6,1),c:'#f4f1e8',at:[0,.29,.06],rot:[Math.PI,0,0]},box(.16,.04,.1,'#4a3826',0,.02,.03)]},
 rainBarrel:{name:'rain barrels',material:'wood',shadow:true,clutter:false,parts:()=>[
  cyl(.3,.28,.9,'#3f6b45',0,.45,0,10),cyl(.31,.31,.04,'#2b3a30',0,.92,0,10),cyl(.31,.31,.04,'#2b3a30',0,.3,0,10),
  cyl(.035,.035,1.5,'#7d8783',0,1.65,-.24,6),cyl(.035,.035,.24,'#7d8783',0,.98,-.14,6,[.9,0,0]),cyl(.03,.03,.1,'#7d8783',.26,.12,.12,6,[0,0,Math.PI/2])]},
 drapedTowel:{name:'towels drying on rails',material:'cloth',shadow:false,clutter:true,parts:()=>[
  box(.5,.02,.12,'#ffffff',0,.01,0),box(.5,.55,.015,'#ffffff',0,-.27,.065),box(.5,.36,.015,'#ffffff',0,-.18,-.065),box(.5,.04,.017,'#f4f1e8',0,-.5,.065)]},

 // WP8: stall goods ------------------------------------------------------------------------
 produceDisplay:{name:'produce trays on stalls',material:'wood',shadow:false,clutter:true,parts:()=>[
  ...[-.6,0,.6].flatMap((x,i)=>[box(.56,.08,.46,'#a47a4c',x,.04,0),box(.5,.02,.4,'#7d5a3a',x,.05,0)]),
  ...[['#c43b2e','#d24a3a'],['#e8b83a','#f1c84b'],['#5f9142','#7fae4a']].flatMap(([a,b],i)=>Array.from({length:4},(_,k)=>ball(.07,k%2?a:b,-.6+i*.6-.1+(k%2)*.2,.12,-.1+Math.floor(k/2)*.2)))]},
 flowerBuckets:{name:'flower buckets',material:'metal',shadow:false,clutter:true,parts:()=>[
  ...[-.6,-.2,.2,.6].flatMap((x,i)=>[cyl(.13,.1,.24,'#8c9a9e',x,.12,0,6),...[0,1].map(k=>ball(.07,['#d9567a','#f1c84b','#e9eef0','#9a6fd0'][(i+k)%4],x-.04+k*.08,.35+k*.04,(k-.5)*.06)),ball(.1,'#4f7f3a',x,.27,0,[1,.6,1])])]},
};
