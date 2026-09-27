import * as T from 'three';
export const BAY = 3.6576;
export const layers = {steel:'Rack steel', floor:'Timber, floors and stairs', roof:'Roofs and upper floors', wall:'Walls and screens', detail:'Interior details', context:'Site context'};
type XYZ = [number,number,number];

// ---- Stable component ids (docs/engineering/HISTORY_IDS.md) -------------------------
// `${assembly}-${kind}-${hash}`: hash = FNV-1a of kind + placement relative to the owning
// assembly group (position per 5 cm, rotation-matrix entries per ~1°). Independent of build
// order; identical kind+placement pairs get `-2`, `-3`… in build order. `Kit.named` pins
// an explicit `${assembly}-${name}` for pieces plans refer to.
export const slug=(s:string)=>s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||'component';
// Off-centre rounding: authored values are round decimals, so float noise never lands
// them on a quantisation boundary (which would make ids flicker between engines).
const quant=(v:number,step:number)=>Math.floor(v/step+.5137)||0;
const fnv1a=(s:string)=>{let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193);}return (h>>>0).toString(16).padStart(8,'0');};
const _inv=new T.Matrix4(),_m=new T.Matrix4(),_r=new T.Matrix4(),_p=new T.Vector3(),_q=new T.Quaternion(),_s=new T.Vector3();
/** Quantised placement of `o` in `assembly`'s frame; matrixWorld must be current. */
export function placementKey(assembly:T.Object3D,o:T.Object3D){
 _m.multiplyMatrices(_inv.copy(assembly.matrixWorld).invert(),o.matrixWorld).decompose(_p,_q,_s);
 const e=_r.makeRotationFromQuaternion(_q).elements;
 return [_p.x,_p.y,_p.z].map(v=>quant(v,.05)).join(',')+'|'+[e[0],e[1],e[2],e[4],e[5],e[6]].map(v=>quant(v,.0175)).join(',');
}
export type IdEntry={o:T.Object3D;assembly:T.Object3D;assemblyId:string;kind:string};
/** Assigns `component_id` to every entry (entries in build order); `taken` is per scene. */
export function assignStableIds(entries:IdEntry[],taken=new Set<string>()){
 for(const {o,assemblyId} of entries){const n=o.userData.named_id;if(!n)continue;const id=`${assemblyId}-${n}`;if(taken.has(id))throw Error(`Duplicate named component id: ${id}`);taken.add(id);o.userData.component_id=id;}
 for(const {o,assembly,assemblyId,kind} of entries){if(o.userData.named_id)continue;
  const base=`${assemblyId}-${slug(kind)}-${fnv1a(`${slug(kind)}|${placementKey(assembly,o)}`)}`;let id=base;for(let n=2;taken.has(id);n++)id=`${base}-${n}`;
  taken.add(id);o.userData.component_id=id;}
}
const isAssembly=(o:T.Object3D)=>Boolean(o.userData.assembly_id&&!o.userData.layer&&!o.userData.component_id);
export type KitHooks={/** Test hook: runs right after each assembly group is created. */assembly?:(k:Kit,g:T.Group)=>void};

