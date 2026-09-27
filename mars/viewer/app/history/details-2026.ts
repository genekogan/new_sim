import * as T from 'three';
import {Kit,layers} from './kit';
/** Movable details from 2026 kitchen/café ground photos. Room registration uses the
 * existing CAD origin [177,66,0]; hidden dimensions remain photographic estimates. */
export function add2026Details(root:T.Group){
 const k=new Kit(2026);
 const kitchen=k.assembly('kitchen-details','Kitchen · appliances and supplies',[-9.2,0,-9.1],-.44,'2026 kitchen IMG_3472, DSCF1559 and DSCF1563; room placement from archived CAD');
 k.box(kitchen,'full-height refrigerator',[.79,1.85,.77],[1.2,.96,2.1],'#dbddd5');
 k.box(kitchen,'freezer seam',[.77,.014,.022],[1.2,1.48,2.5],'#7d8785');for(const y of [1,1.65])k.box(kitchen,'refrigerator handle',[.025,.22,.04],[.92,y,2.52],'#858e8c');
 k.table(kitchen,.4,-.5,1.4,2.0,.92);
 k.box(kitchen,'stainless prep surface',[1.4,.03,2],[.4,.951,-.5],k.mat('#a3b1b1',.72));
 k.box(kitchen,'prep table backsplash',[1.4,.22,.025],[.4,1.07,-1.48],k.mat('#a3b1b1',.72));
 for(let i=0;i<4;i++)k.box(kitchen,'stored carton',[.42,.34,.48],[-.05+(i%2)*.6,.38,-.9+Math.floor(i/2)*.7],'#ac9b7e');
 k.box(kitchen,'pan pegboard',[.04,1.25,1.65],[1.72,1.65,-1.52],'#a78e64');
 const pan=new T.CylinderGeometry(.16,.14,.06,14);for(let i=0;i<6;i++){const o=new T.Mesh(pan,k.mat(i%2?'#41484a':'#9ba2a1',.6));o.rotation.z=Math.PI/2;o.position.set(1.65,1.45+Math.floor(i/3)*.39,-2+(i%3)*.46);k.tag(kitchen,o,'hanging pan',layers.detail);k.rod(kitchen,'pan handle',[1.65,o.position.y+.12,o.position.z],[1.65,o.position.y+.35,o.position.z],.02,'#343d3f',layers.detail);}
 for(let s=0;s<2;s++){k.box(kitchen,'spice shelf',[.27,.045,2.5],[-1.7,1.48+s*.36,-.5]);for(let i=0;i<12;i++)k.box(kitchen,'spice jar',[.09,.13+(i%3)*.025,.09],[-1.7,1.57+s*.36,-1.65+i*.21],['#a5854b','#ded6b3','#83927b','#9b4c32'][i%4]);}
 const bucket=new T.Mesh(new T.CylinderGeometry(.16,.14,.36,12),k.mat('#c2672e'));bucket.position.set(.75,.3,-.8);k.tag(kitchen,bucket,'orange utility bucket',layers.detail);
 const cafe=k.assembly('mimos-details','Mimos · coffee counter',[9,0,10.5],-.44,'2026 Mimos DSCF0863 and DSCF0897; furniture dimensions estimated');
 k.table(cafe,0,0,2.5,.65,.92);k.box(cafe,'coffee machine',[.38,.52,.36],[-.65,1.19,0],'#252d2e');k.box(cafe,'coffee machine metal front',[.31,.3,.018],[-.65,1.22,.19],k.mat('#a4adad',.6));k.box(cafe,'coffee grinder',[.18,.36,.22],[-.22,1.1,0],'#353c39');
 for(let i=0;i<6;i++)k.box(cafe,'café cup',[.085,.11,.085],[.2+i*.15,1,0],'#c9b999');
 const sign=document.createElement('canvas');sign.width=512;sign.height=128;const ctx=sign.getContext('2d')!;ctx.fillStyle='#9a724e';ctx.fillRect(0,0,512,128);ctx.font='bold 78px sans-serif';ctx.fillStyle='#ede7d5';ctx.fillText('MIMOS',35,92);const texture=new T.CanvasTexture(sign);texture.colorSpace=T.SRGBColorSpace;k.box(cafe,'MIMOS sign',[1.7,.43,.025],[0,2.05,-.29],new T.MeshStandardMaterial({map:texture}),layers.detail);
 k.finalize();const chiba=root.getObjectByName('Chiba')||root;chiba.add(...k.root.children);return [kitchen,cafe];
}
