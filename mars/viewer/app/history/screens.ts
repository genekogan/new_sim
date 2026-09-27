import * as T from 'three';
import {screenIds,type SimState} from '../../simulation/shared';
/** The shared screen channels address physical display groups in every year. */
export function createHistoricalScreens(root:T.Group){
 const screens:{mesh:T.Mesh;material:T.MeshBasicMaterial;original:T.Texture|null;canvas:HTMLCanvasElement;texture:T.CanvasTexture;title:string;id:string}[]=[];
 root.traverse(o=>{if(!(o instanceof T.Mesh)||!(o.name==='Portal TV screen'||o.name==='display content'))return;
  const material=(o.material as T.MeshBasicMaterial).clone();o.material=material;o.userData.dynamicScreen=true;
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=288;
  const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
  const id=screenIds[screens.length%screenIds.length];o.userData.screen_id=id;
  screens.push({mesh:o,material,original:material.map,canvas,texture,title:'\0',id});
 });
 return {update(state:SimState|null,_time:number,_cut:string){for(const s of screens){const v=state?.screens?.[s.id];s.material.color.setScalar(v?(v.enabled?v.brightness:0):1);
  if(v?.enabled&&v.program==='test'){if(s.title!=='__test__'){const c=s.canvas.getContext('2d')!;['#eee','#eeee10','#10dddd','#10dd10','#dd10dd','#dd1010','#1010dd'].forEach((color,i)=>{c.fillStyle=color;c.fillRect(i*512/7,0,512/7+1,288);});s.texture.needsUpdate=true;s.title='__test__';}s.material.map=s.texture;}else if(v?.enabled&&v.program==='talk'){if(s.title!==v.title){const c=s.canvas.getContext('2d')!;c.fillStyle='#182a33';c.fillRect(0,0,512,288);c.fillStyle='#e8e2c9';c.font='22px sans-serif';c.fillText('MARS COLLEGE',24,40);c.font='26px sans-serif';const words=v.title.match(/.{1,30}(?:\s|$)/g)||[v.title.slice(0,30)];words.slice(0,5).forEach((line,i)=>c.fillText(line.trim(),24,98+i*34));s.texture.needsUpdate=true;s.title=v.title;}s.material.map=s.texture;}else s.material.map=s.original;
 }},dispose(){for(const s of screens){s.texture.dispose();s.material.dispose();}}};
}
