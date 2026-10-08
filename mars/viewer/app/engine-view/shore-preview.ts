// Design-only depiction of World shore proposal. No canonical scene publication.
import * as THREE from 'three';
import { ThreeResources } from '../../lib/three-resources.ts';
import { VegetationViews, type VegetationPlacement } from './vegetation.ts';
type Point = [number, number, number];
export type ShoreDesign = {
  terrain: { originXZ: number[]; spacingMetres: number; columns: number; rows: number; heightMetres: number[][] };
  water: { datumY: number; wetDomain: { closedPolygonXZ: number[][] } };
  dock: { centre: number[]; sizeXYZ: number[]; shoreConnectionProposal: { width: number; path: number[][] } };
  boat: { poseProposal: { p: number[]; yaw: number }; deck: { topLocalY: number; visualThickness: number }; hullEnvelopeLocal: { minXYZ: number[]; maxXYZ: number[] } };
  boardingConnectorProposal: { centrelineAtProposedDockPose: number[][]; width: number; visualThickness: number };
};
/** Matches the proposal's min/min → max/max diagonal; display only, not Core support. */
export function designHeightAt(t: ShoreDesign['terrain'], x: number, z: number): number | null {
  const gx=(x-t.originXZ[0])/t.spacingMetres,gz=(z-t.originXZ[1])/t.spacingMetres;
  if(gx<0||gz<0||gx>t.columns-1||gz>t.rows-1)return null;
  const i=Math.min(t.columns-2,Math.floor(gx)),j=Math.min(t.rows-2,Math.floor(gz)),u=gx-i,v=gz-j;
  const a=t.heightMetres[j][i],b=t.heightMetres[j][i+1],c=t.heightMetres[j+1][i],d=t.heightMetres[j+1][i+1];
  return v<=u?a+(b-a)*u+(d-b)*v:a+(d-c)*u+(c-a)*v;
}
/** Explicit garden positions for this lookbook only. Tall plants need Core obstruction policy. */
export function shoreGardenPlants(t: ShoreDesign['terrain']): VegetationPlacement[] {
  const out: VegetationPlacement[]=[];
  const add=(kind:VegetationPlacement['kind'],x:number,z:number,size:Point,y=0)=>{
    const root=designHeightAt(t,x,z);if(root===null)throw Error('Garden root outside design');
    out.push({id:'shore-preview-'+out.length,kind,p:[x,root+y,z],size,seed:81+out.length});
  };
  for(const [x,z] of [[6,-9],[10,-8],[14,-6],[14,1],[13,8],[9,10],[5,10]])add('canopy-tree',x,z,[3,4.2,3]);
  for(const [x,z] of [[8,-10],[15,-2],[15,6]])add('conifer',x,z,[2.5,4.4,2.5]);
  for(const [x,z] of [[5,-7],[8,-7],[12,-5],[12,2],[11,8],[7,9],[4,9]])add('shrub',x,z,[1.5,.9,1.4]);
  for(let i=0;i<7;i++)add('reeds',.65,-6+i*.6,[.5,1.15,.5]);
  for(const [x,z] of [[3,-4],[3,-1],[5,-5],[10,-5],[12,4],[10,7],[6,8]])add('grass',x,z,[1.4,.35,1.4]);
  for(let row=0;row<2;row++)for(let i=0;i<4;i++)add('shrub',7+row*3.3,-2.6+i*.55,[.5,.4,.5],.415);
  for(let i=0;i<4;i++)add('vine',6.2+i*.5,-4.8,[.45,2,.3]);
  return out;
}

