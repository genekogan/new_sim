import type {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import type {SampledEntity} from '../../../mars/viewer/engine/take/replay.ts';
import {templateFromGltf,type Template} from '../../../mars/viewer/app/engine-view/people.ts';
import {recordedBody,admittedBodyUrl} from '../../../mars/viewer/app/engine-view/recorded-body.ts';
import {worldPath} from './world-path.ts';
import {validateBodyRig} from '../../../mars/viewer/app/engine-view/body-rig.ts';
/** Validated owner bodies remain separate from the stable built-in template choice. */
export class WorldBodyModels{
 readonly templates=new Map<string,Template>();private pending=new Set<string>();private failed=new Set<string>();private disposed=false;
 readonly unresolved=new Set<string>();
 constructor(private loader:GLTFLoader,private problem:(message:string)=>void){}
 sync(records:Readonly<Record<string,{kind:string;body?:unknown}>>,entities:Readonly<Record<string,SampledEntity>>){
  this.unresolved.clear();
  for(const [id,e] of Object.entries(entities)){const record=records[id];if(record?.kind!=='human')continue;const b=recordedBody(record.body,e.state);if(b?.family!=='humanoid'||!b.modelUrl)continue;
   const key=admittedBodyUrl(b.modelUrl);if(!key){this.unresolved.add(id);continue;}if(this.templates.has(key))continue;this.unresolved.add(id);if(this.pending.has(key)||this.failed.has(key))continue;this.pending.add(key);
   const url=admittedBodyUrl(key,worldPath)!;
   void this.loader.loadAsync(url).then(gltf=>{if(this.disposed){disposeModel(gltf.scene);return;}try{validateBodyRig(gltf);this.templates.set(key,templateFromGltf(b.model??key,gltf));}catch(error){disposeModel(gltf.scene);throw error;}},()=>{this.failed.add(key);if(!this.disposed)this.problem('A Soul’s uploaded body could not be shown; a simple figure marks its position.');}).catch(()=>{this.failed.add(key);if(!this.disposed)this.problem('A Soul’s uploaded rig could not be shown; a simple figure marks its position.');}).finally(()=>this.pending.delete(key));
  }
 }
 dispose(){this.disposed=true;for(const t of this.templates.values())disposeModel(t.gltf.scene);this.templates.clear();}
}
function disposeModel(root:import('three').Object3D){root.traverse(o=>{const mesh=o as import('three').Mesh;if(mesh.isMesh){mesh.geometry.dispose();for(const m of [mesh.material].flat()){for(const v of Object.values(m))if(v&&typeof v==='object'&&(v as {isTexture?:boolean}).isTexture)(v as import('three').Texture).dispose();m.dispose();}}});}
