import type {SceneInfo} from './WorldGeometry.ts';
/** Heights from the selected recorded ground publication. Native terrain wins
 * over its flat clearance surface; level>0 platforms never become ground. This
 * is a decoration sampler, not a physics admission or a current-world lookup. */
export function publishedGroundSampler(info?:Pick<SceneInfo,'scene'|'shore'>){
 const terrain=info?.shore?.metadata.terrain,surfaces=info?.scene?.surfaces.filter(s=>s.level===0)??[];
 return (x:number,z:number):number|null=>{
  if(!Number.isFinite(x)||!Number.isFinite(z))return null;
  if(terrain){const {originXZ,spacingMetres:step,columns,rows,heightMetres:h}=terrain,u=(x-originXZ[0])/step,v=(z-originXZ[1])/step;
   if(u>=0&&v>=0&&u<=columns-1&&v<=rows-1){const i=Math.min(columns-2,Math.floor(u)),j=Math.min(rows-2,Math.floor(v)),a=Math.fround(h[j][i]),b=Math.fround(h[j][i+1]),c=Math.fround(h[j+1][i+1]),d=Math.fround(h[j+1][i]),fx=u-i,fz=v-j;
    return fz<=fx?a+(b-a)*fx+(c-b)*fz:a+(c-d)*fx+(d-a)*fz;
   }
  }
  let top:number|null=null;for(const s of surfaces){const dx=x-s.obb.c[0],dz=z-s.obb.c[1],cs=Math.cos(s.obb.yaw),sn=Math.sin(s.obb.yaw),lx=dx*cs+dz*sn,lz=-dx*sn+dz*cs;if(Math.abs(lx)<=s.obb.half[0]&&Math.abs(lz)<=s.obb.half[1]&&(top===null||s.y>top))top=s.y;}return top;
 };
}