export class ShoreGardenPreview {
  readonly group=new THREE.Group();
  readonly plants:VegetationPlacement[];
  private resources=new ThreeResources();
  private vegetation:VegetationViews;
  private closed=false;
  constructor(design:ShoreDesign){
    this.group.name='Eden shore garden design preview';
    const t=design.terrain;
    if(!Number.isInteger(t.columns)||!Number.isInteger(t.rows)||t.columns<2||t.rows<2||t.columns>129||t.rows>129||!(t.spacingMetres>0)||!Number.isFinite(t.spacingMetres)||t.originXZ.length!==2||!t.originXZ.every(Number.isFinite)||t.heightMetres.length!==t.rows||t.heightMetres.some(row=>row.length!==t.columns||!row.every(Number.isFinite)))throw Error('Invalid bounded terrain design');
    const positions:number[]=[],indices:number[]=[],colors:number[]=[];
    const dry=new THREE.Color('#889b65'),sand=new THREE.Color('#bcb187'),bed=new THREE.Color('#8e8a72');
    for(let z=0;z<t.rows;z++)for(let x=0;x<t.columns;x++){
      const y=t.heightMetres[z][x];positions.push(t.originXZ[0]+x*t.spacingMetres,y,t.originXZ[1]+z*t.spacingMetres);
      const color=y<-.3?bed:y<.25?sand:dry;colors.push(color.r,color.g,color.b);
    }
    for(let z=0;z<t.rows-1;z++)for(let x=0;x<t.columns-1;x++){const a=z*t.columns+x,b=a+1,c=a+t.columns,d=c+1;indices.push(a,d,b,a,c,d);}
    const geo=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(positions,3)).setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.setIndex(indices);geo.computeVertexNormals();
    const terrain=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1}));terrain.receiveShadow=true;terrain.name='proposed terrain triangles';this.group.add(terrain);
    // This fixture has a rectangular calm domain. No wind/buoyancy/wave physics.
    const polygon=design.water.wetDomain.closedPolygonXZ;
    const waterGeo=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(polygon.slice(0,-1).flatMap(p=>[p[0],design.water.datumY,p[1]]),3));waterGeo.setIndex([0,2,1,0,3,2]);waterGeo.computeVertexNormals();
    const water=new THREE.Mesh(waterGeo,new THREE.MeshStandardMaterial({color:'#72a9ac',roughness:.28,metalness:.1,transparent:true,opacity:.82,side:THREE.DoubleSide}));water.name='proposed calm water datum';this.group.add(water);
    const mats=new Map<string,THREE.MeshStandardMaterial>(),boxGeo=new THREE.BoxGeometry(1,1,1);
    const box=(color:string,p:number[],size:number[],parent:THREE.Group=this.group)=>{
      let mat=mats.get(color);if(!mat){mat=new THREE.MeshStandardMaterial({color,roughness:.9});mats.set(color,mat);}
      const mesh=new THREE.Mesh(boxGeo,mat);mesh.position.set(p[0],p[1],p[2]);mesh.scale.set(size[0],size[1],size[2]);mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);return mesh;
    };
    const dock=design.dock;box('#a68b60',dock.centre,dock.sizeXYZ).name='proposed dock deck';
    // Overlay small plank seams, entirely cosmetic and above the design deck.
    for(let i=0;i<20;i++)box('#97805b',[-5.85+i*.3,dock.centre[1]+dock.sizeXYZ[1]/2+.003,5],[.012,.005,1.98]);
    for(const x of [-5.5,-3,-.5])for(const z of [4.2,5.8])box('#705b40',[x,-.35,z],[.14,2,.14]);
    const ramp=(path:number[][],width:number,thickness:number)=>{
      const a=new THREE.Vector3(...path[0]),b=new THREE.Vector3(...path[1]),delta=b.clone().sub(a),length=delta.length();
      const m=box('#b9a077',a.clone().add(b).multiplyScalar(.5).add(new THREE.Vector3(0,-thickness/2,0)).toArray(),[width,thickness,length]);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),delta.normalize());return m;
    };
    ramp(dock.shoreConnectionProposal.path,dock.shoreConnectionProposal.width,.08).name='proposed shore ramp';
    ramp(design.boardingConnectorProposal.centrelineAtProposedDockPose,design.boardingConnectorProposal.width,design.boardingConnectorProposal.visualThickness).name='proposed stopped gangway';
    const boat=new THREE.Group();boat.position.fromArray(design.boat.poseProposal.p);boat.rotation.y=-design.boat.poseProposal.yaw;this.group.add(boat);
    const hull=design.boat.hullEnvelopeLocal,min=hull.minXYZ,max=hull.maxXYZ;
    const outline=[[-1,0],[-.73,-1],[.73,-1],[1,0],[.73,1],[-.73,1]];
    const hp:number[]=[],hi:number[]=[];
    for(const y of [min[1],max[1]])for(const [x,z]of outline)hp.push(x*max[0]*(y===min[1]?.7:1),y,z*max[2]*(y===min[1]?.55:1));
    for(let i=0;i<6;i++){const j=(i+1)%6;hi.push(i,j,j+6,i,j+6,i+6);}
    hi.push(6,8,7,6,9,8,6,10,9,6,11,10);
    const hullGeo=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(hp,3));hullGeo.setIndex(hi);hullGeo.computeVertexNormals();
    const hullMesh=new THREE.Mesh(hullGeo,new THREE.MeshStandardMaterial({color:'#78674c',roughness:.7,side:THREE.DoubleSide}));hullMesh.castShadow=hullMesh.receiveShadow=true;hullMesh.name='proposed empty boat silhouette';boat.add(hullMesh);
    for(const x of [-.65,.65])box('#c4a677',[x,.75,0],[.42,.10,1.05],boat);
    // Garden beds are lookbook furniture, not the seed-deposit controller's state.
    for(const [i,x] of [7,10.3].entries()){
      const y=designHeightAt(t,x,-1.8)!;
      box('#554b35',[x,y+.20,-1.8],[1.1,.35,2.8]).name='proposed raised bed enclosure '+(i+1);box('#403d2d',[x,y+.39,-1.8],[.98,.05,2.65]);
    }
    for(const x of [6.1,7.9])box('#9f8a64',[x,designHeightAt(t,x,-4.8)!+1.1,-4.8],[.075,2.2,.075]);
    for(const y of [.65,1.3,2])box('#9f8a64',[7,designHeightAt(t,7,-4.8)!+y,-4.8],[1.9,.05,.05]);
    // Bench prototype; no engine seat slot or implied occupant.
    const by=designHeightAt(t,6,3)!;box('#ae9366',[6,by+.45,3],[2.1,.09,.48]);
    for(const x of [5.2,6.8])box('#806c4b',[x,by+.22,3],[.13,.44,.4]);
    this.resources.object(this.group);
    this.plants=shoreGardenPlants(t);this.vegetation=new VegetationViews(this.plants);this.group.add(this.vegetation.group);
  }
  dispose(){if(this.closed)return;this.closed=true;this.group.removeFromParent();this.vegetation.dispose();this.resources.dispose();this.group.clear();}
}
