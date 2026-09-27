import * as T from 'three';
import {Kit,layers} from './kit';

/** February 16 flythrough: woven silver shade, suspended above an unfloored aisle. */
export function aluminet2021(k:Kit,g:T.Group,width:number,length:number){
 const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;
 const ctx=canvas.getContext('2d')!;ctx.fillStyle='#111';ctx.fillRect(0,0,32,32);ctx.fillStyle='#eee';
 for(let i=0;i<32;i+=8){ctx.fillRect(i,0,3,32);ctx.fillRect(0,i,32,2);}
 const weave=new T.CanvasTexture(canvas);weave.wrapS=weave.wrapT=T.RepeatWrapping;weave.repeat.set(width*9,length*9);
 const geo=new T.PlaneGeometry(width,length,24,96);geo.rotateX(-Math.PI/2);
 const p=geo.getAttribute('position');
 for(let i=0;i<p.count;i++){
  const x=p.getX(i),z=p.getZ(i),crossSag=1-Math.pow(2*x/width,2);
  p.setY(i,4.25-crossSag*(.55+.16*Math.pow(Math.sin(z*Math.PI/3.65),2)));
 }
 geo.computeVertexNormals();
 const mesh=new T.Mesh(geo,new T.MeshStandardMaterial({color:'#b8bebc',metalness:.38,roughness:.75,alphaMap:weave,alphaTest:.4,side:T.DoubleSide}));
 mesh.castShadow=true;mesh.receiveShadow=true;k.tag(g,mesh,'draped silver aluminet',layers.roof);mesh.userData.walkNoCollision=true;
 for(let z=-length/2;z<=length/2+.01;z+=length/6){
  for(const side of [-1,1])k.rod(g,'aluminet tie',[side*width/2,4.25,z],[side*(width/2+.3),4.65,z],.012,'#a1a39d',layers.roof);
 }
}

/** March 4 frontage + January 29 oblique: raked cladding, not detached solar wings. */
export function frontage2024(k:Kit,g:T.Group,w:number,d:number){
 const rise=4.64,run=2.65,slant=Math.hypot(rise,run),front=new T.Group();
 front.userData={...g.userData,layer:layers.wall};front.position.set(0,.22,d/2+run);front.rotation.x=-Math.atan2(run,rise);g.add(front);
 const red=k.photo('/history/2024/red-wall.webp'),orange=k.photo('/history/2024/orange-wall.webp');
 // Side fields and top mural. Leave a genuine ground-level doorway below the landing.
 for(const side of [-1,1]){
  k.box(front,'painted frontage side',[w/2-1.5,slant,.06],[side*(w/4+.75),slant/2,0],red,layers.wall);
  k.box(front,'upper orange mural',[3.65,2.05,.025],[side*3.48,slant-1.025,.045],orange,layers.wall);
 }
 k.box(front,'central flower mural',[3.25,2.0,.06],[0,slant-1,.04],k.photo('/history/2024/flower.webp'),layers.wall);
 // Photographic array silhouette: two broad upper rows, narrower lower rows,
 // a clear strip, and exposed red base. No PV on the right-hand wing.
 const canvas=document.createElement('canvas');canvas.width=128;canvas.height=64;
 const ctx=canvas.getContext('2d')!;ctx.fillStyle='#20384b';ctx.fillRect(0,0,128,64);ctx.strokeStyle='#69808e';ctx.lineWidth=.8;
 for(let x=0;x<=128;x+=128/12){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,64);ctx.stroke();}
 for(let y=0;y<=64;y+=64/6){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(128,y);ctx.stroke();}
 const cells=new T.CanvasTexture(canvas);cells.colorSpace=T.SRGBColorSpace;cells.anisotropy=4;
 const pv=new T.MeshStandardMaterial({map:cells,metalness:.25,roughness:.4});
 const panel=(x:number,y:number,pw:number,ph:number)=>{
  k.box(front,'solar panel',[pw,ph,.07],[x,y,.1],k.mat('#bcc1bf',.55),layers.roof);
  k.box(front,'photovoltaic cells',[pw-.06,ph-.06,.008],[x,y,.14],pv,layers.roof);
 };
 const left=-w/2;
 for(const y of [slant-1.0,slant-2.03])for(let c=0;c<4;c++)panel(left+.91+c*1.84,y,1.81,.98);
 for(const y of [slant-3.06,.90])for(let c=0;c<2;c++)panel(left+.91+c*1.84,y,1.81,.93);
 const glass=new T.MeshStandardMaterial({color:'#97aaa7',transparent:true,opacity:.33,metalness:.2,roughness:.35,side:T.DoubleSide,depthWrite:false});
 const window=(x:number,y:number,ww:number,hh:number)=>{
  k.box(front,'salvaged window backing',[ww,hh,.02],[x,y,.075],'#414d49',layers.wall);
  k.box(front,'salvaged glazing',[ww-.06,hh-.06,.018],[x,y,.12],glass,layers.wall);
  for(const side of [-1,1]){k.box(front,'window frame',[.045,hh,.065],[x+side*ww/2,y,.14],'#c8c2a8',layers.wall);k.box(front,'window frame',[ww,.045,.065],[x,y+side*hh/2,.14],'#c8c2a8',layers.wall);}
 };
 // Reused windows are deliberately varied in shape; the red surround remains visible.
 for(let c=0;c<4;c++)window(5.0+c*1.55,slant-1.9,1.5,.93);
 for(let c=0;c<5;c++)window(4.1+c*1.43,slant-2.87,1.37,.9);
 for(let c=0;c<5;c++)window(4.1+c*1.43,slant-3.79,1.37,.84);
 window(left+1.8,1.68,3.55,.49);
 k.box(front,'painted eye window insert',[1.36,.9,.03],[6.96,slant-2.87,.18],k.photo('/history/2024/eye.webp'),layers.wall);
 // Vertical entry beneath the stair landing (not painted over with an opaque wall).
 k.wall(g,.75,2.05,-.96,d/2+.10,1.27,'#d09c42');
 k.box(g,'Chiba entry sign',[2.8,.6,.06],[0,2.5,d/2+.13],k.photo('/history/2024/entry.webp'),layers.wall);
}