/** Per-scene reusable geometry/material definitions; every instance remains editable. */
export class Kit {
 root = new T.Group();
 private geometries = new Map<string,T.BufferGeometry>();
 private materials = new Map<string,T.Material>();
 private tagged:{o:T.Object3D;g:T.Object3D}[]=[];
 private hooks:KitHooks;
 year:number;
 constructor(year:number,hooks:KitHooks={}) {this.year=year;this.hooks=hooks;this.root.name=`Mars ${year} · photographic reconstruction`;}
 mat(color:string,metalness=0) {
  const key=color+metalness; let m=this.materials.get(key);
  if(!m){m=new T.MeshStandardMaterial({color,metalness,roughness:metalness?0.5:0.86});if(!metalness && ['#b89770','#b99b75','#b89a75','#aa8d64','#bfa17b','#ae9165'].includes(color)){const map=new T.TextureLoader().load('/modular/textures/kitchen-plywood-sample.jpg');map.colorSpace=T.SRGBColorSpace;map.anisotropy=4;(m as T.MeshStandardMaterial).map=map;(m as T.MeshStandardMaterial).color.set('#ead8b7');}this.materials.set(key,m);}return m;
 }
 photo(url:string) {
  let m=this.materials.get(url);if(!m){const map=new T.TextureLoader().load(url);map.colorSpace=T.SRGBColorSpace;map.anisotropy=4;m=new T.MeshStandardMaterial({map,roughness:0.92,side:T.DoubleSide});this.materials.set(url,m);}return m;
 }
 assembly(id:string,name:string,p:XYZ=[0,0,0],rotation=0,source='Photographic fit; dimensions and hidden surfaces remain provisional') {
  const g=new T.Group();g.name=name;g.position.set(...p);g.rotation.y=rotation;g.userData={assembly_id:id,source,year:this.year};this.root.add(g);this.hooks.assembly?.(this,g);return g;
 }
 tag(g:T.Object3D,o:T.Object3D,name:string,layer:string,definition=name) {
  o.name=name;o.userData={assembly_id:String(g.userData.assembly_id),layer,kind:definition,definition_id:definition,source:g.userData.source};g.add(o);this.tagged.push({o,g});return o;
 }
 /** Pin an explicit, plan-addressable id: component_id becomes `${assembly}-${slug(id)}`. */
 named<O extends T.Object3D>(o:O,id:string):O {o.userData.named_id=slug(id);return o;}
 /** Assign stable component ids once the scene is fully built (placements are final). */
 finalize(taken=new Set<string>()) {
  this.root.updateMatrixWorld(true);const entries:IdEntry[]=[];
  for(const {o,g} of this.tagged){
   let attached=false;for(let p:T.Object3D|null=o;p;p=p.parent)if(p===this.root){attached=true;break;}
   if(!attached)continue; // removed after tagging (e.g. 2025 roof decks)
   let a:T.Object3D=g;while(!isAssembly(a)&&a.parent)a=a.parent;
   entries.push({o,assembly:a,assemblyId:String(o.userData.assembly_id),kind:String(o.userData.kind)});
  }
  assignStableIds(entries,taken);return this.root;
 }
 box(g:T.Object3D,name:string,size:XYZ,p:XYZ,material:T.Material|string='#b89770',layer:string=layers.detail) {
  const key=size.join(',');let geo=this.geometries.get(key);if(!geo){geo=new T.BoxGeometry(...size);this.geometries.set(key,geo);}
  const m=new T.Mesh(geo,typeof material==='string'?this.mat(material):material);m.position.set(...p);m.castShadow=true;m.receiveShadow=true;this.tag(g,m,name,layer);return m;
 }
 rod(g:T.Object3D,name:string,a:XYZ,b:XYZ,r=.025,color='#344149',layer:string=layers.steel) {
  const av=new T.Vector3(...a),bv=new T.Vector3(...b),d=bv.sub(av);const key=`rod:${r}:${d.length().toFixed(5)}`;let geo=this.geometries.get(key);if(!geo){geo=new T.CylinderGeometry(r,r,d.length(),6);this.geometries.set(key,geo);}
  const m=new T.Mesh(geo,this.mat(color,.3));m.position.copy(av).addScaledVector(d,.5);m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize());this.tag(g,m,name,layer);return m;
 }
 frame(g:T.Object3D,nx:number,nz:number,h=4.8768,upper=true,depth=nz*BAY) {
  const w=nx*BAY,frameWidth=h>3.66?.9144:1.2192;
  // Twelve-foot beams span across the rack. Upright frames repeat along its
  // depth; their spacing is estimated from photos, not pre-season design files.
  const rows=Math.max(1,Math.round((depth-frameWidth)/1.8288)),step=(depth-frameWidth)/rows;
  for(let ix=0;ix<=nx;ix++)for(let iz=0;iz<=rows;iz++){
   const x=ix*BAY-w/2,z=iz*step-(depth-frameWidth)/2;
   for(const dz of [-frameWidth/2,frameWidth/2])this.box(g,'rack upright',[.075,h,.075],[x,h/2,z+dz],this.mat('#293c45',.55),layers.steel);
   for(let y=.25;y<h-.6;y+=.7)this.rod(g,'upright bracing',[x,y,z-frameWidth/2],[x,y+.66,z+frameWidth/2],.014);
   this.box(g,'upright crossbar',[.04,.04,frameWidth],[x,.25,z],'#33464e',layers.steel);
  }
  for(const y of [.22,...(upper?[2.48]:[]),h-.12])for(let iz=0;iz<=rows;iz++)for(let ix=0;ix<nx;ix++)for(const side of [-1,1])this.box(g,'12 foot orange beam',[BAY,.12,.08],[(ix+.5)*BAY-w/2,y,iz*step-(depth-frameWidth)/2+side*frameWidth/2],this.mat('#b84c26',.4),layers.steel);
 }
 deck(g:T.Object3D,w:number,d:number,y:number,x=0,z=0,roof=false) {
  for(let i=0;i<Math.ceil(w/1.2192);i++){const width=Math.min(1.2192,w-i*1.2192);this.box(g,'plywood deck sheet',[width-.008,.065,d],[x-w/2+i*1.2192+width/2,y,z],i%2?'#aa8d64':'#bfa17b',roof?layers.roof:layers.floor);}
 }
 wall(g:T.Object3D,w:number,h:number,x:number,z:number,y=h/2,color:T.Material|string='#b99b75',angle=0){const m=this.box(g,'plywood wall',[w,h,.055],[x,y,z],color,layers.wall);m.rotation.y=angle;return m;}
 stairs(g:T.Object3D,w:number,run:number,rise:number,x:number,z:number,n=14){
  for(let i=0;i<n;i++){const y=.24+(i+1)*rise/n,zz=z+run/2-(i+.5)*run/n;this.box(g,'stair tread',[w,.06,run/n-.009],[x,y,zz],'#b89a75',layers.floor);const r=this.box(g,'stair riser',[w,rise/n,.035],[x,y-rise/n/2,zz+run/n/2],'#937654',layers.floor);r.userData.walkNoCollision=true;}
  for(const dx of [-w/2,w/2]){this.rod(g,'stair rail',[x+dx,1.1,z+run/2],[x+dx,rise+1.1,z-run/2],.035,'#a48661',layers.floor);for(let i=0;i<=3;i++)this.rod(g,'stair rail post',[x+dx,.25+i*rise/3,z+run/2-i*run/3],[x+dx,1.1+i*rise/3,z+run/2-i*run/3],.03,'#a48661',layers.floor);}
 }
 solar(g:T.Object3D,w:number,length:number,x:number,y:number,z:number,tilt:number){
  const columns=Math.round(w/1.05),rows=Math.round(length/1.65),cw=w/columns,rh=length/rows;
  for(let c=0;c<columns;c++)for(let r=0;r<rows;r++){
   const dz=(r+.5)*rh-length/2,p:XYZ=[x+(c+.5)*cw-w/2,y-dz*Math.sin(tilt),z+dz*Math.cos(tilt)];
   const panel=this.box(g,'solar panel',[cw-.025,.045,rh-.025],p,this.mat('#a6abb1',.6),layers.roof);panel.rotation.x=tilt;
   const cells=this.box(g,'photovoltaic cells',[cw-.08,.008,rh-.08],[p[0],p[1]+.03*Math.cos(tilt),p[2]+.03*Math.sin(tilt)],this.mat('#1c344b',.25),layers.roof);cells.rotation.x=tilt;
   // Fine cell divisions are texture-scale detail, not hundreds of scene nodes.
  }
 }
 table(g:T.Object3D,x:number,z:number,w=1.8,d=.75,y=.78){this.box(g,'table top',[w,.045,d],[x,y,z],'#d6d0bc');for(const a of [-1,1])for(const b of [-1,1])this.rod(g,'table leg',[x+a*(w/2-.12),.1,z+b*(d/2-.1)],[x+a*(w/2-.12),y,z+b*(d/2-.1)],.022);}
 screen(g:T.Object3D,x:number,y:number,z:number,w=1.3,angle=0,height=w*.5625){
  const s=this.box(g,'screen bezel',[w,height,.075],[x,y,z],'#17191c');s.rotation.y=angle;
  const texture=this.photo('/2020/screens/portal-screen-02.webp');const map=(texture as T.MeshStandardMaterial).map;
  const m=new T.MeshBasicMaterial({map,toneMapped:false});const o=new T.Mesh(new T.PlaneGeometry(w-.05,height-.05),m);o.position.set(x+Math.sin(angle)*.041,y,z+Math.cos(angle)*.041);o.rotation.y=angle;this.tag(g,o,'display content',layers.detail,'screen');
 }
 kitchen(g:T.Object3D,w:number,d:number,year=this.year){
  for(const x of [-w/2+.42,w/2-.42]){this.table(g,x,0,.7,d-1,.91);for(let i=0;i<6;i++)this.box(g,'stored food crate',[.43,.32,.45],[x,.38,-d/2+.9+i*.68],['#92744e','#d2c3a2','#646b5a'][i%3]);}
  this.table(g,0,0,1.1,2.1,.91);
  const fx=w/2-.5,fz=-d/2+.52;
  this.box(g,'white refrigerator',[.8,1.8,.75],[fx,.92,fz],'#d7d8ce');this.box(g,'freezer door seam',[.79,.018,.025],[fx,1.43,fz+.39],'#555d5f');for(const yy of [.96,1.58])this.box(g,'fridge handle',[.025,.22,.04],[fx-.27,yy,fz+.42],'#686e70');
  for(let shelf=0;shelf<3;shelf++){this.box(g,'pantry shelf',[2.2,.04,.32],[-.4,1.05+shelf*.34,-d/2+.19]);for(let i=0;i<10;i++)this.box(g,'pantry jar',[.12,.13+(i%3)*.04,.12],[-1.35+i*.2,1.14+shelf*.34,-d/2+.16],['#bc9652','#dad0ae','#7c805a','#a04930'][i%4]);}
  this.box(g,'stainless sink rim',[.64,.055,.7],[-w/2+.42,.95,0],this.mat('#9babad',.65));this.box(g,'sink bowl',[.46,.025,.51],[-w/2+.42,.982,0],'#454d4d');this.rod(g,'tap',[-w/2+.18,.96,0],[-w/2+.18,1.27,0],.018,'#a5b2b4');this.rod(g,'tap spout',[-w/2+.18,1.27,0],[-w/2+.4,1.27,0],.018,'#a5b2b4');
  const potGeo=new T.CylinderGeometry(.14,.12,.19,12);for(let i=0;i<(year===2020?3:7);i++){const pot=new T.Mesh(potGeo,this.mat('#7d8584',.65));pot.position.set(w/2-.42,1.03,-d/2+1.1+i*.36);this.tag(g,pot,'cooking pot',layers.detail);}
  for(let i=0;i<5;i++)this.box(g,'cup',[.09,.11,.09],[-w/2+.4,.995,1+i*.17],['#bec8bb','#b67442','#536e81'][i%3]);
 }
 rv(id:string,x:number,z:number,angle:number,length=6.8){const g=this.assembly(id,'Travel trailer',[x,0,z],angle);this.box(g,'trailer shell',[2.35,2.35,length],[0,1.65,0],'#d8d8ce',layers.context);this.box(g,'roof AC',[.75,.23,.85],[0,2.94,.4],'#aaaead',layers.context);for(const side of [-1,1]){for(const zz of [-1.7,.9])this.box(g,'trailer window',[.025,.65,1.1],[side*1.19,1.94,zz],'#344347',layers.context);this.box(g,'trailer trim',[.03,.13,length-.1],[side*1.2,1.0,0],'#8f999a',layers.context);for(const zz of [-.6,.6]){const wheel=new T.Mesh(new T.CylinderGeometry(.34,.34,.16,12),this.mat('#222527'));wheel.rotation.z=Math.PI/2;wheel.position.set(side*1.13,.34,zz);this.tag(g,wheel,'trailer wheel',layers.context);}}return g;}
 visitors(count:number){const g=this.assembly('people','Visitors · illustrative');for(let i=0;i<count;i++){const o=new T.Group();o.name=`Visitor ${i+1}`;o.position.set(Math.sin(i*2.4)*(12+i*.55),-.16,10+Math.cos(i*2.4)*(10+i*.4));o.userData={assembly_id:'people',component_id:`person-${i+1}`,kind:'context_person',definition_id:['person_casual','person_punk','person_woman'][i%3]};g.add(o);}}
}
