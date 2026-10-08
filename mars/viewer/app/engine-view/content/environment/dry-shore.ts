// Separate original dry-grove study for the pinned shoreline proposal. No installation.
import { designHeightAt, type ShoreDesign } from '../../shore-preview.ts';
import { VegetationViews, type VegetationPlacement, type VegetationKind } from '../../vegetation.ts';
import { commonsPlantFits, type ContentView } from './commons.ts';
type Candidate={kind:VegetationKind;x:number;z:number;w:number;h:number;d:number;seed:number};
type Rejection={id:string;reason:'bounds-or-commons-clearance'|'wet-envelope'|'root-not-dry'};
/** Deliberately supports the bounded rectangular proposal only. This is visual
 * preflight, not Core schema/traversability validation. Inspect before allocation. */
function preflight(design:ShoreDesign) {
  const t=design?.terrain,w=design?.water;
  if(!t||!Array.isArray(t.originXZ)||t.originXZ.length!==2||!t.originXZ.every(Number.isFinite)||
    !Number.isFinite(t.spacingMetres)||t.spacingMetres<=0||t.spacingMetres>32||
    !Number.isInteger(t.columns)||!Number.isInteger(t.rows)||t.columns<2||t.rows<2||t.columns>129||t.rows>129||
    !Array.isArray(t.heightMetres)||t.heightMetres.length!==t.rows||Array.from(t.heightMetres).some(row=>!Array.isArray(row)||row.length!==t.columns||Array.from(row).some(y=>typeof y!=='number'||!Number.isFinite(y)||Math.abs(y)>10000))||
    t.originXZ[0]!==-16||t.originXZ[1]!==-12||t.originXZ[0]+(t.columns-1)*t.spacingMetres!==16||t.originXZ[1]+(t.rows-1)*t.spacingMetres!==12)throw Error('Invalid bounded dry-shore terrain');
  const p=w?.wetDomain?.closedPolygonXZ;
  if(!w||!Number.isFinite(w.datumY)||Math.abs(w.datumY)>10000||!Array.isArray(p)||p.length!==5||p.some(v=>!Array.isArray(v)||v.length!==2||v.some(n=>typeof n!=='number'||!Number.isFinite(n)))||p[0][0]!==p[4][0]||p[0][1]!==p[4][1])throw Error('Unknown or nonrectangular dry-shore water');
  const corners=new Set(p.slice(0,4).map(v=>v.join(',')));
  if(corners.size!==4||!['-16,-12','0,-12','0,12','-16,12'].every(c=>corners.has(c))||p.slice(0,4).some((v,i)=>{const next=p[i+1];return (v[0]===next[0])===(v[1]===next[1]);}))throw Error('Unknown or nonrectangular dry-shore water');
}
const treeAnchors:readonly [number,number,number,number][]=[
  [3.3,-8.8,2.7,5.0],[6.7,-9.9,2.1,4.3],[10.5,-10.0,2.2,5.0],[13.6,-9.5,2.3,5.5],
  [2.4,-4.8,2.4,4.8],[2.6,-.8,2.7,5.6],[2.5,2.7,2.1,4.5],
  [3.2,8.8,2.6,5.7],[6.4,10.2,2.0,4.7],[10.4,10.0,2.3,5.4],[13.6,9.0,2.3,5.1],
  [14.3,-2.8,2.0,4.6],[14.4,.8,1.9,4.2],
];
function candidates():Candidate[]{
  const out:Candidate[]=treeAnchors.map(([x,z,w,h],i)=>({kind:i===1||i===9?'conifer':'canopy-tree',x,z,w,h,d:w*.86,seed:1400+i}));
  const pockets=[[1.2,-10.2],[4.8,-10.1],[8.3,-10.5],[12.1,-10.5],[14.9,-7.5],[1.1,-6.1],[3.3,-6.4],[1.1,-2.5],[4.3,-.3],[1.1,1.3],[1.3,7.2],[4.4,9.9],[8.1,10.5],[12.5,10.6],[14.9,7.0],[14.8,2.4]];
  pockets.forEach(([x,z],i)=>{
    out.push({kind:'shrub',x,z,w:.95+i%3*.12,h:.65+i%3*.11,d:.9,seed:1600+i});
    for(let j=0;j<5;j++){const a=i*.7+j*2.399;out.push({kind:'grass',x:x+Math.cos(a)*.88,z:z+Math.sin(a)*.75,w:.56,h:.28+j*.035,d:.49,seed:1700+i*7+j});}
  });
  for(const [i,[x,z]]of [[3.7,-7.0],[1.45,-3.8],[3.5,8.0],[14.5,-8.3]].entries())out.push({kind:'vine',x,z,w:.45,h:1.65+i*.1,d:.3,seed:1900+i});
  return out;
}
/** Fresh explicit diagnostics make clearance omissions reviewable. No previous
 * commons plants are transplanted, no caller input changed or root fallback. */
export function dryShoreInspection(design:ShoreDesign):{plants:readonly VegetationPlacement[];rejected:readonly Rejection[];candidateCount:number}{
  preflight(design);const plants:VegetationPlacement[]=[],rejected:Rejection[]=[],all=candidates();
  all.forEach((c,i)=>{
    const id='dry-shore-'+c.kind+'-'+i,r=Math.hypot(c.w,c.d)*.5;
    if(!commonsPlantFits(c.x,c.z,r)){rejected.push({id,reason:'bounds-or-commons-clearance'});return;}
    // Closed rectangle intersects conservative circle iff its nearest point is within r.
    const nearX=Math.max(-16,Math.min(0,c.x)),nearZ=Math.max(-12,Math.min(12,c.z));
    if(Math.hypot(c.x-nearX,c.z-nearZ)<=r){rejected.push({id,reason:'wet-envelope'});return;}
    const y=designHeightAt(design.terrain,c.x,c.z);
    if(y===null||!Number.isFinite(y))throw Error('Missing dry-shore root height');
    if(y<=design.water.datumY+.05){rejected.push({id,reason:'root-not-dry'});return;}
    plants.push({id,kind:c.kind,p:[c.x,y,c.z],size:[c.w,c.h,c.d],yaw:(c.seed*.618)%(Math.PI*2),seed:c.seed});
  });
  return {plants,rejected,candidateCount:all.length};
}
export function dryShorePlants(design:ShoreDesign):readonly VegetationPlacement[]{return dryShoreInspection(design).plants;}
export function createDryShoreGrove(design:ShoreDesign):ContentView{
  const plants=dryShorePlants(design); // complete validation and sampled roots before resources
  const view=new VegetationViews(plants);view.group.name='Dry Eden shore grove decorative proposal';
  return {group:view.group,dispose:()=>view.dispose()};
}
