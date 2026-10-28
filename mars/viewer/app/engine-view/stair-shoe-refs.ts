import type * as THREE from 'three';
import type {Rig} from './people.ts';
import type {Leg} from './rig.ts';
type Refs={mesh:THREE.SkinnedMesh;idx:number[]}[];
/** The composed kit owns a semantic shoes mesh. Include its shin-weighted boot
 * vertices too; validate each positive weight against exactly one actual leg
 * chain instead of inferring a side from a material, vertex order or world X. */
export function stairShoeRefs(rig:Rig,legs:readonly Leg[]):{refs:Map<number,Refs>;vertices:number;complete:boolean}|null{
  if(!rig.template.gltf.scene.userData.humanoid)return null;
  const chains=legs.map(leg=>{const nodes=new Set<THREE.Object3D>();leg.upper.traverse(o=>nodes.add(o));leg.foot.traverse(o=>nodes.add(o));return {side:leg.side,nodes};});
  const validChains=legs.length===2&&new Set(legs.map(l=>l.side)).size===2&&legs.every(l=>(l.side===1||l.side===-1)&&l.lower.parent===l.upper&&l.upper.parent?.name==='Body'&&l.foot.parent?.name==='Root')&&chains.every((c,i)=>[...c.nodes].every(n=>!chains[1-i].nodes.has(n)));
  const refs=new Map<number,Refs>();let vertices=0,complete=validChains;
  rig.model.traverse(o=>{
    const mesh=o as THREE.SkinnedMesh;if(!mesh.isSkinnedMesh||mesh.name!=='shoes')return;
    const si=mesh.geometry.getAttribute('skinIndex'),sw=mesh.geometry.getAttribute('skinWeight'),count=mesh.geometry.getAttribute('position')?.count??0;
    if(!si||!sw){complete=false;return;}
    const bySide=new Map<number,number[]>();
    for(let i=0;i<count;i++){
      vertices++;const sides=new Set<number>();let total=0;
      for(let j=0;j<4;j++){
        const w=sw.getComponent(i,j),index=si.getComponent(i,j);
        if(!Number.isFinite(w)||w<0||!Number.isInteger(index)||index<0||index>=mesh.skeleton.bones.length){complete=false;continue;}
        if(w<=1e-6)continue;total+=w;
        const bone=mesh.skeleton.bones[index],owners=chains.filter(c=>c.nodes.has(bone));
        if(owners.length!==1){complete=false;continue;}sides.add(owners[0].side);
      }
      if(sides.size!==1||Math.abs(total-1)>.01){complete=false;continue;}
      const side=[...sides][0],indices=bySide.get(side)??[];indices.push(i);bySide.set(side,indices);
    }
    for(const [side,idx] of bySide){const rows=refs.get(side)??[];rows.push({mesh,idx});refs.set(side,rows);}
  });
  return {refs,vertices,complete:complete&&vertices>0&&legs.every(l=>refs.has(l.side))};
}
